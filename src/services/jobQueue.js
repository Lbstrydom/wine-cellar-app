/**
 * @fileoverview Background job queue with EventEmitter-based processing.
 * @module services/jobQueue
 */

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
  enqueue(jobType, payload, options = {}) {
    const { priority = 5, scheduledFor = null, maxAttempts = 3 } = options;

    // Use SQLite-compatible datetime format (UTC)
    const scheduledTime = scheduledFor || new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0];

    const result = db.prepare(`
      INSERT INTO job_queue (job_type, payload, priority, max_attempts, scheduled_for)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      jobType,
      JSON.stringify(payload),
      priority,
      maxAttempts,
      scheduledTime
    );

    const jobId = result.lastInsertRowid;
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
   * @param {number} jobId - Job ID
   * @returns {Object|null} Job status
   */
  getJobStatus(jobId) {
    // Check active queue first
    let job = db.prepare(`
      SELECT id, job_type, status, progress, progress_message, result, created_at, started_at, completed_at
      FROM job_queue WHERE id = ?
    `).get(jobId);

    // Check history if not found
    if (!job) {
      job = db.prepare(`
        SELECT id, job_type, status, result, created_at, completed_at,
               100 as progress, 'Completed' as progress_message
        FROM job_history WHERE id = ?
      `).get(jobId);
    }

    return job || null;
  }

  /**
   * Update job progress.
   * @param {number} jobId - Job ID
   * @param {number} progress - Progress percentage (0-100)
   * @param {string|null} message - Progress message
   */
  updateProgress(jobId, progress, message = null) {
    db.prepare(`
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
      // Get next pending job
      const job = db.prepare(`
        SELECT * FROM job_queue
        WHERE status = 'pending'
          AND scheduled_for <= datetime('now')
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
      db.prepare(`
        UPDATE job_queue
        SET status = 'running', started_at = datetime('now'), attempts = attempts + 1
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
      db.prepare(`
        UPDATE job_queue
        SET status = 'completed', progress = 100, result = ?, completed_at = datetime('now')
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
          db.prepare(`
            UPDATE job_queue
            SET status = 'failed', result = ?, completed_at = datetime('now')
            WHERE id = ?
          `).run(JSON.stringify({ error: error.message }), job.id);

          this.emit('job:failed', { jobId: job.id, error: error.message });
          logger.error('JobQueue', `Job ${job.id} failed permanently after ${currentAttempts} attempts`);
          await this.archiveJob(job.id);
        } else {
          // Schedule retry with exponential backoff
          const backoffMinutes = Math.pow(2, currentAttempts);
          const retryAt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

          db.prepare(`
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
   * @param {number} jobId - Job ID
   */
  async archiveJob(jobId) {
    try {
      db.prepare(`
        INSERT INTO job_history (id, job_type, status, payload, result, duration_ms, created_at, completed_at)
        SELECT id, job_type, status, payload, result,
          CAST((julianday(completed_at) - julianday(COALESCE(started_at, created_at))) * 86400000 AS INTEGER),
          created_at, completed_at
        FROM job_queue WHERE id = ?
      `).run(jobId);

      db.prepare('DELETE FROM job_queue WHERE id = ?').run(jobId);
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
  getStats() {
    const pending = db.prepare('SELECT COUNT(*) as count FROM job_queue WHERE status = ?').get('pending');
    const running = db.prepare('SELECT COUNT(*) as count FROM job_queue WHERE status = ?').get('running');
    const failed = db.prepare('SELECT COUNT(*) as count FROM job_queue WHERE status = ?').get('failed');
    const completedToday = db.prepare(`
      SELECT COUNT(*) as count FROM job_history
      WHERE completed_at > datetime('now', '-1 day')
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
   * @param {number} jobId - Job ID
   * @returns {boolean} Whether job was cancelled
   */
  cancelJob(jobId) {
    const result = db.prepare(`
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
  getPendingJobs(limit = 10) {
    return db.prepare(`
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
