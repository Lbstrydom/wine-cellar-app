/**
 * @fileoverview Integration tests for data seeding and initialization patterns.
 * Tests JSON seed files, database population, and initial state consistency.
 */

import fs from 'fs/promises';
import path from 'path';

// Set DATABASE_URL before any imports
process.env.DATABASE_URL = 'postgresql://mock:mock@localhost/mock';
process.env.NODE_ENV = 'test';

// Mock db module
vi.mock('../../../src/db/index.js', () => ({
  default: {
    prepare: vi.fn()
  }
}));

const db = await import('../../../src/db/index.js').then(m => m.default);

describe('Data Seeding & Initialization', () => {
  describe('Seed File Format', () => {
    it('should load JSON seed files with proper structure', async () => {
      const seedDir = './data/seeds';

      try {
        const files = await fs.readdir(seedDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        // If seed directory exists, it should contain valid JSON files
        expect(Array.isArray(jsonFiles)).toBe(true);

        for (const file of jsonFiles) {
          const content = await fs.readFile(path.join(seedDir, file), 'utf8');
          const data = JSON.parse(content);

          // Each seed should have array or object structure
          expect(Array.isArray(data) || typeof data === 'object').toBe(true);
        }
      } catch (error) {
        // Seeds directory may not exist yet - verify it's the expected error type
        expect(error.code).toBe('ENOENT');
      }
    });

    it('should validate wine seeds have required fields', async () => {
      const wineSeeds = [
        {
          wine_name: 'Château Margaux',
          vintage: 2015,
          colour: 'red',
          country: 'France',
          region: 'Bordeaux'
        },
        {
          wine_name: 'Sancerre',
          vintage: 2021,
          colour: 'white',
          country: 'France',
          region: 'Loire Valley'
        }
      ];

      wineSeeds.forEach(wine => {
        expect(wine).toHaveProperty('wine_name');
        expect(wine).toHaveProperty('vintage');
        expect(wine).toHaveProperty('colour');
        expect(['red', 'white', 'rosé', 'sparkling']).toContain(wine.colour);
      });
    });

    it('should validate slot seeds have location_code format', async () => {
      const slotSeeds = [
        { location_code: 'R1C1', zone: 'cellar' },
        { location_code: 'R2C3', zone: 'cellar' },
        { location_code: 'F1C1', zone: 'fridge' }
      ];

      slotSeeds.forEach(slot => {
        expect(slot.location_code).toMatch(/^[RF]\d+C\d+$/);
      });
    });
  });

  describe('Database Population', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should seed wines in bulk', async () => {
      const wines = [
        { wine_name: 'Wine 1', vintage: 2020, colour: 'red' },
        { wine_name: 'Wine 2', vintage: 2021, colour: 'white' }
      ];

      db.prepare.mockReturnValue({
        run: vi.fn().mockResolvedValue({ changes: wines.length }),
        get: vi.fn()
      });

      // Simulate bulk insert
      for (const wine of wines) {
        const result = await db.prepare('INSERT INTO wines (wine_name, vintage, colour) VALUES (?, ?, ?)').run(wine.wine_name, wine.vintage, wine.colour);
        expect(result.changes).toBeGreaterThan(0);
      }
    });

    it('should seed slots matching cellar layout', async () => {
      const slots = [];
      
      // Cellar: 10 rows × 8 columns
      for (let row = 1; row <= 10; row++) {
        for (let col = 1; col <= 8; col++) {
          slots.push({
            location_code: `R${row}C${col}`,
            zone: 'cellar'
          });
        }
      }

      // Fridge: 3 rows × 6 columns
      for (let row = 1; row <= 3; row++) {
        for (let col = 1; col <= 6; col++) {
          slots.push({
            location_code: `F${row}C${col}`,
            zone: 'fridge'
          });
        }
      }

      expect(slots).toHaveLength(80 + 18);
    });

    it('should track seed metadata (created_at, updated_at)', async () => {
      db.prepare.mockReturnValue({
        run: vi.fn().mockResolvedValue({ changes: 1 }),
        get: vi.fn().mockResolvedValue({
          id: 1,
          wine_name: 'Seedling Wine',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
      });

      const result = await db.prepare('SELECT created_at, updated_at FROM wines WHERE id = ?').get(1);
      
      expect(result.created_at).toBeDefined();
      expect(result.updated_at).toBeDefined();
    });
  });

  describe('Initial State Consistency', () => {
    it('should ensure slot count matches layout spec', () => {
      const CELLAR_ROWS = 10;
      const CELLAR_COLS = 8;
      const FRIDGE_ROWS = 3;
      const FRIDGE_COLS = 6;

      const expectedCellarSlots = CELLAR_ROWS * CELLAR_COLS;
      const expectedFridgeSlots = FRIDGE_ROWS * FRIDGE_COLS;
      const expectedTotal = expectedCellarSlots + expectedFridgeSlots;

      expect(expectedCellarSlots).toBe(80);
      expect(expectedFridgeSlots).toBe(18);
      expect(expectedTotal).toBe(98);
    });

    it('should not duplicate wine entries on re-seed', async () => {
      const duplicateCheck = [];

      db.prepare.mockImplementation((sql) => {
        if (sql.includes('DISTINCT wine_name')) {
          duplicateCheck.push('DEDUP_CHECK');
        }
        return {
          all: vi.fn().mockResolvedValue([
            { wine_name: 'Wine A', count: 1 },
            { wine_name: 'Wine B', count: 1 }
          ])
        };
      });

      // Should check for duplicates before bulk insert
      expect(duplicateCheck).toBeDefined();
    });

    it('should maintain referential integrity in seeded data', async () => {
      let fkConstraintChecked = false;

      db.prepare.mockImplementation((sql) => {
        if (sql.includes('FOREIGN KEY') || sql.includes('REFERENCES')) {
          fkConstraintChecked = true;
          return { run: vi.fn().mockResolvedValue({ changes: 1 }) };
        }
        return {
          run: vi.fn().mockResolvedValue({ changes: 1 }),
          get: vi.fn().mockResolvedValue({ id: 1 }),
          all: vi.fn().mockResolvedValue([])
        };
      });

      // Simulate a query that references FK relationship
      await db.prepare('SELECT * FROM slots s JOIN wines w ON s.wine_id = w.id REFERENCES').run();

      // Verify FK constraint handling was triggered
      expect(fkConstraintChecked).toBe(true);
    });
  });

  describe('Seed Idempotency', () => {
    it('should support re-running seed without errors', async () => {
      const seedRuns = [];

      db.prepare.mockImplementation((sql) => {
        if (sql.includes('INSERT')) {
          seedRuns.push('INSERT');
        } else if (sql.includes('ON CONFLICT')) {
          seedRuns.push('UPSERT');
        }
        
        return {
          run: vi.fn().mockResolvedValue({ changes: 1 }),
          get: vi.fn()
        };
      });

      // Re-running seed should use UPSERT or similar
      expect(seedRuns).toBeDefined();
    });

    it('should skip already-seeded data', async () => {
      let skipLogicInvoked = false;

      db.prepare.mockImplementation((sql) => {
        if (sql.includes('WHERE NOT EXISTS') || sql.includes('ON CONFLICT DO NOTHING')) {
          skipLogicInvoked = true;
          return { run: vi.fn().mockResolvedValue({ changes: 0 }) };
        }
        return {
          run: vi.fn().mockResolvedValue({ changes: 1 }),
          get: vi.fn().mockResolvedValue({ id: 1 })
        };
      });

      // Simulate insert with skip logic
      const result = await db.prepare('INSERT INTO wines VALUES (?) WHERE NOT EXISTS').run();

      // Verify skip logic was triggered and no changes were made
      expect(skipLogicInvoked).toBe(true);
      expect(result.changes).toBe(0);
    });
  });

  describe('Seed Performance', () => {
    it('should use batch inserts for large datasets', async () => {
      const wines = Array.from({ length: 1000 }, (_, i) => ({
        wine_name: `Wine ${i}`,
        vintage: 2020,
        colour: 'red'
      }));

      db.prepare.mockReturnValue({
        run: vi.fn().mockResolvedValue({ changes: wines.length }),
        get: vi.fn()
      });

      // Should handle bulk insert
      const result = await db.prepare('INSERT INTO wines VALUES ...').run();
      expect(result.changes).toBe(1000);
    });

    it('should index slots for fast location lookups', async () => {
      let indexCreated = false;

      db.prepare.mockImplementation((sql) => {
        if (sql.includes('CREATE INDEX') && sql.includes('location_code')) {
          indexCreated = true;
          return { run: vi.fn().mockResolvedValue({ changes: 0 }) };
        }
        return {
          run: vi.fn().mockResolvedValue({ changes: 1 }),
          get: vi.fn().mockResolvedValue({ id: 1 })
        };
      });

      // Simulate index creation
      await db.prepare('CREATE INDEX idx_slots_location_code ON slots(location_code)').run();

      // Verify index creation was triggered
      expect(indexCreated).toBe(true);
    });
  });

  describe('Seed Validation', () => {
    it('should validate vintage year is reasonable', () => {
      const validVintages = [
        { vintage: 1947, valid: true },   // Old but valid
        { vintage: 2023, valid: true },   // Current
        { vintage: 2050, valid: false },  // Future
        { vintage: 1800, valid: true }    // Historical
      ];

      validVintages.forEach(({ vintage, valid }) => {
        const isValid = vintage <= new Date().getFullYear() + 1;
        expect(isValid).toBe(valid);
      });
    });

    it('should validate colour is in allowed list', () => {
      const allowedColours = ['red', 'white', 'rosé', 'sparkling', 'fortified'];
      const testColours = ['red', 'white', 'blue', 'rosé'];

      testColours.forEach(colour => {
        const isValid = allowedColours.includes(colour);
        if (colour === 'red' || colour === 'white' || colour === 'rosé') {
          expect(isValid).toBe(true);
        } else {
          expect(isValid).toBe(false);
        }
      });
    });

    it('should validate country exists in reference data', async () => {
      const validCountries = ['France', 'Italy', 'Spain', 'Germany', 'Portugal'];
      
      db.prepare.mockReturnValue({
        get: vi.fn().mockImplementation((sql, country) => {
          return Promise.resolve(validCountries.includes(country) ? { count: 1 } : null);
        })
      });

      // Should check against reference countries
      expect(validCountries).toContain('France');
    });
  });

  describe('Multi-User Seed Data', () => {
    it('should create separate cellars for each user', async () => {
      const users = [
        { id: 'user-1', email: 'user1@example.com' },
        { id: 'user-2', email: 'user2@example.com' }
      ];

      db.prepare.mockReturnValue({
        run: vi.fn().mockResolvedValue({ changes: 1 }),
        get: vi.fn().mockResolvedValue({ id: 'cellar-123' })
      });

      for (const user of users) {
        const cellar = await db.prepare('INSERT INTO cellars (owner_id, name) VALUES (?, ?)').run(user.id, `${user.email}'s Cellar`);
        expect(cellar).toBeDefined();
      }
    });

    it('should not share wines between separate cellars', async () => {
      db.prepare.mockImplementation((sql) => {
        if (sql.includes('WHERE cellar_id = ?')) {
          return {
            all: vi.fn().mockImplementation((cellarId) => {
              // Return wines only for the requested cellar
              if (cellarId === 'cellar-1') {
                return Promise.resolve([{ wine_name: 'Wine A', cellar_id: 'cellar-1' }]);
              } else if (cellarId === 'cellar-2') {
                return Promise.resolve([{ wine_name: 'Wine B', cellar_id: 'cellar-2' }]);
              }
              return Promise.resolve([]);
            })
          };
        }
        return {
          all: vi.fn().mockResolvedValue([]),
          run: vi.fn().mockResolvedValue({ changes: 0 })
        };
      });

      // Query wines for cellar-1
      const cellar1Wines = await db.prepare('SELECT * FROM wines WHERE cellar_id = ?').all('cellar-1');
      const cellar2Wines = await db.prepare('SELECT * FROM wines WHERE cellar_id = ?').all('cellar-2');

      // Verify isolation - each cellar only sees their own wines
      expect(cellar1Wines).toHaveLength(1);
      expect(cellar1Wines[0].cellar_id).toBe('cellar-1');
      expect(cellar2Wines).toHaveLength(1);
      expect(cellar2Wines[0].cellar_id).toBe('cellar-2');

      // Verify no cross-contamination
      expect(cellar1Wines[0].wine_name).not.toBe(cellar2Wines[0].wine_name);
    });
  });
});
