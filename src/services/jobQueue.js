/**
 * @fileoverview Background job queue with EventEmitter-based processing.
 * @module services/jobQueue
 */

import crypto from 'crypto';
import { EventEmitter } from 'events';
import db from '../db/index.js';
import logger from '../utils/logger.js';

class JobQueue extends EventEmitter {
  constructor() {
    super();
    this.isProcessing = false;
    this.currentJob = null;
    this.handlers = {};
    this.pollInterval = null;
  }

  /**
   * Register a job handler.
   * @param {string} jobType - Job type identifier
   * @param {Function} handler - Async handler function
   */
  registerHandler(jobType, handler) {
    this.handlers[jobType] = handler;
    logger.info('JobQueue', `Registered handler for: ${jobType}`);
  }

  /**
   * Add a job to the queue.
   * @param {string} jobType - Job type
   * @param {Object} payload - Job parameters
   * @param {Object} options - Job options
   * @returns {number} Job ID
   */
  async enqueue(jobType, payload, options = {}) {
    const { priority = 5, scheduledFor = null, maxAttempts = 3 } = options;

    // Generate UUID for job ID (PostgreSQL doesn't have auto-increment rowid)
    const jobId = crypto.randomUUID();
    const scheduledTime = scheduledFor || new Date().toISOString();

    await db.prepare(`
      INSERT INTO job_queue (id, job_type, payload, priority, max_attempts, scheduled_for)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      jobId,
      jobType,
      JSON.stringify(payload),
      priority,
      maxAttempts,
      scheduledTime
    );

    this.emit('job:queued', { jobId, jobType, payload });
    logger.info('JobQueue', `Queued job ${jobId}: ${jobType}`);

    // Trigger processing if not already running
    if (!this.isProcessing) {
      setImmediate(() => this.processNext());
    }

    return jobId;
  }

  /**
   * Get job status.
   * @param {string} jobId - Job ID
   * @returns {Object|null} Job status
   */
  async getJobStatus(jobId) {
    // Check active queue first
    let job = await db.prepare(`
      SELECT id, job_type, status, progress, progress_message, result, created_at, started_at, completed_at
      FROM job_queue WHERE id = ?
    `).get(jobId);

    // Check history if not found
    if (!job) {
      job = await db.prepare(`
        SELECT id, job_type, status, result, created_at, completed_at,
               100 as progress, 'Completed' as progress_message
        FROM job_history WHERE id = ?
      `).get(jobId);
    }

    return job || null;
  }

  /**
   * Update job progress.
   * @param {string} jobId - Job ID
   * @param {number} progress - Progress percentage (0-100)
   * @param {string|null} message - Progress message
   */
  async updateProgress(jobId, progress, message = null) {
    await db.prepare(`
      UPDATE job_queue SET progress = ?, progress_message = ? WHERE id = ?
    `).run(progress, message, jobId);

    this.emit('job:progress', { jobId, progress, message });
  }

  /**
   * Process next job in queue.
   */
  async processNext() {
    if (this.isProcessing) return;

    this.isProcessing = true;

    try {
      // Get next pending job (use CURRENT_TIMESTAMP for PostgreSQL compatibility)
      const job = await db.prepare(`
        SELECT * FROM job_queue
        WHERE status = 'pending'
          AND scheduled_for <= CURRENT_TIMESTAMP
          AND attempts < max_attempts
        ORDER BY priority ASC, created_at ASC
        LIMIT 1
      `).get();

      if (!job) {
        this.isProcessing = false;
        return;
      }

      this.currentJob = job;

      // Mark as running
      await db.prepare(`
        UPDATE job_queue
        SET status = 'running', started_at = CURRENT_TIMESTAMP, attempts = attempts + 1
        WHERE id = ?
      `).run(job.id);

      this.emit('job:started', { jobId: job.id, jobType: job.job_type });
      logger.info('JobQueue', `Started job ${job.id}: ${job.job_type}`);

      // Execute handler
      const handler = this.handlers[job.job_type];
      if (!handler) {
        throw new Error(`No handler registered for job type: ${job.job_type}`);
      }

      const payload = JSON.parse(job.payload);
      const result = await handler(payload, {
        jobId: job.id,
        updateProgress: (p, m) => this.updateProgress(job.id, p, m)
      });

      // Mark as completed
      await db.prepare(`
        UPDATE job_queue
        SET status = 'completed', progress = 100, result = ?, completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(JSON.stringify(result), job.id);

      this.emit('job:completed', { jobId: job.id, result });
      logger.info('JobQueue', `Completed job ${job.id}`);

      // Move to history
      await this.archiveJob(job.id);

    } catch (error) {
      logger.error('JobQueue', `Job ${this.currentJob?.id} failed: ${error.message}`);

      if (this.currentJob) {
        const job = this.currentJob;
        const currentAttempts = (job.attempts || 0) + 1;

        if (currentAttempts >= (job.max_attempts || 3)) {
          // Max retries exceeded
          await db.prepare(`
            UPDATE job_queue
            SET status = 'failed', result = ?, completed_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(JSON.stringify({ error: error.message }), job.id);

          this.emit('job:failed', { jobId: job.id, error: error.message });
          logger.error('JobQueue', `Job ${job.id} failed permanently after ${currentAttempts} attempts`);
          await this.archiveJob(job.id);
        } else {
          // Schedule retry with exponential backoff
          const backoffMinutes = Math.pow(2, currentAttempts);
          const retryAt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

          await db.prepare(`
            UPDATE job_queue
            SET status = 'pending', scheduled_for = ?
            WHERE id = ?
          `).run(retryAt, job.id);

          this.emit('job:retry', { jobId: job.id, attempt: currentAttempts, retryIn: backoffMinutes });
          logger.info('JobQueue', `Job ${job.id} scheduled for retry in ${backoffMinutes} minutes`);
        }
      }
    } finally {
      this.currentJob = null;
      this.isProcessing = false;

      // Process next job
      setImmediate(() => this.processNext());
    }
  }

  /**
   * Archive completed/failed job to history.
   * @param {string} jobId - Job ID
   */
  async archiveJob(jobId) {
    try {
      // Use EXTRACT for PostgreSQL-compatible duration calculation
      await db.prepare(`
        INSERT INTO job_history (id, job_type, status, payload, result, created_at, completed_at)
        SELECT id, job_type, status, payload, result, created_at, completed_at
        FROM job_queue WHERE id = ?
      `).run(jobId);

      await db.prepare('DELETE FROM job_queue WHERE id = ?').run(jobId);
    } catch (err) {
      logger.warn('JobQueue', `Archive failed for job ${jobId}: ${err.message}`);
    }
  }

  /**
   * Start the queue processor.
   */
  start() {
    logger.info('JobQueue', 'Starting queue processor');
    this.processNext();

    // Periodic check for scheduled jobs
    this.pollInterval = setInterval(() => this.processNext(), 5000);
  }

  /**
   * Stop the queue processor.
   */
  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    logger.info('JobQueue', 'Queue processor stopped');
  }

  /**
   * Get queue statistics.
   * @returns {Object} Queue stats
   */
  async getStats() {
    const pending = await db.prepare('SELECT COUNT(*) as count FROM job_queue WHERE status = ?').get('pending');
    const running = await db.prepare('SELECT COUNT(*) as count FROM job_queue WHERE status = ?').get('running');
    const failed = await db.prepare('SELECT COUNT(*) as count FROM job_queue WHERE status = ?').get('failed');
    const completedToday = await db.prepare(`
      SELECT COUNT(*) as count FROM job_history
      WHERE completed_at > CURRENT_TIMESTAMP - INTERVAL '1 day'
    `).get();

    return {
      pending: pending?.count || 0,
      running: running?.count || 0,
      failed: failed?.count || 0,
      completedToday: completedToday?.count || 0
    };
  }

  /**
   * Cancel a pending job.
   * @param {string} jobId - Job ID
   * @returns {boolean} Whether job was cancelled
   */
  async cancelJob(jobId) {
    const result = await db.prepare(`
      DELETE FROM job_queue WHERE id = ? AND status = 'pending'
    `).run(jobId);

    if (result.changes > 0) {
      this.emit('job:cancelled', { jobId });
      logger.info('JobQueue', `Cancelled job ${jobId}`);
      return true;
    }
    return false;
  }

  /**
   * Get pending jobs.
   * @param {number} limit - Max jobs to return
   * @returns {Array} Pending jobs
   */
  async getPendingJobs(limit = 10) {
    return await db.prepare(`
      SELECT id, job_type, priority, payload, created_at, scheduled_for
      FROM job_queue
      WHERE status = 'pending'
      ORDER BY priority ASC, created_at ASC
      LIMIT ?
    `).all(limit);
  }
}

// Singleton instance
const jobQueue = new JobQueue();

export default jobQueue;
