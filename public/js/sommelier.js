/**
 * @fileoverview Sommelier (Claude pairing) UI.
 * @module sommelier
 */

import { askSommelier, getPairingSuggestions, sommelierChat, submitPairingFeedback } from './api.js';
import { showToast, escapeHtml } from './utils.js';
import { showWineModalFromList } from './modals.js';
import { renderRecommendation, displayRecommendations } from './pairing.js';
import { switchView } from './app.js';

const selectedSignals = new Set();

// Current chat session
let currentChatId = null;

/**
 * Convert transport/runtime failures into user-friendly messages.
 * @param {unknown} err - Thrown error
 * @param {string} fallback - Fallback message
 * @returns {string}
 */
function getFriendlyErrorMessage(err, fallback) {
  const message = err instanceof Error ? err.message : '';
  if (message && !/failed to fetch|networkerror|load failed/i.test(message)) {
    return message;
  }
  return fallback;
}

/**
 * Handle Ask Sommelier button click.
 */
export async function handleAskSommelier() {
  const dishInput = document.getElementById('dish-input');
  const dish = dishInput.value.trim();

  if (!dish) {
    showToast('Please describe a dish');
    return;
  }

  const source = document.querySelector('input[name="source"]:checked').value;
  const colour = document.querySelector('input[name="colour"]:checked').value;

  const btn = document.getElementById('ask-sommelier');
  const resultsContainer = document.getElementById('sommelier-results');

  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Thinking...';
  resultsContainer.innerHTML = '<div class="sommelier-response"><p style="color: var(--text-muted);">The sommelier is considering your dish...</p></div>';

  try {
    const data = await askSommelier(dish, source, colour);

    // Store chat session info
    currentChatId = data.chatId;

    renderSommelierResponse(data);
  } catch (err) {
    const message = getFriendlyErrorMessage(err, 'Unable to reach the sommelier service. Please try again.');
    resultsContainer.innerHTML = `
      <div class="sommelier-response">
        <p style="color: var(--priority-1);">Error: ${escapeHtml(message)}</p>
      </div>
    `;
    showToast(message, 'error');
    currentChatId = null;
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Ask Sommelier';
  }
}

/**
 * Render sommelier response.
 * @param {Object} data - Sommelier response data
 */
function renderSommelierResponse(data) {
  const container = document.getElementById('sommelier-results');

  let html = '<div class="sommelier-response">';

  if (data.dish_analysis) {
    html += `<div class="dish-analysis">${data.dish_analysis}</div>`;
  }

  if (data.colour_suggestion) {
    html += `<div class="colour-suggestion">${data.colour_suggestion}</div>`;
  }


  // Track card DOM elements to append after innerHTML (preserves event listeners)
  const cardElements = [];

  if (!data.recommendations || data.recommendations.length === 0) {
    html += `<div class="no-match"><p>No suitable wines found.</p></div>`;
  } else {
    // Placeholder div — card DOM elements are appended after innerHTML to keep listeners
    html += '<div class="recommendation-cards"></div>';
    data.recommendations.forEach((rec, idx) => {
      cardElements.push(renderRecommendation(rec, idx + 1));
    });
    // Store sessionId for feedback/choice
    if (data.sessionId) {
      displayRecommendations(data);
    }
  }

  html += '</div>';

  // Add chat interface if we have a chat session
  if (currentChatId) {
    html += `
      <div class="sommelier-chat">
        <div class="chat-messages" id="chat-messages"></div>
        <div class="chat-input-container">
          <input type="text" id="chat-input" placeholder="Ask a follow-up question..." />
          <button id="chat-send" class="btn btn-secondary">Send</button>
        </div>
        <div class="chat-suggestions">
          <span class="suggestion-label">Try:</span>
          <button class="chat-suggestion" data-message="What about something lighter?">Something lighter?</button>
          <button class="chat-suggestion" data-message="Tell me more about option #1">More about #1</button>
          <button class="chat-suggestion" data-message="Any white wine options?">White wines?</button>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;

  // Append recommendation card DOM elements (preserves addEventListener bindings)
  const cardsContainer = container.querySelector('.recommendation-cards');
  if (cardsContainer) {
    cardElements.forEach(card => cardsContainer.appendChild(card));
  }

  // Add click handlers to old-format recommendations (chat follow-ups)
  container.querySelectorAll('.recommendation.clickable').forEach(el => {
    el.addEventListener('click', () => {
      const wineId = Number.parseInt(el.dataset.wineId, 10);
      if (wineId) {
        showWineModalFromList({
          id: wineId,
          wine_name: el.dataset.wineName,
          vintage: el.dataset.vintage || null,
          style: el.dataset.style || null,
          colour: el.dataset.colour || null,
          locations: el.dataset.locations,
          bottle_count: Number.parseInt(el.dataset.bottleCount, 10) || 0
        });
      }
    });
  });

  // Set up chat event listeners
  initChatListeners();
}

/**
 * Initialize chat event listeners.
 */
function initChatListeners() {
  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');

  if (!chatInput || !chatSend) return;

  chatSend.addEventListener('click', handleChatSend);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleChatSend();
  });

  // Suggestion buttons
  document.querySelectorAll('.chat-suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      const message = btn.dataset.message;
      chatInput.value = message;
      handleChatSend();
    });
  });
}

/**
 * Handle sending a chat message.
 */
async function handleChatSend() {
  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');

  if (!chatInput || !currentChatId) return;

  const message = chatInput.value.trim();
  if (!message) return;

  // Add user message to UI
  appendChatMessage('user', message);
  chatInput.value = '';
  chatInput.disabled = true;
  chatSend.disabled = true;

  // Add thinking indicator
  const thinkingId = appendChatMessage('assistant', '<span class="loading-spinner"></span> Thinking...', true);

  try {
    const response = await sommelierChat(currentChatId, message);

    // Remove thinking indicator
    document.getElementById(thinkingId)?.remove();

    // Render response based on type
    if (response.type === 'recommendations') {
      // New recommendations
      renderChatRecommendations(response);
    } else {
      // Text explanation
      appendChatMessage('assistant', escapeHtml(response.message));
    }
  } catch (err) {
    document.getElementById(thinkingId)?.remove();
    appendChatMessage('assistant', `<span style="color: var(--priority-1);">Error: ${escapeHtml(err.message)}</span>`, true);
  } finally {
    chatInput.disabled = false;
    chatSend.disabled = false;
    chatInput.focus();
  }
}

/**
 * Append a message to the chat.
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - Message content
 * @param {boolean} isHtml - If true, content is treated as HTML
 * @returns {string} Message element ID
 */
function appendChatMessage(role, content, isHtml = false) {
  const chatMessagesEl = document.getElementById('chat-messages');
  if (!chatMessagesEl) return '';

  const msgId = `chat-msg-${Date.now()}`;
  const msgDiv = document.createElement('div');
  msgDiv.id = msgId;
  msgDiv.className = `chat-message ${role}`;

  if (isHtml) {
    msgDiv.innerHTML = content;
  } else {
    msgDiv.textContent = content;
  }

  chatMessagesEl.appendChild(msgDiv);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

  return msgId;
}

/**
 * Render recommendations from chat response.
 * @param {Object} response - Chat response with recommendations
 */
function renderChatRecommendations(response) {
  const chatMessagesEl = document.getElementById('chat-messages');
  if (!chatMessagesEl) return;

  let html = '<div class="chat-recommendations">';

  if (response.message) {
    html += `<p class="chat-intro">${escapeHtml(response.message)}</p>`;
  }

  if (response.recommendations && response.recommendations.length > 0) {
    response.recommendations.forEach(rec => {
      const priorityClass = rec.is_priority ? 'priority' : '';
      const clickableClass = rec.wine_id ? 'clickable' : '';

      html += `
        <div class="recommendation ${priorityClass} ${clickableClass}"
             data-wine-id="${rec.wine_id || ''}"
             data-wine-name="${escapeHtml(rec.wine_name)}"
             data-vintage="${rec.vintage || ''}"
             data-style="${rec.style || ''}"
             data-colour="${rec.colour || ''}"
             data-locations="${rec.location || ''}"
             data-bottle-count="${rec.bottle_count || 0}">
          <div class="recommendation-header">
            <h4>#${rec.rank} ${escapeHtml(rec.wine_name)} ${rec.vintage || 'NV'}</h4>
            ${rec.is_priority ? '<span class="priority-badge">Drink Soon</span>' : ''}
          </div>
          <div class="location">${rec.location ? rec.location : 'Unknown'} (${rec.bottle_count ? rec.bottle_count : 0} bottle${(rec.bottle_count ? rec.bottle_count : 0) === 1 ? '' : 's'})</div>
          <p class="why">${escapeHtml(rec.why)}</p>
          ${rec.food_tip ? `<div class="food-tip">${escapeHtml(rec.food_tip)}</div>` : ''}
        </div>
      `;
    });
  }

  html += '</div>';

  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-message assistant';
  msgDiv.innerHTML = html;
  chatMessagesEl.appendChild(msgDiv);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

  // Add click handlers for new recommendations
  msgDiv.querySelectorAll('.recommendation.clickable').forEach(el => {
    el.addEventListener('click', () => {
      const wineId = Number.parseInt(el.dataset.wineId, 10);
      if (wineId) {
        showWineModalFromList({
          id: wineId,
          wine_name: el.dataset.wineName,
          vintage: el.dataset.vintage || null,
          style: el.dataset.style || null,
          colour: el.dataset.colour || null,
          locations: el.dataset.locations,
          bottle_count: Number.parseInt(el.dataset.bottleCount, 10) || 0
        });
      }
    });
  });
}

/**
 * Toggle signal selection.
 * @param {HTMLElement} btn - Signal button
 */
export function toggleSignal(btn) {
  const signal = btn.dataset.signal;

  if (selectedSignals.has(signal)) {
    selectedSignals.delete(signal);
    btn.classList.remove('active');
  } else {
    selectedSignals.add(signal);
    btn.classList.add('active');
  }
}

/**
 * Handle manual pairing request.
 */
export async function handleGetPairing() {
  if (selectedSignals.size === 0) {
    showToast('Select at least one characteristic');
    return;
  }

  const button = document.getElementById('get-pairing');
  const container = document.getElementById('pairing-results');
  const originalLabel = button?.textContent || 'Find Pairing';

  if (button) {
    button.disabled = true;
    button.textContent = 'Finding...';
  }

  try {
    const data = await getPairingSuggestions(Array.from(selectedSignals));
    renderManualPairingResults(data);
  } catch (err) {
    const message = getFriendlyErrorMessage(err, 'Unable to fetch pairing suggestions. Please try again.');
    if (container) {
      container.innerHTML = `<p style="color: var(--priority-1);">Error: ${escapeHtml(message)}</p>`;
    }
    showToast(message, 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

/**
 * Render manual pairing results.
 * @param {Object} data - Pairing results
 */
function renderManualPairingResults(data) {
  const container = document.getElementById('pairing-results');

  if (!data.suggestions || data.suggestions.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted);">No matching wines found.</p>';
    return;
  }

  container.innerHTML = data.suggestions.map((wine, idx) => `
    <div class="pairing-suggestion clickable" data-wine-id="${wine.id}">
      <div class="pairing-score">#${idx + 1}</div>
      <div style="flex: 1;">
        <div style="font-weight: 500;">${wine.wine_name} ${wine.vintage || 'NV'}</div>
        <div style="font-size: 0.85rem; color: var(--text-muted);">
          ${wine.style} • ${wine.bottle_count} bottle${wine.bottle_count > 1 ? 's' : ''}
        </div>
        <div style="font-size: 0.8rem; color: var(--accent);">${wine.locations}</div>
      </div>
    </div>
  `).join('');

  // Add click handlers to suggestions
  container.querySelectorAll('.pairing-suggestion.clickable').forEach(el => {
    el.addEventListener('click', () => {
      const wineId = Number.parseInt(el.dataset.wineId, 10);
      const wine = data.suggestions.find(w => w.id === wineId);
      if (wine) {
        showWineModalFromList(wine);
      }
    });
  });
}

/**
 * Clear signal selections.
 */
export function clearSignals() {
  selectedSignals.clear();
  document.querySelectorAll('.signal-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById('pairing-results').innerHTML = '<p style="color: var(--text-muted);">Select dish characteristics above</p>';
}

/**
 * Initialise sommelier event listeners.
 */
export function initSommelier() {
  document.getElementById('ask-sommelier')?.addEventListener('click', handleAskSommelier);
  document.getElementById('dish-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAskSommelier();
  });

  // AI Picks cross-link: navigate to Cellar grid and expand the recommendations panel
  document.getElementById('go-to-ai-picks')?.addEventListener('click', () => {
    switchView('grid');
    setTimeout(() => {
      import('./recommendations.js').then(({ expandPanel }) => expandPanel());
    }, 100);
  });

  document.querySelectorAll('.signal-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleSignal(btn));
  });

  document.getElementById('get-pairing')?.addEventListener('click', handleGetPairing);
  document.getElementById('clear-signals')?.addEventListener('click', clearSignals);

  // Feedback modal logic (wired once at init, not inside renderSommelierResponse)
  const feedbackModal = document.getElementById('pairing-feedback-modal');
  const cancelBtn = document.getElementById('cancel-feedback');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      feedbackModal.style.display = 'none';
    });
  }
  const form = document.getElementById('pairing-feedback-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const sessionId = feedbackModal.dataset.sessionId;
      const rating = document.getElementById('feedback-rating').value;
      const wouldPairAgainEl = form.querySelector('input[name="wouldPairAgain"]:checked');
      const notes = document.getElementById('feedback-notes').value;
      if (!sessionId || !rating) {
        showToast('Please select a rating.');
        return;
      }
      if (!wouldPairAgainEl) {
        showToast('Please indicate if you would pair these again.');
        return;
      }
      try {
        await submitPairingFeedback(sessionId, {
          pairingFitRating: Number(rating),
          wouldPairAgain: wouldPairAgainEl.value === 'true',
          notes: notes || undefined
        });
        feedbackModal.style.display = 'none';
        showToast('Thank you for your feedback!');
        form.reset();
      } catch (err) {
        if (err instanceof Error) {
          showToast('Error submitting feedback: ' + err.message);
        } else {
          showToast('Error submitting feedback.');
        }
      }
    });
  }
}
