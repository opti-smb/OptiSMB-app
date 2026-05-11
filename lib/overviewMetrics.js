/**
 * Report Overview headline metrics: prefers **bank-classified** POS + e‑commerce credits for Net revenue when
 * deposit lines exist, otherwise {@link displayOverviewNetAfterFees}.
 */

import { displayOverviewNetAfterFees } from './utils.js';
import { overviewNetRevenueFromBankCredits } from './bankStatementChannelSplit.js';

const EPS = 0.005;

/**
 * @param {object|null|undefined} parsedData
 * @param {number|null|undefined} impliedNetFromGrossMinusFees
 * @returns {{ amount: number | null, sub: string, subSecondary?: string | null, kpiLabel: string }}
 */
export function getOverviewNetRevenueDisplay(parsedData, impliedNetFromGrossMinusFees = null) {
  if (!parsedData || typeof parsedData !== 'object') {
    return displayOverviewNetAfterFees(parsedData, impliedNetFromGrossMinusFees);
  }
  const bank = overviewNetRevenueFromBankCredits(parsedData);
  if (bank && bank.amount > EPS) {
    return {
      amount: bank.amount,
      sub: bank.sub,
      subSecondary: bank.subSecondary,
      kpiLabel: 'Net revenue',
    };
  }
  return displayOverviewNetAfterFees(parsedData, impliedNetFromGrossMinusFees);
}
