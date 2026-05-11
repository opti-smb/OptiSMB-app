/**
 * Per–POS-batch commission / effective fee % from batch rows on the parse.
 * Uses gross−net, stated fees, or (when needed) estimates from channel_split or expected POS %.
 */

import { getPosSettlementBatchRows } from './posBatchSettlementLag.js';
import { formatMoney, getStatementDisplayCurrency } from './currencyConversion.js';
import { collectEmbeddedGridPosRowObjects } from './posTransactionEmbedHarvest.js';

const EPS = 0.02;

function num(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : NaN;
}

function humanizeSchemaKey(key) {
  const s = String(key ?? '')
    .trim()
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!s) return '';
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function parsedFieldLabel(parsedData, fieldKey) {
  const map = parsedData?.field_labels && typeof parsedData.field_labels === 'object' ? parsedData.field_labels : null;
  const v = map?.[fieldKey];
  if (typeof v === 'string' && v.trim()) return v.trim();
  return humanizeSchemaKey(fieldKey);
}

function reportUiString(parsedData, key) {
  const ru = parsedData?.report_ui;
  if (!ru || typeof ru !== 'object') return null;
  const v = ru[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function pickPosChannelLabel(parsedData) {
  const fromRu = reportUiString(parsedData, 'pos_channel_label');
  if (fromRu) return fromRu;
  const pos = parsedData?.channel_split?.pos;
  if (pos && typeof pos === 'object') {
    const from = pos.channel_label ?? pos.label ?? pos.name ?? pos.channel;
    if (typeof from === 'string' && from.trim()) return from.trim();
  }
  const roles = parsedData?.workbook_sheet_roles;
  if (Array.isArray(roles)) {
    const hit = roles.find((r) => r && r.role === 'pos' && r.name);
    if (hit?.name && String(hit.name).trim()) return String(hit.name).trim();
  }
  return humanizeSchemaKey('pos');
}

function settlementBatchIdFieldKey(parsedData) {
  for (const row of getPosSettlementBatchRows(parsedData)) {
    if (!row || typeof row !== 'object') continue;
    const bn = row.batch_number != null && String(row.batch_number).trim() !== '';
    const bid = row.batch_id != null && String(row.batch_id).trim() !== '';
    if (bid && !bn) return 'batch_id';
    if (bn) return 'batch_number';
    if (bid) return 'batch_id';
  }
  return 'batch_number';
}

function commissionLabelKeysForSource(source) {
  if (source === 'pos_transaction_line' || source === 'pos_transaction_line_batch')
    return ['processing_fee', 'fees', 'commission', 'fee'];
  if (source === 'explicit_fees_and_gross') return ['processing_fee', 'fees', 'commission'];
  if (source === 'gross_minus_net' || source === 'fees_and_net') return ['commission', 'processing_fee', 'fees'];
  return ['commission', 'fees', 'processing_fee'];
}

function pickFeeColumnLabel(parsedData, spotlightSource) {
  const keys = commissionLabelKeysForSource(String(spotlightSource ?? ''));
  const map = parsedData?.field_labels && typeof parsedData.field_labels === 'object' ? parsedData.field_labels : null;
  for (const k of keys) {
    if (map && typeof map[k] === 'string' && map[k].trim()) return map[k].trim();
  }
  return parsedFieldLabel(parsedData, keys[0]);
}

/**
 * Labels for the POS spotlight card, from `field_labels`, `channel_split`, `report_ui`, and settlement shape.
 * @param {object} parsedData
 * @param {object|null|undefined} spotlightBatch
 */
export function buildPosSpotlightReportUi(parsedData, spotlightBatch) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  const src = spotlightBatch?.source ?? '';
  const rollup = Boolean(spotlightBatch?.channelRollup);
  const txnLine = Boolean(spotlightBatch?.transactionLine);
  const squareDay = Boolean(spotlightBatch?.squareDailySummaryRow);
  const posLab = pickPosChannelLabel(parsedData);
  const batchWord = humanizeSchemaKey('batch');
  const grossWord = parsedFieldLabel(parsedData, 'gross_sales');
  const feeWord = pickFeeColumnLabel(parsedData, src);
  const txnWord = parsedFieldLabel(parsedData, 'transaction_count');
  const batchIdKey = settlementBatchIdFieldKey(parsedData);

  return {
    spotlightSectionTitle:
      reportUiString(parsedData, 'pos_spotlight_section_title') ||
      (rollup
        ? `${posLab} — Highest commission deduction (roll-up totals)`
        : txnLine
          ? `${posLab} — Single transaction with highest fee`
          : squareDay
            ? `${posLab} — Settlement day with highest processing fees`
            : `${posLab} — ${batchWord} that deducted the highest commission`),
    batchIdLabel:
      reportUiString(parsedData, 'pos_spotlight_batch_id_label') ||
      (rollup ? 'Source' : squareDay ? 'Batch / day ID' : parsedFieldLabel(parsedData, batchIdKey)),
    orderOrTxnIdLabel:
      txnLine
        ? reportUiString(parsedData, 'pos_spotlight_order_id_label') ||
          `${humanizeSchemaKey('transaction')} / ${humanizeSchemaKey('order')} ID`
        : null,
    commissionLabel:
      reportUiString(parsedData, 'pos_spotlight_commission_label') || feeWord,
    impliedPctLabel:
      reportUiString(parsedData, 'pos_spotlight_implied_pct_label') || 'Effective %',
    transactionCountLabel:
      reportUiString(parsedData, 'pos_spotlight_transaction_count_label') ||
      (rollup
        ? 'Transactions (if stated on statement)'
        : txnLine
          ? txnWord
          : squareDay
            ? 'Card transactions (that day)'
            : 'Transactions in batch'),
    grossSalesLabel: reportUiString(parsedData, 'pos_spotlight_gross_label') || grossWord,
    netBatchLabel:
      reportUiString(parsedData, 'pos_spotlight_net_label') ||
      parsedFieldLabel(parsedData, 'net_batch_deposit') ||
      humanizeSchemaKey('net_after_fees'),
  };
}

function pickPosTxnGross(txn) {
  if (!txn || typeof txn !== 'object') return null;
  const v = num(
    txn.gross_sales ??
      txn.gross_amount ??
      txn.amount ??
      txn.charge_amount ??
      txn.ticket_amount ??
      txn.payment_amount ??
      txn.sale_amount ??
      txn.total_sales ??
      txn.volume ??
      txn.batch_gross ??
      txn.collected_amount,
  );
  return v > EPS ? v : null;
}

/**
 * Fee + gross on a single POS transaction / line row (not a settlement batch aggregate).
 * @returns {null | { gross: number, fee: number, impliedPct: number }}
 */
function resolvePosTransactionLineFee(txn) {
  if (!txn || typeof txn !== 'object') return null;
  const gross = pickPosTxnGross(txn);
  const feeDirect = pickBatchFees(txn);
  const net = pickBatchNet(txn);
  if (feeDirect != null && gross != null && gross > EPS) {
    return { gross, fee: feeDirect, impliedPct: (feeDirect / gross) * 100 };
  }
  if (gross != null && net != null && gross + EPS >= net && gross > EPS) {
    const fee = Math.max(0, gross - net);
    return { gross, fee, impliedPct: (fee / gross) * 100 };
  }
  if (feeDirect != null && net != null && net > EPS) {
    const g = net + feeDirect;
    if (g > EPS) return { gross: g, fee: feeDirect, impliedPct: (feeDirect / g) * 100 };
  }
  return null;
}

/**
 * Like {@link resolvePosTransactionLineFee} but accepts a few more POS export shapes so roll-up → max-line refinement
 * can still find the largest fee row.
 * @returns {null | { gross: number, fee: number, impliedPct: number }}
 */
function resolvePosTransactionLineFeeLoose(txn) {
  const strict = resolvePosTransactionLineFee(txn);
  if (strict) return strict;
  if (!txn || typeof txn !== 'object') return null;
  const fee = pickBatchFees(txn);
  if (!(fee > EPS)) return null;
  const gross = pickPosTxnGross(txn);
  if (gross != null && gross > EPS) {
    return { gross, fee, impliedPct: (fee / gross) * 100 };
  }
  const amt = num(txn.amount);
  if (amt > EPS && amt + EPS >= fee) {
    return { gross: amt, fee, impliedPct: (fee / amt) * 100 };
  }
  return null;
}

function pickPosTransactionOrderId(txn) {
  if (!txn || typeof txn !== 'object') return null;
  const keys = [
    'order_id',
    'orderId',
    'payment_id',
    'charge_id',
    'transaction_id',
    'txn_id',
    'sale_id',
    'receipt_id',
    'reference',
    'auth_code',
    'card_payment_id',
    'checkout_id',
    'id',
  ];
  for (const k of keys) {
    const v = txn[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s && !/^batch\b/i.test(s) && s.length <= 120) return s;
  }
  return null;
}

/**
 * When there are no `pos_settlement_batches`, pick the single POS transaction row with the largest fee (commission $).
 * @returns {null | ReturnType<typeof getPosBatchCommissionAnalysis>}
 */
function buildPosCommissionAnalysisFromPosTransactions(parsedData) {
  const txns = pickPosTransactionArrays(parsedData);
  if (!txns.length) return null;
  let bestTxn = null;
  let bestFee = -1;
  let bestResolved = null;
  for (const txn of txns) {
    const r = resolvePosTransactionLineFeeLoose(txn);
    if (!r || !(r.fee > EPS)) continue;
    const ip = r.impliedPct != null && Number.isFinite(r.impliedPct) ? r.impliedPct : 0;
    const bestIp = bestResolved?.impliedPct != null && Number.isFinite(bestResolved.impliedPct) ? bestResolved.impliedPct : 0;
    if (r.fee > bestFee + 1e-9) {
      bestFee = r.fee;
      bestTxn = txn;
      bestResolved = r;
    } else if (Math.abs(r.fee - bestFee) <= 1e-9 && bestResolved && ip > bestIp) {
      bestTxn = txn;
      bestResolved = r;
    }
  }
  if (!bestTxn || !bestResolved) return null;

  const batchId = transactionRowBatchRef(bestTxn);
  const orderOrTxnId = pickPosTransactionOrderId(bestTxn);
  const txnCount = pickBatchTransactionCount(bestTxn);
  const row = {
    batchId: batchId && String(batchId).trim() ? String(batchId).trim() : '—',
    orderOrTxnId: orderOrTxnId || null,
    transactionLine: true,
    batchCloseYmd: null,
    lineCountInBatch: 1,
    transactionCount: txnCount != null && txnCount >= 1 ? Math.round(txnCount) : 1,
    gross: bestResolved.gross,
    net: bestResolved.gross - bestResolved.fee,
    commission: bestResolved.fee,
    impliedPct: bestResolved.impliedPct,
    source: 'pos_transaction_line',
    sourceLabel: 'Single transaction fee ÷ gross',
    peer: 'na',
    vsExpected: 'na',
    flagsHigh: false,
    narrative: 'Highest processing fee on one transaction row in this file (no settlement batch table).',
    shortHighLine:
      bestResolved.impliedPct != null
        ? `${bestResolved.impliedPct.toFixed(2)}% effective on this transaction.`
        : '',
  };

  const ccy = getStatementDisplayCurrency(parsedData);
  const plainLines = [];
  const oid = orderOrTxnId ? String(orderOrTxnId) : '—';
  const bid = row.batchId !== '—' ? row.batchId : '—';
  plainLines.push(
    `${pickPosChannelLabel(parsedData)}: transaction / order ${oid}${bid !== '—' ? ` · batch ${bid}` : ''} — ${formatMoney(bestResolved.fee, ccy)} (${pickFeeColumnLabel(parsedData, row.source)}), ${bestResolved.impliedPct.toFixed(2)}% of gross; ${row.transactionCount} transaction${row.transactionCount === 1 ? '' : 's'} on this line.`,
  );

  return {
    rows: [row],
    medianImpliedPct: bestResolved.impliedPct,
    expectedPosPct: Number.isFinite(num(parsedData?.expected_pos_fee_percent ?? parsedData?.workbook_pos_fee_percent))
      ? num(parsedData?.expected_pos_fee_percent ?? parsedData?.workbook_pos_fee_percent)
      : null,
    usableRowCount: 1,
    highPayingBatches: [],
    plainLines,
    spotlightBatch: row,
    ui: buildPosSpotlightReportUi(parsedData, row),
  };
}

function pickBatchGross(row) {
  if (!row || typeof row !== 'object') return null;
  const netHint = num(
    row.net_batch_deposit ?? row.net_deposit ?? row.batch_net ?? row.net_settled_volume ?? row.net_payout,
  );
  const v = num(
    row.gross_sales ??
      row.batch_gross ??
      row.gross_volume ??
      row.total_sales ??
      row.sales_volume ??
      row.batch_total_gross ??
      row.turnover,
  );
  if (v > EPS) return v;
  const vol = num(row.volume);
  if (vol > EPS && (!Number.isFinite(netHint) || vol >= netHint + EPS)) return vol;
  const saleAmt = num(row.sale_amount ?? row.charge_amount ?? row.payment_amount);
  if (saleAmt > EPS) return saleAmt;
  const amt = num(row.amount);
  if (amt > EPS && (!Number.isFinite(netHint) || amt >= netHint + EPS)) return amt;
  return null;
}

function pickBatchNet(row) {
  if (!row || typeof row !== 'object') return null;
  const v = num(
    row.net_batch_deposit ??
      row.net_deposit ??
      row.batch_net ??
      row.net_settled_volume ??
      row.net_payout ??
      row.deposit_amount ??
      row.settlement_amount ??
      row.funded_amount ??
      row.net_amount,
  );
  if (v > EPS) return v;
  const g = num(
    row.gross_sales ??
      row.batch_gross ??
      row.gross_volume ??
      row.total_sales ??
      row.sales_volume ??
      row.batch_total_gross ??
      row.turnover,
  );
  const vol = num(row.volume);
  const grossLike = Number.isFinite(g) && g > EPS ? g : vol > EPS ? vol : NaN;
  const amt = num(row.amount);
  if (amt > EPS && Number.isFinite(grossLike) && amt + EPS < grossLike) return amt;
  return null;
}

function pickBatchFees(row) {
  const v = num(
    row.fees ??
      row.processing_fee ??
      row.fee_amount ??
      row.mdr ??
      row.commission ??
      row.processor_fees ??
      row.acquirer_fee ??
      row.total_fees,
  );
  return v >= 0 && Number.isFinite(v) ? v : null;
}

/**
 * Number of card / sale events in one POS batch when the parse exposes it (column, count field, or txn array).
 * @returns {number|null}
 */
function pickBatchTransactionCount(row) {
  if (!row || typeof row !== 'object') return null;
  if (Array.isArray(row.transactions) && row.transactions.length >= 1) return row.transactions.length;
  const txScalar = num(row.transactions);
  if (txScalar >= 1 && txScalar <= 1e9 && Number.isFinite(txScalar)) return Math.round(txScalar);

  const fromArray = (x) => (Array.isArray(x) && x.length >= 1 ? x.length : null);
  const arrLen =
    fromArray(row.transaction_list) ??
    fromArray(row.txns) ??
    fromArray(row.line_items) ??
    (Array.isArray(row.items) && row.items.length >= 1 && typeof row.items[0] === 'object'
      ? row.items.length
      : null);
  if (arrLen != null) return arrLen;

  const directKeys = [
    'transaction_count',
    'transactions_count',
    'txn_count',
    'trans_count',
    'trx_count',
    'transaction_qty',
    'num_transactions',
    'number_of_transactions',
    'no_of_transactions',
    'nbr_transactions',
    'batch_transaction_count',
    'count_of_transactions',
    'qty_transactions',
    'card_transactions',
    'ticket_count',
    'tickets',
    'payment_count',
    'charge_count',
    'authorization_count',
    'sale_count',
    'sales_count',
    'items',
    'item_count',
    'line_items_count',
  ];
  for (const k of directKeys) {
    const v = num(row[k]);
    if (v >= 1 && v <= 1e9 && Number.isFinite(v)) return Math.round(v);
  }

  const nested = row.totals ?? row.summary ?? row.batch_totals ?? row.batch_summary;
  if (nested && typeof nested === 'object') {
    const v = num(
      nested.transaction_count ??
        nested.transactions_count ??
        nested.txn_count ??
        nested.count,
    );
    if (v >= 1 && v <= 1e9 && Number.isFinite(v)) return Math.round(v);
  }

  return null;
}

function normBatchKey(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/** Loose match for “batch ref is really the order id” (e.g. `#MS1007` vs `MS1007`). */
function normEcomIdCompare(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/#/g, '')
    .replace(/\s+/g, '');
}

/** Batch / closeout id on a transaction-level row (for matching to settlement batches). */
function transactionRowBatchRef(txn) {
  if (!txn || typeof txn !== 'object') return null;
  const v =
    txn.batch_number ??
    txn.batch_id ??
    txn.batch_num ??
    txn.batch ??
    txn.closeout_id ??
    txn.closeout_batch ??
    txn.batch_ref ??
    txn.settlement_batch_id ??
    txn.settlement_id ??
    txn.pos_batch_id ??
    txn.settlement_batch ??
    txn.authorization_batch ??
    txn.merchant_batch_id;
  if (v != null && v !== '') return String(v).trim();
  const meta = txn.meta ?? txn.metadata ?? txn.details;
  if (meta && typeof meta === 'object') {
    const m =
      meta.batch_id ??
      meta.batch_number ??
      meta.settlement_batch_id ??
      meta.closeout_id ??
      meta.pos_batch_id;
    if (m != null && m !== '') return String(m).trim();
  }
  return null;
}

function batchRefsMatchStatement(batchId, txnBatchRef) {
  const a = normBatchKey(batchId);
  const b = normBatchKey(txnBatchRef);
  if (!a || !b || a === '—' || b === '—') return false;
  return a === b;
}

/**
 * Flatten statement-level POS-ish transaction arrays (parser may attach these separately from batch rows).
 */
export function pickPosTransactionArrays(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return [];
  const seen = new WeakSet();
  const out = [];
  const pushList = (L) => {
    if (!Array.isArray(L) || !L.length) return;
    for (const row of L) {
      if (!row || typeof row !== 'object' || seen.has(row)) continue;
      seen.add(row);
      out.push(row);
    }
  };
  const lists = [
    parsedData.pos_transactions,
    parsedData.pos_transaction_details,
    parsedData.pos_settlement_transactions,
    parsedData.card_present_transactions,
    parsedData.in_store_transactions,
    parsedData.batch_transactions,
    parsedData.raw_extracted?.pos_transactions,
    parsedData.raw_extracted?.pos_transaction_details,
    parsedData.extracted?.pos_transactions,
    parsedData.extracted?.pos_transaction_details,
  ];
  for (const L of lists) pushList(L);
  pushList(parsedData.transactions);
  pushList(parsedData.raw_extracted?.transactions);
  pushList(parsedData.raw_extracted_preview?.transactions);
  pushList(parsedData.extracted?.transactions);
  pushList(collectEmbeddedGridPosRowObjects(parsedData));
  return out;
}

/**
 * Count transaction rows on the parse whose batch id matches this settlement batch (same idea as batch_id on batch row).
 * @returns {number|null} null if no transaction list or no matches
 */
export function countPosTransactionsForBatchId(parsedData, batchId) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  if (!batchId || batchId === '—') return null;
  const txns = pickPosTransactionArrays(parsedData);
  if (!txns.length) return null;
  const bid = String(batchId).trim();
  if (/no batch id on export/i.test(bid)) {
    let n = 0;
    for (const txn of txns) {
      const ref = transactionRowBatchRef(txn);
      if (ref == null || String(ref).trim() === '') n += 1;
    }
    return n > 0 ? n : null;
  }
  let n = 0;
  for (const txn of txns) {
    const ref = transactionRowBatchRef(txn);
    if (ref == null) continue;
    if (batchRefsMatchStatement(batchId, ref)) n += 1;
  }
  return n > 0 ? n : null;
}

/**
 * Among `pos_transactions` rows that match `batchId`, use {@link pickBatchTransactionCount} on the line with the
 * largest resolved fee (aligned with e‑commerce batch handling). Tie on fee → larger txn count.
 * @returns {number|null}
 */
function txnCountFromHighestFeePosTxnLines(parsedData, batchId) {
  if (!parsedData || typeof parsedData !== 'object' || batchId == null || batchId === '' || batchId === '—') {
    return null;
  }
  const txns = pickPosTransactionArrays(parsedData);
  if (!txns.length) return null;
  let maxFee = -1;
  /** @type {number|null} */
  let bestTxn = null;
  let sawFeeLine = 0;
  for (const txn of txns) {
    const ref = transactionRowBatchRef(txn);
    if (ref == null || !batchRefsMatchStatement(batchId, ref)) continue;
    const r = resolvePosTransactionLineFee(txn);
    if (!r || !(r.fee >= 0) || !(r.gross > EPS)) continue;
    sawFeeLine += 1;
    const rf = r.fee;
    const tx = pickBatchTransactionCount(txn);
    const ti = tx != null && tx >= 1 && Number.isFinite(tx) ? Math.round(tx) : null;
    if (rf > maxFee + EPS) {
      maxFee = rf;
      bestTxn = ti;
    } else if (Math.abs(rf - maxFee) <= EPS && ti != null) {
      bestTxn = bestTxn == null ? ti : Math.max(bestTxn, ti);
    }
  }
  if (sawFeeLine < 1 || maxFee < -EPS / 2) return null;
  return bestTxn;
}

/**
 * Explicit count on the batch row, else txn count from the highest-fee matching payment line, else line count linked by batch id.
 */
function resolveBatchTransactionCount(batchRow, parsedData, batchId) {
  const direct = pickBatchTransactionCount(batchRow);
  if (direct != null) return direct;
  const fromHigh = txnCountFromHighestFeePosTxnLines(parsedData, batchId);
  if (fromHigh != null) return fromHigh;
  return countPosTransactionsForBatchId(parsedData, batchId);
}

function impliedPosPctFromChannelSplit(parsedData) {
  const cs = parsedData?.channel_split?.pos;
  if (!cs || typeof cs !== 'object') return null;
  const gross = num(cs.gross_volume ?? cs.gross_sales ?? cs.volume ?? cs.net_settled_volume);
  const fees = num(cs.fees);
  if (!(gross > EPS) || !(fees >= 0)) return null;
  return (fees / gross) * 100;
}

function median(values) {
  const a = values.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * @param {object} row
 * @param {object} parsedData
 * @returns {{ gross: number|null, net: number|null, commission: number|null, impliedPct: number|null, source: string }}
 */
function resolveCommission(row, parsedData) {
  const gross = pickBatchGross(row);
  const net = pickBatchNet(row);
  const fees = pickBatchFees(row);
  const expPct = num(
    parsedData?.expected_pos_fee_percent ?? parsedData?.workbook_pos_fee_percent,
  );

  if (fees != null && gross != null && gross > EPS) {
    return {
      gross,
      net: gross - fees,
      commission: fees,
      impliedPct: (fees / gross) * 100,
      source: 'explicit_fees_and_gross',
    };
  }

  if (gross != null && net != null && gross + EPS >= net) {
    const commission = Math.max(0, gross - net);
    if (gross > EPS) {
      return {
        gross,
        net,
        commission,
        impliedPct: (commission / gross) * 100,
        source: 'gross_minus_net',
      };
    }
  }

  if (fees != null && net != null && net > EPS) {
    const g = net + fees;
    if (g > EPS) {
      return {
        gross: g,
        net,
        commission: fees,
        impliedPct: (fees / g) * 100,
        source: 'fees_and_net',
      };
    }
  }

  const channelPct = impliedPosPctFromChannelSplit(parsedData);
  if (net != null && net > EPS && channelPct != null && channelPct > 0 && channelPct < 99) {
    const g = net / (1 - channelPct / 100);
    const commission = g - net;
    return {
      gross: g,
      net,
      commission,
      impliedPct: (commission / g) * 100,
      source: 'inferred_from_channel_split',
    };
  }

  if (net != null && net > EPS && expPct != null && expPct > 0 && expPct < 99) {
    const g = net / (1 - expPct / 100);
    const commission = g - net;
    return {
      gross: g,
      net,
      commission,
      impliedPct: (commission / g) * 100,
      source: 'inferred_from_expected_pos_pct',
    };
  }

  return {
    gross,
    net,
    commission: null,
    impliedPct: null,
    source: 'insufficient_data',
  };
}

function sourceNote(source) {
  switch (source) {
    case 'gross_minus_net':
      return 'Gross − net';
    case 'explicit_fees_and_gross':
      return 'Stated fees ÷ gross';
    case 'fees_and_net':
      return 'Fees + net';
    case 'inferred_from_channel_split':
      return 'Estimated (channel POS %)';
    case 'inferred_from_expected_pos_pct':
      return 'Estimated (expected POS %)';
    case 'pos_transaction_line':
      return 'Transaction fee ÷ gross';
    case 'pos_transaction_line_batch':
      return 'Σ transaction fees ÷ Σ gross (same batch id)';
    default:
      return '—';
  }
}

function buildNarrative({ impliedPct, medianPct, expectedPos, peer, vsExpected, source }) {
  const parts = [];
  if (source === 'pos_transaction_line_batch') {
    parts.push('Fees and gross summed from every payment line that shares the same batch id on the export.');
  } else if (source === 'inferred_from_channel_split') {
    parts.push('Estimated using your overall POS fee % from channel split.');
  } else if (source === 'inferred_from_expected_pos_pct') {
    parts.push('Estimated using your workbook expected POS fee %.');
  }
  if (impliedPct != null && medianPct != null && peer === 'high') {
    parts.push(
      `Effective rate is higher than most batches here (${impliedPct.toFixed(2)}% vs typical ~${medianPct.toFixed(2)}%).`,
    );
  }
  if (impliedPct != null && expectedPos != null && vsExpected === 'above') {
    parts.push(`Above your expected POS rate (${expectedPos.toFixed(2)}%).`);
  }
  if (impliedPct != null && medianPct != null && peer === 'low') {
    parts.push(`Lower effective rate than most batches (~${medianPct.toFixed(2)}% typical).`);
  }
  if (parts.length === 0 && impliedPct != null) {
    parts.push('Looks typical compared with other batches on this statement.');
  }
  if (impliedPct == null) {
    return 'Add gross + net, or fees + net, on each batch row (or set channel_split / expected POS %) to compute commission.';
  }
  return parts.join(' ');
}

/** Synthetic batch id for {@link buildPosStagedFromPosTransactionsByBatch} unbatched lines. */
const POS_UNBATCHED_TXN_LABEL = 'POS lines (no batch id on export)';

/**
 * When the spotlight winner is an **aggregate** (Σ fees in a batch group or channel_split roll-up), swap display
 * values to the **one payment line** with the largest fee so order/txn id, $, and % refer to that line only.
 */
function refineSpotlightToHighestPosFeeLine(parsedData, spotlightBatch) {
  if (!spotlightBatch || typeof spotlightBatch !== 'object') return spotlightBatch;
  const isAggBatch = spotlightBatch.source === 'pos_transaction_line_batch';
  const isRollup = Boolean(spotlightBatch.channelRollup);
  if (!isAggBatch && !isRollup) return spotlightBatch;

  const txns = pickPosTransactionArrays(parsedData);
  if (!Array.isArray(txns) || !txns.length) return spotlightBatch;

  const targetBatch = String(spotlightBatch.batchId ?? '').trim();
  /** @type {object[]} */
  let pool = [];
  if (isAggBatch) {
    if (targetBatch === POS_UNBATCHED_TXN_LABEL) {
      pool = txns.filter((t) => {
        const ref = transactionRowBatchRef(t);
        return ref == null || String(ref).trim() === '';
      });
    } else if (targetBatch && targetBatch !== '—' && !/roll-up/i.test(targetBatch)) {
      pool = txns.filter((t) => normBatchKey(transactionRowBatchRef(t)) === normBatchKey(targetBatch));
    }
  } else if (isRollup) {
    pool = txns;
  }
  if (!pool.length) return spotlightBatch;

  let bestTxn = null;
  let bestResolved = null;
  let bestFee = -1;
  for (const txn of pool) {
    const r = resolvePosTransactionLineFeeLoose(txn);
    if (!r || !(r.fee > EPS)) continue;
    const ip = r.impliedPct != null && Number.isFinite(r.impliedPct) ? r.impliedPct : 0;
    const bestIp = bestResolved?.impliedPct != null && Number.isFinite(bestResolved.impliedPct) ? bestResolved.impliedPct : 0;
    if (r.fee > bestFee + 1e-9) {
      bestFee = r.fee;
      bestTxn = txn;
      bestResolved = r;
    } else if (Math.abs(r.fee - bestFee) <= 1e-9 && bestResolved && ip > bestIp) {
      bestTxn = txn;
      bestResolved = r;
    }
  }
  if (!bestTxn || !bestResolved) return spotlightBatch;

  const batchIdRef = transactionRowBatchRef(bestTxn);
  const orderOrTxnId = pickPosTransactionOrderId(bestTxn);
  const batchId =
    batchIdRef != null && String(batchIdRef).trim()
      ? String(batchIdRef).trim()
      : isRollup
        ? String(spotlightBatch.batchId ?? '').trim() || '—'
        : targetBatch || '—';

  return {
    ...spotlightBatch,
    channelRollup: false,
    transactionLine: true,
    batchId,
    batchCloseYmd: spotlightBatch.batchCloseYmd ?? null,
    orderOrTxnId: orderOrTxnId || null,
    lineCountInBatch: 1,
    transactionCount: 1,
    gross: bestResolved.gross,
    net: bestResolved.gross - bestResolved.fee,
    commission: bestResolved.fee,
    impliedPct: bestResolved.impliedPct,
    source: 'pos_transaction_line',
    sourceLabel: sourceNote('pos_transaction_line'),
    narrative:
      'Highest processing fee on one payment line (file grouped lines into a batch or roll-up; spotlight uses the largest single-line fee).',
    shortHighLine:
      bestResolved.impliedPct != null
        ? `${bestResolved.impliedPct.toFixed(2)}% on this payment line.`
        : spotlightBatch.shortHighLine,
  };
}

/** Spotlight = largest processing commission $ on the file; tie-break by implied %; else “high” flags, else any %. */
function pickSpotlightBatch(rows, highPayingBatches) {
  const withCommission = rows.filter(
    (r) => r.commission != null && Number.isFinite(r.commission) && r.commission > EPS,
  );
  if (withCommission.length) {
    return withCommission.reduce((best, r) => {
      const cr = r.commission ?? 0;
      const cb = best.commission ?? 0;
      if (cr > cb) return r;
      if (Math.abs(cr - cb) <= EPS && (r.impliedPct ?? -1) > (best.impliedPct ?? -1)) return r;
      return best;
    });
  }
  if (highPayingBatches.length > 0) {
    return highPayingBatches.reduce((best, r) => {
      const cr = r.commission ?? 0;
      const cb = best.commission ?? 0;
      if (cr > cb) return r;
      if (Math.abs(cr - cb) <= EPS && (r.impliedPct ?? -1) > (best.impliedPct ?? -1)) return r;
      return best;
    });
  }
  const pctPool = rows.filter((r) => r.impliedPct != null && Number.isFinite(r.impliedPct));
  if (!pctPool.length) return null;
  return pctPool.reduce((a, b) => ((b.impliedPct ?? -1) > (a.impliedPct ?? -1) ? b : a));
}

function impliedDeductionFromChannelRow(row) {
  if (!row || typeof row !== 'object') return null;
  const gross = num(row.volume ?? row.gross_volume ?? row.gross_sales ?? row.net_settled_volume);
  const fees = num(row.fees);
  if (!(gross > EPS) || !(fees >= 0)) return null;
  return { gross, fees, pct: (fees / gross) * 100 };
}

function aggregatePosFromSettlementBatches(parsedData) {
  const staged = buildPosBatchStagedWithTxnCounts(parsedData);
  let sumGross = 0;
  let sumFees = 0;
  let used = 0;
  let sumTxn = 0;
  let batchesWithTxn = 0;
  for (const s of staged) {
    if (s.gross != null && s.gross > EPS && s.commission != null && s.commission >= 0) {
      sumGross += s.gross;
      sumFees += s.commission;
      used += 1;
      if (s.transactionCount != null && Number.isFinite(s.transactionCount)) {
        sumTxn += s.transactionCount;
        batchesWithTxn += 1;
      }
    }
  }
  if (!(sumGross > EPS) || used === 0) return null;
  return {
    pct: (sumFees / sumGross) * 100,
    totalGross: sumGross,
    totalFees: sumFees,
    batchCount: used,
    totalRowsOnFile: getPosSettlementBatchRows(parsedData).length,
    totalTransactionCount: batchesWithTxn > 0 ? sumTxn : null,
    batchesWithTransactionField: batchesWithTxn,
    source: 'pos_batch_aggregate',
  };
}

export function pickEcommerceOrderArrays(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return [];
  const lists = [
    parsedData.ecomm_settlement_orders,
    parsedData.ecommerce_settlement_orders,
    parsedData.ecommerce_orders,
    parsedData.ecomm_orders,
    parsedData.online_orders,
    parsedData.web_orders,
    parsedData.shopify_orders,
    parsedData.cnp_orders,
    parsedData.ecomm_transactions,
    parsedData.ecommerce_transactions,
    parsedData.cnp_transactions,
    parsedData.online_transactions,
    parsedData.ecomm_settlement_batches,
    parsedData.ecommerce_settlement_batches,
    parsedData.cnp_settlement_batches,
    parsedData.raw_extracted?.ecomm_settlement_orders,
    parsedData.raw_extracted?.ecommerce_orders,
    parsedData.raw_extracted?.ecomm_transactions,
    parsedData.raw_extracted?.ecomm_settlement_batches,
    parsedData.raw_extracted_preview?.ecomm_settlement_orders,
    parsedData.raw_extracted_preview?.ecomm_settlement_batches,
    parsedData.extracted?.ecomm_settlement_orders,
    parsedData.extracted?.ecommerce_orders,
    parsedData.extracted?.ecomm_settlement_batches,
  ];
  const out = [];
  for (const L of lists) {
    if (!Array.isArray(L) || !L.length) continue;
    for (const row of L) {
      if (row && typeof row === 'object') out.push(row);
    }
  }
  return out;
}

function pickEcommerceChannelRow(parsedData) {
  const cs = parsedData?.channel_split;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) return { key: null, row: null };
  for (const key of Object.keys(cs)) {
    if (key === 'pos' || key === 'cash') continue;
    const row = cs[key];
    if (!row || typeof row !== 'object') continue;
    const lab = String(row.channel_label ?? row.label ?? key);
    if (/cnp|ecomm|ecommerce|online/i.test(key) || /\bonline\b/i.test(lab)) return { key, row };
  }
  return { key: null, row: null };
}

function aggregateEcomFromOrderRows(rows) {
  let sumGross = 0;
  let sumFees = 0;
  let used = 0;
  let sumTxn = 0;
  let rowsWithTxn = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const gross = num(
      row.gross_amount ??
        row.gross_sales ??
        row.gross ??
        row.total ??
        row.volume ??
        row.order_total ??
        row.batch_gross ??
        row.total_sales,
    );
    const fee = num(
      row.fee ??
        row.processing_fee ??
        row.fees ??
        row.fee_amount ??
        row.commission ??
        row.mdr ??
        row.deduction ??
        row.deductions ??
        row.total_deductions ??
        row.processing_fee_deduction,
    );
    const net = num(
      row.net_amount ??
        row.net ??
        row.net_settled ??
        row.net_batch_deposit ??
        row.net_deposit ??
        row.net_payout ??
        row.payout_amount ??
        row.settlement_net,
    );
    if (fee != null && gross != null && gross > EPS) {
      sumGross += gross;
      sumFees += fee;
      used += 1;
    } else if (gross != null && net != null && gross + EPS >= net && gross > EPS) {
      sumGross += gross;
      sumFees += Math.max(0, gross - net);
      used += 1;
    } else {
      continue;
    }
    const t = pickBatchTransactionCount(row);
    if (t != null) {
      sumTxn += t;
      rowsWithTxn += 1;
    }
  }
  if (!(sumGross > EPS) || used === 0) return null;
  return {
    pct: (sumFees / sumGross) * 100,
    totalGross: sumGross,
    totalFees: sumFees,
    orderCount: used,
    totalTransactionCount: rowsWithTxn > 0 ? sumTxn : null,
    rowsWithTransactionField: rowsWithTxn,
    source: 'ecom_order_aggregate',
  };
}

/**
 * Statement-level % deducted for POS vs e‑commerce (batch/order sums when present, else channel_split).
 * @param {object} parsedData
 * @returns {null | { pos: object|null, ecom: object|null, plainLines: string[] }}
 */
export function getChannelSettlementDeductionSummary(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  const ccy = getStatementDisplayCurrency(parsedData);

  const posAgg = aggregatePosFromSettlementBatches(parsedData);
  const posSplit = impliedDeductionFromChannelRow(parsedData?.channel_split?.pos);
  const pos =
    posAgg != null
      ? {
          label: 'POS',
          pct: posAgg.pct,
          totalGross: posAgg.totalGross,
          totalFees: posAgg.totalFees,
          source: posAgg.source,
          detail: `${posAgg.batchCount} batch row(s) with gross and fees/commission.`,
        }
      : posSplit != null
        ? {
            label: 'POS',
            pct: posSplit.pct,
            totalGross: posSplit.gross,
            totalFees: posSplit.fees,
            source: 'channel_split',
            detail: 'From channel_split.pos totals on the parse.',
          }
        : null;

  const orderRows = pickEcommerceOrderArrays(parsedData);
  const ecomAgg = aggregateEcomFromOrderRows(orderRows);
  const { key: ecomKey, row: ecomRow } = pickEcommerceChannelRow(parsedData);
  const ecomSplit = ecomRow ? impliedDeductionFromChannelRow(ecomRow) : null;
  const ecom =
    ecomAgg != null
      ? {
          label: 'E‑commerce',
          pct: ecomAgg.pct,
          totalGross: ecomAgg.totalGross,
          totalFees: ecomAgg.totalFees,
          source: ecomAgg.source,
          detail: `${ecomAgg.orderCount} order row(s) with gross and fees.`,
        }
      : ecomSplit != null
        ? {
            label: 'E‑commerce',
            pct: ecomSplit.pct,
            totalGross: ecomSplit.gross,
            totalFees: ecomSplit.fees,
            source: 'channel_split',
            detail: ecomKey ? `From channel_split.${ecomKey} totals.` : 'From channel split totals.',
          }
        : null;

  if (!pos && !ecom) return null;

  const plainLines = [];
  if (pos) {
    plainLines.push(
      `POS settlement: ${pos.pct.toFixed(2)}% of gross deducted as fees (${formatMoney(pos.totalFees, ccy)} on ${formatMoney(pos.totalGross, ccy)} gross).`,
    );
  }
  if (ecom) {
    plainLines.push(
      `E‑commerce settlement: ${ecom.pct.toFixed(2)}% of gross deducted as fees (${formatMoney(ecom.totalFees, ccy)} on ${formatMoney(ecom.totalGross, ccy)} gross).`,
    );
  }

  return { pos, ecom, plainLines };
}

/**
 * One staged entry per POS settlement batch row (commission resolved), then txn counts:
 * explicit batch-row count fields → linked pos_transactions rows with matching batch id.
 */
function buildPosBatchStagedWithTxnCounts(parsedData) {
  const raw = getPosSettlementBatchRows(parsedData);
  const staged = [];
  for (const batchRow of raw) {
    if (!batchRow || typeof batchRow !== 'object') continue;
    const batchId = String(
      batchRow.batch_number ?? batchRow.batch_id ?? batchRow.batch_num ?? batchRow.id ?? batchRow.batch ?? '—',
    ).trim() || '—';
    const batchCloseYmd = String(
      batchRow.batch_close_date ?? batchRow.batch_date ?? batchRow.close_date ?? '',
    ).trim() || null;
    const transactionCount = resolveBatchTransactionCount(batchRow, parsedData, batchId);
    const resolved = resolveCommission(batchRow, parsedData);
    staged.push({
      batchId,
      batchCloseYmd,
      transactionCount,
      lineCountInBatch: 1,
      ...resolved,
      square_daily_summary_row: Boolean(batchRow.square_daily_summary_row),
    });
  }
  return staged;
}

/**
 * Compare channel_split fee % vs gross (roll-up only). Not a batch or order id — needs per-batch/per-order arrays for that.
 * @returns {string | null}
 */
export function buildChannelRollupFeePctComparisonLine(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  const cs = parsedData.channel_split;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) return null;
  const parts = [];
  const pushPart = (label, row) => {
    if (!row || typeof row !== 'object') return;
    const g = num(row.volume ?? row.gross_volume ?? row.gross_sales);
    const f = Math.abs(num(row.fees));
    if (!(g > EPS) || !Number.isFinite(f)) return;
    parts.push({ label: String(label).trim() || 'Channel', pct: (f / g) * 100 });
  };
  pushPart(pickPosChannelLabel(parsedData), cs.pos);
  const { row: ecRow } = pickEcommerceChannelRow(parsedData);
  const ecLab =
    ecRow && String(ecRow.channel_label ?? ecRow.label ?? '').trim()
      ? String(ecRow.channel_label ?? ecRow.label).trim()
      : 'E-commerce / online';
  pushPart(ecLab, ecRow ?? cs.cnp);
  pushPart('Cash', cs.cash);
  if (parts.length < 2) return null;
  const sorted = [...parts].sort((a, b) => b.pct - a.pct);
  const hi = sorted[0];
  const lo = sorted[sorted.length - 1];
  return `Among roll-up channels, ${hi.label} has the highest processing fee % vs gross (${hi.pct.toFixed(2)}%; ${lo.label} ${lo.pct.toFixed(2)}%). That compares statement sections — not a single processor batch or order ID (add pos_settlement_batches / ecomm_settlement_orders to rank those).`;
}

/**
 * When there are no `pos_settlement_batches`, still show POS fee % from rolled-up `channel_split.pos`
 * (typical PDFs with only Section A totals).
 */
function buildPosCommissionAnalysisFromChannelRollup(parsedData) {
  const raw = getPosSettlementBatchRows(parsedData);
  if (raw.length > 0) return null;
  const pos = parsedData?.channel_split?.pos;
  if (!pos || typeof pos !== 'object') return null;
  const gross = num(pos.gross_volume ?? pos.gross_sales ?? pos.volume ?? pos.net_settled_volume);
  const fees = num(pos.fees);
  if (!(gross > EPS) || !Number.isFinite(fees) || fees < EPS) return null;
  const commission = fees;
  const netFromRow = num(pos.net_settled_volume);
  const net = netFromRow > EPS ? netFromRow : gross - fees;
  const impliedPct = (commission / gross) * 100;

  const txScalar = num(pos.txn_count);
  let txn =
    txScalar >= 1 && txScalar <= 1e9 && Number.isFinite(txScalar) ? Math.round(txScalar) : null;
  if (txn == null) {
    const txArr = pickPosTransactionArrays(parsedData);
    if (txArr.length) {
      const countsByRef = new Map();
      for (const t of txArr) {
        const ref = transactionRowBatchRef(t);
        if (ref == null || String(ref).trim() === '') continue;
        const k = normBatchKey(ref);
        countsByRef.set(k, (countsByRef.get(k) ?? 0) + 1);
      }
      if (countsByRef.size > 0) txn = Math.max(...countsByRef.values());
      else txn = txArr.length;
    }
  }
  if (txn == null && Array.isArray(parsedData.transactions) && parsedData.transactions.length) {
    txn = parsedData.transactions.length;
  }

  const batchId = 'channel_split (roll-up)';
  const row = {
    batchId,
    channelRollup: true,
    batchCloseYmd: null,
    transactionCount: txn,
    lineCountInBatch: null,
    gross,
    net: Number.isFinite(net) && net > EPS ? net : gross - fees,
    commission,
    impliedPct,
    source: 'explicit_fees_and_gross',
    sourceLabel: sourceNote('explicit_fees_and_gross'),
    peer: 'na',
    vsExpected: 'na',
    flagsHigh: false,
    narrative:
      'Only rolled-up POS totals are on this file (no per-batch export). Fee % is processing fees ÷ POS gross from channel_split.',
    shortHighLine:
      impliedPct != null
        ? `${impliedPct.toFixed(2)}% effective on in-person totals (no per-batch rows to rank).`
        : '—',
  };

  const spotlightBatchRaw = row;
  const spotlightBatch = refineSpotlightToHighestPosFeeLine(parsedData, spotlightBatchRaw);
  const spotlightUi = buildPosSpotlightReportUi(parsedData, spotlightBatch);
  const ccy = getStatementDisplayCurrency(parsedData);
  const plainLines = [];
  const hasEcomOrderRows = pickEcommerceOrderArrays(parsedData).length > 0;
  const posTxCount = pickPosTransactionArrays(parsedData).length;
  if (!posTxCount) {
    if (!hasEcomOrderRows) {
      plainLines.push(
        'A specific batch number or order ID with the highest fee cannot be determined from this file: there are no pos_settlement_batches, ecomm_settlement_orders, or per-line POS rows in the parsed snapshot — only channel_split roll-ups.',
      );
    } else {
      plainLines.push(
        'A specific POS batch number with the highest fee cannot be determined from this file: there are no pos_settlement_batches or per-batch POS rows in the parsed snapshot — only channel_split roll-up totals for in-person sales. E‑commerce order rows are present for ranking the highest online processing fee by order.',
      );
    }
  }
  if (spotlightBatch.impliedPct != null) {
    const amt =
      spotlightBatch.commission != null && Number.isFinite(spotlightBatch.commission)
        ? formatMoney(spotlightBatch.commission, ccy)
        : '—';
    const feeW = pickFeeColumnLabel(parsedData, spotlightBatch.source);
    const grossL = parsedFieldLabel(parsedData, 'gross_sales');
    const txnLine =
      txn != null
        ? `${txn} payment line${txn === 1 ? '' : 's'} (same batch id on export, or total lines if unbatched)`
        : 'transaction count not on parse';
    plainLines.push(
      `${pickPosChannelLabel(parsedData)}${spotlightBatch.transactionLine ? '' : ' (roll-up)'}: ${amt} (${feeW}), ${spotlightBatch.impliedPct.toFixed(2)}% of ${grossL}; ${txnLine}.`,
    );
  }

  const exp = num(parsedData?.expected_pos_fee_percent ?? parsedData?.workbook_pos_fee_percent);
  return {
    rows: [row],
    medianImpliedPct: impliedPct,
    expectedPosPct: Number.isFinite(exp) ? exp : null,
    usableRowCount: 1,
    highPayingBatches: [],
    plainLines,
    spotlightBatch,
    ui: spotlightUi,
  };
}

/**
 * Build synthetic POS “batch” rows by summing fees and gross for every `pos_transactions` line that shares the same batch id.
 * Used when settlement batch rows are missing or unusable but the export still carries batch ids on payment lines.
 * @returns {object[]} same shape as {@link buildPosBatchStagedWithTxnCounts}
 */
function buildPosStagedFromPosTransactionsByBatch(parsedData) {
  const txns = pickPosTransactionArrays(parsedData);
  if (!txns.length) return [];
  /** @type {Map<string, { displayId: string, lines: object[], sumFee: number, sumGross: number }>} */
  const groups = new Map();
  for (const txn of txns) {
    const ref = transactionRowBatchRef(txn);
    if (ref == null || String(ref).trim() === '') continue;
    const k = normBatchKey(ref);
    if (!k || k === '—') continue;
    const displayId = String(ref).trim();
    let g = groups.get(k);
    if (!g) {
      g = { displayId, lines: [], sumFee: 0, sumGross: 0 };
      groups.set(k, g);
    }
    g.lines.push(txn);
    const r = resolvePosTransactionLineFee(txn);
    if (r && r.fee >= 0 && r.gross > EPS) {
      g.sumFee += r.fee;
      g.sumGross += r.gross;
    }
  }
  const out = [];
  for (const g of groups.values()) {
    if (!(g.sumFee > EPS) || !(g.sumGross > EPS)) continue;
    const commission = g.sumFee;
    const gross = g.sumGross;
    const net = gross - commission;
    let maxFee = -1;
    /** @type {number|null} */
    let txnAtMaxFee = null;
    for (const txn of g.lines) {
      const r = resolvePosTransactionLineFee(txn);
      if (!r || !(r.fee >= 0)) continue;
      const rf = r.fee;
      const tx = pickBatchTransactionCount(txn);
      const ti = tx != null && tx >= 1 && Number.isFinite(tx) ? Math.round(tx) : null;
      if (rf > maxFee + EPS) {
        maxFee = rf;
        txnAtMaxFee = ti;
      } else if (Math.abs(rf - maxFee) <= EPS && ti != null) {
        txnAtMaxFee = txnAtMaxFee == null ? ti : Math.max(txnAtMaxFee, ti);
      }
    }
    const txnCount = txnAtMaxFee != null && txnAtMaxFee >= 1 ? txnAtMaxFee : g.lines.length;
    out.push({
      batchId: g.displayId,
      batchCloseYmd: null,
      transactionCount: txnCount,
      lineCountInBatch: g.lines.length,
      gross,
      net,
      commission,
      impliedPct: (commission / gross) * 100,
      source: 'pos_transaction_line_batch',
    });
  }
  const unbatchedLines = [];
  for (const txn of txns) {
    const ref = transactionRowBatchRef(txn);
    if (ref == null || String(ref).trim() === '') unbatchedLines.push(txn);
  }
  if (unbatchedLines.length) {
    let sumFee = 0;
    let sumGross = 0;
    let used = 0;
    for (const txn of unbatchedLines) {
      const r = resolvePosTransactionLineFee(txn);
      if (!r || !(r.fee >= 0) || !(r.gross > EPS)) continue;
      sumFee += r.fee;
      sumGross += r.gross;
      used += 1;
    }
    if (used > 0 && sumGross > EPS && sumFee >= 0) {
      const commission = sumFee;
      const gross = sumGross;
      const net = gross - commission;
      out.push({
        batchId: POS_UNBATCHED_TXN_LABEL,
        batchCloseYmd: null,
        transactionCount: used,
        lineCountInBatch: used,
        gross,
        net,
        commission,
        impliedPct: (commission / gross) * 100,
        source: 'pos_transaction_line_batch',
      });
    }
  }
  return out;
}

/**
 * @param {object} parsedData
 * @param {object[]} staged rows from batch file and/or {@link buildPosStagedFromPosTransactionsByBatch}
 * @param {boolean} [allowTxnBatchFallback] when true and no usable batch rows, retry from transaction batch groups
 */
function buildPosAnalysisFromStaged(parsedData, staged, allowTxnBatchFallback = true) {
  const expectedPos = num(
    parsedData?.expected_pos_fee_percent ?? parsedData?.workbook_pos_fee_percent,
  );

  const withPct = staged
    .filter((r) => r.impliedPct != null && Number.isFinite(r.impliedPct))
    .map((r) => r.impliedPct);
  const medianPct = median(withPct);

  const rows = staged.map((r) => {
    let peer = 'na';
    if (r.impliedPct != null && medianPct != null) {
      if (r.impliedPct > medianPct + 0.35) peer = 'high';
      else if (r.impliedPct + 0.35 < medianPct) peer = 'low';
      else peer = 'typical';
    }

    let vsExpected = 'na';
    if (r.impliedPct != null && expectedPos != null && Number.isFinite(expectedPos)) {
      if (r.impliedPct > expectedPos + 0.2) vsExpected = 'above';
      else if (r.impliedPct + 0.2 < expectedPos) vsExpected = 'below';
      else vsExpected = 'within';
    }

    const flagsHigh =
      (r.impliedPct != null && peer === 'high') || (r.impliedPct != null && vsExpected === 'above');

    const narrative = buildNarrative({
      impliedPct: r.impliedPct,
      medianPct,
      expectedPos,
      peer,
      vsExpected,
      source: r.source,
    });

    const shortHighLine =
      r.impliedPct == null
        ? 'Could not compute commission for this batch.'
        : `${r.impliedPct.toFixed(2)}% effective${peer === 'high' ? '; high vs other batches' : ''}${vsExpected === 'above' ? '; above expected POS %' : ''}.`;

    return {
      batchId: r.batchId,
      batchCloseYmd: r.batchCloseYmd,
      transactionCount: r.transactionCount ?? null,
      lineCountInBatch: r.lineCountInBatch ?? null,
      orderOrTxnId: r.orderOrTxnId ?? null,
      gross: r.gross,
      net: r.net,
      commission: r.commission,
      impliedPct: r.impliedPct,
      source: r.source,
      sourceLabel: sourceNote(r.source),
      peer,
      vsExpected,
      flagsHigh,
      narrative,
      shortHighLine,
      squareDailySummaryRow: Boolean(r.square_daily_summary_row),
    };
  });

  let usableRowCount = rows.filter((r) => r.source !== 'insufficient_data').length;
  if (
    allowTxnBatchFallback &&
    usableRowCount === 0 &&
    pickPosTransactionArrays(parsedData).length
  ) {
    const alt = buildPosStagedFromPosTransactionsByBatch(parsedData);
    if (alt.length) return buildPosAnalysisFromStaged(parsedData, alt, false);
    const fromTx = buildPosCommissionAnalysisFromPosTransactions(parsedData);
    if (fromTx) return fromTx;
  }
  const highPayingBatches = rows.filter((r) => r.flagsHigh);
  let spotlightBatch = pickSpotlightBatch(rows, highPayingBatches);
  spotlightBatch = refineSpotlightToHighestPosFeeLine(parsedData, spotlightBatch);
  const spotlightUi = buildPosSpotlightReportUi(parsedData, spotlightBatch);

  const plainLines = [];
  const ccy = getStatementDisplayCurrency(parsedData);
  const rawRowCount = getPosSettlementBatchRows(parsedData).length;
  if (usableRowCount === 0 && rawRowCount > 0) {
    plainLines.push(
      'POS batches are on file, but no row had enough numbers to compute commission (add gross + net, fees, or expected POS %).',
    );
  } else if (spotlightBatch?.impliedPct != null) {
    const amt =
      spotlightBatch.commission != null && Number.isFinite(spotlightBatch.commission)
        ? formatMoney(spotlightBatch.commission, ccy)
        : '—';
    const txn =
      spotlightBatch.transactionCount != null
        ? `${spotlightBatch.transactionCount} transaction${spotlightBatch.transactionCount === 1 ? '' : 's'} in that batch`
        : 'transaction count not on parse';
    const feeW = pickFeeColumnLabel(parsedData, spotlightBatch.source);
    const grossL = parsedFieldLabel(parsedData, 'gross_sales');
    plainLines.push(
      `${pickPosChannelLabel(parsedData)}: ${spotlightBatch.batchId} — ${amt} (${feeW}), ${spotlightBatch.impliedPct.toFixed(2)}% of ${grossL}; ${txn}.`,
    );
  }

  return {
    rows,
    medianImpliedPct: medianPct,
    expectedPosPct: Number.isFinite(expectedPos) ? expectedPos : null,
    usableRowCount,
    highPayingBatches,
    plainLines,
    spotlightBatch,
    ui: spotlightUi,
  };
}

/**
 * Per-batch POS commission + spotlight (rows, peer flags, spotlight batch).
 * @returns {null | object}
 */
export function getPosBatchCommissionAnalysis(parsedData) {
  let staged = buildPosBatchStagedWithTxnCounts(parsedData);
  if (!staged.length) staged = buildPosStagedFromPosTransactionsByBatch(parsedData);
  if (!staged.length) {
    const fromTx = buildPosCommissionAnalysisFromPosTransactions(parsedData);
    if (fromTx) return fromTx;
    const rollup = buildPosCommissionAnalysisFromChannelRollup(parsedData);
    if (rollup) return rollup;
    return null;
  }
  return buildPosAnalysisFromStaged(parsedData, staged, true);
}

/**
 * POS settlement batches / transaction batch groups ranked by commission (highest first), for Discrepancy tables.
 * Same rows as {@link getPosBatchCommissionAnalysis}; `transactionCount` follows highest-fee line rules when linked
 * payment lines exist.
 *
 * @param {object|null|undefined} parsedData
 * @returns {{ rank: number, batchId: string, batchCloseYmd: string|null, orderOrTxnId: string|null, commission: number|null, gross: number|null, impliedPct: number|null, transactionCount: number|null, lineCountInBatch: number|null, source: string }[]}
 */
export function getPosBatchCommissionRanking(parsedData) {
  const a = getPosBatchCommissionAnalysis(parsedData);
  if (!a?.rows?.length) return [];
  const pool = a.rows.filter((r) => r.source !== 'insufficient_data');
  if (!pool.length) return [];
  const sorted = [...pool].sort((x, y) => {
    const dc = (y.commission ?? 0) - (x.commission ?? 0);
    if (Math.abs(dc) > EPS) return dc;
    const dg = (y.gross ?? 0) - (x.gross ?? 0);
    if (Math.abs(dg) > EPS) return dg;
    const dp = (y.impliedPct ?? 0) - (x.impliedPct ?? 0);
    if (Math.abs(dp) > 1e-6) return dp;
    return String(x.batchId ?? '').localeCompare(String(y.batchId ?? ''));
  });
  return sorted.map((r, i) => ({
    rank: i + 1,
    batchId: r.batchId,
    batchCloseYmd: r.batchCloseYmd ?? null,
    orderOrTxnId: r.orderOrTxnId ?? null,
    commission: r.commission,
    gross: r.gross,
    impliedPct: r.impliedPct,
    transactionCount: r.transactionCount ?? null,
    lineCountInBatch: r.lineCountInBatch ?? null,
    source: r.source,
  }));
}

function pickEcommerceOrderId(row) {
  if (!row || typeof row !== 'object') return null;
  const keys = [
    'order_id',
    'orderId',
    'transaction_id',
    'txn_id',
    'batch_number',
    'batch_id',
    'settlement_id',
    'reference',
    'auth_code',
    'invoice_id',
    'payment_id',
    'checkout_id',
    'id',
  ];
  for (const k of keys) {
    const v = row[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

/** Prefer real order / txn ids for spotlight (avoid using `batch_number` as “order id” when order fields exist). */
function pickEcommerceOrderIdForSpotlight(row) {
  if (!row || typeof row !== 'object') return null;
  const keys = [
    'order_id',
    'orderId',
    'transaction_id',
    'txn_id',
    'invoice_id',
    'payment_id',
    'checkout_id',
    'reference',
    'settlement_id',
    'auth_code',
    'id',
    'batch_number',
    'batch_id',
  ];
  for (const k of keys) {
    const v = row[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

/** Batch / settlement id on an e‑commerce settlement line (for multi-line batch rollups). */
function ecomRowBatchRef(row) {
  if (!row || typeof row !== 'object') return null;
  const v =
    row.batch_number ??
    row.batch_id ??
    row.settlement_batch_id ??
    row.ecommerce_batch_id ??
    row.online_batch_id ??
    row.settlement_batch ??
    row.cnp_batch_id;
  if (v == null || v === '') return null;
  return String(v).trim();
}

function ecomTxnIncrement(row) {
  const t = pickBatchTransactionCount(row);
  if (t != null && t >= 1) return t;
  return 1;
}

/**
 * One non-fee deduction per e‑commerce order row (refunds, returns, chargebacks, adjustments, discounts, …).
 * Uses the first populated numeric among common parser keys so mixed exports still yield one number per row.
 */
function readEcomRowOrderDeduction(row) {
  if (!row || typeof row !== 'object') return 0;
  const keys = [
    'refund_volume',
    'refunds',
    'refund_amount',
    'refund_total',
    'total_refunds',
    'returns',
    'return_amount',
    'return_volume',
    'total_returns',
    'chargeback_amount',
    'chargebacks',
    'adjustment_amount',
    'adjustments',
    'dispute_amount',
    'disputes',
    'void_amount',
    'reversal_amount',
    'sales_returns',
    'total_discounts',
    'discount_amount',
    'discounts',
  ];
  for (const k of keys) {
    if (row[k] == null || row[k] === '') continue;
    const v = num(row[k]);
    if (v != null && Number.isFinite(v) && Math.abs(v) > EPS) return Math.abs(v);
  }
  return 0;
}

function resolveEcommLineFee(row) {
  if (!row || typeof row !== 'object') return null;
  const gross = num(
    row.gross_amount ??
      row.gross_sales ??
      row.gross ??
      row.total ??
      row.volume ??
      row.order_total ??
      row.batch_gross ??
      row.total_sales ??
      row.sale_amount ??
      row.charge_amount ??
      row.order_value ??
      row.ticket_amount ??
      row.settlement_gross,
  );
  const feeDirect = num(
    row.processing_fee ??
      row.fee ??
      row.fees ??
      row.fee_amount ??
      row.commission ??
      row.total_commission ??
      row.mdr ??
      row.total_fees ??
      row.shopify_fee ??
      row.stripe_fee ??
      row.acquirer_fee ??
      row.deduction ??
      row.deductions ??
      row.total_deductions ??
      row.processing_fee_deduction ??
      row.fee_deduction,
  );
  /** Avoid `amount` here — on many statements it is gross/charge, not net, and inflates fee = gross − net. */
  const net = num(
    row.net_amount ??
      row.net ??
      row.net_settled ??
      row.net_batch_deposit ??
      row.net_deposit ??
      row.net_payout ??
      row.payout_amount ??
      row.settlement_net ??
      row.deposit_amount,
  );
  let feeVal = null;
  if (feeDirect != null && feeDirect >= 0 && gross > EPS) feeVal = feeDirect;
  else if (gross != null && net != null && gross + EPS >= net && gross > EPS) feeVal = Math.max(0, gross - net);
  if (feeVal == null || !(gross > EPS)) return null;
  return {
    gross,
    fee: feeVal,
    impliedPct: (feeVal / gross) * 100,
    transactionCount: pickBatchTransactionCount(row),
    lineId: pickEcommerceOrderIdForSpotlight(row) ?? pickEcommerceOrderId(row),
  };
}

function dedupeEcommerceCommissionRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const oid = pickEcommerceOrderIdForSpotlight(row) ?? pickEcommerceOrderId(row);
    const id = oid && String(oid).trim() ? String(oid).trim() : '_anon';
    const r = resolveEcommLineFee(row);
    const fee = r && Number.isFinite(r.fee) ? Math.round(r.fee * 100) : 0;
    const gross = r && Number.isFinite(r.gross) ? Math.round(r.gross * 100) : 0;
    const k = `${normBatchKey(id)}|${fee}|${gross}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

/**
 * Rows used to pick **highest commission** order / batch: order-level exports only (not `*_settlement_batches`),
 * deduped across `parsedData` / `raw_extracted` / `extracted` mirrors so the same line does not win twice.
 */
function pickEcommerceCommissionCandidateRows(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return [];
  const lists = [
    parsedData.ecomm_settlement_orders,
    parsedData.ecommerce_settlement_orders,
    parsedData.ecommerce_orders,
    parsedData.ecomm_orders,
    parsedData.online_orders,
    parsedData.web_orders,
    parsedData.shopify_orders,
    parsedData.cnp_orders,
    parsedData.ecomm_transactions,
    parsedData.ecommerce_transactions,
    parsedData.cnp_transactions,
    parsedData.online_transactions,
    parsedData.raw_extracted?.ecomm_settlement_orders,
    parsedData.raw_extracted?.ecommerce_orders,
    parsedData.raw_extracted?.ecomm_transactions,
    parsedData.raw_extracted_preview?.ecomm_settlement_orders,
    parsedData.extracted?.ecomm_settlement_orders,
    parsedData.extracted?.ecommerce_orders,
  ];
  const tmp = [];
  for (const L of lists) {
    if (!Array.isArray(L) || !L.length) continue;
    for (const row of L) {
      if (row && typeof row === 'object') tmp.push(row);
    }
  }
  return dedupeEcommerceCommissionRows(tmp);
}

function channelSplitGrossForEcomPct(chRow) {
  if (!chRow || typeof chRow !== 'object') return null;
  const v = num(chRow.volume ?? chRow.gross_volume ?? chRow.gross_sales);
  return v > EPS ? v : null;
}

function channelSplitTxnCount(chRow) {
  if (!chRow || typeof chRow !== 'object') return null;
  const t = pickBatchTransactionCount(chRow);
  return t != null && t >= 1 ? Math.round(t) : null;
}

function feeLineRowSaleGrossForPct(row) {
  if (!row || typeof row !== 'object') return null;
  const v = num(
    row.gross_amount ??
      row.gross_sales ??
      row.sale_amount ??
      row.transaction_amount ??
      row.volume ??
      row.amount_ex_tax ??
      row.subtotal,
  );
  return v > EPS ? v : null;
}

/** `fee_lines[]` row whose channel (or type text) indicates online / CNP. */
function feeLineChannelLooksEcommerce(row) {
  if (!row || typeof row !== 'object') return false;
  const ch = String(row.channel ?? '').trim();
  if (!ch) {
    const typ = String(row.type ?? '');
    return /\b(online|cnp|e-?commerce|card\s*not\s*present|remote|moto|web)\b/i.test(typ);
  }
  const c = ch.toLowerCase();
  if (/^pos$|\bpos only\b|\bin-?store\b|\bface\s*to\s*face\b/i.test(c) && !/\bcnp\b/i.test(c)) return false;
  return /\b(online|e-?commerce|ecomm|cnp|card\s*not\s*present|not\s*present|moto|web|digital|remote|keyed)\b/i.test(
    c,
  );
}

function ecomFeeLinePrimaryId(row, index) {
  if (!row || typeof row !== 'object') return `fee_lines[${index}]`;
  const keys = [
    'order_id',
    'orderId',
    'reference',
    'transaction_id',
    'description',
    'statement_line',
    'line_text',
    'detail',
    'memo',
    'type',
    'label',
    'name',
  ];
  for (const k of keys) {
    const s = String(row[k] ?? '').trim();
    if (s) return s.length > 140 ? `${s.slice(0, 137)}...` : s;
  }
  return `fee_lines[${index}]`;
}

/**
 * When there are no resolvable e‑commerce settlement order rows, use the largest Online/CNP `fee_lines[]` amount.
 * % is fee ÷ e‑commerce channel gross when `channel_split` has volume; otherwise fee ÷ sum of eligible online fee lines.
 * @returns {null | { kind: 'fee_line', primaryId: string, commission: number, gross: number|null, impliedPct: number, transactionCount: number|null, pctBasis: 'fee_line_row_gross'|'channel_gross'|'fee_line_sum' }}
 */
function spotlightFromEcommerceFeeLines(parsedData) {
  if (pickEcommerceCommissionCandidateRows(parsedData).length > 0) return null;
  const lines = parsedData?.fee_lines;
  if (!Array.isArray(lines) || !lines.length) return null;

  const { row: chRow } = pickEcommerceChannelRow(parsedData);
  const channelGross = chRow ? channelSplitGrossForEcomPct(chRow) : null;
  const channelTxn = chRow ? channelSplitTxnCount(chRow) : null;

  const elig = [];
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i];
    if (!row || typeof row !== 'object') continue;
    if (!feeLineChannelLooksEcommerce(row)) continue;
    const amt = num(row.amount);
    if (!(amt > EPS) || !Number.isFinite(amt)) continue;
    elig.push({ row, i, amt });
  }
  if (!elig.length) return null;

  const sumFees = elig.reduce((s, x) => s + x.amt, 0);
  if (!(sumFees > EPS)) return null;

  let best = elig[0];
  for (const x of elig) {
    if (x.amt > best.amt + EPS) best = x;
  }

  const lineGross = feeLineRowSaleGrossForPct(best.row);
  const pctBasis =
    lineGross != null && lineGross > EPS ? 'fee_line_row_gross' : channelGross != null && channelGross > EPS ? 'channel_gross' : 'fee_line_sum';
  const denom =
    pctBasis === 'fee_line_row_gross'
      ? lineGross
      : pctBasis === 'channel_gross'
        ? channelGross
        : sumFees;
  const impliedPct = denom != null && denom > EPS ? (best.amt / denom) * 100 : null;
  if (impliedPct == null || !Number.isFinite(impliedPct)) return null;

  /** One Online/CNP fee line that matches channel e‑commerce fees → statement rollup, not a per-order row. */
  if (elig.length === 1 && chRow) {
    const chFees = num(chRow.fees);
    if (chFees > EPS && Math.abs(best.amt - chFees) <= Math.max(1, chFees * 0.02)) return null;
  }

  return {
    kind: 'fee_line',
    primaryId: ecomFeeLinePrimaryId(best.row, best.i),
    commission: best.amt,
    gross: lineGross ?? channelGross ?? null,
    impliedPct,
    transactionCount: channelTxn,
    pctBasis,
  };
}

/**
 * Table chrome for e‑commerce settlement lines (titles + column headers from parse + optional `report_ui`).
 */
export function buildEcomSettlementTableUi(parsedData) {
  const defaults = () => ({
    sectionTitle: humanizeSchemaKey('ecommerce'),
    lineIdLabel: humanizeSchemaKey('order_id'),
    feeLabel: humanizeSchemaKey('fees'),
    pctLabel: humanizeSchemaKey('percent'),
    txnLabel: humanizeSchemaKey('transaction_count'),
  });
  if (!parsedData || typeof parsedData !== 'object') return defaults();

  const ruPick = (k) => reportUiString(parsedData, k);
  const { key, row: chRow } = pickEcommerceChannelRow(parsedData);
  const chShort =
    ruPick('ecom_channel_label') ||
    (chRow && String(chRow.channel_label ?? chRow.label ?? '').trim()) ||
    (key ? humanizeSchemaKey(key) : humanizeSchemaKey('ecommerce'));
  const grossWord = parsedFieldLabel(parsedData, 'gross_sales');
  const feeNoun = humanizeSchemaKey('fee');

  return {
    sectionTitle:
      ruPick('ecom_settlement_section_title') ||
      `${chShort} — ${humanizeSchemaKey('settlement')} ${humanizeSchemaKey('lines')}`,
    lineIdLabel: ruPick('ecom_settlement_line_id_label') || parsedFieldLabel(parsedData, 'order_id'),
    feeLabel: ruPick('ecom_settlement_fee_label') || parsedFieldLabel(parsedData, 'fees'),
    pctLabel: ruPick('ecom_settlement_pct_label') || `${feeNoun} % (${grossWord})`,
    txnLabel: ruPick('ecom_settlement_txn_label') || parsedFieldLabel(parsedData, 'transaction_count'),
  };
}

/**
 * Order / batch labels that are statement rollups, not real transaction IDs (e.g. workbook "TOTALS" row).
 * @param {unknown} id
 * @returns {boolean}
 */
export function isEcommerceSummaryOrderId(id) {
  if (id == null) return false;
  const s = String(id).trim().toLowerCase();
  if (!s) return false;
  if (/^(total|totals|grand\s*total|subtotal|summary|net\s*total|gross\s*total)$/i.test(s)) return true;
  if (/^total[\s_-]/i.test(s)) return true;
  return false;
}

function normLinkageToken(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normLinkageAlnum(s) {
  return String(s ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

/** POS batch / settlement ids for matching bank memo or description text. */
export function getPosBatchReferenceKeysForLinkage(parsedData) {
  const keys = new Set();
  const ids = new Set();
  for (const row of getPosSettlementBatchRows(parsedData)) {
    if (!row || typeof row !== 'object') continue;
    for (const k of ['batch_number', 'batch_id', 'batch_num', 'id', 'batch', 'reference']) {
      const v = row[k];
      if (v == null || v === '') continue;
      const s = String(v).trim();
      if (!s) continue;
      keys.add(normLinkageToken(s));
      const lo = normLinkageAlnum(s);
      if (lo.length >= 3) ids.add(lo);
    }
  }
  return { keys, ids };
}

/** E‑commerce order / txn ids for matching bank memo or description text. */
export function getEcommerceOrderReferenceKeysForLinkage(parsedData) {
  const keys = new Set();
  const ids = new Set();
  for (const row of pickEcommerceOrderArrays(parsedData)) {
    if (!row || typeof row !== 'object') continue;
    const id = pickEcommerceOrderIdForSpotlight(row) ?? pickEcommerceOrderId(row);
    if (!id || isEcommerceSummaryOrderId(id)) continue;
    const s = String(id).trim();
    keys.add(normLinkageToken(s));
    const lo = normLinkageAlnum(s);
    if (lo.length >= 3) ids.add(lo);
  }
  return { keys, ids };
}

/**
 * One row per e‑commerce settlement line on the parse (fee and % from that line’s gross).
 * @returns {{ lineId: string, commission: number, impliedPct: number, transactionCount: number|null }[]}
 */
export function getEcommerceSettlementTableRows(parsedData) {
  const out = [];
  for (const row of pickEcommerceCommissionCandidateRows(parsedData)) {
    const r = resolveEcommLineFee(row);
    if (!r) continue;
    const lineId = r.lineId ?? '—';
    if (isEcommerceSummaryOrderId(lineId)) continue;
    out.push({
      lineId,
      commission: r.fee,
      impliedPct: r.impliedPct,
      transactionCount: r.transactionCount ?? null,
    });
  }
  return out;
}

/**
 * Aggregated order / batch commission candidates from settlement arrays (same rules as spotlight).
 * @param {object[]} rows
 * @returns {{ kind: 'order'|'batch', primaryId: string, commission: number, gross: number, impliedPct: number, transactionCount: number|null, lineCountInBatch?: number }[]}
 */
function collectEcommerceSettlementCommissionCandidates(rows) {
  if (!rows.length) return [];

  /** @type {Map<string, { displayId: string, fees: number, gross: number, txnUnits: number, lineCount: number, firstOrderId: string|null, maxFeeInBatch: number, txnAtMaxFee: number|null, orderIdAtMaxFee: string|null, grossAtMaxFee: number }>} */
  const byKey = new Map();
  const orderCandidates = [];

  for (const row of rows) {
    const r = resolveEcommLineFee(row);
    if (!r || r.fee == null || !(r.fee >= 0) || !(r.gross > EPS)) continue;

    const bref = ecomRowBatchRef(row);
    const oidForBatch = pickEcommerceOrderIdForSpotlight(row) ?? r.lineId;
    const oidNorm = oidForBatch && String(oidForBatch).trim() ? normEcomIdCompare(String(oidForBatch).trim()) : '';
    const brefNorm = normEcomIdCompare(String(bref));
    const batchRefIsJustOrderId = oidNorm && brefNorm && oidNorm === brefNorm;

    if (bref && !batchRefIsJustOrderId) {
      const k = normBatchKey(bref);
      if (!k || k === '—' || isEcommerceSummaryOrderId(k) || isEcommerceSummaryOrderId(String(bref).trim())) continue;
      const cur =
        byKey.get(k) ??
        ({
          displayId: String(bref).trim(),
          fees: 0,
          gross: 0,
          txnUnits: 0,
          lineCount: 0,
          firstOrderId: null,
          maxFeeInBatch: Number.NEGATIVE_INFINITY,
          txnAtMaxFee: null,
          orderIdAtMaxFee: null,
          grossAtMaxFee: 0,
        });
      cur.fees += r.fee;
      cur.gross += r.gross;
      cur.txnUnits += ecomTxnIncrement(row);
      cur.lineCount += 1;
      const oidLine = pickEcommerceOrderIdForSpotlight(row);
      const oidLineTrim = oidLine && String(oidLine).trim() ? String(oidLine).trim() : null;
      if (r.fee > cur.maxFeeInBatch + 1e-9) {
        cur.maxFeeInBatch = r.fee;
        const tx = pickBatchTransactionCount(row);
        cur.txnAtMaxFee = tx != null && tx >= 1 && Number.isFinite(tx) ? Math.round(tx) : null;
        cur.orderIdAtMaxFee = oidLineTrim && !isEcommerceSummaryOrderId(oidLineTrim) ? oidLineTrim : null;
        cur.grossAtMaxFee = r.gross;
      } else if (Math.abs(r.fee - cur.maxFeeInBatch) <= 1e-9) {
        const tx = pickBatchTransactionCount(row);
        if (tx != null && tx >= 1 && Number.isFinite(tx)) {
          const ti = Math.round(tx);
          cur.txnAtMaxFee = cur.txnAtMaxFee == null ? ti : Math.max(cur.txnAtMaxFee, ti);
        }
        if (oidLineTrim && !isEcommerceSummaryOrderId(oidLineTrim)) {
          if (!cur.orderIdAtMaxFee || oidLineTrim.localeCompare(cur.orderIdAtMaxFee) < 0) {
            cur.orderIdAtMaxFee = oidLineTrim;
            cur.grossAtMaxFee = r.gross;
          }
        }
      }
      if (!cur.firstOrderId) {
        const oid = pickEcommerceOrderIdForSpotlight(row);
        const o = oid && String(oid).trim() ? String(oid).trim() : null;
        if (o && !isEcommerceSummaryOrderId(o)) cur.firstOrderId = o;
      }
      byKey.set(k, cur);
    } else {
      const oid = pickEcommerceOrderIdForSpotlight(row) ?? r.lineId;
      const primaryId = oid && String(oid).trim() ? String(oid).trim() : '—';
      if (isEcommerceSummaryOrderId(primaryId)) continue;
      const br = bref ? String(bref).trim() : null;
      orderCandidates.push({
        kind: 'order',
        primaryId,
        batchRef: br && !isEcommerceSummaryOrderId(br) ? br : null,
        commission: r.fee,
        gross: r.gross,
        impliedPct: r.impliedPct,
        transactionCount: r.transactionCount ?? null,
      });
    }
  }

  const multiBatchCandidates = [];
  const singleBatchAsOrders = [];
  for (const agg of byKey.values()) {
    if (isEcommerceSummaryOrderId(agg.displayId)) continue;
    if (agg.lineCount >= 2) {
      const maxLineFee =
        Number.isFinite(agg.maxFeeInBatch) && agg.maxFeeInBatch > Number.NEGATIVE_INFINITY / 2
          ? agg.maxFeeInBatch
          : agg.fees;
      const grossForPct = agg.grossAtMaxFee > EPS ? agg.grossAtMaxFee : agg.gross;
      const txnFromHighestFeeLine =
        agg.txnAtMaxFee != null && agg.txnAtMaxFee >= 1 ? agg.txnAtMaxFee : null;
      const txnFallback = agg.txnUnits > 0 ? Math.round(agg.txnUnits) : agg.lineCount;
      const primaryId =
        agg.orderIdAtMaxFee && !isEcommerceSummaryOrderId(agg.orderIdAtMaxFee)
          ? agg.orderIdAtMaxFee
          : agg.firstOrderId && !isEcommerceSummaryOrderId(agg.firstOrderId)
            ? agg.firstOrderId
            : agg.displayId;
      multiBatchCandidates.push({
        kind: 'batch',
        primaryId,
        batchRef: String(agg.displayId).trim(),
        commission: maxLineFee,
        gross: grossForPct,
        impliedPct: grossForPct > EPS ? (maxLineFee / grossForPct) * 100 : agg.gross > EPS ? (maxLineFee / agg.gross) * 100 : null,
        transactionCount: txnFromHighestFeeLine ?? txnFallback,
        lineCountInBatch: agg.lineCount,
      });
    } else {
      const maxLineFee =
        Number.isFinite(agg.maxFeeInBatch) && agg.maxFeeInBatch > Number.NEGATIVE_INFINITY / 2
          ? agg.maxFeeInBatch
          : agg.fees;
      const grossForPct = agg.grossAtMaxFee > EPS ? agg.grossAtMaxFee : agg.gross;
      const txnFromHighestFeeLine =
        agg.txnAtMaxFee != null && agg.txnAtMaxFee >= 1 ? agg.txnAtMaxFee : null;
      const txnFallback = agg.txnUnits > 0 ? Math.round(agg.txnUnits) : Math.max(1, agg.lineCount);
      const primaryId =
        agg.orderIdAtMaxFee && !isEcommerceSummaryOrderId(agg.orderIdAtMaxFee)
          ? agg.orderIdAtMaxFee
          : agg.firstOrderId && normBatchKey(agg.firstOrderId) !== normBatchKey(agg.displayId)
            ? agg.firstOrderId
            : agg.displayId;
      if (isEcommerceSummaryOrderId(primaryId)) continue;
      const impliedPct =
        grossForPct > EPS
          ? (maxLineFee / grossForPct) * 100
          : agg.gross > EPS
            ? (maxLineFee / agg.gross) * 100
            : null;
      singleBatchAsOrders.push({
        kind: 'order',
        primaryId,
        batchRef: String(agg.displayId).trim(),
        commission: maxLineFee,
        gross: grossForPct,
        impliedPct,
        transactionCount: txnFromHighestFeeLine ?? txnFallback,
      });
    }
  }

  return [...orderCandidates, ...singleBatchAsOrders, ...multiBatchCandidates].filter(
    (x) => x.commission > EPS && x.impliedPct != null && Number.isFinite(x.impliedPct),
  );
}

function sortEcommerceCommissionCandidatesDesc(candidates) {
  return [...candidates].sort((a, b) => {
    const dc = (b.commission ?? 0) - (a.commission ?? 0);
    if (Math.abs(dc) > EPS) return dc;
    const dg = (b.gross ?? 0) - (a.gross ?? 0);
    if (Math.abs(dg) > EPS) return dg;
    const dp = (b.impliedPct ?? 0) - (a.impliedPct ?? 0);
    if (Math.abs(dp) > 1e-6) return dp;
    return String(a.primaryId).localeCompare(String(b.primaryId));
  });
}

/**
 * E‑commerce orders and settlement batches ranked by commission (highest first).
 * Uses the same aggregation as the spotlight (batch lines rolled up by batch id).
 * @param {object} parsedData
 * @returns {{ rank: number, kind: 'order'|'batch', primaryId: string, commission: number, gross: number, impliedPct: number, transactionCount: number|null, lineCountInBatch?: number }[]}
 */
export function getEcommerceOrderCommissionRanking(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return [];
  const raw = pickEcommerceCommissionCandidateRows(parsedData);
  const candidates = collectEcommerceSettlementCommissionCandidates(raw);
  const sorted = sortEcommerceCommissionCandidatesDesc(candidates);
  return sorted.map((row, i) => ({ rank: i + 1, ...row }));
}

/**
 * @param {object[]} rows
 * @returns {null | { kind: 'order'|'batch', primaryId: string, commission: number, gross: number, impliedPct: number, transactionCount: number|null, lineCountInBatch?: number }}
 */
function spotlightFromEcommerceSettlementRows(rows) {
  const sorted = sortEcommerceCommissionCandidatesDesc(collectEcommerceSettlementCommissionCandidates(rows));
  return sorted.length ? sorted[0] : null;
}

/**
 * E‑commerce settlement line or aggregated batch with the highest commission deduction (same winner as {@link getEcommerceCommissionSpotlight}).
 * Prefers `ecomm_*` / `ecommerce_*` settlement arrays. When those rows are missing or do not resolve,
 * falls back to the largest Online/CNP row in `fee_lines` (see `kind: 'fee_line'`).
 * When ≥2 settlement lines share the same batch ref, they compete as one batch aggregate.
 * @returns {null | { kind: 'order'|'batch'|'fee_line', primaryId: string, commission: number, gross: number|null, impliedPct: number, transactionCount: number|null, lineCountInBatch?: number, pctBasis?: 'fee_line_row_gross'|'channel_gross'|'fee_line_sum' }}
 */
export function getEcommerceCommissionSpotlight(parsedData) {
  const rows = pickEcommerceCommissionCandidateRows(parsedData);
  const fromSettlement = spotlightFromEcommerceSettlementRows(rows);
  if (fromSettlement) return fromSettlement;
  return spotlightFromEcommerceFeeLines(parsedData);
}

/**
 * Labels for the e‑commerce commission spotlight block (`report_ui` keys mirror POS spotlight).
 */
export function buildEcomSpotlightReportUi(parsedData, spotlight) {
  if (!parsedData || typeof parsedData !== 'object' || !spotlight) return null;

  const ruPick = (k) => reportUiString(parsedData, k);
  const { key, row: chRow } = pickEcommerceChannelRow(parsedData);
  const fromLabel =
    chRow && String(chRow.channel_label ?? chRow.label ?? '').trim() ? String(chRow.channel_label ?? chRow.label).trim() : '';
  const ecomChannelTitle =
    ruPick('ecom_channel_label') ||
    fromLabel ||
    (key && String(key).toLowerCase() === 'cnp' ? 'E‑commerce (CNP)' : '') ||
    humanizeSchemaKey('ecommerce');
  const batchWord = humanizeSchemaKey('batch');
  const orderWord = humanizeSchemaKey('order');
  const feeWord = pickFeeColumnLabel(parsedData, 'explicit_fees_and_gross');
  const grossWord = parsedFieldLabel(parsedData, 'gross_sales');
  const txnWord = parsedFieldLabel(parsedData, 'transaction_count');

  const idLabel =
    spotlight.kind === 'batch'
      ? ruPick('ecom_spotlight_batch_id_label') || parsedFieldLabel(parsedData, 'batch_number')
      : spotlight.kind === 'fee_line'
        ? ruPick('ecom_spotlight_fee_line_id_label') || `${humanizeSchemaKey('fee')} ${humanizeSchemaKey('line')}`
        : ruPick('ecom_spotlight_order_id_label') || `${orderWord} ID`;

  const defaultPctLabel =
    spotlight.kind === 'fee_line' && spotlight.pctBasis === 'fee_line_sum'
      ? `% of summed online ${humanizeSchemaKey('fee_lines')}`
      : spotlight.kind === 'fee_line' && spotlight.pctBasis === 'fee_line_row_gross'
        ? `% of that ${humanizeSchemaKey('fee')} line ${grossWord}`
        : `Effective % (${grossWord})`;

  const supplementalBatchId =
    spotlight.kind === 'order' &&
    spotlight.batchRef != null &&
    String(spotlight.batchRef).trim() &&
    normBatchKey(spotlight.batchRef) !== normBatchKey(spotlight.primaryId)
      ? String(spotlight.batchRef).trim()
      : null;

  return {
    spotlightSectionTitle:
      ruPick('ecom_spotlight_section_title') ||
      (spotlight.kind === 'batch'
        ? `${ecomChannelTitle} — ${batchWord} that deducted the highest commission`
        : spotlight.kind === 'fee_line'
          ? `${ecomChannelTitle} — Largest online commission deduction (${humanizeSchemaKey('fee_lines')})`
          : `${ecomChannelTitle} — ${orderWord} that deducted the highest commission`),
    primaryIdLabel: idLabel,
    commissionLabel: ruPick('ecom_spotlight_commission_label') || feeWord,
    impliedPctLabel: ruPick('ecom_spotlight_implied_pct_label') || defaultPctLabel,
    transactionCountLabel:
      ruPick('ecom_spotlight_transaction_count_label') ||
      (spotlight.kind === 'batch'
        ? `${txnWord} (${batchWord})`
        : spotlight.kind === 'fee_line'
          ? `${txnWord} (${ecomChannelTitle} total)`
          : txnWord),
    lineCountInBatchLabel:
      spotlight.kind === 'batch' && spotlight.lineCountInBatch != null
        ? ruPick('ecom_spotlight_lines_in_batch_label') || `${humanizeSchemaKey('settlement')} ${humanizeSchemaKey('lines')} (${batchWord})`
        : null,
    supplementalBatchId,
    supplementalBatchLabel: supplementalBatchId
      ? ruPick('ecom_spotlight_secondary_batch_label') || parsedFieldLabel(parsedData, 'batch_number')
      : null,
  };
}

/**
 * Online / CNP totals from `channel_split` (statement-level, not a single order or batch id).
 * Shown beside POS when there are no e‑commerce settlement line arrays in the parse.
 * @returns {null | { commission: number, gross: number, impliedPct: number, transactionCount: number|null }}
 */
export function getEcommerceChannelSummaryForReport(parsedData) {
  if (pickEcommerceOrderArrays(parsedData).length > 0) return null;
  const { row } = pickEcommerceChannelRow(parsedData);
  if (!row || typeof row !== 'object') return null;
  const r = resolveEcommLineFee(row);
  if (!r || r.fee == null || !(r.fee > EPS) || !(r.gross > EPS)) return null;
  if (r.impliedPct == null || !Number.isFinite(r.impliedPct)) return null;
  return {
    commission: r.fee,
    gross: r.gross,
    impliedPct: r.impliedPct,
    transactionCount: r.transactionCount ?? null,
  };
}

/** Labels for the channel-totals panel (optional `report_ui.ecom_channel_summary_*`). */
export function buildEcomChannelSummaryReportUi(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  const ruPick = (k) => reportUiString(parsedData, k);
  const grossWord = parsedFieldLabel(parsedData, 'gross_sales');
  const feeWord = pickFeeColumnLabel(parsedData, 'explicit_fees_and_gross');
  const comparison = buildChannelRollupFeePctComparisonLine(parsedData);
  const customFoot = ruPick('ecom_channel_summary_footnote');
  const baseFoot =
    customFoot ||
    'Per-order online fees need ecomm_settlement_orders (or a workbook order tab). Figures above are statement roll-ups from channel_split only.';
  const footnote = !customFoot && comparison ? `${baseFoot} ${comparison}` : baseFoot;

  return {
    sectionTitle:
      ruPick('ecom_channel_summary_section_title') || 'E‑commerce / online — channel totals',
    sourceLabel: ruPick('ecom_channel_summary_source_label') || 'Source',
    sourceValue:
      ruPick('ecom_channel_summary_source_value') ||
      'Roll-up totals (channel_split — no per-order rows in this file).',
    orderNoLabel: ruPick('ecom_channel_summary_order_no_label') || `${humanizeSchemaKey('order')} no.`,
    feeLabel: ruPick('ecom_channel_summary_fee_label') || feeWord,
    pctLabel: ruPick('ecom_channel_summary_pct_label') || `Effective % (${grossWord})`,
    footnote,
  };
}

/**
 * Distinct card / payment descriptors from e‑commerce order-like rows (best-effort).
 * @param {object[]} rows from {@link pickEcommerceOrderArrays}
 * @returns {string[]}
 */
export function aggregateEcomPaymentLabelsFromEcomOrderRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const keys = [
    'card_brand',
    'card_type',
    'card_scheme',
    'payment_method',
    'network',
    'tender_type',
    'payment_brand',
  ];
  const seen = new Set();
  const labels = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const parts = [];
    for (const k of keys) {
      const s = String(row[k] ?? '').trim();
      if (!s || /^n\/?a$/i.test(s) || /^unknown$/i.test(s) || /^none$/i.test(s)) continue;
      parts.push(s);
    }
    if (!parts.length) continue;
    const label = parts.slice(0, 2).join(' · ');
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= 28) break;
  }
  return labels;
}

/**
 * Distinct card / payment descriptors from POS transaction / line rows (best-effort).
 * @param {object[]} rows from {@link pickPosTransactionArrays}
 * @returns {string[]}
 */
export function aggregatePosPaymentLabelsFromPosTxnRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const keys = [
    'card_brand',
    'card_type',
    'card_scheme',
    'payment_method',
    'network',
    'tender_type',
    'payment_brand',
    'card_product',
    'last4',
    'card_last4',
    'masked_card',
  ];
  const seen = new Set();
  const labels = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const parts = [];
    for (const k of keys) {
      const s = String(row[k] ?? '').trim();
      if (!s || /^n\/?a$/i.test(s) || /^unknown$/i.test(s) || /^none$/i.test(s)) continue;
      parts.push(k === 'last4' || k === 'card_last4' ? `···${s}` : s);
    }
    if (!parts.length) continue;
    const label = parts.slice(0, 3).join(' · ');
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= 28) break;
  }
  return labels;
}

/**
 * E‑commerce line with the largest commission deduction (same winner as {@link getEcommerceCommissionSpotlight}).
 * @returns {null | { orderId: string|null, fee: number, gross: number, impliedPct: number, transactionCount: number|null }}
 */
export function getEcomHighestFeeOrder(parsedData) {
  const s = getEcommerceCommissionSpotlight(parsedData);
  if (!s) return null;
  return {
    orderId: s.primaryId,
    fee: s.commission,
    gross: s.gross,
    impliedPct: s.impliedPct,
    transactionCount: s.transactionCount,
  };
}

/**
 * E‑commerce upload roll-ups: total fees, total gross, deductions (refunds/returns/etc.), net = gross − fees − deductions,
 * and highest-fee line (order / batch / fee_line) from {@link getEcommerceCommissionSpotlight}.
 * @returns {null | {
 *   source: 'ecomm_orders' | 'channel_split',
 *   orderRowCount: number,
 *   totalGross: number,
 *   totalFees: number,
 *   totalDeductions: number,
 *   computedNet: number,
 *   netFromRows: number | null,
 *   highest: { orderId: string, fee: number, gross: number | null, impliedPct: number } | null,
 *   cardPaymentLabels: string[],
 * }}
 */
export function getEcommerceStatementOrderMetrics(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  const r2 = (x) => Math.round(Number(x) * 100) / 100;
  const spot = getEcommerceCommissionSpotlight(parsedData);
  const cardPaymentLabels = aggregateEcomPaymentLabelsFromEcomOrderRows(pickEcommerceOrderArrays(parsedData));
  const highest =
    spot && spot.commission > EPS
      ? {
          orderId: String(spot.primaryId ?? '').trim() || '—',
          fee: r2(spot.commission),
          gross: spot.gross != null && Number.isFinite(spot.gross) ? r2(spot.gross) : null,
          impliedPct: spot.impliedPct != null && Number.isFinite(spot.impliedPct) ? r2(spot.impliedPct) : null,
        }
      : null;

  const rows = pickEcommerceCommissionCandidateRows(parsedData);
  if (rows.length > 0) {
    let totalGross = 0;
    let totalFees = 0;
    let totalDeductions = 0;
    let sumNetExplicit = 0;
    let netExplicitCount = 0;
    let used = 0;
    for (const row of rows) {
      const r = resolveEcommLineFee(row);
      if (!r || !(r.gross > EPS)) continue;
      used += 1;
      totalGross += r.gross;
      totalFees += r.fee;
      totalDeductions += readEcomRowOrderDeduction(row);
      const n = num(
        row.net_sales ??
          row.net_sales_volume ??
          row.total_net_sales ??
          row.net_amount ??
          row.net ??
          row.net_settled ??
          row.net_payout,
      );
      if (n != null && Number.isFinite(n) && Math.abs(n) > EPS) {
        sumNetExplicit += n;
        netExplicitCount += 1;
      }
    }
    if (!used) return null;
    const totalGrossR = r2(totalGross);
    const totalFeesR = r2(totalFees);
    const totalDedR = r2(totalDeductions);
    const computedNet = r2(totalGrossR - totalFeesR - totalDedR);
    const netFromRows =
      netExplicitCount > used * 0.5 ? r2(sumNetExplicit) : null;
    return {
      source: 'ecomm_orders',
      orderRowCount: used,
      totalGross: totalGrossR,
      totalFees: totalFeesR,
      totalDeductions: totalDedR,
      computedNet,
      netFromRows,
      highest,
      cardPaymentLabels,
    };
  }

  const { row } = pickEcommerceChannelRow(parsedData);
  if (!row || typeof row !== 'object') return null;
  const r = resolveEcommLineFee(row);
  if (!r || !(r.gross > EPS)) return null;
  const rowDed = readEcomRowOrderDeduction(row);
  const fileDed = num(
    parsedData.refund_volume ??
      parsedData.total_refunds ??
      parsedData.ecomm_refund_volume ??
      parsedData.ecommerce_refunds,
  );
  const totalDedR = r2(rowDed > EPS ? rowDed : fileDed > EPS ? Math.abs(fileDed) : 0);
  const totalGrossR = r2(r.gross);
  const totalFeesR = r2(r.fee);
  return {
    source: 'channel_split',
    orderRowCount: 0,
    totalGross: totalGrossR,
    totalFees: totalFeesR,
    totalDeductions: totalDedR,
    computedNet: r2(totalGrossR - totalFeesR - totalDedR),
    netFromRows: null,
    highest,
    cardPaymentLabels,
  };
}

/** Labels for {@link getEcommerceStatementOrderMetrics} on the report. */
export function buildEcomOrderUploadMetricsUi(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  const ru = (k, fb) => reportUiString(parsedData, k) || fb;
  return {
    blockTitle: ru('ecom_upload_metrics_title', 'E‑commerce — totals from this file'),
    totalGrossLabel: ru('ecom_upload_metrics_gross', parsedFieldLabel(parsedData, 'gross_sales')),
    totalFeesLabel: ru('ecom_upload_metrics_total_fees', pickFeeColumnLabel(parsedData, 'explicit_fees_and_gross')),
    deductionsLabel: ru(
      'ecom_upload_metrics_deductions',
      'Deductions (refunds, returns, chargebacks, adjustments, …)',
    ),
    netLabel: ru('ecom_upload_metrics_net', 'Net (gross − fees − deductions)'),
    netFromFileLabel: ru('ecom_upload_metrics_net_file', 'Net sum from order rows (when most rows carry it)'),
    highestFeeLabel: ru('ecom_upload_metrics_highest_fee', 'Highest fee'),
    highestOrderLabel: ru('ecom_upload_metrics_highest_order', `${humanizeSchemaKey('order')} / line ID`),
    highestAmountLabel: ru('ecom_upload_metrics_highest_amount', 'Fee amount'),
    highestPctLabel: ru('ecom_upload_metrics_highest_pct', 'Fee % of that line gross'),
    cardMixLabel: ru('ecom_upload_metrics_card_mix', 'Card / payment (from order rows)'),
    footnote:
      ru(
        'ecom_upload_metrics_footnote',
        'Deductions: first non-zero value per order among common refund/return/chargeback/adjustment/discount fields. If your export uses another column name, map it in the parser JSON.',
      ) || '',
  };
}

