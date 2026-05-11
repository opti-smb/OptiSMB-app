/**
 * Tunable thresholds for statement parsing / merge / finalize (not merchant data).
 * Override per-upload via `parsedData.statement_heuristics` (shallow merge per section).
 */

const EPS = 0.005;

/** @typedef {{ [k: string]: number | Record<string, number> }} HeuristicSection */

/**
 * @returns {Record<string, Record<string, number>>}
 */
function deepMergeSections(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return base;
  const out = { ...base };
  for (const key of Object.keys(base)) {
    const b = base[key];
    const o = over[key];
    if (o != null && typeof o === 'object' && !Array.isArray(o) && typeof b === 'object' && b && !Array.isArray(b)) {
      out[key] = { ...b, ...o };
    } else if (typeof o === 'number' && Number.isFinite(o)) {
      out[key] = o;
    }
  }
  return out;
}

/**
 * Default thresholds only — all amounts are relative / structural, not tied to a merchant.
 */
export const DEFAULT_STATEMENT_HEURISTICS = Object.freeze({
  recon: Object.freeze({
    minSplitSumDollarsForBogusScalar: 2000,
    reconBelowSplitSumFraction: 0.35,
    minAbsoluteGapDollarsVsSplit: 500,
    minBankLineSumDollarsForCreditRepair: 99,
    bankCreditsBelowLinesSumFraction: 0.35,
    bankCreditsVsSplitBogusLineMultiplier: 1.5,
    bankRowCreditFloor: 0.02,
  }),
  channelGrossInference: Object.freeze({
    minVolumeDollars: 500,
    maxRefundToVolumeRatio: 0.4,
    maxFeeToVolumeToInferNetVolume: 0.018,
  }),
  aggregateFeeBackfill: Object.freeze({
    minGrossPerBucket: 800,
    maxFeeToGrossRatioToTriggerBackfill: 0.02,
    minDeltaDollarsVsSum: 80,
    maxTotalFeesToGrossSumFraction: 0.1,
  }),
  linkedMerge: Object.freeze({
    grossEps: 0.5,
    maxFeesToGrossRatio: 0.22,
    minGrossDollarsForFeeRatioCheck: 25_000,
    ecomNetPlusRefundMinVolume: 500,
    ecomMaxFeeToVolumeBeforeGrossBump: 0.018,
    ecomFeeAlignVsRowMultiplier: 1.2,
    ecomFeeAlignMinGapDollars: 25,
    ecomFeeAlignMaxFeesVsVolume: 0.12,
    ecomFeeAlignMinVolume: 1000,
    minApiNetDepositDollars: 1000,
    minCashTenderGrossDollars: 100,
  }),
});

/**
 * @param {object | null | undefined} parsedData
 * @returns {typeof DEFAULT_STATEMENT_HEURISTICS}
 */
export function getStatementHeuristics(parsedData) {
  const over = parsedData?.statement_heuristics;
  if (over && typeof over === 'object' && !Array.isArray(over)) {
    return /** @type {typeof DEFAULT_STATEMENT_HEURISTICS} */ (
      deepMergeSections(DEFAULT_STATEMENT_HEURISTICS, over)
    );
  }
  return DEFAULT_STATEMENT_HEURISTICS;
}

export { EPS as STATEMENT_HEURISTIC_EPS };
