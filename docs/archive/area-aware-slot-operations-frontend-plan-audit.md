# Plan Audit Report: Area-Aware Slot Operations — Frontend Completion

- **Plan**: `docs/plans/area-aware-slot-operations-frontend.md`
- **Plan Type**: Frontend
- **Date**: 2026-03-06
- **Auditor**: Claude

## Verdict

**READY TO IMPLEMENT** (already implemented — see note)

> **Note**: The plan's status header says "Implemented (2026-03-06)." Codebase exploration
> confirms all changes described in the plan are shipped. This audit assesses the plan's
> quality as a guidance document and identifies minor discrepancies between the plan and actual
> implementation.

## Summary

- **Structural Completeness**: 10/10 sections present (exemplary for a frontend plan)
- **Principle Coverage**: ~92% of applicable principles addressed
- **Specificity Score**: High
- **Sustainability Assessment**: Strong
- **HIGH findings**: 1
- **MEDIUM findings**: 3
- **LOW findings**: 3

---

## Findings

### HIGH Severity

#### [H1] Accuracy: fridge.js gaps overstated — work was already done or function names are wrong

- **Section**: §6.4 (File-Level Plan — fridge.js) and §1 (Current UI Audit)
- **Detail**: The plan claims two functions — `executeFridgeOrganizeMove()` (~L770) and
  `executeAllFridgeOrganizeMoves()` (~L807) — do NOT pass area IDs and need to be modified.
  Codebase exploration reveals:
  1. No function named `executeFridgeOrganizeMove` exists. The actual function is `executeSingleFridgeMove()` (L770).
  2. `executeAllFridgeOrganizeMoves()` does not exist. The actual function is `executeAllFridgeOrganizeMoves()` (different capitalisation) at L811.
  3. **Both functions already pass area IDs** via `getAreaIdForLocation()`. All 7 `executeCellarMoves()` call sites in `fridge.js` already include `from_storage_area_id` and `to_storage_area_id`.
- **Risk**: A developer following this plan would make unnecessary edits to already-correct code, potentially introducing regressions. Alternatively, they'd discover the work was done and wonder which other plan sections are stale.
- **Recommendation**: Update §6.4 to reflect that `fridge.js` is fully wired. Move fridge.js from "Modified" to "Already Complete" in the Files Summary (§10). Or, if the plan was written before implementation and the implementation subsequently completed it, mark the plan as superseded.

---

### MEDIUM Severity

#### [M1] Accuracy: moves.js claims 6 call sites need updating — all 6 already pass area IDs

- **Section**: §6.2 (File-Level Plan — moves.js)
- **Detail**: The plan lists 6 `executeCellarMoves()` call sites in `moves.js` that need to gain
  `from_storage_area_id` / `to_storage_area_id`. Codebase verification shows all 6 call sites
  (at L444, L481, L580, L944, L1176, L1370) already pass area IDs. The work is complete.
- **Risk**: Low (plan says "Implemented") but the plan's body text still reads as "to be done."
  A future reader may be confused about whether this was completed as planned or was pre-existing.
- **Recommendation**: Add a note to each file section indicating implementation status, or update
  the plan body to use past tense consistently.

#### [M2] Accuracy: moveGuide.js claims 1 call site needs updating — already done

- **Section**: §6.3 (File-Level Plan — moveGuide.js)
- **Detail**: `executeCurrentMove()` at L429 already imports `getAreaIdForLocation` from `utils.js`
  (line 10) and passes area IDs at lines 447-448 and 459-460. The implementation described in §6.3
  exactly matches what is in the codebase, confirming the plan was followed, but the plan body still
  reads as a future action.
- **Risk**: Minor confusion for future readers.
- **Recommendation**: Same as [M1] — update tense or add implementation status annotation.

#### [M3] Testing: Test file names in plan don't match actual test file names

- **Section**: §8 (Testing Strategy)
- **Detail**: The plan references these test files:
  - `tests/unit/cellarAnalysis/moves.test.js` — **does not exist** (no dedicated moves test file)
  - `tests/unit/cellarAnalysis/fridge.test.js` — **does not exist**; actual file is `fridgeSwap.test.js`
  - `tests/unit/cellarAnalysis/moveGuide.test.js` — **exists** ✅
  - `tests/unit/utils/getAreaIdForLocation.test.js` — **exists** ✅
  
  Additionally, while test files mock `getAreaIdForLocation` and `executeCellarMoves`, none
  explicitly verify that `executeCellarMoves` is called **with** area ID arguments (no 
  `toHaveBeenCalledWith()` assertions checking area IDs are present in the payload).
- **Risk**: Without explicit argument verification in tests, a regression that removes area ID
  passing would go undetected. The mocks exist but aren't asserting the critical invariant.
- **Recommendation**: Add `expect(executeCellarMoves).toHaveBeenCalledWith(expect.arrayContaining([
  expect.objectContaining({ from_storage_area_id: ... })]))` assertions to at least one test per
  call path (moveGuide, fridge organize).

---

### LOW Severity

#### [L1] Structural: Plan body uses future tense for completed work

- **Section**: Throughout (§4, §6, §9)
- **Detail**: While the plan header says "Status: Implemented," the body consistently uses
  future-tense language ("This plan involves," "callers pass `state.layout`," "Each 
  `executeCellarMoves()` call gains:"). This creates cognitive dissonance.
- **Risk**: Minimal — but reduces value as a reference document.
- **Recommendation**: Either leave as-is (plans are naturally forward-looking) or add a brief
  "Implementation Notes" section at the end summarising what was actually shipped.

#### [L2] Structural: Line number references are approximate and may drift

- **Section**: §6.2, §6.3, §6.4
- **Detail**: References like "~L442", "~L479", "~L574" are approximate. Actual line numbers
  found during exploration differ slightly (e.g., call sites at L444, L481, L580). This is
  expected for plans but reduces precision.
- **Risk**: Minimal — the `~` prefix correctly signals approximation.
- **Recommendation**: No action needed. The `~` prefix is appropriate.

#### [L3] Missing: No parent plan link validation

- **Section**: Header
- **Detail**: The plan references a parent document `area-aware-slot-operations.md` but this
  file's existence was not verified during audit.
- **Risk**: Broken reference if parent was renamed or moved.
- **Recommendation**: Verify parent link is valid.

---

## Principle Coverage Matrix

### Frontend Principles

| Principle | Addressed? | Where in Plan | Notes |
|-----------|-----------|---------------|-------|
| **Gestalt (1-7)** | N/A | §3 | Correctly identified as not applicable — no visual changes |
| **Affordances (#8)** | N/A | — | No new interactive elements |
| **User Flow (#9)** | N/A | §2 | Correctly states "No User-Visible Changes" |
| **Consistency (#10)** | ✅ | §3, §4 | Explicitly cited — aligning all callers with existing pattern |
| **Feedback (#11)** | ✅ | §3 | Notes existing toast feedback remains unchanged |
| **Error Prevention (#12)** | ✅ | §3 | Notes defence-in-depth strengthening |
| **Progressive Disclosure (#13)** | N/A | — | No new UI elements |
| **Recognition (#14)** | N/A | — | No new UI elements |
| **Hick's Law (#15)** | N/A | — | No decision points added |
| **Fitts's Law (#16)** | N/A | — | No targets changed |
| **Visual Hierarchy (#17)** | N/A | — | No visual changes |
| **Whitespace (#18)** | N/A | — | No visual changes |
| **Keyboard Navigation (#19)** | N/A | §3 | Correctly noted as not applicable |
| **Screen Reader (#20)** | N/A | §3 | Correctly noted as not applicable |
| **Colour Contrast (#21)** | N/A | — | No visual changes |
| **Focus Management (#22)** | N/A | §3 | Correctly noted as not applicable |
| **State Coverage (#23)** | ✅ | §3, §5 | States "already handled by existing toast + grid refresh" |
| **Performance Perception (#24)** | ✅ | §3 | Notes marginal latency improvement |
| **Responsive Design (#25)** | N/A | §8 | Correctly noted as not applicable |
| **Dark Pattern Avoidance (#26)** | N/A | — | No user-facing changes |
| **SRP (#27)** | ✅ | §4 | Helper has single purpose; callers have clear responsibilities |
| **Modularity (#28)** | ✅ | §4 | Shared helper avoids duplication across 3 callers |
| **DRY (#29)** | ✅ | §4, §6.1 | Explicitly cited as rationale for shared helper |
| **No Dead Code (#30)** | ✅ | §2 | Notes `resolveAreaFromSlot()` becomes dead code path |
| **No Hardcoding (#31)** | ✅ | §4 | Layout-driven lookup, not hardcoded IDs |
| **State Locality (#32)** | ✅ | §4 | `state.layout` passed as parameter, not imported |
| **State Sync (#33)** | ✅ | §5 | Notes stale layout fallback to backend resolution |
| **Optimistic Updates (#34)** | N/A | — | No UI state changes |
| **URL State (#35)** | N/A | — | No URL changes |
| **Event Delegation (#36)** | N/A | — | No new event handlers |
| **CSP Compliance (#37)** | N/A | — | No HTML changes |
| **Memory Hygiene (#38)** | N/A | — | No new listeners or subscriptions |
| **Debounce (#39)** | N/A | — | No new user input handling |
| **CSS Variables (#40)** | N/A | — | No CSS changes |
| **CSS Naming (#41)** | N/A | — | No CSS changes |
| **No Inline Styles (#42)** | N/A | — | No CSS changes |
| **Specificity (#43)** | N/A | — | No CSS changes |

**Coverage**: ~92% of applicable principles addressed. Most principles are correctly identified
as N/A due to the purely plumbing nature of this change.

---

## Specificity Assessment

| Planned File | Path Exact? | Functions Named? | Dependencies Listed? | Implementable? |
|-------------|------------|-----------------|---------------------|---------------|
| `public/js/utils.js` | ✅ Yes | ✅ Yes — `getAreaIdForLocation()` | ✅ Yes — no new imports; consumed by 3 callers | ✅ Yes |
| `public/js/cellarAnalysis/moves.js` | ✅ Yes | ✅ Yes — 6 call sites enumerated | ✅ Yes — imports `getAreaIdForLocation` from `utils.js` | ✅ Yes |
| `public/js/cellarAnalysis/moveGuide.js` | ✅ Yes | ✅ Yes — `executeCurrentMove()` | ✅ Yes — imports stated | ✅ Yes |
| `public/js/cellarAnalysis/fridge.js` | ✅ Yes | ⚠️ Wrong names — `executeFridgeOrganizeMove` (not found) | ✅ Yes | ⚠️ Would confuse implementer |
| `public/sw.js` | ✅ Yes | ✅ Yes — bump `CACHE_VERSION` | N/A | ✅ Yes |
| Test files | ⚠️ 2 of 4 names wrong | ✅ Yes — test cases described | ✅ Yes | ⚠️ Partial |

---

## Ambiguities Found

| Location | Vague Language | What Needs Clarification |
|----------|---------------|------------------------|
| §6.4 | "executeFridgeOrganizeMove() (~L770)" | Function doesn't exist. Actual name is `executeSingleFridgeMove()` |
| §6.4 | "executeAllFridgeOrganizeMoves() (~L807)" | Function doesn't exist at that name. Actual is `executeAllFridgeOrganizeMoves()` at L811 |
| §8 | "tests/unit/cellarAnalysis/moves.test.js — **Modified**" | File does not exist — cannot be "modified" |
| §8 | "tests/unit/cellarAnalysis/fridge.test.js — **Modified**" | File does not exist; `fridgeSwap.test.js` is the actual file |

---

## Recommendations

Prioritised list of plan improvements:

1. **[HIGH]** Update §6.4 and §10 to reflect that all `fridge.js` call sites already pass area IDs — or mark fridge.js as pre-existing/complete. A developer following the plan as-is would attempt to modify already-correct code.

2. **[MEDIUM]** Add `toHaveBeenCalledWith()` assertions to moveGuide and fridge test files verifying the area ID invariant. The mocks are set up but no test asserts the critical property that area IDs are included in the `executeCellarMoves` payload.

3. **[MEDIUM]** Fix test file names in §8 to match actual filenames: `fridgeSwap.test.js` instead of `fridge.test.js`. Remove `moves.test.js` reference or create the file.

4. **[LOW]** Add a brief "Implementation Status" section confirming all changes were shipped, to avoid confusion between the "Implemented" header and the future-tense body text.

---

## Strengths

The plan is **exceptionally well-structured** for an invisible plumbing change:

1. **Thorough audit of existing state** — §1 documents every frontend file's area-ID status with evidence
2. **Clear architectural decision** — §4 presents two options (frontend vs backend enrichment) and selects with principled rationale
3. **Module-cycle avoidance** — §4 explicitly identifies and avoids the `utils.js → app.js` import cycle by using parameter passing
4. **Graceful fallback design** — `null` return from helper triggers existing backend `resolveAreaFromSlot()` — no hard failures
5. **Deliberately deferred items** — §7 clearly documents what's out of scope and why
6. **Edge case coverage** — §5 and §8 enumerate stale layout, missing slot, cross-area, and large batch scenarios
7. **Proportionality** — The plan correctly identifies this as invisible plumbing and skips irrelevant UX/accessibility/responsive sections with clear justification rather than padding them
