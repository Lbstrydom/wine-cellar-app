/**
 * @fileoverview Step 4: Results display for restaurant pairing wizard.
 * Renders summary bar, optional inputs, "Get Pairings" button, result cards,
 * fallback banner, and chat interface gated on chatId.
 * @module restaurantPairing/results
 */

import {
  getSelectedWines, getSelectedDishes,
  getResults, setResults,
  getChatId, setChatId,
  getQuickPairMode, setQuickPairMode
} from './state.js';
import { getRecommendations, restaurantChat } from '../api.js';
import { showToast, escapeHtml } from '../utils.js';

/** Must match backend recommendSchema */
const MAX_WINES = 80;
/** Must match backend recommendSchema */
const MAX_DISHES = 20;

/** Chat suggestion buttons */
const CHAT_SUGGESTIONS = [
  'What about a lighter option?',
  'Any by-the-glass alternatives?',
  'Budget-friendly picks?'
];

// --- Module state ---

/** @type {Array<{el: Element, event: string, handler: Function}>} */
let listeners = [];
/** @type {Array<{el: Element, event: string, handler: Function}>} Re-created on chat re-render */
const chatListeners = [];
/** @type {HTMLElement|null} */
let rootContainer = null;

// --- Helpers ---

function addListener(el, event, handler) {
  el.addEventListener(event, handler);
  listeners.push({ el, event, handler });
}

function addChatListener(el, event, handler) {
  el.addEventListener(event, handler);
  chatListeners.push({ el, event, handler });
}

function cleanupChatListeners() {
  for (const { el, event, handler } of chatListeners) {
    el.removeEventListener(event, handler);
  }
  chatListeners.length = 0;
}

// --- Render ---

/**
 * Render Step 4 results into the given container.
 * @param {string} containerId - DOM element ID to render into
 */
export function renderResults(containerId) {
  rootContainer = document.getElementById(containerId);
  if (!rootContainer) return;

  const results = getResults();

  rootContainer.innerHTML = `
    <div class="restaurant-results" role="region" aria-label="Pairing results">
      <div class="restaurant-results-summary" aria-live="polite"></div>
      <div class="restaurant-results-options">
        <div class="form-row">
          <div class="form-field">
            <label for="restaurant-party-size">Party size</label>
            <input type="number" id="restaurant-party-size" class="restaurant-party-size"
                   min="1" max="20" placeholder="Optional" aria-label="Party size">
          </div>
          <div class="form-field">
            <label for="restaurant-max-bottles">Max bottles</label>
            <input type="number" id="restaurant-max-bottles" class="restaurant-max-bottles"
                   min="1" max="10" placeholder="Optional" aria-label="Max bottles">
          </div>
          <label class="restaurant-prefer-btg-toggle">
            <input type="checkbox" class="restaurant-prefer-btg-checkbox"> Prefer by the glass
          </label>
        </div>
      </div>
      <div class="restaurant-results-actions">
        <button class="btn btn-primary restaurant-get-pairings-btn" type="button">Get Pairings</button>
      </div>
      <div class="restaurant-results-loading" style="display:none;" aria-live="polite">
        <span class="loading-spinner"></span> Getting recommendations&hellip;
      </div>
      <div class="restaurant-fallback-banner" role="alert" style="display:none;"></div>
      <div class="restaurant-results-cards" role="list" aria-live="polite"></div>
      <div class="restaurant-chat-section"></div>
    </div>
  `;

  // --- DOM refs ---
  const getPairingsBtn = rootContainer.querySelector('.restaurant-get-pairings-btn');

  // --- Bind "Get Pairings" ---
  addListener(getPairingsBtn, 'click', () => {
    requestRecommendations();
  });

  // --- Quick Pair warning banner ---
  const isQuickPair = getQuickPairMode();
  if (isQuickPair) {
    const warningHtml = `
      <div class="restaurant-quick-pair-warning" role="alert">
        <strong>⚡ Quick Pair</strong> — Pairings based on best-guess parsing.
        <button class="btn btn-link restaurant-refine-btn" type="button">
          Refine for accuracy →
        </button>
      </div>`;
    rootContainer.querySelector('.restaurant-results').insertAdjacentHTML('afterbegin', warningHtml);

    const refineBtn = rootContainer.querySelector('.restaurant-refine-btn');
    addListener(refineBtn, 'click', () => {
      setQuickPairMode(false);
      // Emit custom event for controller to handle (no circular import)
      rootContainer.dispatchEvent(new CustomEvent('restaurant:refine', { bubbles: true }));
    });
  }

  // --- Render state ---
  updateSummary();

  // If results exist (returning to step 4), render them
  if (results) {
    renderResultCards(results);
    renderChat();
  }
}

// --- Summary ---

function updateSummary() {
  const summaryEl = rootContainer.querySelector('.restaurant-results-summary');
  if (!summaryEl) return;

  const wineCount = getSelectedWines().length;
  const dishCount = getSelectedDishes().length;

  let html = `Pairing ${wineCount} wine${wineCount !== 1 ? 's' : ''} with ${dishCount} dish${dishCount !== 1 ? 'es' : ''}`;

  if (wineCount > MAX_WINES) {
    html += ` <span class="restaurant-over-cap-warning">Too many wines selected (${wineCount}/${MAX_WINES})</span>`;
  }
  if (dishCount > MAX_DISHES) {
    html += ` <span class="restaurant-over-cap-warning">Too many dishes selected (${dishCount}/${MAX_DISHES})</span>`;
  }

  summaryEl.innerHTML = html;
}

// --- Request Recommendations ---

/**
 * Request pairing recommendations from API.
 * Exported for Quick Pair direct invocation.
 * @returns {Promise<void>}
 */
export async function requestRecommendations() {
  if (!rootContainer) {
    console.error('requestRecommendations called before renderResults - rootContainer is null');
    return;
  }

  const wines = getSelectedWines();
  const dishes = getSelectedDishes();

  // Pre-flight validation
  if (wines.length > MAX_WINES) {
    showToast(`Too many wines selected (${wines.length}/${MAX_WINES}). Please go back and deselect some.`, 'error');
    return;
  }
  if (dishes.length > MAX_DISHES) {
    showToast(`Too many dishes selected (${dishes.length}/${MAX_DISHES}). Please go back and deselect some.`, 'error');
    return;
  }

  // Gather optional inputs
  const partySizeInput = rootContainer.querySelector('.restaurant-party-size');
  const maxBottlesInput = rootContainer.querySelector('.restaurant-max-bottles');
  const preferBtgCheckbox = rootContainer.querySelector('.restaurant-prefer-btg-checkbox');

  const partySize = partySizeInput?.value ? Number(partySizeInput.value) : null;
  const maxBottles = maxBottlesInput?.value ? Number(maxBottlesInput.value) : null;
  const preferBtg = preferBtgCheckbox?.checked || false;

  // Build payload
  const payload = {
    wines: wines.map(w => ({
      id: w.id, name: w.name, colour: w.colour ?? null,
      style: w.style ?? null, vintage: w.vintage ?? null,
      price: w.price ?? null, by_the_glass: w.by_the_glass ?? false
    })),
    dishes: dishes.map(d => ({
      id: d.id, name: d.name,
      description: d.description ?? null, category: d.category ?? null
    }))
  };
  if (partySize != null) payload.party_size = partySize;
  if (maxBottles != null) payload.max_bottles = maxBottles;
  if (preferBtg) payload.prefer_by_glass = true;

  // Loading state
  const btn = rootContainer.querySelector('.restaurant-get-pairings-btn');
  const loadingEl = rootContainer.querySelector('.restaurant-results-loading');
  if (btn) btn.disabled = true;
  if (loadingEl) loadingEl.style.display = '';

  try {
    const data = await getRecommendations(payload);

    // Store results and chatId (always set — clears old chat on fallback)
    setResults(data);
    setChatId(data.chatId ?? null);

    renderResultCards(data);
    renderChat();
    updateSummary();
  } catch (err) {
    showToast(`Pairing failed: ${err.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

// --- Result Cards ---

/**
 * Render pairing result cards from API response.
 * @param {Object} data - API response
 */
function renderResultCards(data) {
  const cardsContainer = rootContainer.querySelector('.restaurant-results-cards');
  const fallbackBanner = rootContainer.querySelector('.restaurant-fallback-banner');
  if (!cardsContainer) return;

  // Fallback banner
  if (fallbackBanner) {
    if (data.fallback) {
      fallbackBanner.textContent = 'AI unavailable \u2014 basic suggestions shown';
      fallbackBanner.style.display = '';
    } else {
      fallbackBanner.textContent = '';
      fallbackBanner.style.display = 'none';
    }
  }

  const pairings = Array.isArray(data.pairings) ? data.pairings : [];

  let html = pairings.map(p => {
    const btgBadge = p.by_the_glass ? '<span class="restaurant-btg-badge">BTG</span>' : '';
    const priceText = p.wine_price != null ? `<span class="restaurant-card-price">$${escapeHtml(String(p.wine_price))}</span>` : '';
    const colourText = p.wine_colour ? `<span class="restaurant-card-colour">${escapeHtml(p.wine_colour)}</span>` : '';
    const confText = p.confidence ? `<span class="restaurant-pairing-confidence">${escapeHtml(p.confidence)}</span>` : '';

    return `<div class="restaurant-result-card" role="listitem">
      <div class="restaurant-result-dish"><strong>${escapeHtml(p.dish_name ?? '')}</strong></div>
      <div class="restaurant-result-wine">
        <span class="restaurant-result-wine-name">${escapeHtml(p.wine_name ?? '')}</span>
        ${colourText}${priceText}${btgBadge}
      </div>
      ${p.why ? `<div class="restaurant-result-why">${escapeHtml(p.why)}</div>` : ''}
      ${p.serving_tip ? `<div class="restaurant-result-tip">${escapeHtml(p.serving_tip)}</div>` : ''}
      ${confText}
    </div>`;
  }).join('');

  // Table wine suggestion (object with wine_name, wine_price, why)
  if (data.table_wine) {
    const tw = data.table_wine;
    const twPrice = tw.wine_price != null ? ` ($${escapeHtml(String(tw.wine_price))})` : '';
    html += `<div class="restaurant-table-wine-card" role="listitem">
      <strong>Table Wine Suggestion</strong>
      <div>${escapeHtml(tw.wine_name ?? '')}${twPrice}</div>
      ${tw.why ? `<div class="restaurant-table-wine-why">${escapeHtml(tw.why)}</div>` : ''}
    </div>`;
  }

  cardsContainer.innerHTML = html;
}

// --- Chat ---

function renderChat() {
  const chatSection = rootContainer.querySelector('.restaurant-chat-section');
  if (!chatSection) return;

  cleanupChatListeners();

  const chatId = getChatId();

  if (!chatId) {
    chatSection.innerHTML = '<p class="restaurant-chat-unavailable">Follow-up chat is not available for basic suggestions.</p>';
    return;
  }

  chatSection.innerHTML = `
    <div class="restaurant-chat" role="region" aria-label="Follow-up chat">
      <div class="restaurant-chat-messages"></div>
      <div class="restaurant-chat-input-row">
        <input type="text" class="restaurant-chat-input" maxlength="2000"
               placeholder="Ask a follow-up question about pairings..."
               aria-label="Ask a follow-up question about pairings">
        <span class="restaurant-chat-char-counter">0 / 2000</span>
        <button class="btn btn-secondary restaurant-chat-send-btn" type="button">Send</button>
      </div>
      <div class="restaurant-chat-suggestions">
        ${CHAT_SUGGESTIONS.map(s =>
          `<button class="btn btn-outline restaurant-chat-suggestion" type="button"
                  data-message="${escapeHtml(s)}">${escapeHtml(s)}</button>`
        ).join('')}
      </div>
    </div>
  `;

  // Bind chat events
  const chatInput = chatSection.querySelector('.restaurant-chat-input');
  const sendBtn = chatSection.querySelector('.restaurant-chat-send-btn');
  const charCounter = chatSection.querySelector('.restaurant-chat-char-counter');

  // Char counter
  addChatListener(chatInput, 'input', () => {
    charCounter.textContent = `${chatInput.value.length} / 2000`;
  });

  // Send on button click
  addChatListener(sendBtn, 'click', () => {
    handleChatSend();
  });

  // Send on Enter
  addChatListener(chatInput, 'keypress', (e) => {
    if (e.key === 'Enter') handleChatSend();
  });

  // Suggestion buttons
  chatSection.querySelectorAll('.restaurant-chat-suggestion').forEach(btn => {
    addChatListener(btn, 'click', () => {
      chatInput.value = btn.dataset.message;
      charCounter.textContent = `${chatInput.value.length} / 2000`;
      handleChatSend();
    });
  });
}

/**
 * Handle sending a chat message.
 */
async function handleChatSend() {
  const chatInput = rootContainer.querySelector('.restaurant-chat-input');
  const sendBtn = rootContainer.querySelector('.restaurant-chat-send-btn');
  const chatId = getChatId();

  if (!chatInput || !chatId) return;

  const message = chatInput.value.trim();
  if (!message) return;

  // Add user message to UI
  appendChatMessage('user', message);
  chatInput.value = '';
  chatInput.disabled = true;
  sendBtn.disabled = true;

  // Update char counter
  const charCounter = rootContainer.querySelector('.restaurant-chat-char-counter');
  if (charCounter) charCounter.textContent = '0 / 2000';

  // Show thinking indicator
  const thinkingId = appendChatMessage('assistant', '<span class="loading-spinner"></span> Thinking\u2026', true);

  try {
    const response = await restaurantChat(chatId, message);

    // Remove thinking indicator
    removeChatMessage(thinkingId);

    // Display response (textContent path — no escaping needed)
    if (response.message) {
      appendChatMessage('assistant', response.message);
    }
  } catch (err) {
    removeChatMessage(thinkingId);
    appendChatMessage('assistant', `<span class="restaurant-chat-error">Error: ${escapeHtml(err.message)}</span>`, true);
  } finally {
    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.focus();
  }
}

/**
 * Append a message to the chat messages container.
 * @param {'user'|'assistant'} role
 * @param {string} content
 * @param {boolean} [isHtml=false] - If true, content is raw HTML
 * @returns {string} Message element ID
 */
function appendChatMessage(role, content, isHtml = false) {
  const messagesEl = rootContainer.querySelector('.restaurant-chat-messages');
  if (!messagesEl) return '';

  const msgId = `restaurant-chat-msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const msgDiv = document.createElement('div');
  msgDiv.id = msgId;
  msgDiv.className = `restaurant-chat-message ${role}`;

  if (isHtml) {
    msgDiv.innerHTML = content;
  } else {
    msgDiv.textContent = content;
  }

  messagesEl.appendChild(msgDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return msgId;
}

/**
 * Remove a chat message by ID.
 * @param {string} msgId
 */
function removeChatMessage(msgId) {
  if (!msgId || !rootContainer) return;
  const el = document.getElementById(msgId);
  if (el) el.remove();
}

// --- Cleanup ---

/**
 * Destroy results view, removing all event listeners.
 */
export function destroyResults() {
  cleanupChatListeners();
  for (const { el, event, handler } of listeners) {
    el.removeEventListener(event, handler);
  }
  listeners = [];
  rootContainer = null;
}
