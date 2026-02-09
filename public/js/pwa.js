/**
 * @fileoverview PWA install prompt, service-worker registration, and update notification.
 * Extracted from app.js to keep the main entry point focused on auth + bootstrap.
 * @module pwa
 */

/** @type {boolean} Enable verbose logging via localStorage.setItem('debug', 'true') */
const DEBUG = (() => { try { return localStorage.getItem('debug') === 'true'; } catch { return false; } })();

/**
 * Register service worker for PWA functionality.
 */
export async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });

      if (DEBUG) console.log('[App] Service Worker registered:', registration.scope);

      // Check for updates periodically
      setInterval(() => {
        registration.update();
      }, 60 * 60 * 1000); // Every hour

      // Handle updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (DEBUG) console.log('[App] Service Worker update found');

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New version available - pass the registration so we can message waiting worker
            showUpdateNotification(registration);
          }
        });
      });

      // Also check if there's already a waiting worker on page load
      if (registration.waiting) {
        showUpdateNotification(registration);
      }

    } catch (error) {
      console.error('[App] Service Worker registration failed:', error);
    }
  }
}

/**
 * Show notification when new version is available.
 * @param {ServiceWorkerRegistration} registration - The SW registration
 */
function showUpdateNotification(registration) {
  // Don't show duplicate notifications
  if (document.querySelector('.update-notification')) return;

  const notification = document.createElement('div');
  notification.className = 'update-notification';
  notification.innerHTML = `
    <span>A new version is available!</span>
    <button id="update-app-btn" class="btn btn-small btn-primary">Update</button>
    <button id="dismiss-update-btn" class="btn btn-small btn-secondary">Later</button>
  `;
  document.body.appendChild(notification);

  document.getElementById('update-app-btn').addEventListener('click', () => {
    if (DEBUG) console.log('[App] Triggering service worker update...');
    // Tell the WAITING service worker to skip waiting and activate
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    // Listen for the controller to change, then reload
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (DEBUG) console.log('[App] Controller changed, reloading...');
      window.location.reload();
    });
    // Fallback reload after short delay if controllerchange doesn't fire
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  });

  document.getElementById('dismiss-update-btn').addEventListener('click', () => {
    notification.remove();
  });
}

/**
 * Handle PWA install prompt.
 */
let deferredPrompt = null;

/**
 * Update install section status message.
 */
function updateInstallStatus() {
  const installBtn = document.getElementById('install-app-btn');
  const statusMessage = document.getElementById('install-status-message');

  if (!installBtn || !statusMessage) return;

  // Check if running in standalone mode (already installed)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true;

  if (isStandalone) {
    installBtn.style.display = 'none';
    statusMessage.textContent = '\u2705 App is installed and running in standalone mode.';
    statusMessage.className = 'text-success';
    return;
  }

  if (deferredPrompt) {
    // Browser supports install and app is installable
    installBtn.style.display = 'block';
    statusMessage.textContent = 'Click the button above to install.';
    statusMessage.className = 'text-muted';
  } else {
    // No install prompt available - show manual instructions
    installBtn.style.display = 'none';

    // Detect browser/platform
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    if (isIOS || isSafari) {
      statusMessage.innerHTML = '\ud83d\udcf1 <strong>iOS/Safari:</strong> Tap the Share button <span style="font-size: 1.2em;">\u2399</span>, then select "Add to Home Screen".';
    } else {
      statusMessage.innerHTML = '\ud83d\udcf1 <strong>Manual Install:</strong> Tap your browser\'s menu (\u22ee) and select "Install app" or "Add to Home screen".';
    }
    statusMessage.className = 'text-muted';
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent Chrome's default install prompt
  e.preventDefault();
  deferredPrompt = e;

  const installBtn = document.getElementById('install-app-btn');

  if (installBtn) {
    // Remove any existing listeners by cloning
    const newBtn = installBtn.cloneNode(true);
    installBtn.parentNode.replaceChild(newBtn, installBtn);

    newBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (DEBUG) console.log('[App] Install prompt outcome:', outcome);

        if (outcome === 'accepted') {
          deferredPrompt = null;
          updateInstallStatus();
        }
      }
    });
  }

  updateInstallStatus();
});

window.addEventListener('appinstalled', () => {
  if (DEBUG) console.log('[App] PWA was installed');
  deferredPrompt = null;
  updateInstallStatus();

  // Update PWA status
  updatePwaStatus();
});

// Initial status check on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateInstallStatus);
} else {
  updateInstallStatus();
}

/**
 * Update PWA status display in settings.
 */
function updatePwaStatus() {
  const statusEl = document.getElementById('pwa-status');
  if (!statusEl) return;

  if (window.matchMedia('(display-mode: standalone)').matches) {
    statusEl.textContent = 'Installed App';
    statusEl.style.color = 'var(--sparkling)';
  } else if (navigator.standalone) {
    // iOS Safari standalone mode
    statusEl.textContent = 'Installed App (iOS)';
    statusEl.style.color = 'var(--sparkling)';
  } else {
    statusEl.textContent = 'Web App';
  }
}

// Check PWA status on load
window.addEventListener('load', updatePwaStatus);
