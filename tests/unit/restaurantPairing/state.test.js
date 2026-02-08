/**
 * @fileoverview Unit tests for restaurant pairing state module.
 * Tests dedup/merge logic, sessionStorage persistence, and edge cases.
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

const MODULE_PATH = '../../../public/js/restaurantPairing/state.js';

/** Fresh import of state module (resets module-level state). */
async function freshImport() {
  vi.resetModules();
  return import(MODULE_PATH);
}

describe('Restaurant Pairing State', () => {
  let mod;

  beforeEach(async () => {
    storage.clear();
    mod = await freshImport();
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

    it('restores step from sessionStorage', async () => {
      storage.set('wineapp.restaurant.step', '3');
      const mod2 = await freshImport();
      expect(mod2.getStep()).toBe(3);
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
  // Corrupted sessionStorage (Finding 1)
  // =========================================================================

  describe('corrupted sessionStorage recovery', () => {
    it('recovers when wines is stored as an object instead of array', async () => {
      storage.set('wineapp.restaurant.wines', '{"not": "an array"}');
      const mod2 = await freshImport();
      expect(mod2.getWines()).toEqual([]);
    });

    it('recovers when wines is stored as a string', async () => {
      storage.set('wineapp.restaurant.wines', '"just a string"');
      const mod2 = await freshImport();
      expect(mod2.getWines()).toEqual([]);
    });

    it('recovers when wines is stored as null JSON', async () => {
      storage.set('wineapp.restaurant.wines', 'null');
      const mod2 = await freshImport();
      expect(mod2.getWines()).toEqual([]);
    });

    it('recovers when storage contains invalid JSON', async () => {
      storage.set('wineapp.restaurant.wines', '{broken json!!!');
      const mod2 = await freshImport();
      expect(mod2.getWines()).toEqual([]);
    });

    it('recovers when dishes is stored as non-array', async () => {
      storage.set('wineapp.restaurant.dishes', '42');
      const mod2 = await freshImport();
      expect(mod2.getDishes()).toEqual([]);
    });

    it('recovers when selections is stored as a string', async () => {
      storage.set('wineapp.restaurant.selections', '"bad"');
      const mod2 = await freshImport();
      // selections should fall back to default object shape
      const sel = mod2.getSelections();
      expect(sel).toEqual({ wines: {}, dishes: {} });
      // setWineSelected must not crash
      mod2.addWine({ name: 'Test', by_the_glass: false });
      expect(() => mod2.setWineSelected(1, true)).not.toThrow();
    });

    it('recovers when selections is stored as an array', async () => {
      storage.set('wineapp.restaurant.selections', '[1,2,3]');
      const mod2 = await freshImport();
      expect(mod2.getSelections()).toEqual({ wines: {}, dishes: {} });
    });

    it('recovers when selections is stored as null', async () => {
      storage.set('wineapp.restaurant.selections', 'null');
      const mod2 = await freshImport();
      expect(mod2.getSelections()).toEqual({ wines: {}, dishes: {} });
    });

    it('recovers when step is stored as a string', async () => {
      storage.set('wineapp.restaurant.step', '"banana"');
      const mod2 = await freshImport();
      expect(mod2.getStep()).toBe(1);
    });

    it('recovers when step is stored as an object', async () => {
      storage.set('wineapp.restaurant.step', '{"bad": true}');
      const mod2 = await freshImport();
      expect(mod2.getStep()).toBe(1);
    });

    it('clamps out-of-range step from storage', async () => {
      storage.set('wineapp.restaurant.step', '999');
      const mod2 = await freshImport();
      expect(mod2.getStep()).toBe(4);
    });

    it('recovers when results is stored as invalid JSON', async () => {
      storage.set('wineapp.restaurant.results', '{broken!!!');
      const mod2 = await freshImport();
      expect(mod2.getResults()).toBeNull();
    });

    it('recovers when chatId is stored as invalid JSON', async () => {
      storage.set('wineapp.restaurant.chatId', '{broken!!!');
      const mod2 = await freshImport();
      expect(mod2.getChatId()).toBeNull();
    });
  });

  // =========================================================================
  // Persistence across reloads
  // =========================================================================

  describe('persistence across reloads', () => {
    it('restores wines from sessionStorage', async () => {
      mod.mergeWines([
        { name: 'Preserved Wine', vintage: 2020, by_the_glass: false, confidence: 'high' }
      ]);

      const mod2 = await freshImport();
      expect(mod2.getWines()).toHaveLength(1);
      expect(mod2.getWines()[0].name).toBe('Preserved Wine');
    });

    it('restores selections from sessionStorage', async () => {
      mod.mergeWines([
        { name: 'Wine A', vintage: 2020, by_the_glass: false, confidence: 'high' },
        { name: 'Wine B', vintage: 2021, by_the_glass: false, confidence: 'high' }
      ]);
      mod.setWineSelected(2, false);

      const mod2 = await freshImport();
      expect(mod2.getSelectedWines()).toHaveLength(1);
    });

    it('continues ID sequence after reload', async () => {
      mod.addWine({ name: 'Wine 1', by_the_glass: false });
      mod.addWine({ name: 'Wine 2', by_the_glass: false });

      const mod2 = await freshImport();
      const wine3 = mod2.addWine({ name: 'Wine 3', by_the_glass: false });
      expect(wine3.id).toBe(3);
    });
  });
});
