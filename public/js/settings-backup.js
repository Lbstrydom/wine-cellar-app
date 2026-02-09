/**
 * @fileoverview Backup & export section for settings page.
 * Extracted from settings.js for single-responsibility.
 * @module settings-backup
 */

import { getBackupInfo, exportBackupJSON, exportBackupCSV, importBackup } from './api.js';
import { showToast } from './utils.js';

/**
 * Initialize backup section.
 */
export function initBackupSection() {
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
