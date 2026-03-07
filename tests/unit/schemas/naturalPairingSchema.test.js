/**
 * @fileoverview Unit tests for naturalPairingSchema.
 * Covers image fields, either-or refinement, and backwards compatibility.
 */

const { naturalPairingSchema } = await import('../../../src/schemas/pairing.js');

describe('naturalPairingSchema', () => {
  describe('backwards compatibility — text only', () => {
    it('accepts a plain dish description', () => {
      const result = naturalPairingSchema.safeParse({ dish: 'grilled salmon', source: 'all', colour: 'any' });
      expect(result.success).toBe(true);
    });

    it('applies defaults for source and colour', () => {
      const result = naturalPairingSchema.safeParse({ dish: 'steak' });
      expect(result.success).toBe(true);
      expect(result.data.source).toBe('all');
      expect(result.data.colour).toBe('any');
    });

    it('rejects dish exceeding 2000 characters', () => {
      const result = naturalPairingSchema.safeParse({ dish: 'a'.repeat(2001) });
      expect(result.success).toBe(false);
    });
  });

  describe('image-only input', () => {
    it('accepts image without dish when mediaType provided', () => {
      const result = naturalPairingSchema.safeParse({
        image: 'base64data==',
        mediaType: 'image/jpeg'
      });
      expect(result.success).toBe(true);
    });

    it('rejects image without mediaType', () => {
      const result = naturalPairingSchema.safeParse({ image: 'base64data==' });
      expect(result.success).toBe(false);
    });

    it('rejects unsupported mediaType', () => {
      const result = naturalPairingSchema.safeParse({
        image: 'base64data==',
        mediaType: 'image/bmp'
      });
      expect(result.success).toBe(false);
    });

    it('accepts all supported image mediaTypes', () => {
      for (const mt of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
        const result = naturalPairingSchema.safeParse({ image: 'data==', mediaType: mt });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('image + text combined', () => {
    it('accepts both dish and image together', () => {
      const result = naturalPairingSchema.safeParse({
        dish: 'Thai green curry',
        image: 'base64data==',
        mediaType: 'image/jpeg'
      });
      expect(result.success).toBe(true);
    });
  });

  describe('either-or refinement', () => {
    it('rejects when neither dish nor image is provided', () => {
      const result = naturalPairingSchema.safeParse({ source: 'all', colour: 'any' });
      expect(result.success).toBe(false);
    });

    it('rejects empty string dish with no image', () => {
      const result = naturalPairingSchema.safeParse({ dish: '   ' });
      expect(result.success).toBe(false);
    });
  });
});
