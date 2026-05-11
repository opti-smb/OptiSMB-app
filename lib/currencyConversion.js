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

/**
 * After POS/CNP net-to-bank amounts exist, fill missing txn_count from top-level parser fields
 * and align avg_txn to net ÷ count (older saves had gross-based averages).
 */
function applyTxnAvgAfterNet(parsed) {
  if (!parsed?.channel_split?.pos || !parsed.channel_split?.cnp) return parsed;
  const cs = parsed.channel_split;
  const pos = { ...cs.pos };
  const cnp = { ...cs.cnp };
  const posN = Number(pos.net_settled_volume);
  const cnpN = Number(cnp.net_settled_volume);
  if (!(posN > CHANNEL_AMOUNT_EPS) && !(cnpN > CHANNEL_AMOUNT_EPS)) return parsed;

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
  if (pUse && posN > CHANNEL_AMOUNT_EPS) {
    const a = Math.round((posN / pUse) * 100) / 100;
    if (pos.avg_txn !== a) {
      pos.avg_txn = a;
      changed = true;
    }
  }
  if (eUse && cnpN > CHANNEL_AMOUNT_EPS) {
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
  const cashV = Number(cs.cash?.volume) || 0;
  if (cashV > API_VOLUME_FLOOR) return parsed;

  const pos = { ...cs.pos };
  const cnp = { ...cs.cnp };

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
  const sum = posNet + cnpNet;
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
 */
export function finalizeStatementRecord(stmt) {
  if (!stmt?.parsedData) return stmt;
  const nextPd = finalizeParsedForClient(stmt.parsedData);
  if (nextPd === stmt.parsedData) return stmt;
  return { ...stmt, parsedData: nextPd };
}

/**
 * When API includes `pos_volume` / `ecomm_volume` but `channel_split` is empty (older clients / PDF quirks),
 * rebuild POS vs online split for the Channel tab.
 */
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
  const carryPosTx =
    prevPos?.txn_count != null && prevPos.txn_count !== '' ? { txn_count: Number(prevPos.txn_count) } : {};
  const carryCnpTx =
    prevCnp?.txn_count != null && prevCnp.txn_count !== '' ? { txn_count: Number(prevCnp.txn_count) } : {};
  const carryPosNet =
    prevPos && Number(prevPos.net_settled_volume) > CHANNEL_AMOUNT_EPS
      ? { net_settled_volume: Number(prevPos.net_settled_volume), gross_volume: Number(pv) }
      : {};
  const carryCnpNet =
    prevCnp && Number(prevCnp.net_settled_volume) > CHANNEL_AMOUNT_EPS
      ? { net_settled_volume: Number(prevCnp.net_settled_volume), gross_volume: Number(ev) }
      : {};

  if (
    pv > 0 &&
    ev > 0 &&
    cashV > 0 &&
    Math.abs(pv + ev + cashV - gv) / Math.max(gv, 1) <= CHANNEL_SPLIT_DRIFT_MAX
  ) {
    const posFees = Math.round(tf * (pv / gv) * 100) / 100;
    const cnpFees = Math.round(tf * (ev / gv) * 100) / 100;
    const cashFees = Math.round(tf * (cashV / gv) * 100) / 100;
    return {
      ...parsed,
      channel_split: {
        pos: { volume: pv, fees: posFees, ...carryPosTx, ...carryPosNet },
        cnp: { volume: ev, fees: cnpFees, ...carryCnpTx, ...carryCnpNet },
        cash: { volume: cashV, fees: cashFees },
      },
    };
  }

  if (pv <= 0 || ev <= 0) return parsed;
  if (Math.abs(pv + ev - gv) / Math.max(gv, 1) > CHANNEL_SPLIT_DRIFT_MAX) return parsed;
  const posFees = Math.round(tf * (pv / gv) * 100) / 100;
  const cnpFees = Math.round(tf * (ev / gv) * 100) / 100;
  return {
    ...parsed,
    channel_split: {
      pos: { volume: pv, fees: posFees, ...carryPosTx, ...carryPosNet },
      cnp: { volume: ev, fees: cnpFees, ...carryCnpTx, ...carryCnpNet },
      ...(parsed.channel_split?.cash ? { cash: parsed.channel_split.cash } : {}),
    },
  };
}

/** Card-brand promotion + channel_split repair — use after every parse / hydrate. */
export function finalizeParsedForClient(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  let p = parsed;
  // Promote card mix before currency repair so `volume_inr` rows and inference see top-level `card_brand_mix`.
  p = repairParsedCardBrandMix(p);
  p = repairParsedDisplayCurrency(p);
  p = repairParsedChannelSplit(p);
  p = repairReconciliationChannelNet(p);
  return p;
}
