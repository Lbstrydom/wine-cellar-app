/**
 * @fileoverview Rate limiting middleware to prevent abuse.
 * @module middleware/rateLimiter
 */

/**
 * Simple in-memory rate limiter.
 * For production, consider using Redis-based rate limiting.
 */
class RateLimiter {
  constructor() {
    this.requests = new Map();
    this.cleanup();
  }

  /**
   * Clean up old entries every 5 minutes.
   */
  cleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [key, data] of this.requests.entries()) {
        if (now - data.resetTime > 0) {
          this.requests.delete(key);
        }
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Check if request should be allowed.
   * @param {string} key - Identifier (IP address or user ID)
   * @param {number} maxRequests - Maximum requests allowed
   * @param {number} windowMs - Time window in milliseconds
   * @returns {{ allowed: boolean, remaining: number, resetTime: number }}
   */
  checkLimit(key, maxRequests, windowMs) {
    const now = Date.now();
    const data = this.requests.get(key);

    if (!data || now > data.resetTime) {
      // First request or window expired
      this.requests.set(key, {
        count: 1,
        resetTime: now + windowMs
      });
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetTime: now + windowMs
      };
    }

    if (data.count >= maxRequests) {
      // Limit exceeded
      return {
        allowed: false,
        remaining: 0,
        resetTime: data.resetTime
      };
    }

    // Increment counter
    data.count++;
    this.requests.set(key, data);

    return {
      allowed: true,
      remaining: maxRequests - data.count,
      resetTime: data.resetTime
    };
  }
}

const limiter = new RateLimiter();

/**
 * Create rate limiting middleware.
 * @param {Object} options - Rate limit options
 * @param {number} options.maxRequests - Maximum requests per window (default: 100)
 * @param {number} options.windowMs - Time window in milliseconds (default: 15 minutes)
 * @param {string} options.message - Error message when limit exceeded
 * @param {Function} options.keyGenerator - Function to generate rate limit key (default: IP address)
 * @returns {Function} Express middleware
 */
export function createRateLimiter(options = {}) {
  const {
    maxRequests = 100,
    windowMs = 15 * 60 * 1000,
    message = 'Too many requests, please try again later.',
    keyGenerator = (req) => {
      // Get real IP from proxy headers or direct connection
      return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
             req.headers['x-real-ip'] ||
             req.socket.remoteAddress ||
             'unknown';
    }
  } = options;

  return (req, res, next) => {
    const key = keyGenerator(req);
    const result = limiter.checkLimit(key, maxRequests, windowMs);

    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining));
    res.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        error: message,
        retryAfter,
        resetTime: new Date(result.resetTime).toISOString()
      });
    }

    next();
  };
}

/**
 * Strict rate limiter for expensive operations (e.g., AI calls).
 * @param {Object} options - Rate limit options
 * @returns {Function} Express middleware
 */
export function strictRateLimiter(options = {}) {
  return createRateLimiter({
    maxRequests: 10,
    windowMs: 60 * 1000, // 1 minute
    message: 'Too many AI requests, please slow down.',
    ...options
  });
}

/**
 * Lenient rate limiter for general API calls.
 * @param {Object} options - Rate limit options
 * @returns {Function} Express middleware
 */
export function generalRateLimiter(options = {}) {
  return createRateLimiter({
    maxRequests: 100,
    windowMs: 15 * 60 * 1000, // 15 minutes
    message: 'Too many requests, please try again later.',
    ...options
  });
}
