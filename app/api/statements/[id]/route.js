import { NextResponse } from 'next/server';
import { readSessionUserIdFromRequest } from '@/lib/server/sessionCookie.js';
import { deleteStatementForUser } from '@/lib/server/dbStatement.js';

export const runtime = 'nodejs';

export async function DELETE(request, { params }) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: false, error: 'database_not_configured' }, { status: 503 });
  }
  const userId = readSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const id = params?.id;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ ok: false, error: 'id_required' }, { status: 400 });
  }
  const ok = await deleteStatementForUser(userId, id);
  if (!ok) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
