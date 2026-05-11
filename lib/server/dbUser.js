import crypto from 'crypto';
import { prisma } from '@/lib/prisma.js';
import { encryptUtf8 } from '@/lib/server/cryptoAtRest.js';
import { getDataEncryptionKey32 } from '@/lib/server/dataKey.js';

const REGISTRY_PURPOSE = 'app_at_rest';

/**
 * One registry row per distinct app data-encryption key (fingerprint = SHA-256 of key material).
 * Links `User.encryptionKeyId` / `Statement.encryptionKeyId` to the key used for AES-GCM blobs.
 */
export async function ensureAppEncryptionRegistryKey() {
  const material = getDataEncryptionKey32();
  const fingerprintSha256 = crypto.createHash('sha256').update(material).digest('hex');
  const row = await prisma.encryptionKeyRegistry.upsert({
    where: { fingerprintSha256 },
    create: {
      fingerprintSha256,
      purpose: REGISTRY_PURPOSE,
    },
    update: { purpose: REGISTRY_PURPOSE },
  });
  return row.encryptionKeyId;
}

export function normalizeEmail(email) {
  return String(email ?? '')
    .trim()
    .toLowerCase();
}

export function emailHashHex(email) {
  const n = normalizeEmail(email);
  return crypto.createHash('sha256').update(n, 'utf8').digest('hex');
}

const COUNTRY_ISO2 = {
  'united states': 'US',
  'usa': 'US',
  'us': 'US',
  'united kingdom': 'GB',
  'uk': 'GB',
  'canada': 'CA',
  'india': 'IN',
  'australia': 'AU',
  'germany': 'DE',
  'france': 'FR',
};

export function countryToIso2(countryLabel) {
  const s = String(countryLabel ?? '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (s.length === 2 && /^[a-z]{2}$/i.test(s)) return s.toUpperCase();
  return COUNTRY_ISO2[s] ?? null;
}

/**
 * @param {{ email: string; businessName?: string|null; industry?: string|null; countryLabel?: string|null; tier?: string|null }} p
 */
export async function upsertUserFromAuth(p) {
  const email = normalizeEmail(p.email);
  if (!email) throw new Error('email_required');
  const hash = emailHashHex(email);
  const key = getDataEncryptionKey32();
  const emailEncrypted = encryptUtf8(email, key);
  const business = p.businessName != null && String(p.businessName).trim() ? String(p.businessName).trim() : null;
  const businessNameEncrypted = business ? encryptUtf8(business, key) : null;
  const industry = p.industry != null && String(p.industry).trim() ? String(p.industry).trim().slice(0, 100) : null;
  const country = countryToIso2(p.countryLabel) ?? undefined;
  const tier = (p.tier && String(p.tier).trim().slice(0, 10)) || 'L1';
  const roles = ['user'];
  const encryptionKeyId = await ensureAppEncryptionRegistryKey();

  return prisma.user.upsert({
    where: { emailHash: hash },
    create: {
      encryptionKeyId,
      emailEncrypted,
      emailHash: hash,
      businessNameEncrypted,
      industry,
      country,
      tier,
      roles,
    },
    update: {
      encryptionKeyId,
      emailEncrypted,
      businessNameEncrypted,
      industry,
      ...(country != null ? { country } : {}),
      tier,
      deletedAt: null,
    },
  });
}

export async function getUserById(userId) {
  return prisma.user.findUnique({ where: { userId } });
}

/**
 * Persist profile fields for the signed-in user (business name encrypted; industry/country/tier plain).
 * @param {string} userId
 * @param {{ businessName?: string|null; industry?: string|null; countryLabel?: string|null; tier?: string|null }} p
 */
export async function updateUserProfile(userId, p) {
  const existing = await prisma.user.findUnique({ where: { userId } });
  if (!existing) throw new Error('user_not_found');
  const key = getDataEncryptionKey32();
  const data = {};

  if (p.businessName !== undefined) {
    const business =
      p.businessName != null && String(p.businessName).trim() ? String(p.businessName).trim() : null;
    data.businessNameEncrypted = business ? encryptUtf8(business, key) : null;
  }
  if (p.industry !== undefined) {
    data.industry =
      p.industry != null && String(p.industry).trim() ? String(p.industry).trim().slice(0, 100) : null;
  }
  if (p.countryLabel !== undefined) {
    const iso = countryToIso2(p.countryLabel);
    if (iso != null) data.country = iso;
  }
  if (p.tier !== undefined) {
    const t = String(p.tier ?? '').trim().slice(0, 10);
    if (t) data.tier = t;
  }

  if (Object.keys(data).length === 0) return existing;
  return prisma.user.update({ where: { userId }, data });
}

export async function decryptUserEmail(row) {
  if (!row?.emailEncrypted) return '';
  try {
    const { decryptUtf8 } = await import('@/lib/server/cryptoAtRest.js');
    return decryptUtf8(Buffer.from(row.emailEncrypted), getDataEncryptionKey32());
  } catch {
    return '';
  }
}

export async function decryptBusinessName(row) {
  if (!row?.businessNameEncrypted) return '';
  try {
    const { decryptUtf8 } = await import('@/lib/server/cryptoAtRest.js');
    return decryptUtf8(Buffer.from(row.businessNameEncrypted), getDataEncryptionKey32());
  } catch {
    return '';
  }
}
