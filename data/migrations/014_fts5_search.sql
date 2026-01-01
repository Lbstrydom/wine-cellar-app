-- Migration 014: FTS5 Full-Text Search
-- Adds full-text search capability for fast wine searching
-- FTS5 provides sub-millisecond search even with 1000+ wines

-- Create FTS5 virtual table for wine search
-- Using content sync with external content table (wines)
CREATE VIRTUAL TABLE IF NOT EXISTS wines_fts USING fts5(
  wine_name,
  style,
  country,
  tasting_notes,
  content='wines',
  content_rowid='id',
  tokenize='porter unicode61'  -- Porter stemmer for better matching
);

-- Populate FTS table from existing wines
INSERT INTO wines_fts(rowid, wine_name, style, country, tasting_notes)
SELECT id, wine_name, style, country, tasting_notes FROM wines;

-- Trigger: Keep FTS in sync after INSERT
CREATE TRIGGER IF NOT EXISTS wines_fts_insert AFTER INSERT ON wines BEGIN
  INSERT INTO wines_fts(rowid, wine_name, style, country, tasting_notes)
  VALUES (new.id, new.wine_name, new.style, new.country, new.tasting_notes);
END;

-- Trigger: Keep FTS in sync after DELETE
CREATE TRIGGER IF NOT EXISTS wines_fts_delete AFTER DELETE ON wines BEGIN
  INSERT INTO wines_fts(wines_fts, rowid, wine_name, style, country, tasting_notes)
  VALUES ('delete', old.id, old.wine_name, old.style, old.country, old.tasting_notes);
END;

-- Trigger: Keep FTS in sync after UPDATE
-- FTS5 requires delete then insert for updates
CREATE TRIGGER IF NOT EXISTS wines_fts_update AFTER UPDATE ON wines BEGIN
  INSERT INTO wines_fts(wines_fts, rowid, wine_name, style, country, tasting_notes)
  VALUES ('delete', old.id, old.wine_name, old.style, old.country, old.tasting_notes);
  INSERT INTO wines_fts(rowid, wine_name, style, country, tasting_notes)
  VALUES (new.id, new.wine_name, new.style, new.country, new.tasting_notes);
END;

-- Usage examples:
-- Basic search: SELECT * FROM wines WHERE id IN (SELECT rowid FROM wines_fts WHERE wines_fts MATCH 'cabernet')
-- Phrase search: SELECT * FROM wines WHERE id IN (SELECT rowid FROM wines_fts WHERE wines_fts MATCH '"pinot noir"')
-- Column-specific: SELECT * FROM wines WHERE id IN (SELECT rowid FROM wines_fts WHERE wines_fts MATCH 'country:france')
-- With ranking: SELECT w.*, bm25(wines_fts) as rank FROM wines_fts JOIN wines w ON wines_fts.rowid = w.id WHERE wines_fts MATCH 'merlot' ORDER BY rank
