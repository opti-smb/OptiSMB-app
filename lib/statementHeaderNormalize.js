/**
 * Canonical header / label normalization for statement grids and column mapping.
 * Used by POS semantic rollups, heading role aliases, e‑commerce column meta, and tabular harvesters.
 *
 * Normalizes: split **camelCase** / **PascalCase** / **snake_case** tokens, NFKC, strip combining marks,
 * lowercase, collapse punctuation to spaces, non-breaking spaces, and repeated whitespace.
 *
 * @param {unknown} s
 * @returns {string}
 */
export function normalizeStatementHeader(s) {
  let t = String(s ?? '')
    .replace(/[\uFEFF\u200B-\u200D\u2060]/g, '')
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  t = t.replace(/\u00a0/g, ' ');
  t = t.replace(/[\u2000-\u200b\u202f\u205f\u3000]/g, ' ');
  t = t.replace(/[^a-z0-9\s\u00C0-\u024F\u0400-\u04FF]/gi, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

/** @deprecated Prefer {@link normalizeStatementHeader}; kept for existing imports. */
export const normalizeHeaderText = normalizeStatementHeader;
