# Phase 6 Observability Enhancements - Implementation Summary

**Date**: January 17, 2026  
**Status**: ✅ Completed

## Overview

Enhanced the search pipeline observability layer with accuracy metrics tracking and identity provenance diagnostics, completing Phase 6 of the SEARCH_REDESIGN plan.

## What Was Implemented

### 1. Accuracy Metrics Schema (Migration 046)

Added three new columns to `search_metrics` table:
- `vintage_mismatch_count` - Track ratings where vintage differs from wine vintage
- `wrong_wine_count` - Track user corrections flagged as "wrong wine"
- `identity_rejection_count` - Track ratings rejected by identity validation

**Files Changed**:
- `data/migrations/046_accuracy_metrics.sql` - Migration script
- `data/schema.postgres.sql` - Updated base schema

### 2. Accuracy Metrics Service

Created `src/services/accuracyMetrics.js` with utilities:
- `calculateAccuracyMetrics(ratings, rejected)` - Calculate metrics from rating batch
- `getWrongWineCorrections(db, cellarId, since)` - Query user corrections
- `getVintageMismatchRate(db, cellarId, daysBack)` - Calculate mismatch rate over time

### 3. Enhanced Metrics Recording

**Updated `src/routes/searchMetrics.js`**:
- `POST /api/metrics/search/record` - Now accepts `accuracy` object in request body
- Persists accuracy fields to database
- Added `GET /api/metrics/search/accuracy` - Aggregate accuracy stats by cellar

**Updated `src/services/wineAddOrchestrator.js`**:
- `recordSearchMetrics()` now inserts accuracy fields
- Metrics snapshots include vintage mismatch, wrong wine, and rejection counts

### 4. Identity Provenance Diagnostics

**New endpoint in `src/routes/ratings.js`**:
- `GET /api/ratings/:wineId/identity-diagnostics` - Full provenance report per wine
  - Returns all ratings with identity validation metadata
  - Shows `identity_score`, `identity_reason`, `vintage_match`, `match_confidence`
  - Includes summary statistics (exact/inferred vintages, confidence distribution)
  - Exposes evidence excerpts and matched labels for debugging

## API Usage Examples

### Record Search Metrics with Accuracy
```javascript
POST /api/metrics/search/record
{
  "summary": { "totalDuration": 3200, "costCents": 12 },
  "apiCalls": { "serpCalls": 1, "unlockerCalls": 2, "claudeExtractions": 1 },
  "cache": { "hits": 3, "misses": 2, "hitRate": 0.6 },
  "accuracy": {
    "vintageMismatchCount": 1,
    "wrongWineCount": 0,
    "identityRejectionCount": 2
  }
}
```

### Get Accuracy Stats
```bash
GET /api/metrics/search/accuracy

Response:
{
  "data": {
    "total_searches": 42,
    "total_vintage_mismatches": 8,
    "total_wrong_wines": 1,
    "total_identity_rejections": 15,
    "avg_vintage_mismatch_rate": "0.0476",  // 4.76%
    "searches_with_mismatches": 6
  }
}
```

### Get Identity Diagnostics for Wine
```bash
GET /api/ratings/123/identity-diagnostics

Response:
{
  "data": {
    "wine": {
      "id": 123,
      "name": "Kanonkop Paul Sauer",
      "vintage": 2019,
      "producer": "Kanonkop"
    },
    "summary": {
      "total_ratings": 5,
      "exact_vintage_matches": 4,
      "inferred_vintage_matches": 1,
      "high_confidence": 3,
      "medium_confidence": 2,
      "low_confidence": 0,
      "avg_identity_score": "4.80"
    },
    "ratings": [
      {
        "source": "wine_spectator",
        "lens": "panel",
        "score": "94",
        "normalized": 94.0,
        "vintage_match": "exact",
        "confidence": "high",
        "identity_score": 5,
        "identity_reason": "producer+vintage+range",
        "url": "https://...",
        "evidence": "Kanonkop Paul Sauer 2019 - Rich, complex Bordeaux blend...",
        "matched_label": "Kanonkop Paul Sauer 2019",
        "fetched_at": "2026-01-17T10:30:00Z"
      }
    ]
  }
}
```

## Integration Points

### Rating Fetch Flow
When ratings are fetched and validated:
1. `validateRatingsIdentity()` in `ratings.js` returns `{ ratings, rejected }`
2. Call `calculateAccuracyMetrics(ratings, rejected)` from `accuracyMetrics.js`
3. Include result in `recordSearchMetrics()` call

### Example Integration
```javascript
import { calculateAccuracyMetrics } from './services/accuracyMetrics.js';

// After fetching and validating ratings
const { ratings, rejected } = await validateRatingsIdentity(rawRatings, wine);
const accuracyMetrics = calculateAccuracyMetrics(ratings, rejected);

// Record metrics with accuracy data
await recordSearchMetrics(cellarId, fingerprint, {
  latencyMs: duration,
  costCents: totalCost,
  extractionMethod: 'serp_ai',
  matchConfidence: 0.85,
  ...accuracyMetrics
});
```

## Testing

**Unit Tests**: ✅ All 828 tests passing  
**Migration**: ✅ Applied successfully (046_accuracy_metrics.sql)  
**Integration**: ✅ Endpoints validated with integration tests

## Current Phase Status

**Phase 6: Observability** - ✅ **COMPLETED**

Implemented items from SEARCH_REDESIGN.md Phase 6:
- ✅ Add search_id tracking across stages (existing)
- ✅ Add per-category success metrics (search_metrics table)
- ✅ Add identity validation failure logging (identity provenance)
- ✅ Add accuracy metrics (vintage mismatch, wrong wine corrections)
- 🔲 Build search diagnostics UI (future frontend work)

## Success Metrics Tracking

Now tracking these SEARCH_REDESIGN metrics:
- **Vintage mismatch rate**: Target < 3%, calculated via `avg_vintage_mismatch_rate`
- **Wrong wine corrections**: Target < 1%, tracked via `wrong_wine_count`
- **Identity rejection count**: Tracks ratings rejected by validation gate

## Next Steps (Optional)

1. **Frontend Integration**:
   - Add identity diagnostics panel to wine detail view
   - Display accuracy stats in admin dashboard
   - Show confidence indicators on rating badges

2. **Alerting**:
   - Alert when `avg_vintage_mismatch_rate` exceeds 5%
   - Weekly report of identity rejection patterns

3. **Backfill**:
   - Run identity validation on existing ratings
   - Flag historical data quality issues

## Files Modified

### Created
- `data/migrations/046_accuracy_metrics.sql`
- `src/services/accuracyMetrics.js`

### Modified
- `data/schema.postgres.sql`
- `src/routes/searchMetrics.js`
- `src/routes/ratings.js`
- `src/services/wineAddOrchestrator.js`

## Migration Instructions

```bash
# Apply migration
node scripts/run-migrations.js 046

# Verify schema
psql $DATABASE_URL -c "\d search_metrics"

# Test accuracy endpoint
curl -H "Authorization: Bearer $TOKEN" \
     -H "X-Cellar-ID: $CELLAR_ID" \
     https://cellar.creathyst.com/api/metrics/search/accuracy
```

## Documentation References

- Phase 6 plan: `docs/SEARCH_REDESIGN.md` (lines 382-407)
- Identity scoring: `docs/SEARCH_REDESIGN.md` (Appendix B)
- Metrics schema: `docs/SEARCH_REDESIGN.md` (Appendix E)
