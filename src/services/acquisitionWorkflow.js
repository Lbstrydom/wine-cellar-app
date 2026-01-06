/**
 * @fileoverview Acquisition workflow service for Scan → Confirm → Place flow.
 * Orchestrates wine capture, enrichment, and placement suggestions.
 * @module services/acquisitionWorkflow
 */

import { parseWineFromImage, parseWineFromText, fetchWineRatings, saveExtractedWindows } from './claude.js';
import { findBestZone, findAvailableSlot } from './cellarPlacement.js';
import { categoriseWine, getFridgeStatus, selectFridgeFillCandidates, calculateParLevelGaps } from './fridgeStocking.js';
import db from '../db/index.js';
import logger from '../utils/logger.js';

/**
 * Field confidence levels.
 */
const CONFIDENCE_LEVELS = {
  HIGH: 'high',      // Clearly visible/readable
  MEDIUM: 'medium',  // Partially visible or inferred
  LOW: 'low',        // Guessed or uncertain
  MISSING: 'missing' // Not found
};

/**
 * Confidence thresholds for highlighting uncertain fields.
 */
const UNCERTAIN_THRESHOLD = 'medium';

/**
 * Parse wine from image with per-field confidence.
 * @param {string} base64Image - Base64 encoded image
 * @param {string} mediaType - Image MIME type
 * @returns {Promise<Object>} Parsed wine with field confidences
 */
export async function parseWineWithConfidence(base64Image, mediaType) {
  const result = await parseWineFromImage(base64Image, mediaType);

  // Extract wines with confidence analysis
  const winesWithConfidence = (result.wines || []).map(wine => {
    const fieldConfidences = analyzeFieldConfidence(wine, result.confidence, result.parse_notes);

    return {
      ...wine,
      _fieldConfidences: fieldConfidences,
      _uncertainFields: Object.entries(fieldConfidences)
        .filter(([_, conf]) => isUncertain(conf))
        .map(([field]) => field),
      _overallConfidence: result.confidence
    };
  });

  return {
    wines: winesWithConfidence,
    confidence: result.confidence,
    parse_notes: result.parse_notes
  };
}

/**
 * Analyze confidence for each field based on value presence and parse notes.
 * @param {Object} wine - Parsed wine data
 * @param {string} overallConfidence - Overall parse confidence
 * @param {string} parseNotes - Notes about assumptions made
 * @returns {Object} Field confidence map
 */
function analyzeFieldConfidence(wine, overallConfidence, parseNotes) {
  const confidences = {};
  const notesLower = (parseNotes || '').toLowerCase();

  // Core required fields
  confidences.wine_name = wine.wine_name
    ? (overallConfidence === 'high' ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.MEDIUM)
    : CONFIDENCE_LEVELS.MISSING;

  // Vintage - often missing or uncertain
  if (wine.vintage) {
    confidences.vintage = CONFIDENCE_LEVELS.HIGH;
  } else if (notesLower.includes('nv') || notesLower.includes('non-vintage')) {
    confidences.vintage = CONFIDENCE_LEVELS.MEDIUM; // NV is intentional
  } else {
    confidences.vintage = CONFIDENCE_LEVELS.MISSING;
  }

  // Colour - often inferred from grape variety
  if (wine.colour) {
    confidences.colour = notesLower.includes('inferred') || notesLower.includes('guessed')
      ? CONFIDENCE_LEVELS.MEDIUM
      : CONFIDENCE_LEVELS.HIGH;
  } else {
    confidences.colour = CONFIDENCE_LEVELS.MISSING;
  }

  // Style/grape variety
  confidences.style = wine.style
    ? CONFIDENCE_LEVELS.HIGH
    : CONFIDENCE_LEVELS.MISSING;

  // Optional fields
  confidences.price_eur = wine.price_eur ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.MISSING;
  confidences.country = wine.country ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.MISSING;
  confidences.region = wine.region ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.MISSING;
  confidences.alcohol_pct = wine.alcohol_pct ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.MISSING;

  // If overall confidence is low, downgrade all field confidences
  if (overallConfidence === 'low') {
    for (const field of Object.keys(confidences)) {
      if (confidences[field] === CONFIDENCE_LEVELS.HIGH) {
        confidences[field] = CONFIDENCE_LEVELS.MEDIUM;
      }
    }
  }

  return confidences;
}

/**
 * Check if a confidence level is uncertain (needs user review).
 * @param {string} confidence - Confidence level
 * @returns {boolean} True if uncertain
 */
function isUncertain(confidence) {
  return confidence === CONFIDENCE_LEVELS.MEDIUM ||
         confidence === CONFIDENCE_LEVELS.LOW ||
         confidence === CONFIDENCE_LEVELS.MISSING;
}

/**
 * Get enrichment data for a wine (ratings, drinking windows).
 * Runs asynchronously and can be called after wine is saved.
 * @param {Object} wine - Wine object (must have id for DB wine)
 * @returns {Promise<Object>} Enrichment data
 */
export async function enrichWineData(wine) {
  const enrichment = {
    ratings: null,
    drinkingWindows: null,
    error: null
  };

  try {
    // Fetch ratings from web
    const ratingsResult = await fetchWineRatings(wine);
    enrichment.ratings = ratingsResult;

    // Extract and save drinking windows if wine has ID
    if (wine.id && ratingsResult.ratings && ratingsResult.ratings.length > 0) {
      const windowsSaved = await saveExtractedWindows(wine.id, ratingsResult.ratings);
      enrichment.drinkingWindowsSaved = windowsSaved;
    }

    // Extract any drinking windows found
    const windows = (ratingsResult.ratings || [])
      .filter(r => r.drinking_window && (r.drinking_window.drink_from_year || r.drinking_window.drink_by_year))
      .map(r => ({
        source: r.source,
        ...r.drinking_window
      }));

    if (windows.length > 0) {
      enrichment.drinkingWindows = windows;
    }

  } catch (err) {
    logger.error('AcquisitionWorkflow', `Enrichment failed: ${err.message}`);
    enrichment.error = err.message;
  }

  return enrichment;
}

/**
 * Get placement suggestion for a wine (zone + fridge eligibility).
 * @param {Object} wine - Wine object
 * @returns {Promise<Object>} Placement suggestion
 */
export async function suggestPlacement(wine) {
  // Get zone suggestion
  const zoneMatch = await findBestZone(wine);

  // Get occupied slots for slot finding
  const occupiedSlotsResult = await db.prepare('SELECT location_code FROM slots WHERE wine_id IS NOT NULL').all();
  const occupiedSlots = new Set(occupiedSlotsResult.map(s => s.location_code));

  // Find available slot in suggested zone
  let suggestedSlot = null;
  if (zoneMatch.zoneId !== 'unclassified') {
    const slotResult = await findAvailableSlot(zoneMatch.zoneId, occupiedSlots, wine);
    if (slotResult) {
      suggestedSlot = slotResult.slotId;
    }
  }

  // Check fridge eligibility
  const fridgeCategory = categoriseWine(wine);
  let fridgeEligible = false;
  let fridgeReason = null;

  if (fridgeCategory) {
    // Get current fridge contents
    const fridgeWines = await db.prepare(`
      SELECT w.*, s.location_code as slot_id
      FROM wines w
      JOIN slots s ON s.wine_id = w.id
      WHERE s.location_code LIKE 'F%'
    `).all();

    const fridgeStatus = getFridgeStatus(fridgeWines);
    const gaps = fridgeStatus.parLevelGaps;

    if (gaps[fridgeCategory] && gaps[fridgeCategory].need > 0 && fridgeStatus.emptySlots > 0) {
      fridgeEligible = true;
      fridgeReason = `Fills ${fridgeCategory} gap (need ${gaps[fridgeCategory].need} more)`;
    }
  }

  return {
    zone: {
      zoneId: zoneMatch.zoneId,
      displayName: zoneMatch.displayName,
      confidence: zoneMatch.confidence,
      reason: zoneMatch.reason,
      alternatives: zoneMatch.alternativeZones,
      requiresReview: zoneMatch.requiresReview
    },
    suggestedSlot,
    fridge: {
      eligible: fridgeEligible,
      category: fridgeCategory,
      reason: fridgeReason
    }
  };
}

/**
 * Check if wine doesn't fit existing zones (requires zone update).
 * @param {Object} zoneMatch - Zone match result
 * @returns {Object} Zone review suggestion
 */
export function checkZoneReview(zoneMatch) {
  if (!zoneMatch.requiresReview) {
    return { needsReview: false };
  }

  // Wine doesn't fit well into any zone
  return {
    needsReview: true,
    reason: zoneMatch.reason,
    suggestions: [
      {
        action: 'classify_manually',
        description: 'Choose a zone manually for this wine'
      },
      {
        action: 'update_zone_rules',
        description: 'Update zone definitions to accommodate this wine style'
      },
      {
        action: 'use_curiosities',
        description: 'Add to Curiosities zone for unusual wines'
      }
    ]
  };
}

/**
 * Complete acquisition workflow.
 * @param {Object} options - Workflow options
 * @param {string} [options.base64Image] - Base64 image for parsing
 * @param {string} [options.mediaType] - Image MIME type
 * @param {string} [options.text] - Text for parsing (alternative to image)
 * @param {Object} [options.confirmedData] - User-confirmed wine data (after review)
 * @param {boolean} [options.skipEnrichment] - Skip ratings/windows fetch
 * @param {string} [options.targetSlot] - Specific slot to place in
 * @returns {Promise<Object>} Complete workflow result
 */
export async function runAcquisitionWorkflow(options) {
  const result = {
    step: 'parse',
    wines: [],
    selectedWine: null,
    placement: null,
    enrichment: null,
    zoneReview: null,
    errors: []
  };

  try {
    // Step 1: Parse wine from image or text
    if (options.confirmedData) {
      // User has confirmed/edited the wine data
      result.selectedWine = options.confirmedData;
      result.step = 'confirmed';
    } else if (options.base64Image) {
      const parseResult = await parseWineWithConfidence(options.base64Image, options.mediaType);
      result.wines = parseResult.wines;
      result.confidence = parseResult.confidence;
      result.parse_notes = parseResult.parse_notes;

      if (result.wines.length === 0) {
        result.errors.push('No wine details found in image');
        return result;
      }

      // Auto-select first wine if only one
      if (result.wines.length === 1) {
        result.selectedWine = result.wines[0];
      }

      result.step = 'review';
    } else if (options.text) {
      const parseResult = await parseWineFromText(options.text);
      result.wines = parseResult.wines.map(wine => ({
        ...wine,
        _fieldConfidences: analyzeFieldConfidence(wine, parseResult.confidence, parseResult.parse_notes),
        _uncertainFields: [],
        _overallConfidence: parseResult.confidence
      }));
      result.confidence = parseResult.confidence;

      if (result.wines.length === 1) {
        result.selectedWine = result.wines[0];
      }

      result.step = 'review';
    }

    // If we have a selected wine, continue with placement suggestion
    if (result.selectedWine) {
      // Step 2: Get placement suggestion
      result.placement = suggestPlacement(result.selectedWine);

      // Step 3: Check if zone review is needed
      result.zoneReview = checkZoneReview(result.placement.zone);

      // Step 4: Enrichment (async, optional)
      if (!options.skipEnrichment) {
        result.enrichment = await enrichWineData(result.selectedWine);
      }

      result.step = 'ready';
    }

  } catch (err) {
    logger.error('AcquisitionWorkflow', `Workflow error: ${err.message}`);
    result.errors.push(err.message);
  }

  return result;
}

/**
 * Save wine from acquisition workflow.
 * @param {Object} wineData - Wine data to save
 * @param {Object} options - Save options
 * @param {string} [options.slot] - Specific slot to place in
 * @param {number} [options.quantity] - Number of bottles (default 1)
 * @param {boolean} [options.addToFridge] - Add to fridge instead of cellar
 * @returns {Promise<Object>} Save result
 */
export async function saveAcquiredWine(wineData, options = {}) {
  const quantity = options.quantity || 1;

  // Create wine in database
  const insertResult = db.prepare(`
    INSERT INTO wines (
      wine_name, vintage, colour, style, vivino_rating, price_eur,
      country, region, alcohol_pct, drink_from, drink_until,
      vivino_id, vivino_url, vivino_confirmed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    wineData.wine_name,
    wineData.vintage || null,
    wineData.colour || 'white',
    wineData.style || null,
    wineData.vivino_rating || null,
    wineData.price_eur || null,
    wineData.country || null,
    wineData.region || null,
    wineData.alcohol_pct || null,
    wineData.drink_from || null,
    wineData.drink_until || null,
    wineData.vivino_id || null,
    wineData.vivino_url || null,
    wineData.vivino_confirmed ? 1 : 0
  );

  const wineId = insertResult.lastInsertRowid;

  // Determine slot(s) for bottles
  let targetSlot = options.slot;

  if (!targetSlot) {
    // Get placement suggestion
    const placement = suggestPlacement({ ...wineData, id: wineId });
    targetSlot = placement.suggestedSlot;

    // If fridge eligible and user wants fridge, find fridge slot
    if (options.addToFridge && placement.fridge.eligible) {
      const fridgeSlots = db.prepare(
        "SELECT location_code FROM slots WHERE location_code LIKE 'F%' AND wine_id IS NULL ORDER BY location_code"
      ).all();
      if (fridgeSlots.length > 0) {
        targetSlot = fridgeSlots[0].location_code;
      }
    }
  }

  // Add bottles to slots
  const addedSlots = [];
  if (targetSlot) {
    for (let i = 0; i < quantity; i++) {
      // Find next available slot (for multiple bottles)
      let slotToUse = targetSlot;
      if (i > 0) {
        // Find next consecutive slot
        const match = targetSlot.match(/^(R\d+C)(\d+)$/);
        if (match) {
          const nextCol = parseInt(match[2]) + i;
          slotToUse = `${match[1]}${nextCol}`;
        } else if (targetSlot.startsWith('F')) {
          const fridgeNum = parseInt(targetSlot.slice(1)) + i;
          slotToUse = `F${fridgeNum}`;
        }
      }

      // Check if slot is available
      const existing = db.prepare('SELECT id FROM slots WHERE location_code = ? AND wine_id IS NOT NULL').get(slotToUse);
      if (!existing) {
        db.prepare(`
          INSERT INTO slots (location_code, wine_id)
          VALUES (?, ?)
          ON CONFLICT(location_code) DO UPDATE SET wine_id = excluded.wine_id
        `).run(slotToUse, wineId);
        addedSlots.push(slotToUse);
      }
    }
  }

  // Start enrichment in background
  enrichWineData({ ...wineData, id: wineId }).then(enrichment => {
    if (enrichment.ratings && enrichment.ratings.ratings) {
      logger.info('AcquisitionWorkflow', `Enrichment complete: ${enrichment.ratings.ratings.length} ratings found`);
    }
  }).catch(err => {
    logger.error('AcquisitionWorkflow', `Background enrichment failed: ${err.message}`);
  });

  return {
    wineId,
    slots: addedSlots,
    message: addedSlots.length > 0
      ? `Added ${addedSlots.length} bottle(s) to ${addedSlots.join(', ')}`
      : `Wine created (ID: ${wineId}), no slot assigned`
  };
}

export const CONFIDENCE_LEVELS_EXPORT = CONFIDENCE_LEVELS;
