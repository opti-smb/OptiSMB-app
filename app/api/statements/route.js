import { NextResponse } from 'next/server';
import { readSessionUserIdFromRequest } from '@/lib/server/sessionCookie.js';
import { createStatementForUser, listStatementsForUser, dbStatementToClient } from '@/lib/server/dbStatement.js';

export const runtime = 'nodejs';

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
  return NextResponse.json({ ok: true, statements });
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
    return NextResponse.json({ ok: true, statement, duplicate });
  } catch (e) {
    console.error('[statements POST]', e);
    return NextResponse.json({ ok: false, error: 'save_failed', message: String(e?.message || e) }, { status: 500 });
  }
}
