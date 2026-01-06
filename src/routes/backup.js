/**
 * @fileoverview Backup, export and import endpoints.
 * Supports JSON full backup and CSV wine list export.
 * @module routes/backup
 */

import { Router } from 'express';
import db from '../db/index.js';
import { stringAgg, isPostgres } from '../db/helpers.js';

const router = Router();

/**
 * Safely get count from a table that might not exist.
 * @param {string} sql - SQL count query
 * @returns {Promise<number>} Count or 0
 */
async function safeCount(sql) {
  try {
    const result = await db.prepare(sql).get();
    return result?.count || 0;
  } catch {
    return 0;
  }
}

/**
 * Safely run a delete statement on a table that might not exist.
 * @param {string} sql - SQL delete statement
 */
async function safeDelete(sql) {
  try {
    await db.prepare(sql).run();
  } catch {
    // Table doesn't exist, ignore
  }
}

/**
 * Get backup metadata (counts for UI display).
 * @route GET /api/backup/info
 */
router.get('/info', async (req, res) => {
  try {
    const info = {
      wines: await safeCount('SELECT COUNT(*) as count FROM wines'),
      slots: await safeCount('SELECT COUNT(*) as count FROM slots WHERE wine_id IS NOT NULL'),
      history: await safeCount('SELECT COUNT(*) as count FROM consumption_log'),
      ratings: await safeCount('SELECT COUNT(*) as count FROM wine_ratings'),
      lastBackup: null
    };
    res.json(info);
  } catch (error) {
    console.error('Backup info error:', error);
    res.status(500).json({ error: 'Failed to get backup info' });
  }
});

/**
 * Full JSON backup - all data.
 * @route GET /api/backup/export/json
 */
router.get('/export/json', async (req, res) => {
  try {
    const backup = {
      version: '1.0',
      appVersion: '1.0.0',
      exportedAt: new Date().toISOString(),
      data: {
        wines: await db.prepare('SELECT * FROM wines').all(),
        slots: await db.prepare('SELECT * FROM slots').all(),
        wine_ratings: await safeQuery('SELECT * FROM wine_ratings'),
        consumption_log: await safeQuery('SELECT * FROM consumption_log'),
        drinking_windows: await safeQuery('SELECT * FROM drinking_windows'),
        user_settings: await safeQuery('SELECT * FROM user_settings'),
        data_provenance: await safeQuery('SELECT * FROM data_provenance'),
        reduce_now: await safeQuery('SELECT * FROM reduce_now')
      }
    };

    const filename = `cellar-backup-${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(backup);
  } catch (error) {
    console.error('JSON export error:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

/**
 * CSV export - wine list with ratings.
 * @route GET /api/backup/export/csv
 */
router.get('/export/csv', async (req, res) => {
  try {
    const wines = await db.prepare(`
      SELECT
        w.id,
        w.wine_name,
        w.vintage,
        w.colour,
        w.style,
        w.country,
        w.vivino_rating,
        w.price_eur,
        w.personal_rating,
        w.personal_notes,
        w.drink_from,
        w.drink_peak,
        w.drink_until,
        w.purchase_stars,
        COUNT(s.id) as bottle_count,
        ${stringAgg('s.location_code')} as locations
      FROM wines w
      LEFT JOIN slots s ON s.wine_id = w.id
      GROUP BY w.id
      ORDER BY w.wine_name
    `).all();

    // CSV header
    const headers = [
      'ID', 'Wine Name', 'Vintage', 'Colour', 'Style', 'Country',
      'Vivino Rating', 'Price EUR', 'Personal Rating', 'Personal Notes',
      'Drink From', 'Drink Peak', 'Drink Until', 'Purchase Stars',
      'Bottle Count', 'Locations'
    ];

    // Build CSV content
    let csv = headers.join(',') + '\n';

    for (const wine of wines) {
      const row = [
        wine.id,
        escapeCsvField(wine.wine_name),
        wine.vintage || '',
        wine.colour || '',
        escapeCsvField(wine.style),
        escapeCsvField(wine.country),
        wine.vivino_rating || '',
        wine.price_eur || '',
        wine.personal_rating || '',
        escapeCsvField(wine.personal_notes),
        wine.drink_from || '',
        wine.drink_peak || '',
        wine.drink_until || '',
        wine.purchase_stars || '',
        wine.bottle_count || 0,
        escapeCsvField(wine.locations)
      ];
      csv += row.join(',') + '\n';
    }

    const filename = `wine-list-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    console.error('CSV export error:', error);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

/**
 * Import JSON backup.
 * @route POST /api/backup/import
 */
router.post('/import', async (req, res) => {
  const { backup, options = {} } = req.body;

  if (!backup || !backup.data) {
    return res.status(400).json({ error: 'Invalid backup format' });
  }

  const { mergeMode = 'replace' } = options; // 'replace' or 'merge'

  try {
    const stats = { imported: 0, skipped: 0, errors: [] };

    // Use ON CONFLICT for PostgreSQL (also works with SQLite 3.24+)
    const upsertSuffix = isPostgres()
      ? 'ON CONFLICT (id) DO UPDATE SET'
      : 'OR REPLACE';

    // If replace mode, clear existing data
    if (mergeMode === 'replace') {
      await db.prepare('DELETE FROM slots').run();
      await safeDelete('DELETE FROM wine_ratings');
      await safeDelete('DELETE FROM consumption_log');
      await safeDelete('DELETE FROM drinking_windows');
      await safeDelete('DELETE FROM data_provenance');
      await safeDelete('DELETE FROM reduce_now');
      await db.prepare('DELETE FROM wines').run();
    }

    // Import wines
    if (backup.data.wines) {
      for (const wine of backup.data.wines) {
        try {
          if (isPostgres()) {
            // PostgreSQL: use INSERT ... ON CONFLICT
            await db.prepare(`
              INSERT INTO wines (
                id, style, colour, wine_name, vintage, vivino_rating, price_eur,
                country, drink_from, drink_peak, drink_until, personal_rating,
                personal_notes, personal_rated_at, purchase_stars, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET
                style = EXCLUDED.style,
                colour = EXCLUDED.colour,
                wine_name = EXCLUDED.wine_name,
                vintage = EXCLUDED.vintage,
                vivino_rating = EXCLUDED.vivino_rating,
                price_eur = EXCLUDED.price_eur,
                country = EXCLUDED.country,
                drink_from = EXCLUDED.drink_from,
                drink_peak = EXCLUDED.drink_peak,
                drink_until = EXCLUDED.drink_until,
                personal_rating = EXCLUDED.personal_rating,
                personal_notes = EXCLUDED.personal_notes,
                personal_rated_at = EXCLUDED.personal_rated_at,
                purchase_stars = EXCLUDED.purchase_stars,
                updated_at = EXCLUDED.updated_at
            `).run(
              wine.id,
              wine.style || null,
              wine.colour || null,
              wine.wine_name,
              wine.vintage || null,
              wine.vivino_rating || null,
              wine.price_eur || null,
              wine.country || null,
              wine.drink_from || null,
              wine.drink_peak || null,
              wine.drink_until || null,
              wine.personal_rating || null,
              wine.personal_notes || null,
              wine.personal_rated_at || null,
              wine.purchase_stars || null,
              wine.created_at || new Date().toISOString(),
              wine.updated_at || new Date().toISOString()
            );
          } else {
            // SQLite: use INSERT OR REPLACE
            await db.prepare(`
              INSERT OR REPLACE INTO wines (
                id, style, colour, wine_name, vintage, vivino_rating, price_eur,
                country, drink_from, drink_peak, drink_until, personal_rating,
                personal_notes, personal_rated_at, purchase_stars, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              wine.id,
              wine.style || null,
              wine.colour || null,
              wine.wine_name,
              wine.vintage || null,
              wine.vivino_rating || null,
              wine.price_eur || null,
              wine.country || null,
              wine.drink_from || null,
              wine.drink_peak || null,
              wine.drink_until || null,
              wine.personal_rating || null,
              wine.personal_notes || null,
              wine.personal_rated_at || null,
              wine.purchase_stars || null,
              wine.created_at || new Date().toISOString(),
              wine.updated_at || new Date().toISOString()
            );
          }
          stats.imported++;
        } catch (err) {
          stats.errors.push(`Wine ${wine.id}: ${err.message}`);
        }
      }
    }

    // Import slots
    if (backup.data.slots) {
      for (const slot of backup.data.slots) {
        try {
          if (isPostgres()) {
            await db.prepare(`
              INSERT INTO slots (id, location_code, wine_id)
              VALUES (?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET
                location_code = EXCLUDED.location_code,
                wine_id = EXCLUDED.wine_id
            `).run(slot.id, slot.location_code, slot.wine_id);
          } else {
            await db.prepare(`
              INSERT OR REPLACE INTO slots (id, location_code, wine_id)
              VALUES (?, ?, ?)
            `).run(slot.id, slot.location_code, slot.wine_id);
          }
        } catch (err) {
          stats.errors.push(`Slot ${slot.location_code}: ${err.message}`);
        }
      }
    }

    // Import wine_ratings
    if (backup.data.wine_ratings) {
      for (const rating of backup.data.wine_ratings) {
        try {
          if (isPostgres()) {
            await db.prepare(`
              INSERT INTO wine_ratings (
                id, wine_id, source_id, score, normalized_score, review_count,
                source_url, fetched_at, confidence
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET
                wine_id = EXCLUDED.wine_id,
                source_id = EXCLUDED.source_id,
                score = EXCLUDED.score,
                normalized_score = EXCLUDED.normalized_score,
                review_count = EXCLUDED.review_count,
                source_url = EXCLUDED.source_url,
                fetched_at = EXCLUDED.fetched_at,
                confidence = EXCLUDED.confidence
            `).run(
              rating.id, rating.wine_id, rating.source_id, rating.score,
              rating.normalized_score, rating.review_count, rating.source_url,
              rating.fetched_at, rating.confidence
            );
          } else {
            await db.prepare(`
              INSERT OR REPLACE INTO wine_ratings (
                id, wine_id, source_id, score, normalized_score, review_count,
                source_url, fetched_at, confidence
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              rating.id, rating.wine_id, rating.source_id, rating.score,
              rating.normalized_score, rating.review_count, rating.source_url,
              rating.fetched_at, rating.confidence
            );
          }
        } catch (err) {
          stats.errors.push(`Rating: ${err.message}`);
        }
      }
    }

    // Import consumption_log (also support legacy wine_history name)
    const consumptionData = backup.data.consumption_log || backup.data.wine_history;
    if (consumptionData && consumptionData.length > 0) {
      for (const history of consumptionData) {
        try {
          if (isPostgres()) {
            await db.prepare(`
              INSERT INTO consumption_log (
                id, wine_id, wine_name, vintage, style, colour, country,
                location_code, consumed_at, occasion, pairing_dish,
                consumption_notes, consumption_rating
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET
                wine_id = EXCLUDED.wine_id,
                wine_name = EXCLUDED.wine_name,
                vintage = EXCLUDED.vintage,
                style = EXCLUDED.style,
                colour = EXCLUDED.colour,
                country = EXCLUDED.country,
                location_code = EXCLUDED.location_code,
                consumed_at = EXCLUDED.consumed_at,
                occasion = EXCLUDED.occasion,
                pairing_dish = EXCLUDED.pairing_dish,
                consumption_notes = EXCLUDED.consumption_notes,
                consumption_rating = EXCLUDED.consumption_rating
            `).run(
              history.id, history.wine_id, history.wine_name, history.vintage,
              history.style, history.colour, history.country, history.location_code,
              history.consumed_at, history.occasion, history.pairing_dish,
              history.consumption_notes, history.consumption_rating
            );
          } else {
            await db.prepare(`
              INSERT OR REPLACE INTO consumption_log (
                id, wine_id, wine_name, vintage, style, colour, country,
                location_code, consumed_at, occasion, pairing_dish,
                consumption_notes, consumption_rating
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              history.id, history.wine_id, history.wine_name, history.vintage,
              history.style, history.colour, history.country, history.location_code,
              history.consumed_at, history.occasion, history.pairing_dish,
              history.consumption_notes, history.consumption_rating
            );
          }
        } catch (err) {
          stats.errors.push(`History: ${err.message}`);
        }
      }
    }

    res.json({
      message: 'Import completed',
      stats: {
        winesImported: stats.imported,
        errors: stats.errors.length,
        errorDetails: stats.errors.slice(0, 10) // Limit error details
      }
    });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Import failed: ' + error.message });
  }
});

/**
 * Safely query a table that might not exist.
 * @param {string} sql - SQL query
 * @returns {Promise<Array>} Results or empty array
 */
async function safeQuery(sql) {
  try {
    return await db.prepare(sql).all();
  } catch {
    return [];
  }
}

/**
 * Escape a field for CSV output.
 * @param {string} value - Field value
 * @returns {string} Escaped value
 */
function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export default router;
