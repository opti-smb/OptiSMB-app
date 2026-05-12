import { NextResponse } from 'next/server';
import { upsertUserFromAuth, decryptUserEmail, decryptBusinessName } from '@/lib/server/dbUser.js';
import { setSessionCookie } from '@/lib/server/sessionCookie.js';

export const runtime = 'nodejs';

function noDb() {
  return NextResponse.json({ ok: false, error: 'database_not_configured', message: 'Set DATABASE_URL in .env' }, { status: 503 });
}

/**
 * Upsert `identity.users`, set session cookie. Body: { email, businessName?, industry?, country?, tier?, monthlyVolume? }.
 */
export async function POST(request) {
  if (!process.env.DATABASE_URL) return noDb();
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const email = body?.email;
  const businessName = body?.businessName ?? body?.business ?? body?.name ?? null;
  const industry = body?.industry ?? null;
  const countryLabel = body?.country ?? null;
  const tier = body?.tier ?? null;
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ ok: false, error: 'email_required' }, { status: 400 });
  }
  try {
    const user = await upsertUserFromAuth({
      email,
      businessName,
      industry,
      countryLabel,
      tier,
    });
    const emailPlain = await decryptUserEmail(user);
    const businessPlain = await decryptBusinessName(user);
    const res = NextResponse.json({
      ok: true,
      userId: user.userId,
      user: {
        email: emailPlain,
        business: businessPlain || undefined,
        name: businessPlain || undefined,
        industry: user.industry ?? undefined,
        country: countryLabel ?? undefined,
        tier: user.tier,
        monthlyVolume: body?.monthlyVolume,
        roles: Array.isArray(user.roles) ? user.roles : ['user'],
      },
    });
    if (!setSessionCookie(res, user.userId)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'session_not_configured',
          message:
            'Set SESSION_SECRET (16+ characters) in .env so the login cookie can be issued; without it saves to the database are blocked.',
        },
        { status: 503 },
      );
    }
    return res;
  } catch (e) {
    console.error('[auth/login]', e);
    return NextResponse.json({ ok: false, error: 'auth_failed', message: String(e?.message || e) }, { status: 500 });
  }
}
