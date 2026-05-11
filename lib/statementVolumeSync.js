/**
 * Enhanced statement volume synchronization with improved channel detection and validation.
 * Ensures accurate POS, e-commerce, and cash volume mapping.
 */

import { effectiveRatePercentFromTotals } from './financialAnalysisFormulas.js';
import {
  channelSplitCashRowDisplayVolume,
  channelGrossSalesVolumeForAggregation,
  resolveChannelSplitBucket,
  sumChannelSplitPlainVolumes,
} from './utils.js';

const EPS = 0.005;

/**
 * Linked Overview: persist processor gross headline (cash excluded). Prefer **rounded** `pos_volume` + `ecomm_volume`
 * (already synced from the channel walk) so `total_transaction_volume` never drifts by half‑cent rounding from
 * `round(posSum + ecomSum) ≠ round(posSum) + round(ecomSum)`.
 */
function syncLinkedHeadlineTotalVolume(parsed, precomputedProcessorSum = null) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  if (parsed.golden_reconciliation_workbook) return parsed;
  const linked =
    linkedCombinedStatementHint(parsed) && parsed.golden_reconciliation_workbook !== true;
  if (!linked) return parsed;

  const pv = Number(parsed.pos_volume);
  const ev = Number(parsed.ecomm_volume);
  let plain = null;
  const sumSynced =
    (Number.isFinite(pv) ? pv : 0) + (Number.isFinite(ev) ? ev : 0);
  if (sumSynced > EPS) {
    plain = Math.round(sumSynced * 100) / 100;
  } else if (
    precomputedProcessorSum != null &&
    Number.isFinite(precomputedProcessorSum) &&
    precomputedProcessorSum > EPS
  ) {
    plain = Math.round(precomputedProcessorSum * 100) / 100;
  }
  if (plain == null || !(plain > EPS)) {
    plain = sumChannelSplitPlainVolumes(parsed, { excludeCash: true });
  }
  if (plain == null || !(plain > EPS)) return parsed;

  const rounded = Math.round(plain * 100) / 100;
  const next = { ...parsed, total_transaction_volume: rounded };
  const tf = Number(next.total_fees_charged);
  if (tf >= 0 && Number.isFinite(tf) && rounded > EPS) {
    const er = effectiveRatePercentFromTotals(tf, rounded);
    if (er != null) next.effective_rate = er;
  }
  return next;
}

/**
 * Check if this is a linked combined statement
 */
function linkedCombinedStatementHint(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  if (parsed.golden_reconciliation_workbook) return true;
  const b = parsed.linked_statement_bundle;
  if (b && typeof b === 'object') return true;
  if (/^combined\b/i.test(String(parsed.fileName ?? '').trim())) return true;
  return false;
}

export function syncParsedDataVolumeScalars(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const cs = parsed.channel_split;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) return parsed;

  let next = { ...parsed };

  let cashRowCount = 0;
  for (const key of Object.keys(cs)) {
    const row = cs[key];
    if (!row || typeof row !== 'object') continue;
    if (resolveChannelSplitBucket(key, row) === 'cash') cashRowCount++;
  }
  const cashFileHintOk = cashRowCount <= 1;

  let posSum = 0;
  let ecomSum = 0;
  let cashSum = 0;
  
  // Enhanced channel detection with better field validation
  for (const key of Object.keys(cs)) {
    const row = cs[key];
    if (!row || typeof row !== 'object') continue;
    const bucket = resolveChannelSplitBucket(key, row);
    
    if (bucket === 'cash') {
      const cv = channelSplitCashRowDisplayVolume(next, row, {
        allowFileLevelCashHint: cashFileHintOk,
      });
      if (cv > EPS) cashSum += cv;
      continue;
    }
    
    // Enhanced gross volume calculation for POS and e-commerce
    const v = channelGrossSalesVolumeForAggregation(row, next, bucket);
    if (!Number.isFinite(v) || !(v > EPS)) continue;
    
    if (bucket === 'pos') {
      posSum += v;
    } else if (bucket === 'ecom') {
      ecomSum += v;
    }
  }
  
  // Update volumes with better validation
  if (posSum > EPS) next.pos_volume = Math.round(posSum * 100) / 100;
  if (ecomSum > EPS) next.ecomm_volume = Math.round(ecomSum * 100) / 100;
  if (cashSum > EPS) next.cash_volume = Math.round(cashSum * 100) / 100;

  // Enhanced total volume calculation
  const processorTotalRaw = posSum + ecomSum;
  next = syncLinkedHeadlineTotalVolume(
    next,
    processorTotalRaw > EPS ? processorTotalRaw : null,
  );

  return next;
}
