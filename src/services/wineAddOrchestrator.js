/**
 * @fileoverview Wine add orchestrator for Phase 6 pipeline.
 * @module services/wineAddOrchestrator
 */

import crypto from 'crypto';
import db from '../db/index.js';
import FEATURE_FLAGS from '../config/featureFlags.js';
import { WineFingerprint, findAliases } from './wineFingerprint.js';
import { searchVivinoWines } from './vivinoSearch.js';
import { lookupWineSearchCache, storeWineSearchCache } from './searchCache.js';
import logger from '../utils/logger.js';

export const PIPELINE_VERSION = 1;

const AUTO_SELECT_CONFIG = {
  minTopScore: 0.9,
  maxSecondScore: 0.7,
  minMargin: 0.15,
  minEvidenceCount: 2
};

const BUDGET_CONFIG = {
  maxCostCentsPerRequest: 2,
  earlyStopConfidence: 0.92,
  earlyStopMinSources: 1
};

function normalizeInput(value) {
  if (!value) return '';
  return String(value).toLowerCase().trim();
}

function generateQueryHash(input) {
  const normalized = JSON.stringify(input, Object.keys(input).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function calculateNameSimilarity(wineName, query) {
  if (!wineName || !query) return 0;
  const normalize = str => str
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const wineNorm = normalize(wineName);
  const queryNorm = normalize(query);

  if (wineNorm.includes(queryNorm)) return 1.0;
  if (queryNorm.includes(wineNorm)) return 0.9;

  const wineTokens = new Set(wineNorm.split(' ').filter(t => t.length > 2));
  const queryTokens = queryNorm.split(' ').filter(t => t.length > 2);
  if (queryTokens.length === 0) return 0;

  let matchCount = 0;
  for (const token of queryTokens) {
    if (wineTokens.has(token)) matchCount++;
  }

  return matchCount / queryTokens.length;
}

function scoreMatch(match, input) {
  const reasons = [];
  let score = 0;
  let evidenceCount = 0;

  const nameScore = calculateNameSimilarity(match.name, input.wine_name);
  score += nameScore * 0.6;
  if (nameScore >= 0.7) {
    evidenceCount++;
    reasons.push('name_match');
  }

  if (input.vintage && match.vintage && Number(input.vintage) === Number(match.vintage)) {
    score += 0.15;
    evidenceCount++;
    reasons.push('vintage_match');
  }

  if (input.country && match.country &&
      normalizeInput(input.country) === normalizeInput(match.country)) {
    score += 0.1;
    evidenceCount++;
    reasons.push('country_match');
  }

  if (input.producer && match.winery?.name &&
      normalizeInput(match.winery.name).includes(normalizeInput(input.producer))) {
    score += 0.1;
    evidenceCount++;
    reasons.push('producer_match');
  }

  if (match.ratingCount && match.ratingCount > 100) {
    score += 0.05;
    reasons.push('rating_depth');
  }

  score = Math.min(score, 1);
  return { score, evidenceCount, reasons };
}

function shouldAutoSelect(matches) {
  if (matches.length === 0) return { autoSelect: false, reason: 'no_matches' };
  if (matches.length === 1) {
    return matches[0].confidence.score >= 0.85
      ? { autoSelect: true, match: matches[0], reason: 'single_high_confidence' }
      : { autoSelect: false, reason: 'single_low_confidence' };
  }

  const [top, second] = matches;
  const margin = top.confidence.score - second.confidence.score;

  if (top.confidence.score >= AUTO_SELECT_CONFIG.minTopScore &&
      second.confidence.score < AUTO_SELECT_CONFIG.maxSecondScore &&
      margin >= AUTO_SELECT_CONFIG.minMargin &&
      top.confidence.evidenceCount >= AUTO_SELECT_CONFIG.minEvidenceCount) {
    return { autoSelect: true, match: top, reason: 'clear_winner' };
  }

  return { autoSelect: false, reason: 'close_race' };
}

async function findDuplicateWines(cellarId, fingerprint) {
  const fingerprints = findAliases(fingerprint);
  const placeholders = fingerprints.map((_, i) => `$${i + 2}`).join(', ');
  const sql = [
    'SELECT id, wine_name, vintage, colour, style',
    'FROM wines',
    'WHERE cellar_id = $1 AND fingerprint IN (' + placeholders + ')',
    'ORDER BY wine_name'
  ].join('\n');
  const matches = await db.prepare(sql).all(cellarId, ...fingerprints);

  return matches;
}

async function recordSearchMetrics(cellarId, fingerprint, data) {
  try {
    await db.prepare(`
      INSERT INTO search_metrics
        (cellar_id, fingerprint, pipeline_version, latency_ms, total_cost_cents,
         extraction_method, match_confidence, stop_reason, details,
         vintage_mismatch_count, wrong_wine_count, identity_rejection_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `).run(
      cellarId,
      fingerprint,
      PIPELINE_VERSION,
      data.latencyMs || null,
      data.totalCostCents || 0,
      data.extractionMethod || null,
      data.matchConfidence || null,
      data.stopReason || null,
      JSON.stringify(data.details || {}),
      data.vintageMismatchCount || 0,
      data.wrongWineCount || 0,
      data.identityRejectionCount || 0
    );
  } catch (error) {
    // Metrics should never block the pipeline
    logger.warn('WineAdd', 'Metrics insert failed: ' + error.message);
  }
}

/**
 * Evaluate a wine add request for duplicates and external matches.
 * @param {Object} params
 * @param {number} params.cellarId
 * @param {Object} params.input
 * @param {boolean} [params.forceRefresh=false]
 * @returns {Promise<Object>}
 */
export async function evaluateWineAdd({ cellarId, input, forceRefresh = false }) {
  const startedAt = Date.now();
  const fingerprintData = WineFingerprint.generateWithVersion(input);

  if (!fingerprintData?.fingerprint) {
    return {
      fingerprint: null,
      fingerprint_version: WineFingerprint.FINGERPRINT_VERSION,
      matches: [],
      duplicates: []
    };
  }

  const { fingerprint, version } = fingerprintData;
  const queryHash = generateQueryHash({
    wine_name: normalizeInput(input.wine_name),
    producer: normalizeInput(input.producer),
    vintage: normalizeInput(input.vintage),
    country: normalizeInput(input.country),
    region: normalizeInput(input.region),
    colour: normalizeInput(input.colour)
  });

  if (FEATURE_FLAGS.SEARCH_CACHE_ENABLED && !forceRefresh) {
    const cached = await lookupWineSearchCache(cellarId, fingerprint, PIPELINE_VERSION);
    if (cached) {
      const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
      await recordSearchMetrics(cellarId, fingerprint, {
        latencyMs: Date.now() - startedAt,
        totalCostCents: 0,
        stopReason: 'cache_hit',
        details: { cacheHit: true }
      });
      return { ...parsed, cache_hit: true };
    }
  }

  const duplicates = await findDuplicateWines(cellarId, fingerprint);

  let matches = [];
  let stopReason = 'no_external_search';

  const searchAvailable = !!process.env.BRIGHTDATA_API_KEY;

  if (FEATURE_FLAGS.WINE_ADD_ORCHESTRATOR_ENABLED && searchAvailable) {
    const searchResults = await searchVivinoWines({
      query: input.wine_name,
      producer: input.producer,
      vintage: input.vintage,
      country: input.country,
      colour: input.colour
    });

    matches = (searchResults.matches || []).map(match => {
      const confidence = scoreMatch(match, input);
      return {
        source: 'vivino',
        external_id: match.vivinoId ? String(match.vivinoId) : null,
        external_url: match.vivinoUrl,
        name: match.name,
        vintage: match.vintage,
        rating: match.rating,
        rating_count: match.ratingCount,
        winery: match.winery,
        region: match.region,
        country: match.country,
        grape_variety: match.grapeVariety,
        confidence,
        evidence: {
          confidence_score: confidence.score,
          reasons: confidence.reasons
        }
      };
    }).sort((a, b) => b.confidence.score - a.confidence.score);

    if (matches.length > 0 && matches[0].confidence.score >= BUDGET_CONFIG.earlyStopConfidence) {
      stopReason = 'high_confidence';
    } else if (matches.length === 0) {
      stopReason = 'no_matches';
    } else {
      stopReason = 'matches_found';
    }
  }

  const autoSelect = shouldAutoSelect(matches);
  const response = {
    fingerprint,
    fingerprint_version: version,
    pipeline_version: PIPELINE_VERSION,
    query_hash: queryHash,
    duplicates,
    matches,
    auto_select: autoSelect,
    cache_hit: false
  };

  if (FEATURE_FLAGS.SEARCH_CACHE_ENABLED) {
    await storeWineSearchCache(cellarId, fingerprint, queryHash, PIPELINE_VERSION, response);
  }

  await recordSearchMetrics(cellarId, fingerprint, {
    latencyMs: Date.now() - startedAt,
    totalCostCents: 0,
    extractionMethod: matches.length > 0 ? 'structured' : null,
    matchConfidence: matches[0]?.confidence?.score || null,
    stopReason,
    details: {
      matchCount: matches.length,
      duplicateCount: duplicates.length,
      cacheHit: false
    }
  });

  return response;
}

export default {
  evaluateWineAdd,
  PIPELINE_VERSION
};
