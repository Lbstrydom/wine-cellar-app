# REFACTOR_HANDOFF.md - Code Restructuring Task

## Objective

Refactor the Wine Cellar App from monolithic files into a modular structure following the conventions in `AGENTS.md`.

**Important**: This is a restructuring task. All existing functionality must be preserved. The app should work identically after refactoring.

---

## Current State

```
wine-cellar-app/
├── src/
│   └── server.js           # ~400 lines - all backend code
├── public/
│   └── index.html          # ~900 lines - HTML + CSS + JS combined
├── data/
│   ├── schema.sql
│   ├── migrate.py
│   └── cellar.db
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

---

## Target State

```
wine-cellar-app/
├── src/
│   ├── server.js              # ~50 lines - Express setup only
│   ├── routes/
│   │   ├── index.js           # Route aggregator
│   │   ├── wines.js           # Wine CRUD
│   │   ├── slots.js           # Slot operations
│   │   ├── bottles.js         # Bottle add/move
│   │   ├── pairing.js         # Pairing endpoints
│   │   ├── reduceNow.js       # Reduce-now list
│   │   └── stats.js           # Statistics
│   ├── services/
│   │   ├── claude.js          # Claude API wrapper
│   │   └── pairing.js         # Pairing logic
│   └── db/
│       └── index.js           # Database setup and helpers
├── public/
│   ├── index.html             # ~100 lines - HTML structure only
│   ├── css/
│   │   └── styles.css         # All CSS (~300 lines)
│   └── js/
│       ├── app.js             # Main init, state (~80 lines)
│       ├── api.js             # API wrapper (~60 lines)
│       ├── grid.js            # Grid rendering (~100 lines)
│       ├── modals.js          # Modal handlers (~80 lines)
│       ├── sommelier.js       # Sommelier UI (~100 lines)
│       └── utils.js           # Utilities (~30 lines)
├── data/
├── tests/                     # Empty for now
├── AGENTS.md
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

---

## Step-by-Step Instructions

### Phase 1: Backend Refactoring

#### 1.1 Create src/db/index.js

Extract database connection and helper functions:

```javascript
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
```

#### 1.2 Create src/routes/index.js

Route aggregator:

```javascript
/**
 * @fileoverview Aggregates all route modules.
 * @module routes
 */

import { Router } from 'express';
import wineRoutes from './wines.js';
import slotRoutes from './slots.js';
import bottleRoutes from './bottles.js';
import pairingRoutes from './pairing.js';
import reduceNowRoutes from './reduceNow.js';
import statsRoutes from './stats.js';

const router = Router();

router.use('/wines', wineRoutes);
router.use('/slots', slotRoutes);
router.use('/bottles', bottleRoutes);
router.use('/pairing', pairingRoutes);
router.use('/reduce-now', reduceNowRoutes);
router.use('/stats', statsRoutes);

export default router;
```

#### 1.3 Create src/routes/wines.js

Extract wine endpoints from server.js:

```javascript
/**
 * @fileoverview Wine CRUD endpoints.
 * @module routes/wines
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * Get all wines with bottle counts.
 * @route GET /api/wines
 */
router.get('/', (req, res) => {
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

/**
 * Get single wine by ID.
 * @route GET /api/wines/:id
 */
router.get('/:id', (req, res) => {
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

/**
 * Create new wine.
 * @route POST /api/wines
 */
router.post('/', (req, res) => {
  const { style, colour, wine_name, vintage, vivino_rating, price_eur } = req.body;
  
  const result = db.prepare(`
    INSERT INTO wines (style, colour, wine_name, vintage, vivino_rating, price_eur)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(style, colour, wine_name, vintage || null, vivino_rating || null, price_eur || null);
  
  res.status(201).json({ id: result.lastInsertRowid, message: 'Wine added' });
});

/**
 * Update wine.
 * @route PUT /api/wines/:id
 */
router.put('/:id', (req, res) => {
  const { style, colour, wine_name, vintage, vivino_rating, price_eur } = req.body;
  
  db.prepare(`
    UPDATE wines 
    SET style = ?, colour = ?, wine_name = ?, vintage = ?, vivino_rating = ?, price_eur = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(style, colour, wine_name, vintage || null, vivino_rating || null, price_eur || null, req.params.id);
  
  res.json({ message: 'Wine updated' });
});

/**
 * Get distinct wine styles for autocomplete.
 * @route GET /api/wines/styles
 */
router.get('/styles', (req, res) => {
  const styles = db.prepare('SELECT DISTINCT style FROM wines ORDER BY style').all();
  res.json(styles.map(s => s.style));
});

/**
 * Search wines by name.
 * @route GET /api/wines/search
 */
router.get('/search', (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) {
    return res.json([]);
  }
  
  const wines = db.prepare(`
    SELECT id, wine_name, vintage, style, colour, vivino_rating, price_eur
    FROM wines
    WHERE wine_name LIKE ?
    ORDER BY wine_name
    LIMIT 10
  `).all(`%${q}%`);
  
  res.json(wines);
});

export default router;
```

#### 1.4 Create src/routes/slots.js

Extract slot endpoints:

```javascript
/**
 * @fileoverview Slot operations (move, drink, add to slot).
 * @module routes/slots
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * Move bottle between slots.
 * @route POST /api/slots/move
 */
router.post('/move', (req, res) => {
  const { from_location, to_location } = req.body;
  
  const sourceSlot = db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(from_location);
  if (!sourceSlot || !sourceSlot.wine_id) {
    return res.status(400).json({ error: 'Source slot is empty' });
  }
  
  const targetSlot = db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(to_location);
  if (!targetSlot) {
    return res.status(404).json({ error: 'Target slot not found' });
  }
  if (targetSlot.wine_id) {
    return res.status(400).json({ error: 'Target slot is occupied' });
  }
  
  db.prepare('UPDATE slots SET wine_id = NULL WHERE location_code = ?').run(from_location);
  db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?').run(sourceSlot.wine_id, to_location);
  
  res.json({ message: 'Bottle moved' });
});

/**
 * Drink bottle (log consumption and clear slot).
 * @route POST /api/slots/:location/drink
 */
router.post('/:location/drink', (req, res) => {
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
  
  // Check remaining bottles
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

/**
 * Add bottle to empty slot.
 * @route POST /api/slots/:location/add
 */
router.post('/:location/add', (req, res) => {
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

/**
 * Remove bottle from slot without logging consumption.
 * @route DELETE /api/slots/:location/remove
 */
router.delete('/:location/remove', (req, res) => {
  const { location } = req.params;
  
  const slot = db.prepare('SELECT wine_id FROM slots WHERE location_code = ?').get(location);
  if (!slot) {
    return res.status(404).json({ error: 'Slot not found' });
  }
  if (!slot.wine_id) {
    return res.status(400).json({ error: 'Slot is already empty' });
  }
  
  db.prepare('UPDATE slots SET wine_id = NULL WHERE location_code = ?').run(location);
  
  res.json({ message: `Bottle removed from ${location}` });
});

export default router;
```

#### 1.5 Create src/routes/bottles.js

New endpoint for multi-bottle operations:

```javascript
/**
 * @fileoverview Bottle management (add multiple, etc.).
 * @module routes/bottles
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * Add bottle(s) to consecutive slots.
 * @route POST /api/bottles/add
 */
router.post('/add', (req, res) => {
  const { wine_id, start_location, quantity = 1 } = req.body;
  
  if (!wine_id || !start_location) {
    return res.status(400).json({ error: 'wine_id and start_location required' });
  }
  
  // Verify wine exists
  const wine = db.prepare('SELECT id FROM wines WHERE id = ?').get(wine_id);
  if (!wine) {
    return res.status(404).json({ error: 'Wine not found' });
  }
  
  // Parse start location and find consecutive slots
  const isFridge = start_location.startsWith('F');
  let slots = [];
  
  if (isFridge) {
    const startNum = parseInt(start_location.substring(1));
    for (let i = 0; i < quantity; i++) {
      const slotNum = startNum + i;
      if (slotNum > 9) break;
      slots.push(`F${slotNum}`);
    }
  } else {
    const match = start_location.match(/R(\d+)C(\d+)/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid location format' });
    }
    
    let row = parseInt(match[1]);
    let col = parseInt(match[2]);
    
    for (let i = 0; i < quantity; i++) {
      const maxCol = row === 1 ? 7 : 9;
      if (col > maxCol) {
        row++;
        col = 1;
        if (row > 19) break;
      }
      slots.push(`R${row}C${col}`);
      col++;
    }
  }
  
  // Check which slots are empty
  const placeholders = slots.map(() => '?').join(',');
  const existingSlots = db.prepare(`
    SELECT location_code, wine_id FROM slots WHERE location_code IN (${placeholders})
  `).all(...slots);
  
  const emptySlots = slots.filter(loc => {
    const slot = existingSlots.find(s => s.location_code === loc);
    return slot && !slot.wine_id;
  });
  
  if (emptySlots.length < quantity) {
    return res.status(400).json({ 
      error: `Not enough consecutive empty slots. Found ${emptySlots.length}, need ${quantity}.`
    });
  }
  
  // Fill slots
  const slotsToFill = emptySlots.slice(0, quantity);
  const updateStmt = db.prepare('UPDATE slots SET wine_id = ? WHERE location_code = ?');
  
  for (const loc of slotsToFill) {
    updateStmt.run(wine_id, loc);
  }
  
  res.json({
    message: `Added ${slotsToFill.length} bottle(s)`,
    locations: slotsToFill
  });
});

export default router;
```

#### 1.6 Create src/routes/pairing.js

Extract pairing endpoints:

```javascript
/**
 * @fileoverview Pairing endpoints (manual and Claude-powered).
 * @module routes/pairing
 */

import { Router } from 'express';
import db from '../db/index.js';
import { getSommelierRecommendation } from '../services/claude.js';
import { scorePairing } from '../services/pairing.js';

const router = Router();

/**
 * Get pairing rules matrix.
 * @route GET /api/pairing/rules
 */
router.get('/rules', (req, res) => {
  const rules = db.prepare('SELECT * FROM pairing_rules ORDER BY food_signal, match_level').all();
  res.json(rules);
});

/**
 * Get pairing suggestions based on food signals.
 * @route POST /api/pairing/suggest
 */
router.post('/suggest', (req, res) => {
  const { signals, prefer_reduce_now = true, limit = 5 } = req.body;
  
  if (!signals || !Array.isArray(signals) || signals.length === 0) {
    return res.status(400).json({ error: 'Provide food signals array' });
  }
  
  const result = scorePairing(db, signals, prefer_reduce_now, limit);
  res.json(result);
});

/**
 * Natural language pairing via Claude.
 * @route POST /api/pairing/natural
 */
router.post('/natural', async (req, res) => {
  const { dish, source = 'all', colour = 'any' } = req.body;
  
  if (!dish || dish.trim().length === 0) {
    return res.status(400).json({ error: 'Please describe a dish' });
  }
  
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ 
      error: 'Sommelier feature requires API key configuration' 
    });
  }
  
  try {
    const result = await getSommelierRecommendation(db, dish, source, colour);
    res.json(result);
  } catch (error) {
    console.error('Sommelier API error:', error);
    res.status(500).json({ 
      error: 'Sommelier service error',
      message: error.message 
    });
  }
});

export default router;
```

#### 1.7 Create src/routes/reduceNow.js

Extract reduce-now endpoints:

```javascript
/**
 * @fileoverview Reduce-now list management.
 * @module routes/reduceNow
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * Get reduce-now list.
 * @route GET /api/reduce-now
 */
router.get('/', (req, res) => {
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

/**
 * Add wine to reduce-now list.
 * @route POST /api/reduce-now
 */
router.post('/', (req, res) => {
  const { wine_id, priority, reduce_reason } = req.body;
  
  db.prepare(`
    INSERT OR REPLACE INTO reduce_now (wine_id, priority, reduce_reason)
    VALUES (?, ?, ?)
  `).run(wine_id, priority || 3, reduce_reason || null);
  
  res.json({ message: 'Added to reduce-now' });
});

/**
 * Remove wine from reduce-now list.
 * @route DELETE /api/reduce-now/:wine_id
 */
router.delete('/:wine_id', (req, res) => {
  db.prepare('DELETE FROM reduce_now WHERE wine_id = ?').run(req.params.wine_id);
  res.json({ message: 'Removed from reduce-now' });
});

export default router;
```

#### 1.8 Create src/routes/stats.js

Extract stats and layout endpoints:

```javascript
/**
 * @fileoverview Statistics and layout endpoints.
 * @module routes/stats
 */

import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

/**
 * Get cellar statistics.
 * @route GET /api/stats
 */
router.get('/', (req, res) => {
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

/**
 * Get full cellar layout.
 * @route GET /api/layout
 */
router.get('/layout', (req, res) => {
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

  const layout = {
    fridge: { rows: [{ slots: [] }, { slots: [] }] },
    cellar: { rows: [] }
  };

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

/**
 * Get consumption log.
 * @route GET /api/consumption
 */
router.get('/consumption', (req, res) => {
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

export default router;
```

#### 1.9 Create src/services/claude.js

Extract Claude API logic:

```javascript
/**
 * @fileoverview Claude API integration for sommelier feature.
 * @module services/claude
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Get sommelier wine recommendation for a dish.
 * @param {Database} db - Database connection
 * @param {string} dish - Dish description
 * @param {string} source - 'all' or 'reduce_now'
 * @param {string} colour - 'any', 'red', 'white', or 'rose'
 * @returns {Promise<Object>} Sommelier recommendations
 */
export async function getSommelierRecommendation(db, dish, source, colour) {
  // Build wine query based on filters
  let wineQuery;
  let params = [];
  
  if (source === 'reduce_now') {
    wineQuery = `
      SELECT 
        w.id, w.wine_name, w.vintage, w.style, w.colour,
        COUNT(s.id) as bottle_count,
        GROUP_CONCAT(DISTINCT s.location_code) as locations,
        rn.priority, rn.reduce_reason
      FROM reduce_now rn
      JOIN wines w ON w.id = rn.wine_id
      LEFT JOIN slots s ON s.wine_id = w.id
      WHERE 1=1
    `;
    if (colour !== 'any') {
      wineQuery += ` AND w.colour = ?`;
      params.push(colour);
    }
    wineQuery += ` GROUP BY w.id HAVING bottle_count > 0 ORDER BY rn.priority, w.wine_name`;
  } else {
    wineQuery = `
      SELECT 
        w.id, w.wine_name, w.vintage, w.style, w.colour,
        COUNT(s.id) as bottle_count,
        GROUP_CONCAT(DISTINCT s.location_code) as locations
      FROM wines w
      LEFT JOIN slots s ON s.wine_id = w.id
      WHERE 1=1
    `;
    if (colour !== 'any') {
      wineQuery += ` AND w.colour = ?`;
      params.push(colour);
    }
    wineQuery += ` GROUP BY w.id HAVING bottle_count > 0 ORDER BY w.colour, w.style`;
  }
  
  const wines = db.prepare(wineQuery).all(...params);
  
  if (wines.length === 0) {
    return {
      dish_analysis: "No wines match your filters.",
      recommendations: [],
      no_match_reason: `No ${colour !== 'any' ? colour + ' ' : ''}wines found${source === 'reduce_now' ? ' in reduce-now list' : ''}.`
    };
  }
  
  // Format wines for prompt
  const winesList = wines.map(w => 
    `- ${w.wine_name} ${w.vintage || 'NV'} (${w.style}, ${w.colour}) - ${w.bottle_count} bottle(s) at ${w.locations}`
  ).join('\n');
  
  // Get priority wines if source is 'all'
  let prioritySection = '';
  if (source === 'all') {
    const priorityWines = db.prepare(`
      SELECT w.wine_name, w.vintage, rn.reduce_reason
      FROM reduce_now rn
      JOIN wines w ON w.id = rn.wine_id
      JOIN slots s ON s.wine_id = w.id
      ${colour !== 'any' ? 'WHERE w.colour = ?' : ''}
      GROUP BY w.id
      ORDER BY rn.priority
    `).all(colour !== 'any' ? [colour] : []);
    
    if (priorityWines.length > 0) {
      prioritySection = `\nPRIORITY WINES (these should be drunk soon - prefer if suitable):\n` +
        priorityWines.map(w => `- ${w.wine_name} ${w.vintage || 'NV'}: ${w.reduce_reason}`).join('\n');
    }
  }
  
  const sourceDesc = source === 'reduce_now' 
    ? 'Choosing only from priority wines that should be drunk soon'
    : 'Choosing from full cellar inventory';
  
  const colourDesc = {
    'any': 'No colour preference - suggest what works best',
    'red': 'Red wines only',
    'white': 'White wines only',
    'rose': 'Rosé wines only'
  }[colour];
  
  const prompt = buildSommelierPrompt(dish, sourceDesc, colourDesc, winesList, prioritySection);
  
  // Call Claude API
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });
  
  // Parse response
  const responseText = message.content[0].text;
  let parsed;
  
  try {
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || 
                      responseText.match(/```\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : responseText;
    parsed = JSON.parse(jsonStr.trim());
  } catch (parseError) {
    console.error('Failed to parse Claude response:', responseText);
    throw new Error('Could not parse sommelier response');
  }
  
  // Enrich recommendations with locations
  if (parsed.recommendations) {
    parsed.recommendations = parsed.recommendations.map(rec => {
      const wine = wines.find(w => 
        w.wine_name === rec.wine_name && 
        (w.vintage === rec.vintage || (!w.vintage && !rec.vintage))
      );
      return {
        ...rec,
        location: wine?.locations || 'Unknown',
        bottle_count: wine?.bottle_count || 0
      };
    });
  }
  
  return parsed;
}

/**
 * Build the sommelier prompt.
 * @private
 */
function buildSommelierPrompt(dish, sourceDesc, colourDesc, winesList, prioritySection) {
  return `You are a sommelier with 20 years in fine dining, now helping a home cook get the most from their personal wine cellar. Your style is warm and educational - you love sharing the "why" behind pairings, not just the "what".

Your approach:
- Match wine weight to dish weight (light with light, rich with rich)
- Balance acid: high-acid foods need high-acid wines
- Use tannins strategically: they cut through fat and protein
- Respect regional wisdom: "what grows together, goes together"
- Consider the full plate: sauces, sides, and seasonings matter
- Work with what's available, prioritising wines that need drinking soon

TASK:
Analyse this dish and extract food signals for wine pairing, then provide your recommendations.

DISH: ${dish}

AVAILABLE SIGNALS (use only these): chicken, pork, beef, lamb, fish, cheese, garlic_onion, roasted, sweet, acid, herbal, umami, creamy

USER CONSTRAINTS:
- Wine source: ${sourceDesc}
- Colour preference: ${colourDesc}

AVAILABLE WINES:
${winesList}
${prioritySection}

Respond in this JSON format only, with no other text:
{
  "signals": ["array", "of", "matching", "signals"],
  "dish_analysis": "Brief description of the dish's character and what to consider for pairing",
  "colour_suggestion": "If user selected 'any', indicate whether red or white would generally suit this dish better and why. If they specified a colour, either null or a diplomatic note if the dish would pair better with another colour.",
  "recommendations": [
    {
      "rank": 1,
      "wine_name": "Exact wine name from available list",
      "vintage": 2020,
      "why": "Detailed explanation of why this pairing works - discuss specific flavour interactions",
      "food_tip": "Optional suggestion to elevate the pairing (or null if none needed)",
      "is_priority": true
    }
  ],
  "no_match_reason": null
}

RULES:
- Only recommend wines from the AVAILABLE WINES list
- If source is "reduce_now only", all wines shown are priority - mention this is a great time to open them
- If fewer than 3 wines are suitable, return fewer recommendations and explain in no_match_reason
- Keep wine_name exactly as shown in the available list`;
}
```

#### 1.10 Create src/services/pairing.js

Extract pairing scoring logic:

```javascript
/**
 * @fileoverview Pairing scoring logic.
 * @module services/pairing
 */

/**
 * Score wines against food signals.
 * @param {Database} db - Database connection
 * @param {string[]} signals - Food signals
 * @param {boolean} preferReduceNow - Prioritise reduce-now wines
 * @param {number} limit - Max suggestions to return
 * @returns {Object} Pairing suggestions
 */
export function scorePairing(db, signals, preferReduceNow, limit) {
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
    ORDER BY ${preferReduceNow ? 'reduce_priority ASC,' : ''} w.vivino_rating DESC
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
    if (preferReduceNow && a.reduce_priority !== b.reduce_priority) {
      return a.reduce_priority - b.reduce_priority;
    }
    return b.style_score - a.style_score;
  });
  
  return {
    signals_used: signals,
    style_ranking: styleScores.slice(0, 5),
    suggestions: suggestions.slice(0, limit)
  };
}
```

#### 1.11 Update src/server.js

Slim down to just app setup:

```javascript
/**
 * @fileoverview Express server setup.
 * @module server
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from './routes/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api', routes);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Wine cellar app running on http://0.0.0.0:${PORT}`);
});
```

---

### Phase 2: Frontend Refactoring

#### 2.1 Create public/css/styles.css

Extract ALL CSS from index.html into this file. Copy the entire contents of the `<style>` tag.

#### 2.2 Create public/js/utils.js

```javascript
/**
 * @fileoverview Shared utility functions.
 * @module utils
 */

/**
 * Show a toast notification.
 * @param {string} message - Message to display
 */
export function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

/**
 * Shorten wine name to fit in slot.
 * @param {string} name - Full wine name
 * @returns {string} Shortened name
 */
export function shortenWineName(name) {
  if (!name) return '';
  return name
    .replace(/\b(Vineyard|Selection|Reserva?|Gran|Superior[e]?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 30);
}
```

#### 2.3 Create public/js/api.js

```javascript
/**
 * @fileoverview API wrapper for all backend calls.
 * @module api
 */

const API_BASE = '';

/**
 * Fetch cellar layout.
 * @returns {Promise<Object>}
 */
export async function fetchLayout() {
  const res = await fetch(`${API_BASE}/api/stats/layout`);
  return res.json();
}

/**
 * Fetch statistics.
 * @returns {Promise<Object>}
 */
export async function fetchStats() {
  const res = await fetch(`${API_BASE}/api/stats`);
  return res.json();
}

/**
 * Fetch reduce-now list.
 * @returns {Promise<Array>}
 */
export async function fetchReduceNow() {
  const res = await fetch(`${API_BASE}/api/reduce-now`);
  return res.json();
}

/**
 * Fetch all wines.
 * @returns {Promise<Array>}
 */
export async function fetchWines() {
  const res = await fetch(`${API_BASE}/api/wines`);
  return res.json();
}

/**
 * Fetch single wine.
 * @param {number} id - Wine ID
 * @returns {Promise<Object>}
 */
export async function fetchWine(id) {
  const res = await fetch(`${API_BASE}/api/wines/${id}`);
  return res.json();
}

/**
 * Search wines by name.
 * @param {string} query - Search query
 * @returns {Promise<Array>}
 */
export async function searchWines(query) {
  const res = await fetch(`${API_BASE}/api/wines/search?q=${encodeURIComponent(query)}`);
  return res.json();
}

/**
 * Move bottle between slots.
 * @param {string} from - Source location
 * @param {string} to - Target location
 * @returns {Promise<Object>}
 */
export async function moveBottle(from, to) {
  const res = await fetch(`${API_BASE}/api/slots/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from_location: from, to_location: to })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Move failed');
  }
  return res.json();
}

/**
 * Drink bottle from slot.
 * @param {string} location - Slot location
 * @param {Object} details - Consumption details
 * @returns {Promise<Object>}
 */
export async function drinkBottle(location, details = {}) {
  const res = await fetch(`${API_BASE}/api/slots/${location}/drink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(details)
  });
  return res.json();
}

/**
 * Get sommelier pairing recommendation.
 * @param {string} dish - Dish description
 * @param {string} source - 'all' or 'reduce_now'
 * @param {string} colour - 'any', 'red', 'white', 'rose'
 * @returns {Promise<Object>}
 */
export async function askSommelier(dish, source, colour) {
  const res = await fetch(`${API_BASE}/api/pairing/natural`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dish, source, colour })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Request failed');
  }
  return res.json();
}

/**
 * Get manual pairing suggestions.
 * @param {string[]} signals - Food signals
 * @returns {Promise<Object>}
 */
export async function getPairingSuggestions(signals) {
  const res = await fetch(`${API_BASE}/api/pairing/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signals, prefer_reduce_now: true, limit: 5 })
  });
  return res.json();
}
```

#### 2.4 Create public/js/grid.js

```javascript
/**
 * @fileoverview Cellar and fridge grid rendering.
 * @module grid
 */

import { shortenWineName } from './utils.js';
import { state } from './app.js';

/**
 * Render the fridge grid.
 */
export function renderFridge() {
  const grid = document.getElementById('fridge-grid');
  grid.innerHTML = '';
  
  state.layout.fridge.rows.forEach((row) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'fridge-row';
    
    row.slots.forEach(slot => {
      rowEl.appendChild(createSlotElement(slot));
    });
    
    grid.appendChild(rowEl);
  });
}

/**
 * Render the cellar grid.
 */
export function renderCellar() {
  const grid = document.getElementById('cellar-grid');
  grid.innerHTML = '';
  
  state.layout.cellar.rows.forEach((row) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'cellar-row';
    
    const label = document.createElement('div');
    label.className = 'row-label';
    label.textContent = `R${row.row}`;
    rowEl.appendChild(label);
    
    row.slots.forEach(slot => {
      rowEl.appendChild(createSlotElement(slot));
    });
    
    grid.appendChild(rowEl);
  });
}

/**
 * Create a slot DOM element.
 * @param {Object} slot - Slot data
 * @returns {HTMLElement}
 */
export function createSlotElement(slot) {
  const el = document.createElement('div');
  el.className = 'slot';
  el.dataset.location = slot.location_code;
  el.dataset.slotId = slot.slot_id;
  
  if (slot.wine_id) {
    el.classList.add(slot.colour || 'white');
    el.dataset.wineId = slot.wine_id;
    
    if (slot.reduce_priority) {
      el.classList.add(`priority-${Math.min(slot.reduce_priority, 3)}`);
    }
    
    const shortName = shortenWineName(slot.wine_name);
    
    el.innerHTML = `
      <div class="slot-name">${shortName}</div>
      <div class="slot-vintage">${slot.vintage || 'NV'}</div>
      <div class="slot-loc">${slot.location_code}</div>
    `;
  } else {
    el.classList.add('empty');
    el.innerHTML = `<div class="slot-loc">${slot.location_code}</div>`;
  }
  
  return el;
}
```

#### 2.5 Create public/js/modals.js

```javascript
/**
 * @fileoverview Modal management.
 * @module modals
 */

import { drinkBottle } from './api.js';
import { showToast } from './utils.js';
import { state, refreshData } from './app.js';

let currentSlot = null;

/**
 * Show wine detail modal.
 * @param {Object} slot - Slot data
 */
export function showWineModal(slot) {
  currentSlot = slot;
  
  document.getElementById('modal-wine-name').textContent = slot.wine_name;
  document.getElementById('modal-wine-style').textContent = 
    `${slot.style} • ${slot.vintage || 'NV'} • ${slot.colour}`;
  document.getElementById('modal-location').textContent = slot.location_code;
  document.getElementById('modal-rating').textContent = slot.rating ? `${slot.rating}/5` : '-';
  document.getElementById('modal-price').textContent = slot.price ? `€${slot.price.toFixed(2)}` : '-';
  
  const reduceField = document.getElementById('modal-reduce-field');
  if (slot.reduce_priority) {
    reduceField.style.display = 'block';
    document.getElementById('modal-reduce-reason').textContent = 
      `Priority ${slot.reduce_priority}: ${slot.reduce_reason || 'No reason specified'}`;
  } else {
    reduceField.style.display = 'none';
  }
  
  document.getElementById('modal-overlay').classList.add('active');
}

/**
 * Close wine detail modal.
 */
export function closeWineModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  currentSlot = null;
}

/**
 * Handle drink button click.
 */
export async function handleDrinkBottle() {
  if (!currentSlot) return;
  
  const location = currentSlot.location_code;
  
  try {
    const data = await drinkBottle(location);
    closeWineModal();
    showToast(`🍷 Enjoyed! ${data.remaining_bottles} bottles remaining`);
    await refreshData();
  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

/**
 * Initialise modal event listeners.
 */
export function initModals() {
  document.getElementById('btn-drink').addEventListener('click', handleDrinkBottle);
  document.getElementById('btn-close').addEventListener('click', closeWineModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeWineModal();
  });
}
```

#### 2.6 Create public/js/sommelier.js

```javascript
/**
 * @fileoverview Sommelier (Claude pairing) UI.
 * @module sommelier
 */

import { askSommelier, getPairingSuggestions } from './api.js';
import { showToast } from './utils.js';

let selectedSignals = new Set();

/**
 * Handle Ask Sommelier button click.
 */
export async function handleAskSommelier() {
  const dishInput = document.getElementById('dish-input');
  const dish = dishInput.value.trim();
  
  if (!dish) {
    showToast('Please describe a dish');
    return;
  }
  
  const source = document.querySelector('input[name="source"]:checked').value;
  const colour = document.querySelector('input[name="colour"]:checked').value;
  
  const btn = document.getElementById('ask-sommelier');
  const resultsContainer = document.getElementById('sommelier-results');
  
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Thinking...';
  resultsContainer.innerHTML = '<div class="sommelier-response"><p style="color: var(--text-muted);">The sommelier is considering your dish...</p></div>';
  
  try {
    const data = await askSommelier(dish, source, colour);
    renderSommelierResponse(data);
  } catch (err) {
    resultsContainer.innerHTML = `
      <div class="sommelier-response">
        <p style="color: var(--priority-1);">Error: ${err.message}</p>
      </div>
    `;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🍷 Ask Sommelier';
  }
}

/**
 * Render sommelier response.
 * @param {Object} data - Sommelier response data
 */
function renderSommelierResponse(data) {
  const container = document.getElementById('sommelier-results');
  
  let html = '<div class="sommelier-response">';
  
  if (data.dish_analysis) {
    html += `<div class="dish-analysis">${data.dish_analysis}</div>`;
  }
  
  if (data.colour_suggestion) {
    html += `<div class="colour-suggestion">${data.colour_suggestion}</div>`;
  }
  
  if (!data.recommendations || data.recommendations.length === 0) {
    html += `<div class="no-match"><p>No suitable wines found.</p></div>`;
  } else {
    data.recommendations.forEach(rec => {
      const priorityClass = rec.is_priority ? 'priority' : '';
      
      html += `
        <div class="recommendation ${priorityClass}">
          <div class="recommendation-header">
            <h4>#${rec.rank} ${rec.wine_name} ${rec.vintage || 'NV'}</h4>
            ${rec.is_priority ? '<span class="priority-badge">Drink Soon</span>' : ''}
          </div>
          <div class="location">📍 ${rec.location} (${rec.bottle_count} bottle${rec.bottle_count !== 1 ? 's' : ''})</div>
          <p class="why">${rec.why}</p>
          ${rec.food_tip ? `<div class="food-tip">${rec.food_tip}</div>` : ''}
        </div>
      `;
    });
  }
  
  html += '</div>';
  container.innerHTML = html;
}

/**
 * Toggle signal selection.
 * @param {HTMLElement} btn - Signal button
 */
export function toggleSignal(btn) {
  const signal = btn.dataset.signal;
  
  if (selectedSignals.has(signal)) {
    selectedSignals.delete(signal);
    btn.classList.remove('active');
  } else {
    selectedSignals.add(signal);
    btn.classList.add('active');
  }
}

/**
 * Handle manual pairing request.
 */
export async function handleGetPairing() {
  if (selectedSignals.size === 0) {
    showToast('Select at least one characteristic');
    return;
  }
  
  const data = await getPairingSuggestions(Array.from(selectedSignals));
  renderManualPairingResults(data);
}

/**
 * Render manual pairing results.
 * @param {Object} data - Pairing results
 */
function renderManualPairingResults(data) {
  const container = document.getElementById('pairing-results');
  
  if (!data.suggestions || data.suggestions.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted);">No matching wines found.</p>';
    return;
  }
  
  container.innerHTML = data.suggestions.map((wine, idx) => `
    <div class="pairing-suggestion">
      <div class="pairing-score">#${idx + 1}</div>
      <div style="flex: 1;">
        <div style="font-weight: 500;">${wine.wine_name} ${wine.vintage || 'NV'}</div>
        <div style="font-size: 0.85rem; color: var(--text-muted);">
          ${wine.style} • ${wine.bottle_count} bottle${wine.bottle_count > 1 ? 's' : ''}
        </div>
        <div style="font-size: 0.8rem; color: var(--accent);">${wine.locations}</div>
      </div>
    </div>
  `).join('');
}

/**
 * Clear signal selections.
 */
export function clearSignals() {
  selectedSignals.clear();
  document.querySelectorAll('.signal-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById('pairing-results').innerHTML = '<p style="color: var(--text-muted);">Select dish characteristics above</p>';
}

/**
 * Initialise sommelier event listeners.
 */
export function initSommelier() {
  document.getElementById('ask-sommelier')?.addEventListener('click', handleAskSommelier);
  document.getElementById('dish-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAskSommelier();
  });
  
  document.querySelectorAll('.signal-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleSignal(btn));
  });
  
  document.getElementById('get-pairing')?.addEventListener('click', handleGetPairing);
  document.getElementById('clear-signals')?.addEventListener('click', clearSignals);
}
```

#### 2.7 Create public/js/app.js

```javascript
/**
 * @fileoverview Main application initialisation and state.
 * @module app
 */

import { fetchLayout, fetchStats, fetchReduceNow, fetchWines } from './api.js';
import { renderFridge, renderCellar } from './grid.js';
import { initModals, showWineModal } from './modals.js';
import { initSommelier } from './sommelier.js';

/**
 * Application state.
 */
export const state = {
  layout: null,
  stats: null,
  currentView: 'grid'
};

/**
 * Load cellar layout.
 */
export async function loadLayout() {
  state.layout = await fetchLayout();
  renderFridge();
  renderCellar();
  setupSlotClickHandlers();
}

/**
 * Load statistics.
 */
export async function loadStats() {
  const stats = await fetchStats();
  state.stats = stats;
  document.getElementById('stat-total').textContent = stats.total_bottles;
  document.getElementById('stat-reduce').textContent = stats.reduce_now_count;
  document.getElementById('stat-empty').textContent = stats.empty_slots;
}

/**
 * Load reduce-now list.
 */
export async function loadReduceNow() {
  const list = await fetchReduceNow();
  renderReduceList(list);
}

/**
 * Load all wines.
 */
export async function loadWines() {
  const wines = await fetchWines();
  renderWineList(wines);
}

/**
 * Refresh all data.
 */
export async function refreshData() {
  await loadLayout();
  await loadStats();
}

/**
 * Render reduce-now list.
 * @param {Array} list - Reduce-now wines
 */
function renderReduceList(list) {
  const container = document.getElementById('reduce-list');
  
  if (list.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted);">No wines in reduce-now list</p>';
    return;
  }
  
  container.innerHTML = list.map(item => `
    <div class="reduce-item p${item.priority}">
      <div class="reduce-priority">${item.priority}</div>
      <div class="reduce-info">
        <div class="reduce-name">${item.wine_name} ${item.vintage || 'NV'}</div>
        <div class="reduce-meta">${item.style} • ${item.bottle_count} bottle${item.bottle_count > 1 ? 's' : ''}</div>
        <div class="reduce-meta">${item.reduce_reason || ''}</div>
        <div class="reduce-locations">${item.locations || ''}</div>
      </div>
    </div>
  `).join('');
}

/**
 * Render wine list.
 * @param {Array} wines - All wines
 */
function renderWineList(wines) {
  const container = document.getElementById('wine-list');
  const withBottles = wines.filter(w => w.bottle_count > 0);
  
  container.innerHTML = withBottles.map(wine => `
    <div class="wine-card ${wine.colour}">
      <div class="wine-count">${wine.bottle_count}</div>
      <div class="wine-details">
        <div class="wine-name">${wine.wine_name}</div>
        <div class="wine-meta">${wine.style} • ${wine.vintage || 'NV'}</div>
        <div class="wine-meta" style="color: var(--accent);">${wine.locations || ''}</div>
      </div>
    </div>
  `).join('');
}

/**
 * Setup slot click handlers.
 */
function setupSlotClickHandlers() {
  document.querySelectorAll('.slot').forEach(slot => {
    slot.addEventListener('click', (e) => {
      const slotEl = e.currentTarget;
      const wineId = slotEl.dataset.wineId;
      
      if (wineId) {
        // Find slot data from layout
        const allSlots = [
          ...state.layout.fridge.rows.flatMap(r => r.slots),
          ...state.layout.cellar.rows.flatMap(r => r.slots)
        ];
        const slotData = allSlots.find(s => s.location_code === slotEl.dataset.location);
        if (slotData) showWineModal(slotData);
      }
    });
  });
}

/**
 * Switch view.
 * @param {string} viewName - View to switch to
 */
function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  
  document.getElementById(`view-${viewName}`).classList.add('active');
  document.querySelector(`[data-view="${viewName}"]`).classList.add('active');
  
  state.currentView = viewName;
  
  if (viewName === 'reduce') loadReduceNow();
  if (viewName === 'wines') loadWines();
}

/**
 * Initialise application.
 */
async function init() {
  // Setup navigation
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });
  
  // Initialise modules
  initModals();
  initSommelier();
  
  // Load initial data
  await loadLayout();
  await loadStats();
}

// Start app when DOM ready
document.addEventListener('DOMContentLoaded', init);
```

#### 2.8 Update public/index.html

Strip down to HTML structure only:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wine Cellar</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/styles.css">
</head>
<body>
  <header>
    <h1>Wine Cellar</h1>
    <div class="stats" id="stats">
      <div class="stat">
        <div class="stat-value" id="stat-total">-</div>
        <div class="stat-label">Bottles</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="stat-reduce">-</div>
        <div class="stat-label">Reduce Now</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="stat-empty">-</div>
        <div class="stat-label">Empty Slots</div>
      </div>
    </div>
  </header>
  
  <nav class="tabs">
    <div class="tab active" data-view="grid">Cellar Grid</div>
    <div class="tab" data-view="reduce">Reduce Now</div>
    <div class="tab" data-view="wines">All Wines</div>
    <div class="tab" data-view="pairing">Find Pairing</div>
  </nav>
  
  <!-- Grid View -->
  <div class="view active" id="view-grid">
    <div class="fridge-section zone">
      <div class="zone-header">
        <span class="zone-title">Fridge</span>
      </div>
      <div class="fridge-grid" id="fridge-grid"></div>
    </div>
    
    <div class="zone">
      <div class="zone-header">
        <span class="zone-title">Cellar</span>
      </div>
      <div class="cellar-grid" id="cellar-grid"></div>
    </div>
  </div>
  
  <!-- Reduce Now View -->
  <div class="view" id="view-reduce">
    <h2 style="margin-bottom: 1rem;">Drink These Next</h2>
    <div class="reduce-list" id="reduce-list"></div>
  </div>
  
  <!-- All Wines View -->
  <div class="view" id="view-wines">
    <h2 style="margin-bottom: 1rem;">All Wines</h2>
    <div class="wine-list" id="wine-list"></div>
  </div>
  
  <!-- Pairing View -->
  <div class="view" id="view-pairing">
    <!-- Sommelier section -->
    <div class="natural-pairing">
      <h2 style="margin-bottom: 1rem;">Ask the Sommelier</h2>
      <input type="text" id="dish-input" placeholder="Describe your dish... e.g., 'grilled salmon with lemon butter'" />
      <div class="pairing-filters">
        <div class="filter-group">
          <span class="filter-label">Source:</span>
          <label><input type="radio" name="source" value="all" checked> All wines</label>
          <label><input type="radio" name="source" value="reduce_now"> Reduce-now only</label>
        </div>
        <div class="filter-group">
          <span class="filter-label">Colour:</span>
          <label><input type="radio" name="colour" value="any" checked> Any</label>
          <label><input type="radio" name="colour" value="red"> Red</label>
          <label><input type="radio" name="colour" value="white"> White</label>
          <label><input type="radio" name="colour" value="rose"> Rosé</label>
        </div>
      </div>
      <button class="btn btn-primary" id="ask-sommelier">🍷 Ask Sommelier</button>
    </div>
    
    <div id="sommelier-results"></div>
    
    <hr style="margin: 2rem 0; border-color: var(--border); opacity: 0.3;">
    
    <!-- Manual pairing section -->
    <div class="pairing-form">
      <h3 style="margin-bottom: 1rem;">Or select manually</h3>
      <h4 style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">PROTEIN</h4>
      <div class="signal-grid">
        <button class="signal-btn" data-signal="chicken">Chicken</button>
        <button class="signal-btn" data-signal="pork">Pork</button>
        <button class="signal-btn" data-signal="beef">Beef</button>
        <button class="signal-btn" data-signal="lamb">Lamb</button>
        <button class="signal-btn" data-signal="fish">Fish</button>
        <button class="signal-btn" data-signal="cheese">Cheese</button>
      </div>
      <h4 style="font-size: 0.8rem; color: var(--text-muted); margin: 1rem 0 0.5rem;">FLAVOURS</h4>
      <div class="signal-grid">
        <button class="signal-btn" data-signal="garlic_onion">Garlic/Onion</button>
        <button class="signal-btn" data-signal="herbal">Herbal</button>
        <button class="signal-btn" data-signal="roasted">Roasted</button>
        <button class="signal-btn" data-signal="acid">Acidic/Citrus</button>
        <button class="signal-btn" data-signal="sweet">Sweet</button>
        <button class="signal-btn" data-signal="umami">Umami</button>
        <button class="signal-btn" data-signal="creamy">Creamy</button>
      </div>
      <button class="btn btn-primary" style="margin-top: 1.5rem;" id="get-pairing">Find Pairing</button>
      <button class="btn btn-secondary" style="margin-top: 1.5rem;" id="clear-signals">Clear</button>
    </div>
    
    <h3 style="margin: 1.5rem 0 1rem;">Suggestions</h3>
    <div class="pairing-results" id="pairing-results">
      <p style="color: var(--text-muted);">Select dish characteristics above</p>
    </div>
  </div>
  
  <!-- Wine Detail Modal -->
  <div class="modal-overlay" id="modal-overlay">
    <div class="modal" id="wine-modal">
      <h2 id="modal-wine-name">Wine Name</h2>
      <div class="modal-subtitle" id="modal-wine-style">Style • Vintage</div>
      <div class="modal-field">
        <label>Location</label>
        <span id="modal-location">-</span>
      </div>
      <div class="modal-field">
        <label>Rating</label>
        <span id="modal-rating">-</span>
      </div>
      <div class="modal-field">
        <label>Price</label>
        <span id="modal-price">-</span>
      </div>
      <div class="modal-field" id="modal-reduce-field" style="display: none;">
        <label>Reduce Reason</label>
        <span id="modal-reduce-reason">-</span>
      </div>
      <div class="modal-actions">
        <button class="btn btn-danger" id="btn-drink">🍷 Drink This</button>
        <button class="btn btn-secondary" id="btn-close">Close</button>
      </div>
    </div>
  </div>
  
  <!-- Toast -->
  <div class="toast" id="toast"></div>
  
  <!-- Scripts -->
  <script type="module" src="/js/app.js"></script>
</body>
</html>
```

---

## Verification Checklist

After refactoring, verify:

- [ ] `npm start` runs without errors
- [ ] Cellar grid displays correctly
- [ ] Fridge grid displays correctly
- [ ] Can click bottle and see details modal
- [ ] Can drink bottle (logs consumption)
- [ ] Reduce Now tab loads list
- [ ] All Wines tab loads list
- [ ] Manual pairing works
- [ ] Sommelier (Claude) pairing works (if API key set)
- [ ] Stats update after drinking bottle
- [ ] No console errors in browser

---

## Notes

- Keep the original `server.js` and `index.html` as backups until verified
- Run `npm start` frequently during refactoring to catch errors early
- If ES modules cause issues, ensure `"type": "module"` is in `package.json`
- The `/api/layout` endpoint moved to `/api/stats/layout` - update the frontend API call accordingly
