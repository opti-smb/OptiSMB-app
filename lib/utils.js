import { cardMixRowVolume } from './currencyConversion.js';

export function tierOk(current, needed) {
  const rank = { Free: 0, L1: 1, L2: 2 };
  return (rank[current] ?? 0) >= (rank[needed] ?? 0);
}

export function fmt(n, decimals = 0) {
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

export function fmtCurrency(n) {
  return '$' + fmt(n);
}

export function fmtPct(n, dec = 2) {
  return n.toFixed(dec) + '%';
}

export function confidenceColor(level) {
  return { high: 'text-leaf', medium: 'text-amber', low: 'text-rose' }[level] ?? 'text-ink-400';
}

export function confidenceDot(level) {
  return { high: 'bg-leaf', medium: 'bg-amber', low: 'bg-rose' }[level] ?? 'bg-ink/20';
}

export function generateId() {
  return 'stmt-' + Math.random().toString(36).slice(2, 9);
}

/** Human-readable source file kind from parser `file_type` (xlsx, csv, pdf, image). */
export function formatSourceFileKind(fileType) {
  if (fileType == null || fileType === '') return '';
  const x = String(fileType).toLowerCase().replace(/^\./, '');
  if (['xlsx', 'xlsm', 'xls'].includes(x)) return 'Excel';
  if (x === 'csv') return 'CSV';
  if (x === 'pdf') return 'PDF';
  if (x === 'image' || x === 'png' || x === 'jpeg' || x === 'jpg' || x === 'webp' || x === 'gif') return 'Image';
  return String(fileType);
}

/** Readable label from upload file name when the statement has no extracted merchant name. */
export function humanizeFileStem(fileName) {
  if (!fileName || typeof fileName !== 'string') return '';
  return fileName
    .replace(/\.(pdf|csv|xlsx|xlsm|xls|txt|tsv)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Display title for analyses: parsed business name from the file when present,
 * otherwise the humanized file name — no hardcoded placeholder names.
 */
export function statementDisplayTitle(acquirerNameFromParse, uploadFileName) {
  const parsed = acquirerNameFromParse && String(acquirerNameFromParse).trim();
  if (parsed) return parsed;
  return humanizeFileStem(uploadFileName) || 'Statement';
}

/** Strip pandas/Excel stringified NaN and collapse whitespace (parser blob noise). */
function stripExcelNaNNoise(s) {
  if (s == null || typeof s !== 'string') return '';
  return s
    .replace(/\bnan\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove leading "March 2024" / month-year junk from merged Excel title cells. */
function stripLeadingCalendarNoise(s) {
  let t = stripExcelNaNNoise(s);
  if (!t) return '';
  const month =
    '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
  let prev;
  do {
    prev = t;
    t = t
      .replace(new RegExp(`^${month}\\s+\\d{4}\\s+`, 'i'), '')
      .replace(new RegExp(`^${month}\\s+`, 'i'), '')
      .replace(/^20\d{2}\s+/, '')
      .trim();
  } while (t !== prev);
  return t;
}

/**
 * When both API `acquirer_name` and preview `merchant_name` exist, prefer the richer legal name
 * (fixes short/wrong top-level values hiding the full name in `raw_extracted_preview`).
 */
function chooseBestBusinessName(primary, secondary) {
  const a = stripExcelNaNNoise(primary != null && String(primary).trim() !== '' ? String(primary) : '');
  const b = stripExcelNaNNoise(secondary != null && String(secondary).trim() !== '' ? String(secondary) : '');
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al.includes(bl) || bl.includes(al)) return a.length >= b.length ? a : b;
  const score = (s) =>
    s.length + (/\b(LLC|Inc\.?|Ltd\.?|Limited|Corp\.?|LLP|Pty)\b/i.test(s) ? 80 : 0);
  return score(b) > score(a) ? b : a;
}

/**
 * Identity fields from the parser payload, with fallbacks to `raw_extracted_preview`
 * (older sessions / PDFs may only have merchant_name & account in the preview blob).
 */
export function getParsedIdentity(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') {
    return { acquirer_name: null, bank_name: null, account_number: null, merchant_id: null };
  }
  const prev =
    parsedData.raw_extracted_preview && typeof parsedData.raw_extracted_preview === 'object'
      ? parsedData.raw_extracted_preview
      : {};
  const pick = (top, ...previewKeys) => {
    if (top != null && String(top).trim() !== '') return String(top).trim();
    for (const k of previewKeys) {
      const v = prev[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  };
  const merged = chooseBestBusinessName(parsedData.acquirer_name, prev.merchant_name);
  const cleaned = merged ? stripLeadingCalendarNoise(merged) : null;
  let mid = pick(parsedData.merchant_id, 'merchant_id');
  const badMid = /^(bank_ref|txn_id|batch_id|funding_id|merchant_id|channel|ach_code|ref|description)$/i;
  if (mid && badMid.test(String(mid).trim())) mid = null;
  return {
    acquirer_name: cleaned || null,
    bank_name: pick(parsedData.bank_name, 'bank_name'),
    account_number: pick(parsedData.account_number, 'account_number'),
    merchant_id: mid,
  };
}

/** Prefer full legal name from parse (or preview), else list title / filename. */
export function displayBusinessName(parsedData, fallbackAcquirer) {
  const { acquirer_name: an } = getParsedIdentity(parsedData);
  if (an) return an;
  const raw = fallbackAcquirer && String(fallbackAcquirer).trim();
  const f = raw ? stripLeadingCalendarNoise(raw) : '';
  return f || 'Statement';
}

/** One line for UI tables/headers: bank · Acct ****1234 · MID … when parsed. */
export function accountAndMidLine(parsedData) {
  const id = getParsedIdentity(parsedData);
  const bits = [];
  if (id.bank_name) bits.push(id.bank_name);
  if (id.account_number) bits.push(`Acct ${id.account_number}`);
  if (id.merchant_id) bits.push(`MID ${id.merchant_id}`);
  return bits.length ? bits.join(' · ') : '';
}

/**
 * POS/CNP split row: prefer legacy `volume`, then `gross_volume`, then `net_settled_volume`
 * (parser / workbook exports differ).
 */
export function channelSalesVolume(ch) {
  if (!ch || typeof ch !== 'object') return 0;
  for (const k of ['volume', 'gross_volume', 'net_settled_volume']) {
    const v = Number(ch[k]);
    if (Number.isFinite(v) && v >= 0) return v;
  }
  return 0;
}

/** When POS + online channel fees sum above `total_fees_charged` (common with PDFs), use the sum for UI totals. */
export function reconcileTotalFeesCharged(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') {
    return { total: 0, scale: 1, reconciled: false };
  }
  const base = Number(parsedData.total_fees_charged) || 0;
  const posF = Number(parsedData.channel_split?.pos?.fees) || 0;
  const cnpF = Number(parsedData.channel_split?.cnp?.fees) || 0;
  const cashF = Number(parsedData.channel_split?.cash?.fees) || 0;
  const sum = posF + cnpF + cashF;
  if (cnpF > 0.01 && sum > base + 0.01) {
    return { total: sum, scale: base > 0 ? sum / base : 1, reconciled: true };
  }
  return { total: base, scale: 1, reconciled: false };
}

/**
 * Map a fee_lines row label to overview donut buckets (interchange / scheme / processor / other).
 * Channel-specific processing rows count as processor.
 */
function bucketForFeeLineType(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('interchange')) return 'ich';
  if (t.includes('scheme') || t.includes('assessment')) return 'sch';
  if (t.includes('other fees') || (t.includes('other') && t.includes('fee'))) return 'oth';
  if (t.includes('pos') && t.includes('processing')) return 'svc';
  if (t.includes('e-commerce') || t.includes('ecommerce') || (t.includes('online') && t.includes('processing')))
    return 'svc';
  if (t.includes('processor') || t.includes('acquirer') || t.includes('gateway')) return 'svc';
  return 'oth';
}

/**
 * Prefer summing fee_lines when they tie out to the displayed fee total and top-level
 * interchange is implausibly small (e.g. 1.50% misread as ₹1.5 → ~$0.02 after FX).
 * @returns {{ ich: number, sch: number, svc: number, oth: number }}
 */
/**
 * Card brand rows from parser (`card_brand_mix`) or nested preview (some sessions only stored preview).
 * @returns {unknown[] | null}
 */
export function getCardBrandMixFromParsed(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  const candidates = [
    parsedData.card_brand_mix,
    parsedData.raw_extracted_preview?.card_brand_mix,
    parsedData.raw_extracted?.card_brand_mix,
  ];
  for (const top of candidates) {
    if (Array.isArray(top) && top.length > 0) return top;
  }
  return null;
}

/**
 * Channel tab: only these `parse_issues` trigger applying `resolved_transaction_counts` for display.
 * (Other codes, e.g. `transaction_count_inconsistent`, do not force per-channel hiding by themselves.)
 */
export const TX_COUNT_FORCED_CHANNEL_TXN_RESOLUTION = new Set([
  'transaction_count_duplicate_channels',
  'transaction_count_exceeds_total',
]);

function _niNonnegCh(x) {
  if (x == null || x === '') return null;
  const n = Math.round(Number(x));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function _txnBudgetForTotal(total) {
  if (total == null || total <= 0) return 0;
  return Math.max(0, Math.min(3, Math.floor(0.02 * total)));
}

/**
 * True only for impossible / duplicate-all-equal patterns (matches backend `validate_transaction_counts`
 * duplicate + exceeds branches). Does **not** flag normal splits like 20 + 11 = 31.
 */
export function strictChannelTxnDuplicateOrExceedsTotal(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  const total = _niNonnegCh(parsed.total_transactions);
  const pos =
    _niNonnegCh(parsed.pos_transaction_count) ??
    _niNonnegCh(parsed.pos_transactions) ??
    _niNonnegCh(parsed.channel_split?.pos?.txn_count);
  const ec =
    _niNonnegCh(parsed.ecomm_transaction_count) ??
    _niNonnegCh(parsed.ecommerce_transactions) ??
    _niNonnegCh(parsed.channel_split?.cnp?.txn_count);
  if (total == null || !(total > 0)) return false;
  if (pos == null || ec == null) return false;
  const b = _txnBudgetForTotal(total);
  if (pos + ec > total + b) return true;
  if (pos > 0 && ec > 0 && pos === ec && pos === total) return true;
  return false;
}

/**
 * True when summed card-mix row volumes match **POS + CNP** gross (whole-statement mix table).
 * In that shape, txn counts in the mix are not attributable to a single channel — do not force "—/—".
 */
export function cardMixVolumeMatchesPosPlusCnpGross(parsed, posGrossVol, cnpGrossVol) {
  const rows = getCardBrandMixFromParsed(parsed);
  if (!Array.isArray(rows) || rows.length < 2) return false;
  let mixVol = 0;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const vr = cardMixRowVolume(r, parsed);
    if (vr != null && Number.isFinite(Number(vr)) && Number(vr) > 0) mixVol += Number(vr);
  }
  const posG = Number(posGrossVol) || 0;
  const cnpG = Number(cnpGrossVol) || 0;
  const combined = posG + cnpG;
  if (mixVol <= 0 || posG <= 0.005 || cnpG <= 0.005 || combined <= 0) return false;
  const tol = Math.max(5, 0.02 * Math.max(mixVol, combined, 1));
  return Math.abs(mixVol - combined) <= tol;
}

/** True when POS + online counts already reconcile to the statement total (no card-mix override needed). */
function channelTxnCountsAlreadyConsistentWithTotal(parsed) {
  const total = _niNonnegCh(parsed?.total_transactions);
  if (total == null || total <= 0) return false;
  const pos =
    _niNonnegCh(parsed?.pos_transaction_count) ??
    _niNonnegCh(parsed?.pos_transactions) ??
    _niNonnegCh(parsed?.channel_split?.pos?.txn_count);
  const ec =
    _niNonnegCh(parsed?.ecomm_transaction_count) ??
    _niNonnegCh(parsed?.ecommerce_transactions) ??
    _niNonnegCh(parsed?.channel_split?.cnp?.txn_count);
  if (pos == null || ec == null) return false;
  const b = _txnBudgetForTotal(total);
  const s = pos + ec;
  return s >= total - b && s <= total + b;
}

/** Client-only display split when API omitted `resolved_transaction_counts` (card-mix volume vs channels). */
/** @returns {object | null} `null` = skip override (e.g. whole-statement mix); unresolved object = hide both when forced */
export function resolveTransactionCountsClientSide(parsed, posGrossVol, cnpGrossVol) {
  if (channelTxnCountsAlreadyConsistentWithTotal(parsed)) return null;
  const total = _niNonnegCh(parsed?.total_transactions);
  const rows = getCardBrandMixFromParsed(parsed);
  const unresolved = () => ({
    pos: null,
    ecommerce: null,
    total,
    source: 'unresolved',
    confidence: 'low',
  });

  if (!Array.isArray(rows) || rows.length < 2) return null;

  let mixVol = 0;
  let mixTx = 0;
  let txSeen = false;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const vr = cardMixRowVolume(r, parsed);
    if (vr != null && Number.isFinite(Number(vr)) && Number(vr) > 0) mixVol += Number(vr);
    const tv = r.transactions;
    if (tv != null && String(tv).trim() !== '' && !Number.isNaN(Number(tv))) {
      mixTx += Math.round(Number(tv));
      txSeen = true;
    }
  }

  if (mixVol <= 0 || !txSeen || mixTx <= 0) return null;

  const posG = Number(posGrossVol) || 0;
  const cnpG = Number(cnpGrossVol) || 0;
  if (cardMixVolumeMatchesPosPlusCnpGross(parsed, posGrossVol, cnpGrossVol)) {
    return null;
  }

  const tol = Math.max(5, 0.02 * Math.max(mixVol, posG, cnpG, 1));

  if (Math.abs(mixVol - cnpG) <= tol) {
    return { pos: null, ecommerce: mixTx, total, source: 'card_brand_mix', confidence: 'high' };
  }
  if (Math.abs(mixVol - posG) <= tol) {
    return { pos: mixTx, ecommerce: null, total, source: 'card_brand_mix', confidence: 'high' };
  }
  return unresolved();
}

export function getFeeCompositionForOverview(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') {
    return { ich: 0, sch: 0, svc: 0, oth: 0 };
  }
  const { total: displayTotal, scale: feeScale } = reconcileTotalFeesCharged(parsedData);
  const topIch = (Number(parsedData.interchange_fees) || 0) * feeScale;
  const topSch = (Number(parsedData.scheme_fees) || 0) * feeScale;
  const topSvc = (Number(parsedData.service_fees) || 0) * feeScale;
  const topOth = (Number(parsedData.other_fees) || 0) * feeScale;
  const lines = Array.isArray(parsedData.fee_lines) ? parsedData.fee_lines : [];

  const fromTop = () => ({ ich: topIch, sch: topSch, svc: topSvc, oth: topOth });

  if (!lines.length) return fromTop();

  let ichL = 0;
  let schL = 0;
  let svcL = 0;
  let othL = 0;
  let lineIch = 0;
  for (const row of lines) {
    if (!row || row.amount == null) continue;
    const raw = Number(row.amount) || 0;
    const scaled = raw * feeScale;
    const b = bucketForFeeLineType(row.type);
    if (b === 'ich') {
      ichL += scaled;
      lineIch += scaled;
    } else if (b === 'sch') schL += scaled;
    else if (b === 'svc') svcL += scaled;
    else othL += scaled;
  }

  const sumL = ichL + schL + svcL + othL;
  if (sumL <= 0) return fromTop();

  const tol = Math.max(0.5, displayTotal * 0.02);
  const tiesOut = Math.abs(sumL - displayTotal) <= tol + 0.01;
  const topTinyButLineReal =
    topIch < Math.max(displayTotal * 0.01, 1) &&
    lineIch > Math.max(topIch * 3, displayTotal * 0.05, 5);

  if (tiesOut && (topTinyButLineReal || lineIch > topIch * 1.5)) {
    return { ich: ichL, sch: schL, svc: svcL, oth: othL };
  }

  return fromTop();
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function triggerPrint() {
  window.print();
}
