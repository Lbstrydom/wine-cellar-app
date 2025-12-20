/**
 * @fileoverview Database connection and query helpers.
 * @module db
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'cellar.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

export default db;
