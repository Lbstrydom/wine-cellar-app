/**
 * @fileoverview AI zone chat functionality.
 * @module cellarAnalysis/zoneChat
 */

import { zoneChatMessage, reassignWineZone, getZoneLayoutProposal } from '../api.js';
import { showToast, escapeHtml } from '../utils.js';
import {
  getZoneChatContext,
  setZoneChatContext,
  getCurrentProposal,
  setCurrentProposal
} from './state.js';

// Import renderZoneProposal from zones - but we need to duplicate it here to avoid circular deps
// Or we can inline the function call

/**
 * Toggle zone chat panel visibility.
 */
export function toggleZoneChat() {
  const chatPanel = document.getElementById('zone-chat-panel');
  if (!chatPanel) return;

  const isVisible = chatPanel.style.display !== 'none';
  chatPanel.style.display = isVisible ? 'none' : 'block';

  if (!isVisible) {
    // Focus input when opening
    document.getElementById('zone-chat-input')?.focus();
  }
}

/**
 * Send a zone chat message.
 */
export async function sendZoneChatMessage() {
  const input = document.getElementById('zone-chat-input');
  const messagesEl = document.getElementById('zone-chat-messages');
  const sendBtn = document.getElementById('zone-chat-send-btn');

  if (!input || !messagesEl) return;

  const message = input.value.trim();
  if (!message) return;

  // Add user message to chat
  const userMsg = document.createElement('div');
  userMsg.className = 'chat-message user';
  userMsg.innerHTML = `<div class="chat-content">${escapeHtml(message)}</div>`;
  messagesEl.appendChild(userMsg);

  input.value = '';
  input.disabled = true;
  if (sendBtn) sendBtn.disabled = true;

  // Add thinking indicator
  const thinkingMsg = document.createElement('div');
  thinkingMsg.className = 'chat-message assistant thinking';
  thinkingMsg.innerHTML = '<div class="chat-content"><div class="chat-typing"><span></span><span></span><span></span></div></div>';
  messagesEl.appendChild(thinkingMsg);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const zoneChatContext = getZoneChatContext();
    const result = await zoneChatMessage(message, zoneChatContext);

    // Remove thinking indicator
    thinkingMsg.remove();

    // Add AI response
    const aiMsg = document.createElement('div');
    aiMsg.className = 'chat-message assistant';
    aiMsg.innerHTML = `<div class="chat-content">${formatZoneChatResponse(result)}</div>`;
    messagesEl.appendChild(aiMsg);

    // Store context for follow-up
    setZoneChatContext(result.context);

    // If there are reclassifications, show action buttons
    if (result.reclassifications && result.reclassifications.length > 0) {
      const actionsEl = renderReclassificationActions(result.reclassifications);
      messagesEl.appendChild(actionsEl);
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
  } catch (err) {
    thinkingMsg.remove();
    const errMsg = document.createElement('div');
    errMsg.className = 'chat-message assistant error';
    errMsg.innerHTML = `<div class="chat-content">Error: ${escapeHtml(err.message)}</div>`;
    messagesEl.appendChild(errMsg);
  } finally {
    input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    input.focus();
  }
}

/**
 * Format zone chat response for display.
 * @param {Object} result - Chat result
 * @returns {string} Formatted HTML
 */
function formatZoneChatResponse(result) {
  // Convert newlines to <br> and paragraphs
  return result.response
    .split('\n\n')
    .map(p => `<p>${escapeHtml(p).replaceAll('\n', '<br>')}</p>`)
    .join('');
}

/**
 * Render reclassification action buttons.
 * @param {Array} reclassifications - Suggested reclassifications
 * @returns {HTMLElement} Actions element with event listeners attached
 */
function renderReclassificationActions(reclassifications) {
  const container = document.createElement('div');
  container.className = 'zone-chat-actions';
  container.innerHTML = '<p class="actions-title">Suggested zone changes:</p>';

  reclassifications.forEach((r) => {
    const itemEl = document.createElement('div');
    itemEl.className = 'reclassification-item';
    itemEl.dataset.wineId = r.wineId;
    itemEl.dataset.suggestedZone = r.suggestedZone;
    itemEl.dataset.reason = r.reason || '';

    itemEl.innerHTML = `
      <div class="reclassification-info">
        <span class="wine-name">${escapeHtml(r.wineName)}</span>
        <span class="zone-change">${escapeHtml(r.currentZone)} → ${escapeHtml(r.suggestedZone)}</span>
        ${r.reason ? `<span class="reclassification-reason">${escapeHtml(r.reason)}</span>` : ''}
      </div>
      <button class="btn btn-small btn-primary apply-btn">Apply</button>
    `;

    // Attach event listener for apply button
    const applyBtn = itemEl.querySelector('.apply-btn');
    applyBtn.addEventListener('click', () => {
      applyReclassification(r.wineId, r.suggestedZone, r.reason || '', applyBtn);
    });

    container.appendChild(itemEl);
  });

  const applyAllBtn = document.createElement('button');
  applyAllBtn.className = 'btn btn-secondary apply-all-btn';
  applyAllBtn.textContent = `Apply All (${reclassifications.length})`;
  applyAllBtn.addEventListener('click', applyAllReclassifications);
  container.appendChild(applyAllBtn);

  return container;
}

/**
 * Apply a single reclassification.
 * @param {number} wineId - Wine ID
 * @param {string} newZoneId - New zone ID
 * @param {string} reason - Reason for change
 * @param {HTMLElement} buttonEl - The button that was clicked
 */
async function applyReclassification(wineId, newZoneId, reason, buttonEl) {
  try {
    const result = await reassignWineZone(wineId, newZoneId, reason);
    showToast(`Reclassified "${result.wineName}" to ${result.newZone} zone`);

    // Mark this item as applied in the UI
    if (buttonEl) {
      const itemEl = buttonEl.closest('.reclassification-item');
      if (itemEl) {
        itemEl.classList.add('applied');
        buttonEl.textContent = 'Applied';
        buttonEl.disabled = true;
      }
    }

    // Update "Apply All" button count
    updateApplyAllCount();

    // Refresh proposal if showing
    await refreshProposalIfActive();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Update the "Apply All" button to reflect remaining items.
 */
function updateApplyAllCount() {
  const actionsEl = document.querySelector('.zone-chat-actions');
  if (!actionsEl) return;

  const remaining = actionsEl.querySelectorAll('.reclassification-item:not(.applied)').length;
  const applyAllBtn = actionsEl.querySelector('.apply-all-btn');

  if (applyAllBtn) {
    if (remaining === 0) {
      applyAllBtn.textContent = 'All Applied';
      applyAllBtn.disabled = true;
    } else {
      applyAllBtn.textContent = `Apply All (${remaining})`;
    }
  }
}

/**
 * Apply all suggested reclassifications.
 */
async function applyAllReclassifications() {
  const zoneChatContext = getZoneChatContext();
  // Extract reclassifications from last chat message
  if (!zoneChatContext?.history) return;

  // Get the last assistant message with reclassifications
  const lastMsg = [...zoneChatContext.history].reverse().find(m => m.role === 'assistant');
  if (!lastMsg) return;

  const jsonMatch = lastMsg.content.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) return;

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    if (!parsed.reclassifications || parsed.reclassifications.length === 0) {
      showToast('No reclassifications to apply');
      return;
    }

    let applied = 0;
    for (const r of parsed.reclassifications) {
      try {
        await reassignWineZone(r.wineId, r.suggestedZone, r.reason || 'Chat suggestion');
        applied++;

        // Mark item as applied in UI
        const itemEl = document.querySelector(`.reclassification-item[data-wine-id="${r.wineId}"]`);
        if (itemEl) {
          itemEl.classList.add('applied');
          const btn = itemEl.querySelector('.apply-btn');
          if (btn) {
            btn.textContent = 'Applied';
            btn.disabled = true;
          }
        }
      } catch (error_) {
        console.error(`Failed to reclassify wine ${r.wineId}:`, error_);
      }
    }

    showToast(`Reclassified ${applied} wine${applied === 1 ? '' : 's'}`);

    // Update Apply All button
    const applyAllBtn = document.querySelector('.apply-all-btn');
    if (applyAllBtn) {
      applyAllBtn.textContent = 'All Applied';
      applyAllBtn.disabled = true;
    }

    // Refresh proposal if showing
    await refreshProposalIfActive();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Refresh the proposal list if it's currently displayed.
 */
async function refreshProposalIfActive() {
  const currentProposal = getCurrentProposal();
  if (currentProposal) {
    const newProposal = await getZoneLayoutProposal();
    setCurrentProposal(newProposal);
    const proposalEl = document.getElementById('zone-proposal-list');
    if (proposalEl) {
      // Re-render proposal - inline the rendering logic to avoid circular deps
      proposalEl.innerHTML = renderZoneProposal(newProposal);
    }
  }
}

/**
 * Render zone layout proposal as HTML.
 * Duplicated from zones.js to avoid circular dependency.
 * @param {Object} proposal
 * @returns {string} HTML
 */
function renderZoneProposal(proposal) {
  if (!proposal.proposals || proposal.proposals.length === 0) {
    return '<p>No zones to configure - your cellar appears to be empty.</p>';
  }

  let html = `
    <div class="proposal-summary">
      <strong>${proposal.totalBottles} bottles</strong> across <strong>${proposal.proposals.length} zones</strong>
      using <strong>${proposal.totalRows} rows</strong>
    </div>
    <div class="proposal-zones">
  `;

  proposal.proposals.forEach((zone, idx) => {
    html += `
      <div class="proposal-zone-card">
        <div class="zone-card-header">
          <span class="zone-order">${idx + 1}</span>
          <span class="zone-name">${zone.displayName}</span>
          <span class="zone-rows">${zone.assignedRows.join(', ')}</span>
        </div>
        <div class="zone-card-stats">
          <span>${zone.bottleCount} bottles</span>
          <span>${zone.totalCapacity} slots</span>
          <span>${zone.utilizationPercent}% full</span>
        </div>
        <div class="zone-card-wines">
          ${zone.wines.slice(0, 3).map(w => `<small>${w.name} ${w.vintage || ''}</small>`).join(', ')}
          ${zone.wines.length > 3 ? `<small>+${zone.wines.length - 3} more</small>` : ''}
        </div>
      </div>
    `;
  });

  html += '</div>';

  if (proposal.unassignedRows?.length > 0) {
    html += `<p class="proposal-note">Unassigned rows: ${proposal.unassignedRows.join(', ')} (available for future growth)</p>`;
  }

  return html;
}

/**
 * Clear zone chat history.
 */
export function clearZoneChat() {
  const messagesEl = document.getElementById('zone-chat-messages');
  if (messagesEl) {
    messagesEl.innerHTML = '<div class="zone-chat-welcome">Ask me about wine zone classifications. For example: "Why is my Appassimento in the dessert zone?" or "Move Cabernet wines to a different zone."</div>';
  }
  setZoneChatContext(null);
}
