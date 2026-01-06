/**
 * @fileoverview Chat session persistence service.
 * Stores and retrieves AI conversation history across server restarts.
 * @module services/chatSessions
 */

import db from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Session types for different AI interactions.
 * @type {Object}
 */
export const SESSION_TYPES = {
  SOMMELIER: 'sommelier',
  ZONE_CHAT: 'zone_chat',
  CELLAR_ANALYSIS: 'cellar_analysis',
  DRINK_RECOMMENDATIONS: 'drink_recommendations'
};

/**
 * Session statuses.
 * @type {Object}
 */
export const SESSION_STATUS = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  EXPIRED: 'expired'
};

/**
 * Create a new chat session.
 * @param {string} sessionType - Type of session (from SESSION_TYPES)
 * @param {Object} context - Initial context for the session
 * @returns {Object} Created session { id, sessionType, startedAt, context }
 */
export function createSession(sessionType, context = {}) {
  const id = uuidv4();
  const now = new Date().toISOString();
  const contextJson = JSON.stringify(context);

  db.prepare(`
    INSERT INTO chat_sessions (id, session_type, started_at, last_activity, context_json, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, sessionType, now, now, contextJson, SESSION_STATUS.ACTIVE);

  return {
    id,
    sessionType,
    startedAt: now,
    lastActivity: now,
    context,
    status: SESSION_STATUS.ACTIVE
  };
}

/**
 * Get a session by ID.
 * @param {string} sessionId - Session ID
 * @returns {Object|null} Session or null if not found
 */
export function getSession(sessionId) {
  const row = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId);

  if (!row) return null;

  return {
    id: row.id,
    sessionType: row.session_type,
    startedAt: row.started_at,
    lastActivity: row.last_activity,
    context: safeJsonParse(row.context_json, {}),
    status: row.status
  };
}

/**
 * Get active session of a specific type.
 * Returns most recent active session for the type.
 * @param {string} sessionType - Type of session
 * @returns {Object|null} Active session or null
 */
export function getActiveSession(sessionType) {
  const row = db.prepare(`
    SELECT * FROM chat_sessions
    WHERE session_type = ? AND status = ?
    ORDER BY last_activity DESC
    LIMIT 1
  `).get(sessionType, SESSION_STATUS.ACTIVE);

  if (!row) return null;

  return {
    id: row.id,
    sessionType: row.session_type,
    startedAt: row.started_at,
    lastActivity: row.last_activity,
    context: safeJsonParse(row.context_json, {}),
    status: row.status
  };
}

/**
 * Add a message to a session.
 * @param {string} sessionId - Session ID
 * @param {string} role - Message role ('user', 'assistant', 'system')
 * @param {string} content - Message content
 * @param {Object} metadata - Optional metadata { tokensUsed, modelUsed }
 * @returns {Object} Created message
 */
export function addMessage(sessionId, role, content, metadata = {}) {
  const now = new Date().toISOString();

  const result = db.prepare(`
    INSERT INTO chat_messages (session_id, role, content, created_at, tokens_used, model_used)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    role,
    content,
    now,
    metadata.tokensUsed || null,
    metadata.modelUsed || null
  );

  // Update session last activity
  db.prepare(`
    UPDATE chat_sessions SET last_activity = ? WHERE id = ?
  `).run(now, sessionId);

  return {
    id: result.lastInsertRowid,
    sessionId,
    role,
    content,
    createdAt: now,
    tokensUsed: metadata.tokensUsed,
    modelUsed: metadata.modelUsed
  };
}

/**
 * Get messages for a session.
 * @param {string} sessionId - Session ID
 * @param {number} limit - Max messages to return (default all)
 * @returns {Array} Messages ordered by creation time
 */
export function getMessages(sessionId, limit = 0) {
  let query = `
    SELECT * FROM chat_messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `;

  if (limit > 0) {
    query += ` LIMIT ${limit}`;
  }

  const rows = db.prepare(query).all(sessionId);

  return rows.map(row => ({
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    tokensUsed: row.tokens_used,
    modelUsed: row.model_used
  }));
}

/**
 * Get recent messages formatted for Claude API.
 * @param {string} sessionId - Session ID
 * @param {number} maxMessages - Max messages to include (default 20)
 * @returns {Array} Messages formatted as { role, content }
 */
export function getMessagesForAPI(sessionId, maxMessages = 20) {
  const messages = getMessages(sessionId);

  // Filter out system messages and take most recent
  const apiMessages = messages
    .filter(m => m.role !== 'system')
    .slice(-maxMessages)
    .map(m => ({
      role: m.role,
      content: m.content
    }));

  return apiMessages;
}

/**
 * Update session status.
 * @param {string} sessionId - Session ID
 * @param {string} status - New status
 */
export function updateSessionStatus(sessionId, status) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE chat_sessions SET status = ?, last_activity = ? WHERE id = ?
  `).run(status, now, sessionId);
}

/**
 * Complete a session.
 * @param {string} sessionId - Session ID
 */
export function completeSession(sessionId) {
  updateSessionStatus(sessionId, SESSION_STATUS.COMPLETED);
}

/**
 * Get or create an active session.
 * @param {string} sessionType - Type of session
 * @param {Object} context - Context for new session if created
 * @returns {Object} Session (existing or new)
 */
export function getOrCreateSession(sessionType, context = {}) {
  const existing = getActiveSession(sessionType);
  if (existing) return existing;
  return createSession(sessionType, context);
}

/**
 * Get recent sessions of a type.
 * @param {string} sessionType - Type of session
 * @param {number} limit - Max sessions to return
 * @returns {Array} Sessions ordered by last activity
 */
export function getRecentSessions(sessionType, limit = 10) {
  const rows = db.prepare(`
    SELECT * FROM chat_sessions
    WHERE session_type = ?
    ORDER BY last_activity DESC
    LIMIT ?
  `).all(sessionType, limit);

  return rows.map(row => ({
    id: row.id,
    sessionType: row.session_type,
    startedAt: row.started_at,
    lastActivity: row.last_activity,
    context: safeJsonParse(row.context_json, {}),
    status: row.status
  }));
}

/**
 * Cleanup expired sessions.
 * Marks sessions inactive for more than specified hours as expired.
 * @param {number} hoursOld - Age threshold in hours (default 24)
 * @returns {number} Number of sessions expired
 */
export function cleanupExpiredSessions(hoursOld = 24) {
  const cutoff = new Date(Date.now() - hoursOld * 60 * 60 * 1000).toISOString();

  const result = db.prepare(`
    UPDATE chat_sessions
    SET status = ?
    WHERE status = ? AND last_activity < ?
  `).run(SESSION_STATUS.EXPIRED, SESSION_STATUS.ACTIVE, cutoff);

  return result.changes;
}

/**
 * Delete old sessions and their messages.
 * @param {number} daysOld - Age threshold in days (default 30)
 * @returns {number} Number of sessions deleted
 */
export function deleteOldSessions(daysOld = 30) {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();

  // Messages are deleted via CASCADE
  const result = db.prepare(`
    DELETE FROM chat_sessions WHERE last_activity < ?
  `).run(cutoff);

  return result.changes;
}

/**
 * Get session statistics.
 * @returns {Object} Statistics about sessions
 */
export function getSessionStats() {
  const stats = db.prepare(`
    SELECT
      session_type,
      status,
      COUNT(*) as count,
      SUM((SELECT COUNT(*) FROM chat_messages WHERE session_id = chat_sessions.id)) as message_count
    FROM chat_sessions
    GROUP BY session_type, status
  `).all();

  const totals = db.prepare(`
    SELECT
      COUNT(DISTINCT id) as total_sessions,
      (SELECT COUNT(*) FROM chat_messages) as total_messages
    FROM chat_sessions
  `).get();

  return {
    byTypeAndStatus: stats,
    totals
  };
}

/**
 * Safely parse JSON string.
 * @param {string} jsonStr - JSON string to parse
 * @param {*} fallback - Fallback value if parse fails
 * @returns {*} Parsed value or fallback
 */
function safeJsonParse(jsonStr, fallback) {
  if (!jsonStr) return fallback;
  try {
    return JSON.parse(jsonStr);
  } catch {
    return fallback;
  }
}
