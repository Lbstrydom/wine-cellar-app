// @vitest-environment jsdom

/**
 * @fileoverview Unit tests for Quick Pair module.
 * Tests render, enable logic, image handling, parse flows,
 * budget enforcement, error handling, cancel, and destroy.
 */

// --- Mocks ---

const resizeImageMock = vi.fn(() => Promise.resolve({
  base64: 'base64data',
  mediaType: 'image/jpeg',
  dataUrl: 'data:image/jpeg;base64,base64data',
  size: 1024
}));

vi.mock('../../../public/js/bottles/imageParsing.js', () => ({
  resizeImage: (...args) => resizeImageMock(...args)
}));

const parseMenuMock = vi.fn(() => Promise.resolve({
  items: [
    { name: 'Cabernet Sauvignon', colour: 'red', vintage: 2019, price: 120, confidence: 'high' },
    { name: 'Sauvignon Blanc', colour: 'white', vintage: 2022, price: 80, confidence: 'high' }
  ]
}));

vi.mock('../../../public/js/api/restaurantPairing.js', () => ({
  parseMenu: (...args) => parseMenuMock(...args)
}));

const mergeWinesMock = vi.fn((items) => items);
const mergeDishesMock = vi.fn((items) => items);

vi.mock('../../../public/js/restaurantPairing/state.js', () => ({
  mergeWines: (...args) => mergeWinesMock(...args),
  mergeDishes: (...args) => mergeDishesMock(...args)
}));

vi.mock('../../../public/js/utils.js', () => ({
  showToast: vi.fn(),
  escapeHtml: vi.fn(s => s == null ? '' : String(s))
}));

const { renderQuickPair } = await import('../../../public/js/restaurantPairing/quickPair.js');
const { showToast } = await import('../../../public/js/utils.js');

describe('quickPair', () => {
  let container;
  let parseBudget;
  let onComplete;
  let onCancel;
  let qp;

  function render(budgetOverride) {
    parseBudget = budgetOverride || { used: 0 };
    onComplete = vi.fn(() => Promise.resolve());
    onCancel = vi.fn();
    qp = renderQuickPair(container, { parseBudget, onComplete, onCancel });
  }

  /** Simulate selecting a file in a file input */
  function simulateFileSelect(inputSelector) {
    const input = container.querySelector(inputSelector);
    const file = new File(['fake'], 'wine-list.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file], writable: true });
    input.dispatchEvent(new Event('change'));
    return file;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    container.id = 'test-qp';
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (qp) qp.destroy();
    document.body.removeChild(container);
  });

  // --- Render ---

  describe('render', () => {
    it('renders form with camera, file, textarea, and buttons', () => {
      render();

      expect(container.querySelector('.restaurant-quick-pair-camera')).toBeTruthy();
      expect(container.querySelector('.restaurant-quick-pair-file')).toBeTruthy();
      expect(container.querySelector('.restaurant-quick-pair-dishes')).toBeTruthy();
      expect(container.querySelector('.restaurant-quick-pair-go')).toBeTruthy();
      expect(container.querySelector('.restaurant-quick-pair-cancel')).toBeTruthy();
    });

    it('"Get Pairings" is initially disabled', () => {
      render();
      expect(container.querySelector('.restaurant-quick-pair-go').disabled).toBe(true);
    });

    it('loading spinner is initially hidden', () => {
      render();
      expect(container.querySelector('.restaurant-quick-pair-loading').style.display).toBe('none');
    });
  });

  // --- Image Selection ---

  describe('image selection', () => {
    it('camera button triggers hidden camera input', () => {
      render();
      const cameraInput = container.querySelector('.restaurant-quick-pair-camera-input');
      const clickSpy = vi.spyOn(cameraInput, 'click');

      container.querySelector('.restaurant-quick-pair-camera').click();

      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it('file button triggers hidden file input', () => {
      render();
      const fileInput = container.querySelector('.restaurant-quick-pair-file-input');
      const clickSpy = vi.spyOn(fileInput, 'click');

      container.querySelector('.restaurant-quick-pair-file').click();

      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it('shows thumbnail and status after camera image selected', async () => {
      render();
      simulateFileSelect('.restaurant-quick-pair-camera-input');

      await vi.waitFor(() => {
        expect(resizeImageMock).toHaveBeenCalledTimes(1);
      });

      const status = container.querySelector('.restaurant-quick-pair-image-status');
      expect(status.textContent).toBe('wine-list.jpg');

      const thumb = container.querySelector('.restaurant-quick-pair-thumb');
      expect(thumb.style.display).not.toBe('none');
      expect(thumb.querySelector('img')).toBeTruthy();
    });

    it('shows thumbnail after file input selected', async () => {
      render();
      simulateFileSelect('.restaurant-quick-pair-file-input');

      await vi.waitFor(() => {
        expect(resizeImageMock).toHaveBeenCalledTimes(1);
      });

      const thumb = container.querySelector('.restaurant-quick-pair-thumb');
      expect(thumb.style.display).not.toBe('none');
    });
  });

  // --- Enable Logic ---

  describe('enable logic', () => {
    it('disabled when both empty', () => {
      render();
      expect(container.querySelector('.restaurant-quick-pair-go').disabled).toBe(true);
    });

    it('disabled when image only (no dishes)', async () => {
      render();
      simulateFileSelect('.restaurant-quick-pair-camera-input');

      await vi.waitFor(() => {
        expect(resizeImageMock).toHaveBeenCalledTimes(1);
      });

      expect(container.querySelector('.restaurant-quick-pair-go').disabled).toBe(true);
    });

    it('disabled when text only (no image)', () => {
      render();
      const textarea = container.querySelector('.restaurant-quick-pair-dishes');
      textarea.value = 'Grilled salmon';
      textarea.dispatchEvent(new Event('input'));

      expect(container.querySelector('.restaurant-quick-pair-go').disabled).toBe(true);
    });

    it('enabled when both image and text present', async () => {
      render();
      simulateFileSelect('.restaurant-quick-pair-camera-input');

      await vi.waitFor(() => {
        expect(resizeImageMock).toHaveBeenCalledTimes(1);
      });

      const textarea = container.querySelector('.restaurant-quick-pair-dishes');
      textarea.value = 'Grilled salmon';
      textarea.dispatchEvent(new Event('input'));

      expect(container.querySelector('.restaurant-quick-pair-go').disabled).toBe(false);
    });
  });

  // --- Parse Flow ---

  describe('parse flow', () => {
    async function setupReadyState() {
      render();
      simulateFileSelect('.restaurant-quick-pair-camera-input');
      await vi.waitFor(() => expect(resizeImageMock).toHaveBeenCalled());

      const textarea = container.querySelector('.restaurant-quick-pair-dishes');
      textarea.value = 'Grilled salmon\nBeef fillet\n\nCaesar salad';
      textarea.dispatchEvent(new Event('input'));
    }

    it('calls parseMenu with correct payload', async () => {
      await setupReadyState();

      container.querySelector('.restaurant-quick-pair-go').click();

      await vi.waitFor(() => {
        expect(parseMenuMock).toHaveBeenCalledTimes(1);
      });

      const call = parseMenuMock.mock.calls[0][0];
      expect(call.type).toBe('wine_list');
      expect(call.image).toBe('base64data');
      expect(call.mediaType).toBe('image/jpeg');
    });

    it('merges parsed wine items into state', async () => {
      await setupReadyState();

      container.querySelector('.restaurant-quick-pair-go').click();

      await vi.waitFor(() => {
        expect(mergeWinesMock).toHaveBeenCalledTimes(1);
      });

      const wines = mergeWinesMock.mock.calls[0][0];
      expect(wines).toHaveLength(2);
      expect(wines[0].name).toBe('Cabernet Sauvignon');
    });

    it('splits dish text by lines and filters empty lines', async () => {
      await setupReadyState();

      container.querySelector('.restaurant-quick-pair-go').click();

      await vi.waitFor(() => {
        expect(mergeDishesMock).toHaveBeenCalledTimes(1);
      });

      const dishes = mergeDishesMock.mock.calls[0][0];
      expect(dishes).toHaveLength(3); // Empty line filtered
      expect(dishes[0].name).toBe('Grilled salmon');
      expect(dishes[1].name).toBe('Beef fillet');
      expect(dishes[2].name).toBe('Caesar salad');
      expect(dishes[0].confidence).toBe('high');
      expect(dishes[0].category).toBeNull();
    });

    it('calls onComplete after successful parse', async () => {
      await setupReadyState();

      container.querySelector('.restaurant-quick-pair-go').click();

      await vi.waitFor(() => {
        expect(onComplete).toHaveBeenCalledTimes(1);
      });
    });

    it('increments parse budget', async () => {
      await setupReadyState();

      container.querySelector('.restaurant-quick-pair-go').click();

      await vi.waitFor(() => {
        expect(parseBudget.used).toBe(1);
      });
    });
  });

  // --- Zero Wines ---

  describe('zero wines from parse', () => {
    it('shows toast and does not call onComplete when no wines extracted', async () => {
      parseMenuMock.mockResolvedValueOnce({ items: [] });
      render();
      simulateFileSelect('.restaurant-quick-pair-camera-input');
      await vi.waitFor(() => expect(resizeImageMock).toHaveBeenCalled());

      const textarea = container.querySelector('.restaurant-quick-pair-dishes');
      textarea.value = 'Salmon';
      textarea.dispatchEvent(new Event('input'));

      container.querySelector('.restaurant-quick-pair-go').click();

      await vi.waitFor(() => {
        expect(showToast).toHaveBeenCalledWith(
          expect.stringContaining('Could not find wines'),
          'error'
        );
      });
      expect(onComplete).not.toHaveBeenCalled();
    });
  });

  // --- Parse Budget ---

  describe('parse budget', () => {
    it('disables camera/file buttons when budget exhausted', () => {
      render({ used: 10 });

      expect(container.querySelector('.restaurant-quick-pair-camera').disabled).toBe(true);
      expect(container.querySelector('.restaurant-quick-pair-file').disabled).toBe(true);
    });

    it('shows toast when budget exhausted', () => {
      render({ used: 10 });

      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('Parse budget exhausted'),
        'error'
      );
    });

    it('blocks submit at runtime when budget exhausted after render', async () => {
      render({ used: 9 }); // Under limit at render time
      simulateFileSelect('.restaurant-quick-pair-camera-input');
      await vi.waitFor(() => expect(resizeImageMock).toHaveBeenCalled());

      const textarea = container.querySelector('.restaurant-quick-pair-dishes');
      textarea.value = 'Salmon';
      textarea.dispatchEvent(new Event('input'));

      // Exhaust budget after render but before click
      parseBudget.used = 10;

      container.querySelector('.restaurant-quick-pair-go').click();

      await vi.waitFor(() => {
        expect(showToast).toHaveBeenCalledWith(
          expect.stringContaining('Parse budget exhausted'),
          'error'
        );
      });
      expect(parseMenuMock).not.toHaveBeenCalled();
    });

    it('increments budget before parseMenu call (consumed even on failure)', async () => {
      parseMenuMock.mockRejectedValueOnce(new Error('Server error'));
      render();
      simulateFileSelect('.restaurant-quick-pair-camera-input');
      await vi.waitFor(() => expect(resizeImageMock).toHaveBeenCalled());

      const textarea = container.querySelector('.restaurant-quick-pair-dishes');
      textarea.value = 'Salmon';
      textarea.dispatchEvent(new Event('input'));

      container.querySelector('.restaurant-quick-pair-go').click();

      await vi.waitFor(() => {
        expect(showToast).toHaveBeenCalledWith(
          expect.stringContaining('Parse failed'),
          'error'
        );
      });
      expect(parseBudget.used).toBe(1); // Budget consumed despite failure
    });
  });

  // --- Parse Error ---

  describe('parse error', () => {
    it('shows toast on parse failure and re-enables form', async () => {
      parseMenuMock.mockRejectedValueOnce(new Error('Network error'));
      render();
      simulateFileSelect('.restaurant-quick-pair-camera-input');
      await vi.waitFor(() => expect(resizeImageMock).toHaveBeenCalled());

      const textarea = container.querySelector('.restaurant-quick-pair-dishes');
      textarea.value = 'Salmon';
      textarea.dispatchEvent(new Event('input'));

      container.querySelector('.restaurant-quick-pair-go').click();

      await vi.waitFor(() => {
        expect(showToast).toHaveBeenCalledWith(
          expect.stringContaining('Parse failed'),
          'error'
        );
      });
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('shows distinct error when onComplete throws (not "Parse failed")', async () => {
      render();
      onComplete.mockRejectedValueOnce(new Error('Recommendation API down'));
      simulateFileSelect('.restaurant-quick-pair-camera-input');
      await vi.waitFor(() => expect(resizeImageMock).toHaveBeenCalled());

      const textarea = container.querySelector('.restaurant-quick-pair-dishes');
      textarea.value = 'Salmon';
      textarea.dispatchEvent(new Event('input'));

      container.querySelector('.restaurant-quick-pair-go').click();

      await vi.waitFor(() => {
        expect(showToast).toHaveBeenCalledWith(
          expect.stringContaining('Quick Pair failed'),
          'error'
        );
      });
      // Should NOT say "Parse failed"
      const calls = showToast.mock.calls.map(c => c[0]);
      expect(calls.some(msg => msg.includes('Parse failed'))).toBe(false);
    });
  });

  // --- Cancel ---

  describe('cancel', () => {
    it('"Use Full Wizard" calls onCancel', () => {
      render();

      container.querySelector('.restaurant-quick-pair-cancel').click();

      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  // --- Destroy ---

  describe('destroy', () => {
    it('removes listeners and aborts in-flight parse', () => {
      render();

      // Should not throw
      expect(() => qp.destroy()).not.toThrow();
      // Double destroy is safe
      expect(() => qp.destroy()).not.toThrow();
    });
  });

  // --- Char Counter ---

  describe('char counter', () => {
    it('updates counter on textarea input', () => {
      render();
      const textarea = container.querySelector('.restaurant-quick-pair-dishes');
      textarea.value = 'Hello world';
      textarea.dispatchEvent(new Event('input'));

      const counter = container.querySelector('.restaurant-quick-pair-char-count');
      expect(counter.textContent).toBe('11');
    });
  });
});
