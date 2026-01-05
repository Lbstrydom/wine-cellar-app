/**
 * @fileoverview Content Security Policy middleware.
 * @module middleware/csp
 */

/**
 * Apply Content Security Policy headers.
 * CSP helps prevent XSS, clickjacking, and other code injection attacks.
 * 
 * @returns {Function} Express middleware
 */
export function cspMiddleware() {
  return (req, res, next) => {
    // Define CSP policy
    const cspDirectives = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'", // unsafe-inline needed for inline scripts (consider moving to external files)
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // unsafe-inline for inline styles, Google Fonts
      "font-src 'self' https://fonts.gstatic.com", // Google Fonts
      "img-src 'self' data: blob:", // data: for base64 images, blob: for object URLs
      "connect-src 'self'", // API calls to same origin
      "frame-ancestors 'none'", // Prevent clickjacking
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests" // Upgrade HTTP to HTTPS
    ];

    // Set CSP header
    res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

    // Additional security headers
    res.setHeader('X-Content-Type-Options', 'nosniff'); // Prevent MIME sniffing
    res.setHeader('X-Frame-Options', 'DENY'); // Prevent clickjacking
    res.setHeader('X-XSS-Protection', '1; mode=block'); // Enable XSS filter (legacy browsers)
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); // Control referrer information
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()'); // Disable unnecessary browser features

    next();
  };
}

/**
 * Relaxed CSP for development (allows more permissive rules).
 * Use in development when CSP interferes with hot reload, etc.
 * 
 * @returns {Function} Express middleware
 */
export function cspDevMiddleware() {
  return (req, res, next) => {
    const cspDirectives = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // unsafe-eval for dev tools
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: http: https:",
      "connect-src 'self' ws: wss:", // WebSocket for hot reload
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ];

    res.setHeader('Content-Security-Policy', cspDirectives.join('; '));
    
    // Other security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    next();
  };
}
