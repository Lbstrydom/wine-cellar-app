import db from '../src/db/index.js';

async function checkTables() {
  const tables = await db.prepare(`
    SELECT tablename FROM pg_tables 
    WHERE schemaname='public' AND tablename LIKE 'wine%'
  `).all();
  console.log('Wine tables:', tables.map(t => t.tablename).sort());
  
  const searchTables = await db.prepare(`
    SELECT tablename FROM pg_tables 
    WHERE schemaname='public' AND tablename LIKE 'search%'
  `).all();
  console.log('Search tables:', searchTables.map(t => t.tablename).sort());
  
  process.exit(0);
}

checkTables().catch(e => { console.error(e); process.exit(1); });
