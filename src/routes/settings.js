/**
 * @fileoverview User settings endpoints.
 * @module routes/settings
 */

import { Router } from 'express';
import db from '../db/index.js';
import { encrypt, decrypt, isConfigured } from '../services/encryption.js';
import logger from '../utils/logger.js';

const router = Router();

/**
 * Get all settings.
 * @route GET /api/settings
 */
router.get('/', (_req, res) => {
  const settings = db.prepare('SELECT key, value FROM user_settings').all();
  const result = {};
  for (const s of settings) {
    result[s.key] = s.value;
  }
  res.json(result);
});

/**
 * Update a setting.
 * @route PUT /api/settings/:key
 */
router.put('/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body;

  db.prepare(`
    INSERT INTO user_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
  `).run(key, value, value);

  res.json({ message: 'Setting updated' });
});

// ============================================
// Credential Management Endpoints
// ============================================

/**
 * Get configured credential sources (no sensitive data).
 * @route GET /api/settings/credentials
 */
router.get('/credentials', (_req, res) => {
  const credentials = db.prepare(`
    SELECT source_id, auth_status, last_used_at, created_at, updated_at,
           CASE WHEN username_encrypted IS NOT NULL THEN 1 ELSE 0 END as has_username
    FROM source_credentials
  `).all();

  // Decrypt usernames for display (masked)
  const result = credentials.map(cred => {
    let maskedUsername = null;
    if (cred.has_username) {
      const username = decrypt(
        db.prepare('SELECT username_encrypted FROM source_credentials WHERE source_id = ?')
          .get(cred.source_id)?.username_encrypted
      );
      if (username) {
        // Mask email: show first 2 chars + ... + domain
        const atIndex = username.indexOf('@');
        if (atIndex > 2) {
          maskedUsername = username.substring(0, 2) + '***' + username.substring(atIndex);
        } else {
          maskedUsername = username.substring(0, 2) + '***';
        }
      }
    }

    return {
      source_id: cred.source_id,
      auth_status: cred.auth_status,
      last_used_at: cred.last_used_at,
      has_credentials: cred.has_username === 1,
      masked_username: maskedUsername
    };
  });

  res.json({
    encryption_configured: isConfigured(),
    credentials: result
  });
});

/**
 * Save credentials for a source.
 * @route PUT /api/settings/credentials/:source
 */
router.put('/credentials/:source', (req, res) => {
  const { source } = req.params;
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const validSources = ['vivino', 'decanter', 'cellartracker'];
  if (!validSources.includes(source)) {
    return res.status(400).json({ error: `Invalid source. Must be one of: ${validSources.join(', ')}` });
  }

  const usernameEncrypted = encrypt(username);
  const passwordEncrypted = encrypt(password);

  db.prepare(`
    INSERT INTO source_credentials (source_id, username_encrypted, password_encrypted, auth_status, updated_at)
    VALUES (?, ?, ?, 'none', CURRENT_TIMESTAMP)
    ON CONFLICT(source_id) DO UPDATE SET
      username_encrypted = ?,
      password_encrypted = ?,
      auth_status = 'none',
      updated_at = CURRENT_TIMESTAMP
  `).run(source, usernameEncrypted, passwordEncrypted, usernameEncrypted, passwordEncrypted);

  logger.info('Settings', `Credentials saved for ${source}`);
  res.json({ message: 'Credentials saved', source_id: source });
});

/**
 * Delete credentials for a source.
 * @route DELETE /api/settings/credentials/:source
 */
router.delete('/credentials/:source', (req, res) => {
  const { source } = req.params;

  const result = db.prepare('DELETE FROM source_credentials WHERE source_id = ?').run(source);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Credentials not found' });
  }

  logger.info('Settings', `Credentials deleted for ${source}`);
  res.json({ message: 'Credentials deleted' });
});

/**
 * Test credentials for a source.
 * @route POST /api/settings/credentials/:source/test
 */
router.post('/credentials/:source/test', async (req, res) => {
  const { source } = req.params;

  const cred = db.prepare('SELECT * FROM source_credentials WHERE source_id = ?').get(source);

  if (!cred) {
    return res.status(404).json({ error: 'No credentials configured for this source' });
  }

  const username = decrypt(cred.username_encrypted);
  const password = decrypt(cred.password_encrypted);

  if (!username || !password) {
    return res.status(500).json({ error: 'Failed to decrypt credentials' });
  }

  try {
    let testResult = { success: false, message: 'Unknown source' };

    if (source === 'vivino') {
      testResult = await testVivinoCredentials(username, password);
    } else if (source === 'decanter') {
      testResult = await testDecanterCredentials(username, password);
    } else if (source === 'cellartracker') {
      testResult = await testCellarTrackerCredentials(username, password);
    }

    // Update auth status
    db.prepare(`
      UPDATE source_credentials
      SET auth_status = ?, last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE source_id = ?
    `).run(testResult.success ? 'valid' : 'failed', source);

    if (testResult.success) {
      logger.info('Settings', `Credentials test passed for ${source}`);
      res.json({ success: true, message: testResult.message || 'Authentication successful' });
    } else {
      logger.warn('Settings', `Credentials test failed for ${source}: ${testResult.message}`);
      res.json({ success: false, message: testResult.message || 'Authentication failed' });
    }

  } catch (error) {
    logger.error('Settings', `Credentials test error for ${source}: ${error.message}`);
    db.prepare(`
      UPDATE source_credentials SET auth_status = 'failed', updated_at = CURRENT_TIMESTAMP
      WHERE source_id = ?
    `).run(source);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Test Vivino credentials.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function testVivinoCredentials(username, password) {
  try {
    // Vivino uses a session-based login
    const response = await fetch('https://www.vivino.com/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify({ email: username, password })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.user || data.success) {
        return { success: true, message: 'Vivino login successful' };
      }
    }

    // Try alternate endpoint
    const altResponse = await fetch('https://www.vivino.com/users/sign_in', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: new URLSearchParams({
        'user[email]': username,
        'user[password]': password
      }),
      redirect: 'manual'
    });

    // A redirect usually means successful login
    if (altResponse.status === 302 || altResponse.status === 303) {
      return { success: true, message: 'Vivino login successful' };
    }

    return { success: false, message: 'Invalid credentials or login blocked' };

  } catch (error) {
    return { success: false, message: `Connection error: ${error.message}` };
  }
}

/**
 * Test Decanter credentials.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function testDecanterCredentials(username, password) {
  try {
    // Decanter login endpoint
    const response = await fetch('https://www.decanter.com/wp-login.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: new URLSearchParams({
        'log': username,
        'pwd': password,
        'wp-submit': 'Log In',
        'redirect_to': 'https://www.decanter.com/'
      }),
      redirect: 'manual'
    });

    // Redirect to dashboard = success
    if (response.status === 302) {
      const location = response.headers.get('location');
      if (location && !location.includes('wp-login.php')) {
        return { success: true, message: 'Decanter login successful' };
      }
    }

    return { success: false, message: 'Invalid credentials' };

  } catch (error) {
    return { success: false, message: `Connection error: ${error.message}` };
  }
}

/**
 * Test CellarTracker credentials.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function testCellarTrackerCredentials(username, password) {
  try {
    const response = await fetch('https://www.cellartracker.com/login.asp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: new URLSearchParams({
        'szUser': username,
        'szPassword': password
      }),
      redirect: 'manual'
    });

    if (response.status === 302) {
      return { success: true, message: 'CellarTracker login successful' };
    }

    return { success: false, message: 'Invalid credentials' };

  } catch (error) {
    return { success: false, message: `Connection error: ${error.message}` };
  }
}

export default router;
