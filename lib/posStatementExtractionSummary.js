/**
 * POS upload / preview summary — **only** {@link buildPosSemanticOrderRollup} (column titles + numeric shape on
 * transaction-like rows). Same path for tabular files and for PDF / image parses when line tables are embedded
 * under `raw_extracted` / `extracted` (see {@link collectEmbeddedGridPosRowObjects}). No channel_split or
 * English-only row keyword heuristics in this module.
 */

import { formatMoney, getStatementDisplayCurrency } from './currencyConversion.js';
import { buildPosSemanticOrderRollup } from './posOrderSemanticRollup.js';

/**
 * @param {object} parsedData
 * @returns {null | {
 *   currency: string,
 *   posGross: number | null,
 *   totalFees: number | null,
 *   totalAfterFees: number | null,
 *   netSales: number | null,
 *   refundsReturns: number | null,
 *   cashTotalAmount: number | null,
 *   semanticColumnLabels: object | null,
 *   semanticRollupSource: string | null,
 *   semanticNote: string | null,
 *   cardTransactionCount: number,
 *   cashTransactionCount: number,
 *   otherTransactionCount: number,
 *   totalTransactionRows: number,
 *   sumOfTransactionRowAmounts: number,
 * }}
 */
export function buildPosStatementExtractionSummary(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;

  const roll = buildPosSemanticOrderRollup(parsedData);
  if (!roll || !(roll.posGrossOrders > 0.005) || roll.rowCount < 2) return null;

  const ccy = getStatementDisplayCurrency(parsedData);
  const posGross = roll.posGrossOrders;
  const totalFees = roll.feesNonCash;
  const totalAfterFees =
    posGross != null && totalFees != null && Number.isFinite(posGross) && Number.isFinite(totalFees)
      ? Math.round((posGross - totalFees) * 100) / 100
      : null;

  return {
    currency: ccy,
    posGross: Math.round(posGross * 100) / 100,
    totalFees: Math.round(totalFees * 100) / 100,
    totalAfterFees,
    netSales: roll.netSales,
    refundsReturns: roll.refundsReturns,
    cashTotalAmount: roll.cashTotal,
    semanticColumnLabels: roll.mapping,
    semanticRollupSource: roll.source,
    semanticNote: roll.note,
    cardTransactionCount: roll.cardRowCount,
    cashTransactionCount: roll.cashRowCount,
    otherTransactionCount: Math.max(0, roll.rowCount - roll.cardRowCount - roll.cashRowCount),
    totalTransactionRows: roll.rowCount,
    sumOfTransactionRowAmounts: Math.round(roll.posGrossOrders * 100) / 100,
  };
}

/**
 * @param {object | null | undefined} summary
 * @returns {string[]}
 */
export function formatPosExtractionSummaryLines(summary) {
  if (!summary) return [];
  const { currency: ccy } = summary;
  const lines = [];
  if (summary.semanticRollupSource && summary.semanticColumnLabels) {
    const m = summary.semanticColumnLabels;
    lines.push(
      `Headers read as: gross → “${m.gross}”${m.refund ? `, refunds/returns → “${m.refund}”` : ''}${m.fee ? `, fees → “${m.fee}”` : ''}${m.tender ? `, tender → “${m.tender}”` : ''}`,
    );
  }
  if (summary.posGross != null) lines.push(`POS gross (Σ order amounts): ${formatMoney(summary.posGross, ccy)}`);
  if (summary.refundsReturns != null && summary.refundsReturns > 0.005) {
    lines.push(`Refunds / returns: ${formatMoney(summary.refundsReturns, ccy)}`);
  }
  if (summary.netSales != null) lines.push(`Net sales (gross − refunds/returns): ${formatMoney(summary.netSales, ccy)}`);
  if (summary.totalFees != null) lines.push(`Processing fees (non-cash rows): ${formatMoney(summary.totalFees, ccy)}`);
  if (summary.totalAfterFees != null) lines.push(`Net payout (gross − fees): ${formatMoney(summary.totalAfterFees, ccy)}`);
  if (summary.cashTotalAmount != null && summary.cashTotalAmount > 0.005) {
    lines.push(`Cash total (rows classified as cash; no fee on those): ${formatMoney(summary.cashTotalAmount, ccy)}`);
  }
  if (summary.totalTransactionRows > 0) {
    lines.push(
      `Transactions (lines): card ${summary.cardTransactionCount}, cash ${summary.cashTransactionCount}, other ${summary.otherTransactionCount}; total rows ${summary.totalTransactionRows}`,
    );
  }
  if (summary.sumOfTransactionRowAmounts > 0.005) {
    lines.push(`Sum of positive order line amounts: ${formatMoney(summary.sumOfTransactionRowAmounts, ccy)}`);
  }
  if (summary.semanticNote) lines.push(summary.semanticNote);
  return lines;
}
