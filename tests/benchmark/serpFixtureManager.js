/**
 * @fileoverview Manages SERP snapshot fixtures with validation and compression.
 * Supports loading benchmark cases, fixture CRUD, and staleness detection.
 */

import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Security: Limit decompression size (CWE-409 protection)
const MAX_DECOMPRESSED_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_COMPRESSION_RATIO = 100; // Max 100:1 compression ratio

// Default paths
const DEFAULT_BENCHMARK_PATH = path.join(__dirname, '../fixtures/Search_Benchmark_v2_2.json');
const DEFAULT_FIXTURE_DIR = path.join(__dirname, '../fixtures/serp-snapshots');

/**
 * Load benchmark cases from JSON file.
 * @param {string} [benchmarkPath] - Optional custom path to benchmark file
 * @returns {Promise<BenchmarkCase[]>}
 */
export async function loadBenchmarkCases(benchmarkPath = DEFAULT_BENCHMARK_PATH) {
  const content = await fs.readFile(benchmarkPath, 'utf8');
  const data = JSON.parse(content);

  if (!data.cases || !Array.isArray(data.cases)) {
    throw new Error('Invalid benchmark file: missing cases array');
  }

  return data.cases;
}

/**
 * Load full benchmark file including metadata.
 * @param {string} [benchmarkPath] - Optional custom path to benchmark file
 * @returns {Promise<BenchmarkFile>}
 */
export async function loadBenchmarkFile(benchmarkPath = DEFAULT_BENCHMARK_PATH) {
  const content = await fs.readFile(benchmarkPath, 'utf8');
  return JSON.parse(content);
}

/**
 * Load SERP fixture for a specific case.
 * @param {string} caseId - Benchmark case ID
 * @param {string} [fixtureDir] - Directory containing fixtures
 * @returns {Promise<SerpResponse>}
 * @throws {Error} If fixture not found or decompression fails
 */
export async function loadFixture(caseId, fixtureDir = DEFAULT_FIXTURE_DIR) {
  // Try compressed first, then uncompressed
  const gzPath = path.join(fixtureDir, `${caseId}.json.gz`);
  const jsonPath = path.join(fixtureDir, `${caseId}.json`);

  let content;
  let isCompressed = false;

  try {
    const stats = await fs.stat(gzPath);

    // Security check: Validate file size before reading
    if (stats.size * MAX_COMPRESSION_RATIO > MAX_DECOMPRESSED_SIZE) {
      throw new Error(`Fixture ${caseId} exceeds safe decompression ratio`);
    }

    const compressed = await fs.readFile(gzPath);
    const decompressed = await gunzip(compressed);

    // Security check: Validate decompressed size
    if (decompressed.length > MAX_DECOMPRESSED_SIZE) {
      throw new Error(`Fixture ${caseId} exceeds max size after decompression`);
    }

    content = decompressed.toString('utf8');
    isCompressed = true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Try uncompressed
      try {
        content = await fs.readFile(jsonPath, 'utf8');
      } catch (err2) {
        if (err2.code === 'ENOENT') {
          throw new Error(`Missing fixture for ${caseId}. Run in RECORD mode first.`);
        }
        throw err2;
      }
    } else {
      throw err;
    }
  }

  const fixture = JSON.parse(content);

  return {
    ...fixture,
    _fixtureInfo: {
      caseId,
      isCompressed,
      path: isCompressed ? gzPath : jsonPath
    }
  };
}

/**
 * Save SERP response as compressed fixture.
 * @param {string} caseId - Benchmark case ID
 * @param {SerpResponse} response - SERP response to save
 * @param {string} [fixtureDir] - Directory to save fixtures
 * @param {boolean} [compress=true] - Whether to gzip compress
 */
export async function saveFixture(caseId, response, fixtureDir = DEFAULT_FIXTURE_DIR, compress = true) {
  await fs.mkdir(fixtureDir, { recursive: true });

  // Add metadata for provenance
  const fixture = {
    _meta: {
      caseId,
      capturedAt: new Date().toISOString(),
      fixtureVersion: 1
    },
    ...response
  };

  const json = JSON.stringify(fixture, null, 2);

  if (compress) {
    const compressed = await gzip(json);
    const fixturePath = path.join(fixtureDir, `${caseId}.json.gz`);
    await fs.writeFile(fixturePath, compressed);
  } else {
    const fixturePath = path.join(fixtureDir, `${caseId}.json`);
    await fs.writeFile(fixturePath, json, 'utf8');
  }
}

/**
 * Delete a fixture.
 * @param {string} caseId - Benchmark case ID
 * @param {string} [fixtureDir] - Directory containing fixtures
 */
export async function deleteFixture(caseId, fixtureDir = DEFAULT_FIXTURE_DIR) {
  const gzPath = path.join(fixtureDir, `${caseId}.json.gz`);
  const jsonPath = path.join(fixtureDir, `${caseId}.json`);

  try {
    await fs.unlink(gzPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  try {
    await fs.unlink(jsonPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Check if fixture exists for a case.
 * @param {string} caseId - Benchmark case ID
 * @param {string} [fixtureDir] - Directory containing fixtures
 * @returns {Promise<boolean>}
 */
export async function fixtureExists(caseId, fixtureDir = DEFAULT_FIXTURE_DIR) {
  const gzPath = path.join(fixtureDir, `${caseId}.json.gz`);
  const jsonPath = path.join(fixtureDir, `${caseId}.json`);

  try {
    await fs.access(gzPath);
    return true;
  } catch {
    try {
      await fs.access(jsonPath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * List all fixture case IDs.
 * @param {string} [fixtureDir] - Directory containing fixtures
 * @returns {Promise<string[]>} Array of case IDs
 */
export async function listFixtures(fixtureDir = DEFAULT_FIXTURE_DIR) {
  try {
    const files = await fs.readdir(fixtureDir);
    const caseIds = new Set();

    for (const file of files) {
      if (file.endsWith('.json.gz')) {
        caseIds.add(file.replace('.json.gz', ''));
      } else if (file.endsWith('.json')) {
        caseIds.add(file.replace('.json', ''));
      }
    }

    return Array.from(caseIds).sort();
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Check single fixture staleness.
 * @param {object} fixture - Loaded fixture with _meta
 * @param {number} [maxAgeDays=30] - Maximum age in days before considered stale
 * @returns {StalenessInfo}
 */
export function checkSingleFixtureStaleness(fixture, maxAgeDays = 30) {
  const capturedAt = fixture._meta?.capturedAt
    ? new Date(fixture._meta.capturedAt)
    : null;

  if (!capturedAt || isNaN(capturedAt.getTime())) {
    return {
      isStale: true,
      ageDays: null,
      capturedAt: null,
      reason: 'Missing or invalid capturedAt timestamp'
    };
  }

  const ageMs = Date.now() - capturedAt.getTime();
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  return {
    isStale: ageDays > maxAgeDays,
    ageDays,
    capturedAt: fixture._meta.capturedAt,
    reason: ageDays > maxAgeDays ? `Fixture is ${ageDays} days old (max: ${maxAgeDays})` : null
  };
}

/**
 * Check staleness of all fixtures.
 * @param {number} [maxAgeDays=30] - Maximum age in days before considered stale
 * @param {string} [fixtureDir] - Directory containing fixtures
 * @returns {Promise<AllFixturesStalenessReport>}
 */
export async function checkFixtureStaleness(maxAgeDays = 30, fixtureDir = DEFAULT_FIXTURE_DIR) {
  const fixtureIds = await listFixtures(fixtureDir);
  const staleFixtures = [];
  let oldestAge = 0;
  let newestAge = Infinity;

  for (const caseId of fixtureIds) {
    try {
      const fixture = await loadFixture(caseId, fixtureDir);
      const staleness = checkSingleFixtureStaleness(fixture, maxAgeDays);

      if (staleness.ageDays !== null) {
        oldestAge = Math.max(oldestAge, staleness.ageDays);
        newestAge = Math.min(newestAge, staleness.ageDays);
      }

      if (staleness.isStale) {
        staleFixtures.push({
          caseId,
          ageDays: staleness.ageDays,
          capturedAt: staleness.capturedAt
        });
      }
    } catch (err) {
      // Fixture load failed, consider it stale
      staleFixtures.push({
        caseId,
        ageDays: null,
        capturedAt: null,
        error: err.message
      });
    }
  }

  return {
    totalFixtures: fixtureIds.length,
    staleCount: staleFixtures.length,
    freshCount: fixtureIds.length - staleFixtures.length,
    oldestAge: oldestAge === 0 ? null : oldestAge,
    newestAge: newestAge === Infinity ? null : newestAge,
    staleFixtures
  };
}

/**
 * Get fixture coverage report.
 * @param {string} [benchmarkPath] - Path to benchmark file
 * @param {string} [fixtureDir] - Directory containing fixtures
 * @returns {Promise<CoverageReport>}
 */
export async function getFixtureCoverage(benchmarkPath = DEFAULT_BENCHMARK_PATH, fixtureDir = DEFAULT_FIXTURE_DIR) {
  const cases = await loadBenchmarkCases(benchmarkPath);
  const existingFixtures = await listFixtures(fixtureDir);
  const existingSet = new Set(existingFixtures);

  const missing = [];
  const present = [];

  for (const testCase of cases) {
    if (existingSet.has(testCase.id)) {
      present.push(testCase.id);
    } else {
      missing.push(testCase.id);
    }
  }

  return {
    total: cases.length,
    present: present.length,
    missing: missing.length,
    coverage: present.length / cases.length,
    missingIds: missing,
    presentIds: present
  };
}

/**
 * Validate live expectations against SERP response.
 * @param {SerpResponse} serpResponse - Live SERP response
 * @param {ExpectedConstraints} expected - Expected constraints from benchmark case
 * @returns {ValidationResult}
 */
export function validateLiveExpectations(serpResponse, expected) {
  const errors = [];
  const warnings = [];

  if (!expected) {
    return { valid: true, errors, warnings };
  }

  const results = serpResponse.organic || serpResponse.results || [];

  // Check min_results
  if (expected.min_results && results.length < expected.min_results) {
    errors.push(`Expected at least ${expected.min_results} results, got ${results.length}`);
  }

  // Check must_include_domains
  if (expected.must_include_domains?.length > 0) {
    const foundDomains = new Set();

    for (const result of results) {
      const url = result.link || result.url || '';
      try {
        const domain = new URL(url).hostname.replace(/^www\./, '');
        foundDomains.add(domain);
      } catch {
        // Invalid URL, skip
      }
    }

    for (const requiredDomain of expected.must_include_domains) {
      const normalizedRequired = requiredDomain.replace(/^www\./, '');
      if (!foundDomains.has(normalizedRequired)) {
        warnings.push(`Expected domain ${requiredDomain} not found in results`);
      }
    }
  }

  // Check must_include_source_types (informational only - hard to verify)
  if (expected.must_include_source_types?.length > 0) {
    warnings.push(`Source type validation not implemented: ${expected.must_include_source_types.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export default {
  loadBenchmarkCases,
  loadBenchmarkFile,
  loadFixture,
  saveFixture,
  deleteFixture,
  fixtureExists,
  listFixtures,
  checkSingleFixtureStaleness,
  checkFixtureStaleness,
  getFixtureCoverage,
  validateLiveExpectations,
  DEFAULT_BENCHMARK_PATH,
  DEFAULT_FIXTURE_DIR
};
