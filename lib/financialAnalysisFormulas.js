/**
 * **Financial Analysis Formula sheet** — Bank Statement, POS, Ecommerce, Reconciliation, KPIs, data cleaning.
 *
 * Scalar math is implemented below. Spreadsheet-only: FILTER, IF/SEARCH categorization, workbook layout, Notes.
 * Column totals: `sumColumn` / `countNonEmpty` (Excel SUM / COUNTA).
 */

export function roundMoney2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function roundRate4(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

/** Total Credits / Total Debits / any SUM(Column) — sums finite numeric cells. */
export function sumColumn(values) {
  if (!Array.isArray(values)) return 0;
  let s = 0;
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) s += n;
  }
  return s;
}

/** Total Orders := COUNTA(Order_ID_Column) — non-null, non-blank entries. */
export function countNonEmpty(values) {
  if (!Array.isArray(values)) return 0;
  let n = 0;
  for (const v of values) {
    if (v == null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    n++;
  }
  return n;
}

/** Cash vs Card Mix: both shares vs gross (Cash/Gross, Card/Gross). */
export function posCashCardMixShares(cashSales, cardSales, grossSales) {
  const g = Number(grossSales);
  if (!(g > 0)) return { cashShare: null, cardShare: null };
  return { cashShare: Number(cashSales) / g, cardShare: Number(cardSales) / g };
}

/** Step 3: Actual Bank Deposits := SUM(Bank Credit Column). */
export function reconciliationSumBankCredits(creditAmounts) {
  return sumColumn(creditAmounts);
}

/** Step 5: Total Expenses := SUM(Bank Debit Column). */
export function reconciliationSumBankDebits(debitAmounts) {
  return sumColumn(debitAmounts);
}

/** TRIM(Cell): trim + collapse internal whitespace (Excel-style). */
export function excelTrim(cell) {
  if (cell == null) return '';
  return String(cell).replace(/\s+/g, ' ').trim();
}

/**
 * VALUE(Cell): parse a number from text (strips commas); null if not finite.
 * Locale-specific dates: use your parser for DATEVALUE.
 */
export function excelNumericValue(cell) {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number' && Number.isFinite(cell)) return cell;
  const n = Number(String(cell).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/** XLOOKUP(Value, LookupRange, ReturnRange) — first exact match. */
export function excelXLookup(needle, lookupRange, returnRange) {
  if (!Array.isArray(lookupRange) || !Array.isArray(returnRange)) return undefined;
  const i = lookupRange.findIndex((x) => x === needle || String(x) === String(needle));
  return i >= 0 ? returnRange[i] : undefined;
}

/** Net Cash Flow := Total Credits − Total Debits */
export function bankNetCashFlow(totalCredits, totalDebits) {
  return Number(totalCredits) - Number(totalDebits);
}

/** Closing Balance Validation: Opening + Credits − Debits */
export function bankImpliedClosingBalance(openingBalance, totalCredits, totalDebits) {
  return Number(openingBalance) + Number(totalCredits) - Number(totalDebits);
}

/** Daily Balance := Previous Balance + Credit − Debit */
export function bankDailyBalance(previousBalance, credit, debit) {
  return Number(previousBalance) + Number(credit) - Number(debit);
}

/** Net Deposit (Total) := SUM(Gross Sales) − SUM(Fees) */
export function posNetDepositTotal(sumGrossSales, sumFees) {
  return Number(sumGrossSales) - Number(sumFees);
}

/** Net Deposit (Row-wise) := Gross Sales − Fees */
export function posNetDepositRow(grossSales, fees) {
  return Number(grossSales) - Number(fees);
}

/** POS Fee Percentage := Fees / Gross Sales (0–100 scale) */
export function posFeePercentOfGross(totalFees, grossSales) {
  const g = Number(grossSales);
  const f = Number(totalFees);
  if (!(g > 0)) return null;
  const pct = (f / g) * 100;
  if (pct < 0 || pct > 25) return null;
  return roundRate4(pct);
}

/** Cash vs Card Mix: one channel / gross */
export function posChannelShare(channelSales, grossSales) {
  const g = Number(grossSales);
  if (!(g > 0)) return null;
  return Number(channelSales) / g;
}

/** Validation: |Cash + Card − Gross| */
export function posCashPlusCardResidual(cashSales, cardSales, grossSales) {
  return Math.abs(Number(cashSales) + Number(cardSales) - Number(grossSales));
}

/** Net Settlement (Total) := SUM(Gross) − SUM(Fees) */
export function ecommerceNetSettlementTotal(sumGross, sumFees) {
  return Number(sumGross) - Number(sumFees);
}

/** Net Settlement (Row-wise) */
export function ecommerceNetSettlementRow(grossAmount, fees) {
  return Number(grossAmount) - Number(fees);
}

/** AOV := Total Revenue / Total Orders */
export function ecommerceAverageOrderValue(totalRevenue, orderCount) {
  const n = Math.floor(Number(orderCount));
  if (!(Number(totalRevenue) >= 0) || !(n > 0)) return null;
  return roundMoney2(Number(totalRevenue) / n);
}

/** Ecommerce Fee Percentage := Fees / Revenue */
export function ecommerceFeePercentOfRevenue(totalFees, totalRevenue) {
  const r = Number(totalRevenue);
  const f = Number(totalFees);
  if (!(r > 0)) return null;
  return roundRate4((f / r) * 100);
}

/** Total Revenue := POS Gross + Ecommerce Revenue */
export function reconciliationTotalRevenue(posGrossSales, ecommerceRevenue) {
  return Number(posGrossSales) + Number(ecommerceRevenue);
}

export function reconciliationPosNetDeposits(posGrossSales, posFees) {
  return Number(posGrossSales) - Number(posFees);
}

export function reconciliationEcommerceNetDeposits(ecommerceRevenue, ecommerceFees) {
  return Number(ecommerceRevenue) - Number(ecommerceFees);
}

export function reconciliationExpectedDeposits(posNet, ecommerceNet) {
  return Number(posNet) + Number(ecommerceNet);
}

/** Reconciliation Difference := Expected Deposits − Actual Bank Credits */
export function reconciliationDifference(expectedDeposits, actualBankCredits) {
  return Number(expectedDeposits) - Number(actualBankCredits);
}

/** Deposit Efficiency := Actual Bank Credits / Total Revenue */
export function kpiDepositEfficiency(actualBankCredits, totalRevenue) {
  const r = Number(totalRevenue);
  if (!(r > 0)) return null;
  return Number(actualBankCredits) / r;
}

/** Total Fee Percentage := (POS Fees + Ecommerce Fees) / Total Revenue */
export function kpiTotalFeePercent(posFees, ecommerceFees, totalRevenue) {
  const r = Number(totalRevenue);
  if (!(r > 0)) return null;
  return roundRate4(((Number(posFees) + Number(ecommerceFees)) / r) * 100);
}

export function kpiRevenueSplit(posRevenue, ecommerceRevenue) {
  const t = Number(posRevenue) + Number(ecommerceRevenue);
  if (!(t > 0)) return { pos: null, ecommerce: null };
  return {
    pos: Number(posRevenue) / t,
    ecommerce: Number(ecommerceRevenue) / t,
  };
}

/** Approximate Profit := Total Deposits − Total Expenses */
export function kpiApproximateProfit(totalDeposits, totalExpenses) {
  return Number(totalDeposits) - Number(totalExpenses);
}

/** Blended effective rate: Total Fees / Total Gross Volume × 100 */
export function effectiveRatePercentFromTotals(totalFeesCharged, totalGrossVolume) {
  const gv = Number(totalGrossVolume);
  const tf = Number(totalFeesCharged);
  if (!(gv > 0) || tf < 0) return null;
  const rate = (tf / gv) * 100;
  if (rate < 0 || rate > 25) return null;
  return roundRate4(rate);
}

/** Part / total as percent (two decimals) */
export function percentOfTotal(part, total) {
  const tf = Number(total);
  if (!(tf > 0)) return null;
  return Math.round((10000 * Number(part)) / tf) / 100;
}

/** @deprecated use `percentOfTotal` */
export const pctOfTotal = percentOfTotal;
