/**
 * @fileoverview Producer domain discovery and registration service.
 * Auto-registers producer domains found during wine searches for later crawling.
 * @module services/producerDiscovery
 */

import db from '../db/index.js';
import logger from '../utils/logger.js';

/**
 * Register a discovered producer domain for verification and crawling.
 *
 * @param {string} url - Full URL that was discovered
 * @param {string} producerName - Producer name associated with the URL
 * @param {number|null} wineId - Wine ID that led to discovery (optional)
 * @param {string} discoveredVia - How it was discovered ('serp_search', 'wine_reference', 'manual')
 * @returns {Promise<{id: number, isNew: boolean, domain: string}>}
 */
export async function registerDiscoveredProducer(url, producerName, wineId = null, discoveredVia = 'serp_search') {
  try {
    // Extract domain from URL
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace(/^www\./, '');

    // Check if already registered
    const existing = await db.prepare(`
      SELECT id, status, crawl_enabled FROM producer_domains WHERE domain = $1
    `).get(domain);

    if (existing) {
      console.log(`[Discovery] Domain ${domain} already registered (status: ${existing.status})`);
      return { id: existing.id, isNew: false, domain };
    }

    // Insert new producer domain
    const result = await db.prepare(`
      INSERT INTO producer_domains (domain, producer_name, discovered_via, discovery_wine_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `).get(domain, producerName, discoveredVia, wineId);

    console.log(`[Discovery] Registered new producer domain: ${domain} (id: ${result.id})`);

    return { id: result.id, isNew: true, domain };

  } catch (err) {
    // Handle URL parsing errors
    if (err.code === 'ERR_INVALID_URL') {
      logger.warn('Discovery', `Invalid URL: ${url}`);
      return null;
    }
    throw err;
  }
}

/**
 * Verify a producer domain as legitimate.
 *
 * @param {string} domain - Domain to verify
 * @param {string} method - Verification method ('manual', 'auto_domain_match', 'known_producer')
 * @returns {Promise<boolean>}
 */
export async function verifyProducerDomain(domain, method = 'manual') {
  const result = await db.prepare(`
    UPDATE producer_domains SET
      status = 'verified',
      verified_at = NOW(),
      verification_method = $1,
      crawl_enabled = true,
      updated_at = NOW()
    WHERE domain = $2 AND status = 'pending'
  `).run(method, domain);

  if (result.changes > 0) {
    console.log(`[Discovery] Verified producer domain: ${domain} via ${method}`);
    return true;
  }

  return false;
}

/**
 * Reject a producer domain (e.g., not actually a producer site).
 *
 * @param {string} domain - Domain to reject
 * @param {string} reason - Reason for rejection
 * @returns {Promise<boolean>}
 */
export async function rejectProducerDomain(domain, reason = null) {
  const result = await db.prepare(`
    UPDATE producer_domains SET
      status = 'rejected',
      crawl_enabled = false,
      updated_at = NOW()
    WHERE domain = $1 AND status = 'pending'
  `).run(domain);

  if (result.changes > 0) {
    console.log(`[Discovery] Rejected producer domain: ${domain}${reason ? ` (${reason})` : ''}`);
    return true;
  }

  return false;
}

/**
 * Get pending producer domains awaiting verification.
 *
 * @param {number} limit - Maximum number to return
 * @returns {Promise<Array>}
 */
export async function getPendingProducerDomains(limit = 50) {
  return await db.prepare(`
    SELECT
      pd.*,
      w.wine_name as discovery_wine_name,
      w.producer as wine_producer
    FROM producer_domains pd
    LEFT JOIN wines w ON w.id = pd.discovery_wine_id
    WHERE pd.status = 'pending'
    ORDER BY pd.created_at ASC
    LIMIT $1
  `).all(limit);
}

/**
 * Get verified producer domains ready for crawling.
 *
 * @param {number} limit - Maximum number to return
 * @returns {Promise<Array>}
 */
export async function getCrawlableProducerDomains(limit = 20) {
  return await db.prepare(`
    SELECT * FROM producer_domains
    WHERE status = 'verified'
      AND crawl_enabled = true
      AND (next_crawl_after IS NULL OR next_crawl_after <= NOW())
    ORDER BY crawl_priority ASC, last_crawled_at ASC NULLS FIRST
    LIMIT $1
  `).all(limit);
}

/**
 * Auto-verify domains that match known producer patterns.
 * Uses domain-to-producer name similarity heuristics.
 *
 * @param {string} domain - Domain to check
 * @param {string} producerName - Expected producer name
 * @returns {Promise<boolean>} True if auto-verified
 */
export async function tryAutoVerify(domain, producerName) {
  if (!producerName) return false;

  // Normalize for comparison
  const normalizedDomain = domain.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedProducer = producerName.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Check if domain contains significant portion of producer name
  const producerWords = producerName.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const domainContainsProducer = producerWords.some(word =>
    normalizedDomain.includes(word.replace(/[^a-z0-9]/g, ''))
  );

  // Check if producer name contains domain (e.g., "kleinezalze" in "Kleine Zalze")
  const domainBase = domain.split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const producerContainsDomain = normalizedProducer.includes(domainBase) ||
    domainBase.includes(normalizedProducer.substring(0, Math.min(8, normalizedProducer.length)));

  if (domainContainsProducer || producerContainsDomain) {
    console.log(`[Discovery] Auto-verifying ${domain} (matches producer: ${producerName})`);
    return await verifyProducerDomain(domain, 'auto_domain_match');
  }

  return false;
}

/**
 * Get discovery statistics.
 *
 * @returns {Promise<{pending: number, verified: number, rejected: number, crawlEnabled: number}>}
 */
export async function getDiscoveryStats() {
  const stats = await db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'verified') as verified,
      COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
      COUNT(*) FILTER (WHERE crawl_enabled = true) as crawl_enabled
    FROM producer_domains
  `).get();

  return {
    pending: parseInt(stats.pending) || 0,
    verified: parseInt(stats.verified) || 0,
    rejected: parseInt(stats.rejected) || 0,
    crawlEnabled: parseInt(stats.crawl_enabled) || 0
  };
}

/**
 * Mark domain as unreachable after failed fetch attempts.
 *
 * @param {string} domain - Domain that couldn't be reached
 * @returns {Promise<boolean>}
 */
export async function markDomainUnreachable(domain) {
  const result = await db.prepare(`
    UPDATE producer_domains SET
      status = 'unreachable',
      crawl_enabled = false,
      updated_at = NOW()
    WHERE domain = $1
  `).run(domain);

  return result.changes > 0;
}

export default {
  registerDiscoveredProducer,
  verifyProducerDomain,
  rejectProducerDomain,
  getPendingProducerDomains,
  getCrawlableProducerDomains,
  tryAutoVerify,
  getDiscoveryStats,
  markDomainUnreachable
};
