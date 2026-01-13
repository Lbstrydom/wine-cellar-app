/**
 * @fileoverview Backfill wine fingerprints and report collisions.
 * Usage:
 *   node src/db/scripts/backfill_fingerprints.js
 *   node src/db/scripts/backfill_fingerprints.js --nullify-duplicates
 */

import db from '../index.js';
import { WineFingerprint } from '../../services/wineFingerprint.js';

const shouldNullifyDuplicates = process.argv.includes('--nullify-duplicates');
const shouldAddUniqueIndex = process.argv.includes('--add-unique-index');

async function backfillFingerprints() {
  const wines = await db.prepare(`
    SELECT id, cellar_id, wine_name, producer, vintage, country, region, style, colour
    FROM wines
    WHERE fingerprint IS NULL
  `).all();

  console.log(`[Backfill] Found ${wines.length} wines missing fingerprints`);

  for (const wine of wines) {
    const { fingerprint, version } = WineFingerprint.generateWithVersion({
      wine_name: wine.wine_name,
      producer: wine.producer,
      vintage: wine.vintage,
      country: wine.country,
      region: wine.region,
      style: wine.style,
      colour: wine.colour
    });

    if (!fingerprint) {
      console.warn(`[Backfill] Skip wine ${wine.id}: missing fingerprint`);
      continue;
    }

    await db.prepare(`
      UPDATE wines
      SET fingerprint = $1, fingerprint_version = $2
      WHERE id = $3
    `).run(fingerprint, version, wine.id);
  }

  console.log('[Backfill] Fingerprint update complete');
}

async function reportCollisions() {
  const collisions = await db.prepare(`
    SELECT cellar_id, fingerprint, COUNT(*) as cnt, ARRAY_AGG(id ORDER BY id) as wine_ids
    FROM wines
    WHERE fingerprint IS NOT NULL
    GROUP BY cellar_id, fingerprint
    HAVING COUNT(*) > 1
    ORDER BY cellar_id, cnt DESC
  `).all();

  if (collisions.length === 0) {
    console.log('[Backfill] No fingerprint collisions detected');
    return [];
  }

  console.log(`[Backfill] Detected ${collisions.length} fingerprint collisions:`);
  collisions.forEach(c => {
    console.log(`- cellar ${c.cellar_id} fingerprint "${c.fingerprint}" -> ${c.wine_ids.join(', ')}`);
  });

  return collisions;
}

async function nullifyDuplicates(collisions) {
  if (!shouldNullifyDuplicates || collisions.length === 0) return;

  for (const collision of collisions) {
    const keepId = collision.wine_ids[0];
    const toNullify = collision.wine_ids.slice(1);

    if (toNullify.length === 0) continue;

    const placeholders = toNullify.map((_, i) => `$${i + 1}`).join(', ');
    await db.prepare(`
      UPDATE wines SET fingerprint = NULL
      WHERE id IN (${placeholders})
    `).run(...toNullify);
    // Safe: placeholders derived from toNullify array length; values passed to .run()

    console.log(`[Backfill] Kept ${keepId}, nullified ${toNullify.join(', ')}`);
  }
}

async function addUniqueIndex() {
  if (!shouldAddUniqueIndex) return;

  try {
    await db.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_wines_cellar_fingerprint_unique
      ON wines(cellar_id, fingerprint) WHERE fingerprint IS NOT NULL
    `).run();
    console.log('[Backfill] Unique fingerprint index created');
  } catch (error) {
    console.error('[Backfill] Unique index creation failed:', error.message);
  }
}

async function run() {
  try {
    await backfillFingerprints();
    const collisions = await reportCollisions();
    await nullifyDuplicates(collisions);
    await addUniqueIndex();
  } catch (error) {
    console.error('[Backfill] Failed:', error);
    process.exit(1);
  }
}

await run();
