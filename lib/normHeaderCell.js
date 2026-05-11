/**
 * Normalize spreadsheet header / label cell text for fuzzy matching across exports.
 * Delegates to {@link normalizeStatementHeader} after light Excel-specific cleanup so
 * workbook e‑commerce / POS column scoring matches `posOrderSemanticRollup` + `heading_role_aliases`.
 */
import { normalizeStatementHeader } from './statementHeaderNormalize.js';

/**
 * @param {unknown} c
 * @returns {string}
 */
export function normHeaderCell(c) {
  let s = String(c ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim()
    .toLowerCase();
  s = s.replace(/[\u2013\u2014\u2212]/g, '-');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s*•]+/, '').replace(/[\s*•]+$/, '').trim();
  s = s.replace(/\s*[:;]+\s*$/, '').trim();
  s = s.replace(/\s*\(\s*(usd|cad|eur|gbp|aud|inr)\s*\)\s*$/i, '').trim();
  return normalizeStatementHeader(s);
}
