import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock state.js before importing the module under test
vi.mock('../../../public/js/cellarAnalysis/state.js', () => ({
  getCurrentAnalysis: vi.fn(),
}));

// Mock api.js
vi.mock('../../../public/js/api.js', () => ({
  analyseCellarAI: vi.fn(),
}));

// Mock utils.js — provide real escapeHtml, mock showToast
vi.mock('../../../public/js/utils.js', () => ({
  escapeHtml: (str) => {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },
  showToast: vi.fn(),
}));

// Mock labels.js
vi.mock('../../../public/js/cellarAnalysis/labels.js', () => ({
  CTA_AI_RECOMMENDATIONS: 'AI Recommendations',
  CTA_RECONFIGURE_ZONES: 'Reconfigure Zones',
  CTA_SETUP_ZONES: 'Setup Zones',
  CTA_GUIDE_MOVES: 'Guide Me Through Moves',
}));

// Mock aiAdviceActions.js (view tests don't need real action wiring)
vi.mock('../../../public/js/cellarAnalysis/aiAdviceActions.js', () => ({
  wireAdviceActions: vi.fn(),
}));

import { formatAIAdvice, enrichMovesWithNames } from '../../../public/js/cellarAnalysis/aiAdvice.js';
import { getCurrentAnalysis } from '../../../public/js/cellarAnalysis/state.js';

const mockAnalysis = {
  misplacedWines: [
    { wineId: 1, name: 'Kanonkop Pinotage 2019', currentZone: 'A', suggestedZone: 'B' },
    { wineId: 2, name: 'Meerlust Rubicon 2018', currentZone: 'C', suggestedZone: 'D' },
  ],
  suggestedMoves: [
    { wineId: 1, wineName: 'Kanonkop Pinotage 2019', from: 'R3C1', to: 'R5C2', type: 'move' },
    { wineId: 3, wineName: 'Jordan Cobbler Hill 2017', from: 'R1C4', to: 'R7C1', type: 'move' },
  ],
  needsZoneSetup: false,
  movesHaveSwaps: false,
};

const mockAdvice = {
  summary: 'Your cellar is well-organized.',
  layoutNarrative: 'The zones follow logical groupings.',
  zoneHealth: [{ zone: 'SA Reds', status: 'healthy', recommendation: 'No changes needed.' }],
  zoneAdjustments: [{ zoneId: 'italian', suggestion: 'Consider splitting into sub-regions.' }],
  confirmedMoves: [{ wineId: 1, wineName: 'Kanonkop Pinotage 2019', from: 'R3C1', to: 'R5C2' }],
  modifiedMoves: [{ wineId: 3, wineName: 'Jordan Cobbler Hill 2017', from: 'R1C4', to: 'R8C3', reason: 'Better proximity to Italian zone' }],
  rejectedMoves: [{ wineId: 5, wineName: 'Wine #5', reason: 'Already optimally placed' }],
  ambiguousWines: [{ wineId: 7, name: 'Grenache Blend', options: ['rhone', 'spanish'], recommendation: 'Fits either zone' }],
  fridgePlan: { toAdd: [{ wineId: 10, reason: 'Ready to drink', category: 'crispWhite' }], toRemove: [], coverageAfter: {} },
};

describe('formatAIAdvice', () => {
  it('renders summary and narrative with escapeHtml', () => {
    const html = formatAIAdvice(mockAdvice);
    expect(html).toContain('Your cellar is well-organized.');
    expect(html).toContain('The zones follow logical groupings.');
    expect(html).toContain('ai-summary');
    expect(html).toContain('ai-narrative');
  });

  it('renders zone health cards with correct status classes', () => {
    const advice = {
      ...mockAdvice,
      zoneHealth: [
        { zone: 'SA Reds', status: 'healthy', recommendation: 'Good' },
        { zone: 'French', status: 'fragmented', recommendation: 'Consolidate' },
        { zone: 'Italian', status: 'critical', recommendation: 'Needs work' },
      ],
    };
    const html = formatAIAdvice(advice);
    expect(html).toContain('zone-health-item good');
    expect(html).toContain('zone-health-item warning');
    expect(html).toContain('zone-health-item bad');
  });

  it('renders zone adjustments as list items', () => {
    const html = formatAIAdvice(mockAdvice);
    expect(html).toContain('<strong>italian</strong>');
    expect(html).toContain('Consider splitting into sub-regions.');
  });

  it('renders confirmed moves using SECTION_CONFIG with CONFIRMED badge + Move/Dismiss buttons', () => {
    const html = formatAIAdvice(mockAdvice);
    expect(html).toContain('ai-confirmed-moves');
    expect(html).toContain('ai-move-badge--confirmed');
    expect(html).toContain('CONFIRMED');
    expect(html).toContain('ai-move-execute-btn');
    expect(html).toContain('ai-move-dismiss-btn');
  });

  it('renders modified moves with reason text and MODIFIED badge', () => {
    const html = formatAIAdvice(mockAdvice);
    expect(html).toContain('ai-modified-moves');
    expect(html).toContain('MODIFIED');
    expect(html).toContain('Better proximity to Italian zone');
  });

  it('renders rejected moves in collapsed <details> without action buttons', () => {
    const html = formatAIAdvice(mockAdvice);
    // Rejected section should NOT have "open" attribute
    expect(html).toMatch(/<details class="ai-rejected-moves">/);
    expect(html).not.toMatch(/<details class="ai-rejected-moves" open>/);
    // Should NOT have execute/dismiss buttons in rejected section
    const rejectedSection = html.match(/<details class="ai-rejected-moves">[\s\S]*?<\/details>/);
    expect(rejectedSection).toBeTruthy();
    expect(rejectedSection[0]).not.toContain('ai-move-execute-btn');
    expect(rejectedSection[0]).not.toContain('ai-move-dismiss-btn');
    expect(rejectedSection[0]).toContain('KEEP');
  });

  it('renders ambiguous wines with zone choice buttons per option', () => {
    const html = formatAIAdvice(mockAdvice);
    expect(html).toContain('ai-ambiguous-wines');
    expect(html).toContain('ai-zone-choice-btn');
    expect(html).toContain('Grenache Blend');
    expect(html).toContain('rhone');
    expect(html).toContain('spanish');
    expect(html).toContain('Fits either zone');
  });

  it('renders fridge plan recommendations in collapsed <details>', () => {
    const html = formatAIAdvice(mockAdvice);
    expect(html).toMatch(/<details class="ai-fridge-plan">/);
    expect(html).not.toMatch(/<details class="ai-fridge-plan" open>/);
    expect(html).toContain('crispWhite');
    expect(html).toContain('Ready to drink');
  });

  it('renders bottom CTAs (Reconfigure Zones + Scroll to Moves)', () => {
    const html = formatAIAdvice(mockAdvice);
    expect(html).toContain('data-action="ai-reconfigure-zones"');
    expect(html).toContain('Reconfigure Zones');
    expect(html).toContain('data-action="ai-scroll-to-moves"');
    expect(html).toContain('Scroll to Moves');
  });

  it('skips move sections when needsZoneSetup=true (R1-7)', () => {
    const html = formatAIAdvice(mockAdvice, true);
    expect(html).not.toContain('ai-confirmed-moves');
    expect(html).not.toContain('ai-modified-moves');
    expect(html).not.toContain('ai-rejected-moves');
    expect(html).not.toContain('ai-ambiguous-wines');
    // Summary/narrative should still be present
    expect(html).toContain('Your cellar is well-organized.');
  });

  it('skips Reconfigure Zones CTA when needsZoneSetup=true', () => {
    const html = formatAIAdvice(mockAdvice, true);
    expect(html).not.toContain('data-action="ai-reconfigure-zones"');
    expect(html).not.toContain('data-action="ai-scroll-to-moves"');
  });

  it('escapes HTML in all AI-provided text fields (R1-2)', () => {
    const xssAdvice = {
      summary: '<script>alert("xss")</script>',
      layoutNarrative: '<img onerror=alert(1)>',
      zoneHealth: [{ zone: '<b>zone</b>', status: '<em>healthy</em>', recommendation: '<a>link</a>' }],
      zoneAdjustments: [{ zoneId: '<div>zone</div>', suggestion: '<span>test</span>' }],
      confirmedMoves: [{ wineId: 1, wineName: '<script>x</script>', from: 'R1C1', to: 'R2C2' }],
      modifiedMoves: [],
      rejectedMoves: [],
      ambiguousWines: [{ wineId: 2, name: '<img src=x>', options: ['<zone>'], recommendation: '<b>rec</b>' }],
      fridgePlan: { toAdd: [{ category: '<b>cat</b>', reason: '<script>r</script>' }] },
    };
    const html = formatAIAdvice(xssAdvice);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img onerror=alert(1)&gt;');
  });

  it('handles legacy string advice format — splits on \\n\\n, escapes each paragraph', () => {
    const html = formatAIAdvice('First paragraph.\n\nSecond paragraph.\n\n<script>alert(1)</script>');
    expect(html).toContain('<p>First paragraph.</p>');
    expect(html).toContain('<p>Second paragraph.</p>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('handles null/empty advice gracefully', () => {
    expect(formatAIAdvice(null)).toContain('No advice available.');
    expect(formatAIAdvice(undefined)).toContain('No advice available.');
  });

  it('renders empty string for section with 0 moves', () => {
    const advice = { ...mockAdvice, confirmedMoves: [], modifiedMoves: [], rejectedMoves: [] };
    const html = formatAIAdvice(advice);
    expect(html).not.toContain('ai-confirmed-moves');
    expect(html).not.toContain('ai-modified-moves');
    expect(html).not.toContain('ai-rejected-moves');
  });
});

describe('enrichMovesWithNames', () => {
  beforeEach(() => {
    getCurrentAnalysis.mockReturnValue(mockAnalysis);
  });

  it('resolves wineName from misplacedWines by wineId', () => {
    const moves = [{ wineId: 1, from: 'R3C1', to: 'R5C2' }];
    const result = enrichMovesWithNames(moves);
    expect(result[0].wineName).toBe('Kanonkop Pinotage 2019');
  });

  it('resolves wineName from suggestedMoves by wineId as fallback', () => {
    const moves = [{ wineId: 3, from: 'R1C4', to: 'R7C1' }];
    const result = enrichMovesWithNames(moves);
    expect(result[0].wineName).toBe('Jordan Cobbler Hill 2017');
  });

  it('falls back to "Wine #123" when name not found in either source', () => {
    const moves = [{ wineId: 999 }];
    const result = enrichMovesWithNames(moves);
    expect(result[0].wineName).toBe('Wine #999');
  });

  it('fills from/to for rejectedMoves from suggestedMoves (R2-1)', () => {
    // rejectedMoves have no from/to in the AI schema
    const moves = [{ wineId: 3, reason: 'Keep in place' }];
    const result = enrichMovesWithNames(moves);
    expect(result[0].from).toBe('R1C4');
    expect(result[0].to).toBe('R7C1');
  });

  it('preserves existing wineName if already present on move object', () => {
    const moves = [{ wineId: 1, wineName: 'Custom Name', from: 'R1C1', to: 'R2C2' }];
    const result = enrichMovesWithNames(moves);
    expect(result[0].wineName).toBe('Custom Name');
  });

  it('returns empty array for null input', () => {
    expect(enrichMovesWithNames(null)).toEqual([]);
  });

  it('returns empty array for undefined input', () => {
    expect(enrichMovesWithNames(undefined)).toEqual([]);
  });

  it('returns empty array for empty array input', () => {
    expect(enrichMovesWithNames([])).toEqual([]);
  });
});

describe('label consistency', () => {
  it('no "Reorganise Cellar" text in any public/js/ file', async () => {
    const { execSync } = await import('child_process');
    try {
      const result = execSync(
        'grep -r "Reorganise Cellar" public/js/ --include="*.js" -l',
        { cwd: process.cwd(), encoding: 'utf-8' }
      );
      // If grep finds matches, it returns them; fail the test
      expect(result.trim()).toBe('');
    } catch (e) {
      // grep returns exit code 1 when no matches found — that's success
      if (e.status === 1) return;
      throw e;
    }
  });

  it('no "Expert Review" text in any public/js/ file', async () => {
    const { execSync } = await import('child_process');
    try {
      const result = execSync(
        'grep -r "Expert Review" public/js/ --include="*.js" -l',
        { cwd: process.cwd(), encoding: 'utf-8' }
      );
      expect(result.trim()).toBe('');
    } catch (e) {
      if (e.status === 1) return;
      throw e;
    }
  });
});
