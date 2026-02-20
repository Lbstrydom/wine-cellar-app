/**
 * @fileoverview Barrel re-export of all API modules.
 * @module api/index
 */

// Infrastructure (auth state, fetch wrapper, response handling)
export {
  API_BASE,
  AUTH_TOKEN_KEY,
  ACTIVE_CELLAR_KEY,
  INVITE_CODE_KEY,
  setAuthErrorHandler,
  getAccessToken,
  setAccessToken,
  getActiveCellarId,
  setActiveCellarId,
  getInviteCode,
  setInviteCode,
  clearAuthState,
  apiFetch,
  fetch,
  handleResponse,
  downloadBlob
} from './base.js';

// Profile & cellar management
export {
  getProfile,
  getCellars,
  getStorageAreas,
  getStorageAreaById,
  createStorageArea,
  updateStorageArea,
  updateStorageAreaLayout,
  deleteStorageArea,
  createStorageAreaFromTemplate,
  setActiveCellar
} from './profile.js';

// Wine CRUD, search, parsing, bottles, slots
export {
  fetchWines,
  fetchWine,
  searchWines,
  fetchWineStyles,
  createWine,
  checkWineDuplicate,
  updateWine,
  getWineExternalIds,
  confirmWineExternalId,
  setWineVivinoUrl,
  parseWineText,
  parseWineImage,
  addBottles,
  removeBottle,
  moveBottle,
  swapBottles,
  directSwapBottles,
  drinkBottle,
  openBottle,
  sealBottle,
  getOpenBottles,
  getServingTemperature,
  getTastingNotes,
  reportTastingNotes,
  searchVivinoWines,
  getVivinoWineDetails,
  getWineSearchStatus,
  getSearchMetrics
} from './wines.js';

// Ratings & drinking windows
export {
  getPersonalRating,
  updatePersonalRating,
  getWineRatings,
  getWineSourceRatings,
  fetchWineRatingsFromApi,
  fetchRatingsAsync,
  getRatingsJobStatus,
  getIdentityDiagnostics,
  addManualRating,
  deleteRating,
  refreshWineRatings,
  getDrinkingWindows,
  saveDrinkingWindow,
  deleteDrinkingWindow,
  getBestDrinkingWindow,
  getUrgentWines
} from './ratings.js';

// Sommelier & pairing
export {
  askSommelier,
  getPairingSuggestions,
  choosePairingWine,
  submitPairingFeedback,
  sommelierChat,
  clearSommelierChat
} from './pairing.js';

// Cellar zones, reconfiguration, analysis
export {
  getCellarZones,
  getZoneMap,
  getSuggestedPlacement,
  suggestPlacement,
  checkAnalysisFreshness,
  analyseCellar,
  allocateZoneRow,
  mergeZones,
  getReconfigurationPlan,
  getZoneReconfigurationPlan,
  applyReconfigurationPlan,
  undoReconfiguration,
  analyseCellarAI,
  executeCellarMoves,
  assignWineToZone,
  getFridgeOrganization,
  getZoneLayoutProposal,
  getZoneLayout,
  confirmZoneLayout,
  getConsolidationMoves,
  zoneChatMessage,
  reassignWineZone,
  backfillGrapes,
  searchGrapes
} from './cellar.js';

// Awards database
export {
  getAwardsCompetitions,
  createAwardsCompetition,
  getAwardsSources,
  getSourceAwards,
  importAwardsFromWebpage,
  importAwardsFromPDF,
  importAwardsFromText,
  deleteAwardsSource,
  rematchAwardsSource,
  linkAwardToWine,
  getWineAwards
} from './awards.js';

// Settings & credentials
export {
  getSettings,
  updateSetting,
  getCredentials,
  saveCredentials,
  deleteCredentials,
  testCredentials,
  evaluateReduceRules,
  batchAddReduceNow
} from './settings.js';

// Acquisition workflow
export {
  parseWineImageWithConfidence,
  getAcquisitionPlacement,
  enrichWine,
  runAcquisitionWorkflow,
  saveAcquiredWine,
  getConfidenceLevels
} from './acquisition.js';

// Palate profile & feedback
export {
  recordFeedback,
  getWineFeedback,
  getPalateProfile,
  getPersonalizedScore,
  getPersonalizedRecommendations,
  getFoodTags,
  getOccasionTypes
} from './palate.js';

// Health, backup, stats, history
export {
  fetchLayout,
  fetchLayoutLite,
  fetchStats,
  fetchReduceNow,
  fetchConsumptionHistory,
  getCellarHealth,
  getCellarHealthScore,
  getCellarHealthAlerts,
  getAtRiskWines,
  executeFillFridge,
  generateShoppingList,
  getBackupInfo,
  exportBackupJSON,
  exportBackupCSV,
  importBackup
} from './health.js';

// Restaurant pairing
export {
  parseMenu,
  getRecommendations,
  restaurantChat
} from './restaurantPairing.js';

// Error logging
export {
  logClientError
} from './errors.js';
