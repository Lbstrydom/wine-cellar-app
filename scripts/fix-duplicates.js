/**
 * @fileoverview Fix duplicate wines before adding unique fingerprint index
 * 
 * Actions:
 * 1. Delete 8 "Updated Test Cabernet" test wines (no bottles attached)
 * 2. Merge 3 real duplicate pairs (move bottles, delete duplicate record)
 * 3. Add unique index on (cellar_id, fingerprint)
 */

import db from '../src/db/index.js';

const TEST_WINE_IDS = [92, 95, 99, 104, 108, 126, 127, 128];

const MERGE_PAIRS = [
  { keep: 5, remove: 68, name: 'El Castilla Viurachardonnay' },
  { keep: 1, remove: 52, name: 'Moroki Sauvignon Blanc' },
  { keep: 2, remove: 54, name: 'Whanau Pacific Sauvignon Blanc' },
];

async function fixDuplicates() {
  console.log('=== Phase 6: Fix Duplicate Wines ===\n');

  // Step 1: Delete test wines
  console.log('Step 1: Deleting test wines (no bottles attached)...');
  for (const id of TEST_WINE_IDS) {
    await db.prepare('DELETE FROM wines WHERE id = $1').run(id);
  }
  console.log(`  ✓ Deleted ${TEST_WINE_IDS.length} test wines (IDs: ${TEST_WINE_IDS.join(', ')})\n`);

  // Step 2: Merge duplicate pairs
  console.log('Step 2: Merging duplicate wine pairs...');
  for (const { keep, remove, name } of MERGE_PAIRS) {
    // Move bottles from remove → keep
    const result = await db.prepare(`
      UPDATE slots SET wine_id = $1 WHERE wine_id = $2
    `).run(keep, remove);
    
    // Delete any Phase 6 related data for the duplicate (tables may not exist yet)
    try {
      await db.prepare('DELETE FROM wine_external_ids WHERE wine_id = $1').run(remove);
    } catch (e) { /* table may not exist */ }
    try {
      await db.prepare('DELETE FROM wine_source_ratings WHERE wine_id = $1').run(remove);
    } catch (e) { /* table may not exist */ }
    try {
      await db.prepare('DELETE FROM wine_search_cache WHERE wine_id = $1').run(remove);
    } catch (e) { /* table may not exist */ }
    
    // Delete the duplicate wine record
    await db.prepare('DELETE FROM wines WHERE id = $1').run(remove);
    
    console.log(`  ✓ Merged "${name}": ${remove} → ${keep} (${result.changes || 0} bottles moved)`);
  }
  console.log();

  // Step 3: Verify no more duplicates
  console.log('Step 3: Verifying no duplicates remain...');
  const remaining = await db.prepare(`
    SELECT cellar_id, fingerprint, COUNT(*) as cnt, STRING_AGG(id::text, ', ') as ids
    FROM wines
    WHERE fingerprint IS NOT NULL
    GROUP BY cellar_id, fingerprint
    HAVING COUNT(*) > 1
  `).all();
  
  if (remaining.length > 0) {
    console.error('  ✗ Still have duplicates:', remaining);
    process.exit(1);
  }
  console.log('  ✓ No duplicates remaining\n');

  // Step 4: Add unique index
  console.log('Step 4: Adding unique index on (cellar_id, fingerprint)...');
  await db.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wines_cellar_fingerprint_unique 
    ON wines (cellar_id, fingerprint) 
    WHERE fingerprint IS NOT NULL
  `).run();
  console.log('  ✓ Unique index created\n');

  // Final stats
  const count = await db.prepare('SELECT COUNT(*) as cnt FROM wines').get();
  console.log(`=== Complete! ${count.cnt} wines in database ===`);
  
  process.exit(0);
}

fixDuplicates().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
