import crypto from 'crypto';

/** 32-byte AES key from env (hex 64 chars) or SHA-256 of APP_ENCRYPTION_SECRET / SESSION_SECRET. */
export function getDataEncryptionKey32() {
  const hex = process.env.APP_DATA_ENCRYPTION_KEY;
  if (typeof hex === 'string' && /^[0-9a-fA-F]{64}$/.test(hex.trim())) {
    return Buffer.from(hex.trim(), 'hex');
  }
  const secret = process.env.APP_ENCRYPTION_SECRET || process.env.SESSION_SECRET || 'optismb-dev-only-change-me';
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}
