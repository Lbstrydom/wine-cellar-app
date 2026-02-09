# UX Fix Plan — Restaurant Pairing Wizard

**Created**: 2026-02-09  
**Revised**: 2026-02-09 (incorporated code review feedback)  
**Source**: User feedback on restaurant pairing flow clarity  
**Focus**: Process affordances, gestalt principles, user flow clarity

---

## Review Feedback Incorporated

All 9 findings from code review have been addressed:

| Finding | Severity | Fix Applied |
|---------|----------|-------------|
| R2 title injection won't survive render | HIGH | Changed to wrapper pattern with persistent title + body mount |
| R7 missing wiring for Next-button state | HIGH | Added `restaurant:selection-changed` event contract |
| scrollIntoView can cause unintended jumps | HIGH | Gated scroll with initial-render check + reduced-motion respect |
| R5 fade animation won't re-trigger | MEDIUM | Added `key="step-${step}"` to reset animation per step |
| Phase 3 choice cards lack keyboard handlers | MEDIUM | Added Enter/Space handlers + focus styles |
| Step 1 choice flow missing nav gating | MEDIUM | Added Step 1 state machine (`choice`/`quickPair`/`fullCapture`) |
| R8 Step 3 icon signature incomplete | MEDIUM | Fixed `renderDishReview()` signature + forwarding to `createImageCapture()` |
| Test impact understated | MEDIUM | Acknowledged 32 existing wizard tests + module tests, added test update checklists |
| Mobile deferral vs label changes | LOW | Added note about responsive handling in existing media queries |

---

## Problem Statement

The Restaurant Pairing wizard's 4-step flow lacks visual clarity and explicit guidance. Users report confusion about:
- What the 4 steps are
- What each step requires
- Where they are in the process
- What actions are available at each stage

The wizard functions correctly but fails to communicate its structure and expectations clearly.

---

## Current State

### Flow Architecture

```
Mode Toggle: [ From My Cellar ] [ At a Restaurant ]
                                         ↓
                            Restaurant Wizard (4 steps)
                                         ↓
Step 1: Capture  →  Step 2: Wines  →  Step 3: Dishes  →  Step 4: Pairings
   (image)           (review)            (review)           (results)
```

### Visual Components

| Component | Current Implementation | Issue |
|-----------|------------------------|-------|
| **Step Indicator** | Four numbered circles (36px) connected by lines | Numbers only — labels exist in `aria-label` but not visually rendered |
| **Step Content** | Immediate render of capture/filter/form UI | No step title, no instruction text, no orientation |
| **Navigation** | Generic "Back" / "Next" buttons at bottom | No context about what Back/Next leads to |
| **Validation** | Toast message on invalid Next click | Button appears enabled until clicked — no preventive feedback |
| **Process Overview** | None | User sees circles and capture widgets — no "journey preview" |

### User Journey Pain Points

1. **Entry (first view)**: Four circles, no labels, two competing CTAs (Quick Pair banner + Analyze button).
2. **Step transitions**: Abrupt content swap, no animation, no scroll-to-top.
3. **Step 1 vs Step 3**: Both show identical capture widgets (textarea + image upload) — visually indistinguishable.
4. **Validation gates**: User clicks Next → toast error. Button should signal readiness state.

---

## Issues Found

### I1: Invisible Step Labels (HIGH IMPACT)

**Problem**: Step indicator renders `[ 1 ]—[ 2 ]—[ 3 ]—[ 4 ]` as circles only. The labels ("Capture", "Wines", "Dishes", "Pairings") are defined in `STEP_LABELS` array and exist in `aria-label`, but are never visually displayed.

**User Impact**: Cannot preview the journey. Must click through each step to discover its purpose.

**Files**:
- `public/js/restaurantPairing.js` L23 (defines labels), L320 (renders circles with number only)
- `public/css/components.css` L7243-7260 (step indicator styling — no label beneath circle)

**Gestalt Violation**: Proximity/Labelling — indicator shows location but not identity.

---

### I2: No Step Title in Content Area (HIGH IMPACT)

**Problem**: When a step renders, the content area (`<div class="restaurant-step-content">`) immediately shows UI widgets (textarea, filters, cards) with no heading or orientation text.

**Example**: Step 1 shows a textarea placeholder "Paste wine list here..." but no title like "Step 1: Capture Your Wine List". Step 2 shows filter chips with no "Review Wines" heading.

**Exception**: Step 3 has an `<h3>Capture Dish Menu</h3>` (dishReview.js L62), but it's buried inside the capture widget, not a prominent step title.

**User Impact**: Disorientation. User must infer the step's purpose from placeholder text and button labels.

**Files**:
- `public/js/restaurantPairing.js` L59-127 (renderStep — no title injection before step modules render)
- `public/js/restaurantPairing/wineReview.js` L131 (no title, starts with triage banner)
- `public/js/restaurantPairing/dishReview.js` L62 (h3 exists but not step-level)
- `public/js/restaurantPairing/results.js` L67 (no title, starts with summary)

---

### I3: No Process Overview (MEDIUM IMPACT)

**Problem**: When "At a Restaurant" mode activates, the wizard appears with no onboarding or preview. User sees numbered circles and a capture widget — no top-level sentence explaining the journey.

**User Impact**: Cognitive load. User must discover the process through exploration. No mental model set upfront.

**Best Practice**: Wizards should show a one-line subtitle like *"Snap your wine list → pick dishes → get AI pairings"* on initial render.

**Files**:
- `public/js/restaurantPairing.js` L313-333 (wizard skeleton build — no subtitle element)

---

### I4: Competing CTAs on Step 1 (MEDIUM IMPACT)

**Problem**: Step 1 renders two distinct paths simultaneously:
1. **Quick Pair banner** (line renders at top: "⚡ Quick Pair — snap & type → instant pairings")
2. **Full capture widget** (textarea + image upload + Analyze button)

Both are visible on first load. User must decide which path to take without understanding the tradeoff (speed vs accuracy).

**User Impact**: Decision paralysis at entry. Two primary CTAs compete for attention. The banner format (small link button at top) doesn't signal it's a major workflow fork.

**Files**:
- `public/js/restaurantPairing.js` L73-101 (Quick Pair banner + capture widget both rendered)
- `public/css/components.css` L7943-7957 (banner styled as subtle top bar, not prominent choice)

**Recommendation**: Restructure Step 1 as a **choice screen** with two clear cards: "Quick Pair (fast)" vs "Full Wizard (accurate)".

---

### I5: No Transition Feedback (LOW-MEDIUM IMPACT)

**Problem**: Step transitions swap `stepContainer.innerHTML` instantly. No fade animation, no scroll-to-top, no visual indicator that content changed besides the step circle colour update.

**User Impact**: Abrupt experience. On small screens, user may not notice they've moved to a new step if the top of the wizard is off-screen.

**Files**:
- `public/js/restaurantPairing.js` L59-67 (renderStep destroys + innerHTML swap, no animation)
- `public/css/components.css` L7228-7232 (.restaurant-step-content has no transition animation)

---

### I6: Generic Navigation Labels (MEDIUM IMPACT)

**Problem**: Back/Next buttons always say "Back" and "Next", regardless of step. No contextual preview of where navigation leads.

**Example**: On Step 2, "Next" button could say "Next: Add Dishes →" instead of generic "Next".

**User Impact**: Missed opportunity to reinforce mental model. Contextual labels ("Review Wines →", "← Back to Capture") guide expectations.

**Files**:
- `public/js/restaurantPairing.js` L327-330 (static labels in HTML), L162-172 (updateNavButtons only toggles visibility, not text)

---

### I7: Reactive Validation (MEDIUM IMPACT)

**Problem**: Validation gates exist (Step 2→3 requires ≥1 wine selected, Step 3→4 requires ≥1 dish), but enforcement is reactive. The Next button appears enabled — validation fires a toast on click.

**User Impact**: User clicks Next → error toast → confusion. The button should signal unmet requirements before click.

**Files**:
- `public/js/restaurantPairing.js` L178-195 (handleNext runs validation AFTER click, shows toast)
- No disabled state or helper text for requirement visibility

**Best Practice**: Disable Next button with inline text: *"Select at least one wine to continue"* until gate satisfied.

---

### I8: Steps 1 & 3 Are Visually Identical (LOW-MEDIUM IMPACT)

**Problem**: Both Step 1 (wine capture) and Step 3 (dish capture) render the same `imageCapture` widget. The only difference is placeholder text ("Paste wine list here..." vs "Paste dish menu here..."). Color tinting and structure are identical.

**User Impact**: On Step 3, user may think they're back on Step 1. Lack of visual differentiation weakens step identity.

**Files**:
- `public/js/restaurantPairing.js` L102-114 (Step 1 capture), L119-122 (Step 3 capture — same widget)
- `public/js/restaurantPairing/imageCapture.js` L59-98 (single widget template for both)

**Opportunity**: Add distinctive header icon/color per step. Step 1: wine glass icon + burgundy accent. Step 3: plate icon + sage accent (matches existing card tinting at L7310, L7319).

---

## Recommendations

| ID | Issue | Fix | Effort | Impact | Priority |
|----|-------|-----|--------|--------|----------|
| **R1** | I1 — Invisible labels | Add visible text labels below step circles: `<span class="restaurant-step-label">Capture</span>`. CSS: `font-size: var(--font-2xs)`, centered below circle, grey when inactive, accent when active. | S | HIGH | 1 |
| **R2** | I2 — No step titles | Add `<h3 class="restaurant-step-title">` as first child of each step content. E.g. "Capture Wine List", "Review & Select Wines", "Add Your Dishes", "Your Pairings". | S | HIGH | 1 |
| **R3** | I3 — No overview | Add a subtitle below step indicator (show on Step 1 only): `<p class="restaurant-wizard-subtitle text-muted">Snap your wine list → pick dishes → get AI pairings</p>` | S | MED | 2 |
| **R4** | I4 — Competing CTAs | Restructure Step 1 as a choice screen: two cards (Quick Pair vs Full Wizard). Quick Pair → quickPair.js form. Full Wizard → capture widget. | M | MED | 3 |
| **R5** | I5 — No transitions | Add CSS fade-in animation on `.restaurant-step-content` (200ms). Call `wizardContainer.scrollIntoView({ behavior: 'smooth' })` on step change. | S | LOW-MED | 4 |
| **R6** | I6 — Generic nav | Make Next button text contextual: `updateNavButtons(step)` sets `nextBtn.textContent` — "Review Wines →", "Add Dishes →", "Get Pairings →". Back button: "← Wine List", "← Review Wines", "← Review Dishes". | S | MED | 2 |
| **R7** | I7 — Reactive validation | Disable Next button when unmet. Add inline helper text below button: `<span class="restaurant-nav-helper">Select at least one wine to continue</span>`. Update on selection change. Add CSS for `.restaurant-nav-next[disabled]`. | S-M | MED | 2 |
| **R8** | I8 — Identical steps | Add per-step iconography and accent color to capture widget headers. Step 1: `🍷 Capture Wine List` (burgundy), Step 3: `🍽️ Capture Dish Menu` (sage). | S | LOW-MED | 4 |

**Effort Scale**: S (< 1hr), M (1-3hr), L (> 3hr)
**Impact**: How much it improves user clarity
**Priority**: 1 (must-fix), 2 (should-fix), 3 (nice-to-have), 4 (polish)

---

## Implementation Plan

### Phase 1: Critical Labelling (R1 + R2 + R3)

**Goal**: Make the wizard self-explanatory at a glance.

**Tasks**:

1. **Add step labels below circles** (R1)
   - File: `public/js/restaurantPairing.js`
   - Change L320 from `<button>...${num}</button>` to:
     ```html
     <button class="restaurant-step-indicator-item" ...>
       ${num}
       <span class="restaurant-step-label">${label}</span>
     </button>
     ```
   - File: `public/css/components.css`
   - Add after L7260:
     ```css
     .restaurant-step-label {
       position: absolute;
       top: 100%;
       margin-top: 0.25rem;
       font-size: var(--font-2xs);
       color: var(--text-muted);
       white-space: nowrap;
       font-weight: 500;
     }
     .restaurant-step-indicator-item.active .restaurant-step-label {
       color: var(--accent);
     }
     ```

2. **Add step titles to content** (R2)
   - File: `public/js/restaurantPairing.js`
   - In `renderStep()` (L59), restructure to use a wrapper with persistent title:
     ```javascript
     const titles = ['Capture Wine List', 'Review & Select Wines', 'Add Your Dishes', 'Your Pairings'];
     
     // Create persistent wrapper with title + body mount
     stepContainer.innerHTML = `
       <div class="restaurant-step-wrapper">
         <h3 class="restaurant-step-title">${titles[step - 1]}</h3>
         <div class="restaurant-step-body"></div>
       </div>
     `;
     
     // Get body mount for modules to render into
     const stepBody = stepContainer.querySelector('.restaurant-step-body');
     stepContainer.id = 'restaurant-step-container'; // Keep for module targeting
     ```
   - Update each step module to target `.restaurant-step-body` or pass `stepBody` element.
   - **Critical**: This prevents step modules from overwriting the title when they render.
   
   - File: `public/css/components.css`
   - Add after L7228:
     ```css
     .restaurant-step-wrapper {
       display: flex;
       flex-direction: column;
       gap: 1rem;
     }
     .restaurant-step-title {
       font-size: var(--font-xl);
       font-weight: 600;
       margin: 0;
       color: var(--text-primary);
     }
     .restaurant-step-body {
       flex: 1;
       min-height: 0;
     }
     ```

3. **Add wizard subtitle** (R3)
   - File: `public/js/restaurantPairing.js`
   - In `initRestaurantPairing()` L313, add below `.restaurant-wizard-header`:
     ```html
     <p class="restaurant-wizard-subtitle text-muted">
       Snap your wine list → pick dishes → get AI pairings
     </p>
     ```
   - In `renderStep()`, toggle visibility:
     ```javascript
     const subtitle = wizardContainer.querySelector('.restaurant-wizard-subtitle');
     subtitle.style.display = step === 1 ? '' : 'none';
     ```

**Test**: Load wizard, verify circles have visible labels, each step has a title, subtitle shows on Step 1.

**Acceptance**:
- ✅ Step indicator shows "1 Capture", "2 Wines", "3 Dishes", "4 Pairings" (visually, not just aria-label)
- ✅ Each step content starts with an h3 title (survives module renders)
- ✅ Subtitle visible on Step 1, hidden on Steps 2-4
- ✅ Labels responsive: stack on mobile (<= 768px), hide on narrow (<= 480px)
- ✅ Tests updated: 5 tests in `restaurantPairing.test.js` modified for new HTML structure

---

### Phase 2: Navigation Clarity (R6 + R7)

**Goal**: Make navigation predictable and requirements explicit.

**Tasks**:

1. **Contextual nav labels** (R6)
   - File: `public/js/restaurantPairing.js`
   - Update `updateNavButtons(step)` L162-172 to set text:
     ```javascript
     const nextLabels = ['Review Wines →', 'Add Dishes →', 'Get Pairings →'];
     const backLabels = ['← Wine List', '← Review Wines', '← Review Dishes'];
     if (nextBtn && step < 4) {
       nextBtn.textContent = nextLabels[step - 1];
     }
     if (backBtn && step > 1) {
       backBtn.textContent = backLabels[step - 2];
     }
     ```

2. **Preventive validation** (R7)
   - File: `public/js/restaurantPairing.js`
   - Add nav helper element in `initRestaurantPairing()` L325:
     ```html
     <div class="restaurant-nav-bar">
       <button class="btn btn-secondary restaurant-nav-back">...</button>
       <div class="restaurant-nav-next-group">
         <button class="btn btn-primary restaurant-nav-next">...</button>
         <span class="restaurant-nav-helper text-muted"></span>
       </div>
     </div>
     ```
   - In `updateNavButtons(step)`, add validation state:
     ```javascript
     const helperEl = wizardContainer.querySelector('.restaurant-nav-helper');
     if (step === 2) {
       const wineCount = getSelectedWines().length;
       nextBtn.disabled = wineCount === 0;
       helperEl.textContent = wineCount === 0 ? 'Select at least one wine to continue' : '';
     } else if (step === 3) {
       const dishCount = getSelectedDishes().length;
       nextBtn.disabled = dishCount === 0;
       helperEl.textContent = dishCount === 0 ? 'Select at least one dish to continue' : '';
     } else {
       nextBtn.disabled = false;
       helperEl.textContent = '';
     }
     ```
   
   - **Event Contract**: Add a custom event listener in `initRestaurantPairing()` to refresh nav state:
     ```javascript
     // In initRestaurantPairing() after binding nav buttons:
     addListener(wizardContainer, 'restaurant:selection-changed', () => {
       updateNavButtons(getStep());
     });
     ```
   
   - **Module Integration**: In `wineReview.js` and `dishReview.js`, dispatch event after selection changes:
     ```javascript
     // After setWineSelected/setDishSelected calls:
     const event = new CustomEvent('restaurant:selection-changed', { bubbles: true });
     rootContainer.dispatchEvent(event);
     ```
   
   - This avoids tight coupling — modules don't call controller internals, just dispatch events.

   - File: `public/css/components.css`
   - Add after L7402:
     ```css
     .restaurant-nav-next-group {
       display: flex;
       flex-direction: column;
       align-items: flex-end;
       gap: 0.25rem;
     }
     .restaurant-nav-helper {
       font-size: var(--font-xs);
     }
     .restaurant-nav-next:disabled {
       opacity: 0.5;
       cursor: not-allowed;
     }
     ```

**Test**: Navigate to Step 2 with 0 wines selected → Next button disabled + helper text. Select a wine → Next enabled.

**Acceptance**:
- ✅ Next button shows "Review Wines →" on Step 1, "Add Dishes →" on Step 2, etc.
- ✅ Next button disabled + helper text when validation unmet
- ✅ Helper text clears when requirement satisfied
- ✅ Selection changes trigger nav state refresh via event (no direct coupling)
- ✅ Tests updated: 8 tests in wineReview/dishReview tests verify event dispatch

---

### Phase 3: Choice Screen (R4)

**Goal**: Eliminate competing CTAs on Step 1.

**Tasks**:

1. **Create choice screen UI**
   - File: `public/js/restaurantPairing.js`
   - In `renderStep(1)`, replace Quick Pair banner + capture widget with choice cards:
     ```javascript
     case 1: {
       stepContainer.innerHTML = `
         <div class="restaurant-choice-screen">
           <div class="restaurant-choice-card restaurant-choice-quick" role="button" tabindex="0">
             <div class="restaurant-choice-icon">⚡</div>
             <h4>Quick Pair</h4>
             <p>One photo + dish list → instant pairings. Best guess parsing.</p>
             <span class="restaurant-choice-badge">Fast</span>
           </div>
           <div class="restaurant-choice-card restaurant-choice-full" role="button" tabindex="0">
             <div class="restaurant-choice-icon">🎯</div>
             <h4>Full Wizard</h4>
             <p>Review wines & dishes before pairing. More accuracy.</p>
             <span class="restaurant-choice-badge">Accurate</span>
           </div>
         </div>
       `;
       
       // State machine for Step 1: track which path chosen
       let step1State = 'choice'; // 'choice' | 'quickPair' | 'fullCapture'
       
       // Bind choice handlers
       const quickCard = stepContainer.querySelector('.restaurant-choice-quick');
       const fullCard = stepContainer.querySelector('.restaurant-choice-full');
       
       const handleQuickChoice = () => {
         step1State = 'quickPair';
         destroyCurrentStep();
         const stepBody = stepContainer.querySelector('.restaurant-step-body');
         stepBody.innerHTML = '';
         const qp = renderQuickPair(stepBody, {
           parseBudget,
           onComplete: async () => { await runQuickPairFlow(); },
           onCancel: () => { 
             step1State = 'choice';
             renderStep(1); 
           }
         });
         currentStepDestroy = () => qp.destroy();
         updateNavButtons(1); // Update nav for quickPair substate
       };
       
       const handleFullChoice = () => {
         step1State = 'fullCapture';
         const stepBody = stepContainer.querySelector('.restaurant-step-body');
         stepBody.innerHTML = '';
         const captureWidget = createImageCapture(stepBody, {
           type: 'wine_list',
           maxImages: 4,
           parseBudget,
           onAnalyze: (items) => {
             mergeWines(items);
             renderStep(2);
           }
         });
         currentStepDestroy = () => captureWidget.destroy();
         updateNavButtons(1); // Update nav to hide Next until capture
       };
       
       addListener(quickCard, 'click', handleQuickChoice);
       addListener(fullCard, 'click', handleFullChoice);
       
       // Keyboard accessibility
       addListener(quickCard, 'keydown', (e) => {
         if (e.key === 'Enter' || e.key === ' ') {
           e.preventDefault();
           handleQuickChoice();
         }
       });
       addListener(fullCard, 'keydown', (e) => {
         if (e.key === 'Enter' || e.key === ' ') {
           e.preventDefault();
           handleFullChoice();
         }
       });
       
       break;
     }
     ```
   
   - **Nav Gating**: Update `updateNavButtons(step)` to check Step 1 state:
     ```javascript
     if (step === 1) {
       // Step 1: hide Next until path chosen and data captured
       if (step1State === 'choice') {
         nextBtn.style.display = 'none';
       } else if (step1State === 'fullCapture') {
         nextBtn.style.display = hasData() ? '' : 'none';
       } else {
         nextBtn.style.display = 'none'; // quickPair uses its own flow
       }
     }
     ```

   - File: `public/css/components.css`
   - Add after L7410:
     ```css
     .restaurant-choice-screen {
       display: grid;
       grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
       gap: 1.5rem;
       padding: 1rem 0;
     }
     .restaurant-choice-card {
       background: var(--bg-card);
       border: 2px solid var(--border);
       border-radius: 12px;
       padding: 1.5rem;
       cursor: pointer;
       transition: all 0.2s;
       text-align: center;
     }
     .restaurant-choice-card:hover {
       border-color: var(--accent);
       box-shadow: 0 4px 12px rgba(0,0,0,0.1);
     }
     .restaurant-choice-card:focus {
       outline: 2px solid var(--accent);
       outline-offset: 2px;
     }
     .restaurant-choice-icon {
       font-size: 3rem;
       margin-bottom: 0.5rem;
     }
     .restaurant-choice-card h4 {
       margin: 0.5rem 0;
     }
     .restaurant-choice-card p {
       font-size: var(--font-sm);
       color: var(--text-muted);
       margin-bottom: 0.75rem;
     }
     .restaurant-choice-badge {
       display: inline-block;
       background: var(--accent);
       color: white;
       padding: 0.25rem 0.75rem;
       border-radius: 12px;
       font-size: var(--font-xs);
       font-weight: 600;
     }
     ```

**Test**: Step 1 shows two cards. Click Quick Pair → quickPair form. Click Back → choice screen. Click Full Wizard → capture widget.

**Acceptance**:
- ✅ Step 1 renders two distinct choice cards (no banner)
- ✅ Quick Pair card loads quickPair.js form
- ✅ Full Wizard card loads capture widget (current Step 1 behaviour)
- ✅ Keyboard navigation: Enter/Space on cards triggers selection
- ✅ Focus styles visible on keyboard nav
- ✅ Next button hidden until path chosen + data captured
- ✅ Tests added: 12 new tests for choice screen, state machine, keyboard handlers

---

### Phase 4: Polish (R5 + R8)

**Goal**: Smooth transitions and per-step identity.

**Tasks**:

1. **Animation + scroll** (R5)
   - File: `public/css/components.css`
   - Add after L7228:
     ```css
     .restaurant-step-content {
       min-height: 0;
     }
     .restaurant-step-body {
       animation: fadeIn 200ms ease-in;
     }
     @keyframes fadeIn {
       from { opacity: 0; }
       to { opacity: 1; }
     }
     ```
   - **Animation Reset**: To re-trigger on each step, add a key to `.restaurant-step-body`:
     ```javascript
     // In renderStep(), when creating wrapper:
     stepContainer.innerHTML = `
       <div class="restaurant-step-wrapper">
         <h3 class="restaurant-step-title">${titles[step - 1]}</h3>
         <div class="restaurant-step-body" key="step-${step}"></div>
       </div>
     `;
     ```
   - The `key` attribute change forces browser to treat it as a new element, re-running animation.
   - File: `public/js/restaurantPairing.js`
   - In `renderStep()` after `updateNavButtons(step)`, add gated scroll:
     ```javascript
     // Only scroll on user-triggered transitions, not initial render
     if (step > 1 || hasData()) {
       // Respect prefers-reduced-motion
       const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
       wizardContainer.scrollIntoView({ 
         behavior: prefersReducedMotion ? 'auto' : 'smooth', 
         block: 'start' 
       });
     }
     ```
   - This prevents scroll jumps when wizard first renders (Step 1 initial state) or when mode toggled while wizard hidden.

2. **Per-step iconography** (R8)
   - File: `public/js/restaurantPairing/imageCapture.js`
   - Add `icon` parameter to `createImageCapture()` options (L28).
   - In template (L59), prepend to container:
     ```html
     <div class="restaurant-capture-header">
       ${options.icon || ''} ${options.headerText || ''}
     </div>
     ```
   - File: `public/js/restaurantPairing.js`
   - Pass icon in Step 1 capture call (L102):
     ```javascript
     const captureWidget = createImageCapture(captureContainer, {
       type: 'wine_list',
       icon: '🍷',
       headerText: 'Capture Wine List',
       // ... rest
     });
     ```
   - Update `renderDishReview()` signature to accept options:
     ```javascript
     // File: public/js/restaurantPairing/dishReview.js
     // Change signature from (containerId, parseBudget) to (containerId, parseBudget, options = {})
     export function renderDishReview(containerId, parseBudget, options = {}) {
       const { icon, headerText } = options;
       // ...
     }
     ```
   
   - Pass icon in Step 3 render call:
     ```javascript
     // File: public/js/restaurantPairing.js
     case 3:
       renderDishReview('restaurant-step-container', parseBudget, {
         icon: '🍽️',
         headerText: 'Capture Dish Menu'
       });
       currentStepDestroy = destroyDishReview;
       break;
     ```
   
   - Forward options to `createImageCapture()` in dishReview.js:
     ```javascript
     // In renderDishReview(), when calling createImageCapture:
     captureWidget = createImageCapture(captureContainer, {
       type: 'dish_menu',
       maxImages: 4,
       parseBudget: parseBudget || { used: 0 },
       icon: options.icon,
       headerText: options.headerText,
       onAnalyze: (items) => { ... }
     });
     ```
   - File: `public/css/components.css`
   - Add after L7494:
     ```css
     .restaurant-capture-header {
       font-size: var(--font-lg);
       font-weight: 600;
       margin-bottom: 1rem;
       display: flex;
       align-items: center;
       gap: 0.5rem;
     }
     ```

**Test**: Navigate between steps → fade-in animation. Check Step 1 capture has wine icon, Step 3 has dish icon.

**Acceptance**:
- ✅ Step content fades in on transition (animation re-triggers per step)
- ✅ Wizard scrolls to top on user-triggered step change (not initial render)
- ✅ Scroll respects `prefers-reduced-motion`
- ✅ Step 1 capture shows "🍷 Capture Wine List"
- ✅ Step 3 capture shows "🍽️ Capture Dish Menu"
- ✅ Tests updated: animation/scroll tests mock `matchMedia`, verify gating

---

## Execution Order

```
Phase 1 (Labelling: R1+R2+R3) → Phase 2 (Navigation: R6+R7) → Phase 3 (Choice: R4) → Phase 4 (Polish: R5+R8)
         ASAP — 2-3hr                    Next — 2-3hr              Later — 3-4hr         Optional — 1-2hr
```

### Pre-flight for each phase

1. `npm run test:unit` — baseline must pass
2. **Update existing tests**: The wizard has 32 tests in `restaurantPairing.test.js` plus module tests (`wineReview.test.js`, `dishReview.test.js`, `results.test.js`, `quickPair.test.js`). Each phase requires test updates:
   - **Phase 1**: Update snapshot tests for step indicator HTML (labels added), add title presence assertions
   - **Phase 2**: Update nav button text assertions, add validation state tests
   - **Phase 3**: Add choice screen tests (card render, keyboard handlers, state transitions)
   - **Phase 4**: Update animation/scroll tests (may need to mock `matchMedia`)
3. Apply changes
4. `npm run test:unit` — verify test updates pass
5. Manual QA: Load wizard, walk through all 4 steps, test keyboard nav
6. Commit with `feat(ux):` prefix
7. Deploy to Railway, smoke test in production

### Commit strategy

- **Phase 1**: Single commit (`feat(ux): add step labels, titles, and wizard subtitle`)
- **Phase 2**: Single commit (`feat(ux): contextual nav labels and preventive validation`)
- **Phase 3**: Single commit (`feat(ux): choice screen for Step 1 entry`)
- **Phase 4**: One commit per task (R5 animation, R8 iconography)

---

## Not Addressed (Intentional Deferrals)

| Item | Reason |
|------|--------|
| Mobile responsive breakpoints | Current wizard is desktop-first; mobile optimisation is separate scope. **Note**: Phase 1 step labels will need responsive handling in existing media queries (`components.css` L8092+) — labels stack vertically on tablet, hide on mobile (<= 480px). |
| Keyboard navigation enhancements | `tabindex` and `aria-*` already present. Full keyboard wizard navigation is Phase G+ scope. |
| Step persistence on page reload | SessionStorage already persists state. Adding URL hash routing is separate feature. |
| Multi-language step labels | i18n is not implemented app-wide. English-only for now. |
| Accessibility audit (WCAG AA) | Current wizard has basic ARIA. Full audit is separate initiative. |
| Quick Pair vs Full Wizard analytics | No analytics framework. Add after choice screen implementation. |

---

## Success Metrics

| Metric | Current (baseline) | Target (post-fix) |
|--------|--------------------|--------------------|
| User understands step purpose before clicking | Unknown (no labels) | 90%+ (visible labels + titles) |
| Validation error rate (Next clicks with 0 selections) | High (reactive only) | < 10% (preventive disabled state) |
| Step 1 choice clarity | Ambiguous (competing CTAs) | Clear (two distinct cards) |
| User orientation on entry | Low (no overview) | High (subtitle + labels) |

Measure via user testing after Phase 1 + 2 deployment.
