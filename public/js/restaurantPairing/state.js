/**
 * @fileoverview Restaurant pairing wizard state with sessionStorage persistence.
 * Uses `wineapp.restaurant.*` namespaced keys to prevent collisions.
 * @module restaurantPairing/state
 */

// --- SessionStorage Keys ---

const KEYS = {
  step:       'wineapp.restaurant.step',
  wines:      'wineapp.restaurant.wines',
  dishes:     'wineapp.restaurant.dishes',
  selections: 'wineapp.restaurant.selections',
  results:    'wineapp.restaurant.results',
  chatId:     'wineapp.restaurant.chatId'
};

// --- Defaults ---

const DEFAULT_STATE = {
  step: 1,
  wines: [],
  dishes: [],
  selections: { wines: {}, dishes: {} },
  results: null,
  chatId: null
};

// --- Internal Helpers ---

/**
 * Read a JSON value from sessionStorage, returning fallback on miss/error.
 * Validates shape: arrays must be arrays, objects must be plain objects,
 * numbers must be numbers.
 * @param {string} key - Storage key
 * @param {*} fallback - Default value
 * @returns {*}
 */
function load(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    // Shape guards: parsed type must match fallback type
    if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
    if (typeof fallback === 'number' && typeof parsed !== 'number') return fallback;
    if (typeof fallback === 'object' && fallback !== null && !Array.isArray(fallback)) {
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fallback;
    }
    return parsed;
  } catch {
    return fallback;
  }
}

/**
 * Write a JSON value to sessionStorage.
 * @param {string} key - Storage key
 * @param {*} value - Value to persist
 */
function save(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch { /* quota exceeded — non-critical */ }
}

/**
 * Normalize a name for dedup comparison.
 * Lowercases, strips diacritics, collapses whitespace.
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenize a name for Jaccard similarity.
 * @param {string} name
 * @returns {Set<string>}
 */
function tokenize(name) {
  const normalized = normalizeName(name);
  return new Set(normalized.split(' ').filter(Boolean));
}

/**
 * Jaccard similarity between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number} 0-1 similarity score
 */
function jaccardSimilarity(a, b) {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return intersection / union;
}

/**
 * Build composite key for wine dedup.
 * @param {Object} wine
 * @returns {string}
 */
function wineKey(wine) {
  const name = normalizeName(wine.name);
  const vintage = wine.vintage ?? '';
  const glass = wine.by_the_glass ? '1' : '0';
  return `${name}|${vintage}|${glass}`;
}

/**
 * Build composite key for dish dedup.
 * @param {Object} dish
 * @returns {string}
 */
function dishKey(dish) {
  return normalizeName(dish.name);
}

// --- Module State (in-memory, synced to sessionStorage) ---

const state = {
  step:       Math.max(1, Math.min(4, load(KEYS.step, DEFAULT_STATE.step))),
  wines:      load(KEYS.wines, DEFAULT_STATE.wines),
  dishes:     load(KEYS.dishes, DEFAULT_STATE.dishes),
  selections: load(KEYS.selections, DEFAULT_STATE.selections),
  results:    load(KEYS.results, DEFAULT_STATE.results),
  chatId:     load(KEYS.chatId, DEFAULT_STATE.chatId)
};

// --- Next ID tracking ---

let nextWineId = state.wines.reduce((max, w) => Math.max(max, w.id ?? 0), 0) + 1;
let nextDishId = state.dishes.reduce((max, d) => Math.max(max, d.id ?? 0), 0) + 1;

// --- Step ---

/**
 * Get current wizard step (1-4).
 * @returns {number}
 */
export function getStep() {
  return state.step;
}

/**
 * Set wizard step and persist. Clamped to 1-4.
 * @param {number} step - Step number (1-4)
 */
export function setStep(step) {
  state.step = Math.max(1, Math.min(4, Number(step) || 1));
  save(KEYS.step, state.step);
}

// --- Wines ---

/**
 * Get all parsed wines.
 * @returns {Array<Object>}
 */
export function getWines() {
  return state.wines;
}

/**
 * Merge parsed wine items into state, deduplicating by composite key.
 * Composite key: normalize(name) + vintage + by_the_glass.
 * Secondary fuzzy: Jaccard(name) > 0.7 AND same vintage.
 * Keeps both if prices differ >20%; merges if within 10%.
 * @param {Array<Object>} newItems - Parsed wine items from API
 * @returns {Array<Object>} Updated wines array
 */
export function mergeWines(newItems) {
  const existing = [...state.wines];
  const existingKeys = new Map();
  for (const wine of existing) {
    existingKeys.set(wineKey(wine), wine);
  }

  for (const raw of newItems) {
    const item = { ...raw }; // Clone to avoid mutating caller's objects
    const key = wineKey(item);

    // Exact composite key match
    if (existingKeys.has(key)) {
      const match = existingKeys.get(key);
      // If prices differ >20%, keep both (different list sections)
      if (match.price != null && item.price != null) {
        const ratio = Math.abs(match.price - item.price) / Math.max(match.price, item.price);
        if (ratio > 0.2) {
          // Different price point — add as separate entry
          item.id = nextWineId++;
          existing.push(item);
          state.selections.wines[item.id] = true;
          continue;
        }
      }
      // Merge: prefer higher confidence, fill nulls
      if (item.confidence === 'high' && match.confidence !== 'high') {
        Object.assign(match, item, { id: match.id });
      } else {
        for (const [k, v] of Object.entries(item)) {
          if (k !== 'id' && match[k] == null && v != null) {
            match[k] = v;
          }
        }
      }
      continue;
    }

    // Secondary fuzzy: Jaccard > 0.7 AND same vintage
    let fuzzyMerged = false;
    for (const wine of existing) {
      if ((wine.vintage ?? '') === (item.vintage ?? '') &&
          (wine.by_the_glass === item.by_the_glass) &&
          jaccardSimilarity(wine.name, item.name) > 0.7) {
        // Price divergence check
        if (wine.price != null && item.price != null) {
          const ratio = Math.abs(wine.price - item.price) / Math.max(wine.price, item.price);
          if (ratio > 0.2) continue; // Keep both
        }
        // Merge into existing
        for (const [k, v] of Object.entries(item)) {
          if (k !== 'id' && wine[k] == null && v != null) {
            wine[k] = v;
          }
        }
        fuzzyMerged = true;
        break;
      }
    }

    if (!fuzzyMerged) {
      item.id = nextWineId++;
      existing.push(item);
      state.selections.wines[item.id] = true;
    }
  }

  state.wines = existing;
  save(KEYS.wines, state.wines);
  save(KEYS.selections, state.selections);
  return state.wines;
}

/**
 * Add a manually entered wine.
 * @param {Object} wine - Wine data (name required)
 * @returns {Object} Wine with assigned id
 */
export function addWine(wine) {
  const entry = { ...wine, id: nextWineId++, confidence: 'high' };
  state.wines.push(entry);
  state.selections.wines[entry.id] = true;
  save(KEYS.wines, state.wines);
  save(KEYS.selections, state.selections);
  return entry;
}

/**
 * Remove a wine by id.
 * @param {number} id
 */
export function removeWine(id) {
  state.wines = state.wines.filter(w => w.id !== id);
  delete state.selections.wines[id];
  save(KEYS.wines, state.wines);
  save(KEYS.selections, state.selections);
}

// --- Dishes ---

/**
 * Get all parsed dishes.
 * @returns {Array<Object>}
 */
export function getDishes() {
  return state.dishes;
}

/**
 * Merge parsed dish items into state, deduplicating by normalized name.
 * @param {Array<Object>} newItems - Parsed dish items from API
 * @returns {Array<Object>} Updated dishes array
 */
export function mergeDishes(newItems) {
  const existing = [...state.dishes];
  const existingKeys = new Set(existing.map(dishKey));

  for (const raw of newItems) {
    const key = dishKey(raw);
    if (existingKeys.has(key)) {
      // Already exists — skip
      continue;
    }

    const item = { ...raw }; // Clone to avoid mutating caller's objects
    item.id = nextDishId++;
    existing.push(item);
    existingKeys.add(key);
    state.selections.dishes[item.id] = true;
  }

  state.dishes = existing;
  save(KEYS.dishes, state.dishes);
  save(KEYS.selections, state.selections);
  return state.dishes;
}

/**
 * Add a manually entered dish.
 * @param {Object} dish - Dish data (name required)
 * @returns {Object} Dish with assigned id
 */
export function addDish(dish) {
  const entry = { ...dish, id: nextDishId++, confidence: 'high' };
  state.dishes.push(entry);
  state.selections.dishes[entry.id] = true;
  save(KEYS.dishes, state.dishes);
  save(KEYS.selections, state.selections);
  return entry;
}

/**
 * Remove a dish by id.
 * @param {number} id
 */
export function removeDish(id) {
  state.dishes = state.dishes.filter(d => d.id !== id);
  delete state.selections.dishes[id];
  save(KEYS.dishes, state.dishes);
  save(KEYS.selections, state.selections);
}

// --- Selections ---

/**
 * Get selection state for all wines/dishes.
 * @returns {{wines: Object<number, boolean>, dishes: Object<number, boolean>}}
 */
export function getSelections() {
  return state.selections;
}

/**
 * Toggle wine selection.
 * @param {number} id - Wine id
 * @param {boolean} selected
 */
export function setWineSelected(id, selected) {
  state.selections.wines[id] = selected;
  save(KEYS.selections, state.selections);
}

/**
 * Toggle dish selection.
 * @param {number} id - Dish id
 * @param {boolean} selected
 */
export function setDishSelected(id, selected) {
  state.selections.dishes[id] = selected;
  save(KEYS.selections, state.selections);
}

/**
 * Get selected wines (checked AND optionally filtered).
 * @returns {Array<Object>}
 */
export function getSelectedWines() {
  return state.wines.filter(w => state.selections.wines[w.id]);
}

/**
 * Get selected dishes.
 * @returns {Array<Object>}
 */
export function getSelectedDishes() {
  return state.dishes.filter(d => state.selections.dishes[d.id]);
}

/**
 * Select all wines matching a filter predicate.
 * @param {Function} [predicate] - Filter function, defaults to all
 */
export function selectAllWines(predicate) {
  for (const wine of state.wines) {
    if (!predicate || predicate(wine)) {
      state.selections.wines[wine.id] = true;
    }
  }
  save(KEYS.selections, state.selections);
}

/**
 * Deselect all wines matching a filter predicate.
 * @param {Function} [predicate] - Filter function, defaults to all
 */
export function deselectAllWines(predicate) {
  for (const wine of state.wines) {
    if (!predicate || predicate(wine)) {
      state.selections.wines[wine.id] = false;
    }
  }
  save(KEYS.selections, state.selections);
}

// --- Results ---

/**
 * Get pairing results.
 * @returns {Object|null}
 */
export function getResults() {
  return state.results;
}

/**
 * Set pairing results and persist.
 * @param {Object|null} results
 */
export function setResults(results) {
  state.results = results;
  save(KEYS.results, results);
}

/**
 * Get chat ID.
 * @returns {string|null}
 */
export function getChatId() {
  return state.chatId;
}

/**
 * Set chat ID and persist.
 * @param {string|null} chatId
 */
export function setChatId(chatId) {
  state.chatId = chatId;
  save(KEYS.chatId, chatId);
}

// --- Reset ---

/**
 * Check if wizard has any parsed data (for "Start Over" confirm).
 * @returns {boolean}
 */
export function hasData() {
  return state.wines.length > 0 || state.dishes.length > 0;
}

/**
 * Clear all restaurant pairing state from memory and sessionStorage.
 */
export function clearState() {
  state.step = DEFAULT_STATE.step;
  state.wines = [];
  state.dishes = [];
  state.selections = { wines: {}, dishes: {} };
  state.results = null;
  state.chatId = null;
  nextWineId = 1;
  nextDishId = 1;

  try {
    for (const key of Object.values(KEYS)) {
      sessionStorage.removeItem(key);
    }
  } catch { /* storage unavailable — non-critical */ }
}
