import crypto from 'crypto';
import { getDataEncryptionKey32 } from './dataKey.js';

const ALGO = 'aes-256-gcm';

/**
 * Encrypt UTF-8 string → single Buffer (iv ‖ authTag ‖ ciphertext).
 * @param {string} plaintext
 * @param {Buffer} [key32]
 * @returns {Buffer}
 */
export function encryptUtf8(plaintext, key32 = getDataEncryptionKey32()) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key32, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

/**
 * @param {Buffer} buf
 * @param {Buffer} [key32]
 * @returns {string}
 */
export function decryptUtf8(buf, key32 = getDataEncryptionKey32()) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length < 28) return '';
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, key32, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Encrypt JSON-serializable value (uses JSON.stringify). */
export function encryptJson(value, key32) {
  return encryptUtf8(JSON.stringify(value == null ? null : value), key32);
}

export function decryptJson(buf, key32) {
  const s = decryptUtf8(buf, key32);
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
