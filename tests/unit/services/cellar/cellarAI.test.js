import { describe, it, expect, vi } from 'vitest';

// Mock dependencies before import
vi.mock('../../../../src/services/ai/claudeClient.js', () => ({ default: null }));
vi.mock('../../../../src/config/aiModels.js', () => ({
  getModelForTask: () => 'claude-sonnet-4-6',
  getThinkingConfig: () => null,
}));
vi.mock('../../../../src/services/ai/claudeResponseUtils.js', () => ({
  extractText: () => '',
}));
vi.mock('../../../../src/services/ai/openaiReviewer.js', () => ({
  reviewCellarAdvice: vi.fn(),
  isCellarAnalysisReviewEnabled: () => false,
}));
vi.mock('../../../../src/utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  isSlotCoordinate,
  resolveAIMovesToSlots,
  validateAdviceSchema,
  isValidZoneRef,
  enforceAdviceConsistency,
  buildCellarAdvicePrompt,
} from '../../../../src/services/cellar/cellarAI.js';

describe('isSlotCoordinate', () => {
  it('accepts cellar slot coordinates', () => {
    expect(isSlotCoordinate('R3C5')).toBe(true);
    expect(isSlotCoordinate('R1C1')).toBe(true);
    expect(isSlotCoordinate('R10C9')).toBe(true);
  });

  it('accepts fridge slot coordinates', () => {
    expect(isSlotCoordinate('F1')).toBe(true);
    expect(isSlotCoordinate('F12')).toBe(true);
  });

  it('rejects zone names', () => {
    expect(isSlotCoordinate('sauvignon_blanc')).toBe(false);
    expect(isSlotCoordinate('chenin_blanc')).toBe(false);
    expect(isSlotCoordinate('sa_blends')).toBe(false);
    expect(isSlotCoordinate('shiraz')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isSlotCoordinate(null)).toBe(false);
    expect(isSlotCoordinate(undefined)).toBe(false);
    expect(isSlotCoordinate(42)).toBe(false);
  });

  it('rejects display-name formatted strings', () => {
    expect(isSlotCoordinate('Pinotage')).toBe(false);
    expect(isSlotCoordinate('SA Blends')).toBe(false);
    expect(isSlotCoordinate('manual')).toBe(false);
  });
});

describe('resolveAIMovesToSlots', () => {
  const suggestedMoves = [
    { wineId: 1, wineName: 'Wine A', from: 'R3C1', to: 'R5C2', toZone: 'Pinotage', type: 'move' },
    { wineId: 2, wineName: 'Wine B', from: 'R1C4', to: 'R7C1', toZone: 'SA Blends', type: 'move' },
    { wineId: 3, wineName: 'Wine C', from: 'R2C3', to: 'R8C1', toZone: 'Shiraz', type: 'move' },
  ];

  it('maps AI confirmed moves back to original slot coordinates', () => {
    const aiMoves = [
      { wineId: 1, from: 'R3C1', to: 'R5C2' },
      { wineId: 2, from: 'R1C4', to: 'R7C1' },
    ];
    const resolved = resolveAIMovesToSlots(aiMoves, suggestedMoves);
    expect(resolved[0].from).toBe('R3C1');
    expect(resolved[0].to).toBe('R5C2');
    expect(resolved[0].toZone).toBe('Pinotage');
    expect(resolved[1].from).toBe('R1C4');
    expect(resolved[1].to).toBe('R7C1');
    expect(resolved[1].toZone).toBe('SA Blends');
  });

  it('replaces zone-name from with original slot coordinate', () => {
    const aiMoves = [
      { wineId: 1, from: 'pinotage', to: 'R5C2' }, // AI returned zone name
    ];
    const resolved = resolveAIMovesToSlots(aiMoves, suggestedMoves);
    expect(resolved[0].from).toBe('R3C1'); // Uses original
  });

  it('replaces zone-name to with original slot coordinate', () => {
    const aiMoves = [
      { wineId: 2, from: 'R1C4', to: 'sa_blends' }, // AI returned zone ID
    ];
    const resolved = resolveAIMovesToSlots(aiMoves, suggestedMoves);
    expect(resolved[0].to).toBe('R7C1'); // Falls back to original
  });

  it('keeps AI to if it is a valid slot coordinate (modifiedMoves)', () => {
    const aiMoves = [
      { wineId: 1, from: 'R3C1', to: 'R9C4' }, // AI modified the target
    ];
    const resolved = resolveAIMovesToSlots(aiMoves, suggestedMoves);
    expect(resolved[0].to).toBe('R9C4'); // AI's modified target is valid
  });

  it('preserves AI reason and other fields', () => {
    const aiMoves = [
      { wineId: 1, from: 'R3C1', to: 'R9C4', reason: 'Better placement' },
    ];
    const resolved = resolveAIMovesToSlots(aiMoves, suggestedMoves);
    expect(resolved[0].reason).toBe('Better placement');
  });

  it('passes through moves not found in suggestedMoves', () => {
    const aiMoves = [
      { wineId: 999, from: 'unknown_zone', to: 'another_zone' },
    ];
    const resolved = resolveAIMovesToSlots(aiMoves, suggestedMoves);
    expect(resolved[0].from).toBe('unknown_zone'); // No original to fall back to
    expect(resolved[0].to).toBe('another_zone');
  });

  it('returns empty array for null input', () => {
    expect(resolveAIMovesToSlots(null, suggestedMoves)).toEqual([]);
  });

  it('returns moves unchanged when suggestedMoves is empty', () => {
    const aiMoves = [{ wineId: 1, from: 'zone_a', to: 'zone_b' }];
    const resolved = resolveAIMovesToSlots(aiMoves, []);
    expect(resolved[0].from).toBe('zone_a');
    expect(resolved[0].to).toBe('zone_b');
  });

  it('adds toZone from original moves for UI context', () => {
    const aiMoves = [{ wineId: 3, from: 'R2C3', to: 'R8C1' }];
    const resolved = resolveAIMovesToSlots(aiMoves, suggestedMoves);
    expect(resolved[0].toZone).toBe('Shiraz');
  });
});

describe('validateAdviceSchema', () => {
  it('returns default structure for empty object', () => {
    const result = validateAdviceSchema({});
    expect(result.confirmedMoves).toEqual([]);
    expect(result.modifiedMoves).toEqual([]);
    expect(result.rejectedMoves).toEqual([]);
    expect(result.zonesNeedReconfiguration).toBe(false);
    expect(result.summary).toBe('No summary provided');
  });

  it('preserves valid arrays and fields', () => {
    const result = validateAdviceSchema({
      confirmedMoves: [{ wineId: 1, from: 'R1C1', to: 'R2C2' }],
      rejectedMoves: [{ wineId: 2, reason: 'Keep in place' }],
      summary: 'Test summary',
      zonesNeedReconfiguration: true,
    });
    expect(result.confirmedMoves).toHaveLength(1);
    expect(result.rejectedMoves).toHaveLength(1);
    expect(result.summary).toBe('Test summary');
    expect(result.zonesNeedReconfiguration).toBe(true);
  });

  it('filters ambiguousWines options to valid zone refs only', () => {
    const result = validateAdviceSchema({
      ambiguousWines: [
        { wineId: 1, name: 'Test', options: ['shiraz', 'nonexistent_zone_xyz'], recommendation: 'Check' },
      ],
    });
    // 'shiraz' is valid, 'nonexistent_zone_xyz' should be filtered
    const validOptions = result.ambiguousWines[0]?.options || [];
    expect(validOptions).toContain('shiraz');
    expect(validOptions).not.toContain('nonexistent_zone_xyz');
  });

  it('normalizes malformed zoneAdjustments and drops empty entries', () => {
    const result = validateAdviceSchema({
      zoneAdjustments: [
        'southern_france: split by style',
        { zone_id: 'aromatic_whites', reason: 'contains red wines' },
        { zoneId: ' ', suggestion: ' ' },
        null
      ]
    });

    expect(result.zoneAdjustments).toEqual([
      { zoneId: 'southern_france', suggestion: 'split by style' },
      { zoneId: 'aromatic_whites', suggestion: 'contains red wines' }
    ]);
  });

  it('normalizes proposedZoneChanges and removes blank objects', () => {
    const result = validateAdviceSchema({
      proposedZoneChanges: [
        { zone_id: 'southern_france', current_label: 'Southern France', proposed_label: 'Rhone', rationale: 'better grouping' },
        { zoneId: '', currentLabel: '', proposedLabel: '', reason: '' }
      ]
    });

    expect(result.proposedZoneChanges).toEqual([
      {
        changeType: null,
        zoneId: 'southern_france',
        currentLabel: 'Southern France',
        proposedLabel: 'Rhone',
        reason: 'better grouping'
      }
    ]);
  });

  it('normalizes proposedZoneChanges changeType aliases', () => {
    const result = validateAdviceSchema({
      proposedZoneChanges: [
        { action: 'retire', zoneId: 'old_zone', reason: 'remove this legacy zone' },
        { changeType: 'expand', zoneId: 'cabernet', reason: 'add row capacity' }
      ]
    });

    expect(result.proposedZoneChanges[0].changeType).toBe('remove');
    expect(result.proposedZoneChanges[1].changeType).toBe('enlarge');
  });
});

describe('enforceAdviceConsistency', () => {
  it('rewrites overconfident verdict and summary when issues exist', () => {
    const advice = {
      summary: 'Your cellar is 95% well-organized.',
      zoneVerdict: 'Zone structure is sound and well-configured for this collection.',
      zoneHealth: [{ zone: 'aromatic_whites', status: 'contaminated', recommendation: 'Move reds out.' }]
    };
    const report = {
      summary: {
        totalBottles: 98,
        misplacedBottles: 6,
        unclassifiedCount: 4,
        scatteredWineCount: 2,
        overflowingZones: ['Pinot Noir', 'Shiraz'],
        fragmentedZones: [],
        colorAdjacencyViolations: 1
      },
      zoneCapacityIssues: [{ zoneId: 'pinot_noir' }]
    };

    const normalized = enforceAdviceConsistency(advice, report);
    expect(normalized.zoneVerdict).toContain('unresolved issues');
    expect(normalized.summary).toContain('misplaced bottle(s)');
    expect(normalized.summary).toContain('structural issue(s)');
  });

  it('keeps advice unchanged when no issue signals are present', () => {
    const advice = {
      summary: 'Your cellar is well-organized.',
      zoneVerdict: 'Zone structure is sound.',
      zoneHealth: [{ zone: 'chenin_blanc', status: 'healthy', recommendation: 'No changes needed.' }]
    };
    const report = {
      summary: {
        totalBottles: 40,
        misplacedBottles: 0,
        unclassifiedCount: 0,
        scatteredWineCount: 0,
        overflowingZones: [],
        fragmentedZones: [],
        colorAdjacencyViolations: 0
      },
      zoneCapacityIssues: []
    };

    const normalized = enforceAdviceConsistency(advice, report);
    expect(normalized.zoneVerdict).toBe(advice.zoneVerdict);
    expect(normalized.summary).toBe(advice.summary);
  });

  it('flags duplicate placements as data integrity issue', () => {
    const advice = {
      summary: 'Your cellar is well-organized.',
      zoneVerdict: 'Zone structure is sound.',
      zoneHealth: [{ zone: 'cabernet', status: 'healthy', recommendation: 'No changes needed.' }]
    };
    const report = {
      summary: {
        totalBottles: 50,
        misplacedBottles: 0,
        unclassifiedCount: 0,
        scatteredWineCount: 0,
        duplicatePlacementCount: 2,
        overflowingZones: [],
        fragmentedZones: [],
        colorAdjacencyViolations: 0
      },
      zoneCapacityIssues: []
    };

    const normalized = enforceAdviceConsistency(advice, report);
    expect(normalized.zoneVerdict).toContain('duplicate bottle placements');
    expect(normalized.summary).toContain('duplicate placement issue(s)');
  });
});

describe('Phase B5: buildCellarAdvicePrompt', () => {
  /** Minimal report with bottleScan, cleanlinessViolations, and standard fields. */
  function makeReport(overrides = {}) {
    return {
      summary: {
        totalBottles: 50,
        correctlyPlaced: 42,
        misplacedBottles: 8,
        unclassifiedCount: 0,
        scatteredWineCount: 2,
        overflowingZones: [],
        fragmentedZones: [],
        colorAdjacencyViolations: 0,
        duplicatePlacementCount: 0
      },
      misplacedWines: [],
      suggestedMoves: [],
      duplicatePlacements: [],
      zoneNarratives: [
        { zoneId: 'shiraz', displayName: 'Shiraz', rows: ['R3', 'R4'], currentComposition: { bottleCount: 18, topGrapes: ['Shiraz'] } },
        { zoneId: 'cabernet', displayName: 'Cabernet', rows: ['R5'], currentComposition: { bottleCount: 9, topGrapes: ['Cabernet Sauvignon'] } }
      ],
      bottleScan: {
        groups: [
          {
            zoneId: 'shiraz', displayName: 'Shiraz', bottleCount: 18,
            correctlyPlacedCount: 16, misplacedCount: 2, demandRows: 2, rowDeficit: 0,
            wines: [
              { wineId: 1, wineName: 'Kanonkop Pinotage', slot: 'R3C1', physicalRow: 'R3', canonicalZoneId: 'shiraz', confidence: 'high', score: 85, correctlyPlaced: true },
              { wineId: 2, wineName: 'Mystery Blend', slot: 'R3C2', physicalRow: 'R3', canonicalZoneId: 'shiraz', confidence: 'low', score: 35, correctlyPlaced: true },
              { wineId: 3, wineName: 'Borderline GSM', slot: 'R4C1', physicalRow: 'R4', canonicalZoneId: 'shiraz', confidence: 'medium', score: 55, correctlyPlaced: true }
            ]
          },
          {
            zoneId: 'cabernet', displayName: 'Cabernet', bottleCount: 9,
            correctlyPlacedCount: 8, misplacedCount: 1, demandRows: 1, rowDeficit: 0,
            wines: [
              { wineId: 4, wineName: 'Warwick Cab', slot: 'R5C1', physicalRow: 'R5', canonicalZoneId: 'cabernet', confidence: 'high', score: 90, correctlyPlaced: true }
            ]
          }
        ],
        consolidationOpportunities: [],
        totalBottles: 27,
        totalGroups: 2
      },
      cleanlinessViolations: [
        { wineId: 10, wineName: 'Stray Chardonnay', slot: 'R3C5', physicalRow: 'R3', rowZoneId: 'shiraz', rowZoneName: 'Shiraz', bestZoneId: 'chardonnay', bestZoneName: 'Chardonnay', bestScore: 80, rowZoneScore: 5, scoreDelta: 75, confidence: 'high', severity: 'critical', reason: 'Colour mismatch: white wine in red zone' }
      ],
      fridgeStatus: null,
      layoutBaseline: null,
      ...overrides
    };
  }

  it('includes BOTTLES_FIRST_SCAN section with pre-classified groups', () => {
    const prompt = buildCellarAdvicePrompt(makeReport());
    expect(prompt).toContain('<BOTTLES_FIRST_SCAN>');
    expect(prompt).toContain('Pre-classified zone groupings');
    expect(prompt).toContain('"zoneId":"shiraz"');
    expect(prompt).toContain('"bottles":18');
    expect(prompt).toContain('"correct":16');
  });

  it('includes CLEANLINESS_VIOLATIONS section when violations exist', () => {
    const prompt = buildCellarAdvicePrompt(makeReport());
    expect(prompt).toContain('<CLEANLINESS_VIOLATIONS>');
    expect(prompt).toContain('Pre-prioritized row violations');
    expect(prompt).toContain('"severity":"critical"');
    expect(prompt).toContain('Stray Chardonnay');
  });

  it('omits CLEANLINESS_VIOLATIONS section when no violations', () => {
    const prompt = buildCellarAdvicePrompt(makeReport({ cleanlinessViolations: [] }));
    expect(prompt).not.toContain('<CLEANLINESS_VIOLATIONS>');
  });

  it('includes AMBIGUITY_CANDIDATES for low/medium confidence wines only', () => {
    const prompt = buildCellarAdvicePrompt(makeReport());
    expect(prompt).toContain('<AMBIGUITY_CANDIDATES>');
    // Low confidence wine included
    expect(prompt).toContain('Mystery Blend');
    // Medium confidence wine included
    expect(prompt).toContain('Borderline GSM');
    // High confidence wine excluded
    expect(prompt).not.toContain('Kanonkop Pinotage');
    expect(prompt).not.toContain('Warwick Cab');
  });

  it('omits AMBIGUITY_CANDIDATES when all wines are high confidence', () => {
    const report = makeReport();
    // Override wines to all high confidence
    report.bottleScan.groups = [{
      zoneId: 'shiraz', displayName: 'Shiraz', bottleCount: 2,
      correctlyPlacedCount: 2, misplacedCount: 0, demandRows: 1, rowDeficit: 0,
      wines: [
        { wineId: 1, wineName: 'Wine A', slot: 'R3C1', physicalRow: 'R3', canonicalZoneId: 'shiraz', confidence: 'high', score: 90, correctlyPlaced: true },
        { wineId: 2, wineName: 'Wine B', slot: 'R3C2', physicalRow: 'R3', canonicalZoneId: 'shiraz', confidence: 'high', score: 85, correctlyPlaced: true }
      ]
    }];
    const prompt = buildCellarAdvicePrompt(report);
    expect(prompt).not.toContain('<AMBIGUITY_CANDIDATES>');
  });

  it('caps ambiguity candidates at 15', () => {
    const report = makeReport();
    // Create 20 low-confidence wines
    const manyWines = Array.from({ length: 20 }, (_, i) => ({
      wineId: 100 + i, wineName: `Wine ${i}`, slot: `R3C${i + 1}`, physicalRow: 'R3',
      canonicalZoneId: 'shiraz', confidence: 'low', score: 30, correctlyPlaced: false
    }));
    report.bottleScan.groups = [{
      zoneId: 'shiraz', displayName: 'Shiraz', bottleCount: 20,
      correctlyPlacedCount: 0, misplacedCount: 20, demandRows: 3, rowDeficit: 1,
      wines: manyWines
    }];
    const prompt = buildCellarAdvicePrompt(report);
    // Count occurrences of wineId in the AMBIGUITY_CANDIDATES section
    const ambSection = prompt.split('<AMBIGUITY_CANDIDATES>')[1]?.split('</AMBIGUITY_CANDIDATES>')[0] || '';
    const matches = ambSection.match(/"id":\d+/g) || [];
    expect(matches.length).toBe(15);
  });

  it('instructs AI that algorithmic classification is authoritative', () => {
    const prompt = buildCellarAdvicePrompt(makeReport());
    expect(prompt).toContain('ALGORITHMIC CLASSIFICATION IS AUTHORITATIVE');
    expect(prompt).toContain('do NOT reclassify');
  });

  it('removes misplacedWines from DATA (replaced by bottles-first scan)', () => {
    const prompt = buildCellarAdvicePrompt(makeReport());
    // DATA section should not contain misplacedWines key
    const dataSection = prompt.split('<DATA>')[1]?.split('</DATA>')[0] || '';
    expect(dataSection).not.toContain('"misplacedWines"');
  });

  it('gracefully handles missing bottleScan', () => {
    const report = makeReport({ bottleScan: null });
    const prompt = buildCellarAdvicePrompt(report);
    // Should still produce valid prompt with empty groups
    expect(prompt).toContain('<BOTTLES_FIRST_SCAN>');
    expect(prompt).toContain('[]');
    expect(prompt).not.toContain('<AMBIGUITY_CANDIDATES>');
  });

  it('includes suggested moves for AI confirmation', () => {
    const report = makeReport({
      suggestedMoves: [
        { wineId: 10, wineName: 'Stray Chardonnay', from: 'R3C5', to: 'R7C1', type: 'move' }
      ]
    });
    const prompt = buildCellarAdvicePrompt(report);
    expect(prompt).toContain('"suggestedMoves"');
    expect(prompt).toContain('Stray Chardonnay');
  });
});
