/**
 * @fileoverview User settings endpoints.
 * @module routes/settings
 */

import { Router } from 'express';
import db from '../db/index.js';
import { encrypt, decrypt, isConfigured } from '../services/encryption.js';
import logger from '../utils/logger.js';
import { asyncHandler } from '../utils/errorResponse.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { settingsKeySchema, updateSettingSchema, sourceParamSchema, saveCredentialSchema } from '../schemas/settings.js';

const router = Router();

/**
 * Get all settings for this cellar.
 * @route GET /api/settings
 */
router.get('/', asyncHandler(async (req, res) => {
  const settings = await db.prepare('SELECT key, value FROM user_settings WHERE cellar_id = $1').all(req.cellarId);
  const result = {};
  for (const s of settings) {
    result[s.key] = s.value;
  }
  res.json(result);
}));

/**
 * Update a setting for this cellar.
 * @route PUT /api/settings/:key
 */
router.put('/:key', validateParams(settingsKeySchema), validateBody(updateSettingSchema), asyncHandler(async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;

  await db.prepare(`
    INSERT INTO user_settings (cellar_id, key, value, updated_at)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    ON CONFLICT(cellar_id, key) DO UPDATE SET value = $3, updated_at = CURRENT_TIMESTAMP
  `).run(req.cellarId, key, value);

  res.json({ message: 'Setting updated' });
}));

// ============================================
// Credential Management Endpoints
// ============================================

/**
 * Get configured credential sources for this cellar (no sensitive data).
 * @route GET /api/settings/credentials
 */
router.get('/credentials', asyncHandler(async (req, res) => {
  const credentials = await db.prepare(`
    SELECT source_id, auth_status, last_used_at, created_at, updated_at,
           CASE WHEN username_encrypted IS NOT NULL THEN 1 ELSE 0 END as has_username
    FROM source_credentials
    WHERE cellar_id = $1
  `).all(req.cellarId);

  // Decrypt usernames for display (masked)
  const result = [];
  for (const cred of credentials) {
    let maskedUsername = null;
    if (cred.has_username) {
      const row = await db.prepare('SELECT username_encrypted FROM source_credentials WHERE cellar_id = $1 AND source_id = $2')
        .get(req.cellarId, cred.source_id);
      const username = decrypt(row?.username_encrypted);
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

    result.push({
      source_id: cred.source_id,
      auth_status: cred.auth_status,
      last_used_at: cred.last_used_at,
      has_credentials: cred.has_username === 1,
      masked_username: maskedUsername
    });
  }

  res.json({
    encryption_configured: isConfigured(),
    credentials: result
  });
}));

/**
 * Save credentials for a source.
 * @route PUT /api/settings/credentials/:source
 */
router.put('/credentials/:source', validateParams(sourceParamSchema), validateBody(saveCredentialSchema), asyncHandler(async (req, res) => {
  const { source } = req.params;
  const { username, password } = req.body;

  const usernameEncrypted = encrypt(username);
  const passwordEncrypted = encrypt(password);

  await db.prepare(`
    INSERT INTO source_credentials (cellar_id, source_id, username_encrypted, password_encrypted, auth_status, updated_at)
    VALUES ($1, $2, $3, $4, 'none', CURRENT_TIMESTAMP)
    ON CONFLICT(cellar_id, source_id) DO UPDATE SET
      username_encrypted = $3,
      password_encrypted = $4,
      auth_status = 'none',
      updated_at = CURRENT_TIMESTAMP
  `).run(req.cellarId, source, usernameEncrypted, passwordEncrypted);

  logger.info('Settings', `Credentials saved for ${source}`);
  res.json({ message: 'Credentials saved', source_id: source });
}));

/**
 * Delete credentials for a source.
 * @route DELETE /api/settings/credentials/:source
 */
router.delete('/credentials/:source', validateParams(sourceParamSchema), asyncHandler(async (req, res) => {
  const { source } = req.params;

  const result = await db.prepare('DELETE FROM source_credentials WHERE cellar_id = $1 AND source_id = $2').run(req.cellarId, source);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Credentials not found' });
  }

  logger.info('Settings', `Credentials deleted for ${source}`);
  res.json({ message: 'Credentials deleted' });
}));

/**
 * Test credentials for a source.
 * @route POST /api/settings/credentials/:source/test
 */
router.post('/credentials/:source/test', validateParams(sourceParamSchema), asyncHandler(async (req, res) => {
  const { source } = req.params;

  try {
    const cred = await db.prepare('SELECT * FROM source_credentials WHERE cellar_id = $1 AND source_id = $2').get(req.cellarId, source);

    if (!cred) {
      return res.status(404).json({ error: 'No credentials configured for this source' });
    }

    const username = decrypt(cred.username_encrypted);
    const password = decrypt(cred.password_encrypted);

    if (!username || !password) {
      return res.status(500).json({ error: 'Failed to decrypt credentials' });
    }

    let testResult = { success: false, message: 'Unknown source' };

    if (source === 'vivino') {
      testResult = await testVivinoCredentials(username, password);
    } else if (source === 'decanter') {
      testResult = await testDecanterCredentials(username, password);
    }
    // Note: CellarTracker removed - their API only searches user's personal cellar

    // Update auth status
    await db.prepare(`
      UPDATE source_credentials
      SET auth_status = $1, last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE cellar_id = $2 AND source_id = $3
    `).run(testResult.success ? 'valid' : 'failed', req.cellarId, source);

    if (testResult.success) {
      logger.info('Settings', `Credentials test passed for ${source}`);
      res.json({ success: true, message: testResult.message || 'Authentication successful' });
    } else {
      logger.warn('Settings', `Credentials test failed for ${source}: ${testResult.message}`);
      res.json({ success: false, message: testResult.message || 'Authentication failed' });
    }

  } catch (error) {
    logger.error('Settings', `Credentials test error for ${source}: ${error.message}`);
    await db.prepare(`
      UPDATE source_credentials SET auth_status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE cellar_id = $2 AND source_id = $3
    `).run('failed', req.cellarId, source);
    res.status(500).json({ error: error.message });
  }
}));

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

// NOTE: CellarTracker credential testing removed.
// Their xlquery.asp API only searches the user's personal cellar, not global wine database.
// This made it useless for discovering ratings on wines not already in the user's CT account.
// CellarTracker ratings are still found via web search snippets.

export default router;
