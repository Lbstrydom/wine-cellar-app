/**
 * Onboarding Wizard - lets users configure arbitrary storage area setups.
 * Steps:
 * 1) Choose how many areas (1-5) — skipped when editing existing areas
 * 2) Define each area's name, type, temperature zone, colour zone
 * 3) Build layouts (rows/columns), or apply a preset template
 * 4) Review and save (host app persists via API)
 */

import { BUILDER_TEMPLATES, setAreas, getAreas, addArea, normalizeTemplate, renderPreview, applyRowOffsets } from './storageBuilder.js';

const FRIDGE_TYPES = new Set(['wine_fridge', 'kitchen_fridge']);

const ui = {
  container: null,
  step: 1,
  maxAreas: 5,
  maxExistingRow: 0
};

/**
 * Start the onboarding wizard.
 * @param {HTMLElement} container - Host container element
 * @param {number} [maxExistingRow=0] - Highest row_num already in the cellar (for offset calc)
 */
export function startOnboarding(container, maxExistingRow = 0) {
  ui.container = container;
  ui.maxExistingRow = maxExistingRow;

  const hasExistingAreas = getAreas().length > 0;
  // Skip count step when editing existing areas
  ui.step = hasExistingAreas ? 2 : 1;

  renderStep();
}

function renderStep() {
  if (!ui.container) return;
  ui.container.innerHTML = '';

  const header = document.createElement('h2');
  const isEdit = getAreas().some(a => a.id);
  header.textContent = isEdit
    ? `Edit Storage Areas (Step ${ui.step}/4)`
    : `Setup Storage Areas (Step ${ui.step}/4)`;
  ui.container.appendChild(header);

  if (ui.step === 1) renderCountStep();
  else if (ui.step === 2) renderDetailsStep();
  else if (ui.step === 3) renderLayoutStep();
  else if (ui.step === 4) renderConfirmStep();
}

function renderCountStep() {
  const info = document.createElement('p');
  info.textContent = 'How many storage areas do you want to manage? You can add, remove, or edit later.';
  ui.container.appendChild(info);

  const input = document.createElement('input');
  input.type = 'number';
  input.min = 1;
  input.max = ui.maxAreas;
  input.value = Math.min(2, ui.maxAreas);
  ui.container.appendChild(input);

  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next';
  nextBtn.addEventListener('click', () => {
    const count = Math.max(1, Math.min(ui.maxAreas, Number(input.value) || 1));
    setAreas([]);
    for (let i = 0; i < count; i++) {
      addArea({ name: `Area ${i + 1}`, storage_type: 'cellar', temp_zone: 'cellar' });
    }
    ui.step = 2;
    renderStep();
  });
  ui.container.appendChild(nextBtn);
}

function renderDetailsStep() {
  const areas = getAreas();
  const list = document.createElement('div');
  areas.forEach((a, _idx) => {
    const card = document.createElement('div');
    card.className = 'area-card';

    const nameInput = document.createElement('input');
    nameInput.value = a.name;
    nameInput.placeholder = 'Name (e.g., Main Cellar, Wine Fridge)';
    nameInput.addEventListener('input', () => { a.name = nameInput.value; });
    card.appendChild(nameInput);

    const typeSelect = document.createElement('select');
    ['cellar', 'wine_fridge', 'kitchen_fridge', 'rack', 'other'].forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      if (a.storage_type === t) opt.selected = true;
      typeSelect.appendChild(opt);
    });

    const zoneSelect = document.createElement('select');
    ['cellar', 'cool', 'cold', 'ambient'].forEach(z => {
      const opt = document.createElement('option');
      opt.value = z;
      opt.textContent = z;
      if (a.temp_zone === z) opt.selected = true;
      zoneSelect.appendChild(opt);
    });
    zoneSelect.addEventListener('change', () => { a.temp_zone = zoneSelect.value; });

    // Colour zone selector (hidden for fridge types)
    const czWrapper = document.createElement('div');
    czWrapper.className = 'colour-zone-wrapper';
    const czLabel = document.createElement('label');
    czLabel.textContent = 'Colour purpose:';
    czWrapper.appendChild(czLabel);

    const czSelect = document.createElement('select');
    const CZ_LABELS = {
      mixed: 'White and red wines (auto-split)',
      white: 'White wines only',
      red: 'Red wines only'
    };
    ['mixed', 'white', 'red'].forEach(z => {
      const opt = document.createElement('option');
      opt.value = z;
      opt.textContent = CZ_LABELS[z];
      if ((a.colour_zone || 'mixed') === z) opt.selected = true;
      czSelect.appendChild(opt);
    });
    czSelect.addEventListener('change', () => { a.colour_zone = czSelect.value; });
    czWrapper.appendChild(czSelect);

    const czHint = document.createElement('small');
    czHint.textContent = 'Affects where the white/red boundary is drawn in analysis.';
    czWrapper.appendChild(czHint);

    // Show/hide colour zone based on current type
    const updateCzVisibility = () => {
      czWrapper.style.display = FRIDGE_TYPES.has(a.storage_type) ? 'none' : '';
    };
    updateCzVisibility();

    typeSelect.addEventListener('change', () => {
      a.storage_type = typeSelect.value;
      updateCzVisibility();
    });

    card.appendChild(typeSelect);
    card.appendChild(zoneSelect);
    card.appendChild(czWrapper);

    const templateRow = document.createElement('div');
    const templateLabel = document.createElement('span');
    templateLabel.textContent = 'Apply template:';
    templateRow.appendChild(templateLabel);
    const select = document.createElement('select');
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '(none)';
    select.appendChild(noneOpt);
    Object.keys(BUILDER_TEMPLATES).forEach(key => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = key;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      const tpl = BUILDER_TEMPLATES[select.value];
      if (tpl) {
        const normalized = normalizeTemplate(tpl);
        a.name = normalized.name;
        a.storage_type = normalized.storage_type;
        a.temp_zone = normalized.temp_zone;
        a.colour_zone = 'mixed'; // Templates are colour-neutral
        // For existing areas, remap template rows to start from the area's original base row
        // so that global row_nums are preserved and don't collide with other areas.
        // For new areas (no id), template rows keep their 1..N numbering;
        // applyRowOffsets() will shift them at save time.
        const baseRow = a.id && a.rows.length > 0
          ? Math.min(...a.rows.map(r => r.row_num))
          : 1;
        a.rows = normalized.rows.map((r, i) => ({
          row_num: baseRow + i,
          col_count: r.col_count
        }));
        renderStep();
      }
    });
    templateRow.appendChild(select);
    card.appendChild(templateRow);

    // Remove area button — only shown when more than one area remains
    if (areas.length > 1) {
      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove This Area';
      removeBtn.className = 'btn btn-danger btn-small';
      removeBtn.addEventListener('click', () => {
        if (a.id) {
          const ok = window.confirm(
            `Remove "${a.name}"? This will delete the area and all its empty slots on save.\n\n` +
            'Note: Areas containing wines must be emptied first.'
          );
          if (!ok) return;
        }
        setAreas(getAreas().filter(x => x !== a));
        renderStep();
      });
      card.appendChild(removeBtn);
    }

    list.appendChild(card);
  });
  ui.container.appendChild(list);

  // Add area button — only when under the max limit
  if (areas.length < ui.maxAreas) {
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add Another Area';
    addBtn.className = 'btn btn-secondary btn-small';
    addBtn.addEventListener('click', () => {
      addArea({ name: `Area ${getAreas().length + 1}`, storage_type: 'cellar', temp_zone: 'cellar' });
      renderStep();
    });
    ui.container.appendChild(addBtn);
  }

  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next';
  nextBtn.addEventListener('click', () => { ui.step = 3; renderStep(); });
  ui.container.appendChild(nextBtn);
}

/**
 * Build a row control element for the layout step.
 * Extracted to reduce nesting depth.
 * @param {Object} area - Area object (mutated in-place)
 * @param {Object} row - Row descriptor { row_num, col_count }
 * @param {number} displayIndex - 0-based position in the array (shown as displayIndex+1 to user)
 * @returns {HTMLElement}
 */
function buildRowControl(area, row, displayIndex) {
  const rowCtl = document.createElement('div');
  const label = document.createElement('span');
  // Display sequential label (1-based), but preserve the actual row_num internally
  label.textContent = `Row ${displayIndex + 1} columns:`;
  rowCtl.appendChild(label);

  const colInput = document.createElement('input');
  colInput.type = 'number';
  colInput.min = 1;
  colInput.max = 20;
  colInput.value = row.col_count;
  colInput.addEventListener('input', () => {
    row.col_count = Math.max(1, Math.min(20, Number(colInput.value) || 1));
    renderStep();
  });
  rowCtl.appendChild(colInput);

  const delBtn = document.createElement('button');
  delBtn.textContent = 'Delete Row';
  // Hide delete button when only one row remains — zero-row areas are not supported
  if (area.rows.length === 1) {
    delBtn.style.display = 'none';
  }
  delBtn.addEventListener('click', () => {
    // Preserve original row_nums — do not renumber to 1..N
    area.rows = area.rows.filter(x => x.row_num !== row.row_num);
    renderStep();
  });
  rowCtl.appendChild(delBtn);
  return rowCtl;
}

function renderLayoutStep() {
  const areas = getAreas();

  const preview = document.createElement('div');
  preview.className = 'layout-preview';
  ui.container.appendChild(preview);

  renderPreview(preview);

  const controls = document.createElement('div');
  controls.className = 'layout-controls';

  areas.forEach((a, _idx) => {
    const areaCtl = document.createElement('div');
    areaCtl.className = 'area-controls';
    const title = document.createElement('h3');
    title.textContent = a.name;
    areaCtl.appendChild(title);

    const addRowBtn = document.createElement('button');
    addRowBtn.textContent = 'Add Row';
    addRowBtn.addEventListener('click', () => {
      a.rows.push({ row_num: (a.rows.at(-1)?.row_num ?? 0) + 1, col_count: 6 });
      renderStep();
    });
    areaCtl.appendChild(addRowBtn);

    a.rows.forEach((r, idx) => areaCtl.appendChild(buildRowControl(a, r, idx)));

    controls.appendChild(areaCtl);
  });

  ui.container.appendChild(controls);

  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Review & Save';
  nextBtn.addEventListener('click', () => { ui.step = 4; renderStep(); });
  ui.container.appendChild(nextBtn);
}

function renderConfirmStep() {
  // Apply row offsets so preview reflects actual row numbers to be saved
  const adjustedAreas = applyRowOffsets(getAreas(), ui.maxExistingRow);

  const summary = document.createElement('pre');
  summary.textContent = JSON.stringify({ areas: adjustedAreas }, null, 2);
  ui.container.appendChild(summary);

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save Configuration';
  saveBtn.addEventListener('click', () => {
    // Dispatch save event with the original (un-offset) areas;
    // settings.js will apply offsets before POSTing new areas.
    const event = new CustomEvent('onboarding:save', { detail: { areas: getAreas() } });
    ui.container.dispatchEvent(event);
  });
  ui.container.appendChild(saveBtn);
}
