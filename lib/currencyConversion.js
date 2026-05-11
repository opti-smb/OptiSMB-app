/**
 * Statement money: **no cross-currency conversion**. Amounts stay as parsed.
 *
 * This module formats numbers and repairs nested parser fields. **Which ISO code to show**
 * is centralized in `./statementCurrency.js` (`getStatementDisplayCurrency`, `detectStatementCurrency`).
 * Channel/reconciliation heuristics use named constants below (tune with product, not scattered literals).
 */

import {
  resolveStatementCurrency,
  getStatementDisplayCurrency,
  inferStatementCurrencyFromParsed,
  detectStatementCurrency,
  isPlaceholderWireCurrency,
} from './statementCurrency.js';
import { pickBankLedgerRowCreditAmount } from './bankLedgerRowCredit.js';
import { effectiveRatePercentFromTotals } from './financialAnalysisFormulas.js';
import { getStatementHeuristics } from './statementHeuristics.js';
import { ensureDerivedReconciliationVarianceField } from './reconciliationVarianceDerived.js';

// Re-export statement-currency helpers here so callers can import format/repair + ISO logic from one module.
export {
  resolveStatementCurrency,
  getStatementDisplayCurrency,
  inferStatementCurrencyFromParsed,
  detectStatementCurrency,
  isPlaceholderWireCurrency,
};

/** Sub-cent floor: treat channel net/volume as present (floating noise). */
const CHANNEL_AMOUNT_EPS = 0.005;

/** Same idea as `linkedOrGoldenRollup` in utils (avoid importing utils ↔ circular). */
function linkedOrGoldenRollupLocal(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  if (parsed.golden_reconciliation_workbook) return true;
  const b = parsed.linked_statement_bundle;
  if (b && typeof b === 'object' && !Array.isArray(b)) return true;
  if (/^combined\b/i.test(String(parsed.fileName ?? '').trim())) return true;
  const sh = parsed.report_ui?.structure_headline;
  if (typeof sh === 'string') {
    const parts = sh
      .split(/\s*[·•]\s*/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (parts.length >= 4) return true;
  }
  return false;
}

/** POS channel display volume for linked/golden: same priority as `channelRollupVolume` (no utils import). */
function linkedPosStatementDisplayVolume(row, parsed) {
  if (!row || typeof row !== 'object') return 0;
  if (!linkedOrGoldenRollupLocal(parsed)) {
    const v = Number(row.volume ?? row.gross_volume ?? row.gross_sales);
    return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : 0;
  }
  const sgv = Number(row.statement_gross_volume);
  if (Number.isFinite(sgv) && sgv > CHANNEL_AMOUNT_EPS) return Math.round(sgv * 100) / 100;
  const gv = Number(row.gross_volume ?? row.gross_sales);
  if (Number.isFinite(gv) && gv > CHANNEL_AMOUNT_EPS) return Math.round(gv * 100) / 100;
  if (parsed?.golden_reconciliation_workbook) {
    const v = Number(row.volume ?? row.gross_volume);
    return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : 0;
  }
  const vol = Number(row.volume);
  return Number.isFinite(vol) && vol >= 0 ? Math.round(vol * 100) / 100 : 0;
}

/**
 * When `volume` still reflects a merged POS/e‑com export but `gross_volume` matches the reconciliation workbook,
 * align `volume` to explicit gross so Channel tab, KPI sum, and bank comparison tables agree.
 */
function repairChannelSplitVolumeAgainstExplicitGross(parsed) {
  if (!parsed?.channel_split || typeof parsed.channel_split !== 'object') return parsed;
  if (!linkedOrGoldenRollupLocal(parsed)) return parsed;
  const cs = { ...parsed.channel_split };
  let touched = false;
  for (const key of Object.keys(cs)) {
    const row = cs[key];
    if (!row || typeof row !== 'object') continue;
    const gv = Number(row.gross_volume ?? row.gross_sales);
    const vol = Number(row.volume);
    if (!Number.isFinite(gv) || !(gv > CHANNEL_AMOUNT_EPS)) continue;
    if (!Number.isFinite(vol)) continue;
    if (Math.abs(vol - gv) <= 0.5) continue;
    const g = Math.round(gv * 100) / 100;
    cs[key] = { ...row, volume: g, gross_volume: g };
    touched = true;
  }
  if (!touched) return parsed;
  const out = { ...parsed, channel_split: cs };
  const hintPd = { ...parsed, channel_split: cs };
  if (cs.pos && typeof cs.pos === 'object') {
    const pv = linkedPosStatementDisplayVolume(cs.pos, hintPd);
    if (pv > CHANNEL_AMOUNT_EPS) out.pos_volume = pv;
  }
  if (cs.cnp && typeof cs.cnp === 'object') {
    const ev = linkedPosStatementDisplayVolume(cs.cnp, hintPd);
    if (ev > CHANNEL_AMOUNT_EPS) out.ecomm_volume = ev;
  }
  return out;
}

/**
 * Linked merge sometimes leaves `channel_split.pos.volume` as **gross + refunds** while refunds are also on the row
 * (or only at file level). When implied POS gross **volume − refunds** makes Σ channels match `total_transaction_volume`,
 * rewrite POS `volume` / `gross_volume` (same rule as Channel tab display — cannot import `utils` here).
 */
function _channelRowPrimaryVol(row) {
  if (!row || typeof row !== 'object') return 0;
  for (const k of ['volume', 'gross_volume', 'net_settled_volume']) {
    const n = Number(row[k]);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

function _inferPosRefundFinalize(parsed, posRow) {
  let rf = Math.abs(Number(posRow?.refund_volume ?? posRow?.refunds) || 0);
  if (rf > CHANNEL_AMOUNT_EPS) return Math.round(rf * 100) / 100;
  if (!parsed || typeof parsed !== 'object') return 0;
  const candidates = [
    parsed.refund_volume,
    parsed.total_refunds,
    parsed.refund_total,
    parsed.refunds_total,
    parsed.pos_refund_volume,
    parsed.pos_refunds,
    parsed.total_return_volume,
    parsed.raw_extracted?.refund_volume,
    parsed.raw_extracted_preview?.refund_volume,
    parsed.extracted?.refund_volume,
  ];
  let fileTot = 0;
  for (const x of candidates) {
    const v = Math.abs(Number(x));
    if (Number.isFinite(v) && v > fileTot) fileTot = v;
  }
  fileTot = Math.round(fileTot * 100) / 100;
  if (!(fileTot > CHANNEL_AMOUNT_EPS)) return 0;
  const cs = parsed.channel_split;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) return fileTot;
  const posG = _channelRowPrimaryVol(posRow);
  let cnpG = 0;
  for (const key of ['cnp', 'ecommerce', 'ecomm', 'online', 'web', 'digital']) {
    const r = cs[key];
    if (r && typeof r === 'object') {
      cnpG = _channelRowPrimaryVol(r);
      break;
    }
  }
  if (!(cnpG > 500)) return fileTot;
  const denom = posG + cnpG;
  if (!(denom > CHANNEL_AMOUNT_EPS)) return fileTot;
  const share = posG / denom;
  return Math.round(fileTot * share * 100) / 100;
}

/** Declared `total_transaction_volume` anchor for linked finalize (matches utils reconcile headline logic). */
function gtvAnchorForLinkedFinalize(parsed) {
  const declared = Number(parsed.total_transaction_volume);
  if (!Number.isFinite(declared) || !(declared > CHANNEL_AMOUNT_EPS)) return null;
  return declared;
}

function _linkedPosImpliedGrossForFinalize(parsed) {
  if (!linkedOrGoldenRollupLocal(parsed)) return null;
  const cs = parsed.channel_split;
  const posRow = cs?.pos;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs) || !posRow || typeof posRow !== 'object') return null;

  const gvExplicit = Number(posRow.gross_sales ?? posRow.gross_volume);
  const vol = _channelRowPrimaryVol(posRow);
  if (Number.isFinite(gvExplicit) && gvExplicit > CHANNEL_AMOUNT_EPS && Math.abs(gvExplicit - vol) > 0.5) {
    return null;
  }

  const rf = _inferPosRefundFinalize(parsed, posRow);
  if (!(vol > CHANNEL_AMOUNT_EPS) || !(rf > CHANNEL_AMOUNT_EPS)) return null;
  const implied = Math.round((vol - rf) * 100) / 100;
  if (!(implied > CHANNEL_AMOUNT_EPS)) return null;

  let sumOthers = 0;
  for (const key of Object.keys(cs)) {
    if (key === 'pos') continue;
    const row = cs[key];
    if (!row || typeof row !== 'object') continue;
    sumOthers += _channelRowPrimaryVol(row);
  }

  const sumRaw = vol + sumOthers;
  const sumImplied = implied + sumOthers;
  const gtv = gtvAnchorForLinkedFinalize(parsed);
  if (gtv == null || !(gtv > CHANNEL_AMOUNT_EPS)) return null;
  const tol = Math.max(2, 0.0005 * Math.max(gtv, sumRaw, 1));
  if (Math.abs(sumImplied - gtv) <= tol && Math.abs(sumRaw - gtv) > tol) return implied;
  return null;
}

function repairLinkedPosVolumeFromTrustedTotal(parsed) {
  const implied = _linkedPosImpliedGrossForFinalize(parsed);
  if (implied == null) return parsed;
  const cs = parsed.channel_split;
  const posRow = cs.pos;
  const prePrimary = _channelRowPrimaryVol(posRow);
  const existingStmt = Number(posRow.statement_gross_volume);
  const existingStmtOk = Number.isFinite(existingStmt) && existingStmt > CHANNEL_AMOUNT_EPS ? existingStmt : 0;
  const statementGross = Math.max(existingStmtOk, prePrimary);
  const keepStmt =
    statementGross > implied + CHANNEL_AMOUNT_EPS
      ? { statement_gross_volume: Math.round(statementGross * 100) / 100 }
      : {};
  const g = implied;
  const nextPos = { ...posRow, volume: g, gross_volume: g, ...keepStmt };
  const pvOut = linkedPosStatementDisplayVolume(nextPos, { ...parsed, channel_split: { ...cs, pos: nextPos } });
  return {
    ...parsed,
    channel_split: { ...cs, pos: nextPos },
    ...(pvOut > CHANNEL_AMOUNT_EPS ? { pos_volume: pvOut } : {}),
  };
}

/** Cash / API deposit volumes above this are treated as real. */
const API_VOLUME_FLOOR = 0.01;

/** If existing split covers this fraction of GTV, skip rebuilding `channel_split`. */
const CHANNEL_SPLIT_ALREADY_COVER_FRAC = 0.98;

/** Max relative drift for pos + ecomm (+ cash) vs GTV when inferring split. */
const CHANNEL_SPLIT_DRIFT_MAX = 0.08;

/** Inferred posNet + cnpNet must match `net_revenue` within max(minAbs, rel * |net|). */
const NET_REV_MATCH_MIN_ABS = 1.5;
const NET_REV_MATCH_REL = 0.003;

/** INR uses Indian grouping; other ISO codes use en-US until per-currency locales are added. */
function _moneyNumberFormatLocale(ccy) {
  return ccy === 'INR' ? 'en-IN' : 'en-US';
}

/** Old localStorage saves: marked USD but carried INR provenance + fx metadata. */
function _legacyUsdFromInrPayload(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  return (
    String(parsed.currency || '').toUpperCase() === 'USD' &&
    String(parsed.original_currency || '').toUpperCase() === 'INR' &&
    parsed.fx_inr_per_usd != null
  );
}

/** Full-format money in the statement ISO currency (e.g. ₹, $, €). */
export function formatMoney(amount, currency = 'USD') {
  if (amount == null || Number.isNaN(Number(amount))) return '—';
  const ccy = resolveStatementCurrency(currency);
  try {
    return new Intl.NumberFormat(_moneyNumberFormatLocale(ccy), {
      style: 'currency',
      currency: ccy,
    }).format(Number(amount));
  } catch {
    return `${Number(amount).toLocaleString()} ${ccy}`;
  }
}

/**
 * Short currency label for charts (compact notation; locale matches currency where useful).
 */
export function formatCompactMoney(amount, currency = 'USD') {
  const v = Number(amount);
  if (amount == null || Number.isNaN(v)) return '—';
  const ccy = resolveStatementCurrency(currency);
  try {
    return new Intl.NumberFormat(_moneyNumberFormatLocale(ccy), {
      style: 'currency',
      currency: ccy,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(v);
  } catch {
    return formatMoney(v, ccy);
  }
}

/**
 * Card mix row: pick the volume number that matches the statement currency.
 * Parser stores scheme volumes in `volume_inr` for INR files; USD mocks use `volume_usd`.
 */
function _numVol(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Card mix row: pick the volume field that matches **display** currency so INR amounts are not shown with a $ symbol.
 * Parser uses `volume_inr` for rupee statements; mocks may use `volume_usd`.
 */
export function cardMixRowVolume(row, parsed) {
  if (!row || typeof row !== 'object') return null;
  if (_legacyUsdFromInrPayload(parsed)) {
    const u = _numVol(row.volume_usd);
    const ir = _numVol(row.volume_inr);
    if (u != null) return u;
    if (ir != null) return ir;
    return null;
  }
  const ccy = getStatementDisplayCurrency(parsed);
  const inr = _numVol(row.volume_inr);
  const usd = _numVol(row.volume_usd);
  if (ccy === 'INR') {
    if (inr != null) return inr;
    if (usd != null) return usd;
  }
  if (ccy === 'USD') {
    if (usd != null) return usd;
    if (inr != null) return inr;
  }
  if (inr != null) return inr;
  if (usd != null) return usd;
  const pct = Number(row.share_volume_pct);
  const gv = Number(parsed?.total_transaction_volume);
  if (pct > 0 && gv > 0 && !Number.isNaN(pct) && !Number.isNaN(gv)) {
    return Math.round((pct / 100) * gv * 100) / 100;
  }
  return null;
}

/**
 * Promote `card_brand_mix` from `raw_extracted_preview` when the top-level array was dropped (older saves).
 */
export function repairParsedCardBrandMix(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  if (Array.isArray(parsed.card_brand_mix) && parsed.card_brand_mix.length) return parsed;
  const alt =
    parsed.raw_extracted_preview?.card_brand_mix || parsed.raw_extracted?.card_brand_mix;
  if (!Array.isArray(alt) || !alt.length) return parsed;
  return { ...parsed, card_brand_mix: alt };
}

/** Fix placeholder currencies and mis-tagged USD on Indian / multi-currency statements. */
export function repairParsedDisplayCurrency(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const fixed = getStatementDisplayCurrency(parsed);
  const wire = parsed.display_currency ?? parsed.statement_currency ?? parsed.currency;
  const before = isPlaceholderWireCurrency(wire) ? null : resolveStatementCurrency(wire);
  if (before === fixed) return parsed;
  return { ...parsed, currency: fixed, display_currency: fixed };
}

function _positiveTxnInt(n) {
  if (n == null || n === '') return null;
  const x = Math.round(Number(n));
  return Number.isFinite(x) && x > 0 ? x : null;
}

/** Same rules as e‑commerce commission helpers: skip totals / summary rows when counting order lines. */
function _isEcommerceSummaryOrderIdForTxnCount(id) {
  const s = String(id ?? '').trim().toLowerCase();
  if (!s) return true;
  if (/^(total|totals|grand\s*total|subtotal|summary|net\s*total|gross\s*total)$/i.test(s)) return true;
  if (/^total[\s_-]/i.test(s)) return true;
  return false;
}

function _pickEcommerceOrderIdForTxnCount(row) {
  if (!row || typeof row !== 'object') return '';
  const v =
    row.order_id ??
    row.orderId ??
    row.transaction_id ??
    row.order_number ??
    row.order_no ??
    row.id;
  if (v == null || v === '') return '';
  return String(v).trim();
}

/** Count non-summary order rows (best populated list). */
function _countEcommerceOrderLines(parsed) {
  if (!parsed || typeof parsed !== 'object') return 0;
  const lists = [
    parsed.ecomm_settlement_orders,
    parsed.ecommerce_settlement_orders,
    parsed.shopify_orders,
    parsed.ecomm_orders,
    parsed.ecommerce_orders,
    parsed.raw_extracted?.ecomm_settlement_orders,
    parsed.raw_extracted?.ecommerce_orders,
    parsed.extracted?.ecomm_settlement_orders,
    parsed.extracted?.ecommerce_orders,
  ];
  let best = 0;
  for (const L of lists) {
    if (!Array.isArray(L) || !L.length) continue;
    let c = 0;
    for (const row of L) {
      if (!row || typeof row !== 'object') continue;
      const id = _pickEcommerceOrderIdForTxnCount(row);
      if (!id || _isEcommerceSummaryOrderIdForTxnCount(id)) continue;
      c += 1;
    }
    if (c > best) best = c;
  }
  return best;
}

/** Longest POS payment / card line list on the parse (same slots augmenters use). */
function _countPosTransactionLines(parsed) {
  if (!parsed || typeof parsed !== 'object') return 0;
  const lists = [
    parsed.pos_transactions,
    parsed.pos_transaction_details,
    parsed.pos_settlement_transactions,
    parsed.card_present_transactions,
    parsed.in_store_transactions,
    parsed.batch_transactions,
    parsed.transactions,
    parsed.raw_extracted?.pos_transactions,
    parsed.raw_extracted?.pos_transaction_details,
    parsed.raw_extracted?.transactions,
    parsed.raw_extracted_preview?.pos_transactions,
    parsed.raw_extracted_preview?.pos_transaction_details,
    parsed.raw_extracted_preview?.transactions,
    parsed.extracted?.pos_transactions,
    parsed.extracted?.pos_transaction_details,
    parsed.extracted?.transactions,
  ];
  let n = 0;
  for (const L of lists) {
    if (Array.isArray(L) && L.length > n) n = L.length;
  }
  return n;
}

function _maxPosSettlementBatchTableRows(parsed) {
  if (!parsed || typeof parsed !== 'object') return 0;
  let n = 0;
  for (const L of [
    parsed.pos_settlement_batches,
    parsed.pos_batches,
    parsed.raw_extracted?.pos_settlement_batches,
    parsed.raw_extracted?.pos_batches,
    parsed.raw_extracted_preview?.pos_settlement_batches,
    parsed.raw_extracted_preview?.pos_batches,
    parsed.extracted?.pos_settlement_batches,
    parsed.extracted?.pos_batches,
  ]) {
    if (Array.isArray(L) && L.length > n) n = L.length;
  }
  return n;
}

/** Prefer payment-line count; if none, use settlement batch row count so the Channel tab is never blank. */
function _inferPosTxnCountHint(parsed) {
  const lines = _countPosTransactionLines(parsed);
  const batches = _maxPosSettlementBatchTableRows(parsed);
  if (lines > 0) return lines;
  if (batches > 0) return batches;
  return 0;
}

function _channelSplitKeyIsEcom(key, row) {
  const k = String(key ?? '')
    .toLowerCase()
    .replace(/\s+/g, '');
  if (/^(cnp|ecomm|ecommerce|online|web|digital|remote)$/.test(k)) return true;
  const lab = String(row?.channel_label ?? row?.label ?? row?.name ?? '').toLowerCase();
  if (/\b(online|e-?commerce|cnp|card\s*not\s*present|web\s*sales)\b/i.test(lab)) return true;
  return false;
}

/**
 * When `channel_split.*.txn_count` is missing, infer from POS line exports / batch tables and from
 * e‑commerce order grids, then set `avg_txn` ≈ volume ÷ count (same basis as the Channel tab volume column).
 */
function inferChannelTxnMetricsFromGrids(parsed) {
  if (!parsed?.channel_split || typeof parsed.channel_split !== 'object' || Array.isArray(parsed.channel_split)) {
    return parsed;
  }
  const cs = parsed.channel_split;
  let changed = false;
  const next = { ...cs };

  const denomForAvg = (row) => {
    const v = Number(row?.volume);
    if (v > CHANNEL_AMOUNT_EPS) return v;
    const g = Number(row?.gross_volume);
    if (g > CHANNEL_AMOUNT_EPS) return g;
    const n = Number(row?.net_settled_volume);
    return n > CHANNEL_AMOUNT_EPS ? n : 0;
  };

  for (const key of Object.keys(cs)) {
    const row = cs[key];
    if (!row || typeof row !== 'object') {
      next[key] = row;
      continue;
    }
    if (String(key).toLowerCase() === 'cash') {
      next[key] = row;
      continue;
    }

    const nextRow = { ...row };
    const d = denomForAvg(nextRow);
    const isEcom = _channelSplitKeyIsEcom(key, row);
    const hintRaw = isEcom ? _countEcommerceOrderLines(parsed) : _inferPosTxnCountHint(parsed);
    const inferred = _positiveTxnInt(hintRaw);

    if (!_positiveTxnInt(nextRow.txn_count) && inferred) {
      nextRow.txn_count = inferred;
      changed = true;
    }
    const cnt = _positiveTxnInt(nextRow.txn_count);
    if (cnt && d > CHANNEL_AMOUNT_EPS) {
      const a = Math.round((d / cnt) * 100) / 100;
      if (nextRow.avg_txn !== a) {
        nextRow.avg_txn = a;
        changed = true;
      }
    }
    next[key] = nextRow;
  }
  const base = changed ? { ...parsed, channel_split: next } : parsed;
  const linkedPatched = applyLinkedBundlePosTxnInference(base);
  if (linkedPatched !== base) return linkedPatched;
  return changed ? base : parsed;
}

/**
 * When every `pos_settlement_batches` row has a transaction count (e.g. Square Daily Summary), use the
 * sum as `channel_split.pos.txn_count` so the Channel tab matches processor exports (not line-list guesses).
 */
function inferPosTxnCountFromPosSettlementBatches(parsed) {
  if (!parsed?.channel_split?.pos || !Array.isArray(parsed.pos_settlement_batches) || !parsed.pos_settlement_batches.length) {
    return parsed;
  }
  const batches = parsed.pos_settlement_batches.filter((b) => b && typeof b === 'object');
  if (!batches.length) return parsed;
  let sum = 0;
  for (const b of batches) {
    const n = Math.round(Number(b.transaction_count ?? b.txn_count ?? b.transactions));
    if (!Number.isFinite(n) || n < 1 || n > 1e9) return parsed;
    sum += n;
  }
  if (!(sum >= 1)) return parsed;
  const cs = parsed.channel_split;
  const pos = { ...cs.pos, txn_count: sum };
  const vol = Number(pos.volume) || Number(pos.gross_volume) || Number(pos.gross_sales);
  if (vol > CHANNEL_AMOUNT_EPS) {
    pos.avg_txn = Math.round((vol / sum) * 100) / 100;
  }
  return { ...parsed, channel_split: { ...cs, pos } };
}

/**
 * Linked POS + e‑commerce + bank merge often drops per-channel txn fields while `total_transactions`
 * (or volume share of it) still describes the combined statement — infer missing POS txn_count + avg_txn.
 */
export function applyLinkedBundlePosTxnInference(parsed) {
  const bundle = parsed?.linked_statement_bundle;
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return parsed;
  const cs = parsed.channel_split;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs) || !cs.pos || !cs.cnp) return parsed;
  const pos = { ...cs.pos };
  const cnp = { ...cs.cnp };
  if (_positiveTxnInt(pos.txn_count)) return parsed;

  const volP = Number(pos.volume || pos.gross_volume || pos.gross_sales) || 0;
  const volC = Number(cnp.volume || cnp.gross_volume || cnp.gross_sales) || 0;
  if (!(volP > CHANNEL_AMOUNT_EPS)) return parsed;

  const E = _positiveTxnInt(cnp.txn_count) ?? _positiveTxnInt(parsed.ecomm_transaction_count);
  const T = _positiveTxnInt(parsed.total_transactions);
  const Pscalar = _positiveTxnInt(parsed.pos_transaction_count);

  let posN = Pscalar;
  if (!_positiveTxnInt(posN) && T && E && T > E) {
    const diff = T - E;
    if (_positiveTxnInt(diff)) {
      const avgTry = volP / diff;
      if (avgTry >= 4 && avgTry <= 5000) posN = diff;
    }
  }
  if (!_positiveTxnInt(posN) && T && volC > CHANNEL_AMOUNT_EPS) {
    const share = Math.max(1, Math.round(T * (volP / (volP + volC))));
    if (_positiveTxnInt(share)) {
      const avgTry = volP / share;
      if (!(avgTry >= 4 && avgTry <= 5000)) {
        /* skip */
      } else if (E) {
        const err = Math.abs(share + E - T);
        if (err <= Math.max(3, 0.04 * T)) posN = share;
      } else {
        posN = share;
      }
    }
  }

  if (!_positiveTxnInt(posN)) return parsed;
  const impliedAvg = volP / posN;
  if (!(impliedAvg >= 4 && impliedAvg <= 5000)) return parsed;
  const avg = Math.round(impliedAvg * 100) / 100;
  return {
    ...parsed,
    channel_split: {
      ...cs,
      pos: { ...pos, txn_count: posN, avg_txn: avg },
    },
  };
}

/**
 * After POS/CNP net-to-bank amounts exist, fill missing txn_count from top-level parser fields
 * and align avg_txn to gross volume ÷ count (same basis as `volume` / fees ÷ volume on the Channel tab).
 * Falls back to net ÷ count only when no gross-like volume is present on the row.
 */
function applyTxnAvgAfterNet(parsed) {
  if (!parsed?.channel_split?.pos || !parsed.channel_split?.cnp) return parsed;
  const cs = parsed.channel_split;
  const pos = { ...cs.pos };
  const cnp = { ...cs.cnp };
  const posN = Number(pos.net_settled_volume);
  const cnpN = Number(cnp.net_settled_volume);
  const volLike = (row) =>
    Number(row?.volume) > CHANNEL_AMOUNT_EPS ||
    Number(row?.gross_volume) > CHANNEL_AMOUNT_EPS ||
    Number(row?.net_settled_volume) > CHANNEL_AMOUNT_EPS;
  // Linked / PDF splits often have gross in `volume` but no per-channel net yet — still promote parser txn counts.
  if (!volLike(pos) && !volLike(cnp) && !(posN > CHANNEL_AMOUNT_EPS) && !(cnpN > CHANNEL_AMOUNT_EPS)) return parsed;

  const channelAvgDenom = (row) => {
    const v = Number(row.volume);
    if (v > CHANNEL_AMOUNT_EPS) return v;
    const g = Number(row.gross_volume);
    if (g > CHANNEL_AMOUNT_EPS) return g;
    const n = Number(row.net_settled_volume);
    return n > CHANNEL_AMOUNT_EPS ? n : 0;
  };

  const rawPrev =
    parsed.raw_extracted_preview && typeof parsed.raw_extracted_preview === 'object'
      ? parsed.raw_extracted_preview
      : parsed.raw_extracted && typeof parsed.raw_extracted === 'object'
        ? parsed.raw_extracted
        : null;

  let changed = false;
  const ptc =
    _positiveTxnInt(pos.txn_count) ??
    _positiveTxnInt(parsed.pos_transaction_count) ??
    (rawPrev ? _positiveTxnInt(rawPrev.pos_transaction_count) : null);
  const etc =
    _positiveTxnInt(cnp.txn_count) ??
    _positiveTxnInt(parsed.ecomm_transaction_count) ??
    (rawPrev ? _positiveTxnInt(rawPrev.ecomm_transaction_count) : null);
  if (ptc && !_positiveTxnInt(pos.txn_count)) {
    pos.txn_count = ptc;
    changed = true;
  }
  if (etc && !_positiveTxnInt(cnp.txn_count)) {
    cnp.txn_count = etc;
    changed = true;
  }
  const pUse = _positiveTxnInt(pos.txn_count);
  const eUse = _positiveTxnInt(cnp.txn_count);
  const posDenom = channelAvgDenom(pos);
  const cnpDenom = channelAvgDenom(cnp);
  if (pUse && posDenom > CHANNEL_AMOUNT_EPS) {
    const a = Math.round((posDenom / pUse) * 100) / 100;
    if (pos.avg_txn !== a) {
      pos.avg_txn = a;
      changed = true;
    }
  } else if (pUse && posN > CHANNEL_AMOUNT_EPS) {
    const a = Math.round((posN / pUse) * 100) / 100;
    if (pos.avg_txn !== a) {
      pos.avg_txn = a;
      changed = true;
    }
  }
  if (eUse && cnpDenom > CHANNEL_AMOUNT_EPS) {
    const a = Math.round((cnpDenom / eUse) * 100) / 100;
    if (cnp.avg_txn !== a) {
      cnp.avg_txn = a;
      changed = true;
    }
  } else if (eUse && cnpN > CHANNEL_AMOUNT_EPS) {
    const a = Math.round((cnpN / eUse) * 100) / 100;
    if (cnp.avg_txn !== a) {
      cnp.avg_txn = a;
      changed = true;
    }
  }
  return changed ? { ...parsed, channel_split: { ...cs, pos, cnp } } : parsed;
}

/**
 * Older parsed statements only had Section A gross in `channel_split.*.volume`. When the file
 * also implies net (API `pos_net_deposit_volume` / `ecomm_net_deposit_volume`, or channel gross −
 * channel fees ≈ `net_revenue`), attach `net_settled_volume` + `gross_volume` so the Channel tab
 * matches reconciliation Section B without re-upload.
 */
export function repairReconciliationChannelNet(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const cs = parsed.channel_split;
  if (!cs?.pos || !cs?.cnp) return parsed;

  const pos = { ...cs.pos };
  const cnp = { ...cs.cnp };
  const cashRow = cs.cash && typeof cs.cash === 'object' ? cs.cash : null;
  const cashG = Number(cashRow?.volume) || 0;
  const cashF = Math.abs(Number(cashRow?.fees) || 0);
  const cashNet = Math.round((cashG - cashF) * 100) / 100;

  if (
    Number(pos.net_settled_volume) > CHANNEL_AMOUNT_EPS ||
    Number(cnp.net_settled_volume) > CHANNEL_AMOUNT_EPS
  ) {
    return applyTxnAvgAfterNet(parsed);
  }

  const apiPosNet = Number(parsed.pos_net_deposit_volume);
  const apiEcommNet = Number(parsed.ecomm_net_deposit_volume);
  if (
    Number.isFinite(apiPosNet) &&
    apiPosNet > API_VOLUME_FLOOR &&
    Number.isFinite(apiEcommNet) &&
    apiEcommNet > API_VOLUME_FLOOR
  ) {
    const posG = Number(pos.volume) || 0;
    const cnpG = Number(cnp.volume) || 0;
    const next = {
      ...parsed,
      channel_split: {
        ...cs,
        pos: {
          ...pos,
          net_settled_volume: Math.round(apiPosNet * 100) / 100,
          gross_volume: posG > CHANNEL_AMOUNT_EPS ? Math.round(posG * 100) / 100 : posG,
        },
        cnp: {
          ...cnp,
          net_settled_volume: Math.round(apiEcommNet * 100) / 100,
          gross_volume: cnpG > CHANNEL_AMOUNT_EPS ? Math.round(cnpG * 100) / 100 : cnpG,
        },
      },
    };
    return applyTxnAvgAfterNet(next);
  }

  const posG = Number(pos.volume) || 0;
  const cnpG = Number(cnp.volume) || 0;
  const posF = Math.abs(Number(pos.fees) || 0);
  const cnpF = Math.abs(Number(cnp.fees) || 0);
  if (posG <= 0 || cnpG <= 0) return parsed;
  if (posF >= posG || cnpF >= cnpG) return parsed;

  let netRev = Number(parsed.net_revenue);
  if (!Number.isFinite(netRev)) {
    const gv = Number(parsed.total_transaction_volume);
    const tf = Number(parsed.total_fees_charged);
    if (Number.isFinite(gv) && Number.isFinite(tf) && gv > 0) netRev = gv - tf;
  }
  if (!Number.isFinite(netRev) || netRev <= 0) return parsed;

  const posNet = Math.round((posG - posF) * 100) / 100;
  const cnpNet = Math.round((cnpG - cnpF) * 100) / 100;
  const sum = posNet + cnpNet + (Number.isFinite(cashNet) ? cashNet : 0);
  const tol = Math.max(NET_REV_MATCH_MIN_ABS, NET_REV_MATCH_REL * Math.abs(netRev));
  if (Math.abs(sum - netRev) > tol) return parsed;

  const next = {
    ...parsed,
    channel_split: {
      ...cs,
      pos: {
        ...pos,
        net_settled_volume: posNet,
        gross_volume: Math.round(posG * 100) / 100,
      },
      cnp: {
        ...cnp,
        net_settled_volume: cnpNet,
        gross_volume: Math.round(cnpG * 100) / 100,
      },
    },
  };
  return applyTxnAvgAfterNet(next);
}

/**
 * Hydrate parsed payload (card mix promotion, channel split repair). Currency is unchanged.
 * Prefer {@link finalizeParsedForClient} from `./statementFinalize.js` so volume scalars match Channel tab.
 */
export function finalizeStatementRecord(stmt) {
  if (!stmt?.parsedData) return stmt;
  const nextPd = finalizeParsedForClientCore(stmt.parsedData);
  if (nextPd === stmt.parsedData) return stmt;
  return { ...stmt, parsedData: nextPd };
}

/**
 * When API includes `pos_volume` / `ecomm_volume` but `channel_split` is empty (older clients / PDF quirks),
 * rebuild POS vs online split for the Channel tab.
 */
function grossVolumeHintFromSplitRow(row) {
  if (!row || typeof row !== 'object') return 0;
  const sg = Number(row.statement_gross_volume);
  if (Number.isFinite(sg) && sg > 0.005) return sg;
  const g = Number(row.gross_volume ?? row.gross_sales);
  if (Number.isFinite(g) && g > 0.005) return g;
  return 0;
}

export function repairParsedChannelSplit(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const gv = Number(parsed.total_transaction_volume) || 0;
  const tf = Number(parsed.total_fees_charged) || 0;
  const pv = Number(parsed.pos_volume);
  const ev = Number(parsed.ecomm_volume);
  const cashV = Number(parsed.cash_volume) || 0;
  const csv = Number(parsed.channel_split?.pos?.volume) || 0;
  const cev = Number(parsed.channel_split?.cnp?.volume) || 0;
  const ccash = Number(parsed.channel_split?.cash?.volume) || 0;
  if (gv <= 0) return parsed;

  const sumReported = csv + cev + ccash;
  if (sumReported >= gv * CHANNEL_SPLIT_ALREADY_COVER_FRAC) return parsed;

  const prevPos = parsed.channel_split?.pos;
  const prevCnp = parsed.channel_split?.cnp;
  const usePv = Math.max(pv || 0, csv || 0, grossVolumeHintFromSplitRow(prevPos));
  const useEv = Math.max(ev || 0, cev || 0, grossVolumeHintFromSplitRow(prevCnp));
  const carryPosTx =
    prevPos?.txn_count != null && prevPos.txn_count !== '' ? { txn_count: Number(prevPos.txn_count) } : {};
  const carryCnpTx =
    prevCnp?.txn_count != null && prevCnp.txn_count !== '' ? { txn_count: Number(prevCnp.txn_count) } : {};
  const carryPosAvg =
    prevPos?.avg_txn != null &&
    prevPos.avg_txn !== '' &&
    Number.isFinite(Number(prevPos.avg_txn)) &&
    Number(prevPos.avg_txn) > 0
      ? { avg_txn: Math.round(Number(prevPos.avg_txn) * 100) / 100 }
      : {};
  const carryCnpAvg =
    prevCnp?.avg_txn != null &&
    prevCnp.avg_txn !== '' &&
    Number.isFinite(Number(prevCnp.avg_txn)) &&
    Number(prevCnp.avg_txn) > 0
      ? { avg_txn: Math.round(Number(prevCnp.avg_txn) * 100) / 100 }
      : {};
  const carryPosNet =
    prevPos && Number(prevPos.net_settled_volume) > CHANNEL_AMOUNT_EPS
      ? { net_settled_volume: Number(prevPos.net_settled_volume), gross_volume: usePv }
      : {};
  const carryCnpNet =
    prevCnp && Number(prevCnp.net_settled_volume) > CHANNEL_AMOUNT_EPS
      ? { net_settled_volume: Number(prevCnp.net_settled_volume), gross_volume: useEv }
      : {};

  if (
    usePv > 0 &&
    useEv > 0 &&
    cashV > 0 &&
    Math.abs(usePv + useEv + cashV - gv) / Math.max(gv, 1) <= CHANNEL_SPLIT_DRIFT_MAX
  ) {
    const cardDenom = usePv + useEv;
    let posFees = 0;
    let cnpFees = 0;
    if (tf > CHANNEL_AMOUNT_EPS && cardDenom > CHANNEL_AMOUNT_EPS) {
      posFees = Math.round(tf * (usePv / cardDenom) * 100) / 100;
      cnpFees = Math.round((tf - posFees) * 100) / 100;
    }
    return {
      ...parsed,
      channel_split: {
        pos: { volume: usePv, fees: posFees, ...carryPosTx, ...carryPosAvg, ...carryPosNet },
        cnp: { volume: useEv, fees: cnpFees, ...carryCnpTx, ...carryCnpAvg, ...carryCnpNet },
        cash: { volume: cashV },
      },
    };
  }

  if (usePv <= 0 || useEv <= 0) return parsed;
  if (Math.abs(usePv + useEv - gv) / Math.max(gv, 1) > CHANNEL_SPLIT_DRIFT_MAX) return parsed;
  const pairSum = usePv + useEv;
  const denom2 = pairSum > 0.005 ? pairSum : gv;
  const posFees = Math.round(tf * (usePv / denom2) * 100) / 100;
  const cnpFees = Math.round(tf * (useEv / denom2) * 100) / 100;
  return {
    ...parsed,
    channel_split: {
      pos: { volume: usePv, fees: posFees, ...carryPosTx, ...carryPosAvg, ...carryPosNet },
      cnp: { volume: useEv, fees: cnpFees, ...carryCnpTx, ...carryCnpAvg, ...carryCnpNet },
      ...(parsed.channel_split?.cash ? { cash: parsed.channel_split.cash } : {}),
    },
  };
}

/** Sum gross-like volume across `channel_split` rows; linked/golden prefers explicit gross columns over stale `volume`.
 * Linked POS + e‑commerce + bank bundles omit **cash** rows so inferred GTV matches processor POS + CNP headline.
 */
function sumChannelSplitGrossLikeVolumes(parsed) {
  const cs = parsed?.channel_split;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) return 0;
  const rollup = linkedOrGoldenRollupLocal(parsed);
  const linkedNoGolden =
    parsed?.linked_statement_bundle &&
    typeof parsed.linked_statement_bundle === 'object' &&
    !Array.isArray(parsed.linked_statement_bundle) &&
    parsed.golden_reconciliation_workbook !== true;
  let sum = 0;
  for (const k of Object.keys(cs)) {
    const row = cs[k];
    if (!row || typeof row !== 'object') continue;
    if (linkedNoGolden && channelSplitRowIsCashForFeeTotals(k, row)) continue;
    let v = 0;
    if (rollup) {
      const sgv = Number(row.statement_gross_volume);
      if (Number.isFinite(sgv) && sgv > CHANNEL_AMOUNT_EPS) v = sgv;
      else {
        const gv = Number(row.gross_volume ?? row.gross_sales);
        if (Number.isFinite(gv) && gv >= 0) v = gv;
      }
    }
    if (!(v > CHANNEL_AMOUNT_EPS)) {
      for (const key of ['volume', 'gross_volume', 'net_settled_volume']) {
        const n = Number(row[key]);
        if (Number.isFinite(n) && n >= 0) {
          v = n;
          break;
        }
      }
    }
    sum += v;
  }
  return sum;
}

/**
 * Linked POS + e‑commerce + bank: keep headline `total_transaction_volume` aligned with **channel_split**
 * row volumes (same basis as Channel tab / reconciliation overlay). Merger or repairs can leave the header
 * at the old POS+Shopify sum while rows already reflect the reconciliation workbook.
 */
function syncLinkedBundleTotalTransactionVolumeToPlainSplit(parsed) {
  const bundle = parsed?.linked_statement_bundle;
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return parsed;
  if (parsed.golden_reconciliation_workbook) return parsed;
  const cs = parsed.channel_split;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs) || !cs.pos || !cs.cnp) return parsed;
  let plainSum = 0;
  let any = false;
  for (const k of Object.keys(cs)) {
    const row = cs[k];
    if (!row || typeof row !== 'object') continue;
    if (channelSplitRowIsCashForFeeTotals(k, row)) continue;
    let v = 0;
    const sgv = Number(row.statement_gross_volume);
    if (Number.isFinite(sgv) && sgv > CHANNEL_AMOUNT_EPS) {
      v = Math.round(sgv * 100) / 100;
    } else {
      const gv = Number(row.gross_volume ?? row.gross_sales);
      if (Number.isFinite(gv) && gv > CHANNEL_AMOUNT_EPS) {
        v = Math.round(gv * 100) / 100;
      } else {
        for (const key of ['volume', 'gross_volume', 'net_settled_volume']) {
          const n = Number(row[key]);
          if (Number.isFinite(n) && n >= 0) {
            v = n;
            break;
          }
        }
      }
    }
    if (v > CHANNEL_AMOUNT_EPS) {
      plainSum += v;
      any = true;
    }
  }
  if (!any) return parsed;
  plainSum = Math.round(plainSum * 100) / 100;
  const declared = Number(parsed.total_transaction_volume);
  if (!Number.isFinite(declared) || !(declared > CHANNEL_AMOUNT_EPS)) return parsed;
  const tolPlain = Math.max(0.5, 0.002 * Math.max(declared, plainSum, 1));
  if (Math.abs(declared - plainSum) <= tolPlain) return parsed;

  const gap = plainSum - declared;
  if (gap > 0.5) {
    const posRow = cs.pos;
    let rf = Math.abs(Number(posRow?.refund_volume ?? posRow?.refunds) || 0);
    if (!(rf > CHANNEL_AMOUNT_EPS)) rf = _inferPosRefundFinalize(parsed, posRow);
    if (
      rf > CHANNEL_AMOUNT_EPS &&
      Math.abs(gap - rf) <= Math.max(2, 0.004 * Math.max(declared, plainSum))
    ) {
      return parsed;
    }
  }

  const out = { ...parsed, total_transaction_volume: plainSum };
  const tf = Number(out.total_fees_charged);
  if (plainSum > CHANNEL_AMOUNT_EPS && tf >= 0 && Number.isFinite(tf)) {
    out.effective_rate = Math.round((10000 * tf) / plainSum) / 100;
  }
  return out;
}

/** Same routing as `resolveChannelSplitBucket` in utils (avoid importing utils — circular). Cash rows carry no processor fees in totals. */
function channelSplitRowIsCashForFeeTotals(channelKey, row) {
  const kRaw = String(channelKey ?? '').toLowerCase();
  const k = kRaw.replace(/\s+/g, '_').replace(/-/g, '_');
  const lab = String(row?.channel_label || row?.label || row?.name || '').toLowerCase();
  const combined = `${kRaw} ${lab}`;
  if (/\bcash\s*back\b|\bcashback\b/i.test(combined)) return false;
  if (/\bnon-?\s*cash\b/i.test(combined)) return false;
  if (k === 'cash' || k.includes('cash_tender') || k.includes('cash_sales') || k.includes('cashtender')) return true;
  if (/\bcash\b/.test(lab) && (/\bsales\b/.test(lab) || /\btender\b/.test(lab) || /\bdrawer\b/.test(lab))) return true;
  if (/\b(cash\s+tender|tender\s+cash|cash\s+only|in-?store\s+cash)\b/i.test(lab)) return true;
  return false;
}

/** Σ channel_split.*.fees (non-negative), excluding cash — same basis as `reconcileTotalFeesCharged` / Channel tab. */
function sumChannelSplitFeesAll(parsed) {
  const s = parsed?.channel_split;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return 0;
  let sum = 0;
  for (const k of Object.keys(s)) {
    const ch = s[k];
    if (!ch || typeof ch !== 'object') continue;
    if (channelSplitRowIsCashForFeeTotals(k, ch)) continue;
    const f = Number(ch.fees);
    if (Number.isFinite(f) && f >= 0) sum += f;
  }
  return Math.round(sum * 100) / 100;
}

/**
 * When Σ `channel_split.*.fees` exceeds the header `total_fees_charged`, raise the header so net, effective rate,
 * and reconciliation math use the same fee total as the channel rows (matches overview reconcile logic).
 */
function alignTotalFeesChargedWithChannelSplit(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const base = Number(parsed.total_fees_charged) || 0;
  const sum = sumChannelSplitFeesAll(parsed);
  if (sum > base + 0.01) {
    const lineSum = sumFeesFromFeeLinesForInference(parsed);
    if (
      base > CHANNEL_AMOUNT_EPS &&
      lineSum > CHANNEL_AMOUNT_EPS &&
      Math.abs(lineSum - base) <= Math.max(2, 0.025 * base)
    ) {
      // Statement fee total matches detailed fee_lines — trust the header, not roll-up channel_split fees
      // (channels are often estimated / partial when line items came from the document).
      return parsed;
    }
    // Guard: keep header when channel fees are only slightly above (rounding / classification drift).
    if (
      Number.isFinite(base) &&
      base > CHANNEL_AMOUNT_EPS &&
      sum <= base * 1.05 &&
      sum >= base - 0.01
    ) {
      return parsed;
    }
    const baseMissing = !Number.isFinite(base) || base < CHANNEL_AMOUNT_EPS;
    const clearlyHigher = sum > base * 1.08 || sum > base + Math.max(25, 0.02 * base);
    if (!baseMissing && !clearlyHigher) return parsed;
    return { ...parsed, total_fees_charged: sum, _optismb_fees_synced_from_channel_split: true };
  }
  return parsed;
}

function pickFeeLinesArrayForInference(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  if (Array.isArray(parsed.fee_lines) && parsed.fee_lines.length > 0) return parsed.fee_lines;
  const nested =
    parsed.raw_extracted?.fee_lines ||
    parsed.raw_extracted_preview?.fee_lines ||
    parsed.extracted?.fee_lines;
  return Array.isArray(nested) ? nested : [];
}

function sumFeesFromFeeLinesForInference(parsed) {
  const lines = pickFeeLinesArrayForInference(parsed);
  let s = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || typeof line !== 'object') continue;
    const a = Number(line.amount ?? line.fee_amount ?? line.total ?? line.value ?? line.charge);
    if (Number.isFinite(a) && a >= 0) s += a;
  }
  return Math.round(s * 100) / 100;
}

function sumGrossFromPosSettlementBatchesForInference(parsed) {
  const batches = Array.isArray(parsed?.pos_settlement_batches) ? parsed.pos_settlement_batches : [];
  let s = 0;
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i];
    if (!b || typeof b !== 'object') continue;
    const g = Number(b.gross_sales ?? b.sales ?? b.gross_volume ?? b.amount ?? b.total);
    if (Number.isFinite(g) && g > CHANNEL_AMOUNT_EPS) s += g;
  }
  return Math.round(s * 100) / 100;
}

/** Mirrors `sumEcommOrderGrossBestFromParsed` in `./utils.js` without importing (avoid circular dependency). */
function ecommOrderExcludedFromInferenceTotals(row) {
  if (!row || typeof row !== 'object') return false;
  const st = String(row.status ?? row.fulfillment_status ?? row.order_status ?? row.Fulfillment ?? row.State ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!st) return false;
  if (st === 'refunded' || st === 'voided' || st === 'void' || st === 'cancelled' || st === 'canceled') return true;
  if (st.includes('refunded')) return true;
  return false;
}

function sumEcommOrderGrossBestFromParsedLocal(parsed) {
  if (!parsed || typeof parsed !== 'object') return 0;
  const lists = [
    parsed.ecomm_settlement_orders,
    parsed.ecommerce_settlement_orders,
    parsed.shopify_orders,
    parsed.ecomm_orders,
  ].filter((x) => Array.isArray(x) && x.length > 0);
  let bestSum = 0;
  let bestLen = -1;
  for (const L of lists) {
    let s = 0;
    for (const o of L) {
      if (!o || typeof o !== 'object') continue;
      if (ecommOrderExcludedFromInferenceTotals(o)) continue;
      const g = Number(
        o.gross_sales ?? o.gross_volume ?? o.gross ?? o.order_total ?? o.total ?? o.charged_amount ?? o.amount,
      );
      if (!Number.isFinite(g) || !(g > 0.005)) continue;
      s += g;
    }
    s = Math.round(s * 100) / 100;
    const n = L.length;
    if (n > bestLen || (n === bestLen && s > bestSum)) {
      bestLen = n;
      bestSum = s;
    }
  }
  return bestSum;
}

/**
 * When PDFs omit `total_transaction_volume` / `total_fees_charged`, infer from row-level grids the parser already filled.
 * Runs before split/GTV repair so downstream logic still reconciles against channel_split when present.
 */
function inferTotalsFromRawArrays(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  if (parsed.golden_reconciliation_workbook) return parsed;

  let out = parsed;

  const feeSum = sumFeesFromFeeLinesForInference(out);
  const headFees = Number(out.total_fees_charged);
  if (feeSum > CHANNEL_AMOUNT_EPS) {
    const feesMissing = !Number.isFinite(headFees) || headFees < CHANNEL_AMOUNT_EPS;
    const feesClearlyLow =
      Number.isFinite(headFees) &&
      headFees >= CHANNEL_AMOUNT_EPS &&
      feeSum > headFees + 1 &&
      feeSum > headFees * 1.35 &&
      feeSum > 15;
    if (feesMissing || feesClearlyLow) {
      out = { ...out, total_fees_charged: feeSum };
    }
  }

  const declared = Number(out.total_transaction_volume);
  const splitSum = sumChannelSplitGrossLikeVolumes(out);
  const batchGross = sumGrossFromPosSettlementBatchesForInference(out);
  const ecommGross = sumEcommOrderGrossBestFromParsedLocal(out);
  const rawComposite = Math.round((batchGross + ecommGross) * 100) / 100;

  const declaredWeak = !Number.isFinite(declared) || declared < CHANNEL_AMOUNT_EPS;
  const splitWeak = !(splitSum > CHANNEL_AMOUNT_EPS);

  // Guard: headline already tracks channel gross sum — do not replace with batch+order composite.
  if (
    Number.isFinite(declared) &&
    declared > CHANNEL_AMOUNT_EPS &&
    splitSum > CHANNEL_AMOUNT_EPS
  ) {
    const tolAlign = Math.max(2, 0.004 * Math.max(declared, splitSum, 1));
    if (Math.abs(declared - splitSum) <= tolAlign) {
      return out;
    }
  }

  if (rawComposite > CHANNEL_AMOUNT_EPS && declaredWeak && splitWeak) {
    out = { ...out, total_transaction_volume: rawComposite };
  } else if (
    rawComposite > CHANNEL_AMOUNT_EPS &&
    splitWeak &&
    Number.isFinite(declared) &&
    declared > CHANNEL_AMOUNT_EPS &&
    rawComposite > declared + Math.max(50, 0.25 * declared) &&
    rawComposite > declared * 1.25
  ) {
    out = { ...out, total_transaction_volume: rawComposite };
  }

  return out;
}

/**
 * PDF parsers sometimes set `total_transaction_volume` to a tiny cash stub while `channel_split` carries full POS/CNP.
 * Realign GTV to the split sum, and refresh `net_revenue` / `effective_rate` when they are wildly inconsistent.
 */
function repairParsedTotalTransactionVolume(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  if (parsed.golden_reconciliation_workbook) return parsed;
  const splitSum = sumChannelSplitGrossLikeVolumes(parsed);
  if (!(splitSum > CHANNEL_AMOUNT_EPS)) return parsed;

  const declared = Number(parsed.total_transaction_volume);
  const fees = Number(parsed.total_fees_charged);

  // Guard: valid headline already agrees with channel gross-like sum — skip repair.
  if (Number.isFinite(declared) && declared > CHANNEL_AMOUNT_EPS) {
    const tolAlign = Math.max(2, 0.004 * Math.max(declared, splitSum, 1));
    if (Math.abs(declared - splitSum) <= tolAlign) return parsed;
  }

  const implausibleLow =
    !Number.isFinite(declared) ||
    declared < CHANNEL_AMOUNT_EPS ||
    (splitSum > declared * 1.25 && splitSum - declared > 25) ||
    (splitSum > 200 && declared < splitSum * 0.1);

  if (!implausibleLow) return parsed;

  const newGtv = Math.round(splitSum * 100) / 100;
  const out = { ...parsed, total_transaction_volume: newGtv };

  const rf = sumRefundVolumesFromChannelSplit(parsed);
  const impliedNet =
    Number.isFinite(fees) && fees >= 0 ? Math.round((newGtv - rf - fees) * 100) / 100 : null;
  const nr = Number(parsed.net_revenue);
  if (
    impliedNet != null &&
    impliedNet > CHANNEL_AMOUNT_EPS &&
    (!Number.isFinite(nr) ||
      nr < CHANNEL_AMOUNT_EPS ||
      Math.abs(nr - impliedNet) > Math.max(50, 0.12 * Math.abs(impliedNet)))
  ) {
    out.net_revenue = impliedNet;
  }

  const er = effectiveRatePercentFromTotals(fees, newGtv);
  if (er != null) out.effective_rate = er;

  return out;
}

function sumRefundVolumesFromChannelSplit(parsed) {
  const cs = parsed?.channel_split;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) return 0;
  let s = 0;
  for (const k of Object.keys(cs)) {
    const row = cs[k];
    if (!row || typeof row !== 'object') continue;
    const v = Math.abs(Number(row.refund_volume ?? row.refunds) || 0);
    if (Number.isFinite(v) && v > CHANNEL_AMOUNT_EPS) s += v;
  }
  return Math.round(s * 100) / 100;
}

/**
 * Parser sometimes sets `net_revenue` equal to gross volume or to a junk value while fees and GTV are consistent.
 */
function repairParsedNetRevenue(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const stripFeeSyncMeta = (obj) => {
    const o = { ...obj };
    delete o._optismb_fees_synced_from_channel_split;
    return o;
  };
  const gv = Number(parsed.total_transaction_volume);
  const tf = Number(parsed.total_fees_charged);
  if (!(gv > CHANNEL_AMOUNT_EPS) || !Number.isFinite(tf) || tf < 0) return stripFeeSyncMeta(parsed);
  const syncedFromChannels = parsed._optismb_fees_synced_from_channel_split === true;
  const rfSplit = sumRefundVolumesFromChannelSplit(parsed);
  const rfHead = Math.abs(Number(parsed.refund_volume) || 0);
  const rf = rfSplit > CHANNEL_AMOUNT_EPS ? rfSplit : rfHead;
  const implied = Math.round((gv - rf - tf) * 100) / 100;
  if (!(implied > CHANNEL_AMOUNT_EPS)) return stripFeeSyncMeta(parsed);
  const nr = Number(parsed.net_revenue);
  const impliedNoRefund = Math.round((gv - tf) * 100) / 100;
  const bogusEqualsGross =
    Number.isFinite(nr) && tf > CHANNEL_AMOUNT_EPS && Math.abs(nr - gv) <= Math.max(1, 0.0005 * gv);
  const missing = !Number.isFinite(nr);
  const alreadyOk =
    Number.isFinite(nr) &&
    (Math.abs(nr - implied) <= Math.max(25, 0.006 * Math.abs(implied)) ||
      (rf <= CHANNEL_AMOUNT_EPS &&
        Math.abs(nr - impliedNoRefund) <= Math.max(25, 0.006 * Math.abs(impliedNoRefund))));
  if (alreadyOk) return stripFeeSyncMeta(parsed);
  // Do not replace headline net with gross − fees unless the parser clearly erred, or we just raised
  // total_fees_charged from Σ channel_split (then headline net must be recomputed to stay consistent).
  const reconcileNetAfterFeeSync =
    syncedFromChannels &&
    Number.isFinite(nr) &&
    Math.abs(nr - implied) > Math.max(50, 0.012 * Math.abs(implied));
  if (bogusEqualsGross || missing || reconcileNetAfterFeeSync) {
    return stripFeeSyncMeta({ ...parsed, net_revenue: implied });
  }
  return stripFeeSyncMeta(parsed);
}

/**
 * Linked POS + e‑commerce + bank: `net_revenue` from gross − refunds − fees often disagrees with the processor
 * settlement totals (`pos_net_deposit_volume` + `ecomm_net_deposit_volume`) merchants compare to the bank row.
 * Align headline net to Σ processor nets plus optional **cash** channel net so Overview matches reconciliation.
 */
function alignLinkedBundleNetRevenueWithSettlementNets(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const bundle = parsed.linked_statement_bundle;
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return parsed;
  const cs = parsed.channel_split;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs) || !cs.pos || !cs.cnp) return parsed;

  const headlineNr = Number(parsed.net_revenue);
  if (Number.isFinite(headlineNr) && headlineNr > CHANNEL_AMOUNT_EPS) {
    // Parser / statement already supplied net revenue — do not replace with Σ channel settlement nets
    // (inferred nets can disagree with the processor headline the merchant sees on the PDF).
    return parsed;
  }

  const pn = Number(parsed.pos_net_deposit_volume ?? cs.pos?.net_settled_volume);
  const en = Number(parsed.ecomm_net_deposit_volume ?? cs.cnp?.net_settled_volume);
  if (!(pn > CHANNEL_AMOUNT_EPS) || !(en > CHANNEL_AMOUNT_EPS)) return parsed;

  let cashNet = 0;
  if (cs.cash && typeof cs.cash === 'object') {
    const cg =
      Number(cs.cash.volume ?? cs.cash.gross_volume ?? cs.cash.gross_sales ?? cs.cash.net_settled_volume) || 0;
    const cf = Math.abs(Number(cs.cash.fees) || 0);
    if (cg > CHANNEL_AMOUNT_EPS) cashNet = Math.round((cg - cf) * 100) / 100;
  }

  const netSum = Math.round((pn + en + cashNet) * 100) / 100;
  if (!(netSum > CHANNEL_AMOUNT_EPS)) return parsed;
  return { ...parsed, net_revenue: netSum };
}

/**
 * Copy POS / e-comm transaction counts from nested parser blobs when top-level fields are missing
 * (so channel_split txn_count + avg_txn can be filled in applyTxnAvgAfterNet).
 */
function promoteParserTxnCounts(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const raw =
    parsed.raw_extracted_preview && typeof parsed.raw_extracted_preview === 'object'
      ? parsed.raw_extracted_preview
      : parsed.raw_extracted && typeof parsed.raw_extracted === 'object'
        ? parsed.raw_extracted
        : null;
  const ext = parsed.extracted && typeof parsed.extracted === 'object' ? parsed.extracted : null;
  const pick = (key) =>
    _positiveTxnInt(parsed[key]) ??
    (raw ? _positiveTxnInt(raw[key]) : null) ??
    (ext ? _positiveTxnInt(ext[key]) : null);

  let out = parsed;
  let changed = false;
  const ptc = pick('pos_transaction_count');
  const etc = pick('ecomm_transaction_count');
  if (ptc && !_positiveTxnInt(parsed.pos_transaction_count)) {
    out = { ...out, pos_transaction_count: ptc };
    changed = true;
  }
  if (etc && !_positiveTxnInt(out.ecomm_transaction_count)) {
    out = { ...out, ecomm_transaction_count: etc };
    changed = true;
  }
  return changed ? out : parsed;
}

function hasBankCreditLineArrays(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  const lists = [
    parsed.bank_transactions,
    parsed.bank_ledger_lines,
    parsed.bank_statement_lines,
    parsed.account_transactions,
    parsed.bank_deposits,
    parsed.deposit_transactions,
    parsed.raw_bank_lines,
    parsed.raw_extracted?.bank_transactions,
    parsed.raw_extracted?.bank_ledger_lines,
    parsed.raw_extracted?.raw_bank_lines,
    parsed.raw_extracted_preview?.bank_transactions,
    parsed.raw_extracted_preview?.raw_bank_lines,
    parsed.extracted?.bank_transactions,
    parsed.extracted?.raw_bank_lines,
  ];
  for (const L of lists) {
    if (Array.isArray(L) && L.length > 0) return true;
  }
  return false;
}

/** Drop opening/closing/net cash on merchant PDFs when no bank lines exist (avoids unrelated PDF table picks). */
function suppressMisleadingCashFlowOnMerchantPdf(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const ft = String(parsed.file_type || '').toLowerCase();
  if (ft && ft !== 'pdf') return parsed;
  const cs = parsed.channel_split;
  if (!cs?.pos || !cs?.cnp || typeof cs.pos !== 'object' || typeof cs.cnp !== 'object') return parsed;
  const posVol = Number(cs.pos.volume ?? cs.pos.gross_volume);
  const posFees = Number(cs.pos.fees);
  const minVol = getStatementHeuristics(parsed).channelGrossInference.minVolumeDollars;
  if (!(posVol > minVol) || !Number.isFinite(posFees)) return parsed;
  if (hasBankCreditLineArrays(parsed)) return parsed;
  if (
    parsed.opening_balance == null &&
    parsed.closing_balance == null &&
    (parsed.net_cash_flow == null || parsed.net_cash_flow === '')
  ) {
    return parsed;
  }
  const out = { ...parsed };
  delete out.opening_balance;
  delete out.closing_balance;
  delete out.net_cash_flow;
  return out;
}

function repairParsedEffectiveRate(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const gv = Number(parsed.total_transaction_volume);
  const tf = Number(parsed.total_fees_charged);
  const implied = effectiveRatePercentFromTotals(tf, gv);
  if (implied == null) return parsed;
  const cur = Number(parsed.effective_rate);
  const missing = !Number.isFinite(cur);
  /** Parser sometimes emits 0 while fees and volume imply a normal blended rate. */
  const bogusZero =
    cur === 0 && Number.isFinite(tf) && tf > CHANNEL_AMOUNT_EPS && Number.isFinite(gv) && gv > CHANNEL_AMOUNT_EPS;
  const absurd = Number.isFinite(cur) && (cur < 0 || cur > 25);
  const drift =
    Number.isFinite(cur) &&
    implied > 0.0001 &&
    Math.abs(cur - implied) > Math.max(0.35, 0.2 * implied);
  if (!missing && !bogusZero && !absurd && !drift) return parsed;
  return { ...parsed, effective_rate: implied };
}

/** Sum credits on parsed bank line arrays (aligned with bankStatementChannelSplit heuristics). */
function _bankRowCreditAmountForRepair(row) {
  return pickBankLedgerRowCreditAmount(row);
}

function _sumBankTransactionCreditsForRepair(parsed) {
  if (!parsed || typeof parsed !== 'object') return 0;
  const keys = [
    'bank_transactions',
    'bank_ledger_lines',
    'bank_statement_lines',
    'account_transactions',
    'bank_deposits',
    'deposit_transactions',
    'raw_bank_lines',
  ];
  const nestRoots = [
    parsed.raw_extracted,
    parsed.raw_extracted_preview,
    parsed.extracted,
  ].filter((x) => x && typeof x === 'object' && !Array.isArray(x));
  let sum = 0;
  for (const k of keys) {
    const L = parsed[k];
    if (!Array.isArray(L) || !L.length) continue;
    for (const row of L) {
      const a = _bankRowCreditAmountForRepair(row);
      if (a != null) sum += a;
    }
  }
  for (const k of keys) {
    const L = parsed[k];
    if (Array.isArray(L) && L.length > 0) continue;
    for (const root of nestRoots) {
      const Ln = root[k];
      if (!Array.isArray(Ln) || !Ln.length) continue;
      for (const row of Ln) {
        const a = _bankRowCreditAmountForRepair(row);
        if (a != null) sum += a;
      }
      break;
    }
  }
  return Math.round(sum * 100) / 100;
}

/**
 * Lift `bank_credits_total_verified` from summed ledger credits when the scalar is missing or
 * implausibly small vs parsed line items (or vs processor channel nets when those are large).
 */
function repairBankCreditsVerifiedFromLedgerIfScalarBogus(parsed, splitBasedSum) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const hr = getStatementHeuristics(parsed).recon;
  if (
    parsed.bank_deposits_statement_summary_verified === true &&
    Number.isFinite(Number(parsed.bank_credits_total_verified)) &&
    Number(parsed.bank_credits_total_verified) > hr.bankRowCreditFloor
  ) {
    return parsed;
  }
  const lineSum = _sumBankTransactionCreditsForRepair(parsed);
  if (!(lineSum > hr.bankRowCreditFloor)) return parsed;
  const curB = Number(parsed.bank_credits_total_verified);
  const missingOrWeakScalar = !Number.isFinite(curB) || !(curB > hr.bankRowCreditFloor);
  if (missingOrWeakScalar && lineSum > hr.bankRowCreditFloor) {
    return { ...parsed, bank_credits_total_verified: lineSum };
  }
  if (!(lineSum > hr.minBankLineSumDollarsForCreditRepair)) return parsed;
  const bogusBank =
    !(curB > hr.bankRowCreditFloor) ||
    curB < lineSum * hr.bankCreditsBelowLinesSumFraction ||
    (splitBasedSum > hr.minSplitSumDollarsForBogusScalar &&
      curB > hr.bankRowCreditFloor &&
      curB < splitBasedSum * hr.reconBelowSplitSumFraction &&
      lineSum > curB * hr.bankCreditsVsSplitBogusLineMultiplier);
  if (!bogusBank) return parsed;
  return { ...parsed, bank_credits_total_verified: lineSum };
}

/**
 * Copy channel net deposits to top-level fields used by Bank Reconciliation when the parser omitted them.
 */
function syncTopLevelSettlementNetsFromSplit(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const cs = parsed.channel_split;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) {
    return repairBankCreditsVerifiedFromLedgerIfScalarBogus(parsed, 0);
  }

  const pickNet = (row) => {
    if (!row || typeof row !== 'object') return null;
    const ns = Number(row.net_settled_volume);
    if (Number.isFinite(ns) && ns > CHANNEL_AMOUNT_EPS) return Math.round(ns * 100) / 100;
    const vol = Number(row.volume ?? row.gross_volume);
    const fees = Math.abs(Number(row.fees) || 0);
    if (Number.isFinite(vol) && vol > CHANNEL_AMOUNT_EPS && Number.isFinite(fees) && fees < vol) {
      return Math.round((vol - fees) * 100) / 100;
    }
    return null;
  };

  let out = parsed;
  const posN = pickNet(cs.pos);
  const cnpN = pickNet(cs.cnp);
  const curP = Number(parsed.pos_net_deposit_volume);
  const curE = Number(parsed.ecomm_net_deposit_volume);
  if (!(curP > CHANNEL_AMOUNT_EPS) && posN != null && posN > CHANNEL_AMOUNT_EPS) {
    out = { ...out, pos_net_deposit_volume: posN };
  }
  if (!(curE > CHANNEL_AMOUNT_EPS) && cnpN != null && cnpN > CHANNEL_AMOUNT_EPS) {
    out = { ...out, ecomm_net_deposit_volume: cnpN };
  }

  const cashN = pickNet(cs.cash);
  const p = Number(out.pos_net_deposit_volume);
  const e = Number(out.ecomm_net_deposit_volume);
  const splitBasedSum =
    (Number.isFinite(p) && p > CHANNEL_AMOUNT_EPS ? p : 0) +
    (Number.isFinite(e) && e > CHANNEL_AMOUNT_EPS ? e : 0) +
    (cashN != null && cashN > CHANNEL_AMOUNT_EPS ? cashN : 0);

  const curR = Number(out.reconciliation_total_deposits ?? parsed.reconciliation_total_deposits);
  const hr = getStatementHeuristics(parsed).recon;
  const bogusRecon =
    splitBasedSum > hr.minSplitSumDollarsForBogusScalar &&
    Number.isFinite(curR) &&
    curR > CHANNEL_AMOUNT_EPS &&
    curR < splitBasedSum * hr.reconBelowSplitSumFraction &&
    splitBasedSum - curR > hr.minAbsoluteGapDollarsVsSplit;

  if (splitBasedSum > CHANNEL_AMOUNT_EPS && (!(curR > CHANNEL_AMOUNT_EPS) || bogusRecon)) {
    out = { ...out, reconciliation_total_deposits: Math.round(splitBasedSum * 100) / 100 };
  }

  return repairBankCreditsVerifiedFromLedgerIfScalarBogus(out, splitBasedSum);
}

/** Lift e‑commerce settlement line arrays from nested parser blobs when top-level is empty (same idea as POS batches). */
function promoteEcommSettlementArrays(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const keys = [
    'ecomm_settlement_orders',
    'ecommerce_settlement_orders',
    'ecommerce_orders',
    'ecomm_orders',
    'online_orders',
    'web_orders',
    'shopify_orders',
    'cnp_orders',
    'ecomm_transactions',
    'ecommerce_transactions',
    'cnp_transactions',
    'online_transactions',
    'ecomm_settlement_batches',
    'ecommerce_settlement_batches',
    'cnp_settlement_batches',
  ];
  let out = parsed;
  let changed = false;
  for (const key of keys) {
    const cur = out[key];
    if (Array.isArray(cur) && cur.length > 0) continue;
    const from =
      parsed.raw_extracted?.[key] || parsed.raw_extracted_preview?.[key] || parsed.extracted?.[key];
    if (!Array.isArray(from) || from.length === 0) continue;
    if (!changed) {
      out = { ...parsed };
      changed = true;
    }
    out[key] = from;
  }
  return changed ? out : parsed;
}

/** Lift bank / ledger line arrays when the parser nests them. */
function promoteBankTransactionArrays(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const keys = [
    'bank_transactions',
    'bank_ledger_lines',
    'bank_statement_lines',
    'account_transactions',
    'bank_deposits',
    'deposit_transactions',
    'raw_bank_lines',
  ];
  let out = parsed;
  let changed = false;
  for (const key of keys) {
    const cur = out[key];
    if (Array.isArray(cur) && cur.length > 0) continue;
    const from =
      parsed.raw_extracted?.[key] ||
      parsed.raw_extracted_preview?.[key] ||
      parsed.extracted?.[key];
    if (!Array.isArray(from) || from.length === 0) continue;
    if (!changed) {
      out = { ...parsed };
      changed = true;
    }
    out[key] = from;
  }
  return changed ? out : parsed;
}

/** Lift POS batch rows from nested parser blobs when the top-level array is missing (older saves / alternate shapes). */
function promotePosSettlementBatches(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  if (Array.isArray(parsed.pos_settlement_batches) && parsed.pos_settlement_batches.length > 0) return parsed;
  if (Array.isArray(parsed.pos_batches) && parsed.pos_batches.length > 0) {
    return {
      ...parsed,
      pos_settlement_batches: parsed.pos_batches,
      pos_settlement_batch_count: parsed.pos_batches.length,
    };
  }
  const from =
    parsed.raw_extracted?.pos_settlement_batches ||
    parsed.raw_extracted_preview?.pos_settlement_batches ||
    parsed.extracted?.pos_settlement_batches;
  if (Array.isArray(from) && from.length > 0) {
    return {
      ...parsed,
      pos_settlement_batches: from,
      pos_settlement_batch_count: from.length,
    };
  }
  const fromBatches =
    parsed.raw_extracted?.pos_batches ||
    parsed.raw_extracted_preview?.pos_batches ||
    parsed.extracted?.pos_batches;
  if (Array.isArray(fromBatches) && fromBatches.length > 0) {
    return {
      ...parsed,
      pos_settlement_batches: fromBatches,
      pos_settlement_batch_count: fromBatches.length,
    };
  }
  return parsed;
}

/** Lift POS payment line arrays from nested parser blobs when top-level is empty (same pattern as bank lines). */
function promotePosTransactionArrays(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const keys = [
    'pos_transactions',
    'pos_transaction_details',
    'pos_settlement_transactions',
    'card_present_transactions',
    'in_store_transactions',
    'batch_transactions',
    'transactions',
  ];
  let out = parsed;
  let changed = false;
  for (const key of keys) {
    const cur = out[key];
    if (Array.isArray(cur) && cur.length > 0) continue;
    const from =
      parsed.raw_extracted?.[key] ||
      parsed.raw_extracted_preview?.[key] ||
      parsed.extracted?.[key];
    if (!Array.isArray(from) || from.length === 0) continue;
    if (!changed) {
      out = { ...parsed };
      changed = true;
    }
    out[key] = from;
  }
  return changed ? out : parsed;
}

/** Deep clone parsed JSON so finalize heuristics never mutate stored statement payloads. */
function cloneParsedJsonSafe(parsed) {
  if (parsed == null || typeof parsed !== 'object') return parsed;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(parsed);
    } catch {
      /* non-cloneable values */
    }
  }
  try {
    return JSON.parse(JSON.stringify(parsed));
  } catch {
    return { ...parsed };
  }
}

/**
 * Core finalize passes (repairs, inference). Consumers should normally use {@link finalizeParsedForClient}
 * from `./statementFinalize.js`, which runs one scalar sync so `pos_volume` / `ecomm_volume` match Channel tab.
 * Operates on a deep clone so viewing one statement cannot corrupt another's stored `parsedData`.
 */
export function finalizeParsedForClientCore(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  let p = cloneParsedJsonSafe(parsed);
  p = promotePosSettlementBatches(p);
  p = promotePosTransactionArrays(p);
  p = promoteEcommSettlementArrays(p);
  p = promoteBankTransactionArrays(p);
  // Promote card mix before currency repair so `volume_inr` rows and inference see top-level `card_brand_mix`.
  p = repairParsedCardBrandMix(p);
  p = repairParsedDisplayCurrency(p);
  p = inferTotalsFromRawArrays(p);
  p = repairParsedTotalTransactionVolume(p);
  p = repairParsedChannelSplit(p);
  p = repairChannelSplitVolumeAgainstExplicitGross(p);
  p = repairLinkedPosVolumeFromTrustedTotal(p);
  p = syncLinkedBundleTotalTransactionVolumeToPlainSplit(p);
  p = alignTotalFeesChargedWithChannelSplit(p);
  p = repairParsedNetRevenue(p);
  p = alignLinkedBundleNetRevenueWithSettlementNets(p);
  p = promoteParserTxnCounts(p);
  p = repairReconciliationChannelNet(p);
  p = inferChannelTxnMetricsFromGrids(p);
  p = inferPosTxnCountFromPosSettlementBatches(p);
  p = syncTopLevelSettlementNetsFromSplit(p);
  p = repairParsedEffectiveRate(p);
  p = suppressMisleadingCashFlowOnMerchantPdf(p);
  p = ensureDerivedReconciliationVarianceField(p);
  if (p && typeof p === 'object') delete p._optismb_fees_synced_from_channel_split;
  return p;
}
