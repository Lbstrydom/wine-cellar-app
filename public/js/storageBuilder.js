/**
 * Storage Builder - visual editor for storage areas
 * Allows users to define arbitrary storage area configurations (1-5 areas),
 * with variable rows and columns per row.
 * No network calls here; this module only builds/edit layouts in memory,
 * and emits events for the host app to persist via API.
 */

// Canonical template normalizer: rows = [{ row_num, col_count }]
export function normalizeTemplate(template) {
  if (Array.isArray(template.rows) && template.rows[0]?.row_num !== undefined) {
    return template;
  }
  if (template.cols) {
    const colCounts = Array.isArray(template.cols)
      ? template.cols
      : Array(template.rows || 1).fill(template.cols);
    return {
      ...template,
      rows: colCounts.map((col_count, i) => ({ row_num: i + 1, col_count }))
    };
  }
  return template;
}

// Default presets for quick setup; users can edit freely after applying
export const BUILDER_TEMPLATES = {
  wine_fridge_small: {
    name: 'Wine Fridge',
    storage_type: 'wine_fridge',
    temp_zone: 'cool',
    rows: [
      { row_num: 1, col_count: 6 },
      { row_num: 2, col_count: 6 }
    ]
  },
  cellar_large: {
    name: 'Wine Cellar',
    storage_type: 'cellar',
    temp_zone: 'cellar',
    rows: [
      { row_num: 1, col_count: 7 },
      ...Array.from({ length: 18 }, (_, i) => ({ row_num: i + 2, col_count: 9 }))
    ]
  },
  rack_floor: {
    name: 'Wine Rack',
    storage_type: 'rack',
    temp_zone: 'ambient',
    rows: Array.from({ length: 4 }, (_, i) => ({ row_num: i + 1, col_count: 6 }))
  },
  kitchen_fridge: {
    name: 'Kitchen Fridge',
    storage_type: 'kitchen_fridge',
    temp_zone: 'cold',
    rows: [{ row_num: 1, col_count: 6 }],
    warning: 'Only for short-term chilling before serving'
  }
};

// Builder state lives here; host app can read/write via exported functions
const state = {
  areas: [] // [{ id?, name, storage_type, temp_zone, rows: [{row_num,col_count}] }]
};

export function setAreas(areas) {
  state.areas = areas.map(a => ({
    ...a,
    rows: Array.isArray(a.rows)
      ? a.rows.map((r, idx) => ({ row_num: r.row_num ?? idx + 1, col_count: r.col_count }))
      : []
  }));
}

export function getAreas() {
  return state.areas;
}

// Add a new area with defaults; caller provides name/type/zone
export function addArea({ name, storage_type, temp_zone }) {
  const area = {
    name,
    storage_type,
    temp_zone,
    rows: [{ row_num: 1, col_count: 6 }]
  };
  state.areas.push(area);
  emitChange();
  return area;
}

export function removeArea(index) {
  if (index >= 0 && index < state.areas.length) {
    state.areas.splice(index, 1);
    emitChange();
  }
}

export function addRow(areaIndex) {
  const area = state.areas[areaIndex];
  if (!area) return;
  const nextRow = (area.rows.at(-1)?.row_num ?? 0) + 1;
  area.rows.push({ row_num: nextRow, col_count: 6 });
  emitChange();
}

export function removeRow(areaIndex, rowNum) {
  const area = state.areas[areaIndex];
  if (!area) return;
  const idx = area.rows.findIndex(r => r.row_num === rowNum);
  if (idx >= 0) {
    area.rows.splice(idx, 1);
    // Re-number following rows to keep 1..N
    area.rows = area.rows.map((r, i) => ({ row_num: i + 1, col_count: r.col_count }));
    emitChange();
  }
}

export function setColumns(areaIndex, rowNum, colCount) {
  const area = state.areas[areaIndex];
  if (!area) return;
  const row = area.rows.find(r => r.row_num === rowNum);
  if (row) {
    row.col_count = Math.max(1, Math.min(20, Number(colCount) || 1));
    emitChange();
  }
}

// Simple event system so host app can persist changes
let onChangeCallbacks = [];
export function onChange(cb) {
  onChangeCallbacks.push(cb);
  return () => {
    onChangeCallbacks = onChangeCallbacks.filter(fn => fn !== cb);
  };
}
function emitChange() {
  for (const cb of onChangeCallbacks) cb(getAreas());
}

// Render helper to preview grids (no CSS assumptions)
export function renderPreview(container) {
  container.innerHTML = '';
  state.areas.forEach(area => {
    const wrap = document.createElement('div');
    wrap.className = 'storage-area-preview';
    const title = document.createElement('h3');
    title.textContent = `${area.name} (${area.storage_type}, ${area.temp_zone})`;
    wrap.appendChild(title);

    area.rows.forEach(r => {
      const rowEl = document.createElement('div');
      rowEl.className = 'storage-row';
      for (let c = 1; c <= r.col_count; c++) {
        const slot = document.createElement('div');
        slot.className = 'storage-slot';
        slot.textContent = `R${r.row_num}C${c}`;
        rowEl.appendChild(slot);
      }
      wrap.appendChild(rowEl);
    });
    container.appendChild(wrap);
  });
}
