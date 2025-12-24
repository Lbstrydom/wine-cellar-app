# Claude Code Task: Implement Phase 8 - Rating Search Improvements

## Context

The wine rating search system works but has performance and coverage issues:
- 15-25 seconds per wine is too slow for interactive use
- No caching - identical searches re-run the full pipeline
- Missing premium critics (Parker, Jancis, Vinous, Suckling)
- Inconsistent error handling for blocked/paywalled sites
- "Inferred" vintage matches are inappropriate for age-worthy wines

## Instructions

Read `PHASE8_SEARCH_IMPROVEMENTS.md` in this project. It contains:
- Multi-tier caching layer (SERP, page, extraction)
- Background job queue with progress tracking
- Premium source definitions
- Vintage sensitivity configuration
- Standardised fetch result classification
- Dynamic extraction prompt with score format injection

Execute in order:

### Task 1: Database
1. Create migration `migrations/009_search_cache.sql` with:
   - `search_cache` table (SERP results)
   - `page_cache` table (fetched page content)
   - `extraction_cache` table (Claude results)
   - `job_queue` table (background jobs)
   - `job_history` table (completed jobs)
   - `cache_config` table (TTL settings)

### Task 2: Cache Service
1. Create `src/services/cacheService.js` with cache operations
2. Integrate caching into `searchProviders.js` fetch flow

### Task 3: Job Queue
1. Create `src/services/jobQueue.js` with EventEmitter-based queue
2. Create `src/jobs/ratingFetchJob.js` for single wine fetch
3. Create `src/jobs/batchFetchJob.js` for batch processing
4. Register handlers in server startup

### Task 4: Classification & Config
1. Create `src/services/fetchClassifier.js` for result classification
2. Create `src/config/scoreFormats.js` with normalisation rules
3. Create `src/config/vintageSensitivity.js` with wine type rules

### Task 5: Source Registry
1. Update `sourceRegistry.js` with premium critics (Parker, Jancis, Vinous, Suckling, Wine Spectator)
2. Add additional regional sources (Falstaff, Vinum, Revista de Vinhos)

### Task 6: API & Frontend
1. Add async endpoints to `routes/ratings.js`:
   - `POST /api/wines/:id/ratings/fetch-async` → returns job ID
   - `POST /api/ratings/batch-fetch` → batch job
   - `GET /api/jobs/:id/status` → job progress
2. Update `public/js/ratings.js` with polling UI
3. Add progress bar HTML/CSS

### Task 7: Integration
1. Update `claude.js` to use dynamic prompt builder with score formats
2. Apply vintage sensitivity filtering to extraction results
3. Wire up cache checks before each pipeline stage

## Constraints

- Preserve existing synchronous fetch endpoint for backwards compatibility
- Cache failures gracefully - if cache unavailable, proceed without it
- Job queue should be in-process (no external Redis/RabbitMQ required)
- Progress updates every 5-10% minimum

## Output

Provide:
1. List of files created/modified
2. Cache TTL defaults applied
3. Sample async fetch flow trace
4. Any assumptions made
