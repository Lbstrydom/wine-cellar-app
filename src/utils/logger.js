/**
 * @fileoverview Structured logging with Winston (backward-compatible API).
 * @module utils/logger
 */

import winston from 'winston';
import fs from 'fs';
import path from 'path';

const { combine, timestamp, printf, colorize, json } = winston.format;

const LOG_DIR = path.join(process.cwd(), 'data');
const LOG_FILE = path.join(LOG_DIR, 'ratings-search.log');

// Ensure data directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Custom format for development console output.
 */
const devFormat = printf(({ level, message, timestamp: ts, category, ...meta }) => {
  const cat = category ? `[${category}] ` : '';
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `${ts} [${level.toUpperCase()}] ${cat}${message}${metaStr}`;
});

/**
 * Custom format for file output (matches legacy format).
 */
const fileFormat = printf(({ level, message, timestamp: ts, category }) => {
  const cat = category ? `[${category}] ` : '';
  return `[${ts}] [${level.toUpperCase()}] ${cat}${message}`;
});

/**
 * Create Winston logger instance.
 */
const winstonLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  defaultMeta: { service: 'wine-cellar' },
  transports: []
});

// Console transport
if (process.env.NODE_ENV === 'production') {
  // Production: JSON format for log aggregation
  winstonLogger.add(new winston.transports.Console({
    format: combine(
      timestamp(),
      json()
    )
  }));
} else {
  // Development: Colorized console output
  winstonLogger.add(new winston.transports.Console({
    format: combine(
      colorize(),
      timestamp({ format: 'HH:mm:ss' }),
      devFormat
    )
  }));
}

// File transport (always active for backward compatibility)
winstonLogger.add(new winston.transports.File({
  filename: LOG_FILE,
  format: combine(
    timestamp(),
    fileFormat
  ),
  maxsize: 5242880, // 5MB
  maxFiles: 3
}));

/**
 * Log info message (backward-compatible API).
 * @param {string} category - Log category
 * @param {string} message - Log message
 */
export function info(category, message) {
  winstonLogger.info(message, { category });
}

/**
 * Log warning message (backward-compatible API).
 * @param {string} category - Log category
 * @param {string} message - Log message
 */
export function warn(category, message) {
  winstonLogger.warn(message, { category });
}

/**
 * Log error message (backward-compatible API).
 * @param {string} category - Log category
 * @param {string} message - Log message
 */
export function error(category, message) {
  winstonLogger.error(message, { category });
}

/**
 * Log debug message.
 * @param {string} category - Log category
 * @param {string} message - Log message
 */
export function debug(category, message) {
  winstonLogger.debug(message, { category });
}

/**
 * Log a separator line (backward-compatible).
 */
export function separator() {
  const line = '='.repeat(80);
  winstonLogger.info(line);
}

/**
 * Get the log file path (backward-compatible).
 * @returns {string} Log file path
 */
export function getLogPath() {
  return LOG_FILE;
}

/**
 * Create a child logger with additional context.
 * @param {Object} meta - Additional metadata
 * @returns {Object} Logger with bound metadata
 */
export function createLogger(meta) {
  return {
    info: (msg, extra = {}) => winstonLogger.info(msg, { ...meta, ...extra }),
    warn: (msg, extra = {}) => winstonLogger.warn(msg, { ...meta, ...extra }),
    error: (msg, extra = {}) => winstonLogger.error(msg, { ...meta, ...extra }),
    debug: (msg, extra = {}) => winstonLogger.debug(msg, { ...meta, ...extra })
  };
}

/**
 * Express middleware for request logging.
 * @returns {Function} Express middleware
 */
export function requestLogger() {
  return (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

      winstonLogger.log(level, `${req.method} ${req.path}`, {
        category: 'HTTP',
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        ip: req.ip
      });
    });

    next();
  };
}

// Export Winston instance for advanced use
export const logger = winstonLogger;

export default { info, warn, error, debug, separator, getLogPath, createLogger, requestLogger, logger };
