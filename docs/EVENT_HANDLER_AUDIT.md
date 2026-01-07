# Event Handler Audit Guide

## Background

On 7 January 2026, we discovered that inline event handlers (`onclick="..."`) were silently failing due to Content Security Policy (CSP) restrictions. The CSP has `script-src 'self'` which blocks inline event handlers without any visible error - buttons simply don't respond to clicks.

This document provides guidance for auditing the codebase to ensure all event handlers are CSP-compliant.

---

## What Was Fixed

The following files were refactored to remove inline event handlers (CSP-blocked `on*="..."` attributes):

| File | Issue | Fix |
|------|-------|-----|
| `public/js/cellarAnalysis.js` | 12 inline onclick handlers | Converted to addEventListener with data attributes |
| `public/js/errorBoundary.js` | 1 inline onclick handler | Converted to addEventListener |
| `public/js/recommendations.js` | 1 inline onclick handler | Converted to addEventListener |
| `public/js/bottles/wineConfirmation.js` | 1 inline handler (`onerror`) in generated HTML | Replaced with CSP-safe `error` listener fallback |
| `public/index.html` | 4 inline handlers (`onclick`, `onkeypress`) in Zone Chat UI | Removed attributes; wired listeners in `public/js/cellarAnalysis.js` |

---

## Audit Scope

### Priority 1: Inline Event Handlers (Critical)

**Search Pattern:**
```bash
# HTML files
grep -rn "\\bon[a-zA-Z]*\\s*=\\s*\"" public/*.html

# JS template literals / dynamic HTML
grep -rn "\\bon[a-zA-Z]*\\s*=\\s*\"" public/js/
grep -rn "\\bon[a-zA-Z]*\\s*=\\s*'" public/js/

# Common explicit handlers (optional targeted searches)
grep -rn "onclick=\"" public/
grep -rn "onchange=\"" public/
grep -rn "onsubmit=\"" public/
grep -rn "oninput=\"" public/
grep -rn "onkeydown=\"" public/
grep -rn "onkeyup=\"" public/
grep -rn "onfocus=\"" public/
grep -rn "onblur=\"" public/
grep -rn "onerror=\"" public/
```

**What to Look For:**
- Any HTML template literal containing `on[event]="..."` attributes
- These will be blocked by CSP and fail silently

**How to Fix:**
```javascript
// BAD - CSP blocks this
const html = `<button onclick="handleClick(${id})">Click</button>`;
container.innerHTML = html;

// GOOD - CSP-compliant
const html = `<button class="action-btn" data-id="${id}">Click</button>`;
container.innerHTML = html;
container.querySelector('.action-btn').addEventListener('click', () => handleClick(id));
```

---

### Priority 2: Dynamic HTML Generation (Medium)

**Files to Check:**
- `public/js/grid.js` - Slot rendering
- `public/js/modals.js` - Modal content generation
- `public/js/sommelier.js` - Chat interface
- `public/js/bottles/*.js` - Form generation
- `public/js/settings.js` - Settings controls
- `public/js/ratings.js` - Rating UI
- `public/js/virtualList.js` - Virtual list items

**What to Look For:**
- `innerHTML = ` assignments followed by interactive elements
- Template literals that generate `<button>`, `<a>`, `<input>`, `<select>` elements
- Missing `addEventListener` calls after HTML insertion

**Pattern to Audit:**
```javascript
// Check if event listeners are attached after innerHTML
container.innerHTML = `<button class="some-btn">Action</button>`;
// Is there a corresponding addEventListener call?
container.querySelector('.some-btn').addEventListener('click', handler);
```

---

### Priority 3: Event Listener Cleanup (Low)

**Context:**
The codebase has an `eventManager.js` utility for tracking listeners, but not all modules use it consistently.

**Files to Check:**
- Any module that adds listeners on view/tab changes
- Modules that create/destroy UI components dynamically

**What to Look For:**
```javascript
// Check if listeners are cleaned up when views change
element.addEventListener('click', handler);
// Is there a corresponding removeEventListener or cleanup function?
```

**Current State:**
- `eventManager.js` provides `addTrackedListener()` and `cleanupNamespace()`
- Some modules use it (wine list), others don't
- This is a memory leak concern, not a CSP issue
- Lower priority than inline handler issues

---

## Verification Steps

### 1. Search for Remaining Inline Handlers
```bash
grep -rn "\\bon[a-zA-Z]+\\s*=\\s*[\"']" public/
grep -rn "javascript:" public/
```

Expected result: **No matches** (all inline handlers should be removed)

### 1b. Run Automated Regression Test (Recommended)

This repository includes a Vitest check that scans `public/` for CSP-blocked inline handlers and `javascript:` URLs.

```bash
npm run test:run -- tests/unit/utils/cspInlineHandlers.test.js
```

Expected result: **Pass**

### 2. Test Interactive Elements
For each file audited, manually test:
- All buttons respond to clicks
- Form submissions work
- Dropdowns and selects function
- Modal open/close buttons work

### 3. Check Browser Console
Open DevTools Console and look for:
- CSP violation errors (though these may not appear for inline handlers)
- JavaScript errors on click
- "Refused to execute inline event handler" messages

---

## Files Already Audited (Clean)

These files have been verified CSP-compliant:

- [x] `public/js/cellarAnalysis.js` - Refactored 7 Jan 2026
- [x] `public/js/errorBoundary.js` - Refactored 7 Jan 2026
- [x] `public/js/recommendations.js` - Refactored 7 Jan 2026
- [x] `public/js/bottles/wineConfirmation.js` - Refactored 7 Jan 2026 (includes CSP-safe image fallback)
- [x] `public/index.html` - Refactored 7 Jan 2026 (Zone Chat UI wiring)

---

## Files Requiring Audit

| File | Priority | Notes |
|------|----------|-------|
| `public/js/grid.js` | Medium | Slot click handlers |
| `public/js/modals.js` | Medium | Modal buttons |
| `public/js/sommelier.js` | Medium | Chat interface |
| `public/js/bottles/form.js` | Medium | Form submission |
| `public/js/bottles/imageParsing.js` | Medium | Parse buttons |
| `public/js/settings.js` | Medium | Settings controls |
| `public/js/ratings.js` | Medium | Rating UI |
| `public/js/dragdrop.js` | Low | Drag events (usually use addEventListener) |
| `public/js/globalSearch.js` | Low | Search input handling |
| `public/js/accessibility.js` | Low | Focus management |

---

## Best Practices Going Forward

### 1. Never Use Inline Event Handlers
```javascript
// NEVER do this
onclick="handler()"
onchange="handler()"
onsubmit="handler()"
```

### 2. Always Attach Listeners After innerHTML
```javascript
container.innerHTML = generateHTML();
attachEventListeners(container);
```

### 3. Use Data Attributes for Parameters
```javascript
// Pass data via data-* attributes
const html = `<button data-wine-id="${id}" data-action="delete">Delete</button>`;

// Read them in the handler
btn.addEventListener('click', (e) => {
  const wineId = e.target.dataset.wineId;
  const action = e.target.dataset.action;
});
```

### 4. Use Event Delegation for Lists
```javascript
// Instead of attaching to each item
container.addEventListener('click', (e) => {
  const item = e.target.closest('.list-item');
  if (item) handleItemClick(item);
});
```

### 5. Consider Using eventManager.js
```javascript
import { addTrackedListener, cleanupNamespace } from './eventManager.js';

// Add tracked listener
addTrackedListener('myModule', element, 'click', handler);

// Clean up when view changes
cleanupNamespace('myModule');
```

---

## CSP Reference

Current production CSP (from `src/middleware/csp.js`):
```javascript
const cspDirectives = [
  "default-src 'self'",
  "script-src 'self'",  // No 'unsafe-inline' - blocks inline handlers
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests"
];
```

The key directive is `script-src 'self'` without `'unsafe-inline'`. This:
- Allows external JavaScript files from same origin
- Blocks inline `<script>` tags
- Blocks inline event handlers (`onclick`, `onchange`, etc.)
- Blocks `javascript:` URLs
- Blocks `eval()` and `new Function()`

---

## Reporting

When completing the audit, document:

1. **Files checked** with date
2. **Issues found** with line numbers
3. **Fixes applied** with before/after code
4. **Testing performed** to verify fix

Example:
```
File: public/js/example.js
Date: 8 Jan 2026
Issue: Line 145 - onclick="deleteItem(${id})"
Fix: Converted to addEventListener with data-item-id attribute
Tested: Delete button now works in production
```

---

## Audit Execution Summary (7 Jan 2026)

**Issues found (true positives):**
- `public/index.html`: Zone Chat UI contained inline handlers (`onclick`, `onkeypress`) which are blocked by CSP.
- `public/js/bottles/wineConfirmation.js`: Generated match-card HTML contained an inline `onerror` handler on `<img>`.

**Fixes applied:**
- `public/index.html`: removed inline handler attributes; added stable element IDs:
  - `#zone-chat-close-btn`
  - `#zone-chat-send-btn`
- `public/js/cellarAnalysis.js`: wired Zone Chat controls via `addEventListener` (toggle/close/send + Enter key submission).
- `public/js/bottles/wineConfirmation.js`: replaced inline `onerror` with a CSP-safe image fallback using an `error` event listener.

**Verification:**
- Post-fix search for `\bon...=` attributes under `public/`: **no matches**.
- Post-fix search for `javascript:` URLs under `public/`: **no matches**.
- Automated regression test: `npm run test:run -- tests/unit/utils/cspInlineHandlers.test.js` (**pass**)

---

*Created: 7 January 2026*
*Author: Claude Code*
*Related Commit: cad2de8 - fix: refactor inline onclick handlers for CSP compliance*
