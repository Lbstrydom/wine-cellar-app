/**
 * @fileoverview Encryption service for secure credential storage.
 * @module services/encryption
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const KEY_FILE = '.credential_key';

/**
 * Get the encryption key from environment or persisted file.
 * NEVER logs the actual key value.
 * @returns {Buffer} 32-byte encryption key
 * @throws {Error} If no key is configured and cannot be persisted
 */
function getEncryptionKey() {
  // Priority 1: Environment variable (most secure for production)
  const keyEnv = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (keyEnv) {
    const key = Buffer.from(keyEnv, 'base64');
    if (key.length !== KEY_LENGTH) {
      throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 32 bytes (base64 encoded)');
    }
    return key;
  }

  // Priority 2: Persisted key file (for development convenience)
  const keyFilePath = path.join(process.cwd(), KEY_FILE);
  if (fs.existsSync(keyFilePath)) {
    try {
      const keyBase64 = fs.readFileSync(keyFilePath, 'utf8').trim();
      const key = Buffer.from(keyBase64, 'base64');
      if (key.length === KEY_LENGTH) {
        logger.info('Encryption', 'Using persisted encryption key from .credential_key file');
        return key;
      }
    } catch (_err) {
      // Fall through to generate new key
    }
  }

  // Priority 3: Generate and persist a new key (development only)
  logger.warn('Encryption', 'No CREDENTIAL_ENCRYPTION_KEY set. Generating and persisting key.');
  logger.warn('Encryption', 'For production, set CREDENTIAL_ENCRYPTION_KEY in your .env file');

  const newKey = crypto.randomBytes(KEY_LENGTH);
  const base64Key = newKey.toString('base64');

  // Persist the key so credentials survive restarts
  try {
    fs.writeFileSync(keyFilePath, base64Key, { mode: 0o600 }); // Owner read/write only
    logger.info('Encryption', `Key persisted to ${KEY_FILE} (add to .gitignore)`);
  } catch (err) {
    logger.error('Encryption', `Failed to persist key: ${err.message}`);
    logger.error('Encryption', 'Credentials will NOT survive restart. Set CREDENTIAL_ENCRYPTION_KEY.');
  }

  return newKey;
}

// Cache the key on module load
let encryptionKey = null;

/**
 * Initialize encryption key lazily.
 * @returns {Buffer} Encryption key
 */
function ensureKey() {
  if (!encryptionKey) {
    encryptionKey = getEncryptionKey();
  }
  return encryptionKey;
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * @param {string} plaintext - Text to encrypt
 * @returns {string} Base64-encoded ciphertext (IV + authTag + encrypted data)
 */
export function encrypt(plaintext) {
  if (!plaintext) return null;

  const key = ensureKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const authTag = cipher.getAuthTag();

  // Combine IV + authTag + encrypted data
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypt ciphertext using AES-256-GCM.
 * @param {string} ciphertext - Base64-encoded ciphertext
 * @returns {string|null} Decrypted plaintext or null if decryption fails
 */
export function decrypt(ciphertext) {
  if (!ciphertext) return null;

  try {
    const key = ensureKey();
    const combined = Buffer.from(ciphertext, 'base64');

    // Extract IV, authTag, and encrypted data
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  } catch (err) {
    logger.error('Encryption', `Decryption failed: ${err.message}`);
    return null;
  }
}

/**
 * Generate a new random encryption key.
 * @returns {string} Base64-encoded 32-byte key
 */
export function generateKey() {
  return crypto.randomBytes(KEY_LENGTH).toString('base64');
}

/**
 * Check if encryption is properly configured (env var or persisted file).
 * @returns {boolean} True if key is available
 */
export function isConfigured() {
  if (process.env.CREDENTIAL_ENCRYPTION_KEY) {
    return true;
  }
  const keyFilePath = path.join(process.cwd(), KEY_FILE);
  return fs.existsSync(keyFilePath);
}
