/**
 * Fills `pos_settlement_batches` from tabular uploads (.xlsx, .xls, .csv) when the parser omits them.
 * Scans workbook sheets for a daily batch summary (batch date + batch id + bank credit date).
 * Also scans all sheets for transaction-detail grids (batch id + a transaction/sale/auth column) and
 * appends minimal `{ batch_number }` rows to `pos_transactions` so per-batch counts match line items.
 * Tolerant of multi-sheet workbooks: merged headers, renamed columns, string Excel serials.
 * E‑commerce order grids use **scored column assignment** (not left‑to‑right first match) so reordered or
 * extra columns still map to order / gross / fee / net / dates when headers are recognizable.
 *
 * `xlsx` is imported statically so Next.js `/api/parse` (Node) reliably bundles it; dynamic import
 * could omit batches in the API response while the standalone Node test still passed.
 */
import {
  isTabularStatementFileName,
  isSyntheticInterchangeSchemeProcessorFeeLine,
  slugifyCardOrKey,
} from './utils.js';
import { isEcommerceSummaryOrderId } from './posBatchCommissionAnalysis.js';
import { ecommHeadingAliasScoreBonus } from './statementHeadingRoleMap.js';
import * as XLSXImport from 'xlsx';
import { tryParseGoldenReconciliationWorkbookBuffer } from './reconciliationGoldenWorkbook.js';
import { normHeaderCell as normCell } from './normHeaderCell.js';

const XLSX = /** @type {any} */ (XLSXImport).default ?? XLSXImport;

/** Internal flag on rows synthesized from workbook grids (JSON-safe, stripped before re-append). */
const POS_WORKBOOK_GRID_DETAIL_ROW = true;

/** Rows merged from e‑commerce / online order grids in the same workbook (when parser omits `ecomm_settlement_orders`). */
const ECOMM_WORKBOOK_GRID_DETAIL_ROW = true;

/** Bank credit rows merged from workbook activity tabs when parser omits `bank_transactions`. */
const BANK_WORKBOOK_GRID_DETAIL_ROW = true;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function excelSerialToYmd(n, XLSX) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const whole = Math.floor(Math.abs(n));
  // Excel day serials for 1980–2100-ish; avoids mis-parsing arbitrary counts as dates
  if (whole < 20000 || whole > 75000) return null;
  const p = XLSX.SSF?.parse_date_code?.(n);
  if (p && Number.isFinite(p.y) && Number.isFinite(p.m) && Number.isFinite(p.d)) {
    return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
  }
  return null;
}

function cellToYmd(v, XLSX) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const fromSerial = excelSerialToYmd(v, XLSX);
    if (fromSerial) return fromSerial;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`;
  }
  if (typeof v === 'string') {
    const t = v.trim();
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (us) {
      const mo = Number(us[1]);
      const da = Number(us[2]);
      const yr = Number(us[3]);
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31 && yr >= 1990 && yr <= 2100) {
        return `${yr}-${pad2(mo)}-${pad2(da)}`;
      }
    }
    const us2 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})\b/);
    if (us2) {
      let yr = Number(us2[3]);
      yr += yr >= 70 ? 1900 : 2000;
      const mo = Number(us2[1]);
      const da = Number(us2[2]);
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
        return `${yr}-${pad2(mo)}-${pad2(da)}`;
      }
    }
    // Excel sometimes exports numbers as strings (serial or plain digits)
    if (/^\d{5}(\.\d+)?$/.test(t)) {
      const num = Number(t);
      const fromSerial = excelSerialToYmd(num, XLSX);
      if (fromSerial) return fromSerial;
    }
  }
  return null;
}

function toNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isBatchDateHeader(c) {
  if (!c) return false;
  if (c.includes('deposit') && c.includes('date')) return false;
  if (c.includes('bank') && c.includes('date')) return false;
  return (
    c === 'batch date' ||
    c === 'batch dt' ||
    c === 'close date' ||
    c === 'batch close date' ||
    c === 'closeout date' ||
    c === 'settlement date' ||
    (c.includes('batch') && c.includes('date')) ||
    (c.includes('close') && c.includes('date') && !c.includes('bank'))
  );
}

function isBatchIdHeader(c) {
  if (!c) return false;
  if (c.includes('date')) return false;
  return (
    c === 'batch id' ||
    c === 'batch #' ||
    c === 'batch no' ||
    c === 'batch number' ||
    c === 'batch ref' ||
    c === 'reference' ||
    (c.includes('batch') && (c.includes('id') || c.includes('#') || c.endsWith(' no'))) ||
    (c.includes('settlement') && c.includes('id')) ||
    (c.includes('payout') && c.includes('id')) ||
    (c.includes('transfer') && c.includes('id') && !c.includes('date'))
  );
}

function isBankCreditDateHeader(h) {
  if (!h) return false;
  if (h.includes('batch') && (h.includes('close') || h.includes('batch date'))) return false;
  return (
    h === 'deposit date' ||
    h === 'date deposited' ||
    h === 'bank date' ||
    h === 'credit date' ||
    h === 'funding date' ||
    h === 'value date' ||
    h === 'posted date' ||
    h === 'processing date' ||
    (h.includes('deposit') && h.includes('date') && !h.includes('net')) ||
    (h.includes('bank') && h.includes('date')) ||
    (h.includes('credit') && h.includes('date') && !h.includes('card')) ||
    (h.includes('settle') && h.includes('bank')) ||
    (h.includes('payout') && h.includes('date'))
  );
}

function isNetDepositHeader(h) {
  if (!h) return false;
  return (
    (h.includes('net') && (h.includes('deposit') || h.includes('dep'))) ||
    (h.includes('net') && h.includes('payout')) ||
    h === 'net amount' ||
    h.includes('batch total') ||
    // Enhanced net amount detection
    (h.includes('net') && h.includes('amount')) ||
    (h.includes('net') && h.includes('settled')) ||
    (h.includes('net') && h.includes('sales')) ||
    (h.includes('settlement') && h.includes('amount')) ||
    (h.includes('payout') && h.includes('amount')) ||
    (h.includes('deposit') && h.includes('total'))
  );
}

function isBatchProcessingFeeHeader(h) {
  if (!h) return false;
  if (h.includes('date')) return false;
  if (h.includes('net') && h.includes('deposit')) return false;
  return (
    (h.includes('processing') && h.includes('fee')) ||
    (h.includes('processor') && h.includes('fee')) ||
    (h.includes('batch') && h.includes('fee') && !h.includes('date')) ||
    (h.includes('discount') && (h.includes('fee') || h.includes('amount'))) ||
    // Enhanced fee detection
    (h.includes('service') && h.includes('fee')) ||
    (h.includes('transaction') && h.includes('fee')) ||
    (h.includes('merchant') && h.includes('fee')) ||
    (h.includes('card') && h.includes('fee')) ||
    (h.includes('rate') && h.includes('fee')) ||
    (h.includes('charge') && (h.includes('process') || h.includes('fee'))) ||
    (h.includes('mdr') || h.includes('discount rate'))
  );
}

/** Gross / sales column for commission (gross − net); must not pick fee or net columns. */
function isGrossBatchHeader(h) {
  if (!h || h.includes('net')) return false;
  if (h.includes('fee') || h.includes('discount') || h.includes('commission') || h.includes('mdr')) return false;
  if (h.includes('deposit') && h.includes('bank')) return false;
  return (
    (h.includes('gross') && (h.includes('sales') || h.includes('volume') || h.includes('amount'))) ||
    (h.includes('sales') && h.includes('total')) ||
    h === 'batch sales' ||
    (h.includes('turnover') && !h.includes('net')) ||
    (h.includes('card') && h.includes('sales') && !h.includes('net')) ||
    // Enhanced detection for various statement formats
    (h.includes('revenue') && !h.includes('net')) ||
    (h.includes('income') && !h.includes('net')) ||
    (h.includes('total') && (h.includes('sales') || h.includes('revenue')) && !h.includes('net'))
  );
}

/** # of card / auth events in the batch (not dollar volume). */
function isBatchTxnCountHeader(h) {
  if (!h || h.includes('date')) return false;
  if (h.includes('$') || h.includes('€') || h.includes('£') || h.includes('¢')) return false;
  if ((h.includes('gross') || h.includes('net')) && h.includes('sales')) return false;
  if (h.includes('fee') && !h.includes('count')) return false;
  return (
    h === 'transactions' ||
    h === 'transaction' ||
    h === '# transactions' ||
    h === '# of transactions' ||
    h === '# txns' ||
    h === '# txn' ||
    (h.startsWith('#') && /\btxns?\b/.test(h)) ||
    h === 'no. of transactions' ||
    h === 'no of transactions' ||
    h === 'txn count' ||
    h === 'trans count' ||
    h === 'trx count' ||
    (h.includes('transaction') && (h.includes('count') || h.includes('#') || /\bqty\b/.test(h))) ||
    (/\btrans\b/.test(h) && h.includes('count')) ||
    (h.includes('txn') && h.includes('count')) ||
    (h.includes('sales') && h.includes('count') && !h.includes('amount'))
  );
}

/**
 * @param {unknown[][]} rows
 * @param {object} XLSX
 * @returns {{ batch_number: string, batch_close_date: string, bank_credit_date: string, amount?: number, gross_sales?: number, fees?: number, processing_fee?: number, transaction_count?: number }[]}
 */
function extractBatchesFromMatrix(rows, XLSX) {
  if (!Array.isArray(rows) || !rows.length) return [];

  let headerIdx = -1;
  let batchDateCol = -1;
  let batchIdCol = -1;

  for (let i = 0; i < Math.min(rows.length, 300); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const cells = row.map(normCell);
    const bi = cells.findIndex(isBatchDateHeader);
    if (bi < 0) continue;
    const bidi = cells.findIndex((c, j) => j !== bi && isBatchIdHeader(c));
    if (bidi < 0) continue;
    headerIdx = i;
    batchDateCol = bi;
    batchIdCol = bidi;
    break;
  }

  if (headerIdx < 0 || batchDateCol < 0 || batchIdCol < 0) return [];

  const hdr = rows[headerIdx].map(normCell);
  let depIdx = hdr.findIndex((h, j) => j !== batchDateCol && isBankCreditDateHeader(h));
  if (depIdx < 0) {
    depIdx = hdr.findIndex((h, j) => j > batchIdCol && h.includes('date') && !h.includes('batch'));
  }
  let netIdx = hdr.findIndex(isNetDepositHeader);
  if (netIdx < 0) netIdx = hdr.findIndex((h) => h.includes('net') && !h.includes('date'));
  let feeIdx = hdr.findIndex(
    (h, j) =>
      j !== batchDateCol &&
      j !== batchIdCol &&
      j !== depIdx &&
      isBatchProcessingFeeHeader(h),
  );
  let grossIdx = hdr.findIndex(
    (h, j) =>
      j !== batchDateCol &&
      j !== batchIdCol &&
      j !== depIdx &&
      j !== feeIdx &&
      isGrossBatchHeader(h),
  );
  let txnCountIdx = hdr.findIndex(
    (h, j) =>
      j !== batchDateCol &&
      j !== batchIdCol &&
      j !== depIdx &&
      j !== feeIdx &&
      j !== grossIdx &&
      isBatchTxnCountHeader(h),
  );

  const batches = [];
  let blankStreak = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) break;
    const stop = normCell(row[batchDateCol]);
    if (!stop) {
      blankStreak += 1;
      if (blankStreak > 30) break;
      continue;
    }
    blankStreak = 0;
    if (stop.includes('total') || stop.includes('individual') || stop.includes('summary')) break;

    const batchCloseYmd = cellToYmd(row[batchDateCol], XLSX);
    const batchIdRaw = row[batchIdCol];
    const batchId = batchIdRaw != null ? String(batchIdRaw).trim() : '';
    let bankYmd = depIdx >= 0 ? cellToYmd(row[depIdx], XLSX) : null;

    // Fallback: if deposit column wrong, use last column in row that parses as a date after batch date
    if (!bankYmd && batchCloseYmd) {
      for (let c = row.length - 1; c > batchDateCol; c--) {
        if (c === batchIdCol) continue;
        const y = cellToYmd(row[c], XLSX);
        if (y) {
          bankYmd = y;
          break;
        }
      }
    }

    const amount = netIdx >= 0 ? toNum(row[netIdx]) : null;
    const gross = grossIdx >= 0 ? toNum(row[grossIdx]) : null;
    const fees = feeIdx >= 0 ? toNum(row[feeIdx]) : null;
    const txnCountRaw = txnCountIdx >= 0 ? toNum(row[txnCountIdx]) : null;
    const transaction_count =
      txnCountRaw != null && txnCountRaw >= 1 && txnCountRaw <= 1e9 ? Math.round(txnCountRaw) : null;

    if (!batchCloseYmd || !batchId || !bankYmd) continue;

    batches.push({
      batch_number: batchId,
      batch_close_date: batchCloseYmd,
      bank_credit_date: bankYmd,
      ...(amount != null ? { amount } : {}),
      ...(gross != null && gross > 0 ? { gross_sales: gross, batch_gross: gross } : {}),
      ...(fees != null && fees >= 0 ? { fees, processing_fee: fees } : {}),
      ...(transaction_count != null ? { transaction_count } : {}),
    });
  }

  return batches;
}

function isLikelyBatchSummarySettlementHeader(hdr) {
  if (!Array.isArray(hdr)) return false;
  const hasBatchDate = hdr.some(isBatchDateHeader);
  const hasBatchId = hdr.some(isBatchIdHeader);
  const hasNet = hdr.some(isNetDepositHeader);
  const hasBank = hdr.some(isBankCreditDateHeader);
  return hasBatchDate && hasBatchId && hasNet && hasBank;
}

/** Column that identifies one sale/authorization line (not the daily batch summary row). */
function isTxnDetailColumnHeader(h) {
  if (!h) return false;
  if (isBatchDateHeader(h) || isBankCreditDateHeader(h)) return false;
  if (isNetDepositHeader(h) || isGrossBatchHeader(h) || isBatchProcessingFeeHeader(h)) return false;
  if (isBatchIdHeader(h) || isBatchTxnCountHeader(h)) return false;
  return /transaction|txn|auth|approval|payment|sale|card|pan|last\s*4|invoice|order|receipt|ticket|description|merchant|payment\s*id|trans\s*id/i.test(
    h,
  );
}

/**
 * Per-sheet: find transaction-detail tables (batch id + detail column), not the daily batch settlement grid.
 * @param {unknown[][]} rows
 * @param {object} _XLSX
 * @returns {{ batch_number: string }[]}
 */
function extractPosTransactionStubsFromSheet(rows, _XLSX) {
  const out = [];
  if (!Array.isArray(rows) || !rows.length) return out;
  let start = 0;
  const maxStart = Math.min(rows.length, 400);
  while (start < maxStart) {
    let foundHi = -1;
    let batchIdCol = -1;
    let detailCol = -1;
    for (let hi = start; hi < maxStart; hi++) {
      const row = rows[hi];
      if (!Array.isArray(row)) continue;
      const hdr = row.map(normCell);
      if (isLikelyBatchSummarySettlementHeader(hdr)) continue;
      const bic = hdr.findIndex(isBatchIdHeader);
      if (bic < 0) continue;
      let dc = -1;
      for (let j = 0; j < hdr.length; j++) {
        if (j === bic) continue;
        const h = hdr[j];
        if (!h) continue;
        if (isTxnDetailColumnHeader(h)) {
          dc = j;
          break;
        }
      }
      if (dc < 0) continue;
      foundHi = hi;
      batchIdCol = bic;
      detailCol = dc;
      break;
    }
    if (foundHi < 0) break;

    const chunk = [];
    let blankStreak = 0;
    let end = foundHi;
    for (let i = foundHi + 1; i < rows.length; i++) {
      end = i;
      const r = rows[i];
      if (!Array.isArray(r)) break;
      const first = normCell(r[0]);
      if (first && /^(total|subtotal|summary)\b|grand\s+total/.test(first)) break;

      const bidCell = r[batchIdCol];
      const bid = bidCell != null ? String(bidCell).trim() : '';
      if (!bid) {
        blankStreak += 1;
        if (blankStreak > 30) break;
        continue;
      }
      blankStreak = 0;
      const det = r[detailCol];
      if (det == null || det === '') continue;
      chunk.push({ batch_number: bid });
    }

    if (chunk.length) {
      for (const c of chunk) out.push(c);
    }
    start = end + 1;
  }
  return out;
}

/** @param {string[]} headerNorm */
function pickSquareDailySummaryDateColumn(headerNorm) {
  const exact = [
    'date',
    'calendar date',
    'business date',
    'report date',
    'day',
    'activity date',
    'transaction date',
  ];
  for (const e of exact) {
    const i = headerNorm.findIndex((h) => h === e);
    if (i >= 0) return i;
  }
  return headerNorm.findIndex(
    (h) =>
      h &&
      h.includes('date') &&
      !h.includes('bank') &&
      !h.includes('deposit') &&
      !h.includes('funding') &&
      !h.includes('payout') &&
      !h.includes('credit') &&
      !h.includes('settlement') &&
      !h.includes('posted') &&
      !h.includes('value') &&
      h.length <= 48,
  );
}

/** @param {string[]} headerNorm */
function pickSquareDailySummaryGrossColumn(headerNorm) {
  const exact = [
    'gross sales',
    'total gross sales',
    'gross revenue',
    'gross',
    'total sales',
    'sales gross',
    'card gross sales',
  ];
  for (const e of exact) {
    const i = headerNorm.findIndex((h) => h === e);
    if (i >= 0) return i;
  }
  return headerNorm.findIndex(
    (h) =>
      h &&
      !h.includes('net') &&
      !h.includes('fee') &&
      !h.includes('refund') &&
      !h.includes('discount') &&
      !h.includes('commission') &&
      (h.includes('gross') ||
        (h.includes('total') && h.includes('sale')) ||
        (h.includes('turnover') && !h.includes('net'))),
  );
}

/** @param {string[]} headerNorm */
function pickSquareDailySummaryNetSalesColumn(headerNorm) {
  const exact = ['net sales', 'total net sales', 'net revenue', 'card net sales', 'net card sales'];
  for (const e of exact) {
    const i = headerNorm.findIndex((h) => h === e);
    if (i >= 0) return i;
  }
  return headerNorm.findIndex(
    (h) =>
      h &&
      h.includes('net') &&
      (h.includes('sale') || h.includes('revenue')) &&
      !h.includes('fee') &&
      !h.includes('deposit') &&
      !h.includes('payout') &&
      !h.includes('bank'),
  );
}

/** @param {string[]} headerNorm */
function pickSquareDailySummaryCardTxnColumn(headerNorm) {
  const exact = [
    'card txns',
    'card transactions',
    'card txn',
    '# card transactions',
    'card transaction count',
    'cnp transactions',
  ];
  for (const e of exact) {
    const i = headerNorm.findIndex((h) => h === e);
    if (i >= 0) return i;
  }
  return headerNorm.findIndex(
    (h) =>
      h &&
      !h.includes('amount') &&
      !h.includes('$') &&
      !/\bvolume\b/.test(h) &&
      !h.includes('gross') &&
      !h.includes('net sale') &&
      !(h.includes('sale') && !/\btrans|\btxn|\bcount\b/.test(h)) &&
      (/\bcard\b/.test(h) || /\bcnp\b/.test(h)) &&
      (/\btrans/.test(h) || /\btxn/.test(h) || /\bcount\b/.test(h)),
  );
}

/** @param {string[]} headerNorm */
function pickSquareDailySummaryTotalTxnColumn(headerNorm) {
  const exact = [
    'total txns',
    'total transactions',
    'transactions',
    'total txn',
    '# transactions',
    'no. of transactions',
    'txn count',
  ];
  for (const e of exact) {
    const i = headerNorm.findIndex((h) => h === e);
    if (i >= 0) return i;
  }
  return headerNorm.findIndex(
    (h) =>
      h &&
      !/\bcard\b/.test(h) &&
      !/\bcash\b/.test(h) &&
      !h.includes('amount') &&
      !h.includes('$') &&
      (h === 'transactions' ||
        h === 'txns' ||
        (h.includes('total') && (h.includes('trans') || h.includes('txn'))) ||
        (h.includes('all') && (h.includes('trans') || h.includes('txn'))) ||
        h.includes('payment count')),
  );
}

/** @param {string[]} headerNorm */
function pickSquareDailySummaryCashSalesColumn(headerNorm) {
  const exact = ['cash sales', 'cash tender', 'cash payments', 'cash payment total'];
  for (const e of exact) {
    const i = headerNorm.findIndex((h) => h === e);
    if (i >= 0) return i;
  }
  return headerNorm.findIndex(
    (h) => h && h.includes('cash') && (h.includes('sale') || h.includes('tender') || h.includes('payment')),
  );
}

/**
 * Square "Daily Summary" (and similar): one row per calendar day with gross, blended card fees, txn counts.
 * Uses **Card Txns** when that column exists (fees apply to card volume); otherwise **Total Txns**.
 * Exported for programmatic reuse.
 */
export function extractSquarePosDailyBatchesFromMatrix(rows, XLSXMod) {
  if (!Array.isArray(rows) || rows.length < 8) return [];
  for (let headerIdx = 0; headerIdx < Math.min(35, rows.length); headerIdx++) {
    const row = rows[headerIdx];
    if (!Array.isArray(row)) continue;
    const headerNorm = row.map((c) => normCell(c));
    const dateCol = pickSquareDailySummaryDateColumn(headerNorm);
    if (dateCol < 0) continue;
    const grossCol = pickSquareDailySummaryGrossColumn(headerNorm);
    /** Prefer **card** txn counts for fee math; Square Daily Summary also has cash / total columns. */
    const cardTxCol = pickSquareDailySummaryCardTxnColumn(headerNorm);
    const totalTxCol = pickSquareDailySummaryTotalTxnColumn(headerNorm);
    let feeCol = -1;
    for (let j = 0; j < row.length; j++) {
      if (isSquareBlendedFeeColumnHeader(row[j])) {
        feeCol = j;
        break;
      }
    }
    const netSalesCol = pickSquareDailySummaryNetSalesColumn(headerNorm);
    const hasTxnBasis = cardTxCol >= 0 || totalTxCol >= 0;
    if (grossCol < 0 || feeCol < 0 || !hasTxnBasis) continue;

    const out = [];
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const dr = rows[r];
      if (!Array.isArray(dr)) continue;
      const first = normCell(dr[dateCol]);
      if (!first || first === 'total' || first === '') continue;
      const ymd = cellToYmd(dr[dateCol], XLSXMod);
      if (!ymd) continue;
      const gross = toNum(dr[grossCol]);
      const fees = toNum(dr[feeCol]);
      let txns = null;
      if (cardTxCol >= 0) {
        const c = toNum(dr[cardTxCol]);
        if (c != null && Number.isFinite(c) && c >= 0) txns = c;
      }
      if (txns == null && totalTxCol >= 0) {
        const t = toNum(dr[totalTxCol]);
        if (t != null && Number.isFinite(t) && t >= 1) txns = t;
      }
      const netSale = netSalesCol >= 0 ? toNum(dr[netSalesCol]) : null;
      if (gross == null || !(gross > 0.005)) continue;
      if (fees == null || !Number.isFinite(fees) || fees < 0) continue;
      const netBatch =
        netSale != null && netSale > 0.005 ? Math.round(netSale * 100) / 100 : Math.round((gross - fees) * 100) / 100;
      out.push({
        batch_number: ymd,
        batch_id: ymd,
        batch_close_date: ymd,
        gross_sales: Math.round(gross * 100) / 100,
        fees: Math.round(fees * 100) / 100,
        processing_fee: Math.round(fees * 100) / 100,
        transaction_count:
          txns != null && Number.isFinite(txns) && txns >= 0
            ? Math.min(Math.max(0, Math.round(txns)), 1e9)
            : null,
        net_batch_deposit: netBatch,
        square_daily_summary_row: true,
      });
    }
    if (out.length >= 3) return out;
  }
  return [];
}

/**
 * Sum the **Cash Sales** column on Square Daily Summary (month total in the sheet footer matches Month Summary).
 * Used when Month Summary scalars are missing from stored JSON but the daily grid is still in the workbook at upload.
 * @param {unknown[][]} rows
 * @param {object} XLSXMod
 * @returns {number | null}
 */
function extractSquareDailyCashSalesColumnSumFromMatrix(rows, XLSXMod) {
  if (!Array.isArray(rows) || rows.length < 8) return null;
  for (let headerIdx = 0; headerIdx < Math.min(35, rows.length); headerIdx++) {
    const row = rows[headerIdx];
    if (!Array.isArray(row)) continue;
    const headerNorm = row.map((c) => normCell(c));
    const dateCol = pickSquareDailySummaryDateColumn(headerNorm);
    const cashCol = pickSquareDailySummaryCashSalesColumn(headerNorm);
    if (dateCol < 0 || cashCol < 0) continue;
    let sum = 0;
    let n = 0;
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const dr = rows[r];
      if (!Array.isArray(dr)) continue;
      const first = normCell(dr[dateCol]);
      if (!first || first === 'total' || first === '') continue;
      const ymd = cellToYmd(dr[dateCol], XLSXMod);
      if (!ymd) continue;
      const c = toNum(dr[cashCol]);
      if (c != null && Number.isFinite(c) && c >= 0) {
        sum += c;
        n++;
      }
    }
    if (n >= 3 && sum > 0.005) return Math.round(sum * 100) / 100;
  }
  return null;
}

/** @returns {number | null} */
function tryExtractSquareDailyCashSalesSumFromWorkbook(wb, XLSXMod) {
  if (!wb?.SheetNames) return null;
  for (const sn of wb.SheetNames) {
    const ln = String(sn).toLowerCase().replace(/\s+/g, ' ');
    if (!(ln.includes('daily') && ln.includes('summary'))) continue;
    const sh = wb.Sheets[sn];
    if (!sh) continue;
    for (const raw of [true, false]) {
      const rows = XLSXMod.utils.sheet_to_json(sh, { header: 1, defval: null, raw });
      const got = extractSquareDailyCashSalesColumnSumFromMatrix(rows, XLSXMod);
      if (got != null) return got;
    }
  }
  return null;
}

function tryExtractSquarePosDailyBatchesFromWorkbook(wb, XLSXMod) {
  if (!wb?.SheetNames) return [];
  for (const sn of wb.SheetNames) {
    const ln = String(sn).toLowerCase().replace(/\s+/g, ' ');
    if (!(ln.includes('daily') && ln.includes('summary'))) continue;
    const sh = wb.Sheets[sn];
    if (!sh) continue;
    for (const raw of [true, false]) {
      const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw });
      const got = extractSquarePosDailyBatchesFromMatrix(rows, XLSXMod);
      if (got.length >= 3) return got;
    }
  }
  return [];
}

function mergeBatchesFromWorkbookWb(wb, XLSX) {
  let bestPos = [];
  let bestAny = [];
  for (const sheetName of sheetNamesInScanOrder(wb)) {
    const sh = wb.Sheets[sheetName];
    if (!sh) continue;
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: true });
    const found = extractBatchesFromMatrix(rows, XLSX);
    const role = workbookSheetRole(sheetName);
    if (role === 'pos' && found.length > bestPos.length) bestPos = found;
    if (found.length > bestAny.length) bestAny = found;
  }
  let merged = bestPos.length > 0 ? bestPos : bestAny;

  if (!merged.length) {
    let bestPos2 = [];
    let bestAny2 = [];
    for (const sheetName of sheetNamesInScanOrder(wb)) {
      const sh = wb.Sheets[sheetName];
      if (!sh) continue;
      const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: false });
      const found = extractBatchesFromMatrix(rows, XLSX);
      const role = workbookSheetRole(sheetName);
      if (role === 'pos' && found.length > bestPos2.length) bestPos2 = found;
      if (found.length > bestAny2.length) bestAny2 = found;
    }
    merged = bestPos2.length > 0 ? bestPos2 : bestAny2;
  }

  const squareDaily = tryExtractSquarePosDailyBatchesFromWorkbook(wb, XLSX);
  if (squareDaily.length >= 3) {
    if (!merged.length || squareDaily.length >= merged.length) {
      return squareDaily;
    }
  }
  return merged;
}

/**
 * @param {object} wb
 * @param {object} XLSX
 * @returns {{ batch_number: string }[]}
 */
function readPosTransactionStubsFromWorkbookWb(wb, XLSX) {
  const all = [];
  const pushFromRows = (rows) => {
    const stubs = extractPosTransactionStubsFromSheet(rows, XLSX);
    for (const s of stubs) all.push({ ...s, posWorkbookGridDetailRow: POS_WORKBOOK_GRID_DETAIL_ROW });
  };
  for (const sheetName of sheetNamesInScanOrder(wb)) {
    const sh = wb.Sheets[sheetName];
    if (!sh) continue;
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: true });
    pushFromRows(rows);
  }
  if (!all.length) {
    for (const sheetName of sheetNamesInScanOrder(wb)) {
      const sh = wb.Sheets[sheetName];
      if (!sh) continue;
      const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: false });
      pushFromRows(rows);
    }
  }
  return all;
}

function sheetNamesInScanOrder(wb) {
  const names = wb.SheetNames || [];
  return [...names].sort((a, b) => workbookSheetPriority(b) - workbookSheetPriority(a));
}

/** Human-readable role for each tab (POS / e-commerce / bank / reconciliation). */
export function workbookSheetRole(sheetName) {
  const ln = String(sheetName ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!ln) return 'other';
  if (/\bpos\b/.test(ln) || ln.includes('point of sale') || ln.includes('point-of-sale')) return 'pos';
  if (
    ln.includes('ecom') ||
    ln.includes('e-comm') ||
    ln.includes('shopify') ||
    ln.includes('web store') ||
    ln.includes('online payment') ||
    ln.includes('cnp') ||
    ln.includes('online order') ||
    ln.includes('web order') ||
    ln === 'online' ||
    ln.includes('card not present') ||
    ln.includes('keyed')
  )
    return 'ecommerce';
  if (
    ln.includes('bank') &&
    (ln.includes('statement') || ln.includes('account') || ln.includes('deposit') || ln.includes('checking'))
  )
    return 'bank';
  /** Single-tab exports titled only “Statement” / “Account statement” (e.g. First National commercial checking). */
  if (ln === 'statement' || ln === 'account statement' || /^checking\b/.test(ln)) return 'bank';
  if (ln.includes('recon') || ln.includes('reconcile')) return 'reconciliation';
  // Square / Clover–style POS exports: "Daily Summary", "Month Summary" are activity views, not generic workbook overviews.
  if (/\b(daily|weekly|monthly|month|year)\s+summary\b/.test(ln)) return 'pos';
  if (ln === 'summary' || ln === 'overview' || /^summary\b/.test(ln) || /^overview\b/.test(ln) || /\bexecutive\s+summary\b/.test(ln))
    return 'summary';
  if (ln.includes('summary') || ln.includes('overview')) return 'summary';
  return 'other';
}

/** Prefer POS tab for daily batch table, then other sheets. */
function workbookSheetPriority(sheetName) {
  const r = workbookSheetRole(sheetName);
  const p = { pos: 100, ecommerce: 40, summary: 15, other: 10, bank: 5, reconciliation: 5 };
  const ln = String(sheetName).toLowerCase();
  let bump = 0;
  if (r === 'pos' && ln.includes('report')) bump += 20;
  if (r === 'ecommerce' && ln.includes('statement')) bump += 10;
  return (p[r] ?? 0) + bump;
}

function workbookSheetRolesList(wb) {
  const names = wb.SheetNames || [];
  return names.map((name) => ({ name, role: workbookSheetRole(name) }));
}

/** Sale / order activity date (not bank settlement). */
function isEcommOrderActivityDateHeader(h) {
  if (!h) return false;
  if (h.includes('settlement') && h.includes('date')) return false;
  if ((h.includes('payout') || h.includes('funding')) && h.includes('date')) return false;
  if (h.includes('bank') && h.includes('date')) return false;
  if (h === 'date/time' || h === 'datetime' || (h.includes('date') && h.includes('time') && !h.includes('timezone')))
    return true;
  if (h === 'created at' || h === 'created' || h === 'timestamp' || h === 'processed at' || h === 'sale time')
    return true;
  if (h === 'order date' || h === 'sale date' || h === 'purchase date' || h === 'activity date') return true;
  if (h === 'transaction date' || h === 'txn date' || h === 'trans date') return true;
  if (h.includes('order') && h.includes('date')) return true;
  if ((h.includes('transaction') || h.startsWith('txn')) && h.includes('date') && !h.includes('count')) return true;
  return false;
}

/** When funds hit bank / settlement posts (used as bank credit proxy for lag). */
function isEcommBankOrSettlementDateHeader(h) {
  if (!h) return false;
  if (h === 'settlement date' || h === 'bank credit date' || h === 'payout date' || h === 'deposit date' || h === 'funding date')
    return true;
  if (h.includes('settlement') && h.includes('date')) return true;
  if (h.includes('bank') && h.includes('date') && (h.includes('credit') || h.includes('post'))) return true;
  return false;
}

function scoreEcommOrderIdHeader(h) {
  if (!h) return 0;
  if (isEcommOrderActivityDateHeader(h)) return 0;
  if (isEcommBankOrSettlementDateHeader(h)) return 0;
  if (h.includes('transaction') && h.includes('count')) return 0;
  let s = 0;
  if (/^order(\s*#|\s*id|\s*number|\s*no\.?)?$/i.test(h)) s = 100;
  else if (h.includes('shopify') && h.includes('order')) s = 92;
  else if (h.includes('transaction') && h.includes('id') && !h.includes('date')) s = 65;
  else if (h.includes('order') && (h.includes('#') || h.includes(' id') || h.endsWith(' id') || h.includes('number')))
    s = 85;
  else if (h === 'invoice' || h === 'invoice id' || h === 'invoice number' || h === 'invoice #') s = 72;
  else if ((h === 'reference' || h === 'ref') && !h.includes('date')) s = 52;
  else if (h.includes('payment') && h.includes('id') && !h.includes('method')) s = 68;
  else if (h.includes('checkout') && h.includes('id')) s = 66;
  else if (h.includes('cart') && h.includes('id')) s = 62;
  else if (/^ord(\s|er)?\s*id$/i.test(h) || h === 'ord id') s = 58;
  return Math.min(100, s);
}

function scoreEcommGrossHeader(h) {
  if (!h) return 0;
  if (h.includes('transaction') && h.includes('count')) return 0;
  if (h.includes('fee') && !h.includes('gross')) return 0;
  if ((h.includes('tax') || h === 'vat' || h.includes(' vat')) && !h.includes('gross')) return 0;
  if (h.includes('shipping') && !h.includes('gross') && !h.includes('order')) return 0;
  if (h.includes('discount') && !h.includes('gross')) return 0;
  let s = 0;
  if (h.includes('gross') && !h.includes('margin')) s = 96;
  else if (h.includes('order') && h.includes('total')) s = 90;
  else if (h.includes('item') && h.includes('total')) s = 72;
  else if (h.includes('product') && (h.includes('total') || h.includes('amount'))) s = 68;
  else if (h.includes('billing') && h.includes('total')) s = 70;
  else if (h.includes('charged') || h.includes('charge amount')) s = 82;
  else if (h.includes('line') && h.includes('total')) s = 80;
  else if (h === 'subtotal' || h.endsWith(' subtotal')) s = 68;
  else if (h === 'total' && !h.includes('fee') && !h.includes('tax') && !h.includes('net')) s = 74;
  else if (h === 'amount' || h === 'sale amount' || h === 'transaction amount') s = 48;
  else if (h === 'sales' || h.includes('merchandise')) s = 55;
  return Math.min(100, s);
}

function scoreEcommFeeHeader(h) {
  if (!h) return 0;
  if (h.includes('transaction') && h.includes('count')) return 0;
  /** Prefer real processing fees — tax/discount/tip columns are often numeric but not MDR. */
  if (/\b(vat|gst|hst|pst|sales tax)\b/.test(h) && !/\bfee\b/.test(h)) return 0;
  if (/\b(discount|coupon|promo code|promotion)\b/.test(h)) return 0;
  if (/\b(tip|gratuity)\b/.test(h)) return 0;
  if (/\bshipping\b/.test(h) && !/\bfee\b/.test(h)) return 0;
  if (/\brefund\b/.test(h) && !/\bfee\b/.test(h)) return 0;
  let s = 0;
  if (h.includes('processing') && h.includes('fee')) s = Math.max(s, 92);
  if (h.includes('stripe') && h.includes('fee')) s = Math.max(s, 94);
  if (h.includes('platform') && (h.includes('fee') || h.includes('cost'))) s = Math.max(s, 88);
  if (h.includes('gateway') && h.includes('fee')) s = Math.max(s, 86);
  if (h.includes('paypal') && h.includes('fee')) s = Math.max(s, 86);
  if (h.includes('square') && h.includes('fee')) s = Math.max(s, 88);
  if (h === 'fee' || h === 'fees' || h.endsWith(' fees')) s = Math.max(s, 78);
  if (h.includes('commission') || h.includes('mdr')) s = Math.max(s, 84);
  if (h.includes('card') && h.includes('processing')) s = Math.max(s, 82);
  if (h.includes('payment') && h.includes('fee') && !h.includes('method')) s = Math.max(s, 70);
  if (h === 'transaction fee' || h === 'service fee') s = Math.max(s, 72);
  if (h.includes('acquirer') && h.includes('fee')) s = Math.max(s, 80);
  if (h.includes('processor') && h.includes('fee')) s = Math.max(s, 78);
  return Math.min(100, s);
}

function scoreEcommNetHeader(h) {
  if (!h) return 0;
  if (h.includes('gross')) return 0;
  let s = 0;
  if (h === 'net' || h === 'net amount' || h === 'net total') s = 86;
  else if (h.includes('net') && h.includes('payout')) s = 84;
  else if (h.includes('payout') && h.includes('amount') && !h.includes('gross')) s = 80;
  else if (h.includes('net') && h.includes('deposit')) s = 82;
  else if (h.includes('transfer') && h.includes('amount') && !h.includes('gross')) s = 64;
  else if (h.includes('payout') && !h.includes('date')) s = 78;
  else if (h.includes('deposit') && h.includes('net')) s = 76;
  else if ((h.includes('received') || h.includes('paid out')) && !h.includes('gross')) s = 62;
  else if (h.includes('settlement') && h.includes('net')) s = 74;
  return Math.min(100, s);
}

function scoreEcommActivityDateHeader(h) {
  if (!h) return 0;
  if (isEcommOrderActivityDateHeader(h)) return 80;
  if (h.includes('created') && h.includes('at')) return 72;
  if (h === 'timestamp' || h.includes('timestamp')) return 70;
  return 0;
}

function scoreEcommBankDateHeader(h) {
  if (!h) return 0;
  if (isEcommBankOrSettlementDateHeader(h)) return 82;
  return 0;
}

function pickBestColumnIndex(hdr, used, scorer, minScore, parsedData = null, ecommRole = null) {
  let bestJ = -1;
  let bestS = minScore;
  for (let j = 0; j < hdr.length; j++) {
    if (used.has(j)) continue;
    const h = hdr[j];
    if (!h) continue;
    const bonus = parsedData && ecommRole ? ecommHeadingAliasScoreBonus(parsedData, h, ecommRole) : 0;
    const s = scorer(h) + bonus;
    if (s > bestS) {
      bestS = s;
      bestJ = j;
    }
  }
  return bestJ;
}

/**
 * Build a readable map of which workbook columns were used (and which were ignored) for support / QA.
 */
function buildEcommWorkbookColumnMeta(sheetName, headerIdx, headerRow, cols) {
  const rawHdr = Array.isArray(headerRow) ? headerRow : [];
  const labelAt = (idx) => {
    if (idx == null || idx < 0) return null;
    const c = rawHdr[idx];
    if (c == null || c === '') return null;
    const s = String(c).trim();
    return s || null;
  };
  /** @type {Record<string, { index: number, header: string | null }>} */
  const columns_used = {};
  const roleKeys = ['order', 'gross', 'fee', 'net', 'activity', 'bankSettlement'];
  for (const k of roleKeys) {
    const idx = cols[k];
    if (typeof idx === 'number' && idx >= 0) {
      columns_used[k] = { index: idx, header: labelAt(idx) };
    }
  }
  const usedIdx = new Set(
    roleKeys.map((k) => cols[k]).filter((idx) => typeof idx === 'number' && idx >= 0),
  );
  const unmapped_columns = [];
  for (let j = 0; j < rawHdr.length; j++) {
    if (usedIdx.has(j)) continue;
    const lab = labelAt(j);
    if (lab) unmapped_columns.push({ index: j, header: lab });
  }
  return {
    sheet_name: String(sheetName || '').trim() || null,
    header_row_index: headerIdx,
    columns_used,
    unmapped_columns,
    note: 'Columns chosen by header text scores (order-independent). Unmapped columns are preserved in the file but not required for order extraction.',
  };
}

/**
 * Assign order / money columns by **scores** so reordered or extra columns still map when headers are recognizable.
 * @param {unknown[]} headerRow
 * @returns {null | { order: number, gross: number, fee: number, net: number, activity: number, bankSettlement: number }}
 */
function classifyEcommOrderColumns(headerRow, parsedData = null) {
  if (!Array.isArray(headerRow)) return null;
  const hdr = headerRow.map(normCell);
  const used = new Set();

  const order = pickBestColumnIndex(hdr, used, scoreEcommOrderIdHeader, 12, parsedData, 'order');
  if (order < 0) return null;
  used.add(order);

  const fee = pickBestColumnIndex(hdr, used, scoreEcommFeeHeader, 8, parsedData, 'fee');
  if (fee >= 0) used.add(fee);
  const net = pickBestColumnIndex(hdr, used, scoreEcommNetHeader, 8, parsedData, 'net');
  if (net >= 0) used.add(net);
  const gross = pickBestColumnIndex(hdr, used, scoreEcommGrossHeader, 6, parsedData, 'gross');
  if (gross >= 0) used.add(gross);
  const activity = pickBestColumnIndex(hdr, used, scoreEcommActivityDateHeader, 6, parsedData, 'activity');
  if (activity >= 0) used.add(activity);
  const bankSettlement = pickBestColumnIndex(hdr, used, scoreEcommBankDateHeader, 6, parsedData, 'bankSettlement');
  if (bankSettlement >= 0) used.add(bankSettlement);

  const hasFeeGross = fee >= 0 && gross >= 0;
  const hasFeeNet = fee >= 0 && net >= 0;
  const hasGrossNet = gross >= 0 && net >= 0;
  if (!hasFeeGross && !hasFeeNet && !hasGrossNet) return null;

  return {
    order,
    gross: gross >= 0 ? gross : -1,
    fee: fee >= 0 ? fee : -1,
    net: net >= 0 ? net : -1,
    activity: activity >= 0 ? activity : -1,
    bankSettlement: bankSettlement >= 0 ? bankSettlement : -1,
  };
}

function countEcommOrderDataRows(rows, headerIdx, cols) {
  let n = 0;
  let blank = 0;
  for (let i = headerIdx + 1; i < Math.min(rows.length, headerIdx + 800); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) break;
    const first = normCell(row[0]);
    if (first && /^(total|subtotal|grand|summary)\b/.test(first)) break;
    const idCell = row[cols.order];
    const id = idCell != null ? String(idCell).trim() : '';
    const idLo = id.toLowerCase();
    if (idLo && /^(total|subtotal|grand\s*total|summary)\b/.test(idLo)) break;
    if (!id) {
      blank += 1;
      if (blank > 40) break;
      continue;
    }
    blank = 0;
    let g = cols.gross >= 0 ? toNum(row[cols.gross]) : null;
    const f = cols.fee >= 0 ? toNum(row[cols.fee]) : null;
    const nt = cols.net >= 0 ? toNum(row[cols.net]) : null;
    if ((g == null || !(g > 0.005)) && f != null && nt != null && f >= 0 && nt >= 0) g = nt + f;
    const ok =
      g != null &&
      g > 0.005 &&
      ((f != null && f >= 0) || (nt != null && nt >= 0 && g + 1e-6 >= nt));
    if (ok) n += 1;
  }
  return n;
}

/**
 * @param {unknown[][]} rows
 * @param {string|null} sheetRole `ecommerce` | `pos` | etc.
 * @returns {null | { headerIdx: number, cols: object, score: number }}
 */
function findBestEcommOrderGrid(rows, sheetRole, parsedData = null) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const minScore = sheetRole === 'ecommerce' ? 2 : 4;
  let best = null;
  for (let hi = 0; hi < Math.min(120, rows.length); hi++) {
    const row = rows[hi];
    if (!Array.isArray(row)) continue;
    const hdr = row.map(normCell);
    if (isLikelyBatchSummarySettlementHeader(hdr)) continue;
    const cols = classifyEcommOrderColumns(row, parsedData);
    if (!cols) continue;
    const score = countEcommOrderDataRows(rows, hi, cols);
    const richness = [cols.fee, cols.gross, cols.net].filter((i) => typeof i === 'number' && i >= 0).length;
    const bestRich = best ? [best.cols.fee, best.cols.gross, best.cols.net].filter((i) => typeof i === 'number' && i >= 0).length : -1;
    if (
      score >= minScore &&
      (!best ||
        score > best.score ||
        (score === best.score && richness > bestRich) ||
        (score === best.score && richness === bestRich && hi < best.headerIdx))
    ) {
      best = { headerIdx: hi, cols, score };
    }
  }
  return best;
}

/**
 * @param {unknown[][]} rows
 * @param {number} headerIdx
 * @param {{ order: number, gross: number, fee: number, net: number, activity: number, bankSettlement: number }} cols
 * @returns {object[]}
 */
function extractEcommOrdersAtHeader(rows, headerIdx, cols, XLSXMod) {
  const out = [];
  let blank = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) break;
    const first = normCell(row[0]);
    if (first && /^(total|subtotal|grand|summary)\b/.test(first)) break;
    const idCell = row[cols.order];
    const order_id = idCell != null ? String(idCell).trim() : '';
    const oidLo = order_id.toLowerCase();
    if (oidLo && /^(total|subtotal|grand\s*total|summary)\b/.test(oidLo)) break;
    if (!order_id) {
      blank += 1;
      if (blank > 40) break;
      continue;
    }
    if (isEcommerceSummaryOrderId(order_id)) continue;
    blank = 0;
    let gross = cols.gross >= 0 ? toNum(row[cols.gross]) : null;
    let fee = cols.fee >= 0 ? toNum(row[cols.fee]) : null;
    const net = cols.net >= 0 ? toNum(row[cols.net]) : null;
    if ((gross == null || !(gross > 0.005)) && fee != null && net != null && fee >= 0 && net >= 0) {
      gross = net + fee;
    }
    if (gross == null || !(gross > 0.005)) continue;
    if (fee == null && net != null && gross + 1e-6 >= net) fee = Math.max(0, gross - net);
    if (fee == null || !(fee >= 0)) continue;
    /** @type {Record<string, unknown>} */
    const rec = {
      order_id,
      gross_sales: gross,
      fee,
      ...(net != null && net >= 0 ? { net_amount: net } : {}),
      ecommWorkbookGridDetailRow: ECOMM_WORKBOOK_GRID_DETAIL_ROW,
    };
    if (cols.activity >= 0) {
      const y = cellToYmd(row[cols.activity], XLSXMod);
      if (y) rec.order_date = y;
    }
    if (cols.bankSettlement >= 0) {
      const y = cellToYmd(row[cols.bankSettlement], XLSXMod);
      if (y) rec.bank_credit_date = y;
    }
    out.push(rec);
  }
  return out;
}

/**
 * @param {unknown[][]} rows
 * @param {string} sheetName
 * @returns {{ list: object[], meta: object | null }}
 */
function extractEcommOrdersFromSheetRows(rows, sheetName, XLSXMod = XLSX, parsedData = null) {
  const role = workbookSheetRole(sheetName);
  if (role === 'bank' || role === 'reconciliation') return { list: [], meta: null };
  if (role === 'pos') {
    const batchLike = extractBatchesFromMatrix(rows, XLSXMod);
    if (batchLike.length >= 2) return { list: [], meta: null };
  }
  const grid = findBestEcommOrderGrid(rows, role, parsedData);
  if (!grid) return { list: [], meta: null };
  const list = extractEcommOrdersAtHeader(rows, grid.headerIdx, grid.cols, XLSXMod);
  const headerRow = rows[grid.headerIdx];
  const meta = buildEcommWorkbookColumnMeta(sheetName, grid.headerIdx, headerRow, grid.cols);
  return { list, meta };
}

/**
 * @param {object} wb
 * @param {object} XLSX
 * @returns {{ list: object[], meta: object | null }}
 */
function mergeEcommOrdersFromWorkbookWb(wb, XLSX, parsedData = null) {
  let best = [];
  let bestMeta = null;
  const tryRows = (rows, sheetName) => {
    const { list, meta } = extractEcommOrdersFromSheetRows(rows, sheetName, XLSX, parsedData);
    if (list.length > best.length) {
      best = list;
      bestMeta = meta;
    }
  };
  for (const sheetName of sheetNamesInScanOrder(wb)) {
    const sh = wb.Sheets[sheetName];
    if (!sh) continue;
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: true });
    tryRows(rows, sheetName);
  }
  if (best.length) return { list: best, meta: bestMeta };
  for (const sheetName of sheetNamesInScanOrder(wb)) {
    const sh = wb.Sheets[sheetName];
    if (!sh) continue;
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: false });
    tryRows(rows, sheetName);
  }
  return { list: best, meta: bestMeta };
}

/** Same id resolution as settlement lag (`_ecomOrderId`). */
function ecomRowOrderIdForMerge(row) {
  if (!row || typeof row !== 'object') return '';
  const v =
    row.order_id ??
    row.batch_number ??
    row.batch_id ??
    row.order_number ??
    row.order_no ??
    row.transaction_id ??
    row.primary_id ??
    row.id;
  if (v == null || v === '') return '';
  const s = String(v).trim();
  return isEcommerceSummaryOrderId(s) ? '' : s;
}

function ecomRowHasActivityRaw(row) {
  if (!row || typeof row !== 'object') return false;
  const raw =
    row.order_date ??
    row.transaction_date ??
    row.txn_date ??
    row.sale_date ??
    row.purchase_date ??
    row.created_date ??
    row.batch_close_date ??
    row.settlement_date ??
    row.pos_settlement_date;
  return raw != null && String(raw).trim() !== '';
}

function ecomRowHasBankCreditRaw(row) {
  if (!row || typeof row !== 'object') return false;
  const raw =
    row.bank_credit_date ??
    row.bank_deposit_date ??
    row.bank_posting_date ??
    row.deposit_date ??
    row.bank_statement_date ??
    row.value_date ??
    row.payout_date;
  return raw != null && String(raw).trim() !== '';
}

/**
 * Parser may return `ecomm_settlement_orders` without dates; workbook scan has Order Date / Settlement Date.
 * @param {object[]} existingEc full array (may include prior workbook stub rows)
 * @param {object[]} ecommMerged from `mergeEcommOrdersFromWorkbookWb`
 * @returns {{ list: object[], changed: boolean }}
 */
function enrichExistingEcommOrdersWithWorkbookDates(existingEc, ecommMerged) {
  if (!Array.isArray(existingEc) || !existingEc.length || !Array.isArray(ecommMerged) || !ecommMerged.length) {
    return { list: existingEc, changed: false };
  }
  const byId = new Map();
  for (const m of ecommMerged) {
    if (!m || typeof m !== 'object') continue;
    const id = String(m.order_id ?? '').trim();
    if (id) byId.set(id, m);
  }
  if (byId.size === 0) return { list: existingEc, changed: false };
  let changed = false;
  const list = existingEc.map((r) => {
    if (!r || typeof r !== 'object') return r;
    if (r.ecommWorkbookGridDetailRow === ECOMM_WORKBOOK_GRID_DETAIL_ROW) return r;
    const id = ecomRowOrderIdForMerge(r);
    if (!id) return r;
    const m = byId.get(id);
    if (!m) return r;
    const patch = {};
    if (!ecomRowHasActivityRaw(r) && m.order_date) patch.order_date = m.order_date;
    if (!ecomRowHasBankCreditRaw(r) && m.bank_credit_date) patch.bank_credit_date = m.bank_credit_date;
    if (Object.keys(patch).length === 0) return r;
    changed = true;
    return { ...r, ...patch };
  });
  return { list, changed };
}

function isBankCreditColumnHeader(h) {
  if (!h) return false;
  if (h.includes('debit') && !h.includes('credit')) return false;
  if (h.includes('balance') && !h.includes('credit')) return false;
  return (
    h === 'credit' ||
    h === 'credits' ||
    h === 'credit amount' ||
    h === 'deposit' ||
    h === 'deposit amount' ||
    h === 'money in' ||
    h === 'paid in' ||
    h === 'lodgement' ||
    h === 'amount paid in' ||
    (h.includes('paid') && h.includes('in') && !h.includes('out')) ||
    (h.includes('credit') && h.includes('amount')) ||
    (h.includes('deposit') && !h.includes('date'))
  );
}

function isBankDescriptionColumnHeader(h) {
  if (!h) return false;
  return (
    h === 'description' ||
    h === 'memo' ||
    h === 'narrative' ||
    h === 'details' ||
    h === 'transaction description' ||
    h === 'payee' ||
    (h.includes('description') && !h.includes('date'))
  );
}

/** Single Amount column (First National / many PDF exports) — exclude running balance columns. */
function isBankAmountColumnHeader(h) {
  if (!h) return false;
  if ((h.includes('running') || h.includes('available')) && h.includes('balance')) return false;
  if (h.includes('opening') && h.includes('balance')) return false;
  if (h.includes('closing') && h.includes('balance')) return false;
  if (h === 'balance' && !h.includes('transaction') && !h.includes('amount')) return false;
  return (
    h === 'amount' ||
    h === 'amt' ||
    h === 'transaction amount' ||
    (h.includes('amount') && !h.includes('balance'))
  );
}

function isBankTypeColumnHeader(h) {
  if (!h) return false;
  if (h.includes('type') && h.includes('date')) return false;
  return h === 'type' || h === 'tran type' || h === 'transaction type' || (h.includes('type') && !h.includes('date'));
}

/** Parses currency cells including accounting negatives like ($25.00). */
function toNumSignedBankAmount(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).trim();
  const neg = s.includes('(') && s.includes(')');
  const n = Number(s.replace(/[$,]/g, '').replace(/[()]/g, ''));
  if (!Number.isFinite(n)) return null;
  const mag = Math.abs(n);
  return neg ? -mag : mag;
}

function countBankCreditDataRows(rows, headerIdx, cols) {
  let n = 0;
  let blank = 0;
  for (let i = headerIdx + 1; i < Math.min(rows.length, headerIdx + 800); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) break;
    const first = normCell(row[0]);
    if (first && /^(opening|closing|balance|total)\b/.test(first)) continue;
    const c = cols.credit >= 0 ? toNum(row[cols.credit]) : null;
    if (c == null || !(c > 0.005)) {
      blank += 1;
      if (blank > 40) break;
      continue;
    }
    blank = 0;
    n += 1;
  }
  return n;
}

function countBankTypeAmountCreditRows(rows, headerIdx, cols) {
  let n = 0;
  let blank = 0;
  for (let i = headerIdx + 1; i < Math.min(rows.length, headerIdx + 800); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) break;
    const descTxt = cols.desc >= 0 ? normCell(row[cols.desc]) : '';
    if (descTxt.includes('beginning balance') || descTxt.includes('ending balance')) continue;
    const first = normCell(row[0]);
    if (first && /^(opening|closing|balance|total)\b/.test(first)) continue;
    const typ = cols.type >= 0 ? normCell(row[cols.type]) : '';
    if (!typ.includes('credit')) {
      blank += 1;
      if (blank > 40) break;
      continue;
    }
    const signed = toNumSignedBankAmount(row[cols.amount]);
    const mag = signed != null ? Math.abs(signed) : null;
    if (mag == null || !(mag > 0.005)) {
      blank += 1;
      if (blank > 40) break;
      continue;
    }
    blank = 0;
    n += 1;
  }
  return n;
}

/**
 * @param {unknown[][]} rows
 * @param {string} sheetRole
 * @returns {null | { headerIdx: number, cols: Record<string, number>, score: number, mode: 'creditCol' | 'typeAmount' }}
 */
function findBestBankDepositGrid(rows, sheetRole) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const minScore = sheetRole === 'bank' ? 2 : 4;
  let best = null;
  for (let hi = 0; hi < Math.min(50, rows.length); hi++) {
    const row = rows[hi];
    if (!Array.isArray(row)) continue;
    const hdr = row.map(normCell);
    let credit = -1;
    let desc = -1;
    let ref = -1;
    for (let j = 0; j < hdr.length; j++) {
      const h = hdr[j];
      if (!h) continue;
      if (credit < 0 && isBankCreditColumnHeader(h)) credit = j;
      if (desc < 0 && isBankDescriptionColumnHeader(h)) desc = j;
      if (ref < 0 && (h === 'reference' || h === 'ref' || h.includes('reference'))) ref = j;
    }
    if (credit >= 0 && desc >= 0) {
      const score = countBankCreditDataRows(rows, hi, { credit, desc, ref });
      if (score >= minScore && (!best || score > best.score)) {
        best = { headerIdx: hi, cols: { credit, desc, ref }, score, mode: 'creditCol' };
      }
    }

    let amount = -1;
    let typ = -1;
    desc = -1;
    ref = -1;
    for (let j = 0; j < hdr.length; j++) {
      const h = hdr[j];
      if (!h) continue;
      if (amount < 0 && isBankAmountColumnHeader(h)) amount = j;
      if (typ < 0 && isBankTypeColumnHeader(h)) typ = j;
      if (desc < 0 && isBankDescriptionColumnHeader(h)) desc = j;
      if (ref < 0 && (h === 'reference' || h === 'ref' || h.includes('reference'))) ref = j;
    }
    if (amount >= 0 && typ >= 0 && desc >= 0) {
      const score = countBankTypeAmountCreditRows(rows, hi, { amount, type: typ, desc, ref });
      if (score >= minScore && (!best || score > best.score)) {
        best = {
          headerIdx: hi,
          cols: { amount, type: typ, desc, ref },
          score,
          mode: 'typeAmount',
        };
      }
    }
  }
  return best;
}

/**
 * @param {unknown[][]} rows
 * @param {number} headerIdx
 * @param {{ credit: number, desc: number, ref: number }} cols
 * @returns {object[]}
 */
function extractBankCreditsAtHeader(rows, headerIdx, cols) {
  const out = [];
  let blank = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) break;
    const first = normCell(row[0]);
    if (first && /^(opening|closing|balance|total)\b/.test(first)) break;
    const credit = toNum(row[cols.credit]);
    if (credit == null || !(credit > 0.005)) {
      blank += 1;
      if (blank > 40) break;
      continue;
    }
    blank = 0;
    const desc = row[cols.desc] != null ? String(row[cols.desc]).trim() : '';
    const ref = cols.ref >= 0 && row[cols.ref] != null ? String(row[cols.ref]).trim() : '';
    out.push({
      description: desc || ref || 'Bank credit',
      memo: desc,
      reference: ref || undefined,
      credit,
      credit_amount: credit,
      amount: credit,
      transaction_type: 'credit',
      bankWorkbookGridDetailRow: BANK_WORKBOOK_GRID_DETAIL_ROW,
    });
  }
  return out;
}

/**
 * @param {unknown[][]} rows
 * @param {number} headerIdx
 * @param {{ amount: number, type: number, desc: number, ref: number }} cols
 * @returns {object[]}
 */
function extractBankCreditsTypeAmountAtHeader(rows, headerIdx, cols) {
  const out = [];
  let blank = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) break;
    const descTxt = cols.desc >= 0 ? normCell(row[cols.desc]) : '';
    if (descTxt.includes('beginning balance') || descTxt.includes('ending balance')) continue;
    const first = normCell(row[0]);
    if (first && /^(opening|closing|balance|total)\b/.test(first)) break;
    const typ = cols.type >= 0 ? normCell(row[cols.type]) : '';
    if (!typ.includes('credit')) {
      blank += 1;
      if (blank > 40) break;
      continue;
    }
    const signed = toNumSignedBankAmount(row[cols.amount]);
    const mag = signed != null ? Math.abs(signed) : null;
    if (mag == null || !(mag > 0.005)) {
      blank += 1;
      if (blank > 40) break;
      continue;
    }
    blank = 0;
    const desc = row[cols.desc] != null ? String(row[cols.desc]).trim() : '';
    const ref = cols.ref >= 0 && row[cols.ref] != null ? String(row[cols.ref]).trim() : '';
    const credit = Math.round(mag * 100) / 100;
    out.push({
      description: desc || ref || 'Bank credit',
      memo: desc,
      reference: ref || undefined,
      Type: 'Credit',
      type: 'Credit',
      credit,
      credit_amount: credit,
      amount: credit,
      transaction_type: 'credit',
      bankWorkbookGridDetailRow: BANK_WORKBOOK_GRID_DETAIL_ROW,
    });
  }
  return out;
}

function extractBankLinesFromSheetRows(rows, sheetName) {
  const role = workbookSheetRole(sheetName);
  if (role === 'reconciliation') return [];
  const grid = findBestBankDepositGrid(rows, role);
  if (!grid) return [];
  if (grid.mode === 'typeAmount') {
    return extractBankCreditsTypeAmountAtHeader(rows, grid.headerIdx, grid.cols);
  }
  return extractBankCreditsAtHeader(rows, grid.headerIdx, grid.cols);
}

/**
 * @param {object} wb
 * @param {object} XLSX
 * @returns {object[]}
 */
/**
 * @param {unknown[][]} rows
 * @returns {number | null} Positive dollars from the bank statement's own summary (e.g. "Total Deposits & Credits").
 */
function tryExtractBankStatementSummaryTotalDeposits(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const labelBlob = row
      .slice(0, 5)
      .map((c) => (c == null ? '' : String(c).trim()))
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!labelBlob.includes('total')) continue;
    if (!/deposit|credit/.test(labelBlob)) continue;
    if (/withdraw|debit|charge|fee\s*total|subtotal|ending|beginning/.test(labelBlob)) continue;
    let pick = null;
    for (let j = 0; j < row.length; j++) {
      const v = row[j];
      if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) > 0.5) {
        const mag = Math.abs(v);
        if (mag > (pick ?? 0)) pick = mag;
        continue;
      }
      if (v == null || v === '') continue;
      const n = toNumSignedBankAmount(v);
      if (n != null && Math.abs(n) > 0.5) {
        const mag = Math.abs(n);
        if (mag > (pick ?? 0)) pick = mag;
      }
    }
    if (pick != null && pick > 25) return Math.round(pick * 100) / 100;
  }
  return null;
}

/**
 * Use the **account summary** total deposits on bank-statement workbooks (authoritative vs summing detail rows).
 * @param {object} wb
 * @param {object} XLSX
 * @returns {number | null}
 */
function tryExtractBankStatementSummaryTotalDepositsFromWb(wb, XLSX) {
  if (!wb?.SheetNames?.length) return null;
  let best = null;
  for (const sheetName of sheetNamesInScanOrder(wb)) {
    if (workbookSheetRole(sheetName) !== 'bank') continue;
    const sh = wb.Sheets[sheetName];
    if (!sh) continue;
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: true });
    const v = tryExtractBankStatementSummaryTotalDeposits(rows);
    if (v != null && v > (best ?? 0)) best = v;
  }
  return best;
}

function mergeBankLedgerLinesFromWorkbookWb(wb, XLSX) {
  let best = [];
  const tryRows = (rows, sheetName) => {
    const got = extractBankLinesFromSheetRows(rows, sheetName);
    if (got.length > best.length) best = got;
  };
  for (const sheetName of sheetNamesInScanOrder(wb)) {
    const sh = wb.Sheets[sheetName];
    if (!sh) continue;
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: true });
    tryRows(rows, sheetName);
  }
  if (best.length) return best;
  for (const sheetName of sheetNamesInScanOrder(wb)) {
    const sh = wb.Sheets[sheetName];
    if (!sh) continue;
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: false });
    tryRows(rows, sheetName);
  }
  return best;
}

/**
 * Merge bank deposit row grids from workbook tabs (multi-sheet uploads) and optionally lift a statement summary total
 * when `bank_credits_total_verified` is missing. Safe to call after golden reconciliation merge.
 * @param {object} next
 * @param {object} wb
 * @param {object} XLSX
 */
function mergeWorkbookBankTransactionsAndOptionalVerifiedTotal(next, wb, XLSX) {
  if (!next || typeof next !== 'object' || !wb || !XLSX) return next;
  let out = next;
  const bankMerged = mergeBankLedgerLinesFromWorkbookWb(wb, XLSX);
  if (bankMerged.length > 0) {
    const existingBk = Array.isArray(out.bank_transactions) ? out.bank_transactions : [];
    const keptBk = existingBk.filter(
      (r) => !(r && typeof r === 'object' && r.bankWorkbookGridDetailRow === BANK_WORKBOOK_GRID_DETAIL_ROW),
    );
    if (keptBk.length === 0) {
      out = {
        ...out,
        bank_transactions: bankMerged,
        bank_transactions_workbook_augment: true,
      };
    }
  }
  const hasVerified =
    Number.isFinite(Number(out.bank_credits_total_verified)) && Number(out.bank_credits_total_verified) > 0.5;
  const stmtSummaryTotal = tryExtractBankStatementSummaryTotalDepositsFromWb(wb, XLSX);
  if (!hasVerified && stmtSummaryTotal != null && stmtSummaryTotal > 500) {
    out = {
      ...out,
      bank_credits_total_verified: stmtSummaryTotal,
      bank_deposits_statement_summary_verified: true,
    };
  }
  return out;
}

/**
 * Light cleanup for Square blended-fee headers like `Fees (2.6% + $0.10)`.
 * Intentionally does **not** run {@link normCell} / full statement normalization, which strips `%` / `$` / `+`
 * and would make fee-column detection impossible.
 * @param {unknown} cell
 * @returns {string}
 */
function normSquareBlendedFeeHeaderForDetection(cell) {
  let s = String(cell ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim()
    .toLowerCase();
  s = s.replace(/[\u2013\u2014\u2212]/g, '-');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s*•]+/, '').replace(/[\s*•]+$/, '').trim();
  s = s.replace(/\s*[:;]+\s*$/, '').trim();
  return s;
}

function isSquareBlendedFeeColumnHeader(cell) {
  const s = normSquareBlendedFeeHeaderForDetection(cell);
  if (!s.startsWith('fees')) return false;
  if (!s.includes('%')) return false;
  return s.includes('+') || s.includes('$') || s.includes('¢');
}

/**
 * Square Daily Summary: column like "Fees (2.6% + $0.10)" with per-day amounts; TOTAL row has sum.
 * @returns {{ label: string, amount: number, source: string } | null}
 */
function extractSquareDailyBlendedFeeColumn(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  for (let headerIdx = 0; headerIdx < Math.min(25, rows.length); headerIdx++) {
    const row = rows[headerIdx];
    if (!Array.isArray(row)) continue;
    let feeCol = -1;
    let labelRaw = '';
    for (let j = 0; j < row.length; j++) {
      const raw = row[j];
      if (raw == null || raw === '') continue;
      const label = String(raw).trim();
      if (!isSquareBlendedFeeColumnHeader(label)) continue;
      feeCol = j;
      labelRaw = label;
      break;
    }
    if (feeCol < 0) continue;

    let totalRowAmount = null;
    let rollingSum = 0;
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const dr = rows[r];
      if (!Array.isArray(dr)) continue;
      const first = normCell(dr[0]);
      if (first === 'total') {
        const v = toNum(dr[feeCol]);
        if (v != null && v > 0.005) totalRowAmount = v;
        break;
      }
      if (!first) continue;
      const v = toNum(dr[feeCol]);
      if (v != null && v >= 0) {
        rollingSum += v;
      }
    }
    const amount = totalRowAmount != null ? totalRowAmount : rollingSum;
    if (amount > 0.005 && labelRaw) {
      return { label: labelRaw, amount, source: 'square_daily_summary' };
    }
  }
  return null;
}

/**
 * Square Month Summary: label "Total Card Fees" in column A, amount in B.
 */
function extractSquareMonthTotalCardFees(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length < 2) continue;
    const a = normCell(row[0]);
    if (a === 'total card fees' || a === 'total card processing fees') {
      const v = toNum(row[1]);
      if (v != null && v > 0.005) return { label: 'Total Card Fees', amount: v, source: 'square_month_summary' };
    }
  }
  return null;
}

/**
 * Shopify **Month Summary** (label column A, amount column B): fulfilled gross, refunds, net revenue,
 * Stripe fees, payouts — same numbers as the PDF-style summary, independent of Order Detail line items.
 * @param {unknown[][]} rows
 * @returns {null | {
 *   gross_sales_fulfilled: number,
 *   refunds?: number,
 *   net_revenue?: number,
 *   total_stripe_fees?: number,
 *   net_payouts?: number,
 *   total_orders?: number,
 *   fulfilled_orders?: number,
 * }}
 */
function extractShopifyMonthSummaryScalarsFromMatrix(rows) {
  if (!Array.isArray(rows) || rows.length < 6) return null;
  let shopifyDoc = false;
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const blob = row.map((c) => normCell(c)).join(' ');
    if (blob.includes('shopify')) {
      shopifyDoc = true;
      break;
    }
  }
  if (!shopifyDoc) return null;
  /** @type {Record<string, number>} */
  const out = {};
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const k = normCell(row[0]);
    if (!k || k === 'orders' || k === 'revenue' || k === 'fees' || k === 'bank deposits') continue;
    const v = toNum(row[1]);
    if (v == null || !Number.isFinite(v)) continue;
    if (k.includes('gross sales') && k.includes('fulfilled')) {
      out.gross_sales_fulfilled = v;
    } else if (k === 'refunds') {
      out.refunds = v;
    } else if (k === 'net revenue') {
      out.net_revenue = v;
    } else if ((k.includes('stripe') && k.includes('fee')) || k.includes('total stripe fees')) {
      if (!k.includes('effective')) out.total_stripe_fees = v;
    } else if (k.includes('net payouts') && k.includes('bank')) {
      out.net_payouts = v;
    } else if (k === 'total orders') {
      out.total_orders = v;
    } else if (k === 'fulfilled') {
      out.fulfilled_orders = v;
    }
  }
  if (!(out.gross_sales_fulfilled > 0.005)) return null;
  return /** @type {any} */ (out);
}

/**
 * @param {object} wb
 * @param {object} XLSXMod
 * @returns {ReturnType<typeof extractShopifyMonthSummaryScalarsFromMatrix> & { sheet?: string } | null}
 */
function tryExtractShopifyMonthSummaryScalarsFromWorkbook(wb, XLSXMod) {
  if (!wb?.SheetNames) return null;
  for (const sn of wb.SheetNames) {
    const ln = String(sn).toLowerCase().replace(/\s+/g, ' ');
    if (!(ln.includes('month') && ln.includes('summary'))) continue;
    const sh = wb.Sheets[sn];
    if (!sh) continue;
    const rows = XLSXMod.utils.sheet_to_json(sh, { header: 1, defval: null, raw: true });
    const got = extractShopifyMonthSummaryScalarsFromMatrix(rows);
    if (got) return { ...got, sheet: sn };
  }
  return null;
}

/**
 * Prefer Month Summary roll-ups on the CNP row so Overview / linked merge match the summary sheet
 * (Order Detail still used for per-order ranking; refunded lines no longer inflate gross/fees).
 * @param {object} next
 * @param {NonNullable<ReturnType<typeof tryExtractShopifyMonthSummaryScalarsFromWorkbook>>} ms
 */
function applyShopifyMonthSummaryChannelPatch(next, ms) {
  if (!next || typeof next !== 'object' || !ms || !(ms.gross_sales_fulfilled > 0.005)) return next;
  const cs0 =
    next.channel_split && typeof next.channel_split === 'object' && !Array.isArray(next.channel_split)
      ? { ...next.channel_split }
      : {};
  const prevCnp = cs0.cnp && typeof cs0.cnp === 'object' ? { ...cs0.cnp } : {};
  const gross = Math.round(ms.gross_sales_fulfilled * 100) / 100;
  const fees =
    ms.total_stripe_fees != null && Number.isFinite(ms.total_stripe_fees) && ms.total_stripe_fees >= 0
      ? Math.round(ms.total_stripe_fees * 100) / 100
      : undefined;
  const refunds =
    ms.refunds != null && Number.isFinite(ms.refunds) && ms.refunds > 0.005 ? Math.round(ms.refunds * 100) / 100 : undefined;
  const netRev =
    ms.net_revenue != null && Number.isFinite(ms.net_revenue) && ms.net_revenue > 0.005
      ? Math.round(ms.net_revenue * 100) / 100
      : undefined;
  const netPay =
    ms.net_payouts != null && Number.isFinite(ms.net_payouts) && ms.net_payouts > 0.005
      ? Math.round(ms.net_payouts * 100) / 100
      : undefined;
  const ord = ms.total_orders;
  const fulfilled = ms.fulfilled_orders;
  const txnPick =
    fulfilled != null && Number.isFinite(fulfilled) && fulfilled >= 1
      ? Math.min(1e9, Math.floor(fulfilled))
      : ord != null && Number.isFinite(ord) && ord >= 1
        ? Math.min(1e9, Math.floor(ord))
        : undefined;
  const cnp = {
    ...prevCnp,
    channel_label: prevCnp.channel_label || 'E-commerce (Shopify)',
    gross_sales: gross,
    gross_volume: gross,
    ...(netRev != null ? { volume: netRev } : {}),
    ...(refunds != null ? { refund_volume: refunds, refunds } : {}),
    ...(fees != null ? { fees } : {}),
    ...(netPay != null ? { net_settled_volume: netPay } : {}),
    ...(txnPick != null ? { txn_count: txnPick } : {}),
    ecomm_workbook_month_summary_merge: true,
  };
  const out = {
    ...next,
    ecomm_workbook_month_summary: { ...ms },
    channel_split: { ...cs0, cnp },
  };
  if (fees != null && fees > 0.005) out.total_fees_charged = fees;
  if (netRev != null) out.ecomm_volume = netRev;
  if (netPay != null) {
    out.ecomm_net_deposit_volume = netPay;
    out.ecommerce_net_deposit = netPay;
  }
  return out;
}

/**
 * Square Month Summary tab (label column A, amounts column B): gross, refunds, net sales, card fees, payouts.
 * Same layout pattern as {@link extractShopifyMonthSummaryScalarsFromMatrix} but for POS exports.
 * @param {unknown[][]} rows
 */
function extractSquareMonthSummaryScalarsFromMatrix(rows) {
  if (!Array.isArray(rows) || rows.length < 6) return null;
  let squareDoc = false;
  for (let i = 0; i < Math.min(14, rows.length); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const blob = row.map((c) => normCell(c)).join(' ');
    if (blob.includes('square')) {
      squareDoc = true;
      break;
    }
  }
  if (!squareDoc) return null;
  /** @type {Record<string, number>} */
  const out = {};
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const k = normCell(row[0]);
    const v = toNum(row[1]);
    if (v == null || !Number.isFinite(v)) continue;
    if (k.includes('total gross sales')) out.total_gross_sales = v;
    else if (k.includes('total refunds')) out.total_refunds = v;
    else if (k.includes('total net sales')) out.total_net_sales = v;
    else if (k.includes('total card fees')) out.total_card_fees = v;
    else if ((k.includes('total square payouts') && k.includes('bank')) || k.includes('square payouts to bank'))
      out.total_square_payouts = v;
    else if (k.includes('total transactions') && !k.includes('card') && !k.includes('cash')) out.total_transactions = v;
    else if (k.includes('card transactions')) out.card_transactions = v;
    else if (k.includes('cash transactions')) out.cash_transactions = v;
    /** Channel mix: Card Sales / Cash Sales (exclude "Card % of Net", etc.). */
    else if (k.includes('cash sales') && !k.includes('card')) out.total_cash_sales = v;
    else if (k.includes('card sales') && !k.includes('cash') && !k.includes('%')) out.total_card_sales = v;
  }
  if (!(out.total_gross_sales > 0.005)) return null;
  return /** @type {any} */ (out);
}

/**
 * @param {object} wb
 * @param {object} XLSXMod
 */
function tryExtractSquareMonthSummaryScalarsFromWorkbook(wb, XLSXMod) {
  if (!wb?.SheetNames) return null;
  for (const sn of wb.SheetNames) {
    const ln = String(sn).toLowerCase().replace(/\s+/g, ' ');
    if (!(ln.includes('month') && ln.includes('summary'))) continue;
    const sh = wb.Sheets[sn];
    if (!sh) continue;
    const rows = XLSXMod.utils.sheet_to_json(sh, { header: 1, defval: null, raw: true });
    const got = extractSquareMonthSummaryScalarsFromMatrix(rows);
    if (got) return { ...got, sheet: sn };
  }
  return null;
}

/**
 * Prefer Month Summary roll-ups on the POS row so linked bundles match the Square summary tab
 * (Daily Summary still feeds batches / fee columns).
 * @param {object} next
 * @param {NonNullable<ReturnType<typeof tryExtractSquareMonthSummaryScalarsFromWorkbook>>} ms
 */
function applySquareMonthSummaryChannelPatch(next, ms) {
  if (!next || typeof next !== 'object' || !(ms.total_gross_sales > 0.005)) return next;
  const cs0 =
    next.channel_split && typeof next.channel_split === 'object' && !Array.isArray(next.channel_split)
      ? { ...next.channel_split }
      : {};
  const prevPos = cs0.pos && typeof cs0.pos === 'object' ? { ...cs0.pos } : {};
  const gross = Math.round(ms.total_gross_sales * 100) / 100;
  const netSalesMs =
    ms.total_net_sales != null && Number.isFinite(ms.total_net_sales) && ms.total_net_sales > 0.005
      ? Math.round(ms.total_net_sales * 100) / 100
      : null;
  const cardGrossRaw = ms.total_card_sales;
  const cashGrossRaw = ms.total_cash_sales;
  const cardG =
    cardGrossRaw != null && Number.isFinite(cardGrossRaw) && cardGrossRaw > 0.005
      ? Math.round(cardGrossRaw * 100) / 100
      : null;
  const cashG =
    cashGrossRaw != null && Number.isFinite(cashGrossRaw) && cashGrossRaw > 0.005
      ? Math.round(cashGrossRaw * 100) / 100
      : null;
  const sumMix = cardG != null && cashG != null ? Math.round((cardG + cashG) * 100) / 100 : null;
  /** Square Month Summary "CHANNEL MIX": Card + Cash equals **total net sales**, not gross — refunds sit above that section. */
  const mixMatchesNet =
    sumMix != null &&
    netSalesMs != null &&
    Math.abs(sumMix - netSalesMs) <= Math.max(12, 0.003 * Math.max(netSalesMs, sumMix));
  const mixMatchesGross =
    sumMix != null && Math.abs(sumMix - gross) <= Math.max(15, 0.004 * gross);
  const splitCardCash =
    cardG != null && cashG != null && (mixMatchesGross || mixMatchesNet);
  const refunds =
    ms.total_refunds != null && Number.isFinite(ms.total_refunds) && ms.total_refunds >= 0
      ? Math.round(ms.total_refunds * 100) / 100
      : undefined;
  const netSales =
    ms.total_net_sales != null && Number.isFinite(ms.total_net_sales) && ms.total_net_sales > 0.005
      ? Math.round(ms.total_net_sales * 100) / 100
      : undefined;
  const fees =
    ms.total_card_fees != null && Number.isFinite(ms.total_card_fees) && ms.total_card_fees >= 0
      ? Math.round(ms.total_card_fees * 100) / 100
      : undefined;
  const payout =
    ms.total_square_payouts != null && Number.isFinite(ms.total_square_payouts) && ms.total_square_payouts > 0.005
      ? Math.round(ms.total_square_payouts * 100) / 100
      : undefined;
  const txnPickCard =
    ms.card_transactions != null && Number.isFinite(ms.card_transactions) && ms.card_transactions >= 1
      ? Math.min(1e9, Math.floor(ms.card_transactions))
      : null;
  const txnPickFallback =
    ms.total_transactions != null && Number.isFinite(ms.total_transactions) && ms.total_transactions >= 1
      ? Math.min(1e9, Math.floor(ms.total_transactions))
      : null;
  /** Refunds / net sales allocated by gross share when Month Summary splits card vs cash (Square POS exports). */
  let posGross = gross;
  let cashRow = null;
  let posRefund = refunds;
  let cashRefund = undefined;
  let posNetVol = netSales;
  let cashNetVol = undefined;
  let txnPick = txnPickCard ?? txnPickFallback;

  if (splitCardCash) {
    const rfTot = refunds ?? 0;
    const netTot = cardG + cashG;
    let cardGrossOut = cardG;
    let cashGrossOut = cashG;
    /** Channel mix rows are net-by-channel: add each channel's share of statement refunds to match Total Gross Sales. */
    if (mixMatchesNet && netTot > 0.005 && rfTot > 0.005) {
      const toCard = Math.round(rfTot * (cardG / netTot) * 100) / 100;
      const toCash = Math.round((rfTot - toCard) * 100) / 100;
      cardGrossOut = Math.round((cardG + toCard) * 100) / 100;
      cashGrossOut = Math.round((cashG + toCash) * 100) / 100;
    }
    posGross = cardGrossOut;
    const posRf =
      gross > 0.005 && rfTot > 0 ? Math.round(rfTot * (cardG / netTot) * 100) / 100 : rfTot > 0 ? rfTot : undefined;
    cashRefund =
      rfTot > 0 && posRf != null ? Math.round((rfTot - posRf) * 100) / 100 : rfTot > 0 ? rfTot : undefined;
    posRefund = posRf;
    if (netSalesMs != null && netTot > 0.005) {
      posNetVol = Math.round(netSalesMs * (cardG / netTot) * 100) / 100;
      cashNetVol = Math.round((netSalesMs - posNetVol) * 100) / 100;
    }
    const prevCash = cs0.cash && typeof cs0.cash === 'object' ? { ...cs0.cash } : {};
    const cashTxn =
      ms.cash_transactions != null && Number.isFinite(ms.cash_transactions) && ms.cash_transactions >= 1
        ? Math.min(1e9, Math.floor(ms.cash_transactions))
        : undefined;
    cashRow = {
      ...prevCash,
      channel_label: prevCash.channel_label || 'Cash Sales',
      gross_sales: cashGrossOut,
      gross_volume: cashGrossOut,
      ...(cashNetVol != null ? { volume: cashNetVol } : { volume: cashG }),
      ...(cashRefund != null && cashRefund > 0.005 ? { refund_volume: cashRefund, refunds: cashRefund } : {}),
      ...(cashTxn != null ? { txn_count: cashTxn } : {}),
      square_month_summary_cash: true,
    };
    txnPick = txnPickCard;
  }

  const pos = {
    ...prevPos,
    channel_label: prevPos.channel_label || 'POS (linked file)',
    gross_sales: posGross,
    gross_volume: posGross,
    /** Full Month Summary POS gross (card + cash + refunds above channel mix). Channel Split / revenue roll-ups prefer this over card-only `gross_sales` when Square splits card vs cash rows. */
    ...(gross > 0.005 ? { statement_gross_volume: gross } : {}),
    ...(posNetVol != null ? { volume: posNetVol } : {}),
    ...(posRefund != null && posRefund > 0.005 ? { refund_volume: posRefund, refunds: posRefund } : {}),
    ...(fees != null ? { fees } : {}),
    ...(payout != null ? { net_settled_volume: payout } : {}),
    ...(txnPick != null ? { txn_count: txnPick } : {}),
    pos_workbook_month_summary_merge: true,
  };
  const channel_split = cashRow ? { ...cs0, pos, cash: cashRow } : { ...cs0, pos };
  const cashTop =
    cashRow && typeof cashRow.gross_sales === 'number' && cashRow.gross_sales > 0.005
      ? cashRow.gross_sales
      : cashG != null && cashG > 0.005
        ? cashG
        : null;
  const out = {
    ...next,
    pos_workbook_month_summary: { ...ms },
    channel_split,
    ...(cashTop != null ? { cash_sales: cashTop, cash_sales_volume: cashTop } : {}),
  };
  if (fees != null && fees > 0.005) out.total_fees_charged = fees;
  if (netSales != null) out.pos_volume = splitCardCash && posNetVol != null ? posNetVol : netSales;
  if (payout != null) {
    out.pos_net_deposit_volume = payout;
    out.pos_net_deposit = payout;
  }
  if (refunds != null && refunds > 0.005) out.refund_volume = refunds;
  return out;
}

function rateFromFeesColumnHeader(label) {
  const m = String(label).match(/\(([^)]+)\)/);
  return m ? m[1].trim() : '';
}

/**
 * @param {object} wb workbook from XLSX.read
 * @param {object} XLSX
 * @returns {{ label: string, amount: number, source: string, rate: string } | null}
 */
function readBlendedCardFeesFromWorkbookWb(wb, XLSX) {
  if (!wb?.SheetNames) return null;
  const names = wb.SheetNames;
  let daily = null;
  let month = null;

  for (const sn of names) {
    const ln = String(sn).toLowerCase().replace(/\s+/g, ' ');
    const sh = wb.Sheets[sn];
    if (!sh) continue;
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: true });
    if (ln.includes('daily') && ln.includes('summary')) {
      const got = extractSquareDailyBlendedFeeColumn(rows);
      if (got) daily = got;
    }
    if (ln.includes('month') && ln.includes('summary')) {
      const got = extractSquareMonthTotalCardFees(rows);
      if (got) month = got;
    }
  }

  if (daily) {
    const rate = rateFromFeesColumnHeader(daily.label);
    if (month && Math.abs(month.amount - daily.amount) > Math.max(0.5, daily.amount * 0.03)) {
      return { ...daily, amount: month.amount, source: `${daily.source}+month_reconciled`, rate };
    }
    return { ...daily, rate };
  }
  if (month) {
    return { ...month, rate: '' };
  }
  return null;
}

/**
 * Square / Clover-style workbooks often list card brands in column A and amounts in B–D.
 * Fills `card_brand_mix` when the model left it empty and headings vary by export.
 */
function sheetCellLooksLikeCardBrandLabel(cell) {
  const t = normCell(cell);
  if (!t || t.length > 52) return false;
  if (/^(total|subtotal|sum\b|gross\b|net\b|fee|fees|tax|discount|refund|import|count|qty)/.test(t)) return false;
  return (
    /^visa\b/.test(t) ||
    /^mastercard\b|^master card\b/.test(t) ||
    /^mc\b/.test(t) ||
    /^american express\b|^amex\b/.test(t) ||
    /^discover\b/.test(t) ||
    /^diners\b/.test(t) ||
    /^union ?pay\b/.test(t) ||
    /^jcb\b/.test(t) ||
    /^eftpos\b/.test(t) ||
    /^interac\b/.test(t) ||
    /^other (card|brand)/.test(t) ||
    (/^debit\b/.test(t) && t.length < 28) ||
    (/^credit\b/.test(t) && t.length < 28 && !t.includes('transaction') && !t.includes('memo'))
  );
}

function firstAmountCellInRow(row, startIdx = 1) {
  if (!Array.isArray(row)) return null;
  const end = Math.min(row.length, startIdx + 12);
  for (let i = startIdx; i < end; i++) {
    const v = toNum(row[i]);
    if (v != null && v >= 1) return v;
  }
  return null;
}

/**
 * Shopify / Stripe order exports: header row with `Order #` + `Card Brand` + `Total`, amounts in `Total` column.
 * (Square-style workbooks put brands in column A instead — see {@link extractCardBrandMixFromColumnACardRows}.)
 */
function findOrderExportCardBrandHeaderRow(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const maxScan = Math.min(rows.length, 100);
  for (let ri = 0; ri < maxScan; ri++) {
    const row = rows[ri];
    if (!Array.isArray(row) || row.length < 3) continue;
    let hasOrder = false;
    let cardCol = -1;
    let totalCol = -1;
    let subCol = -1;
    let payCol = -1;
    for (let i = 0; i < row.length; i++) {
      const t = normCell(row[i]);
      if (!t) continue;
      if (t === 'order #' || t === 'order id') hasOrder = true;
      else if (t === 'card brand') cardCol = i;
      else if (t === 'total') totalCol = i;
      else if (t === 'subtotal') subCol = i;
      else if (t === 'payment method') payCol = i;
    }
    if (!hasOrder || cardCol < 0) continue;
    const moneyCol = totalCol >= 0 ? totalCol : subCol;
    if (moneyCol < 0) continue;
    return { headerRi: ri, cardCol, moneyCol, payCol: payCol >= 0 ? payCol : null };
  }
  return null;
}

function orderExportRowCardLabelIsPlausible(s) {
  const raw = String(s ?? '').trim();
  if (!raw || raw.length > 40) return false;
  if (sheetCellLooksLikeCardBrandLabel(raw)) return true;
  const t = normCell(raw);
  if (t === 'card brand' || t === 'total' || t === 'payment method') return false;
  if (/^amex$/i.test(raw)) return true;
  if (/^mc$/i.test(raw)) return true;
  return false;
}

function extractCardBrandMixFromShopifyOrderExportGrids(wb, XLSX) {
  if (!wb?.SheetNames) return null;
  const byKey = new Map();
  for (const sn of wb.SheetNames) {
    const sh = wb.Sheets[sn];
    if (!sh) continue;
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: true });
    const meta = findOrderExportCardBrandHeaderRow(rows);
    if (!meta) continue;
    const { headerRi, cardCol, moneyCol, payCol } = meta;
    const maxR = Math.min(rows.length, headerRi + 12000);
    for (let ri = headerRi + 1; ri < maxR; ri++) {
      const row = rows[ri];
      if (!Array.isArray(row) || row.length <= Math.max(cardCol, moneyCol)) continue;
      const rawBrand = String(row[cardCol] ?? '').trim();
      if (!rawBrand || !orderExportRowCardLabelIsPlausible(rawBrand)) continue;
      if (payCol != null) {
        const pm = normCell(row[payCol]);
        if (pm && pm !== 'card' && !/\b(credit|debit|shop\s*pay|apple\s*pay|google\s*pay)\b/.test(pm)) continue;
      }
      const vol = toNum(row[moneyCol]);
      if (vol == null || !(vol > 0)) continue;
      const key = normCell(rawBrand).slice(0, 80);
      const rounded = Math.round(vol * 100) / 100;
      const prev = byKey.get(key);
      if (prev) byKey.set(key, { label: prev.label, volume: Math.round((prev.volume + rounded) * 100) / 100 });
      else byKey.set(key, { label: rawBrand, volume: rounded });
    }
  }
  const list = [...byKey.values()];
  if (list.length < 2) return null;
  return list.map((x) => ({
    label: x.label,
    volume: x.volume,
    volume_usd: x.volume,
    slug: slugifyCardOrKey(x.label) || normCell(x.label).replace(/\s+/g, '-'),
    source: 'shopify_order_export_card_brand',
  }));
}

function extractCardBrandMixFromColumnACardRows(wb, XLSX) {
  if (!wb?.SheetNames) return null;
  const byKey = new Map();
  for (const sn of wb.SheetNames) {
    const sh = wb.Sheets[sn];
    if (!sh) continue;
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null, raw: true });
    const maxR = Math.min(rows.length, 450);
    for (let ri = 0; ri < maxR; ri++) {
      const row = rows[ri];
      if (!Array.isArray(row) || row.length < 2) continue;
      if (!sheetCellLooksLikeCardBrandLabel(row[0])) continue;
      const vol = firstAmountCellInRow(row, 1);
      if (vol == null) continue;
      const rawLabel = String(row[0]).trim();
      const key = normCell(rawLabel).slice(0, 80);
      const prev = byKey.get(key);
      const rounded = Math.round(vol * 100) / 100;
      if (prev) byKey.set(key, { label: prev.label, volume: Math.round((prev.volume + rounded) * 100) / 100 });
      else byKey.set(key, { label: rawLabel, volume: rounded });
    }
  }
  const list = [...byKey.values()];
  if (list.length < 2) return null;
  return list.map((x) => ({
    label: x.label,
    volume: x.volume,
    volume_usd: x.volume,
    source: 'workbook_card_brand_row',
  }));
}

function extractCardBrandMixFromWorkbookWb(wb, XLSX) {
  const shopify = extractCardBrandMixFromShopifyOrderExportGrids(wb, XLSX);
  if (shopify && shopify.length >= 2) return shopify;
  return extractCardBrandMixFromColumnACardRows(wb, XLSX);
}

/**
 * Replace model-invented interchange/scheme/processor fee_lines with a single line from the workbook
 * when we detect Square-style blended card pricing.
 */
function maybeReplaceSyntheticFeeLinesFromWorkbook(parsedData, feeExtract) {
  if (!feeExtract || !(feeExtract.amount > 0.005) || !feeExtract.label) return parsedData;
  const lines = Array.isArray(parsedData.fee_lines) ? parsedData.fee_lines : [];
  const allSynthetic =
    lines.length === 0 || lines.every((row) => row && typeof row === 'object' && isSyntheticInterchangeSchemeProcessorFeeLine(row));
  if (!allSynthetic) return parsedData;

  const rate = feeExtract.rate || rateFromFeesColumnHeader(feeExtract.label);
  const newLine = {
    type: feeExtract.label,
    description: feeExtract.label,
    statement_line: feeExtract.label,
    rate: rate || '—',
    amount: feeExtract.amount,
    card_type: 'all',
    channel: 'POS',
    confidence: 'high',
    flagged: false,
    source: feeExtract.source,
  };

  const { interchange_fees: _i, scheme_fees: _s, service_fees: _v, other_fees: _o, ...rest } = parsedData;
  return {
    ...rest,
    fee_lines: [newLine],
    total_fees_charged: feeExtract.amount,
  };
}

function toUint8Array(bufferLike) {
  if (bufferLike instanceof Uint8Array) return bufferLike;
  if (bufferLike instanceof ArrayBuffer) return new Uint8Array(bufferLike);
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(bufferLike)) {
    const b = bufferLike;
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  }
  return new Uint8Array(bufferLike);
}

export async function augmentParsedDataWithPosBatchesFromXlsxBuffer(bufferLike, parsedData, fileName = '') {
  if (!bufferLike || !parsedData || typeof parsedData !== 'object') return parsedData;
  const name = String(fileName || '');
  if (!isTabularStatementFileName(name)) return parsedData;

  try {
    const u8 = toUint8Array(bufferLike);
    const wb = XLSX.read(u8, { type: 'array', cellDates: false });
    const golden = tryParseGoldenReconciliationWorkbookBuffer(u8);
    if (golden?.golden_reconciliation_workbook) {
      let next = { ...parsedData, ...golden };
      const sheet_roles = workbookSheetRolesList(wb);
      if (Array.isArray(sheet_roles) && sheet_roles.length) {
        next = { ...next, workbook_sheet_roles: sheet_roles };
      }
      const cardFromWb = extractCardBrandMixFromWorkbookWb(wb, XLSX);
      if (cardFromWb?.length >= 2) {
        const ex = Array.isArray(next.card_brand_mix) ? next.card_brand_mix : [];
        if (ex.length === 0) {
          next = { ...next, card_brand_mix: cardFromWb, card_brand_mix_workbook_augment: true };
        }
      }
      next = mergeWorkbookBankTransactionsAndOptionalVerifiedTotal(next, wb, XLSX);
      // Authoritative channel roll-ups + fee totals — do not replace with a single blended fee row from cell sniffing.
      return next;
    }
    const sheet_roles = workbookSheetRolesList(wb);
    const feeExtract = readBlendedCardFeesFromWorkbookWb(wb, XLSX);
    const merged = mergeBatchesFromWorkbookWb(wb, XLSX);
    const txnStubs = readPosTransactionStubsFromWorkbookWb(wb, XLSX);

    const dailyCashSum = tryExtractSquareDailyCashSalesSumFromWorkbook(wb, XLSX);
    let next = {
      ...parsedData,
      workbook_sheet_roles: sheet_roles,
      ...(dailyCashSum != null && dailyCashSum > 0.005 ? { square_pos_daily_cash_sales_sum: dailyCashSum } : {}),
    };
    if (merged.length > 0) {
      next = {
        ...next,
        pos_settlement_batches: merged,
        pos_settlement_batch_count: merged.length,
      };
    }
    if (txnStubs.length > 0) {
      // Idempotent: /api/parse and client upload both call augment; drop prior workbook stubs before re-append.
      const existing = Array.isArray(next.pos_transactions) ? next.pos_transactions : [];
      const kept = existing.filter((r) => !(r && typeof r === 'object' && r.posWorkbookGridDetailRow === POS_WORKBOOK_GRID_DETAIL_ROW));
      next = { ...next, pos_transactions: [...kept, ...txnStubs] };
    }

    const ecommPack = mergeEcommOrdersFromWorkbookWb(wb, XLSX, parsedData);
    if (ecommPack.list.length > 0) {
      const existingEc = Array.isArray(next.ecomm_settlement_orders) ? next.ecomm_settlement_orders : [];
      const keptEc = existingEc.filter(
        (r) => !(r && typeof r === 'object' && r.ecommWorkbookGridDetailRow === ECOMM_WORKBOOK_GRID_DETAIL_ROW),
      );
      if (keptEc.length === 0) {
        next = {
          ...next,
          ecomm_settlement_orders: ecommPack.list,
          ecomm_orders_workbook_augment: true,
          ...(ecommPack.meta ? { ecomm_workbook_column_mapping: ecommPack.meta } : {}),
        };
      } else {
        const { list: ecommList, changed: ecommDatesPatched } = enrichExistingEcommOrdersWithWorkbookDates(
          existingEc,
          ecommPack.list,
        );
        if (ecommDatesPatched) {
          next = {
            ...next,
            ecomm_settlement_orders: ecommList,
            ecomm_orders_workbook_date_augment: true,
            ...(ecommPack.meta ? { ecomm_workbook_column_mapping: ecommPack.meta } : {}),
          };
        }
      }
    }

    const shopifyMonthScalars = tryExtractShopifyMonthSummaryScalarsFromWorkbook(wb, XLSX);
    if (shopifyMonthScalars) {
      next = applyShopifyMonthSummaryChannelPatch(next, shopifyMonthScalars);
    }

    const squareMonthScalars = tryExtractSquareMonthSummaryScalarsFromWorkbook(wb, XLSX);
    if (squareMonthScalars) {
      next = applySquareMonthSummaryChannelPatch(next, squareMonthScalars);
    }

    next = mergeWorkbookBankTransactionsAndOptionalVerifiedTotal(next, wb, XLSX);

    const cardMixRows = extractCardBrandMixFromWorkbookWb(wb, XLSX);
    if (cardMixRows && cardMixRows.length >= 2) {
      const existingMix = Array.isArray(next.card_brand_mix) ? next.card_brand_mix : [];
      const fromShopifyOrders = cardMixRows[0]?.source === 'shopify_order_export_card_brand';
      if (fromShopifyOrders || existingMix.length === 0) {
        next = { ...next, card_brand_mix: cardMixRows, card_brand_mix_workbook_augment: true };
      }
    }

    return maybeReplaceSyntheticFeeLinesFromWorkbook(next, feeExtract);
  } catch {
    return parsedData;
  }
}

/**
 * @param {File} file
 * @param {object} parsedData
 * @returns {Promise<object>}
 */
export async function augmentParsedDataWithPosBatchesFromXlsxIfNeeded(file, parsedData) {
  if (!file || !parsedData || typeof parsedData !== 'object') return parsedData;
  const name = typeof file.name === 'string' ? file.name : '';
  if (!isTabularStatementFileName(name)) return parsedData;

  const buf = await file.arrayBuffer();
  return augmentParsedDataWithPosBatchesFromXlsxBuffer(buf, parsedData, name);
}

/**
 * Test / tooling: scan a single sheet matrix (array-of-array rows) for an e‑commerce order grid.
 * @param {unknown[][]} rows
 * @param {string} [sheetName]
 * @returns {object[]}
 */
export function tryExtractEcommOrdersFromSheetRows(rows, sheetName = 'Online orders', parsedData = null) {
  return extractEcommOrdersFromSheetRows(rows, sheetName, XLSX, parsedData).list;
}
