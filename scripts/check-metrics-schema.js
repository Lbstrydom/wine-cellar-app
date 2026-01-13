import db from '../src/db/index.js';

const columns = await db.prepare(`
  SELECT column_name FROM information_schema.columns 
  WHERE table_name='search_metrics' 
  ORDER BY column_name
`).all();

console.log('search_metrics columns:', columns.map(c => c.column_name));
process.exit(0);
