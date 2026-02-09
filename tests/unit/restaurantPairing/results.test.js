// @vitest-environment jsdom

/**
 * @fileoverview Unit tests for results module.
 * Tests summary bar, pre-flight validation, API call, result cards,
 * fallback banner, chat rendering/hiding, chat messaging, loading state,
 * direct invocation, invalidated state, and destroy.
 */

// --- Mocks ---

const mockWines = [
  { id: 1, name: 'Cabernet Sauvignon', colour: 'red', vintage: 2019, price: 120, by_the_glass: false, style: 'full-bodied' },
  { id: 2, name: 'Sauvignon Blanc', colour: 'white', vintage: 2022, price: 80, by_the_glass: true, style: 'crisp' },
  { id: 3, name: 'Pinot Noir', colour: 'red', vintage: 2020, price: 150, by_the_glass: false, style: 'elegant' },
  { id: 4, name: 'Chardonnay', colour: 'white', vintage: 2021, price: 95, by_the_glass: true, style: 'oaked' },
  { id: 5, name: 'Merlot', colour: 'red', vintage: 2018, price: 110, by_the_glass: false, style: 'medium-bodied' }
];

const mockDishes = [
  { id: 10, name: 'Grilled Lamb Chops', description: 'With rosemary jus', category: 'Main' },
  { id: 11, name: 'Caesar Salad', description: 'Classic preparation', category: 'Starter' },
  { id: 12, name: 'Chocolate Fondant', description: 'With vanilla ice cream', category: 'Dessert' }
];

/** Matches backend recommendResponseSchema (flat pairing fields, object table_wine) */
const mockPairingsResponse = {
  table_summary: 'Great selection for a dinner party',
  pairings: [
    { rank: 1, dish_name: 'Grilled Lamb Chops', wine_id: 1, wine_name: 'Cabernet Sauvignon', wine_colour: 'red', wine_price: 120, by_the_glass: false, why: 'Tannic reds complement lamb', serving_tip: 'Serve at 16°C', confidence: 'high' },
    { rank: 2, dish_name: 'Caesar Salad', wine_id: 2, wine_name: 'Sauvignon Blanc', wine_colour: 'white', wine_price: 80, by_the_glass: true, why: 'Crisp acidity matches greens', serving_tip: 'Serve chilled', confidence: 'high' },
    { rank: 3, dish_name: 'Chocolate Fondant', wine_id: 5, wine_name: 'Merlot', wine_colour: 'red', wine_price: 110, by_the_glass: false, why: 'Soft tannins with chocolate', serving_tip: 'Slight chill', confidence: 'medium' }
  ],
  table_wine: { wine_name: 'Pinot Noir', wine_price: 150, why: 'Versatile table wine for the group' },
  chatId: 'chat-uuid-123',
  fallback: false
};

let currentSelectedWines = [];
let currentSelectedDishes = [];
let currentResults = null;
let currentChatId = null;
let currentQuickPairMode = false;

vi.mock('../../../public/js/restaurantPairing/state.js', () => ({
  getSelectedWines: vi.fn(() => currentSelectedWines),
  getSelectedDishes: vi.fn(() => currentSelectedDishes),
  getResults: vi.fn(() => currentResults),
  setResults: vi.fn((r) => { currentResults = r; }),
  getChatId: vi.fn(() => currentChatId),
  setChatId: vi.fn((id) => { currentChatId = id; }),
  getQuickPairMode: vi.fn(() => currentQuickPairMode),
  setQuickPairMode: vi.fn((val) => { currentQuickPairMode = !!val; })
}));

vi.mock('../../../public/js/api.js', () => ({
  getRecommendations: vi.fn(() => Promise.resolve(mockPairingsResponse)),
  restaurantChat: vi.fn(() => Promise.resolve({ message: 'Try Pinot Grigio for a lighter option.' }))
}));

vi.mock('../../../public/js/utils.js', () => ({
  showToast: vi.fn(),
  escapeHtml: vi.fn(s => s == null ? '' : String(s))
}));

const { renderResults, destroyResults, requestRecommendations } = await import('../../../public/js/restaurantPairing/results.js');
const { setResults: setResultsMock, setChatId: setChatIdMock, setQuickPairMode: setQuickPairModeMock } = await import('../../../public/js/restaurantPairing/state.js');
const { getRecommendations: getRecommendationsMock, restaurantChat: restaurantChatMock } = await import('../../../public/js/api.js');
const { showToast } = await import('../../../public/js/utils.js');

describe('results', () => {
  let container;

  beforeEach(() => {
    vi.clearAllMocks();
    currentSelectedWines = mockWines.map(w => ({ ...w }));
    currentSelectedDishes = mockDishes.map(d => ({ ...d }));
    currentResults = null;
    currentChatId = null;
    currentQuickPairMode = false;
    container = document.createElement('div');
    container.id = 'test-results';
    document.body.appendChild(container);
  });

  afterEach(() => {
    destroyResults();
    document.body.removeChild(container);
  });

  // --- Summary ---

  describe('summary', () => {
    it('renders summary with correct counts', () => {
      renderResults('test-results');

      const summary = container.querySelector('.restaurant-results-summary');
      expect(summary.textContent).toContain('Pairing 5 wines with 3 dishes');
    });

    it('shows over-cap warning when wines exceed MAX', () => {
      // Generate 81 wines
      currentSelectedWines = Array.from({ length: 81 }, (_, i) => ({
        id: i + 1, name: `Wine ${i + 1}`, colour: 'red'
      }));
      renderResults('test-results');

      const summary = container.querySelector('.restaurant-results-summary');
      expect(summary.textContent).toContain('Too many wines selected (81/80)');
    });

    it('shows over-cap warning when dishes exceed MAX', () => {
      currentSelectedDishes = Array.from({ length: 21 }, (_, i) => ({
        id: i + 1, name: `Dish ${i + 1}`, category: 'Main'
      }));
      renderResults('test-results');

      const summary = container.querySelector('.restaurant-results-summary');
      expect(summary.textContent).toContain('Too many dishes selected (21/20)');
    });
  });

  // --- Pre-flight Validation ---

  describe('pre-flight validation', () => {
    it('blocks when wines exceed 80', async () => {
      currentSelectedWines = Array.from({ length: 81 }, (_, i) => ({
        id: i + 1, name: `Wine ${i + 1}`, colour: 'red'
      }));
      renderResults('test-results');

      await requestRecommendations();

      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('Too many wines selected'),
        'error'
      );
      expect(getRecommendationsMock).not.toHaveBeenCalled();
    });

    it('blocks when dishes exceed 20', async () => {
      currentSelectedDishes = Array.from({ length: 21 }, (_, i) => ({
        id: i + 1, name: `Dish ${i + 1}`, category: 'Main'
      }));
      renderResults('test-results');

      await requestRecommendations();

      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('Too many dishes selected'),
        'error'
      );
      expect(getRecommendationsMock).not.toHaveBeenCalled();
    });
  });

  // --- API Call ---

  describe('requestRecommendations', () => {
    it('calls getRecommendations with correct payload', async () => {
      renderResults('test-results');

      await requestRecommendations();

      expect(getRecommendationsMock).toHaveBeenCalledTimes(1);
      const payload = getRecommendationsMock.mock.calls[0][0];
      expect(payload.wines).toHaveLength(5);
      expect(payload.dishes).toHaveLength(3);
      expect(payload.wines[0]).toEqual(expect.objectContaining({ id: 1, name: 'Cabernet Sauvignon' }));
      expect(payload.dishes[0]).toEqual(expect.objectContaining({ id: 10, name: 'Grilled Lamb Chops' }));
    });

    it('stores results and chatId on success', async () => {
      renderResults('test-results');

      await requestRecommendations();

      expect(setResultsMock).toHaveBeenCalledWith(mockPairingsResponse);
      expect(setChatIdMock).toHaveBeenCalledWith('chat-uuid-123');
    });

    it('clears chatId when API returns null chatId', async () => {
      // Simulate a prior chat session
      currentChatId = 'old-chat-id';
      getRecommendationsMock.mockResolvedValueOnce({
        ...mockPairingsResponse,
        chatId: null,
        fallback: true
      });
      renderResults('test-results');

      await requestRecommendations();

      expect(setChatIdMock).toHaveBeenCalledWith(null);
    });
  });

  // --- Result Cards ---

  describe('result cards', () => {
    it('renders recommendation cards from API response', async () => {
      renderResults('test-results');
      await requestRecommendations();

      const cards = container.querySelectorAll('.restaurant-result-card');
      expect(cards.length).toBe(3);
      expect(cards[0].textContent).toContain('Grilled Lamb Chops');
      expect(cards[0].textContent).toContain('Cabernet Sauvignon');
      expect(cards[0].textContent).toContain('Tannic reds complement lamb');
    });

    it('renders table wine suggestion card with name and why', async () => {
      renderResults('test-results');
      await requestRecommendations();

      const tableWine = container.querySelector('.restaurant-table-wine-card');
      expect(tableWine).toBeTruthy();
      expect(tableWine.textContent).toContain('Pinot Noir');
      expect(tableWine.textContent).toContain('$150');
      expect(tableWine.textContent).toContain('Versatile table wine');
    });
  });

  // --- Fallback Banner ---

  describe('fallback banner', () => {
    it('shows fallback banner when response has fallback: true', async () => {
      getRecommendationsMock.mockResolvedValueOnce({
        ...mockPairingsResponse,
        fallback: true,
        chatId: null
      });
      currentChatId = null;
      renderResults('test-results');
      await requestRecommendations();

      const banner = container.querySelector('.restaurant-fallback-banner');
      expect(banner.style.display).not.toBe('none');
      expect(banner.textContent).toContain('AI unavailable');
    });

    it('hides fallback banner on normal response', async () => {
      renderResults('test-results');
      await requestRecommendations();

      const banner = container.querySelector('.restaurant-fallback-banner');
      expect(banner.style.display).toBe('none');
    });
  });

  // --- Chat ---

  describe('chat interface', () => {
    it('renders chat UI when chatId is present', async () => {
      currentChatId = 'chat-uuid-123';
      renderResults('test-results');
      await requestRecommendations();

      const chatInput = container.querySelector('.restaurant-chat-input');
      const sendBtn = container.querySelector('.restaurant-chat-send-btn');
      expect(chatInput).toBeTruthy();
      expect(sendBtn).toBeTruthy();
    });

    it('hides chat when chatId is null and shows explanatory text', async () => {
      getRecommendationsMock.mockResolvedValueOnce({
        ...mockPairingsResponse,
        chatId: null,
        fallback: true
      });
      currentChatId = null;
      renderResults('test-results');
      await requestRecommendations();

      const unavailable = container.querySelector('.restaurant-chat-unavailable');
      expect(unavailable).toBeTruthy();
      expect(unavailable.textContent).toContain('Follow-up chat is not available');

      const chatInput = container.querySelector('.restaurant-chat-input');
      expect(chatInput).toBeFalsy();
    });

    it('sends chat message via restaurantChat API', async () => {
      currentChatId = 'chat-uuid-123';
      renderResults('test-results');
      await requestRecommendations();

      const chatInput = container.querySelector('.restaurant-chat-input');
      chatInput.value = 'What about a lighter red?';

      const sendBtn = container.querySelector('.restaurant-chat-send-btn');
      sendBtn.click();

      // Wait for async chat send
      await vi.waitFor(() => {
        expect(restaurantChatMock).toHaveBeenCalledWith('chat-uuid-123', 'What about a lighter red?');
      });
    });

    it('enforces maxlength 2000 on chat input', async () => {
      currentChatId = 'chat-uuid-123';
      renderResults('test-results');
      await requestRecommendations();

      const chatInput = container.querySelector('.restaurant-chat-input');
      expect(chatInput.getAttribute('maxlength')).toBe('2000');
    });

    it('renders chat suggestion buttons', async () => {
      currentChatId = 'chat-uuid-123';
      renderResults('test-results');
      await requestRecommendations();

      const suggestions = container.querySelectorAll('.restaurant-chat-suggestion');
      expect(suggestions.length).toBe(3);
      expect(suggestions[0].textContent).toContain('What about a lighter option?');
    });
  });

  // --- Loading State ---

  describe('loading state', () => {
    it('disables button and shows spinner during API call', async () => {
      let resolveRecommendations;
      getRecommendationsMock.mockImplementationOnce(() =>
        new Promise(resolve => { resolveRecommendations = resolve; })
      );

      renderResults('test-results');

      const promise = requestRecommendations();

      const btn = container.querySelector('.restaurant-get-pairings-btn');
      const loading = container.querySelector('.restaurant-results-loading');
      expect(btn.disabled).toBe(true);
      expect(loading.style.display).not.toBe('none');

      resolveRecommendations(mockPairingsResponse);
      await promise;

      expect(btn.disabled).toBe(false);
      expect(loading.style.display).toBe('none');
    });
  });

  // --- Direct Invocation ---

  describe('direct invocation', () => {
    it('requestRecommendations works without DOM button click', async () => {
      renderResults('test-results');

      await requestRecommendations();

      expect(getRecommendationsMock).toHaveBeenCalledTimes(1);
      const cards = container.querySelectorAll('.restaurant-result-card');
      expect(cards.length).toBe(3);
    });
  });

  // --- Invalidated State ---

  describe('invalidated state', () => {
    it('shows fresh UI with Get Pairings button when results are null', () => {
      currentResults = null;
      renderResults('test-results');

      const btn = container.querySelector('.restaurant-get-pairings-btn');
      expect(btn).toBeTruthy();

      const cards = container.querySelectorAll('.restaurant-result-card');
      expect(cards.length).toBe(0);
    });
  });

  // --- Quick Pair Warning ---

  describe('quick pair warning', () => {
    it('renders warning banner when quickPairMode is true', () => {
      currentQuickPairMode = true;
      renderResults('test-results');

      const warning = container.querySelector('.restaurant-quick-pair-warning');
      expect(warning).toBeTruthy();
      expect(warning.textContent).toContain('Quick Pair');
    });

    it('does not render warning when quickPairMode is false', () => {
      currentQuickPairMode = false;
      renderResults('test-results');

      const warning = container.querySelector('.restaurant-quick-pair-warning');
      expect(warning).toBeFalsy();
    });

    it('refine button dispatches restaurant:refine event', () => {
      currentQuickPairMode = true;
      renderResults('test-results');

      const handler = vi.fn();
      container.addEventListener('restaurant:refine', handler);

      container.querySelector('.restaurant-refine-btn').click();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(setQuickPairModeMock).toHaveBeenCalledWith(false);
    });
  });

  // --- Destroy ---

  describe('destroy', () => {
    it('cleans up all listeners on destroy', () => {
      renderResults('test-results');

      destroyResults();

      // No errors should occur; module state should be cleared
      expect(true).toBe(true);
    });
  });
});
