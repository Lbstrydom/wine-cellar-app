/**
 * @fileoverview Recipes view entry point. Lazy-loaded on tab switch.
 * Renders Recipe Library with profile summary, import section, and recipe detail.
 * @module recipes
 */

import { recipeState, loadPersistedState } from './recipes/state.js';
import { renderImportSection } from './recipes/recipeImport.js';
import { renderRecipeLibrary } from './recipes/recipeLibrary.js';
import { renderRecipeDetail } from './recipes/recipeDetail.js';
import { showRecipeForm } from './recipes/recipeForm.js';
import { renderProfileSummary } from './recipes/profileSummary.js';
import { renderCategoryOverrides } from './recipes/categoryOverrides.js';
import { renderMenuBuilder } from './recipes/menuBuilder.js';
import { renderBuyingGuide } from './recipes/buyingGuide.js';
import { menuState, loadMenuState } from './recipes/menuState.js';
import { listRecipes, getCookingProfile } from './api/recipes.js';

let initialized = false;

/**
 * Initialize the Recipes view.
 * Called once when the tab is first selected.
 */
export async function initRecipes() {
  if (initialized) return;
  initialized = true;
  loadPersistedState();
  loadMenuState();
}

/**
 * Load/refresh the Recipes view content.
 * Called each time the tab is selected.
 */
export async function loadRecipes() {
  const container = document.getElementById('view-recipes');
  if (!container) return;

  await initRecipes();

  // Check if we have any recipes
  let hasRecipes = false;
  try {
    const result = await listRecipes({ limit: 1 });
    hasRecipes = (result.total || 0) > 0;
  } catch { /* ignore */ }

  if (hasRecipes) {
    renderLibraryView(container);
  } else {
    renderFirstRunView(container);
  }
}

/**
 * Render the first-run / empty state view with hero import card.
 * @param {HTMLElement} container - View container
 */
function renderFirstRunView(container) {
  container.innerHTML = `
    <div class="recipes-view">
      <div class="recipes-hero">
        <h2>Add Your Recipes</h2>
        <p>Import your recipes to get personalised wine pairing suggestions and buying advice.</p>
      </div>
      <div id="recipe-import-section"></div>
      <div class="recipes-hero-manual">
        <button class="btn btn-secondary" id="add-recipe-manual-btn">Or add a recipe manually</button>
      </div>
    </div>
  `;

  renderImportSection(container.querySelector('#recipe-import-section'), () => {
    // After successful import, switch to library view
    renderLibraryView(container);
  });

  container.querySelector('#add-recipe-manual-btn')?.addEventListener('click', () => {
    showRecipeForm(null, () => renderLibraryView(container));
  });
}

/**
 * Render the full library view (profile + filters + grid + import toggle + menu builder).
 * @param {HTMLElement} container - View container
 */
function renderLibraryView(container) {
  container.innerHTML = `
    <div class="recipes-view">
      <div class="recipes-toolbar">
        <h2>Recipe Library</h2>
        <div class="recipes-toolbar-actions">
          <button class="btn btn-small btn-secondary" id="toggle-menu-btn">Menu Builder${menuState.selectedIds.length > 0 ? ' (' + menuState.selectedIds.length + ')' : ''}</button>
          <button class="btn btn-small btn-secondary" id="toggle-import-btn">Import</button>
          <button class="btn btn-small btn-primary" id="add-recipe-btn">+ Add Recipe</button>
        </div>
      </div>
      <div id="recipe-profile-section"></div>
      <div id="recipe-buying-guide-section"></div>
      <div id="recipe-overrides-section" style="display: none;"></div>
      <div id="recipe-menu-builder" style="display: none;"></div>
      <div id="recipe-import-section" style="display: none;"></div>
      <div id="recipe-library-section"></div>
    </div>
  `;

  // Render profile summary (non-blocking)
  const overridesClickHandler = async () => {
    const overridesSection = container.querySelector('#recipe-overrides-section');
    if (!overridesSection) return;

    overridesSection.style.display = 'block';

    // Fetch current overrides from cached profile
    let currentOverrides = {};
    try {
      const profileResult = await getCookingProfile();
      const breakdown = profileResult.data?.categoryBreakdown || {};
      for (const [cat, data] of Object.entries(breakdown)) {
        if (data.userOverride !== null && data.userOverride !== undefined) {
          currentOverrides[cat] = data.userOverride;
        }
      }
    } catch { /* proceed with empty overrides */ }

    renderCategoryOverrides(overridesSection, currentOverrides, () => {
      overridesSection.style.display = 'none';
      // Refresh profile and buying guide after overrides saved
      renderProfileSummary(container.querySelector('#recipe-profile-section'), {
        onOverridesClick: overridesClickHandler
      });
      renderBuyingGuide(container.querySelector('#recipe-buying-guide-section'));
    });
  };

  renderProfileSummary(
    container.querySelector('#recipe-profile-section'),
    { onOverridesClick: overridesClickHandler }
  );

  // Render buying guide (non-blocking)
  renderBuyingGuide(container.querySelector('#recipe-buying-guide-section'));

  // Wire up toolbar buttons
  container.querySelector('#toggle-import-btn')?.addEventListener('click', () => {
    const importSection = container.querySelector('#recipe-import-section');
    const isHidden = importSection.style.display === 'none';
    importSection.style.display = isHidden ? 'block' : 'none';
    if (isHidden && !importSection.hasChildNodes()) {
      renderImportSection(importSection, () => {
        importSection.style.display = 'none';
        refreshLibrary(container);
      });
    }
  });

  container.querySelector('#toggle-menu-btn')?.addEventListener('click', () => {
    const menuSection = container.querySelector('#recipe-menu-builder');
    const isHidden = menuSection.style.display === 'none';
    menuSection.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
      renderMenuBuilder(menuSection, () => {
        menuSection.style.display = 'none';
      });
    }
  });

  container.querySelector('#add-recipe-btn')?.addEventListener('click', () => {
    showRecipeForm(null, () => refreshLibrary(container));
  });

  // Render library
  renderRecipeLibrary(
    container.querySelector('#recipe-library-section'),
    (id) => showRecipeDetail(container, id)
  );
}

/**
 * Refresh the recipe library grid, profile summary, and buying guide after mutations.
 * @param {HTMLElement} container - View container
 */
function refreshLibrary(container) {
  renderRecipeLibrary(
    container.querySelector('#recipe-library-section'),
    (id) => showRecipeDetail(container, id)
  );

  // Re-render profile and buying guide (non-blocking, profile may have changed)
  const profileEl = container.querySelector('#recipe-profile-section');
  if (profileEl) {
    renderProfileSummary(profileEl, {
      onOverridesClick: () => renderLibraryView(container)
    });
  }

  const guideEl = container.querySelector('#recipe-buying-guide-section');
  if (guideEl) {
    renderBuyingGuide(guideEl);
  }
}

/**
 * Show recipe detail view (replaces library).
 * @param {HTMLElement} container - View container
 * @param {number} recipeId - Recipe ID
 */
function showRecipeDetail(container, recipeId) {
  container.innerHTML = '<div class="recipes-view" id="recipe-detail-container"></div>';
  renderRecipeDetail(
    container.querySelector('#recipe-detail-container'),
    recipeId,
    () => renderLibraryView(container)
  );
}
