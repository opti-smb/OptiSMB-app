import crypto from 'crypto';

const COOKIE = 'optismb_session';
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

function sessionSecret() {
  return process.env.SESSION_SECRET || process.env.APP_ENCRYPTION_SECRET || 'optismb-session-dev-only';
}

export function sessionCookieName() {
  return COOKIE;
}

/**
 * @param {string} userId UUID
 * @returns {string} cookie value
 */
export function sealSessionUserId(userId) {
  const exp = Date.now() + MAX_AGE_SEC * 1000;
  const payload = JSON.stringify({ userId, exp });
  const sig = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sig}`;
}

/**
 * @param {string} cookieValue
 * @returns {string | null} userId
 */
export function unsealSessionUserId(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  const i = cookieValue.lastIndexOf('.');
  if (i <= 0) return null;
  const b64 = cookieValue.slice(0, i);
  const sig = cookieValue.slice(i + 1);
  let payload;
  try {
    payload = Buffer.from(b64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  try {
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return null;
    }
  } catch {
    return null;
  }
  try {
    const { userId, exp } = JSON.parse(payload);
    if (typeof userId !== 'string' || typeof exp !== 'number' || Date.now() > exp) return null;
    return userId;
  } catch {
    return null;
  }
}

/** @param {import('next/server').NextResponse} res */
export function setSessionCookie(res, userId) {
  res.cookies.set(COOKIE, sealSessionUserId(userId), {
    httpOnly: true,
    path: '/',
    maxAge: MAX_AGE_SEC,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

/** @param {import('next/server').NextResponse} res */
export function clearSessionCookie(res) {
  res.cookies.set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0, sameSite: 'lax' });
}

/** @param {import('next/server').NextRequest} req */
export function readSessionUserIdFromRequest(req) {
  return unsealSessionUserId(req.cookies.get(COOKIE)?.value ?? '');
}
