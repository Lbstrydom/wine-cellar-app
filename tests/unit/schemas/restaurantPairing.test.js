/**
 * @fileoverview Schema validation tests for restaurant pairing schemas.
 * Tests request schemas (parse-menu, recommend, chat), response schemas,
 * and exported constants.
 * Uses vitest globals (do NOT import from 'vitest').
 */

import {
  parseMenuSchema,
  recommendSchema,
  restaurantChatSchema,
  parsedWineItemSchema,
  parsedDishItemSchema,
  wineListResponseSchema,
  dishMenuResponseSchema,
  pairingItemSchema,
  tableWineSchema,
  recommendResponseSchema,
  MAX_IMAGE_BASE64_CHARS,
  MENU_TYPES,
  RESTAURANT_WINE_COLOURS,
  DISH_CATEGORIES,
  CONFIDENCE_LEVELS
} from '../../../src/schemas/restaurantPairing.js';
import { expectSchemaPass, expectSchemaFail } from '../helpers/schemaTestUtils.js';

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

function validParseText(overrides = {}) {
  return { type: 'wine_list', text: 'Merlot 2019 R350', image: null, mediaType: null, ...overrides };
}

function validParseImage(overrides = {}) {
  return { type: 'wine_list', text: null, image: 'iVBORw0KGgo=', mediaType: 'image/jpeg', ...overrides };
}

function validWine(overrides = {}) {
  return { id: 1, name: 'Merlot Reserve', colour: 'red', style: null, vintage: 2019, price: 350, by_the_glass: false, ...overrides };
}

function validDish(overrides = {}) {
  return { id: 1, name: 'Grilled Lamb', description: 'With rosemary jus', category: 'Main', ...overrides };
}

function validRecommend(overrides = {}) {
  return {
    wines: [validWine()],
    dishes: [validDish()],
    colour_preferences: [],
    budget_max: null,
    party_size: null,
    max_bottles: null,
    prefer_by_glass: false,
    ...overrides
  };
}

function validChat(overrides = {}) {
  return { chatId: '550e8400-e29b-41d4-a716-446655440000', message: 'What about a lighter option?', ...overrides };
}

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

describe('Exported constants', () => {
  it('MAX_IMAGE_BASE64_CHARS is 4 * ceil(2MB / 3)', () => {
    const expected = 4 * Math.ceil((2 * 1024 * 1024) / 3);
    expect(MAX_IMAGE_BASE64_CHARS).toBe(expected);
  });

  it('MENU_TYPES contains wine_list and dish_menu', () => {
    expect(MENU_TYPES).toEqual(['wine_list', 'dish_menu']);
  });

  it('RESTAURANT_WINE_COLOURS contains 4 colours', () => {
    expect(RESTAURANT_WINE_COLOURS).toEqual(['red', 'white', 'rose', 'sparkling']);
  });

  it('DISH_CATEGORIES contains 5 categories', () => {
    expect(DISH_CATEGORIES).toEqual(['Starter', 'Main', 'Dessert', 'Side', 'Sharing']);
  });

  it('CONFIDENCE_LEVELS contains 3 levels', () => {
    expect(CONFIDENCE_LEVELS).toEqual(['high', 'medium', 'low']);
  });
});

// ---------------------------------------------------------------------------
// parseMenuSchema
// ---------------------------------------------------------------------------

describe('parseMenuSchema', () => {
  describe('type field', () => {
    it.each(MENU_TYPES)('accepts valid type "%s"', (type) => {
      const result = expectSchemaPass(parseMenuSchema, validParseText({ type }));
      expect(result.type).toBe(type);
    });

    it('rejects invalid type', () => {
      expectSchemaFail(parseMenuSchema, validParseText({ type: 'cocktail_list' }));
    });

    it('rejects missing type', () => {
      const data = validParseText();
      delete data.type;
      expectSchemaFail(parseMenuSchema, data);
    });
  });

  describe('text input', () => {
    it('accepts valid text with null image', () => {
      const result = expectSchemaPass(parseMenuSchema, validParseText());
      expect(result.text).toBe('Merlot 2019 R350');
      expect(result.image).toBeNull();
    });

    it('trims whitespace from text', () => {
      const result = expectSchemaPass(parseMenuSchema, validParseText({ text: '  Wine list  ' }));
      expect(result.text).toBe('Wine list');
    });

    it('rejects text over 5000 characters', () => {
      expectSchemaFail(parseMenuSchema, validParseText({ text: 'x'.repeat(5001) }));
    });

    it('defaults text to null when omitted', () => {
      const data = { type: 'wine_list', image: 'iVBORw0KGgo=', mediaType: 'image/jpeg' };
      const result = expectSchemaPass(parseMenuSchema, data);
      expect(result.text).toBeNull();
    });
  });

  describe('image input', () => {
    it('accepts valid base64 image with mediaType', () => {
      const result = expectSchemaPass(parseMenuSchema, validParseImage());
      expect(result.image).toBe('iVBORw0KGgo=');
      expect(result.mediaType).toBe('image/jpeg');
    });

    it('rejects image exceeding MAX_IMAGE_BASE64_CHARS', () => {
      expectSchemaFail(parseMenuSchema, validParseImage({ image: 'A'.repeat(MAX_IMAGE_BASE64_CHARS + 1) }));
    });

    it('accepts image at exactly MAX_IMAGE_BASE64_CHARS (boundary)', () => {
      const result = expectSchemaPass(parseMenuSchema, validParseImage({
        image: 'A'.repeat(MAX_IMAGE_BASE64_CHARS)
      }));
      expect(result.image).toHaveLength(MAX_IMAGE_BASE64_CHARS);
    });

    it('defaults image to null when omitted', () => {
      const result = expectSchemaPass(parseMenuSchema, validParseText());
      expect(result.image).toBeNull();
    });
  });

  describe('mediaType field', () => {
    it.each(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])('accepts valid mediaType "%s"', (mediaType) => {
      const result = expectSchemaPass(parseMenuSchema, validParseImage({ mediaType }));
      expect(result.mediaType).toBe(mediaType);
    });

    it('rejects invalid mediaType', () => {
      expectSchemaFail(parseMenuSchema, validParseImage({ mediaType: 'image/bmp' }));
    });

    it('defaults mediaType to null when omitted', () => {
      const result = expectSchemaPass(parseMenuSchema, validParseText());
      expect(result.mediaType).toBeNull();
    });
  });

  describe('mutual exclusion refinements', () => {
    it('rejects when neither text nor image provided', () => {
      expectSchemaFail(parseMenuSchema, { type: 'wine_list', text: null, image: null, mediaType: null });
    });

    it('rejects empty string text with null image', () => {
      expectSchemaFail(parseMenuSchema, { type: 'wine_list', text: '', image: null, mediaType: null });
    });

    it('rejects whitespace-only text with null image (trimmed to empty)', () => {
      expectSchemaFail(parseMenuSchema, { type: 'wine_list', text: '   ', image: null, mediaType: null });
    });

    it('rejects when both text and image provided', () => {
      expectSchemaFail(parseMenuSchema, {
        type: 'wine_list', text: 'some text', image: 'iVBORw0KGgo=', mediaType: 'image/jpeg'
      });
    });

    it('rejects image without mediaType', () => {
      expectSchemaFail(parseMenuSchema, {
        type: 'wine_list', text: null, image: 'iVBORw0KGgo=', mediaType: null
      });
    });

    // Tolerant parsing: mediaType is harmless noise when no image is present.
    // Frontends may send a default mediaType even for text-only requests.
    it('accepts text with extraneous mediaType (tolerant parsing)', () => {
      const result = expectSchemaPass(parseMenuSchema, {
        type: 'wine_list', text: 'Merlot 2019', image: null, mediaType: 'image/jpeg'
      });
      expect(result.text).toBe('Merlot 2019');
      expect(result.mediaType).toBe('image/jpeg');
    });
  });
});

// ---------------------------------------------------------------------------
// recommendSchema
// ---------------------------------------------------------------------------

describe('recommendSchema', () => {
  describe('valid payloads', () => {
    it('accepts minimal valid payload (1 wine, 1 dish)', () => {
      const result = expectSchemaPass(recommendSchema, validRecommend());
      expect(result.wines).toHaveLength(1);
      expect(result.dishes).toHaveLength(1);
    });

    it('applies defaults for optional fields', () => {
      const result = expectSchemaPass(recommendSchema, {
        wines: [validWine()],
        dishes: [validDish()]
      });
      expect(result.colour_preferences).toEqual([]);
      expect(result.budget_max).toBeNull();
      expect(result.party_size).toBeNull();
      expect(result.max_bottles).toBeNull();
      expect(result.prefer_by_glass).toBe(false);
    });

    it('accepts full payload with all options', () => {
      const result = expectSchemaPass(recommendSchema, validRecommend({
        colour_preferences: ['red', 'white'],
        budget_max: 500,
        party_size: 4,
        max_bottles: 3,
        prefer_by_glass: true
      }));
      expect(result.colour_preferences).toEqual(['red', 'white']);
      expect(result.budget_max).toBe(500);
      expect(result.party_size).toBe(4);
      expect(result.max_bottles).toBe(3);
      expect(result.prefer_by_glass).toBe(true);
    });
  });

  describe('wines array', () => {
    it('rejects empty wines array', () => {
      expectSchemaFail(recommendSchema, validRecommend({ wines: [] }));
    });

    it('rejects more than 80 wines', () => {
      const wines = Array.from({ length: 81 }, (_, i) => validWine({ id: i + 1 }));
      expectSchemaFail(recommendSchema, validRecommend({ wines }));
    });

    it('accepts exactly 80 wines', () => {
      const wines = Array.from({ length: 80 }, (_, i) => validWine({ id: i + 1 }));
      const result = expectSchemaPass(recommendSchema, validRecommend({ wines }));
      expect(result.wines).toHaveLength(80);
    });
  });

  describe('wine item validation', () => {
    it('rejects wine with non-positive id', () => {
      expectSchemaFail(recommendSchema, validRecommend({ wines: [validWine({ id: 0 })] }));
    });

    it('rejects wine with negative id', () => {
      expectSchemaFail(recommendSchema, validRecommend({ wines: [validWine({ id: -1 })] }));
    });

    it('rejects wine with empty name', () => {
      expectSchemaFail(recommendSchema, validRecommend({ wines: [validWine({ name: '' })] }));
    });

    it('rejects wine name over 300 characters', () => {
      expectSchemaFail(recommendSchema, validRecommend({ wines: [validWine({ name: 'x'.repeat(301) })] }));
    });

    it('accepts wine with null optional fields', () => {
      const result = expectSchemaPass(recommendSchema, validRecommend({
        wines: [validWine({ colour: null, style: null, vintage: null, price: null })]
      }));
      const wine = result.wines[0];
      expect(wine.colour).toBeNull();
      expect(wine.style).toBeNull();
      expect(wine.vintage).toBeNull();
      expect(wine.price).toBeNull();
    });

    it('rejects wine with vintage below 1900', () => {
      expectSchemaFail(recommendSchema, validRecommend({ wines: [validWine({ vintage: 1800 })] }));
    });

    it('rejects wine with vintage above 2100', () => {
      expectSchemaFail(recommendSchema, validRecommend({ wines: [validWine({ vintage: 2200 })] }));
    });

    it('rejects wine with negative price', () => {
      expectSchemaFail(recommendSchema, validRecommend({ wines: [validWine({ price: -1 })] }));
    });

    it('accepts wine with price 0', () => {
      const result = expectSchemaPass(recommendSchema, validRecommend({
        wines: [validWine({ price: 0 })]
      }));
      expect(result.wines[0].price).toBe(0);
    });

    it('defaults by_the_glass to false when omitted', () => {
      const wine = validWine();
      delete wine.by_the_glass;
      const result = expectSchemaPass(recommendSchema, validRecommend({ wines: [wine] }));
      expect(result.wines[0].by_the_glass).toBe(false);
    });
  });

  describe('dishes array', () => {
    it('rejects empty dishes array', () => {
      expectSchemaFail(recommendSchema, validRecommend({ dishes: [] }));
    });

    it('rejects more than 20 dishes', () => {
      const dishes = Array.from({ length: 21 }, (_, i) => validDish({ id: i + 1 }));
      expectSchemaFail(recommendSchema, validRecommend({ dishes }));
    });

    it('accepts exactly 20 dishes', () => {
      const dishes = Array.from({ length: 20 }, (_, i) => validDish({ id: i + 1 }));
      const result = expectSchemaPass(recommendSchema, validRecommend({ dishes }));
      expect(result.dishes).toHaveLength(20);
    });
  });

  describe('dish item validation', () => {
    it('rejects dish with non-positive id', () => {
      expectSchemaFail(recommendSchema, validRecommend({ dishes: [validDish({ id: 0 })] }));
    });

    it('rejects dish with empty name', () => {
      expectSchemaFail(recommendSchema, validRecommend({ dishes: [validDish({ name: '' })] }));
    });

    it('rejects dish name over 300 characters', () => {
      expectSchemaFail(recommendSchema, validRecommend({ dishes: [validDish({ name: 'x'.repeat(301) })] }));
    });

    it('rejects dish description over 1000 characters', () => {
      expectSchemaFail(recommendSchema, validRecommend({
        dishes: [validDish({ description: 'x'.repeat(1001) })]
      }));
    });

    it.each(DISH_CATEGORIES)('accepts valid dish category "%s"', (category) => {
      const result = expectSchemaPass(recommendSchema, validRecommend({
        dishes: [validDish({ category })]
      }));
      expect(result.dishes[0].category).toBe(category);
    });

    it('rejects invalid dish category', () => {
      expectSchemaFail(recommendSchema, validRecommend({
        dishes: [validDish({ category: 'Beverage' })]
      }));
    });

    it('accepts null category', () => {
      const result = expectSchemaPass(recommendSchema, validRecommend({
        dishes: [validDish({ category: null })]
      }));
      expect(result.dishes[0].category).toBeNull();
    });
  });

  describe('colour_preferences', () => {
    it.each(RESTAURANT_WINE_COLOURS)('accepts valid colour "%s"', (colour) => {
      const result = expectSchemaPass(recommendSchema, validRecommend({
        colour_preferences: [colour]
      }));
      expect(result.colour_preferences).toContain(colour);
    });

    it('rejects invalid colour', () => {
      expectSchemaFail(recommendSchema, validRecommend({ colour_preferences: ['orange'] }));
    });

    it('accepts multiple colours', () => {
      const result = expectSchemaPass(recommendSchema, validRecommend({
        colour_preferences: ['red', 'white', 'sparkling']
      }));
      expect(result.colour_preferences).toHaveLength(3);
    });
  });

  describe('constraint bounds', () => {
    it('rejects negative budget_max', () => {
      expectSchemaFail(recommendSchema, validRecommend({ budget_max: -1 }));
    });

    it('accepts budget_max of 0', () => {
      const result = expectSchemaPass(recommendSchema, validRecommend({ budget_max: 0 }));
      expect(result.budget_max).toBe(0);
    });

    it('rejects party_size of 0', () => {
      expectSchemaFail(recommendSchema, validRecommend({ party_size: 0 }));
    });

    it('rejects party_size over 20', () => {
      expectSchemaFail(recommendSchema, validRecommend({ party_size: 21 }));
    });

    it('rejects max_bottles of 0', () => {
      expectSchemaFail(recommendSchema, validRecommend({ max_bottles: 0 }));
    });

    it('rejects max_bottles over 10', () => {
      expectSchemaFail(recommendSchema, validRecommend({ max_bottles: 11 }));
    });

    it('rejects non-integer party_size', () => {
      expectSchemaFail(recommendSchema, validRecommend({ party_size: 2.5 }));
    });

    it('rejects non-integer max_bottles', () => {
      expectSchemaFail(recommendSchema, validRecommend({ max_bottles: 1.5 }));
    });
  });

  // Restaurant pairing uses JSON API (not HTML forms), so z.number() is strict —
  // no string→number coercion. This is intentionally different from wine schemas
  // which transform string numerics for HTML form inputs.
  describe('strict numeric typing (no string coercion)', () => {
    it('rejects string wine id', () => {
      expectSchemaFail(recommendSchema, validRecommend({ wines: [validWine({ id: '1' })] }));
    });

    it('rejects string wine vintage', () => {
      expectSchemaFail(recommendSchema, validRecommend({ wines: [validWine({ vintage: '2019' })] }));
    });

    it('rejects string wine price', () => {
      expectSchemaFail(recommendSchema, validRecommend({ wines: [validWine({ price: '350' })] }));
    });

    it('rejects string dish id', () => {
      expectSchemaFail(recommendSchema, validRecommend({ dishes: [validDish({ id: '1' })] }));
    });

    it('rejects string budget_max', () => {
      expectSchemaFail(recommendSchema, validRecommend({ budget_max: '500' }));
    });

    it('rejects string party_size', () => {
      expectSchemaFail(recommendSchema, validRecommend({ party_size: '4' }));
    });
  });
});

// ---------------------------------------------------------------------------
// restaurantChatSchema
// ---------------------------------------------------------------------------

describe('restaurantChatSchema', () => {
  it('accepts valid chat payload', () => {
    const result = expectSchemaPass(restaurantChatSchema, validChat());
    expect(result.chatId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(result.message).toBe('What about a lighter option?');
  });

  it('trims whitespace from message', () => {
    const result = expectSchemaPass(restaurantChatSchema, validChat({ message: '  hello  ' }));
    expect(result.message).toBe('hello');
  });

  it('rejects non-UUID chatId', () => {
    expectSchemaFail(restaurantChatSchema, validChat({ chatId: 'not-a-uuid' }));
  });

  it('rejects empty chatId', () => {
    expectSchemaFail(restaurantChatSchema, validChat({ chatId: '' }));
  });

  it('rejects empty message', () => {
    expectSchemaFail(restaurantChatSchema, validChat({ message: '' }));
  });

  it('rejects whitespace-only message (trimmed to empty)', () => {
    expectSchemaFail(restaurantChatSchema, validChat({ message: '   ' }));
  });

  it('rejects message over 2000 characters', () => {
    expectSchemaFail(restaurantChatSchema, validChat({ message: 'x'.repeat(2001) }));
  });

  it('accepts message at exactly 2000 characters', () => {
    const result = expectSchemaPass(restaurantChatSchema, validChat({ message: 'x'.repeat(2000) }));
    expect(result.message).toHaveLength(2000);
  });

  it('rejects missing chatId', () => {
    expectSchemaFail(restaurantChatSchema, { message: 'hello' });
  });

  it('rejects missing message', () => {
    expectSchemaFail(restaurantChatSchema, { chatId: '550e8400-e29b-41d4-a716-446655440000' });
  });
});

// ---------------------------------------------------------------------------
// Response schemas — parsedWineItemSchema
// ---------------------------------------------------------------------------

describe('parsedWineItemSchema', () => {
  function validParsedWine(overrides = {}) {
    return { type: 'wine', name: 'Merlot Reserve', confidence: 'high', ...overrides };
  }

  it('accepts minimal valid parsed wine', () => {
    const result = expectSchemaPass(parsedWineItemSchema, validParsedWine());
    expect(result.type).toBe('wine');
    expect(result.name).toBe('Merlot Reserve');
    expect(result.confidence).toBe('high');
  });

  it('applies defaults for optional fields', () => {
    const result = expectSchemaPass(parsedWineItemSchema, validParsedWine());
    expect(result.colour).toBeNull();
    expect(result.style).toBeNull();
    expect(result.price).toBeNull();
    expect(result.currency).toBeNull();
    expect(result.vintage).toBeNull();
    expect(result.by_the_glass).toBe(false);
    expect(result.region).toBeNull();
  });

  it('accepts full parsed wine with all fields', () => {
    const result = expectSchemaPass(parsedWineItemSchema, validParsedWine({
      colour: 'red', style: 'Full-bodied', price: 350, currency: 'ZAR',
      vintage: 2019, by_the_glass: true, region: 'Stellenbosch'
    }));
    expect(result.colour).toBe('red');
    expect(result.price).toBe(350);
    expect(result.by_the_glass).toBe(true);
  });

  it('rejects type other than "wine"', () => {
    expectSchemaFail(parsedWineItemSchema, validParsedWine({ type: 'dish' }));
  });

  it.each(CONFIDENCE_LEVELS)('accepts confidence level "%s"', (confidence) => {
    expectSchemaPass(parsedWineItemSchema, validParsedWine({ confidence }));
  });

  it('rejects invalid confidence level', () => {
    expectSchemaFail(parsedWineItemSchema, validParsedWine({ confidence: 'unknown' }));
  });
});

// ---------------------------------------------------------------------------
// Response schemas — parsedDishItemSchema
// ---------------------------------------------------------------------------

describe('parsedDishItemSchema', () => {
  function validParsedDish(overrides = {}) {
    return { type: 'dish', name: 'Grilled Lamb', confidence: 'medium', ...overrides };
  }

  it('accepts minimal valid parsed dish', () => {
    const result = expectSchemaPass(parsedDishItemSchema, validParsedDish());
    expect(result.type).toBe('dish');
    expect(result.name).toBe('Grilled Lamb');
  });

  it('applies defaults for optional fields', () => {
    const result = expectSchemaPass(parsedDishItemSchema, validParsedDish());
    expect(result.description).toBeNull();
    expect(result.price).toBeNull();
    expect(result.currency).toBeNull();
    expect(result.category).toBeNull();
  });

  it('rejects type other than "dish"', () => {
    expectSchemaFail(parsedDishItemSchema, validParsedDish({ type: 'wine' }));
  });

  it.each(DISH_CATEGORIES)('accepts valid category "%s"', (category) => {
    const result = expectSchemaPass(parsedDishItemSchema, validParsedDish({ category }));
    expect(result.category).toBe(category);
  });

  it('rejects invalid category', () => {
    expectSchemaFail(parsedDishItemSchema, validParsedDish({ category: 'Beverage' }));
  });
});

// ---------------------------------------------------------------------------
// Response schemas — wineListResponseSchema / dishMenuResponseSchema
// ---------------------------------------------------------------------------

describe('wineListResponseSchema', () => {
  it('accepts valid wine list response', () => {
    const result = expectSchemaPass(wineListResponseSchema, {
      items: [{ type: 'wine', name: 'Merlot', confidence: 'high' }],
      overall_confidence: 'high',
      parse_notes: 'Clear wine list'
    });
    expect(result.items).toHaveLength(1);
    expect(result.overall_confidence).toBe('high');
  });

  it('accepts empty items array', () => {
    const result = expectSchemaPass(wineListResponseSchema, {
      items: [],
      overall_confidence: 'low',
      parse_notes: 'No wines found'
    });
    expect(result.items).toHaveLength(0);
  });

  it('rejects dish item in wine list', () => {
    expectSchemaFail(wineListResponseSchema, {
      items: [{ type: 'dish', name: 'Lamb', confidence: 'high' }],
      overall_confidence: 'high',
      parse_notes: ''
    });
  });
});

describe('dishMenuResponseSchema', () => {
  it('accepts valid dish menu response', () => {
    const result = expectSchemaPass(dishMenuResponseSchema, {
      items: [{ type: 'dish', name: 'Lamb', confidence: 'medium' }],
      overall_confidence: 'medium',
      parse_notes: 'Some items unclear'
    });
    expect(result.items).toHaveLength(1);
  });

  it('rejects wine item in dish menu', () => {
    expectSchemaFail(dishMenuResponseSchema, {
      items: [{ type: 'wine', name: 'Merlot', confidence: 'high' }],
      overall_confidence: 'high',
      parse_notes: ''
    });
  });
});

// ---------------------------------------------------------------------------
// Response schemas — pairingItemSchema / tableWineSchema / recommendResponseSchema
// ---------------------------------------------------------------------------

describe('pairingItemSchema', () => {
  function validPairing(overrides = {}) {
    return {
      rank: 1, dish_name: 'Lamb', wine_id: 1, wine_name: 'Merlot',
      wine_colour: 'red', wine_price: 350, by_the_glass: false,
      why: 'Rich tannins complement lamb', serving_tip: 'Serve at 16°C',
      confidence: 'high', ...overrides
    };
  }

  it('accepts valid pairing', () => {
    const result = expectSchemaPass(pairingItemSchema, validPairing());
    expect(result.rank).toBe(1);
    expect(result.wine_id).toBe(1);
  });

  it('rejects non-positive rank', () => {
    expectSchemaFail(pairingItemSchema, validPairing({ rank: 0 }));
  });

  it('rejects non-positive wine_id', () => {
    expectSchemaFail(pairingItemSchema, validPairing({ wine_id: 0 }));
  });

  it('accepts null wine_price', () => {
    const result = expectSchemaPass(pairingItemSchema, validPairing({ wine_price: null }));
    expect(result.wine_price).toBeNull();
  });
});

describe('tableWineSchema', () => {
  it('accepts valid table wine', () => {
    const result = expectSchemaPass(tableWineSchema, {
      wine_name: 'Cab Sav', wine_price: 500, why: 'Versatile'
    });
    expect(result.wine_name).toBe('Cab Sav');
  });

  it('accepts null wine_price', () => {
    const result = expectSchemaPass(tableWineSchema, {
      wine_name: 'Cab Sav', wine_price: null, why: 'Versatile'
    });
    expect(result.wine_price).toBeNull();
  });
});

describe('recommendResponseSchema', () => {
  function validResponse(overrides = {}) {
    return {
      table_summary: 'Great choices',
      pairings: [{
        rank: 1, dish_name: 'Lamb', wine_id: 1, wine_name: 'Merlot',
        wine_colour: 'red', wine_price: 350, by_the_glass: false,
        why: 'Rich match', serving_tip: '16°C', confidence: 'high'
      }],
      table_wine: { wine_name: 'Cab Sav', wine_price: 500, why: 'Versatile' },
      chatId: '550e8400-e29b-41d4-a716-446655440000',
      fallback: false,
      ...overrides
    };
  }

  it('accepts valid full response', () => {
    const result = expectSchemaPass(recommendResponseSchema, validResponse());
    expect(result.pairings).toHaveLength(1);
    expect(result.table_wine).not.toBeNull();
    expect(result.fallback).toBe(false);
  });

  it('applies defaults for optional fields', () => {
    const result = expectSchemaPass(recommendResponseSchema, {
      table_summary: 'AI unavailable',
      pairings: []
    });
    expect(result.table_wine).toBeNull();
    expect(result.chatId).toBeNull();
    expect(result.fallback).toBe(false);
  });

  it('accepts null table_wine (all by-the-glass)', () => {
    const result = expectSchemaPass(recommendResponseSchema, validResponse({ table_wine: null }));
    expect(result.table_wine).toBeNull();
  });

  it('accepts fallback: true', () => {
    const result = expectSchemaPass(recommendResponseSchema, validResponse({ fallback: true }));
    expect(result.fallback).toBe(true);
  });

  it('accepts empty pairings array', () => {
    const result = expectSchemaPass(recommendResponseSchema, validResponse({ pairings: [] }));
    expect(result.pairings).toHaveLength(0);
  });

  it('rejects non-UUID chatId string', () => {
    expectSchemaFail(recommendResponseSchema, validResponse({ chatId: 'not-a-uuid' }));
  });

  // Response schemas intentionally accept empty strings for server-generated fields.
  // The fallback path sets serving_tip: '' and table_summary can be '' on empty results.
  // Tightening would cause validation failures for legitimate generated data.
  describe('empty string acceptance in response fields (intentional)', () => {
    it('accepts empty table_summary', () => {
      const result = expectSchemaPass(recommendResponseSchema, validResponse({ table_summary: '' }));
      expect(result.table_summary).toBe('');
    });

    it('accepts empty serving_tip in pairing', () => {
      const result = expectSchemaPass(pairingItemSchema, {
        rank: 1, dish_name: 'Lamb', wine_id: 1, wine_name: 'Merlot',
        wine_colour: 'red', wine_price: null, by_the_glass: false,
        why: 'Good match', serving_tip: '', confidence: 'low'
      });
      expect(result.serving_tip).toBe('');
    });

    it('accepts empty why in pairing', () => {
      const result = expectSchemaPass(pairingItemSchema, {
        rank: 1, dish_name: 'Lamb', wine_id: 1, wine_name: 'Merlot',
        wine_colour: 'red', wine_price: null, by_the_glass: false,
        why: '', serving_tip: '', confidence: 'low'
      });
      expect(result.why).toBe('');
    });

    it('accepts empty name in parsed wine', () => {
      const result = expectSchemaPass(parsedWineItemSchema, {
        type: 'wine', name: '', confidence: 'low'
      });
      expect(result.name).toBe('');
    });
  });
});
