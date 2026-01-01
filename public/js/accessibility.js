/**
 * @fileoverview Accessibility improvements for WCAG 2.1 AA compliance.
 * @module accessibility
 */

/**
 * Initialize accessibility features.
 */
export function initAccessibility() {
  setupAnnouncer();
  setupFocusTrapping();
  setupKeyboardShortcuts();
  setupTooltips();
  setupSkipLink();
}

/**
 * Screen reader announcer for dynamic content changes.
 */
let announcer = null;

function setupAnnouncer() {
  announcer = document.createElement('div');
  announcer.id = 'sr-announcer';
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('aria-atomic', 'true');
  announcer.className = 'sr-only';
  document.body.appendChild(announcer);
}

/**
 * Announce a message to screen readers.
 * @param {string} message - Message to announce
 * @param {string} [priority='polite'] - 'polite' or 'assertive'
 */
export function announce(message, priority = 'polite') {
  if (!announcer) return;

  announcer.setAttribute('aria-live', priority);
  // Clear and set to trigger announcement
  announcer.textContent = '';
  setTimeout(() => {
    announcer.textContent = message;
  }, 50);
}

/**
 * Setup focus trapping for modals.
 */
function setupFocusTrapping() {
  // Watch for modal visibility changes
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        const modal = mutation.target.closest('.modal-overlay');
        if (modal) {
          if (modal.classList.contains('active') || getComputedStyle(modal).display !== 'none') {
            enableFocusTrap(modal);
          } else {
            disableFocusTrap(modal);
          }
        }
      }
    });
  });

  document.querySelectorAll('.modal-overlay, .modal').forEach((modal) => {
    observer.observe(modal, { attributes: true, attributeFilter: ['class', 'style'] });
  });
}

// Store original focused element and trap handler
const focusTrapState = new WeakMap();

/**
 * Enable focus trapping within an element.
 * @param {HTMLElement} element - Element to trap focus within
 */
export function enableFocusTrap(element) {
  const focusableSelector =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])';

  const getFocusableElements = () =>
    Array.from(element.querySelectorAll(focusableSelector))
      .filter(el => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden');

  const handleKeyDown = (e) => {
    if (e.key !== 'Tab') return;

    const focusable = getFocusableElements();
    if (focusable.length === 0) return;

    const firstFocusable = focusable[0];
    const lastFocusable = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === firstFocusable) {
      lastFocusable.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === lastFocusable) {
      firstFocusable.focus();
      e.preventDefault();
    }
  };

  // Store original focus to restore later
  const originalFocus = document.activeElement;

  // Store state for cleanup
  focusTrapState.set(element, { handleKeyDown, originalFocus });

  // Add trap handler
  element.addEventListener('keydown', handleKeyDown);

  // Focus first focusable element
  const focusable = getFocusableElements();
  if (focusable.length > 0) {
    focusable[0].focus();
  }
}

/**
 * Disable focus trapping and restore original focus.
 * @param {HTMLElement} element - Element with focus trap
 */
export function disableFocusTrap(element) {
  const state = focusTrapState.get(element);
  if (!state) return;

  element.removeEventListener('keydown', state.handleKeyDown);

  // Restore focus to original element
  if (state.originalFocus && state.originalFocus.focus) {
    state.originalFocus.focus();
  }

  focusTrapState.delete(element);
}

/**
 * Setup global keyboard shortcuts.
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Escape key closes modals
    if (e.key === 'Escape') {
      const activeModal = document.querySelector('.modal-overlay.active, .modal-overlay[style*="block"]');
      if (activeModal) {
        const closeBtn = activeModal.querySelector('.modal-close, [data-dismiss="modal"]');
        if (closeBtn) {
          closeBtn.click();
          e.preventDefault();
        }
      }
    }
  });
}

/**
 * Setup tooltips for visual indicators.
 */
function setupTooltips() {
  // Peak status indicators
  const peakTooltips = {
    'peak': 'This wine is at its peak drinking window',
    'past-peak': 'This wine is past its optimal drinking window',
    'too-young': 'This wine needs more time to develop',
    'mature': 'This wine is mature and ready to drink'
  };

  document.querySelectorAll('[data-peak-status]').forEach(el => {
    const status = el.dataset.peakStatus;
    if (peakTooltips[status]) {
      el.setAttribute('title', peakTooltips[status]);
      el.setAttribute('aria-label', peakTooltips[status]);
    }
  });

  // Rating indicators
  document.querySelectorAll('.rating-indicator, .purchase-stars').forEach(el => {
    const rating = el.dataset.rating || el.textContent;
    el.setAttribute('aria-label', `Rating: ${rating}`);
  });

  // Color indicators
  const colorNames = {
    'red': 'Red wine',
    'white': 'White wine',
    'rose': 'Rosé wine',
    'sparkling': 'Sparkling wine'
  };

  document.querySelectorAll('[data-colour]').forEach(el => {
    const colour = el.dataset.colour;
    if (colorNames[colour]) {
      el.setAttribute('aria-label', colorNames[colour]);
    }
  });
}

/**
 * Setup skip link for keyboard navigation.
 */
function setupSkipLink() {
  // Check if skip link already exists
  if (document.getElementById('skip-link')) return;

  const skipLink = document.createElement('a');
  skipLink.id = 'skip-link';
  skipLink.href = '#main-content';
  skipLink.className = 'skip-link';
  skipLink.textContent = 'Skip to main content';

  // Insert at the beginning of body
  document.body.insertBefore(skipLink, document.body.firstChild);

  // Add main content landmark if not present
  const mainContent = document.querySelector('main, #main-content, .main-content');
  if (mainContent && !mainContent.id) {
    mainContent.id = 'main-content';
  }
}

/**
 * Update ARIA attributes for tab navigation.
 * @param {HTMLElement} tablist - Container with role="tablist"
 */
export function updateTabSelection(tablist) {
  const tabs = tablist.querySelectorAll('[role="tab"]');
  const activeTab = tablist.querySelector('[role="tab"].active, [role="tab"][aria-selected="true"]');

  tabs.forEach(tab => {
    const isActive = tab === activeTab;
    tab.setAttribute('aria-selected', isActive);
    tab.setAttribute('tabindex', isActive ? '0' : '-1');

    // Update associated panel
    const panelId = tab.getAttribute('aria-controls');
    if (panelId) {
      const panel = document.getElementById(panelId);
      if (panel) {
        panel.hidden = !isActive;
      }
    }
  });
}

/**
 * Make an element keyboard navigable with arrow keys.
 * @param {HTMLElement} container - Container element
 * @param {string} itemSelector - Selector for navigable items
 */
export function enableArrowNavigation(container, itemSelector) {
  container.addEventListener('keydown', (e) => {
    const items = Array.from(container.querySelectorAll(itemSelector));
    const currentIndex = items.indexOf(document.activeElement);

    if (currentIndex === -1) return;

    let newIndex = currentIndex;

    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        newIndex = (currentIndex + 1) % items.length;
        e.preventDefault();
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        newIndex = (currentIndex - 1 + items.length) % items.length;
        e.preventDefault();
        break;
      case 'Home':
        newIndex = 0;
        e.preventDefault();
        break;
      case 'End':
        newIndex = items.length - 1;
        e.preventDefault();
        break;
    }

    if (newIndex !== currentIndex) {
      items[currentIndex].setAttribute('tabindex', '-1');
      items[newIndex].setAttribute('tabindex', '0');
      items[newIndex].focus();
    }
  });
}
