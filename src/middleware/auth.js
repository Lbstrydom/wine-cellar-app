/**
 * @fileoverview JWT authentication middleware for Supabase Auth.
 * Validates JWT tokens and creates first-time user profiles.
 * Uses local JWT verification with Supabase JWKS instead of service key.
 * @module middleware/auth
 */

import jwt from 'jsonwebtoken';
import { createPublicKey } from 'crypto';
import db from '../db/index.js';

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
    console.error('Failed to fetch JWKS:', err);
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
      algorithms: ['RS256'],
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
    // Verify JWT using local JWKS (no service key exposure)
    const user = await verifyJwt(token);

    // Check if profile exists
    let profile = await db.prepare(`
      SELECT id, email, display_name, avatar_url, active_cellar_id, cellar_quota, bottle_quota, tier
      FROM profiles
      WHERE id = $1
    `).get(user.sub);  // sub = user ID in JWT

    if (!profile) {
      // First login - run atomic setup
      profile = await createFirstTimeUser(user, req.headers['x-invite-code']);
      if (!profile) {
        return res.status(403).json({ error: 'Valid invite code required for beta signup' });
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
    console.error('Auth middleware error:', err);
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
    // Atomic transaction (includes invite validation)
    await db.prepare('BEGIN').run();

    try {
      // CRITICAL: Use FOR UPDATE to lock invite row, preventing race condition
      // This prevents two concurrent signups from both passing the use_count check
      const invite = await db.prepare(`
        SELECT code, max_uses, use_count, expires_at
        FROM invites
        WHERE code = $1
        FOR UPDATE
      `).get(inviteCode);

      if (!invite) {
        await db.prepare('ROLLBACK').run();
        return null;
      }

      // Validate expiry and use count within transaction
      if (invite.expires_at && invite.expires_at <= new Date()) {
        await db.prepare('ROLLBACK').run();
        return null;  // Expired
      }

      if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
        await db.prepare('ROLLBACK').run();
        return null;  // Maxed out
      }

      // 1. Create profile
      const profile = await db.prepare(`
        INSERT INTO profiles (id, email, display_name, avatar_url)
        VALUES ($1, $2, $3, $4)
        RETURNING id, email, display_name, avatar_url, active_cellar_id, cellar_quota, bottle_quota, tier
      `).get(
        authUser.sub,  // sub = user ID in JWT
        authUser.email,
        authUser.name || authUser.email.split('@')[0],
        authUser.picture || null
      );

      // 2. Create default cellar
      const cellar = await db.prepare(`
        INSERT INTO cellars (name, created_by)
        VALUES ($1, $2)
        RETURNING id
      `).get('My Cellar', profile.id);

      // 3. Create membership (owner)
      await db.prepare(`
        INSERT INTO cellar_memberships (cellar_id, user_id, role)
        VALUES ($1, $2, 'owner')
      `).run(cellar.id, profile.id);

      // 4. Set active cellar
      await db.prepare(`
        UPDATE profiles SET active_cellar_id = $1 WHERE id = $2
      `).run(cellar.id, profile.id);

      // 5. Increment invite use_count
      await db.prepare(`
        UPDATE invites
        SET use_count = use_count + 1, used_by = $1, used_at = NOW()
        WHERE code = $2
      `).run(profile.id, inviteCode);

      await db.prepare('COMMIT').run();

      // Return profile with active_cellar_id
      return { ...profile, active_cellar_id: cellar.id };

    } catch (err) {
      await db.prepare('ROLLBACK').run();
      console.error('First-time user setup failed:', err);
      return null;
    }
  } catch (err) {
    // Outer catch for any unexpected errors (JWKS fetch, etc.)
    console.error('Invite validation error:', err);
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
