# Data Plan: Dynamic Category-Led Cellar Configuration

## Purpose

This plan defines a full data-structure and algorithm strategy for cellar configuration where:

1. Rows are led by categories (not fixed static zones).
2. Category allocation adjusts dynamically to row-length constraints and actual cellar composition.
3. Categories can span multiple rows when that produces a better global structure.
4. Deterministic optimization remains the primary planner, with LLM refinement as controlled augmentation.

## Scope

This plan covers:

1. Data model changes
2. In-memory planner structures
3. Optimization algorithm
4. LLM interleaving strategy (Sonnet and Opus 4.6)
5. Heuristic interfaces and UX flow
6. Validation, tests, and rollout

This plan does not include:

1. Final visual design details
2. Migration scripts content
3. Full implementation code

## Design Principles

1. Deterministic first: solver output must stand on its own without LLM.
2. Capacity-true math: use real row capacities, never constant-slot assumptions.
3. Category-led control: rows are assigned to category blocks based on demand.
4. Stability-aware optimization: improve structure without unnecessary churn.
5. LLM as delta refiner: LLM should patch and improve, not rewrite from scratch.
6. Hard invariants at every stage: no invalid ownership, no impossible actions, no data loss.

## Problem Definition

Given:

1. A cellar with rows `R1..Rn`, each with capacity `cap(r)` (example: `R1=7`, others `9`).
2. Wines mapped to categories with confidence scores.
3. Current row-to-category allocation.
4. Stability and pin constraints.

Find:

1. A row-to-category allocation where categories may own multiple rows.
2. A move plan that improves placement and utilization.
3. Minimal disruption under configured stability bias.

## Optimization Objective

Maximize:

`objective = fit_score + contiguity_score + color_boundary_score - churn_penalty - overflow_penalty`

Where:

1. `fit_score`: bottles placed into best-fit category rows
2. `contiguity_score`: categories form compact row spans
3. `color_boundary_score`: white/rose/sparkling before reds
4. `churn_penalty`: moved bottles and changed rows
5. `overflow_penalty`: unresolved category deficits

## Constraints

1. Each row belongs to exactly one category at a time.
2. A category can own zero, one, or many rows.
3. Sum of row capacities allocated to a category must cover target demand where possible.
4. Pinned categories/rows cannot violate pin rules.
5. No row can be reallocated more than once in the same plan.
6. Reallocation actions must be sequentially valid (ownership changes after every action).
7. Zones/categories with bottles cannot be left with zero rows unless explicitly retired.

## Data Model Plan

## Canonical Entities

1. `cellar_rows`
2. `category_catalog`
3. `category_allocations`
4. `wine_category_scores`
5. `plan_snapshots`

## Proposed Fields

### `cellar_rows`

1. `cellar_id`
2. `row_id` (`R1`, `R2`, ...)
3. `capacity_slots` (supports non-uniform rows)
4. `physical_order` (integer)
5. `temperature_band` (optional)
6. `is_active` (for future partial areas)

### `category_catalog`

1. `category_id` (stable key)
2. `display_name`
3. `color_family` (`white`, `red`, `sparkling`, `rose`, `dessert`, `any`)
4. `priority`
5. `is_system`
6. `is_retirable`

### `category_allocations`

1. `cellar_id`
2. `category_id`
3. `assigned_rows` (array of row ids)
4. `slot_capacity_total` (derived snapshot)
5. `bottle_count` (derived snapshot)
6. `updated_at`

### `wine_category_scores`

1. `wine_id`
2. `category_id`
3. `score` (0..1)
4. `source` (`rules`, `llm`, `manual`, `hybrid`)
5. `updated_at`

### `plan_snapshots`

1. `plan_id`
2. `cellar_id`
3. `input_state_json`
4. `solver_plan_json`
5. `llm_delta_json`
6. `final_plan_json`
7. `telemetry_json`
8. `created_at`

## In-Memory Planner Structures

1. `RowState[]`: `{ rowId, capacity, order, categoryId }`
2. `CategoryState[]`: `{ categoryId, bottleDemand, slotDemand, rowsOwned[], pinned, colorFamily }`
3. `DemandVector`: category -> slot deficit/surplus
4. `AdjacencyGraph`: row order graph for contiguity scoring
5. `Action[]`: typed discriminated union
6. `SimulationState`: mutable ownership map with sequential validity checks

## Category-Led Dynamic Demand

Demand is computed from current cellar composition and category classification:

1. `bottleDemand(category) = count(wines assigned to category)`
2. `slotDemand(category) = bottleDemand + reserveBuffer`
3. `requiredCapacity(category)` uses percentile stress factor for near-term growth
4. `requiredRows(category)` is computed from actual available row capacities, not flat 9-slot rows

Categories can span multiple rows automatically when:

1. Demand exceeds one row capacity
2. Contiguous rows improve classification fit
3. Stability and boundary rules are preserved

## Solver Architecture

## Layer 0: Deterministic Preprocess (sub-10ms target)

1. Normalize row capacities
2. Recompute wine->category scoring
3. Build category demand and current deficits
4. Build color boundary map and contiguity map

## Layer 1: Deterministic Allocation Solver (sub-20ms target)

Primary recommendation: min-cost flow over row assignment.

1. Supply nodes: rows with capacity `cap(r)`
2. Demand nodes: categories with `slotDemand`
3. Edge cost components:
   - color mismatch penalty
   - contiguity break penalty
   - stability change penalty
   - pin violation hard block

Fallback: greedy best-first if flow solver fails.

Output:

1. Target category-to-rows allocation (categories may own multiple rows)
2. Deterministic action draft

## Layer 2: LLM Refinement (Sonnet default)

LLM receives deterministic draft and returns delta protocol:

1. `accept_action_ids`
2. `remove_action_ids`
3. `patches` (field-level changes)
4. `new_actions` (strictly schema-validated)
5. `reasoning`

Do not allow full freeform plan rewrite.

## Layer 2b: Opus 4.6 Escalation (conditional)

Escalate from Sonnet to Opus only when complexity score exceeds threshold:

1. many deficits
2. color boundary conflicts unresolved
3. high pin friction
4. low deterministic confidence

Complexity trigger example:

`complexityScore >= 0.7` -> run Opus 4.6 refinement pass.

## Layer 3: Heuristic Gap Fill (sub-2ms target)

Patch only unresolved deficits not already addressed.

1. Use live mutable simulation state.
2. Never emit type-inconsistent action fields.
3. Never donate below donor minimum viability.
4. Respect stability action cap.

## Layer 4: Deterministic Plan Validator and Simulator

Mandatory before apply:

1. replay actions sequentially
2. verify ownership each step
3. verify no duplicate row move
4. verify no invalid zone/category ids
5. verify capacity post-state
6. verify bottle-count invariants

If invalid, reject or auto-repair via deterministic patching.

## Action Schema Contract

Use one shared Zod discriminated union across:

1. solver output
2. LLM delta
3. reviewer
4. apply endpoint
5. UI rendering

Core action types:

1. `reallocate_row`
2. `merge_categories`
3. `retire_category`
4. `split_category` (optional advanced)
5. `swap_rows` (optional explicit primitive)

## Heuristic Interface Design (UX + Control)

## Planner Preview UI

1. Show category spans as row bands
2. Show each category's `demand vs allocated capacity`
3. Show reason for multi-row category expansion
4. Show churn estimate and stability score
5. Show unresolved issues clearly

## Apply Controls

1. Apply all
2. Skip action
3. Lock category (pin)
4. Re-run with stronger stability
5. Re-run with "optimize for fit"

## Explainability

For every action expose:

1. source (`solver`, `solver+llm`, `solver+llm+heuristic`)
2. local objective gain
3. affected wines estimate
4. risk flags

## Classification Strategy

Classification must be confidence-aware and robust:

1. Primary: deterministic grape/style/region rules
2. Secondary: normalized aliases and synonym tables
3. Tertiary: LLM tie-break for ambiguous wines
4. Store top-k category scores, not only top-1

Planner should use top-k distribution for demand smoothing to avoid hard misclassification spikes.

## Testing Plan

## Unit Tests

1. row-capacity math with non-uniform rows
2. multi-row category allocation correctness
3. sequential simulator validity
4. delta-apply behavior for LLM patches
5. no-type-drift guarantees (`rowNumber` normalization etc.)

## Property Tests

1. random cellars with random capacities and categories
2. invariants always hold after planning and apply
3. stability caps always respected

## Integration Tests

1. full 3-layer pipeline with LLM disabled
2. pipeline with Sonnet enabled and Opus escalation path
3. fallback behavior on model errors/timeouts
4. API apply idempotency and rollback safety

## Performance Targets

1. Layer 0 + 1 <= 20ms P95
2. Layer 3 <= 2ms P95
3. Full deterministic plan <= 30ms P95
4. Full with Sonnet <= 15s P95
5. Full with Opus escalation <= 45s P95

## Telemetry and Monitoring

Track:

1. solver latency
2. LLM latency and model path (Sonnet vs Opus)
3. number of actions by source
4. unresolved deficits after each layer
5. stability score before and after reviewer
6. plan acceptance and undo rates
7. post-apply misplacement delta

## Rollout Plan

## Phase 1: Data Foundations

1. add row capacity canonicalization
2. add category allocation snapshot fields
3. add shared action schema

## Phase 2: Deterministic Solver Upgrade

1. replace flat row math with true capacity math
2. implement category multi-row spanning by demand
3. add sequential simulator

## Phase 3: LLM Delta Interface

1. move from full-plan generation to delta protocol
2. add complexity-based Opus escalation
3. enforce schema + simulator gate

## Phase 4: UX and Operations

1. category-span visualization
2. explainability metadata in UI
3. telemetry dashboards and alerts

## Risks and Mitigations

1. Risk: overfitting to current category taxonomy
   - Mitigation: keep category catalog editable and track category drift telemetry
2. Risk: LLM proposes invalid deltas
   - Mitigation: strict schema + sequential simulator + deterministic fallback
3. Risk: user trust drops if plan churn is high
   - Mitigation: explicit stability controls and churn budget in objective
4. Risk: complexity creep in planner code
   - Mitigation: separate modules for state build, solver, simulator, delta apply

## Deliverables

1. `docs/data-plan.md` (this document)
2. schema RFC for action contract
3. solver upgrade spec with row-capacity-aware objective
4. simulator spec with invariant list
5. migration and telemetry checklist

