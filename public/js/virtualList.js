/**
 * @fileoverview Virtual list rendering for large datasets.
 * Uses a windowing technique to only render visible items plus a buffer.
 * No external dependencies - uses native Intersection Observer API.
 * @module virtualList
 */

/**
 * Default configuration for virtual list.
 */
const DEFAULT_CONFIG = {
  itemHeight: 80,      // Estimated height of each item in pixels
  bufferSize: 5,       // Number of items to render above/below viewport
  throttleMs: 16       // Throttle scroll events (~60fps)
};

/**
 * Virtual list state.
 */
let virtualState = {
  container: null,
  items: [],
  renderItem: null,
  config: { ...DEFAULT_CONFIG },
  scrollTop: 0,
  containerHeight: 0,
  renderedRange: { start: 0, end: 0 },
  isInitialized: false,
  resizeObserver: null,
  scrollThrottleId: null
};

/**
 * Initialize virtual list on a container.
 * @param {Object} options - Configuration options
 * @param {HTMLElement} options.container - Container element
 * @param {Array} options.items - Data items to render
 * @param {Function} options.renderItem - Function that returns HTML for an item
 * @param {number} [options.itemHeight] - Estimated item height in pixels
 * @param {number} [options.bufferSize] - Buffer items above/below viewport
 * @param {Function} [options.onItemClick] - Click handler for items
 */
export function initVirtualList(options) {
  const {
    container,
    items,
    renderItem,
    itemHeight = DEFAULT_CONFIG.itemHeight,
    bufferSize = DEFAULT_CONFIG.bufferSize,
    onItemClick = null
  } = options;

  if (!container || !renderItem) {
    console.error('[VirtualList] Container and renderItem are required');
    return;
  }

  // Clean up previous instance if exists
  destroyVirtualList();

  virtualState = {
    container,
    items: items || [],
    renderItem,
    onItemClick,
    config: { itemHeight, bufferSize, throttleMs: DEFAULT_CONFIG.throttleMs },
    scrollTop: 0,
    containerHeight: container.clientHeight,
    renderedRange: { start: 0, end: 0 },
    isInitialized: true,
    resizeObserver: null,
    scrollThrottleId: null
  };

  // Set up container styles
  container.style.overflowY = 'auto';
  container.style.position = 'relative';

  // Create inner wrapper for virtual height
  const wrapper = document.createElement('div');
  wrapper.className = 'virtual-list-wrapper';
  wrapper.style.position = 'relative';
  wrapper.style.width = '100%';
  container.innerHTML = '';
  container.appendChild(wrapper);
  virtualState.wrapper = wrapper;

  // Create content container
  const content = document.createElement('div');
  content.className = 'virtual-list-content';
  content.style.position = 'absolute';
  content.style.top = '0';
  content.style.left = '0';
  content.style.right = '0';
  wrapper.appendChild(content);
  virtualState.content = content;

  // Set up scroll listener
  container.addEventListener('scroll', handleScroll, { passive: true });

  // Set up resize observer
  virtualState.resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      virtualState.containerHeight = entry.contentRect.height;
      render();
    }
  });
  virtualState.resizeObserver.observe(container);

  // Initial render
  render();
}

/**
 * Update items in the virtual list.
 * @param {Array} newItems - New data items
 */
export function updateVirtualList(newItems) {
  if (!virtualState.isInitialized) {
    console.warn('[VirtualList] Not initialized');
    return;
  }

  virtualState.items = newItems || [];
  render();
}

/**
 * Destroy virtual list and clean up.
 */
export function destroyVirtualList() {
  if (!virtualState.isInitialized) return;

  if (virtualState.container) {
    virtualState.container.removeEventListener('scroll', handleScroll);
  }

  if (virtualState.resizeObserver) {
    virtualState.resizeObserver.disconnect();
  }

  if (virtualState.scrollThrottleId) {
    cancelAnimationFrame(virtualState.scrollThrottleId);
  }

  virtualState = {
    ...virtualState,
    isInitialized: false,
    container: null,
    items: [],
    wrapper: null,
    content: null,
    resizeObserver: null
  };
}

/**
 * Handle scroll events with throttling.
 * @param {Event} event - Scroll event
 */
function handleScroll(event) {
  if (virtualState.scrollThrottleId) return;

  virtualState.scrollThrottleId = requestAnimationFrame(() => {
    virtualState.scrollTop = event.target.scrollTop;
    render();
    virtualState.scrollThrottleId = null;
  });
}

/**
 * Calculate visible range based on scroll position.
 * @returns {Object} { start, end } indices
 */
function calculateVisibleRange() {
  const { items, scrollTop, containerHeight, config } = virtualState;
  const { itemHeight, bufferSize } = config;

  const totalItems = items.length;
  if (totalItems === 0) return { start: 0, end: 0 };

  // Calculate visible range
  const visibleStart = Math.floor(scrollTop / itemHeight);
  const visibleEnd = Math.ceil((scrollTop + containerHeight) / itemHeight);

  // Add buffer
  const start = Math.max(0, visibleStart - bufferSize);
  const end = Math.min(totalItems, visibleEnd + bufferSize);

  return { start, end };
}

/**
 * Render visible items.
 */
function render() {
  if (!virtualState.isInitialized) return;

  const { items, wrapper, content, config, renderItem, onItemClick } = virtualState;
  const { itemHeight } = config;

  // Update total height
  const totalHeight = items.length * itemHeight;
  wrapper.style.height = `${totalHeight}px`;

  // Calculate visible range
  const range = calculateVisibleRange();

  // Skip if range hasn't changed
  if (range.start === virtualState.renderedRange.start &&
      range.end === virtualState.renderedRange.end &&
      content.children.length > 0) {
    return;
  }

  virtualState.renderedRange = range;

  // Position content container
  const offsetY = range.start * itemHeight;
  content.style.transform = `translateY(${offsetY}px)`;

  // Render visible items
  const visibleItems = items.slice(range.start, range.end);
  content.innerHTML = visibleItems.map((item, index) => {
    const globalIndex = range.start + index;
    return `<div class="virtual-list-item" data-index="${globalIndex}" style="min-height: ${itemHeight}px;">
      ${renderItem(item, globalIndex)}
    </div>`;
  }).join('');

  // Add click handlers if provided
  if (onItemClick) {
    content.querySelectorAll('.virtual-list-item').forEach(el => {
      el.addEventListener('click', (e) => {
        const index = parseInt(el.dataset.index, 10);
        const item = items[index];
        if (item) onItemClick(item, index, e);
      });
    });
  }
}

/**
 * Scroll to a specific item index.
 * @param {number} index - Item index to scroll to
 * @param {string} [position='start'] - 'start', 'center', or 'end'
 */
export function scrollToIndex(index, position = 'start') {
  if (!virtualState.isInitialized || !virtualState.container) return;

  const { itemHeight } = virtualState.config;
  const containerHeight = virtualState.containerHeight;

  let scrollTop;
  switch (position) {
    case 'center':
      scrollTop = (index * itemHeight) - (containerHeight / 2) + (itemHeight / 2);
      break;
    case 'end':
      scrollTop = (index * itemHeight) - containerHeight + itemHeight;
      break;
    case 'start':
    default:
      scrollTop = index * itemHeight;
  }

  virtualState.container.scrollTop = Math.max(0, scrollTop);
}

/**
 * Get current scroll information.
 * @returns {Object} Scroll info { scrollTop, visibleStart, visibleEnd, totalItems }
 */
export function getScrollInfo() {
  if (!virtualState.isInitialized) return null;

  const range = calculateVisibleRange();
  return {
    scrollTop: virtualState.scrollTop,
    visibleStart: range.start,
    visibleEnd: range.end,
    totalItems: virtualState.items.length,
    containerHeight: virtualState.containerHeight
  };
}

/**
 * Check if virtual list is active/initialized.
 * @returns {boolean} True if initialized
 */
export function isVirtualListActive() {
  return virtualState.isInitialized;
}

export default {
  initVirtualList,
  updateVirtualList,
  destroyVirtualList,
  scrollToIndex,
  getScrollInfo,
  isVirtualListActive
};
