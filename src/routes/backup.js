/**
 * @fileoverview Backup, export and import endpoints.
 * Supports JSON full backup and CSV wine list export.
 * @module routes/backup
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * Safely get count from a table that might not exist.
 * @param {string} sql - SQL count query
 * @returns {number} Count or 0
 */
function safeCount(sql) {
  try {
    return db.prepare(sql).get().count;
  } catch {
    return 0;
  }
}

/**
 * Safely run a delete statement on a table that might not exist.
 * @param {string} sql - SQL delete statement
 */
function safeDelete(sql) {
  try {
    db.prepare(sql).run();
  } catch {
    // Table doesn't exist, ignore
  }
}

/**
 * Get backup metadata (counts for UI display).
 * @route GET /api/backup/info
 */
router.get('/info', (req, res) => {
  try {
    const info = {
      wines: safeCount('SELECT COUNT(*) as count FROM wines'),
      slots: safeCount('SELECT COUNT(*) as count FROM slots WHERE wine_id IS NOT NULL'),
      history: safeCount('SELECT COUNT(*) as count FROM consumption_log'),
      ratings: safeCount('SELECT COUNT(*) as count FROM wine_ratings'),
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
router.get('/export/json', (req, res) => {
  try {
    const backup = {
      version: '1.0',
      appVersion: '1.0.0',
      exportedAt: new Date().toISOString(),
      data: {
        wines: db.prepare('SELECT * FROM wines').all(),
        slots: db.prepare('SELECT * FROM slots').all(),
        wine_ratings: safeQuery('SELECT * FROM wine_ratings'),
        consumption_log: safeQuery('SELECT * FROM consumption_log'),
        drinking_windows: safeQuery('SELECT * FROM drinking_windows'),
        user_settings: safeQuery('SELECT * FROM user_settings'),
        data_provenance: safeQuery('SELECT * FROM data_provenance'),
        reduce_now: safeQuery('SELECT * FROM reduce_now')
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
router.get('/export/csv', (req, res) => {
  try {
    const wines = db.prepare(`
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
        GROUP_CONCAT(s.location_code) as locations
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
router.post('/import', (req, res) => {
  const { backup, options = {} } = req.body;

  if (!backup || !backup.data) {
    return res.status(400).json({ error: 'Invalid backup format' });
  }

  const { mergeMode = 'replace' } = options; // 'replace' or 'merge'

  try {
    const stats = { imported: 0, skipped: 0, errors: [] };

    db.transaction(() => {
      // If replace mode, clear existing data
      if (mergeMode === 'replace') {
        db.prepare('DELETE FROM slots').run();
        safeDelete('DELETE FROM wine_ratings');
        safeDelete('DELETE FROM consumption_log');
        safeDelete('DELETE FROM drinking_windows');
        safeDelete('DELETE FROM data_provenance');
        safeDelete('DELETE FROM reduce_now');
        db.prepare('DELETE FROM wines').run();
      }

      // Import wines
      if (backup.data.wines) {
        const insertWine = db.prepare(`
          INSERT OR REPLACE INTO wines (
            id, style, colour, wine_name, vintage, vivino_rating, price_eur,
            country, drink_from, drink_peak, drink_until, personal_rating,
            personal_notes, personal_rated_at, purchase_stars, created_at, updated_at
          ) VALUES (
            @id, @style, @colour, @wine_name, @vintage, @vivino_rating, @price_eur,
            @country, @drink_from, @drink_peak, @drink_until, @personal_rating,
            @personal_notes, @personal_rated_at, @purchase_stars, @created_at, @updated_at
          )
        `);

        for (const wine of backup.data.wines) {
          try {
            insertWine.run({
              id: wine.id,
              style: wine.style || null,
              colour: wine.colour || null,
              wine_name: wine.wine_name,
              vintage: wine.vintage || null,
              vivino_rating: wine.vivino_rating || null,
              price_eur: wine.price_eur || null,
              country: wine.country || null,
              drink_from: wine.drink_from || null,
              drink_peak: wine.drink_peak || null,
              drink_until: wine.drink_until || null,
              personal_rating: wine.personal_rating || null,
              personal_notes: wine.personal_notes || null,
              personal_rated_at: wine.personal_rated_at || null,
              purchase_stars: wine.purchase_stars || null,
              created_at: wine.created_at || new Date().toISOString(),
              updated_at: wine.updated_at || new Date().toISOString()
            });
            stats.imported++;
          } catch (err) {
            stats.errors.push(`Wine ${wine.id}: ${err.message}`);
          }
        }
      }

      // Import slots
      if (backup.data.slots) {
        const insertSlot = db.prepare(`
          INSERT OR REPLACE INTO slots (id, location_code, wine_id)
          VALUES (@id, @location_code, @wine_id)
        `);

        for (const slot of backup.data.slots) {
          try {
            insertSlot.run({
              id: slot.id,
              location_code: slot.location_code,
              wine_id: slot.wine_id
            });
          } catch (err) {
            stats.errors.push(`Slot ${slot.location_code}: ${err.message}`);
          }
        }
      }

      // Import wine_ratings
      if (backup.data.wine_ratings) {
        const insertRating = db.prepare(`
          INSERT OR REPLACE INTO wine_ratings (
            id, wine_id, source_id, score, normalized_score, review_count,
            source_url, fetched_at, confidence
          ) VALUES (
            @id, @wine_id, @source_id, @score, @normalized_score, @review_count,
            @source_url, @fetched_at, @confidence
          )
        `);

        for (const rating of backup.data.wine_ratings) {
          try {
            insertRating.run(rating);
          } catch (err) {
            stats.errors.push(`Rating: ${err.message}`);
          }
        }
      }

      // Import consumption_log (also support legacy wine_history name)
      const consumptionData = backup.data.consumption_log || backup.data.wine_history;
      if (consumptionData && consumptionData.length > 0) {
        try {
          const insertHistory = db.prepare(`
            INSERT OR REPLACE INTO consumption_log (
              id, wine_id, wine_name, vintage, style, colour, country,
              location_code, consumed_at, occasion, pairing_dish,
              consumption_notes, consumption_rating
            ) VALUES (
              @id, @wine_id, @wine_name, @vintage, @style, @colour, @country,
              @location_code, @consumed_at, @occasion, @pairing_dish,
              @consumption_notes, @consumption_rating
            )
          `);

          for (const history of consumptionData) {
            try {
              insertHistory.run(history);
            } catch (err) {
              stats.errors.push(`History: ${err.message}`);
            }
          }
        } catch {
          // consumption_log table doesn't exist, skip
        }
      }
    })();

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
 * @returns {Array} Results or empty array
 */
function safeQuery(sql) {
  try {
    return db.prepare(sql).all();
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
