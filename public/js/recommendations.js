/**
 * @fileoverview AI-powered drink recommendations UI.
 * Displays personalized wine suggestions based on cellar data and context.
 * @module recommendations
 */

import { escapeHtml } from './utils.js';

const API_BASE = '/api';

/**
 * State for recommendations panel.
 */
const recState = {
  isLoading: false,
  isCollapsed: false,
  lastRecommendations: null
};

/**
 * Initialize recommendations panel.
 */
export function initRecommendations() {
  const panel = document.getElementById('drink-tonight-panel');
  if (!panel) return;

  // Bind refresh button
  const refreshBtn = document.getElementById('refresh-recommendations');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadRecommendations());
  }

  // Bind toggle button
  const toggleBtn = document.getElementById('toggle-recommendations');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', togglePanel);
  }

  // Bind context selectors
  const occasionSelect = document.getElementById('rec-occasion');
  const foodSelect = document.getElementById('rec-food');
  const foodDetailInput = document.getElementById('rec-food-detail');

  if (occasionSelect) {
    occasionSelect.addEventListener('change', () => loadRecommendations());
  }
  if (foodSelect) {
    foodSelect.addEventListener('change', () => loadRecommendations());
  }

  // Debounce text input to avoid too many API calls
  const debounceTimer = null;
  if (foodDetailInput) {
    // Only trigger on Enter key - don't auto-load on every keystroke
    foodDetailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(debounceTimer);
        loadRecommendations();
      }
    });
  }

  // Show initial placeholder instead of auto-loading
  showInitialPlaceholder();
}

/**
 * Show initial placeholder with Get Recommendations button.
 */
function showInitialPlaceholder() {
  const cardsContainer = document.getElementById('recommendation-cards');
  if (!cardsContainer) return;

  cardsContainer.innerHTML = `
    <div class="recommendation-placeholder">
      <p>Select your occasion and food pairing, then click the button below.</p>
      <button class="btn btn-primary" id="get-recommendations-btn">
        Get Recommendations
      </button>
    </div>
  `;

  // Bind the button
  const btn = document.getElementById('get-recommendations-btn');
  if (btn) {
    btn.addEventListener('click', () => loadRecommendations());
  }
}

/**
 * Toggle panel collapsed state.
 */
function togglePanel() {
  const panel = document.getElementById('drink-tonight-panel');
  const toggleBtn = document.getElementById('toggle-recommendations');

  if (!panel || !toggleBtn) return;

  recState.isCollapsed = !recState.isCollapsed;
  panel.classList.toggle('collapsed', recState.isCollapsed);

  const icon = toggleBtn.querySelector('.toggle-icon');
  if (icon) {
    icon.textContent = recState.isCollapsed ? '+' : '−';
  }

  toggleBtn.setAttribute('aria-expanded', !recState.isCollapsed);
  toggleBtn.title = recState.isCollapsed ? 'Show panel' : 'Hide panel';
}

/**
 * Load recommendations from API.
 */
async function loadRecommendations() {
  if (recState.isLoading) return;

  const cardsContainer = document.getElementById('recommendation-cards');
  if (!cardsContainer) return;

  recState.isLoading = true;

  // Show skeleton loading state
  cardsContainer.innerHTML = `
    <div class="recommendation-loading">
      <div class="skeleton skeleton-card" style="width:100%"></div>
      <div class="skeleton skeleton-card" style="width:100%"></div>
      <div class="skeleton skeleton-card" style="width:100%"></div>
    </div>
  `;

  try {
    // Build query params from context
    const params = new URLSearchParams();
    params.set('limit', '5');

    const occasion = document.getElementById('rec-occasion')?.value;
    const food = document.getElementById('rec-food')?.value;
    const foodDetail = document.getElementById('rec-food-detail')?.value?.trim();

    if (occasion) params.set('occasion', occasion);
    // Combine food category with specific description for better pairing
    if (food || foodDetail) {
      const foodContext = [food, foodDetail].filter(Boolean).join(': ');
      params.set('food', foodContext);
    }

    const response = await fetch(`${API_BASE}/reduce-now/ai-recommendations?${params}`);

    if (!response.ok) {
      throw new Error('Failed to fetch recommendations');
    }

    const data = await response.json();
    recState.lastRecommendations = data;

    renderRecommendations(data);
  } catch (error) {
    console.error('Recommendations error:', error);
    cardsContainer.innerHTML = `
      <div class="recommendation-error">
        <div class="error-icon">⚠️</div>
        <p>Couldn't load recommendations</p>
        <button class="btn btn-small btn-secondary retry-btn">
          Try again
        </button>
      </div>
    `;
    // Attach event listener (CSP-compliant)
    cardsContainer.querySelector('.retry-btn')?.addEventListener('click', () => {
      document.getElementById('refresh-recommendations')?.click();
    });
  } finally {
    recState.isLoading = false;
  }
}

/**
 * Render recommendations to the UI.
 * @param {Object} data - API response data
 */
function renderRecommendations(data) {
  const cardsContainer = document.getElementById('recommendation-cards');
  if (!cardsContainer) return;

  // Check for API key error
  if (data.error && data.error.includes('API key')) {
    // Show fallback recommendations with notice
    if (data.recommendations && data.recommendations.length > 0) {
      renderFallbackRecommendations(data.recommendations, cardsContainer);
    } else {
      cardsContainer.innerHTML = `
        <div class="no-api-key-notice">
          <p>AI recommendations require a Claude API key</p>
          <p class="hint">Add ANTHROPIC_API_KEY to your environment to enable AI features</p>
        </div>
      `;
    }
    return;
  }

  // Get recommendations array
  const recommendations = data.recommendations || [];

  if (recommendations.length === 0) {
    cardsContainer.innerHTML = `
      <div class="recommendation-error">
        <div class="error-icon">🍷</div>
        <p>No recommendations available</p>
        <p style="font-size: 0.85rem; color: var(--text-muted);">Add more wines to your cellar</p>
      </div>
    `;
    return;
  }

  // Render recommendation cards
  cardsContainer.innerHTML = recommendations.map((rec, index) => {
    const wine = rec.wine || rec;
    const urgencyClass = getUrgencyClass(rec.urgency || wine.urgency);
    const urgencyLabel = getUrgencyLabel(rec.urgency || wine.urgency);

    return `
      <div class="recommendation-card" data-wine-id="${wine.wine_id || wine.id}">
        <span class="rank-badge">${index + 1}</span>
        <div class="wine-name">
          <span class="wine-colour ${escapeHtml(wine.colour || '')}"></span>
          ${escapeHtml(wine.wine_name)}
        </div>
        <div class="wine-vintage">${escapeHtml(wine.vintage) || 'NV'} • ${escapeHtml(wine.style || wine.country || '')}</div>
        ${urgencyLabel ? `<span class="urgency-tag ${urgencyClass}">${urgencyLabel}</span>` : ''}
        <div class="rec-reason">"${escapeHtml(rec.reason || rec.suggested_reason || 'Perfect for tonight')}"</div>
      </div>
    `;
  }).join('');

  // Bind click handlers to cards
  cardsContainer.querySelectorAll('.recommendation-card').forEach(card => {
    card.addEventListener('click', () => {
      const wineId = card.dataset.wineId;
      if (wineId) {
        navigateToWine(parseInt(wineId, 10));
      }
    });
  });
}

/**
 * Render fallback recommendations (when no AI available).
 * @param {Array} recommendations - Fallback recommendations
 * @param {HTMLElement} container - Container element
 */
function renderFallbackRecommendations(recommendations, container) {
  container.innerHTML = `
    <div class="no-api-key-notice" style="margin-bottom: 1rem;">
      <p style="font-size: 0.85rem;">Showing urgency-based suggestions (AI unavailable)</p>
    </div>
  ` + recommendations.map((rec, index) => {
    const wine = rec.wine || rec;
    const urgencyClass = getUrgencyClass(rec.urgency || wine.urgency);
    const urgencyLabel = getUrgencyLabel(rec.urgency || wine.urgency);

    return `
      <div class="recommendation-card" data-wine-id="${wine.wine_id || wine.id}">
        <span class="rank-badge">${index + 1}</span>
        <div class="wine-name">
          <span class="wine-colour ${escapeHtml(wine.colour || '')}"></span>
          ${escapeHtml(wine.wine_name)}
        </div>
        <div class="wine-vintage">${escapeHtml(wine.vintage) || 'NV'} • ${escapeHtml(wine.style || wine.country || '')}</div>
        ${urgencyLabel ? `<span class="urgency-tag ${urgencyClass}">${urgencyLabel}</span>` : ''}
        <div class="rec-reason">"${escapeHtml(rec.reason || rec.suggested_reason || 'Based on drinking window')}"</div>
      </div>
    `;
  }).join('');

  // Bind click handlers
  container.querySelectorAll('.recommendation-card').forEach(card => {
    card.addEventListener('click', () => {
      const wineId = card.dataset.wineId;
      if (wineId) {
        navigateToWine(parseInt(wineId, 10));
      }
    });
  });
}

/**
 * Get CSS class for urgency level.
 * @param {string} urgency - Urgency level
 * @returns {string} CSS class
 */
function getUrgencyClass(urgency) {
  switch (urgency) {
    case 'critical':
    case 'estimated_critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'peak':
    case 'estimated_peak':
      return 'peak';
    case 'medium':
    case 'estimated_medium':
      return 'medium';
    default:
      return '';
  }
}

/**
 * Get display label for urgency level.
 * @param {string} urgency - Urgency level
 * @returns {string} Display label
 */
function getUrgencyLabel(urgency) {
  switch (urgency) {
    case 'critical':
      return 'Past window';
    case 'estimated_critical':
      return 'Est. past window';
    case 'high':
      return 'Drink soon';
    case 'peak':
      return 'At peak';
    case 'estimated_peak':
      return 'Est. at peak';
    case 'medium':
      return 'Good to drink';
    case 'estimated_medium':
      return 'Est. ready';
    default:
      return '';
  }
}

/**
 * Navigate to wine in the wine list.
 * @param {number} wineId - Wine ID
 */
function navigateToWine(wineId) {
  // Switch to wines view
  const winesTab = document.querySelector('[data-view="wines"]');
  if (winesTab) winesTab.click();

  // After a brief delay, scroll to and highlight the wine
  setTimeout(() => {
    const wineCard = document.querySelector(`.wine-card[data-wine-id="${wineId}"]`);
    if (wineCard) {
      wineCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      wineCard.classList.add('highlight-pulse');
      setTimeout(() => wineCard.classList.remove('highlight-pulse'), 2000);
      wineCard.click();
    }
  }, 200);
}

export default {
  initRecommendations
};
