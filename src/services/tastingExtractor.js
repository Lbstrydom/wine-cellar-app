/**
 * @fileoverview AI-powered tasting note extraction service.
 * Transforms prose tasting notes into structured, searchable profiles.
 * @module services/tastingExtractor
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  FRUIT_DESCRIPTORS,
  SECONDARY_DESCRIPTORS,
  TERTIARY_DESCRIPTORS,
  TEXTURE_DESCRIPTORS,
  STYLE_TAGS,
  getAllFruitTerms,
  getAllSecondaryTerms,
  getAllTertiaryTerms
} from '../config/tastingVocabulary.js';

let anthropic = null;

/**
 * Initialize Anthropic client lazily.
 * @returns {Anthropic|null} Anthropic client or null if no API key
 */
function getClient() {
  if (!anthropic && process.env.ANTHROPIC_API_KEY) {
    anthropic = new Anthropic();
  }
  return anthropic;
}

/**
 * System prompt for tasting note extraction.
 */
const EXTRACTION_SYSTEM_PROMPT = `You are a wine tasting note analyzer. Extract structured descriptors from tasting notes using ONLY the provided vocabulary terms.

Your task:
1. Read the tasting note carefully
2. Map descriptors to our controlled vocabulary terms
3. Output structured JSON with the extracted profile
4. If a descriptor doesn't match our vocabulary, find the closest term or omit it
5. Generate 3-5 summary bullets that capture the wine's character in plain language

Be conservative - only include terms you're confident about. Empty arrays are better than guesses.`;

/**
 * Build the extraction prompt with vocabulary.
 * @param {string} tastingNote - The tasting note to analyze
 * @param {Object} wineInfo - Optional wine metadata for context
 * @returns {string} Formatted prompt
 */
function buildExtractionPrompt(tastingNote, wineInfo = {}) {
  const fruitVocab = Object.entries(FRUIT_DESCRIPTORS)
    .map(([cat, terms]) => `  ${cat}: ${terms.join(', ')}`)
    .join('\n');

  const secondaryVocab = Object.entries(SECONDARY_DESCRIPTORS)
    .map(([cat, terms]) => `  ${cat}: ${terms.join(', ')}`)
    .join('\n');

  const tertiaryVocab = Object.entries(TERTIARY_DESCRIPTORS)
    .map(([cat, terms]) => `  ${cat}: ${terms.join(', ')}`)
    .join('\n');

  let wineContext = '';
  if (wineInfo.colour || wineInfo.style || wineInfo.grape) {
    wineContext = `\nWINE CONTEXT: ${wineInfo.colour || ''} ${wineInfo.style || ''} ${wineInfo.grape || ''}\n`;
  }

  return `CONTROLLED VOCABULARY (use ONLY these terms):

FRUIT DESCRIPTORS:
${fruitVocab}

SECONDARY DESCRIPTORS:
${secondaryVocab}

TERTIARY DESCRIPTORS:
${tertiaryVocab}

TEXTURE TERMS: ${TEXTURE_DESCRIPTORS.join(', ')}

STYLE TAGS: ${STYLE_TAGS.join(', ')}
${wineContext}
TASTING NOTE TO ANALYZE:
"${tastingNote}"

Return a JSON object with this exact structure:
{
  "nose": {
    "primary_fruit": [],
    "secondary": [],
    "tertiary": [],
    "intensity": "light|medium|pronounced"
  },
  "palate": {
    "sweetness": "dry|off-dry|medium|sweet",
    "body": "light|medium|full",
    "acidity": "low|medium|high",
    "tannin": "low|medium|high" or null for whites,
    "alcohol": "low|medium|high",
    "texture": []
  },
  "finish": {
    "length": "short|medium|long",
    "notes": []
  },
  "style_tags": [],
  "summary_bullets": []
}

Return ONLY the JSON object, no additional text.`;
}

/**
 * Extract structured tasting profile from a tasting note using AI.
 * @param {string} tastingNote - The tasting note text to analyze
 * @param {Object} options - Options for extraction
 * @param {string} options.sourceId - Source ID for provenance
 * @param {Object} options.wineInfo - Optional wine context (colour, style, grape)
 * @returns {Promise<Object>} Structured tasting profile
 */
export async function extractTastingProfile(tastingNote, options = {}) {
  const { sourceId = 'unknown', wineInfo = {} } = options;
  const client = getClient();

  if (!client) {
    console.log('No Anthropic API key, using deterministic extraction');
    const profile = extractTastingProfileDeterministic(tastingNote, wineInfo);
    profile.extraction = {
      source_id: sourceId,
      method: 'deterministic',
      confidence: 0.5,
      extracted_at: new Date().toISOString()
    };
    return profile;
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: buildExtractionPrompt(tastingNote, wineInfo)
      }]
    });

    // Parse the JSON response
    const responseText = response.content[0].text;
    let profile;

    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        profile = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      // Fall back to deterministic
      profile = extractTastingProfileDeterministic(tastingNote, wineInfo);
      profile.extraction = {
        source_id: sourceId,
        method: 'deterministic_fallback',
        confidence: 0.5,
        extracted_at: new Date().toISOString(),
        parse_error: parseError.message
      };
      return profile;
    }

    // Validate and sanitize the profile
    profile = sanitizeProfile(profile);

    // Add extraction metadata
    profile.extraction = {
      source_id: sourceId,
      method: 'ai',
      confidence: calculateConfidence(profile),
      extracted_at: new Date().toISOString()
    };

    return profile;
  } catch (error) {
    console.error('AI extraction error:', error);
    // Fall back to deterministic
    const profile = extractTastingProfileDeterministic(tastingNote, wineInfo);
    profile.extraction = {
      source_id: sourceId,
      method: 'deterministic_fallback',
      confidence: 0.5,
      extracted_at: new Date().toISOString(),
      error: error.message
    };
    return profile;
  }
}

/**
 * Deterministic fallback extraction using keyword matching.
 * @param {string} tastingNote - The tasting note to analyze
 * @param {Object} wineInfo - Optional wine context
 * @returns {Object} Structured tasting profile
 */
export function extractTastingProfileDeterministic(tastingNote, wineInfo = {}) {
  const note = tastingNote.toLowerCase();

  const profile = {
    nose: {
      primary_fruit: [],
      secondary: [],
      tertiary: [],
      intensity: 'medium'
    },
    palate: {
      sweetness: 'dry',
      body: 'medium',
      acidity: 'medium',
      tannin: wineInfo.colour === 'red' ? 'medium' : null,
      alcohol: 'medium',
      texture: []
    },
    finish: {
      length: 'medium',
      notes: []
    },
    style_tags: [],
    summary_bullets: []
  };

  // Match fruit descriptors
  for (const [, terms] of Object.entries(FRUIT_DESCRIPTORS)) {
    for (const term of terms) {
      const searchTerm = term.replace(/_/g, ' ');
      if (note.includes(searchTerm)) {
        profile.nose.primary_fruit.push(term);
      }
    }
  }

  // Match secondary descriptors
  for (const [, terms] of Object.entries(SECONDARY_DESCRIPTORS)) {
    for (const term of terms) {
      const searchTerm = term.replace(/_/g, ' ');
      if (note.includes(searchTerm)) {
        profile.nose.secondary.push(term);
      }
    }
  }

  // Match tertiary descriptors
  for (const [, terms] of Object.entries(TERTIARY_DESCRIPTORS)) {
    for (const term of terms) {
      const searchTerm = term.replace(/_/g, ' ');
      if (note.includes(searchTerm)) {
        profile.nose.tertiary.push(term);
      }
    }
  }

  // Match texture
  for (const term of TEXTURE_DESCRIPTORS) {
    if (note.includes(term)) {
      profile.palate.texture.push(term);
    }
  }

  // Intensity
  if (note.includes('pronounced') || note.includes('intense') || note.includes('powerful')) {
    profile.nose.intensity = 'pronounced';
  } else if (note.includes('light') || note.includes('delicate') || note.includes('subtle')) {
    profile.nose.intensity = 'light';
  }

  // Sweetness
  if (note.includes('sweet') && !note.includes('off-dry')) {
    profile.palate.sweetness = 'sweet';
  } else if (note.includes('off-dry') || note.includes('hint of sweetness')) {
    profile.palate.sweetness = 'off-dry';
  } else if (note.includes('medium-dry')) {
    profile.palate.sweetness = 'medium';
  }

  // Body
  if (note.includes('full-bodied') || note.includes('full bodied') || note.includes('big')) {
    profile.palate.body = 'full';
  } else if (note.includes('light-bodied') || note.includes('light bodied') || note.includes('lightweight')) {
    profile.palate.body = 'light';
  } else if (note.includes('medium-bodied') || note.includes('medium bodied')) {
    profile.palate.body = 'medium';
  }

  // Acidity
  if (note.includes('high acidity') || note.includes('bright acidity') || note.includes('racy') || note.includes('zesty')) {
    profile.palate.acidity = 'high';
  } else if (note.includes('low acidity') || note.includes('soft acidity') || note.includes('mellow')) {
    profile.palate.acidity = 'low';
  }

  // Tannin (only for reds)
  if (wineInfo.colour === 'red' || note.includes('tannin')) {
    if (note.includes('silky tannin') || note.includes('fine tannin') || note.includes('soft tannin')) {
      profile.palate.tannin = 'low';
    } else if (note.includes('firm tannin') || note.includes('grippy') || note.includes('structured')) {
      profile.palate.tannin = 'high';
    } else if (note.includes('tannin')) {
      profile.palate.tannin = 'medium';
    }
  }

  // Alcohol
  if (note.includes('high alcohol') || note.includes('hot') || note.includes('warming')) {
    profile.palate.alcohol = 'high';
  } else if (note.includes('low alcohol') || note.includes('light alcohol')) {
    profile.palate.alcohol = 'low';
  }

  // Finish
  if (note.includes('long finish') || note.includes('lingering') || note.includes('persistent')) {
    profile.finish.length = 'long';
  } else if (note.includes('short finish') || note.includes('quick finish')) {
    profile.finish.length = 'short';
  }

  // Style tags
  if (note.includes('oaked') || note.includes('oak')) {
    if (note.includes('heavily oaked') || note.includes('lots of oak')) {
      profile.style_tags.push('heavily_oaked');
    } else if (note.includes('lightly oaked') || note.includes('subtle oak')) {
      profile.style_tags.push('lightly_oaked');
    }
  }
  if (note.includes('unoaked')) {
    profile.style_tags.push('unoaked');
  }
  if (note.includes('age') || note.includes('cellaring potential')) {
    profile.style_tags.push('age_worthy');
  }
  if (note.includes('drink now') || note.includes('ready to drink')) {
    profile.style_tags.push('drink_now');
  }
  if (note.includes('fruit forward') || note.includes('fruit-forward')) {
    profile.style_tags.push('fruit_forward');
  }
  if (note.includes('elegant')) {
    profile.style_tags.push('elegant');
  }
  if (note.includes('powerful') || note.includes('big')) {
    profile.style_tags.push('powerful');
  }
  if (note.includes('complex') || note.includes('complexity')) {
    profile.style_tags.push('complex');
  }

  // Dedupe arrays
  profile.nose.primary_fruit = [...new Set(profile.nose.primary_fruit)];
  profile.nose.secondary = [...new Set(profile.nose.secondary)];
  profile.nose.tertiary = [...new Set(profile.nose.tertiary)];
  profile.palate.texture = [...new Set(profile.palate.texture)];
  profile.finish.notes = [...new Set(profile.finish.notes)];
  profile.style_tags = [...new Set(profile.style_tags)];

  // Generate summary bullets from what we found
  profile.summary_bullets = generateSummaryBullets(profile);

  return profile;
}

/**
 * Sanitize and validate extracted profile against vocabulary.
 * @param {Object} profile - Raw extracted profile
 * @returns {Object} Sanitized profile
 */
function sanitizeProfile(profile) {
  const allFruits = getAllFruitTerms();
  const allSecondary = getAllSecondaryTerms();
  const allTertiary = getAllTertiaryTerms();

  // Ensure structure exists
  profile.nose = profile.nose || {};
  profile.palate = profile.palate || {};
  profile.finish = profile.finish || {};

  // Filter fruits to vocabulary
  profile.nose.primary_fruit = (profile.nose.primary_fruit || [])
    .filter(t => allFruits.includes(t));

  // Filter secondary
  profile.nose.secondary = (profile.nose.secondary || [])
    .filter(t => allSecondary.includes(t));

  // Filter tertiary
  profile.nose.tertiary = (profile.nose.tertiary || [])
    .filter(t => allTertiary.includes(t));

  // Filter texture
  profile.palate.texture = (profile.palate.texture || [])
    .filter(t => TEXTURE_DESCRIPTORS.includes(t));

  // Filter style tags
  profile.style_tags = (profile.style_tags || [])
    .filter(t => STYLE_TAGS.includes(t));

  // Validate enums
  const validIntensity = ['light', 'medium', 'pronounced'];
  const validSweetness = ['dry', 'off-dry', 'medium', 'sweet'];
  const validBody = ['light', 'medium', 'full'];
  const validLevel = ['low', 'medium', 'high'];
  const validFinish = ['short', 'medium', 'long'];

  profile.nose.intensity = validIntensity.includes(profile.nose.intensity)
    ? profile.nose.intensity : 'medium';

  profile.palate.sweetness = validSweetness.includes(profile.palate.sweetness)
    ? profile.palate.sweetness : 'dry';

  profile.palate.body = validBody.includes(profile.palate.body)
    ? profile.palate.body : 'medium';

  profile.palate.acidity = validLevel.includes(profile.palate.acidity)
    ? profile.palate.acidity : 'medium';

  profile.palate.alcohol = validLevel.includes(profile.palate.alcohol)
    ? profile.palate.alcohol : 'medium';

  if (profile.palate.tannin !== null) {
    profile.palate.tannin = validLevel.includes(profile.palate.tannin)
      ? profile.palate.tannin : 'medium';
  }

  profile.finish.length = validFinish.includes(profile.finish.length)
    ? profile.finish.length : 'medium';

  // Ensure finish notes are valid terms
  profile.finish.notes = (profile.finish.notes || [])
    .filter(t => allFruits.includes(t) || allSecondary.includes(t) || allTertiary.includes(t));

  // Ensure summary bullets exist and are strings
  profile.summary_bullets = (profile.summary_bullets || [])
    .filter(b => typeof b === 'string')
    .slice(0, 5);

  return profile;
}

/**
 * Calculate confidence score based on profile completeness.
 * @param {Object} profile - Extracted profile
 * @returns {number} Confidence score 0-1
 */
function calculateConfidence(profile) {
  let score = 0.5; // Base score

  // More descriptors = higher confidence
  const fruitCount = (profile.nose?.primary_fruit || []).length;
  const secondaryCount = (profile.nose?.secondary || []).length;
  const textureCount = (profile.palate?.texture || []).length;

  if (fruitCount > 0) score += 0.1;
  if (fruitCount > 2) score += 0.1;
  if (secondaryCount > 0) score += 0.1;
  if (textureCount > 0) score += 0.1;

  // Summary bullets indicate good understanding
  if ((profile.summary_bullets || []).length >= 3) score += 0.1;

  return Math.min(score, 1.0);
}

/**
 * Generate summary bullets from profile.
 * @param {Object} profile - Tasting profile
 * @returns {string[]} Summary bullets
 */
function generateSummaryBullets(profile) {
  const bullets = [];

  // Fruit summary
  const fruits = profile.nose?.primary_fruit || [];
  if (fruits.length > 0) {
    const fruitNames = fruits.slice(0, 3).map(f => f.replace(/_/g, ' '));
    bullets.push(`Aromas of ${fruitNames.join(', ')}`);
  }

  // Oak/secondary
  const secondary = profile.nose?.secondary || [];
  if (secondary.length > 0) {
    const names = secondary.slice(0, 2).map(s => s.replace(/_/g, ' '));
    bullets.push(`Notes of ${names.join(' and ')}`);
  }

  // Body and structure
  const body = profile.palate?.body;
  const tannin = profile.palate?.tannin;
  if (body && tannin) {
    bullets.push(`${body.charAt(0).toUpperCase() + body.slice(1)}-bodied with ${tannin} tannins`);
  } else if (body) {
    bullets.push(`${body.charAt(0).toUpperCase() + body.slice(1)}-bodied`);
  }

  // Finish
  if (profile.finish?.length === 'long') {
    bullets.push('Long, lingering finish');
  }

  // Style
  const tags = profile.style_tags || [];
  if (tags.includes('age_worthy')) {
    bullets.push('Good aging potential');
  }
  if (tags.includes('drink_now')) {
    bullets.push('Ready to enjoy now');
  }

  return bullets.slice(0, 5);
}

/**
 * Extract profile from multiple tasting notes and merge.
 * @param {Array<{note: string, sourceId: string}>} notes - Array of notes with sources
 * @param {Object} wineInfo - Wine context
 * @returns {Promise<Object>} Merged tasting profile
 */
export async function extractAndMergeProfiles(notes, wineInfo = {}) {
  if (notes.length === 0) {
    return null;
  }

  if (notes.length === 1) {
    return extractTastingProfile(notes[0].note, {
      sourceId: notes[0].sourceId,
      wineInfo
    });
  }

  // Extract all profiles
  const profiles = await Promise.all(
    notes.map(n => extractTastingProfile(n.note, {
      sourceId: n.sourceId,
      wineInfo
    }))
  );

  // Merge profiles
  return mergeProfiles(profiles);
}

/**
 * Merge multiple profiles into one.
 * @param {Object[]} profiles - Array of profiles to merge
 * @returns {Object} Merged profile
 */
function mergeProfiles(profiles) {
  const merged = {
    nose: {
      primary_fruit: [],
      secondary: [],
      tertiary: [],
      intensity: 'medium'
    },
    palate: {
      sweetness: 'dry',
      body: 'medium',
      acidity: 'medium',
      tannin: null,
      alcohol: 'medium',
      texture: []
    },
    finish: {
      length: 'medium',
      notes: []
    },
    style_tags: [],
    summary_bullets: [],
    extraction: {
      sources: profiles.map(p => p.extraction?.source_id).filter(Boolean),
      method: 'merged',
      confidence: 0,
      extracted_at: new Date().toISOString()
    }
  };

  // Collect all terms with counts
  const fruitCounts = {};
  const secondaryCounts = {};
  const tertiaryCounts = {};
  const textureCounts = {};
  const tagCounts = {};
  const intensityCounts = {};
  const bodyCounts = {};
  const acidityCounts = {};
  const tanninCounts = {};
  const finishCounts = {};

  for (const profile of profiles) {
    // Fruits
    for (const term of profile.nose?.primary_fruit || []) {
      fruitCounts[term] = (fruitCounts[term] || 0) + 1;
    }
    // Secondary
    for (const term of profile.nose?.secondary || []) {
      secondaryCounts[term] = (secondaryCounts[term] || 0) + 1;
    }
    // Tertiary
    for (const term of profile.nose?.tertiary || []) {
      tertiaryCounts[term] = (tertiaryCounts[term] || 0) + 1;
    }
    // Texture
    for (const term of profile.palate?.texture || []) {
      textureCounts[term] = (textureCounts[term] || 0) + 1;
    }
    // Style tags
    for (const tag of profile.style_tags || []) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
    // Structural
    if (profile.nose?.intensity) {
      intensityCounts[profile.nose.intensity] = (intensityCounts[profile.nose.intensity] || 0) + 1;
    }
    if (profile.palate?.body) {
      bodyCounts[profile.palate.body] = (bodyCounts[profile.palate.body] || 0) + 1;
    }
    if (profile.palate?.acidity) {
      acidityCounts[profile.palate.acidity] = (acidityCounts[profile.palate.acidity] || 0) + 1;
    }
    if (profile.palate?.tannin) {
      tanninCounts[profile.palate.tannin] = (tanninCounts[profile.palate.tannin] || 0) + 1;
    }
    if (profile.finish?.length) {
      finishCounts[profile.finish.length] = (finishCounts[profile.finish.length] || 0) + 1;
    }
  }

  // Helper to get top terms by count
  const getTopTerms = (counts, threshold = 1, limit = 5) => {
    return Object.entries(counts)
      .filter(([_, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([term]) => term);
  };

  // Helper to get most common value
  const getMostCommon = (counts, defaultVal) => {
    const entries = Object.entries(counts);
    if (entries.length === 0) return defaultVal;
    return entries.sort((a, b) => b[1] - a[1])[0][0];
  };

  // Populate merged profile
  merged.nose.primary_fruit = getTopTerms(fruitCounts, 1, 5);
  merged.nose.secondary = getTopTerms(secondaryCounts, 1, 3);
  merged.nose.tertiary = getTopTerms(tertiaryCounts, 1, 3);
  merged.palate.texture = getTopTerms(textureCounts, 1, 3);
  merged.style_tags = getTopTerms(tagCounts, 1, 5);

  merged.nose.intensity = getMostCommon(intensityCounts, 'medium');
  merged.palate.body = getMostCommon(bodyCounts, 'medium');
  merged.palate.acidity = getMostCommon(acidityCounts, 'medium');
  merged.palate.tannin = Object.keys(tanninCounts).length > 0
    ? getMostCommon(tanninCounts, 'medium') : null;
  merged.finish.length = getMostCommon(finishCounts, 'medium');

  // Generate summary from merged data
  merged.summary_bullets = generateSummaryBullets(merged);

  // Calculate merged confidence (average of source confidences)
  const confidences = profiles.map(p => p.extraction?.confidence || 0.5);
  merged.extraction.confidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;

  return merged;
}

export default {
  extractTastingProfile,
  extractTastingProfileDeterministic,
  extractAndMergeProfiles
};
