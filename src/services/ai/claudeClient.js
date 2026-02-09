/**
 * @fileoverview Shared Anthropic client instance for all Claude API integrations.
 * @module services/ai/claudeClient
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120000 })
  : null;

export default anthropic;
