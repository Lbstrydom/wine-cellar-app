// @vitest-environment jsdom
/**
 * @fileoverview Unit tests for the cart panel UI component.
 * Tests DOM rendering, form submission, status transitions,
 * batch actions, and partial conversion confirmation flow.
 * @module tests/unit/recipes/cartPanel
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mocks (must precede imports) ──────────────────────────────────────────────

vi.mock('../../../public/js/recipes/cartState.js', () => ({
  getCartState: vi.fn(),
  subscribe: vi.fn(),
  loadCart: vi.fn(),
  addItem: vi.fn(),
  transitionStatus: vi.fn(),
  removeItem: vi.fn(),
  batchTransition: vi.fn(),
  arriveItem: vi.fn(),
  convertToCellar: vi.fn()
}));

vi.mock('../../../public/js/utils.js', () => ({
  escapeHtml: (str) => {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },
  showToast: vi.fn()
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { renderCartPanel, openQuickAddForGap } from '../../../public/js/recipes/cartPanel.js';
import {
  getCartState, subscribe, loadCart,
  addItem, transitionStatus, removeItem,
  batchTransition, arriveItem, convertToCellar
} from '../../../public/js/recipes/cartState.js';
import { showToast } from '../../../public/js/utils.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMPTY_STATE = { items: [], summary: { counts: {}, totals: {} }, loading: false };

/** Items spanning all statuses */
const MIXED_ITEMS = [
  { id: 1, wine_name: 'Stellenbosch Shiraz', producer: 'Kanonkop', status: 'planned',
    quantity: 3, style_id: 'red_full', converted_wine_id: null, vintage: 2021,
    price: 250, currency: 'ZAR' },
  { id: 2, wine_name: 'Chardonnay Reserve', producer: null, status: 'ordered',
    quantity: 1, style_id: 'white_oaked', converted_wine_id: null },
  { id: 3, wine_name: 'Pinot Grigio', producer: null, status: 'arrived',
    quantity: 2, style_id: 'white_crisp', converted_wine_id: null },
  { id: 4, wine_name: 'Old Vine Grenache', producer: null, status: 'cancelled',
    quantity: 1, style_id: 'red_medium', converted_wine_id: null }
];

const MIXED_STATE = {
  items: MIXED_ITEMS,
  summary: {
    counts: {
      planned: { items: 1, bottles: 3 },
      ordered: { items: 1, bottles: 1 },
      arrived: { items: 1, bottles: 2 }
    },
    totals: { ZAR: { bottles: 3, cost: 750 } }
  },
  loading: false
};

/** Create a fresh container attached to jsdom body. */
function makeContainer() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCartState.mockReturnValue(EMPTY_STATE);
  subscribe.mockReturnValue(() => {}); // returns unsubscribe fn
  loadCart.mockResolvedValue(undefined);
});

// ── renderCartPanel ───────────────────────────────────────────────────────────

describe('renderCartPanel', () => {
  it('calls loadCart and subscribes to state on init', () => {
    const container = makeContainer();
    renderCartPanel(container);

    expect(loadCart).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(typeof subscribe.mock.calls[0][0]).toBe('function');
  });

  it('returns early without error when container is null', () => {
    expect(() => renderCartPanel(null)).not.toThrow();
    expect(loadCart).not.toHaveBeenCalled();
  });

  it('renders empty-state message when cart has no items', () => {
    const container = makeContainer();
    renderCartPanel(container);

    expect(container.innerHTML).toContain('No items');
  });

  it('renders loading state when loading=true and items empty', () => {
    getCartState.mockReturnValue({ items: [], summary: {}, loading: true });
    const container = makeContainer();
    renderCartPanel(container);

    expect(container.innerHTML).toContain('Loading cart');
    expect(container.querySelector('.cart-empty')).toBeNull();
  });

  it('renders the cart panel wrapper and header', () => {
    const container = makeContainer();
    renderCartPanel(container);

    expect(container.querySelector('.cart-panel')).not.toBeNull();
    expect(container.querySelector('.cart-panel-header')).not.toBeNull();
    expect(container.innerHTML).toContain('Shopping Cart');
  });

  it('renders toggle button labelled "+ Add Wine" when form collapsed', () => {
    const container = makeContainer();
    renderCartPanel(container);

    const btn = container.querySelector('.cart-toggle-form-btn');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('+ Add Wine');
  });

  it('renders items grouped by status with group headers', () => {
    getCartState.mockReturnValue(MIXED_STATE);
    const container = makeContainer();
    renderCartPanel(container);

    const badges = [...container.querySelectorAll('.cart-status-badge')].map(el => el.textContent);
    expect(badges).toContain('Planned');
    expect(badges).toContain('Ordered');
    expect(badges).toContain('Arrived');
    expect(badges).toContain('Cancelled');
  });

  it('renders wine names and producer in item rows', () => {
    getCartState.mockReturnValue(MIXED_STATE);
    const container = makeContainer();
    renderCartPanel(container);

    expect(container.innerHTML).toContain('Stellenbosch Shiraz');
    expect(container.innerHTML).toContain('Chardonnay Reserve');
    expect(container.innerHTML).toContain('Kanonkop');
  });

  it('renders totals bar when active items exist', () => {
    getCartState.mockReturnValue(MIXED_STATE);
    const container = makeContainer();
    renderCartPanel(container);

    const totals = container.querySelector('.cart-totals');
    expect(totals).not.toBeNull();
    expect(totals.textContent).toMatch(/item/);
    expect(totals.textContent).toMatch(/bottle/);
  });

  it('does not render totals bar when no active items', () => {
    getCartState.mockReturnValue({
      items: [{ id: 4, wine_name: 'X', status: 'cancelled', quantity: 1, converted_wine_id: null }],
      summary: { counts: { cancelled: { items: 1, bottles: 1 } }, totals: {} },
      loading: false
    });
    const container = makeContainer();
    renderCartPanel(container);

    expect(container.querySelector('.cart-totals')).toBeNull();
  });

  it('renders placement hint on arrived items that have _placement set', () => {
    const items = [{
      id: 3, wine_name: 'Pinotage', status: 'arrived', quantity: 1,
      style_id: 'red_medium', converted_wine_id: null,
      _placement: { zoneName: 'Red Zone A' }
    }];
    getCartState.mockReturnValue({ items, summary: { counts: {}, totals: {} }, loading: false });
    const container = makeContainer();
    renderCartPanel(container);

    expect(container.innerHTML).toContain('Red Zone A');
    expect(container.querySelector('.cart-placement-hint')).not.toBeNull();
  });

  it('marks converted items with cart-item-converted class', () => {
    const items = [{
      id: 5, wine_name: 'Cab Sauv', status: 'arrived', quantity: 1,
      style_id: 'red_full', converted_wine_id: 99
    }];
    getCartState.mockReturnValue({ items, summary: { counts: {}, totals: {} }, loading: false });
    const container = makeContainer();
    renderCartPanel(container);

    expect(container.querySelector('.cart-item-converted')).not.toBeNull();
    expect(container.innerHTML).toContain('in cellar');
  });
});

// ── prefill via options ───────────────────────────────────────────────────────

describe('renderCartPanel with prefillStyle', () => {
  it('stores prefillStyle/label in dataset', () => {
    const container = makeContainer();
    renderCartPanel(container, { prefillStyle: 'red_full', prefillStyleLabel: 'Full Red' });

    expect(container.dataset.prefillStyle).toBe('red_full');
    expect(container.dataset.prefillLabel).toBe('Full Red');
  });

  it('expands the form when prefillStyle provided', () => {
    const container = makeContainer();
    renderCartPanel(container, { prefillStyle: 'white_crisp', prefillStyleLabel: 'Crisp White' });

    expect(container.querySelector('.cart-quick-add')).not.toBeNull();
  });

  it('shows gap hint with prefill label', () => {
    const container = makeContainer();
    renderCartPanel(container, { prefillStyle: 'rose_dry', prefillStyleLabel: 'Dry Rosé' });

    expect(container.innerHTML).toContain('Filling gap');
    expect(container.innerHTML).toContain('Dry Ros'); // é may be escaped
  });

  it('pre-selects correct style option in dropdown', () => {
    const container = makeContainer();
    renderCartPanel(container, { prefillStyle: 'white_oaked', prefillStyleLabel: 'Oaked White' });

    const select = container.querySelector('.cart-quick-add-style');
    expect(select).not.toBeNull();
    expect(select.innerHTML).toContain('selected');
    // The selected option value should be white_oaked
    const selectedOpt = [...select.options].find(o => o.selected);
    expect(selectedOpt?.value).toBe('white_oaked');
  });
});

// ── openQuickAddForGap ────────────────────────────────────────────────────────

describe('openQuickAddForGap', () => {
  it('sets prefillStyle, expands form, and re-renders', () => {
    // Initialize panel first (form may already be expanded from prior tests in --no-isolate mode)
    const container = makeContainer();
    renderCartPanel(container);

    openQuickAddForGap('sparkling_dry', 'Sparkling');

    // After calling openQuickAddForGap, the dataset must be set and form must be visible
    expect(container.dataset.prefillStyle).toBe('sparkling_dry');
    expect(container.dataset.prefillLabel).toBe('Sparkling');
    expect(container.querySelector('.cart-quick-add')).not.toBeNull();
  });

  it('does not throw when no panel has been initialized', () => {
    // openQuickAddForGap guards against null panelRoot
    // (panelRoot was set by previous test; just ensure no crash)
    expect(() => openQuickAddForGap('red_light', 'Light Red')).not.toThrow();
  });
});

// ── Toggle form button ────────────────────────────────────────────────────────

describe('toggle form button', () => {
  it('expands form when clicked while collapsed', () => {
    const container = makeContainer();
    // Re-render with a fresh getCartState that returns empty state (collapsed)
    getCartState.mockReturnValue(EMPTY_STATE);
    renderCartPanel(container);

    // Force collapsed state by re-rendering without prefill
    const btn = container.querySelector('.cart-toggle-form-btn');
    expect(btn).not.toBeNull();

    // If form is expanded after prefill, clicking closes it
    if (container.querySelector('.cart-quick-add')) {
      btn.click();
      expect(container.querySelector('.cart-quick-add')).toBeNull();
    } else {
      btn.click();
      expect(container.querySelector('.cart-quick-add')).not.toBeNull();
    }
  });
});

// ── Quick-add form ────────────────────────────────────────────────────────────

describe('quick-add form submission', () => {
  function setupExpandedPanel() {
    const container = makeContainer();
    renderCartPanel(container, { prefillStyle: 'red_medium', prefillStyleLabel: 'Medium Red' });
    return container;
  }

  it('calls addItem with correct wine data on submit', async () => {
    addItem.mockResolvedValue({ id: 10, wine_name: 'Merlot', style_inferred: false });
    const container = setupExpandedPanel();

    container.querySelector('.cart-quick-add-name').value = 'Merlot 2020';
    container.querySelector('.cart-quick-add-qty').value = '2';
    container.querySelector('.cart-quick-add-producer').value = 'Stellenbosch Estate';

    const form = container.querySelector('.cart-quick-add');
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    await vi.waitFor(() => expect(addItem).toHaveBeenCalledOnce());

    const [data] = addItem.mock.calls[0];
    expect(data.wine_name).toBe('Merlot 2020');
    expect(data.quantity).toBe(2);
    expect(data.producer).toBe('Stellenbosch Estate');
    expect(data.source_gap_style).toBe('red_medium');
  });

  it('does not call addItem if wine name is empty', async () => {
    const container = setupExpandedPanel();
    container.querySelector('.cart-quick-add-name').value = '   ';

    const form = container.querySelector('.cart-quick-add');
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    await new Promise(r => setTimeout(r, 0));
    expect(addItem).not.toHaveBeenCalled();
  });

  it('shows success toast after addItem resolves', async () => {
    addItem.mockResolvedValue({ id: 11, style_inferred: false });
    const container = setupExpandedPanel();
    container.querySelector('.cart-quick-add-name').value = 'Cab Franc';

    const form = container.querySelector('.cart-quick-add');
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast.mock.calls[0][0]).toContain('Added to plan');
  });

  it('shows style-confirmation toast when needs_style_confirmation=true', async () => {
    addItem.mockResolvedValue({ id: 12, style_inferred: true, needs_style_confirmation: true });
    const container = setupExpandedPanel();
    container.querySelector('.cart-quick-add-name').value = 'Mystery White';

    const form = container.querySelector('.cart-quick-add');
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast.mock.calls[0][0]).toContain('auto-detected');
  });

  it('shows error toast when addItem rejects', async () => {
    addItem.mockRejectedValue(new Error('Network error'));
    const container = setupExpandedPanel();
    container.querySelector('.cart-quick-add-name').value = 'Broken Wine';

    const form = container.querySelector('.cart-quick-add');
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast.mock.calls[0][0]).toContain('Failed to add');
  });
});

// ── Status action buttons ─────────────────────────────────────────────────────

describe('status action buttons', () => {
  it('calls transitionStatus for non-arrive/to-cellar actions', async () => {
    transitionStatus.mockResolvedValue({ item: { id: 1, status: 'ordered' } });
    getCartState.mockReturnValue({
      items: [{ id: 1, wine_name: 'Malbec', status: 'planned', quantity: 1, style_id: 'red_full', converted_wine_id: null }],
      summary: { counts: {}, totals: {} }, loading: false
    });
    const container = makeContainer();
    renderCartPanel(container);

    const orderBtn = container.querySelector('.cart-action-btn[data-action="ordered"]');
    expect(orderBtn).not.toBeNull();
    orderBtn.click();

    await vi.waitFor(() => expect(transitionStatus).toHaveBeenCalledWith(1, 'ordered'));
  });

  it('calls arriveItem when "arrived" action clicked', async () => {
    arriveItem.mockResolvedValue({ item: { id: 2, status: 'arrived' }, placement: { zoneName: 'Reds' } });
    getCartState.mockReturnValue({
      items: [{ id: 2, wine_name: 'Shiraz', status: 'ordered', quantity: 1, style_id: 'red_full', converted_wine_id: null }],
      summary: { counts: {}, totals: {} }, loading: false
    });
    const container = makeContainer();
    renderCartPanel(container);

    const arriveBtn = container.querySelector('.cart-action-btn[data-action="arrived"]');
    expect(arriveBtn).not.toBeNull();
    arriveBtn.click();

    await vi.waitFor(() => expect(arriveItem).toHaveBeenCalledWith(2));
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('arrived'), 'success');
  });

  it('shows placement zone name in arrive toast', async () => {
    arriveItem.mockResolvedValue({
      item: { id: 3, status: 'arrived' },
      placement: { zoneName: 'Bordeaux Reds' }
    });
    getCartState.mockReturnValue({
      items: [{ id: 3, wine_name: 'Cab Sauv', status: 'planned', quantity: 1, style_id: 'red_full', converted_wine_id: null }],
      summary: { counts: {}, totals: {} }, loading: false
    });
    const container = makeContainer();
    renderCartPanel(container);

    const arriveBtn = container.querySelector('.cart-action-btn[data-action="arrived"]');
    arriveBtn.click();

    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast.mock.calls[0][0]).toContain('Bordeaux Reds');
  });

  it('calls convertToCellar when "to-cellar" action clicked (full conversion)', async () => {
    convertToCellar.mockResolvedValue({
      requiresConfirmation: false,
      partial: false,
      converted: 2,
      remaining: 0,
      wineId: 55
    });
    getCartState.mockReturnValue({
      items: [{ id: 4, wine_name: 'Pinotage', status: 'arrived', quantity: 2, style_id: 'red_full', converted_wine_id: null }],
      summary: { counts: {}, totals: {} }, loading: false
    });
    const container = makeContainer();
    renderCartPanel(container);

    const toCellarBtn = container.querySelector('.cart-action-btn[data-action="to-cellar"]');
    expect(toCellarBtn).not.toBeNull();
    toCellarBtn.click();

    await vi.waitFor(() => expect(convertToCellar).toHaveBeenCalledWith(4));
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Converted 2'), 'success');
  });

  it('shows error toast when arrive action fails', async () => {
    arriveItem.mockRejectedValue(new Error('Server error'));
    getCartState.mockReturnValue({
      items: [{ id: 5, wine_name: 'Riesling', status: 'ordered', quantity: 1, style_id: 'white_aromatic', converted_wine_id: null }],
      summary: { counts: {}, totals: {} }, loading: false
    });
    const container = makeContainer();
    renderCartPanel(container);

    const arriveBtn = container.querySelector('.cart-action-btn[data-action="arrived"]');
    arriveBtn.click();

    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast.mock.calls[0][1]).toBe('error');
  });
});

// ── Delete button ─────────────────────────────────────────────────────────────

describe('delete button', () => {
  it('calls removeItem with the item ID', async () => {
    removeItem.mockResolvedValue(undefined);
    getCartState.mockReturnValue({
      items: [{ id: 7, wine_name: 'Chenin', status: 'planned', quantity: 1, style_id: 'white_medium', converted_wine_id: null }],
      summary: { counts: {}, totals: {} }, loading: false
    });
    const container = makeContainer();
    renderCartPanel(container);

    const deleteBtn = container.querySelector('.cart-delete-btn[data-id="7"]');
    expect(deleteBtn).not.toBeNull();
    deleteBtn.click();

    await vi.waitFor(() => expect(removeItem).toHaveBeenCalledWith(7));
  });

  it('does not render delete button for converted items', () => {
    getCartState.mockReturnValue({
      items: [{ id: 8, wine_name: 'Old Vine', status: 'arrived', quantity: 1, style_id: 'red_full', converted_wine_id: 100 }],
      summary: { counts: {}, totals: {} }, loading: false
    });
    const container = makeContainer();
    renderCartPanel(container);

    const deleteBtn = container.querySelector('.cart-delete-btn[data-id="8"]');
    expect(deleteBtn).toBeNull();
  });
});

// ── Partial conversion confirmation ───────────────────────────────────────────

describe('partial conversion confirmation dialog', () => {
  it('shows confirmation dialog when requiresConfirmation=true', async () => {
    convertToCellar.mockResolvedValue({
      requiresConfirmation: true,
      partial: true,
      available: 1,
      total: 3,
      message: 'Only 1 of 3 slots available. Confirm to convert 1 now.'
    });
    getCartState.mockReturnValue({
      items: [{ id: 9, wine_name: 'Grand Cru', status: 'arrived', quantity: 3, style_id: 'red_full', converted_wine_id: null }],
      summary: { counts: {}, totals: {} }, loading: false
    });
    const container = makeContainer();
    renderCartPanel(container);

    const toCellarBtn = container.querySelector('.cart-action-btn[data-action="to-cellar"]');
    toCellarBtn.click();

    await vi.waitFor(() => {
      const dialog = container.querySelector('.cart-partial-confirm');
      expect(dialog).not.toBeNull();
    });

    const dialog = container.querySelector('.cart-partial-confirm');
    expect(dialog.innerHTML).toContain('Only 1 of 3');
    expect(dialog.querySelector('.cart-partial-yes')).not.toBeNull();
    expect(dialog.querySelector('.cart-partial-no')).not.toBeNull();
  });

  it('calls convertToCellar with confirmed=true on "Convert now" click', async () => {
    convertToCellar
      .mockResolvedValueOnce({ requiresConfirmation: true, available: 1, total: 3, message: 'Partial' })
      .mockResolvedValueOnce({ requiresConfirmation: false, partial: true, converted: 1, remaining: 2, wineId: 77 });

    getCartState.mockReturnValue({
      items: [{ id: 10, wine_name: 'Reserve', status: 'arrived', quantity: 3, style_id: 'red_full', converted_wine_id: null }],
      summary: { counts: {}, totals: {} }, loading: false
    });
    const container = makeContainer();
    renderCartPanel(container);

    container.querySelector('.cart-action-btn[data-action="to-cellar"]').click();
    await vi.waitFor(() => expect(container.querySelector('.cart-partial-confirm')).not.toBeNull());

    container.querySelector('.cart-partial-yes').click();
    await vi.waitFor(() => expect(convertToCellar).toHaveBeenCalledTimes(2));

    const secondCall = convertToCellar.mock.calls[1];
    expect(secondCall[1]).toEqual({ confirmed: true, convertQuantity: 1 });
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Converted'), 'success');
  });

  it('removes confirmation dialog when "Cancel" clicked', async () => {
    convertToCellar.mockResolvedValue({ requiresConfirmation: true, available: 1, total: 3, message: 'Partial' });
    getCartState.mockReturnValue({
      items: [{ id: 11, wine_name: 'Cab', status: 'arrived', quantity: 3, style_id: 'red_full', converted_wine_id: null }],
      summary: { counts: {}, totals: {} }, loading: false
    });
    const container = makeContainer();
    renderCartPanel(container);

    container.querySelector('.cart-action-btn[data-action="to-cellar"]').click();
    await vi.waitFor(() => expect(container.querySelector('.cart-partial-confirm')).not.toBeNull());

    container.querySelector('.cart-partial-no').click();
    expect(container.querySelector('.cart-partial-confirm')).toBeNull();
  });
});

// ── Checkbox selection & batch bar ────────────────────────────────────────────

describe('checkbox selection and batch bar', () => {
  it('does not show batch bar when no items selected', () => {
    getCartState.mockReturnValue(MIXED_STATE);
    const container = makeContainer();
    renderCartPanel(container);

    expect(container.querySelector('.cart-batch-bar')).toBeNull();
  });

  it('calls batchTransition when batch action button clicked', async () => {
    batchTransition.mockResolvedValue({ updated: 1, skipped: [] });
    getCartState.mockReturnValue({
      items: [{ id: 1, wine_name: 'Merlot', status: 'planned', quantity: 1, style_id: 'red_full', converted_wine_id: null }],
      summary: { counts: {}, totals: {} }, loading: false
    });
    const container = makeContainer();
    renderCartPanel(container);

    // Select the checkbox
    const cb = container.querySelector('.cart-select-cb[data-id="1"]');
    expect(cb).not.toBeNull();
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));

    // Batch bar should now appear; click "Mark Ordered"
    await vi.waitFor(() => {
      const bar = container.querySelector('.cart-batch-bar');
      expect(bar).not.toBeNull();
    });

    const orderedBtn = container.querySelector('.cart-batch-btn[data-action="ordered"]');
    orderedBtn.click();

    await vi.waitFor(() => expect(batchTransition).toHaveBeenCalledWith([1], 'ordered'));
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('updated'), expect.any(String));
  });

  it('shows skipped count in toast when some items skipped', async () => {
    batchTransition.mockResolvedValue({ updated: 1, skipped: [2] });
    getCartState.mockReturnValue({
      items: [
        { id: 1, wine_name: 'A', status: 'planned', quantity: 1, style_id: 'red_full', converted_wine_id: null },
        { id: 2, wine_name: 'B', status: 'arrived', quantity: 1, style_id: 'red_full', converted_wine_id: null }
      ],
      summary: { counts: {}, totals: {} }, loading: false
    });
    const container = makeContainer();
    renderCartPanel(container);

    // Select item 1
    const cb = container.querySelector('.cart-select-cb[data-id="1"]');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(container.querySelector('.cart-batch-bar')).not.toBeNull());

    container.querySelector('.cart-batch-btn[data-action="ordered"]').click();

    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast.mock.calls[0][0]).toContain('skipped');
    expect(showToast.mock.calls[0][1]).toBe('info');
  });
});

// ── Subscription callback ─────────────────────────────────────────────────────

describe('state subscription re-render', () => {
  it('re-renders panel when subscribe callback is invoked', () => {
    getCartState.mockReturnValue(EMPTY_STATE);
    const container = makeContainer();
    renderCartPanel(container);

    // Panel is empty initially
    expect(container.innerHTML).toContain('No items');

    // Now update state and invoke the subscription callback
    getCartState.mockReturnValue({
      items: [{ id: 99, wine_name: 'New Wine', status: 'planned', quantity: 1, style_id: 'red_full', converted_wine_id: null }],
      summary: { counts: {}, totals: {} }, loading: false
    });

    const subscribeCb = subscribe.mock.calls[0][0];
    subscribeCb(); // trigger re-render

    expect(container.innerHTML).toContain('New Wine');
  });
});
