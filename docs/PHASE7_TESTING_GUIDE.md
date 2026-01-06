# Phase 7 User Testing Guide
## Sommelier-Grade Cellar Organisation

**Version**: 1.0
**Date**: 6 January 2026
**Estimated Testing Time**: 45-60 minutes

---

## Overview

This guide covers all user-facing features implemented in Phase 7. Test each section and provide feedback using the template at the end.

---

## Pre-Testing Checklist

Before starting, ensure:
- [ ] App is running and accessible
- [ ] You have at least 10-15 wines in your cellar
- [ ] You have wines in both cellar and fridge
- [ ] You have some wines with drinking windows set
- [ ] Browser console is open (F12 → Console) to catch any errors

---

## Test Sections

### 1. Zone Metadata & Narratives (7.2, 7.3)

**What to Test**: Zone definitions now include purpose, style descriptions, and pairing hints.

**Steps**:
1. Go to the **Cellar** tab
2. Click **"Analyse Cellar"** button
3. Look for zone narrative cards showing:
   - Zone purpose (e.g., "Crisp whites for weeknight cooking")
   - Style range description
   - Serving temperature recommendations
   - Food pairing hints
   - Example wines in each zone

**What to Look For**:
- [ ] Each zone displays a meaningful narrative
- [ ] Style descriptions match the wines in each zone
- [ ] Pairing hints are relevant to wine types
- [ ] No empty or placeholder text

**Feedback Questions**:
- Are the zone descriptions helpful and accurate?
- Do the pairing hints match what you'd expect?
- Is anything confusing or incorrect?

---

### 2. Fridge Status Panel (7.5, 7.6)

**What to Test**: Fridge now shows par-level status and gap warnings.

**Steps**:
1. Go to the **Fridge** tab (or fridge section)
2. Look for the fridge status panel showing:
   - Current bottles vs par levels by category
   - Gap warnings (e.g., "Missing: Sparkling for celebrations")
   - Fill suggestions

**What to Look For**:
- [ ] Status panel appears near the fridge grid
- [ ] Shows counts by category (white crisp, red light, sparkling, etc.)
- [ ] Highlights gaps where you're below par levels
- [ ] Suggestions make sense based on your collection

**Feedback Questions**:
- Are the par-level categories appropriate for your drinking habits?
- Are the gap warnings accurate?
- Would you act on the fill suggestions?

---

### 3. AI Cellar Analysis (7.3, 7.4)

**What to Test**: Enhanced analysis with zone context and specific recommendations.

**Steps**:
1. Click **"Analyse Cellar"** button
2. Review the AI analysis report
3. Check for:
   - Misplaced bottle identification
   - Zone-specific recommendations
   - Drinking window warnings
   - Event readiness assessment

**What to Look For**:
- [ ] Analysis completes without errors
- [ ] Misplaced wines are correctly identified
- [ ] Recommendations reference specific zones
- [ ] No hallucinated wines (wines not in your collection)

**Feedback Questions**:
- Do the recommendations make sense?
- Are misplaced wines actually in the wrong zone?
- Is the analysis actionable?

---

### 4. Zone Chat / Conversational AI (7.4, 7.7)

**What to Test**: Chat-based zone classification and wine placement help.

**Steps**:
1. In Cellar Analysis, look for a chat interface or "Ask AI" button
2. Try asking questions like:
   - "Where should I put my new Sancerre?"
   - "What zone is best for a full-bodied Barossa Shiraz?"
   - "Why is my Pinot Noir in the wrong zone?"

**What to Look For**:
- [ ] Chat responds with relevant zone suggestions
- [ ] Answers reference YOUR zones, not generic advice
- [ ] No errors or timeouts
- [ ] Responses are specific and actionable

**Feedback Questions**:
- Did the AI understand your questions?
- Were the zone recommendations correct?
- Did it hallucinate or make things up?

---

### 5. Hybrid Food Pairing (7.8)

**What to Test**: Food pairing now uses deterministic rules + AI explanations.

**Steps**:
1. Go to **Sommelier** tab or pairing feature
2. Enter a dish description, e.g.:
   - "Grilled lamb chops with rosemary"
   - "Creamy mushroom risotto"
   - "Spicy Thai curry"
   - "Fresh oysters"
3. Review the wine recommendations

**What to Look For**:
- [ ] Recommendations come from YOUR cellar only
- [ ] Wines match the food type appropriately
- [ ] AI explanations describe WHY each wine works
- [ ] "Reduce Now" wines get priority (if applicable)
- [ ] Fridge wines are highlighted as "ready to serve"

**Feedback Questions**:
- Do the pairings match your expectations?
- Are the explanations helpful?
- Did it recommend wines you don't have?
- Would you follow these recommendations?

---

### 6. Acquisition Workflow (7.11)

**What to Test**: Improved wine addition flow with confidence indicators.

**Steps**:
1. Click **"Add Bottle"** or **"+"** button
2. Try **parsing a wine image**:
   - Upload a photo of a wine label
   - Check the parsed fields
   - Look for confidence indicators (red = uncertain)
3. Try **parsing text**:
   - Paste wine details from a receipt/website
   - Review parsed fields

**What to Look For**:
- [ ] Image parsing extracts key fields (name, producer, vintage, country)
- [ ] Uncertain fields are highlighted
- [ ] "Please review" hints appear for low-confidence fields
- [ ] Zone suggestion appears after parsing
- [ ] Fridge eligibility is indicated

**Feedback Questions**:
- How accurate was the image parsing?
- Did confidence highlighting help you spot errors?
- Was the zone suggestion correct?
- Did the workflow feel smoother than before?

---

### 7. Cellar Health Dashboard (7.12)

**What to Test**: New health metrics and one-click actions.

**API Endpoints to Test** (use browser address bar or fetch):
```
GET /api/health          - Full health report
GET /api/health/score    - Just the score
GET /api/health/alerts   - Current alerts
GET /api/health/at-risk  - At-risk wines
GET /api/health/shopping-list - Shopping suggestions
```

**Steps**:
1. Open browser console (F12)
2. Run: `fetch('/api/health').then(r => r.json()).then(console.log)`
3. Review the health report

**What to Look For**:
- [ ] Health score (0-100) seems reasonable
- [ ] Metrics breakdown shows:
  - Drinking window risk
  - Style coverage
  - Diversity score
  - Event readiness
  - Fridge status
- [ ] Alerts list wines approaching drink-by dates
- [ ] Shopping list identifies gaps

**Feedback Questions**:
- Does the health score reflect your cellar's state?
- Are the alerts accurate?
- Would the shopping list help you decide what to buy?

---

### 8. Palate Profile & Personalisation (7.9)

**What to Test**: Preference learning from consumption feedback.

**API Endpoints to Test**:
```
GET /api/palate/profile        - Your learned preferences
GET /api/palate/food-tags      - Available food tags
GET /api/palate/occasions      - Available occasions
GET /api/palate/recommendations - Personalized picks
```

**Steps**:
1. **Record feedback** after drinking a wine:
   - In browser console, run:
   ```javascript
   fetch('/api/palate/feedback', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       wineId: 1, // Replace with actual wine ID
       wouldBuyAgain: true,
       personalRating: 4,
       pairedWith: ['beef', 'roasted'],
       occasion: 'dinner_party',
       notes: 'Great with the roast beef'
     })
   }).then(r => r.json()).then(console.log)
   ```
2. Check your profile: `fetch('/api/palate/profile').then(r => r.json()).then(console.log)`

**What to Look For**:
- [ ] Feedback is recorded successfully
- [ ] Profile shows learned preferences by category
- [ ] Likes/dislikes are populated after multiple feedbacks
- [ ] Personalized recommendations change based on feedback

**Feedback Questions**:
- Is the preference categorization intuitive?
- Do the learned preferences match your actual tastes?
- Would you use this to get better recommendations?

---

### 9. Move Optimisation (7.10)

**What to Test**: Efficient move planning for cellar reorganisation.

**Steps**:
1. Run cellar analysis to find misplaced wines
2. Review the suggested moves
3. Look for:
   - Move batching (multiple wines to same zone grouped)
   - Swap suggestions (when no empty slots)
   - Move count minimization

**What to Look For**:
- [ ] Moves are grouped by destination zone
- [ ] Total move count seems minimal
- [ ] Swap moves are suggested when appropriate
- [ ] No circular or impossible moves

**Feedback Questions**:
- Are the moves efficient?
- Would you execute these moves?
- Any moves that seem unnecessary?

---

### 10. AI Safety & Reliability (7.7)

**What to Test**: AI doesn't hallucinate or recommend wines you don't have.

**Steps**:
1. Try edge cases in pairing/analysis:
   - Ask for pairing with an unusual dish
   - Request analysis when cellar is empty
   - Try to confuse the AI with odd requests
2. Check that responses:
   - Only reference wines in YOUR collection
   - Don't invent ratings or reviews
   - Gracefully handle errors

**What to Look For**:
- [ ] No hallucinated wines
- [ ] No made-up ratings
- [ ] Graceful error handling
- [ ] No infinite loops or hangs

**Feedback Questions**:
- Did the AI ever recommend a wine you don't have?
- Did it make up any information?
- How did it handle unusual requests?

---

## Feedback Template

Please copy this template and fill in your feedback:

```markdown
## Phase 7 Testing Feedback

**Tester**: [Your name]
**Date**: [Date]
**Device/Browser**: [e.g., Windows/Chrome, macOS/Safari]

### Overall Experience
- Overall rating (1-5):
- Most useful new feature:
- Biggest issue found:

### Section Feedback

#### 1. Zone Metadata & Narratives
- Works as expected: Yes / No / Partially
- Issues found:
- Suggestions:

#### 2. Fridge Status Panel
- Works as expected: Yes / No / Partially
- Issues found:
- Suggestions:

#### 3. AI Cellar Analysis
- Works as expected: Yes / No / Partially
- Issues found:
- Suggestions:

#### 4. Zone Chat
- Works as expected: Yes / No / Partially
- Issues found:
- Suggestions:

#### 5. Hybrid Food Pairing
- Works as expected: Yes / No / Partially
- Issues found:
- Suggestions:

#### 6. Acquisition Workflow
- Works as expected: Yes / No / Partially
- Issues found:
- Suggestions:

#### 7. Cellar Health Dashboard
- Works as expected: Yes / No / Partially
- Issues found:
- Suggestions:

#### 8. Palate Profile
- Works as expected: Yes / No / Partially
- Issues found:
- Suggestions:

#### 9. Move Optimisation
- Works as expected: Yes / No / Partially
- Issues found:
- Suggestions:

#### 10. AI Safety
- Works as expected: Yes / No / Partially
- Issues found:
- Suggestions:

### Bugs Found
| # | Feature | Description | Severity (Low/Med/High) |
|---|---------|-------------|-------------------------|
| 1 |         |             |                         |
| 2 |         |             |                         |

### Feature Requests
1.
2.

### Console Errors
[Paste any JavaScript errors from browser console]

### Screenshots
[Attach screenshots of any issues]
```

---

## Quick API Testing Script

Run this in browser console to test all new API endpoints:

```javascript
async function testPhase7APIs() {
  const tests = [
    { name: 'Health Report', url: '/api/health' },
    { name: 'Health Score', url: '/api/health/score' },
    { name: 'Health Alerts', url: '/api/health/alerts' },
    { name: 'At-Risk Wines', url: '/api/health/at-risk?limit=5' },
    { name: 'Shopping List', url: '/api/health/shopping-list' },
    { name: 'Palate Profile', url: '/api/palate/profile' },
    { name: 'Food Tags', url: '/api/palate/food-tags' },
    { name: 'Occasion Types', url: '/api/palate/occasions' },
    { name: 'Pairing Signals', url: '/api/pairing/signals' },
  ];

  console.log('=== Phase 7 API Tests ===\n');

  for (const test of tests) {
    try {
      const res = await fetch(test.url);
      const data = await res.json();
      console.log(`✅ ${test.name}: OK`);
      console.log(data);
      console.log('---');
    } catch (err) {
      console.log(`❌ ${test.name}: FAILED - ${err.message}`);
    }
  }

  console.log('\n=== Tests Complete ===');
}

testPhase7APIs();
```

---

## Priority Testing Order

If you have limited time, test in this order:

1. **High Priority** (core user experience):
   - Hybrid Food Pairing (7.8)
   - Acquisition Workflow (7.11)
   - AI Cellar Analysis (7.3, 7.4)

2. **Medium Priority** (valuable but less frequent):
   - Cellar Health Dashboard (7.12)
   - Zone Metadata & Narratives (7.2, 7.3)
   - Fridge Status Panel (7.5, 7.6)

3. **Lower Priority** (backend/advanced):
   - Palate Profile (7.9) - needs multiple uses to test
   - Move Optimisation (7.10) - needs misplaced wines
   - AI Safety (7.7) - implicit in other tests

---

## Known Limitations

- **Palate Profile**: Needs 5+ feedback entries before recommendations improve significantly
- **Health Dashboard**: Currently API-only, no dedicated UI panel yet
- **Move Optimisation**: Part of analysis workflow, not standalone UI
- **Zone Chat**: May not be exposed in UI yet (API available)

---

## Reporting Issues

For any issues found:
1. Note the exact steps to reproduce
2. Copy any console errors
3. Take a screenshot if visual
4. Include your browser/device info

Submit feedback via the feedback template above.
