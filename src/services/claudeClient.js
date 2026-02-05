/**
 * @fileoverview Shared Anthropic client instance for all Claude API integrations.
 * @module services/claudeClient
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 120000 // 2 minute timeout for API calls
});

export default anthropic;
