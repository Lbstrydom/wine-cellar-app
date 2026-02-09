/**
 * @fileoverview Global error boundary for frontend crashes.
 * @module errorBoundary
 */

import { logClientError } from './api.js';
import { escapeHtml } from './utils.js';

/**
 * Initialize global error handling.
 */
export function initErrorBoundary() {
  // Catch unhandled errors
  window.addEventListener('error', (event) => {
    console.error('Unhandled error:', event.error);
    handleError(event.error, 'Unhandled Error');
    event.preventDefault();
  });

  // Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    handleError(event.reason, 'Promise Rejection');
    event.preventDefault();
  });

}

/**
 * Handle and display errors to user.
 * @param {Error} error - The error object
 * @param {string} context - Error context (where it occurred)
 */
function handleError(error, context = 'Application Error') {
  const errorMessage = error?.message || String(error) || 'Unknown error occurred';
  const errorStack = error?.stack || '';

  // Log to console for debugging
  console.error(`[${context}]`, errorMessage);
  if (errorStack) {
    console.error('Stack:', errorStack);
  }

  // Show user-friendly error message
  showErrorToast(context, errorMessage);

  // Log to server (optional - could add endpoint for error logging)
  logErrorToServer(context, errorMessage, errorStack);
}

/**
 * Show error toast notification to user.
 * @param {string} title - Error title
 * @param {string} message - Error message
 */
function showErrorToast(title, message) {
  // Use existing toast mechanism if available
  if (typeof window.showToast === 'function') {
    window.showToast(`${title}: ${message}`, 'error');
    return;
  }

  // Fallback: create simple toast
  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.innerHTML = `
    <div class="error-toast-content">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(message)}</p>
      <button class="dismiss-btn">Dismiss</button>
    </div>
  `;
  // Attach event listener (CSP-compliant)
  toast.querySelector('.dismiss-btn').addEventListener('click', () => toast.remove());
  
  // Add styles if not already present
  if (!document.getElementById('error-boundary-styles')) {
    const style = document.createElement('style');
    style.id = 'error-boundary-styles';
    style.textContent = `
      .error-toast {
        position: fixed;
        top: 20px;
        right: 20px;
        max-width: 400px;
        background: #dc3545;
        color: white;
        padding: 16px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
      }
      .error-toast-content strong {
        display: block;
        margin-bottom: 8px;
        font-size: 16px;
      }
      .error-toast-content p {
        margin: 0 0 12px 0;
        font-size: 14px;
        opacity: 0.9;
      }
      .error-toast-content button {
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: white;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
      }
      .error-toast-content button:hover {
        background: rgba(255, 255, 255, 0.3);
      }
      @keyframes slideIn {
        from {
          transform: translateX(120%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);

  // Auto-dismiss after 10 seconds
  setTimeout(() => {
    if (toast.parentElement) {
      toast.remove();
    }
  }, 10000);
}


/**
 * Log error to server for monitoring (optional).
 * @param {string} context - Error context
 * @param {string} message - Error message
 * @param {string} stack - Error stack trace
 */
function logErrorToServer(_context, _message, _stack) {
  const payload = {
    context: _context,
    message: _message,
    stack: _stack,
    url: window.location.href,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString()
  };

  logClientError(payload).catch(err => {
    console.warn('Failed to log error to server:', err);
  });
}

/**
 * Wrap a function with error handling.
 * @param {Function} fn - Function to wrap
 * @param {string} context - Context for error messages
 * @returns {Function} Wrapped function
 */
function withErrorBoundary(fn, context) {
  return async function(...args) {
    try {
      return await fn.apply(this, args);
    } catch (error) {
      handleError(error, context);
      throw error; // Re-throw for caller to handle if needed
    }
  };
}

/**
 * Wrap async operations with automatic error handling.
 * @param {Promise} promise - Promise to wrap
 * @param {string} context - Context for error messages
 * @returns {Promise} Wrapped promise
 */
async function safeAsync(promise, context) {
  try {
    return await promise;
  } catch (error) {
    handleError(error, context);
    return null; // Return null on error
  }
}
