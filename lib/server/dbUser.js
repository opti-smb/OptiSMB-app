import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { prisma } from '../prisma.js';

function aesKey32() {
  const hex = process.env.APP_DATA_ENCRYPTION_KEY;
  if (hex && /^[a-f0-9]{64}$/i.test(String(hex).trim())) {
    return Buffer.from(String(hex).trim(), 'hex');
  }
  const s = process.env.SESSION_SECRET || process.env.APP_ENCRYPTION_SECRET;
  if (!s || String(s).length < 16) {
    throw new Error('Set SESSION_SECRET (16+ chars) or APP_DATA_ENCRYPTION_KEY (64 hex chars)');
  }
  return createHash('sha256').update(String(s), 'utf8').digest();
}

/** @returns {Buffer} iv(12) + tag(16) + ciphertext */
function sealUtf8(plaintext) {
  const key = aesKey32();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

/** @param {Buffer} buf */
function openUtf8(buf) {
  if (!buf || buf.length < 29) return '';
  const key = aesKey32();
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function emailHash(email) {
  return createHash('sha256').update(String(email).trim().toLowerCase(), 'utf8').digest('hex');
}

/** @param {string} email */
export async function isEmailRegistered(email) {
  const hash = emailHash(email);
  const row = await prisma.user.findUnique({ where: { emailHash: hash }, select: { userId: true } });
  return !!row;
}

function countryToChar2(countryLabel) {
  if (countryLabel == null || countryLabel === '') return null;
  const s = String(countryLabel).trim();
  if (s.length === 2) return s.toUpperCase();
  const map = {
    'United States': 'US',
    Canada: 'CA',
    'United Kingdom': 'GB',
  };
  return map[s] || null;
}

function rolesForEmailNorm(emailNorm) {
  const adminEmail = process.env.ADMIN_EMAIL ? String(process.env.ADMIN_EMAIL).trim().toLowerCase() : '';
  return adminEmail && emailNorm === adminEmail ? ['user', 'admin'] : ['user'];
}

/**
 * Create a new user row. Caller must ensure the email is not already registered.
 * @param {{ email: string, businessName?: string|null, industry?: string|null, countryLabel?: string|null, tier?: string|null }} p
 */
export async function createUserFromAuth({ email, businessName, industry, countryLabel, tier }) {
  const hash = emailHash(email);
  const emailNorm = String(email).trim().toLowerCase();
  const emailCt = sealUtf8(emailNorm);
  const bizCt =
    businessName != null && String(businessName).trim() !== '' ? sealUtf8(String(businessName).trim()) : null;
  const roles = rolesForEmailNorm(emailNorm);

  return prisma.user.create({
    data: {
      emailCiphertext: emailCt,
      emailHash: hash,
      businessNameCiphertext: bizCt,
      industry: industry != null ? String(industry).slice(0, 100) : null,
      country: countryToChar2(countryLabel),
      tier: tier != null ? String(tier).slice(0, 10) : 'L1',
      roles,
    },
  });
}

/**
 * Sign-in only: refresh ciphertext / profile fields for an existing user. Returns `null` if no account.
 * @param {{ email: string, businessName?: string|null, industry?: string|null, countryLabel?: string|null, tier?: string|null }} p
 */
export async function loginExistingUserFromAuth({ email, businessName, industry, countryLabel, tier }) {
  const hash = emailHash(email);
  const emailNorm = String(email).trim().toLowerCase();
  const emailCt = sealUtf8(emailNorm);
  const bizCt =
    businessName != null && String(businessName).trim() !== '' ? sealUtf8(String(businessName).trim()) : null;
  const roles = rolesForEmailNorm(emailNorm);

  const existing = await prisma.user.findUnique({ where: { emailHash: hash } });
  if (!existing) return null;

  return prisma.user.update({
    where: { userId: existing.userId },
    data: {
      emailCiphertext: emailCt,
      ...(bizCt !== null && { businessNameCiphertext: bizCt }),
      ...(industry != null && { industry: String(industry).slice(0, 100) }),
      ...(countryLabel !== undefined && { country: countryToChar2(countryLabel) }),
      ...(tier != null && { tier: String(tier).slice(0, 10) }),
      roles,
    },
  });
}

/** @param {import('@prisma/client').User} user */
export async function decryptUserEmail(user) {
  return openUtf8(Buffer.from(user.emailCiphertext));
}

/** @param {import('@prisma/client').User} user */
export async function decryptBusinessName(user) {
  if (!user.businessNameCiphertext) return '';
  return openUtf8(Buffer.from(user.businessNameCiphertext));
}

/**
 * @param {string} userId
 * @param {{ businessName?: string, industry?: string, countryLabel?: string, tier?: string }} patch
 */
export async function updateUserProfile(userId, patch) {
  const existing = await prisma.user.findUnique({ where: { userId } });
  if (!existing) throw new Error('user_not_found');

  const data = {};
  if (patch.businessName !== undefined) {
    const v = patch.businessName;
    data.businessNameCiphertext =
      v != null && String(v).trim() !== '' ? sealUtf8(String(v).trim()) : null;
  }
  if (patch.industry !== undefined) {
    data.industry = patch.industry != null ? String(patch.industry).slice(0, 100) : null;
  }
  if (patch.countryLabel !== undefined) {
    data.country = countryToChar2(patch.countryLabel);
  }
  if (patch.tier !== undefined) {
    data.tier = patch.tier != null ? String(patch.tier).slice(0, 10) : existing.tier;
  }

  return prisma.user.update({ where: { userId }, data });
}
