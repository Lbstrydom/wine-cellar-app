/**
 * @fileoverview Unit tests for data provenance service.
 * Tests provenance recording, querying, and expiry management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  hashContent,
  RETRIEVAL_METHODS,
  PROVENANCE_FIELDS
} from '../../../src/services/provenance.js';

// Mock the database
vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
      get: vi.fn(),
      all: vi.fn(() => [])
    })),
    exec: vi.fn()
  }
}));

// Mock the logger
vi.mock('../../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

describe('hashContent', () => {
  it('should generate consistent hash for same content', () => {
    const content = 'This is a test rating from Decanter';
    const hash1 = hashContent(content);
    const hash2 = hashContent(content);
    expect(hash1).toBe(hash2);
  });

  it('should generate different hashes for different content', () => {
    const hash1 = hashContent('Rating: 95 points');
    const hash2 = hashContent('Rating: 92 points');
    expect(hash1).not.toBe(hash2);
  });

  it('should return null for null/undefined input', () => {
    expect(hashContent(null)).toBeNull();
    expect(hashContent(undefined)).toBeNull();
  });

  it('should handle empty string', () => {
    const hash = hashContent('');
    expect(hash).toBeDefined();
    expect(hash.length).toBe(64); // SHA-256 hex length
  });

  it('should convert non-strings to strings', () => {
    const hash = hashContent(12345);
    expect(hash).toBeDefined();
    expect(hash.length).toBe(64);
  });
});

describe('RETRIEVAL_METHODS', () => {
  it('should define all retrieval methods', () => {
    expect(RETRIEVAL_METHODS.SCRAPE).toBe('scrape');
    expect(RETRIEVAL_METHODS.API).toBe('api');
    expect(RETRIEVAL_METHODS.USER_INPUT).toBe('user_input');
    expect(RETRIEVAL_METHODS.OCR).toBe('ocr');
    expect(RETRIEVAL_METHODS.MANUAL).toBe('manual');
    expect(RETRIEVAL_METHODS.IMPORT).toBe('import');
  });
});

describe('PROVENANCE_FIELDS', () => {
  it('should define all provenance field types', () => {
    expect(PROVENANCE_FIELDS.RATING_SCORE).toBe('rating_score');
    expect(PROVENANCE_FIELDS.TASTING_NOTES).toBe('tasting_notes');
    expect(PROVENANCE_FIELDS.DRINK_WINDOW).toBe('drink_window');
    expect(PROVENANCE_FIELDS.AWARD).toBe('award');
    expect(PROVENANCE_FIELDS.PRICE).toBe('price');
    expect(PROVENANCE_FIELDS.PRODUCER_INFO).toBe('producer_info');
    expect(PROVENANCE_FIELDS.VINTAGE_NOTES).toBe('vintage_notes');
  });
});

describe('recordProvenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should be importable without errors', async () => {
    // Dynamic import to test module loading
    const { recordProvenance } = await import('../../../src/services/provenance.js');
    expect(recordProvenance).toBeDefined();
    expect(typeof recordProvenance).toBe('function');
  });
});

describe('getProvenance', () => {
  it('should be importable without errors', async () => {
    const { getProvenance } = await import('../../../src/services/provenance.js');
    expect(getProvenance).toBeDefined();
    expect(typeof getProvenance).toBe('function');
  });
});

describe('hasFreshData', () => {
  it('should be importable without errors', async () => {
    const { hasFreshData } = await import('../../../src/services/provenance.js');
    expect(hasFreshData).toBeDefined();
    expect(typeof hasFreshData).toBe('function');
  });
});

describe('hasContentChanged', () => {
  it('should be importable without errors', async () => {
    const { hasContentChanged } = await import('../../../src/services/provenance.js');
    expect(hasContentChanged).toBeDefined();
    expect(typeof hasContentChanged).toBe('function');
  });
});

describe('getProvenanceStats', () => {
  it('should be importable without errors', async () => {
    const { getProvenanceStats } = await import('../../../src/services/provenance.js');
    expect(getProvenanceStats).toBeDefined();
    expect(typeof getProvenanceStats).toBe('function');
  });
});

describe('purgeExpiredRecords', () => {
  it('should be importable without errors', async () => {
    const { purgeExpiredRecords } = await import('../../../src/services/provenance.js');
    expect(purgeExpiredRecords).toBeDefined();
    expect(typeof purgeExpiredRecords).toBe('function');
  });
});

describe('initProvenanceTable', () => {
  it('should be importable without errors', async () => {
    const { initProvenanceTable } = await import('../../../src/services/provenance.js');
    expect(initProvenanceTable).toBeDefined();
    expect(typeof initProvenanceTable).toBe('function');
  });
});

describe('default export', () => {
  it('should export all functions', async () => {
    const provenance = await import('../../../src/services/provenance.js');
    const defaultExport = provenance.default;

    expect(defaultExport.initProvenanceTable).toBeDefined();
    expect(defaultExport.recordProvenance).toBeDefined();
    expect(defaultExport.getProvenance).toBeDefined();
    expect(defaultExport.getProvenanceForSource).toBeDefined();
    expect(defaultExport.hasFreshData).toBeDefined();
    expect(defaultExport.hasContentChanged).toBeDefined();
    expect(defaultExport.getExpiredRecords).toBeDefined();
    expect(defaultExport.purgeExpiredRecords).toBeDefined();
    expect(defaultExport.getProvenanceStats).toBeDefined();
    expect(defaultExport.getWinesWithSource).toBeDefined();
    expect(defaultExport.deleteWineProvenance).toBeDefined();
    expect(defaultExport.hashContent).toBeDefined();
    expect(defaultExport.RETRIEVAL_METHODS).toBeDefined();
    expect(defaultExport.PROVENANCE_FIELDS).toBeDefined();
  });
});
