/**
 * @fileoverview Tasting & Service card UI component.
 * Implements Wine Detail Panel Spec v2 frontend requirements.
 * Consolidates tasting notes, serving temperature, and drinking window.
 * @module tastingService
 */

import { getTastingNotes, getServingTemperature, getBestDrinkingWindow, reportTastingNotes } from './api.js';

/**
 * Render the Tasting & Service card for a wine.
 * @param {Object} wine - Wine object with id, colour, style, etc.
 * @param {HTMLElement} container - Container element to render into
 */
export async function renderTastingServiceCard(wine, container) {
  if (!container) return;
  
  container.innerHTML = '<div class="tasting-service-loading">Loading...</div>';
  
  try {
    // Fetch tasting notes, serving temp, and drinking window in parallel
    const [tastingNotes, servingTemp, drinkingWindow] = await Promise.all([
      fetchTastingNotes(wine.id || wine.wine_id),
      fetchServingTemperature(wine.id || wine.wine_id),
      fetchDrinkingWindow(wine.id || wine.wine_id)
    ]);
    
    const html = buildTastingServiceCard(wine, tastingNotes, servingTemp, drinkingWindow);
    container.innerHTML = html;
    
    // Attach event listeners
    attachCardEventListeners(container, wine);
  } catch (error) {
    console.error('[TastingService] Error rendering card:', error);
    container.innerHTML = `
      <div class="tasting-service-error">
        <p>Could not load tasting information</p>
      </div>
    `;
  }
}

/**
 * Fetch structured tasting notes for a wine.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object|null>} Tasting notes or null
 */
async function fetchTastingNotes(wineId) {
  try {
    const data = await getTastingNotes(wineId, true);
    return data.notes || data;
  } catch (error) {
    console.warn('[TastingService] Could not fetch tasting notes:', error);
    return null;
  }
}

/**
 * Fetch serving temperature for a wine.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object|null>} Temperature data or null
 */
async function fetchServingTemperature(wineId) {
  try {
    const data = await getServingTemperature(wineId);
    return data.recommendation || data.temperature;
  } catch (error) {
    console.warn('[TastingService] Could not fetch serving temp:', error);
    return null;
  }
}

/**
 * Fetch drinking window for a wine.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object|null>} Drinking window or null
 */
async function fetchDrinkingWindow(wineId) {
  try {
    return await getBestDrinkingWindow(wineId);
  } catch (error) {
    console.warn('[TastingService] Could not fetch drinking window:', error);
    return null;
  }
}

/**
 * Build the Tasting & Service card HTML.
 * @param {Object} wine - Wine object
 * @param {Object|null} notes - Tasting notes
 * @param {Object|null} temp - Serving temperature
 * @param {Object|null} window - Drinking window
 * @returns {string} HTML string
 */
function buildTastingServiceCard(wine, notes, temp, window) {
  const sections = [];
  
  // Style fingerprint
  if (notes?.style_fingerprint) {
    sections.push(`
      <div class="style-fingerprint">
        <div class="section-label">STYLE FINGERPRINT</div>
        <p class="fingerprint-text">${escapeHtml(notes.style_fingerprint)}</p>
      </div>
    `);
  }
  
  // Tasting notes section
  if (notes) {
    sections.push(buildTastingNotesSection(notes));
  } else {
    sections.push(`
      <div class="tasting-notes-empty">
        <p class="no-data">No tasting notes available</p>
      </div>
    `);
  }
  
  // Divider
  sections.push('<div class="card-divider"></div>');
  
  // Info cards row (temp + window)
  sections.push(`
    <div class="info-cards-row">
      ${buildServingTempCard(temp)}
      ${buildDrinkingWindowCard(window, wine)}
    </div>
  `);
  
  return `
    <div class="tasting-service-card">
      <h4 class="card-title">TASTING & SERVICE</h4>
      <div class="card-content">
        ${sections.join('')}
      </div>
    </div>
  `;
}

/**
 * Build the tasting notes section HTML.
 * @param {Object} notes - V2 structured notes
 * @returns {string} HTML string
 */
function buildTastingNotesSection(notes) {
  const parts = [];
  
  // Nose section
  if (notes.nose?.all_descriptors?.length > 0) {
    const noseItems = notes.nose.all_descriptors.slice(0, 6);
    const grouped = groupByCategory(noseItems, notes.nose.categories);
    
    parts.push(`
      <div class="tasting-section nose-section">
        <div class="section-header">
          <span class="section-label">NOSE</span>
          ${buildEvidenceIndicator(notes.evidence)}
        </div>
        ${buildCategoryBullets(grouped)}
      </div>
    `);
  }
  
  // Palate section
  if (notes.structure || notes.palate?.all_descriptors?.length > 0) {
    const structureLine = buildStructureLine(notes.structure, notes.wine_type);
    const palateItems = notes.palate?.all_descriptors?.slice(0, 6) || [];
    const grouped = groupByCategory(palateItems, notes.palate?.categories);
    
    parts.push(`
      <div class="tasting-section palate-section">
        <div class="section-label">PALATE</div>
        ${structureLine ? `<div class="structure-line">${structureLine}</div>` : ''}
        ${palateItems.length > 0 ? buildCategoryBullets(grouped) : ''}
      </div>
    `);
  }
  
  // Finish section
  if (notes.finish) {
    const finishItems = notes.finish.descriptors?.slice(0, 3) || [];
    const lengthText = formatLength(notes.finish.length);
    
    parts.push(`
      <div class="tasting-section finish-section">
        <div class="section-label">FINISH</div>
        <p class="finish-text">
          ${lengthText}${finishItems.length > 0 ? ' • ' + finishItems.map(toDisplayFormat).join(', ') : ''}
        </p>
      </div>
    `);
  }
  
  // Show more toggle (if there's more content)
  const hasMore = (notes.nose?.all_descriptors?.length > 6) ||
                  (notes.palate?.all_descriptors?.length > 6) ||
                  (notes.finish?.descriptors?.length > 3);
  
  if (hasMore) {
    parts.push(`
      <button class="show-more-toggle" data-expanded="false">
        Show more ▼
      </button>
    `);
  }
  
  // Contradictions warning
  if (notes.evidence?.contradictions?.length > 0) {
    const contradiction = notes.evidence.contradictions[0];
    parts.push(`
      <div class="contradiction-warning">
        ⚠️ Sources vary on ${contradiction.field} (${contradiction.values_found.join(' vs ')})
      </div>
    `);
  }
  
  // Footer with sources and report
  parts.push(`
    <div class="notes-footer">
      <button class="sources-toggle" data-wine-id="${notes.wine_id || ''}">
        Sources ▼
      </button>
      <button class="report-button" data-wine-id="${notes.wine_id || ''}" title="Report issue">
        ⚑ Report
      </button>
    </div>
  `);
  
  // Sources drawer (hidden by default)
  if (notes.sources?.length > 0) {
    parts.push(`
      <div class="sources-drawer" style="display: none;">
        ${notes.sources.map(s => `
          <div class="source-item">
            <span class="source-icon">${getSourceIcon(s.type)}</span>
            <span class="source-name">${escapeHtml(s.name)}</span>
            ${s.snippet ? `<p class="source-snippet">"${escapeHtml(s.snippet.substring(0, 150))}..."</p>` : ''}
          </div>
        `).join('')}
      </div>
    `);
  }
  
  return `<div class="tasting-notes-section">${parts.join('')}</div>`;
}

/**
 * Build the evidence indicator HTML.
 * @param {Object} evidence - Evidence object
 * @returns {string} HTML string
 */
function buildEvidenceIndicator(evidence) {
  if (!evidence) return '';
  
  const strength = evidence.strength || 'weak';
  const sourceCount = evidence.source_count || 0;
  
  // Build dots (filled based on strength)
  const filledDots = strength === 'strong' ? 3 : strength === 'medium' ? 2 : 1;
  const dots = Array(5).fill(0).map((_, i) => 
    i < filledDots ? '●' : '○'
  ).join('');
  
  const strengthClass = `evidence-${strength}`;
  
  return `
    <div class="evidence-indicator ${strengthClass}">
      <span class="evidence-label">Evidence: ${capitalise(strength)}</span>
      <span class="evidence-dots">${dots}</span>
      <span class="evidence-sources">${sourceCount} source${sourceCount !== 1 ? 's' : ''}</span>
    </div>
  `;
}

/**
 * Build structure line (sweetness, acidity, body, tannin).
 * @param {Object} structure - Structure object
 * @param {string} wineType - Wine type
 * @returns {string} Structure line text
 */
function buildStructureLine(structure, wineType) {
  if (!structure) return '';
  
  const elements = [];
  
  if (structure.sweetness && structure.sweetness !== 'dry') {
    elements.push(toDisplayFormat(structure.sweetness));
  }
  
  if (structure.acidity && structure.acidity !== 'medium') {
    elements.push(`${capitalise(structure.acidity)} acid`);
  }
  
  if (structure.body) {
    elements.push(`${capitalise(structure.body)} body`);
  }
  
  if (structure.tannin && ['still_red', 'orange'].includes(wineType)) {
    elements.push(`${capitalise(structure.tannin)} tannin`);
  }
  
  if (structure.mousse && wineType === 'sparkling') {
    elements.push(`${capitalise(structure.mousse)} mousse`);
  }
  
  return elements.join(' | ');
}

/**
 * Group descriptors by their categories.
 * @param {Array<string>} descriptors - List of descriptors
 * @param {Object} categories - Category groupings
 * @returns {Object} Grouped descriptors
 */
function groupByCategory(descriptors, categories) {
  if (!categories || Object.keys(categories).length === 0) {
    return { other: descriptors };
  }
  
  const result = {};
  const assigned = new Set();
  
  for (const [category, items] of Object.entries(categories)) {
    const matching = descriptors.filter(d => items.includes(d));
    if (matching.length > 0) {
      result[category] = matching;
      matching.forEach(d => assigned.add(d));
    }
  }
  
  // Add unassigned to 'other'
  const unassigned = descriptors.filter(d => !assigned.has(d));
  if (unassigned.length > 0) {
    result.other = unassigned;
  }
  
  return result;
}

/**
 * Build category bullets HTML.
 * @param {Object} grouped - Grouped descriptors
 * @returns {string} HTML string
 */
function buildCategoryBullets(grouped) {
  const bullets = [];
  
  for (const [category, items] of Object.entries(grouped)) {
    if (items.length === 0) continue;
    
    const displayCategory = toDisplayFormat(category);
    const displayItems = items.map(toDisplayFormat).join(', ');
    
    bullets.push(`
      <div class="category-bullet">
        <span class="bullet-category">${displayCategory}:</span>
        <span class="bullet-items">${displayItems}</span>
      </div>
    `);
  }
  
  return `<div class="category-bullets">${bullets.join('')}</div>`;
}

/**
 * Build the serving temperature card HTML.
 * @param {Object|null} temp - Temperature data
 * @returns {string} HTML string
 */
function buildServingTempCard(temp) {
  if (!temp) {
    return `
      <div class="info-card serving-temp-card">
        <div class="info-card-header">
          <span class="info-icon">🌡️</span>
          <span class="info-label">SERVE AT</span>
        </div>
        <div class="info-card-body">
          <p class="no-data">No data</p>
        </div>
      </div>
    `;
  }
  
  const minC = temp.temp_min_celsius || temp.min_celsius;
  const maxC = temp.temp_max_celsius || temp.max_celsius;
  const minF = temp.temp_min_fahrenheit || temp.min_fahrenheit || celsiusToFahrenheit(minC);
  const maxF = temp.temp_max_fahrenheit || temp.max_fahrenheit || celsiusToFahrenheit(maxC);
  const source = temp.match_type || temp.source || temp.wine_type || 'colour';
  
  return `
    <div class="info-card serving-temp-card">
      <div class="info-card-header">
        <span class="info-icon">🌡️</span>
        <span class="info-label">SERVE AT</span>
      </div>
      <div class="info-card-body">
        <div class="temp-display">
          <span class="temp-celsius">${minC}-${maxC}°C</span>
          <span class="temp-fahrenheit">(${minF}-${maxF}°F)</span>
        </div>
        <div class="temp-source">via ${escapeHtml(source)}</div>
      </div>
    </div>
  `;
}

/**
 * Build the drinking window card HTML.
 * @param {Object|null} window - Drinking window data
 * @param {Object} wine - Wine object
 * @returns {string} HTML string
 */
function buildDrinkingWindowCard(window, wine) {
  const wineId = wine?.id || wine?.wine_id || '';
  
  if (!window || (!window.drink_from_year && !window.drink_by_year)) {
    return `
      <div class="info-card drinking-window-card">
        <div class="info-card-header">
          <span class="info-icon">🍷</span>
          <span class="info-label">DRINK</span>
        </div>
        <div class="info-card-body">
          <p class="no-data">No window data</p>
          <button class="edit-window-btn" data-wine-id="${wineId}" title="Set window">✎</button>
        </div>
      </div>
    `;
  }
  
  const fromYear = window.drink_from_year;
  const byYear = window.drink_by_year;
  const peakYear = window.peak_year;
  const source = window.source || 'unknown';
  
  // Calculate urgency
  const currentYear = new Date().getFullYear();
  const urgencyBadge = getUrgencyBadge(fromYear, byYear, currentYear);
  
  // Build window text
  let windowText = '';
  if (fromYear && byYear) {
    windowText = `${fromYear} - ${byYear}`;
  } else if (byYear) {
    windowText = `Until ${byYear}`;
  } else if (fromYear) {
    windowText = `From ${fromYear}`;
  }
  
  return `
    <div class="info-card drinking-window-card">
      <div class="info-card-header">
        <span class="info-icon">🍷</span>
        <span class="info-label">DRINK</span>
      </div>
      <div class="info-card-body">
        <div class="window-years">${windowText}</div>
        ${peakYear ? `<div class="window-peak">peak ${peakYear}</div>` : ''}
        ${urgencyBadge}
        <div class="window-source">via ${escapeHtml(source)}</div>
        <button class="edit-window-btn" data-wine-id="${wineId}" title="Edit window">✎</button>
      </div>
    </div>
  `;
}

/**
 * Get urgency badge based on drinking window.
 * @param {number} fromYear - Drink from year
 * @param {number} byYear - Drink by year
 * @param {number} currentYear - Current year
 * @returns {string} HTML string for badge
 */
function getUrgencyBadge(fromYear, byYear, currentYear) {
  if (byYear && currentYear > byYear) {
    return '<span class="urgency-badge urgency-danger">PAST WINDOW</span>';
  }
  
  if (byYear) {
    const yearsLeft = byYear - currentYear;
    if (yearsLeft <= 1) {
      return `<span class="urgency-badge urgency-warning">${yearsLeft} YEAR LEFT</span>`;
    }
    if (yearsLeft <= 2) {
      return `<span class="urgency-badge urgency-caution">${yearsLeft} YEARS LEFT</span>`;
    }
  }
  
  if (fromYear && currentYear < fromYear) {
    return `<span class="urgency-badge urgency-hold">HOLD UNTIL ${fromYear}</span>`;
  }
  
  return '';
}

/**
 * Get source type icon.
 * @param {string} type - Source type
 * @returns {string} Icon character
 */
function getSourceIcon(type) {
  const icons = {
    critic: '🎖️',
    merchant: '📦',
    community: '👥',
    producer: '🏭'
  };
  return icons[type] || '📝';
}

/**
 * Format finish length for display.
 * @param {string} length - Finish length value
 * @returns {string} Formatted text
 */
function formatLength(length) {
  const formats = {
    short: 'Short finish',
    'medium-minus': 'Medium-short finish',
    medium: 'Medium finish',
    'medium-plus': 'Medium-long finish',
    long: 'Long finish',
    'very-long': 'Very long, lingering finish'
  };
  return formats[length] || 'Medium finish';
}

/**
 * Convert snake_case to display format.
 * @param {string} term - Term to format
 * @returns {string} Formatted term
 */
function toDisplayFormat(term) {
  if (!term) return '';
  return term
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .toLowerCase();
}

/**
 * Capitalise first letter.
 * @param {string} str - String to capitalise
 * @returns {string} Capitalised string
 */
function capitalise(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Escape HTML characters.
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Convert Celsius to Fahrenheit.
 * @param {number} celsius - Temperature in Celsius
 * @returns {number} Temperature in Fahrenheit
 */
function celsiusToFahrenheit(celsius) {
  return Math.round((celsius * 9/5) + 32);
}

/**
 * Attach event listeners to the card.
 * @param {HTMLElement} container - Container element
 * @param {Object} wine - Wine object
 */
function attachCardEventListeners(container, wine) {
  // Show more toggle
  const showMoreBtn = container.querySelector('.show-more-toggle');
  if (showMoreBtn) {
    showMoreBtn.addEventListener('click', () => {
      const expanded = showMoreBtn.dataset.expanded === 'true';
      showMoreBtn.dataset.expanded = !expanded;
      showMoreBtn.textContent = expanded ? 'Show more ▼' : 'Show less ▲';
      // TODO: Implement expansion logic
    });
  }
  
  // Sources toggle
  const sourcesBtn = container.querySelector('.sources-toggle');
  const sourcesDrawer = container.querySelector('.sources-drawer');
  if (sourcesBtn && sourcesDrawer) {
    sourcesBtn.addEventListener('click', () => {
      const isVisible = sourcesDrawer.style.display !== 'none';
      sourcesDrawer.style.display = isVisible ? 'none' : 'block';
      sourcesBtn.textContent = isVisible ? 'Sources ▼' : 'Sources ▲';
    });
  }
  
  // Report button
  const reportBtn = container.querySelector('.report-button');
  if (reportBtn) {
    reportBtn.addEventListener('click', () => {
      const wineId = wine?.id || wine?.wine_id;
      if (wineId) {
        showReportModal(wineId);
      }
    });
  }
  
  // Edit window button
  const editWindowBtn = container.querySelector('.edit-window-btn');
  if (editWindowBtn) {
    editWindowBtn.addEventListener('click', () => {
      const wineId = wine?.id || wine?.wine_id;
      if (wineId) {
        showEditWindowModal(wineId);
      }
    });
  }
}

/**
 * Show report issue modal.
 * @param {number} wineId - Wine ID
 */
function showReportModal(wineId) {
  const issueType = prompt('Issue type:\n1. Inaccurate\n2. Missing info\n3. Wrong wine\n4. Other\n\nEnter 1-4:');
  if (!issueType) return;
  
  const types = { '1': 'inaccurate', '2': 'missing_info', '3': 'wrong_wine', '4': 'other' };
  const type = types[issueType];
  if (!type) return;
  
  const details = prompt('Please describe the issue:');
  if (details === null) return;
  
  reportTastingNotes(wineId, { issue_type: type, details })
    .then((data) => {
      if (data.success) {
        alert('Thank you for your report. We will review it shortly.');
      } else {
        alert('Could not submit report: ' + (data.error || 'Unknown error'));
      }
    })
    .catch(err => {
      alert('Error submitting report: ' + err.message);
    });
}

/**
 * Show edit drinking window modal.
 * @param {number} wineId - Wine ID
 */
function showEditWindowModal(_wineId) {
  // Trigger existing drinking window edit modal if available
  const manualEntry = document.getElementById('manual-window-entry');
  if (manualEntry) {
    manualEntry.scrollIntoView({ behavior: 'smooth' });
  }
}

// Export for use in modals.js
export default {
  renderTastingServiceCard,
  fetchTastingNotes,
  fetchServingTemperature,
  fetchDrinkingWindow
};
