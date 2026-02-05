# MCP Use Cases for Wine Cellar Development

This document describes specific scenarios where MCP servers enhance the development workflow.

---

## PDF Reader Use Cases

### 1. Award Extraction from Competition Booklets
**Scenario:** Import wine awards from Michelangelo, Veritas, or Old Mutual trophy show PDFs.

```
mcp__pdf-reader__read_pdf({
  sources: [{ path: "awards/michelangelo-2024.pdf" }],
  include_full_text: true
})
```

**Workflow:**
1. Download competition PDF booklet
2. Use pdf-reader to extract text
3. Parse structured award data (wine name, producer, medal)
4. Insert into awards database

### 2. Technical Data Sheet Parsing
**Scenario:** Extract wine specs from producer tech sheets (ABV, residual sugar, pH, etc.)

```
mcp__pdf-reader__read_pdf({
  sources: [{ path: "tech-sheets/kanonkop-pinotage-2021.pdf" }],
  include_full_text: true,
  include_images: true
})
```

### 3. Restaurant Wine List Digitization
**Scenario:** Convert a restaurant's PDF wine list into structured data.

---

## Filesystem Use Cases

### 1. Codebase Structure Analysis
**Scenario:** Get a quick overview of project structure for documentation or onboarding.

```
mcp__filesystem__directory_tree({
  path: "c:/GIT/wine-cellar-app/src",
  excludePatterns: ["node_modules", "*.log"]
})
```

### 2. Find All Migration Files
**Scenario:** List all database migration files to understand schema history.

```
mcp__filesystem__search_files({
  path: "c:/GIT/wine-cellar-app/data/migrations",
  pattern: "**/*.sql"
})
```

### 3. Batch File Metadata Check
**Scenario:** Verify file sizes and modification dates for debugging.

```
mcp__filesystem__list_directory_with_sizes({
  path: "c:/GIT/wine-cellar-app/public/js",
  sortBy: "size"
})
```

---

## Memory Use Cases

### 1. Store User Wine Preferences
**Scenario:** Remember user's favourite wine styles, regions, and price ranges across sessions.

```
mcp__memory__create_entities({
  entities: [{
    name: "louis_wine_preferences",
    entityType: "user_profile",
    observations: [
      "Prefers South African wines",
      "Favourite grape: Pinotage",
      "Budget: R150-R400 per bottle",
      "Serves reds at 16-18°C",
      "Dislikes overly oaky Chardonnays"
    ]
  }]
})
```

### 2. Track Project Decisions
**Scenario:** Remember architectural decisions and their rationale.

```
mcp__memory__create_entities({
  entities: [{
    name: "decision_postgresql_migration",
    entityType: "architecture_decision",
    observations: [
      "Migrated from SQLite to PostgreSQL on 2026-01-05",
      "Reason: Railway deployment requires cloud database",
      "Using Supabase for managed PostgreSQL",
      "Kept SQLite support for local development"
    ]
  }]
})
```

### 3. Build Wine Knowledge Graph
**Scenario:** Create relationships between wines, producers, and regions.

```
mcp__memory__create_entities({
  entities: [
    { name: "Kanonkop", entityType: "producer", observations: ["Stellenbosch estate", "Famous for Pinotage"] },
    { name: "Kanonkop_Pinotage_2021", entityType: "wine", observations: ["94 points", "R450"] },
    { name: "Stellenbosch", entityType: "region", observations: ["South Africa", "Red wine focus"] }
  ]
})

mcp__memory__create_relations({
  relations: [
    { from: "Kanonkop_Pinotage_2021", to: "Kanonkop", relationType: "PRODUCED_BY" },
    { from: "Kanonkop", to: "Stellenbosch", relationType: "LOCATED_IN" }
  ]
})
```

### 4. Session Context Persistence
**Scenario:** Remember what was discussed in previous sessions.

```
mcp__memory__add_observations({
  observations: [{
    entityName: "current_development_context",
    contents: [
      "Working on zone reconfiguration feature",
      "GPT-5.2 reviewer integrated for validation",
      "Next: implement batch move with conflict detection"
    ]
  }]
})
```

---

## Bright Data Use Cases

### 1. Wine Rating Research
**Scenario:** Find ratings and reviews for wines not in our database.

```
mcp__brightdata__search_engine({
  query: "Meerlust Rubicon 2019 wine rating review",
  engine: "google"
})
```

### 2. Vivino Page Scraping
**Scenario:** Get structured wine data from Vivino when the API isn't available.

```
mcp__brightdata__scrape_as_markdown({
  url: "https://www.vivino.com/wines/1234567"
})
```

### 3. Competitor Price Research
**Scenario:** Check wine prices across multiple retailers.

```
mcp__brightdata__search_engine_batch({
  queries: [
    { query: "Kanonkop Pinotage 2021 price site:wine.co.za", engine: "google" },
    { query: "Kanonkop Pinotage 2021 price site:cybercellar.co.za", engine: "google" },
    { query: "Kanonkop Pinotage 2021 price site:normangoodies.com", engine: "google" }
  ]
})
```

### 4. Wine News Monitoring
**Scenario:** Find recent news about South African wine industry.

```
mcp__brightdata__search_engine({
  query: "South African wine awards 2025 results",
  engine: "google"
})
```

### 5. Browser Automation for Dynamic Sites
**Scenario:** Scrape JavaScript-rendered wine data from SPAs.

```
// Navigate to page
mcp__brightdata__scraping_browser_navigate({ url: "https://www.vivino.com/search/wines?q=pinotage" })

// Wait for content to load and get snapshot
mcp__brightdata__scraping_browser_snapshot({ filtered: true })

// Take screenshot for verification
mcp__brightdata__scraping_browser_screenshot({ full_page: false })
```

### 6. Structured E-commerce Data
**Scenario:** Get product details from Amazon wine listings.

```
mcp__brightdata__web_data_amazon_product({
  url: "https://www.amazon.com/dp/B08N5WRWNW"
})
```

---

## Combined Workflows

### Award Import Pipeline
1. **PDF Reader:** Extract text from competition PDF
2. **Memory:** Store extraction metadata and progress
3. **Bright Data:** Lookup missing wine details (ratings, prices)
4. **Filesystem:** Check existing migration files before schema changes

### Wine Research Workflow
1. **Memory:** Check if wine was researched before
2. **Bright Data:** Search for current ratings and reviews
3. **Memory:** Store new findings in knowledge graph
4. **Filesystem:** Generate report or update documentation

### Cellar Analysis Enhancement
1. **Memory:** Load user preferences from knowledge graph
2. **Bright Data:** Fetch current market prices for inventory valuation
3. **PDF Reader:** Import drinking window charts from sommelier guides

---

## When NOT to Use MCP

| Task | Don't Use MCP | Use Instead |
|------|---------------|-------------|
| Read source files during coding | mcp__filesystem | Built-in `Read` tool |
| Edit code files | mcp__filesystem | Built-in `Edit` tool |
| Search code patterns | mcp__filesystem | Built-in `Grep`/`Glob` |
| Simple HTTP fetch | mcp__brightdata | Built-in `WebFetch` |
| Git operations | Any MCP | Built-in `Bash` with git |

**Rule of thumb:** Use MCP for specialized tasks (PDFs, persistent memory, protected sites). Use built-in tools for standard development operations.
