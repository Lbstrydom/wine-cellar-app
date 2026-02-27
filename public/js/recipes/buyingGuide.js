/**
 * @fileoverview Inline buying guide section for Recipe Library.
 * Shows coverage bar (physical + projected), gap cards with "Add to Plan",
 * surplus cards, diversity recommendations, and integrated cart panel.
 * @module recipes/buyingGuide
 */

import { getBuyingGuide } from '../api/recipes.js';
import { escapeHtml } from '../utils.js';
import { renderCartPanel, openQuickAddForGap } from './cartPanel.js';

/** Style colour classes for visual consistency with profileSummary */
const STYLE_COLOURS = {
  white_crisp: 'style-bar-white',
  white_medium: 'style-bar-white',
  white_oaked: 'style-bar-white',
  white_aromatic: 'style-bar-white',
  rose_dry: 'style-bar-rose',
  red_light: 'style-bar-red-light',
  red_medium: 'style-bar-red',
  red_full: 'style-bar-red-full',
  sparkling_dry: 'style-bar-sparkling',
  sparkling_rose: 'style-bar-sparkling',
  dessert: 'style-bar-dessert'
};

/**
 * Render the buying guide section.
 * @param {HTMLElement} container - Parent element
 */
export async function renderBuyingGuide(container) {
  if (!container) return;

  container.innerHTML = '<div class="buying-guide-loading">Analysing your cellar against cooking profile...</div>';

  try {
    const result = await getBuyingGuide();
    const guide = result.data;

    if (!guide || guide.empty) {
      if (guide?.emptyReason === 'no_wines') {
        container.innerHTML = renderNoWinesState(guide);
      } else {
        container.innerHTML = '';
      }
      return;
    }

    if (guide.recipeCount < 5 || guide.noTargets) {
      container.innerHTML = '';
      return;
    }

    const coverageHtml = renderCoverageBar(guide);
    const gapsHtml = renderGaps(guide.gaps);
    const surplusesHtml = renderSurpluses(guide.surpluses);
    const diversityHtml = renderDiversityRecs(guide.diversityRecs);
    const seasonHtml = guide.seasonalBias
      ? `<span class="buying-guide-season">Season: ${escapeHtml(guide.seasonalBias.charAt(0).toUpperCase() + guide.seasonalBias.slice(1))}</span>`
      : '';

    const cartInfo = guide.activeCartBottles > 0
      ? ` \u2022 ${guide.activeCartBottles} planned`
      : '';

    container.innerHTML = `
      <div class="buying-guide-panel">
        <div class="buying-guide-header">
          <h3>Buying Guide</h3>
          ${seasonHtml}
        </div>
        <p class="buying-guide-subtitle">Based on ${guide.recipeCount} recipes${guide.cellarCapacity ? ` \u2022 ${guide.totalBottles} of ${guide.cellarCapacity} slots filled` : ` \u2022 ${guide.totalBottles} bottles`}${cartInfo}</p>
        ${coverageHtml}
        <div class="buying-guide-cart-section"></div>
        ${gapsHtml}
        ${surplusesHtml}
        ${diversityHtml}
      </div>
    `;

    // Wire "Add to Plan" buttons on gap cards
    wireGapAddButtons(container);

    // Render cart panel into its section
    const cartSection = container.querySelector('.buying-guide-cart-section');
    if (cartSection) {
      renderCartPanel(cartSection);
    }

  } catch (err) {
    container.innerHTML = `<p class="no-data">Error loading buying guide: ${escapeHtml(err.message)}</p>`;
  }
}

/**
 * Render the dual coverage bar (physical + projected overlay).
 * @param {Object} guide - Buying guide data
 * @returns {string} HTML
 */
function renderCoverageBar(guide) {
  const pct = guide.bottleCoveragePct;
  const projectedPct = guide.projectedBottleCoveragePct ?? pct;
  const colourClass = pct >= 80 ? 'coverage-good' : pct >= 50 ? 'coverage-ok' : 'coverage-low';
  const hasProjection = projectedPct > pct;

  const projectedLabel = hasProjection
    ? ` <span class="coverage-projected-label">(${projectedPct}% after planned)</span>`
    : '';

  // Show projected bar as striped overlay if there's a difference
  const projectedBarHtml = hasProjection
    ? `<div class="coverage-bar coverage-bar-projected" style="width: ${Math.max(2, projectedPct)}%"></div>`
    : '';

  return `
    <div class="buying-guide-coverage">
      <div class="coverage-label">
        <span>Your cellar covers <strong>${pct}%</strong> of cooking needs${projectedLabel}</span>
        <span class="coverage-detail">${guide.gaps.length} gap${guide.gaps.length !== 1 ? 's' : ''}, ${guide.surpluses.length} surplus${guide.surpluses.length !== 1 ? 'es' : ''}</span>
      </div>
      <div class="coverage-bar-track">
        ${projectedBarHtml}
        <div class="coverage-bar ${colourClass}" style="width: ${Math.max(2, pct)}%"></div>
      </div>
    </div>
  `;
}

/**
 * Render gap cards with "Add to Plan" buttons and projected deficit.
 * @param {Array} gaps - Gap objects
 * @returns {string} HTML
 */
function renderGaps(gaps) {
  if (gaps.length === 0) {
    return '<div class="buying-guide-section"><p class="buying-guide-allclear">No gaps \u2014 your cellar matches your cooking profile well.</p></div>';
  }

  const cardsHtml = gaps.map(gap => {
    const colourClass = STYLE_COLOURS[gap.style] || 'style-bar-default';
    const signalsHtml = gap.drivingSignals.length > 0
      ? `<div class="gap-signals">Because you cook: ${gap.drivingSignals.map(s => `<span class="recipe-tag recipe-tag-small">${escapeHtml(s)}</span>`).join(' ')}</div>`
      : '';
    const suggestionsHtml = gap.suggestions.length > 0
      ? `<div class="gap-suggestions">Try: ${gap.suggestions.map(s => escapeHtml(s)).join(', ')}</div>`
      : '';

    // Show projected deficit when virtual inventory reduces the gap
    const projectedDeficit = gap.projectedDeficit ?? gap.deficit;
    const projectedHtml = projectedDeficit < gap.deficit
      ? `<div class="gap-projected-info">${projectedDeficit === 0 ? 'Covered after planned' : `${projectedDeficit} needed after planned`}</div>`
      : '';

    return `
      <div class="gap-card">
        <div class="gap-card-header">
          <span class="gap-style-badge ${colourClass}">${escapeHtml(gap.label)}</span>
          <span class="gap-deficit">+${gap.deficit} bottle${gap.deficit !== 1 ? 's' : ''}</span>
        </div>
        <div class="gap-card-meta">
          <span class="gap-have-target">${gap.have} of ${gap.target} needed (${gap.demandPct}% demand)</span>
        </div>
        ${projectedHtml}
        ${signalsHtml}
        ${suggestionsHtml}
        <button class="gap-add-btn" data-style="${escapeHtml(gap.style)}" data-label="${escapeHtml(gap.label)}" type="button">+ Add to Plan</button>
      </div>
    `;
  }).join('');

  return `
    <div class="buying-guide-section">
      <h4 class="buying-guide-section-title">Wines to Buy</h4>
      <div class="gap-cards">${cardsHtml}</div>
    </div>
  `;
}

/**
 * Wire "Add to Plan" button click handlers on gap cards.
 * @param {HTMLElement} container
 */
function wireGapAddButtons(container) {
  container.querySelectorAll('.gap-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const styleId = btn.dataset.style;
      const label = btn.dataset.label;
      openQuickAddForGap(styleId, label);

      // Scroll cart section into view
      const cartSection = container.querySelector('.buying-guide-cart-section');
      if (cartSection) {
        cartSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });
}

/**
 * Render surplus cards.
 * @param {Array} surpluses - Surplus objects
 * @returns {string} HTML
 */
function renderSurpluses(surpluses) {
  if (surpluses.length === 0) return '';

  const cardsHtml = surpluses.map(s => {
    const colourClass = STYLE_COLOURS[s.style] || 'style-bar-default';
    const reduceHtml = s.reduceNowCount > 0
      ? `<div class="surplus-reduce">${s.reduceNowCount} wine${s.reduceNowCount !== 1 ? 's' : ''} flagged to drink soon: ${s.reduceNowWines.map(w => `<span class="surplus-wine">${escapeHtml(w.name)}${w.vintage ? ' ' + w.vintage : ''}</span>`).join(', ')}</div>`
      : '';

    return `
      <div class="surplus-card">
        <div class="surplus-card-header">
          <span class="gap-style-badge ${colourClass}">${escapeHtml(s.label)}</span>
          <span class="surplus-excess">${s.excess} over target</span>
        </div>
        <div class="gap-card-meta">
          <span>${s.have} bottles (target: ${s.target})</span>
        </div>
        ${reduceHtml}
      </div>
    `;
  }).join('');

  return `
    <div class="buying-guide-section">
      <h4 class="buying-guide-section-title">Overstocked Styles</h4>
      <div class="surplus-cards">${cardsHtml}</div>
    </div>
  `;
}

/**
 * Render diversity recommendations.
 * @param {Array} recs - Diversity recommendation objects
 * @returns {string} HTML
 */
function renderDiversityRecs(recs) {
  if (recs.length === 0) return '';

  const recsHtml = recs.map(r => {
    const suggestionsHtml = r.suggestions.length > 0
      ? ` Try: ${r.suggestions.map(s => escapeHtml(s)).join(', ')}.`
      : '';
    return `
      <div class="diversity-rec">
        <span class="diversity-label">${escapeHtml(r.label)}:</span>
        <span class="diversity-reason">${escapeHtml(r.reason)}.${suggestionsHtml}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="buying-guide-section buying-guide-diversity">
      <h4 class="buying-guide-section-title">Diversity Suggestions</h4>
      <p class="buying-guide-diversity-hint">You don't cook much with these styles, but having 1-2 bottles adds flexibility:</p>
      ${recsHtml}
    </div>
  `;
}

/**
 * Render the no-wines empty state (has recipes but no wines).
 * @param {Object} guide - Guide data
 * @returns {string} HTML
 */
function renderNoWinesState(guide) {
  if (!guide.gaps || guide.gaps.length === 0) return '';

  const topGaps = guide.gaps.slice(0, 5).map(gap =>
    `<li><strong>${escapeHtml(gap.label)}</strong>: ~${gap.target} bottles (${gap.demandPct}% of demand)</li>`
  ).join('');

  return `
    <div class="buying-guide-panel buying-guide-empty">
      <h3>Buying Guide</h3>
      <p>Based on your ${guide.recipeCount} recipes, here's what a balanced cellar would look like (assuming ~50 bottles):</p>
      <ul class="buying-guide-starter-list">${topGaps}</ul>
      <p class="buying-guide-hint">Add wines to your cellar to see personalised gap analysis.</p>
    </div>
  `;
}
