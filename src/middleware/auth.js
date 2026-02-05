/**
 * @fileoverview JWT authentication middleware for Supabase Auth.
 * Validates JWT tokens and creates first-time user profiles.
 * Uses local JWT verification with Supabase JWKS instead of service key.
 * @module middleware/auth
 */

import jwt from 'jsonwebtoken';
import { createPublicKey } from 'crypto';
import db from '../db/index.js';
import logger from '../utils/logger.js';

// Cache JWKS keys to avoid repeated fetches
let cachedJwks = null;
let jwksExpiry = 0;

/**
 * Fetch Supabase JWKS (JSON Web Key Set) for public key verification.
 * Cached for 1 hour to avoid repeated HTTP requests.
 */
async function getSupabaseJwks() {
  const now = Date.now();

  if (cachedJwks && jwksExpiry > now) {
    return cachedJwks;
  }

  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
    if (!response.ok) {
      throw new Error(`JWKS fetch failed: ${response.status}`);
    }

    cachedJwks = await response.json();
    jwksExpiry = now + (60 * 60 * 1000);  // Cache for 1 hour

    return cachedJwks;
  } catch (err) {
    logger.error('Auth', 'Failed to fetch JWKS: ' + err.message);
    throw err;
  }
}

/**
 * Get signing key from JWKS by kid (key ID).
 */
function getSigningKey(jwks, kid) {
  const key = jwks.keys.find(k => k.kid === kid);
  if (!key) {
    throw new Error(`Signing key not found for kid: ${kid}`);
  }

  // Convert JWKS key to PEM format
  const publicKey = createPublicKey({ key, format: 'jwk' });
  return publicKey.export({ format: 'pem', type: 'spki' });
}

/**
 * Verify JWT token using local JWKS verification.
 * This avoids exposing SUPABASE_SERVICE_KEY in runtime.
 */
async function verifyJwt(token) {
  try {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header.kid) {
      throw new Error('Invalid JWT format');
    }

    const jwks = await getSupabaseJwks();
    const publicKey = getSigningKey(jwks, decoded.header.kid);

    const verified = jwt.verify(token, publicKey, {
      algorithms: ['RS256', 'ES256'],
      audience: 'authenticated',
      issuer: `${process.env.SUPABASE_URL}/auth/v1`
    });

    return verified;
  } catch (err) {
    throw new Error(`JWT verification failed: ${err.message}`);
  }
}

/**
 * Middleware: Require valid JWT token and validate/create user profile.
 * Sets req.user to the authenticated user's profile.
 *
 * In TEST_MODE (NODE_ENV=test), allows bearer tokens to be any base64-encoded JSON object.
 * This is ONLY for testing and must never be enabled in production.
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 * @returns {void}
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);

  try {
    let user;

    // INTEGRATION TEST MODE: Allow base64-encoded JSON tokens for integration testing
    // Only enabled when INTEGRATION_TEST_MODE=true (not just NODE_ENV=test)
    if (process.env.INTEGRATION_TEST_MODE === 'true') {
      try {
        const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
        user = {
          sub: decoded.id,
          email: decoded.email
        };
      } catch {
        // Not a test token, try normal JWT verification
        user = await verifyJwt(token);
      }
    } else {
      // Verify JWT using local JWKS (no service key exposure)
      user = await verifyJwt(token);
    }

    // Check if profile exists
    let profile = null;
    let dbError = false;

    try {
      profile = await db.prepare(`
        SELECT id, email, display_name, avatar_url, active_cellar_id, cellar_quota, bottle_quota, tier
        FROM profiles
        WHERE id = $1
      `).get(user.sub);  // sub = user ID in JWT
    } catch (dbErr) {
      // In INTEGRATION TEST MODE, allow DB errors (e.g., table doesn't exist)
      // and proceed with mock profile
      if (process.env.INTEGRATION_TEST_MODE === 'true') {
        dbError = true;
      } else {
        throw dbErr;
      }
    }

    if (!profile || dbError) {
      // INTEGRATION TEST MODE: Create mock profile without DB insertion
      // This allows integration tests to run without complex setup
      if (process.env.INTEGRATION_TEST_MODE === 'true') {
        profile = {
          id: user.sub,
          email: user.email,
          display_name: user.email?.split('@')[0] || 'Test User',
          avatar_url: null,
          active_cellar_id: req.headers['x-cellar-id'] || null,
          cellar_quota: 10,
          bottle_quota: 1000,
          tier: 'admin'
        };
      } else {
        // First login - run atomic setup
        profile = await createFirstTimeUser(user, req.headers['x-invite-code']);
        if (!profile) {
          return res.status(403).json({ error: 'Valid invite code required for beta signup' });
        }
      }
    } else {
      // Update last_login_at
      await db.prepare(`
        UPDATE profiles
        SET last_login_at = NOW()
        WHERE id = $1
      `).run(user.sub);
    }

    req.user = profile;
    next();
  } catch (err) {
    logger.error('Auth', 'Auth middleware error: ' + err.message);
    res.status(401).json({ error: 'Authentication failed' });
  }
}

/**
 * Atomic first-time user setup:
 * 1. Validate invite code (beta gating)
 * 2. Create profile
 * 3. Create default cellar
 * 4. Create membership (owner role)
 * 5. Set active_cellar_id
 * 6. Increment invite use_count
 *
 * All in a transaction - no half-created users.
 *
 * @param {Object} authUser - Supabase auth user object
 * @param {string} inviteCode - Invite code from header
 * @returns {Promise<Object|null>} Profile with active_cellar_id, or null if validation failed
 */
async function createFirstTimeUser(authUser, inviteCode) {
  // Validate invite code (beta gating)
  if (!inviteCode) {
    return null;
  }

  try {
    const result = await db.transaction(async (client) => {
      // CRITICAL: Use FOR UPDATE to lock invite row, preventing race condition
      // This prevents two concurrent signups from both passing the use_count check
      const { rows: [invite] } = await client.query(`
        SELECT code, max_uses, use_count, expires_at
        FROM invites
        WHERE code = $1
        FOR UPDATE
      `, [inviteCode]);

      if (!invite) return null;

      // Validate expiry and use count within transaction
      if (invite.expires_at && invite.expires_at <= new Date()) return null;
      if (invite.max_uses !== null && invite.use_count >= invite.max_uses) return null;

      // 1. Create profile
      const { rows: [profile] } = await client.query(`
        INSERT INTO profiles (id, email, display_name, avatar_url)
        VALUES ($1, $2, $3, $4)
        RETURNING id, email, display_name, avatar_url, active_cellar_id, cellar_quota, bottle_quota, tier
      `, [
        authUser.sub,  // sub = user ID in JWT
        authUser.email,
        authUser.name || authUser.email.split('@')[0],
        authUser.picture || null
      ]);

      // 2. Create default cellar
      const { rows: [cellar] } = await client.query(`
        INSERT INTO cellars (name, created_by)
        VALUES ($1, $2)
        RETURNING id
      `, ['My Cellar', profile.id]);

      // 3. Create membership (owner)
      await client.query(`
        INSERT INTO cellar_memberships (cellar_id, user_id, role)
        VALUES ($1, $2, 'owner')
      `, [cellar.id, profile.id]);

      // 4. Set active cellar
      await client.query(`
        UPDATE profiles SET active_cellar_id = $1 WHERE id = $2
      `, [cellar.id, profile.id]);

      // 5. Increment invite use_count
      await client.query(`
        UPDATE invites
        SET use_count = use_count + 1, used_by = $1, used_at = NOW()
        WHERE code = $2
      `, [profile.id, inviteCode]);

      // Return profile with active_cellar_id
      return { ...profile, active_cellar_id: cellar.id };
    });

    return result;
  } catch (err) {
    logger.error('Auth', 'First-time user setup failed: ' + err.message);
    return null;
  }
}

/**
 * Middleware: Require auth but don't fail on missing token.
 * Useful for optional auth endpoints.
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 * @returns {void}
 */
export async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);

    try {
      const user = await verifyJwt(token);

      const profile = await db.prepare(`
        SELECT id, email, display_name, avatar_url, active_cellar_id
        FROM profiles
        WHERE id = $1
      `).get(user.sub);

      if (profile) {
        req.user = profile;
      }
    } catch (_err) {
      // Silent fail for optional auth
    }
  }

  next();
}
