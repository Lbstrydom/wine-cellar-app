/**
 * @fileoverview Multi-source recipe import UI.
 * @module recipes/recipeImport
 */

import {
  importPaprikaFile, importRecipeSageFile, importCsvFile, importRecipeFromUrl
} from '../api/recipes.js';
import { showToast } from '../utils.js';
import { recipeState } from './state.js';

/**
 * Render the import section inside a container.
 * @param {HTMLElement} container - Parent element
 * @param {Function} onImportComplete - Callback after successful import
 */
export function renderImportSection(container, onImportComplete) {
  container.innerHTML = `
    <div class="recipe-import">
      <h3>Import Recipes</h3>
      <div class="import-tabs">
        <button class="import-tab active" data-import="paprika">Paprika</button>
        <button class="import-tab" data-import="recipesage">RecipeSage</button>
        <button class="import-tab" data-import="csv">CSV</button>
        <button class="import-tab" data-import="url">From URL</button>
      </div>

      <div class="import-panel" id="import-paprika">
        <p>Upload your <code>.paprikarecipes</code> export file.</p>
        <input type="file" id="paprika-file" accept=".paprikarecipes,.zip" />
        <button class="btn btn-primary import-btn" id="import-paprika-btn" disabled>Import Paprika File</button>
      </div>

      <div class="import-panel" id="import-recipesage" style="display: none;">
        <p>Upload your RecipeSage JSON-LD export file.</p>
        <input type="file" id="recipesage-file" accept=".json" />
        <button class="btn btn-primary import-btn" id="import-recipesage-btn" disabled>Import RecipeSage File</button>
      </div>

      <div class="import-panel" id="import-csv" style="display: none;">
        <p>Upload a CSV file with columns: name, ingredients, categories, rating.</p>
        <input type="file" id="csv-file" accept=".csv,.txt" />
        <button class="btn btn-primary import-btn" id="import-csv-btn" disabled>Import CSV</button>
      </div>

      <div class="import-panel" id="import-url" style="display: none;">
        <p>Paste a recipe URL to import via structured data (JSON-LD).</p>
        <input type="url" id="recipe-url-input" placeholder="https://www.example.com/recipe/..." />
        <button class="btn btn-primary import-btn" id="import-url-btn">Import from URL</button>
      </div>

      <div class="import-progress" id="import-progress" style="display: none;">
        <div class="progress-spinner"></div>
        <span id="import-progress-text">Importing...</span>
      </div>
    </div>
  `;

  // Tab switching
  container.querySelectorAll('.import-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.import-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      container.querySelectorAll('.import-panel').forEach(p => { p.style.display = 'none'; });
      const panel = container.querySelector(`#import-${tab.dataset.import}`);
      if (panel) panel.style.display = 'block';
    });
  });

  // File input enable buttons
  container.querySelector('#paprika-file')?.addEventListener('change', (e) => {
    container.querySelector('#import-paprika-btn').disabled = !e.target.files.length;
  });
  container.querySelector('#recipesage-file')?.addEventListener('change', (e) => {
    container.querySelector('#import-recipesage-btn').disabled = !e.target.files.length;
  });
  container.querySelector('#csv-file')?.addEventListener('change', (e) => {
    container.querySelector('#import-csv-btn').disabled = !e.target.files.length;
  });

  // Import handlers
  container.querySelector('#import-paprika-btn')?.addEventListener('click', async () => {
    const file = container.querySelector('#paprika-file').files[0];
    if (!file) return;
    await doImport(() => importPaprikaFile(file), onImportComplete, container);
  });

  container.querySelector('#import-recipesage-btn')?.addEventListener('click', async () => {
    const file = container.querySelector('#recipesage-file').files[0];
    if (!file) return;
    await doImport(() => importRecipeSageFile(file), onImportComplete, container);
  });

  container.querySelector('#import-csv-btn')?.addEventListener('click', async () => {
    const file = container.querySelector('#csv-file').files[0];
    if (!file) return;
    await doImport(() => importCsvFile(file), onImportComplete, container);
  });

  container.querySelector('#import-url-btn')?.addEventListener('click', async () => {
    const url = container.querySelector('#recipe-url-input').value.trim();
    if (!url) {
      showToast('Please enter a URL');
      return;
    }
    await doImport(() => importRecipeFromUrl(url), onImportComplete, container);
  });
}

/**
 * Execute an import with progress UI.
 * @param {Function} importFn - Import function returning Promise
 * @param {Function} onComplete - Callback
 * @param {HTMLElement} container - Container element
 */
async function doImport(importFn, onComplete, container) {
  const progress = container.querySelector('#import-progress');
  const progressText = container.querySelector('#import-progress-text');

  recipeState.importInProgress = true;
  if (progress) progress.style.display = 'flex';
  if (progressText) progressText.textContent = 'Importing...';

  // Disable all import buttons
  container.querySelectorAll('.import-btn').forEach(b => { b.disabled = true; });

  try {
    const result = await importFn();
    const msg = result.message || `Added ${result.added || 0}, updated ${result.updated || 0}`;
    showToast(msg);
    if (onComplete) onComplete(result);
  } catch (err) {
    showToast('Import error: ' + err.message);
  } finally {
    recipeState.importInProgress = false;
    if (progress) progress.style.display = 'none';
    container.querySelectorAll('.import-btn').forEach(b => { b.disabled = false; });
  }
}
