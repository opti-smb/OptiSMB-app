/**
 * Statement-scoped card / tender **slug** identity with stable display and optional stored names
 * (`parsedData.channel_card_display_slug_map`).
 */

/** Canonical UI labels for normalized slugs (processor text varies per statement). */
const CANONICAL_SLUG_LABEL = {
  cash: 'Cash',
  visa: 'Visa',
  mastercard: 'Mastercard',
  mc: 'Mastercard',
  amex: 'American Express',
  'american-express': 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  maestro: 'Maestro',
  interac: 'Interac',
  unionpay: 'UnionPay',
  debitcard: 'Debit card',
  creditcard: 'Credit card',
  prepaid: 'Prepaid',
  paypal: 'PayPal',
  ach: 'ACH',
  'other-non-cash': 'Other (card)',
  'unknown-tender': 'Unknown tender',
  'other-unknown-tender': 'Other (no card / tender on line)',
};

/**
 * Title-case a slug for display when we have no better label.
 * @param {string} slug
 */
function titleCaseFromSlug(slug) {
  const s = String(slug ?? '')
    .trim()
    .replace(/-/g, ' ');
  if (!s) return '—';
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * UI label for a card/tender **slug** on this statement.
 * Order: stored map on parse → built-in canonical → title-case slug → raw fallback.
 *
 * @param {string} slug normalized id (e.g. `visa`, `visa-debit`)
 * @param {string} [sourceLabel] text seen on the file for this slug (stored on first encounter)
 * @param {Record<string, string> | null | undefined} [slugMap] `parsedData.channel_card_display_slug_map`
 */
export function displayLabelForCardSlug(slug, sourceLabel = '', slugMap = null) {
  const u = String(slug ?? '').trim().toLowerCase();
  if (!u) return String(sourceLabel || '').trim() || '—';
  const stored = slugMap && typeof slugMap === 'object' && !Array.isArray(slugMap) ? slugMap[u] ?? slugMap[slug] : null;
  if (stored != null && String(stored).trim() !== '') return String(stored).trim();
  if (CANONICAL_SLUG_LABEL[u]) return CANONICAL_SLUG_LABEL[u];
  const raw = String(sourceLabel ?? '').trim();
  if (raw) return raw.length <= 48 ? raw : `${raw.slice(0, 45)}…`;
  return titleCaseFromSlug(u);
}

/**
 * Merge newly discovered slug → source labels into `parsedData.channel_card_display_slug_map`
 * (does not overwrite existing keys so prior runs / edits keep precedence).
 *
 * @param {object} pd finalized parsed payload
 * @param {Record<string, string>} additions slug → first-seen label from this parse
 * @returns {object} shallow-cloned `pd` with merged map (always sets key when additions non-empty or map existed)
 */
export function mergeChannelCardSlugMap(pd, additions) {
  if (!pd || typeof pd !== 'object') return pd;
  const prev =
    pd.channel_card_display_slug_map && typeof pd.channel_card_display_slug_map === 'object' && !Array.isArray(pd.channel_card_display_slug_map)
      ? { ...pd.channel_card_display_slug_map }
      : {};
  const add = additions && typeof additions === 'object' ? additions : {};
  for (const [k, v] of Object.entries(add)) {
    const slug = String(k).trim().toLowerCase();
    const lab = String(v ?? '').trim();
    if (!slug || !lab) continue;
    if (prev[slug] == null || String(prev[slug]).trim() === '') prev[slug] = lab;
  }
  if (Object.keys(prev).length === 0) return pd;
  return { ...pd, channel_card_display_slug_map: prev };
}
