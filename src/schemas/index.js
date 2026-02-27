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

// Cellar schemas
export {
  createCellarSchema,
  updateCellarSchema
} from './cellar.js';

// Pairing schemas
export {
  suggestPairingSchema,
  naturalPairingSchema,
  chatMessageSchema,
  extractSignalsSchema,
  shortlistSchema,
  hybridPairingSchema,
  sessionChooseSchema,
  sessionFeedbackSchema,
  sessionIdSchema
} from './pairing.js';

// Settings schemas
export {
  settingsKeySchema,
  updateSettingSchema,
  sourceParamSchema,
  saveCredentialSchema
} from './settings.js';

// Awards schemas
export {
  addCompetitionSchema,
  importWebpageSchema,
  importTextSchema,
  linkAwardSchema,
  searchAwardsQuerySchema,
  awardIdSchema,
  sourceIdSchema,
  awardWineIdSchema
} from './awards.js';

// Acquisition schemas
export {
  parseImageSchema as acquisitionParseImageSchema,
  suggestPlacementSchema,
  enrichSchema,
  workflowSchema,
  saveAcquiredSchema
} from './acquisition.js';

// Palate profile schemas
export {
  feedbackSchema,
  palateWineIdSchema,
  recommendationsQuerySchema
} from './palateProfile.js';

// Storage area schemas
export {
  createStorageAreaSchema,
  updateStorageAreaSchema,
  updateLayoutSchema,
  fromTemplateSchema,
  storageAreaIdSchema
} from './storageArea.js';

// Rating schemas
export {
  ratingWineIdSchema,
  ratingParamsSchema,
  ratingsQuerySchema,
  addRatingSchema,
  overrideRatingSchema,
  fetchAsyncSchema,
  batchFetchSchema,
  jobIdSchema
} from './rating.js';

// Buying guide item schemas
export {
  createItemSchema,
  updateItemSchema,
  updateStatusSchema,
  batchStatusSchema,
  listItemsQuerySchema,
  itemIdSchema,
  inferStyleSchema
} from './buyingGuideItem.js';

// Restaurant pairing schemas
export {
  MENU_TYPES,
  RESTAURANT_WINE_COLOURS,
  DISH_CATEGORIES,
  CONFIDENCE_LEVELS,
  parseMenuSchema,
  recommendSchema,
  restaurantChatSchema,
  parsedWineItemSchema,
  parsedDishItemSchema,
  wineListResponseSchema,
  dishMenuResponseSchema,
  pairingItemSchema,
  tableWineSchema,
  recommendResponseSchema
} from './restaurantPairing.js';
