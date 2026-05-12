import { randomUUID } from 'node:crypto';
import { prisma } from '../prisma.js';

function toDecimal(n) {
  /** Explicit JSON/body `null` → SQL NULL for optional decimals */
  if (n === null) return null;
  if (n === undefined || n === '') return undefined;
  const x = Number(n);
  return Number.isFinite(x) ? x : undefined;
}

/** First non-empty scalar (parser / client may use snake_case or camelCase). */
function firstDefined(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/**
 * POST body `parsedData` mixes snake_case (Python) and camelCase (JS). Align to snake_case
 * for headline fees/volumes so DB columns (`pos_fees`, `ecomm_fees`, …) persist.
 * @param {Record<string, unknown>} pd
 */
function normalizeParsedDataIncoming(pd) {
  if (!pd || typeof pd !== 'object') return {};
  const feeLines = Array.isArray(pd.fee_lines)
    ? pd.fee_lines
    : Array.isArray(pd.feeLines)
      ? pd.feeLines
      : pd.fee_lines;
  const channelSplit = firstDefined(pd.channel_split, pd.channelSplit);
  return {
    ...pd,
    fee_lines: feeLines,
    channel_split: channelSplit ?? pd.channel_split,
    total_transaction_volume: firstDefined(pd.total_transaction_volume, pd.totalTransactionVolume),
    total_fees_charged: firstDefined(pd.total_fees_charged, pd.totalFeesCharged),
    effective_rate: firstDefined(pd.effective_rate, pd.effectiveRate),
    interchange_fees: firstDefined(pd.interchange_fees, pd.interchangeFees),
    scheme_fees: firstDefined(pd.scheme_fees, pd.schemeFees),
    service_fees: firstDefined(pd.service_fees, pd.serviceFees),
    other_fees: firstDefined(pd.other_fees, pd.otherFees),
    pos_volume: firstDefined(pd.pos_volume, pd.posVolume),
    ecomm_volume: firstDefined(pd.ecomm_volume, pd.ecommVolume),
    pos_fees: firstDefined(pd.pos_fees, pd.posFees),
    ecomm_fees: firstDefined(pd.ecomm_fees, pd.ecommFees),
    fee_headline_model: firstDefined(pd.fee_headline_model, pd.feeHeadlineModel),
  };
}

/**
 * Parser marks POS/e-comm–first statements so we do not persist synthetic interchange/scheme amounts.
 * Fallback for older parser builds: `fee_lines` only POS + Online rows.
 * @param {unknown} feeLines
 */
function feeLinesLookLikeChannelOnly(feeLines) {
  if (!Array.isArray(feeLines) || feeLines.length === 0) return false;
  return feeLines.every((row) => {
    const ch = row?.channel;
    return ch === 'POS' || ch === 'Online';
  });
}

/** Statement gave explicit POS and/or e-comm fee totals (parser headline fields). */
function hasChannelFeeScalars(pd) {
  const pos = Number(firstDefined(pd.pos_fees, pd.posFees));
  const ec = Number(firstDefined(pd.ecomm_fees, pd.ecommFees));
  if ((Number.isFinite(pos) && pos > 0.005) || (Number.isFinite(ec) && ec > 0.005)) return true;
  const cs = pd.channel_split && typeof pd.channel_split === 'object' ? pd.channel_split : null;
  if (cs?.pos && typeof cs.pos === 'object') {
    const f = Number(cs.pos.fees);
    if (Number.isFinite(f) && f > 0.005) return true;
  }
  if (cs?.cnp && typeof cs.cnp === 'object') {
    const f = Number(cs.cnp.fees);
    if (Number.isFinite(f) && f > 0.005) return true;
  }
  return false;
}

/**
 * Itemized rows look like an interchange / scheme / acquirer summary (not channel-only).
 * If there are no rows, we do not assume IC breakdown came from the PDF.
 * @param {unknown} feeLines
 */
function feeLinesSuggestIcSchemeBreakdown(feeLines) {
  if (!Array.isArray(feeLines) || feeLines.length === 0) return false;
  return feeLines.some((row) => {
    const ch = String(row?.channel ?? '');
    const t = String(row?.type ?? '').toLowerCase();
    if (ch === 'All' || ch === '—' || ch === '-' || ch === '–') return true;
    if (t.includes('interchange')) return true;
    if (t.includes('scheme') || t.includes('assessment')) return true;
    if (t.includes('processor') || (t.includes('acquirer') && !t.includes('pos'))) return true;
    return false;
  });
}

/**
 * @param {Record<string, unknown>} pd
 */
function shouldClearIcSchemeHeadlineFees(pd) {
  /** Parser explicitly chose IC/scheme/acquirer headline split — keep DB columns unless user overrides later. */
  if (pd.fee_headline_model === 'headline_ic_split') return false;
  if (pd.fee_headline_model === 'channel') return true;
  if (feeLinesLookLikeChannelOnly(pd.fee_lines)) return true;
  // Parser sends pos_fees / ecomm_fees but sometimes omits fee_lines or channel tags — still channel headline.
  if (hasChannelFeeScalars(pd) && !feeLinesSuggestIcSchemeBreakdown(pd.fee_lines)) return true;
  return false;
}

/**
 * Copy POS / e-comm fee totals from `channel_split` when headline fields are missing.
 * @param {Record<string, unknown>} pd
 */
function materializeChannelFeesFromSplit(pd) {
  if (!pd || typeof pd !== 'object') return pd;
  let posFees = firstDefined(pd.pos_fees, pd.posFees);
  let ecommFees = firstDefined(pd.ecomm_fees, pd.ecommFees);

  const cs = pd.channel_split && typeof pd.channel_split === 'object' ? pd.channel_split : null;
  if (cs) {
    if ((posFees == null || posFees === '') && cs.pos && typeof cs.pos === 'object') {
      const f = Number(cs.pos.fees);
      if (Number.isFinite(f) && f > 0.005) posFees = Math.round(f * 100) / 100;
    }
    if ((ecommFees == null || ecommFees === '') && cs.cnp && typeof cs.cnp === 'object') {
      const f = Number(cs.cnp.fees);
      if (Number.isFinite(f) && f > 0.005) ecommFees = Math.round(f * 100) / 100;
    }
  }

  const lines = Array.isArray(pd.fee_lines) ? pd.fee_lines : Array.isArray(pd.feeLines) ? pd.feeLines : null;
  if (lines && (posFees == null || posFees === '' || ecommFees == null || ecommFees === '')) {
    let posSum = 0;
    let ecommSum = 0;
    for (const row of lines) {
      const ch = row?.channel;
      const amt = Number(row?.amount);
      if (!Number.isFinite(amt) || amt <= 0) continue;
      if (ch === 'POS') posSum += amt;
      else if (ch === 'Online') ecommSum += amt;
    }
    if ((posFees == null || posFees === '') && posSum > 0.005) posFees = Math.round(posSum * 100) / 100;
    if ((ecommFees == null || ecommFees === '') && ecommSum > 0.005) ecommFees = Math.round(ecommSum * 100) / 100;
  }

  const out = { ...pd };
  if (posFees != null && posFees !== '') out.pos_fees = posFees;
  if (ecommFees != null && ecommFees !== '') out.ecomm_fees = ecommFees;
  return out;
}

/**
 * Strip headline IC/scheme/service/other scalars when fees are channel-based only.
 * @param {Record<string, unknown>} pd
 */
function sanitizeParsedDataFeeScalarsForStorage(pd) {
  if (!pd || typeof pd !== 'object') return pd;
  if (!shouldClearIcSchemeHeadlineFees(pd)) return pd;

  const cs = pd.channel_split && typeof pd.channel_split === 'object' ? pd.channel_split : null;
  let posFees = firstDefined(pd.pos_fees, pd.posFees);
  let ecommFees = firstDefined(pd.ecomm_fees, pd.ecommFees);
  if ((posFees == null || posFees === '') && cs?.pos && typeof cs.pos === 'object') {
    const f = Number(cs.pos.fees);
    if (Number.isFinite(f) && f > 0.005) posFees = Math.round(f * 100) / 100;
  }
  if ((ecommFees == null || ecommFees === '') && cs?.cnp && typeof cs.cnp === 'object') {
    const f = Number(cs.cnp.fees);
    if (Number.isFinite(f) && f > 0.005) ecommFees = Math.round(f * 100) / 100;
  }

  /** Never wipe materialized POS/e-comm with `undefined` (that was clearing good DB values). */
  const mergedPos = firstDefined(posFees, pd.pos_fees, pd.posFees);
  const mergedEcomm = firstDefined(ecommFees, pd.ecomm_fees, pd.ecommFees);

  const out = {
    ...pd,
    interchange_fees: null,
    scheme_fees: null,
    service_fees: null,
    other_fees: null,
  };
  if (mergedPos != null && mergedPos !== '') out.pos_fees = mergedPos;
  if (mergedEcomm != null && mergedEcomm !== '') out.ecomm_fees = mergedEcomm;
  return out;
}

function billingDate(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const d = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return new Date(`${d}T12:00:00.000Z`);
}

function isoDate(d) {
  if (!d) return null;
  try {
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

/**
 * @param {import('@prisma/client').Statement & { parsedData: import('@prisma/client').ParsedData | null }} row
 */
export function dbStatementToClient(row) {
  const pr = row.parsedData;
  let snap =
    pr?.parsedSnapshot && typeof pr.parsedSnapshot === 'object' && !Array.isArray(pr.parsedSnapshot)
      ? { ...pr.parsedSnapshot }
      : {};

  if (pr) {
    const overlay = {
      total_transaction_volume: toDecimal(pr.totalTransactionVolume),
      total_fees_charged: toDecimal(pr.totalFeesCharged),
      effective_rate: toDecimal(pr.effectiveRate),
      interchange_fees: toDecimal(pr.interchangeFees),
      scheme_fees: toDecimal(pr.schemeFees),
      service_fees: toDecimal(pr.serviceFees),
      other_fees: toDecimal(pr.otherFees),
      pos_volume: toDecimal(pr.posVolume),
      ecomm_volume: toDecimal(pr.ecommVolume),
      pos_fees: toDecimal(pr.posFees),
      ecomm_fees: toDecimal(pr.ecommFees),
    };
    for (const [k, v] of Object.entries(overlay)) {
      if (v !== undefined) snap[k] = v;
    }
    if (Array.isArray(pr.feeLines)) snap.fee_lines = pr.feeLines;
    if (pr.parsingConfidence) snap.parsing_confidence = pr.parsingConfidence;
    if (pr.currency) snap.currency = pr.currency;
  }

  const meta = snap._client && typeof snap._client === 'object' ? snap._client : {};
  const { _client: _omitClient, ...parsedData } = snap;

  const periodFromRow =
    row.billingPeriodTo != null
      ? new Date(row.billingPeriodTo).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      : meta.period || '';

  return {
    id: row.statementId,
    fileName: row.fileName,
    fileType: meta.fileType,
    statementCategory: meta.statementCategory,
    acquirer: row.acquirerName || parsedData.acquirer_name || 'Unknown Acquirer',
    period: meta.period || periodFromRow,
    uploadDate: meta.uploadDate,
    status: 'Parsed',
    parsingConfidence: pr?.parsingConfidence || parsedData.parsing_confidence || 'high',
    rateConfidence: meta.rateConfidence || 'medium',
    dataAsOf: meta.dataAsOf,
    source: meta.source,
    parseMethod: meta.parseMethod,
    parseFailureReason: meta.parseFailureReason ?? null,
    parseFailureMessage: meta.parseFailureMessage ?? null,
    extractionRatio: meta.extractionRatio ?? null,
    uploadKindDescription: meta.uploadKindDescription,
    fileSha256: row.fileSha256 || undefined,
    billingPeriodFromIso: isoDate(row.billingPeriodFrom),
    billingPeriodToIso: isoDate(row.billingPeriodTo),
    discrepancies: meta.discrepancies || [],
    benchmarks: meta.benchmarks || [],
    rateTrend: meta.rateTrend ?? null,
    parsedData,
  };
}

/**
 * Prefer the upload payload filename; fall back to parser fields so DB row and snapshot stay aligned.
 * @param {Record<string, unknown>} body
 * @param {Record<string, unknown>} pd
 */
function resolveStatementFileName(body, pd) {
  const fromBody = body?.fileName;
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();
  for (const k of ['source_filename', 'original_filename', 'upload_filename', 'file_name']) {
    const v = pd[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const ru = pd.report_ui;
  if (ru && typeof ru === 'object') {
    for (const k of ['source_file', 'source_filename', 'file_name']) {
      const v = /** @type {Record<string, unknown>} */ (ru)[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return 'statement';
}

/**
 * @param {string} userId
 * @param {Record<string, unknown>} body
 * @returns {Promise<{ row: import('@prisma/client').Statement & { parsedData: import('@prisma/client').ParsedData | null }, duplicate: boolean }>}
 */
export async function createStatementForUser(userId, body) {
  const rawPd = body?.parsedData && typeof body.parsedData === 'object' ? body.parsedData : {};
  const normalizedIn = normalizeParsedDataIncoming(rawPd);
  const withChannelFees = materializeChannelFeesFromSplit(normalizedIn);
  const pd = sanitizeParsedDataFeeScalarsForStorage(withChannelFees);

  const resolvedFileName = resolveStatementFileName(body, pd).slice(0, 2048);

  const clientBlock = {
    fileName: resolvedFileName,
    fileType: body.fileType,
    statementCategory: body.statementCategory,
    uploadDate: body.uploadDate,
    period: body.period,
    source: body.source,
    parseMethod: body.parseMethod,
    rateConfidence: body.rateConfidence,
    dataAsOf: body.dataAsOf,
    uploadKindDescription: body.uploadKindDescription,
    parseFailureReason: body.parseFailureReason,
    parseFailureMessage: body.parseFailureMessage,
    extractionRatio: body.extractionRatio,
    discrepancies: body.discrepancies,
    benchmarks: body.benchmarks,
    rateTrend: body.rateTrend,
  };

  let parsedSnapshot;
  try {
    parsedSnapshot = JSON.parse(JSON.stringify({ ...pd, _client: clientBlock }));
  } catch {
    parsedSnapshot = { ...pd, _client: clientBlock };
  }

  const fromIso = body.billingPeriodFromIso || (pd.billing_period?.from ? String(pd.billing_period.from).slice(0, 10) : null);
  const toIso = body.billingPeriodToIso || (pd.billing_period?.to ? String(pd.billing_period.to).slice(0, 10) : null);

  const size = Number(body.fileSizeBytes);
  const fileSizeBytes = Number.isFinite(size) && size >= 0 ? BigInt(Math.floor(size)) : 0n;

  const sha =
    body.fileSha256 && /^[a-f0-9]{64}$/i.test(String(body.fileSha256))
      ? String(body.fileSha256).toLowerCase().slice(0, 64)
      : null;

  const row = await prisma.statement.create({
    data: {
      statementId: randomUUID(),
      userId,
      fileName: resolvedFileName,
      fileSizeBytes,
      fileSha256: sha,
      acquirerName: body.acquirer || pd.acquirer_name || null,
      billingPeriodFrom: billingDate(fromIso),
      billingPeriodTo: billingDate(toIso),
      parseStatus: 'parsed',
      idempotencyKey: randomUUID(),
      parsedData: {
        create: {
          totalTransactionVolume: toDecimal(pd.total_transaction_volume),
          totalFeesCharged: toDecimal(pd.total_fees_charged),
          effectiveRate: toDecimal(pd.effective_rate),
          interchangeFees: toDecimal(pd.interchange_fees),
          schemeFees: toDecimal(pd.scheme_fees),
          serviceFees: toDecimal(pd.service_fees),
          otherFees: toDecimal(pd.other_fees),
          posVolume: toDecimal(pd.pos_volume),
          ecommVolume: toDecimal(pd.ecomm_volume),
          posFees: toDecimal(pd.pos_fees),
          ecommFees: toDecimal(pd.ecomm_fees),
          feeLines: Array.isArray(pd.fee_lines) ? pd.fee_lines : undefined,
          parsedSnapshot: parsedSnapshot || undefined,
          parsingConfidence: pd.parsing_confidence != null ? String(pd.parsing_confidence).slice(0, 10) : null,
          currency:
            pd.currency != null ? String(pd.currency).replace(/\s/g, '').toUpperCase().slice(0, 3) : null,
          comparisonSnapshotSha256:
            typeof pd.comparison_snapshot_sha256 === 'string'
              ? pd.comparison_snapshot_sha256.slice(0, 64)
              : null,
        },
      },
    },
    include: { parsedData: true },
  });

  return { row, duplicate: false };
}

/** @param {string} userId */
export async function listStatementsForUser(userId) {
  const rows = await prisma.statement.findMany({
    where: { userId },
    include: { parsedData: true },
    orderBy: [{ billingPeriodTo: 'desc' }, { statementId: 'desc' }],
  });
  return rows.map(dbStatementToClient);
}

/**
 * @param {string} userId
 * @param {string} statementId
 */
export async function deleteStatementForUser(userId, statementId) {
  const r = await prisma.statement.deleteMany({
    where: { statementId, userId },
  });
  return r.count > 0;
}
