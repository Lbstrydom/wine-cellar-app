/**
 * @fileoverview Reduce-now list management.
 * @module routes/reduceNow
 */

import { Router } from 'express';
import db from '../db/index.js';
import { stringAgg, nullsLast } from '../db/helpers.js';
import { getDefaultDrinkingWindow, adjustForStorage, getStorageSettings } from '../services/wine/windowDefaults.js';
import { asyncHandler } from '../utils/errorResponse.js';

const router = Router();

/**
 * Get reduce-now list.
 * @route GET /api/reduce-now
 */
router.get('/', asyncHandler(async (req, res) => {
  // Safe: stringAgg() is a helper that returns SQL function call string
  const locationAgg = stringAgg('s.location_code');
  const sqlList = [
    'SELECT',
    '  rn.id,',
    '  rn.priority,',
    '  rn.reduce_reason,',
    '  w.id as wine_id,',
    '  w.style,',
    '  w.colour,',
    '  w.wine_name,',
    '  w.vintage,',
    '  w.vivino_rating,',
    '  COUNT(s.id) as bottle_count,',
    '  ' + locationAgg + ' as locations',
    'FROM reduce_now rn',
    'JOIN wines w ON w.id = rn.wine_id AND w.cellar_id = $1',
    'LEFT JOIN slots s ON s.wine_id = w.id',
    'GROUP BY rn.id, rn.priority, rn.reduce_reason, w.id, w.style, w.colour, w.wine_name, w.vintage, w.vivino_rating',
    'ORDER BY rn.priority, w.wine_name'
  ].join('\n');
  const list = await db.prepare(sqlList).all(req.cellarId);
  res.json(list);
}));

/**
 * Add wine to reduce-now list.
 * @route POST /api/reduce-now
 */
router.post('/', asyncHandler(async (req, res) => {
  const { wine_id, priority, reduce_reason } = req.body;

  // Validate wine belongs to this cellar
  const wine = await db.prepare('SELECT id FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wine_id);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  // PostgreSQL uses ON CONFLICT ... DO UPDATE
  await db.prepare(`
    INSERT INTO reduce_now (wine_id, priority, reduce_reason)
    VALUES ($1, $2, $3)
    ON CONFLICT(wine_id) DO UPDATE SET priority = EXCLUDED.priority, reduce_reason = EXCLUDED.reduce_reason
  `).run(wine_id, priority || 3, reduce_reason || null);

  res.json({ message: 'Added to reduce-now' });
}));

/**
 * Remove wine from reduce-now list.
 * @route DELETE /api/reduce-now/:wine_id
 */
router.delete('/:wine_id', asyncHandler(async (req, res) => {
  // Validate wine belongs to this cellar first
  const wine = await db.prepare('SELECT id FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, req.params.wine_id);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }

  await db.prepare('DELETE FROM reduce_now WHERE wine_id = $1').run(req.params.wine_id);
  res.json({ message: 'Removed from reduce-now' });
}));

/**
 * Evaluate wines against auto-rules and return candidates.
 * Uses drinking window data as primary signal, with age/rating as fallback.
 * Does NOT add them automatically - user must confirm.
 * @route POST /api/reduce-now/evaluate
 *
 * Optimized: Single query to fetch all candidate wines, then process in-memory
 */
router.post('/evaluate', asyncHandler(async (req, res) => {
  // Get current settings (scoped to cellar)
    const settings = {};
    const settingsRows = await db.prepare('SELECT key, value FROM user_settings WHERE cellar_id = $1').all(req.cellarId);
    for (const row of settingsRows) {
      settings[row.key] = row.value;
    }

    const rulesEnabled = settings.reduce_auto_rules_enabled === 'true';
    const urgencyMonths = parseInt(settings.reduce_window_urgency_months || '12', 10);
    const includeNoWindow = settings.reduce_include_no_window !== 'false';
    const ageThreshold = parseInt(settings.reduce_age_threshold || '10', 10);
    const ratingMinimum = parseFloat(settings.reduce_rating_minimum || '3.0');

    // Get storage settings for window adjustment
    const storageSettings = await getStorageSettings(req.cellarId);
    const storageEnabled = storageSettings.storage_adjustment_enabled === 'true';

    if (!rulesEnabled) {
      return res.json({
        enabled: false,
        message: 'Auto-rules are disabled',
        candidates: []
      });
    }

    const currentYear = new Date().getFullYear();
    const urgencyYear = currentYear + Math.ceil(urgencyMonths / 12);

    // Optimized: Single query to fetch ALL wines with bottles that aren't already in reduce_now
    // This replaces 5 separate queries with 1 comprehensive query
    // Safe: stringAgg() and nullsLast() are helpers that return SQL function call strings
    const locationAgg = stringAgg('s.location_code', ',', true);
    const orderByClause = nullsLast('dw.drink_by_year', 'ASC');
    const allSql = [
      'SELECT',
      '  w.id as wine_id, w.wine_name, w.vintage, w.style, w.colour,',
      '  w.purchase_stars, w.vivino_rating, w.country, w.grape,',
      '  (? - w.vintage) as wine_age,',
      '  dw.drink_by_year, dw.drink_from_year, dw.peak_year, dw.source as window_source,',
      '  COUNT(s.id) as bottle_count,',
      '  ' + locationAgg + ' as locations',
      'FROM wines w',
      'JOIN slots s ON s.wine_id = w.id',
      'LEFT JOIN drinking_windows dw ON w.id = dw.wine_id',
      'LEFT JOIN reduce_now rn ON rn.wine_id = w.id',
      'WHERE w.cellar_id = ?',
      '  AND rn.id IS NULL',
      'GROUP BY w.id, w.wine_name, w.vintage, w.style, w.colour, w.purchase_stars, w.vivino_rating, w.country, w.grape, dw.drink_by_year, dw.drink_from_year, dw.peak_year, dw.source',
      'HAVING COUNT(s.id) > 0',
      'ORDER BY ' + orderByClause + ', w.vintage ASC'
    ].join('\n');
    const allWines = await db.prepare(allSql).all(currentYear, req.cellarId);

    const candidates = [];
    const seenWineIds = new Set();

    // Process all wines in-memory instead of multiple queries
    for (const wine of allWines) {
      if (seenWineIds.has(wine.wine_id)) continue;

      // Has drinking window data
      if (wine.drink_by_year !== null) {
        // Apply storage adjustment if enabled
        let effectiveDrinkBy = wine.drink_by_year;
        let storageAdjusted = false;
        let storageNote = '';

        if (storageEnabled) {
          const adjusted = adjustForStorage(
            { drink_from: wine.drink_from_year, drink_by: wine.drink_by_year, peak: wine.peak_year },
            wine.vintage,
            storageSettings
          );
          if (adjusted.storage_adjusted) {
            effectiveDrinkBy = adjusted.drink_by;
            storageAdjusted = true;
            storageNote = ` (adjusted from ${wine.drink_by_year} for ${storageSettings.storage_temp_bucket} storage)`;
          }
          if (adjusted.heat_warning) {
            storageNote += ' ⚠️ Heat risk';
          }
        }

        // Priority 1: Past drinking window (critical)
        if (effectiveDrinkBy < currentYear) {
          seenWineIds.add(wine.wine_id);
          candidates.push({
            ...wine,
            priority: 1,
            suggested_reason: `Past drinking window (ended ${effectiveDrinkBy})${storageNote}`,
            suggested_priority: 1,
            urgency: 'critical',
            storage_adjusted: storageAdjusted,
            effective_drink_by: effectiveDrinkBy
          });
          continue;
        }

        // Priority 2: Within urgency threshold (closing soon)
        if (effectiveDrinkBy >= currentYear && effectiveDrinkBy <= urgencyYear) {
          seenWineIds.add(wine.wine_id);
          const yearsRemaining = effectiveDrinkBy - currentYear;
          candidates.push({
            ...wine,
            priority: 2,
            suggested_reason: yearsRemaining === 0
              ? `Final year of drinking window (${effectiveDrinkBy})${storageNote}`
              : `Drinking window closes ${effectiveDrinkBy} (${yearsRemaining} year${yearsRemaining > 1 ? 's' : ''} left)${storageNote}`,
            suggested_priority: yearsRemaining === 0 ? 1 : 2,
            urgency: yearsRemaining === 0 ? 'high' : 'medium',
            storage_adjusted: storageAdjusted,
            effective_drink_by: effectiveDrinkBy
          });
          continue;
        }
      }

      // Priority 3: At peak year
      if (wine.peak_year === currentYear) {
        seenWineIds.add(wine.wine_id);
        candidates.push({
          ...wine,
          priority: 3,
          suggested_reason: `At peak drinking year (${wine.peak_year})`,
          suggested_priority: 2,
          urgency: 'peak'
        });
        continue;
      }

      // Priority 4-6: No critic window data - try default matrix estimates
      if (includeNoWindow && wine.drink_by_year === null && wine.vintage !== null) {
        // Try to get a default window estimate
        let defaultWindow = await getDefaultDrinkingWindow(wine, wine.vintage);

        if (defaultWindow && defaultWindow.source !== 'colour_fallback') {
          // Apply storage adjustment to default window if enabled
          let storageAdjusted = false;
          let storageNote = '';

          if (storageEnabled) {
            const adjusted = adjustForStorage(defaultWindow, wine.vintage, storageSettings);
            if (adjusted.storage_adjusted) {
              storageAdjusted = true;
              storageNote = ` [${storageSettings.storage_temp_bucket} storage]`;
              defaultWindow = { ...defaultWindow, ...adjusted };
            }
            if (adjusted.heat_warning) {
              storageNote += ' ⚠️ Heat risk';
            }
          }

          const yearsRemaining = defaultWindow.drink_by - currentYear;

          if (yearsRemaining <= 0) {
            seenWineIds.add(wine.wine_id);
            candidates.push({
              ...wine,
              priority: 4,
              suggested_reason: `Estimated past drinking window (ended ${defaultWindow.drink_by})${storageNote} - ${defaultWindow.notes}`,
              suggested_priority: 2,
              drink_by_year: defaultWindow.drink_by,
              peak_year: defaultWindow.peak,
              window_source: defaultWindow.source,
              urgency: 'estimated_critical',
              confidence: defaultWindow.confidence,
              storage_adjusted: storageAdjusted
            });
            continue;
          } else if (yearsRemaining <= Math.ceil(urgencyMonths / 12)) {
            seenWineIds.add(wine.wine_id);
            candidates.push({
              ...wine,
              priority: 5,
              suggested_reason: `Estimated window closes ${defaultWindow.drink_by} (${yearsRemaining} year${yearsRemaining > 1 ? 's' : ''} left)${storageNote} - ${defaultWindow.notes}`,
              suggested_priority: 3,
              drink_by_year: defaultWindow.drink_by,
              peak_year: defaultWindow.peak,
              window_source: defaultWindow.source,
              urgency: 'estimated_medium',
              confidence: defaultWindow.confidence,
              storage_adjusted: storageAdjusted
            });
            continue;
          } else if (defaultWindow.peak && defaultWindow.peak === currentYear) {
            seenWineIds.add(wine.wine_id);
            candidates.push({
              ...wine,
              priority: 5,
              suggested_reason: `Estimated peak year (${defaultWindow.peak})${storageNote} - ${defaultWindow.notes}`,
              suggested_priority: 3,
              drink_by_year: defaultWindow.drink_by,
              peak_year: defaultWindow.peak,
              window_source: defaultWindow.source,
              urgency: 'estimated_peak',
              confidence: defaultWindow.confidence,
              storage_adjusted: storageAdjusted
            });
            continue;
          }
        } else {
          // No specific match or only colour fallback - use age threshold
          if (wine.wine_age >= ageThreshold) {
            seenWineIds.add(wine.wine_id);
            candidates.push({
              ...wine,
              priority: 6,
              suggested_reason: `Unknown wine type; vintage ${wine.vintage} is ${wine.wine_age} years old`,
              suggested_priority: 4,
              needs_window_data: true,
              urgency: 'unknown'
            });
            continue;
          }
        }
      }

      // Priority 7: Low rating (kept as final check)
      const rating = wine.purchase_stars || wine.vivino_rating;
      if (rating !== null && rating < ratingMinimum) {
        seenWineIds.add(wine.wine_id);
        candidates.push({
          ...wine,
          priority: 7,
          suggested_reason: `Low rating (${rating?.toFixed(1)} stars) - consider drinking soon`,
          suggested_priority: 4,
          urgency: 'low'
        });
      }
    }

    // Sort candidates by priority
    candidates.sort((a, b) => a.priority - b.priority || (a.drink_by_year || 9999) - (b.drink_by_year || 9999));

    res.json({
      enabled: true,
      candidates,
      settings_used: {
        urgency_months: urgencyMonths,
        include_no_window: includeNoWindow,
        age_threshold: ageThreshold,
        rating_minimum: ratingMinimum,
        storage_adjustment_enabled: storageEnabled,
        storage_temp_bucket: storageSettings.storage_temp_bucket || null,
        storage_heat_risk: storageSettings.storage_heat_risk === 'true'
      },
      summary: {
        total: candidates.length,
        critical: candidates.filter(c => c.urgency === 'critical').length,
        high: candidates.filter(c => c.urgency === 'high').length,
        medium: candidates.filter(c => c.urgency === 'medium').length,
        peak: candidates.filter(c => c.urgency === 'peak').length,
        estimated_critical: candidates.filter(c => c.urgency === 'estimated_critical').length,
        estimated_medium: candidates.filter(c => c.urgency === 'estimated_medium').length,
        estimated_peak: candidates.filter(c => c.urgency === 'estimated_peak').length,
        unknown: candidates.filter(c => c.urgency === 'unknown').length,
        low: candidates.filter(c => c.urgency === 'low').length,
        storage_adjusted: candidates.filter(c => c.storage_adjusted).length
      }
  });
}));

/**
 * Batch add wines to reduce-now from evaluation.
 * @route POST /api/reduce-now/batch
 */
router.post('/batch', asyncHandler(async (req, res) => {
  const { wine_ids, priority, reason_prefix } = req.body;

  if (!Array.isArray(wine_ids) || wine_ids.length === 0) {
    return res.status(400).json({ error: 'wine_ids array required' });
  }

  let added = 0;
  for (const wineId of wine_ids) {
    // Get wine info for reason and validate it belongs to cellar
    const wine = await db.prepare('SELECT wine_name, vintage FROM wines WHERE cellar_id = $1 AND id = $2').get(req.cellarId, wineId);
    if (wine) {
      const reason = reason_prefix ? `${reason_prefix}` : 'Auto-suggested';
      await db.prepare(`
        INSERT INTO reduce_now (wine_id, priority, reduce_reason)
        VALUES ($1, $2, $3)
        ON CONFLICT(wine_id) DO UPDATE SET priority = EXCLUDED.priority, reduce_reason = EXCLUDED.reduce_reason
      `).run(wineId, priority || 3, reason);
      added++;
    }
  }

  res.json({ message: `Added ${added} wines to reduce-now`, added });
}));

/**
 * Get AI-powered drink recommendations.
 * @route GET /api/reduce-now/ai-recommendations
 */
router.get('/ai-recommendations', asyncHandler(async (req, res) => {
  // Dynamic import to avoid issues if service not available
  const { generateDrinkRecommendations } = await import('../services/ai/drinkNowAI.js');

  const context = {};
  if (req.query.weather) context.weather = req.query.weather;
  if (req.query.occasion) context.occasion = req.query.occasion;
  if (req.query.food) context.food = req.query.food;

  const limit = parseInt(req.query.limit, 10) || 5;

  const recommendations = await generateDrinkRecommendations({
    limit,
    context: Object.keys(context).length > 0 ? context : null
  });

  res.json(recommendations);
}));

export default router;
