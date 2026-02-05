/**
 * @fileoverview Unit tests for data provenance service.
 * Tests provenance recording, querying, and expiry management.
 */


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

  it('should record provenance with required fields', async () => {
    const { recordProvenance } = await import('../../../src/services/provenance.js');
    const db = (await import('../../../src/db/index.js')).default;

    const mockRun = vi.fn().mockResolvedValue({ changes: 1, lastInsertRowid: 42 });
    db.prepare.mockReturnValue({ run: mockRun });

    const result = await recordProvenance({
      wineId: 123,
      fieldName: 'rating_score',
      sourceId: 'decanter',
      sourceUrl: 'https://decanter.com/wine/123',
      retrievalMethod: 'scrape',
      confidence: 0.95,
      rawContent: 'Rating: 94 points'
    });

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO data_provenance'));
    expect(result.lastInsertRowid).toBe(42);
  });

  it('should use default expiry when not specified', async () => {
    const { recordProvenance } = await import('../../../src/services/provenance.js');
    const db = (await import('../../../src/db/index.js')).default;

    const mockRun = vi.fn().mockResolvedValue({ changes: 1, lastInsertRowid: 1 });
    db.prepare.mockReturnValue({ run: mockRun });

    await recordProvenance({
      wineId: 1,
      fieldName: 'rating_score',
      sourceId: 'vivino'
    });

    // Verify the function was called (default expiry applied internally)
    expect(mockRun).toHaveBeenCalled();
  });
});

describe('getProvenance', () => {
  it('should return provenance records for a wine', async () => {
    const { getProvenance } = await import('../../../src/services/provenance.js');
    const db = (await import('../../../src/db/index.js')).default;

    const mockRecords = [
      { id: 1, wine_id: 123, field_name: 'rating_score', source_id: 'decanter' },
      { id: 2, wine_id: 123, field_name: 'tasting_notes', source_id: 'vivino' }
    ];
    db.prepare.mockReturnValue({ all: vi.fn().mockResolvedValue(mockRecords) });

    const result = await getProvenance(123);

    expect(result).toHaveLength(2);
    expect(result[0].source_id).toBe('decanter');
  });

  it('should filter by field name when specified', async () => {
    const { getProvenance } = await import('../../../src/services/provenance.js');
    const db = (await import('../../../src/db/index.js')).default;

    db.prepare.mockReturnValue({
      all: vi.fn().mockResolvedValue([{ id: 1, field_name: 'rating_score' }])
    });

    const result = await getProvenance(123, 'rating_score');

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('field_name = ?'));
    expect(result).toHaveLength(1);
  });
});

describe('hasFreshData', () => {
  it('should return true when fresh data exists', async () => {
    const { hasFreshData } = await import('../../../src/services/provenance.js');
    const db = (await import('../../../src/db/index.js')).default;

    db.prepare.mockReturnValue({ get: vi.fn().mockResolvedValue({ 1: 1 }) });

    const result = await hasFreshData(123, 'decanter', 'rating_score');

    expect(result).toBe(true);
  });

  it('should return false when no fresh data exists', async () => {
    const { hasFreshData } = await import('../../../src/services/provenance.js');
    const db = (await import('../../../src/db/index.js')).default;

    db.prepare.mockReturnValue({ get: vi.fn().mockResolvedValue(null) });

    const result = await hasFreshData(123, 'decanter', 'rating_score');

    expect(result).toBe(false);
  });
});

describe('hasContentChanged', () => {
  it('should return true when no previous record exists', async () => {
    const { hasContentChanged } = await import('../../../src/services/provenance.js');
    const db = (await import('../../../src/db/index.js')).default;

    db.prepare.mockReturnValue({ get: vi.fn().mockResolvedValue(null) });

    const result = await hasContentChanged(123, 'decanter', 'rating_score', 'New content');

    expect(result).toBe(true);
  });

  it('should return true when content hash differs', async () => {
    const { hasContentChanged, hashContent } = await import('../../../src/services/provenance.js');
    const db = (await import('../../../src/db/index.js')).default;

    const oldHash = hashContent('Old content');
    db.prepare.mockReturnValue({
      get: vi.fn().mockResolvedValue({ raw_hash: oldHash })
    });

    const result = await hasContentChanged(123, 'decanter', 'rating_score', 'New different content');

    expect(result).toBe(true);
  });

  it('should return false when content hash matches', async () => {
    const { hasContentChanged, hashContent } = await import('../../../src/services/provenance.js');
    const db = (await import('../../../src/db/index.js')).default;

    const content = 'Same content';
    const contentHash = hashContent(content);
    db.prepare.mockReturnValue({
      get: vi.fn().mockResolvedValue({ raw_hash: contentHash })
    });

    const result = await hasContentChanged(123, 'decanter', 'rating_score', content);

    expect(result).toBe(false);
  });
});

describe('getProvenanceStats', () => {
  it('should return aggregate statistics', async () => {
    const { getProvenanceStats } = await import('../../../src/services/provenance.js');
    const db = (await import('../../../src/db/index.js')).default;

    db.prepare.mockReturnValue({
      get: vi.fn()
        .mockResolvedValueOnce({ count: 100 })  // total
        .mockResolvedValueOnce({ count: 80 })   // fresh
        .mockResolvedValueOnce({ avg: 0.92 }),  // avgConfidence
      all: vi.fn().mockResolvedValue([
        { source_id: 'decanter', count: 50 }
      ])
    });

    const stats = await getProvenanceStats();

    expect(stats.total).toBe(100);
    expect(stats).toHaveProperty('bySource');
    expect(stats).toHaveProperty('byField');
  });
});

describe('purgeExpiredRecords', () => {
  it('should delete expired records and return count', async () => {
    const { purgeExpiredRecords } = await import('../../../src/services/provenance.js');
    const db = (await import('../../../src/db/index.js')).default;

    db.prepare.mockReturnValue({
      run: vi.fn().mockResolvedValue({ changes: 15 })
    });

    const count = await purgeExpiredRecords();

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM data_provenance'));
    expect(count).toBe(15);
  });

  it('should return 0 when no expired records exist', async () => {
    const { purgeExpiredRecords } = await import('../../../src/services/provenance.js');
    const db = (await import('../../../src/db/index.js')).default;

    db.prepare.mockReturnValue({
      run: vi.fn().mockResolvedValue({ changes: 0 })
    });

    const count = await purgeExpiredRecords();

    expect(count).toBe(0);
  });
});

describe('initProvenanceTable', () => {
  it('should be a no-op function (table created via migrations)', async () => {
    const { initProvenanceTable } = await import('../../../src/services/provenance.js');

    // Should not throw and should complete without error
    expect(() => initProvenanceTable()).not.toThrow();
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
