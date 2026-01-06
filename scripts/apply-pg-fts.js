#!/usr/bin/env node
/**
 * Apply PostgreSQL full-text search trigger to Supabase
 */

import db from '../src/db/index.js';

async function applyFTS() {
  console.log('Applying PostgreSQL full-text search...\n');

  try {
    // Create the function using dollar-quoting
    const createFunction = `
      CREATE OR REPLACE FUNCTION wines_search_update() RETURNS trigger AS $func$
      BEGIN
        NEW.search_vector := to_tsvector('english',
          COALESCE(NEW.wine_name, '') || ' ' ||
          COALESCE(NEW.style, '') || ' ' ||
          COALESCE(NEW.country, '') || ' ' ||
          COALESCE(NEW.producer, '') || ' ' ||
          COALESCE(NEW.region, '') || ' ' ||
          COALESCE(NEW.tasting_notes, '')
        );
        RETURN NEW;
      END;
      $func$ LANGUAGE plpgsql
    `;
    await db.prepare(createFunction).run();
    console.log('✅ Created wines_search_update function');

    // Drop existing trigger
    await db.prepare('DROP TRIGGER IF EXISTS wines_search_trigger ON wines').run();
    console.log('✅ Dropped existing trigger (if any)');

    // Create trigger
    const createTrigger = `
      CREATE TRIGGER wines_search_trigger
        BEFORE INSERT OR UPDATE ON wines
        FOR EACH ROW EXECUTE FUNCTION wines_search_update()
    `;
    await db.prepare(createTrigger).run();
    console.log('✅ Created wines_search_trigger');

    // Create GIN index
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_wines_search ON wines USING GIN(search_vector)').run();
    console.log('✅ Created GIN index for full-text search');

    // Backfill search_vector for existing wines
    const backfill = `
      UPDATE wines SET search_vector = to_tsvector('english',
        COALESCE(wine_name, '') || ' ' ||
        COALESCE(style, '') || ' ' ||
        COALESCE(country, '') || ' ' ||
        COALESCE(producer, '') || ' ' ||
        COALESCE(region, '') || ' ' ||
        COALESCE(tasting_notes, '')
      )
    `;
    const result = await db.prepare(backfill).run();
    console.log(`✅ Backfilled search_vector for ${result.changes || 'all'} wines`);

    console.log('\n✅ Full-text search setup complete!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

applyFTS();
