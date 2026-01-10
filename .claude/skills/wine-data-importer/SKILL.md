---
name: wine-data-importer
description: Imports wine data from CSV files, spreadsheets, or structured text. Use when user mentions "import wines", "bulk import", "import from CSV", "import from spreadsheet", or "add wines from file".
allowed-tools: Read, Bash(node:*), Glob, Grep
---

# Wine Data Importer Skill

## Overview

Imports wine data from CSV files, spreadsheets (exported to CSV), or structured text into the wine cellar database. Handles column mapping, duplicate detection, data validation, and zone placement suggestions.

## When to Use

- Importing wine collections from spreadsheets
- Bulk adding wines from exported lists
- Migrating from another wine app
- User says: "import wines", "bulk import", "import from CSV", "add wines from file"

## Database Schema

Wines are stored in `wines` table:

```sql
-- Core wine fields
id SERIAL PRIMARY KEY,
wine_name TEXT NOT NULL,
producer TEXT,
vintage INTEGER,
country TEXT,
region TEXT,
grape_variety TEXT,
colour TEXT,              -- 'Red', 'White', 'Rosé', 'Sparkling', 'Dessert'
style TEXT,               -- More specific style description
price DECIMAL(10,2),
purchase_date DATE,
purchase_location TEXT,
notes TEXT,

-- Drinking window (optional)
drink_from INTEGER,       -- Year
drink_peak INTEGER,       -- Year
drink_until INTEGER,      -- Year

-- Rating fields (usually fetched later)
purchase_score INTEGER,   -- 0-100
star_rating DECIMAL(2,1), -- 0-5

-- Timestamps
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

Bottles are placed in `slots` table:

```sql
id SERIAL PRIMARY KEY,
location_code TEXT UNIQUE NOT NULL,  -- e.g., 'R1C1', 'R5C3', 'F1'
wine_id INTEGER REFERENCES wines(id),
wine_name TEXT,
added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

## Import Process

### Step 1: Analyze the Input File

Read the CSV/text file and identify:
1. Column headers (first row typically)
2. Delimiter (comma, tab, semicolon)
3. Quote character (usually double quotes)
4. Number of records

```javascript
// Common column name variations to recognize
const COLUMN_MAPPINGS = {
  wine_name: ['wine', 'wine_name', 'name', 'wine name', 'title'],
  producer: ['producer', 'winery', 'estate', 'domaine', 'chateau'],
  vintage: ['vintage', 'year', 'yr'],
  country: ['country', 'origin', 'nation'],
  region: ['region', 'appellation', 'area', 'sub-region'],
  grape_variety: ['grape', 'variety', 'varietal', 'grapes', 'grape_variety'],
  colour: ['colour', 'color', 'type', 'wine_type'],
  style: ['style', 'category'],
  price: ['price', 'cost', 'purchase_price', 'paid'],
  quantity: ['quantity', 'qty', 'bottles', 'count'],
  notes: ['notes', 'comments', 'description', 'tasting_notes'],
  drink_from: ['drink_from', 'ready', 'from'],
  drink_until: ['drink_until', 'drink_by', 'until', 'best_before'],
  location: ['location', 'bin', 'rack', 'position', 'slot']
};
```

### Step 2: Map Columns

Present the user with detected mappings and ask for confirmation:

```
Detected columns:
  - "Wine Name" → wine_name
  - "Producer" → producer
  - "Year" → vintage
  - "Color" → colour
  - "Price ($)" → price
  - "Qty" → quantity

Unmapped columns: "Rating", "Notes"
```

### Step 3: Validate Data

For each row, validate:

| Field | Validation | Action on Fail |
|-------|------------|----------------|
| wine_name | Required, non-empty | Skip row, report error |
| vintage | Integer 1900-current year | Set to NULL, warn |
| colour | One of: Red, White, Rosé, Sparkling, Dessert | Infer from grape/style, warn |
| country | Valid country name | Keep as-is, warn |
| price | Positive number | Set to NULL, warn |
| quantity | Positive integer | Default to 1 |

### Step 4: Detect Duplicates

Check for existing wines with matching:
- wine_name + vintage (exact match)
- wine_name (fuzzy match, Levenshtein distance < 3)

For each potential duplicate, offer:
1. **Skip** - Don't import this wine
2. **Add as new** - Import anyway (different vintage or variation)
3. **Update existing** - Merge data into existing record
4. **Add bottles only** - Wine exists, just add bottle slots

### Step 5: Suggest Zone Placement

Based on colour and style, suggest zones from `src/config/cellarZones.js`:

```javascript
// Zone suggestion logic
function suggestZone(wine) {
  // Use classifier from src/services/wineClassifier.js
  const classification = classifyWine(wine);
  return {
    primaryZone: classification.zone,
    confidence: classification.confidence,
    alternativeZones: classification.alternatives
  };
}
```

### Step 6: Generate Import Plan

Output a structured import plan:

```json
{
  "summary": {
    "total_rows": 50,
    "valid_wines": 47,
    "duplicates_found": 3,
    "bottles_to_add": 52,
    "errors": 0,
    "warnings": 5
  },
  "wines": [
    {
      "row": 2,
      "wine_name": "Kanonkop Paul Sauer",
      "producer": "Kanonkop",
      "vintage": 2019,
      "colour": "Red",
      "quantity": 2,
      "suggested_zone": "bordeaux_blend",
      "status": "new",
      "warnings": []
    },
    {
      "row": 3,
      "wine_name": "Kleine Zalze Chenin Blanc",
      "vintage": 2021,
      "status": "duplicate",
      "existing_wine_id": 45,
      "action": "add_bottles_only"
    }
  ],
  "errors": [],
  "warnings": [
    { "row": 5, "field": "vintage", "message": "Invalid year '20', assuming 2020" }
  ]
}
```

### Step 7: Execute Import

After user confirms the plan, execute:

1. Insert new wines into `wines` table
2. For each bottle (respecting quantity):
   - Find available slot in suggested zone
   - Insert into `slots` table
3. Return summary with new wine IDs

## API Endpoints Used

```javascript
// Add new wine
POST /api/wines
Body: { wine_name, producer, vintage, colour, ... }

// Add bottles to slots
POST /api/bottles/add
Body: { wineId, quantity, startLocation? }

// Check for existing wine
GET /api/wines/search?q={wine_name}&vintage={vintage}
```

## Output Format

Provide a clear summary to the user:

```
Import Complete!

Added: 45 wines (52 bottles)
Skipped: 3 duplicates
Updated: 2 existing wines

Zone Distribution:
  - Bordeaux Blends: 8 bottles
  - Chenin Blanc: 6 bottles
  - Pinot Noir: 5 bottles
  - Sauvignon Blanc: 4 bottles
  - ...

Warnings (5):
  - Row 5: Invalid vintage '20', assumed 2020
  - Row 12: Unknown country 'ZA', kept as-is
  - ...

New wines are ready for rating enrichment.
Run: /enrich-ratings to fetch scores from online sources.
```

## Common CSV Formats

### Vivino Export
```csv
Wine,Winery,Vintage,Region,Country,Average Rating,My Rating
```

### CellarTracker Export
```csv
Wine,Vintage,Locale,Country,Region,Producer,Type,Color,Category
```

### Generic Spreadsheet
```csv
Name,Producer,Year,Type,Price,Quantity,Notes
```

## Tips for Success

1. **Encoding**: Handle UTF-8 with BOM, Latin-1, Windows-1252
2. **Dates**: Parse various date formats (YYYY, MM/DD/YYYY, DD-MM-YY)
3. **Currency**: Strip currency symbols ($, €, £, R) from prices
4. **Quantities**: Look for "x2", "×3", "(6)" patterns in wine names
5. **Producer extraction**: If not separate, extract from wine name prefix

## Example Usage

User: "Import wines from my-cellar.csv"

Claude will:
1. Read the CSV file
2. Detect columns and show mapping
3. Validate all rows
4. Check for duplicates against existing cellar
5. Generate import plan with zone suggestions
6. After user approval, execute import
7. Report summary with any issues
