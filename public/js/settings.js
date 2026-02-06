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
  batchAddReduceNow,
  getAwardsCompetitions,
  createAwardsCompetition,
  getAwardsSources,
  importAwardsFromWebpage,
  importAwardsFromPDF,
  importAwardsFromText,
  deleteAwardsSource,
  rematchAwardsSource,
  getBackupInfo,
  exportBackupJSON,
  exportBackupCSV,
  importBackup,
  fetchLayoutLite,
  createStorageArea,
  updateStorageAreaLayout
} from './api.js';
import { showToast, escapeHtml } from './utils.js';
import { startOnboarding } from './onboarding.js';
import { refreshLayout } from './app.js';

// Track current import type
let currentImportType = 'webpage';

// ============================================
// Storage Areas Configuration
// ============================================

/**
 * Initialize storage areas wizard button and listener.
 */
function initStorageAreasWizard() {
  const btn = document.getElementById('configure-storage-areas-btn');
  if (!btn) return;

  btn.addEventListener('click', openStorageAreasWizard);
}

/**
 * Open storage areas configuration wizard.
 * Loads existing layout in lite mode and initializes the onboarding UI.
 */
async function openStorageAreasWizard() {
  const btn = document.getElementById('configure-storage-areas-btn');
  const wizardContainer = document.getElementById('storage-areas-wizard');
  if (!btn || !wizardContainer) return;

  try {
    btn.disabled = true;
    btn.textContent = 'Loading...';

    // Load existing layout in lite mode to prefill areas
    const layout = await fetchLayoutLite();

    // Show wizard container
    wizardContainer.style.display = 'block';

    // Initialize onboarding wizard
    startOnboarding(wizardContainer);

    // Prefill areas if they exist
    if (layout?.areas && layout.areas.length > 0) {
      // Import existing areas into the builder state
      // The builder has its own state that we'll populate
      const { setAreas } = await import('./storageBuilder.js');
      setAreas(layout.areas);
      // Note: After setAreas, the wizard will show the appropriate step
    }

    // Listen for save event
    wizardContainer.addEventListener('onboarding:save', handleStorageAreasSave, { once: true });

  } catch (err) {
    showToast('Error loading configuration: ' + err.message);
    console.error('Wizard error:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Configure Storage Areas';
  }
}

/**
 * Handle storage areas save from onboarding wizard.
 * Persists areas and layout to the backend API.
 * @param {CustomEvent} event
 */
async function handleStorageAreasSave(event) {
  const wizardContainer = document.getElementById('storage-areas-wizard');
  const btn = document.getElementById('configure-storage-areas-btn');
  if (!wizardContainer || !btn) return;

  const { areas } = event.detail;
  if (!Array.isArray(areas) || areas.length === 0) {
    showToast('No areas to save');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    // Create each area and store its ID
    const createdAreas = [];
    for (const area of areas) {
      const areaData = {
        name: area.name,
        storage_type: area.storage_type,
        temp_zone: area.temp_zone,
        display_order: createdAreas.length + 1
      };
      const result = await createStorageArea(areaData);
      const areaId = result.data?.id || result.id;
      if (!areaId) {
        throw new Error(`Failed to create area: ${area.name}`);
      }
      createdAreas.push({ ...area, id: areaId });
    }

    // Update layout for each area
    for (const area of createdAreas) {
      if (Array.isArray(area.rows) && area.rows.length > 0) {
        await updateStorageAreaLayout(area.id, area.rows);
      }
    }

    // Hide wizard and reset
    wizardContainer.style.display = 'none';
    wizardContainer.innerHTML = '';

    // Refresh the cellar grid to show new areas
    await refreshLayout();

    showToast(`Storage configuration saved: ${createdAreas.length} areas created`);

  } catch (err) {
    showToast('Error saving configuration: ' + err.message);
    console.error('Save error:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Configure Storage Areas';

    // Re-attach listener in case user wants to try again
    const container = document.getElementById('storage-areas-wizard');
    if (container) {
      container.addEventListener('onboarding:save', handleStorageAreasSave, { once: true });
    }
  }
}

// ============================================
// Text Size / Display Settings
// ============================================

const TEXT_SIZE_KEY = 'wine-cellar-text-size';
const THEME_KEY = 'wine-cellar-theme';

/**
 * Load and apply saved text size preference.
 * Call this early (e.g., in app.js init) to prevent flash of wrong size.
 */
export function loadTextSize() {
  const saved = localStorage.getItem(TEXT_SIZE_KEY) || 'medium';
  applyTextSize(saved);
  return saved;
}

/**
 * Apply text size to the document.
 * @param {string} size - 'small', 'medium', or 'large'
 */
function applyTextSize(size) {
  document.documentElement.setAttribute('data-text-size', size);
}

/**
 * Initialize text size selector in settings.
 */
function initTextSizeSelector() {
  const radios = document.querySelectorAll('input[name="text-size"]');
  if (radios.length === 0) return;

  // Set the current selection based on saved preference
  const currentSize = localStorage.getItem(TEXT_SIZE_KEY) || 'medium';
  radios.forEach(radio => {
    radio.checked = radio.value === currentSize;
  });

  // Add change listeners
  radios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      const newSize = e.target.value;
      applyTextSize(newSize);
      localStorage.setItem(TEXT_SIZE_KEY, newSize);
      showToast(`Text size set to ${newSize}`);
    });
  });
}

/**
 * Apply theme preference to document and meta tags.
 * @param {string} theme - 'system', 'dark', or 'light'
 */
function applyThemePreference(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    // 'system' — detect and set explicitly for WebView compatibility
    // CSS @media (prefers-color-scheme) can fail in Android PWA standalone mode,
    // so we always set an explicit data-theme attribute.
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  }

  updateThemeMeta();
}

/**
 * Update theme-related meta tags.
 */
function updateThemeMeta() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  // Detect actual theme: explicit attribute or OS preference
  const isDark = currentTheme === 'dark' || (!currentTheme && !window.matchMedia('(prefers-color-scheme: light)').matches);
  const themeColor = isDark ? '#722F37' : '#7A6240';
  const tileColor = isDark ? '#1a1a1a' : '#FAF6F1';

  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
  document.querySelector('meta[name="msapplication-TileColor"]')?.setAttribute('content', tileColor);
}

/**
 * Initialize theme selector in settings.
 */
function initThemeSelector() {
  const radios = document.querySelectorAll('input[name="theme"]');
  if (radios.length === 0) return;

  const savedTheme = localStorage.getItem(THEME_KEY) || 'system';
  radios.forEach((radio) => {
    radio.checked = radio.value === savedTheme;
  });

  applyThemePreference(savedTheme);
  updateSystemThemeIndicator();
  updateThemeStatusHint();

  // Listen for OS theme changes when in "system" mode
  const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  systemThemeQuery.addEventListener('change', () => {
    const currentSetting = localStorage.getItem(THEME_KEY) || 'system';
    if (currentSetting === 'system') {
      applyThemePreference('system');
    }
    updateSystemThemeIndicator();
    updateThemeStatusHint();
  });

  radios.forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const newTheme = e.target.value;
      localStorage.setItem(THEME_KEY, newTheme);
      applyThemePreference(newTheme);
      updateThemeStatusHint();
      showToast(`Theme set to ${newTheme}`);
    });
  });
}

/**
 * Update the system theme indicator to show current OS preference.
 */
function updateSystemThemeIndicator() {
  const indicator = document.getElementById('system-theme-indicator');
  if (!indicator) return;

  const systemIsDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  indicator.textContent = systemIsDark ? 'Device: Dark' : 'Device: Light';
}

/**
 * Update hint text to show if user's choice differs from system preference.
 */
function updateThemeStatusHint() {
  const hint = document.getElementById('theme-status-hint');
  if (!hint) return;

  const savedTheme = localStorage.getItem(THEME_KEY) || 'system';
  const systemIsDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const systemThemeName = systemIsDark ? 'dark' : 'light';

  if (savedTheme === 'system') {
    hint.textContent = `App follows your device theme (currently ${systemThemeName}).`;
    hint.className = 'form-hint';
  } else if (savedTheme !== systemThemeName) {
    hint.textContent = `💡 Your device is in ${systemThemeName} mode. Select "System" above to follow device theme changes automatically.`;
    hint.className = 'form-hint theme-mismatch-hint';
  } else {
    hint.textContent = `App uses ${savedTheme} theme (matches device preference).`;
    hint.className = 'form-hint';
  }
}

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

    // Load storage conditions settings
    loadStorageSettings(settings);

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
    // Note: CellarTracker removed - their API only searches user's personal cellar
    const sources = ['vivino', 'decanter'];
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
  // Initialize display settings (text size)
  initTextSizeSelector();

  // Initialize theme selector
  initThemeSelector();

  // Initialize storage areas wizard
  initStorageAreasWizard();

  // Initialize backup section
  initBackupSection();

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

  // Storage conditions settings
  initStorageSettings();

  // Evaluate rules button
  document.getElementById('evaluate-rules-btn')?.addEventListener('click', handleEvaluateRules);

  // Add all candidates button
  document.getElementById('add-all-candidates-btn')?.addEventListener('click', handleAddCandidates);

  // Clear candidates button
  document.getElementById('clear-candidates-btn')?.addEventListener('click', () => {
    document.getElementById('reduce-candidates-container').style.display = 'none';
  });

  // Credential forms
  // Note: CellarTracker removed - their API only searches user's personal cellar
  const sources = ['vivino', 'decanter'];
  for (const source of sources) {
    document.getElementById(`${source}-save-btn`)?.addEventListener('click', () => handleSaveCredentials(source));
    document.getElementById(`${source}-test-btn`)?.addEventListener('click', () => handleTestCredentials(source));
    document.getElementById(`${source}-delete-btn`)?.addEventListener('click', () => handleDeleteCredentials(source));
  }

  // Awards Database
  initAwardsSection();
}

// ============================================
// Storage Conditions Settings
// ============================================

/**
 * Initialize storage conditions settings event listeners.
 */
function initStorageSettings() {
  // Storage adjustment enabled toggle
  const storageEnabled = document.getElementById('storage-adjustment-enabled');
  if (storageEnabled) {
    storageEnabled.addEventListener('change', async () => {
      updateStorageVisibility(storageEnabled.checked);
      try {
        await updateSetting('storage_adjustment_enabled', storageEnabled.checked ? 'true' : 'false');
        showToast(storageEnabled.checked ? 'Storage adjustment enabled' : 'Storage adjustment disabled');
      } catch (_err) {
        showToast('Error saving setting');
      }
    });
  }

  // Temperature bucket selector
  const tempBucket = document.getElementById('storage-temp-bucket');
  if (tempBucket) {
    tempBucket.addEventListener('change', async () => {
      try {
        await updateSetting('storage_temp_bucket', tempBucket.value);
        updateTempDescription(tempBucket.value);
        showToast('Storage temperature updated');
      } catch (_err) {
        showToast('Error saving setting');
      }
    });
  }

  // Heat risk checkbox
  const heatRisk = document.getElementById('storage-heat-risk');
  if (heatRisk) {
    heatRisk.addEventListener('change', async () => {
      try {
        await updateSetting('storage_heat_risk', heatRisk.checked ? 'true' : 'false');
      } catch (_err) {
        showToast('Error saving setting');
      }
    });
  }
}

/**
 * Load storage settings into UI.
 * @param {object} settings - Settings object from API
 */
function loadStorageSettings(settings) {
  const storageEnabled = document.getElementById('storage-adjustment-enabled');
  if (storageEnabled) {
    storageEnabled.checked = settings.storage_adjustment_enabled === 'true';
    updateStorageVisibility(storageEnabled.checked);
  }

  const tempBucket = document.getElementById('storage-temp-bucket');
  if (tempBucket && settings.storage_temp_bucket) {
    tempBucket.value = settings.storage_temp_bucket;
    updateTempDescription(settings.storage_temp_bucket);
  }

  const heatRisk = document.getElementById('storage-heat-risk');
  if (heatRisk) {
    heatRisk.checked = settings.storage_heat_risk === 'true';
  }
}

/**
 * Update visibility of storage options based on enabled state.
 * @param {boolean} enabled
 */
function updateStorageVisibility(enabled) {
  const container = document.getElementById('storage-options-container');
  if (container) {
    container.style.opacity = enabled ? '1' : '0.5';
    container.querySelectorAll('select, input').forEach(el => {
      el.disabled = !enabled;
    });
  }
}

/**
 * Update temperature bucket description text.
 * @param {string} bucket - Temperature bucket value
 */
function updateTempDescription(bucket) {
  const descriptions = {
    'cool': '10-15°C - Ideal cellar conditions, no window adjustment',
    'moderate': '15-20°C - Typical home storage, 10% window reduction',
    'warm': '20-24°C - Warm room, 20% window reduction',
    'hot': '24°C+ - Garage or hot climate, 30% window reduction'
  };

  const desc = document.getElementById('storage-temp-description');
  if (desc) {
    desc.textContent = descriptions[bucket] || '';
  }
}

// ============================================
// Awards Database Functions
// ============================================

/**
 * Initialize awards section.
 */
async function initAwardsSection() {
  // Load competitions dropdown
  await loadCompetitionsDropdown();

  // Load existing sources
  await loadAwardsSources();

  // Import type tabs
  document.querySelectorAll('.import-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.import-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentImportType = tab.dataset.importType;
      updateImportInputVisibility();
    });
  });

  // Import button
  document.getElementById('import-awards-btn')?.addEventListener('click', handleImportAwards);

  // Set default year to current year
  const yearInput = document.getElementById('awards-year');
  if (yearInput && !yearInput.value) {
    yearInput.value = new Date().getFullYear();
  }

  // PDF file selection - show selected files and auto-detect years
  const pdfInput = document.getElementById('awards-pdf');
  if (pdfInput) {
    pdfInput.addEventListener('change', updatePdfFilesList);
  }
}

/**
 * Extract year from filename (e.g., "VERITAS 2024.pdf" -> 2024)
 * @param {string} filename
 * @returns {number|null}
 */
function extractYearFromFilename(filename) {
  const match = filename.match(/\b(20\d{2})\b/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Update PDF files list display.
 */
function updatePdfFilesList() {
  const fileInput = document.getElementById('awards-pdf');
  const listContainer = document.getElementById('pdf-files-list');
  const yearInput = document.getElementById('awards-year');

  if (!fileInput || !listContainer) return;

  const files = Array.from(fileInput.files || []);

  if (files.length === 0) {
    listContainer.innerHTML = '';
    return;
  }

  // If single file, auto-detect year and fill in the year field
  if (files.length === 1) {
    const detectedYear = extractYearFromFilename(files[0].name);
    if (detectedYear && yearInput) {
      yearInput.value = detectedYear;
    }
    listContainer.innerHTML = '';
    return;
  }

  // Multiple files - show list with detected years
  listContainer.innerHTML = `
    <div class="pdf-files-header">Selected ${files.length} files (year field ignored for multi-file import):</div>
    ${files.map((file) => {
      const detectedYear = extractYearFromFilename(file.name);
      return `
        <div class="pdf-file-item">
          <span class="pdf-file-name">${escapeHtml(file.name)}</span>
          <span class="pdf-file-year ${detectedYear ? 'detected' : 'missing'}">
            ${detectedYear ? `Year: ${detectedYear}` : 'No year detected - will use form year'}
          </span>
        </div>
      `;
    }).join('')}
  `;
}

/**
 * Load competitions into dropdown.
 */
async function loadCompetitionsDropdown() {
  try {
    const result = await getAwardsCompetitions();
    const select = document.getElementById('awards-competition');
    if (!select) return;

    select.innerHTML = '<option value="">Select competition...</option>';

    for (const comp of result.data || []) {
      const option = document.createElement('option');
      option.value = comp.id;
      option.textContent = `${comp.name}${comp.country ? ` (${comp.country})` : ''}`;
      select.appendChild(option);
    }

    // Add custom option
    const customOption = document.createElement('option');
    customOption.value = '_custom';
    customOption.textContent = '+ Add custom competition...';
    select.appendChild(customOption);

    // Handle custom competition selection
    select.addEventListener('change', () => {
      const customField = document.getElementById('custom-competition-field');
      if (customField) {
        customField.style.display = select.value === '_custom' ? 'block' : 'none';
      }
    });

  } catch (err) {
    console.error('Failed to load competitions:', err);
  }
}

/**
 * Update import input visibility based on selected type.
 */
function updateImportInputVisibility() {
  document.getElementById('import-webpage-input').style.display =
    currentImportType === 'webpage' ? 'block' : 'none';
  document.getElementById('import-pdf-input').style.display =
    currentImportType === 'pdf' ? 'block' : 'none';
  document.getElementById('import-text-input').style.display =
    currentImportType === 'text' ? 'block' : 'none';
}

/**
 * Handle import awards button.
 */
async function handleImportAwards() {
  let competitionId = document.getElementById('awards-competition').value;
  const year = Number.parseInt(document.getElementById('awards-year').value, 10);

  // Handle custom competition
  if (competitionId === '_custom') {
    const customName = document.getElementById('custom-competition-name').value.trim();
    if (!customName) {
      showToast('Please enter a competition name');
      return;
    }
    // Create a slug from the name
    competitionId = customName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    // Add the custom competition via API
    try {
      await createAwardsCompetition({ name: customName, id: competitionId });
      // Reload competitions dropdown
      await loadCompetitionsDropdown();
    } catch (err) {
      showToast('Failed to add competition: ' + err.message);
      return;
    }
  }

  if (!competitionId) {
    showToast('Please select a competition');
    return;
  }

  if (!year || year < 2000 || year > 2030) {
    showToast('Please enter a valid year');
    return;
  }

  const progress = document.getElementById('import-progress');
  const btn = document.getElementById('import-awards-btn');

  progress.style.display = 'flex';
  btn.disabled = true;

  try {
    let result;

    if (currentImportType === 'webpage') {
      const url = document.getElementById('awards-url').value.trim();
      if (!url) {
        showToast('Please enter a URL');
        return;
      }
      result = await importAwardsFromWebpage(url, competitionId, year);

    } else if (currentImportType === 'pdf') {
      const fileInput = document.getElementById('awards-pdf');
      if (!fileInput.files || fileInput.files.length === 0) {
        showToast('Please select a PDF file');
        return;
      }

      const files = Array.from(fileInput.files);

      if (files.length === 1) {
        // Single file - use form year or auto-detect
        const detectedYear = extractYearFromFilename(files[0].name);
        const fileYear = detectedYear || year;
        result = await importAwardsFromPDF(files[0], competitionId, fileYear);
      } else {
        // Multiple files - process each with auto-detected year
        let totalImported = 0;
        let totalMatches = 0;
        const errors = [];

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const fileYear = extractYearFromFilename(file.name) || year;

          progress.querySelector('span').textContent = `Processing ${i + 1}/${files.length}: ${file.name}`;

          try {
            const fileResult = await importAwardsFromPDF(file, competitionId, fileYear);
            totalImported += fileResult.imported || 0;
            totalMatches += fileResult.matches?.exactMatches || 0;
          } catch (err) {
            errors.push(`${file.name}: ${err.message}`);
          }
        }

        result = {
          imported: totalImported,
          matches: { exactMatches: totalMatches },
          errors: errors.length > 0 ? errors : undefined
        };

        if (errors.length > 0) {
          console.warn('Some files failed to import:', errors);
        }
      }

    } else if (currentImportType === 'text') {
      const text = document.getElementById('awards-text').value.trim();
      if (!text) {
        showToast('Please paste text content');
        return;
      }
      result = await importAwardsFromText(text, competitionId, year, 'manual');
    }

    // Show result
    if (result.imported > 0) {
      showToast(`Imported ${result.imported} awards, ${result.matches?.exactMatches || 0} matched to cellar`);
    } else if (result.hint === 'dynamic_content') {
      // Page loads dynamically - show longer message
      showToast(result.message, 8000);
    } else {
      showToast(result.message || 'No awards found');
    }

    // Refresh sources list
    await loadAwardsSources();

    // Clear inputs
    document.getElementById('awards-url').value = '';
    document.getElementById('awards-text').value = '';
    const fileInput = document.getElementById('awards-pdf');
    if (fileInput) fileInput.value = '';

  } catch (err) {
    showToast('Error: ' + err.message);
  } finally {
    progress.style.display = 'none';
    btn.disabled = false;
  }
}

/**
 * Load and display award sources.
 */
async function loadAwardsSources() {
  try {
    const result = await getAwardsSources();
    const container = document.getElementById('awards-sources-list');
    const batchActions = document.getElementById('awards-batch-actions');
    if (!container) return;

    if (!result.data || result.data.length === 0) {
      container.innerHTML = '<p class="no-data">No awards imported yet</p>';
      if (batchActions) batchActions.style.display = 'none';
      return;
    }

    // Show batch actions
    if (batchActions) batchActions.style.display = 'flex';

    // Render compact list with checkboxes
    container.innerHTML = result.data.map(source => {
      const importDate = new Date(source.imported_at).toLocaleDateString('en-GB', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric' 
      });
      
      return `
        <div class="awards-source-item-compact" data-source-id="${escapeHtml(source.id)}">
          <input type="checkbox" class="source-checkbox" id="source-${source.id}" data-source-id="${source.id}">
          <label for="source-${source.id}" class="source-label">
            <div class="source-info">
              <span class="source-name">${escapeHtml(source.competition_name)} ${source.year}</span>
              <span class="source-meta">${escapeHtml(source.source_type)} • ${source.award_count} awards • ${importDate}</span>
            </div>
          </label>
        </div>
      `;
    }).join('');

    // Add event listeners to checkboxes
    updateBatchActionState();
    container.querySelectorAll('.source-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', updateBatchActionState);
    });

    // Initialize batch action buttons (only once)
    initBatchActions();

  } catch (err) {
    console.error('Failed to load award sources:', err);
  }
}

/**
 * Update batch action button states based on selection.
 */
function updateBatchActionState() {
  const checkboxes = document.querySelectorAll('.source-checkbox');
  const checkedBoxes = Array.from(checkboxes).filter(cb => cb.checked);
  const count = checkedBoxes.length;

  const rematchBtn = document.getElementById('awards-rematch-selected-btn');
  const deleteBtn = document.getElementById('awards-delete-selected-btn');
  const countSpan = document.getElementById('awards-selection-count');

  if (rematchBtn) rematchBtn.disabled = count === 0;
  if (deleteBtn) deleteBtn.disabled = count === 0;
  if (countSpan) countSpan.textContent = `${count} selected`;
}

/**
 * Initialize batch action buttons (only once).
 */
let batchActionsInitialized = false;
function initBatchActions() {
  if (batchActionsInitialized) return;
  batchActionsInitialized = true;

  const rematchBtn = document.getElementById('awards-rematch-selected-btn');
  const deleteBtn = document.getElementById('awards-delete-selected-btn');

  if (rematchBtn) {
    rematchBtn.addEventListener('click', async () => {
      const selected = getSelectedSourceIds();
      if (selected.length === 0) return;

      rematchBtn.disabled = true;
      rematchBtn.innerHTML = '<span>⏳</span> Matching...';

      try {
        let totalExact = 0;
        let totalFuzzy = 0;

        for (const sourceId of selected) {
          const result = await rematchAwardsSource(sourceId);
          totalExact += result.exactMatches || 0;
          totalFuzzy += result.fuzzyMatches || 0;
        }

        showToast(`Matched ${totalExact} wines exactly, ${totalFuzzy} fuzzy`);
        await loadAwardsSources();
      } catch (err) {
        showToast('Error: ' + err.message);
      } finally {
        rematchBtn.disabled = false;
        rematchBtn.innerHTML = '<span>🔄</span> Re-match Selected';
      }
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const selected = getSelectedSourceIds();
      if (selected.length === 0) return;

      const plural = selected.length > 1 ? 's' : '';
      if (!confirm(`Delete ${selected.length} award source${plural} and all their awards?`)) {
        return;
      }

      deleteBtn.disabled = true;
      deleteBtn.innerHTML = '<span>⏳</span> Deleting...';

      try {
        for (const sourceId of selected) {
          await deleteAwardsSource(sourceId);
        }
        showToast(`${selected.length} source${plural} deleted`);
        await loadAwardsSources();
      } catch (err) {
        showToast('Error: ' + err.message);
      } finally {
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = '<span>🗑️</span> Delete Selected';
      }
    });
  }
}

/**
 * Get selected source IDs from checkboxes.
 */
function getSelectedSourceIds() {
  const checkboxes = document.querySelectorAll('.source-checkbox:checked');
  return Array.from(checkboxes).map(cb => cb.dataset.sourceId);
}

// ============================================
// Backup & Export Functions
// ============================================

/**
 * Initialize backup section.
 */
function initBackupSection() {
  // Export JSON button
  document.getElementById('export-json-btn')?.addEventListener('click', handleExportJSON);

  // Export CSV button
  document.getElementById('export-csv-btn')?.addEventListener('click', handleExportCSV);

  // Import file input
  const importInput = document.getElementById('import-backup-file');
  if (importInput) {
    importInput.addEventListener('change', handleImportFileSelect);
  }

  // Import button
  document.getElementById('import-backup-btn')?.addEventListener('click', handleImportBackup);

  // Load backup info on settings view
  loadBackupInfo();
}

/**
 * Load backup metadata.
 */
async function loadBackupInfo() {
  try {
    const info = await getBackupInfo();

    const winesCount = document.getElementById('backup-wines-count');
    const bottlesCount = document.getElementById('backup-bottles-count');
    const historyCount = document.getElementById('backup-history-count');

    if (winesCount) winesCount.textContent = info.wines || 0;
    if (bottlesCount) bottlesCount.textContent = info.slots || 0;
    if (historyCount) historyCount.textContent = info.history || 0;

  } catch (err) {
    console.error('Failed to load backup info:', err);
  }
}

/**
 * Handle JSON export.
 */
async function handleExportJSON() {
  try {
    showToast('Preparing backup...');
    await exportBackupJSON();
    showToast('Backup downloaded');
  } catch (err) {
    console.error('JSON export failed:', err);
    showToast('Export failed: ' + err.message);
  }
}

/**
 * Handle CSV export.
 */
async function handleExportCSV() {
  try {
    showToast('Preparing CSV...');
    await exportBackupCSV();
    showToast('CSV downloaded');
  } catch (err) {
    console.error('CSV export failed:', err);
    showToast('Export failed: ' + err.message);
  }
}

/**
 * Handle import file selection.
 * @param {Event} e - Change event
 */
function handleImportFileSelect(e) {
  const file = e.target.files?.[0];
  const fileInfo = document.getElementById('import-file-info');
  const importBtn = document.getElementById('import-backup-btn');

  if (file && fileInfo) {
    fileInfo.textContent = `Selected: ${file.name} (${formatBytes(file.size)})`;
    fileInfo.style.display = 'block';
    if (importBtn) importBtn.disabled = false;
  } else if (fileInfo) {
    fileInfo.style.display = 'none';
    if (importBtn) importBtn.disabled = true;
  }
}

/**
 * Format bytes for display.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Handle import backup.
 */
async function handleImportBackup() {
  const fileInput = document.getElementById('import-backup-file');
  const file = fileInput?.files?.[0];

  if (!file) {
    showToast('Please select a backup file');
    return;
  }

  // Confirm before import
  const mergeMode = document.getElementById('import-merge-mode')?.value || 'replace';
  const modeText = mergeMode === 'replace' ? 'REPLACE all existing data' : 'merge with existing data';

  if (!confirm(`This will ${modeText}. Continue?`)) {
    return;
  }

  const importBtn = document.getElementById('import-backup-btn');
  if (importBtn) {
    importBtn.disabled = true;
    importBtn.textContent = 'Importing...';
  }

  try {
    // Read the file
    const text = await file.text();
    const backup = JSON.parse(text);

    // Validate backup format
    if (!backup.version || !backup.data) {
      throw new Error('Invalid backup format');
    }

    // Send to API
    const result = await importBackup(backup, { mergeMode });

    showToast(`Imported ${result.stats.winesImported} wines`);

    if (result.stats.errors > 0) {
      console.warn('Import errors:', result.stats.errorDetails);
    }

    // Refresh backup info
    await loadBackupInfo();

    // Clear the file input
    if (fileInput) fileInput.value = '';
    const fileInfo = document.getElementById('import-file-info');
    if (fileInfo) fileInfo.style.display = 'none';

  } catch (err) {
    showToast('Error: ' + err.message);
  } finally {
    if (importBtn) {
      importBtn.disabled = true;
      importBtn.textContent = 'Import';
    }
  }
}
