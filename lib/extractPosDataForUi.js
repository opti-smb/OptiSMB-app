/**
 * Single entry for **POS-derived** figures used by `statementClientModel.js` (`buildStatementClientModel`),
 * discrepancy plain-English lines (when `pos` is passed through), and fee-line resolution in `utils`.
 * Pulls line-level totals from transaction/header semantic rollup; batch spotlight only when it comes from
 * POS batch or transaction rows (never `channel_split` roll-up placeholders).
 */

import { getPosBatchCommissionAnalysis } from './posBatchCommissionAnalysis.js';
import { buildPosStatementExtractionSummary } from './posStatementExtractionSummary.js';

/**
 * One call site for POS UI: semantic line summary + full batch analysis, with a filtered spotlight object when the
 * winner is not a `channel_split` roll-up placeholder.
 *
 * @param {object|null|undefined} parsedData
 * @returns {{ summary: object | null; spotlightAnalysis: object | null; batchAnalysis: object | null }}
 */
export function extractPosDataForUi(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') {
    return { summary: null, spotlightAnalysis: null, batchAnalysis: null };
  }

  const summary = buildPosStatementExtractionSummary(parsedData);
  const full = getPosBatchCommissionAnalysis(parsedData);

  const spotlightAnalysis =
    full?.spotlightBatch && !full.spotlightBatch.channelRollup ? full : null;

  return { summary, spotlightAnalysis, batchAnalysis: full ?? null };
}
