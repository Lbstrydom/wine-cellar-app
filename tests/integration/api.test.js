/**
 * Integration tests for Wine Cellar API.
 * Tests real API endpoints with a test database.
 *
 * Requires server to be running: npm run dev
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Node.js 18+ has native fetch, no need for node-fetch
const API_BASE = process.env.TEST_API_URL || 'http://localhost:3000/api';

describe('Wine API Integration Tests', () => {
  let testWineId;

  describe('GET /api/wines', () => {
    it('should return paginated list of wines', async () => {
      const response = await fetch(`${API_BASE}/wines`);
      expect(response.status).toBe(200);

      const result = await response.json();
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('pagination');
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.pagination).toHaveProperty('total');
      expect(result.pagination).toHaveProperty('limit');
      expect(result.pagination).toHaveProperty('offset');
      expect(result.pagination).toHaveProperty('hasMore');
    });

    it('should support pagination parameters', async () => {
      const response = await fetch(`${API_BASE}/wines?limit=5&offset=0`);
      expect(response.status).toBe(200);

      const result = await response.json();
      expect(result.pagination.limit).toBe(5);
      expect(result.pagination.offset).toBe(0);
    });
  });

  describe('POST /api/wines', () => {
    it('should create a new wine', async () => {
      const newWine = {
        wine_name: 'Test Cabernet Sauvignon',
        style: 'Cabernet Sauvignon',
        colour: 'red',
        vintage: 2020,
        country: 'France'
      };

      const response = await fetch(`${API_BASE}/wines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newWine)
      });

      expect(response.status).toBe(201);
      
      const result = await response.json();
      expect(result.id).toBeDefined();
      expect(result.message).toBe('Wine added');
      
      testWineId = result.id;
    });

    it('should reject wine without required fields', async () => {
      const response = await fetch(`${API_BASE}/wines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      // Zod validation returns 400 with error details
      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/wines/:id', () => {
    it('should return a specific wine', async () => {
      const response = await fetch(`${API_BASE}/wines/${testWineId}`);
      expect(response.status).toBe(200);
      
      const wine = await response.json();
      expect(wine.id).toBe(testWineId);
      expect(wine.wine_name).toBe('Test Cabernet Sauvignon');
    });

    it('should return 404 for non-existent wine', async () => {
      const response = await fetch(`${API_BASE}/wines/999999`);
      expect(response.status).toBe(404);
      
      const result = await response.json();
      expect(result.error).toBe('Wine not found');
    });
  });

  describe('PUT /api/wines/:id', () => {
    it('should update a wine', async () => {
      const updates = {
        wine_name: 'Updated Test Cabernet',
        style: 'Cabernet Sauvignon',
        colour: 'red',
        vintage: 2021,
        country: 'Italy'
      };

      const response = await fetch(`${API_BASE}/wines/${testWineId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      expect(response.status).toBe(200);
      
      const result = await response.json();
      expect(result.message).toBe('Wine updated');
    });
  });

  describe('GET /api/stats', () => {
    it('should return cellar statistics', async () => {
      const response = await fetch(`${API_BASE}/stats`);
      expect(response.status).toBe(200);
      
      const stats = await response.json();
      expect(stats).toHaveProperty('total_bottles');
      expect(stats).toHaveProperty('empty_slots');
      expect(stats).toHaveProperty('reduce_now_count');
      expect(typeof stats.total_bottles).toBe('number');
    });
  });

  describe('DELETE /api/wines/:id', () => {
    it('should delete a wine', async () => {
      const response = await fetch(`${API_BASE}/wines/${testWineId}`, {
        method: 'DELETE'
      });

      expect(response.status).toBe(200);
      
      const result = await response.json();
      expect(result.message).toContain('deleted');
    });
  });
});

describe('Slots API Integration Tests', () => {
  describe('GET /api/layout', () => {
    it('should return cellar layout', async () => {
      const response = await fetch(`${API_BASE}/layout`);
      expect(response.status).toBe(200);
      
      const layout = await response.json();
      expect(layout).toHaveProperty('fridge');
      expect(layout).toHaveProperty('cellar');
      expect(Array.isArray(layout.fridge)).toBe(true);
      expect(Array.isArray(layout.cellar)).toBe(true);
    });
  });
});

describe('Pairing API Integration Tests', () => {
  describe('GET /api/pairing/rules', () => {
    it('should return pairing rules', async () => {
      const response = await fetch(`${API_BASE}/pairing/rules`);
      expect(response.status).toBe(200);
      
      const rules = await response.json();
      expect(Array.isArray(rules)).toBe(true);
    });
  });

  describe('POST /api/pairing/suggest', () => {
    it('should return pairing suggestions', async () => {
      const response = await fetch(`${API_BASE}/pairing/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signals: ['beef', 'rich']
        })
      });

      expect(response.status).toBe(200);
      
      const result = await response.json();
      expect(result).toHaveProperty('suggestions');
      expect(Array.isArray(result.suggestions)).toBe(true);
    });

    it('should reject request without signals', async () => {
      const response = await fetch(`${API_BASE}/pairing/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(400);
      
      const result = await response.json();
      expect(result.error).toBeDefined();
    });
  });
});

describe('Rate Limiting', () => {
  it('should enforce rate limits on API endpoints', async () => {
    const requests = [];

    // Make 150 requests (exceeds 100 limit)
    for (let i = 0; i < 150; i++) {
      requests.push(fetch(`${API_BASE}/stats`));
    }

    const responses = await Promise.all(requests);

    // Should have some 429 responses
    const rateLimited = responses.filter(r => r.status === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
  }, 30000); // Increase timeout for this test
});

describe('Health Check Endpoints (Phase 8.2)', () => {
  const HEALTH_BASE = process.env.TEST_API_URL?.replace('/api', '/health') || 'http://localhost:3000/health';

  describe('GET /health', () => {
    it('should return basic health status', async () => {
      const response = await fetch(HEALTH_BASE);
      expect(response.status).toBe(200);

      const health = await response.json();
      expect(health).toHaveProperty('status');
      expect(health.status).toBe('healthy');
    });
  });

  describe('GET /health/live', () => {
    it('should return liveness status', async () => {
      const response = await fetch(`${HEALTH_BASE}/live`);
      expect(response.status).toBe(200);

      const health = await response.json();
      expect(health.status).toBe('alive');
    });
  });

  describe('GET /health/ready', () => {
    it('should return readiness status', async () => {
      const response = await fetch(`${HEALTH_BASE}/ready`);
      // Status depends on database connection
      expect([200, 503]).toContain(response.status);

      const health = await response.json();
      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('checks');
    });
  });
});

describe('Metrics Endpoint (Phase 8.10)', () => {
  const METRICS_URL = process.env.TEST_API_URL?.replace('/api', '/metrics') || 'http://localhost:3000/metrics';

  describe('GET /metrics', () => {
    it('should return Prometheus-formatted metrics', async () => {
      const response = await fetch(METRICS_URL);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/plain');

      const text = await response.text();
      expect(text).toContain('http_requests_total');
      expect(text).toContain('app_uptime_seconds');
    });

    it('should return JSON metrics when requested', async () => {
      const response = await fetch(`${METRICS_URL}?format=json`);
      expect(response.status).toBe(200);

      const metrics = await response.json();
      expect(metrics).toHaveProperty('uptime_seconds');
      expect(metrics).toHaveProperty('requests');
      expect(metrics).toHaveProperty('database');
    });
  });
});

describe('Input Validation (Phase 8.4)', () => {
  describe('POST /api/slots/move', () => {
    it('should validate location format', async () => {
      const response = await fetch(`${API_BASE}/slots/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_location: 'invalid',
          to_location: 'R1C1'
        })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject identical source and target', async () => {
      const response = await fetch(`${API_BASE}/slots/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_location: 'R1C1',
          to_location: 'R1C1'
        })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
