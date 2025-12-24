/**
 * @fileoverview Drinking window management endpoints.
 * @module routes/drinkingWindows
 */

import { Router } from 'express';
import db from '../db/index.js';
import logger from '../utils/logger.js';
import { getDefaultDrinkingWindow } from '../services/windowDefaults.js';

const router = Router();

/**
 * Get all drinking windows for a wine.
 * @route GET /api/wines/:wine_id/drinking-windows
 */
router.get('/wines/:wine_id/drinking-windows', (req, res) => {
  try {
    const { wine_id } = req.params;
    const windows = db.prepare(`
      SELECT * FROM drinking_windows
      WHERE wine_id = ?
      ORDER BY
        CASE source
          WHEN 'manual' THEN 0
          ELSE 1
        END,
        updated_at DESC
    `).all(wine_id);

    // If no windows exist, try to get a default estimate
    if (windows.length === 0) {
      const wine = db.prepare('SELECT * FROM wines WHERE id = ?').get(wine_id);
      if (wine && wine.vintage) {
        const defaultWindow = getDefaultDrinkingWindow(wine, parseInt(wine.vintage));
        if (defaultWindow) {
          windows.push({
            wine_id: parseInt(wine_id),
            source: defaultWindow.source,
            drink_from_year: defaultWindow.drink_from,
            drink_by_year: defaultWindow.drink_by,
            peak_year: defaultWindow.peak,
            confidence: defaultWindow.confidence,
            raw_text: defaultWindow.notes,
            is_default: true
          });
        }
      }
    }

    res.json(windows);
  } catch (error) {
    logger.error('DrinkingWindows', `Failed to get windows: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Add or update a drinking window (upsert by source).
 * @route POST /api/wines/:wine_id/drinking-windows
 */
router.post('/wines/:wine_id/drinking-windows', (req, res) => {
  try {
    const { wine_id } = req.params;
    const { source, drink_from_year, drink_by_year, peak_year, confidence, raw_text } = req.body;

    if (!source) {
      return res.status(400).json({ error: 'source is required' });
    }

    db.prepare(`
      INSERT INTO drinking_windows (wine_id, source, drink_from_year, drink_by_year, peak_year, confidence, raw_text, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(wine_id, source) DO UPDATE SET
        drink_from_year = excluded.drink_from_year,
        drink_by_year = excluded.drink_by_year,
        peak_year = excluded.peak_year,
        confidence = excluded.confidence,
        raw_text = excluded.raw_text,
        updated_at = CURRENT_TIMESTAMP
    `).run(wine_id, source, drink_from_year || null, drink_by_year || null, peak_year || null, confidence || 'medium', raw_text || null);

    logger.info('DrinkingWindows', `Saved window for wine ${wine_id} from ${source}`);
    res.json({ success: true });
  } catch (error) {
    logger.error('DrinkingWindows', `Failed to save window: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete a drinking window by source.
 * @route DELETE /api/wines/:wine_id/drinking-windows/:source
 */
router.delete('/wines/:wine_id/drinking-windows/:source', (req, res) => {
  try {
    const { wine_id, source } = req.params;
    const result = db.prepare('DELETE FROM drinking_windows WHERE wine_id = ? AND source = ?').run(wine_id, source);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Window not found' });
    }

    logger.info('DrinkingWindows', `Deleted window for wine ${wine_id} from ${source}`);
    res.json({ success: true });
  } catch (error) {
    logger.error('DrinkingWindows', `Failed to delete window: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get wines with urgent drinking windows.
 * @route GET /api/drinking-windows/urgent
 */
router.get('/drinking-windows/urgent', (req, res) => {
  try {
    const urgencyMonths = parseInt(req.query.months) || 12;
    const currentYear = new Date().getFullYear();
    const urgencyYear = currentYear + Math.ceil(urgencyMonths / 12);

    const urgent = db.prepare(`
      SELECT
        w.id, w.wine_name, w.vintage, w.style, w.colour,
        COUNT(s.id) as bottle_count,
        GROUP_CONCAT(DISTINCT s.location_code) as locations,
        dw.drink_from_year, dw.drink_by_year, dw.peak_year, dw.source as window_source,
        (dw.drink_by_year - ?) as years_remaining
      FROM wines w
      JOIN drinking_windows dw ON w.id = dw.wine_id
      LEFT JOIN slots s ON s.wine_id = w.id
      WHERE dw.drink_by_year IS NOT NULL
        AND dw.drink_by_year <= ?
      GROUP BY w.id, dw.id
      HAVING bottle_count > 0
      ORDER BY dw.drink_by_year ASC
    `).all(currentYear, urgencyYear);

    res.json(urgent);
  } catch (error) {
    logger.error('DrinkingWindows', `Failed to get urgent wines: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get the best drinking window for a wine (respecting source priority).
 * @route GET /api/wines/:wine_id/drinking-window/best
 */
router.get('/wines/:wine_id/drinking-window/best', (req, res) => {
  try {
    const { wine_id } = req.params;

    // Get source priority from settings
    const prioritySetting = db.prepare("SELECT value FROM user_settings WHERE key = 'reduce_window_source_priority'").get();
    let sourcePriority = ['manual', 'halliday', 'wine_spectator', 'decanter', 'vivino'];

    if (prioritySetting?.value) {
      try {
        sourcePriority = JSON.parse(prioritySetting.value);
      } catch (_e) {
        // Use default
      }
    }

    // Get all windows for this wine
    const windows = db.prepare('SELECT * FROM drinking_windows WHERE wine_id = ?').all(wine_id);

    if (windows.length === 0) {
      // No explicit windows - try to get default based on wine characteristics
      const wine = db.prepare('SELECT * FROM wines WHERE id = ?').get(wine_id);
      if (wine && wine.vintage) {
        const defaultWindow = getDefaultDrinkingWindow(wine, parseInt(wine.vintage));
        if (defaultWindow) {
          return res.json({
            wine_id: parseInt(wine_id),
            source: defaultWindow.source,
            drink_from_year: defaultWindow.drink_from,
            drink_by_year: defaultWindow.drink_by,
            peak_year: defaultWindow.peak,
            confidence: defaultWindow.confidence,
            raw_text: defaultWindow.notes,
            is_default: true
          });
        }
      }
      return res.json(null);
    }

    // Sort by priority
    windows.sort((a, b) => {
      const aIndex = sourcePriority.indexOf(a.source);
      const bIndex = sourcePriority.indexOf(b.source);
      // Unknown sources go to end
      const aPriority = aIndex === -1 ? 999 : aIndex;
      const bPriority = bIndex === -1 ? 999 : bIndex;
      return aPriority - bPriority;
    });

    res.json(windows[0]);
  } catch (error) {
    logger.error('DrinkingWindows', `Failed to get best window: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

export default router;
