import crypto from 'crypto';
import { prisma } from '@/lib/prisma.js';
import { encryptJson, decryptJson, encryptUtf8 } from '@/lib/server/cryptoAtRest.js';
import { getDataEncryptionKey32 } from '@/lib/server/dataKey.js';
import { ensureAppEncryptionRegistryKey } from '@/lib/server/dbUser.js';

function numOrZero(n) {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/**
 * Persist client-shaped statement. Full `parsedData` is stored as encrypted JSON in `parsed_data.fee_lines_encrypted`
 * (column name is legacy; content is the entire parsed object for round-trip).
 * @param {string} userId
 * @param {object} stmt
 */
export async function createStatementForUser(userId, stmt) {
  const encryptionKeyId = await ensureAppEncryptionRegistryKey();
  const key = getDataEncryptionKey32();
  const base = stmt.parsedData && typeof stmt.parsedData === 'object' ? { ...stmt.parsedData } : {};
  const pd = {
    ...base,
    discrepancies: stmt.discrepancies ?? base.discrepancies ?? [],
    benchmarks: stmt.benchmarks ?? base.benchmarks ?? [],
    rateTrend: stmt.rateTrend ?? base.rateTrend ?? null,
    linkedSourceFiles: stmt.linkedSourceFiles ?? base.linkedSourceFiles,
    uploadKindDescription: stmt.uploadKindDescription ?? base.uploadKindDescription,
    statementCategory: stmt.statementCategory ?? base.statementCategory,
    parseMethod: stmt.parseMethod ?? base.parseMethod,
    source: stmt.source ?? base.source,
    parseFailureReason: stmt.parseFailureReason ?? base.parseFailureReason,
    parseFailureMessage: stmt.parseFailureMessage ?? base.parseFailureMessage,
    extractionRatio: stmt.extractionRatio ?? base.extractionRatio,
  };
  const fileName = String(stmt.fileName || 'statement').slice(0, 500);
  const fileSizeBytes = BigInt(numOrZero(stmt.fileSizeBytes ?? stmt.fileSize));
  const acquirerName = stmt.acquirer || pd.acquirer_name || null;
  const bpFrom = pd.billing_period?.from ? new Date(pd.billing_period.from) : null;
  const bpTo = pd.billing_period?.to ? new Date(pd.billing_period.to) : null;
  const parseStatus = String(stmt.status || 'parsed')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .slice(0, 30);
  const merchantId = pd.merchant_id != null && pd.merchant_id !== '' ? String(pd.merchant_id) : null;

  return prisma.statement.create({
    data: {
      userId,
      encryptionKeyId,
      fileName,
      fileSizeBytes,
      fileSha256: stmt.fileSha256 ? String(stmt.fileSha256).slice(0, 64) : null,
      merchantIdEncrypted: merchantId ? encryptUtf8(merchantId, key) : null,
      acquirerName: acquirerName ? String(acquirerName).slice(0, 255) : null,
      billingPeriodFrom: bpFrom,
      billingPeriodTo: bpTo,
      parseStatus,
      idempotencyKey: crypto.randomUUID(),
      parsedData: {
        create: {
          encryptionKeyId,
          feeLinesEncrypted: encryptJson(pd, key),
          currency: pd.currency ? String(pd.currency).slice(0, 3).toUpperCase() : null,
          parsingConfidence: stmt.parsingConfidence ? String(stmt.parsingConfidence).slice(0, 10) : null,
        },
      },
    },
    include: { parsedData: true },
  });
}

function formatPeriodFromRow(row, pd) {
  if (row.billingPeriodFrom && !Number.isNaN(row.billingPeriodFrom.getTime())) {
    return row.billingPeriodFrom.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  if (pd?.billing_period?.from) {
    const d = new Date(pd.billing_period.from);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  return '—';
}

/** @param {Date | null} d */
function billingMonthKeyFromDate(d) {
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function billingMonthKeyFromRow(row, pd) {
  const fromRow = billingMonthKeyFromDate(row.billingPeriodFrom);
  if (fromRow) return fromRow;
  if (pd?.billing_period?.from) {
    const d = new Date(pd.billing_period.from);
    return billingMonthKeyFromDate(d);
  }
  return null;
}

/**
 * @param {import('@prisma/client').Statement & { parsedData: import('@prisma/client').ParsedData | null }} row
 */
export function dbStatementToClient(row) {
  const key = getDataEncryptionKey32();
  let pd = {};
  if (row.parsedData?.feeLinesEncrypted) {
    try {
      pd = decryptJson(Buffer.from(row.parsedData.feeLinesEncrypted), key) || {};
    } catch {
      pd = {};
    }
  }
  const titleCaseStatus = row.parseStatus
    ? row.parseStatus
        .split(/[_\s]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    : 'Parsed';
  const uploadDate =
    row.billingPeriodTo != null
      ? row.billingPeriodTo.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
      : new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });

  const billingMonthKey = billingMonthKeyFromRow(row, pd);

  return {
    id: row.statementId,
    fileName: row.fileName,
    acquirer: row.acquirerName || pd.acquirer_name || '—',
    period: formatPeriodFromRow(row, pd),
    billingMonthKey,
    billingPeriodFromIso:
      row.billingPeriodFrom && !Number.isNaN(row.billingPeriodFrom.getTime())
        ? row.billingPeriodFrom.toISOString().slice(0, 10)
        : pd?.billing_period?.from
          ? String(pd.billing_period.from).slice(0, 10)
          : null,
    billingPeriodToIso:
      row.billingPeriodTo && !Number.isNaN(row.billingPeriodTo.getTime())
        ? row.billingPeriodTo.toISOString().slice(0, 10)
        : pd?.billing_period?.to
          ? String(pd.billing_period.to).slice(0, 10)
          : null,
    uploadDate,
    status: titleCaseStatus,
    parsingConfidence: row.parsedData?.parsingConfidence || pd.parsingConfidence || 'high',
    rateConfidence: pd.rateConfidence ?? 'medium',
    dataAsOf: uploadDate,
    source: pd.source || 'live',
    fileType: pd.file_type || 'pdf',
    parsedData: pd,
    discrepancies: Array.isArray(pd.discrepancies) ? pd.discrepancies : [],
    benchmarks: Array.isArray(pd.benchmarks) ? pd.benchmarks : [],
    rateTrend: pd.rateTrend ?? null,
    linkedSourceFiles: Array.isArray(pd.linkedSourceFiles) ? pd.linkedSourceFiles : undefined,
    uploadKindDescription: pd.uploadKindDescription,
    statementCategory: pd.statementCategory,
    parseMethod: pd.parseMethod,
    parseFailureReason: pd.parseFailureReason,
    parseFailureMessage: pd.parseFailureMessage,
    extractionRatio: pd.extractionRatio,
    dbBacked: true,
  };
}

export async function listStatementsForUser(userId) {
  const rows = await prisma.statement.findMany({
    where: { userId },
    include: { parsedData: true },
    orderBy: [
      { billingPeriodFrom: { sort: 'desc', nulls: 'last' } },
      { statementId: 'desc' },
    ],
  });
  return rows.map(dbStatementToClient);
}

export async function deleteStatementForUser(userId, statementId) {
  const r = await prisma.statement.deleteMany({
    where: { userId, statementId },
  });
  return r.count > 0;
}
