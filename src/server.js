import express from 'express';
import Database from 'better-sqlite3';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';

// Load environment variables from .env file
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'cellar.db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Database connection
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Initialize Claude API client with .env key
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// ============================================================
// CELLAR LAYOUT API
// ============================================================

// Get full cellar layout with all slots and their contents
app.get('/api/layout', (req, res) => {
  const slots = db.prepare(`
    SELECT 
      s.id as slot_id,
      s.zone,
      s.location_code,
      s.row_num,
      s.col_num,
      w.id as wine_id,
      w.style,
      w.colour,
      w.wine_name,
      w.vintage,
      w.vivino_rating,
      w.price_eur,
      (SELECT rn.priority FROM reduce_now rn WHERE rn.wine_id = w.id) as reduce_priority,
      (SELECT rn.reduce_reason FROM reduce_now rn WHERE rn.wine_id = w.id) as reduce_reason
    FROM slots s
    LEFT JOIN wines w ON s.wine_id = w.id
    ORDER BY s.zone DESC, s.row_num, s.col_num
  `).all();

  // Organise into structure for frontend
  const layout = {
    fridge: { rows: [{ slots: [] }, { slots: [] }] },
    cellar: { rows: [] }
  };

  // Initialise cellar rows
  for (let r = 1; r <= 19; r++) {
    const maxCol = r === 1 ? 7 : 9;
    layout.cellar.rows.push({ row: r, maxCols: maxCol, slots: [] });
  }

  slots.forEach(slot => {
    const slotData = {
      slot_id: slot.slot_id,
      location_code: slot.location_code,
      wine_id: slot.wine_id,
      wine_name: slot.wine_name,
      vintage: slot.vintage,
      colour: slot.colour,
      style: slot.style,
      rating: slot.vivino_rating,
      price: slot.price_eur,
      reduce_priority: slot.reduce_priority,
      reduce_reason: slot.reduce_reason
    };

    if (slot.zone === 'fridge') {
      const fridgeRow = slot.row_num - 1;
      layout.fridge.rows[fridgeRow].slots.push(slotData);
    } else {
      layout.cellar.rows[slot.row_num - 1].slots.push(slotData);
    }
  });

  res.json(layout);
});

// ============================================================
// WINE CRUD API
// ============================================================

// Get all wines with counts
app.get('/api/wines', (req, res) => {
  const wines = db.prepare(`
    SELECT 
      w.id,
      w.style,
      w.colour,
      w.wine_name,
      w.vintage,
      w.vivino_rating,
      w.price_eur,
      COUNT(s.id) as bottle_count,
      GROUP_CONCAT(s.location_code) as locations
    FROM wines w
    LEFT JOIN slots s ON s.wine_id = w.id
    GROUP BY w.id
    ORDER BY w.colour, w.style, w.wine_name
  `).all();
  res.json(wines);
});

// Get single wine details
app.get('/api/wines/:id', (req, res) => {
  const wine = db.prepare(`
    SELECT 
      w.*,
      COUNT(s.id) as bottle_count,
      GROUP_CONCAT(s.location_code) as locations
    FROM wines w
    LEFT JOIN slots s ON s.wine_id = w.id
    WHERE w.id = ?
    GROUP BY w.id
  `).get(req.params.id);
  
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }
  res.json(wine);
});

// Add new wine
app.post('/api/wines', (req, res) => {
  const { style, colour, wine_name, vintage, vivino_rating, price_eur, location } = req.body;
  
  const result = db.prepare(`
    INSERT INTO wines (style, colour, wine_name, vintage, vivino_rating, price_eur)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(style, colour, wine_name, vintage || null, vivino_rating || null, price_eur || null);
  
  const wine_id = result.lastInsertRowid;
  
  // If location specified, assign to slot
  if (location) {
    db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ? AND wine_id IS NULL')
      .run(wine_id, location);
  }
  
  res.json({ id: wine_id, message: 'Wine added' });
});

// Update wine
app.put('/api/wines/:id', (req, res) => {
  const { style, colour, wine_name, vintage, vivino_rating, price_eur } = req.body;
  
  db.prepare(`
    UPDATE wines 
    SET style = ?, colour = ?, wine_name = ?, vintage = ?, vivino_rating = ?, price_eur = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(style, colour, wine_name, vintage || null, vivino_rating || null, price_eur || null, req.params.id);
  
  res.json({ message: 'Wine updated' });
});

// ============================================================
// SLOT/BOTTLE ACTIONS
// ============================================================

// Move bottle to different slot
app.post('/api/slots/move', (req, res) => {
  const { from_location, to_location } = req.body;
  
  // Get wine from source slot
  const sourceSlot = db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(from_location);
  if (!sourceSlot || !sourceSlot.wine_id) {
    return res.status(400).json({ error: 'Source slot is empty' });
  }
  
  // Check target is empty
  const targetSlot = db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(to_location);
  if (!targetSlot) {
    return res.status(404).json({ error: 'Target slot not found' });
  }
  if (targetSlot.wine_id) {
    return res.status(400).json({ error: 'Target slot is occupied' });
  }
  
  // Move
  db.prepare('UPDATE slots SET wine_id = NULL WHERE location_code = ?').run(from_location);
  db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?').run(sourceSlot.wine_id, to_location);
  
  res.json({ message: 'Bottle moved' });
});

// Drink a bottle (log consumption and clear slot)
app.post('/api/slots/:location/drink', (req, res) => {
  const { location } = req.params;
  const { occasion, pairing_dish, rating, notes } = req.body;
  
  const slot = db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(location);
  if (!slot || !slot.wine_id) {
    return res.status(400).json({ error: 'Slot is empty' });
  }
  
  // Log consumption
  db.prepare(`
    INSERT INTO consumption_log (wine_id, slot_location, occasion, pairing_dish, rating, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(slot.wine_id, location, occasion || null, pairing_dish || null, rating || null, notes || null);
  
  // Clear slot
  db.prepare('UPDATE slots SET wine_id = NULL WHERE location_code = ?').run(location);
  
  // Check if this was the last bottle of this wine
  const remaining = db.prepare('SELECT COUNT(*) as count FROM slots WHERE wine_id = ?').get(slot.wine_id);
  
  // Remove from reduce_now if no bottles left
  if (remaining.count === 0) {
    db.prepare('DELETE FROM reduce_now WHERE wine_id = ?').run(slot.wine_id);
  }
  
  res.json({ 
    message: 'Bottle consumed and logged',
    remaining_bottles: remaining.count
  });
});

// Add bottle to empty slot
app.post('/api/slots/:location/add', (req, res) => {
  const { location } = req.params;
  const { wine_id } = req.body;
  
  const slot = db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(location);
  if (!slot) {
    return res.status(404).json({ error: 'Slot not found' });
  }
  if (slot.wine_id) {
    return res.status(400).json({ error: 'Slot is occupied' });
  }
  
  db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?').run(wine_id, location);
  res.json({ message: 'Bottle added to slot' });
});

// ============================================================
// REDUCE NOW API
// ============================================================

// Get reduce-now list
app.get('/api/reduce-now', (req, res) => {
  const list = db.prepare(`
    SELECT 
      rn.id,
      rn.priority,
      rn.reduce_reason,
      w.id as wine_id,
      w.style,
      w.colour,
      w.wine_name,
      w.vintage,
      w.vivino_rating,
      COUNT(s.id) as bottle_count,
      GROUP_CONCAT(s.location_code) as locations
    FROM reduce_now rn
    JOIN wines w ON w.id = rn.wine_id
    LEFT JOIN slots s ON s.wine_id = w.id
    GROUP BY rn.id
    ORDER BY rn.priority, w.wine_name
  `).all();
  res.json(list);
});

// Add wine to reduce-now
app.post('/api/reduce-now', (req, res) => {
  const { wine_id, priority, reduce_reason } = req.body;
  
  db.prepare(`
    INSERT OR REPLACE INTO reduce_now (wine_id, priority, reduce_reason)
    VALUES (?, ?, ?)
  `).run(wine_id, priority || 3, reduce_reason || null);
  
  res.json({ message: 'Added to reduce-now' });
});

// Remove from reduce-now
app.delete('/api/reduce-now/:wine_id', (req, res) => {
  db.prepare('DELETE FROM reduce_now WHERE wine_id = ?').run(req.params.wine_id);
  res.json({ message: 'Removed from reduce-now' });
});

// ============================================================
// PAIRING API
// ============================================================

// Get pairing rules (for reference/debugging)
app.get('/api/pairing-rules', (req, res) => {
  const rules = db.prepare('SELECT * FROM pairing_rules ORDER BY food_signal, match_level').all();
  res.json(rules);
});

// Get pairing suggestion based on food signals
app.post('/api/pairing/suggest', (req, res) => {
  const { signals, prefer_reduce_now = true, limit = 5 } = req.body;
  
  if (!signals || !Array.isArray(signals) || signals.length === 0) {
    return res.status(400).json({ error: 'Provide food signals array' });
  }
  
  // Score wine styles based on signals
  const placeholders = signals.map(() => '?').join(',');
  const styleScores = db.prepare(`
    SELECT 
      wine_style_bucket,
      SUM(CASE match_level 
        WHEN 'primary' THEN 3 
        WHEN 'good' THEN 2 
        WHEN 'fallback' THEN 1 
        ELSE 0 END) as score
    FROM pairing_rules
    WHERE food_signal IN (${placeholders})
    GROUP BY wine_style_bucket
    ORDER BY score DESC
  `).all(...signals);
  
  // Find matching wines from inventory
  const wines = db.prepare(`
    SELECT 
      w.id,
      w.style,
      w.colour,
      w.wine_name,
      w.vintage,
      w.vivino_rating,
      COUNT(s.id) as bottle_count,
      GROUP_CONCAT(DISTINCT s.location_code) as locations,
      MAX(CASE WHEN s.zone = 'fridge' THEN 1 ELSE 0 END) as in_fridge,
      CASE WHEN rn.id IS NOT NULL THEN rn.priority ELSE 99 END as reduce_priority,
      rn.reduce_reason
    FROM wines w
    JOIN slots s ON s.wine_id = w.id
    LEFT JOIN reduce_now rn ON w.id = rn.wine_id
    GROUP BY w.id
    HAVING bottle_count > 0
    ORDER BY ${prefer_reduce_now ? 'reduce_priority ASC,' : ''} w.vivino_rating DESC
  `).all();
  
  // Match wines to scored styles
  const suggestions = [];
  for (const wine of wines) {
    const styleMatch = styleScores.find(ss => 
      wine.style.toLowerCase().includes(ss.wine_style_bucket.toLowerCase().split('/')[0]) ||
      ss.wine_style_bucket.toLowerCase().includes(wine.style.toLowerCase().split(' ')[0])
    );
    
    if (styleMatch) {
      suggestions.push({
        ...wine,
        style_score: styleMatch.score,
        matched_style_bucket: styleMatch.wine_style_bucket
      });
    }
  }
  
  // Sort by reduce priority, then style score
  suggestions.sort((a, b) => {
    if (prefer_reduce_now && a.reduce_priority !== b.reduce_priority) {
      return a.reduce_priority - b.reduce_priority;
    }
    return b.style_score - a.style_score;
  });
  
  res.json({
    signals_used: signals,
    style_ranking: styleScores.slice(0, 5),
    suggestions: suggestions.slice(0, limit)
  });
});

// ============================================================
// CONSUMPTION LOG
// ============================================================

app.get('/api/consumption', (req, res) => {
  const log = db.prepare(`
    SELECT 
      cl.*,
      w.wine_name,
      w.vintage,
      w.style,
      w.colour
    FROM consumption_log cl
    JOIN wines w ON w.id = cl.wine_id
    ORDER BY cl.consumed_at DESC
    LIMIT 50
  `).all();
  res.json(log);
});

// ============================================================
// STATS
// ============================================================

app.get('/api/stats', (req, res) => {
  const totalBottles = db.prepare('SELECT COUNT(*) as count FROM slots WHERE wine_id IS NOT NULL').get();
  const byColour = db.prepare(`
    SELECT w.colour, COUNT(s.id) as count 
    FROM slots s 
    JOIN wines w ON w.id = s.wine_id 
    GROUP BY w.colour
  `).all();
  const reduceNowCount = db.prepare('SELECT COUNT(*) as count FROM reduce_now').get();
  const emptySlots = db.prepare('SELECT COUNT(*) as count FROM slots WHERE wine_id IS NULL').get();
  const recentConsumption = db.prepare(`
    SELECT COUNT(*) as count FROM consumption_log 
    WHERE consumed_at > datetime('now', '-30 days')
  `).get();
  
  res.json({
    total_bottles: totalBottles.count,
    by_colour: byColour,
    reduce_now_count: reduceNowCount.count,
    empty_slots: emptySlots.count,
    consumed_last_30_days: recentConsumption.count
  });
});

// ============================================================
// START SERVER
// ============================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Wine cellar app running on http://0.0.0.0:${PORT}`);
});
