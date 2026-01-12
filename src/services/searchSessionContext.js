/**
 * @fileoverview Search session budget governance and escalation logic.
 * Implements Phase 3 of Wine Search Implementation Plan v1.1.
 * @module services/searchSessionContext
 */

/**
 * Budget presets for different search modes.
 * Controls maximum API calls per search session.
 */
const BUDGET_PRESETS = {
  standard: {
    maxSerpCalls: 6,
    maxUnlockerCalls: 2,
    maxClaudeExtractions: 2,
    earlyStopThreshold: 3, // Stop after 3 high-confidence results
    allowEscalation: false
  },
  important: {
    maxSerpCalls: 12,
    maxUnlockerCalls: 4,
    maxClaudeExtractions: 3,
    earlyStopThreshold: 5,
    allowEscalation: true
  },
  deep: {
    maxSerpCalls: 20,
    maxUnlockerCalls: 6,
    maxClaudeExtractions: 5,
    earlyStopThreshold: 8,
    allowEscalation: true
  }
};

/**
 * Extraction ladder - escalation strategy for getting wine data.
 * Each level has higher cost but higher success rate.
 */
const EXTRACTION_LADDER = [
  {
    method: 'structured_parse',
    costCents: 0,
    description: 'Parse structured data (JSON-LD, microdata, __NEXT_DATA__)'
  },
  {
    method: 'regex_extract',
    costCents: 0,
    description: 'Extract with regex patterns (ratings, scores, dates)'
  },
  {
    method: 'page_fetch',
    costCents: 0.1,
    description: 'Fetch full page HTML for scraping'
  },
  {
    method: 'unlocker_fetch',
    costCents: 2,
    description: 'Use BrightData Web Unlocker for blocked sites'
  },
  {
    method: 'claude_extract',
    costCents: 5,
    description: 'Claude AI extraction from HTML/text'
  }
];

/**
 * Escalation reasons that can trigger budget increase.
 */
const ESCALATION_REASONS = {
  scarce_sources: 'Wine has very few rating sources available',
  high_fingerprint_confidence: 'Wine fingerprint is unique and well-formed',
  user_important: 'User marked wine as important/valuable',
  low_coverage: 'Existing results have low confidence or coverage'
};

/**
 * Confidence levels for search results.
 */
const CONFIDENCE_LEVELS = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
};

/**
 * Search session context for budget governance.
 * Tracks API usage and enforces spending limits per search session.
 */
class SearchSessionContext {
  /**
   * Create a new search session.
   * @param {Object} options - Session configuration
   * @param {string} [options.mode='standard'] - Budget mode (standard/important/deep)
   * @param {Object} [options.customBudget] - Override default budget
   * @param {string} [options.wineFingerprint] - Wine fingerprint for tracking
   * @param {Object} [options.metadata] - Additional session metadata
   */
  constructor(options = {}) {
    const { mode = 'standard', customBudget, wineFingerprint, metadata = {} } = options;

    // Validate mode
    if (!BUDGET_PRESETS[mode] && !customBudget) {
      throw new Error(`Invalid budget mode: ${mode}. Must be one of: standard, important, deep`);
    }

    this.mode = mode;
    this.budget = customBudget || { ...BUDGET_PRESETS[mode] };
    this.wineFingerprint = wineFingerprint;
    this.metadata = metadata;

    // Spending counters
    this.spent = {
      serpCalls: 0,
      unlockerCalls: 0,
      claudeExtractions: 0
    };

    // Results tracking
    this.results = [];
    this.highConfidenceCount = 0;
    this.mediumConfidenceCount = 0;
    this.lowConfidenceCount = 0;

    // Session state
    this.escalated = false;
    this.escalationReason = null;
    this.stopped = false;
    this.stopReason = null;
    this.startTime = Date.now();
    this.extractionHistory = [];
  }

  /**
   * Check if SERP call can be made within budget.
   * @returns {boolean}
   */
  canMakeSerpCall() {
    return this.spent.serpCalls < this.budget.maxSerpCalls;
  }

  /**
   * Check if unlocker can be used within budget.
   * @returns {boolean}
   */
  canUseUnlocker() {
    return this.spent.unlockerCalls < this.budget.maxUnlockerCalls;
  }

  /**
   * Check if Claude extraction can be used within budget.
   * @returns {boolean}
   */
  canUseClaudeExtraction() {
    return this.spent.claudeExtractions < this.budget.maxClaudeExtractions;
  }

  /**
   * Record a SERP API call.
   * @param {string} query - Search query
   * @param {number} resultCount - Number of results returned
   */
  recordSerpCall(query, resultCount) {
    this.spent.serpCalls++;
    this.extractionHistory.push({
      timestamp: Date.now(),
      method: 'serp',
      query,
      resultCount
    });
  }

  /**
   * Record an unlocker call.
   * @param {string} url - URL that was unlocked
   * @param {boolean} success - Whether unlock was successful
   */
  recordUnlockerCall(url, success) {
    this.spent.unlockerCalls++;
    this.extractionHistory.push({
      timestamp: Date.now(),
      method: 'unlocker',
      url,
      success
    });
  }

  /**
   * Record a Claude extraction.
   * @param {string} source - Data source (e.g., 'vivino', 'decanter')
   * @param {number} resultCount - Number of results extracted
   */
  recordClaudeExtraction(source, resultCount) {
    this.spent.claudeExtractions++;
    this.extractionHistory.push({
      timestamp: Date.now(),
      method: 'claude',
      source,
      resultCount
    });
  }

  /**
   * Add a result to the session.
   * @param {Object} result - Search result
   * @param {string} result.confidence - Confidence level (high/medium/low)
   * @param {string} result.source - Data source
   * @param {Object} result.data - Result data
   * @throws {Error} If confidence level is invalid
   */
  addResult(result) {
    // Validate confidence level
    if (!Object.values(CONFIDENCE_LEVELS).includes(result.confidence)) {
      throw new Error(`Invalid confidence level: ${result.confidence}. Must be one of: ${Object.values(CONFIDENCE_LEVELS).join(', ')}`);
    }

    this.results.push({
      ...result,
      timestamp: Date.now()
    });

    // Update confidence counters
    if (result.confidence === CONFIDENCE_LEVELS.HIGH) {
      this.highConfidenceCount++;
    } else if (result.confidence === CONFIDENCE_LEVELS.MEDIUM) {
      this.mediumConfidenceCount++;
    } else if (result.confidence === CONFIDENCE_LEVELS.LOW) {
      this.lowConfidenceCount++;
    }
  }

  /**
   * Check if session should stop early due to sufficient results.
   * @returns {boolean}
   */
  shouldEarlyStop() {
    if (this.stopped) {
      return true;
    }

    // Early stop if we have enough high-confidence results
    if (this.highConfidenceCount >= this.budget.earlyStopThreshold) {
      this.stopped = true;
      this.stopReason = 'sufficient_high_confidence_results';
      return true;
    }

    return false;
  }

  /**
   * Request budget escalation for special cases.
   * @param {string} reason - Escalation reason (key from ESCALATION_REASONS)
   * @param {Object} [_details] - Additional escalation details (reserved for future use)
   * @returns {boolean} - Whether escalation was granted
   */
  requestEscalation(reason, _details = {}) {
    // Check if escalation is allowed
    if (!this.budget.allowEscalation) {
      return false;
    }

    // Validate reason
    if (!ESCALATION_REASONS[reason]) {
      throw new Error(`Invalid escalation reason: ${reason}`);
    }

    // Don't escalate twice
    if (this.escalated) {
      return false;
    }

    // Grant escalation - upgrade to next tier
    this.escalated = true;
    this.escalationReason = reason;

    if (this.mode === 'standard') {
      // Upgrade standard -> important
      this.budget = { ...BUDGET_PRESETS.important };
      this.mode = 'important';
    } else if (this.mode === 'important') {
      // Upgrade important -> deep
      this.budget = { ...BUDGET_PRESETS.deep };
      this.mode = 'deep';
    }
    // deep mode has no higher tier

    return true;
  }

  /**
   * Get the next extraction method to try based on ladder.
   * @param {number} [currentLevel=0] - Current ladder level
   * @returns {Object|null} - Next extraction method or null if exhausted
   */
  getNextExtractionMethod(currentLevel = 0) {
    if (currentLevel >= EXTRACTION_LADDER.length) {
      return null;
    }

    const method = EXTRACTION_LADDER[currentLevel];

    // Check if method is within budget
    if (method.method === 'unlocker_fetch' && !this.canUseUnlocker()) {
      return this.getNextExtractionMethod(currentLevel + 1);
    }

    if (method.method === 'claude_extract' && !this.canUseClaudeExtraction()) {
      return this.getNextExtractionMethod(currentLevel + 1);
    }

    return {
      ...method,
      level: currentLevel
    };
  }

  /**
   * Calculate total cost of the session in cents.
   * @returns {number}
   */
  getTotalCostCents() {
    const serpCost = this.spent.serpCalls * 0.5; // $0.005 per call
    const unlockerCost = this.spent.unlockerCalls * 2; // $0.02 per call
    const claudeCost = this.spent.claudeExtractions * 5; // $0.05 per call
    return serpCost + unlockerCost + claudeCost;
  }

  /**
   * Get session duration in milliseconds.
   * @returns {number}
   */
  getDuration() {
    return Date.now() - this.startTime;
  }

  /**
   * Get budget utilization percentages.
   * @returns {Object}
   */
  getBudgetUtilization() {
    return {
      serpCalls: (this.spent.serpCalls / this.budget.maxSerpCalls) * 100,
      unlockerCalls: (this.spent.unlockerCalls / this.budget.maxUnlockerCalls) * 100,
      claudeExtractions: (this.spent.claudeExtractions / this.budget.maxClaudeExtractions) * 100
    };
  }

  /**
   * Get comprehensive session summary.
   * @returns {Object}
   */
  getSummary() {
    return {
      mode: this.mode,
      wineFingerprint: this.wineFingerprint,
      budget: this.budget,
      spent: this.spent,
      utilization: this.getBudgetUtilization(),
      results: {
        total: this.results.length,
        highConfidence: this.highConfidenceCount,
        mediumConfidence: this.mediumConfidenceCount,
        lowConfidence: this.lowConfidenceCount
      },
      cost: {
        totalCents: this.getTotalCostCents(),
        formatted: `$${(this.getTotalCostCents() / 100).toFixed(3)}`
      },
      session: {
        durationMs: this.getDuration(),
        escalated: this.escalated,
        escalationReason: this.escalationReason,
        stopped: this.stopped,
        stopReason: this.stopReason
      },
      extractionHistory: this.extractionHistory
    };
  }

  /**
   * Convert session to JSON for persistence.
   * @returns {Object}
   */
  toJSON() {
    return this.getSummary();
  }

  /**
   * Create session from JSON.
   * @param {Object} json - Serialized session
   * @returns {SearchSessionContext}
   */
  static fromJSON(json) {
    const ctx = new SearchSessionContext({
      mode: json.mode,
      wineFingerprint: json.wineFingerprint,
      customBudget: json.budget
    });

    ctx.spent = json.spent;
    
    // Handle results - getSummary returns array of result objects
    if (Array.isArray(json.results)) {
      ctx.results = json.results.map(r => ({
        ...r,
        confidence: r.confidence || CONFIDENCE_LEVELS.HIGH
      }));
    } else {
      // If results is an object with high/medium/low counts (from getSummary), 
      // we can't reconstruct the full results array, so leave it empty
      ctx.results = [];
    }
    
    // Use the aggregated counts from results summary
    if (json.results && typeof json.results === 'object') {
      ctx.highConfidenceCount = json.results.highConfidence || 0;
      ctx.mediumConfidenceCount = json.results.mediumConfidence || 0;
      ctx.lowConfidenceCount = json.results.lowConfidence || 0;
    }
    
    ctx.escalated = json.session?.escalated || false;
    ctx.escalationReason = json.session?.escalationReason || null;
    ctx.stopped = json.session?.stopped || false;
    ctx.stopReason = json.session?.stopReason || null;
    ctx.extractionHistory = json.extractionHistory || [];

    return ctx;
  }
}

export {
  SearchSessionContext,
  BUDGET_PRESETS,
  EXTRACTION_LADDER,
  ESCALATION_REASONS,
  CONFIDENCE_LEVELS
};
