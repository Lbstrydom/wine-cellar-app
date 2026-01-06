/**
 * @fileoverview Browser console tests for Phase 8 changes.
 *
 * Usage: Open browser console and run:
 *   import('/js/browserTests.js').then(t => t.runAll())
 *
 * Or run individual tests:
 *   import('/js/browserTests.js').then(t => t.testHealth())
 */

const results = {
  passed: 0,
  failed: 0,
  tests: []
};

function log(msg, type = 'info') {
  const styles = {
    info: 'color: #888',
    pass: 'color: #4CAF50; font-weight: bold',
    fail: 'color: #f44336; font-weight: bold',
    header: 'color: #2196F3; font-weight: bold; font-size: 14px'
  };
  console.log(`%c${msg}`, styles[type] || styles.info);
}

function assert(condition, testName, details = '') {
  if (condition) {
    results.passed++;
    results.tests.push({ name: testName, passed: true });
    log(`  ✓ ${testName}`, 'pass');
  } else {
    results.failed++;
    results.tests.push({ name: testName, passed: false, details });
    log(`  ✗ ${testName}${details ? ': ' + details : ''}`, 'fail');
  }
  return condition;
}

// ============ Test Functions ============

/**
 * Test event listener cleanup (Phase 8.6)
 */
export async function testEventListeners() {
  log('\n[Phase 8.6] Event Listener Cleanup', 'header');

  try {
    const eventManager = await import('/js/eventManager.js');
    const app = await import('/js/app.js');

    // Get initial count
    const initialCount = eventManager.getTotalListenerCount();
    log(`  Initial listener count: ${initialCount}`);

    // Refresh data (should cleanup and re-add listeners)
    await app.refreshData();

    const afterRefresh = eventManager.getTotalListenerCount();
    log(`  After refresh: ${afterRefresh}`);

    // Refresh again
    await app.refreshData();

    const afterSecondRefresh = eventManager.getTotalListenerCount();
    log(`  After second refresh: ${afterSecondRefresh}`);

    // Listeners should not accumulate
    assert(
      afterSecondRefresh <= afterRefresh * 1.1, // Allow 10% variance
      'Listeners do not accumulate on refresh',
      `Expected ~${afterRefresh}, got ${afterSecondRefresh}`
    );

    // Check namespace counts
    const gridCount = eventManager.getListenerCount('grid');
    const dragdropCount = eventManager.getListenerCount('dragdrop');

    assert(gridCount > 0, 'Grid namespace has listeners', `Count: ${gridCount}`);
    assert(dragdropCount > 0, 'Dragdrop namespace has listeners', `Count: ${dragdropCount}`);

  } catch (err) {
    assert(false, 'Event listener test', err.message);
  }
}

/**
 * Test health endpoints (Phase 8.2)
 */
export async function testHealth() {
  log('\n[Phase 8.2] Health Check Endpoints', 'header');

  try {
    // Basic health
    const healthRes = await fetch('/health');
    const health = await healthRes.json();
    assert(healthRes.status === 200, 'GET /health returns 200');
    assert(health.status === 'healthy', 'Health status is healthy');

    // Liveness
    const liveRes = await fetch('/health/live');
    const live = await liveRes.json();
    assert(liveRes.status === 200, 'GET /health/live returns 200');
    assert(live.status === 'healthy', 'Liveness status is healthy');

    // Readiness
    const readyRes = await fetch('/health/ready');
    const ready = await readyRes.json();
    assert([200, 503].includes(readyRes.status), 'GET /health/ready returns valid status');
    assert('checks' in ready, 'Readiness includes checks object');
    assert('database' in ready.checks, 'Readiness checks database');

  } catch (err) {
    assert(false, 'Health endpoint test', err.message);
  }
}

/**
 * Test metrics endpoint (Phase 8.10)
 */
export async function testMetrics() {
  log('\n[Phase 8.10] Metrics Endpoint', 'header');

  try {
    // Prometheus format
    const promRes = await fetch('/metrics');
    const promText = await promRes.text();
    assert(promRes.status === 200, 'GET /metrics returns 200');
    assert(
      promRes.headers.get('content-type').includes('text/plain'),
      'Prometheus format has text/plain content-type'
    );
    assert(promText.includes('http_requests_total'), 'Contains http_requests_total metric');
    assert(promText.includes('app_uptime_seconds'), 'Contains app_uptime_seconds metric');

    // JSON format
    const jsonRes = await fetch('/metrics?format=json');
    const metrics = await jsonRes.json();
    assert(jsonRes.status === 200, 'GET /metrics?format=json returns 200');
    assert('uptime_seconds' in metrics, 'JSON has uptime_seconds');
    assert('requests' in metrics, 'JSON has requests');
    assert('duration' in metrics, 'JSON has duration');
    assert('database' in metrics, 'JSON has database stats');

    log(`  Uptime: ${metrics.uptime_seconds}s, Requests: ${metrics.requests.total}`);

  } catch (err) {
    assert(false, 'Metrics endpoint test', err.message);
  }
}

/**
 * Test API pagination (Phase 8.8)
 */
export async function testPagination() {
  log('\n[Phase 8.8] API Pagination', 'header');

  try {
    // Default pagination
    const defaultRes = await fetch('/api/wines');
    const defaultData = await defaultRes.json();
    assert(defaultRes.status === 200, 'GET /api/wines returns 200');
    assert('data' in defaultData, 'Response has data array');
    assert('pagination' in defaultData, 'Response has pagination object');
    assert(Array.isArray(defaultData.data), 'data is an array');

    const { pagination } = defaultData;
    assert('total' in pagination, 'Pagination has total');
    assert('limit' in pagination, 'Pagination has limit');
    assert('offset' in pagination, 'Pagination has offset');
    assert('hasMore' in pagination, 'Pagination has hasMore');

    log(`  Total wines: ${pagination.total}, Limit: ${pagination.limit}`);

    // Custom pagination
    const customRes = await fetch('/api/wines?limit=3&offset=1');
    const customData = await customRes.json();
    assert(customData.pagination.limit === 3, 'Custom limit applied', `Got ${customData.pagination.limit}`);
    assert(customData.pagination.offset === 1, 'Custom offset applied', `Got ${customData.pagination.offset}`);

  } catch (err) {
    assert(false, 'Pagination test', err.message);
  }
}

/**
 * Test input validation (Phase 8.4)
 */
export async function testValidation() {
  log('\n[Phase 8.4] Input Validation', 'header');

  try {
    // Invalid location format
    const invalidLocRes = await fetch('/api/slots/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_location: 'INVALID', to_location: 'R1C1' })
    });
    const invalidLocData = await invalidLocRes.json();
    assert(invalidLocRes.status === 400, 'Invalid location returns 400');
    assert(invalidLocData.error?.code === 'VALIDATION_ERROR', 'Returns VALIDATION_ERROR code');
    assert(Array.isArray(invalidLocData.error?.details), 'Includes validation details');

    // Same source and target
    const sameLocRes = await fetch('/api/slots/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_location: 'R1C1', to_location: 'R1C1' })
    });
    const sameLocData = await sameLocRes.json();
    assert(sameLocRes.status === 400, 'Same source/target returns 400');
    assert(sameLocData.error?.code === 'VALIDATION_ERROR', 'Same locations rejected');

    // Empty wine creation
    const emptyWineRes = await fetch('/api/wines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert(emptyWineRes.status === 400, 'Empty wine body returns 400');

  } catch (err) {
    assert(false, 'Validation test', err.message);
  }
}

/**
 * Test security headers (Phase 8.9)
 */
export async function testSecurityHeaders() {
  log('\n[Phase 8.9] Security Headers', 'header');

  try {
    const res = await fetch('/api/stats');

    const csp = res.headers.get('content-security-policy');
    const hsts = res.headers.get('strict-transport-security');
    const xfo = res.headers.get('x-frame-options');
    const xcto = res.headers.get('x-content-type-options');

    assert(!!csp, 'CSP header present', csp ? csp.substring(0, 40) + '...' : 'missing');
    assert(!!hsts, 'HSTS header present', hsts || 'missing');
    assert(xfo === 'DENY', 'X-Frame-Options is DENY', xfo || 'missing');
    assert(xcto === 'nosniff', 'X-Content-Type-Options is nosniff', xcto || 'missing');

    if (hsts) {
      assert(hsts.includes('max-age=31536000'), 'HSTS has 1 year max-age');
      assert(hsts.includes('includeSubDomains'), 'HSTS includes subdomains');
    }

  } catch (err) {
    assert(false, 'Security headers test', err.message);
  }
}

/**
 * Test service worker (Phase 5.1 / updated in 8.6)
 */
export async function testServiceWorker() {
  log('\n[Service Worker] Cache & Registration', 'header');

  try {
    if (!('serviceWorker' in navigator)) {
      log('  Service Worker not supported in this browser', 'info');
      return;
    }

    const reg = await navigator.serviceWorker.ready;
    assert(!!reg, 'Service Worker registered');
    assert(reg.active?.state === 'activated', 'Service Worker is activated', reg.active?.state);

    const cacheNames = await caches.keys();
    const wineCellarCaches = cacheNames.filter(n => n.includes('wine-cellar'));
    assert(wineCellarCaches.length > 0, 'Wine cellar caches exist');

    // Check for v29 cache (updated for mobile accessibility fixes)
    const hasV29 = wineCellarCaches.some(n => n.includes('v29'));
    assert(hasV29, 'Cache version v29 present', `Found: ${wineCellarCaches.join(', ')}`);

    log(`  Active caches: ${wineCellarCaches.join(', ')}`);

  } catch (err) {
    assert(false, 'Service Worker test', err.message);
  }
}

/**
 * Test error boundary (Phase 7)
 */
export async function testErrorBoundary() {
  log('\n[Phase 7] Error Boundary', 'header');

  try {
    const errorBoundary = await import('/js/errorBoundary.js');

    // Check if error boundary is initialized
    assert(typeof errorBoundary.initErrorBoundary === 'function', 'initErrorBoundary exists');

    // Verify global error handlers are attached
    // (We can't easily test them without causing actual errors)
    log('  Error boundary module loaded successfully');

  } catch (err) {
    assert(false, 'Error boundary test', err.message);
  }
}

// ============ Run All Tests ============

/**
 * Run all browser tests
 */
export async function runAll() {
  results.passed = 0;
  results.failed = 0;
  results.tests = [];

  log('╔════════════════════════════════════════╗', 'header');
  log('║   Wine Cellar - Phase 8 Browser Tests  ║', 'header');
  log('╚════════════════════════════════════════╝', 'header');

  await testHealth();
  await testMetrics();
  await testPagination();
  await testValidation();
  await testSecurityHeaders();
  await testServiceWorker();
  await testEventListeners();
  await testErrorBoundary();

  // Summary
  log('\n════════════════════════════════════════', 'header');
  log(`Results: ${results.passed} passed, ${results.failed} failed`,
      results.failed === 0 ? 'pass' : 'fail');
  log('════════════════════════════════════════\n', 'header');

  return results;
}

// Export individual tests for selective running
export {
  testEventListeners as listeners,
  testHealth as health,
  testMetrics as metrics,
  testPagination as pagination,
  testValidation as validation,
  testSecurityHeaders as security,
  testServiceWorker as sw,
  testErrorBoundary as errorBoundary
};

// Auto-log usage instructions
console.log('%c[Browser Tests] Loaded. Run with:', 'color: #2196F3');
console.log('%c  import(\'/js/browserTests.js\').then(t => t.runAll())', 'color: #888');
console.log('%c  Or individual: t.health(), t.metrics(), t.validation(), etc.', 'color: #888');
