# Plan Audit Report: Area-Aware Slot Operations (Multi-Storage Phase 1–3)

- **Plan**: `docs/plans/area-aware-slot-operations.md` + companion `docs/plans/area-aware-slot-operations-frontend.md`
- **Plan Type**: Full-Stack (backend + frontend, multi-phase)
- **Date**: 2026-03-06
- **Auditor**: Claude

---

## Verdict

**NEEDS REVISION** — 3 HIGH, 5 MEDIUM, 4 LOW findings

The plan is exceptionally thorough — among the best-structured plans I have audited. Phase 1 is fully
implemented and shipped. Phase 2 and the companion frontend plan are well-specified with exact file
paths, function names, data flow diagrams, and a clear implementation order. However, there are
three HIGH-severity issues that must be resolved before implementation proceeds: a stale migration
number, a missing `pairing.js` deferral in the companion plan that contradicts the main plan, and
an ambiguity in Fix D's treatment of the existing codebase path for `countColourFamilies`.

---

## Summary

- **Structural Completeness**: 7/7 sections present (main plan), 9/9 sections present (frontend companion)
- **Principle Coverage**: 92% of applicable principles addressed
- **Specificity Score**: High — every file has exact path, function names, and dependencies
- **Sustainability Assessment**: Strong — assumptions, extension points, and change scenarios documented
- **HIGH findings**: 3
- **MEDIUM findings**: 5
- **LOW findings**: 4

---

## Findings

### HIGH Severity

#### [H1] Fix D Migration Number Collision: `040` is already taken

- **Section**: Phase 2, Fix D.1 — `data/migrations/040_storage_area_colour_zone.sql`
- **Detail**: The plan specifies migration `040` with the note "slot 040 is available" because the
  Phase 1 constraint migration was obsoleted. However, `040_producer_crawler.sql` already exists in
  `data/migrations/`. The latest migration is `065_cellar_zone_config.sql`. The next valid number
  is **066**.
- **Risk**: The migration runner executes files in numeric order. A second `040_*.sql` migration
  would either fail (if the runner detects duplicates) or execute out-of-order relative to columns
  and tables created in 041–065, causing schema dependency errors.
- **Recommendation**: Rename to `066_storage_area_colour_zone.sql`. Update all references in the
  plan to use `066`.

#### [H2] Frontend Companion Plan: `pairing.js` deferral contradicts main plan

- **Section**: Frontend companion §7 (Risk & Trade-off Register) — "Deliberately Deferred" AND
  main plan §4.15
- **Detail**: The **main plan** (§4.15) specifies `pairing.js` as a Phase 1 file modification:
  > "Backend: pairing response includes `storage_area_id` per recommendation location.
  > Frontend: extract `storage_area_id` from `rec` and pass to `drinkBottle()` call."

  The **frontend companion plan** (§7 Deliberately Deferred) lists `pairing.js` area enrichment
  as deferred:
  > "`pairing.js` area enrichment — Multi-slot wines need slot-specific user intent — Phase 2+
  > (if pairing UI gets per-slot drink buttons)"

  These two plans contradict each other. The main plan says Phase 1 handles `pairing.js`; the
  companion plan (which is Phase 2 Fix A scope) says it is *not* in scope and deferred.

  Given that the companion plan's audit (§1) shows `pairing.js` already uses `resolveAreaFromSlot()`
  as the intentional strategy, the deferral seems correct — but the main plan's Phase 1 §4.15
  should be explicitly updated to mark `pairing.js` as "deferred to Phase 2+" with a rationale.
- **Risk**: A developer following the main plan §4.15 may implement `pairing.js` changes in Phase 1
  scope, wasting effort on a path that the companion plan explicitly decided against.
- **Recommendation**: Update main plan §4.15 to add a "**Deferred**" annotation with the companion
  plan's rationale. Remove `pairing.js` from the Phase 1 Files Summary (§8) or mark it as
  "Deferred — backend resolves via fallback (see companion plan §7)."

#### [H3] Fix D.3: `countColourFamilies` area filter — SQL not specified

- **Section**: Phase 2, Fix D.3
- **Detail**: The plan says `countColourFamilies` will gain an optional `storageAreaId` parameter
  that adds `AND s.storage_area_id = $2`. But the current function (line 124 of
  `cellarLayoutSettings.js`) joins through `slots → wines` and filters by `cellar_id`. The plan
  provides a one-line pseudocode addition but **does not specify**:
  1. Whether the area filter goes on the `slots` table or a joined table
  2. What happens to the outer `getDynamicColourRowRanges()` call — it currently calls
     `countColourFamilies(cellarId)` once. The plan says it will iterate areas and call
     `countColourFamilies(cellarId, areaId)` per area — but this means N+1 queries (one per area).
  3. Whether to use a single query with `GROUP BY storage_area_id` instead (more efficient)
- **Risk**: An implementer may create N+1 queries for a function that is already on the
  critical path of cellar analysis, degrading performance. Or they may add the area filter
  incorrectly if the SQL join path is not specified.
- **Recommendation**: Specify the exact SQL change. Consider recommending a single query with
  `GROUP BY storage_area_id` that returns counts per area, then iterating the result set in
  memory — eliminates N+1.

---

### MEDIUM Severity

#### [M1] Phase 2 Implementation Order not specified

- **Section**: Phase 2 overall
- **Detail**: The main plan specifies a detailed implementation order for Phase 1 (§7, steps 1–18)
  and the companion plan specifies one for Fix A (§9, steps 1–6). But Fixes B, C, and D have no
  implementation order. Fix D has internal sub-steps (D.1–D.6) that imply an order (migration first,
  then schema, then service, then route, then UI), but this is not explicitly stated. Fixes B and C
  are specified as independent file changes with no ordering guidance relative to each other or Fix A.
- **Risk**: A developer implementing Phase 2 may start Fix D.3 (service change) before Fix D.1
  (migration), leading to runtime errors. Or may implement Fix B before Fix A, which changes
  the same function (`movePlanner.js`) — causing merge conflicts.
- **Recommendation**: Add a Phase 2 Implementation Order section:
  ```
  1. Fix A (frontend area threading) — can deploy independently
  2. Fix B (validateMovePlan area filter) — depends on Fix A for test data
  3. Fix C (execute-moves lock) — independent of A/B
  4. Fix D.1 → D.2 → D.3 → D.4 → D.5 → D.6 (serial within Fix D)
  ```

#### [M2] Fix D.4: Row continuity enforcement — insufficient validation detail

- **Section**: Phase 2, Fix D.4
- **Detail**: The plan specifies a guard that checks `MAX(row_num) FROM storage_area_rows` and
  rejects if any new row ≤ current max. But this check does not account for:
  1. **Row gaps within an existing area** — what if rows 1–10 exist, then 12–19 exist (gap at 11)?
     A new area starting at row 20 would pass the check, but the gap may invalidate assumptions.
  2. **Concurrent area creation** — two simultaneous `POST /api/storage-areas` calls could both
     read the same `MAX(row_num)` and both succeed, creating overlapping rows. No mention of
     `FOR UPDATE` locking or unique constraint on `(cellar_id, row_num)`.
  3. **The check is on `POST /` only** — what about `PUT /:id` (update)? Can a user re-number
     an area's rows via update, breaking continuity?
- **Risk**: Concurrent creation could violate the continuous numbering invariant, silently
  breaking the colour zone model.
- **Recommendation**: Add a DB-level `UNIQUE(cellar_id, row_num)` constraint on
  `storage_area_rows` (if one doesn't already exist). This is the defence-in-depth approach
  that the plan uses effectively elsewhere (e.g., `resolveAreaFromSlot` 409 guard). Also
  mention that `PUT /:id` should reject row_num changes or enforce the same continuity check.

#### [M3] Fix D.5: Frontend form for colour purpose — file path not specified

- **Section**: Phase 2, Fix D.5
- **Detail**: The plan says "Whichever view handles storage area creation/editing" and "create if
  not exists" — but does not specify the exact frontend file path. The backend file
  (`src/routes/storageAreas.js`) is identified. The frontend form is described generically as
  "a frontend modal or settings panel."
- **Risk**: A developer must search the codebase to find (or create) the form. If a new file is
  created, it needs to be added to `STATIC_ASSETS` in `sw.js`, `CACHE_VERSION` bumped, etc.
  The plan's Files Summary says "Frontend storage area form — Modify/Create" — this ambiguity
  is below the specificity standard set by the rest of the plan.
- **Recommendation**: Explore the codebase to determine whether a storage area form exists.
  If it does, specify the exact path. If it needs creation, specify the file path, name it in
  the Files Summary, and add a note about `sw.js` registration.

#### [M4] Companion plan: `getAreaIdForLocation()` imports `state` — circular dependency risk understated

- **Section**: Frontend companion §4 (Technical Architecture) + §7 (Risk Register)
- **Detail**: The companion plan places `getAreaIdForLocation()` in `public/js/utils.js` and
  notes it imports `state` from `app.js`. The risk register says "utils.js already imports state
  from app.js; no new cycle introduced." However, `utils.js` exporting back to `moves.js`,
  `moveGuide.js` and `fridge.js` (which are imported by `app.js` via the analysis barrel) creates
  a deeper dependency chain. While ES modules handle circular imports via live bindings, the *load
  order* matters: if `utils.js` tries to access `state` before `app.js` initializes it, the value
  is `undefined`.

  The risk is LOW in practice (the function is never called during module initialization, only
  in event handlers after full app boot), but the plan should explicitly note this timing
  constraint.
- **Risk**: A future refactor could move `getAreaIdForLocation()` to module-level initialization
  or a computed export, breaking on circular import evaluation order.
- **Recommendation**: Add a one-line note in §4 or §7: "Safe because `getAreaIdForLocation()`
  is only called in event handlers (post-boot); accessing `state` at module load time would see
  `undefined`."

#### [M5] Phase 3 has no testing strategy details beyond stubs

- **Section**: Phase 3 — Features E, F, G
- **Detail**: Each Phase 3 feature lists 1–2 test file references but does not specify test
  scenarios, edge cases, or coverage expectations. For example, Feature E (cross-area drag-drop)
  says "tests/unit/dragdrop.test.js — cross-area drop opens confirmation; same-area drop proceeds
  without confirmation; cancel restores drag state" — three scenarios listed as a one-liner, but
  no description of touch-specific tests, accessibility (keyboard drag), or error scenarios.
- **Risk**: Phase 3 is acknowledged as "detailed plan to be written before implementation" so this
  is expected to be incomplete. However, the current level sets a floor that may be accepted as
  sufficient without deeper test planning.
- **Recommendation**: This is acceptable for now since the plan declares Phase 3 needs a detailed
  companion plan before implementation. Ensure the companion plan (`area-aware-slot-operations-phase3.md`)
  includes a full testing strategy matching the depth of the Phase 2 companion plan.

---

### LOW Severity

#### [L1] Main plan metadata: Status says v4 but Phase 1 is shipped

- **Section**: Metadata header
- **Detail**: Status is "Approved (v4 — Phase 2 fully specified: Fixes A/B/C/D including per-area
  colour zone)". Since Phase 1 is fully implemented and deployed, the status should reflect this:
  "Phase 1 Shipped. Phase 2 Approved."
- **Recommendation**: Update status to something like:
  `"Phase 1 Complete (shipped). Phase 2 Approved (v4). Phase 3 Outline only."`

#### [L2] Phase 1 Files Summary includes files that are part of Phase 2 scope

- **Section**: §8 Files Summary
- **Detail**: The Phase 1 summary lists `cellarAnalysis/moves.js` and `moveGuide.js` among
  "Phase 1" files. But these are the exact files covered by the Phase 2 Fix A companion plan.
  Depending on whether these were actually modified in Phase 1 (for other purposes, like
  `fridge.js` transfers), this could be confusing.
- **Risk**: Very low — the Files Summary is informational. But it may cause confusion when
  a developer cross-references against the companion plan.
- **Recommendation**: Add a note that `moves.js` and `moveGuide.js` were *not* modified in
  Phase 1 — their area threading is Phase 2 Fix A scope.

#### [L3] Context Summary table mentions `cellarAnalysis/fridge.js` gap — now partially resolved

- **Section**: §1 Context Summary
- **Detail**: The context summary table's frontend entries were written pre-implementation.
  Several entries (e.g., "Modals (`modals.js`) — location only", "Frontend grid (`grid.js`) —
  Slot elements lack `data-storage-area-id` attribute") are now outdated because Phase 1 shipped.
  The companion plan (§1) has an accurate "What Already Exists" audit.
- **Recommendation**: Add a note at the top of §1: "This section reflects the pre-implementation
  state. See the frontend companion plan §1 for the current state after Phase 1 shipped."

#### [L4] Companion plan: line number references may drift

- **Section**: Frontend companion §6.2 — "Call sites (from exploration): Single move execution
  (~L442), Batch move execution (~L479)..."
- **Detail**: Six call sites are identified with approximate line numbers. These are approximate
  and may have drifted since the exploration was done. The plan correctly uses `~L` notation.
- **Risk**: Very low — the call sites are identifiable by surrounding code patterns even if line
  numbers shift. And the plan instructs searching for `executeCellarMoves` call sites.
- **Recommendation**: No change needed. The `~L` notation appropriately signals approximation.

---

## Principle Coverage Matrix

### Backend Principles

| Principle | Addressed? | Where in Plan | Notes |
|-----------|-----------|---------------|-------|
| **DRY (#1)** | Yes | §2.2, §2.3, §4.1 (resolver), companion §4 (shared helper) | Shared resolver prevents duplicated area lookup logic |
| **Single Responsibility (#2)** | Yes | §4.1 (resolver is standalone), each route file keeps its existing scope | No new mixed-concern files |
| **Open/Closed (#3)** | Yes | §3 — resolver extensible to new storage types | Good extension point analysis |
| **Liskov Substitution (#4)** | N/A | — | No polymorphic interfaces |
| **Interface Segregation (#5)** | Yes | Zod schemas keep area fields optional | Callers not forced to provide area IDs |
| **Dependency Inversion (#6)** | Yes | Resolver injected via import; DB abstraction used | Consistent with existing patterns |
| **Modularity (#7)** | Yes | §4.1 standalone resolver, companion §4 standalone helper | Both independently testable |
| **No Hardcoding (#8)** | Yes | §2.2 — area via FK not string encoding; Fix G removes `startsWith` heuristics | Strong coverage |
| **No Dead Code (#9)** | Yes | §5 "Deliberately Deferred" tracks what becomes dead code when (resolveAreaFromSlot) | Explicit lifecycle plan |
| **Single Source of Truth (#10)** | Yes | §2.3, §4.1 — resolver is THE source | Well-identified |
| **Testability (#11)** | Yes | §6 — unit tests for resolver, schemas, routes; all with injectable DB | Strong |
| **Defensive Validation (#12)** | Yes | §2.3, §4.3 — 409 on ambiguous match; area validated per request | Core design pillar |
| **Idempotency (#13)** | Implicit | — | Slot operations are already idempotent; area addition doesn't change this |
| **Transaction Safety (#14)** | Yes | §2.4, §4.4 — transactions on multi-step moves; Fix C locks | Explicitly called out |
| **Consistent Error Handling (#15)** | Yes | §4.1 — AppError with proper codes (404, 409) | Follows existing pattern |
| **Graceful Degradation (#16)** | Yes | §4.3 — resolveAreaFromSlot fallback; companion §5 — null fallback to backend | Two-layer degradation |
| **N+1 Prevention (#17)** | Partial | Fix A eliminates N queries per batch, but Fix D.3 may introduce N+1 — see [H3] | Needs attention |
| **Backward Compatibility (#18)** | Yes | §2.2, §5 — all area IDs optional; zero breaking changes | Strong |
| **Observability (#19)** | Implicit | — | Error messages include location codes and area IDs for diagnostics |
| **Long-Term Flexibility (#20)** | Yes | §3 — extension points; §5 — deferred items with explicit timeline | Good sustainability section |

**Backend coverage**: 18/18 applicable principles addressed (2 N/A or implicit) = **95%**

### Frontend Principles (Companion Plan)

| Principle | Addressed? | Where in Plan | Notes |
|-----------|-----------|---------------|-------|
| **Feedback (#11)** | Yes | §3 — toasts unchanged | Correctly noted as no-change |
| **Error Prevention (#12)** | Yes | §3 — explicit IDs prevent wrong-slot | Strengthened |
| **Consistency (#10)** | Yes | §3, §6 — all callers now match fridge/dragdrop pattern | Core motivation |
| **State Coverage (#23)** | Yes | §5 — all states for all components mapped | Thorough |
| **Performance (#24)** | Yes | §3, §7 — eliminates N extra queries | Quantified |
| **DRY (#29)** | Yes | §4 — shared helper instead of 3 inline copies | Well-justified |
| **CSP Compliance** | N/A | No new event handlers | — |
| **Accessibility** | Yes | §3, §8 — correctly noted as N/A for this change | Honest assessment |

**Frontend coverage**: All applicable principles addressed = **100%** (most are honestly noted as N/A)

---

## Specificity Assessment

### Main Plan (Phase 1 — shipped, Phase 2 active)

| Planned File | Path Exact? | Functions Named? | Dependencies Listed? | Implementable? |
|-------------|------------|-----------------|---------------------|---------------|
| `storageAreaResolver.js` | Yes | Yes (2 functions with full JSDoc) | Yes (imports + consumers) | **Yes** — shipped |
| `schemas/slot.js` | Yes | Yes (field names + schemas) | Yes | **Yes** — shipped |
| `routes/slots.js` | Yes | Yes (all 8 endpoints mapped) | Yes | **Yes** — shipped |
| `cellarReconfiguration.js` | Yes | Yes (validateMovePlan, execution) | Yes | **Yes** (Phase 2 Fix C) |
| `movePlanner.js` | Yes | Yes (planMoves, validateMovePlan) | Yes | **Yes** (Phase 2 Fix A+B) |
| `cellarLayoutSettings.js` | Yes | Yes (getDynamicColourRowRanges, countColourFamilies) | Partial — see [H3] | **Partial** — SQL unspecified |
| `storageAreas.js` route | Yes | Partial — mentions POST guard | Partial — see [M2] | **Partial** — concurrency unspecified |
| Frontend storage area form | **No — see [M3]** | No | No | **No** — must be identified |
| Migration 040 | **Wrong — see [H1]** | N/A | N/A | **Blocked** until renumbered |

### Companion Plan (Phase 2 Fix A)

| Planned File | Path Exact? | Functions Named? | Dependencies Listed? | Implementable? |
|-------------|------------|-----------------|---------------------|---------------|
| `public/js/utils.js` | Yes | Yes (`getAreaIdForLocation`) | Yes (imports state, exports to 3 files) | **Yes** |
| `cellarAnalysis/moves.js` | Yes | Yes (6 call sites with ~line numbers) | Yes | **Yes** |
| `cellarAnalysis/moveGuide.js` | Yes | Yes (`executeCurrentMove`) | Yes | **Yes** |
| `cellarAnalysis/fridge.js` | Yes | Yes (2 functions named) | Yes | **Yes** |
| `public/sw.js` | Yes | Yes (bump only) | N/A | **Yes** |
| Test files (4) | Yes | Yes (test scenarios listed) | N/A | **Yes** |

---

## Ambiguities Found

| Location | Vague Language | What Needs Clarification |
|----------|---------------|------------------------|
| Phase 2 Fix D.5 | "Whichever view handles storage area creation/editing" | Specify exact frontend file path |
| Phase 2 Fix D.3 | "Add `AND s.storage_area_id = $2` when storageAreaId provided" | Specify complete rewritten SQL or at minimum the join path |
| Phase 2 Fix D.4 | "Light guard" | Specify concurrency handling (locking or constraint) |
| Phase 3 Feature E | "Small confirmation popover" | Deferred to Phase 3 companion plan — acceptable |
| Main plan §4.15 | "Backend: pairing response includes…" | Contradicted by companion plan deferral — which is correct? |

---

## Recommendations

Prioritised list of plan improvements before implementation begins:

1. **[HIGH] Fix migration number** — Rename `040_storage_area_colour_zone.sql` to `066_storage_area_colour_zone.sql` throughout the plan. Migration 040 is taken by `040_producer_crawler.sql`.

2. **[HIGH] Resolve pairing.js contradiction** — Either remove `pairing.js` from main plan §4.15 / §8 (marking it deferred with the companion plan's rationale), or bring it back into Fix A scope. The companion plan's deferral rationale is sound — update the main plan to match.

3. **[HIGH] Specify Fix D.3 SQL** — Provide the exact rewritten `countColourFamilies` SQL or recommend a single `GROUP BY storage_area_id` query to avoid N+1.

4. **[MEDIUM] Add Phase 2 implementation order** — Specify the ordering of Fixes A→D, noting which can be parallelised and which have dependencies.

5. **[MEDIUM] Add concurrency guard for Fix D.4** — Add `UNIQUE(cellar_id, row_num)` on `storage_area_rows` or `SELECT ... FOR UPDATE` in the creation path.

6. **[MEDIUM] Identify the frontend storage area form** — Specify exact file path for Fix D.5 or explicitly note it needs creation (with `sw.js` registration).

7. **[MEDIUM] Note circular import safety in companion plan** — Add timing constraint note for `getAreaIdForLocation()` accessing `state`.

8. **[MEDIUM] Phase 3 companion plan note** — Ensure the Phase 3 plan-to-be-written includes full testing strategy.

9. **[LOW] Update main plan status** — Reflect Phase 1 shipped, Phase 2 approved, Phase 3 outline.

10. **[LOW] Clarify moves.js/moveGuide.js were NOT modified in Phase 1** — Add annotation to §8 Files Summary.

11. **[LOW] Add staleness note to §1 Context Summary** — Point readers to companion plan §1 for current state.

---

## Cross-Plan Consistency Check

Since this is a multi-file plan, verify the two documents are aligned:

| Aspect | Main Plan | Companion Plan | Aligned? |
|--------|----------|----------------|----------|
| Scope of Fix A | "moves.js, moveGuide.js thread area IDs" | "moves.js (6 sites), moveGuide.js (1 site), fridge.js organize (2 funcs)" | ✅ Companion is more specific, superset |
| `pairing.js` handling | Phase 1 §4.15: implement | §7 Deliberately Deferred | ❌ **Contradiction — see [H2]** |
| `fridge.js` scope | Phase 1 §4.18: all move/swap/transfer | Companion §6.4: organize only (transfers already done) | ✅ Compatible — transfers shipped in Phase 1 |
| Implementation approach | Not specified for Fix A | Option A chosen (frontend enrichment) with full justification | ✅ Decision well-documented |
| `sw.js` changes | "Bump cache version" (Phase 1 §8) | "Bump CACHE_VERSION" (companion §9) | ✅ Aligned |
| Test strategy | Main plan §6 focuses on backend tests | Companion §8 focuses on frontend tests | ✅ Complementary |

---

## Overall Assessment

This is a **high-quality, well-structured multi-phase plan** that demonstrates strong engineering
discipline. The Phase 1 implementation is verifiably shipped and matches the plan. The Phase 2
specification (Fixes A–D) is detailed enough to implement from, with the notable exception of the
three HIGH findings. The companion frontend plan is exemplary in its current-state audit,
decision documentation, and state map analysis.

The plan's greatest strength is its **defence-in-depth approach**: the `UNIQUE` constraint stays
until consumers are proven safe, the `resolveAreaFromSlot()` 409 guard catches ambiguity, and the
continuous row numbering decision elegantly eliminates an entire class of problems (zone/analysis
map collapse) that dominated the v1→v3 revision cycle.

The three HIGH findings are mechanical fixes (migration number, cross-plan contradiction, SQL
specificity) — none require architectural rethinking. After addressing those, the plan is ready
to implement.
