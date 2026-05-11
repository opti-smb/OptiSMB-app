import { NextResponse } from 'next/server';
import { readSessionUserIdFromRequest } from '@/lib/server/sessionCookie.js';
import { updateUserProfile, decryptUserEmail, decryptBusinessName } from '@/lib/server/dbUser.js';

export const runtime = 'nodejs';

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

function noDb() {
  return NextResponse.json({ ok: false, error: 'database_not_configured' }, { status: 503 });
}

/**
 * PATCH profile (session user). Body: { businessName?, business?, name?, industry?, country?, tier? }.
 * Email is not changed here (identity key).
 */
export async function PATCH(request) {
  if (!process.env.DATABASE_URL) return noDb();
  const userId = readSessionUserIdFromRequest(request);
  if (!userId) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'body_required' }, { status: 400 });
  }

  const businessName = body.businessName ?? body.business ?? body.name ?? undefined;
  const industry = body.industry !== undefined ? body.industry : undefined;
  const countryLabel = body.country !== undefined ? body.country : undefined;
  const tier = body.tier !== undefined ? body.tier : undefined;

  try {
    const user = await updateUserProfile(userId, {
      businessName,
      industry,
      countryLabel,
      tier,
    });
    const email = await decryptUserEmail(user);
    const business = await decryptBusinessName(user);
    return NextResponse.json({
      ok: true,
      user: {
        email,
        business: business || undefined,
        name: business || undefined,
        industry: user.industry ?? undefined,
        country: user.country ?? undefined,
        tier: user.tier,
      },
    });
  } catch (e) {
    if (String(e?.message) === 'user_not_found') return unauthorized();
    console.error('[auth/profile PATCH]', e);
    return NextResponse.json({ ok: false, error: 'update_failed', message: String(e?.message || e) }, { status: 500 });
  }
}
