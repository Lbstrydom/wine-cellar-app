/**
 * @fileoverview Simple file logger for rating searches.
 * @module utils/logger
 */

import fs from 'fs';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'data');
const LOG_FILE = path.join(LOG_DIR, 'ratings-search.log');

// Ensure data directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Format timestamp for log entries.
 * @returns {string} Formatted timestamp
 */
function timestamp() {
  return new Date().toISOString();
}

/**
 * Write to log file and console.
 * @param {string} level - Log level (INFO, WARN, ERROR)
 * @param {string} category - Log category (e.g., 'Search', 'Fetch', 'Ratings')
 * @param {string} message - Log message
 */
function log(level, category, message) {
  const entry = `[${timestamp()}] [${level}] [${category}] ${message}`;

  // Write to console
  console.log(entry);

  // Append to file
  fs.appendFileSync(LOG_FILE, entry + '\n');
}

/**
 * Log info message.
 * @param {string} category - Log category
 * @param {string} message - Log message
 */
export function info(category, message) {
  log('INFO', category, message);
}

/**
 * Log warning message.
 * @param {string} category - Log category
 * @param {string} message - Log message
 */
export function warn(category, message) {
  log('WARN', category, message);
}

/**
 * Log error message.
 * @param {string} category - Log category
 * @param {string} message - Log message
 */
export function error(category, message) {
  log('ERROR', category, message);
}

/**
 * Log a separator line.
 */
export function separator() {
  const line = '='.repeat(80);
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

/**
 * Get the log file path.
 * @returns {string} Log file path
 */
export function getLogPath() {
  return LOG_FILE;
}

export default { info, warn, error, separator, getLogPath };
