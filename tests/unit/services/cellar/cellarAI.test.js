import { describe, it, expect, vi } from 'vitest';

// Mock dependencies before import
vi.mock('../../../../src/services/ai/claudeClient.js', () => ({ default: null }));
vi.mock('../../../../src/config/aiModels.js', () => ({
  getModelForTask: () => 'claude-sonnet-4-5-20250929',
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
});
