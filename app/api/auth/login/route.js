import { NextResponse } from 'next/server';
import {
  createUserFromAuth,
  loginExistingUserFromAuth,
  decryptUserEmail,
  decryptBusinessName,
  isEmailRegistered,
} from '@/lib/server/dbUser.js';
import { setSessionCookie } from '@/lib/server/sessionCookie.js';

export const runtime = 'nodejs';

function noDb() {
  return NextResponse.json({ ok: false, error: 'database_not_configured', message: 'Set DATABASE_URL in .env' }, { status: 503 });
}

const MSG_NO_ACCOUNT =
  "We don't have an account for this email yet. Create one on the Register page, then sign in here with the same address.";

const MSG_EMAIL_ALREADY_REGISTERED =
  'This email is already registered. Use Sign in with the same address instead of creating another account.';

/**
 * Auth: `register` creates `identity.users` (409 if email exists). `login` only signs in existing users (404 if no account). Sets session cookie on success.
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
  const intent = body?.intent === 'register' ? 'register' : 'login';
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ ok: false, error: 'email_required' }, { status: 400 });
  }
  try {
    if (intent === 'register') {
      if (await isEmailRegistered(email)) {
        return NextResponse.json(
          {
            ok: false,
            error: 'email_already_registered',
            message: MSG_EMAIL_ALREADY_REGISTERED,
          },
          { status: 409 },
        );
      }
    } else if (!(await isEmailRegistered(email))) {
      return NextResponse.json(
        {
          ok: false,
          error: 'no_account',
          message: MSG_NO_ACCOUNT,
        },
        { status: 404 },
      );
    }

    const user =
      intent === 'register'
        ? await createUserFromAuth({
            email,
            businessName,
            industry,
            countryLabel,
            tier,
          })
        : await loginExistingUserFromAuth({
            email,
            businessName,
            industry,
            countryLabel,
            tier,
          });
    if (!user) {
      return NextResponse.json(
        {
          ok: false,
          error: 'no_account',
          message: MSG_NO_ACCOUNT,
        },
        { status: 404 },
      );
    }
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
        country:
          countryLabel != null && String(countryLabel).trim() !== ''
            ? countryLabel
            : user.country ?? undefined,
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
