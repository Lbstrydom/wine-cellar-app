/**
 * @fileoverview Utilities for extracting text from Claude API responses.
 * Handles both thinking-enabled and standard responses gracefully.
 * @module services/ai/claudeResponseUtils
 */

/**
 * Extract the text content from a Claude API response.
 * When adaptive thinking is enabled, response.content may contain thinking
 * and redacted_thinking blocks before text blocks. This function finds the
 * first text block.
 *
 * @param {Object} response - Claude messages.create() response
 * @returns {string} The text content from the response
 * @throws {Error} If no text block is found in the response
 */
export function extractText(response) {
  const content = response?.content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error('Empty response from Claude API');
  }

  const textBlock = content.find(block => block.type === 'text');
  if (!textBlock) {
    throw new Error('No text block found in Claude response');
  }

  return textBlock.text;
}

/**
 * Extract the text content from a Claude streaming response.
 * Collects only text_delta events, ignoring thinking_delta,
 * content_block_start, content_block_stop, and other event types.
 *
 * @param {AsyncIterable} stream - Claude streaming response
 * @returns {Promise<string>} The accumulated text content
 */
export async function extractStreamText(stream) {
  let responseText = '';

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      responseText += event.delta.text;
    }
  }

  return responseText;
}
