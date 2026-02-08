// @vitest-environment jsdom

/**
 * @fileoverview Unit tests for imageCapture widget.
 * Tests DOM rendering, concurrency queue, AbortController cleanup,
 * parse budget enforcement, and 429 handling.
 */

// --- DataTransfer polyfill for jsdom ---
if (typeof globalThis.DataTransfer === 'undefined') {
  globalThis.DataTransfer = class DataTransfer {
    constructor() { this._items = []; this._files = []; }
    get items() {
      const self = this;
      return {
        add(file) { self._files.push(file); },
        get length() { return self._files.length; }
      };
    }
    get files() {
      const list = Object.create(FileList.prototype);
      this._files.forEach((f, i) => { list[i] = f; });
      Object.defineProperty(list, 'length', { value: this._files.length });
      return list;
    }
  };
}

// --- Mocks (use globals — vitest config has globals: true) ---

vi.mock('../../../public/js/bottles/imageParsing.js', () => ({
  resizeImage: vi.fn(async () => ({
    base64: 'fakeBase64Data',
    mediaType: 'image/jpeg',
    dataUrl: 'data:image/jpeg;base64,fakeBase64Data',
    size: 1000
  }))
}));

vi.mock('../../../public/js/api/restaurantPairing.js', () => ({
  parseMenu: vi.fn()
}));

vi.mock('../../../public/js/utils.js', () => ({
  showToast: vi.fn(),
  escapeHtml: vi.fn(s => s)
}));

const { createImageCapture } = await import('../../../public/js/restaurantPairing/imageCapture.js');
const { resizeImage } = await import('../../../public/js/bottles/imageParsing.js');
const { parseMenu } = await import('../../../public/js/api/restaurantPairing.js');
const { showToast } = await import('../../../public/js/utils.js');

describe('imageCapture', () => {
  let container;
  let parseBudget;
  let onAnalyze;
  let onSkipManual;

  function createWidget(overrides = {}) {
    return createImageCapture(container, {
      type: 'wine_list',
      maxImages: 4,
      parseBudget,
      onAnalyze,
      onSkipManual,
      ...overrides
    });
  }

  /** Helper to create a mock File */
  function makeFile(name = 'test.jpg') {
    return new File(['fake'], name, { type: 'image/jpeg' });
  }

  /** Add files by dispatching change event on file input */
  async function addFilesViaInput(fileCount = 1) {
    const fileInput = container.querySelector('.restaurant-file-input');
    const dt = new DataTransfer();
    for (let i = 0; i < fileCount; i++) dt.items.add(makeFile(`img${i}.jpg`));
    Object.defineProperty(fileInput, 'files', { value: dt.files, writable: true });
    fileInput.dispatchEvent(new Event('change'));
    // Wait for async resizeImage to complete
    await vi.waitFor(() => {
      expect(container.querySelectorAll('.restaurant-image-thumb').length).toBeGreaterThanOrEqual(1);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    parseBudget = { used: 0 };
    onAnalyze = vi.fn();
    onSkipManual = vi.fn();

    // Default: parseMenu resolves with items
    parseMenu.mockResolvedValue({
      items: [{ type: 'wine', name: 'Test Wine', confidence: 'high' }],
      overall_confidence: 'high',
      parse_notes: ''
    });
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  // =========================================================================
  // DOM rendering
  // =========================================================================

  describe('DOM rendering', () => {
    it('renders all expected DOM elements', () => {
      createWidget();
      expect(container.querySelector('.restaurant-text-input')).toBeTruthy();
      expect(container.querySelector('.restaurant-text-counter')).toBeTruthy();
      expect(container.querySelector('.restaurant-image-grid')).toBeTruthy();
      expect(container.querySelector('.restaurant-capture-status')).toBeTruthy();
      expect(container.querySelector('.restaurant-browse-btn')).toBeTruthy();
      expect(container.querySelector('.restaurant-camera-btn')).toBeTruthy();
      expect(container.querySelector('.restaurant-file-input')).toBeTruthy();
      expect(container.querySelector('.restaurant-camera-input')).toBeTruthy();
      expect(container.querySelector('.restaurant-analyze-btn')).toBeTruthy();
      expect(container.querySelector('.restaurant-skip-btn')).toBeTruthy();
    });

    it('textarea has maxlength="5000"', () => {
      createWidget();
      expect(container.querySelector('.restaurant-text-input').getAttribute('maxlength')).toBe('5000');
    });

    it('shows correct placeholder for wine_list', () => {
      createWidget({ type: 'wine_list' });
      expect(container.querySelector('.restaurant-text-input').placeholder).toContain('wine list');
    });

    it('shows correct placeholder for dish_menu', () => {
      createWidget({ type: 'dish_menu' });
      expect(container.querySelector('.restaurant-text-input').placeholder).toContain('dish menu');
    });

    it('updates character counter on input', () => {
      createWidget();
      const textarea = container.querySelector('.restaurant-text-input');
      textarea.value = 'Hello';
      textarea.dispatchEvent(new Event('input'));
      expect(container.querySelector('.restaurant-text-counter').textContent).toBe('5 / 5000');
    });

    it('file input supports multiple files', () => {
      createWidget();
      expect(container.querySelector('.restaurant-file-input').hasAttribute('multiple')).toBe(true);
    });

    it('camera input has capture="environment"', () => {
      createWidget();
      expect(container.querySelector('.restaurant-camera-input').getAttribute('capture')).toBe('environment');
    });

    it('skip to manual button is visible immediately', () => {
      createWidget();
      const skipBtn = container.querySelector('.restaurant-skip-btn');
      expect(skipBtn).toBeTruthy();
      expect(skipBtn.style.display).not.toBe('none');
    });

    it('analyze button has correct aria-label for wine_list', () => {
      createWidget({ type: 'wine_list' });
      expect(container.querySelector('.restaurant-analyze-btn').getAttribute('aria-label'))
        .toContain('wine list');
    });

    it('analyze button has correct aria-label for dish_menu', () => {
      createWidget({ type: 'dish_menu' });
      expect(container.querySelector('.restaurant-analyze-btn').getAttribute('aria-label'))
        .toContain('dish menu');
    });
  });

  // =========================================================================
  // Image management
  // =========================================================================

  describe('image management', () => {
    it('adds images up to maxImages limit', async () => {
      createWidget({ maxImages: 2 });
      const fileInput = container.querySelector('.restaurant-file-input');
      const dt = new DataTransfer();
      dt.items.add(makeFile('a.jpg'));
      dt.items.add(makeFile('b.jpg'));
      dt.items.add(makeFile('c.jpg'));
      Object.defineProperty(fileInput, 'files', { value: dt.files, writable: true });

      fileInput.dispatchEvent(new Event('change'));

      await vi.waitFor(() => {
        expect(container.querySelectorAll('.restaurant-image-thumb').length).toBe(2);
      });
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('Maximum 2 images'),
        'error'
      );
    });

    it('calls resizeImage for each file', async () => {
      createWidget();
      await addFilesViaInput(1);
      expect(resizeImage).toHaveBeenCalledTimes(1);
      expect(resizeImage).toHaveBeenCalledWith(expect.any(File));
    });

    it('remove button removes thumbnail', async () => {
      createWidget();
      await addFilesViaInput(2);
      expect(container.querySelectorAll('.restaurant-image-thumb').length).toBe(2);

      container.querySelector('.restaurant-image-remove').click();
      expect(container.querySelectorAll('.restaurant-image-thumb').length).toBe(1);
    });

    it('getImages returns current images', async () => {
      const widget = createWidget();
      await addFilesViaInput(1);
      expect(widget.getImages().length).toBe(1);
      expect(widget.getImages()[0]).toHaveProperty('base64', 'fakeBase64Data');
    });

    it('getText returns textarea value', () => {
      const widget = createWidget();
      container.querySelector('.restaurant-text-input').value = 'My wine list';
      expect(widget.getText()).toBe('My wine list');
    });
  });

  // =========================================================================
  // Analyze / Parse
  // =========================================================================

  describe('analyze', () => {
    it('calls parseMenu with correct type for text-only', async () => {
      createWidget({ type: 'wine_list' });
      const ta = container.querySelector('.restaurant-text-input');
      ta.value = 'Merlot 2019 - $25';
      ta.dispatchEvent(new Event('input'));
      container.querySelector('.restaurant-analyze-btn').click();

      await vi.waitFor(() => {
        expect(parseMenu).toHaveBeenCalledWith(
          { type: 'wine_list', text: 'Merlot 2019 - $25', image: null, mediaType: null },
          expect.any(AbortSignal)
        );
      });
    });

    it('calls parseMenu with correct type for dish_menu', async () => {
      createWidget({ type: 'dish_menu' });
      const ta = container.querySelector('.restaurant-text-input');
      ta.value = 'Grilled Steak';
      ta.dispatchEvent(new Event('input'));
      container.querySelector('.restaurant-analyze-btn').click();

      await vi.waitFor(() => {
        expect(parseMenu).toHaveBeenCalledWith(
          { type: 'dish_menu', text: 'Grilled Steak', image: null, mediaType: null },
          expect.any(AbortSignal)
        );
      });
    });

    it('calls onAnalyze with parsed items', async () => {
      createWidget();
      const ta = container.querySelector('.restaurant-text-input');
      ta.value = 'Merlot 2019';
      ta.dispatchEvent(new Event('input'));
      container.querySelector('.restaurant-analyze-btn').click();

      await vi.waitFor(() => {
        expect(onAnalyze).toHaveBeenCalledWith([
          { type: 'wine', name: 'Test Wine', confidence: 'high' }
        ]);
      });
    });

    it('increments parseBudget on each call', async () => {
      createWidget();
      const ta = container.querySelector('.restaurant-text-input');
      ta.value = 'Merlot 2019';
      ta.dispatchEvent(new Event('input'));
      container.querySelector('.restaurant-analyze-btn').click();

      await vi.waitFor(() => {
        expect(parseBudget.used).toBe(1);
      });
    });

    it('shows toast when no items found', async () => {
      parseMenu.mockResolvedValue({ items: [], overall_confidence: 'high', parse_notes: '' });
      createWidget();
      const ta = container.querySelector('.restaurant-text-input');
      ta.value = 'gibberish';
      ta.dispatchEvent(new Event('input'));
      container.querySelector('.restaurant-analyze-btn').click();

      await vi.waitFor(() => {
        expect(showToast).toHaveBeenCalledWith(
          expect.stringContaining('No items found'),
          'info'
        );
      });
    });

    it('sends image payload with base64 and mediaType', async () => {
      createWidget();
      await addFilesViaInput(1);
      container.querySelector('.restaurant-analyze-btn').click();

      await vi.waitFor(() => {
        expect(parseMenu).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'wine_list',
            text: null,
            image: 'fakeBase64Data',
            mediaType: 'image/jpeg'
          }),
          expect.any(AbortSignal)
        );
      });
    });
  });

  // =========================================================================
  // Concurrency queue
  // =========================================================================

  describe('concurrency queue', () => {
    it('limits to 2 concurrent parseMenu calls', async () => {
      let activeCalls = 0;
      let maxActive = 0;
      const resolvers = [];

      parseMenu.mockImplementation(() => {
        activeCalls++;
        maxActive = Math.max(maxActive, activeCalls);
        return new Promise(resolve => {
          resolvers.push(() => {
            activeCalls--;
            resolve({ items: [{ type: 'wine', name: 'W', confidence: 'high' }] });
          });
        });
      });

      createWidget();
      await addFilesViaInput(4);

      container.querySelector('.restaurant-analyze-btn').click();

      // Wait for first batch of 2
      await vi.waitFor(() => {
        expect(parseMenu).toHaveBeenCalledTimes(2);
      });
      expect(maxActive).toBe(2);

      // Resolve first two
      resolvers[0]();
      resolvers[1]();

      // Wait for remaining 2
      await vi.waitFor(() => {
        expect(parseMenu).toHaveBeenCalledTimes(4);
      });

      // Resolve remaining
      resolvers[2]();
      resolvers[3]();

      await vi.waitFor(() => {
        expect(onAnalyze).toHaveBeenCalled();
      });
      expect(maxActive).toBe(2);
    });
  });

  // =========================================================================
  // Cancel / AbortController
  // =========================================================================

  describe('cancel', () => {
    it('removing image aborts in-flight request', async () => {
      let abortSignal;
      parseMenu.mockImplementation(async (_payload, signal) => {
        abortSignal = signal;
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      });

      createWidget();
      await addFilesViaInput(1);

      container.querySelector('.restaurant-analyze-btn').click();
      await vi.waitFor(() => {
        expect(parseMenu).toHaveBeenCalled();
      });

      // Remove the image
      container.querySelector('.restaurant-image-remove').click();
      expect(abortSignal.aborted).toBe(true);
    });
  });

  // =========================================================================
  // Parse budget
  // =========================================================================

  describe('parse budget', () => {
    it('disables analyze when budget exhausted', () => {
      parseBudget.used = 10;
      createWidget();
      expect(container.querySelector('.restaurant-analyze-btn').disabled).toBe(true);
    });

    it('shows budget status when used > 0', () => {
      parseBudget.used = 3;
      createWidget();
      expect(container.querySelector('.restaurant-capture-status').textContent).toContain('3/10');
    });

    it('shows exhaustion message at limit', () => {
      parseBudget.used = 10;
      createWidget();
      expect(container.querySelector('.restaurant-capture-status').textContent).toContain('add items manually');
    });

    it('prevents analyze when budget exhausted', () => {
      parseBudget.used = 10;
      createWidget();
      // Button should be disabled
      expect(container.querySelector('.restaurant-analyze-btn').disabled).toBe(true);
      // Status message should guide user
      expect(container.querySelector('.restaurant-capture-status').textContent)
        .toContain('add items manually');
    });
  });

  // =========================================================================
  // 429 handling
  // =========================================================================

  describe('429 handling', () => {
    it('shows friendly toast on 429 response', async () => {
      const error = new Error('429');
      error.status = 429;
      parseMenu.mockRejectedValue(error);

      createWidget();
      const ta = container.querySelector('.restaurant-text-input');
      ta.value = 'test';
      ta.dispatchEvent(new Event('input'));
      container.querySelector('.restaurant-analyze-btn').click();

      await vi.waitFor(() => {
        expect(showToast).toHaveBeenCalledWith(
          expect.stringContaining('please wait a few minutes'),
          'error'
        );
      });
    });
  });

  // =========================================================================
  // Skip to manual
  // =========================================================================

  describe('skip to manual', () => {
    it('calls onSkipManual when clicked', () => {
      createWidget();
      container.querySelector('.restaurant-skip-btn').click();
      expect(onSkipManual).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Destroy / cleanup
  // =========================================================================

  describe('destroy', () => {
    it('aborts in-flight controllers', async () => {
      let abortSignal;
      parseMenu.mockImplementation(async (_payload, signal) => {
        abortSignal = signal;
        return new Promise(() => {}); // Never resolves
      });

      const widget = createWidget();
      const ta = container.querySelector('.restaurant-text-input');
      ta.value = 'test';
      ta.dispatchEvent(new Event('input'));
      container.querySelector('.restaurant-analyze-btn').click();

      await vi.waitFor(() => {
        expect(parseMenu).toHaveBeenCalled();
      });

      widget.destroy();
      expect(abortSignal.aborted).toBe(true);
    });

    it('removes event listeners so analyze no longer fires', () => {
      const widget = createWidget();
      widget.destroy();

      const ta = container.querySelector('.restaurant-text-input');
      ta.value = 'test';
      ta.dispatchEvent(new Event('input'));
      // Even though button may be disabled, confirm parseMenu is never called
      container.querySelector('.restaurant-analyze-btn').click();
      expect(parseMenu).not.toHaveBeenCalled();
    });

    it('stops queued requests from starting after destroy()', async () => {
      const resolvers = [];
      parseMenu.mockImplementation(() => {
        return new Promise(resolve => {
          resolvers.push(() => {
            resolve({ items: [{ type: 'wine', name: 'W', confidence: 'high' }] });
          });
        });
      });

      const widget = createWidget();
      await addFilesViaInput(4);
      container.querySelector('.restaurant-analyze-btn').click();

      // Wait for first batch of 2 (MAX_CONCURRENT)
      await vi.waitFor(() => {
        expect(parseMenu).toHaveBeenCalledTimes(2);
      });

      // Destroy while 2 are in-flight, 2 are queued
      widget.destroy();

      // Resolve in-flight requests
      resolvers[0]();
      resolvers[1]();

      // Allow microtasks to flush
      await new Promise(r => setTimeout(r, 50));

      // Queued requests should NOT have been started
      expect(parseMenu).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // Removed-image queue skip
  // =========================================================================

  describe('removed-image queue skip', () => {
    it('skips queued request for image removed while waiting', async () => {
      const resolvers = [];
      parseMenu.mockImplementation(() => {
        return new Promise(resolve => {
          resolvers.push(() => {
            resolve({ items: [{ type: 'wine', name: 'W', confidence: 'high' }] });
          });
        });
      });

      createWidget();
      await addFilesViaInput(4);

      container.querySelector('.restaurant-analyze-btn').click();

      // Wait for first batch of 2
      await vi.waitFor(() => {
        expect(parseMenu).toHaveBeenCalledTimes(2);
      });

      // Remove image #4 (queued but not yet started) — last remove button
      let removeBtns = container.querySelectorAll('.restaurant-image-remove');
      removeBtns[removeBtns.length - 1].click();

      // Re-query after DOM re-render (renderImages rebuilds all buttons)
      removeBtns = container.querySelectorAll('.restaurant-image-remove');
      // Remove image #3 (also queued) — now the last button
      removeBtns[removeBtns.length - 1].click();

      // Resolve first two in-flight requests
      resolvers[0]();
      resolvers[1]();

      // Wait for onAnalyze to be called (queue should finish without starting removed images)
      await vi.waitFor(() => {
        expect(onAnalyze).toHaveBeenCalled();
      });

      // Only 2 parseMenu calls total — the queued ones for removed images were skipped
      expect(parseMenu).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // Budget status persistence
  // =========================================================================

  describe('budget status persistence', () => {
    it('shows budget count after analysis completes', async () => {
      createWidget();
      const ta = container.querySelector('.restaurant-text-input');
      ta.value = 'Merlot 2019';
      ta.dispatchEvent(new Event('input'));
      container.querySelector('.restaurant-analyze-btn').click();

      await vi.waitFor(() => {
        expect(onAnalyze).toHaveBeenCalled();
      });

      // After analysis, status should show budget count (not be empty)
      const status = container.querySelector('.restaurant-capture-status').textContent;
      expect(status).toContain('1/10');
      expect(status).toContain('parses used');
    });
  });
});
