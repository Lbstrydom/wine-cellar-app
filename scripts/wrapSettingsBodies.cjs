/**
 * Wraps settings section bodies in <div class="settings-section-body"> elements.
 * Also fixes the "Backup & Export" h3 that was missed in the first transform pass.
 */
const fs = require('fs');
let content = fs.readFileSync('public/index.html', 'utf8');

// Step 1: Fix Backup & Export h3 → button
const oldH3 = '<h3 class="settings-section-title">Backup & Export</h3>';
const newBtn = '<button class="settings-section-toggle" aria-expanded="true" data-section-id="backup-export">Backup &amp; Export <span class="settings-section-arrow">▾</span></button>';
if (content.includes(oldH3)) {
  content = content.split(oldH3).join(newBtn);
  console.log('Fixed: Backup & Export h3 → button');
} else {
  console.log('NOT FOUND: Backup & Export h3 (may already be converted)');
}

// Step 2: Wrap section bodies
// For each settings-section div, wrap everything after the toggle button
// with <div class="settings-section-body">...</div>
let result = '';
let i = 0;
let wrappedCount = 0;

while (i < content.length) {
  // Find the next settings-section start
  const sectionStart = content.indexOf('<div class="settings-section"', i);

  if (sectionStart === -1) {
    // No more sections, append remainder and stop
    result += content.slice(i);
    break;
  }

  // Append everything before this section
  result += content.slice(i, sectionStart);

  // Find the end of the opening tag
  const tagEnd = content.indexOf('>', sectionStart) + 1;
  result += content.slice(sectionStart, tagEnd);

  // Find the settings-section-toggle button end
  const buttonEnd = content.indexOf('</button>', tagEnd);
  if (buttonEnd === -1) {
    // No button found - copy rest and bail
    result += content.slice(tagEnd);
    break;
  }

  const buttonText = content.slice(tagEnd, buttonEnd + '</button>'.length);
  if (!buttonText.includes('settings-section-toggle')) {
    // This is not a toggle section, skip this div
    i = tagEnd;
    result = result.slice(0, result.length - (tagEnd - sectionStart));
    result += content.slice(sectionStart, tagEnd);
    i = tagEnd;
    continue;
  }

  const afterButton = buttonEnd + '</button>'.length;
  result += content.slice(tagEnd, afterButton);

  // Count div depth from afterButton to find the closing </div> of the settings-section
  // We start at depth 1 (already inside the settings-section div)
  let depth = 1;
  let j = afterButton;

  while (j < content.length && depth > 0) {
    if (content.slice(j, j + 4) === '<div') {
      depth++;
      j += 4;
    } else if (content.slice(j, j + 6) === '</div>') {
      depth--;
      if (depth === 0) break;
      j += 6;
    } else {
      j++;
    }
  }

  if (depth !== 0) {
    console.error('WARNING: Could not find closing </div> for settings-section at offset', sectionStart);
    result += content.slice(afterButton);
    break;
  }

  // j is now at the start of the closing </div> of settings-section
  const bodyContent = content.slice(afterButton, j);

  result += '\n      <div class="settings-section-body">';
  result += bodyContent;
  result += '      </div>\n    ';
  result += content.slice(j, j + 6); // </div>

  wrappedCount++;
  i = j + 6;
}

fs.writeFileSync('public/index.html', result, 'utf8');
console.log(`Done. Wrapped ${wrappedCount} section bodies.`);
