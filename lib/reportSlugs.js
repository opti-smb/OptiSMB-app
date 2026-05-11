/**
 * Stable DOM ids / URL fragments for report sections. Pass fixed ASCII segments only (tab + section key).
 * @param {...string} parts
 * @returns {string} e.g. report-discrepancy-channel-split
 */
export function reportSectionSlug(...parts) {
  const body = parts
    .filter((x) => x != null && String(x).trim() !== '')
    .map((x) =>
      String(x)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean)
    .join('-');
  if (!body) return 'report-section';
  const full = `report-${body}`;
  return full.length > 120 ? full.slice(0, 120).replace(/-+$/g, '') : full;
}

/**
 * Turn a parser- or UI-driven title into a short slug suffix (for ids when you want the visible name reflected).
 * @param {string} text
 * @returns {string}
 */
export function slugifyReportHeading(text) {
  const s = String(text ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s ? s.slice(0, 56).replace(/-+$/g, '') : 'section';
}
