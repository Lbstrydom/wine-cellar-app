/**
 * @fileoverview Unit tests for Claude response utility functions.
 * Tests extractText and extractStreamText with thinking-enabled responses.
 */

import { extractText, extractStreamText } from '../../../../src/services/ai/claudeResponseUtils.js';

describe('claudeResponseUtils', () => {

  describe('extractText()', () => {
    it('should extract text from standard response (no thinking)', () => {
      const response = {
        content: [
          { type: 'text', text: 'Hello world' }
        ]
      };
      expect(extractText(response)).toBe('Hello world');
    });

    it('should extract text when thinking block precedes text block', () => {
      const response = {
        content: [
          { type: 'thinking', thinking: 'Let me reason about this...' },
          { type: 'text', text: '{"result": "success"}' }
        ]
      };
      expect(extractText(response)).toBe('{"result": "success"}');
    });

    it('should extract text when redacted_thinking block precedes text block', () => {
      const response = {
        content: [
          { type: 'redacted_thinking', data: 'encrypted_data_here' },
          { type: 'text', text: 'The answer is 42' }
        ]
      };
      expect(extractText(response)).toBe('The answer is 42');
    });

    it('should handle multiple thinking blocks before text', () => {
      const response = {
        content: [
          { type: 'thinking', thinking: 'First thought...' },
          { type: 'thinking', thinking: 'Second thought...' },
          { type: 'text', text: 'Final answer' }
        ]
      };
      expect(extractText(response)).toBe('Final answer');
    });

    it('should skip leading empty text block from adaptive thinking (Opus 4.6 pattern)', () => {
      // Opus 4.6 with adaptive thinking returns: [text("\n\n"), thinking, text(answer)]
      const response = {
        content: [
          { type: 'text', text: '\n\n' },
          { type: 'thinking', thinking: 'Let me analyze this cellar...' },
          { type: 'text', text: '{"confirmedMoves": [], "summary": "All good"}' }
        ]
      };
      expect(extractText(response)).toBe('{"confirmedMoves": [], "summary": "All good"}');
    });

    it('should skip leading whitespace-only text block with empty string', () => {
      const response = {
        content: [
          { type: 'text', text: '' },
          { type: 'thinking', thinking: 'reasoning...' },
          { type: 'text', text: 'Actual content' }
        ]
      };
      expect(extractText(response)).toBe('Actual content');
    });

    it('should skip multiple empty text blocks to find content', () => {
      const response = {
        content: [
          { type: 'text', text: '  \n  ' },
          { type: 'thinking', thinking: 'step 1' },
          { type: 'text', text: '\t\n' },
          { type: 'thinking', thinking: 'step 2' },
          { type: 'text', text: '{"result": true}' }
        ]
      };
      expect(extractText(response)).toBe('{"result": true}');
    });

    it('should return last text block when all are whitespace', () => {
      const response = {
        content: [
          { type: 'text', text: '\n\n' },
          { type: 'thinking', thinking: 'reasoning...' },
          { type: 'text', text: '   ' }
        ]
      };
      // All whitespace — return the last one as-is
      expect(extractText(response)).toBe('   ');
    });

    it('should throw on empty content array', () => {
      expect(() => extractText({ content: [] })).toThrow('Empty response from Claude API');
    });

    it('should throw on null/undefined response', () => {
      expect(() => extractText(null)).toThrow('Empty response from Claude API');
      expect(() => extractText(undefined)).toThrow('Empty response from Claude API');
    });

    it('should throw on missing content', () => {
      expect(() => extractText({})).toThrow('Empty response from Claude API');
    });

    it('should throw when no text block exists', () => {
      const response = {
        content: [
          { type: 'thinking', thinking: 'Only thinking, no text' }
        ]
      };
      expect(() => extractText(response)).toThrow('No text block found in Claude response');
    });
  });

  describe('extractStreamText()', () => {
    function createMockStream(events) {
      return {
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            next() {
              if (i < events.length) {
                return Promise.resolve({ value: events[i++], done: false });
              }
              return Promise.resolve({ done: true });
            }
          };
        }
      };
    }

    it('should collect text_delta events from stream', async () => {
      const stream = createMockStream([
        { type: 'content_block_start', content_block: { type: 'text' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } },
        { type: 'content_block_stop' }
      ]);

      expect(await extractStreamText(stream)).toBe('Hello world');
    });

    it('should ignore thinking_delta events', async () => {
      const stream = createMockStream([
        { type: 'content_block_start', content_block: { type: 'thinking' } },
        { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'reasoning...' } },
        { type: 'content_block_stop' },
        { type: 'content_block_start', content_block: { type: 'text' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'result' } },
        { type: 'content_block_stop' }
      ]);

      expect(await extractStreamText(stream)).toBe('result');
    });

    it('should return empty string when no text_delta events', async () => {
      const stream = createMockStream([
        { type: 'content_block_start', content_block: { type: 'thinking' } },
        { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'only thinking' } },
        { type: 'content_block_stop' }
      ]);

      expect(await extractStreamText(stream)).toBe('');
    });

    it('should handle empty stream', async () => {
      const stream = createMockStream([]);
      expect(await extractStreamText(stream)).toBe('');
    });

    it('should ignore non-content events', async () => {
      const stream = createMockStream([
        { type: 'message_start', message: {} },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'data' } },
        { type: 'message_delta', delta: {} },
        { type: 'message_stop' }
      ]);

      expect(await extractStreamText(stream)).toBe('data');
    });
  });
});
