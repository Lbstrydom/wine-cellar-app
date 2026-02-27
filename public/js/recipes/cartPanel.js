/**
 * @fileoverview Cart panel component for buying guide.
 * Renders cart items grouped by status, quick-add form,
 * running totals, and batch action toolbar.
 * @module recipes/cartPanel
 */

import { escapeHtml, showToast } from '../utils.js';
import {
  getCartState,
  subscribe,
  loadCart,
  addItem,
  transitionStatus,
  removeItem,
  batchTransition,
  arriveItem,
  convertToCellar
} from './cartState.js';

/** Status display config: label, badge class, available actions */
const STATUS_CONFIG = {
  planned:   { label: 'Planned',   badgeClass: 'cart-badge-planned',   actions: ['ordered', 'arrived', 'cancelled'] },
  ordered:   { label: 'Ordered',   badgeClass: 'cart-badge-ordered',   actions: ['arrived', 'cancelled'] },
  arrived:   { label: 'Arrived',   badgeClass: 'cart-badge-arrived',   actions: ['to-cellar'] },
  cancelled: { label: 'Cancelled', badgeClass: 'cart-badge-cancelled', actions: ['planned'] }
};

/** Action button labels and icons */
const ACTION_LABELS = {
  ordered:      { icon: '\u{1F69A}', label: 'Mark Ordered' },
  arrived:      { icon: '\u2705',    label: 'Mark Arrived' },
  cancelled:    { icon: '\u274C',    label: 'Cancel' },
  planned:      { icon: '\u{1F504}', label: 'Re-plan' },
  'to-cellar':  { icon: '\u{1F3E0}', label: 'Move to Cellar' }
};

/** Style select options (matches STYLE_LABELS from config/styleIds.js) */
const STYLE_OPTIONS = [
  { id: '', label: '-- Auto detect --' },
  { id: 'white_crisp', label: 'Crisp White' },
  { id: 'white_medium', label: 'Medium White' },
  { id: 'white_oaked', label: 'Oaked White' },
  { id: 'white_aromatic', label: 'Aromatic White' },
  { id: 'rose_dry', label: 'Dry Rosé' },
  { id: 'red_light', label: 'Light Red' },
  { id: 'red_medium', label: 'Medium Red' },
  { id: 'red_full', label: 'Full Red' },
  { id: 'sparkling_dry', label: 'Sparkling' },
  { id: 'sparkling_rose', label: 'Sparkling Rosé' },
  { id: 'dessert', label: 'Dessert' }
];

/** @type {HTMLElement|null} */
let panelRoot = null;

/** @type {Set<number>} Selected item IDs for batch actions */
const selectedIds = new Set();

/** @type {boolean} Whether the quick-add form is expanded */
let formExpanded = false;

/**
 * Render the cart panel into a container.
 * Subscribes to state changes for re-renders.
 * @param {HTMLElement} container - Target element
 * @param {Object} [options] - Render options
 * @param {string} [options.prefillStyle] - Pre-fill style_id for quick-add
 * @param {string} [options.prefillStyleLabel] - Pre-fill style label
 */
export function renderCartPanel(container, options = {}) {
  if (!container) return;
  panelRoot = container;

  // Initial load
  loadCart();

  // Subscribe to state changes
  subscribe(() => {
    if (panelRoot) renderCartContent(panelRoot);
  });

  // Store prefill for form
  if (options.prefillStyle) {
    panelRoot.dataset.prefillStyle = options.prefillStyle;
    panelRoot.dataset.prefillLabel = options.prefillStyleLabel || '';
    formExpanded = true;
  }

  renderCartContent(panelRoot);
}

/**
 * Open the quick-add form prefilled for a specific gap style.
 * @param {string} styleId - Style bucket ID
 * @param {string} label - Human-readable label
 */
export function openQuickAddForGap(styleId, label) {
  formExpanded = true;
  if (panelRoot) {
    panelRoot.dataset.prefillStyle = styleId;
    panelRoot.dataset.prefillLabel = label;
    renderCartContent(panelRoot);
    // Focus wine name input
    const nameInput = panelRoot.querySelector('.cart-quick-add-name');
    if (nameInput) nameInput.focus();
  }
}

/**
 * Render the full cart panel content.
 * @param {HTMLElement} container
 */
function renderCartContent(container) {
  const { items, summary, loading } = getCartState();

  if (loading && items.length === 0) {
    container.innerHTML = '<div class="cart-loading">Loading cart...</div>';
    return;
  }

  const quickAddHtml = renderQuickAddForm(container.dataset.prefillStyle || '', container.dataset.prefillLabel || '');
  const totalsHtml = renderTotals(summary);
  const itemsHtml = renderGroupedItems(items);
  const batchHtml = selectedIds.size > 0 ? renderBatchBar() : '';

  container.innerHTML = `
    <div class="cart-panel">
      <div class="cart-panel-header">
        <h4 class="buying-guide-section-title">Shopping Cart</h4>
        <button class="cart-toggle-form-btn" type="button">${formExpanded ? 'Close' : '+ Add Wine'}</button>
      </div>
      ${formExpanded ? quickAddHtml : ''}
      ${totalsHtml}
      ${batchHtml}
      ${itemsHtml}
    </div>
  `;

  wireCartEvents(container);
}

/**
 * Render the quick-add form.
 * @param {string} prefillStyle - Pre-selected style ID
 * @param {string} prefillLabel - Pre-selected style label
 * @returns {string} HTML
 */
function renderQuickAddForm(prefillStyle, prefillLabel) {
  const styleOpts = STYLE_OPTIONS.map(s =>
    `<option value="${s.id}"${s.id === prefillStyle ? ' selected' : ''}>${escapeHtml(s.label)}</option>`
  ).join('');

  const gapHint = prefillLabel
    ? `<span class="cart-gap-hint">Filling gap: <strong>${escapeHtml(prefillLabel)}</strong></span>`
    : '';

  return `
    <form class="cart-quick-add">
      ${gapHint}
      <div class="cart-form-row">
        <input type="text" class="cart-quick-add-name" placeholder="Wine name *" required autocomplete="off" />
        <input type="number" class="cart-quick-add-qty" placeholder="Qty" min="1" value="1" />
      </div>
      <div class="cart-form-row">
        <input type="text" class="cart-quick-add-producer" placeholder="Producer" autocomplete="off" />
        <select class="cart-quick-add-style">${styleOpts}</select>
      </div>
      <div class="cart-form-row cart-form-extras" style="display: none;">
        <input type="text" class="cart-quick-add-colour" placeholder="Colour (Red/White)" autocomplete="off" />
        <input type="text" class="cart-quick-add-grapes" placeholder="Grapes" autocomplete="off" />
      </div>
      <div class="cart-form-row cart-form-extras" style="display: none;">
        <input type="text" class="cart-quick-add-region" placeholder="Region" autocomplete="off" />
        <input type="number" class="cart-quick-add-price" placeholder="Price" min="0" step="0.01" />
      </div>
      <div class="cart-form-actions">
        <button type="button" class="cart-more-fields-btn">More fields</button>
        <button type="submit" class="cart-add-btn">Add to Plan</button>
      </div>
    </form>
  `;
}

/**
 * Render currency-segmented totals bar.
 * @param {Object} summary - Cart summary
 * @returns {string} HTML
 */
function renderTotals(summary) {
  const counts = summary.counts || {};
  const totals = summary.totals || {};

  const activeItems = (counts.planned?.items || 0) + (counts.ordered?.items || 0) + (counts.arrived?.items || 0);
  const activeBottles = (counts.planned?.bottles || 0) + (counts.ordered?.bottles || 0) + (counts.arrived?.bottles || 0);

  if (activeItems === 0) return '';

  const currencyParts = Object.entries(totals).map(([currency, data]) =>
    `${data.bottles} bottle${data.bottles !== 1 ? 's' : ''} (${formatCurrency(data.cost, currency)})`
  );

  const costHtml = currencyParts.length > 0
    ? ` &mdash; ${currencyParts.join(' + ')}`
    : '';

  return `
    <div class="cart-totals">
      <span>${activeItems} item${activeItems !== 1 ? 's' : ''}, ${activeBottles} bottle${activeBottles !== 1 ? 's' : ''}${costHtml}</span>
    </div>
  `;
}

/**
 * Render items grouped by status.
 * @param {Array} items - Cart items
 * @returns {string} HTML
 */
function renderGroupedItems(items) {
  if (items.length === 0) {
    return '<div class="cart-empty">No items in your shopping cart yet.</div>';
  }

  const groups = { planned: [], ordered: [], arrived: [], cancelled: [] };
  for (const item of items) {
    const group = groups[item.status];
    if (group) group.push(item);
  }

  let html = '';
  for (const [status, groupItems] of Object.entries(groups)) {
    if (groupItems.length === 0) continue;
    const cfg = STATUS_CONFIG[status];
    html += `
      <div class="cart-group">
        <div class="cart-group-header">
          <span class="cart-status-badge ${cfg.badgeClass}">${cfg.label}</span>
          <span class="cart-group-count">${groupItems.length}</span>
        </div>
        ${groupItems.map(item => renderCartItem(item)).join('')}
      </div>
    `;
  }

  return html;
}

/**
 * Render a single cart item row.
 * @param {Object} item - Cart item
 * @returns {string} HTML
 */
function renderCartItem(item) {
  const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.planned;
  const isChecked = selectedIds.has(item.id) ? ' checked' : '';
  const isConverted = item.converted_wine_id != null;

  const styleLabel = item.style_id
    ? STYLE_OPTIONS.find(s => s.id === item.style_id)?.label || item.style_id
    : 'Unknown';

  const actionBtns = cfg.actions.map(action => {
    const a = ACTION_LABELS[action];
    return `<button class="cart-action-btn" data-id="${item.id}" data-action="${action}" type="button" title="${a.label}">${a.icon}</button>`;
  }).join('');

  const priceStr = item.price != null
    ? ` &middot; ${formatCurrency(item.price, item.currency || 'ZAR')}`
    : '';

  const inferredHint = item.style_inferred && item.needs_style_confirmation
    ? ' <span class="cart-inferred-hint" title="Style was auto-detected with low confidence">(unconfirmed)</span>'
    : '';

  const convertedLink = isConverted
    ? ` <a class="cart-cellar-link" href="#" data-wine-id="${item.converted_wine_id}" title="View in cellar">(in cellar)</a>`
    : '';

  // Show placement hint if arrive data was cached
  const placementHtml = item._placement && !isConverted
    ? `<div class="cart-placement-hint">Suggested: ${escapeHtml(item._placement.zoneName || 'Unknown zone')}</div>`
    : '';

  return `
    <div class="cart-item${isConverted ? ' cart-item-converted' : ''}" data-item-id="${item.id}">
      <label class="cart-item-check">
        <input type="checkbox" class="cart-select-cb" data-id="${item.id}"${isChecked}${isConverted ? ' disabled' : ''} />
      </label>
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(item.wine_name)}${item.vintage ? ' ' + item.vintage : ''}${convertedLink}</div>
        <div class="cart-item-meta">
          ${item.producer ? escapeHtml(item.producer) + ' &middot; ' : ''}${escapeHtml(styleLabel)}${inferredHint}
          &middot; x${item.quantity}${priceStr}
        </div>
        ${placementHtml}
      </div>
      <div class="cart-item-actions">
        ${actionBtns}
        ${!isConverted ? `<button class="cart-delete-btn" data-id="${item.id}" type="button" title="Delete">&#x1F5D1;</button>` : ''}
      </div>
    </div>
  `;
}

/**
 * Render batch actions bar.
 * @returns {string} HTML
 */
function renderBatchBar() {
  return `
    <div class="cart-batch-bar">
      <span>${selectedIds.size} selected</span>
      <button class="cart-batch-btn" data-action="ordered" type="button">Mark Ordered</button>
      <button class="cart-batch-btn" data-action="arrived" type="button">Mark Arrived</button>
      <button class="cart-batch-btn" data-action="cancelled" type="button">Cancel</button>
      <button class="cart-batch-clear-btn" type="button">Clear</button>
    </div>
  `;
}

/**
 * Wire all event listeners for the cart panel.
 * @param {HTMLElement} container
 */
function wireCartEvents(container) {
  // Toggle form
  const toggleBtn = container.querySelector('.cart-toggle-form-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      formExpanded = !formExpanded;
      if (!formExpanded) {
        delete container.dataset.prefillStyle;
        delete container.dataset.prefillLabel;
      }
      renderCartContent(container);
    });
  }

  // More fields toggle
  const moreBtn = container.querySelector('.cart-more-fields-btn');
  if (moreBtn) {
    moreBtn.addEventListener('click', () => {
      const extras = container.querySelectorAll('.cart-form-extras');
      const hidden = extras[0]?.style.display === 'none';
      extras.forEach(el => { el.style.display = hidden ? 'flex' : 'none'; });
      moreBtn.textContent = hidden ? 'Fewer fields' : 'More fields';
    });
  }

  // Quick-add form submit
  const form = container.querySelector('.cart-quick-add');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = container.querySelector('.cart-quick-add-name')?.value.trim();
      if (!name) return;

      const data = {
        wine_name: name,
        quantity: parseInt(container.querySelector('.cart-quick-add-qty')?.value, 10) || 1,
        producer: container.querySelector('.cart-quick-add-producer')?.value.trim() || undefined,
        style_id: container.querySelector('.cart-quick-add-style')?.value || undefined,
        colour: container.querySelector('.cart-quick-add-colour')?.value.trim() || undefined,
        grapes: container.querySelector('.cart-quick-add-grapes')?.value.trim() || undefined,
        region: container.querySelector('.cart-quick-add-region')?.value.trim() || undefined,
        price: parseFloat(container.querySelector('.cart-quick-add-price')?.value) || undefined,
        source_gap_style: container.dataset.prefillStyle || undefined
      };

      // Remove undefined keys
      for (const k of Object.keys(data)) {
        if (data[k] === undefined) delete data[k];
      }

      try {
        const item = await addItem(data);
        if (item?.style_inferred && item?.needs_style_confirmation) {
          showToast('Added to plan (style auto-detected, please confirm)', 'info');
        } else {
          showToast('Added to plan', 'success');
        }
        // Reset form
        form.reset();
        delete container.dataset.prefillStyle;
        delete container.dataset.prefillLabel;
      } catch (err) {
        showToast('Failed to add: ' + err.message, 'error');
      }
    });
  }

  // Status transition buttons
  container.querySelectorAll('.cart-action-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id, 10);
      const action = btn.dataset.action;
      try {
        if (action === 'arrived') {
          await handleArriveAction(id, container);
        } else if (action === 'to-cellar') {
          await handleToCellarAction(id, container);
        } else {
          await transitionStatus(id, action);
          showToast(`Status updated to ${action}`, 'success');
        }
      } catch (err) {
        showToast('Status change failed: ' + err.message, 'error');
      }
    });
  });

  // Delete buttons
  container.querySelectorAll('.cart-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id, 10);
      try {
        await removeItem(id);
        showToast('Item removed', 'success');
      } catch (err) {
        showToast('Delete failed: ' + err.message, 'error');
      }
    });
  });

  // Checkbox selection
  container.querySelectorAll('.cart-select-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = parseInt(cb.dataset.id, 10);
      if (cb.checked) {
        selectedIds.add(id);
      } else {
        selectedIds.delete(id);
      }
      renderCartContent(container);
    });
  });

  // Batch action buttons
  container.querySelectorAll('.cart-batch-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      const ids = [...selectedIds];
      try {
        const result = await batchTransition(ids, action);
        selectedIds.clear();
        const skipped = result?.skipped?.length || 0;
        showToast(
          `${result?.updated || 0} updated${skipped ? `, ${skipped} skipped` : ''}`,
          skipped ? 'info' : 'success'
        );
      } catch (err) {
        showToast('Batch update failed: ' + err.message, 'error');
      }
    });
  });

  // Batch clear
  const clearBtn = container.querySelector('.cart-batch-clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      selectedIds.clear();
      renderCartContent(container);
    });
  }
}

/**
 * Handle the "Mark Arrived" action.
 * Calls arrive endpoint + shows placement suggestion.
 * @param {number} id - Item ID
 * @param {HTMLElement} container
 */
async function handleArriveAction(id, container) {
  const data = await arriveItem(id);
  if (!data?.item) {
    showToast('Failed to mark as arrived', 'error');
    return;
  }

  // Cache placement on the item for inline display
  if (data.placement) {
    const { items } = getCartState();
    const item = items.find(i => i.id === id);
    if (item) item._placement = data.placement;
  }

  const placementMsg = data.placement?.zoneName
    ? ` — suggested zone: ${data.placement.zoneName}`
    : '';
  showToast(`Marked as arrived${placementMsg}`, 'success');
  renderCartContent(container);
}

/**
 * Handle the "Move to Cellar" action.
 * Calls convert endpoint; shows confirmation dialog for partial conversion.
 * @param {number} id - Item ID
 * @param {HTMLElement} container
 */
async function handleToCellarAction(id, container) {
  const data = await convertToCellar(id);

  // Partial conversion — needs user confirmation
  if (data?.requiresConfirmation) {
    showPartialConfirmation(id, data, container);
    return;
  }

  // Successful full conversion
  const msg = data?.partial
    ? `Converted ${data.converted} of ${data.converted + data.remaining} bottle(s) to cellar`
    : `Converted ${data?.converted || 0} bottle(s) to cellar`;
  showToast(msg, 'success');
}

/**
 * Show a partial conversion confirmation inline.
 * @param {number} id - Item ID
 * @param {Object} data - { partial, available, total, message }
 * @param {HTMLElement} container
 */
function showPartialConfirmation(id, data, container) {
  const itemEl = container.querySelector(`.cart-item[data-item-id="${id}"]`);
  if (!itemEl) return;

  // Remove any existing confirmation
  const existing = itemEl.querySelector('.cart-partial-confirm');
  if (existing) existing.remove();

  const confirmDiv = document.createElement('div');
  confirmDiv.className = 'cart-partial-confirm';
  confirmDiv.innerHTML = `
    <p>${escapeHtml(data.message)}</p>
    <button class="cart-partial-yes" type="button">Convert ${data.available} now</button>
    <button class="cart-partial-no" type="button">Cancel</button>
  `;
  itemEl.appendChild(confirmDiv);

  confirmDiv.querySelector('.cart-partial-yes').addEventListener('click', async () => {
    try {
      const result = await convertToCellar(id, { confirmed: true, convertQuantity: data.available });
      if (result?.requiresConfirmation) {
        showToast('Still not enough slots', 'error');
        return;
      }
      showToast(`Converted ${result?.converted || data.available} bottle(s) to cellar`, 'success');
    } catch (err) {
      showToast('Conversion failed: ' + err.message, 'error');
    }
  });

  confirmDiv.querySelector('.cart-partial-no').addEventListener('click', () => {
    confirmDiv.remove();
  });
}

/**
 * Format a currency amount.
 * @param {number} amount
 * @param {string} currency
 * @returns {string}
 */
function formatCurrency(amount, currency) {
  const num = Number(amount);
  if (isNaN(num)) return '';
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currency || 'ZAR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(num);
  } catch {
    return `${currency} ${num.toFixed(0)}`;
  }
}
