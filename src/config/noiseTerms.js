/**
 * @fileoverview Noise terms to suppress from tasting note extraction.
 * These terms typically indicate food pairing suggestions or marketing hyperbole
 * rather than actual wine characteristics.
 * @module config/noiseTerms
 */

/**
 * Food pairing terms that should be filtered when they appear
 * in context suggesting food pairing, not wine character.
 */
export const FOOD_PAIRING_NOISE = [
  'cheese',
  'cream',
  'oil',
  'butter', // Note: valid when describing texture, filter in pairing context
  'fish',
  'meat',
  'shellfish',
  'pairs with',
  'serve with',
  'complement',
  'accompanies',
  'matches well',
  'perfect with',
  'great with',
  'ideal with',
  'goes well with',
  'enjoy with',
  'best served with',
  'chicken',
  'beef',
  'lamb',
  'pork',
  'pasta',
  'risotto',
  'grilled',
  'roasted',
  'seared'
];

/**
 * Marketing hyperbole terms that add no descriptive value.
 */
export const MARKETING_HYPERBOLE = [
  'explosive',
  'amazing',
  'incredible',
  'stunning',
  'exceptional',
  'world-class',
  'outstanding',
  'superb',
  'brilliant',
  'magnificent',
  'phenomenal',
  'extraordinary',
  'remarkable',
  'spectacular',
  'unbelievable',
  'breathtaking',
  'sublime',
  'legendary',
  'iconic',
  'masterpiece',
  'benchmark',
  'quintessential',
  'definitive',
  'ultimate',
  'supreme',
  'absolute',
  'pure',
  'true',
  'authentic',
  'genuine',
  'real'
];

/**
 * Contextual phrases that indicate food pairing context.
 */
export const PAIRING_CONTEXT_PHRASES = [
  'pair',
  'serve',
  'match',
  'accompany',
  'complement',
  'enjoy with',
  'goes with',
  'alongside',
  'works with'
];

/**
 * Check if a term is in the noise list.
 * @param {string} term - Term to check
 * @returns {boolean} True if term is noise
 */
export function isMarketingNoise(term) {
  const lower = term.toLowerCase().trim();
  return MARKETING_HYPERBOLE.includes(lower);
}

/**
 * Check if text contains food pairing context.
 * @param {string} text - Surrounding text
 * @returns {boolean} True if pairing context detected
 */
export function hasPairingContext(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return PAIRING_CONTEXT_PHRASES.some(phrase => lower.includes(phrase));
}

/**
 * Check if a term should be suppressed as noise.
 * @param {string} term - Term to check
 * @param {Object} context - Context object with surroundingText
 * @returns {boolean} True if term should be filtered
 */
export function isNoiseTerm(term, context = {}) {
  const lower = term.toLowerCase().trim();
  
  // Always filter marketing hyperbole
  if (MARKETING_HYPERBOLE.includes(lower)) {
    return true;
  }
  
  // Check food pairing terms with context
  if (FOOD_PAIRING_NOISE.includes(lower)) {
    // If we have context, check for pairing phrases
    if (context.surroundingText) {
      return hasPairingContext(context.surroundingText);
    }
    // Without context, be conservative - suppress food terms
    return true;
  }
  
  return false;
}

export default {
  FOOD_PAIRING_NOISE,
  MARKETING_HYPERBOLE,
  PAIRING_CONTEXT_PHRASES,
  isMarketingNoise,
  hasPairingContext,
  isNoiseTerm
};
