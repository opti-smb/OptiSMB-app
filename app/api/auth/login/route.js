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

const MSG_INVALID_CREDENTIALS = 'Invalid email or password.';

const MSG_PASSWORD_NOT_SET =
  'This account has no password on file (older registration). Use Forgot password when available, or contact support to secure the account.';

/**
 * Auth: `register` creates `identity.users` with a bcrypt password hash. `login` verifies the password, then sets the session cookie.
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
  const password = body?.password;
  const businessName = body?.businessName ?? body?.business ?? body?.name ?? null;
  const industry = body?.industry ?? null;
  const countryLabel = body?.country ?? null;
  const tier = body?.tier ?? null;
  const intent = body?.intent === 'register' ? 'register' : 'login';
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ ok: false, error: 'email_required' }, { status: 400 });
  }
  if (typeof password !== 'string' || !password) {
    return NextResponse.json(
      { ok: false, error: 'password_required', message: 'Password is required.' },
      { status: 400 },
    );
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

    let user;
    if (intent === 'register') {
      try {
        user = await createUserFromAuth({
          email,
          password,
          businessName,
          industry,
          countryLabel,
          tier,
        });
      } catch (e) {
        if (e?.code === 'weak_password') {
          return NextResponse.json(
            {
              ok: false,
              error: 'weak_password',
              message: 'Password must be at least 10 characters.',
            },
            { status: 400 },
          );
        }
        if (e?.code === 'password_too_long') {
          return NextResponse.json(
            { ok: false, error: 'password_too_long', message: 'Password is too long.' },
            { status: 400 },
          );
        }
        throw e;
      }
    } else {
      const auth = await loginExistingUserFromAuth({
        email,
        password,
        businessName,
        industry,
        countryLabel,
        tier,
      });
      if (auth === 'invalid_credentials') {
        return NextResponse.json(
          { ok: false, error: 'invalid_credentials', message: MSG_INVALID_CREDENTIALS },
          { status: 401 },
        );
      }
      if (auth === 'password_not_set') {
        return NextResponse.json(
          { ok: false, error: 'password_not_set', message: MSG_PASSWORD_NOT_SET },
          { status: 403 },
        );
      }
      user = auth;
    }

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
