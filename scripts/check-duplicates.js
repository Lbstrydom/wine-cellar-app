/**
 * @fileoverview Check duplicate wines before merging
 */

import db from '../src/db/index.js';

async function checkDuplicates() {
  console.log('=== SUSPICIOUS: updated-test wines (IDs: 92, 95, 99, 104, 108, 126, 127, 128) ===');
  const testWines = await db.prepare(`
    SELECT id, wine_name, vintage, country, producer, style 
    FROM wines WHERE id IN (92, 95, 99, 104, 108, 126, 127, 128)
  `).all();
  console.table(testWines);
  
  console.log('\n=== El Castilla duplicates (IDs: 5, 68) ===');
  const elCastilla = await db.prepare(`
    SELECT id, wine_name, vintage, country, producer, style 
    FROM wines WHERE id IN (5, 68)
  `).all();
  console.table(elCastilla);
  
  console.log('\n=== Moroki duplicates (IDs: 1, 52) ===');
  const moroki = await db.prepare(`
    SELECT id, wine_name, vintage, country, producer, style 
    FROM wines WHERE id IN (1, 52)
  `).all();
  console.table(moroki);
  
  console.log('\n=== Whanau Pacific duplicates (IDs: 2, 54) ===');
  const whanau = await db.prepare(`
    SELECT id, wine_name, vintage, country, producer, style 
    FROM wines WHERE id IN (2, 54)
  `).all();
  console.table(whanau);
  
  console.log('\n=== Bottles (slots) attached to these wines ===');
  const slots = await db.prepare(`
    SELECT wine_id, location_code, COUNT(*) as bottle_count 
    FROM slots 
    WHERE wine_id IN (92, 95, 99, 104, 108, 126, 127, 128, 5, 68, 1, 52, 2, 54) 
    GROUP BY wine_id, location_code
  `).all();
  if (slots.length === 0) {
    console.log('No bottles attached to any of these wines');
  } else {
    console.table(slots);
  }
  
  process.exit(0);
}

checkDuplicates().catch(e => { console.error(e); process.exit(1); });
