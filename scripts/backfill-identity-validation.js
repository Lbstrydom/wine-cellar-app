#!/usr/bin/env node
/**
 * @fileoverview Backfill identity validation for existing ratings.
 * Re-validates all existing ratings against wine identity tokens.
 * @module scripts/backfill-identity-validation
 */

import db from '../src/db/index.js';
import logger from '../src/utils/logger.js';
import { generateIdentityTokens, calculateIdentityScore } from '../src/services/wine/wineIdentity.js';

/**
 * Backfill identity scores for all ratings.
 * @param {Object} options - Options for backfill
 * @param {boolean} [options.dryRun=true] - Dry run mode (no updates)
 * @param {number} [options.batchSize=100] - Batch size for processing
 * @param {number} [options.cellarId] - Optional: limit to specific cellar
 */
async function backfillIdentityValidation(options = {}) {
  const { dryRun = true, batchSize = 100, cellarId = null } = options;

  logger.info('BackfillIdentity', `Starting identity validation backfill (dryRun: ${dryRun})`);

  try {
    // Get count of ratings to process
    const countQuery = cellarId
      ? `SELECT COUNT(*) as count FROM wine_ratings wr 
         JOIN wines w ON w.id = wr.wine_id 
         WHERE w.cellar_id = $1 AND (wr.identity_score IS NULL OR wr.identity_score = 0)`
      : `SELECT COUNT(*) as count FROM wine_ratings 
         WHERE identity_score IS NULL OR identity_score = 0`;

    const { count } = cellarId
      ? await db.prepare(countQuery).get(cellarId)
      : await db.prepare(countQuery).get();

    logger.info('BackfillIdentity', `Found ${count} ratings to process`);

    if (count === 0) {
      logger.info('BackfillIdentity', 'No ratings need backfill');
      return { processed: 0, updated: 0, rejected: 0 };
    }

    let processed = 0;
    let updated = 0;
    let rejected = 0;
    let offset = 0;

    while (offset < count) {
      // Fetch batch of ratings with wine data
      const batchQuery = cellarId
        ? `SELECT 
             wr.id as rating_id,
             wr.wine_id,
             wr.source,
             wr.source_url,
             wr.evidence_excerpt,
             wr.matched_wine_label,
             w.wine_name,
             w.vintage,
             w.producer,
             w.winery,
             w.grapes,
             w.region,
             w.country,
             w.colour,
             w.cellar_id
           FROM wine_ratings wr
           JOIN wines w ON w.id = wr.wine_id
           WHERE w.cellar_id = $1 
             AND (wr.identity_score IS NULL OR wr.identity_score = 0)
           ORDER BY wr.id
           LIMIT $2 OFFSET $3`
        : `SELECT 
             wr.id as rating_id,
             wr.wine_id,
             wr.source,
             wr.source_url,
             wr.evidence_excerpt,
             wr.matched_wine_label,
             w.wine_name,
             w.vintage,
             w.producer,
             w.winery,
             w.grapes,
             w.region,
             w.country,
             w.colour
           FROM wine_ratings wr
           JOIN wines w ON w.id = wr.wine_id
           WHERE wr.identity_score IS NULL OR wr.identity_score = 0
           ORDER BY wr.id
           LIMIT $1 OFFSET $2`;

      const params = cellarId ? [cellarId, batchSize, offset] : [batchSize, offset];
      const batch = await db.prepare(batchQuery).all(...params);

      logger.info('BackfillIdentity', `Processing batch ${Math.floor(offset / batchSize) + 1} (${batch.length} ratings)`);

      for (const row of batch) {
        processed++;

        // Generate identity tokens for this wine
        const identityTokens = generateIdentityTokens({
          producer_name: row.producer || row.winery || '',
          winery: row.winery || row.producer || '',
          range_name: row.wine_name || '',
          grape_variety: row.grapes || '',
          country: row.country || '',
          region: row.region || '',
          wine_type: row.colour || 'unknown',
          vintage: row.vintage
        });

        // Calculate identity score
        const validationText = [
          row.matched_wine_label,
          row.evidence_excerpt,
          row.source_url,
          row.source
        ].filter(Boolean).join(' ');

        const identity = calculateIdentityScore(validationText, identityTokens);

        // Update rating with identity score
        if (!dryRun) {
          await db.prepare(`
            UPDATE wine_ratings
            SET 
              identity_score = $1,
              identity_reason = $2
            WHERE id = $3
          `).run(identity.score, identity.reason, row.rating_id);
        }

        if (identity.valid) {
          updated++;
        } else {
          rejected++;
          if (!dryRun) {
            logger.warn('BackfillIdentity', `Rating ${row.rating_id} rejected (score: ${identity.score}, reason: ${identity.reason})`);
          }
        }

        // Log progress every 100 ratings
        if (processed % 100 === 0) {
          logger.info('BackfillIdentity', `Progress: ${processed}/${count} (${updated} valid, ${rejected} rejected)`);
        }
      }

      offset += batchSize;
    }

    logger.info('BackfillIdentity', `Backfill complete: ${processed} processed, ${updated} valid, ${rejected} rejected`);

    return { processed, updated, rejected };

  } catch (error) {
    logger.error('BackfillIdentity', `Backfill failed: ${error.message}`);
    throw error;
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--commit');
  const cellarIdArg = args.find(a => a.startsWith('--cellar-id='));
  const cellarId = cellarIdArg ? parseInt(cellarIdArg.split('=')[1]) : null;

  logger.info('BackfillIdentity', `CLI execution: dryRun=${dryRun}, cellarId=${cellarId}`);

  backfillIdentityValidation({ dryRun, cellarId })
    .then(result => {
      logger.info('BackfillIdentity', 'Backfill completed successfully');
      logger.info('BackfillIdentity', JSON.stringify(result));
      process.exit(0);
    })
    .catch(error => {
      logger.error('BackfillIdentity', `Backfill failed: ${error.message}`);
      process.exit(1);
    });
}

export { backfillIdentityValidation };
