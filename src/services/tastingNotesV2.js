/**
 * @fileoverview Tasting notes v2 service.
 * Converts extracted profiles to v2 structured format per Wine Detail Panel Spec.
 * @module services/tastingNotesV2
 */

import { extractTastingProfile, extractAndMergeProfiles } from './tastingExtractor.js';
import {
  NORMALISER_VERSION,
  normaliseDescriptor,
  normaliseStructureValue,
  groupByCategory,
  toDisplayFormat
} from './vocabularyNormaliser.js';
import db from '../db/index.js';

/**
 * Schema version for structured tasting notes.
 */
export const SCHEMA_VERSION = '2.0';

/**
 * Wine type mappings.
 */
const WINE_TYPE_MAP = {
  white: 'still_white',
  red: 'still_red',
  rosé: 'still_rosé',
  rose: 'still_rosé',
  orange: 'orange',
  sparkling: 'sparkling',
  fortified: 'fortified',
  dessert: 'dessert'
};

/**
 * Map colour to wine type.
 * @param {string} colour - Wine colour
 * @param {Object} wineInfo - Additional wine info
 * @returns {string} Wine type enum value
 */
function getWineType(colour, wineInfo = {}) {
  // Check for special types first
  if (wineInfo.style?.toLowerCase().includes('sparkling') ||
      wineInfo.style?.toLowerCase().includes('champagne') ||
      wineInfo.style?.toLowerCase().includes('prosecco') ||
      wineInfo.style?.toLowerCase().includes('cava')) {
    return 'sparkling';
  }
  
  if (wineInfo.style?.toLowerCase().includes('port') ||
      wineInfo.style?.toLowerCase().includes('sherry') ||
      wineInfo.style?.toLowerCase().includes('madeira') ||
      wineInfo.style?.toLowerCase().includes('fortified')) {
    return 'fortified';
  }
  
  if (wineInfo.sweetness?.toLowerCase().includes('dessert') ||
      wineInfo.style?.toLowerCase().includes('dessert') ||
      wineInfo.style?.toLowerCase().includes('sauternes') ||
      wineInfo.style?.toLowerCase().includes('icewine')) {
    return 'dessert';
  }
  
  const lower = (colour || '').toLowerCase();
  return WINE_TYPE_MAP[lower] || 'still_red';
}

/**
 * Generate style fingerprint from profile.
 * Max 120 characters summarising the wine's character.
 * @param {Object} profile - Extracted profile
 * @param {string} wineType - Wine type
 * @returns {string} Style fingerprint
 */
function generateStyleFingerprint(profile, wineType) {
  const parts = [];
  
  // Sweetness (if not bone-dry)
  const sweetness = profile.structure?.sweetness || profile.palate?.sweetness || 'dry';
  if (sweetness !== 'dry' && sweetness !== 'bone-dry') {
    parts.push(toDisplayFormat(sweetness));
  }
  
  // Acidity
  const acidity = profile.structure?.acidity || profile.palate?.acidity;
  if (acidity && acidity !== 'medium') {
    parts.push(`${acidity} acid`);
  }
  
  // Wine type description
  const typeDescriptions = {
    still_white: 'white',
    still_red: 'red',
    still_rosé: 'rosé',
    orange: 'orange wine',
    sparkling: 'sparkling',
    fortified: 'fortified',
    dessert: 'dessert wine'
  };
  
  // Style modifiers
  const styleTags = profile.style_tags || [];
  if (styleTags.includes('fruit_forward')) {
    parts.push('fruit-forward');
  } else if (styleTags.includes('elegant')) {
    parts.push('elegant');
  } else if (styleTags.includes('powerful')) {
    parts.push('powerful');
  } else if (styleTags.includes('complex')) {
    parts.push('complex');
  }
  
  parts.push(typeDescriptions[wineType] || wineType.replace('still_', ''));
  
  // Key flavour notes
  const flavours = [];
  const fruits = profile.nose?.primary_fruit || profile.nose?.all_descriptors || [];
  if (fruits.length > 0) {
    // Group by category and pick representative
    const firstTwo = fruits.slice(0, 2).map(f => toDisplayFormat(f).toLowerCase());
    if (firstTwo.length > 0) {
      flavours.push(firstTwo.join(' and '));
    }
  }
  
  // Body
  const body = profile.structure?.body || profile.palate?.body || 'medium';
  if (body !== 'medium') {
    flavours.push(`${body} body`);
  }
  
  let fingerprint = parts.join(', ');
  if (flavours.length > 0) {
    fingerprint += '; ' + flavours.join(', ');
  }
  
  // Add period and ensure max length
  if (!fingerprint.endsWith('.')) {
    fingerprint += '.';
  }
  
  // Capitalise first letter
  fingerprint = fingerprint.charAt(0).toUpperCase() + fingerprint.slice(1);
  
  // Truncate if needed
  if (fingerprint.length > 120) {
    fingerprint = fingerprint.substring(0, 117) + '...';
  }
  
  return fingerprint;
}

/**
 * Calculate evidence strength from sources.
 * @param {Array} sources - Source array
 * @param {number} agreementScore - Agreement score 0-1
 * @returns {string} Evidence strength: strong, medium, weak
 */
function calculateEvidenceStrength(sources, agreementScore) {
  const sourceCount = sources?.length || 0;
  const sourceTypes = new Set((sources || []).map(s => s.type));
  const hasMultipleTypes = sourceTypes.size > 1;
  
  // Strong: 3+ sources, good agreement, multiple source types
  if (sourceCount >= 3 && agreementScore >= 0.7 && hasMultipleTypes) {
    return 'strong';
  }
  
  // Medium: 2+ sources with decent agreement OR 1 critic source
  if (sourceCount >= 2 && agreementScore >= 0.5) {
    return 'medium';
  }
  if (sourceCount === 1 && sources?.[0]?.type === 'critic') {
    return 'medium';
  }
  
  // Weak: single source, poor agreement, or community-only
  return 'weak';
}

/**
 * Detect contradictions in structural fields.
 * @param {Array<Object>} profiles - Multiple extraction profiles
 * @returns {Array<Object>} Detected contradictions
 */
function detectContradictions(profiles) {
  if (!profiles || profiles.length < 2) {
    return [];
  }
  
  const contradictions = [];
  const fields = ['sweetness', 'body', 'tannin', 'acidity'];
  
  for (const field of fields) {
    const values = profiles
      .map(p => p.palate?.[field] || p.structure?.[field])
      .filter(Boolean);
    
    if (values.length < 2) continue;
    
    const unique = [...new Set(values)];
    if (unique.length > 1) {
      // Count occurrences to find most common
      const counts = {};
      for (const v of values) {
        counts[v] = (counts[v] || 0) + 1;
      }
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const mostCommon = sorted[0][0];
      const count = sorted[0][1];
      const total = values.length;
      
      let resolution;
      if (count > total / 2) {
        resolution = `Most sources suggest ${mostCommon}`;
      } else {
        resolution = `Sources vary between ${unique.join(' and ')}`;
      }
      
      contradictions.push({
        field,
        values_found: unique,
        resolution
      });
    }
  }
  
  return contradictions;
}

/**
 * Calculate agreement score across profiles.
 * @param {Array<Object>} profiles - Multiple extraction profiles
 * @returns {number} Agreement score 0-1
 */
function calculateAgreementScore(profiles) {
  if (!profiles || profiles.length < 2) {
    return 1; // No disagreement possible with single source
  }
  
  const scores = [];
  const fields = ['sweetness', 'body', 'tannin', 'acidity'];
  
  for (const field of fields) {
    const values = profiles
      .map(p => p.palate?.[field] || p.structure?.[field])
      .filter(Boolean);
    
    if (values.length < 2) continue;
    
    const mostCommon = mode(values);
    const agreeing = values.filter(v => v === mostCommon).length;
    scores.push(agreeing / values.length);
  }
  
  return scores.length > 0
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 1;
}

/**
 * Get mode (most common value) from array.
 * @param {Array} arr - Array of values
 * @returns {*} Most common value
 */
function mode(arr) {
  const counts = {};
  for (const v of arr) {
    counts[v] = (counts[v] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Convert extracted profile to v2 schema format.
 * @param {Object} profile - Extracted profile from tastingExtractor
 * @param {Object} options - Conversion options
 * @returns {Object} V2 structured tasting notes
 */
export function convertToV2Schema(profile, options = {}) {
  const {
    wineInfo = {},
    sources = [],
    vintageSpecific = true,
    allProfiles = [] // For contradiction detection
  } = options;
  
  const wineType = getWineType(wineInfo.colour, wineInfo);
  
  // Build structure object
  const structure = {
    sweetness: normaliseStructureValue('sweetness', profile.palate?.sweetness) || 'dry',
    acidity: normaliseStructureValue('acidity', profile.palate?.acidity) || 'medium',
    body: normaliseStructureValue('body', profile.palate?.body) || 'medium',
    tannin: wineType === 'still_red' || wineType === 'orange'
      ? (normaliseStructureValue('tannin', profile.palate?.tannin) || 'medium')
      : null,
    alcohol: normaliseStructureValue('alcohol', profile.palate?.alcohol) || 'medium'
  };
  
  // Add sparkling-specific fields
  if (wineType === 'sparkling') {
    structure.mousse = normaliseStructureValue('mousse', profile.palate?.mousse) || null;
    structure.dosage = normaliseStructureValue('dosage', profile.palate?.dosage) || null;
  }
  
  // Build nose object
  const noseDescriptors = [
    ...(profile.nose?.primary_fruit || []),
    ...(profile.nose?.secondary || []),
    ...(profile.nose?.tertiary || [])
  ].map(d => normaliseDescriptor(d)).filter(Boolean);
  
  const noseCategories = groupByCategory(noseDescriptors.map(d => d.canonical));
  const noseAllDescriptors = noseDescriptors
    .map(d => d.canonical)
    .filter((v, i, a) => a.indexOf(v) === i); // Dedupe
  
  const nose = {
    intensity: normaliseStructureValue('intensity', profile.nose?.intensity) || 'medium',
    categories: noseCategories,
    all_descriptors: noseAllDescriptors
  };
  
  // Build palate object
  const palateDescriptors = [
    ...(profile.palate?.texture || [])
  ].map(d => normaliseDescriptor(d)).filter(Boolean);
  
  // Palate flavours often overlap with nose
  const palate = {
    categories: groupByCategory(palateDescriptors.map(d => d.canonical)),
    all_descriptors: palateDescriptors.map(d => d.canonical)
  };
  
  // Build finish object
  const finishDescriptors = (profile.finish?.notes || [])
    .map(d => normaliseDescriptor(d))
    .filter(Boolean)
    .slice(0, 5);
  
  const finish = {
    length: normaliseStructureValue('finish', profile.finish?.length) || 'medium',
    descriptors: finishDescriptors.map(d => d.canonical)
  };
  
  // Calculate evidence
  const agreementScore = calculateAgreementScore(allProfiles.length > 0 ? allProfiles : [profile]);
  const contradictions = detectContradictions(allProfiles);
  
  const sourceTypes = [...new Set(sources.map(s => s.type || 'unknown'))];
  
  const evidence = {
    strength: calculateEvidenceStrength(sources, agreementScore),
    source_count: sources.length || 1,
    source_types: sourceTypes.length > 0 ? sourceTypes : ['unknown'],
    agreement_score: agreementScore,
    contradictions
  };
  
  // Build v2 notes object
  const v2Notes = {
    version: SCHEMA_VERSION,
    normaliser_version: NORMALISER_VERSION,
    generated_at: new Date().toISOString(),
    wine_type: wineType,
    vintage_specific: vintageSpecific,
    
    style_fingerprint: generateStyleFingerprint({ ...profile, structure }, wineType),
    
    structure,
    nose,
    palate,
    finish,
    evidence,
    
    sources: sources.map(s => ({
      name: s.name || s.source_name || 'Unknown',
      type: s.type || s.source_type || 'unknown',
      url: s.url || s.source_url || null,
      snippet: s.snippet || null,
      retrieved_at: s.retrieved_at || new Date().toISOString()
    })),
    
    flags: {
      needs_review: false,
      user_reported: false,
      low_confidence: (profile.extraction?.confidence || 0.5) < 0.5,
      vintage_unknown: !vintageSpecific
    }
  };
  
  return v2Notes;
}

/**
 * Extract and convert to v2 in one operation.
 * @param {string} tastingNote - Raw tasting note text
 * @param {Object} options - Options
 * @returns {Promise<Object>} V2 structured notes
 */
export async function extractToV2(tastingNote, options = {}) {
  const {
    wineInfo = {},
    sourceId = 'unknown',
    sourceType = 'unknown',
    sourceUrl = null
  } = options;
  
  // Extract using existing service
  const profile = await extractTastingProfile(tastingNote, {
    sourceId,
    wineInfo
  });
  
  // Convert to v2
  const sources = [{
    name: sourceId,
    type: sourceType,
    url: sourceUrl,
    snippet: tastingNote.substring(0, 300),
    retrieved_at: new Date().toISOString()
  }];
  
  return convertToV2Schema(profile, {
    wineInfo,
    sources,
    vintageSpecific: Boolean(wineInfo.vintage)
  });
}

/**
 * Extract from multiple sources and merge to v2.
 * @param {Array<{note: string, source: Object}>} notes - Notes with source info
 * @param {Object} wineInfo - Wine context
 * @returns {Promise<Object>} V2 structured notes
 */
export async function extractMultipleToV2(notes, wineInfo = {}) {
  if (notes.length === 0) {
    return null;
  }
  
  // Extract all profiles
  const extractedNotes = notes.map(n => ({
    note: n.note,
    sourceId: n.source?.name || 'unknown'
  }));
  
  const mergedProfile = await extractAndMergeProfiles(extractedNotes, wineInfo);
  
  // Also extract individual for contradiction detection
  const allProfiles = [];
  for (const n of notes) {
    const p = await extractTastingProfile(n.note, { wineInfo });
    allProfiles.push(p);
  }
  
  // Build sources array
  const sources = notes.map(n => ({
    name: n.source?.name || 'Unknown',
    type: n.source?.type || 'unknown',
    url: n.source?.url || null,
    snippet: n.note?.substring(0, 300),
    retrieved_at: n.source?.retrieved_at || new Date().toISOString()
  }));
  
  return convertToV2Schema(mergedProfile, {
    wineInfo,
    sources,
    vintageSpecific: Boolean(wineInfo.vintage),
    allProfiles
  });
}

/**
 * Get v2 tasting notes for a wine from database.
 * @param {number} wineId - Wine ID
 * @returns {Promise<Object|null>} V2 structured notes or null
 */
export async function getWineTastingNotes(wineId) {
  const wine = await db.prepare(`
    SELECT 
      id, wine_name, colour, style, grapes, vintage,
      tasting_notes, tasting_notes_structured
    FROM wines WHERE id = ?
  `).get(wineId);
  
  if (!wine) {
    return null;
  }
  
  // Return structured if available
  if (wine.tasting_notes_structured) {
    try {
      return JSON.parse(wine.tasting_notes_structured);
    } catch {
      // Fall through to extract
    }
  }
  
  // Extract from legacy tasting_notes if available
  if (wine.tasting_notes) {
    const v2Notes = await extractToV2(wine.tasting_notes, {
      wineInfo: {
        colour: wine.colour,
        style: wine.style,
        grape: wine.grapes,
        vintage: wine.vintage
      },
      sourceId: 'legacy',
      sourceType: 'unknown'
    });
    
    // Save for future use
    await db.prepare(`
      UPDATE wines SET 
        tasting_notes_structured = ?,
        tasting_notes_version = ?,
        normaliser_version = ?,
        tasting_notes_generated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(JSON.stringify(v2Notes), SCHEMA_VERSION, NORMALISER_VERSION, wineId);
    
    return v2Notes;
  }
  
  return null;
}

/**
 * Save v2 tasting notes for a wine.
 * @param {number} wineId - Wine ID
 * @param {Object} notes - V2 structured notes
 * @returns {Promise<void>}
 */
export async function saveWineTastingNotes(wineId, notes) {
  await db.prepare(`
    UPDATE wines SET 
      tasting_notes_structured = ?,
      tasting_notes_version = ?,
      normaliser_version = ?,
      tasting_notes_generated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    JSON.stringify(notes),
    notes.version || SCHEMA_VERSION,
    notes.normaliser_version || NORMALISER_VERSION,
    wineId
  );
  
  // Save sources to separate table
  if (notes.sources && notes.sources.length > 0) {
    for (const source of notes.sources) {
      try {
        await db.prepare(`
          INSERT INTO tasting_note_sources (wine_id, source_name, source_type, source_url, snippet, retrieved_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (wine_id, source_url) DO UPDATE SET
            snippet = EXCLUDED.snippet,
            retrieved_at = EXCLUDED.retrieved_at
        `).run(
          wineId,
          source.name,
          source.type,
          source.url,
          source.snippet,
          source.retrieved_at
        );
      } catch (err) {
        // Ignore duplicate source errors
        console.warn(`[TastingNotes] Could not save source: ${err.message}`);
      }
    }
  }
}

/**
 * Report an issue with tasting notes.
 * @param {number} wineId - Wine ID
 * @param {string} issueType - Issue type
 * @param {string} details - Issue details
 * @returns {Promise<number>} Report ID
 */
export async function reportTastingNoteIssue(wineId, issueType, details) {
  const result = await db.prepare(`
    INSERT INTO tasting_note_reports (wine_id, issue_type, details)
    VALUES (?, ?, ?)
  `).run(wineId, issueType, details);
  
  // Mark wine as needing review
  await db.prepare(`
    UPDATE wines SET tasting_notes_user_reported = TRUE WHERE id = ?
  `).run(wineId);
  
  return result.lastInsertRowid || result.lastID;
}

export default {
  SCHEMA_VERSION,
  convertToV2Schema,
  extractToV2,
  extractMultipleToV2,
  getWineTastingNotes,
  saveWineTastingNotes,
  reportTastingNoteIssue
};
