/**
 * Extensible **column title → semantic role** hints for tabular POS / order rows.
 *
 * - **Built-in** rules ship in code (new headings: add a row here or ship parser aliases).
 * - **Parser / template / profile**: merged from (in order) built-ins, then each source below — later entries win on ties.
 *   - `heading_role_aliases` — array `{ match, role }` / `{ header, role }` or object `{ "Header text": "gross" }`
 *   - `statement_format_profile.heading_role_aliases`
 *   - `statement_template.heading_role_aliases`
 *   - `heading_role_alias_bundles[]` — array of objects/arrays (e.g. one bundle per acquirer tag)
 *   - `heading_role_aliases_by_template_id[id]` — keyed library when `statement_format_id` / `format_template_id` is set
 *
 * Roles align with {@link inferMapping} in `posOrderSemanticRollup.js`: `gross`, `refund`, `fee`, `tender`, `net`, `orderId`.
 */

import { normalizeStatementHeader } from './statementHeaderNormalize.js';

/** @typedef {'gross'|'refund'|'fee'|'tender'|'net'|'orderId'} HeadingSemanticRole */

const VALID_ROLES = new Set(['gross', 'refund', 'fee', 'tender', 'net', 'orderId']);

/**
 * @type {{ match: string, role: HeadingSemanticRole, builtin?: boolean, minSubstring?: number }[]}
 * `match` is already normalized; built-ins use substring length ≥ 6 to limit false positives.
 */
const BUILTIN_HEADING_ROLE_RULES = [
  { match: 'gross sales', role: 'gross', builtin: true, minSubstring: 6 },
  { match: 'gross amount', role: 'gross', builtin: true, minSubstring: 6 },
  { match: 'total charged', role: 'gross', builtin: true, minSubstring: 6 },
  { match: 'sale amount', role: 'gross', builtin: true, minSubstring: 6 },
  { match: 'auth amount', role: 'gross', builtin: true, minSubstring: 6 },
  { match: 'payment amount', role: 'gross', builtin: true, minSubstring: 6 },
  { match: 'collected amount', role: 'gross', builtin: true, minSubstring: 6 },
  { match: 'ticket amount', role: 'gross', builtin: true, minSubstring: 6 },
  { match: 'charge amount', role: 'gross', builtin: true, minSubstring: 6 },
  { match: 'transaction amount', role: 'gross', builtin: true, minSubstring: 6 },
  { match: 'txn amount', role: 'gross', builtin: true, minSubstring: 6 },
  { match: 'invoice amount', role: 'gross', builtin: true, minSubstring: 6 },
  { match: 'billed amount', role: 'gross', builtin: true, minSubstring: 6 },
  { match: 'montant brut', role: 'gross', builtin: true, minSubstring: 6 },
  { match: 'importe bruto', role: 'gross', builtin: true, minSubstring: 6 },
  { match: 'refund amount', role: 'refund', builtin: true, minSubstring: 6 },
  { match: 'refund total', role: 'refund', builtin: true, minSubstring: 6 },
  { match: 'returns', role: 'refund', builtin: true, minSubstring: 6 },
  { match: 'chargeback', role: 'refund', builtin: true, minSubstring: 6 },
  { match: 'montant rembourse', role: 'refund', builtin: true, minSubstring: 6 },
  { match: 'processing fee', role: 'fee', builtin: true, minSubstring: 6 },
  { match: 'merchant discount', role: 'fee', builtin: true, minSubstring: 6 },
  { match: 'service charge', role: 'fee', builtin: true, minSubstring: 6 },
  { match: 'interchange fee', role: 'fee', builtin: true, minSubstring: 6 },
  { match: 'mdr amount', role: 'fee', builtin: true, minSubstring: 6 },
  { match: 'frais de traitement', role: 'fee', builtin: true, minSubstring: 6 },
  { match: 'acquirer fee', role: 'fee', builtin: true, minSubstring: 6 },
  { match: 'scheme fee', role: 'fee', builtin: true, minSubstring: 6 },
  { match: 'payment method', role: 'tender', builtin: true, minSubstring: 6 },
  { match: 'card type', role: 'tender', builtin: true, minSubstring: 6 },
  { match: 'card brand', role: 'tender', builtin: true, minSubstring: 6 },
  { match: 'card scheme', role: 'tender', builtin: true, minSubstring: 6 },
  { match: 'payment brand', role: 'tender', builtin: true, minSubstring: 6 },
  { match: 'payment network', role: 'tender', builtin: true, minSubstring: 6 },
  { match: 'tender type', role: 'tender', builtin: true, minSubstring: 6 },
  { match: 'tender description', role: 'tender', builtin: true, minSubstring: 6 },
  { match: 'net deposit', role: 'net', builtin: true, minSubstring: 6 },
  { match: 'net payout', role: 'net', builtin: true, minSubstring: 6 },
  { match: 'settlement net', role: 'net', builtin: true, minSubstring: 6 },
  { match: 'order id', role: 'orderId', builtin: true, minSubstring: 6 },
  { match: 'transaction id', role: 'orderId', builtin: true, minSubstring: 6 },
  { match: 'receipt number', role: 'orderId', builtin: true, minSubstring: 6 },
];

/** @param {unknown} raw */
function pushHeadingAliasChunk(out, raw) {
  if (Array.isArray(raw)) {
    for (const e of raw) {
      if (!e || typeof e !== 'object') continue;
      const m = normalizeStatementHeader(e.match ?? e.pattern ?? e.header ?? e.from ?? e.source ?? '');
      const role = String(e.role ?? e.semantic ?? e.to ?? '').trim().toLowerCase();
      if (!m || !VALID_ROLES.has(role)) continue;
      out.push({
        match: m,
        role: /** @type {HeadingSemanticRole} */ (role),
        builtin: false,
        minSubstring: Number.isFinite(Number(e.minSubstring)) ? Math.max(2, Number(e.minSubstring)) : 4,
      });
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      const m = normalizeStatementHeader(k);
      const role = String(v ?? '').trim().toLowerCase();
      if (!m || !VALID_ROLES.has(role)) continue;
      out.push({ match: m, role: /** @type {HeadingSemanticRole} */ (role), builtin: false, minSubstring: 4 });
    }
  }
}

/**
 * @param {object|null|undefined} parsedData
 * @returns {{ match: string, role: HeadingSemanticRole, builtin?: boolean, minSubstring?: number }[]}
 */
export function mergeHeadingRoleRules(parsedData) {
  const out = BUILTIN_HEADING_ROLE_RULES.map((r) => ({ ...r }));
  if (!parsedData || typeof parsedData !== 'object') return out;

  pushHeadingAliasChunk(out, parsedData.heading_role_aliases);
  const profile = parsedData.statement_format_profile;
  if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
    pushHeadingAliasChunk(out, profile.heading_role_aliases);
  }
  const tmpl = parsedData.statement_template;
  if (tmpl && typeof tmpl === 'object' && !Array.isArray(tmpl)) {
    pushHeadingAliasChunk(out, tmpl.heading_role_aliases);
  }
  const bundles = parsedData.heading_role_alias_bundles;
  if (Array.isArray(bundles)) {
    for (const b of bundles) pushHeadingAliasChunk(out, b);
  }
  const tid = parsedData.statement_format_id ?? parsedData.format_template_id ?? parsedData.acquirer_format_id;
  const byId = parsedData.heading_role_aliases_by_template_id;
  if (tid != null && byId && typeof byId === 'object' && !Array.isArray(byId)) {
    const chunk = byId[String(tid)] ?? byId[Number(tid)];
    pushHeadingAliasChunk(out, chunk);
  }

  return out;
}

function headingTokens(norm) {
  return norm.split(' ').filter((t) => t.length > 2);
}

function tokenOverlapScore(keyNorm, phraseNorm) {
  const A = new Set(headingTokens(keyNorm));
  const B = new Set(headingTokens(phraseNorm));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) {
    if (B.has(t)) inter += 1;
  }
  const union = A.size + B.size - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Best semantic role for a raw column key from merged alias rules (longest / strongest match wins).
 * @param {object|null|undefined} parsedData
 * @param {string} columnKey object key from a transaction row
 * @returns {HeadingSemanticRole | null}
 */
export function resolveHeadingSemanticRole(parsedData, columnKey) {
  const keyNorm = normalizeStatementHeader(columnKey);
  if (!keyNorm) return null;
  const rules = mergeHeadingRoleRules(parsedData);
  let best = null;
  let bestWeight = -1;

  for (const r of rules) {
    if (!r.match || !VALID_ROLES.has(r.role)) continue;
    const minSub = r.minSubstring ?? (r.builtin ? 6 : 4);
    if (keyNorm === r.match) {
      const w = 1000 + r.match.length;
      if (w >= bestWeight) {
        best = r.role;
        bestWeight = w;
      }
      continue;
    }
    if (r.match.length >= minSub && keyNorm.includes(r.match)) {
      const w = 100 + r.match.length;
      if (w > bestWeight) {
        best = r.role;
        bestWeight = w;
      }
    }
  }

  if (best != null) return best;

  /** Token overlap for **non-builtin** rules (templates / parser) — maps unseen headings that normalize to similar tokens. */
  let bestOv = -1;
  let bestRoleOv = null;
  for (const r of rules) {
    if (!r.match || r.builtin || !VALID_ROLES.has(r.role)) continue;
    const ov = tokenOverlapScore(keyNorm, r.match);
    if (ov >= 0.42 && ov > bestOv) {
      bestOv = ov;
      bestRoleOv = r.role;
    }
  }
  return bestRoleOv;
}

/**
 * Score bump for {@link pickBestKey}: strong positive when alias agrees, light penalty when alias disagrees.
 * @param {object|null|undefined} parsedData
 * @param {string} key column key
 * @param {string} role gross | refund | fee | tender | net | orderId
 */
export function headingAliasScoreAdjustment(parsedData, key, role) {
  const alias = resolveHeadingSemanticRole(parsedData, key);
  if (!alias) return 0;
  if (alias === role) return 24;
  return -6;
}

/** @typedef {'order'|'gross'|'fee'|'net'|'activity'|'bankSettlement'} EcommHeadingSemanticRole */

const ECOM_VALID_ROLES = new Set(['order', 'gross', 'fee', 'net', 'activity', 'bankSettlement']);

const BUILTIN_ECOMM_HEADING_RULES = [
  { match: 'order id', role: 'order', builtin: true, minSubstring: 6 },
  { match: 'order number', role: 'order', builtin: true, minSubstring: 6 },
  { match: 'transaction id', role: 'order', builtin: true, minSubstring: 6 },
  { match: 'checkout id', role: 'order', builtin: true, minSubstring: 6 },
  { match: 'gross sales', role: 'gross', builtin: true, minSubstring: 6 },
  { match: 'order total', role: 'gross', builtin: true, minSubstring: 6 },
  { match: 'charged amount', role: 'gross', builtin: true, minSubstring: 6 },
  { match: 'processing fee', role: 'fee', builtin: true, minSubstring: 6 },
  { match: 'transaction fee', role: 'fee', builtin: true, minSubstring: 6 },
  { match: 'platform fee', role: 'fee', builtin: true, minSubstring: 6 },
  { match: 'net amount', role: 'net', builtin: true, minSubstring: 6 },
  { match: 'payout amount', role: 'net', builtin: true, minSubstring: 6 },
  { match: 'order date', role: 'activity', builtin: true, minSubstring: 6 },
  { match: 'sale date', role: 'activity', builtin: true, minSubstring: 6 },
  { match: 'settlement date', role: 'bankSettlement', builtin: true, minSubstring: 6 },
  { match: 'bank credit date', role: 'bankSettlement', builtin: true, minSubstring: 6 },
];

const POS_ROLE_TO_ECOMM = /** @type {Record<HeadingSemanticRole, EcommHeadingSemanticRole | null>} */ ({
  gross: 'gross',
  fee: 'fee',
  net: 'net',
  orderId: 'order',
  refund: null,
  tender: null,
});

/** @param {unknown} raw */
function pushEcommAliasChunk(out, raw) {
  if (Array.isArray(raw)) {
    for (const e of raw) {
      if (!e || typeof e !== 'object') continue;
      const m = normalizeStatementHeader(e.match ?? e.pattern ?? e.header ?? e.from ?? e.source ?? '');
      let role = String(e.role ?? e.semantic ?? e.to ?? '').trim().toLowerCase();
      if (role === 'orderid' || role === 'order_id' || role === 'txn' || role === 'transaction') role = 'order';
      if (!m || !ECOM_VALID_ROLES.has(role)) continue;
      out.push({
        match: m,
        role: /** @type {EcommHeadingSemanticRole} */ (role),
        builtin: false,
        minSubstring: Number.isFinite(Number(e.minSubstring)) ? Math.max(2, Number(e.minSubstring)) : 4,
      });
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      const m = normalizeStatementHeader(k);
      let role = String(v ?? '').trim().toLowerCase();
      if (role === 'orderid' || role === 'order_id' || role === 'txn' || role === 'transaction') role = 'order';
      if (!m || !ECOM_VALID_ROLES.has(role)) continue;
      out.push({ match: m, role: /** @type {EcommHeadingSemanticRole} */ (role), builtin: false, minSubstring: 4 });
    }
  }
}

/**
 * E‑commerce workbook column hints (same template keys as POS where roles align).
 * @param {object|null|undefined} parsedData
 */
export function mergeEcommHeadingRoleRules(parsedData) {
  const out = BUILTIN_ECOMM_HEADING_RULES.map((r) => ({ ...r }));
  if (!parsedData || typeof parsedData !== 'object') return out;

  for (const r of mergeHeadingRoleRules(parsedData)) {
    const mapped = POS_ROLE_TO_ECOMM[r.role];
    if (!mapped || !r.match) continue;
    out.push({
      match: r.match,
      role: mapped,
      builtin: false,
      minSubstring: r.minSubstring ?? (r.builtin ? 6 : 4),
    });
  }

  pushEcommAliasChunk(out, parsedData.ecomm_heading_role_aliases);
  const profile = parsedData.statement_format_profile;
  if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
    pushEcommAliasChunk(out, profile.ecomm_heading_role_aliases);
  }
  const tmpl = parsedData.statement_template;
  if (tmpl && typeof tmpl === 'object' && !Array.isArray(tmpl)) {
    pushEcommAliasChunk(out, tmpl.ecomm_heading_role_aliases);
  }
  const bundles = parsedData.ecomm_heading_role_alias_bundles;
  if (Array.isArray(bundles)) {
    for (const b of bundles) pushEcommAliasChunk(out, b);
  }
  const tid = parsedData.statement_format_id ?? parsedData.format_template_id ?? parsedData.acquirer_format_id;
  const byId = parsedData.ecomm_heading_role_aliases_by_template_id;
  if (tid != null && byId && typeof byId === 'object' && !Array.isArray(byId)) {
    const chunk = byId[String(tid)] ?? byId[Number(tid)];
    pushEcommAliasChunk(out, chunk);
  }

  return out;
}

/**
 * @param {object|null|undefined} parsedData
 * @param {string} headerNorm cell text already passed through {@link normHeaderCell}
 * @returns {EcommHeadingSemanticRole | null}
 */
export function resolveEcommHeadingSemanticRole(parsedData, headerNorm) {
  const keyNorm = headerNorm ? normalizeStatementHeader(headerNorm) : '';
  if (!keyNorm) return null;
  const rules = mergeEcommHeadingRoleRules(parsedData);
  let best = null;
  let bestWeight = -1;

  for (const r of rules) {
    if (!r.match || !ECOM_VALID_ROLES.has(r.role)) continue;
    const minSub = r.minSubstring ?? (r.builtin ? 6 : 4);
    if (keyNorm === r.match) {
      const w = 1000 + r.match.length;
      if (w >= bestWeight) {
        best = r.role;
        bestWeight = w;
      }
      continue;
    }
    if (r.match.length >= minSub && keyNorm.includes(r.match)) {
      const w = 100 + r.match.length;
      if (w > bestWeight) {
        best = r.role;
        bestWeight = w;
      }
    }
  }
  if (best != null) return best;

  let bestOv = -1;
  let bestRoleOv = null;
  for (const r of rules) {
    if (!r.match || r.builtin || !ECOM_VALID_ROLES.has(r.role)) continue;
    const ov = tokenOverlapScore(keyNorm, r.match);
    if (ov >= 0.42 && ov > bestOv) {
      bestOv = ov;
      bestRoleOv = r.role;
    }
  }
  return bestRoleOv;
}

/**
 * Score bump for e‑commerce workbook {@link classifyEcommOrderColumns} pickers.
 * @param {object|null|undefined} parsedData
 * @param {string} headerNorm from {@link normHeaderCell}
 * @param {EcommHeadingSemanticRole} role
 */
export function ecommHeadingAliasScoreBonus(parsedData, headerNorm, role) {
  const alias = resolveEcommHeadingSemanticRole(parsedData, headerNorm);
  if (!alias) return 0;
  if (alias === role) return 28;
  return -6;
}
