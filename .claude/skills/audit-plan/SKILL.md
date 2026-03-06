---
name: audit-plan
description: |
  Audit the quality of a plan before implementation begins. Checks that the plan
  covers all required engineering and UX principles, is specific enough to implement,
  addresses sustainability, and has no gaps or ambiguities.
  Requires a plan file path as argument.
  Triggers on: "audit the plan", "review the plan", "is the plan good enough",
  "check the plan quality", "audit-plan docs/plans/".
  Usage: /audit-plan docs/plans/my-feature.md
  The plan file must exist in the repository and should have been created by /plan-backend
  or /plan-frontend (or manually in the same format).
  disable-model-invocation: true
---

# Plan Quality Auditor

You are auditing the quality of a plan BEFORE implementation. Your job is to verify that
the plan is complete, principled, specific enough to build from, and will not lead to
rework or architectural regret.

**Input**: `$ARGUMENTS` — path to a plan document (e.g., `docs/plans/my-feature.md`)

## Step 0 — Load and Classify the Plan

1. **Read the plan file** at the provided path
2. **Determine plan type** — backend, frontend, or full-stack (based on content and sections present)
3. **Check metadata header** — Does it have Date, Status, Author?
4. **Identify the scope** — What is this plan trying to achieve?

If the plan file does not exist or cannot be read, stop and inform the user.

## Step 1 — Structural Completeness

Check that all required sections are present based on plan type.

### Backend Plans (created by /plan-backend)

| Section | Present? | Quality |
|---------|----------|---------|
| **Context Summary** | Does the plan explain what exists today? | |
| **Proposed Architecture** | Component diagram, data flow, design decisions with principle citations? | |
| **Sustainability Notes** | Assumptions, future change accommodation, extension points? | |
| **File-Level Plan** | Every file listed with path, purpose, key functions, dependencies, justification? | |
| **Risk & Trade-off Register** | Trade-offs documented, risks identified, deferrals justified? | |
| **Testing Strategy** | Unit tests, integration tests, edge cases identified? | |

### Frontend Plans (created by /plan-frontend)

| Section | Present? | Quality |
|---------|----------|---------|
| **Current UI Audit** | Existing patterns, design language, pain points, reusable components? | |
| **User Flow & Wireframe** | Step-by-step journey, ASCII wireframes, state transitions? | |
| **UX Design Decisions** | Choices with principle citations, Gestalt application, cognitive load, accessibility? | |
| **Technical Architecture** | Component diagram, state management, event handling, CSS architecture? | |
| **State Map** | Empty, loading, error, success, and edge case states for every component? | |
| **File-Level Plan** | Every file listed with path, purpose, key functions, dependencies? | |
| **Risk & Trade-off Register** | Trade-offs, browser compat, performance, accessibility gaps? | |
| **Testing Strategy** | Visual tests, accessibility tests, responsive breakpoints, edge cases? | |

### Missing Section Severity

| Severity | Missing Section |
|----------|----------------|
| HIGH | File-Level Plan, Proposed Architecture / Technical Architecture |
| HIGH | State Map (frontend) — leads to forgotten empty/error/loading states |
| MEDIUM | Sustainability Notes, Risk Register, Testing Strategy |
| MEDIUM | User Flow & Wireframe (frontend) |
| LOW | Context Summary / Current UI Audit (implies Phase 1 was skipped but might still be ok) |

## Step 2 — Principle Coverage Audit

Check that the plan explicitly addresses the relevant principles. The plan does NOT need to
mention every principle by name — but it must demonstrate that each was CONSIDERED.

### Backend Principle Coverage

For each principle, check if the plan addresses it:

**Core Design (1-10)**:
- [ ] **DRY** — Does the plan identify shared logic and propose extraction?
- [ ] **Single Responsibility** — Does each planned module/function have one clear purpose?
- [ ] **Open/Closed** — Can the design be extended without modifying existing code?
- [ ] **Liskov Substitution** — Are abstractions interchangeable?
- [ ] **Interface Segregation** — No forced dependencies on unused interfaces?
- [ ] **Dependency Inversion** — High-level modules depend on abstractions?
- [ ] **Modularity** — Are units composable and independently testable?
- [ ] **No Hardcoding** — Are values configurable (env vars, constants, config)?
- [ ] **No Dead Code** — Does the plan avoid creating unused paths?
- [ ] **Single Source of Truth** — Every constant/mapping defined in one place?

**Robustness (11-16)**:
- [ ] **Testability** — Are dependencies injectable? Can units be tested in isolation?
- [ ] **Defensive Validation** — Is input validated at boundaries?
- [ ] **Idempotency** — Are write operations safe to retry?
- [ ] **Transaction Safety** — Are multi-step mutations wrapped in transactions?
- [ ] **Consistent Error Handling** — Uniform error format, proper status codes?
- [ ] **Graceful Degradation** — What happens when external services fail?

**Performance & Sustainability (17-20)**:
- [ ] **N+1 Query Prevention** — Are DB patterns batched?
- [ ] **Backward Compatibility** — Do changes break existing consumers?
- [ ] **Observability** — Are errors meaningful and diagnosable from logs?
- [ ] **Long-Term Flexibility** — Does the sustainability assessment exist and address real concerns?

### Frontend Principle Coverage

**Gestalt (1-7)**:
- [ ] Proximity, Similarity, Continuity, Closure, Figure-Ground, Common Region, Common Fate

**Interaction & Usability (8-14)**:
- [ ] Affordances, User Flow, Consistency, Feedback, Error Prevention, Progressive Disclosure, Recognition over Recall

**Cognitive Load (15-18)**:
- [ ] Hick's Law, Fitts's Law, Visual Hierarchy, Whitespace

**Accessibility (19-22)**:
- [ ] Keyboard Navigation, Screen Reader Support, Colour Contrast, Focus Management

**State & Resilience (23-26)**:
- [ ] State Coverage, Performance Perception, Responsive Design, Dark Pattern Avoidance

**Technical (27-43)**:
- [ ] Component Architecture (SRP, Modularity, DRY, No Dead Code, No Hardcoding)
- [ ] State Management (Locality, Synchronisation, Optimistic Updates, URL State)
- [ ] Event Handling (Delegation, CSP Compliance, Memory Hygiene, Debounce)
- [ ] CSS (Variables, Naming, No Inline Styles, Specificity Control)

### Coverage Scoring

| Coverage | Assessment |
|----------|------------|
| 90-100% of applicable principles addressed | Plan is thorough |
| 70-89% addressed | Plan has gaps — flag missing principles |
| Below 70% | Plan is incomplete — significant rework risk |

## Step 3 — Specificity & Implementability

The plan must be specific enough that a developer can implement it without guessing.

### 3.1 File-Level Specificity

For each file in the File-Level Plan:

| Check | Severity |
|-------|----------|
| **File path is exact** — not vague like "somewhere in services" | HIGH |
| **Key functions are named** — not just "add helper functions" | HIGH |
| **Dependencies are listed** — what it imports AND what imports it | MEDIUM |
| **Purpose is clear** — a dev could implement from description alone | MEDIUM |

### 3.2 Data Flow Clarity

- [ ] Can you trace the complete request path from entry to response?
- [ ] Are the shapes of data at each boundary described (request body, response format, DB schema)?
- [ ] Are new API endpoints fully specified (method, path, request shape, response shape)?

### 3.3 Ambiguity Detection

Flag any language that is too vague to implement:

| Red Flag Phrases | Problem |
|-----------------|---------|
| "handle appropriately" | How? What does appropriate mean? |
| "as needed" | What determines the need? |
| "similar to X" | How similar? What differs? |
| "etc." in a feature list | What else is included? |
| "might need to" / "could also" | Is this in scope or not? |
| "standard approach" | Which standard? Document it. |
| "TBD" / "to be decided" | Decide before implementing |
| "probably" / "maybe" | Commit to a decision |

### 3.4 Decision Completeness

- [ ] Are all either/or choices resolved? (No "we could do A or B")
- [ ] Are edge cases addressed? (What happens with empty input, max values, concurrent access?)
- [ ] Are error scenarios specified? (What error message, what status code, what recovery?)

## Step 4 — Sustainability Assessment Quality

The sustainability section is where most plans fail. Audit it rigorously.

### 4.1 Backend Sustainability

- [ ] **Assumptions listed** — Does the plan explicitly state what it assumes will NOT change?
- [ ] **Change scenarios addressed** — Does it answer "what if requirements change in 6 months"?
- [ ] **Coupling assessment** — Does the plan state whether it tightens or loosens coupling?
- [ ] **Pattern vs exception** — Is this creating a reusable pattern or a one-off?
- [ ] **Migration path** — If this outgrows the design, what is the upgrade path?

### 4.2 Frontend Sustainability

- [ ] **Design system alignment** — Is the plan using CSS variables and reusable classes?
- [ ] **Scaling assessment** — Does it work with 5 items AND 500 items?
- [ ] **Mobile readiness** — Is the component architecture responsive-ready?
- [ ] **Accessibility foundation** — Are ARIA, keyboard, and focus patterns built in from the start?
- [ ] **Reusable pattern** — If first of its kind, is it designed as a template for others?

### 4.3 Anti-Patterns Check

Does the plan's architecture avoid these?

- [ ] God function / God component
- [ ] Shotgun surgery (one change = edits across 5+ files)
- [ ] Feature envy (service accessing another service's data)
- [ ] Leaky abstractions (DB column names in API responses)
- [ ] CSS soup / DOM spaghetti
- [ ] Invisible state (component behaves differently with no visual cue)

## Step 5 — Risk & Testing Gaps

### 5.1 Risk Register Quality

- [ ] Are risks specific (not generic "something might break")?
- [ ] Does each risk have a mitigation or acceptance rationale?
- [ ] Are trade-offs justified with reasoning, not just stated?
- [ ] Are deferred items tracked with "why it is OK to defer"?

### 5.2 Testing Strategy Quality

- [ ] Does the test strategy cover the critical path (not just happy path)?
- [ ] Are edge cases identified and assigned to test types?
- [ ] Is the test approach proportional to risk? (High-risk features get more coverage)
- [ ] For frontend: Are accessibility, responsive, and state tests planned?

## Step 6 — Generate the Audit Report

### Report Structure

```markdown
# Plan Audit Report: <Plan Name>
- **Plan**: <path to plan file>
- **Plan Type**: Backend / Frontend / Full-Stack
- **Date**: <today>
- **Auditor**: Claude

## Verdict

**READY TO IMPLEMENT** / **NEEDS REVISION** / **SIGNIFICANT GAPS**

## Summary
- **Structural Completeness**: X/Y sections present
- **Principle Coverage**: X% of applicable principles addressed
- **Specificity Score**: High / Medium / Low
- **Sustainability Assessment**: Strong / Adequate / Weak / Missing
- **HIGH findings**: N
- **MEDIUM findings**: N
- **LOW findings**: N

## Findings

### HIGH Severity

#### [H1] <Category>: <Short description>
- **Section**: Which plan section this relates to
- **Detail**: What is missing or inadequate
- **Risk**: What could go wrong during implementation if this is not fixed
- **Recommendation**: Specific improvement

### MEDIUM Severity

#### [M1] ...

### LOW Severity

#### [L1] ...

## Principle Coverage Matrix

| Principle | Addressed? | Where in Plan | Notes |
|-----------|-----------|---------------|-------|
| DRY | Yes | Section 2.1 | Identified shared validation |
| SRP | No | - | File X handles routing AND business logic |
| ... | | | |

## Specificity Assessment

| Planned File | Path Exact? | Functions Named? | Dependencies Listed? | Implementable? |
|-------------|------------|-----------------|---------------------|---------------|
| Wine service | Yes | Yes | Partial — missing consumers | Mostly |
| ... | | | | |

## Ambiguities Found

| Location | Vague Language | What Needs Clarification |
|----------|---------------|------------------------|
| Section 3.2 | "handle errors appropriately" | Specify: which errors, what response code, what message |

## Recommendations

Prioritised list of plan improvements before implementation begins:
1. [HIGH] Add missing X — risk of Y during implementation
2. [MEDIUM] Clarify Z — ambiguous, could lead to rework
3. [LOW] Add detail to W — nice to have for clarity
```

### Report Destination

Save the audit report to: `docs/plans/<plan-name>-plan-audit.md`

For example, if the plan is `docs/plans/wine-recommendation-engine.md`,
save the audit to `docs/plans/wine-recommendation-engine-plan-audit.md`.

---

## Execution Approach

1. **Read the plan thoroughly** — understand what it promises
2. **Check structure against template** — are all sections present?
3. **Walk every principle** — has each been considered?
4. **Test specificity** — could a developer implement from this plan alone?
5. **Stress-test sustainability** — "what if this changes?" for every major decision
6. **Be constructive** — the goal is to strengthen the plan, not tear it down
7. **Be specific** — every finding must cite the section and the gap
8. **Prioritise ruthlessly** — HIGH means implementation will fail or require rework without this fix

## Severity Guide

| Severity | Criteria | Examples |
|----------|----------|---------|
| **HIGH** | Implementation will fail, produce bugs, or require significant rework | Missing file-level plan, no error handling strategy, unresolved architecture decision, missing state map |
| **MEDIUM** | Implementation will work but quality, maintainability, or UX will suffer | Missing principle coverage, vague descriptions, weak sustainability section, incomplete testing strategy |
| **LOW** | Plan is functional but could be clearer or more thorough | Missing metadata header, minor ambiguities, missing context summary |
