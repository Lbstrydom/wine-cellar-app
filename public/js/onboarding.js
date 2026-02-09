/**
 * Onboarding Wizard - lets users configure arbitrary storage area setups.
 * Steps:
 * 1) Choose how many areas (1-5)
 * 2) Define each area's name, type, temperature zone
 * 3) Build layouts (rows/columns), or apply a preset template
 * 4) Review and save (host app persists via API)
 */

import { BUILDER_TEMPLATES, setAreas, getAreas, addArea, normalizeTemplate, renderPreview } from './storageBuilder.js';

const ui = {
  container: null,
  step: 1,
  maxAreas: 5
};

export function startOnboarding(container) {
  ui.container = container;
  ui.step = 1;
  setAreas([]);
  renderStep();
}

function renderStep() {
  if (!ui.container) return;
  ui.container.innerHTML = '';

  const header = document.createElement('h2');
  header.textContent = `Setup Storage Areas (Step ${ui.step}/4)`;
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
    ['cellar','wine_fridge','kitchen_fridge','rack','other'].forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      if (a.storage_type === t) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener('change', () => { a.storage_type = typeSelect.value; });
    card.appendChild(typeSelect);

    const zoneSelect = document.createElement('select');
    ['cellar','cool','cold','ambient'].forEach(z => {
      const opt = document.createElement('option');
      opt.value = z;
      opt.textContent = z;
      if (a.temp_zone === z) opt.selected = true;
      zoneSelect.appendChild(opt);
    });
    zoneSelect.addEventListener('change', () => { a.temp_zone = zoneSelect.value; });
    card.appendChild(zoneSelect);

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
        a.rows = normalized.rows.map(r => ({ row_num: r.row_num, col_count: r.col_count }));
        renderStep();
      }
    });
    templateRow.appendChild(select);
    card.appendChild(templateRow);

    list.appendChild(card);
  });
  ui.container.appendChild(list);

  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next';
  nextBtn.addEventListener('click', () => { ui.step = 3; renderStep(); });
  ui.container.appendChild(nextBtn);
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

    a.rows.forEach(r => {
      const rowCtl = document.createElement('div');
      const label = document.createElement('span');
      label.textContent = `Row ${r.row_num} columns:`;
      rowCtl.appendChild(label);

      const colInput = document.createElement('input');
      colInput.type = 'number';
      colInput.min = 1;
      colInput.max = 20;
      colInput.value = r.col_count;
      colInput.addEventListener('input', () => {
        r.col_count = Math.max(1, Math.min(20, Number(colInput.value) || 1));
        renderStep();
      });
      rowCtl.appendChild(colInput);

      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete Row';
      delBtn.addEventListener('click', () => {
        a.rows = a.rows.filter(x => x.row_num !== r.row_num)
          .map((x, i) => ({ row_num: i + 1, col_count: x.col_count }));
        renderStep();
      });
      rowCtl.appendChild(delBtn);

      areaCtl.appendChild(rowCtl);
    });

    controls.appendChild(areaCtl);
  });

  ui.container.appendChild(controls);

  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Review & Save';
  nextBtn.addEventListener('click', () => { ui.step = 4; renderStep(); });
  ui.container.appendChild(nextBtn);
}

function renderConfirmStep() {
  const areas = getAreas();
  const summary = document.createElement('pre');
  summary.textContent = JSON.stringify({ areas }, null, 2);
  ui.container.appendChild(summary);

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save Configuration';
  saveBtn.addEventListener('click', () => {
    // Host app should POST to /api/storage-areas for each area, then PUT /:id/layout
    // This module intentionally does not perform network requests.
    const event = new CustomEvent('onboarding:save', { detail: { areas } });
    ui.container.dispatchEvent(event);
  });
  ui.container.appendChild(saveBtn);
}
