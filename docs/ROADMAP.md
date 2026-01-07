# Wine Cellar App - Future Roadmap
## Updated: 7 January 2026

---

## Current Status: Production Ready

All major development phases are **complete**. The app is deployed and running in production on Railway + Supabase PostgreSQL.

| Phase | Status | Completed |
|-------|--------|-----------|
| Phase 1: Testing & Architecture | ✅ Complete | Jan 2026 |
| Phase 2: Performance & Scale | ✅ Complete | Jan 2026 |
| Phase 3: UX Polish | ✅ Complete | Jan 2026 |
| Phase 4: AI Enhancements | ✅ Complete | Jan 2026 |
| Phase 5: PWA & Deployment | ✅ Complete | Jan 2026 |
| Phase 6: MCP Integration | ✅ Complete | Jan 2026 |
| Phase 7: Sommelier-Grade Organisation | ✅ Complete | Jan 2026 |
| Phase 8: Production Hardening | ✅ Complete | Jan 2026 |

See [STATUS.md](STATUS.md) for complete documentation of implemented features.

---

## Future Features (When Needed)

### 1. Wine Confirmation Modal

**Priority**: P2 (nice-to-have)
**Status**: Planned

**Why**: Prevent incorrect wine matches when adding bottles. Show Vivino-style confirmation with alternatives before saving.

**User Flow**:
1. User uploads image/pastes text
2. Claude parses wine details
3. Search Vivino for matching wines
4. Show confirmation modal with alternatives
5. User selects correct match
6. Save with Vivino ID for accurate ratings

**Key Components**:
- `src/services/vivinoSearch.js` - Vivino API search integration
- `public/js/bottles/confirmation.js` - Confirmation modal UI
- Bright Data Web Unlocker for Vivino API access

---

### 2. Play Store Release (TWA)

**Priority**: P3 (when ready for public release)
**Status**: Ready when needed

**Prerequisites** (all met):
- ✅ PWA passing Lighthouse audit (95+)
- ✅ HTTPS deployment
- ✅ Service worker for offline support
- ✅ Manifest with icons

**Steps**:
1. Use **Bubblewrap** CLI to generate TWA wrapper
2. Add `assetlinks.json` for domain verification
3. Generate signed APK
4. Submit to Google Play Console
5. Fill store listing (description, screenshots, etc.)

---

### 3. Multi-User Authentication

**Priority**: P4 (future consideration)
**Status**: Deferred

**Why Defer**:
- Current single-user deployment works well
- No need for multi-user yet
- Adds complexity and cost

**When to Implement**:
- After validating with alpha testers (friends/family)
- If planning commercial release
- When need for data sync across devices arises

**Options**:
- Supabase Auth (already using Supabase for DB)
- Auth0
- Firebase Auth

---

### 4. Barcode Scanning

**Priority**: P4 (future consideration)
**Status**: Not started

**Why**: Quick wine lookup via UPC/EAN barcode scanning.

**Implementation Options**:
- QuaggaJS (browser-based)
- Camera API + external barcode service
- Integration with wine database APIs

---

## Technical Debt (Low Priority)

### Frontend Event Listener Cleanup (8.6)

**Problem**: Event listeners in frontend modules could benefit from cleanup functions.

**Impact**: Low - no user-visible issues, good practice for large apps.

**Solution**: Add `cleanup()` functions to each frontend module.

**Status**: Optional improvement

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Test coverage | 85% services | Maintain 85%+ |
| Lighthouse PWA score | 95+ | Maintain 95+ |
| Search latency (1000 wines) | <50ms | <50ms |
| List scroll FPS | 60fps | 60fps |
| Accessibility score | 95+ | 95+ |

---

## Development Philosophy

**Current Approach**:
- ✅ Building for personal use first
- ✅ Alpha testing with friends/family
- ✅ Server-side scraping (partner-ready data practices)
- ✅ PostgreSQL production database

**Future Vision**:
- Public Play Store release when ready
- Partnerships with rating providers
- Freemium model (basic free, premium features)
- Multi-user support when needed

---

## Documentation

See also:
- [STATUS.md](STATUS.md) - Complete feature documentation
- [CLAUDE.md](../CLAUDE.md) - AI assistant and deployment guidelines
- [AGENTS.md](../AGENTS.md) - Coding standards and conventions

---

*Last updated: 7 January 2026*
