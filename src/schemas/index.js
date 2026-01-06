/**
 * @fileoverview Central export for all validation schemas.
 * @module schemas
 */

// Common schemas
export {
  idParamSchema,
  paginationSchema,
  searchPaginationSchema,
  dateRangeSchema,
  sortOrderSchema,
  booleanQueryParam
} from './common.js';

// Wine schemas
export {
  WINE_COLOURS,
  wineIdSchema,
  createWineSchema,
  updateWineSchema,
  personalRatingSchema,
  tastingProfileSchema,
  tastingExtractionSchema,
  parseTextSchema,
  parseImageSchema,
  searchQuerySchema,
  globalSearchSchema,
  servingTempQuerySchema
} from './wine.js';

// Slot schemas
export {
  locationCodeSchema,
  locationParamSchema,
  moveBottleSchema,
  swapBottleSchema,
  directSwapSchema,
  addToSlotSchema,
  drinkBottleSchema
} from './slot.js';
