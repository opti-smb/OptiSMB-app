import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'optismb_session';

function signingSecret() {
  const s = process.env.SESSION_SECRET || process.env.APP_ENCRYPTION_SECRET;
  if (!s || String(s).length < 16) return null;
  return String(s);
}

function signPayload(payload) {
  const secret = signingSecret();
  if (!secret) return null;
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  const secret = signingSecret();
  if (!secret || !token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const json = Buffer.from(body, 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    if (payload.exp && typeof payload.exp === 'number' && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * @param {import('next/server').NextResponse} res
 * @param {string} userId
 */
export function setSessionCookie(res, userId) {
  const token = signPayload({ u: userId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 });
  if (!token) return;
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

/** @param {import('next/server').NextResponse} res */
export function clearSessionCookie(res) {
  res.cookies.set(COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 });
}

/** @param {import('next/server').NextRequest} request */
export function readSessionUserIdFromRequest(request) {
  const raw = request.cookies.get(COOKIE_NAME)?.value;
  const p = verifyToken(raw);
  const u = p?.u;
  if (typeof u !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(u)) return null;
  return u;
}
