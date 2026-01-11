# MCP Server Testing Guide

This document provides test commands to verify each MCP server is working correctly.
Run these tests in Claude Code after restarting to ensure all MCP tools are available.

---

## 1. PDF Reader (`mcp__pdf-reader__read_pdf`)

### Test: Extract text from existing PDF
```
mcp__pdf-reader__read_pdf({
  sources: [{ path: "c:/GIT/wine-cellar-app/docs/suggested-wine-drinking-temperatures.pdf" }],
  include_full_text: true,
  include_metadata: true,
  include_page_count: true
})
```

**Expected Result:** Returns wine temperature guide text with metadata.

### Test: Extract specific pages from a PDF
```
mcp__pdf-reader__read_pdf({
  sources: [{ path: "path/to/multi-page.pdf", pages: "1-3" }],
  include_full_text: true
})
```

### Test: Extract images from PDF
```
mcp__pdf-reader__read_pdf({
  sources: [{ path: "path/to/document.pdf" }],
  include_images: true
})
```

---

## 2. Filesystem (`mcp__filesystem__*`)

### Test: List allowed directories
```
mcp__filesystem__list_allowed_directories()
```

**Expected Result:** Shows `c:/GIT/wine-cellar-app` as allowed.

### Test: Get directory tree
```
mcp__filesystem__directory_tree({
  path: "c:/GIT/wine-cellar-app/src",
  excludePatterns: ["node_modules"]
})
```

**Expected Result:** JSON tree of src/ directory structure.

### Test: Read a file
```
mcp__filesystem__read_text_file({
  path: "c:/GIT/wine-cellar-app/package.json"
})
```

### Test: Search for files
```
mcp__filesystem__search_files({
  path: "c:/GIT/wine-cellar-app",
  pattern: "**/*.test.js"
})
```

### Test: Get file info
```
mcp__filesystem__get_file_info({
  path: "c:/GIT/wine-cellar-app/src/server.js"
})
```

---

## 3. Memory (`mcp__memory__*`)

### Test: Read existing graph
```
mcp__memory__read_graph()
```

**Expected Result:** Returns current knowledge graph (may be empty on first run).

### Test: Create test entity
```
mcp__memory__create_entities({
  entities: [{
    name: "wine_cellar_project",
    entityType: "project",
    observations: [
      "Node.js Express backend",
      "PostgreSQL on Supabase",
      "Deployed on Railway",
      "Uses Claude API for AI features"
    ]
  }]
})
```

### Test: Search nodes
```
mcp__memory__search_nodes({ query: "wine" })
```

### Test: Create relations
```
mcp__memory__create_relations({
  relations: [{
    from: "wine_cellar_project",
    to: "user_preferences",
    relationType: "OWNED_BY"
  }]
})
```

### Test: Add observations to existing entity
```
mcp__memory__add_observations({
  observations: [{
    entityName: "wine_cellar_project",
    contents: ["Added MCP integration on 2026-01-10"]
  }]
})
```

---

## 4. Bright Data (`mcp__brightdata__*`)

### Test: Search engine (free tier)
```
mcp__brightdata__search_engine({
  query: "Kanonkop Pinotage 2021 wine review",
  engine: "google"
})
```

**Expected Result:** Search results with titles, URLs, and snippets.

### Test: Scrape as markdown (free tier)
```
mcp__brightdata__scrape_as_markdown({
  url: "https://www.wine-searcher.com/grape-pinotage"
})
```

**Expected Result:** Clean markdown content from the page.

### Test: Batch search (PRO_MODE)
```
mcp__brightdata__search_engine_batch({
  queries: [
    { query: "Stellenbosch wine region", engine: "google" },
    { query: "South African Chenin Blanc", engine: "google" }
  ]
})
```

### Test: Web data API - Amazon product (PRO_MODE)
```
mcp__brightdata__web_data_amazon_product({
  url: "https://www.amazon.com/dp/B08N5WRWNW"
})
```

### Test: Scraping browser snapshot (PRO_MODE)
```
mcp__brightdata__scraping_browser_navigate({ url: "https://www.vivino.com" })
mcp__brightdata__scraping_browser_snapshot({ filtered: true })
```

### Test: Session stats
```
mcp__brightdata__session_stats()
```

**Expected Result:** Shows tool usage during current session.

---

## Quick Verification Checklist

Run these minimal tests to verify all servers are connected:

| Server | Quick Test | Expected |
|--------|------------|----------|
| pdf-reader | Read temperature PDF | Text content returned |
| filesystem | List allowed directories | Shows project path |
| memory | Read graph | Returns JSON (may be empty) |
| brightdata | Search engine query | Returns search results |

---

## Troubleshooting

### "Tool not found" errors
1. Check `.mcp.json` has correct server config
2. Verify server is listed in `.claude/settings.local.json` → `enabledMcpjsonServers`
3. Restart Claude Code

### Bright Data authentication errors
1. Verify `API_TOKEN` in `.mcp.json` matches your Bright Data API key
2. Check `PRO_MODE` is set to `"true"` for advanced tools
3. Verify API key has sufficient credits

### Memory not persisting
1. Check `MEMORY_FILE_PATH` environment variable if using custom location
2. Default location is in the MCP server's working directory

### Filesystem permission errors
1. Ensure the path is within allowed directories
2. Check file/directory exists and is readable
