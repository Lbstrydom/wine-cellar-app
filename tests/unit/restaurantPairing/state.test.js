/**
 * @fileoverview Unit tests for restaurant pairing state module.
 * Tests dedup/merge logic, sessionStorage persistence, and edge cases.
 *
 * NOTE: Uses clearState() + _rehydrateFromStorage() instead of vi.resetModules()
 * to avoid corrupting the shared module registry in --no-isolate mode.
 */

// --- sessionStorage mock ---

const storage = new Map();
const sessionStorageMock = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear()
};

globalThis.sessionStorage = sessionStorageMock;

import * as mod from '../../../public/js/restaurantPairing/state.js';

describe('Restaurant Pairing State', () => {
  beforeEach(() => {
    storage.clear();
    mod.clearState();
  });

  // =========================================================================
  // Step management
  // =========================================================================

  describe('step management', () => {
    it('defaults to step 1', () => {
      expect(mod.getStep()).toBe(1);
    });

    it('persists step to sessionStorage', () => {
      mod.setStep(3);
      expect(mod.getStep()).toBe(3);
      expect(JSON.parse(storage.get('wineapp.restaurant.step'))).toBe(3);
    });

    it('clamps step below 1 to 1', () => {
      mod.setStep(0);
      expect(mod.getStep()).toBe(1);
    });

    it('clamps step above 4 to 4', () => {
      mod.setStep(7);
      expect(mod.getStep()).toBe(4);
    });

    it('clamps NaN to 1', () => {
      mod.setStep('banana');
      expect(mod.getStep()).toBe(1);
    });

    it('restores step from sessionStorage', () => {
      storage.set('wineapp.restaurant.step', '3');
      mod._rehydrateFromStorage();
      expect(mod.getStep()).toBe(3);
    });
  });

  // =========================================================================
  // Wine merge/dedup
  // =========================================================================

  describe('wine merge/dedup', () => {
    const wine1 = { name: 'Kanonkop Pinotage', vintage: 2019, by_the_glass: false, price: 120, colour: 'red', confidence: 'high' };
    const wine2 = { name: 'Meerlust Rubicon', vintage: 2018, by_the_glass: false, price: 200, colour: 'red', confidence: 'medium' };

    it('assigns incrementing IDs to new wines', () => {
      const result = mod.mergeWines([wine1, wine2]);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
    });

    it('auto-selects new wines', () => {
      mod.mergeWines([wine1]);
      const selections = mod.getSelections();
      expect(selections.wines[1]).toBe(true);
    });

    it('deduplicates exact composite key matches', () => {
      mod.mergeWines([wine1]);
      const result = mod.mergeWines([{ ...wine1 }]);
      expect(result).toHaveLength(1);
    });

    it('keeps both entries when prices differ >20%', () => {
      mod.mergeWines([wine1]); // price: 120
      const expensive = { ...wine1, price: 200 }; // >20% difference
      const result = mod.mergeWines([expensive]);
      expect(result).toHaveLength(2);
    });

    it('merges when prices differ <=20%', () => {
      mod.mergeWines([wine1]); // price: 120
      const similar = { ...wine1, price: 130 }; // ~8% difference
      const result = mod.mergeWines([similar]);
      expect(result).toHaveLength(1);
    });

    it('fills null fields from duplicate with data', () => {
      const sparse = { name: 'Kanonkop Pinotage', vintage: 2019, by_the_glass: false, price: null, colour: null, confidence: 'medium' };
      mod.mergeWines([sparse]);
      const result = mod.mergeWines([wine1]);
      expect(result[0].colour).toBe('red');
      expect(result[0].price).toBe(120);
    });

    it('prefers high confidence data over existing', () => {
      const lowConf = { ...wine1, confidence: 'low', colour: 'white' };
      mod.mergeWines([lowConf]);
      const result = mod.mergeWines([{ ...wine1, confidence: 'high', colour: 'red' }]);
      expect(result[0].colour).toBe('red');
      expect(result[0].confidence).toBe('high');
    });

    it('fuzzy-merges similar names (Jaccard > 0.7)', () => {
      // Jaccard: {kanonkop,estate,pinotage} ∩ {kanonkop,estate,red,pinotage} = 3/4 = 0.75
      mod.mergeWines([{ name: 'Kanonkop Estate Pinotage', vintage: 2019, by_the_glass: false, price: 120, confidence: 'high' }]);
      const result = mod.mergeWines([{ name: 'Kanonkop Estate Red Pinotage', vintage: 2019, by_the_glass: false, price: 125, confidence: 'high' }]);
      expect(result).toHaveLength(1);
    });

    it('does not fuzzy-merge different vintages', () => {
      mod.mergeWines([{ name: 'Kanonkop Pinotage', vintage: 2019, by_the_glass: false, confidence: 'high' }]);
      const result = mod.mergeWines([{ name: 'Kanonkop Pinotage', vintage: 2020, by_the_glass: false, confidence: 'high' }]);
      expect(result).toHaveLength(2);
    });

    it('does not fuzzy-merge different by_the_glass values', () => {
      mod.mergeWines([{ name: 'Kanonkop Pinotage', vintage: 2019, by_the_glass: false, confidence: 'high' }]);
      const result = mod.mergeWines([{ name: 'Kanonkop Pinotage', vintage: 2019, by_the_glass: true, confidence: 'high' }]);
      expect(result).toHaveLength(2);
    });

    it('does not mutate input objects', () => {
      const input = { name: 'Test Wine', vintage: 2020, by_the_glass: false, confidence: 'high' };
      mod.mergeWines([input]);
      expect(input.id).toBeUndefined();
    });

    it('persists wines to sessionStorage', () => {
      mod.mergeWines([wine1]);
      const stored = JSON.parse(storage.get('wineapp.restaurant.wines'));
      expect(stored).toHaveLength(1);
      expect(stored[0].name).toBe('Kanonkop Pinotage');
    });

    it('handles diacritics in dedup', () => {
      mod.mergeWines([{ name: 'Château Margaux', vintage: 2015, by_the_glass: false, confidence: 'high' }]);
      const result = mod.mergeWines([{ name: 'Chateau Margaux', vintage: 2015, by_the_glass: false, confidence: 'high' }]);
      expect(result).toHaveLength(1);
    });

    it('merges null-price items with same composite key', () => {
      mod.mergeWines([{ ...wine1, price: null }]);
      const result = mod.mergeWines([{ ...wine1, price: null }]);
      expect(result).toHaveLength(1);
    });
  });

  // =========================================================================
  // Dish merge/dedup
  // =========================================================================

  describe('dish merge/dedup', () => {
    it('assigns incrementing IDs', () => {
      const result = mod.mergeDishes([
        { name: 'Grilled Steak', confidence: 'high' },
        { name: 'Caesar Salad', confidence: 'high' }
      ]);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
    });

    it('deduplicates by normalized name', () => {
      mod.mergeDishes([{ name: 'Grilled Steak', confidence: 'high' }]);
      const result = mod.mergeDishes([{ name: 'grilled steak', confidence: 'high' }]);
      expect(result).toHaveLength(1);
    });

    it('does not mutate input objects', () => {
      const input = { name: 'Test Dish', confidence: 'high' };
      mod.mergeDishes([input]);
      expect(input.id).toBeUndefined();
    });

    it('handles diacritics in dish dedup', () => {
      mod.mergeDishes([{ name: 'Crème Brûlée', confidence: 'high' }]);
      const result = mod.mergeDishes([{ name: 'Creme Brulee', confidence: 'high' }]);
      expect(result).toHaveLength(1);
    });
  });

  // =========================================================================
  // Manual add/remove
  // =========================================================================

  describe('manual add/remove', () => {
    it('addWine assigns id and high confidence', () => {
      const wine = mod.addWine({ name: 'Manual Wine', vintage: 2020, by_the_glass: false });
      expect(wine.id).toBe(1);
      expect(wine.confidence).toBe('high');
      expect(mod.getWines()).toHaveLength(1);
    });

    it('addWine does not mutate input', () => {
      const input = { name: 'Test', by_the_glass: false };
      mod.addWine(input);
      expect(input.id).toBeUndefined();
      expect(input.confidence).toBeUndefined();
    });

    it('removeWine removes by id', () => {
      mod.addWine({ name: 'Wine A', by_the_glass: false });
      mod.addWine({ name: 'Wine B', by_the_glass: false });
      mod.removeWine(1);
      expect(mod.getWines()).toHaveLength(1);
      expect(mod.getWines()[0].name).toBe('Wine B');
    });

    it('removeWine clears selection', () => {
      mod.addWine({ name: 'Wine A', by_the_glass: false });
      mod.removeWine(1);
      expect(mod.getSelections().wines[1]).toBeUndefined();
    });

    it('updateWineField updates a specific field', () => {
      mod.addWine({ name: 'Wine A', vintage: 2020, price: 120, by_the_glass: false });
      mod.updateWineField(1, 'price', 150);
      const wine = mod.getWines()[0];
      expect(wine.price).toBe(150);
      expect(wine.name).toBe('Wine A'); // Other fields unchanged
    });

    it('updateWineField persists to sessionStorage', () => {
      mod.addWine({ name: 'Wine A', vintage: 2020, price: 120, by_the_glass: false });
      mod.updateWineField(1, 'price', 150);
      const stored = JSON.parse(storage.get('wineapp.restaurant.wines'));
      expect(stored[0].price).toBe(150);
    });

    it('updateWineField invalidates results', () => {
      mod.addWine({ name: 'Wine A', vintage: 2020, price: 120, by_the_glass: false });
      mod.setResults({ pairings: [] });
      mod.setChatId('chat-1');
      mod.updateWineField(1, 'price', 150);
      expect(mod.getResults()).toBeNull();
      expect(mod.getChatId()).toBeNull();
    });

    it('updateWineField is a no-op for non-existent wine id', () => {
      mod.addWine({ name: 'Wine A', vintage: 2020, price: 120, by_the_glass: false });
      mod.updateWineField(999, 'price', 150); // Non-existent ID
      const wine = mod.getWines()[0];
      expect(wine.price).toBe(120); // Unchanged
    });

    it('addDish assigns id and high confidence', () => {
      const dish = mod.addDish({ name: 'Manual Dish' });
      expect(dish.id).toBe(1);
      expect(dish.confidence).toBe('high');
    });

    it('addDish does not mutate input', () => {
      const input = { name: 'Test Dish' };
      mod.addDish(input);
      expect(input.id).toBeUndefined();
      expect(input.confidence).toBeUndefined();
    });

    it('removeDish removes by id', () => {
      mod.addDish({ name: 'Dish A' });
      mod.addDish({ name: 'Dish B' });
      mod.removeDish(1);
      expect(mod.getDishes()).toHaveLength(1);
    });
  });

  // =========================================================================
  // Selections
  // =========================================================================

  describe('selections', () => {
    it('getSelectedWines returns only checked wines', () => {
      mod.mergeWines([
        { name: 'Wine A', vintage: 2020, by_the_glass: false, confidence: 'high' },
        { name: 'Wine B', vintage: 2021, by_the_glass: false, confidence: 'high' }
      ]);
      mod.setWineSelected(2, false);
      expect(mod.getSelectedWines()).toHaveLength(1);
      expect(mod.getSelectedWines()[0].name).toBe('Wine A');
    });

    it('getSelectedDishes returns only checked dishes', () => {
      mod.mergeDishes([
        { name: 'Dish A', confidence: 'high' },
        { name: 'Dish B', confidence: 'high' }
      ]);
      mod.setDishSelected(1, false);
      expect(mod.getSelectedDishes()).toHaveLength(1);
    });

    it('getSelectedWines treats missing selection keys as selected (restored session)', () => {
      mod.mergeWines([
        { name: 'Wine A', vintage: 2020, by_the_glass: false, confidence: 'high' },
        { name: 'Wine B', vintage: 2021, by_the_glass: false, confidence: 'high' }
      ]);
      // Simulate restored session: clear selections map but keep wines
      const sel = mod.getSelections();
      delete sel.wines[1];
      delete sel.wines[2];
      // Missing keys should be treated as selected (consistent with !== false)
      expect(mod.getSelectedWines()).toHaveLength(2);
    });

    it('getSelectedDishes treats missing selection keys as selected (restored session)', () => {
      mod.mergeDishes([
        { name: 'Dish A', confidence: 'high' },
        { name: 'Dish B', confidence: 'high' }
      ]);
      const sel = mod.getSelections();
      delete sel.dishes[1];
      delete sel.dishes[2];
      expect(mod.getSelectedDishes()).toHaveLength(2);
    });

    it('selectAllWines selects all', () => {
      mod.mergeWines([
        { name: 'Wine A', vintage: 2020, by_the_glass: false, confidence: 'high' },
        { name: 'Wine B', vintage: 2021, by_the_glass: false, confidence: 'high' }
      ]);
      mod.setWineSelected(1, false);
      mod.setWineSelected(2, false);
      mod.selectAllWines();
      expect(mod.getSelectedWines()).toHaveLength(2);
    });

    it('deselectAllWines deselects all', () => {
      mod.mergeWines([
        { name: 'Wine A', vintage: 2020, by_the_glass: false, confidence: 'high' },
        { name: 'Wine B', vintage: 2021, by_the_glass: false, confidence: 'high' }
      ]);
      mod.deselectAllWines();
      expect(mod.getSelectedWines()).toHaveLength(0);
    });

    it('selectAllWines with predicate filters', () => {
      mod.mergeWines([
        { name: 'Red Wine', vintage: 2020, by_the_glass: false, colour: 'red', confidence: 'high' },
        { name: 'White Wine', vintage: 2020, by_the_glass: false, colour: 'white', confidence: 'high' }
      ]);
      mod.deselectAllWines();
      mod.selectAllWines(w => w.colour === 'red');
      expect(mod.getSelectedWines()).toHaveLength(1);
      expect(mod.getSelectedWines()[0].colour).toBe('red');
    });

    it('persists selections to sessionStorage', () => {
      mod.mergeWines([{ name: 'Wine', vintage: 2020, by_the_glass: false, confidence: 'high' }]);
      mod.setWineSelected(1, false);
      const stored = JSON.parse(storage.get('wineapp.restaurant.selections'));
      expect(stored.wines[1]).toBe(false);
    });
  });

  // =========================================================================
  // Results & chat
  // =========================================================================

  describe('results and chat', () => {
    it('stores and retrieves results', () => {
      const results = { pairings: [{ rank: 1, dish_name: 'Steak', wine_name: 'Merlot' }] };
      mod.setResults(results);
      expect(mod.getResults()).toEqual(results);
    });

    it('stores and retrieves chatId', () => {
      mod.setChatId('abc-123');
      expect(mod.getChatId()).toBe('abc-123');
    });

    it('persists results to sessionStorage', () => {
      mod.setResults({ test: true });
      expect(JSON.parse(storage.get('wineapp.restaurant.results'))).toEqual({ test: true });
    });
  });

  // =========================================================================
  // hasData and clearState
  // =========================================================================

  describe('hasData and clearState', () => {
    it('hasData returns false when empty', () => {
      expect(mod.hasData()).toBe(false);
    });

    it('hasData returns true when wines exist', () => {
      mod.addWine({ name: 'Wine', by_the_glass: false });
      expect(mod.hasData()).toBe(true);
    });

    it('hasData returns true when dishes exist', () => {
      mod.addDish({ name: 'Dish' });
      expect(mod.hasData()).toBe(true);
    });

    it('clearState resets all state', () => {
      mod.addWine({ name: 'Wine', by_the_glass: false });
      mod.addDish({ name: 'Dish' });
      mod.setStep(3);
      mod.setResults({ test: true });
      mod.setChatId('chat-1');

      mod.clearState();

      expect(mod.getStep()).toBe(1);
      expect(mod.getWines()).toHaveLength(0);
      expect(mod.getDishes()).toHaveLength(0);
      expect(mod.getResults()).toBeNull();
      expect(mod.getChatId()).toBeNull();
      expect(mod.hasData()).toBe(false);
    });

    it('clearState removes all sessionStorage keys', () => {
      mod.addWine({ name: 'Wine', by_the_glass: false });
      mod.setStep(2);
      mod.clearState();

      expect(storage.get('wineapp.restaurant.step')).toBeUndefined();
      expect(storage.get('wineapp.restaurant.wines')).toBeUndefined();
      expect(storage.get('wineapp.restaurant.dishes')).toBeUndefined();
      expect(storage.get('wineapp.restaurant.selections')).toBeUndefined();
      expect(storage.get('wineapp.restaurant.results')).toBeUndefined();
      expect(storage.get('wineapp.restaurant.chatId')).toBeUndefined();
    });

    it('clearState resets IDs so next add starts at 1', () => {
      mod.addWine({ name: 'Wine', by_the_glass: false });
      mod.clearState();
      const wine = mod.addWine({ name: 'New Wine', by_the_glass: false });
      expect(wine.id).toBe(1);
    });
  });

  // =========================================================================
  // Quick Pair Mode
  // =========================================================================

  describe('quickPairMode', () => {
    it('defaults to false', () => {
      expect(mod.getQuickPairMode()).toBe(false);
    });

    it('persists true to sessionStorage', () => {
      mod.setQuickPairMode(true);
      expect(mod.getQuickPairMode()).toBe(true);
      expect(JSON.parse(storage.get('wineapp.restaurant.quickPairMode'))).toBe(true);
    });

    it('clearState resets quickPairMode to false', () => {
      mod.setQuickPairMode(true);
      mod.clearState();
      expect(mod.getQuickPairMode()).toBe(false);
      expect(storage.get('wineapp.restaurant.quickPairMode')).toBeUndefined();
    });

    it('invalidateResults resets quickPairMode to false', () => {
      mod.setQuickPairMode(true);
      mod.invalidateResults();
      expect(JSON.parse(storage.get('wineapp.restaurant.quickPairMode'))).toBe(false);
    });
  });

  // =========================================================================
  // Corrupted sessionStorage (Finding 1)
  // Uses _rehydrateFromStorage() instead of vi.resetModules() to avoid
  // corrupting the shared module registry in --no-isolate mode.
  // =========================================================================

  describe('corrupted sessionStorage recovery', () => {
    it('recovers when wines is stored as an object instead of array', () => {
      storage.set('wineapp.restaurant.wines', '{"not": "an array"}');
      mod._rehydrateFromStorage();
      expect(mod.getWines()).toEqual([]);
    });

    it('recovers when wines is stored as a string', () => {
      storage.set('wineapp.restaurant.wines', '"just a string"');
      mod._rehydrateFromStorage();
      expect(mod.getWines()).toEqual([]);
    });

    it('recovers when wines is stored as null JSON', () => {
      storage.set('wineapp.restaurant.wines', 'null');
      mod._rehydrateFromStorage();
      expect(mod.getWines()).toEqual([]);
    });

    it('recovers when storage contains invalid JSON', () => {
      storage.set('wineapp.restaurant.wines', '{broken json!!!');
      mod._rehydrateFromStorage();
      expect(mod.getWines()).toEqual([]);
    });

    it('recovers when dishes is stored as non-array', () => {
      storage.set('wineapp.restaurant.dishes', '42');
      mod._rehydrateFromStorage();
      expect(mod.getDishes()).toEqual([]);
    });

    it('recovers when selections is stored as a string', () => {
      storage.set('wineapp.restaurant.selections', '"bad"');
      mod._rehydrateFromStorage();
      // selections should fall back to default object shape
      const sel = mod.getSelections();
      expect(sel).toEqual({ wines: {}, dishes: {} });
      // setWineSelected must not crash
      mod.addWine({ name: 'Test', by_the_glass: false });
      expect(() => mod.setWineSelected(1, true)).not.toThrow();
    });

    it('recovers when selections is stored as an array', () => {
      storage.set('wineapp.restaurant.selections', '[1,2,3]');
      mod._rehydrateFromStorage();
      expect(mod.getSelections()).toEqual({ wines: {}, dishes: {} });
    });

    it('recovers when selections is stored as null', () => {
      storage.set('wineapp.restaurant.selections', 'null');
      mod._rehydrateFromStorage();
      expect(mod.getSelections()).toEqual({ wines: {}, dishes: {} });
    });

    it('recovers when step is stored as a string', () => {
      storage.set('wineapp.restaurant.step', '"banana"');
      mod._rehydrateFromStorage();
      expect(mod.getStep()).toBe(1);
    });

    it('recovers when step is stored as an object', () => {
      storage.set('wineapp.restaurant.step', '{"bad": true}');
      mod._rehydrateFromStorage();
      expect(mod.getStep()).toBe(1);
    });

    it('clamps out-of-range step from storage', () => {
      storage.set('wineapp.restaurant.step', '999');
      mod._rehydrateFromStorage();
      expect(mod.getStep()).toBe(4);
    });

    it('recovers when results is stored as invalid JSON', () => {
      storage.set('wineapp.restaurant.results', '{broken!!!');
      mod._rehydrateFromStorage();
      expect(mod.getResults()).toBeNull();
    });

    it('recovers when chatId is stored as invalid JSON', () => {
      storage.set('wineapp.restaurant.chatId', '{broken!!!');
      mod._rehydrateFromStorage();
      expect(mod.getChatId()).toBeNull();
    });
  });

  // =========================================================================
  // Result invalidation
  // =========================================================================

  describe('invalidateResults', () => {
    it('clears results and chatId', () => {
      mod.setResults({ pairings: [] });
      mod.setChatId('abc-123');
      mod.invalidateResults();
      expect(mod.getResults()).toBeNull();
      expect(mod.getChatId()).toBeNull();
    });

    it('persists null to sessionStorage', () => {
      mod.setResults({ pairings: [] });
      mod.setChatId('abc-123');
      mod.invalidateResults();
      expect(JSON.parse(storage.get('wineapp.restaurant.results'))).toBeNull();
      expect(JSON.parse(storage.get('wineapp.restaurant.chatId'))).toBeNull();
    });

    it('is a no-op when results already null', () => {
      mod.invalidateResults();
      expect(mod.getResults()).toBeNull();
      expect(mod.getChatId()).toBeNull();
    });

    it('is called by setWineSelected', () => {
      mod.mergeWines([{ name: 'Wine', vintage: 2020, by_the_glass: false, confidence: 'high' }]);
      mod.setResults({ pairings: [] });
      mod.setChatId('chat-1');
      mod.setWineSelected(1, false);
      expect(mod.getResults()).toBeNull();
      expect(mod.getChatId()).toBeNull();
    });

    it('is called by setDishSelected', () => {
      mod.mergeDishes([{ name: 'Dish', confidence: 'high' }]);
      mod.setResults({ pairings: [] });
      mod.setChatId('chat-1');
      mod.setDishSelected(1, false);
      expect(mod.getResults()).toBeNull();
      expect(mod.getChatId()).toBeNull();
    });

    it('is called by addWine', () => {
      mod.setResults({ pairings: [] });
      mod.setChatId('chat-1');
      mod.addWine({ name: 'New Wine', by_the_glass: false });
      expect(mod.getResults()).toBeNull();
      expect(mod.getChatId()).toBeNull();
    });

    it('is called by addDish', () => {
      mod.setResults({ pairings: [] });
      mod.setChatId('chat-1');
      mod.addDish({ name: 'New Dish' });
      expect(mod.getResults()).toBeNull();
      expect(mod.getChatId()).toBeNull();
    });

    it('is called by mergeWines', () => {
      mod.setResults({ pairings: [] });
      mod.setChatId('chat-1');
      mod.mergeWines([{ name: 'Wine', vintage: 2020, by_the_glass: false, confidence: 'high' }]);
      expect(mod.getResults()).toBeNull();
      expect(mod.getChatId()).toBeNull();
    });

    it('is called by mergeDishes', () => {
      mod.setResults({ pairings: [] });
      mod.setChatId('chat-1');
      mod.mergeDishes([{ name: 'Dish', confidence: 'high' }]);
      expect(mod.getResults()).toBeNull();
      expect(mod.getChatId()).toBeNull();
    });

    it('is called by removeWine', () => {
      mod.addWine({ name: 'Wine', by_the_glass: false });
      mod.setResults({ pairings: [] });
      mod.setChatId('chat-1');
      mod.removeWine(1);
      expect(mod.getResults()).toBeNull();
      expect(mod.getChatId()).toBeNull();
    });

    it('is called by removeDish', () => {
      mod.addDish({ name: 'Dish' });
      mod.setResults({ pairings: [] });
      mod.setChatId('chat-1');
      mod.removeDish(1);
      expect(mod.getResults()).toBeNull();
      expect(mod.getChatId()).toBeNull();
    });

    it('is called by selectAllWines', () => {
      mod.mergeWines([{ name: 'Wine', vintage: 2020, by_the_glass: false, confidence: 'high' }]);
      mod.setResults({ pairings: [] });
      mod.setChatId('chat-1');
      mod.selectAllWines();
      expect(mod.getResults()).toBeNull();
      expect(mod.getChatId()).toBeNull();
    });

    it('is called by deselectAllWines', () => {
      mod.mergeWines([{ name: 'Wine', vintage: 2020, by_the_glass: false, confidence: 'high' }]);
      mod.setResults({ pairings: [] });
      mod.setChatId('chat-1');
      mod.deselectAllWines();
      expect(mod.getResults()).toBeNull();
      expect(mod.getChatId()).toBeNull();
    });
  });

  // =========================================================================
  // Persistence across reloads
  // Uses _rehydrateFromStorage() instead of vi.resetModules() to simulate
  // a page reload without corrupting the shared module registry.
  // =========================================================================

  describe('persistence across reloads', () => {
    it('restores wines from sessionStorage', () => {
      mod.mergeWines([
        { name: 'Preserved Wine', vintage: 2020, by_the_glass: false, confidence: 'high' }
      ]);

      // Capture what's in storage
      const winesJson = storage.get('wineapp.restaurant.wines');
      const selectionsJson = storage.get('wineapp.restaurant.selections');

      // Reset in-memory state without clearing storage
      mod.clearState();

      // Re-set storage to simulate a reload scenario
      storage.set('wineapp.restaurant.wines', winesJson);
      if (selectionsJson) storage.set('wineapp.restaurant.selections', selectionsJson);

      mod._rehydrateFromStorage();
      expect(mod.getWines()).toHaveLength(1);
      expect(mod.getWines()[0].name).toBe('Preserved Wine');
    });

    it('restores selections from sessionStorage', () => {
      mod.mergeWines([
        { name: 'Wine A', vintage: 2020, by_the_glass: false, confidence: 'high' },
        { name: 'Wine B', vintage: 2021, by_the_glass: false, confidence: 'high' }
      ]);
      mod.setWineSelected(2, false);

      // Capture storage
      const winesJson = storage.get('wineapp.restaurant.wines');
      const selectionsJson = storage.get('wineapp.restaurant.selections');

      // Simulate reload
      mod.clearState();
      storage.set('wineapp.restaurant.wines', winesJson);
      storage.set('wineapp.restaurant.selections', selectionsJson);
      mod._rehydrateFromStorage();

      expect(mod.getSelectedWines()).toHaveLength(1);
    });

    it('continues ID sequence after reload', () => {
      mod.addWine({ name: 'Wine 1', by_the_glass: false });
      mod.addWine({ name: 'Wine 2', by_the_glass: false });

      // Capture storage
      const winesJson = storage.get('wineapp.restaurant.wines');

      // Simulate reload
      mod.clearState();
      storage.set('wineapp.restaurant.wines', winesJson);
      mod._rehydrateFromStorage();

      const wine3 = mod.addWine({ name: 'Wine 3', by_the_glass: false });
      expect(wine3.id).toBe(3);
    });
  });
});
