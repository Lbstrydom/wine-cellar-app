/**
 * @fileoverview Generate human-readable and machine-parseable benchmark reports.
 * Supports console output, JSON export, and CI-friendly summaries.
 *
 * @module tests/benchmark/metricsReporter
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RESULTS_DIR = path.join(__dirname, 'results');

/**
 * Generate comprehensive benchmark report.
 * @param {CaseResult[]} results - Individual case results
 * @param {BenchmarkMetrics} metrics - Aggregate metrics
 * @param {Object} categoryMetrics - Metrics grouped by challenge category
 * @param {Object} options
 * @param {string} options.mode - Benchmark mode used
 * @param {Object} options.thresholds - Pass thresholds
 * @param {Object[]} [options.errors] - Any errors that occurred
 * @returns {BenchmarkReport}
 */
export function generateReport(results, metrics, categoryMetrics, options) {
  const { mode, thresholds, errors = [] } = options;

  const failures = results.filter(r => !r.hit_at_1);
  const hardFailures = results.filter(r => !r.hit_at_3);

  // Check pass thresholds
  const passChecks = {
    hit_at_1: metrics.hit_at_1 >= thresholds.hit_at_1,
    hit_at_3: metrics.hit_at_3 >= thresholds.hit_at_3,
    mrr: metrics.mrr >= thresholds.mrr
  };
  const passThreshold = passChecks.hit_at_1 && passChecks.hit_at_3 && passChecks.mrr;

  return {
    summary: {
      mode,
      timestamp: new Date().toISOString(),
      totalCases: metrics.total,
      hit_at_1: `${(metrics.hit_at_1 * 100).toFixed(1)}%`,
      hit_at_3: `${(metrics.hit_at_3 * 100).toFixed(1)}%`,
      hit_at_5: `${(metrics.hit_at_5 * 100).toFixed(1)}%`,
      mrr: metrics.mrr.toFixed(4),
      passThreshold,
      passChecks
    },
    thresholds: {
      hit_at_1: `${(thresholds.hit_at_1 * 100).toFixed(0)}%`,
      hit_at_3: `${(thresholds.hit_at_3 * 100).toFixed(0)}%`,
      mrr: thresholds.mrr.toFixed(2)
    },
    byCountry: formatCountryBreakdown(metrics.by_country),
    byChallenge: formatChallengeBreakdown(metrics.by_challenge),
    byChallengeCategory: formatCategoryBreakdown(categoryMetrics),
    failures: failures.map(f => ({
      caseId: f.caseId,
      query: f.query,
      goldName: f.goldName,
      country: f.country,
      challenges: f.challenges,
      actualPosition: f.score.position,
      topResult: f.ranking[0]?.title || 'No results'
    })),
    hardFailures: hardFailures.map(f => f.caseId),
    errors,
    rawMetrics: metrics,
    rawResults: results
  };
}

/**
 * Format country breakdown for report.
 * @param {Object} byCountry - Metrics per country
 * @returns {Object} Formatted breakdown
 */
function formatCountryBreakdown(byCountry) {
  const formatted = {};

  for (const [country, metrics] of Object.entries(byCountry)) {
    formatted[country] = {
      total: metrics.total,
      hit_at_1: `${(metrics.hit_at_1 * 100).toFixed(0)}%`,
      hit_at_3: `${(metrics.hit_at_3 * 100).toFixed(0)}%`,
      mrr: metrics.mrr.toFixed(3)
    };
  }

  return formatted;
}

/**
 * Format challenge breakdown for report.
 * @param {Object} byChallenge - Metrics per challenge
 * @returns {Object} Formatted breakdown
 */
function formatChallengeBreakdown(byChallenge) {
  const formatted = {};

  for (const [challenge, metrics] of Object.entries(byChallenge)) {
    formatted[challenge] = {
      total: metrics.total,
      hit_at_1: `${(metrics.hit_at_1 * 100).toFixed(0)}%`,
      hit_at_3: `${(metrics.hit_at_3 * 100).toFixed(0)}%`,
      mrr: metrics.mrr.toFixed(3)
    };
  }

  return formatted;
}

/**
 * Format challenge category breakdown for report.
 * @param {Object} categoryMetrics - Metrics per category
 * @returns {Object} Formatted breakdown
 */
function formatCategoryBreakdown(categoryMetrics) {
  const formatted = {};

  for (const [category, metrics] of Object.entries(categoryMetrics)) {
    formatted[category] = {
      total: metrics.total,
      hit_at_1: metrics.hit_at_1,
      hit_at_3: metrics.hit_at_3,
      mrr: metrics.mrr,
      challenges: metrics.challenges
    };
  }

  return formatted;
}

/**
 * Format report for console output.
 * @param {BenchmarkReport} report
 * @returns {string}
 */
export function formatConsoleReport(report) {
  const lines = [];

  // Header
  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║           WINE SEARCH BENCHMARK RESULTS                      ║');
  lines.push('╠══════════════════════════════════════════════════════════════╣');
  lines.push(`║ Mode: ${report.summary.mode.toUpperCase().padEnd(54)}║`);
  lines.push(`║ Total Cases: ${report.summary.totalCases.toString().padEnd(47)}║`);
  lines.push('╠══════════════════════════════════════════════════════════════╣');

  // Main metrics
  const hit1Status = report.summary.passChecks.hit_at_1 ? '✓' : '✗';
  const hit3Status = report.summary.passChecks.hit_at_3 ? '✓' : '✗';
  const mrrStatus = report.summary.passChecks.mrr ? '✓' : '✗';

  lines.push(`║ Hit@1:  ${report.summary.hit_at_1.padEnd(10)} (threshold: ${report.thresholds.hit_at_1}) ${hit1Status.padStart(25)}║`);
  lines.push(`║ Hit@3:  ${report.summary.hit_at_3.padEnd(10)} (threshold: ${report.thresholds.hit_at_3}) ${hit3Status.padStart(25)}║`);
  lines.push(`║ MRR:    ${report.summary.mrr.padEnd(10)} (threshold: ${report.thresholds.mrr}) ${mrrStatus.padStart(25)}║`);
  lines.push('╠══════════════════════════════════════════════════════════════╣');

  // Pass/Fail
  const passText = report.summary.passThreshold ? '✅ PASS' : '❌ FAIL';
  lines.push(`║ Status: ${passText.padEnd(52)}║`);
  lines.push('╚══════════════════════════════════════════════════════════════╝');

  // Country breakdown (sorted by total)
  lines.push('\n📍 Results by Country:');
  lines.push('─'.repeat(50));

  const sortedCountries = Object.entries(report.byCountry)
    .sort((a, b) => b[1].total - a[1].total);

  for (const [country, metrics] of sortedCountries) {
    const bar = getProgressBar(parseFloat(metrics.hit_at_1) / 100, 10);
    lines.push(`  ${country.padEnd(20)} ${bar} ${metrics.hit_at_1.padStart(4)} hit@1 (n=${metrics.total})`);
  }

  // Challenge category breakdown
  lines.push('\n🏷️  Results by Challenge Category:');
  lines.push('─'.repeat(50));

  const sortedCategories = Object.entries(report.byChallengeCategory)
    .sort((a, b) => b[1].total - a[1].total);

  for (const [category, metrics] of sortedCategories) {
    const hit1Pct = (metrics.hit_at_1 * 100).toFixed(0);
    const bar = getProgressBar(metrics.hit_at_1, 10);
    lines.push(`  ${category.padEnd(20)} ${bar} ${hit1Pct.padStart(3)}% hit@1 (n=${metrics.total})`);
  }

  // Failures
  if (report.failures.length > 0) {
    lines.push('\n⚠️  Failures (not hit@1):');
    lines.push('─'.repeat(50));

    for (const f of report.failures.slice(0, 10)) {
      const pos = f.actualPosition === 0 ? 'not found' : `position ${f.actualPosition}`;
      lines.push(`  ${f.caseId}:`);
      lines.push(`    Query: "${f.query}"`);
      lines.push(`    Result: ${pos}`);
      if (f.topResult) {
        lines.push(`    Top: "${truncate(f.topResult, 50)}"`);
      }
    }

    if (report.failures.length > 10) {
      lines.push(`  ... and ${report.failures.length - 10} more failures`);
    }
  }

  // Hard failures
  if (report.hardFailures.length > 0) {
    lines.push('\n❌ Hard Failures (not hit@3):');
    lines.push(`  ${report.hardFailures.join(', ')}`);
  }

  // Errors
  if (report.errors && report.errors.length > 0) {
    lines.push('\n⛔ Errors:');
    for (const e of report.errors) {
      lines.push(`  ${e.caseId}: ${e.error}`);
    }
  }

  lines.push('');

  return lines.join('\n');
}

/**
 * Format report as JSON.
 * @param {BenchmarkReport} report
 * @param {boolean} [pretty=true] - Pretty print
 * @returns {string}
 */
export function formatJsonReport(report) {
  // Remove raw results for cleaner JSON
  const cleaned = {
    ...report,
    rawResults: undefined
  };

  return JSON.stringify(cleaned, null, 2);
}

/**
 * Generate CI-friendly summary (single line).
 * @param {BenchmarkReport} report
 * @returns {string}
 */
export function formatCiSummary(report) {
  const status = report.summary.passThreshold ? 'PASS' : 'FAIL';
  return `Benchmark ${status}: hit@1=${report.summary.hit_at_1}, hit@3=${report.summary.hit_at_3}, MRR=${report.summary.mrr}`;
}

/**
 * Generate progress bar.
 * @param {number} ratio - Value 0-1
 * @param {number} width - Bar width in characters
 * @returns {string} Progress bar string
 */
function getProgressBar(ratio, width) {
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Truncate string with ellipsis.
 * @param {string} str - String to truncate
 * @param {number} maxLen - Maximum length
 * @returns {string}
 */
function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

/**
 * Get regression analysis between two reports.
 * @param {BenchmarkReport} current - Current run
 * @param {BenchmarkReport} baseline - Baseline to compare against
 * @returns {Object} Regression analysis
 */
export function analyzeRegression(current, baseline) {
  const regressions = [];
  const improvements = [];

  // Compare individual challenges
  for (const [challenge, currentMetrics] of Object.entries(current.byChallenge)) {
    const baselineMetrics = baseline.byChallenge[challenge];
    if (!baselineMetrics) continue;

    const currentHit1 = parseFloat(currentMetrics.hit_at_1) / 100;
    const baselineHit1 = parseFloat(baselineMetrics.hit_at_1) / 100;
    const delta = currentHit1 - baselineHit1;

    if (delta < -0.1) {
      regressions.push({
        challenge,
        current: currentMetrics.hit_at_1,
        baseline: baselineMetrics.hit_at_1,
        delta: `${(delta * 100).toFixed(0)}%`
      });
    } else if (delta > 0.1) {
      improvements.push({
        challenge,
        current: currentMetrics.hit_at_1,
        baseline: baselineMetrics.hit_at_1,
        delta: `+${(delta * 100).toFixed(0)}%`
      });
    }
  }

  // Overall regression
  const currentMrr = parseFloat(current.summary.mrr);
  const baselineMrr = parseFloat(baseline.summary.mrr);
  const mrrDelta = currentMrr - baselineMrr;

  return {
    overallRegression: mrrDelta < -0.02,
    mrrDelta: mrrDelta.toFixed(4),
    regressions,
    improvements,
    summary: regressions.length > 0
      ? `${regressions.length} regressions detected`
      : 'No significant regressions'
  };
}

/**
 * Analyze challenge category regressions with thresholds.
 * @param {BenchmarkReport} report - Current benchmark report
 * @param {Object} [categoryThresholds] - Min hit@1 thresholds per category
 * @returns {Object} Category regression analysis
 */
export function analyzeCategoryRegressions(report, categoryThresholds = {}) {
  // Default thresholds from the plan
  const defaults = {
    diacritics: 0.90,
    classification: 0.85,
    brand_producer: 0.80,
    vineyard: 0.80,
    numeric: 0.90,
    name_complexity: 0.75,
    disambiguation: 0.85,
    search_difficulty: 0.60,
    special_types: 0.75,
    region: 0.75,
    other: 0.70
  };

  const thresholds = { ...defaults, ...categoryThresholds };
  const categoryResults = [];
  const failures = [];

  for (const [category, metrics] of Object.entries(report.byChallengeCategory || {})) {
    const threshold = thresholds[category] ?? 0.70;
    const hit1 = metrics.hit_at_1;
    const passed = hit1 >= threshold;

    const result = {
      category,
      hit_at_1: hit1,
      threshold,
      passed,
      delta: hit1 - threshold,
      total: metrics.total
    };

    categoryResults.push(result);

    if (!passed) {
      failures.push(result);
    }
  }

  return {
    allPassed: failures.length === 0,
    categoryResults: categoryResults.sort((a, b) => a.hit_at_1 - b.hit_at_1),
    failures,
    summary: failures.length > 0
      ? `${failures.length} category(s) below threshold: ${failures.map(f => f.category).join(', ')}`
      : 'All categories meet thresholds'
  };
}

/**
 * Generate country-level performance heatmap data.
 * @param {BenchmarkReport} report - Benchmark report
 * @returns {Object} Heatmap data with performance tiers
 */
export function generateCountryHeatmap(report) {
  const tiers = {
    excellent: [], // ≥90% hit@1
    good: [],      // ≥75% hit@1
    fair: [],      // ≥60% hit@1
    poor: []       // <60% hit@1
  };

  const countryData = [];

  for (const [country, metrics] of Object.entries(report.byCountry || {})) {
    const hit1 = parseFloat(metrics.hit_at_1) / 100;
    const hit3 = parseFloat(metrics.hit_at_3) / 100;
    const mrr = parseFloat(metrics.mrr);

    const data = {
      country,
      hit_at_1: hit1,
      hit_at_3: hit3,
      mrr,
      total: metrics.total,
      tier: hit1 >= 0.9 ? 'excellent' : hit1 >= 0.75 ? 'good' : hit1 >= 0.6 ? 'fair' : 'poor'
    };

    countryData.push(data);
    tiers[data.tier].push(country);
  }

  // Sort by performance
  countryData.sort((a, b) => b.hit_at_1 - a.hit_at_1);

  return {
    countries: countryData,
    tiers,
    summary: {
      excellent: tiers.excellent.length,
      good: tiers.good.length,
      fair: tiers.fair.length,
      poor: tiers.poor.length
    },
    weakestCountries: countryData.slice(-3).map(c => c.country),
    strongestCountries: countryData.slice(0, 3).map(c => c.country)
  };
}

/**
 * Format country heatmap for console output.
 * @param {Object} heatmap - Heatmap data from generateCountryHeatmap
 * @returns {string} Formatted heatmap
 */
export function formatCountryHeatmapConsole(heatmap) {
  const lines = [];

  lines.push('\n🗺️  Country Performance Heatmap:');
  lines.push('─'.repeat(60));

  // Legend
  lines.push('  Legend: 🟢 ≥90%  🟡 ≥75%  🟠 ≥60%  🔴 <60%\n');

  for (const country of heatmap.countries) {
    const icon = country.tier === 'excellent' ? '🟢' :
      country.tier === 'good' ? '🟡' :
        country.tier === 'fair' ? '🟠' : '🔴';

    const hit1Pct = (country.hit_at_1 * 100).toFixed(0);
    const bar = getProgressBar(country.hit_at_1, 15);

    lines.push(`  ${icon} ${country.country.padEnd(18)} ${bar} ${hit1Pct.padStart(3)}% (n=${country.total})`);
  }

  lines.push('');
  lines.push(`  Summary: ${heatmap.summary.excellent} excellent, ${heatmap.summary.good} good, ${heatmap.summary.fair} fair, ${heatmap.summary.poor} poor`);

  if (heatmap.weakestCountries.length > 0) {
    lines.push(`  Focus areas: ${heatmap.weakestCountries.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Load baseline report from disk for comparison.
 * @param {string} [resultsDir] - Results directory
 * @param {string} [mode] - Benchmark mode
 * @returns {Promise<BenchmarkReport|null>} Baseline report or null
 */
export async function loadBaselineReport(resultsDir = DEFAULT_RESULTS_DIR, mode = 'replay') {
  const baselinePath = path.join(resultsDir, `benchmark-${mode}-latest.json`);

  try {
    const content = await fs.readFile(baselinePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Compare current report against saved baseline.
 * @param {BenchmarkReport} current - Current report
 * @param {string} [resultsDir] - Results directory
 * @returns {Promise<Object|null>} Comparison result or null if no baseline
 */
export async function compareWithBaseline(current, resultsDir = DEFAULT_RESULTS_DIR) {
  const baseline = await loadBaselineReport(resultsDir, current.summary.mode);

  if (!baseline) {
    return null;
  }

  const regression = analyzeRegression(current, baseline);
  const categoryAnalysis = analyzeCategoryRegressions(current);

  return {
    hasBaseline: true,
    baselineTimestamp: baseline.summary.timestamp,
    regression,
    categoryAnalysis,
    summary: regression.overallRegression
      ? `⚠️ Regression detected: MRR delta ${regression.mrrDelta}`
      : `✓ No regression: MRR delta ${regression.mrrDelta}`
  };
}

/**
 * Save benchmark report to disk.
 * @param {BenchmarkReport} report - Report to save
 * @param {Object} [options]
 * @param {string} [options.resultsDir] - Directory to save results
 * @param {string} [options.filename] - Custom filename (without extension)
 * @returns {Promise<string>} Path to saved file
 */
export async function saveReport(report, options = {}) {
  const {
    resultsDir = DEFAULT_RESULTS_DIR,
    filename = `benchmark-${report.summary.mode}-${Date.now()}`
  } = options;

  // Ensure directory exists
  await fs.mkdir(resultsDir, { recursive: true });

  // Save JSON report
  const jsonPath = path.join(resultsDir, `${filename}.json`);
  const jsonContent = formatJsonReport(report);
  await fs.writeFile(jsonPath, jsonContent, 'utf8');

  // Save summary text
  const summaryPath = path.join(resultsDir, `${filename}.txt`);
  const summaryContent = formatConsoleReport(report);
  await fs.writeFile(summaryPath, summaryContent, 'utf8');

  return jsonPath;
}

/**
 * Save latest report with fixed filename for CI.
 * @param {BenchmarkReport} report - Report to save
 * @param {string} [resultsDir] - Directory to save results
 * @returns {Promise<string>} Path to saved file
 */
export async function saveLatestReport(report, resultsDir = DEFAULT_RESULTS_DIR) {
  return saveReport(report, {
    resultsDir,
    filename: `benchmark-${report.summary.mode}-latest`
  });
}

export default {
  generateReport,
  formatConsoleReport,
  formatJsonReport,
  formatCiSummary,
  analyzeRegression,
  analyzeCategoryRegressions,
  generateCountryHeatmap,
  formatCountryHeatmapConsole,
  loadBaselineReport,
  compareWithBaseline,
  saveReport,
  saveLatestReport,
  DEFAULT_RESULTS_DIR
};
