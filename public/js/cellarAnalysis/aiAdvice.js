/**
 * @fileoverview AI organization advice functionality.
 * @module cellarAnalysis/aiAdvice
 */

import { analyseCellarAI } from '../api.js';

/**
 * Get AI advice for cellar organisation.
 */
export async function handleGetAIAdvice() {
  const adviceEl = document.getElementById('analysis-ai-advice');
  if (!adviceEl) return;

  adviceEl.style.display = 'block';
  adviceEl.innerHTML = '<div class="analysis-loading">Getting AI advice... (this may take up to 2 minutes)</div>';

  try {
    const result = await analyseCellarAI();
    adviceEl.innerHTML = formatAIAdvice(result.aiAdvice);
  } catch (err) {
    adviceEl.innerHTML = `<div class="ai-advice-error">Error: ${err.message}</div>`;
  }
}

/**
 * Format AI advice object into HTML.
 * @param {Object} advice - AI advice object
 * @returns {string} HTML formatted advice
 */
function formatAIAdvice(advice) {
  if (!advice) return '<p>No advice available.</p>';

  // If it's a string (legacy), just format as paragraphs
  if (typeof advice === 'string') {
    const paragraphs = advice.split('\n\n').map(p => {
      return `<p>${p.replaceAll('\n', '<br>')}</p>`;
    }).join('');
    return `<h4>AI Sommelier Advice</h4><div class="ai-advice-content">${paragraphs}</div>`;
  }

  // Format structured advice object
  let html = '<div class="ai-advice-structured">';

  // Summary
  if (advice.summary) {
    html += `<div class="ai-summary"><h4>Summary</h4><p>${advice.summary}</p></div>`;
  }

  // Layout narrative
  if (advice.layoutNarrative) {
    html += `<div class="ai-narrative"><h4>Cellar Layout</h4><p>${advice.layoutNarrative}</p></div>`;
  }

  // Zone adjustments
  if (advice.zoneAdjustments && advice.zoneAdjustments.length > 0) {
    html += '<div class="ai-zone-adjustments"><h4>Suggested Zone Changes</h4><ul>';
    advice.zoneAdjustments.forEach(adj => {
      html += `<li><strong>${adj.zoneId}</strong>: ${adj.suggestion}</li>`;
    });
    html += '</ul></div>';
  }

  // Zone health
  if (advice.zoneHealth && advice.zoneHealth.length > 0) {
    html += '<div class="ai-zone-health"><h4>Zone Health</h4>';
    advice.zoneHealth.forEach(z => {
      let statusClass = 'bad';
      if (z.status === 'healthy') {
        statusClass = 'good';
      } else if (z.status === 'fragmented') {
        statusClass = 'warning';
      }
      html += `<div class="zone-health-item ${statusClass}">
        <span class="zone-name">${z.zone}</span>
        <span class="zone-status">${z.status}</span>
        <p class="zone-recommendation">${z.recommendation}</p>
      </div>`;
    });
    html += '</div>';
  }

  // Fridge plan
  if (advice.fridgePlan?.toAdd?.length > 0) {
    html += '<div class="ai-fridge-plan"><h4>Fridge Recommendations</h4><ul>';
    advice.fridgePlan.toAdd.forEach(item => {
      html += `<li><strong>${item.category}</strong>: ${item.reason}</li>`;
    });
    html += '</ul></div>';
  }

  html += '</div>';
  return html;
}
