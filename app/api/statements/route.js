import { NextResponse } from 'next/server';
import { readSessionUserIdFromRequest } from '@/lib/server/sessionCookie.js';
import { createStatementForUser, listStatementsForUser, dbStatementToClient } from '@/lib/server/dbStatement.js';

export const runtime = 'nodejs';
/** Never serve cached statement lists (avoids stale rows after upload in dev / proxies). */
export const dynamic = 'force-dynamic';

const NO_STORE = {
  'Cache-Control': 'private, no-store, must-revalidate',
  Pragma: 'no-cache',
};

function noDb() {
  return NextResponse.json({ ok: false, error: 'database_not_configured' }, { status: 503 });
}

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

export async function GET(request) {
  if (!process.env.DATABASE_URL) return noDb();
  const userId = readSessionUserIdFromRequest(request);
  if (!userId) return unauthorized();
  const statements = await listStatementsForUser(userId);
  return NextResponse.json({ ok: true, statements }, { headers: NO_STORE });
}

export async function POST(request) {
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
  try {
    const { row, duplicate } = await createStatementForUser(userId, body);
    const statement = dbStatementToClient(row);
    return NextResponse.json({ ok: true, statement, duplicate }, { headers: NO_STORE });
  } catch (e) {
    console.error('[statements POST]', e);
    return NextResponse.json({ ok: false, error: 'save_failed', message: String(e?.message || e) }, { status: 500 });
  }
}
