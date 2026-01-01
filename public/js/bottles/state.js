/**
 * @fileoverview Shared state for bottle management module.
 * @module bottles/state
 */

/**
 * Module state for bottle management.
 */
export const bottleState = {
  mode: 'add', // 'add' or 'edit'
  editingLocation: null,
  editingWineId: null,
  wineStyles: [],
  searchTimeout: null,
  parsedWines: [],
  selectedParsedIndex: 0,
  uploadedImage: null, // { base64: string, mediaType: string, preview: string }
  // Slot picker state
  pendingAddWineId: null,
  pendingQuantity: 1,
  placedCount: 0,
  placementMethod: 'manual' // 'auto' or 'manual'
};

/**
 * Reset bottle modal state.
 */
export function resetBottleState() {
  bottleState.mode = 'add';
  bottleState.editingLocation = null;
  bottleState.editingWineId = null;
  bottleState.parsedWines = [];
  bottleState.selectedParsedIndex = 0;
  bottleState.uploadedImage = null;
}

/**
 * Reset slot picker state.
 */
export function resetSlotPickerState() {
  bottleState.pendingAddWineId = null;
  bottleState.pendingQuantity = 1;
  bottleState.placedCount = 0;
  bottleState.placementMethod = 'manual';
}
