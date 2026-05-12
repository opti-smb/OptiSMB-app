import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma.js';
import { readSessionUserIdFromRequest } from '@/lib/server/sessionCookie.js';
import { decryptUserEmail, decryptBusinessName } from '@/lib/server/dbUser.js';

export const runtime = 'nodejs';

export async function GET(request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: false, authenticated: false }, { status: 503 });
  }
  const userId = readSessionUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ ok: false, authenticated: false }, { status: 401 });
  }
  const user = await prisma.user.findUnique({ where: { userId } });
  if (!user || user.deletedAt) {
    return NextResponse.json({ ok: false, authenticated: false }, { status: 401 });
  }
  const email = await decryptUserEmail(user);
  const business = await decryptBusinessName(user);
  return NextResponse.json({
    ok: true,
    authenticated: true,
    userId: user.userId,
    user: {
      email,
      business: business || undefined,
      name: business || undefined,
      industry: user.industry ?? undefined,
      country: user.country ?? undefined,
      tier: user.tier,
      roles: Array.isArray(user.roles) ? user.roles : ['user'],
    },
  });
}
