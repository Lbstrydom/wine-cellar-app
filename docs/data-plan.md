# Data Plan: Adaptive Zone-Led Cellar Configuration

## Critical Evaluation of Original Draft

The original plan had strong design principles but several issues were identified:

1. **Terminology mismatch** — The draft introduced "categories" when the codebase uses "zones" throughout (~25 zone definitions, DB tables, API routes, frontend). Renaming would touch hundreds of files for zero functional benefit. **Decision: Retain "zones" terminology.**

2. **Over-engineered data model** — Five new database tables proposed (`cellar_rows`, `category_catalog`, `category_allocations`, `wine_category_scores`, `plan_snapshots`). The existing schema already has `zone_allocations`, `zone_pins`, `zone_reconfigurations`, and `zone_metadata`. Most proposed data is already stored or can be derived in-memory during planning. **Decision: No new tables. Add columns to existing tables where needed.**

3. **Min-cost flow solver is unnecessary** — The cellar has 19 rows and ~25 zones. The current greedy best-first algorithm runs in <10ms. A min-cost flow implementation adds significant complexity (requires a flow library or custom implementation) for a problem size where greedy is provably near-optimal. **Decision: Enhance the greedy solver with capacity-aware math and contiguity scoring.**

4. **Row capacity bug (CRITICAL)** — `SLOTS_PER_ROW = 9` is hardcoded throughout the solver and planner, but Row 1 has 7 slots. This causes incorrect demand computation, wrong utilization percentages, and flawed capacity deficit detection. **Decision: Fix immediately with a capacity map.**

5. **Scattered wine consolidation is a no-op** — `consolidateScatteredWines()` returns `[]`. The plan identifies this gap but doesn't specify the algorithm. **Decision: Implement adjacency-swap heuristic.**

6. **Sequential simulator missing** — The plan correctly identifies this need. Currently `filterLLMActions()` does shallow validation (zone existence, row ownership) but doesn't replay actions sequentially to detect cascading conflicts. **Decision: Build a proper sequential simulator.**

7. **LLM delta protocol** — The plan proposes structured patches over freeform rewrite. The current LLM gets a draft and returns a complete new plan. **Decision: Implement structured delta protocol with Zod validation.**

8. **`wine_category_scores` table is redundant** — `findBestZone()` in `cellarPlacement.js` already computes zone scores deterministically. A separate persistence layer adds sync complexity. **Decision: Use in-memory top-k scoring during planning, no new table.**

---

## Purpose

Upgrade the cellar configuration system with:

1. True non-uniform row capacity math (fixing the Row 1 = 7 slots bug).
2. A shared Zod action schema used across solver, LLM, reviewer, and API.
3. A sequential plan simulator that validates action chains before application.
4. Complexity-based Opus 4.6 escalation for difficult reconfiguration scenarios.
5. A structured LLM delta protocol (patches, not rewrites).
6. Contiguity scoring and scattered wine consolidation.
7. Per-layer telemetry for observability.

## Design Principles (Retained)

1. **Deterministic first**: Solver output must stand on its own without LLM.
2. **Capacity-true math**: Use real row capacities (`ROW_CAPACITY_MAP`), never constant 9.
3. **Zone-led control**: Rows are assigned to zone blocks based on demand.
4. **Stability-aware**: Improve structure without unnecessary churn.
5. **LLM as delta refiner**: LLM patches and improves, not rewrites from scratch.
6. **Hard invariants**: No invalid ownership, no impossible actions, no data loss.

---

## Implementation Plan

### Phase 1: Data Foundations

**Files created/modified:**

1. `src/config/cellarCapacity.js` (NEW) — Row capacity map and utility functions
2. `src/schemas/reconfigurationActions.js` (NEW) — Zod discriminated union for all action types
3. `src/services/zone/rowAllocationSolver.js` — Replace `SLOTS_PER_ROW` constant with capacity map
4. `src/services/zone/zoneReconfigurationPlanner.js` — Use capacity map in utilization calc

**Row capacity map:**
```javascript
const ROW_CAPACITY_MAP = { R1: 7, R2: 9, ..., R19: 9 };
function getRowCapacity(rowId) → number
function getTotalCapacity() → number (169)
function computeRowsCapacity(rowIds) → number
```

**Zod action schema (discriminated union):**
```javascript
const ReallocateRowAction = z.object({
  type: z.literal('reallocate_row'),
  priority: z.number().int().min(1).max(5),
  fromZoneId: z.string(),
  toZoneId: z.string(),
  rowNumber: z.number().int().min(1).max(19),
  reason: z.string(),
  bottlesAffected: z.number().int().min(0),
  source: z.enum(['solver', 'llm', 'heuristic']).optional()
});
// + MergeZonesAction, RetireZoneAction, ExpandZoneAction
const PlanActionSchema = z.discriminatedUnion('type', [...]);
```

### Phase 2: Sequential Plan Simulator

**File:** `src/services/zone/planSimulator.js` (NEW)

The simulator replays actions against a mutable ownership state and checks invariants at each step:

1. Build initial state from current zone→row allocations
2. For each action in sequence:
   - Validate preconditions (row belongs to fromZone, zones exist, etc.)
   - Apply mutation to state
   - Check post-conditions (no orphaned bottles, no duplicate ownership)
3. After all actions: verify global invariants (bottle count unchanged, all rows assigned)

**Invariant checks:**
- No row appears in more than one zone
- No zone with bottles ends up with zero rows (unless explicitly retired)
- No row moved more than once
- All zone IDs are valid
- Post-plan capacity covers demand

### Phase 3: Solver Upgrades

**File:** `src/services/zone/rowAllocationSolver.js` — Enhanced

1. **Capacity-aware demand**: `requiredRows(zone)` accounts for non-uniform row capacities
2. **Contiguity scoring**: Bonus for keeping zone rows adjacent in physical order
3. **Scattered wine consolidation**: Swap rows to reduce scattering
4. **Global objective scoring**: Compute fit + contiguity + color boundary - churn as a numeric score

### Phase 4: Adaptive LLM Interface

**Files modified:**

1. `src/config/aiModels.js` — Add `zoneReconfigEscalation` task mapped to Opus 4.6
2. `src/services/zone/zoneReconfigurationPlanner.js` — Complexity scoring + Opus escalation

**Complexity score** (0.0 to 1.0):
- +0.2 if >3 deficit zones
- +0.2 if >2 unresolved color boundary violations
- +0.2 if >2 pin constraints active
- +0.2 if solver confidence < 0.5
- +0.2 if scattered wine count > 5

If `complexityScore >= 0.6` → escalate from Sonnet to Opus 4.6 with adaptive thinking.

**Delta protocol** — LLM returns structured patches:
```json
{
  "accept_action_indices": [0, 1, 3],
  "remove_action_indices": [2],
  "patches": [{ "action_index": 1, "field": "priority", "value": 1 }],
  "new_actions": [{ "type": "reallocate_row", ... }],
  "reasoning": "..."
}
```

### Phase 5: Telemetry

**File:** `src/services/zone/zoneReconfigurationPlanner.js` — Enhanced

Track per-plan:
- Solver latency (ms)
- LLM latency (ms) and model used (Sonnet vs Opus)
- Actions by source (solver / llm / heuristic)
- Complexity score
- Simulator pass/fail
- Unresolved deficits after each layer

Stored in `zone_reconfigurations.plan_json` alongside the plan.

---

## Testing Plan

### Unit Tests (New)

1. **`cellarCapacity.test.js`** — Row capacity map correctness, `getRowCapacity()`, `computeRowsCapacity()`
2. **`reconfigurationActions.test.js`** — Zod schema validation for all action types, invalid action rejection
3. **`planSimulator.test.js`** — Sequential replay, invariant detection, auto-repair
4. **`rowAllocationSolver.test.js`** — Extended: capacity-aware demand, contiguity scoring, scatter consolidation
5. **`complexityScoring.test.js`** — Complexity calculation, Opus escalation triggers
6. **`deltaProtocol.test.js`** — Delta application, patch validation, schema gate

### Integration Tests

1. Full pipeline with LLM disabled (solver + heuristic + simulator)
2. Pipeline with mock LLM returning delta protocol
3. Simulator rejection causes graceful fallback to solver-only plan

### Performance Targets

1. Layer 0 (preprocess) + Layer 1 (solver) ≤ 20ms P95
2. Layer 3 (heuristic) ≤ 2ms P95
3. Full deterministic plan (no LLM) ≤ 30ms P95
4. Full with Sonnet ≤ 15s P95
5. Full with Opus escalation ≤ 45s P95

---

## Risks and Mitigations

1. **Risk: Capacity math changes break existing plans**
   - Mitigation: Row 1 = 7 is the only non-uniform row; impact is bounded
2. **Risk: LLM delta protocol produces malformed patches**
   - Mitigation: Zod validation + simulator gate + fallback to solver-only
3. **Risk: Opus escalation adds latency for simple cases**
   - Mitigation: Complexity threshold ensures Opus only runs for genuinely hard problems
4. **Risk: Simulator rejects valid plans due to strict invariants**
   - Mitigation: Auto-repair pass before rejection; log telemetry for tuning

---

## Deliverables

1. `src/config/cellarCapacity.js` — Row capacity map
2. `src/schemas/reconfigurationActions.js` — Zod action schema
3. `src/services/zone/planSimulator.js` — Sequential plan simulator
4. Updated `src/services/zone/rowAllocationSolver.js` — Capacity-aware solver
5. Updated `src/services/zone/zoneReconfigurationPlanner.js` — Delta protocol + Opus escalation
6. Updated `src/config/aiModels.js` — Opus escalation task
7. Comprehensive test suite covering all new modules
8. This document (updated from draft)

---

## Phase 6: Cross-Service Adaptive Interface Improvements

After implementing the zone reconfiguration pipeline, the same complexity-based model routing
pattern was applied across other AI-consuming services to reduce LLM costs, improve consistency,
and leverage Opus 4.6 adaptive thinking only when the scenario warrants it.

### Pattern: Complexity-Based Model Routing

Each service computes a complexity score (0.0–1.0) from domain-specific factors.
Below a threshold, the service uses Sonnet 4.5 with low/no thinking (fast, cheap).
Above the threshold, it escalates to Opus 4.6 with high thinking (deep reasoning).

| Service | Base Task (Sonnet) | Escalation Task (Opus) | Threshold | Key Factors |
|---------|-------------------|----------------------|-----------|-------------|
| Zone Reconfiguration | `zoneReconfigurationPlan` | `zoneReconfigEscalation` | 0.6 | Deficit count, color conflicts, pins, solver actions, scattered wines |
| Zone Capacity Advisor | `zoneCapacityAdvice` | `zoneCapacityEscalation` | 0.5 | Wine count, adjacent zones, free rows, allocated zone count |
| Pairing Engine | `sommelier` | `cellarAnalysis` | 0.5 | Signal count, conflicting signals, low-confidence matches, style diversity |
| Award Extraction | `awardExtraction` | `awardExtractionEscalation` | 0.4 | Content size, narrative vs tabular, vintage indicators, language diversity |

### Zone Capacity Advisor (`zoneCapacityAdvisor.js`)

**Before**: Always used Opus 4.6 with medium thinking — even for simple "zone has 2 bottles, 3 free rows available" cases.

**After**: `computeCapacityComplexity()` evaluates:
- Wine count needing placement (>5 → +0.25)
- Adjacent zone count (>3 → +0.25)
- No free rows available (→ +0.3, forces merge/reorganize thinking)
- Crowded cellar (>8 allocated zones → +0.2)

Simple overflows (few wines + free rows) route to Sonnet with low thinking.
Complex overflows (no free rows + many adjacent zones) escalate to Opus with high thinking.

**Expected savings**: 60–70% cost reduction on straightforward capacity overflows.

### Pairing Engine (`pairingEngine.js`)

**Before**: Always used Sonnet with no thinking for explanation generation.

**After**: `computePairingComplexity()` evaluates:
- Signal count (≥6 → +0.25)
- Conflicting signal pairs (creamy+acid, sweet+spicy, etc. → +0.2 per conflict, max 2)
- Low-confidence style matches (≥2 → +0.2)
- Diverse styles in shortlist (≥3 unique styles → +0.15)

Simple pairings (beef + grilled → red wine) stay on Sonnet.
Complex pairings (creamy + acid + sweet + multiple styles) escalate to Opus with thinking
for deeper flavour analysis and more nuanced explanations.

**Note**: The deterministic scoring (shortlist generation) remains unchanged and fast.
Only the LLM explanation step is affected by complexity routing.

### Award Extraction (`awardExtractorWeb.js`)

**Before**: Always used Opus 4.6 with medium thinking for all content.

**After**: `computeAwardExtractionComplexity()` evaluates per-content (including per-chunk):
- Large content (>30K chars → +0.2)
- Narrative vs tabular (pipes/tabs/numbered → tabular; prose → narrative +0.3)
- Multi-language content (CJK + accented chars → +0.2)
- Few vintage indicators in large text (→ +0.2)
- Many award patterns (>50 → +0.1)

Structured tabular PDFs (clear medal tables) route to Sonnet with low thinking.
Narrative prose from competition reviews escalates to Opus with high thinking.
Chunked processing routes each chunk independently based on its content.

**Expected savings**: 40–50% cost reduction on well-structured award documents.

### Thinking Effort Configuration

The `TASK_THINKING` map in `aiModels.js` now uses tiered effort levels:

| Task | Effort | Rationale |
|------|--------|-----------|
| `cellarAnalysis` | high | Complex multi-zone analysis, always Opus |
| `zoneReconfigEscalation` | high | Complex reconfiguration with cascading effects |
| `zoneCapacityEscalation` | high | Complex capacity decisions requiring merge/reorganize |
| `awardExtractionEscalation` | high | Narrative/unstructured content needs deep reasoning |
| `zoneReconfigurationPlan` | low | Primary planning done by algorithmic solver |
| `zoneCapacityAdvice` | low | Simple overflows with clear solutions |
| `awardExtraction` | low | Structured tabular extraction |

### New Tests

| Test File | Test Count | Coverage |
|-----------|-----------|----------|
| `capacityAdvisorComplexity.test.js` | 9 | Capacity complexity scoring |
| `pairingComplexity.test.js` | 9 | Pairing complexity scoring |
| `awardExtractionComplexity.test.js` | 9 | Award extraction complexity scoring |
| Updated `aiModels.test.js` | +4 | New escalation task entries |

### Total Test Count After All Phases

1691 unit tests across 65 test files (was 1475 before this implementation).
