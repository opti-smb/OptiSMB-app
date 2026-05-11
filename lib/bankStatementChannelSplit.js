/**
 * Classify bank / ledger credit lines into POS vs e‑commerce using parser `channel`,
 * settlement id matches (batch / order ids), and description keywords.
 * Surfaces acquirer-side fee % from {@link getChannelSettlementDeductionSummary} alongside bank splits.
 */

import {
  getChannelSettlementDeductionSummary,
  getPosBatchReferenceKeysForLinkage,
  getEcommerceOrderReferenceKeysForLinkage,
} from './posBatchCommissionAnalysis.js';
import { pickBankLedgerRowCreditAmount } from './bankLedgerRowCredit.js';
import { buildRevenueByChannelTable } from './utils.js';
import { formatMoney, getStatementDisplayCurrency } from './currencyConversion.js';

const EPS = 0.02;

/** POS + e‑commerce Net Bank from the same {@link buildRevenueByChannelTable} rows as the Channel Split tab. */
function netBankPosEcomFromRevenue(rev) {
  if (!rev?.rows?.length) return null;
  let pos = 0;
  let ecom = 0;
  for (const r of rev.rows) {
    if (r.key === 'pos') pos = Number(r.netBank) || 0;
    if (r.key === 'ecom') ecom = Number(r.netBank) || 0;
  }
  if (!(pos > EPS) || !(ecom > EPS)) return null;
  return { pos: Math.round(pos * 100) / 100, ecom: Math.round(ecom * 100) / 100 };
}

/** When true, POS/e‑com “processor net” and bank-credit shares follow Channel Split Net Bank rows (same {@link buildRevenueByChannelTable} roll-up). */
function useChannelSplitNetBankForReconciliation(parsedData) {
  return (
    parsedData?.golden_reconciliation_workbook === true ||
    (parsedData?.linked_statement_bundle &&
      typeof parsedData.linked_statement_bundle === 'object' &&
      !Array.isArray(parsedData.linked_statement_bundle)) ||
    num(parsedData?.bank_credits_total_verified) > EPS
  );
}

/**
 * POS vs e‑commerce net amounts already reconciled on the parse (workbook / processor layout).
 * Used when there are no per-line `bank_transactions` credits to classify.
 * @returns {{ pos: number, ecommerce: number } | null}
 */
function getReconNetDepositSplit(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  if (useChannelSplitNetBankForReconciliation(parsedData)) {
    const nb = netBankPosEcomFromRevenue(buildRevenueByChannelTable(parsedData));
    if (nb && nb.pos > EPS && nb.ecom > EPS) return { pos: nb.pos, ecommerce: nb.ecom };
  }
  const p = num(parsedData.pos_net_deposit_volume);
  const e = num(parsedData.ecomm_net_deposit_volume);
  if (p > EPS && e > EPS) return { pos: p, ecommerce: e };
  const rev = buildRevenueByChannelTable(parsedData);
  if (!rev?.rows?.length) return null;
  let posN = 0;
  let ecomN = 0;
  for (const r of rev.rows) {
    if (r.key === 'pos') posN = Number(r.netBank) || 0;
    if (r.key === 'ecom') ecomN = Number(r.netBank) || 0;
  }
  if (posN > EPS && ecomN > EPS) return { pos: posN, ecommerce: ecomN };
  return null;
}

/**
 * Channel gross sales for POS and e‑commerce (CNP / online), same basis as the channel split table.
 * @returns {{ pos: number, ecom: number } | null}
 */
function getPosEcomGrossTotals(parsedData) {
  const rev = buildRevenueByChannelTable(parsedData);
  let pos = null;
  let ecom = null;
  if (rev?.rows?.length) {
    for (const r of rev.rows) {
      if (r.key === 'pos') pos = Number(r.gross);
      if (r.key === 'ecom') ecom = Number(r.gross);
    }
  }
  const cs = parsedData?.channel_split;
  if (cs && typeof cs === 'object' && !Array.isArray(cs)) {
    if (!(pos > EPS) && cs.pos && typeof cs.pos === 'object') {
      const v = num(
        cs.pos.statement_gross_volume ??
          cs.pos.gross_volume ??
          cs.pos.gross_sales ??
          cs.pos.volume ??
          cs.pos.sales_volume,
      );
      if (v > EPS) pos = v;
    }
    if (!(ecom > EPS)) {
      for (const key of ['cnp', 'ecommerce', 'online', 'web', 'digital']) {
        const row = cs[key];
        if (!row || typeof row !== 'object') continue;
        const v = num(row.statement_gross_volume ?? row.gross_volume ?? row.gross_sales ?? row.volume ?? row.sales_volume);
        if (v > EPS) {
          ecom = v;
          break;
        }
      }
    }
  }
  const posOk = pos != null && Number.isFinite(pos) && pos > EPS;
  const ecomOk = ecom != null && Number.isFinite(ecom) && ecom > EPS;
  if (!posOk && !ecomOk) return null;
  return {
    pos: posOk ? Math.round(pos * 100) / 100 : null,
    ecom: ecomOk ? Math.round(ecom * 100) / 100 : null,
  };
}

/**
 * Expected processor payouts (per channel) from settlement / channel_split — comparable to classified bank credits.
 * Prefer top-level nets from linked merge, then `channel_split` net_settled_volume.
 * @returns {{ pos: number, ecom: number } | null}
 */
function getPosEcomProcessorNetTotals(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  let p = num(parsedData.pos_net_deposit_volume);
  let e = num(parsedData.ecomm_net_deposit_volume);
  if (p > EPS && e > EPS) return { pos: p, ecom: e };
  const cs = parsedData.channel_split;
  if (cs && typeof cs === 'object' && !Array.isArray(cs)) {
    const pn = num(cs.pos?.net_settled_volume);
    const en = num(
      cs.cnp?.net_settled_volume ?? cs.ecommerce?.net_settled_volume ?? cs.ecomm?.net_settled_volume,
    );
    if (pn > EPS && en > EPS) return { pos: pn, ecom: en };
  }
  return null;
}

/** Prefer Channel Split Net Bank when reconciling; else parser scalars (legacy). */
function processorNetWeightsForBankVsStatement(parsedData, revenueRev) {
  const preferChannelSplit = useChannelSplitNetBankForReconciliation(parsedData);
  const rev = revenueRev ?? buildRevenueByChannelTable(parsedData);
  const fromRev = netBankPosEcomFromRevenue(rev);
  if (preferChannelSplit && fromRev) return { pos: fromRev.pos, ecom: fromRev.ecom };
  const scalar = getPosEcomProcessorNetTotals(parsedData);
  if (scalar) return scalar;
  return null;
}

/**
 * When true, per-channel “bank credited” can follow `bank_credits_total_verified` × processor-net share — not memo lines alone.
 * Covers golden reconciliation workbooks and linked POS + e‑commerce + bank merges (often without `golden_reconciliation_workbook`).
 * Opt out: `report_ui.bank_credits_channel_source === 'memo'`.
 */
function shouldAllocateBankCreditsFromVerifiedTotal(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return false;
  const ui = parsedData.report_ui;
  if (ui && typeof ui === 'object' && !Array.isArray(ui) && ui.bank_credits_channel_source === 'memo') {
    return false;
  }
  if (parsedData.golden_reconciliation_workbook === true) return true;
  const b = parsedData.linked_statement_bundle;
  return Boolean(b && typeof b === 'object' && !Array.isArray(b));
}

/**
 * Split `bank_credits_total_verified` across POS / e‑commerce using Channel Split Net Bank weights.
 * @returns {{ split: typeof split, allocationNote: null, bankCreditsUsesVerifiedTotalShare: true } | null}
 */
function verifiedNetBankAllocationDisplay(parsedData, split, revenueRev) {
  const verified = num(parsedData.bank_credits_total_verified);
  const nets = processorNetWeightsForBankVsStatement(parsedData, revenueRev);
  if (!(verified > EPS) || nets == null || !(nets.pos > EPS) || !(nets.ecom > EPS)) return null;
  const sumN = nets.pos + nets.ecom;
  const posA = Math.round(((verified * nets.pos) / sumN) * 100) / 100;
  const ecomA = Math.round((verified - posA) * 100) / 100;
  return {
    split: {
      ...split,
      pos: { ...split.pos, credits: posA },
      ecommerce: { ...split.ecommerce, credits: ecomA },
      unknown: { ...split.unknown, credits: 0 },
    },
    allocationNote: null,
    bankCreditsUsesVerifiedTotalShare: true,
  };
}

/**
 * Align per-channel bank credited with `bank_credits_total_verified` using the same POS vs e‑commerce weights as
 * processor net. Optional `bank_credits_pos_statement` / `bank_credits_ecomm_statement` — one may be inferred from
 * `bank_credits_total_verified` when only one side appears on the workbook.
 * @returns {{
 *   split: ReturnType<typeof splitBankTransactionsByChannel>,
 *   allocationNote: string | null,
 *   bankCreditsUsesVerifiedTotalShare: boolean,
 * }}
 */
function applyGoldenBankCreditDisplayTotals(parsedData, split, revenueRev) {
  const noop = { split, allocationNote: null, bankCreditsUsesVerifiedTotalShare: false };

  if (!parsedData || typeof parsedData !== 'object') return noop;

  const stmtPair = resolveBankCreditsStatementScalars(parsedData);
  if (stmtPair) {
    return {
      split: {
        ...split,
        pos: { ...split.pos, credits: stmtPair.pos },
        ecommerce: { ...split.ecommerce, credits: stmtPair.ecom },
        unknown: { ...split.unknown, credits: 0 },
      },
      allocationNote: null,
      bankCreditsUsesVerifiedTotalShare: true,
    };
  }

  const memoPreferred =
    parsedData.report_ui &&
    typeof parsedData.report_ui === 'object' &&
    !Array.isArray(parsedData.report_ui) &&
    parsedData.report_ui.bank_credits_channel_source === 'memo';

  const linkedBundle =
    parsedData.linked_statement_bundle &&
    typeof parsedData.linked_statement_bundle === 'object' &&
    !Array.isArray(parsedData.linked_statement_bundle);

  /**
   * Split `bank_credits_total_verified` using Channel Split Net Bank weights so POS/e‑com settlement matches the
   * reconciliation workbook when only **one** verified bank total exists. Applies to golden templates and linked
   * POS / e‑commerce / bank bundles — **before** memo-classified deposit lines, unless `report_ui.bank_credits_channel_source === 'memo'`.
   */
  if ((parsedData.golden_reconciliation_workbook === true || linkedBundle) && !memoPreferred) {
    const fromVerified = verifiedNetBankAllocationDisplay(parsedData, split, revenueRev);
    if (fromVerified) return fromVerified;
  }

  /** Processor statement fallback: no batch/order match on bank lines (or mostly “unknown”) → split verified bank $ by Channel Split Net Bank (same roll-up as POS/e‑com statements). */
  const posEcomSum = split.pos.credits + split.ecommerce.credits;
  const totalCred = posEcomSum + split.unknown.credits;
  const weakLinkage =
    !(totalCred > EPS) ||
    !(posEcomSum > EPS) ||
    (split.unknown.credits > EPS && totalCred > EPS && split.unknown.credits / totalCred >= 0.08);

  if (!memoPreferred && weakLinkage) {
    const fromRollup = verifiedNetBankAllocationDisplay(parsedData, split, revenueRev);
    if (fromRollup) {
      const explain =
        split.lines.length > 0
          ? 'Bank lines lacked batch/order IDs matching POS/e‑commerce parses; settlement uses verified bank total × Channel Split Net Bank from processor roll-up (same weights as after-charges net per channel).'
          : null;
      return {
        ...fromRollup,
        allocationNote: explain,
      };
    }
  }

  if (!shouldAllocateBankCreditsFromVerifiedTotal(parsedData) && !memoPreferred) return noop;

  const classifiedChannelCredits = split.pos.credits + split.ecommerce.credits;
  if (split.lines.length > 0 && classifiedChannelCredits > EPS) {
    return noop;
  }

  if (!shouldAllocateBankCreditsFromVerifiedTotal(parsedData)) return noop;

  return verifiedNetBankAllocationDisplay(parsedData, split, revenueRev) ?? noop;
}

/**
 * Compare **channel gross** to classified bank credits per channel; rate is (gross − bank) ÷ gross × 100.
 * @param {object} parsedData
 * @param {ReturnType<typeof getBankStatementPosEcomChargeSummary>} summary
 */
function addGrossVsBankCreditPct(parsedData, summary, revenueRev) {
  const g = getPosEcomGrossTotals(parsedData);
  const nets = processorNetWeightsForBankVsStatement(parsedData, revenueRev);
  /** Actual classified or verified×share dollars on `split` — Bank activity card stays tied to deposits when relevant. */
  const bankPosRaw = Number(summary.split.pos.credits) || 0;
  const bankEcomRaw = Number(summary.split.ecommerce.credits) || 0;
  /**
   * When the workbook only has one verified bank total (no per-channel bank statement scalars), we still store the
   * prorated POS/e‑com amounts on `split` for deposit math — but gross-vs-settlement should compare gross to the same
   * **processor Net Bank** line items as Channel Split, not to the prorated verified slices.
   */
  const stmtScalars = resolveBankCreditsStatementScalars(parsedData);
  const useProcNetForCompare =
    summary.bankCreditsUsesVerifiedTotalShare === true &&
    stmtScalars == null &&
    nets != null &&
    nets.pos > EPS &&
    nets.ecom > EPS;
  const bankPos = useProcNetForCompare ? nets.pos : bankPosRaw;
  const bankEcom = useProcNetForCompare ? nets.ecom : bankEcomRaw;

  const posGrossVsBankPct =
    g?.pos != null && g.pos > EPS ? ((g.pos - bankPos) / g.pos) * 100 : null;
  const ecomGrossVsBankPct =
    g?.ecom != null && g.ecom > EPS ? ((g.ecom - bankEcom) / g.ecom) * 100 : null;

  const pg = g?.pos;
  const eg = g?.ecom;
  const combinedGrossTotal =
    (pg != null && Number.isFinite(pg) ? pg : 0) + (eg != null && Number.isFinite(eg) ? eg : 0);
  const combinedBankSettlement =
    (Number.isFinite(bankPos) ? bankPos : 0) + (Number.isFinite(bankEcom) ? bankEcom : 0);
  const combinedGrossVsBankDiff =
    combinedGrossTotal > EPS ? Math.round((combinedGrossTotal - combinedBankSettlement) * 100) / 100 : null;
  const combinedGrossVsBankPct =
    combinedGrossTotal > EPS ? ((combinedGrossTotal - combinedBankSettlement) / combinedGrossTotal) * 100 : null;

  return {
    ...summary,
    bankCreditsAllocationNote: summary.bankCreditsAllocationNote ?? null,
    bankCreditsUsesVerifiedTotalShare: summary.bankCreditsUsesVerifiedTotalShare ?? false,
    grossVsBankUsesProcessorNet: useProcNetForCompare,
    posGrossTotal: g?.pos ?? null,
    ecomGrossTotal: g?.ecom ?? null,
    posProcessorNetTotal: nets?.pos ?? null,
    ecomProcessorNetTotal: nets?.ecom ?? null,
    posBankCreditsTotal: bankPosRaw,
    ecomBankCreditsTotal: bankEcomRaw,
    posGrossVsBankSettlementAmount: bankPos,
    ecomGrossVsBankSettlementAmount: bankEcom,
    posGrossVsBankPct,
    ecomGrossVsBankPct,
    combinedGrossTotal: combinedGrossTotal > EPS ? Math.round(combinedGrossTotal * 100) / 100 : null,
    combinedBankSettlement: Math.round(combinedBankSettlement * 100) / 100,
    combinedGrossVsBankDiff,
    combinedGrossVsBankPct:
      combinedGrossVsBankPct != null && Number.isFinite(combinedGrossVsBankPct) ? combinedGrossVsBankPct : null,
  };
}

function num(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : NaN;
}

/**
 * Explicit POS / e‑commerce bank amounts from the parse when both are present, or one plus `bank_credits_total_verified`
 * to infer the complementary channel (common when only one row exists on the workbook).
 * @returns {{ pos: number, ecom: number } | null}
 */
function resolveBankCreditsStatementScalars(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  const posStmt = num(parsedData.bank_credits_pos_statement);
  const eStmt = num(parsedData.bank_credits_ecomm_statement);
  const verified = num(parsedData.bank_credits_total_verified);

  if (posStmt > EPS && eStmt > EPS) {
    return { pos: Math.round(posStmt * 100) / 100, ecom: Math.round(eStmt * 100) / 100 };
  }

  const allowInferFromVerified =
    parsedData.golden_reconciliation_workbook === true ||
    (parsedData.linked_statement_bundle && typeof parsedData.linked_statement_bundle === 'object' && !Array.isArray(parsedData.linked_statement_bundle));

  if (verified > EPS && allowInferFromVerified) {
    if (posStmt > EPS && !(eStmt > EPS)) {
      const ecom = Math.round((verified - posStmt) * 100) / 100;
      if (ecom > EPS) return { pos: Math.round(posStmt * 100) / 100, ecom };
    }
    if (eStmt > EPS && !(posStmt > EPS)) {
      const pos = Math.round((verified - eStmt) * 100) / 100;
      if (pos > EPS) return { pos, ecom: Math.round(eStmt * 100) / 100 };
    }
  }
  return null;
}

/**
 * When memo-classified lines sum differs from `bank_credits_total_verified`, surface it so settlement columns are not
 * mistaken for the verified rollup.
 * @returns {string | null}
 */
function verifiedVsClassifiedCreditsGapNote(parsedData, splitAdj) {
  const verified = num(parsedData?.bank_credits_total_verified);
  if (!(verified > EPS) || !splitAdj) return null;
  const sumClass =
    num(splitAdj.pos?.credits) +
    num(splitAdj.ecommerce?.credits) +
    num(splitAdj.unknown?.credits);
  if (!(sumClass > EPS)) return null;
  const diff = Math.abs(sumClass - verified);
  const tol = Math.max(25, verified * 0.005);
  if (diff <= tol) return null;
  const sumR = Math.round(sumClass * 100) / 100;
  const verR = Math.round(verified * 100) / 100;
  const diffR = Math.round(diff * 100) / 100;
  return `Classified bank credits sum to ${sumR} vs verified bank total ${verR} (difference ${diffR}); dates, filters, or unclassified lines may explain the gap.`;
}

function pickBankTransactionArrays(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return [];
  const lists = [
    parsedData.bank_transactions,
    parsedData.bank_ledger_lines,
    parsedData.bank_statement_lines,
    parsedData.account_transactions,
    parsedData.bank_deposits,
    parsedData.deposit_transactions,
    parsedData.raw_bank_lines,
    parsedData.raw_extracted?.bank_transactions,
    parsedData.raw_extracted?.bank_ledger_lines,
    parsedData.raw_extracted?.raw_bank_lines,
    parsedData.raw_extracted_preview?.bank_transactions,
    parsedData.raw_extracted_preview?.raw_bank_lines,
    parsedData.extracted?.bank_transactions,
    parsedData.extracted?.raw_bank_lines,
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

/** Concatenate memo-style fields **and** common ID columns so batch/order/settlement IDs match processor extracts even when not embedded in description. */
const BANK_LINE_ID_TEXT_KEYS = [
  'id',
  'transaction_id',
  'external_id',
  'order_id',
  'settlement_id',
  'settlement_batch_id',
  'batch_id',
  'batch_number',
  'reference_id',
  'reference_number',
  'customer_reference',
  'payment_reference',
  'merchant_reference',
  'acquirer_reference',
  'end_to_end_id',
  'e2e_reference',
  'trace_number',
  'fed_trace',
  'bank_reference',
  'counterparty_reference',
  'remittance_information',
  'invoice_id',
  'purchase_id',
];

function bankLineText(row) {
  if (!row || typeof row !== 'object') return '';
  const bits = [
    row.description,
    row.memo,
    row.narrative,
    row.detail,
    row.payee,
    row.merchant,
    row.statement_line,
    row.reference,
    row.transaction_description,
    row.name,
  ];
  for (const k of BANK_LINE_ID_TEXT_KEYS) {
    const v = row[k];
    if (v != null && v !== '') bits.push(v);
  }
  return bits
    .map((x) => (x == null ? '' : String(x)))
    .join(' ')
    .trim();
}

function bankLineCreditAmount(row) {
  return pickBankLedgerRowCreditAmount(row);
}

function textHasPosSignal(t) {
  const s = String(t).toLowerCase();
  if (/\b(cnp|card\s*not\s*present|e-?commerce|online\s*pay|shopify|web\s*pay|internet)\b/i.test(s)) return false;
  /** Square ACH deposits are in-person / POS for typical merchant bank feeds (vs Stripe/Shopify payout lines). */
  return /\b(square|pos|point\s*of\s*sale|terminal|batch|in-?store|card\s*present|merchant\s*deposit|settlement|acquirer|visa\s*mc|mastercard\s*deposit)\b/i.test(
    s,
  );
}

function textHasEcomSignal(t) {
  return /\b(online|cnp|e-?commerce|ecomm|shopify|stripe|www\.|web\s*pay|internet|mail\s*order|moto|digital\s*wallet)\b/i.test(
    String(t),
  );
}

function matchLinkage(text, { keys, ids }) {
  const t = normLinkageToken(text);
  const al = normLinkageAlnum(text);
  if (!t && !al) return false;
  for (const k of keys) {
    if (k && t.includes(k)) return true;
  }
  for (const id of ids) {
    if (id && id.length >= 4 && al.includes(id)) return true;
  }
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

/**
 * @param {object} row
 * @param {{ pos: ReturnType<typeof getPosBatchReferenceKeysForLinkage>, ecom: ReturnType<typeof getEcommerceOrderReferenceKeysForLinkage> }} index
 * @returns {{ channel: 'pos'|'ecommerce'|'unknown', method: 'parser'|'reference'|'keyword'|'none' }}
 */
export function classifyBankTransactionLine(row, index) {
  if (!row || typeof row !== 'object') return { channel: 'unknown', method: 'none' };
  const ch = String(row.channel ?? row.channel_type ?? row.sales_channel ?? '').toLowerCase();
  if (/^pos|in-?store|retail|terminal$/i.test(ch)) return { channel: 'pos', method: 'parser' };
  if (/cnp|e-?comm|online|web|digital/i.test(ch)) return { channel: 'ecommerce', method: 'parser' };

  const text = bankLineText(row);
  const posHit = matchLinkage(text, index.pos);
  const ecomHit = matchLinkage(text, index.ecom);
  if (posHit && !ecomHit) return { channel: 'pos', method: 'reference' };
  if (ecomHit && !posHit) return { channel: 'ecommerce', method: 'reference' };
  if (posHit && ecomHit) {
    if (textHasEcomSignal(text) && !textHasPosSignal(text)) return { channel: 'ecommerce', method: 'reference' };
    return { channel: 'pos', method: 'reference' };
  }

  if (textHasEcomSignal(text) && !textHasPosSignal(text)) return { channel: 'ecommerce', method: 'keyword' };
  if (textHasPosSignal(text)) return { channel: 'pos', method: 'keyword' };
  return { channel: 'unknown', method: 'none' };
}

/**
 * @param {object} parsedData
 * @returns {{ lines: object[], pos: { count: number, credits: number }, ecommerce: { count: number, credits: number }, unknown: { count: number, credits: number } }}
 */
export function splitBankTransactionsByChannel(parsedData) {
  const raw = pickBankTransactionArrays(parsedData);
  const index = {
    pos: getPosBatchReferenceKeysForLinkage(parsedData),
    ecom: getEcommerceOrderReferenceKeysForLinkage(parsedData),
  };
  const pos = { count: 0, credits: 0 };
  const ecommerce = { count: 0, credits: 0 };
  const unknown = { count: 0, credits: 0 };
  const lines = [];

  for (const row of raw) {
    const amt = bankLineCreditAmount(row);
    if (amt == null || !(amt > EPS)) continue;
    const { channel, method } = classifyBankTransactionLine(row, index);
    lines.push({ ...row, _bankSplitChannel: channel, _bankSplitMethod: method, _bankSplitAmount: amt });
    if (channel === 'pos') {
      pos.count += 1;
      pos.credits += amt;
    } else if (channel === 'ecommerce') {
      ecommerce.count += 1;
      ecommerce.credits += amt;
    } else {
      unknown.count += 1;
      unknown.credits += amt;
    }
  }

  return { lines, pos, ecommerce, unknown };
}

/**
 * Bank credit split, and per channel: (gross − bank settlement) ÷ gross × 100, plus acquirer fee % (reference).
 * @param {object} parsedData
 * @param {ReturnType<typeof buildRevenueByChannelTable> | null | undefined} [revenueHint] Same roll-up as Channel Split — omit to build internally (tests / standalone callers).
 * @returns {{
 *   splitMode: 'bank_lines' | 'reconciliation_nets' | 'none',
 *   split: ReturnType<typeof splitBankTransactionsByChannel>,
 *   totalBankCredits: number,
 *   posDepositShare: number | null,
 *   ecomDepositShare: number | null,
 *   posChargePct: number | null,
 *   ecomChargePct: number | null,
 *   posSettlement: object | null,
 *   ecomSettlement: object | null,
 *   settlementPlainLines: string[],
 *   posGrossTotal: number | null,
 *   ecomGrossTotal: number | null,
 *   posBankCreditsTotal: number,
 *   ecomBankCreditsTotal: number,
 *   posGrossVsBankSettlementAmount: number,
 *   ecomGrossVsBankSettlementAmount: number,
 *   posGrossVsBankPct: number | null,
 *   ecomGrossVsBankPct: number | null,
 *   combinedGrossTotal: number | null,
 *   combinedBankSettlement: number,
 *   combinedGrossVsBankDiff: number | null,
 *   combinedGrossVsBankPct: number | null,
 *   bankCreditsAllocationNote: string | null,
 *   bankCreditsUsesVerifiedTotalShare: boolean,
 *   grossVsBankUsesProcessorNet: boolean,
 * }}
 */
export function getBankStatementPosEcomChargeSummary(parsedData, revenueHint) {
  const revenueRev = revenueHint ?? buildRevenueByChannelTable(parsedData);
  const split = splitBankTransactionsByChannel(parsedData);
  const settlement = getChannelSettlementDeductionSummary(parsedData);

  if (split.lines.length > 0) {
    const { split: splitAdj, allocationNote, bankCreditsUsesVerifiedTotalShare } =
      applyGoldenBankCreditDisplayTotals(parsedData, split, revenueRev);
    let mergedNote = allocationNote;
    if (!bankCreditsUsesVerifiedTotalShare) {
      const gapNote = verifiedVsClassifiedCreditsGapNote(parsedData, splitAdj);
      if (gapNote) mergedNote = mergedNote ? `${mergedNote} ${gapNote}` : gapNote;
    }
    const totalCredits = splitAdj.pos.credits + splitAdj.ecommerce.credits + splitAdj.unknown.credits;
    const posShare = totalCredits > EPS ? splitAdj.pos.credits / totalCredits : null;
    const ecomShare = totalCredits > EPS ? splitAdj.ecommerce.credits / totalCredits : null;
    return addGrossVsBankCreditPct(
      parsedData,
      {
        splitMode: 'bank_lines',
        split: splitAdj,
        totalBankCredits: totalCredits,
        posDepositShare: posShare != null && Number.isFinite(posShare) ? posShare * 100 : null,
        ecomDepositShare: ecomShare != null && Number.isFinite(ecomShare) ? ecomShare * 100 : null,
        posChargePct: settlement?.pos?.pct ?? null,
        ecomChargePct: settlement?.ecom?.pct ?? null,
        posSettlement: settlement?.pos ?? null,
        ecomSettlement: settlement?.ecom ?? null,
        settlementPlainLines: settlement?.plainLines ?? [],
        bankCreditsAllocationNote: mergedNote,
        bankCreditsUsesVerifiedTotalShare,
      },
      revenueRev,
    );
  }

  const nets = getReconNetDepositSplit(parsedData);
  if (nets && settlement?.pos && settlement?.ecom) {
    let posCr = nets.pos;
    let ecomCr = nets.ecommerce;
    let allocationNote = null;
    let bankCreditsUsesVerifiedTotalShare = false;

    const stmtPair = resolveBankCreditsStatementScalars(parsedData);
    if (stmtPair) {
      posCr = stmtPair.pos;
      ecomCr = stmtPair.ecom;
      bankCreditsUsesVerifiedTotalShare = true;
    } else if (shouldAllocateBankCreditsFromVerifiedTotal(parsedData)) {
      const verified = num(parsedData.bank_credits_total_verified);
      const nb = netBankPosEcomFromRevenue(revenueRev);
      const pn = nb != null && nb.pos > EPS ? nb.pos : num(parsedData.pos_net_deposit_volume);
      const en = nb != null && nb.ecom > EPS ? nb.ecom : num(parsedData.ecomm_net_deposit_volume);
      if (verified > EPS && pn > EPS && en > EPS) {
        const sumN = pn + en;
        posCr = Math.round(((verified * pn) / sumN) * 100) / 100;
        ecomCr = Math.round((verified - posCr) * 100) / 100;
        allocationNote = null;
        bankCreditsUsesVerifiedTotalShare = true;
      }
    }

    const totalCredits = posCr + ecomCr;
    const posShare = totalCredits > EPS ? posCr / totalCredits : null;
    const ecomShare = totalCredits > EPS ? ecomCr / totalCredits : null;
    const splitSynth = {
      lines: [],
      pos: { count: 0, credits: posCr },
      ecommerce: { count: 0, credits: ecomCr },
      unknown: { count: 0, credits: 0 },
    };
    return addGrossVsBankCreditPct(
      parsedData,
      {
        splitMode: 'reconciliation_nets',
        split: splitSynth,
        totalBankCredits: totalCredits,
        posDepositShare: posShare != null && Number.isFinite(posShare) ? posShare * 100 : null,
        ecomDepositShare: ecomShare != null && Number.isFinite(ecomShare) ? ecomShare * 100 : null,
        posChargePct: settlement.pos.pct,
        ecomChargePct: settlement.ecom.pct,
        posSettlement: settlement.pos,
        ecomSettlement: settlement.ecom,
        settlementPlainLines: settlement.plainLines ?? [],
        bankCreditsAllocationNote: allocationNote,
        bankCreditsUsesVerifiedTotalShare,
      },
      revenueRev,
    );
  }

  return addGrossVsBankCreditPct(
    parsedData,
    {
      splitMode: 'none',
      split,
      totalBankCredits: 0,
      posDepositShare: null,
      ecomDepositShare: null,
      posChargePct: settlement?.pos?.pct ?? null,
      ecomChargePct: settlement?.ecom?.pct ?? null,
      posSettlement: settlement?.pos ?? null,
      ecomSettlement: settlement?.ecom ?? null,
      settlementPlainLines: settlement?.plainLines ?? [],
      bankCreditsAllocationNote: null,
      bankCreditsUsesVerifiedTotalShare: false,
    },
    revenueRev,
  );
}

/**
 * Show POS vs e‑commerce **bank activity** only when the parse has classified **bank credit lines**.
 * When there are no lines, reconciliation nets already appear in the channel / revenue tables — duplicating them
 * here as “bank credits” was noisy and confused merchant PDFs (e.g. Rosewood) with processor statements.
 */
export function hasBankPosEcomSplit(parsedData) {
  return splitBankTransactionsByChannel(parsedData).lines.length > 0;
}

/**
 * Overview **Net revenue** from **bank deposit lines** classified as POS vs e‑commerce (batch/order IDs, channel
 * field, or description keywords), after the same adjustments as {@link getBankStatementPosEcomChargeSummary}.
 * Returns null when there are no credit lines to classify — callers should fall back to {@link displayOverviewNetAfterFees}.
 * @param {object} parsedData
 * @returns {{ amount: number, pos: number, ecom: number, posLineCount: number, ecomLineCount: number, sub: string, subSecondary: string | null } | null}
 */
export function overviewNetRevenueFromBankCredits(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  if (parsedData.golden_reconciliation_workbook === true) return null;
  const raw = splitBankTransactionsByChannel(parsedData);
  if (!raw.lines.length) return null;
  const revenue = buildRevenueByChannelTable(parsedData);
  const summary = getBankStatementPosEcomChargeSummary(parsedData, revenue ?? undefined);
  const pos = num(summary.split.pos.credits);
  const ecom = num(summary.split.ecommerce.credits);
  const sum = Math.round((pos + ecom) * 100) / 100;
  if (!(sum > EPS)) return null;
  const ccy = getStatementDisplayCurrency(parsedData);
  const pc = Number(summary.split.pos.count) || 0;
  const ec = Number(summary.split.ecommerce.count) || 0;
  const sub = summary.bankCreditsUsesVerifiedTotalShare
    ? 'Bank credits to POS + e‑commerce (verified bank total allocated by Channel Split when lines do not foot).'
    : 'Bank credits to POS + e‑commerce (classified deposit lines: settlement IDs, channel field, or memo keywords).';
  const subSecondary = `POS ${formatMoney(pos, ccy)} (${pc} lines) + e‑commerce ${formatMoney(ecom, ccy)} (${ec} lines)`;
  return {
    amount: sum,
    pos: Math.round(pos * 100) / 100,
    ecom: Math.round(ecom * 100) / 100,
    posLineCount: pc,
    ecomLineCount: ec,
    sub,
    subSecondary,
  };
}
