/**
 * @fileoverview Settings page functionality.
 * @module settings
 */

import {
  getSettings,
  updateSetting,
  getCredentials,
  saveCredentials,
  deleteCredentials,
  testCredentials,
  evaluateReduceRules,
  batchAddReduceNow
} from './api.js';
import { showToast, escapeHtml } from './utils.js';

/**
 * Load and display current settings.
 */
export async function loadSettings() {
  try {
    const settings = await getSettings();

    // Rating preference slider
    const slider = document.getElementById('rating-preference-slider');
    if (slider && settings.rating_preference) {
      slider.value = settings.rating_preference;
      updatePreferenceDisplay(parseInt(settings.rating_preference, 10));
    }

    // Reduce-now auto rules
    const rulesEnabled = document.getElementById('reduce-auto-rules-enabled');
    if (rulesEnabled) {
      rulesEnabled.checked = settings.reduce_auto_rules_enabled === 'true';
      updateRulesVisibility(rulesEnabled.checked);
    }

    const ageThreshold = document.getElementById('reduce-age-threshold');
    if (ageThreshold && settings.reduce_age_threshold) {
      ageThreshold.value = settings.reduce_age_threshold;
    }

    const ratingMinimum = document.getElementById('reduce-rating-minimum');
    if (ratingMinimum && settings.reduce_rating_minimum) {
      ratingMinimum.value = settings.reduce_rating_minimum;
    }

    // Drinking window settings
    const urgencyMonths = document.getElementById('reduce-urgency-months');
    if (urgencyMonths && settings.reduce_window_urgency_months) {
      urgencyMonths.value = settings.reduce_window_urgency_months;
    }

    const includeNoWindow = document.getElementById('reduce-include-no-window');
    if (includeNoWindow) {
      includeNoWindow.checked = settings.reduce_include_no_window !== 'false';
    }

    // Load credentials status
    await loadCredentialsStatus();

  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

/**
 * Update the preference slider display text.
 * @param {number} value - Slider value (-100 to +100)
 */
function updatePreferenceDisplay(value) {
  const display = document.getElementById('preference-value-display');
  const description = document.getElementById('preference-description');

  if (display) {
    display.textContent = value >= 0 ? `+${value}` : `${value}`;
  }

  if (description) {
    if (value >= 75) {
      description.textContent = 'Strongly favors competition awards';
    } else if (value >= 25) {
      description.textContent = 'Slightly favors competition awards';
    } else if (value >= -25) {
      description.textContent = 'Balanced between all sources';
    } else if (value >= -75) {
      description.textContent = 'Slightly favors community ratings';
    } else {
      description.textContent = 'Strongly favors community ratings';
    }
  }
}

/**
 * Update visibility of rules inputs based on enabled state.
 * @param {boolean} enabled
 */
function updateRulesVisibility(enabled) {
  const container = document.getElementById('reduce-rules-container');
  if (container) {
    container.style.opacity = enabled ? '1' : '0.5';
    container.querySelectorAll('input, button').forEach(el => {
      el.disabled = !enabled;
    });
  }
}

/**
 * Load credentials status from API.
 */
async function loadCredentialsStatus() {
  try {
    const data = await getCredentials();

    // Show encryption warning if not configured
    const warning = document.getElementById('encryption-warning');
    if (warning) {
      warning.style.display = data.encryption_configured ? 'none' : 'block';
    }

    // Update each credential source status
    const sources = ['vivino', 'decanter', 'cellartracker'];
    for (const source of sources) {
      const cred = data.credentials.find(c => c.source_id === source);
      updateCredentialUI(source, cred);
    }

  } catch (err) {
    console.error('Failed to load credentials:', err);
  }
}

/**
 * Update credential form UI based on status.
 * @param {string} source - Source ID
 * @param {Object|null} cred - Credential data
 */
function updateCredentialUI(source, cred) {
  const statusEl = document.getElementById(`${source}-status`);
  const usernameInput = document.getElementById(`${source}-username`);
  const passwordInput = document.getElementById(`${source}-password`);
  const saveBtn = document.getElementById(`${source}-save-btn`);
  const testBtn = document.getElementById(`${source}-test-btn`);
  const deleteBtn = document.getElementById(`${source}-delete-btn`);

  if (!statusEl) return;

  if (cred && cred.has_credentials) {
    // Has credentials configured
    const statusClass = cred.auth_status === 'valid' ? 'status-valid' :
                        cred.auth_status === 'failed' ? 'status-failed' : 'status-pending';
    const statusText = cred.auth_status === 'valid' ? 'Connected' :
                       cred.auth_status === 'failed' ? 'Failed' : 'Not tested';

    statusEl.textContent = statusText;
    statusEl.className = `credential-status ${statusClass}`;

    if (usernameInput) usernameInput.value = cred.masked_username || '';
    if (usernameInput) usernameInput.placeholder = 'Update email...';
    if (passwordInput) passwordInput.placeholder = 'Update password...';

    if (saveBtn) saveBtn.textContent = 'Update';
    if (testBtn) testBtn.style.display = 'inline-block';
    if (deleteBtn) deleteBtn.style.display = 'inline-block';

  } else {
    // No credentials
    statusEl.textContent = 'Not configured';
    statusEl.className = 'credential-status';

    if (usernameInput) usernameInput.value = '';
    if (passwordInput) passwordInput.value = '';

    if (saveBtn) saveBtn.textContent = 'Save';
    if (testBtn) testBtn.style.display = 'none';
    if (deleteBtn) deleteBtn.style.display = 'none';
  }
}

/**
 * Handle saving credentials.
 * @param {string} source - Source ID
 */
async function handleSaveCredentials(source) {
  const username = document.getElementById(`${source}-username`).value.trim();
  const password = document.getElementById(`${source}-password`).value;

  if (!username || !password) {
    showToast('Please enter both username and password');
    return;
  }

  const saveBtn = document.getElementById(`${source}-save-btn`);
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    await saveCredentials(source, username, password);
    showToast('Credentials saved');
    await loadCredentialsStatus();
    // Clear password field after save
    document.getElementById(`${source}-password`).value = '';
  } catch (err) {
    showToast('Error: ' + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
}

/**
 * Handle testing credentials.
 * @param {string} source - Source ID
 */
async function handleTestCredentials(source) {
  const testBtn = document.getElementById(`${source}-test-btn`);
  testBtn.disabled = true;
  testBtn.textContent = 'Testing...';

  try {
    const result = await testCredentials(source);
    if (result.success) {
      showToast(result.message || 'Connection successful');
    } else {
      showToast(result.message || 'Connection failed');
    }
    await loadCredentialsStatus();
  } catch (err) {
    showToast('Error: ' + err.message);
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test';
  }
}

/**
 * Handle deleting credentials.
 * @param {string} source - Source ID
 */
async function handleDeleteCredentials(source) {
  if (!confirm(`Remove ${source} credentials?`)) return;

  try {
    await deleteCredentials(source);
    showToast('Credentials removed');
    await loadCredentialsStatus();
  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

/**
 * Handle evaluating reduce-now rules.
 */
async function handleEvaluateRules() {
  const btn = document.getElementById('evaluate-rules-btn');
  btn.disabled = true;
  btn.textContent = 'Evaluating...';

  try {
    const result = await evaluateReduceRules();

    if (!result.enabled) {
      showToast('Auto-rules are disabled');
      return;
    }

    const container = document.getElementById('reduce-candidates-container');
    const list = document.getElementById('reduce-candidates-list');

    if (result.candidates.length === 0) {
      showToast('No wines match the criteria');
      container.style.display = 'none';
      return;
    }

    // Render candidates with urgency badges
    list.innerHTML = result.candidates.map(wine => `
      <div class="reduce-candidate" data-wine-id="${wine.wine_id}">
        <input type="checkbox" class="candidate-checkbox" checked />
        <div class="candidate-info">
          <div class="candidate-name">
            ${escapeHtml(wine.wine_name)} ${escapeHtml(String(wine.vintage || 'NV'))}
            ${wine.urgency ? `<span class="urgency-badge ${wine.urgency}">${escapeHtml(wine.urgency)}</span>` : ''}
          </div>
          <div class="candidate-reason">${escapeHtml(wine.suggested_reason)}</div>
          <div class="candidate-meta">${wine.bottle_count} bottle${wine.bottle_count > 1 ? 's' : ''} • ${escapeHtml(wine.locations || '')}</div>
        </div>
      </div>
    `).join('');

    container.style.display = 'block';
    showToast(`Found ${result.candidates.length} matching wines`);

  } catch (err) {
    showToast('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Evaluate Now';
  }
}

/**
 * Handle adding selected candidates to reduce-now.
 */
async function handleAddCandidates() {
  const checkboxes = document.querySelectorAll('.candidate-checkbox:checked');
  const wineIds = Array.from(checkboxes).map(cb =>
    parseInt(cb.closest('.reduce-candidate').dataset.wineId, 10)
  );

  if (wineIds.length === 0) {
    showToast('No wines selected');
    return;
  }

  try {
    const result = await batchAddReduceNow(wineIds, 3, 'Auto-suggested');
    showToast(result.message);

    // Hide the candidates container
    document.getElementById('reduce-candidates-container').style.display = 'none';

  } catch (err) {
    showToast('Error: ' + err.message);
  }
}

/**
 * Initialize settings page event listeners.
 */
export function initSettings() {
  // Rating preference slider
  const slider = document.getElementById('rating-preference-slider');
  if (slider) {
    slider.addEventListener('input', () => {
      updatePreferenceDisplay(parseInt(slider.value, 10));
    });

    slider.addEventListener('change', async () => {
      try {
        await updateSetting('rating_preference', slider.value);
        showToast('Preference saved');
      } catch (_err) {
        showToast('Error saving preference');
      }
    });
  }

  // Reduce-now auto rules toggle
  const rulesEnabled = document.getElementById('reduce-auto-rules-enabled');
  if (rulesEnabled) {
    rulesEnabled.addEventListener('change', async () => {
      updateRulesVisibility(rulesEnabled.checked);
      try {
        await updateSetting('reduce_auto_rules_enabled', rulesEnabled.checked ? 'true' : 'false');
      } catch (_err) {
        showToast('Error saving setting');
      }
    });
  }

  // Age threshold
  const ageThreshold = document.getElementById('reduce-age-threshold');
  if (ageThreshold) {
    ageThreshold.addEventListener('change', async () => {
      try {
        await updateSetting('reduce_age_threshold', ageThreshold.value);
      } catch (_err) {
        showToast('Error saving setting');
      }
    });
  }

  // Rating minimum
  const ratingMinimum = document.getElementById('reduce-rating-minimum');
  if (ratingMinimum) {
    ratingMinimum.addEventListener('change', async () => {
      try {
        await updateSetting('reduce_rating_minimum', ratingMinimum.value);
      } catch (_err) {
        showToast('Error saving setting');
      }
    });
  }

  // Urgency months (drinking window setting)
  const urgencyMonths = document.getElementById('reduce-urgency-months');
  if (urgencyMonths) {
    urgencyMonths.addEventListener('change', async () => {
      try {
        await updateSetting('reduce_window_urgency_months', urgencyMonths.value);
      } catch (_err) {
        showToast('Error saving setting');
      }
    });
  }

  // Include wines without window data
  const includeNoWindow = document.getElementById('reduce-include-no-window');
  if (includeNoWindow) {
    includeNoWindow.addEventListener('change', async () => {
      try {
        await updateSetting('reduce_include_no_window', includeNoWindow.checked ? 'true' : 'false');
      } catch (_err) {
        showToast('Error saving setting');
      }
    });
  }

  // Evaluate rules button
  document.getElementById('evaluate-rules-btn')?.addEventListener('click', handleEvaluateRules);

  // Add all candidates button
  document.getElementById('add-all-candidates-btn')?.addEventListener('click', handleAddCandidates);

  // Clear candidates button
  document.getElementById('clear-candidates-btn')?.addEventListener('click', () => {
    document.getElementById('reduce-candidates-container').style.display = 'none';
  });

  // Credential forms
  const sources = ['vivino', 'decanter', 'cellartracker'];
  for (const source of sources) {
    document.getElementById(`${source}-save-btn`)?.addEventListener('click', () => handleSaveCredentials(source));
    document.getElementById(`${source}-test-btn`)?.addEventListener('click', () => handleTestCredentials(source));
    document.getElementById(`${source}-delete-btn`)?.addEventListener('click', () => handleDeleteCredentials(source));
  }
}
