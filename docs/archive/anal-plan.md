# Cellar Analysis UX Assessment And Restructure Plan

**Date:** 16 February 2026  
**Author:** Codex review (UX + flow + IA)  
**Scope:** `Cellar Analysis` view flow, naming, section structure, and refresh semantics

---

## 1. Executive Assessment

Your diagnosis is correct. The current experience mixes strategic and tactical content, duplicates move/fridge guidance, and forces users through a long non-MECE scroll where context shifts are hard to track.

The biggest issues are:

1. Controls are ambiguous (`AI Zone Structure`, `Reorganise Zones`, icon refresh).
2. Information architecture is mixed (zone strategy, placement execution, fridge, and alerts all interleaved).
3. Guidance is duplicated in multiple places (AI Tactical Moves vs Suggested Moves; AI Fridge plan vs Fridge section).
4. Alerts are fragmented into many cards instead of one prioritised issue digest.

---

## 2. Direct Answers To Your Core Questions

## 2.1 What does refresh do today?

Current behavior:

1. Refresh icon (`#refresh-analysis-btn`) calls `refreshAnalysis()` in `public/js/cellarAnalysis.js`.
2. `refreshAnalysis()` calls `loadAnalysis(true)` in `public/js/cellarAnalysis/analysis.js`.
3. That forces a fresh `/api/cellar/analyse?refresh=true` run (deterministic analysis snapshot).

What it does **not** do:

1. It does not auto-run AI Zone Structure (`/api/cellar/analyse/ai`).
2. It does not execute or re-run zone reconfiguration actions.
3. It does not apply any move by itself.

Conclusion: the icon currently means **Refresh analysis snapshot only**.

## 2.2 Are the two main buttons conceptually "structure first, then placement"?

Yes, that is the right mental model:

1. **Zone Structure**: define whether zone definitions and row allocation are sound.
2. **Cellar Placement**: move bottles into the agreed structure.

This is the right gestalt flow and should be explicit in both naming and layout.

---

## 3. Current-State Critical Findings

## 3.1 Control semantics are unclear (High)

Evidence:

1. `AI Zone Structure` triggers AI advice.
2. `Reorganise Zones` is dynamic and can represent setup/reconfigure/guide.
3. Refresh icon has no explicit scope in UI copy.

Impact:

1. Users cannot predict what each control changes.
2. "Refresh" can be misread as "redo AI" or "redo reconfiguration".

## 3.2 Strategic and tactical layers are mixed (High)

Evidence:

1. AI section includes `Zone Assessment`, `Zone Health`, and `Tactical Moves` in one block.
2. Separate page sections already render `Suggested Moves` and `Row Compaction`.

Impact:

1. User sees two move systems and must reconcile them mentally.
2. Stage order appears to jump back and forth between structure and execution.

## 3.3 Alert model is fragmented, not MECE (High)

Evidence:

1. Multiple alert cards for capacity, gaps, scattered wines, color boundary, reorg recommendation.
2. Alerts are shown independently with overlapping intent.

Impact:

1. Hard to know top priority.
2. Repetition increases cognitive load and perceived chaos.

## 3.4 Fridge guidance appears in two channels (Medium)

Evidence:

1. Dedicated `Fridge Status` section.
2. AI advice also renders `Fridge Recommendations`.

Impact:

1. Conflicting source-of-truth risk.
2. Users cannot tell which section to act from.

## 3.5 Long-scroll monolith hurts task focus (Medium)

Evidence:

1. Everything is vertically stacked in one flow.
2. User must scroll through unrelated content to continue one task.

Impact:

1. High context switching.
2. Low progress visibility.

---

## 4. Target UX Model (MECE)

Restructure into 3 explicit workspaces:

1. **Zone Analysis** (strategy)
2. **Cellar Placement** (execution)
3. **Fridge** (serving readiness)

Top-level toggle:

1. `Zone Analysis`
2. `Cellar Placement`
3. `Fridge`

Only one workspace visible at a time.

---

## 5. Recommended Control And Copy Model

## 5.1 Top action stack (above toggle)

Replace the current horizontal trio with a vertical workflow block:

1. **Zone Structure**
   Zone definitions and row allocation assessment.
2. **Cellar Placement**
   Move bottles into the agreed zone structure.
3. **Refresh Snapshot** (secondary/icon)
   Recompute current analysis from live layout data.

Behavior:

1. If structure is unresolved, `Cellar Placement` can remain enabled but shows "structure review recommended first".
2. Keep `Refresh Snapshot` neutral and non-destructive.

## 5.2 Rename suggestions

1. `AI Zone Structure` -> `Zone Structure`
2. `Reorganise Zones` -> `Cellar Placement` (top workflow button)
3. Keep destructive/reconfiguration actions labeled specifically inside context:
   `Reconfigure Zones`, `Apply Zone Plan`, `Execute Moves`

## 5.3 Refresh label/tooltip

Use explicit microcopy:

`Refresh Snapshot` tooltip:
`Re-runs cellar analysis (alerts, placement, fridge). Does not apply moves or re-run AI advice.`

---

## 6. Proposed Information Architecture By Workspace

## 6.1 Workspace A: Zone Analysis

Goal: decide whether structure is sound.

Sections:

1. `Zone Structure Verdict` (single prominent card, pass/fail + one-sentence rationale)
2. `Structure Issues` (single consolidated digest)
3. `Zone Overview` (cards/grid)
4. `Zone Health` (details)
5. `Reconfigure Zones` CTA (if needed)

Rules:

1. No tactical move cards here.
2. No fridge actions here.

## 6.2 Workspace B: Cellar Placement

Goal: execute physical bottle corrections.

Sections:

1. `Placement Summary` (misplaced count, scattered count, boundary count)
2. `Priority Moves` (single actionable list)
3. `Row Compaction` (separate but in same workspace)
4. `Execute All`, `Visual Guide`, per-move actions

Rules:

1. AI move judgments should annotate this list, not create a second list.
2. This is the only place where move execution controls live.

## 6.3 Workspace C: Fridge

Goal: stock fridge intentionally.

Sections:

1. Capacity + category mix
2. Gaps and recommendations
3. Add/swap actions
4. Organize fridge actions

Rules:

1. Fridge recommendations should only appear here.
2. Remove fridge duplicate panel from AI advice.

---

## 7. AI Advice Role Reframe

Current AI advice includes structure, health, tactical moves, and fridge recommendations.  
Target: AI advice is a **decision-support overlay**, not a parallel execution lane.

Recommended behavior:

1. In `Zone Analysis`, AI provides:
   `summary`, `layoutNarrative`, `zoneVerdict`, `zoneHealth`, `proposedZoneChanges`.
2. In `Cellar Placement`, AI can provide per-move status tags:
   `confirmed`, `modified`, `keep`.
3. In `Fridge`, AI can enrich candidate rationale only if needed.

Do not render separate AI move cards and separate native move cards.

---

## 8. Consolidated Alert Model (MECE)

Replace alert stack with one `Cellar Issues` digest card:

1. Structure issues
2. Placement issues
3. Fridge readiness issues

Each issue item has:

1. severity
2. impact count
3. owning workspace (`Zone Analysis`, `Cellar Placement`, `Fridge`)
4. one primary CTA

Example:

1. `Structure`: `6 zones over capacity` -> `Open Zone Analysis`
2. `Placement`: `21 bottles misplaced` -> `Open Cellar Placement`
3. `Fridge`: `3 category gaps` -> `Open Fridge`

---

## 9. Implementation Plan

## Phase 1: Semantics And Navigation (Low risk, immediate clarity)

Deliverables:

1. Rename top controls and add helper text.
2. Clarify refresh copy.
3. Add workspace toggle (`Zone Analysis | Cellar Placement | Fridge`).

Files:

1. `public/index.html`
2. `public/js/cellarAnalysis.js`
3. `public/js/cellarAnalysis/labels.js`
4. `public/css/components.css`

Acceptance:

1. Users can explain what each top control does without guesswork.
2. Refresh behavior is explicit.

## Phase 2: IA Separation (Medium risk, structural)

Deliverables:

1. Move sections into 3 workspaces.
2. Remove cross-workspace duplicates.
3. Keep one source of action controls per workspace.

Files:

1. `public/index.html`
2. `public/js/cellarAnalysis/analysis.js`
3. `public/js/cellarAnalysis/aiAdvice.js`
4. `public/js/cellarAnalysis/moves.js`
5. `public/js/cellarAnalysis/fridge.js`
6. `public/js/cellarAnalysis/zones.js`
7. `public/css/components.css`

Acceptance:

1. No repeated move section in two places.
2. No repeated fridge section in two places.

## Phase 3: Alert Consolidation (Medium risk, logic and UI)

Deliverables:

1. Build one issue digest component.
2. Route each issue to owning workspace CTA.

Files:

1. `public/js/cellarAnalysis/analysis.js`
2. `public/js/cellarAnalysis/zoneCapacityAlert.js`
3. `public/js/cellarAnalysis/zoneReconfigurationBanner.js`
4. `src/services/cellar/cellarAnalysis.js` (optional: add pre-grouped issue digest server-side)

Acceptance:

1. Alert area is one concise digest, not stacked repeats.
2. Top 3 actions are immediately obvious.

## Phase 4: AI Integration Cleanup (Medium risk, behavior alignment)

Deliverables:

1. AI advice no longer renders standalone tactical/fridge sections.
2. AI move opinions become tags/annotations on canonical move list.

Files:

1. `public/js/cellarAnalysis/aiAdvice.js`
2. `public/js/cellarAnalysis/aiAdviceActions.js`
3. `public/js/cellarAnalysis/moves.js`

Acceptance:

1. Exactly one move execution surface in UI.
2. AI and system recommendations no longer compete visually.

---

## 10. Testing And Validation Plan

Functional checks:

1. Refresh snapshot updates summary/alerts/moves/fridge only.
2. AI structure run updates structure content only.
3. Reconfigure zones and placement actions remain explicit and separated.
4. Toggle preserves state when switching workspaces.

Unit/integration focus:

1. `tests/unit/cellarAnalysis/*` for toggle state and section visibility.
2. Add regression tests for duplicate-section prevention.
3. Add copy/label test assertions for top control semantics.

UX acceptance checks:

1. First-time user can follow structure -> placement -> fridge flow without instruction.
2. User can always tell "where to act next" in under 3 seconds.

---

## 11. Risks And Mitigations

1. Risk: Existing users rely on current long-scroll sequence.
   Mitigation: Keep old section IDs where possible; migrate incrementally with toggle default to `Zone Analysis`.
2. Risk: AI advice perceived as "reduced" when tactical cards are removed.
   Mitigation: Show AI status badges directly on canonical move cards.
3. Risk: State-sync bugs when switching panes.
   Mitigation: centralize pane state in `cellarAnalysis/state.js` and test transitions.

---

## 12. Recommended First Increment (Practical Next Step)

Start with Phase 1 only:

1. Rename and clarify controls.
2. Add helper microcopy under top buttons.
3. Rename refresh to `Refresh Snapshot` with explicit tooltip text.
4. Introduce the 3-way workspace toggle scaffold (even before full content move).

This gives immediate usability gains with minimal regression risk and sets up clean Phase 2 migration.
