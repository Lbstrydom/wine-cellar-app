/**
 * @fileoverview Utilities for extracting text from Claude API responses.
 * Handles both thinking-enabled and standard responses gracefully.
 * @module services/ai/claudeResponseUtils
 */

/**
 * Extract the text content from a Claude API response.
 * When adaptive thinking is enabled, response.content may contain thinking
 * and redacted_thinking blocks interleaved with text blocks. With Opus 4.6
 * adaptive thinking, the response often has the structure:
 *   [text("\n\n"), thinking(...), text(actual_answer)]
 * This function finds the LAST non-empty text block, which contains the
 * actual model output rather than a leading whitespace placeholder.
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

  // Collect all text blocks
  const textBlocks = content.filter(block => block.type === 'text');
  if (textBlocks.length === 0) {
    throw new Error('No text block found in Claude response');
  }

  // With adaptive thinking, the first text block may be empty whitespace
  // (e.g. "\n\n") while the actual answer is in a later text block.
  // Find the last text block with non-whitespace content.
  for (let i = textBlocks.length - 1; i >= 0; i--) {
    if (textBlocks[i].text && textBlocks[i].text.trim().length > 0) {
      return textBlocks[i].text;
    }
  }

  // All text blocks are empty/whitespace — return the last one as-is
  return textBlocks[textBlocks.length - 1].text;
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
