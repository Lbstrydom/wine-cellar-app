/**
 * One-off diagnostic: exercise the OpenAI reviewer and confirm the model used.
 *
 * Safety: never prints OPENAI_API_KEY.
 */

import 'dotenv/config';
import { reviewReconfigurationPlan } from '../src/services/openaiReviewer.js';

if (!process.env.OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in environment.');
  process.exitCode = 2;
  process.exit();
}

// Ensure the feature flag is enabled for this diagnostic.
process.env.OPENAI_REVIEW_ZONE_RECONFIG = 'true';

const plan = {
  actions: [
    {
      type: 'reallocate_row',
      fromZoneId: 'chenin_blanc',
      toZoneId: 'cabernet_sauvignon',
      rowNumber: 3,
      bottlesAffected: 5
    }
  ],
  reasoning: 'Test plan',
  summary: { zonesChanged: 1, bottlesAffected: 5, misplacedBefore: 10, misplacedAfter: 8 }
};

const context = {
  zones: [
    { id: 'chenin_blanc', name: 'Chenin Blanc', actualAssignedRows: [3] },
    { id: 'cabernet_sauvignon', name: 'Cabernet Sauvignon', actualAssignedRows: [4, 5] }
  ],
  physicalConstraints: { totalRows: 19, slotsPerRow: 9, totalCapacity: 169 },
  currentState: { totalBottles: 100, misplaced: 10, misplacementPct: 10 }
};

const result = await reviewReconfigurationPlan(plan, context, {
  model: 'gpt-5.2',
  forceModel: true,
  reasoningEffort: 'low',
  maxOutputTokens: 1200
});

if (result.skipped) {
  console.error('Reviewer skipped:', result.reason);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    verdict: result.verdict,
    reviewer_model: result.telemetry?.reviewer_model,
    latency_ms: result.telemetry?.latency_ms
  }, null, 2));
}
