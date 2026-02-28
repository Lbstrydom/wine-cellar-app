/**
 * @fileoverview Unit tests for issue digest classification.
 * Verifies that alert types are routed to the correct workspace group
 * and that suppressed alerts are summarised (not duplicated).
 * @module tests/unit/cellarAnalysis/issueDigest
 */

vi.mock('../../../public/js/utils.js', () => ({
  showToast: vi.fn(),
  escapeHtml: vi.fn((v) => String(v || ''))
}));

vi.mock('../../../public/js/cellarAnalysis/zones.js', () => ({
  startZoneSetup: vi.fn()
}));

vi.mock('../../../public/js/cellarAnalysis/state.js', () => ({
  switchWorkspace: vi.fn()
}));

import { buildDigestGroups } from '../../../public/js/cellarAnalysis/issueDigest.js';

describe('issueDigest buildDigestGroups', () => {
  describe('colour_order_violation classification', () => {
    it('routes colour_order_violation to structure group, not placement', () => {
      const analysis = {
        alerts: [{
          type: 'colour_order_violation',
          severity: 'warning',
          message: '2 colour order violations',
          data: {
            issues: [
              { row: 'R3', zoneName: 'Sauvignon Blanc', message: 'Sauvignon Blanc (white) in R3 is in the red (bottom) section' },
              { row: 'R5', zoneName: 'Chardonnay', message: 'Chardonnay (white) in R5 is in the red (bottom) section' }
            ],
            colourOrder: 'whites-top'
          }
        }]
      };

      const groups = buildDigestGroups(analysis);
      expect(groups.placement).toHaveLength(0);
      expect(groups.structure).toHaveLength(1);
      expect(groups.structure[0].workspace).toBe('structure');
      // No CTA on the summary item — the Zone Issues banner in Cellar Review
      // workspace provides the canonical "Reorganise Zones" action (Phase 4.7).
      expect(groups.structure[0].ctaAction).toBeUndefined();
    });

    it('uses issue count from data.issues, not alert count', () => {
      const analysis = {
        alerts: [{
          type: 'colour_order_violation',
          severity: 'warning',
          message: 'test',
          data: { issues: [{ message: 'a' }, { message: 'b' }, { message: 'c' }] }
        }]
      };

      const groups = buildDigestGroups(analysis);
      expect(groups.structure[0].message).toContain('3');
    });

    it('does not duplicate colour_order_violation (suppressed + summarised once)', () => {
      const analysis = {
        alerts: [{
          type: 'colour_order_violation',
          severity: 'warning',
          message: 'test',
          data: { issues: [{ message: 'test' }] }
        }]
      };

      const groups = buildDigestGroups(analysis);
      const colourItems = groups.structure.filter(i =>
        i.message.includes('colour order')
      );
      expect(colourItems).toHaveLength(1);
    });

    it('summary message includes "colour order violation(s)" text', () => {
      const analysis = {
        alerts: [{
          type: 'colour_order_violation',
          severity: 'warning',
          message: 'test',
          data: { issues: [{ message: 'x' }] }
        }]
      };

      const groups = buildDigestGroups(analysis);
      expect(groups.structure[0].message).toMatch(/colour order violation/);
    });
  });

  describe('color_adjacency_violation still works correctly', () => {
    it('suppresses color_adjacency_violation from classifyAlert and adds summary to structure', () => {
      const analysis = {
        alerts: [
          { type: 'color_adjacency_violation', severity: 'warning', message: 'R7-R8 boundary issue' },
          { type: 'color_adjacency_violation', severity: 'warning', message: 'R12-R13 boundary issue' }
        ]
      };

      const groups = buildDigestGroups(analysis);
      expect(groups.placement).toHaveLength(0);
      expect(groups.structure).toHaveLength(1);
      expect(groups.structure[0].message).toContain('2 color boundary violation');
    });
  });

  describe('both colour violations coexist without duplication', () => {
    it('shows separate summaries for adjacency and colour order in structure', () => {
      const analysis = {
        alerts: [
          { type: 'color_adjacency_violation', severity: 'warning', message: 'adj1' },
          {
            type: 'colour_order_violation',
            severity: 'warning',
            message: 'order1',
            data: { issues: [{ message: 'v1' }, { message: 'v2' }] }
          }
        ]
      };

      const groups = buildDigestGroups(analysis);
      expect(groups.structure).toHaveLength(2);
      const messages = groups.structure.map(i => i.message);
      expect(messages).toContainEqual(expect.stringContaining('color boundary'));
      expect(messages).toContainEqual(expect.stringContaining('colour order'));
      expect(groups.placement).toHaveLength(0);
    });
  });

  describe('other alert types still classified correctly', () => {
    it('classifies scattered_wines as placement', () => {
      const analysis = {
        alerts: [{ type: 'scattered_wines', severity: 'warning', message: '3 scattered wines' }]
      };
      const groups = buildDigestGroups(analysis);
      expect(groups.placement).toHaveLength(1);
      expect(groups.structure).toHaveLength(0);
    });

    it('suppresses reorganisation_recommended', () => {
      const analysis = {
        alerts: [{ type: 'reorganisation_recommended', severity: 'info', message: 'reorg recommended' }]
      };
      const groups = buildDigestGroups(analysis);
      expect(groups.structure).toHaveLength(0);
      expect(groups.placement).toHaveLength(0);
      expect(groups.fridge).toHaveLength(0);
    });
  });
});
