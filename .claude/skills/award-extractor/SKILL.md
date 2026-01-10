---
name: award-extractor
description: Extracts wine awards from PDF documents. Use when importing competition results, processing wine ratings, or when user mentions "extract awards", "parse awards PDF", "import competition results", or "process wine ratings booklet".
allowed-tools: Read, Bash(node:*), Bash(sqlite3:*), mcp__pdf-reader__*, mcp__sqlite__*
---

# Wine Award Extraction Skill

## Overview

Extracts structured wine award data from PDF competition booklets, rating guides, and certification documents for import into the wine cellar app's awards database.

## When to Use

- Importing awards from competition PDFs (IWSC, Decanter World Wine Awards, etc.)
- Processing wine rating booklets (Wine Spectator, Wine Enthusiast)
- Batch-importing multiple award documents
- User says: "extract awards", "import competition results", "process this awards PDF"

## Database Schema

Awards are stored in `data/awards.db` with this structure:

```sql
CREATE TABLE awards (
  id INTEGER PRIMARY KEY,
  wine_name TEXT NOT NULL,
  producer TEXT,
  vintage INTEGER,
  country TEXT,
  region TEXT,
  grape_variety TEXT,
  award_name TEXT NOT NULL,        -- e.g., "IWSC 2024"
  medal TEXT,                       -- Gold, Silver, Bronze, Trophy
  score INTEGER,                    -- Points (if applicable)
  category TEXT,                    -- Competition category
  source_file TEXT,                 -- Original PDF filename
  extracted_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

## Extraction Process

### Step 1: Read the PDF

Use the PDF Reader MCP to extract text content:

```
Use mcp__pdf-reader__read_pdf tool with the PDF file path
```

### Step 2: Identify Document Structure

Look for common patterns in wine competition PDFs:
- **Table format**: Rows with Wine | Producer | Medal | Score columns
- **Category sections**: Headers like "CABERNET SAUVIGNON", "SOUTH AFRICAN REDS"
- **Award indicators**: Gold/Silver/Bronze, Trophy, points (90-100 scale)
- **Vintage patterns**: 4-digit years (2018, 2019, 2020, etc.)

### Step 3: Extract Award Data

For each wine entry, extract:

| Field | Description | Examples |
|-------|-------------|----------|
| wine_name | Full wine name | "Kanonkop Paul Sauer" |
| producer | Winery/producer | "Kanonkop" |
| vintage | Year of wine | 2019 |
| country | Country of origin | "South Africa" |
| region | Wine region | "Stellenbosch" |
| grape_variety | Grape(s) | "Cabernet Sauvignon Blend" |
| award_name | Competition + year | "IWSC 2024" |
| medal | Medal type | "Gold", "Silver", "Bronze", "Trophy" |
| score | Points if given | 95 |
| category | Competition category | "Red Bordeaux Blends over $20" |

### Step 4: Validate and Match

Before importing:
1. Check for duplicate entries in awards.db
2. Cross-reference producer names with existing cellar entries
3. Normalize medal names (GOLD -> Gold, G -> Gold)
4. Verify vintage years are reasonable (1950-current year)

### Step 5: Import to Database

Use the SQLite MCP to insert awards:

```sql
INSERT INTO awards (wine_name, producer, vintage, country, region,
                    grape_variety, award_name, medal, score, category, source_file)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
```

## Output Format

Return extracted awards as JSON array:

```json
[
  {
    "wine_name": "Kanonkop Paul Sauer",
    "producer": "Kanonkop",
    "vintage": 2019,
    "country": "South Africa",
    "region": "Stellenbosch",
    "grape_variety": "Cabernet Sauvignon Blend",
    "award_name": "Decanter World Wine Awards 2024",
    "medal": "Gold",
    "score": 95,
    "category": "Red Bordeaux Blends - South Africa"
  }
]
```

## Common Competition Formats

### IWSC (International Wine & Spirit Competition)
- Categories by grape variety and country
- Medals: Trophy, Gold Outstanding, Gold, Silver, Bronze
- No numeric scores

### Decanter World Wine Awards
- Regional categories
- Medals: Best in Show, Platinum, Gold, Silver, Bronze
- Points: 95-100 (Platinum), 90-94 (Gold), etc.

### Tim Atkin South Africa Report
- Wines rated on 100-point scale
- Categories by region and style
- First Growths, Wines of Origin designations

### Platter's South African Wine Guide
- 5-star rating system
- Wines organized by producer
- Includes drinking windows

## Tips for Accuracy

1. **Table extraction**: Look for consistent column spacing or delimiters
2. **Multi-page handling**: Track category headers across page breaks
3. **OCR artifacts**: Handle common OCR errors (0 vs O, l vs 1)
4. **Partial data**: Flag entries missing critical fields for review
5. **Duplicate detection**: Use wine_name + vintage + award_name as unique key

## Example Usage

User: "Extract awards from this IWSC 2024 booklet"

Claude will:
1. Use pdf-reader MCP to extract text from the PDF
2. Parse the table structure to identify wine entries
3. Extract medal, producer, wine name, vintage for each entry
4. Validate data and check for duplicates
5. Insert into awards.db using sqlite MCP
6. Report summary: "Extracted 147 awards, 3 duplicates skipped"
