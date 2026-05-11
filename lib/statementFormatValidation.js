/**
 * Post-parse **format / column-map** validation. Runs after augments and volume sync so `pos_transactions`
 * from XLSX harvest is visible. Sets `parse_issues` codes and `report_ui.format_compatibility_notice` instead
 * of silently showing wrong line rollups.
 */

import { buildPosSemanticOrderRollup, describePosSemanticRollupQuality } from './posOrderSemanticRollup.js';
import { pickPosTransactionArrays } from './posBatchCommissionAnalysis.js';

const TABULAR_FILE_TYPES = new Set(['csv', 'xlsx', 'xls', 'xlsm']);

const ISSUE_TABULAR_POS_MAP = 'tabular_pos_semantic_map_failed';
const ISSUE_TABULAR_POS_LOW = 'tabular_pos_semantic_map_low_confidence';
const ISSUE_TABULAR_POS_CARD = 'tabular_pos_card_mix_unverified';

/**
 * @param {object|null|undefined} parsed
 * @returns {object|null|undefined}
 */
export function applyFormatCompatibilityLayer(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;

  const issues = Array.isArray(parsed.parse_issues) ? [...parsed.parse_issues] : [];
  const had = new Set(issues.map((x) => String(x)));

  const ft = String(parsed.file_type ?? '').toLowerCase();
  const fn = String(parsed.fileName ?? '');
  const looksTabular =
    TABULAR_FILE_TYPES.has(ft) || /\.(csv|xlsx|xls|xlsm)$/i.test(fn);

  const tx = pickPosTransactionArrays(parsed);
  const semanticOk = Boolean(buildPosSemanticOrderRollup(parsed));
  const quality = describePosSemanticRollupQuality(parsed);

  if (looksTabular && tx.length >= 6 && !semanticOk && !had.has(ISSUE_TABULAR_POS_MAP)) {
    issues.push(ISSUE_TABULAR_POS_MAP);
    had.add(ISSUE_TABULAR_POS_MAP);
  }

  if (looksTabular && tx.length >= 6 && quality.hasRollup && quality.weakMapping && !had.has(ISSUE_TABULAR_POS_LOW)) {
    issues.push(ISSUE_TABULAR_POS_LOW);
    had.add(ISSUE_TABULAR_POS_LOW);
  }

  if (looksTabular && tx.length >= 8 && quality.hasRollup && quality.cardMixUnverified && !had.has(ISSUE_TABULAR_POS_CARD)) {
    issues.push(ISSUE_TABULAR_POS_CARD);
    had.add(ISSUE_TABULAR_POS_CARD);
  }

  const prevRu =
    parsed.report_ui && typeof parsed.report_ui === 'object' && !Array.isArray(parsed.report_ui)
      ? parsed.report_ui
      : {};
  const ru = { ...prevRu };

  const noticeParts = [];
  if (had.has(ISSUE_TABULAR_POS_MAP)) {
    noticeParts.push(
      'Tabular payment rows are present, but column headings did not map to sale / fee / tender roles with enough confidence. **Do not rely on line-level POS totals** from this file until headings are mapped. Add **heading_role_aliases** (or **heading_role_aliases_by_template_id** for your format id), or extend built-in rules in `lib/statementHeadingRoleMap.js`. See docs/DETERMINISTIC_PIPELINE.md.',
    );
  }
  if (had.has(ISSUE_TABULAR_POS_LOW)) {
    noticeParts.push(
      'A semantic POS column map was found, but **confidence is low** (weak header match or fees look inconsistent). Treat per-line gross, fees, and net as **provisional** — prefer statement headline totals or add explicit **heading_role_aliases** / template bundles for this bank export.',
    );
  }
  if (had.has(ISSUE_TABULAR_POS_CARD)) {
    noticeParts.push(
      '**Card / tender split is not verified** on this tabular file: no confident tender column, no parser **card_brand_mix**, and we could not build a line-level tender volume mix. Channel card charts may omit or bucket types until headings map card / payment columns.',
    );
  }
  if (noticeParts.length) {
    ru.format_compatibility_notice = noticeParts.join('\n\n');
  }

  const prevLen = Array.isArray(parsed.parse_issues) ? parsed.parse_issues.length : 0;
  const noticeChanged = ru.format_compatibility_notice !== prevRu.format_compatibility_notice;
  const issuesChanged = issues.length !== prevLen;

  if (!issuesChanged && !noticeChanged) {
    return parsed;
  }

  return {
    ...parsed,
    parse_issues: issues,
    report_ui: ru,
  };
}
