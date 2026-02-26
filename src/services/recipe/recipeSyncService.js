/**
 * @fileoverview Recipe sync orchestration for Paprika and Mealie.
 * @module services/recipe/recipeSyncService
 */

import { createHash } from 'node:crypto';
import db from '../../db/index.js';
import { decrypt } from '../shared/encryption.js';
import { ensureRecipeTables } from './recipeService.js';
import logger from '../../utils/logger.js';

/**
 * Trigger a sync for a provider.
 * @param {string} cellarId - Cellar ID
 * @param {string} provider - 'paprika' or 'mealie'
 * @returns {Promise<Object>}
 */
export async function triggerSync(cellarId, provider) {
  await ensureRecipeTables();

  // Get credentials
  const cred = await db.prepare(`
    SELECT username_encrypted, password_encrypted
    FROM source_credentials
    WHERE cellar_id = $1 AND source_id = $2
  `).get(cellarId, provider);

  if (!cred) {
    return { error: `No ${provider} credentials configured. Add them in Settings.` };
  }

  const username = decrypt(cred.username_encrypted);
  const password = decrypt(cred.password_encrypted);

  if (!username || !password) {
    return { error: 'Failed to decrypt credentials' };
  }

  // Create sync log entry
  const logEntry = await db.prepare(`
    INSERT INTO recipe_sync_log (cellar_id, source_provider, status)
    VALUES ($1, $2, 'running')
    RETURNING id
  `).get(cellarId, provider);

  const logId = logEntry?.id;

  try {
    let result;
    if (provider === 'paprika') {
      result = await syncPaprika(cellarId, username, password);
    } else if (provider === 'mealie') {
      result = await syncMealie(cellarId, username, password);
    } else {
      throw new Error(`Unknown provider: ${provider}`);
    }

    // Update sync log
    if (logId) {
      await db.prepare(`
        UPDATE recipe_sync_log SET
          status = 'success',
          completed_at = NOW(),
          added = $2, updated = $3, deleted = $4, unchanged = $5
        WHERE id = $1
      `).run(logId, result.added, result.updated, result.deleted, result.unchanged);
    }

    logger.info('RecipeSync', `${provider} sync complete: +${result.added} ~${result.updated} -${result.deleted}`);
    return { success: true, ...result };

  } catch (err) {
    logger.error('RecipeSync', `${provider} sync failed: ${err.message}`);

    if (logId) {
      await db.prepare(`
        UPDATE recipe_sync_log SET
          status = 'failed',
          completed_at = NOW(),
          error_message = $2
        WHERE id = $1
      `).run(logId, err.message);
    }

    return { error: err.message };
  }
}

/**
 * Get sync status for a provider.
 * @param {string} cellarId - Cellar ID
 * @param {string} provider - Provider name
 * @returns {Promise<Object>}
 */
export async function getSyncStatus(cellarId, provider) {
  await ensureRecipeTables();

  const lastSync = await db.prepare(`
    SELECT * FROM recipe_sync_log
    WHERE cellar_id = $1 AND source_provider = $2
    ORDER BY started_at DESC LIMIT 1
  `).get(cellarId, provider);

  const recipeCount = await db.prepare(`
    SELECT COUNT(*) as count FROM recipes
    WHERE cellar_id = $1 AND source_provider = $2 AND deleted_at IS NULL
  `).get(cellarId, provider);

  return {
    provider,
    last_sync: lastSync || null,
    recipe_count: recipeCount?.count || 0
  };
}

/**
 * Sync recipes from Paprika cloud API.
 * @param {string} cellarId - Cellar ID
 * @param {string} email - Paprika account email
 * @param {string} password - Paprika account password
 * @returns {Promise<{added: number, updated: number, deleted: number, unchanged: number}>}
 */
async function syncPaprika(cellarId, email, password) {
  const BASE = 'https://www.paprikaapp.com/api/v1';

  // Authenticate
  const authRes = await fetch(`${BASE}/sync/recipes/`, {
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${email}:${password}`).toString('base64')
    },
    signal: AbortSignal.timeout(30000)
  });

  if (!authRes.ok) {
    if (authRes.status === 401) throw new Error('Invalid Paprika credentials');
    throw new Error(`Paprika API error: ${authRes.status}`);
  }

  const recipeList = await authRes.json();
  const remoteRecipes = recipeList.result || recipeList;

  if (!Array.isArray(remoteRecipes)) {
    throw new Error('Unexpected Paprika API response');
  }

  // Get existing sync state
  const existingState = await db.prepare(`
    SELECT source_recipe_id, source_hash FROM recipe_sync_state
    WHERE cellar_id = $1 AND source_provider = 'paprika'
  `).all(cellarId);

  const stateMap = new Map(existingState.map(s => [s.source_recipe_id, s.source_hash]));

  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const remote of remoteRecipes) {
    const uid = remote.uid;
    const hash = remote.hash;

    if (stateMap.has(uid) && stateMap.get(uid) === hash) {
      // Update last_seen_at only
      await db.prepare(`
        UPDATE recipe_sync_state SET last_seen_at = NOW()
        WHERE cellar_id = $1 AND source_provider = 'paprika' AND source_recipe_id = $2
      `).run(cellarId, uid);
      unchanged++;
      continue;
    }

    // Fetch full recipe
    const recipeRes = await fetch(`${BASE}/sync/recipe/${uid}/`, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${email}:${password}`).toString('base64')
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!recipeRes.ok) continue;

    const recipeData = await recipeRes.json();
    const raw = recipeData.result || recipeData;

    // Import via adapter
    const { parseRecipes } = await import('./adapters/paprikaAdapter.js');
    // Create a minimal zip-like structure for a single recipe
    const recipe = mapPaprikaApiRecipe(raw);
    if (!recipe) continue;

    const { importRecipes } = await import('./recipeService.js');
    const result = await importRecipes([recipe], cellarId);

    if (result.added > 0) added++;
    else if (result.updated > 0) updated++;

    // Update sync state
    await db.prepare(`
      INSERT INTO recipe_sync_state (cellar_id, source_provider, source_recipe_id, source_hash, last_seen_at)
      VALUES ($1, 'paprika', $2, $3, NOW())
      ON CONFLICT (cellar_id, source_provider, source_recipe_id) DO UPDATE SET
        source_hash = $3, last_seen_at = NOW()
    `).run(cellarId, uid, hash);
  }

  // Detect deletions: recipes not seen for 3+ syncs
  const deleted = await detectDeletions(cellarId, 'paprika');

  return { added, updated, deleted, unchanged };
}

/**
 * Parse categories from various formats (string, array, object).
 * @param {*} cats - Raw categories value
 * @returns {string[]}
 */
function parseFlexibleCategories(cats) {
  if (!cats) return [];
  if (Array.isArray(cats)) return cats.map(c => typeof c === 'string' ? c.trim() : String(c)).filter(Boolean);
  if (typeof cats === 'string') return cats.split(/[\n,]/).map(c => c.trim()).filter(Boolean);
  if (typeof cats === 'object') return Object.values(cats).map(c => String(c).trim()).filter(Boolean);
  return [];
}

/**
 * Map a Paprika API recipe (non-zipped) to RecipeInput.
 * @param {Object} raw - Raw Paprika recipe from API
 * @returns {import('./adapters/adapterInterface.js').RecipeInput|null}
 */
function mapPaprikaApiRecipe(raw) {
  if (!raw?.name) return null;

  const hashContent = `${raw.name}|${raw.ingredients || ''}|${raw.directions || ''}`;
  const sourceHash = createHash('sha256').update(hashContent).digest('hex').slice(0, 16);

  return {
    name: raw.name,
    ingredients: raw.ingredients || null,
    directions: raw.directions || null,
    categories: parseFlexibleCategories(raw.categories),
    rating: raw.rating ? Math.max(0, Math.min(5, Math.round(Number(raw.rating)))) : 0,
    cook_time: raw.cook_time || null,
    prep_time: raw.prep_time || null,
    total_time: raw.total_time || null,
    servings: raw.servings || null,
    source: raw.source || null,
    source_url: raw.source_url || null,
    notes: raw.notes || null,
    image_url: raw.image_url || null,
    source_provider: 'paprika',
    source_recipe_id: raw.uid || null,
    source_hash: sourceHash
  };
}


/**
 * Sync recipes from Mealie API.
 * @param {string} cellarId - Cellar ID
 * @param {string} instanceUrl - Mealie instance URL
 * @param {string} token - Mealie API token
 * @returns {Promise<{added: number, updated: number, deleted: number, unchanged: number}>}
 */
async function syncMealie(cellarId, instanceUrl, token) {
  const base = instanceUrl.replace(/\/$/, '');

  // Fetch recipe list (paginated)
  let page = 1;
  const allRecipes = [];

  while (true) {
    const res = await fetch(`${base}/api/recipes?page=${page}&perPage=50`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(30000)
    });

    if (!res.ok) {
      if (res.status === 401) throw new Error('Invalid Mealie credentials');
      throw new Error(`Mealie API error: ${res.status}`);
    }

    const data = await res.json();
    const items = data.items || data;
    if (!Array.isArray(items) || items.length === 0) break;

    allRecipes.push(...items);
    if (items.length < 50) break;
    page++;
  }

  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const item of allRecipes) {
    const slug = item.slug || item.id;
    if (!slug) continue;

    // Fetch full recipe detail
    const detailRes = await fetch(`${base}/api/recipes/${slug}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!detailRes.ok) continue;
    const detail = await detailRes.json();

    const recipe = mapMealieRecipe(detail);
    if (!recipe) continue;

    // Check sync state for hash
    const existing = await db.prepare(`
      SELECT source_hash FROM recipe_sync_state
      WHERE cellar_id = $1 AND source_provider = 'mealie' AND source_recipe_id = $2
    `).get(cellarId, recipe.source_recipe_id);

    if (existing?.source_hash === recipe.source_hash) {
      await db.prepare(`
        UPDATE recipe_sync_state SET last_seen_at = NOW()
        WHERE cellar_id = $1 AND source_provider = 'mealie' AND source_recipe_id = $2
      `).run(cellarId, recipe.source_recipe_id);
      unchanged++;
      continue;
    }

    const { importRecipes } = await import('./recipeService.js');
    const result = await importRecipes([recipe], cellarId);

    if (result.added > 0) added++;
    else if (result.updated > 0) updated++;

    // Update sync state
    await db.prepare(`
      INSERT INTO recipe_sync_state (cellar_id, source_provider, source_recipe_id, source_hash, last_seen_at)
      VALUES ($1, 'mealie', $2, $3, NOW())
      ON CONFLICT (cellar_id, source_provider, source_recipe_id) DO UPDATE SET
        source_hash = $3, last_seen_at = NOW()
    `).run(cellarId, recipe.source_recipe_id, recipe.source_hash);
  }

  const deleted = await detectDeletions(cellarId, 'mealie');

  return { added, updated, deleted, unchanged };
}

/**
 * Map a Mealie recipe to RecipeInput.
 * @param {Object} detail - Full Mealie recipe detail
 * @returns {import('./adapters/adapterInterface.js').RecipeInput|null}
 */
function mapMealieRecipe(detail) {
  if (!detail?.name) return null;

  // Mealie has structured ingredients
  const ingredients = detail.recipeIngredient
    ? detail.recipeIngredient.map(i => {
      if (typeof i === 'string') return i;
      const parts = [i.quantity, i.unit?.name, i.food?.name, i.note].filter(Boolean);
      return parts.join(' ');
    }).join('\n')
    : null;

  const directions = detail.recipeInstructions
    ? detail.recipeInstructions.map(s => s.text || s.name || '').filter(Boolean).join('\n')
    : null;

  const hashContent = `${detail.name}|${ingredients || ''}`;
  const sourceHash = createHash('sha256').update(hashContent).digest('hex').slice(0, 16);

  return {
    name: detail.name,
    ingredients,
    directions,
    categories: detail.recipeCategory?.map(c => c.name || c) || detail.tags?.map(t => t.name || t) || [],
    rating: detail.rating ? Math.round(detail.rating) : 0,
    cook_time: detail.cookTime || null,
    prep_time: detail.prepTime || null,
    total_time: detail.totalTime || null,
    servings: detail.recipeYield || null,
    source: null,
    source_url: detail.orgURL || null,
    notes: detail.description || null,
    image_url: null,
    source_provider: 'mealie',
    source_recipe_id: detail.id || detail.slug,
    source_hash: sourceHash
  };
}

/**
 * Detect and soft-delete recipes not seen in recent syncs.
 * A recipe is deleted after not appearing in 3 consecutive syncs.
 * Note: the current sync's log is still 'running' when this function is called,
 * so we count both 'success' and 'running' statuses. The current run also
 * missed the recipe (it wasn't updated in last_seen_at above).
 * @param {string} cellarId - Cellar ID
 * @param {string} provider - Source provider
 * @returns {Promise<number>} Number of recipes soft-deleted
 */
async function detectDeletions(cellarId, provider) {
  // Find sync state entries not updated in this sync (last_seen_at older than latest log)
  const latestLog = await db.prepare(`
    SELECT started_at FROM recipe_sync_log
    WHERE cellar_id = $1 AND source_provider = $2
    ORDER BY started_at DESC LIMIT 1
  `).get(cellarId, provider);

  if (!latestLog) return 0;

  // Count consecutive missed syncs (include 'running' for the current sync)
  const staleEntries = await db.prepare(`
    SELECT rss.source_recipe_id FROM recipe_sync_state rss
    WHERE rss.cellar_id = $1 AND rss.source_provider = $2
      AND rss.last_seen_at < $3 - INTERVAL '1 minute'
      AND (
        SELECT COUNT(*) FROM recipe_sync_log rsl
        WHERE rsl.cellar_id = $1 AND rsl.source_provider = $2
          AND rsl.status IN ('success', 'running')
          AND rsl.started_at > rss.last_seen_at
      ) >= 3
  `).all(cellarId, provider, latestLog.started_at);

  let deleted = 0;
  for (const entry of staleEntries) {
    const result = await db.prepare(`
      UPDATE recipes SET deleted_at = NOW()
      WHERE cellar_id = $1 AND source_provider = $2 AND source_recipe_id = $3
        AND deleted_at IS NULL
    `).run(cellarId, provider, entry.source_recipe_id);

    if (result.changes > 0) deleted++;
  }

  return deleted;
}
