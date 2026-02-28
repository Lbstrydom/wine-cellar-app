/**
 * @fileoverview Searchable/filterable recipe card grid.
 * @module recipes/recipeLibrary
 */

import { listRecipes, getRecipeCategories, deleteRecipe, getRecipeSyncStatus, triggerRecipeSync } from '../api/recipes.js';
import { showToast, escapeHtml } from '../utils.js';
import { recipeState, persistState } from './state.js';
import { toggleMenuRecipe, isInMenu } from './menuState.js';
import { switchView } from '../app.js';

/**
 * Render the recipe library inside a container.
 * @param {HTMLElement} container - Parent element
 * @param {Function} onRecipeClick - Callback when a recipe card is clicked
 */
export async function renderRecipeLibrary(container, onRecipeClick) {
  // Build filter bar
  const filterHtml = `
    <div class="recipe-filters">
      <input type="search" id="recipe-search" class="recipe-search"
             placeholder="Search recipes..." value="${escapeHtml(recipeState.searchQuery)}" />
      <select id="recipe-category-filter" class="recipe-filter-select">
        <option value="">All Categories</option>
      </select>
      <select id="recipe-rating-filter" class="recipe-filter-select">
        <option value="">Any Rating</option>
        <option value="5" ${recipeState.ratingFilter === 5 ? 'selected' : ''}>5 Stars</option>
        <option value="4" ${recipeState.ratingFilter === 4 ? 'selected' : ''}>4+ Stars</option>
        <option value="3" ${recipeState.ratingFilter === 3 ? 'selected' : ''}>3+ Stars</option>
      </select>
      <span class="recipe-count" id="recipe-count"></span>
    </div>
    <div class="recipe-sync-banner" id="recipe-sync-banner"></div>
    <div class="recipe-grid" id="recipe-grid"></div>
    <div class="recipe-pagination" id="recipe-pagination"></div>
  `;

  container.innerHTML = filterHtml;

  // Load sync status banners in background
  loadSyncBanners(container.querySelector('#recipe-sync-banner'));

  // Load categories for filter dropdown
  try {
    const catResult = await getRecipeCategories();
    recipeState.categories = catResult.data || [];
    const select = container.querySelector('#recipe-category-filter');
    for (const cat of recipeState.categories) {
      const opt = document.createElement('option');
      opt.value = cat.category;
      opt.textContent = `${cat.category} (${cat.count})`;
      if (cat.category === recipeState.categoryFilter) opt.selected = true;
      select.appendChild(opt);
    }
  } catch { /* ignore */ }

  // Wire up filter events
  const searchInput = container.querySelector('#recipe-search');
  let searchTimeout;
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      recipeState.searchQuery = searchInput.value;
      recipeState.currentPage = 1;
      persistState();
      loadAndRenderRecipes(container, onRecipeClick);
    }, 300);
  });

  container.querySelector('#recipe-category-filter')?.addEventListener('change', (e) => {
    recipeState.categoryFilter = e.target.value;
    recipeState.currentPage = 1;
    persistState();
    loadAndRenderRecipes(container, onRecipeClick);
  });

  container.querySelector('#recipe-rating-filter')?.addEventListener('change', (e) => {
    recipeState.ratingFilter = Number(e.target.value) || 0;
    recipeState.currentPage = 1;
    persistState();
    loadAndRenderRecipes(container, onRecipeClick);
  });

  // Initial load
  await loadAndRenderRecipes(container, onRecipeClick);
}

/**
 * Load recipes from API and render the grid.
 * @param {HTMLElement} container - Parent element
 * @param {Function} onRecipeClick - Click handler
 */
async function loadAndRenderRecipes(container, onRecipeClick) {
  const grid = container.querySelector('#recipe-grid');
  const countEl = container.querySelector('#recipe-count');
  const paginationEl = container.querySelector('#recipe-pagination');

  if (!grid) return;

  grid.innerHTML = '<div class="loading-spinner">Loading recipes...</div>';

  try {
    const result = await listRecipes({
      search: recipeState.searchQuery || undefined,
      category: recipeState.categoryFilter || undefined,
      rating: recipeState.ratingFilter || undefined,
      source_provider: recipeState.sourceFilter || undefined,
      limit: recipeState.pageSize,
      offset: (recipeState.currentPage - 1) * recipeState.pageSize
    });

    recipeState.recipes = result.data || [];
    recipeState.total = result.total || 0;

    if (countEl) {
      countEl.textContent = `${recipeState.total} recipe${recipeState.total !== 1 ? 's' : ''}`;
    }

    if (recipeState.recipes.length === 0) {
      grid.innerHTML = '<p class="no-data">No recipes found</p>';
    } else {
      grid.innerHTML = recipeState.recipes.map(r => renderRecipeCard(r)).join('');

      // Wire up click handlers
      grid.querySelectorAll('.recipe-card').forEach(card => {
        card.addEventListener('click', () => {
          const id = Number(card.dataset.id);
          if (onRecipeClick) onRecipeClick(id);
        });
      });

      // Wire up menu toggle buttons
      grid.querySelectorAll('.recipe-menu-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = Number(btn.dataset.id);
          const name = btn.dataset.name;
          const recipe = recipeState.recipes.find(r => r.id === id);
          if (!recipe) return;
          const added = toggleMenuRecipe({
            id: recipe.id,
            name: recipe.name,
            categories: safeParseCategories(recipe.categories)
          });
          // Update card visual state
          const card = btn.closest('.recipe-card');
          if (card) {
            card.classList.toggle('recipe-card-selected', added);
          }
          btn.classList.toggle('active', added);
          btn.title = added ? 'Remove from menu' : 'Add to menu';
          // Update menu builder button count
          const menuBtn = document.getElementById('toggle-menu-btn');
          if (menuBtn) {
            const { menuState } = { menuState: { selectedIds: [] } };
            try {
              const stored = sessionStorage.getItem('wineapp.recipes.menu');
              const parsed = stored ? JSON.parse(stored) : { selectedIds: [] };
              const count = parsed.selectedIds?.length || 0;
              menuBtn.textContent = 'Menu Builder' + (count > 0 ? ' (' + count + ')' : '');
            } catch { /* ignore */ }
          }
        });
      });

      // Wire up delete buttons
      grid.querySelectorAll('.recipe-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = Number(btn.dataset.id);
          const name = btn.dataset.name;
          if (!confirm(`Delete "${name}"?`)) return;
          try {
            await deleteRecipe(id);
            showToast('Recipe deleted');
            await loadAndRenderRecipes(container, onRecipeClick);
          } catch (err) {
            showToast('Error: ' + err.message);
          }
        });
      });

      // Wire up pairing buttons — switch to Pairing tab and pre-fill dish input
      grid.querySelectorAll('.recipe-pairing-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const name = btn.dataset.name;
          switchView('pairing');
          setTimeout(() => {
            const dishInput = document.getElementById('dish-input');
            if (dishInput) {
              dishInput.value = name;
              document.getElementById('ask-sommelier')?.click();
            }
          }, 100);
        });
      });
    }

    // Pagination
    renderPagination(paginationEl, container, onRecipeClick);

  } catch (err) {
    grid.innerHTML = `<p class="no-data">Error loading recipes: ${escapeHtml(err.message)}</p>`;
  }
}

/**
 * Render a single recipe card.
 * @param {Object} recipe - Recipe object
 * @returns {string} HTML string
 */
function renderRecipeCard(recipe) {
  const categories = safeParseCategories(recipe.categories);
  const catHtml = categories.slice(0, 3).map(c =>
    `<span class="recipe-tag">${escapeHtml(c)}</span>`
  ).join('');

  const ratingHtml = recipe.rating > 0
    ? `<span class="recipe-rating">${'\u2605'.repeat(recipe.rating)}${'\u2606'.repeat(5 - recipe.rating)}</span>`
    : '';

  const sourceIcon = getSourceIcon(recipe.source_provider);
  const inMenu = isInMenu(recipe.id);

  return `
    <div class="recipe-card ${inMenu ? 'recipe-card-selected' : ''}" data-id="${recipe.id}">
      <div class="recipe-card-header">
        <h4 class="recipe-card-title">${escapeHtml(recipe.name)}</h4>
        <div class="recipe-card-actions">
          <button class="recipe-pairing-btn" data-id="${recipe.id}" data-name="${escapeHtml(recipe.name)}" title="Find wine pairing">🍷</button>
          <button class="recipe-menu-toggle ${inMenu ? 'active' : ''}" data-id="${recipe.id}" data-name="${escapeHtml(recipe.name)}" title="${inMenu ? 'Remove from menu' : 'Add to menu'}">+M</button>
          <button class="recipe-delete-btn" data-id="${recipe.id}" data-name="${escapeHtml(recipe.name)}" title="Delete">&times;</button>
        </div>
      </div>
      <div class="recipe-card-meta">
        ${ratingHtml}
        ${sourceIcon ? `<span class="recipe-source-icon" title="${escapeHtml(recipe.source_provider)}">${sourceIcon}</span>` : ''}
        ${recipe.total_time ? `<span class="recipe-time">${escapeHtml(recipe.total_time)}</span>` : ''}
      </div>
      ${catHtml ? `<div class="recipe-card-tags">${catHtml}</div>` : ''}
    </div>
  `;
}

/**
 * Get a source provider icon.
 * @param {string} provider - Source provider
 * @returns {string}
 */
function getSourceIcon(provider) {
  switch (provider) {
    case 'paprika': return 'P';
    case 'mealie': return 'M';
    case 'recipesage': return 'RS';
    case 'csv': return 'CSV';
    case 'url': return 'URL';
    default: return '';
  }
}

/**
 * Safely parse categories from DB (stored as JSON string or array).
 * @param {string|string[]} cats - Categories
 * @returns {string[]}
 */
function safeParseCategories(cats) {
  if (Array.isArray(cats)) return cats;
  if (typeof cats === 'string') {
    try { return JSON.parse(cats); } catch { return []; }
  }
  return [];
}

/**
 * Load sync status banners for configured providers.
 * @param {HTMLElement} bannerEl - Banner container
 */
async function loadSyncBanners(bannerEl) {
  if (!bannerEl) return;

  const providers = ['paprika', 'mealie'];
  const banners = [];

  for (const provider of providers) {
    try {
      const status = await getRecipeSyncStatus(provider);
      if (!status.last_sync) continue;

      const lastSync = status.last_sync;
      const lastDate = lastSync.completed_at || lastSync.started_at;
      const age = Date.now() - new Date(lastDate).getTime();
      const daysAgo = Math.floor(age / (1000 * 60 * 60 * 24));
      const isStale = daysAgo >= 7;
      const isFailed = lastSync.status === 'failed';

      if (isStale || isFailed) {
        const label = provider.charAt(0).toUpperCase() + provider.slice(1);
        const msg = isFailed
          ? `${label} sync failed: ${escapeHtml(lastSync.error_message || 'Unknown error')}`
          : `${label} last synced ${daysAgo} day${daysAgo !== 1 ? 's' : ''} ago`;
        banners.push(`
          <div class="sync-banner ${isFailed ? 'sync-banner-error' : 'sync-banner-stale'}">
            <span>${msg}</span>
            <button class="btn btn-small sync-retry-btn" data-provider="${provider}">Sync Now</button>
          </div>
        `);
      }
    } catch { /* provider not configured — skip */ }
  }

  if (banners.length === 0) return;
  bannerEl.innerHTML = banners.join('');

  bannerEl.querySelectorAll('.sync-retry-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const prov = btn.dataset.provider;
      btn.disabled = true;
      btn.textContent = 'Syncing...';
      try {
        const result = await triggerRecipeSync(prov);
        if (result.error) {
          showToast('Sync failed: ' + result.error);
        } else {
          showToast(`Synced: +${result.added || 0} added, ~${result.updated || 0} updated`);
          btn.closest('.sync-banner')?.remove();
        }
      } catch (err) {
        showToast('Sync error: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Sync Now';
      }
    });
  });
}

/**
 * Render pagination controls.
 * @param {HTMLElement} el - Pagination container
 * @param {HTMLElement} container - Parent container
 * @param {Function} onRecipeClick - Click handler
 */
function renderPagination(el, container, onRecipeClick) {
  if (!el) return;
  const totalPages = Math.ceil(recipeState.total / recipeState.pageSize);
  if (totalPages <= 1) {
    el.innerHTML = '';
    return;
  }

  const buttons = [];
  if (recipeState.currentPage > 1) {
    buttons.push(`<button class="pagination-btn" data-page="${recipeState.currentPage - 1}">Prev</button>`);
  }
  buttons.push(`<span class="pagination-info">Page ${recipeState.currentPage} of ${totalPages}</span>`);
  if (recipeState.currentPage < totalPages) {
    buttons.push(`<button class="pagination-btn" data-page="${recipeState.currentPage + 1}">Next</button>`);
  }

  el.innerHTML = buttons.join('');

  el.querySelectorAll('.pagination-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      recipeState.currentPage = Number(btn.dataset.page);
      loadAndRenderRecipes(container, onRecipeClick);
    });
  });
}
