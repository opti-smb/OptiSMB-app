/**
 * POS order / line rollups from **column titles + numeric shape**, not fixed English keywords.
 * Maps arbitrary header strings to roles (gross, refund/return, fee, tender, net, order id) via token overlap
 * and light numeric heuristics, then applies:
 *   POS gross (orders)     = Σ gross column
 *   Refunds / returns      = Σ |refund column| when present, else Σ max(0, −gross) on rows flagged as returns
 *   Net sales              = gross − refunds/returns
 *   Fees (card / non-cash) = Σ fee column on rows **not** classified as cash (cash → fee treated as 0)
 *   Net payout (orders)  = gross − fees (non-cash fees only)
 *   Cash total             = Σ gross on cash-classified rows (same amount column; no processing fee)
 */

import { pickPosTransactionArrays } from './posBatchCommissionAnalysis.js';
import { collectEmbeddedGridPosRowObjects } from './posTransactionEmbedHarvest.js';
import { slugifyCardOrKey } from './utils.js';
import { displayLabelForCardSlug } from './channelCardSlugDisplay.js';
import { normalizeStatementHeader as normalizeHeaderText } from './statementHeaderNormalize.js';
import { headingAliasScoreAdjustment } from './statementHeadingRoleMap.js';

const EPS = 0.005;

function tokenSet(s) {
  const n = normalizeHeaderText(s);
  return new Set(n.split(' ').filter((t) => t.length > 0));
}

/**
 * Multilingual / variant hints per semantic role (substring + token match; not a single English word).
 */
const ROLE_HINTS = {
  gross: [
    'gross',
    'sale',
    'sales',
    'amount',
    'total',
    'charge',
    'ticket',
    'collected',
    'payment',
    'item',
    'line',
    'subtotal',
    'ventas',
    'importe',
    'monto',
    'montant',
    'betrag',
    'umsatz',
    'brutto',
    'amount due',
    'charged',
    '销售额',
    '金额',
    '合计',
    'order total',
    'txn amount',
  ],
  refund: [
    'refund',
    'return',
    'returns',
    'reversal',
    'void',
    'credit',
    'chargeback',
    'cbk',
    'devolucion',
    'devolución',
    'remboursement',
    'retour',
    'ruckerstattung',
    'rueckerstattung',
    'storno',
    'annulation',
    '退货',
    '退款',
    '返金',
    'rebate',
    'adjustment',
    'negative',
  ],
  fee: [
    'fee',
    'fees',
    'commission',
    'mdr',
    'processing',
    'service charge',
    'interchange',
    'acquirer',
    'frais',
    'gebühr',
    'honorar',
    'prov',
    '手续费',
    '费用',
    '佣金',
    'kosten',
    'cost',
  ],
  tender: [
    'tender',
    'payment',
    'method',
    'type',
    'mode',
    'card',
    'wallet',
    'instrument',
    'medios',
    'pago',
    'zahlung',
    'moyen',
    '支付方式',
    '支払',
    'issuer',
    /** Omit bare `scheme` — it matches fee headers like “Scheme fee” and mis-maps interchange columns as tender. */
    'card scheme',
    'brand',
    'network',
    'product',
    'funding',
    'entry',
    'cnp',
    'present',
  ],
  cash: ['cash', 'bargeld', 'efectivo', 'espèces', 'dinero', 'kasse', '纸币', '現金'],
  net: [
    'net',
    'payout',
    'deposit',
    'settlement',
    'liquid',
    'paid out',
    'you receive',
    'nett',
    'netto',
    '入账',
    '实收',
  ],
  orderId: [
    'order',
    'receipt',
    'transaction',
    'txn',
    'payment id',
    'charge id',
    'reference',
    'ref #',
    'numero',
    'número',
    'bestell',
    '单号',
    '订单',
  ],
};

function scoreLabelAgainstHints(labelNorm, hints) {
  let score = 0;
  const tokens = tokenSet(labelNorm);
  for (const h of hints) {
    const hn = normalizeHeaderText(h);
    if (!hn) continue;
    if (labelNorm.includes(hn) || hn.includes(labelNorm)) score += 3;
    for (const t of hn.split(' ')) {
      if (t.length >= 3 && tokens.has(t)) score += 2;
      if (t.length >= 4 && labelNorm.includes(t)) score += 1.5;
    }
  }
  return score;
}

function roleTextScore(labelNorm, role) {
  return scoreLabelAgainstHints(labelNorm, ROLE_HINTS[role] || []);
}

function numCell(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const raw = String(v).trim();
  const parenNeg = raw.includes('(') && raw.includes(')');
  const s = raw.replace(/[,$€£¥\s]/g, '').replace(/[()]/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const mag = Math.abs(n);
  return parenNeg ? -mag : mag;
}

function columnNumericProfile(rows, key, cap = 120) {
  let n = 0;
  let sumAbs = 0;
  let neg = 0;
  let pos = 0;
  let zeros = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (n >= cap) break;
    const x = numCell(row[key]);
    if (x == null) continue;
    n += 1;
    const ax = Math.abs(x);
    sumAbs += ax;
    if (x < -EPS) neg += 1;
    else if (x > EPS) pos += 1;
    else zeros += 1;
  }
  const meanAbs = n ? sumAbs / n : 0;
  return { n, meanAbs, neg, pos, zeros };
}

function collectKeys(rows, maxKeys = 80) {
  const freq = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    for (const k of Object.keys(row)) {
      if (k.startsWith('_')) continue;
      freq.set(k, (freq.get(k) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeys)
    .map(([k]) => k);
}

/**
 * Column titles that often **partially match** gross hints (`item`, `line`, `amount`) but are **not** sale dollars
 * (counts, SKUs). Same extension model as {@link ROLE_HINTS}: add strings when a new export mis-classifies.
 * Scoring uses {@link scoreLabelAgainstHints} on normalised header text.
 */
const GROSS_ANTIPATTERN_HINTS = [
  'qty',
  'quantity',
  'units',
  'unit count',
  'line count',
  'row count',
  'num items',
  '# items',
  'sku',
  'upc',
  'plu',
  'ean',
  'cantidad',
  'menge',
  'stück',
  'pieces',
  'count',
];

/**
 * Fee-column titles that look like “fees” but are usually **merchant / line discounts**, not card MDR.
 * If the same header also matches {@link FEE_PROCESSING_CONTEXT_HINTS}, penalty is reduced (e.g. “processing discount”).
 */
const FEE_FALSE_PROCESSING_FEE_HINTS = [
  'line discount',
  'item discount',
  'order discount',
  'menu discount',
  'sku discount',
  'volume discount',
  'loyalty discount',
  'promotional discount',
  'markdown',
  'rebate',
  'coupon',
  'allowance',
  'descuento articulo',
  'rabatt',
  'remise',
];

/** When these appear with discount-like wording, treat as real processing fee column. */
const FEE_PROCESSING_CONTEXT_HINTS = [
  'processing',
  'interchange',
  'scheme',
  'acquirer',
  'mdr',
  'merchant discount rate',
  'service charge',
  'card fee',
  'commission rate',
  'gebühr',
  'frais',
  '手续费',
];

/**
 * Column titles that look like **fee / discount revenue** lines, not sale dollars. Penalise only for role `gross`
 * so “Merchant discount” / “Interchange pass-through” are not picked as the sale column.
 */
const GROSS_FEE_LIKE_HINTS = [
  'interchange',
  'merchant discount',
  'mdr',
  'scheme fee',
  'assessment',
  'processing fee',
  'service charge',
  'commission',
  'acquirer fee',
  'discount rate',
  'pass through',
  'passthrough',
  'gebühr',
  'frais',
];

/** @param {number} cap */
function antipatternScore(labelNorm, hintList, cap) {
  const raw = scoreLabelAgainstHints(labelNorm, hintList);
  return raw > 0 ? Math.min(cap, raw) : 0;
}

function grossAntipatternPenalty(labelNorm) {
  return antipatternScore(labelNorm, GROSS_ANTIPATTERN_HINTS, 14);
}

function grossFeeLikePenalty(labelNorm) {
  return antipatternScore(labelNorm, GROSS_FEE_LIKE_HINTS, 18);
}

function feeAntipatternPenalty(labelNorm) {
  const ctx = scoreLabelAgainstHints(labelNorm, FEE_PROCESSING_CONTEXT_HINTS);
  const bad = scoreLabelAgainstHints(labelNorm, FEE_FALSE_PROCESSING_FEE_HINTS);
  if (ctx >= 4) return 0;
  if (bad >= 3) return Math.min(14, bad);
  if (/\bdiscount\b/.test(labelNorm) && ctx < 3) return Math.min(12, 6 + bad * 0.5);
  return 0;
}

function pickBestKey(keys, rows, role, exclude, parsedData) {
  let best = null;
  let bestScore = -1;
  const floor = role === 'gross' ? 1.6 : 2;
  for (const key of keys) {
    if (exclude.has(key)) continue;
    const lab = normalizeHeaderText(key);
    let s = roleTextScore(lab, role);
    s += headingAliasScoreAdjustment(parsedData, key, role);
    const prof = columnNumericProfile(rows, key);
    if (role === 'gross') {
      s -= grossAntipatternPenalty(lab);
      s -= grossFeeLikePenalty(lab);
    }
    if (role === 'tender') {
      const feeLike = roleTextScore(lab, 'fee');
      if (feeLike >= 2.5) s -= Math.min(22, feeLike * 1.35);
      s -= grossFeeLikePenalty(lab);
    }
    if (role === 'fee') s -= feeAntipatternPenalty(lab);
    if (role === 'gross' && prof.n >= 3 && prof.meanAbs > 1) s += Math.min(8, Math.log10(prof.meanAbs + 1) * 2);
    if (role === 'refund' && prof.neg > prof.pos * 0.25 && prof.n >= 3) s += 4;
    if (role === 'fee' && prof.n >= 3 && prof.meanAbs > 0.2 && prof.meanAbs < prof.n * 5000) s += 2;
    if (role === 'net' && prof.n >= 3 && prof.meanAbs > 1) s += Math.min(6, Math.log10(prof.meanAbs + 1) * 1.5);
    if (s > bestScore) {
      bestScore = s;
      best = key;
    }
  }
  return bestScore >= floor ? { key: best, score: bestScore } : null;
}

/** Max header+numeric score for `role` without pick threshold (diagnostics / low-confidence warnings). */
function maxRoleHintScore(keys, rows, role, exclude, parsedData) {
  let best = -Infinity;
  for (const key of keys) {
    if (exclude.has(key)) continue;
    const lab = normalizeHeaderText(key);
    let s = roleTextScore(lab, role);
    s += headingAliasScoreAdjustment(parsedData, key, role);
    const prof = columnNumericProfile(rows, key);
    if (role === 'gross') {
      s -= grossAntipatternPenalty(lab);
      s -= grossFeeLikePenalty(lab);
    }
    if (role === 'tender') {
      const feeLike = roleTextScore(lab, 'fee');
      if (feeLike >= 2.5) s -= Math.min(22, feeLike * 1.35);
      s -= grossFeeLikePenalty(lab);
    }
    if (role === 'fee') s -= feeAntipatternPenalty(lab);
    if (role === 'gross' && prof.n >= 3 && prof.meanAbs > 1) s += Math.min(8, Math.log10(prof.meanAbs + 1) * 2);
    if (role === 'refund' && prof.neg > prof.pos * 0.25 && prof.n >= 3) s += 4;
    if (role === 'fee' && prof.n >= 3 && prof.meanAbs > 0.2 && prof.meanAbs < prof.n * 5000) s += 2;
    if (role === 'net' && prof.n >= 3 && prof.meanAbs > 1) s += Math.min(6, Math.log10(prof.meanAbs + 1) * 1.5);
    if (s > best) best = s;
  }
  return best === -Infinity ? 0 : best;
}

function tenderCellLooksCash(val) {
  const s = normalizeHeaderText(String(val ?? ''));
  if (!s) return false;
  return scoreLabelAgainstHints(s, ROLE_HINTS.cash) >= 2 || ROLE_HINTS.cash.some((h) => s === normalizeHeaderText(h));
}

function inferMapping(rows, keys, parsedData) {
  const used = new Set();
  const grossP = pickBestKey(keys, rows, 'gross', used, parsedData);
  if (!grossP) return null;
  used.add(grossP.key);

  const refundP = pickBestKey(keys, rows, 'refund', used, parsedData);
  if (refundP) used.add(refundP.key);

  const feeP = pickBestKey(keys, rows, 'fee', used, parsedData);
  if (feeP) used.add(feeP.key);

  const tenderP = pickBestKey(keys, rows, 'tender', used, parsedData);
  if (tenderP) used.add(tenderP.key);

  const netP = pickBestKey(keys, rows, 'net', used, parsedData);
  if (netP) used.add(netP.key);

  const orderP = pickBestKey(keys, rows, 'orderId', used, parsedData);
  if (orderP) used.add(orderP.key);

  const feeHintMax = feeP ? feeP.score : maxRoleHintScore(keys, rows, 'fee', used, parsedData);
  const tenderHintMax = tenderP ? tenderP.score : maxRoleHintScore(keys, rows, 'tender', used, parsedData);

  return {
    grossKey: grossP.key,
    refundKey: refundP?.key ?? null,
    feeKey: feeP?.key ?? null,
    tenderKey: tenderP?.key ?? null,
    netKey: netP?.key ?? null,
    orderIdKey: orderP?.key ?? null,
    grossHeaderScore: grossP.score,
    mappingConfidence: {
      grossScore: grossP.score,
      feeMapped: Boolean(feeP),
      feeScore: feeP?.score ?? feeHintMax,
      feeHintMax: Number.isFinite(feeHintMax) ? feeHintMax : 0,
      tenderMapped: Boolean(tenderP),
      tenderHintMax: Number.isFinite(tenderHintMax) ? tenderHintMax : 0,
      netMapped: Boolean(netP),
      orderMapped: Boolean(orderP),
    },
  };
}

/**
 * Same transaction arrays as {@link pickPosTransactionArrays}, but each kept separate with a priority so we can pick
 * **one** homogeneous table for header inference. Mixing POS line objects with unrelated `transactions[]` or duplicate
 * embedded grids breaks column mapping and doubles totals.
 * @type {{ pri: number, tag: string, pick: (pd: object) => unknown}[]}
 */
const POS_SEMANTIC_ROW_SOURCES = [
  { pri: 1000, tag: 'pos_transactions', pick: (pd) => pd.pos_transactions },
  { pri: 990, tag: 'pos_transaction_details', pick: (pd) => pd.pos_transaction_details },
  { pri: 980, tag: 'card_present_transactions', pick: (pd) => pd.card_present_transactions },
  { pri: 970, tag: 'in_store_transactions', pick: (pd) => pd.in_store_transactions },
  { pri: 920, tag: 'raw_extracted.pos_transactions', pick: (pd) => pd.raw_extracted?.pos_transactions },
  { pri: 915, tag: 'raw_extracted.pos_transaction_details', pick: (pd) => pd.raw_extracted?.pos_transaction_details },
  { pri: 910, tag: 'extracted.pos_transactions', pick: (pd) => pd.extracted?.pos_transactions },
  { pri: 905, tag: 'extracted.pos_transaction_details', pick: (pd) => pd.extracted?.pos_transaction_details },
  { pri: 760, tag: 'batch_transactions', pick: (pd) => pd.batch_transactions },
  { pri: 620, tag: 'pos_settlement_transactions', pick: (pd) => pd.pos_settlement_transactions },
  { pri: 400, tag: 'transactions', pick: (pd) => pd.transactions },
  { pri: 380, tag: 'raw_extracted.transactions', pick: (pd) => pd.raw_extracted?.transactions },
  { pri: 375, tag: 'raw_extracted_preview.transactions', pick: (pd) => pd.raw_extracted_preview?.transactions },
  { pri: 370, tag: 'extracted.transactions', pick: (pd) => pd.extracted?.transactions },
  { pri: 100, tag: 'embedded_tables', pick: (pd) => collectEmbeddedGridPosRowObjects(pd) },
];

function listRowObjects(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
}

/**
 * One best-effort homogeneous row set for semantic POS rollups (same mapping applied to every row).
 * @param {object|null|undefined} parsedData
 * @returns {object[]}
 */
export function pickPosRowsForSemanticRollup(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return [];
  let bestRows = null;
  let bestScore = -Infinity;
  for (const { pri, tag, pick } of POS_SEMANTIC_ROW_SOURCES) {
    const rows = listRowObjects(pick(parsedData));
    if (rows.length < 2) continue;
    const keys = collectKeys(rows, 100);
    if (keys.length < 2) continue;
    const map = inferMapping(rows, keys, parsedData);
    if (!map) continue;
    const roll = rollupRows(rows, map);
    if (!roll || !(roll.posGrossOrders > EPS) || roll.rowCount < 2) continue;
    const inferBonus = Math.min(12_000, (map.grossHeaderScore ?? 0) * 100);
    const score = pri * 1_000_000 + Math.min(50_000, rows.length) + inferBonus;
    if (score > bestScore) {
      bestScore = score;
      bestRows = rows;
    }
  }
  if (bestRows && bestRows.length >= 2) return bestRows;
  return listRowObjects(pickPosTransactionArrays(parsedData));
}

/**
 * @param {object[]} rows
 * @param {ReturnType<typeof inferMapping>} map
 */
function rollupRows(rows, map) {
  if (!map || !map.grossKey) return null;
  let posGross = 0;
  let feesNonCash = 0;
  let cashTotal = 0;
  let cashRows = 0;
  let cardRows = 0;
  let rowCount = 0;

  let refundsFromNegativeGross = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const g = numCell(row[map.grossKey]);
    if (g == null) continue;
    rowCount += 1;
    const absG = Math.abs(g);
    if (g < -EPS) {
      refundsFromNegativeGross += absG;
      continue;
    }
    if (!(g > EPS)) continue;

    posGross += g;

    let cash = false;
    if (map.tenderKey) {
      cash = tenderCellLooksCash(row[map.tenderKey]);
    }

    const feeRaw = map.feeKey ? numCell(row[map.feeKey]) : null;
    const fee = feeRaw != null && feeRaw >= 0 ? feeRaw : 0;

    if (cash) {
      cashTotal += g;
      cashRows += 1;
    } else {
      cardRows += 1;
      feesNonCash += fee;
    }
  }

  let refundsFromColumn = 0;
  if (map.refundKey) {
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const r = numCell(row[map.refundKey]);
      if (r != null && Math.abs(r) > EPS) refundsFromColumn += Math.abs(r);
    }
  }
  // Same refunds often appear as a dedicated column **or** negative gross rows — do not sum both.
  const refundsResolved = Math.round(
    (map.refundKey ? Math.max(refundsFromColumn, refundsFromNegativeGross) : refundsFromNegativeGross) * 100,
  ) / 100;

  const netSales = Math.round((posGross - refundsResolved) * 100) / 100;
  const netPayout = Math.round((posGross - feesNonCash) * 100) / 100;

  return {
    rowCount,
    posGrossOrders: Math.round(posGross * 100) / 100,
    refundsReturns: Math.round(refundsResolved * 100) / 100,
    netSales,
    feesNonCash: Math.round(feesNonCash * 100) / 100,
    netPayoutOrders: netPayout,
    cashTotal: Math.round(cashTotal * 100) / 100,
    cashRowCount: cashRows,
    cardRowCount: cardRows,
    mapping: {
      gross: map.grossKey,
      refund: map.refundKey,
      fee: map.feeKey,
      tender: map.tenderKey,
      net: map.netKey,
      orderId: map.orderIdKey,
    },
  };
}

/**
 * Semantic POS rollup from transaction-like row objects (headers = keys).
 * @param {object|null|undefined} parsedData
 * @returns {null | object}
 */
export function buildPosSemanticOrderRollup(parsedData) {
  const rows = pickPosRowsForSemanticRollup(parsedData);
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const keys = collectKeys(rows, 100);
  if (keys.length < 2) return null;
  const map = inferMapping(rows, keys, parsedData);
  if (!map) return null;
  const roll = rollupRows(rows, map);
  if (!roll || !(roll.posGrossOrders > EPS) || roll.rowCount < 2) return null;
  return {
    ...roll,
    source: 'pos_transaction_semantic_headers',
    note:
      'Columns chosen by header text + amount patterns (not fixed English labels). Applies to line tables from tabular files and to grids embedded under raw_extracted / extracted (e.g. PDF or image parses). Cash rows use tender/method hints; fees summed only on non-cash rows.',
    mappingConfidence: map.mappingConfidence,
  };
}

/**
 * Whether the semantic POS rollup is trustworthy for line-level analytics (vs headline totals only).
 * @param {object|null|undefined} parsedData
 * @returns {{ hasRollup: boolean, weakMapping: boolean, cardMixUnverified: boolean, reasons: string[], mappingConfidence?: object }}
 */
export function describePosSemanticRollupQuality(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') {
    return { hasRollup: false, weakMapping: false, cardMixUnverified: false, reasons: [] };
  }
  const roll = buildPosSemanticOrderRollup(parsedData);
  if (!roll?.mappingConfidence) {
    return { hasRollup: false, weakMapping: false, cardMixUnverified: false, reasons: [] };
  }
  const c = roll.mappingConfidence;
  const reasons = [];
  let weakMapping = false;
  if (c.grossScore < 2.5) {
    weakMapping = true;
    reasons.push('low_gross_header_confidence');
  }
  if (!c.feeMapped && c.feeHintMax < 2.25 && roll.cardRowCount >= 8 && roll.feesNonCash < EPS) {
    weakMapping = true;
    reasons.push('fee_column_unmapped_or_zero_fees');
  }
  const parserMix = Array.isArray(parsedData.card_brand_mix) && parsedData.card_brand_mix.length > 0;
  const volMix = buildPosOrderLineTenderVolumeMix(parsedData, null);
  const cardMixUnverified =
    roll.cardRowCount >= 8 && !parserMix && volMix == null && (!c.tenderMapped || c.tenderHintMax < 2);
  if (cardMixUnverified) reasons.push('card_or_tender_lines_unverified');

  return {
    hasRollup: true,
    weakMapping,
    cardMixUnverified,
    reasons,
    mappingConfidence: c,
  };
}

/** Prefer parser / export keys that carry card or tender text (when semantic tender column is missing). */
const STRUCTURED_TENDER_KEYS = [
  'card_brand',
  'network',
  'scheme',
  'card_scheme',
  'issuer',
  'card_type',
  'tender_type',
  'payment_method',
  'payment_brand',
  'instrument',
  'funding',
  'wallet',
  'payment type',
  'pay_type',
  'tender',
];

const PAYMENT_OR_CARD_BRAND_LIKE =
  /\b(visa|mastercard|master\s*card|\bmc\b|amex|american\s*express|discover|diners|jcb|union\s*pay|unionpay|maestro|interac|eftpos|rupay|elo|deb[ií]t|cr[eé]dit|prepaid|contactless|apple\s*pay|google\s*pay|samsung\s*pay|paypal|ach|card\s*present|cnp|card\s*not\s*present)\b/i;

/** Cell text that is a fee / pass-through label, not a card or tender type (was grouped into “mix” when tender column was wrong). */
const TENDER_VALUE_FEE_LIKE =
  /\b(interchange|scheme\s*fee|assessment|acquirer|passthrough|pass\s*through|merchant\s*discount|processing\s*fee|ic\s*\+|ic\+|bps|basis\s*points)\b/i;

const MENU_OR_PRODUCT_LINE_HEURISTIC =
  /\b(cake|croissant|muffin|latte|espresso|coffee|sandwich|salad|cookie|bread|item|sku|qty|quantity|unit\s*price|subtotal|grand\s*total)\b/i;

function tenderValueLooksLikePlainMoney(raw) {
  const s = String(raw ?? '').trim();
  if (!s || /[a-z]{2,}/i.test(s.replace(/\b(usd|cad|eur|gbp|aud|inr)\b/gi, ''))) return false;
  return /^[$€£¥]?\s*[\d,]+(?:\.\d{1,4})?\s*[$€£¥]?$/i.test(s.replace(/\s/g, ''));
}

function tenderValueLooksFeeLike(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  if (TENDER_VALUE_FEE_LIKE.test(s)) return true;
  const n = normalizeHeaderText(s);
  if (TENDER_VALUE_FEE_LIKE.test(n)) return true;
  if (tenderValueLooksLikePlainMoney(s)) return true;
  return false;
}

function readPosRowTenderLabel(row, tenderKey) {
  if (!row || typeof row !== 'object') return { raw: '', fromPrimaryTender: false };
  if (tenderKey) {
    const v = row[tenderKey];
    if (v != null && String(v).trim() !== '') {
      return { raw: String(v).trim(), fromPrimaryTender: true };
    }
  }
  for (const k of STRUCTURED_TENDER_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(row, k)) continue;
    const v = row[k];
    if (v == null || v === '') continue;
    const s = String(v).trim();
    if (s) return { raw: s, fromPrimaryTender: false };
  }
  return { raw: '', fromPrimaryTender: false };
}

function tenderLabelAcceptableForMix(raw, fromPrimaryTender) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 56) return false;
  if (MENU_OR_PRODUCT_LINE_HEURISTIC.test(s)) return false;
  if (tenderValueLooksFeeLike(s)) return false;
  if (PAYMENT_OR_CARD_BRAND_LIKE.test(s) || /^[A-Z0-9]{2,8}$/.test(s)) return true;
  if (fromPrimaryTender) {
    if (/^(debit|credit|prepaid|commercial|consumer)\b/i.test(s) && s.length <= 28) return true;
    if (/\b(in[- ]?person|card\s*present|not\s*present|keyed|mail\s*order|phone|ecommerce|e[\s-]?commerce)\b/i.test(s) && s.length <= 36)
      return true;
    return false;
  }
  return false;
}

/**
 * Gross volume by tender / card **slug** on **POS transaction line** objects (same pick + header inference as semantic rollup).
 * Used on the Channel tab when `card_brand_mix` is missing but order rows name Visa / MC / Cash / etc.
 *
 * @param {object|null|undefined} parsedData
 * @param {Record<string, string> | null | undefined} [slugDisplayMap] `parsedData.channel_card_display_slug_map` for stable labels across statements
 * @returns {null | { rows: { key: string, slug: string, sourceLabel: string, label: string, volume: number }[], totalVolume: number, tenderColumn: string | null, source: string }}
 */
export function buildPosOrderLineTenderVolumeMix(parsedData, slugDisplayMap = null) {
  const rows = pickPosRowsForSemanticRollup(parsedData);
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const keys = collectKeys(rows, 100);
  if (keys.length < 2) return null;
  const map = inferMapping(rows, keys, parsedData);
  if (!map) return null;

  const sm =
    slugDisplayMap && typeof slugDisplayMap === 'object' && !Array.isArray(slugDisplayMap) ? slugDisplayMap : {};

  /** @type {Map<string, { sourceLabel: string, volume: number }>} */
  const bySlug = new Map();
  let unknownNonCash = 0;

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const g = numCell(row[map.grossKey]);
    if (g == null || g < -EPS) continue;
    if (!(g > EPS)) continue;

    const { raw, fromPrimaryTender } = readPosRowTenderLabel(row, map.tenderKey);
    const cash = raw ? tenderCellLooksCash(raw) : false;
    if (cash) {
      const slug = 'cash';
      const sourceLabel = 'Cash';
      const rounded = Math.round(g * 100) / 100;
      const prev = bySlug.get(slug);
      if (prev) bySlug.set(slug, { sourceLabel, volume: Math.round((prev.volume + rounded) * 100) / 100 });
      else bySlug.set(slug, { sourceLabel, volume: rounded });
      continue;
    }

    if (!tenderLabelAcceptableForMix(raw, fromPrimaryTender)) {
      unknownNonCash += g;
      continue;
    }

    const slug = slugifyCardOrKey(raw) || 'unknown-tender';
    const sourceLabel = raw.length <= 56 ? raw : `${raw.slice(0, 53)}…`;
    const rounded = Math.round(g * 100) / 100;
    const prev = bySlug.get(slug);
    if (prev) {
      bySlug.set(slug, {
        sourceLabel: prev.sourceLabel || sourceLabel,
        volume: Math.round((prev.volume + rounded) * 100) / 100,
      });
    } else {
      bySlug.set(slug, { sourceLabel, volume: rounded });
    }
  }

  if (unknownNonCash > EPS) {
    const rounded = Math.round(unknownNonCash * 100) / 100;
    const slug = 'other-unknown-tender';
    const sourceLabel = 'Other (no card / tender on line)';
    const prev = bySlug.get(slug);
    if (prev) bySlug.set(slug, { sourceLabel, volume: Math.round((prev.volume + rounded) * 100) / 100 });
    else bySlug.set(slug, { sourceLabel, volume: rounded });
  }

  const outRows = [];
  let totalVolume = 0;
  for (const [slug, { sourceLabel, volume }] of bySlug) {
    if (!(volume > EPS)) continue;
    const label = displayLabelForCardSlug(slug, sourceLabel, sm);
    outRows.push({
      key: slug,
      slug,
      sourceLabel,
      label,
      volume,
    });
    totalVolume += volume;
  }

  if (outRows.length < 2 || !(totalVolume > EPS)) return null;

  return {
    rows: outRows.sort((a, b) => b.volume - a.volume),
    totalVolume: Math.round(totalVolume * 100) / 100,
    tenderColumn: map.tenderKey,
    source: 'pos_order_line_tender',
  };
}

export { normalizeStatementHeader, normalizeHeaderText } from './statementHeaderNormalize.js';
