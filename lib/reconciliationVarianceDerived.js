/** Fills missing `reconciliation_variance` using {@link computeReconciliationDifferenceValue} from `utils.js`. */
import { computeReconciliationDifferenceValue } from './utils.js';

function optionalFiniteNum(x) {
  if (x == null || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sets `reconciliation_variance` when derivable but missing so dashboards and exports show the dollar gap.
 * @param {object} parsed
 * @returns {object}
 */
export function ensureDerivedReconciliationVarianceField(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  if (optionalFiniteNum(parsed.reconciliation_variance) != null) return parsed;
  const d = computeReconciliationDifferenceValue(parsed);
  if (d == null || !Number.isFinite(d)) return parsed;
  return { ...parsed, reconciliation_variance: d };
}
