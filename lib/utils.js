import { cardMixRowVolume, formatMoney, getStatementDisplayCurrency } from './currencyConversion.js';
import { roundMoney2 } from './financialAnalysisFormulas.js';
import { getPendingSettlementNarrativeFacts } from './posBatchSettlementLag.js';
import { pickEcommerceOrderArrays } from './posBatchCommissionAnalysis.js';
import { getStatementHeuristics } from './statementHeuristics.js';

export function tierOk(current, needed) {
  const rank = { Free: 0, L1: 1, L2: 2 };
  return (rank[current] ?? 0) >= (rank[needed] ?? 0);
}

export function fmt(n, decimals = 0) {
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

export function fmtCurrency(n) {
  return '$' + fmt(n);
}

export function fmtPct(n, dec = 2) {
  return n.toFixed(dec) + '%';
}

/** Display label for a parser/schema field key (snake_case → Title Case). Parser may override via `parsedData.field_labels[key]`. */
export function humanizeFieldKey(key) {
  const s = String(key ?? '')
    .trim()
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!s) return '';
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function _parserFieldLabel(parsedData, fieldKey) {
  const map = parsedData?.field_labels && typeof parsedData.field_labels === 'object' ? parsedData.field_labels : null;
  const v = map?.[fieldKey];
  if (typeof v === 'string' && v.trim()) return v.trim();
  return humanizeFieldKey(fieldKey);
}

/** Display label for a fee scalar slug (`fee_totals_by_slug` key or canonical `interchange_fees`, …). */
function _feeScalarLabel(parsedData, slug) {
  if (!slug) return '';
  const fl = parsedData?.field_labels?.[slug];
  if (typeof fl === 'string' && fl.trim()) return fl.trim();
  const fsl = parsedData?.fee_slug_labels?.[slug];
  if (typeof fsl === 'string' && fsl.trim()) return fsl.trim();
  const ui = parsedData?.report_ui?.fee_slug_labels;
  if (ui && typeof ui === 'object' && !Array.isArray(ui)) {
    const v = ui[slug];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return humanizeFieldKey(slug);
}

export function confidenceColor(level) {
  return { high: 'text-leaf', medium: 'text-amber', low: 'text-rose' }[level] ?? 'text-ink-400';
}

export function confidenceDot(level) {
  return { high: 'bg-leaf', medium: 'bg-amber', low: 'bg-rose' }[level] ?? 'bg-ink/20';
}

export function generateId() {
  return 'stmt-' + Math.random().toString(36).slice(2, 9);
}

/**
 * Slug from parser text or object keys (lowercase, [a-z0-9-] only).
 * Empty / unusable input returns '' (caller should use `unknown-card-{n}`).
 */
export function slugifyCardOrKey(raw) {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s;
}

/**
 * Stable **snake_case** slug for fee scalar keys (`fee_totals_by_slug` / custom parser fields).
 * Use for storage and map keys; labels come from {@link humanizeFieldKey} or `fee_slug_labels` / `field_labels`.
 */
export function slugifyFeeScalarKey(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

/**
 * Stable id for card_brand_mix rows or card_mix keys: prefer `slug` / `card_slug` / `id`,
 * else slugify(label | brand | network | scheme | card_product | code), else object key, else unknown-card-{index}.
 */
export function cardMixRowDisplayId(row, index = 0, objectKey = null) {
  if (row && typeof row === 'object') {
    const explicit = row.slug ?? row.card_slug ?? row.id;
    if (explicit != null && String(explicit).trim() !== '') {
      const u = slugifyCardOrKey(explicit);
      if (u) return u;
    }
    const from =
      row.label ?? row.brand ?? row.network ?? row.scheme ?? row.card_product ?? row.code;
    const u = slugifyCardOrKey(from);
    if (u) return u;
  }
  const k = slugifyCardOrKey(objectKey);
  if (k) return k;
  return `unknown-card-${index}`;
}

/**
 * Human-readable card / tender label for charts (prefer statement `label` / brand, not internal slug).
 */
export function cardBrandMixRowHumanLabel(row, index = 0, objectKey = null) {
  if (row && typeof row === 'object') {
    const lab = String(row.label ?? row.brand ?? row.network ?? row.scheme ?? row.card_product ?? '').trim();
    if (lab) return lab;
  }
  if (objectKey != null && String(objectKey).trim() !== '') {
    return String(objectKey)
      .trim()
      .replace(/_/g, ' ');
  }
  return cardMixRowDisplayId(row, index, objectKey);
}

/** Card / wallet / tender tokens in free-text labels (Excel + many PDFs). */
const PAYMENT_OR_CARD_BRAND_LIKE =
  /\b(visa|mastercard|master\s*card|\bmc\b|amex|american\s*express|discover|diners|jcb|union\s*pay|unionpay|maestro|interac|eftpos|rupay|mir|elo|hiper|carte\s*bleue|\bcb\b|tarjeta|cart[aã]o|deb[ií]t|cr[eé]dit|prepaid|contactless|tap\s*to\s*pay|apple\s*pay|google\s*pay|samsung\s*pay|paypal|venmo|zelle|ach|bank\s*transfer|wire|cash|check|cheque|gift\s*card|store\s*credit|card\s*present|cnp|card\s*not\s*present)\b/i;

/** Strong hint the row is a product / menu line, not a tender bucket (used only when no payment-like rows matched). */
const MENU_OR_PRODUCT_LINE_HEURISTIC =
  /\b(cake|croissant|muffin|latte|espresso|cappuccino|coffee|brew|soup|quiche|sandwich|salad|cookie|bread|loaf|roll|slice|pax|catering|pastry|biscuit|bagel|donut|doughnut|tea|smoothie|juice|scone|waffle|pizza|taco|burrito|burger|fries|cold\s*brew|drip|item|sku|qty|quantity|unit\s*price|subtotal|grand\s*total)\b/i;

const KNOWN_BRAND_SLUGS = new Set([
  'visa',
  'mastercard',
  'mc',
  'amex',
  'american-express',
  'discover',
  'diners',
  'jcb',
  'maestro',
  'interac',
  'unionpay',
  'rupay',
  'elo',
  'mir',
  'hiper',
  'debitcard',
  'creditcard',
  'cash',
  'check',
  'cheque',
  'pindebit',
  'signaturedebit',
]);

function structuredPaymentFieldsPresent(row) {
  if (!row || typeof row !== 'object') return false;
  for (const k of [
    'network',
    'scheme',
    'card_type',
    'tender_type',
    'payment_method',
    'payment_brand',
    'card_brand',
    'instrument',
    'funding',
    'wallet',
  ]) {
    const v = row[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s.length >= 1 && s.length <= 72) return true;
  }
  for (const k of ['last4', 'last_four', 'masked_pan', 'pan_last4', 'card_last_four', 'last_4']) {
    if (row[k] != null && String(row[k]).trim() !== '') return true;
  }
  return false;
}

function allCapsShortCodeMaybeBrand(label) {
  const s = String(label ?? '').trim();
  if (s.length < 2 || s.length > 14) return false;
  if (!/^[A-Z0-9]+$/.test(s)) return false;
  if (MENU_OR_PRODUCT_LINE_HEURISTIC.test(s)) return false;
  return true;
}

function slugLooksKnownBrand(u) {
  if (!u) return false;
  const compact = String(u).replace(/-/g, '');
  if (KNOWN_BRAND_SLUGS.has(u) || KNOWN_BRAND_SLUGS.has(compact)) return true;
  return false;
}

function cardBrandMixRowLooksPaymentLike(row) {
  if (!row || typeof row !== 'object') return false;
  if (structuredPaymentFieldsPresent(row)) return true;
  if (allCapsShortCodeMaybeBrand(row.label) || allCapsShortCodeMaybeBrand(row.brand)) return true;

  const bits = [
    row.slug,
    row.card_slug,
    row.id,
    row.code,
    row.card_product,
    row.label,
    row.brand,
    row.network,
    row.scheme,
    row.card_type,
    row.type,
  ];
  const labelSlug = slugifyCardOrKey(row.label ?? row.brand ?? '');
  if (slugLooksKnownBrand(labelSlug)) return true;

  const hay = bits
    .filter((x) => x != null && String(x).trim() !== '')
    .map((x) => String(x).toLowerCase())
    .join(' ');
  if (hay.trim() && PAYMENT_OR_CARD_BRAND_LIKE.test(hay)) return true;
  for (const x of bits) {
    const u = slugifyCardOrKey(x);
    if (u && PAYMENT_OR_CARD_BRAND_LIKE.test(u.replace(/-/g, ' '))) return true;
    if (slugLooksKnownBrand(u)) return true;
  }
  return false;
}

function menuRowLooksLikeProductLine(row) {
  const s = String(row.label ?? row.brand ?? row.type ?? '').trim();
  if (!s) return false;
  if (MENU_OR_PRODUCT_LINE_HEURISTIC.test(s)) return true;
  if (s.length > 44) return true;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length >= 5) return true;
  return false;
}

/**
 * Parser sometimes fills `card_brand_mix` from an **Item / product** column (bakery line items) instead of tender.
 * When we can tell (regex + structured fields + menu heuristics), drop junk or the whole block. When labels are
 * opaque (common on PDFs) but not menu-like, keep the rows.
 */
function sanitizeCardBrandMixRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const solid = rows.filter((r) => r && typeof r === 'object');
  if (!solid.length) return null;

  const paymentLike = solid.filter(cardBrandMixRowLooksPaymentLike);
  if (paymentLike.length === 0) {
    if (solid.length === 1 && menuRowLooksLikeProductLine(solid[0])) return null;
    const menuHits = solid.filter(menuRowLooksLikeProductLine).length;
    if (solid.length >= 2 && menuHits >= Math.max(2, Math.ceil(solid.length * 0.35))) return null;
    return rows;
  }
  if (paymentLike.length === solid.length) return rows;
  const minPay = Math.max(1, Math.ceil(solid.length * 0.25));
  if (paymentLike.length < minPay) return null;
  return paymentLike;
}

/** Fee line table: use `card_type` from the statement when set; else slug from type/description; else unknown slug. */
export function feeLineCardDisplayId(row, index = 0) {
  const ct = row?.card_type;
  if (ct != null && String(ct).trim() !== '') return String(ct).trim();
  const u = slugifyCardOrKey(row?.type ?? row?.description ?? row?.name);
  if (u) return u;
  return `unknown-card-${index}`;
}

/**
 * Numeric fee for one `fee_lines[]` row: parsers vary (`amount`, `fee`, `charge`, …).
 * @returns {number} Absolute magnitude, or NaN if nothing parses.
 */
export function feeLineRowAmount(row) {
  if (!row || typeof row !== 'object') return NaN;
  const keys = [
    'amount',
    'fee',
    'fees',
    'charge',
    'charges',
    'total',
    'fee_amount',
    'fee_total',
    'total_fee',
    'processing_fee',
    'net_fee',
    'value',
    'cost',
    'debit',
  ];
  for (const k of keys) {
    const v = row[k];
    if (v == null || v === '') continue;
    const n =
      typeof v === 'string' ? Number(String(v).replace(/,/g, '').trim()) : Number(v);
    if (Number.isFinite(n)) return Math.abs(n);
  }
  return NaN;
}

/** Parser / model buckets like "Interchange (est.)" — not copied from a statement line item. */
export function isParserEstimateFeeTypeLabel(s) {
  const t = String(s ?? '').trim();
  if (!t) return true;
  if (/\(est\.?\)/i.test(t)) return true;
  if (/\bestimated\b/i.test(t) && /\b(fee|fees|cost|split)\b/i.test(t)) return true;
  return false;
}

/**
 * Industry split labels often invented by models when the workbook (e.g. Square) only shows blended pricing.
 */
export function isGenericIndustryFeeBucketType(s) {
  const t = String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!t) return false;
  return t === 'interchange' || t === 'scheme / assessment' || t === 'processor / acquirer';
}

/**
 * `fee_lines` row whose `type` is only the generic bucket label (Interchange / Scheme / Processor),
 * not wording copied from a statement line. Overview donut skips these so we do not scale placeholders
 * to match total fees or imply a detailed split the file did not provide.
 */
export function isGenericIndustryFeeBucketFeeLine(row) {
  if (!row || typeof row !== 'object') return false;
  const typ = String(row.type ?? '').trim();
  return typ !== '' && isGenericIndustryFeeBucketType(typ);
}

/** True when `type` looks like a model estimate or generic interchange/scheme/processor bucket. */
export function isSyntheticFeeLineType(s) {
  return isParserEstimateFeeTypeLabel(s) || isGenericIndustryFeeBucketType(s);
}

export function isSyntheticInterchangeSchemeProcessorFeeLine(row) {
  if (!row || typeof row !== 'object') return false;
  const typ = String(row.type ?? '').trim();
  if (!typ) return false;
  return isSyntheticFeeLineType(typ);
}

/**
 * True when the statement JSON carries interchange/scheme dollars, itemized fee lines, **`fee_totals_by_slug`** amounts,
 * or similar — not merely generic model buckets. Used so UI copy can reference a real fee breakdown when present.
 * @param {object|null|undefined} parsedData
 */
export function statementBreaksOutInterchangeOrSchemeFees(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return false;
  const ic = Number(parsedData.interchange_fees);
  const sc = Number(parsedData.scheme_fees);
  if (Number.isFinite(ic) && Math.abs(ic) > 0.005) return true;
  if (Number.isFinite(sc) && Math.abs(sc) > 0.005) return true;
  const lines = Array.isArray(parsedData.fee_lines) ? parsedData.fee_lines : [];
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i];
    if (!row || typeof row !== 'object') continue;
    if (isSyntheticInterchangeSchemeProcessorFeeLine(row)) continue;
    const hay = `${String(row.type ?? '')} ${String(row.label ?? '')}`.toLowerCase();
    if (/\binterchange\b/.test(hay)) return true;
    if (/\bscheme\b/.test(hay) && /\b(fee|fees|assessment|charge)\b/.test(hay)) return true;
  }
  const bySlug = parsedData.fee_totals_by_slug;
  if (bySlug && typeof bySlug === 'object' && !Array.isArray(bySlug)) {
    for (const v of Object.values(bySlug)) {
      const n = Number(v);
      if (Number.isFinite(n) && Math.abs(n) > 0.005) return true;
    }
  }
  return false;
}

/** Order matters: prefer verbatim statement / processor line fields before broad narrative fields (often model-filled). */
const FEE_LINE_STATEMENT_STRING_KEYS = [
  'statement_line',
  'statement_label',
  'source_line',
  'ledger_line',
  'line_text',
  'line_description',
  'row_description',
  'merchant_descriptor',
  'fee_description',
  'fee_name',
  'charge_name',
  'charge_description',
  'fee_category',
  'charge_type',
  'fee_type',
  'service',
  'product',
  'item',
  'activity',
  'transaction_description',
  'raw_line',
  'text',
  'category',
  'subcategory',
  'name',
  'label',
  'title',
  'description',
  'detail',
  'memo',
  'notes',
];

function _feeLineFirstNonEmptyField(row, keys) {
  if (!row || typeof row !== 'object') return '';
  for (const key of keys) {
    const v = row[key];
    if (v == null) continue;
    const t = typeof v === 'string' ? v.trim() : String(v).trim();
    if (t) return t;
  }
  return '';
}

/**
 * Card / tender label for a fee line: match `card_type` to `card_brand_mix` rows, else legacy `card_mix` key.
 */
export function feeLineResolvedCardLabel(row, index, parsedData) {
  if (!row || typeof row !== 'object') return '';
  const rawCt = row.card_type;
  if (rawCt == null) return '';
  const ct = String(rawCt).trim();
  if (!ct || ct === '—' || ct === '-' || /^all$/i.test(ct)) return '';

  const slugMap = parsedData?.channel_card_display_slug_map;
  if (slugMap && typeof slugMap === 'object' && !Array.isArray(slugMap)) {
    const needleSlug = slugifyCardOrKey(ct);
    if (needleSlug && slugMap[needleSlug] != null && String(slugMap[needleSlug]).trim() !== '') {
      return String(slugMap[needleSlug]).trim();
    }
  }

  const mix = getCardBrandMixFromParsed(parsedData);
  if (Array.isArray(mix) && mix.length) {
    const needle = slugifyCardOrKey(ct);
    for (let i = 0; i < mix.length; i++) {
      const r = mix[i];
      if (!r || typeof r !== 'object') continue;
      const idSlug = slugifyCardOrKey(cardMixRowDisplayId(r, i));
      const candidates = [r.card_slug, r.slug, r.id, r.code, idSlug];
      for (const c of candidates) {
        if (c == null || String(c).trim() === '') continue;
        if (slugifyCardOrKey(c) === needle) {
          const lab = String(r.label ?? r.brand ?? r.network ?? r.scheme ?? r.card_product ?? '').trim();
          if (lab) return lab;
        }
      }
      const fromDims = slugifyCardOrKey(r.label ?? r.brand ?? r.network ?? r.scheme);
      if (needle && fromDims === needle) {
        const lab = String(r.label ?? r.brand ?? r.network ?? r.scheme ?? '').trim();
        if (lab) return lab;
      }
    }
  }

  const legacy =
    parsedData?.card_mix && typeof parsedData.card_mix === 'object' && !Array.isArray(parsedData.card_mix)
      ? parsedData.card_mix
      : null;
  if (legacy && Object.prototype.hasOwnProperty.call(legacy, ct)) {
    const share = legacy[ct];
    const pct = Number(share);
    if (Number.isFinite(pct) && pct > 0) return `${ct} (${pct}% mix)`;
    return ct;
  }

  return ct;
}

/**
 * Overview / table label: prefer statement-sourced strings; avoid showing estimate-only bucket names when
 * `description` (or similar) exists; otherwise combine resolved card, channel, and rate.
 */
export function feeLineDisplayLabel(row, index, parsedData) {
  if (!row || typeof row !== 'object') return `fee_lines[${index}]`;

  const fromStatement = _feeLineFirstNonEmptyField(row, FEE_LINE_STATEMENT_STRING_KEYS);
  if (fromStatement) return fromStatement;

  const typ = String(row.type ?? '').trim();
  if (typ && !isSyntheticFeeLineType(typ)) return typ;

  const bits = [];
  const cardPart = feeLineResolvedCardLabel(row, index, parsedData);
  if (cardPart) bits.push(cardPart);
  const ch = String(row.channel ?? '').trim();
  if (ch && !/^all$/i.test(ch)) bits.push(ch);
  const rate = String(row.rate ?? '').trim();
  if (rate && rate !== '—' && rate !== '-') bits.push(rate);
  if (bits.length) return bits.join(' · ');

  if (typ) {
    const stripped = typ.replace(/\s*\(est\.?\)\s*$/i, '').trim();
    if (stripped) return stripped;
  }

  return `Fee line ${index + 1}`;
}

/**
 * Enhanced statement file type detection with better support for various formats.
 * @param {string} fileType
 * @param {string} fileName
 * @param {string} mimeType
 * @returns {string}
 */
export function normalizeStatementFileType(fileType, fileName, mimeType) {
  if (!fileType && fileName) {
    const name = String(fileName).toLowerCase();
    if (name.endsWith('.csv')) return 'csv';
    if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.xlsm')) return 'excel';
    if (name.endsWith('.pdf')) return 'pdf';
    if (name.match(/\.(jpg|jpeg|png|gif|bmp|tiff|webp)$/)) return 'image';
    if (name.endsWith('.txt')) return 'text';
    if (name.endsWith('.json')) return 'json';
  }
  
  const normalized = String(fileType || '').toLowerCase().trim();
  const enhancedMapping = {
    'csv': 'csv',
    'excel': 'excel', 
    'xlsx': 'excel',
    'xls': 'excel',
    'pdf': 'pdf',
    'image': 'image',
    'jpg': 'image',
    'jpeg': 'image', 
    'png': 'image',
    'gif': 'image',
    'text': 'text',
    'json': 'json',
    'statement': 'statement',
    'bank_statement': 'bank_statement',
    'merchant_statement': 'merchant_statement'
  };
  
  return enhancedMapping[normalized] || normalized || 'unknown';
}

/**
 * First gate: is this upload a file type we treat as a possible statement (PDF / tabular / image), or unknown?
 * Content classification (really a statement vs not) comes from the parser (`not_statement`, etc.).
 * @param {string} fileName
 * @param {string} [mimeType]
 * @returns {'statement' | 'unknown'}
 */
export function getStatementUploadKindFromFile(fileName, mimeType = '') {
  const name = String(fileName || '');
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
  const byExt = new Set([
    'pdf',
    'csv',
    'xlsx',
    'xls',
    'xlsm',
    'jpg',
    'jpeg',
    'png',
    'gif',
    'webp',
    'bmp',
    'tif',
    'tiff',
  ]);
  if (ext && byExt.has(ext)) return 'statement';
  if (ext) return 'unknown';

  const m = String(mimeType || '').toLowerCase();
  if (
    m.includes('pdf') ||
    m.includes('spreadsheet') ||
    m.includes('excel') ||
    m.includes('csv') ||
    m.startsWith('image/')
  ) {
    return 'statement';
  }
  return 'unknown';
}

/** Readable label from upload file name when the statement has no extracted merchant name. */
export function humanizeFileStem(fileName) {
  if (!fileName || typeof fileName !== 'string') return '';
  return fileName
    .replace(/\.(pdf|csv|xlsx|xlsm|xls|txt|tsv)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Display title for analyses: parsed business name from the file when present,
 * otherwise the humanized file name — no hardcoded placeholder names.
 */
export function statementDisplayTitle(acquirerNameFromParse, uploadFileName) {
  const parsed = acquirerNameFromParse && String(acquirerNameFromParse).trim();
  if (parsed) return parsed;
  return humanizeFileStem(uploadFileName) || 'Statement';
}

/** Strip pandas/Excel stringified NaN and collapse whitespace (parser blob noise). */
function stripExcelNaNNoise(s) {
  if (s == null || typeof s !== 'string') return '';
  return s
    .replace(/\bnan\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove leading "March 2024" / month-year junk from merged Excel title cells. */
function stripLeadingMonthYearNoise(s) {
  let t = stripExcelNaNNoise(s);
  if (!t) return '';
  const month =
    '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
  let prev;
  do {
    prev = t;
    t = t
      .replace(new RegExp(`^${month}\\s+\\d{4}\\s+`, 'i'), '')
      .replace(new RegExp(`^${month}\\s+`, 'i'), '')
      .replace(/^20\d{2}\s+/, '')
      .trim();
  } while (t !== prev);
  return t;
}

/**
 * When both API `acquirer_name` and preview `merchant_name` exist, prefer the richer legal name
 * (fixes short/wrong top-level values hiding the full name in `raw_extracted_preview`).
 */
function chooseBestBusinessName(primary, secondary) {
  const a = stripExcelNaNNoise(primary != null && String(primary).trim() !== '' ? String(primary) : '');
  const b = stripExcelNaNNoise(secondary != null && String(secondary).trim() !== '' ? String(secondary) : '');
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al.includes(bl) || bl.includes(al)) return a.length >= b.length ? a : b;
  const score = (s) =>
    s.length + (/\b(LLC|Inc\.?|Ltd\.?|Limited|Corp\.?|LLP|Pty)\b/i.test(s) ? 80 : 0);
  return score(b) > score(a) ? b : a;
}

/**
 * Identity fields from the parser payload, with fallbacks to `raw_extracted_preview`
 * (older sessions / PDFs may only have merchant_name & account in the preview blob).
 */
export function getParsedIdentity(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') {
    return { acquirer_name: null, bank_name: null, account_number: null, merchant_id: null };
  }
  const prev =
    parsedData.raw_extracted_preview && typeof parsedData.raw_extracted_preview === 'object'
      ? parsedData.raw_extracted_preview
      : {};
  const pick = (top, ...previewKeys) => {
    if (top != null && String(top).trim() !== '') return String(top).trim();
    for (const k of previewKeys) {
      const v = prev[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  };
  const merged = chooseBestBusinessName(parsedData.acquirer_name, prev.merchant_name);
  const cleaned = merged ? stripLeadingMonthYearNoise(merged) : null;
  let mid = pick(parsedData.merchant_id, 'merchant_id');
  const badMid = /^(bank_ref|txn_id|batch_id|funding_id|merchant_id|channel|ach_code|ref|description)$/i;
  if (mid && badMid.test(String(mid).trim())) mid = null;
  return {
    acquirer_name: cleaned || null,
    bank_name: pick(parsedData.bank_name, 'bank_name'),
    account_number: pick(parsedData.account_number, 'account_number'),
    merchant_id: mid,
  };
}

/** Prefer full legal name from parse (or preview), else list title / filename. */
export function displayBusinessName(parsedData, fallbackAcquirer) {
  const { acquirer_name: an } = getParsedIdentity(parsedData);
  if (an) return an;
  const raw = fallbackAcquirer && String(fallbackAcquirer).trim();
  const f = raw ? stripLeadingMonthYearNoise(raw) : '';
  return f || 'Statement';
}

/** One line for UI tables/headers: bank · Acct ****1234 · MID … when parsed. */
export function accountAndMidLine(parsedData) {
  const id = getParsedIdentity(parsedData);
  const bits = [];
  if (id.bank_name) bits.push(id.bank_name);
  if (id.account_number) bits.push(`Acct ${id.account_number}`);
  if (id.merchant_id) bits.push(`MID ${id.merchant_id}`);
  return bits.length ? bits.join(' · ') : '';
}

/**
 * Enhanced channel volume calculation with proper field prioritization and validation.
 * Fixed to correctly extract gross amounts from various statement formats.
 */
export function channelSalesVolume(ch) {
  if (!ch || typeof ch !== 'object') return 0;
  
  // Strict field prioritization to ensure correct gross amount extraction
  const fieldPriority = [
    'statement_gross_volume', // Full statement POS/CNP gross when parser stamps it (e.g. Square card+cash vs card-only row)
    'gross_sales', // Most accurate for gross sales
    'gross_volume', // Alternative gross field
    'sales',           // Generic sales field
    'total_sales',     // Total sales amount
    'revenue',         // Revenue field
    'volume',          // Fallback volume field
    'total_volume',    // Alternative total volume
    'net_settled_volume', // Net settled as last resort
    'net_sales',       // Net sales fallback
    'net_volume'       // Net volume fallback
  ];
  
  for (const field of fieldPriority) {
    const value = ch[field];
    if (value != null && value !== '' && !isNaN(value)) {
      const num = Number(value);
      if (Number.isFinite(num) && num >= 0) {
        return Math.round(num * 100) / 100;
      }
    }
  }
  
  return 0;
}

/**
 * Channel tab “Cash sales” label: prefer Month Summary / Daily cash column when present, else `channel_split` row.
 */
export function getCashChannelSalesDisplayAmount(parsedData, cashRow) {
  if (parsedData && typeof parsedData === 'object') {
    const ms = parsedData.pos_workbook_month_summary;
    const tc = Number(ms?.total_cash_sales);
    if (Number.isFinite(tc) && tc > 0.005) return Math.round(tc * 100) / 100;
    const daily = Number(parsedData.square_pos_daily_cash_sales_sum);
    if (Number.isFinite(daily) && daily > 0.005) return Math.round(daily * 100) / 100;
  }
  if (cashRow && typeof cashRow === 'object') {
    const v = channelSalesVolume(cashRow);
    if (Number.isFinite(v) && v > 0.005) return Math.round(v * 100) / 100;
  }
  return null;
}

function _absNumUi(x) {
  const v = Math.abs(Number(x));
  return Number.isFinite(v) ? v : 0;
}

/** File-level refund hints (POS file often omits per-row `refund_volume`) — mirrors linked-merge inference. */
export function inferPosRefundVolumeForUi(parsedData, posRow) {
  let rf = _absNumUi(posRow?.refund_volume ?? posRow?.refunds);
  if (rf > 0.005) return Math.round(rf * 100) / 100;
  if (!parsedData || typeof parsedData !== 'object') return 0;
  const candidates = [
    parsedData.refund_volume,
    parsedData.total_refunds,
    parsedData.refund_total,
    parsedData.refunds_total,
    parsedData.pos_refund_volume,
    parsedData.pos_refunds,
    parsedData.total_return_volume,
    parsedData.raw_extracted?.refund_volume,
    parsedData.raw_extracted_preview?.refund_volume,
    parsedData.extracted?.refund_volume,
  ];
  let fileTot = 0;
  for (const x of candidates) {
    const v = _absNumUi(x);
    if (v > fileTot) fileTot = v;
  }
  fileTot = Math.round(fileTot * 100) / 100;
  if (!(fileTot > 0.005)) return 0;
  const cs = parsedData.channel_split;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) return fileTot;
  const posG = channelSalesVolume(posRow);
  let cnpG = 0;
  for (const key of ['cnp', 'ecommerce', 'ecomm', 'online', 'web', 'digital']) {
    const r = cs[key];
    if (r && typeof r === 'object') {
      cnpG = channelSalesVolume(r);
      break;
    }
  }
  if (!(cnpG > 500)) return fileTot;
  const denom = posG + cnpG;
  if (!(denom > 0.005)) return fileTot;
  const share = posG / denom;
  return Math.round(fileTot * share * 100) / 100;
}

/**
 * Enhanced gross volume calculation with proper field validation and amount reconstruction.
 * Fixed to correctly calculate POS and e-commerce gross amounts.
 */
export function channelGrossSalesVolumeForAggregation(ch, parsedData, splitBucket = null) {
  if (!ch || typeof ch !== 'object') return channelSalesVolume(ch);
  
  // For golden workbook, prefer stamped full gross, then explicit row fields (same as non-golden channel roll-ups).
  if (parsedData?.golden_reconciliation_workbook) {
    const sgv = Number(ch.statement_gross_volume);
    if (Number.isFinite(sgv) && sgv > 0.005) {
      return Math.round(sgv * 100) / 100;
    }
    const gv = Number(ch.gross_sales ?? ch.gross_volume ?? ch.sales);
    if (Number.isFinite(gv) && gv > 0.005) {
      return Math.round(gv * 100) / 100;
    }
    return channelRollupVolume(ch, parsedData);
  }
  
  // Enhanced gross field detection with validation.
  // `statement_gross_volume` is stamped when the parser (or linked merge) keeps full statement POS/CNP gross while
  // `volume` may reflect card-only or another partial total — prefer it for Channel Split / revenue roll-ups.
  const grossFields = [
    { field: 'statement_gross_volume', weight: 12 },
    { field: 'gross_sales', weight: 10 },
    { field: 'gross_volume', weight: 9 },
    { field: 'total_sales', weight: 8 },
    { field: 'revenue', weight: 7 },
    { field: 'sales', weight: 6 },
    { field: 'amount', weight: 5 },
  ];
  
  let bestGrossValue = null;
  let bestWeight = 0;
  
  for (const { field, weight } of grossFields) {
    const value = ch[field];
    if (value != null && value !== '' && !isNaN(value)) {
      const num = Number(value);
      if (Number.isFinite(num) && num > 0.005 && weight > bestWeight) {
        bestGrossValue = num;
        bestWeight = weight;
      }
    }
  }
  
  if (bestGrossValue != null) {
    return Math.round(bestGrossValue * 100) / 100;
  }

  const vol = Number(ch.volume);
  const rf = Math.abs(Number(ch.refund_volume ?? ch.refunds) || 0);
  const fees = Math.abs(Number(ch.fees) || 0);

  if (Number.isFinite(vol) && vol > 0.005) {
    const netSales = Number(ch.net_sales ?? ch.total_net_sales ?? ch.net_volume);
    if (rf > 0.005 && Number.isFinite(netSales) && netSales > 0.005) {
      const impliedGross = netSales + rf;
      const volNearNet = Math.abs(vol - netSales) <= Math.max(1, 0.02 * Math.max(vol, netSales, 1));
      const volNearImpliedGross =
        Math.abs(vol - impliedGross) <= Math.max(1, 0.02 * Math.max(vol, impliedGross, 1));
      if (volNearNet && impliedGross > vol + 0.01) {
        return Math.round(impliedGross * 100) / 100;
      }
      if (volNearImpliedGross) {
        return Math.round(vol * 100) / 100;
      }
    }

    // When the row has no explicit gross_* fields, `volume` is often processor **gross** sales. Inferring
    // gross = volume + refunds from fee/refund ratios alone inflates totals on low-fee or missing-fee parses.
    // Keep the Shopify-style net+refunds path only when **fees are present** on the same row (signals net-like basis).
    const feeRatio = fees > 0 && vol > 0 ? fees / vol : 0;
    const refundRatio = rf > 0 && vol > 0 ? rf / vol : 0;
    if (feeRatio > 0.002 && feeRatio < 0.05 && refundRatio > 0.01) {
      const reconstructed = vol + rf;
      return Math.round(reconstructed * 100) / 100;
    }

    if (feeRatio >= 0.01 && feeRatio <= 0.15) {
      return Math.round(vol * 100) / 100;
    }

    return Math.round(vol * 100) / 100;
  }

  // Fallback to e-commerce orders for ecom bucket
  if (splitBucket === 'ecom' && parsedData) {
    const orderGross = sumEcommOrderGrossBestFromParsed(parsedData);
    if (orderGross > 0.005) {
      return Math.round(orderGross * 100) / 100;
    }
  }
  
  return channelSalesVolume(ch);
}

/**
 * Σ `channel_split` row gross volumes (same basis as {@link channelGrossSalesVolumeForAggregation} when present).
 * @returns {number | null} null when there is no object split or no positive row volumes
 */
export function sumChannelSplitGrossVolumes(parsedData) {
  const split = parsedData?.channel_split;
  if (!split || typeof split !== 'object' || Array.isArray(split)) return null;
  let s = 0;
  let any = false;
  const useRollupVol = linkedOrGoldenRollup(parsedData);
  for (const key of Object.keys(split)) {
    const row = split[key];
    if (!row || typeof row !== 'object') continue;
    const b = _channelSplitPosEcomCashBucket(key, row);
    const v = useRollupVol
      ? channelRollupVolume(row, parsedData)
      : channelGrossSalesVolumeForAggregation(row, parsedData, b);
    if (v > 0) {
      s += v;
      any = true;
    }
  }
  return any ? Math.round(s * 100) / 100 : null;
}

/**
 * Σ each channel row's {@link channelSalesVolume} — headline roll-ups without inferring gross from
 * refunds/order grids (used for linked-bundle `total_transaction_volume` so headline matches processor exports).
 * @param {{ excludeCash?: boolean }} [opts] When `excludeCash`, omit in-hand cash tender rows (e.g. Square Month Summary
 * **Cash Sales**) so the sum matches **POS + e‑commerce processor gross** only.
 */
export function sumChannelSplitPlainVolumes(parsedData, opts) {
  const excludeCash = Boolean(opts && typeof opts === 'object' && opts.excludeCash);
  const split = parsedData?.channel_split;
  if (!split || typeof split !== 'object' || Array.isArray(split)) return null;
  let s = 0;
  let any = false;
  const rollup = linkedOrGoldenRollup(parsedData);
  for (const key of Object.keys(split)) {
    const row = split[key];
    if (!row || typeof row !== 'object') continue;
    if (excludeCash && _channelSplitPosEcomCashBucket(key, row) === 'cash') continue;
    const v = rollup ? channelRollupVolume(row, parsedData) : channelSalesVolume(row);
    if (v > 0) {
      s += v;
      any = true;
    }
  }
  return any ? Math.round(s * 100) / 100 : null;
}

/** Combined POS + e‑commerce + bank (+ optional reconciliation) uploads — scalar header may drift vs channel rows. */
export function linkedCombinedStatementHint(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return false;
  const b = parsedData.linked_statement_bundle;
  if (b && typeof b === 'object' && !Array.isArray(b)) return true;
  if (/^combined\b/i.test(String(parsedData.fileName ?? '').trim())) return true;
  const sh = parsedData.report_ui?.structure_headline;
  if (typeof sh === 'string') {
    const parts = sh
      .split(/\s*[·•]\s*/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (parts.length >= 4) return true;
  }
  return false;
}

/** Linked POS+e‑com+bank bundle, Combined reporting, or golden workbook — roll-ups should trust explicit gross columns. */
export function linkedOrGoldenRollup(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return false;
  if (parsedData.golden_reconciliation_workbook) return true;
  return linkedCombinedStatementHint(parsedData);
}

/**
 * Channel row volume for linked/golden roll-ups: prefer **statement_gross_volume** (POS stmt gross preserved when
 * linked merge shrinks `volume` for headline match), then **gross_volume** / **gross_sales**, then **volume**.
 */
export function channelRollupVolume(ch, parsedData) {
  if (!ch || typeof ch !== 'object') return 0;
  if (linkedOrGoldenRollup(parsedData)) {
    const sgv = Number(ch.statement_gross_volume);
    if (Number.isFinite(sgv) && sgv > 0.005) return Math.round(sgv * 100) / 100;
    const gv = Number(ch.gross_volume ?? ch.gross_sales);
    if (Number.isFinite(gv) && gv > 0.005) return Math.round(gv * 100) / 100;
    if (parsedData?.golden_reconciliation_workbook) return channelSalesVolume(ch);
    return channelGrossSalesVolumeForAggregation(ch, parsedData, null);
  }
  return channelSalesVolume(ch);
}

/**
 * Per-row gross for Channel Split cards and {@link _aggregatePosEcomCashBuckets}.
 * When {@link linkedOrGoldenRollup} is true (linked bundle, combined headline/filename, or golden workbook),
 * POS/CNP use {@link channelRollupVolume} — same basis as {@link sumChannelSplitPlainVolumes} and synced scalars.
 * **Cash** keeps the inference/scalar path so month-summary / daily cash hints still apply.
 * @param {'pos'|'ecom'|'cash'|null} [splitBucket]
 */
export function channelSplitRowGrossForAggregate(parsedData, row, splitBucket) {
  if (!row || typeof row !== 'object') return 0;
  if (linkedOrGoldenRollup(parsedData) && splitBucket !== 'cash')
    return channelRollupVolume(row, parsedData);
  let g = channelGrossSalesVolumeForAggregation(row, parsedData, splitBucket);
  if (
    splitBucket === 'cash' &&
    parsedData &&
    typeof parsedData === 'object' &&
    _channelSplitCashRowCount(parsedData) === 1
  ) {
    const scalar = _pickCashVolumeScalars(parsedData);
    if (
      scalar != null &&
      scalar > g + Math.max(12, 0.04 * Math.max(g, scalar)) &&
      g < scalar * 0.82 + 8
    ) {
      return scalar;
    }
  }
  return g;
}

/**
 * Cash bucket gross matching Channel tab / Report `TabChannel`: month-summary or daily cash hints,
 * then row {@link channelSalesVolume}, then {@link channelSplitRowGrossForAggregate}.
 * @param {{ allowFileLevelCashHint?: boolean }} [options] Set `allowFileLevelCashHint: false` when multiple cash rows exist — file-level month/daily totals must not repeat per row (avoids double counting in Σ cash).
 */
export function channelSplitCashRowDisplayVolume(parsedData, row, options = {}) {
  const allowFile = options.allowFileLevelCashHint !== false;
  if (!row || typeof row !== 'object') return 0;
  if (allowFile && parsedData && typeof parsedData === 'object') {
    const ms = parsedData.pos_workbook_month_summary;
    const tc = Number(ms?.total_cash_sales);
    if (Number.isFinite(tc) && tc > 0.005) return Math.round(tc * 100) / 100;
    const daily = Number(parsedData.square_pos_daily_cash_sales_sum);
    if (Number.isFinite(daily) && daily > 0.005) return Math.round(daily * 100) / 100;
  }
  const netLike = channelSalesVolume(row);
  if (Number.isFinite(netLike) && netLike > 0.005) return Math.round(netLike * 100) / 100;
  const g = channelSplitRowGrossForAggregate(parsedData, row, 'cash');
  return Number.isFinite(g) && g > 0.005 ? Math.round(g * 100) / 100 : 0;
}

/**
 * Gross volume for overview / blended rate: when the header `total_transaction_volume` under-counts
 * vs the sum of `channel_split` lines (common when a small cash row is omitted from the headline),
 * use the split sum so **fees ÷ gross** matches the channel table.
 */
export function reconcileOverviewGrossVolume(parsedData) {
  const declared = Number(parsedData?.total_transaction_volume);
  if (!Number.isFinite(declared) || !(declared > 0)) {
    if (parsedData?.golden_reconciliation_workbook) return Number.isFinite(declared) ? declared : 0;
    const splitOnly = sumChannelSplitGrossVolumes(parsedData);
    if (splitOnly != null && splitOnly > 0.005) return splitOnly;
    const plainOnly = sumChannelSplitPlainVolumes(parsedData, {});
    if (plainOnly != null && plainOnly > 0.005) return plainOnly;
    return Number.isFinite(declared) ? declared : 0;
  }
  // Cross-channel reconciliation workbook total — POS/e‑com detail rows can still sum higher (timing / overlap).
  if (parsedData?.golden_reconciliation_workbook) return declared;

  const plainOpts =
    linkedCombinedStatementHint(parsedData) && parsedData?.golden_reconciliation_workbook !== true
      ? { excludeCash: true }
      : {};
  const plain = sumChannelSplitPlainVolumes(parsedData, plainOpts);
  const tol = Math.max(0.5, 0.0005 * Math.max(declared, plain ?? 0));
  // Linked bundle: Channel tab / reconciliation rows are the roll-up of record; the scalar header often lags
  // (POS+Shopify merge vs workbook overlay, or stale stored payload). Prefer Σ channel_split volumes for KPI.
  if (
    linkedCombinedStatementHint(parsedData) &&
    plain != null &&
    plain > 0.005 &&
    Math.abs(declared - plain) > tol
  ) {
    return plain;
  }

  const agg = sumChannelSplitGrossVolumes(parsedData);
  if (
    linkedCombinedStatementHint(parsedData) &&
    plain != null &&
    agg != null &&
    agg > plain + 0.25 &&
    Math.abs(declared - plain) <= Math.max(0.5, 0.0005 * Math.abs(declared))
  ) {
    return declared;
  }

  const splitSum = sumChannelSplitGrossVolumes(parsedData);
  if (splitSum == null || !(splitSum > declared + 0.25)) return declared;
  const cashRow = parsedData?.channel_split?.cash;
  const cashV = cashRow && typeof cashRow === 'object' ? channelSalesVolume(cashRow) : 0;
  const viaCash = Math.abs(splitSum - declared - cashV) < 0.75;
  const smallGap = splitSum - declared <= Math.max(50, 0.02 * declared);
  if (viaCash || smallGap) return splitSum;
  return declared;
}

/**
 * Raw headline **transaction volume** reconciler: `reconcileOverviewGrossVolume`, linked **`pos_volume` + `ecomm_volume`**,
 * or `total_transaction_volume`. Does **not** apply {@link buildRevenueByChannelTable} / `statement_gross_volume` rules.
 * Prefer {@link overviewPrimarySalesVolumeGross} for any user-facing KPI so POS gross matches Channel / Discrepancy everywhere.
 */
export function displayStatementTotalTransactionVolume(parsedData) {
  const linked =
    linkedCombinedStatementHint(parsedData) && parsedData?.golden_reconciliation_workbook !== true;
  if (linked) {
    const pv = Number(parsedData?.pos_volume);
    const ev = Number(parsedData?.ecomm_volume);
    const sumSynced = (Number.isFinite(pv) ? pv : 0) + (Number.isFinite(ev) ? ev : 0);
    if (sumSynced > 0.005) return Math.round(sumSynced * 100) / 100;

    const noCash = sumChannelSplitPlainVolumes(parsedData, { excludeCash: true });
    const declared = Number(parsedData?.total_transaction_volume);
    if (noCash != null && noCash > 0.005) {
      if (Number.isFinite(declared) && declared > 0.005) {
        const tol = Math.max(0.5, 0.002 * Math.max(declared, noCash));
        if (Math.abs(declared - noCash) <= tol) return declared;
      }
      return noCash;
    }
  }
  const gv = reconcileOverviewGrossVolume(parsedData);
  if (Number.isFinite(gv) && gv > 0.005) return Math.round(gv * 100) / 100;
  const declared = Number(parsedData?.total_transaction_volume);
  return Number.isFinite(declared) && declared > 0.005 ? Math.round(declared * 100) / 100 : 0;
}

/**
 * **Canonical** headline **processor gross sales volume** for the whole app (POS + e‑commerce card sales, excluding cash):
 * uses {@link buildRevenueByChannelTable} → same roll-up as Channel Split / Discrepancy when that table exists.
 * Otherwise prefers **`pos_volume` + `ecomm_volume`**, then Σ `channel_split` (cash excluded), then {@link displayStatementTotalTransactionVolume}.
 *
 * Use this for dashboard, upload, analyses, report Overview, exports, and chat context — not ad-hoc volume fields.
 */
export function overviewPrimarySalesVolumeGross(parsedData) {
  const rev = buildRevenueByChannelTable(parsedData);
  const g = rev?.totals?.gross;
  if (g != null && Number.isFinite(Number(g)) && Number(g) > 0.005) {
    return Math.round(Number(g) * 100) / 100;
  }
  const pv = Number(parsedData?.pos_volume);
  const ev = Number(parsedData?.ecomm_volume);
  if (Number.isFinite(pv) && pv > 0.005 && Number.isFinite(ev) && ev > 0.005) {
    return Math.round((pv + ev) * 100) / 100;
  }
  if (Number.isFinite(pv) && pv > 0.005) return Math.round(pv * 100) / 100;
  if (Number.isFinite(ev) && ev > 0.005) return Math.round(ev * 100) / 100;
  const plain = sumChannelSplitPlainVolumes(parsedData, { excludeCash: true });
  if (plain != null && plain > 0.005) return Math.round(plain * 100) / 100;
  return displayStatementTotalTransactionVolume(parsedData);
}

const _OVERVIEW_BANK_NET_EPS = 0.005;

/**
 * POS + e‑commerce **net to bank** for Overview copy.
 * Linked bundles: prefer **Revenue by channel** Net Bank (same roll-up as the Channel Split tab), then merged
 * **pos_net_deposit_volume** + **ecomm_net_deposit_volume** when both exist, else strict pair / scalar fallbacks.
 * @returns {{ pos: number, ecom: number, sum: number } | null}
 */
export function linkedProcessorNetToBankPairForOverview(parsedData) {
  const linkedBundle =
    parsedData?.linked_statement_bundle &&
    typeof parsedData.linked_statement_bundle === 'object' &&
    !Array.isArray(parsedData.linked_statement_bundle);

  const pn = Number(parsedData?.pos_net_deposit_volume);
  const en = Number(parsedData?.ecomm_net_deposit_volume ?? parsedData?.ecommerce_net_deposit);
  const pnOk = Number.isFinite(pn) && pn > _OVERVIEW_BANK_NET_EPS;
  const enOk = Number.isFinite(en) && en > _OVERVIEW_BANK_NET_EPS;

  /** Sum Channel Split **Net Bank** rows first so Overview matches the Channel tab (avoids stale stamped scalars). */
  if (linkedBundle) {
    const rev = buildRevenueByChannelTable(parsedData);
    if (rev?.rows?.length) {
      let pos = 0;
      let ecom = 0;
      let sawPos = false;
      let sawEcom = false;
      for (const r of rev.rows) {
        if (r.key === 'pos') {
          sawPos = true;
          pos = Number(r.netBank) || 0;
        }
        if (r.key === 'ecom') {
          sawEcom = true;
          ecom = Number(r.netBank) || 0;
        }
      }
      const sum = Math.round((pos + ecom) * 100) / 100;
      if ((sawPos || sawEcom) && sum > _OVERVIEW_BANK_NET_EPS) {
        return {
          pos: Math.round(pos * 100) / 100,
          ecom: Math.round(ecom * 100) / 100,
          sum,
        };
      }
    }
  }

  /** Merged top-level nets when both exist (linked merge stamps from channel roll-up when the table is empty). */
  if (linkedBundle && pnOk && enOk) {
    const rp = Math.round(pn * 100) / 100;
    const re = Math.round(en * 100) / 100;
    return { pos: rp, ecom: re, sum: Math.round((rp + re) * 100) / 100 };
  }

  const pair = getChannelNetBankPairForReconciliation(parsedData);
  if (pair && pair.sum > _OVERVIEW_BANK_NET_EPS) return pair;

  if (pnOk && enOk) {
    const rp = Math.round(pn * 100) / 100;
    const re = Math.round(en * 100) / 100;
    return { pos: rp, ecom: re, sum: Math.round((rp + re) * 100) / 100 };
  }

  if (linkedBundle && pnOk) {
    const rp = Math.round(pn * 100) / 100;
    return { pos: rp, ecom: 0, sum: rp };
  }
  if (linkedBundle && enOk) {
    const re = Math.round(en * 100) / 100;
    return { pos: 0, ecom: re, sum: re };
  }

  return null;
}

function _overviewRefundTotalForNet(parsedData) {
  const parts = posEcomRefundPartsForDiscrepancyReport(parsedData);
  if (parts && parts.sum > 0.005) return Math.round(parts.sum * 100) / 100;
  const head = Number(parsedData?.refund_volume);
  if (Number.isFinite(head) && Math.abs(head) > 0.005) return Math.round(Math.abs(head) * 100) / 100;
  return 0;
}

/**
 * Inputs that drive Overview net revenue (channel Net Bank vs gross − refunds − fees vs bank credits).
 * Handy for tracing which path the UI took on linked bundles vs single statements.
 */
export function getChannelNetBreakdown(parsedData) {
  const linked =
    !!(
      parsedData?.linked_statement_bundle &&
      typeof parsedData.linked_statement_bundle === 'object' &&
      !Array.isArray(parsedData.linked_statement_bundle)
    );
  const gross = overviewPrimarySalesVolumeGross(parsedData);
  const { total: fees } = reconcileTotalFeesCharged(parsedData);
  const refunds = _overviewRefundTotalForNet(parsedData);
  const gsf =
    Number.isFinite(gross) &&
    gross > _OVERVIEW_BANK_NET_EPS &&
    fees != null &&
    Number.isFinite(fees) &&
    Number.isFinite(refunds)
      ? Math.round((gross - refunds - fees) * 100) / 100
      : null;
  const rev = buildRevenueByChannelTable(parsedData);
  const nbTot =
    rev?.totals != null &&
    rev.totals.netBank != null &&
    Number(rev.totals.netBank) > _OVERVIEW_BANK_NET_EPS
      ? Math.round(Number(rev.totals.netBank) * 100) / 100
      : null;
  const pair = linked ? linkedProcessorNetToBankPairForOverview(parsedData) : null;
  const bank = Number(parsedData?.bank_credits_total_verified);

  return {
    linked,
    revenueTableNetBankTotal: nbTot,
    linkedPairSum:
      pair && Number.isFinite(pair.sum) && pair.sum > _OVERVIEW_BANK_NET_EPS ? Math.round(pair.sum * 100) / 100 : null,
    grossMinusRefundsMinusFees: gsf,
    bankCreditsVerified:
      Number.isFinite(bank) && bank > _OVERVIEW_BANK_NET_EPS ? Math.round(bank * 100) / 100 : null,
  };
}

/**
 * Overview third KPI: linked **POS + e‑commerce + bank** bundles use **Net revenue** as **POS net to bank +
 * e‑commerce net to bank** when both processor figures exist ({@link linkedProcessorNetToBankPairForOverview});
 * otherwise **`bank_credits_total_verified`** when the bank file supplied a verified credit total.
 * Bank vs processor timing gaps stay on the Discrepancy tab, not this headline.
 * @param {number | null | undefined} impliedNetFromGrossMinusFees from sales volume − fees when parse has no net
 * @returns {{ amount: number | null, sub: string, subSecondary?: string | null, kpiLabel: string }}
 */
export function displayOverviewNetAfterFees(parsedData, impliedNetFromGrossMinusFees = null) {
  const eps = _OVERVIEW_BANK_NET_EPS;
  const linkedBundle =
    parsedData?.linked_statement_bundle &&
    typeof parsedData.linked_statement_bundle === 'object' &&
    !Array.isArray(parsedData.linked_statement_bundle);

  // PRIORITY 1 — Golden reconciliation workbook (authoritative when present).
  if (parsedData?.golden_reconciliation_workbook === true) {
    const inf = Number(parsedData?.net_revenue_inferred);
    const leg = Number(parsedData?.net_revenue);
    if (Number.isFinite(inf) && inf >= 0) {
      let subSecondary = null;
      if (Number.isFinite(leg) && Math.abs(leg - inf) > 0.02) {
        subSecondary = `net_revenue ${Math.round(leg * 100) / 100}`;
      }
      return {
        amount: Math.round(inf * 100) / 100,
        sub: 'net_revenue_inferred from reconciliation workbook',
        subSecondary,
        kpiLabel: 'Net revenue',
      };
    }
  }

  const gross = overviewPrimarySalesVolumeGross(parsedData);
  const { total: fees } = reconcileTotalFeesCharged(parsedData);
  const refunds = _overviewRefundTotalForNet(parsedData);

  // PRIORITY 2 — Linked POS + e‑commerce + bank bundles (processor pair, then gross − refunds − fees, then bank).
  if (linkedBundle) {
    const pair = linkedProcessorNetToBankPairForOverview(parsedData);
    if (pair && pair.sum > eps) {
      return {
        amount: pair.sum,
        sub: '',
        subSecondary: null,
        kpiLabel: 'Net revenue',
      };
    }
    if (
      gross != null &&
      Number.isFinite(gross) &&
      gross > eps &&
      fees != null &&
      Number.isFinite(fees) &&
      refunds >= 0
    ) {
      const calculated = Math.round((gross - refunds - fees) * 100) / 100;
      if (calculated > eps) {
        return {
          amount: calculated,
          sub: 'calculated: gross sales − refunds − total fees',
          subSecondary: `gross ${Math.round(gross * 100) / 100}, refunds ${Math.round(refunds * 100) / 100}, fees ${Math.round(fees * 100) / 100}`,
          kpiLabel: 'Net revenue',
        };
      }
    }
    const bank = Number(parsedData?.bank_credits_total_verified);
    if (Number.isFinite(bank) && bank > eps) {
      return {
        amount: Math.round(bank * 100) / 100,
        sub: '',
        subSecondary: null,
        kpiLabel: 'Net revenue',
      };
    }
  }

  // PRIORITY 3 — Single (unlinked) processor statement: gross − refunds − fees, then parser net fields.
  if (!linkedBundle) {
    if (
      gross != null &&
      Number.isFinite(gross) &&
      gross > eps &&
      fees != null &&
      Number.isFinite(fees) &&
      refunds >= 0
    ) {
      const calculated = Math.round((gross - refunds - fees) * 100) / 100;
      if (calculated > eps) {
        return {
          amount: calculated,
          sub: 'calculated: gross sales − refunds − total fees',
          subSecondary: `gross ${Math.round(gross * 100) / 100}, refunds ${Math.round(refunds * 100) / 100}, fees ${Math.round(fees * 100) / 100}`,
          kpiLabel: 'Net revenue (calculated)',
        };
      }
    }
  }

  const explicitNetFields = [
    'net_revenue',
    'net_settled_volume',
    'net_sales',
    'net_amount',
    'net_total',
    'settlement_amount',
    'payout_amount',
  ];

  if (!linkedBundle) {
    for (const field of explicitNetFields) {
      const value = Number(parsedData?.[field]);
      if (Number.isFinite(value) && value >= 0) {
        return {
          amount: Math.round(value * 100) / 100,
          sub: `${field} from statement`,
          subSecondary: null,
          kpiLabel: 'Net after fees',
        };
      }
    }
  }

  // PRIORITY 3 (continued) — channel volume roll-up when headline gross is missing.
  const posVolume = Number(parsedData?.pos_volume) || 0;
  const ecomVolume = Number(parsedData?.ecomm_volume) || 0;
  const cashVolume = Number(parsedData?.cash_volume) || 0;
  const totalVolume = posVolume + ecomVolume + cashVolume;

  if (totalVolume > eps && fees != null && Number.isFinite(fees) && fees > eps) {
    const netFromChannels = totalVolume - fees;
    if (netFromChannels >= 0) {
      return {
        amount: Math.round(netFromChannels * 100) / 100,
        sub: 'calculated: channel volumes - total fees',
        subSecondary: `channels: ${Math.round(totalVolume * 100) / 100}, fees: ${Math.round(fees * 100) / 100}`,
        kpiLabel: 'Net revenue (channel calc)',
      };
    }
  }

  if (gross != null && Number.isFinite(gross) && gross > eps && fees != null && Number.isFinite(fees)) {
    const calculated = Math.round((gross - fees) * 100) / 100;
    if (calculated >= 0) {
      return {
        amount: calculated,
        sub: 'calculated: gross sales − total fees (refunds not applied)',
        subSecondary: `gross: ${Math.round(gross * 100) / 100}, fees: ${Math.round(fees * 100) / 100}`,
        kpiLabel: 'Net revenue (calculated)',
      };
    }
  }

  // PRIORITY 4 — Caller-provided implied net (e.g. workbook-derived hint).
  const implied = Number(impliedNetFromGrossMinusFees);
  if (Number.isFinite(implied) && implied >= 0) {
    return {
      amount: Math.round(implied * 100) / 100,
      sub: '',
      subSecondary: null,
      kpiLabel: 'Net revenue',
    };
  }

  // NO DATA — nothing defensible to show on the Overview KPI.
  return { amount: null, sub: 'no net revenue data available', subSecondary: null, kpiLabel: 'Net revenue' };
}

export function sumChannelSplitFees(parsedData) {
  const s = parsedData?.channel_split;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return 0;
  let sum = 0;
  for (const k of Object.keys(s)) {
    const ch = s[k];
    if (!ch || typeof ch !== 'object') continue;
    if (_channelSplitPosEcomCashBucket(k, ch) === 'cash') continue;
    const f = Number(ch.fees);
    if (Number.isFinite(f) && f >= 0) sum += f;
  }
  return sum;
}

/**
 * When summed `channel_split.*.fees` exceeds `total_fees_charged` (common when the header total lags channel rows),
 * use the channel sum as the display total and set `scale` so other fee math can stay consistent with that total.
 */
export function reconcileTotalFeesCharged(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') {
    return { total: 0, scale: 1, reconciled: false };
  }
  const base = Number(parsedData.total_fees_charged) || 0;
  const sum = sumChannelSplitFees(parsedData);
  if (sum > base + 0.01) {
    const scale = base > 0 ? sum / base : 1;
    return { total: sum, scale, reconciled: true };
  }
  return { total: base, scale: 1, reconciled: false };
}

/**
 * Use `channel_split` POS / e-commerce processing fees for the Overview donut (and related UI) when those buckets
 * carry fee amounts and a reconciled fee total exists — **unless** the parse already has statement-sourced fee
 * detail (non-synthetic `fee_lines` or named top-level fee scalars), which take precedence in {@link getFeeLineOverviewRows}.
 */
export function shouldPreferChannelFeesForOverview(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return false;
  if (buildFeeOverviewRowsFromStatementFeeLines(parsedData).length) return false;
  if (buildFeeOverviewRowsFromScalarFeeFields(parsedData).length) return false;
  const chRows = buildPosEcomCashFeeOverviewRowsFromChannelSplit(parsedData);
  if (!chRows.length) return false;
  const { total: displayTotal } = reconcileTotalFeesCharged(parsedData);
  return displayTotal > 0.005;
}

/** Lowercased text from channel key + row labels + structured channel fields (underscores → spaces). */
function _channelSplitClassificationHaystack(channelKey, row) {
  const parts = [
    String(channelKey ?? ''),
    String(row?.channel_label ?? ''),
    String(row?.label ?? ''),
    String(row?.name ?? ''),
  ];
  for (const fid of [
    'sales_channel',
    'channel',
    'txn_type',
    'transaction_type',
    'entry_mode',
    'card_entry_mode',
    'payment_method',
    'tender_type',
    'source',
    'processor_channel',
  ]) {
    if (row?.[fid] != null && String(row[fid]).trim()) parts.push(String(row[fid]));
  }
  return parts
    .join(' ')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _channelSplitKeyNormalized(channelKey) {
  return String(channelKey ?? '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/__+/g, '_');
}

function _channelSplitRowIsEcommerce(channelKey, row) {
  if (row == null || typeof row !== 'object') return false;

  const k = _channelSplitKeyNormalized(channelKey);
  const kCompact = String(channelKey ?? '')
    .toLowerCase()
    .replace(/[\s_\-]+/g, '');

  const explicitEcomPatterns =
    /^(cnp|ecomm|ecommerce|online|web|digital|remote|moto|shopify|stripe|paypal|square_online|clover_online|amazon|ebay|walmart|wix|bigcommerce)$/i;
  if (explicitEcomPatterns.test(k)) return true;

  const inclusivePatterns = [
    /cnp/,
    /e.?commerce/i,
    /e.?com(?!merce)/i,
    /online/,
    /web(?!store)/i,
    /digital/,
    /shopify/,
    /stripe/,
    /paypal/,
    /square_online/,
    /clover_online/,
    /card.?not.?present/i,
    /not.?present/i,
    /moto/i,
    /keyed/i,
  ];
  for (const pattern of inclusivePatterns) {
    if (pattern.test(kCompact) || pattern.test(k)) return true;
  }

  const label = String(row?.channel_label || row?.label || row?.name || '').toLowerCase();
  const method = String(row?.payment_method || '').toLowerCase();
  const source = String(row?.source || '').toLowerCase();
  const type = String(row?.type || row?.transaction_type || '').toLowerCase();
  const hay = _channelSplitClassificationHaystack(channelKey, row);

  if (/\b(in\s*person|card\s*present|counter|storefront|pos\s+only)\b/i.test(hay) && !/\b(online|e-?commerce|cnp|web\s+sales)\b/i.test(hay)) {
    return false;
  }

  if (/\b(online|e-?commerce|cnp|card\s*not\s*present|not\s*present|moto|keyed|shopify|stripe|paypal|square|clover|amazon|ebay)\b/i.test(label)) {
    return true;
  }
  if (/\b(online|web|digital|cnp|ecom)\b/i.test(method)) return true;
  if (/\b(online|web|shopify|stripe|paypal|amazon|ebay|wix|bigcommerce)\b/i.test(source)) return true;
  if (/\b(online|ecommerce|cnp|internet|web|digital)\b/i.test(type)) return true;

  if (row?.entry_mode && /\b(cnp|keyed|moto|online|not\s*present)\b/i.test(String(row.entry_mode))) return true;
  if (row?.card_entry_mode && /\b(cnp|keyed|moto|online)\b/i.test(String(row.card_entry_mode))) return true;

  return false;
}

/** Cash / tender (not card-present sales); checked before e-commerce so keys like `cash_sales` route correctly. */
function _channelSplitRowIsCash(channelKey, row) {
  if (row == null || typeof row !== 'object') return false;

  const k = _channelSplitKeyNormalized(channelKey);
  const kCompact = String(channelKey ?? '')
    .toLowerCase()
    .replace(/[\s_\-]+/g, '');
  const label = String(row?.channel_label || row?.label || row?.name || '').toLowerCase();
  const hay = _channelSplitClassificationHaystack(channelKey, row);

  if (/\bcash\s*back\b|\bcashback\b/i.test(`${label} ${hay}`)) return false;
  if (/\bnon-?\s*cash\b/i.test(hay)) return false;

  const explicitCashPatterns = /^(cash|tender|check|checks|gift.?card|giftcard|bank.?transfer|ach|wire)$/i;
  if (explicitCashPatterns.test(k)) return true;

  const inclusivePatterns = [/^cash(?!back)/i, /tender/, /check/, /giftcard|gift.?card/i];
  for (const pattern of inclusivePatterns) {
    if (pattern.test(k) || pattern.test(kCompact)) return true;
  }

  if (/\b(cash|tender|check|giftcard|gift.?card)\b/i.test(label)) return true;

  if (row?.payment_method && /\bcash\b/i.test(String(row.payment_method))) return true;
  if (row?.tender_type && /\bcash\b/i.test(String(row.tender_type))) return true;
  return false;
}

/** @returns {'pos'|'ecom'|'cash'} */
function _channelSplitPosEcomCashBucket(channelKey, row) {
  // 1. Cash — tender / drawer (must not fall through to POS or e‑com).
  if (_channelSplitRowIsCash(channelKey, row)) return 'cash';
  // 2. E‑commerce — explicit online / CNP signals.
  if (_channelSplitRowIsEcommerce(channelKey, row)) return 'ecom';
  // 3. POS — default for card-present and unknown processor buckets.
  return 'pos';
}

/** POS / e‑commerce / cash bucket for a `channel_split` key + row (same rules as revenue aggregation). */
export function resolveChannelSplitBucket(channelKey, row) {
  return _channelSplitPosEcomCashBucket(channelKey, row);
}

/**
 * Why a `channel_split` row landed in POS / e‑com / cash (QA / browser console).
 * @param {string|number} channelKey
 * @param {object|null|undefined} row
 */
export function debugChannelSplitClassification(channelKey, row) {
  const result = resolveChannelSplitBucket(channelKey, row);
  const isCash = _channelSplitRowIsCash(channelKey, row);
  const isEcom = _channelSplitRowIsEcommerce(channelKey, row);
  return {
    key: channelKey,
    result,
    reasons: {
      cash: isCash,
      ecommerce: isEcom && !isCash,
      pos: !isCash && !isEcom,
    },
    label: row?.channel_label ?? row?.label,
    source: row?.source,
    paymentMethod: row?.payment_method,
  };
}

/** How many `channel_split` rows roll into the cash bucket (scalar uplift must not double-count across rows). */
function _channelSplitCashRowCount(parsedData) {
  const split = parsedData?.channel_split;
  if (!split || typeof split !== 'object' || Array.isArray(split)) return 0;
  let n = 0;
  for (const key of Object.keys(split)) {
    const row = split[key];
    if (!row || typeof row !== 'object') continue;
    if (_channelSplitPosEcomCashBucket(key, row) === 'cash') n++;
  }
  return n;
}

/**
 * Rows that should not add to **reported sales / fee roll-ups** when a processor export also has
 * statement-level fulfilled vs refunded breakdown (e.g. Shopify Order Detail + Month Summary).
 */
export function ecommOrderExcludedFromReportedSalesTotals(row) {
  if (!row || typeof row !== 'object') return false;
  const st = String(row.status ?? row.fulfillment_status ?? row.order_status ?? row.Fulfillment ?? row.State ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!st) return false;
  if (st === 'refunded' || st === 'voided' || st === 'void' || st === 'cancelled' || st === 'canceled') return true;
  if (st.includes('refunded')) return true;
  return false;
}

/** Sum order-level gross from the richest order list (prefer **most line rows**, then higher sum) so a one-line “month total” row does not override real order grids. */
export function sumEcommOrderGrossBestFromParsed(pd) {
  if (!pd || typeof pd !== 'object') return 0;
  const lists = [
    pd.ecomm_settlement_orders,
    pd.ecommerce_settlement_orders,
    pd.shopify_orders,
    pd.ecomm_orders,
  ].filter((x) => Array.isArray(x) && x.length > 0);
  let bestSum = 0;
  let bestLen = -1;
  for (const L of lists) {
    let s = 0;
    for (const o of L) {
      if (!o || typeof o !== 'object') continue;
      if (ecommOrderExcludedFromReportedSalesTotals(o)) continue;
      const g = Number(
        o.gross_sales ?? o.gross_volume ?? o.gross ?? o.order_total ?? o.total ?? o.charged_amount ?? o.amount,
      );
      if (!Number.isFinite(g) || !(g > 0.005)) continue;
      s += g;
    }
    s = Math.round(s * 100) / 100;
    const n = L.length;
    if (n > bestLen || (n === bestLen && s > bestSum)) {
      bestLen = n;
      bestSum = s;
    }
  }
  return bestSum;
}

/**
 * One display name per POS / e-commerce / cash bucket from `channel_split` row labels (or humanized keys).
 * @returns {{ pos: string, ecom: string, cash: string }}
 */
export function channelBucketDisplayLabels(parsedData) {
  const split = parsedData?.channel_split;
  const fb = (k) => humanizeFieldKey(k);
  if (!split || typeof split !== 'object' || Array.isArray(split)) {
    return { pos: fb('pos'), ecom: fb('ecommerce'), cash: fb('cash') };
  }
  const by = { pos: [], ecom: [], cash: [] };
  for (const key of Object.keys(split)) {
    const row = split[key];
    if (!row || typeof row !== 'object') continue;
    const b = _channelSplitPosEcomCashBucket(key, row);
    const t = b === 'cash' ? by.cash : b === 'ecom' ? by.ecom : by.pos;
    const lab = String(row.channel_label || row.label || row.name || '').trim();
    if (lab) t.push(lab);
    else {
      const hk = humanizeFieldKey(key);
      if (hk) t.push(hk);
    }
  }
  const uniqJoin = (arr) => {
    const u = [...new Set(arr.filter(Boolean))];
    if (!u.length) return '';
    if (u.length === 1) return u[0];
    return u.join(' · ');
  };
  return {
    pos: uniqJoin(by.pos) || fb('pos'),
    ecom: uniqJoin(by.ecom) || fb('ecommerce'),
    cash: uniqJoin(by.cash) || fb('cash'),
  };
}

/**
 * Fee overview rows from `channel_split.*.fees` (POS / e-commerce; cash has no processor charges).
 * Uses {@link _aggregatePosEcomCashBuckets} so amounts match summed `channel_split` fee fields only (no synthetic top-up).
 * @returns {{ label: string, value: number, bucket?: 'pos'|'ecom' }[]}
 */
function buildPosEcomCashFeeOverviewRowsFromChannelSplit(parsedData) {
  const agg = _aggregatePosEcomCashBuckets(parsedData);
  if (!agg) return [];
  const L = channelBucketDisplayLabels(parsedData);
  const out = [];
  if (agg.pos.fees > 0.005) {
    out.push({ label: _feeChargeLabelForBucket(agg.pos.feeTitles, L.pos), value: agg.pos.fees, bucket: 'pos' });
  }
  if (agg.ecom.fees > 0.005) {
    out.push({ label: _feeChargeLabelForBucket(agg.ecom.feeTitles, L.ecom), value: agg.ecom.fees, bucket: 'ecom' });
  }
  return out;
}

/** Sum-of-daily **Cash Sales** from Square Daily Summary at workbook ingest (`square_pos_daily_cash_sales_sum`). */
function _cashGrossHintFromSquareDailyCashSum(parsedData) {
  const v = Number(parsedData?.square_pos_daily_cash_sales_sum);
  return Number.isFinite(v) && v > 0.005 ? Math.round(v * 100) / 100 : null;
}

/** When Square Month Summary was merged into the payload, trust **Cash Sales** + refund share vs a stale daily stub in channel_split. */
function _cashGrossHintFromSquareWorkbookMonthSummary(parsedData) {
  const ms = parsedData?.pos_workbook_month_summary;
  if (!ms || typeof ms !== 'object') return null;
  const cash = Number(ms.total_cash_sales);
  const card = Number(ms.total_card_sales);
  const gross = Number(ms.total_gross_sales);
  const net = Number(ms.total_net_sales);
  const rf = Number(ms.total_refunds);
  if (!Number.isFinite(cash) || !(cash > 0.005)) return null;
  if (!Number.isFinite(card) || !(card > 0.005)) return null;
  const sumMix = Math.round((cash + card) * 100) / 100;
  const matchesNet =
    Number.isFinite(net) &&
    net > 0.005 &&
    Math.abs(sumMix - net) <= Math.max(12, 0.003 * Math.max(net, sumMix));
  if (
    matchesNet &&
    Number.isFinite(gross) &&
    gross > 0.005 &&
    Number.isFinite(rf) &&
    rf >= 0 &&
    sumMix > 0.005
  ) {
    const netTot = cash + card;
    const toCash = Math.round(rf * (cash / netTot) * 100) / 100;
    return Math.round((cash + toCash) * 100) / 100;
  }
  if (Number.isFinite(gross) && Math.abs(sumMix - gross) <= Math.max(15, 0.004 * gross)) {
    return Math.round(cash * 100) / 100;
  }
  return null;
}

/** @returns {{ gross: number, fees: number, refunds: number, netSettled: number, feeTitles: string[], deductions: number, statementNetSales: number | null, statementNetSalesLegacy: number | null }} */
function _emptyPosEcomCashBucket() {
  return {
    gross: 0,
    fees: 0,
    refunds: 0,
    netSettled: 0,
    feeTitles: [],
    deductions: 0,
    statementNetSales: null,
    statementNetSalesLegacy: null,
  };
}

/**
 * Square Month Summary: `channel_split.pos` carries full {@link statement_gross_volume}; the `cash` row is tender-only.
 * Gross for that cash row is omitted from Σ gross (see `_aggregatePosEcomCashBuckets`); **refunds** on the cash row
 * still belong to store POS and must roll into the POS bucket so revenue totals and headline refund_volume reconcile.
 */
function _squareCashMergedIntoPosStatementGross(split, row, bucket) {
  return (
    bucket === 'cash' &&
    row &&
    typeof row === 'object' &&
    row.square_month_summary_cash &&
    split &&
    typeof split === 'object' &&
    split.pos &&
    typeof split.pos === 'object' &&
    Number(split.pos.statement_gross_volume) > 0.005
  );
}

/**
 * Roll up `channel_split` into POS / e-commerce / cash for volumes, refunds, and net settled.
 * **Fees** roll up to POS / e-commerce only (cash is in-hand; no processor charges).
 * `feeTitles` collects labels only from rows that carry fees (for charge line naming).
 * @returns {{ pos: ReturnType<typeof _emptyPosEcomCashBucket>, ecom: ReturnType<typeof _emptyPosEcomCashBucket>, cash: ReturnType<typeof _emptyPosEcomCashBucket> } | null}
 */
function _aggregatePosEcomCashBuckets(parsedData) {
  const split = parsedData?.channel_split;
  if (!split || typeof split !== 'object' || Array.isArray(split)) return null;
  const pos = _emptyPosEcomCashBucket();
  const ecom = _emptyPosEcomCashBucket();
  const cash = _emptyPosEcomCashBucket();
  let cashBucketRowCount = 0;
  for (const key of Object.keys(split)) {
    const row = split[key];
    if (!row || typeof row !== 'object') continue;
    if (_channelSplitPosEcomCashBucket(key, row) === 'cash') cashBucketRowCount++;
  }
  const cashFileHintOk = cashBucketRowCount <= 1;
  for (const key of Object.keys(split)) {
    const row = split[key];
    if (!row || typeof row !== 'object') continue;
    const b = _channelSplitPosEcomCashBucket(key, row);
    const target = b === 'cash' ? cash : b === 'ecom' ? ecom : pos;
    let grossAdd =
      b === 'cash'
        ? channelSplitCashRowDisplayVolume(parsedData, row, { allowFileLevelCashHint: cashFileHintOk })
        : channelSplitRowGrossForAggregate(parsedData, row, b);
    // Square Month Summary: POS `statement_gross_volume` is full store gross; card sits on `pos` and cash on `cash`.
    // Count that total once in the POS bucket — do not also add cash tender dollars into Σ channel gross / bars.
    if (
      b === 'cash' &&
      row?.square_month_summary_cash &&
      split.pos &&
      typeof split.pos === 'object' &&
      Number(split.pos.statement_gross_volume) > 0.005
    ) {
      grossAdd = 0;
    }
    target.gross += grossAdd;
    if (b !== 'cash') {
      const f = Number(row.fees);
      if (Number.isFinite(f) && f >= 0) target.fees += f;
      if (Number.isFinite(f) && f > 0.005) {
        const t = String(row.channel_label || row.label || row.name || '').trim();
        if (t) target.feeTitles.push(t);
      }
    }
    const rf = _dispChannelRefunds(row);
    if (rf != null && rf > 0) {
      if (_squareCashMergedIntoPosStatementGross(split, row, b)) {
        pos.refunds += rf;
      } else {
        target.refunds += rf;
      }
    }
    const ns = Number(row.net_settled_volume);
    if (Number.isFinite(ns) && ns > 0.005) target.netSettled += ns;
    if (b !== 'cash') {
      target.deductions += _dispChannelTradeDeductions(row);
      const ex0 = _dispChannelExplicitNetSales(row);
      if (ex0 != null) {
        target.statementNetSales = (target.statementNetSales ?? 0) + ex0;
      }
      const exLeg = legacyChannelExplicitNetSales(row);
      if (exLeg != null) {
        target.statementNetSalesLegacy = (target.statementNetSalesLegacy ?? 0) + exLeg;
      }
    }
  }

  const msCash = _cashGrossHintFromSquareWorkbookMonthSummary(parsedData);
  const dailyCash = _cashGrossHintFromSquareDailyCashSum(parsedData);
  let hint = msCash != null ? msCash : dailyCash;
  if (
    hint != null &&
    hint > cash.gross + Math.max(20, 0.025 * Math.max(hint, cash.gross))
  ) {
    cash.gross = Math.round(hint * 100) / 100;
  }

  return { pos, ecom, cash };
}

function _feeChargeLabelForBucket(feeTitles, bucketName) {
  const uniq = [...new Set(feeTitles.filter(Boolean))];
  if (uniq.length === 1) return uniq[0];
  if (uniq.length > 1) return `${bucketName} · ${uniq.slice(0, 3).join(' · ')}`;
  return bucketName || humanizeFieldKey('fees');
}

// ── Discrepancy report tab (cross-channel reconciliation workbook layout) ──

const _RECON_DIFF_EPS = 0.005;

/** Present and finite; `0` is valid. `null`/`''`/NaN → null. */
function _optionalFiniteNum(x) {
  if (x == null || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function _dispNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function _dispRound2(x) {
  return Math.round(Number(x) * 100) / 100;
}

function _dispChannelLabel(ch, fallback) {
  if (!ch || typeof ch !== 'object') return fallback;
  const s = String(ch.channel_label || ch.label || ch.name || '').trim();
  return s || fallback;
}

function _dispChannelRefunds(ch) {
  const r = ch?.refund_volume ?? ch?.refunds;
  if (r == null || r === '') return null;
  const n = Math.abs(Number(r));
  return Number.isFinite(n) ? n : null;
}

/**
 * Sum of statement-side amounts that reduce net sales besides refunds (discounts, adjustments, voids, chargebacks, etc.).
 * Each field is taken as an absolute dollar magnitude so sign conventions on the parse do not flip the roll-up.
 */
function _dispChannelTradeDeductions(ch) {
  if (!ch || typeof ch !== 'object') return 0;
  const keys = [
    'discount_volume',
    'discounts',
    'total_discounts',
    'discount_amount',
    'adjustment_volume',
    'adjustments',
    'adjustment_amount',
    'net_adjustments',
    'void_volume',
    'voids',
    'void_amount',
    'chargeback_volume',
    'chargebacks',
    'other_deductions',
    'statement_discounts',
    'tips_out',
    'third_party_fees',
  ];
  let s = 0;
  for (const k of keys) {
    const n = Number(ch[k]);
    if (Number.isFinite(n) && Math.abs(n) > 0.005) s += Math.abs(n);
  }
  return Math.round(s * 100) / 100;
}

/**
 * Original behavior: first positive value among the canonical `net_sales` keys (no settlement / fee heuristics).
 * Kept alongside {@link _dispChannelExplicitNetSales} for compatibility and internal comparison.
 */
export function legacyChannelExplicitNetSales(ch) {
  if (!ch || typeof ch !== 'object') return null;
  for (const k of ['net_sales', 'net_sales_volume', 'total_net_sales', 'net_sales_total']) {
    const n = Number(ch[k]);
    if (Number.isFinite(n) && n > 0.005) return Math.round(n * 100) / 100;
  }
  return null;
}

/** Processor / statement **net sales** when the parse stamps it — fee‑ / settlement‑aware read (extends legacy keys). */
function _dispChannelExplicitNetSales(ch) {
  if (!ch || typeof ch !== 'object') return null;
  const keys = [
    'net_sales',
    'net_sales_volume',
    'total_net_sales',
    'net_sales_total',
    'merchandise_net',
    'sales_net',
    'adjusted_net_sales',
  ];
  const fees = Math.abs(Number(ch.fees) || 0);
  const settled = Number(ch.net_settled_volume);
  const vol = Number(ch.volume ?? ch.gross_volume ?? ch.gross_sales);
  for (const k of keys) {
    const n = Number(ch[k]);
    if (!Number.isFinite(n) || !(n > 0.005)) continue;
    const rounded = Math.round(n * 100) / 100;
    // Some exports label **payout / net-to-bank** as "net sales"; do not treat as merchandise net (avoids fee − twice in UI).
    if (Number.isFinite(settled) && settled > 0.005 && fees > 0.005) {
      if (Math.abs(rounded - settled) <= Math.max(1.5, 0.01 * Math.max(rounded, settled))) continue;
    }
    if (Number.isFinite(vol) && vol > 0.005 && fees > 0.005) {
      const volMinusFees = Math.round((vol - fees) * 100) / 100;
      if (Math.abs(rounded - volMinusFees) <= Math.max(2, 0.012 * Math.max(vol, 1))) continue;
    }
    return rounded;
  }
  return null;
}

/**
 * Net sales for one POS / e‑commerce bucket: **gross − refunds − trade deductions**, or an explicit row `net_sales`
 * when present and plausible vs gross.
 * @param {{ gross: number, refunds: number, deductions?: number, fees?: number, statementNetSales?: number | null }} b
 */
function _revenueBucketNetSales(b) {
  const gross = _dispRound2(b.gross);
  const rfAmt = b.refunds > 0.005 ? _dispRound2(b.refunds) : 0;
  const ded = b.deductions > 0.005 ? _dispRound2(b.deductions) : 0;
  const parts = _dispRound2(gross - rfAmt - ded);
  const fees = Math.abs(Number(b.fees) || 0);
  const sn = b.statementNetSales;
  if (sn != null && sn > 0.005) {
    const ex = _dispRound2(sn);
    const cap = gross + Math.max(2, 0.002 * Math.max(gross, 1));
    if (ex >= -0.005 && ex <= cap) {
      const tol = Math.max(0.5, 0.002 * Math.max(gross, ex, parts, fees, rfAmt, 1));
      // Parser sometimes stamps **gross − fees** (or even **gross**) as `net_sales` while `refund_volume` is
      // non‑zero — that would leave refunds out of Net Sales. Prefer the computed merchandise net.
      const nearGrossOnly = rfAmt > 0.005 && Math.abs(ex - gross) <= tol;
      const nearGrossMinusFees =
        rfAmt > 0.005 && fees > 0.005 && Math.abs(ex - _dispRound2(gross - fees)) <= tol;
      if ((nearGrossOnly || nearGrossMinusFees) && Math.abs(ex - parts) > tol) return parts;
      return ex;
    }
  }
  return parts;
}

/**
 * POS + e‑commerce refund dollars from `channel_split` (cash tender excluded). Discrepancy tab uses this so
 * **refund_volume** is explicit as **POS refunds + e‑commerce refunds**.
 * @returns {{ pos: number, ecom: number, sum: number } | null}
 */
export function posEcomRefundPartsForDiscrepancyReport(parsedData) {
  const split = parsedData?.channel_split;
  if (!split || typeof split !== 'object' || Array.isArray(split)) return null;
  let pos = 0;
  let ecom = 0;
  for (const key of Object.keys(split)) {
    const row = split[key];
    if (!row || typeof row !== 'object') continue;
    const bucket = _channelSplitPosEcomCashBucket(key, row);
    if (bucket === 'cash') {
      if (_squareCashMergedIntoPosStatementGross(split, row, bucket)) {
        const r = _dispChannelRefunds(row);
        if (r != null && r > 0.005) pos += r;
      }
      continue;
    }
    const r = _dispChannelRefunds(row);
    if (r == null || !(r > 0.005)) continue;
    if (bucket === 'ecom') ecom += r;
    else pos += r;
  }
  pos = Math.round(pos * 100) / 100;
  ecom = Math.round(ecom * 100) / 100;
  const sum = Math.round((pos + ecom) * 100) / 100;
  if (!(sum > 0.005)) return null;
  return { pos, ecom, sum };
}

/**
 * Single sentence for the Discrepancy report: headline **refund_volume** equals POS channel refunds plus
 * e‑commerce channel refunds (with optional note when the headline field differs from the channel sum).
 */
export function discrepancyRefundEquationText(parsedData, channelLabels) {
  const parts = posEcomRefundPartsForDiscrepancyReport(parsedData);
  if (!parts) return null;
  const L = channelLabels || channelBucketDisplayLabels(parsedData);
  const ccy = getStatementDisplayCurrency(parsedData);
  const headN = Number(parsedData?.refund_volume);
  const totalShown =
    Number.isFinite(headN) && headN > 0.005 ? Math.round(headN * 100) / 100 : parts.sum;
  const label = _parserFieldLabel(parsedData, 'refund_volume');
  let line = `${label} ${formatMoney(totalShown, ccy)} = ${L.pos} refunds ${formatMoney(parts.pos, ccy)} + ${L.ecom} refunds ${formatMoney(parts.ecom, ccy)}.`;
  if (
    Number.isFinite(headN) &&
    headN > 0.005 &&
    Math.abs(headN - parts.sum) > Math.max(1, 0.02 * Math.max(headN, parts.sum))
  ) {
    line += ` (${label} is the headline parse field; channel split sum is ${formatMoney(parts.sum, ccy)}.)`;
  }
  return line;
}

/**
 * Parsed `net_settled_volume` sometimes equals **gross − fees** while **net sales** already subtracts refunds.
 * In that case using settlement as "Net Bank" ignores refunds and inflates Overview net revenue. Prefer
 * **net sales − fees** when channel refunds exist and settlement tracks gross−fees but not sales−fees.
 * @param {{ netSettled: number, refunds: number }} b bucket from {@link _aggregatePosEcomCashBuckets}
 */
function _coherentNetBankForRevenueRow(b, gross, netSales, fees) {
  const settled = _dispRound2(b.netSettled);
  const nsMinusF = _dispRound2(netSales - fees);
  if (!(settled > 0.005)) return nsMinusF;
  const gf = _dispRound2(gross - fees);
  const tol = Math.max(1.01, 0.00015 * Math.max(Math.abs(gross), Math.abs(netSales), 1));
  const nearGrossMinusFees = Math.abs(settled - gf) <= tol;
  const nearSalesMinusFees = Math.abs(settled - nsMinusF) <= tol;
  const rfAmt = b.refunds > 0.005 ? _dispRound2(b.refunds) : 0;
  if (rfAmt > 0.005 && nearGrossMinusFees && !nearSalesMinusFees) return nsMinusF;
  return settled;
}

/**
 * When `channel_split` is missing or all channel gross/fees are zero, build POS / e‑com buckets from top-level
 * `pos_volume`, `ecomm_volume`, and `total_transaction_volume` so revenue / Channel / Discrepancy still show.
 * Skips linked bundles (split roll-up is required there).
 * @returns {ReturnType<typeof _aggregatePosEcomCashBuckets> | null}
 */
function _aggregatePosEcomCashBucketsScalarFallback(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  const linked =
    parsedData.linked_statement_bundle &&
    typeof parsedData.linked_statement_bundle === 'object' &&
    !Array.isArray(parsedData.linked_statement_bundle);
  if (linked) return null;

  const pos = _emptyPosEcomCashBucket();
  const ecom = _emptyPosEcomCashBucket();
  const cash = _emptyPosEcomCashBucket();
  const pv = Number(parsedData.pos_volume);
  const ev = Number(parsedData.ecomm_volume ?? parsedData.ecommerce_volume);
  const tt = Number(parsedData.total_transaction_volume);
  const tf = Number(parsedData.total_fees_charged);
  const pn = Number(parsedData.pos_net_deposit_volume);
  const en = Number(parsedData.ecomm_net_deposit_volume);

  let posGross = NaN;
  let ecomGross = NaN;
  if (Number.isFinite(pv) && pv > 0.005) posGross = pv;
  if (Number.isFinite(ev) && ev > 0.005) ecomGross = ev;
  if (!Number.isFinite(posGross) && Number.isFinite(tt) && tt > 0.005) {
    if (Number.isFinite(ecomGross) && ecomGross > 0.005) {
      posGross = Math.round(Math.max(0, tt - ecomGross) * 100) / 100;
    } else {
      posGross = Math.round(tt * 100) / 100;
    }
  }

  if (Number.isFinite(posGross) && posGross > 0.005) {
    pos.gross = Math.round(posGross * 100) / 100;
    const hasEcom = Number.isFinite(ecomGross) && ecomGross > 0.005;
    if (!hasEcom && Number.isFinite(tf) && tf > 0.005) pos.fees = Math.round(tf * 100) / 100;
    if (Number.isFinite(pn) && pn > 0.005) pos.netSettled = Math.round(pn * 100) / 100;
  }
  if (Number.isFinite(ecomGross) && ecomGross > 0.005) {
    ecom.gross = Math.round(ecomGross * 100) / 100;
    const hasPos = pos.gross > 0.005;
    if (!hasPos && Number.isFinite(tf) && tf > 0.005) ecom.fees = Math.round(tf * 100) / 100;
    if (Number.isFinite(en) && en > 0.005) ecom.netSettled = Math.round(en * 100) / 100;
  }

  if (!(pos.gross > 0.005) && !(ecom.gross > 0.005)) return null;
  return { pos, ecom, cash };
}

/**
 * @returns {{ rows: { key: string, label: string, gross: number, refunds: number | null, netSales: number, fees: number, netBank: number }[], totals: { gross: number, refunds: number | null, netSales: number, fees: number, netBank: number }, refundNote: string | null, netBankTotalNote: string | null, compositionNote: string | null, headings: { sectionTitle: string, channel: string, grossSales: string, refunds: string, netSales: string, fees: string, netBank: string, totalRow: string }, showRefundColumns: boolean } | null}
 */
export function buildRevenueByChannelTable(parsedData) {
  let agg = _aggregatePosEcomCashBuckets(parsedData);
  if (!agg) {
    agg = _aggregatePosEcomCashBucketsScalarFallback(parsedData);
  }
  if (!agg) return null;
  const L = channelBucketDisplayLabels(parsedData);
  const rows = [];
  const mk = (key, displayLabel, b) => {
    const gross = _dispRound2(b.gross);
    const fees = _dispRound2(b.fees);
    const rf = b.refunds > 0.005 ? _dispRound2(b.refunds) : null;
    if (!(gross > 0.005) && !(fees > 0.005)) return;
    const netSales = _revenueBucketNetSales(b);
    const rfAmt = rf != null ? rf : 0;
    let netBank = _coherentNetBankForRevenueRow(b, gross, netSales, fees);
    if (!(Number(b.netSettled) > 0.005)) {
      netBank = _dispRound2(gross - rfAmt - fees);
    }
    rows.push({
      key,
      label: displayLabel,
      gross,
      refunds: rf,
      netSales,
      fees,
      netBank,
    });
  };
  mk('pos', L.pos, agg.pos);
  mk('ecom', L.ecom, agg.ecom);
  if (!rows.length) {
    const aggFb = _aggregatePosEcomCashBucketsScalarFallback(parsedData);
    if (aggFb) {
      mk('pos', L.pos, aggFb.pos);
      mk('ecom', L.ecom, aggFb.ecom);
    }
  }
  if (!rows.length) return null;

  let refundNote = null;
  const anyNullRefund = rows.some((r) => r.refunds == null);
  const totalRefundParsed = _dispNum(parsedData?.refund_volume);

  const grossTotal = _dispRound2(rows.reduce((s, r) => s + r.gross, 0));
  const sumRowRefunds = _dispRound2(rows.reduce((s, r) => s + (r.refunds ?? 0), 0));
  const anyRowRefund = rows.some((r) => r.refunds != null && r.refunds > 0.005);
  let refundsTotal = null;
  if (anyRowRefund || sumRowRefunds > 0.005) {
    refundsTotal = sumRowRefunds;
  } else if (totalRefundParsed > 0.005) {
    refundsTotal = _dispRound2(totalRefundParsed);
  }
  const feesTotal = _dispRound2(rows.reduce((s, r) => s + r.fees, 0));
  const netBankFromRows = _dispRound2(rows.reduce((s, r) => s + r.netBank, 0));
  const netSalesFromRows = _dispRound2(rows.reduce((s, r) => s + r.netSales, 0));
  const netSalesTotal = netSalesFromRows;
  const netBankTotal = netBankFromRows;
  let netBankTotalNote = null;
  const fromNetSalesMinusFees = _dispRound2(netSalesTotal - feesTotal);
  if (
    Math.abs(fromNetSalesMinusFees - netBankFromRows) >
    Math.max(2, 0.002 * Math.max(Math.abs(netBankFromRows), 1))
  ) {
    const ccy = getStatementDisplayCurrency(parsedData);
    netBankTotalNote = `Total Net Bank sums the channel rows (${formatMoney(netBankFromRows, ccy)}). That can differ from total net sales minus fees (${formatMoney(fromNetSalesMinusFees, ccy)}) when a channel uses processor settlement (net_settled_volume) instead of net sales − fees.`;
  }
  const linkedBundle =
    parsedData?.linked_statement_bundle &&
    typeof parsedData.linked_statement_bundle === 'object' &&
    !Array.isArray(parsedData.linked_statement_bundle);
  const verifiedBankForNote = Number(parsedData?.bank_credits_total_verified);
  if (
    linkedBundle &&
    Number.isFinite(verifiedBankForNote) &&
    verifiedBankForNote > 0.005 &&
    netBankFromRows > 0.005
  ) {
    const bankTol = Math.max(200, 0.025 * Math.max(netBankFromRows, verifiedBankForNote, 1));
    if (netBankFromRows - verifiedBankForNote > bankTol) {
      const ccy = getStatementDisplayCurrency(parsedData);
      const extra = ` ${_parserFieldLabel(parsedData, 'bank_credits_total_verified')} on the linked bank statement is ${formatMoney(verifiedBankForNote, ccy)} (e.g. processor payout credits); Σ Net Bank is ${formatMoney(netBankFromRows, ccy)} from POS/e‑commerce processor data. Overview Net revenue uses the bank figure when this gap is large.`;
      netBankTotalNote = (netBankTotalNote || '') + extra;
    }
  }
  const totals = {
    gross: grossTotal,
    refunds: refundsTotal,
    netSales: netSalesTotal,
    fees: feesTotal,
    netBank: netBankTotal,
  };

  if (totalRefundParsed > sumRowRefunds + Math.max(1, 0.02 * totalRefundParsed) && totalRefundParsed > 0.005) {
    const ccy = getStatementDisplayCurrency(parsedData);
    refundNote = `${_parserFieldLabel(parsedData, 'refund_volume')} (${formatMoney(_dispRound2(totalRefundParsed), ccy)}) exceeds the sum of per-channel refund columns (${formatMoney(sumRowRefunds, ccy)}); totals use the channel sum so net sales and net bank stay consistent.`;
  } else if (anyNullRefund && totalRefundParsed > 0.005 && !(sumRowRefunds > 0.005)) {
    const ccy = getStatementDisplayCurrency(parsedData);
    refundNote = `${_parserFieldLabel(parsedData, 'refund_volume')}: ${formatMoney(_dispRound2(totalRefundParsed), ccy)}; ${_parserFieldLabel(parsedData, 'channel_split')} ${_parserFieldLabel(parsedData, 'refunds')} not split per row.`;
  }
  const ui =
    parsedData?.report_ui && typeof parsedData.report_ui === 'object' && !Array.isArray(parsedData.report_ui)
      ? parsedData.report_ui
      : {};
  const pick = (k, fb) => (typeof ui[k] === 'string' && ui[k].trim() ? ui[k].trim() : fb);
  const headings = {
    sectionTitle: pick('revenue_section_title', _parserFieldLabel(parsedData, 'channel_split')),
    channel: pick('revenue_col_channel', humanizeFieldKey('channel')),
    grossSales: pick('revenue_col_gross_sales', humanizeFieldKey('gross_volume')),
    refunds: pick('revenue_col_refunds', humanizeFieldKey('refund_volume')),
    netSales: pick('revenue_col_net_sales', humanizeFieldKey('net_sales')),
    fees: pick('revenue_col_fees', humanizeFieldKey('fees')),
    netBank: pick('revenue_col_net_to_bank', humanizeFieldKey('net_bank')),
    totalRow: pick('revenue_row_total', humanizeFieldKey('total')),
  };
  const showRefundColumns =
    rows.some((r) => r.refunds != null) || (totals.refunds != null && totals.refunds > 0.005);
  const anyDed =
    (agg.pos.deductions > 0.005 || agg.ecom.deductions > 0.005) &&
    (agg.pos.gross > 0.005 || agg.ecom.gross > 0.005);
  const anyStmtNet =
    (agg.pos.statementNetSales != null && agg.pos.statementNetSales > 0.005) ||
    (agg.ecom.statementNetSales != null && agg.ecom.statementNetSales > 0.005);
  let compositionNote = null;
  if (anyDed || anyStmtNet) {
    compositionNote =
      'Net sales per channel: gross minus refunds minus discounts, adjustments, voids, and similar statement deductions when those fields exist on the channel row; otherwise the row’s net sales total (`net_sales` / `total_net_sales`, etc.) when the statement provides it.';
  }
  return { rows, totals, refundNote, netBankTotalNote, compositionNote, headings, showRefundColumns };
}

/**
 * One call to {@link buildRevenueByChannelTable} with stable POS / e‑commerce row handles.
 * Use this anywhere Channel Split and Discrepancy must show the same gross and fees (including merged channel cards).
 * @returns {{ table: NonNullable<ReturnType<typeof buildRevenueByChannelTable>>, posRow: object | null, ecomRow: object | null } | null}
 */
export function getRevenueByChannelPosEcom(parsedData) {
  const table = buildRevenueByChannelTable(parsedData);
  if (!table?.rows?.length) return null;
  let posRow = null;
  let ecomRow = null;
  for (const r of table.rows) {
    if (r.key === 'pos') posRow = r;
    if (r.key === 'ecom') ecomRow = r;
  }
  return { table, posRow, ecomRow };
}

/**
 * POS + e‑commerce Net Bank from {@link buildRevenueByChannelTable} — identical to the Channel Split “Net Bank” rows.
 * Prefer this over raw `pos_net_deposit_volume` / `ecomm_net_deposit_volume` wherever the UI shows both tables together.
 * @returns {{ pos: number, ecom: number, sum: number } | null}
 */
export function getChannelNetBankPairForReconciliation(parsedData) {
  const rev = buildRevenueByChannelTable(parsedData);
  if (!rev?.rows?.length) return null;
  let pos = 0;
  let ecom = 0;
  for (const r of rev.rows) {
    if (r.key === 'pos') pos = Number(r.netBank) || 0;
    if (r.key === 'ecom') ecom = Number(r.netBank) || 0;
  }
  const tol = 0.005;
  if (!(pos > tol) || !(ecom > tol)) return null;
  const rp = Math.round(pos * 100) / 100;
  const re = Math.round(ecom * 100) / 100;
  return { pos: rp, ecom: re, sum: Math.round((rp + re) * 100) / 100 };
}

/** @returns {{ label: string, value: number | null, sub?: string | null }[]} */
export function buildBankReconciliationRows(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return [];
  const pair = getChannelNetBankPairForReconciliation(parsedData);
  const posNet =
    pair != null && pair.pos > 0.005 ? pair.pos : _dispNum(parsedData.pos_net_deposit_volume);
  const ecNet =
    pair != null && pair.ecom > 0.005 ? pair.ecom : _dispNum(parsedData.ecomm_net_deposit_volume);
  const expected = getReconciliationExpectedDeposits(parsedData, pair);
  const actual = _dispNum(parsedData.bank_credits_total_verified);
  const diff = computeReconciliationDifferenceValue(parsedData);

  return [
    {
      label: 'POS net to bank',
      value: posNet > 0.005 ? posNet : null,
      sub: _parserFieldLabel(parsedData, 'pos_net_deposit_volume'),
    },
    {
      label: 'E‑commerce net to bank',
      value: ecNet > 0.005 ? ecNet : null,
      sub: _parserFieldLabel(parsedData, 'ecomm_net_deposit_volume'),
    },
    {
      label: 'Expected processor settlement',
      value: expected != null && expected > 0.005 ? expected : null,
      sub: 'POS net to bank + e‑commerce net to bank; workbook expected deposits only if those nets are missing',
    },
    {
      label: 'Actual bank credits (statement)',
      value: actual > 0.005 ? actual : null,
      sub: _parserFieldLabel(parsedData, 'bank_credits_total_verified'),
    },
    {
      label: 'Difference (expected − actual)',
      value: diff,
      sub: 'Expected processor settlement − actual bank credits (positive if bank credits are below settlement)',
    },
  ];
}

/** Shown on the Discrepancy tab when a golden reconciliation workbook is merged or parsed. */
export const RECONCILIATION_VARIANCE_GUIDANCE_DEFAULT =
  'Use the steps above as your tie-out: processor settlement lines → workbook expected deposit → bank ledger credits. When they disagree, the dollars are usually still inside the payment stack (batch timing, T+1/T+2 settlement, weekly ACH windows), outside it (cash, checks, non-card tenders), or split across other statement lines (reserves, chargebacks, separate fee debits). The workbook discrepancy table names the line items when the file includes them.';

/**
 * Statement-style reconciliation walk: processor nets → workbook expected deposit → bank credits → variance meaning.
 * Each string is one numbered step for the Discrepancy tab. Variance is expected minus actual when present.
 * @param {object} parsedData
 * @returns {string[]}
 */
export function buildReconciliationVariancePlainEnglishExplanation(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return [];

  const ccy = getStatementDisplayCurrency(parsedData);
  const L = channelBucketDisplayLabels(parsedData);
  const pair = getChannelNetBankPairForReconciliation(parsedData);
  const posNet =
    pair != null && pair.pos > 0.005 ? pair.pos : _dispNum(parsedData.pos_net_deposit_volume);
  const ecNet =
    pair != null && pair.ecom > 0.005 ? pair.ecom : _dispNum(parsedData.ecomm_net_deposit_volume);
  const sumChannels =
    pair != null && pair.sum > 0.005 ? pair.sum : _dispRound2(posNet + ecNet);
  const hasCh = posNet > _RECON_DIFF_EPS || ecNet > _RECON_DIFF_EPS;
  const expected = getReconciliationExpectedDeposits(parsedData, pair);

  const bankOpt = _optionalFiniteNum(parsedData.bank_credits_total_verified);
  const bankDisp = bankOpt != null && bankOpt > _RECON_DIFF_EPS ? _dispRound2(bankOpt) : null;
  const variance = computeReconciliationDifferenceValue(parsedData);
  const disc = Array.isArray(parsedData.reconciliation_discrepancy_lines)
    ? parsedData.reconciliation_discrepancy_lines
    : [];

  if (!hasCh && !(expected != null && expected > _RECON_DIFF_EPS)) {
    return [];
  }

  const out = [];
  let step = 1;
  const nextStep = () => step++;

  if (
    expected != null &&
    expected > _RECON_DIFF_EPS &&
    bankDisp != null &&
    (variance == null || Math.abs(variance) <= _RECON_DIFF_EPS)
  ) {
    const chBits = [];
    if (posNet > _RECON_DIFF_EPS) {
      chBits.push(
        `${L.pos} card settlement nets ${formatMoney(_dispRound2(posNet), ccy)} to the bank after sales, refunds, and processing charges on the statement pack.`,
      );
    }
    if (ecNet > _RECON_DIFF_EPS) {
      chBits.push(
        `${L.ecom} nets ${formatMoney(_dispRound2(ecNet), ccy)} on the same basis (processor-side net deposit, not merchandise gross).`,
      );
    }
    if (chBits.length) {
      out.push(`Step ${step} — Read processor settlement first: ${chBits.join(' ')}`);
      nextStep();
    }
    out.push(
      `Step ${step} — Workbook tie-out: the reconciliation sheet's expected deposit line is ${formatMoney(expected, ccy)} for this period.`,
    );
    nextStep();
    out.push(
      `Step ${step} — Bank statement: ${formatMoney(bankDisp, ccy)} in verified processor credits lands in the same window, so processor math, workbook expected deposits, and bank credits agree within normal rounding (no material reconciliation variance).`,
    );
    nextStep();
    if (disc.length) {
      out.push(
        `Step ${step} — Footnotes: the workbook still carries ${disc.length} labeled discrepancy row(s); keep them for audit trail—if the dollars are tiny, they are usually rounding or presentation, not missing revenue.`,
      );
    }
    return out;
  }

  if (hasCh) {
    const chParts = [];
    if (posNet > _RECON_DIFF_EPS) {
      chParts.push(
        `${L.pos} ${formatMoney(_dispRound2(posNet), ccy)} net to bank (card sales, less refunds and card fees, per processor settlement lines).`,
      );
    }
    if (ecNet > _RECON_DIFF_EPS) {
      chParts.push(`${L.ecom} ${formatMoney(_dispRound2(ecNet), ccy)} net to bank on the same definition.`);
    }
    let workbookLine = '';
    if (expected != null && expected > _RECON_DIFF_EPS) {
      if (Math.abs(expected - sumChannels) > 1) {
        workbookLine = ` The workbook's single expected deposit line is ${formatMoney(expected, ccy)} (it can diverge slightly from the sum of the two channels when the sheet includes adjustments or contra entries).`;
      } else if (sumChannels > _RECON_DIFF_EPS) {
        workbookLine = ` Those channels sum to ${formatMoney(sumChannels, ccy)}, which matches the workbook expected deposit total ${formatMoney(expected, ccy)}.`;
      } else {
        workbookLine = ` The workbook shows ${formatMoney(expected, ccy)} as expected deposits for the period.`;
      }
    }
    out.push(`Step ${step} — Processor / statement pack: ${chParts.join(' ')}${workbookLine}`);
    nextStep();
  } else if (expected != null && expected > _RECON_DIFF_EPS) {
    out.push(
      `Step ${step} — Workbook only: expected deposits are ${formatMoney(expected, ccy)}; this file did not split ${L.pos} vs ${L.ecom} net settlement lines—use the workbook detail tabs for channel drill-down.`,
    );
    nextStep();
  }

  if (bankDisp != null && expected != null && expected > _RECON_DIFF_EPS) {
    if (variance != null && Math.abs(variance) > _RECON_DIFF_EPS) {
      const mag = formatMoney(Math.abs(_dispRound2(variance)), ccy);
      out.push(
        `Step ${step} — Bank ledger: verified processor credits on the bank statement for this tie-out are ${formatMoney(bankDisp, ccy)}.`,
      );
      nextStep();
      if (variance > 0) {
        out.push(
          `Step ${step} — Where the gap is (not necessarily a fee leak): reconciliation variance is ${mag} (expected ${formatMoney(expected, ccy)} minus bank ${formatMoney(bankDisp, ccy)}). That usually means funds are still in the settlement pipeline (batch not paid yet), posted in the next bank cycle, held (reserve or chargeback), or booked on other statement lines (separate fee debits, cash not run through the card processor). Use the discrepancy table and the delayed settlement section below to pinpoint the driver.`,
        );
      } else {
        out.push(
          `Step ${step} — Bank vs workbook: the bank shows ${mag} more than the workbook expected line (${formatMoney(bankDisp, ccy)} credited vs ${formatMoney(expected, ccy)} expected). That often means an extra deposit in the bank window, duplicate ACH, or different date scope between the bank extract and the processor file—confirm dates before treating it as income.`,
        );
      }
      nextStep();
    } else if (variance == null || Math.abs(variance) <= _RECON_DIFF_EPS) {
      out.push(
        `Step ${step} — Bank ledger: ${formatMoney(bankDisp, ccy)} credited matches the workbook expected ${formatMoney(expected, ccy)} within a few cents.`,
      );
      nextStep();
    }
  } else if (bankDisp == null && variance != null && Math.abs(variance) > _RECON_DIFF_EPS) {
    out.push(
      `Step ${step} — Bank side missing in upload: workbook variance is ${formatMoney(Math.abs(_dispRound2(variance)), ccy)}; add ${_parserFieldLabel(parsedData, 'bank_credits_total_verified')} (or re-run with the bank statement) so we can show where the gap sits between processor and bank.`,
    );
    nextStep();
  }

  if (disc.length) {
    let sumFinite = 0;
    let anyAmt = false;
    for (const li of disc) {
      const a = _optionalFiniteNum(li?.amount);
      if (a != null) {
        anyAmt = true;
        sumFinite += a;
      }
    }
    if (anyAmt) {
      const sr = _dispRound2(sumFinite);
      let msg = `Step ${step} — Workbook line items: ${disc.length} discrepancy row(s) sum to about ${formatMoney(sr, ccy)} (see table).`;
      if (variance != null && Math.abs(variance) > _RECON_DIFF_EPS) {
        const vr = _dispRound2(variance);
        if (Math.abs(sr - vr) <= 1 || Math.abs(sr + vr) <= 1) {
          msg += ` That explains the headline ${formatMoney(Math.abs(vr), ccy)} variance row-by-row—use each label as your audit checklist.`;
        } else {
          msg += ` Headline variance is ${formatMoney(Math.abs(vr), ccy)}; if the sum differs, check sign convention, rounding, or rows not imported.`;
        }
      }
      out.push(msg);
      nextStep();
    } else {
      out.push(
        `Step ${step} — Narrative-only rows: ${disc.length} discrepancy explanation(s) have no amounts in this extract—read the descriptions in the table for the business reason (timing, reserve, adjustment, etc.).`,
      );
      nextStep();
    }
  } else if (variance != null && Math.abs(variance) > _RECON_DIFF_EPS) {
    out.push(
      `Step ${step} — No itemized bridge: we did not capture workbook discrepancy lines—typical drivers are settlement timing, cash or checks outside card settlement, reserves, or processor fees on separate debits. Scroll to "Delayed settlement → bank" if batches look late.`,
    );
  }

  return out;
}

/**
 * Compact variance explanation for dashboard / cards when full paragraphs are not shown.
 * @param {object} parsedData
 * @returns {string | null}
 */
export function buildReconciliationVarianceShortReason(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  const ccy = getStatementDisplayCurrency(parsedData);
  const expected = getReconciliationExpectedDeposits(parsedData);
  const bank = _optionalFiniteNum(parsedData.bank_credits_total_verified);
  const v = computeReconciliationDifferenceValue(parsedData);

  if (expected != null && expected > _RECON_DIFF_EPS && bank != null && bank > _RECON_DIFF_EPS) {
    if (v != null && Math.abs(v) <= _RECON_DIFF_EPS) {
      return `Tie-out clean: workbook expected settlement (${formatMoney(expected, ccy)}) matches verified bank credits (${formatMoney(bank, ccy)}) within a few cents for this statement window.`;
    }
    if (v != null && Math.abs(v) > _RECON_DIFF_EPS) {
      const mag = formatMoney(Math.abs(_dispRound2(v)), ccy);
      const sense =
        v > 0
          ? `Gap ${mag}: processor expected ${formatMoney(expected, ccy)} vs bank credits ${formatMoney(bank, ccy)}—bank is short versus the workbook (timing, holds, or other lines usually explain it).`
          : `Gap ${mag}: bank credits ${formatMoney(bank, ccy)} run above processor expected ${formatMoney(expected, ccy)}—confirm extra deposits or date scope before booking.`;
      return `${sense} Typical drivers: settlement timing across statement periods, other ACH in the same bank bucket, cash not in the card total, reserves or chargebacks, or processor fees as separate debits.`;
    }
  }

  if (v != null && Math.abs(v) > _RECON_DIFF_EPS && (bank == null || !(bank > _RECON_DIFF_EPS))) {
    return `Variance ${formatMoney(Math.abs(_dispRound2(v)), ccy)} is on file without a verified bank credit total—upload or link the bank statement leg to see the full processor-to-bank walk.`;
  }

  return null;
}

/**
 * Plain-language tips from in-store vs online vs cash mix (no dollar amount; confirm with bank/processor).
 * @returns {{ label: string, amount: number | null, explanation: string }[]}
 */
export function buildChannelOptimizationSuggestions(parsedData) {
  const agg = _aggregatePosEcomCashBuckets(parsedData);
  if (!agg) return [];
  const L = channelBucketDisplayLabels(parsedData);
  const { pos, ecom, cash } = agg;
  const totalG = pos.gross + ecom.gross + cash.gross;
  if (!(totalG > 0.005)) return [];
  const cardG = pos.gross + ecom.gross;
  const eff = (g, fees) => (g > 0.005 ? fees / g : null);
  const effPos = eff(pos.gross, pos.fees);
  const effEcom = eff(ecom.gross, ecom.fees);
  const ccy = getStatementDisplayCurrency(parsedData);
  const id = getParsedIdentity(parsedData);
  const proc = id.acquirer_name ? id.acquirer_name.trim() : '';

  const out = [];

  if (effPos != null && effEcom != null && ecom.gross > cardG * 0.08 && effEcom > effPos * 1.12) {
    const pct = ((effEcom / effPos - 1) * 100).toFixed(0);
    out.push({
      label: `${L.ecom} / ${L.pos}: ${humanizeFieldKey('fee_rate_ratio')} +${pct}%`,
      amount: null,
      explanation: [
        `${L.ecom}: ${formatMoney(ecom.fees, ccy)} / ${formatMoney(ecom.gross, ccy)} = ${(effEcom * 100).toFixed(3)}%`,
        `${L.pos}: ${formatMoney(pos.fees, ccy)} / ${formatMoney(pos.gross, ccy)} = ${(effPos * 100).toFixed(3)}%`,
        proc ? `${_parserFieldLabel(parsedData, 'acquirer_name')}: ${proc}` : _parserFieldLabel(parsedData, 'acquirer_name'),
      ].join(' · '),
    });
  }
  if (effPos != null && effEcom != null && pos.gross > cardG * 0.08 && effPos > effEcom * 1.12) {
    const pct = ((effPos / effEcom - 1) * 100).toFixed(0);
    out.push({
      label: `${L.pos} / ${L.ecom}: ${humanizeFieldKey('fee_rate_ratio')} +${pct}%`,
      amount: null,
      explanation: [
        `${L.pos}: ${formatMoney(pos.fees, ccy)} / ${formatMoney(pos.gross, ccy)} = ${(effPos * 100).toFixed(3)}%`,
        `${L.ecom}: ${formatMoney(ecom.fees, ccy)} / ${formatMoney(ecom.gross, ccy)} = ${(effEcom * 100).toFixed(3)}%`,
        proc ? `${_parserFieldLabel(parsedData, 'acquirer_name')}: ${proc}` : _parserFieldLabel(parsedData, 'acquirer_name'),
      ].join(' · '),
    });
  }
  if (cardG > 0.005 && ecom.gross / cardG >= 0.52) {
    const p = ((ecom.gross / cardG) * 100).toFixed(0);
    out.push({
      label: `${L.ecom}: ${p}% ${humanizeFieldKey('of_card_gross')}`,
      amount: null,
      explanation: `${L.ecom} ${formatMoney(ecom.gross, ccy)} · ${L.pos} ${formatMoney(pos.gross, ccy)} · Σ ${formatMoney(cardG, ccy)}`,
    });
  }
  if (cardG > 0.005 && pos.gross / cardG >= 0.62) {
    const p = ((pos.gross / cardG) * 100).toFixed(0);
    out.push({
      label: `${L.pos}: ${p}% ${humanizeFieldKey('of_card_gross')}`,
      amount: null,
      explanation: `${L.pos} ${formatMoney(pos.gross, ccy)} · ${L.ecom} ${formatMoney(ecom.gross, ccy)} · Σ ${formatMoney(cardG, ccy)}`,
    });
  }
  if (cash.gross > totalG * 0.2 && cash.gross > 50) {
    const p = ((cash.gross / totalG) * 100).toFixed(0);
    out.push({
      label: `${L.cash}: ${p}% ${humanizeFieldKey('of_total_gross')}`,
      amount: null,
      explanation: `${formatMoney(cash.gross, ccy)} / ${formatMoney(totalG, ccy)} · ${_parserFieldLabel(parsedData, 'bank_credits_total_verified')} vs ${_parserFieldLabel(parsedData, 'channel_split')}`,
    });
  }

  return out.slice(0, 4);
}

function _reconciliationVarianceExplanation(parsedData, vSynth) {
  const ccy = getStatementDisplayCurrency(parsedData);
  const bank = _optionalFiniteNum(parsedData?.bank_credits_total_verified);
  const expected = getReconciliationExpectedDeposits(parsedData);
  const vLab = _parserFieldLabel(parsedData, 'reconciliation_variance');
  const amt = formatMoney(_dispRound2(vSynth), ccy);
  if (expected != null && expected > 0.005 && bank != null && bank > 0.005) {
    return `${vLab} (${amt}) is the gap between expected settlement ${formatMoney(_dispRound2(expected), ccy)} and verified bank credits ${formatMoney(bank, ccy)} on this tie-out.`;
  }
  return `${vLab}: ${amt}`;
}

/**
 * Parsed statement discrepancy rows plus synthetic reconciliation variance when applicable.
 * @returns {{ label: string, amount: number | null, explanation: string }[]}
 */
export function buildStatementDiscrepancyRows(stmt, parsedData) {
  const statementRows = [];
  const disc = stmt?.discrepancies;
  if (Array.isArray(disc)) {
    for (const d of disc) {
      if (!d || typeof d !== 'object') continue;
      const label =
        String(d.label ?? d.discrepancy ?? d.title ?? '').trim() || _parserFieldLabel(parsedData, 'line_item');
      const amount = _dispNum(d.amount);
      const explanation = String(d.explanation ?? d.note ?? d.description ?? '').trim();
      if (amount === 0 && !explanation && !String(d.label ?? d.discrepancy ?? d.title ?? '').trim()) continue;
      statementRows.push({ label, amount, explanation });
    }
  }
  let vSynth = computeReconciliationDifferenceValue(parsedData);
  if (vSynth == null) {
    vSynth = _optionalFiniteNum(parsedData?.reconciliation_variance);
  }
  const varLabel = _parserFieldLabel(parsedData, 'reconciliation_variance');
  const hasSynthVarianceRow = statementRows.some((r) => {
    const lb = String(r.label).toLowerCase();
    return lb.includes('reconciliation variance') || String(r.label).trim() === varLabel;
  });
  if (!hasSynthVarianceRow && vSynth != null) {
    statementRows.push({
      label: varLabel,
      amount: _dispRound2(vSynth),
      explanation: Math.abs(vSynth) > 0.02 ? _reconciliationVarianceExplanation(parsedData, vSynth) : '',
    });
  }
  return statementRows;
}

/**
 * @returns {{ statementRows: { label: string, amount: number | null, explanation: string }[] }}
 */
export function buildDiscrepancyLineItems(stmt, parsedData) {
  return { statementRows: buildStatementDiscrepancyRows(stmt, parsedData) };
}

function _parseBillingDate(s) {
  if (s == null || s === '') return null;
  const str = String(s).trim();
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function getBillingPeriodBounds(parsedData) {
  const bp = parsedData?.billing_period;
  if (!bp || typeof bp !== 'object') return null;
  const from = _parseBillingDate(bp.from ?? bp.start);
  const to = _parseBillingDate(bp.to ?? bp.end);
  if (!from || !to || from > to) return null;
  return { from, to };
}

export function getBillingPeriodDisplay(parsedData, locale) {
  const bp = parsedData?.billing_period;
  if (!bp || typeof bp !== 'object') return null;
  const from = _parseBillingDate(bp.from ?? bp.start);
  const to = _parseBillingDate(bp.to ?? bp.end);
  if (!from || !to || from > to) return null;
  const df = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const days = Math.round((to - from) / 86400000) + 1;
  return {
    fromText: df.format(from),
    toText: df.format(to),
    days,
  };
}

function _peSalesSnapshot(parsedData, ccy) {
  const cs = parsedData.channel_split;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) return null;
  const agg = _aggregatePosEcomCashBuckets(parsedData);
  const L = channelBucketDisplayLabels(parsedData);
  const bits = [];
  if (agg && (agg.pos.gross > 0.005 || agg.ecom.gross > 0.005 || agg.cash.gross > 0.005)) {
    if (agg.pos.gross > 0.005) bits.push(`${L.pos} ${formatMoney(agg.pos.gross, ccy)}`);
    if (agg.ecom.gross > 0.005) bits.push(`${L.ecom} ${formatMoney(agg.ecom.gross, ccy)}`);
    if (agg.cash.gross > 0.005) bits.push(`${L.cash} ${formatMoney(agg.cash.gross, ccy)}`);
  }
  const out = bits.length ? [`${_parserFieldLabel(parsedData, 'channel_split')}: ${bits.join(' · ')}.`] : [];
  let bestLab = '';
  let bestN = -1;
  for (const key of Object.keys(cs)) {
    const ch = cs[key];
    if (!ch || typeof ch !== 'object') continue;
    const n = _optionalFiniteNum(ch.txn_count);
    if (n != null && n > bestN) {
      bestN = n;
      bestLab = _dispChannelLabel(ch, key);
    }
  }
  if (bestLab && bestN > 0) out.push(`${_parserFieldLabel(parsedData, 'txn_count')}: ${bestLab} (${bestN.toLocaleString('en-US')}).`);
  return out.length ? out.join(' ') : null;
}

function _peCardMixShort(parsedData) {
  const mix = parsedData.card_mix;
  if (mix && typeof mix === 'object' && !Array.isArray(mix)) {
    let bestK = null;
    let bestV = -Infinity;
    let sum = 0;
    for (const [k, raw] of Object.entries(mix)) {
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      sum += n;
      if (n > bestV) {
        bestV = n;
        bestK = k;
      }
    }
    if (bestK != null && bestV > 0) {
      const disp = cardBrandMixRowHumanLabel(null, 0, bestK);
      if (sum > 85 && sum < 115) return `${humanizeFieldKey('card_mix')}: ${disp} ${bestV.toFixed(0)}% (Σ≈${sum.toFixed(0)}).`;
      return `${humanizeFieldKey('card_mix')}: ${disp}.`;
    }
  }
  const rows = getCardBrandMixFromParsed(parsedData);
  if (!Array.isArray(rows) || !rows.length) return null;
  const scored = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const vol = cardMixRowVolume(r, parsedData);
    const v = Number(vol);
    if (!Number.isFinite(v) || !(v > 0)) continue;
    const label = String(cardBrandMixRowHumanLabel(r, i) || r.label || r.brand || r.network || r.scheme || '').trim();
    if (!label) continue;
    scored.push({ label, v });
  }
  scored.sort((a, b) => b.v - a.v);
  const top = scored.slice(0, 3);
  if (!top.length) return null;
  const volLab = _parserFieldLabel(parsedData, 'volume');
  const bits = top.map((x) => `${x.label} · ${volLab} ${x.v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
  return `${humanizeFieldKey('card_brand_mix')}: ${bits.join(' · ')}.`;
}

function _peTopFeeLineShort(parsedData, ccy) {
  if (shouldPreferChannelFeesForOverview(parsedData)) return null;
  const lines = Array.isArray(parsedData.fee_lines) ? parsedData.fee_lines : [];
  if (!lines.length) return null;
  let top = { typ: '', amt: -1 };
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i];
    if (!row || typeof row !== 'object') continue;
    if (isSyntheticInterchangeSchemeProcessorFeeLine(row)) continue;
    const raw = Number(feeLineRowAmount(row));
    if (!Number.isFinite(raw)) continue;
    const amt = roundMoney2(Math.abs(raw));
    const typ = feeLineDisplayLabel(row, i, parsedData).trim();
    if (amt > top.amt) top = { typ: typ || humanizeFieldKey('fee_line'), amt };
  }
  if (top.amt <= 0.01) return null;
  const short = top.typ.length > 48 ? `${top.typ.slice(0, 45)}…` : top.typ;
  return `${humanizeFieldKey('fee_lines')}: ${short} ${formatMoney(top.amt, ccy)}`;
}

function _ymdToReadable(ymd) {
  if (ymd == null || typeof ymd !== 'string') return null;
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    const t = String(ymd).trim();
    return t || null;
  }
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(dt.getTime())) return ymd;
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Opening bullets for the Plain English summary when bank vs processor variance is present: what the dollar gap means,
 * plus one optional line when pending processor-only nets trail the variance (timing hint).
 * @param {object} parsedData
 * @returns {string[]}
 */
function buildDiscrepancyReconciliationVarianceContextLines(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return [];
  let diff = computeReconciliationDifferenceValue(parsedData);
  if (diff == null) {
    const explicit = _optionalFiniteNum(parsedData.reconciliation_variance);
    if (explicit != null && Math.abs(explicit) > _RECON_DIFF_EPS) diff = explicit;
  }
  if (diff == null || Math.abs(diff) <= _RECON_DIFF_EPS) return [];

  const ccy = getStatementDisplayCurrency(parsedData);
  const expHelper = getReconciliationExpectedDeposits(parsedData);
  const expected =
    expHelper != null && expHelper > _RECON_DIFF_EPS ? _dispRound2(expHelper) : null;
  const bankOpt = _optionalFiniteNum(parsedData.bank_credits_total_verified);
  const bank = bankOpt != null && bankOpt > _RECON_DIFF_EPS ? _dispRound2(bankOpt) : null;

  const mag = formatMoney(Math.abs(_dispRound2(diff)), ccy);
  const lines = [];

  if (expected != null && expected > _RECON_DIFF_EPS && bank != null) {
    if (diff > _RECON_DIFF_EPS) {
      lines.push(
        `Statement tie-out (step 1): processor / workbook expected settlement is ${formatMoney(expected, ccy)} for this period.`,
      );
      lines.push(
        `Statement tie-out (step 2): verified bank credits are ${formatMoney(bank, ccy)}—${mag} less than expected, so the variance is on the bank-ledger side of the bridge (money not yet credited, held, or booked elsewhere—not automatically ${
          statementBreaksOutInterchangeOrSchemeFees(parsedData)
            ? 'an interchange or scheme-fee issue'
            : 'a mis-read of a specific processor fee line on this extract'
        }).`,
      );
      lines.push(
        'Next checks: match settlement batch dates to ACH posting dates, scan for reserve or chargeback lines, confirm cash and checks are excluded from the card total, and look for processor fees taken as separate debits.',
      );
    } else if (diff < -_RECON_DIFF_EPS) {
      lines.push(
        `Statement tie-out: the bank statement shows ${mag} more in processor credits (${formatMoney(bank, ccy)}) than the workbook expected settlement (${formatMoney(expected, ccy)}). Treat that as a scope or timing signal until you confirm an extra deposit, duplicate ACH, or a different statement window on the bank extract.`,
      );
    }
  } else if (expected != null && expected > _RECON_DIFF_EPS && bank == null) {
    lines.push(
      `Statement tie-out: expected settlement from the processor pack is ${formatMoney(expected, ccy)}, but this upload has no ${_parserFieldLabel(parsedData, 'bank_credits_total_verified')}—add the bank leg so the app can finish the bank-vs-processor story in steps.`,
    );
    lines.push(
      'Until then, compare that expected line to your bank statement manually: look for settlement lag, cash outside card processors, reserves, and fee debits on their own lines.',
    );
  } else {
    lines.push(
      `Reconciliation variance on file: ${mag}. Tie it out by lining up POS plus e-commerce net to bank (or ${_parserFieldLabel(parsedData, 'reconciliation_total_deposits')} when channel nets are missing) against ${_parserFieldLabel(parsedData, 'bank_credits_total_verified')} on the bank statement.`,
    );
  }

  const facts = getPendingSettlementNarrativeFacts(parsedData);
  const combinedPending =
    (facts.pos.pendingNetTotal != null ? facts.pos.pendingNetTotal : 0) +
    (facts.ecom.pendingNetTotal != null ? facts.ecom.pendingNetTotal : 0);
  const roundedComb = Math.round(combinedPending * 100) / 100;
  if (
    diff > _RECON_DIFF_EPS &&
    roundedComb > _RECON_DIFF_EPS &&
    Math.abs(roundedComb - diff) <= Math.max(25, Math.abs(diff) * 0.2)
  ) {
    lines.push(
      `Data signal: processor rows with settlement activity but no bank payout date in this export still net about ${formatMoney(roundedComb, ccy)}, close to the ${mag} gap—month-end cutoff and ACH batch timing is a strong explanation before you assume lost revenue.`,
    );
  }

  return lines;
}

/**
 * Headline volume, reconciled fees, and implied effective rate for comparing one statement to another (no agreements).
 * @param {object} parsedData finalized parse
 * @returns {{ ccy: string, gv: number, fees: number, eff: number | null } | null}
 */
function snapshotStatementCompareMetrics(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  const ccy = getStatementDisplayCurrency(parsedData);
  const gv0 = overviewPrimarySalesVolumeGross(parsedData);
  const gv =
    gv0 != null && Number.isFinite(Number(gv0)) && Number(gv0) > 0.005
      ? Number(gv0)
      : _dispNum(parsedData.total_transaction_volume);
  if (!(gv > 0.005)) return null;
  const { total: fees } = reconcileTotalFeesCharged(parsedData);
  const eff = fees >= 0 && gv > 0.005 ? (fees / gv) * 100 : null;
  return { ccy, gv, fees, eff: eff != null && Number.isFinite(eff) ? eff : null };
}

/**
 * Plain-English deltas vs other uploaded statements (same currency only). Numbers come from each file’s parse only.
 * @param {object} currentPd finalized parse for the report in view
 * @param {{ period?: string, acquirer?: string, parsedData?: object }[]} peers other finalized parses (best recency first)
 * @returns {string[]}
 */
export function buildStatementLibraryCompareLines(currentPd, peers) {
  const cur = snapshotStatementCompareMetrics(currentPd);
  if (!cur || !Array.isArray(peers) || peers.length < 1) return [];
  const out = [];
  let used = 0;
  for (const p of peers) {
    if (used >= 2) break;
    const pd = p?.parsedData;
    if (!pd || typeof pd !== 'object') continue;
    const peer = snapshotStatementCompareMetrics(pd);
    if (!peer || peer.ccy !== cur.ccy) continue;
    used += 1;
    const label = String(p.period ?? '').trim() || 'Earlier statement';
    const volPct = peer.gv > 0.005 ? ((cur.gv - peer.gv) / peer.gv) * 100 : null;
    const feePct = peer.fees > 0.005 ? ((cur.fees - peer.fees) / peer.fees) * 100 : null;
    const effDeltaBp =
      cur.eff != null && peer.eff != null && Number.isFinite(cur.eff) && Number.isFinite(peer.eff)
        ? Math.round((cur.eff - peer.eff) * 100)
        : null;
    const volPhrase =
      volPct != null && Number.isFinite(volPct)
        ? `${volPct >= 0 ? 'up' : 'down'} ${fmt(Math.abs(volPct), 1)}% (${formatMoney(cur.gv, cur.ccy)} vs ${formatMoney(peer.gv, peer.ccy)})`
        : `${formatMoney(cur.gv, cur.ccy)} on this statement vs ${formatMoney(peer.gv, peer.ccy)} on ${label}`;
    const feePhrase =
      feePct != null && Number.isFinite(feePct)
        ? `${feePct >= 0 ? 'up' : 'down'} ${fmt(Math.abs(feePct), 1)}% (${formatMoney(cur.fees, cur.ccy)} vs ${formatMoney(peer.fees, peer.ccy)})`
        : `${formatMoney(cur.fees, cur.ccy)} vs ${formatMoney(peer.fees, peer.ccy)}`;
    const effPhrase =
      effDeltaBp != null && cur.eff != null && peer.eff != null
        ? ` Implied effective rate (fees ÷ headline volume) is ${cur.eff.toFixed(2)}% here vs ${peer.eff.toFixed(2)}% on ${label} (${effDeltaBp >= 0 ? '+' : ''}${effDeltaBp} bps).`
        : '';
    out.push(
      `Compared with ${label} in your statement library (${cur.ccy}): headline processing volume is ${volPhrase}; total fees are ${feePhrase}.${effPhrase} Why the period-to-period gap exists (mix, refunds, pricing, seasonality) is not determined from these two parses alone.`,
    );
  }
  return out;
}

/**
 * Honest scope for the Reconciliation plain-English list: what the JSON supports vs what is not inferable here.
 * @param {object} parsedData
 * @returns {string[]}
 */
function buildPlainEnglishEvidenceGapLines(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return [];
  const out = [];
  out.push(
    'This list is grounded only in fields on this upload—we state gaps plainly instead of guessing bank policy, contract terms, or off-file timing.',
  );

  const disp = getBillingPeriodDisplay(parsedData, 'en-US');
  if (disp?.fromText && disp?.toText) {
    out.push(
      `Billing window on the parse: ${disp.fromText} → ${disp.toText} (${disp.days} calendar day span on the billing_period object).`,
    );
  } else {
    out.push(
      'Billing window: no usable billing_period from/to on this extract—use line-level dates in tables when you need a strict accrual window.',
    );
  }

  const cs = parsedData.channel_split;
  const hasSplit = cs && typeof cs === 'object' && !Array.isArray(cs) && Object.keys(cs).length > 0;
  if (hasSplit) {
    out.push(
      'Channel economics (POS / online / cash) follow channel_split on this snapshot when those rows carry volume or fees.',
    );
  } else {
    out.push(
      'Unknown here: POS vs e-commerce vs cash split—channel_split is missing or empty, so channel tables cannot be tied to separate buckets from this file alone.',
    );
  }

  const feeLineCount = Array.isArray(parsedData.fee_lines) ? parsedData.fee_lines.length : 0;
  if (feeLineCount < 1 && _dispNum(parsedData.total_fees_charged) > 0.005) {
    const tfLab = _parserFieldLabel(parsedData, 'total_fees_charged');
    if (statementBreaksOutInterchangeOrSchemeFees(parsedData)) {
      out.push(
        `Unknown here: itemized fee lines—fee_lines is empty while ${tfLab} is present; this parse still carries named fee scalars (interchange_fees / scheme_fees / fee_totals_by_slug, etc.) as top-level totals without per-row detail.`,
      );
    } else {
      out.push(
        `Unknown here: itemized fee lines—fee_lines is empty while ${tfLab} is present, so we cannot list individual processor charge rows from this JSON.`,
      );
    }
  }

  const bank = _optionalFiniteNum(parsedData.bank_credits_total_verified);
  if (bank == null || !(bank > _RECON_DIFF_EPS)) {
    out.push(
      `Unknown here: verified bank credits—${_parserFieldLabel(parsedData, 'bank_credits_total_verified')} is missing or not positive, so we cannot confirm what hit the bank account from this extract alone.`,
    );
  }

  const exp = getReconciliationExpectedDeposits(parsedData);
  const posNet = _optionalFiniteNum(parsedData.pos_net_deposit_volume);
  const ecNet = _optionalFiniteNum(parsedData.ecomm_net_deposit_volume);
  const hasExpected = exp != null && exp > _RECON_DIFF_EPS;
  const hasPair =
    posNet != null &&
    posNet > _RECON_DIFF_EPS &&
    ecNet != null &&
    ecNet > _RECON_DIFF_EPS;
  if (!hasExpected && !hasPair) {
    out.push(
      'Unknown here: a single “expected settlement” bridge—workbook expected deposits and both POS and e-commerce net-to-bank are not all present, so processor-to-bank wording stays partial.',
    );
  }

  const disc = Array.isArray(parsedData.reconciliation_discrepancy_lines) ? parsedData.reconciliation_discrepancy_lines.length : 0;
  let v = computeReconciliationDifferenceValue(parsedData);
  if (v == null) {
    const exV = _optionalFiniteNum(parsedData.reconciliation_variance);
    if (exV != null && Math.abs(exV) > _RECON_DIFF_EPS) v = exV;
  }
  if (v != null && Math.abs(v) > _RECON_DIFF_EPS && disc === 0) {
    out.push(
      'Unknown here: labeled reasons for reconciliation variance—reconciliation_discrepancy_lines is empty on this import, so only the headline variance amount is visible, not row-by-row explanations.',
    );
  }

  const conf = String(parsedData.parsing_confidence ?? '').trim().toLowerCase();
  if (conf === 'medium' || conf === 'low') {
    out.push(
      `Parser confidence is ${parsedData.parsing_confidence}—treat any fine-grained narrative as provisional until you reconcile against the original statement PDF or spreadsheet.`,
    );
  }

  const issues = Array.isArray(parsedData.parse_issues) ? parsedData.parse_issues.map(String) : [];
  if (issues.includes('tabular_pos_semantic_map_failed')) {
    out.push(
      'Unknown here: embedded POS grids—the parser flagged tabular_pos_semantic_map_failed (semantic column map did not succeed), so row-level POS gross, fee, and tender reads from tabular grids on this sheet are not treated as verified.',
    );
  }
  if (issues.includes('tabular_pos_semantic_map_low_confidence')) {
    out.push(
      'Unknown here: tabular_pos_semantic_map_low_confidence—column headings mapped only with low confidence; line-level POS rollups may disagree with your PDF until you add heading_role_aliases or a template bundle for this bank export.',
    );
  }
  if (issues.includes('tabular_pos_card_mix_unverified')) {
    out.push(
      'Unknown here: tabular_pos_card_mix_unverified—card / tender columns were not mapped confidently, so per-brand card mix from line rows is not asserted on this file.',
    );
  }

  const parserCardMix = getCardBrandMixFromParsed(parsedData);
  const hasParserCardMix = Array.isArray(parserCardMix) && parserCardMix.length > 0;
  const ecomRows = pickEcommerceOrderArrays(parsedData).slice(0, 400);
  const rowHasEcomCardField = (row) => {
    if (!row || typeof row !== 'object') return false;
    for (const k of ['card_brand', 'card_type', 'card_scheme', 'payment_method', 'network', 'tender_type', 'payment_brand']) {
      const s = String(row[k] ?? '').trim();
      if (s && !/^n\/?a$/i.test(s) && !/^unknown$/i.test(s) && !/^none$/i.test(s)) return true;
    }
    return false;
  };
  const ecVol =
    _dispNum(parsedData.ecomm_volume) ||
    _dispNum(parsedData.channel_split?.cnp?.volume) ||
    _dispNum(parsedData.channel_split?.ecommerce?.volume);
  if (ecVol > 0.005 && ecomRows.length >= 3 && !hasParserCardMix && !ecomRows.some(rowHasEcomCardField)) {
    out.push(
      'Unknown here: online card-brand mix—e-commerce order rows lack card or payment columns and card_brand_mix is absent, so card-network splits (Visa/MC/Amex, etc.) cannot be read from this file alone.',
    );
  }

  return out.slice(0, 12);
}

/**
 * Summary bullets from parsed JSON, plus statement discrepancy rows and channel mix notes (same card in UI).
 * @param {object|null|undefined} parsedData
 * @param {object|null|undefined} [stmt] Statement record (`discrepancies` array when present).
 * @param {{ pos?: object | null, peerStatements?: { period?: string, acquirer?: string, parsedData?: object }[] }} [opts] Pass `pos` from {@link buildStatementClientModel}. Optional `peerStatements` adds library-vs-library comparison lines (same currency).
 * @returns {string[]}
 */
export function buildPlainEnglishSummaryLines(parsedData, stmt = null, opts = {}) {
  if (!parsedData || typeof parsedData !== 'object') return [];
  const ccy = getStatementDisplayCurrency(parsedData);
  const varianceCtx = buildDiscrepancyReconciliationVarianceContextLines(parsedData);
  const evidenceGaps = buildPlainEnglishEvidenceGapLines(parsedData);
  const lines = [...varianceCtx, ...evidenceGaps];
  const gv = _dispNum(parsedData.total_transaction_volume);
  const feeRecon = reconcileTotalFeesCharged(parsedData);
  const { total: fees } = feeRecon;

  if (gv > 0.01 && fees >= 0) {
    const pct = ((fees / gv) * 100).toFixed(2);
    lines.push(
      `From this file only: processing cost on headline card volume is ${formatMoney(fees, ccy)} in ${_parserFieldLabel(parsedData, 'total_fees_charged')} on ${formatMoney(gv, ccy)} ${_parserFieldLabel(parsedData, 'total_transaction_volume')} (${pct}% implied on those two scalars). That is not the same as bank–processor reconciliation variance. Library comparisons below require another upload in the same currency.`,
    );
  }

  for (const libLine of buildStatementLibraryCompareLines(parsedData, opts.peerStatements ?? [])) {
    lines.push(libLine);
  }

  if (feeRecon.reconciled) {
    const base = Number(parsedData.total_fees_charged) || 0;
    const sum = sumChannelSplitFees(parsedData);
    lines.push(
      `${humanizeFieldKey('channel_split')} Σ ${_parserFieldLabel(parsedData, 'total_fees_charged')}: ${formatMoney(sum, ccy)} > ${formatMoney(base, ccy)} · scale ${feeRecon.scale.toFixed(4)}`,
    );
  }

  const snap = _peSalesSnapshot(parsedData, ccy);
  if (snap) lines.push(snap);

  const mix = _peCardMixShort(parsedData);
  if (mix) lines.push(mix);

  const topFee = _peTopFeeLineShort(parsedData, ccy);
  if (topFee) lines.push(topFee);

  const rfRefund = _pickRefundVolumeForOverview(parsedData);
  if (rfRefund != null && rfRefund > 0.01) {
    lines.push(`${_parserFieldLabel(parsedData, 'refund_volume')}: ${formatMoney(rfRefund, ccy)}`);
  }

  for (const r of buildStatementDiscrepancyRows(stmt ?? {}, parsedData)) {
    const bits = [r.label];
    if (r.amount != null && Number.isFinite(Number(r.amount))) {
      bits.push(formatMoney(_dispRound2(Number(r.amount)), ccy));
    }
    if (r.explanation) bits.push(r.explanation);
    lines.push(bits.join(' — '));
  }

  let batchNoiseDiff = computeReconciliationDifferenceValue(parsedData);
  if (batchNoiseDiff == null) {
    const exVar = _optionalFiniteNum(parsedData.reconciliation_variance);
    if (exVar != null && Math.abs(exVar) > _RECON_DIFF_EPS) batchNoiseDiff = exVar;
  }
  const skipBatchCommissionPlainLines =
    batchNoiseDiff != null && Math.abs(batchNoiseDiff) > _RECON_DIFF_EPS;

  if (!skipBatchCommissionPlainLines) {
    const plainLines = opts.pos?.batchAnalysis?.plainLines;
    const linesArr = Array.isArray(plainLines) ? plainLines : [];
    for (const line of linesArr) {
      lines.push(line);
    }
  }

  for (const t of buildChannelOptimizationSuggestions(parsedData)) {
    lines.push(t.explanation ? `${t.label}: ${t.explanation}` : t.label);
  }

  const deduped = [];
  for (const line of lines) {
    const s = line == null ? '' : String(line).trim();
    if (!s) continue;
    if (deduped.length && deduped[deduped.length - 1] === s) continue;
    deduped.push(s);
  }
  return deduped.slice(0, 60);
}

/**
 * Label for Overview fee donut / list: same as {@link feeLineDisplayLabel}, without a leading `Less:`
 * (statement wording) so POS / e‑commerce processing lines read like the channel split labels.
 * @param {object} row
 * @param {number} index
 * @param {object} parsedData
 */
export function feeLineOverviewDisplayLabel(row, index, parsedData) {
  const raw = feeLineDisplayLabel(row, index, parsedData);
  const s = String(raw ?? '').trim();
  const stripped = s.replace(/^\s*less:\s*/i, '').trim();
  return stripped || s;
}

function _feeLineRowChannelBucket(row) {
  if (!row || typeof row !== 'object') return null;
  const ch = String(row.channel ?? '').trim().toLowerCase();
  if (!ch) return null;
  if (/^(online|cnp|e-?commerce|ecom|web|digital)$/i.test(ch)) return 'ecom';
  if (/^(pos|in[- ]?person|store|retail)$/i.test(ch)) return 'pos';
  if (/\b(online|cnp|e-?commerce|ecom)\b/.test(ch)) return 'ecom';
  if (/\b(pos|in[- ]?person|card\s*present)\b/.test(ch)) return 'pos';
  return null;
}

/**
 * One donut / fee-breakdown row per **non-synthetic** `fee_lines[]` entry with a numeric amount (statement-sourced).
 * @returns {{ label: string, value: number, bucket?: 'pos'|'ecom'|'total', feeSlug?: string }[]}
 */
function buildFeeOverviewRowsFromStatementFeeLines(parsedData) {
  const lines = Array.isArray(parsedData?.fee_lines) ? parsedData.fee_lines : [];
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i];
    if (!row || typeof row !== 'object') continue;
    if (isSyntheticInterchangeSchemeProcessorFeeLine(row)) continue;
    const n = Number(feeLineRowAmount(row));
    if (!Number.isFinite(n) || !(Math.abs(n) > 0.005)) continue;
    const label = feeLineOverviewDisplayLabel(row, i, parsedData);
    const b = _feeLineRowChannelBucket(row);
    const slugOpt = String(row.fee_slug ?? row.fee_slug_key ?? '').trim();
    out.push({
      label,
      value: roundMoney2(Math.abs(n)),
      ...(b ? { bucket: b } : {}),
      ...(slugOpt ? { feeSlug: slugifyFeeScalarKey(slugOpt) } : {}),
    });
  }
  return out;
}

/** Top-level processor fee scalars when the parse has no usable itemized `fee_lines` but does name fee categories. */
const SCALAR_FEE_FIELD_KEYS = ['interchange_fees', 'scheme_fees', 'service_fees', 'other_fees'];

/**
 * Merge canonical scalar fields with **`fee_totals_by_slug`**: `{ [slug: string]: number }` (parser / template storage).
 * Slugs are normalized with {@link slugifyFeeScalarKey}. Labels: `field_labels[slug]`, `fee_slug_labels[slug]`,
 * `report_ui.fee_slug_labels[slug]`, else {@link humanizeFieldKey}(slug). Known top-level keys win over duplicate slug-map entries.
 * @returns {{ label: string, value: number, bucket: 'total', feeSlug: string }[]}
 */
function buildFeeOverviewRowsFromScalarFeeFields(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return [];
  const amountBySlug = new Map();

  for (const key of SCALAR_FEE_FIELD_KEYS) {
    const n = Number(parsedData[key]);
    if (!Number.isFinite(n) || !(Math.abs(n) > 0.005)) continue;
    amountBySlug.set(key, Math.abs(n));
  }

  const bySlug = parsedData.fee_totals_by_slug;
  if (bySlug && typeof bySlug === 'object' && !Array.isArray(bySlug)) {
    for (const [k, v] of Object.entries(bySlug)) {
      const sk = slugifyFeeScalarKey(k);
      if (!sk) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || !(Math.abs(n) > 0.005)) continue;
      if (SCALAR_FEE_FIELD_KEYS.includes(sk) && amountBySlug.has(sk)) continue;
      amountBySlug.set(sk, Math.abs(n));
    }
  }

  const out = [];
  for (const key of SCALAR_FEE_FIELD_KEYS) {
    if (!amountBySlug.has(key)) continue;
    out.push({
      label: _feeScalarLabel(parsedData, key),
      value: roundMoney2(amountBySlug.get(key)),
      bucket: 'total',
      feeSlug: key,
    });
    amountBySlug.delete(key);
  }
  const restSlugs = Array.from(amountBySlug.keys()).sort((a, b) => a.localeCompare(b));
  for (const slug of restSlugs) {
    out.push({
      label: _feeScalarLabel(parsedData, slug),
      value: roundMoney2(amountBySlug.get(slug)),
      bucket: 'total',
      feeSlug: slug,
    });
  }
  return out;
}

/**
 * Parsed fee scalars for UI / chat: canonical fields plus `fee_totals_by_slug` (see {@link buildFeeOverviewRowsFromScalarFeeFields}).
 * @returns {{ slug: string, label: string, value: number }[]}
 */
export function listParsedFeeScalarEntries(parsedData) {
  return buildFeeOverviewRowsFromScalarFeeFields(parsedData).map((r) => ({
    slug: r.feeSlug,
    label: r.label,
    value: r.value,
  }));
}

/**
 * Fee donut rows for Overview / Fee Breakdown: prefer **statement itemization** — real `fee_lines` rows, else named
 * top-level fee scalars (`interchange_fees`, `scheme_fees`, `service_fees`, `other_fees`, and **`fee_totals_by_slug`**),
 * else `channel_split.*.fees`, else a single reconciled
 * **`total_fees_charged`** slice. Does **not** invent POS vs e‑com fee splits from gross mix or scale `fee_lines` to
 * match a reconciled total.
 * @returns {{ label: string, value: number, bucket?: 'pos'|'ecom'|'total', feeSlug?: string }[]}
 */
export function getFeeLineOverviewRows(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return [];

  const fromLines = buildFeeOverviewRowsFromStatementFeeLines(parsedData);
  if (fromLines.length) return fromLines;

  const fromScalars = buildFeeOverviewRowsFromScalarFeeFields(parsedData);
  if (fromScalars.length) return fromScalars;

  const { total: displayTotal } = reconcileTotalFeesCharged(parsedData);
  const chRowsFirst = buildPosEcomCashFeeOverviewRowsFromChannelSplit(parsedData);
  if (chRowsFirst.length && displayTotal > 0.005) {
    return chRowsFirst.map((r) => ({ ...r, value: roundMoney2(r.value) }));
  }

  if (displayTotal > 0.005) {
    return [{ label: _parserFieldLabel(parsedData, 'total_fees_charged'), value: roundMoney2(displayTotal), bucket: 'total' }];
  }
  return [];
}

const CHANNEL_BAR_COLORS = ['#0F1B2D', '#00A88A', '#B8770B', '#8B94A3', '#B03A2E', '#5B6B7F'];

/** Pick refund dollars from common parser shapes (top-level or nested extract). */
function _pickRefundVolumeForOverview(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  const paths = [
    parsedData.refund_volume,
    parsedData.raw_extracted?.refund_volume,
    parsedData.raw_extracted_preview?.refund_volume,
    parsedData.extracted?.refund_volume,
    parsedData.total_refunds,
  ];
  for (const p of paths) {
    const v = Math.abs(Number(p) || 0);
    if (v > 0.01) return _dispRound2(v);
  }
  return null;
}

/**
 * Cash dollars from top-level parser fields when `channel_split.cash` is missing.
 * Uses **first trustworthy path** (authoritative order), not max — max picked duplicate/larger staging fields.
 */
function _pickCashVolumeScalars(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  const paths = [
    parsedData.square_pos_daily_cash_sales_sum,
    parsedData.cash_sales,
    parsedData.cash_sales_volume,
    parsedData.cash_volume,
    parsedData.raw_extracted?.cash_sales,
    parsedData.raw_extracted?.cash_sales_volume,
    parsedData.raw_extracted?.cash_volume,
    parsedData.raw_extracted_preview?.cash_volume,
    parsedData.extracted?.cash_volume,
  ];
  for (const p of paths) {
    const v = Number(p);
    if (Number.isFinite(v) && v > 0.01) return Math.round(v * 100) / 100;
  }
  return null;
}

/** Overview volume bar order: refunds, cash, e‑commerce, POS, then any other segments (stable colors). */
function _reorderOverviewVolumeBars(bars, parsedData) {
  if (!Array.isArray(bars) || bars.length <= 1) return bars;
  const L = channelBucketDisplayLabels(parsedData);
  const refundLab = _parserFieldLabel(parsedData, 'refund_volume');
  const isRefund = (b) => String(b?.label) === refundLab;
  const isCash = (b) => b?.label === L.cash;
  const isEcom = (b) => b?.label === L.ecom || String(b?.label ?? '').startsWith(`${L.ecom} ·`);
  const isPos = (b) => b?.label === L.pos || String(b?.label ?? '').startsWith(`${L.pos} ·`);
  const refund = bars.filter(isRefund);
  const cash = bars.filter(isCash);
  const ecom = bars.filter(isEcom);
  const pos = bars.filter(isPos);
  const rest = bars.filter((b) => !isRefund(b) && !isCash(b) && !isEcom(b) && !isPos(b));
  return [...refund, ...cash, ...ecom, ...pos, ...rest];
}

/**
 * Volume bars for overview: **POS**, **E-commerce**, and **Cash** sales (merged from `channel_split` rows),
 * then top-level `pos_volume` / `ecomm_volume` / `cash_volume` if split is empty, then `refund_volume`.
 * When `opts.statementCategory === 'pos'`, adds a **POS-only file** bar from `total_transaction_volume` (or `pos_volume`)
 * if nothing else produced bars so a single POS upload still shows volume on Overview.
 * @param {object} parsedData
 * @param {{ statementCategory?: string }} [opts]
 * @returns {{ label: string, value: number, color: string }[]}
 */
export function getChannelVolumeBarsFromParsed(parsedData, opts = {}) {
  if (!parsedData || typeof parsedData !== 'object') return [];
  const out = [];
  let ci = 0;
  const split = parsedData.channel_split;
  const L = channelBucketDisplayLabels(parsedData);
  if (split && typeof split === 'object' && !Array.isArray(split)) {
    const agg = _aggregatePosEcomCashBuckets(parsedData);
    if (agg) {
      const segments = [
        { label: L.pos, value: agg.pos.gross },
        { label: L.ecom, value: agg.ecom.gross },
        { label: L.cash, value: agg.cash.gross },
      ];
      for (const s of segments) {
        if (!(Number(s.value) > 0.01)) continue;
        out.push({
          label: s.label,
          value: Number(s.value) || 0,
          color: CHANNEL_BAR_COLORS[ci++ % CHANNEL_BAR_COLORS.length],
        });
      }
    }
    const cvScalar = _pickCashVolumeScalars(parsedData);
    const cashBarPresent = out.some((r) => r.label === L.cash);
    if (
      !cashBarPresent &&
      agg &&
      !(agg.cash.gross > 0.01) &&
      cvScalar != null &&
      cvScalar > 0.01
    ) {
      out.push({
        label: L.cash,
        value: cvScalar,
        color: CHANNEL_BAR_COLORS[ci++ % CHANNEL_BAR_COLORS.length],
      });
    }
  }
  if (!out.length) {
    const pv = Number(parsedData.pos_volume);
    const ev = Number(parsedData.ecomm_volume);
    const cv = _pickCashVolumeScalars(parsedData);
    if (Number.isFinite(pv) && pv > 0.01) {
      out.push({
        label: _parserFieldLabel(parsedData, 'pos_volume'),
        value: pv,
        color: CHANNEL_BAR_COLORS[ci++ % CHANNEL_BAR_COLORS.length],
      });
    }
    if (Number.isFinite(ev) && ev > 0.01) {
      out.push({
        label: _parserFieldLabel(parsedData, 'ecomm_volume'),
        value: ev,
        color: CHANNEL_BAR_COLORS[ci++ % CHANNEL_BAR_COLORS.length],
      });
    }
    if (cv != null && cv > 0.01) {
      out.push({
        label: L.cash,
        value: cv,
        color: CHANNEL_BAR_COLORS[ci++ % CHANNEL_BAR_COLORS.length],
      });
    }
  }
  if (
    !out.length &&
    opts.statementCategory === 'pos' &&
    parsedData &&
    typeof parsedData === 'object'
  ) {
    const gv = overviewPrimarySalesVolumeGross(parsedData);
    const pv = Number(parsedData.pos_volume);
    const L = channelBucketDisplayLabels(parsedData);
    if (Number.isFinite(gv) && gv > 0.01) {
      out.push({
        label: `${L.pos} · ${humanizeFieldKey('total_transaction_volume')}`,
        value: gv,
        color: CHANNEL_BAR_COLORS[ci++ % CHANNEL_BAR_COLORS.length],
      });
    } else if (Number.isFinite(pv) && pv > 0.01) {
      out.push({
        label: L.pos,
        value: pv,
        color: CHANNEL_BAR_COLORS[ci++ % CHANNEL_BAR_COLORS.length],
      });
    }
  }
  const revBars = buildRevenueByChannelTable(parsedData);
  if (revBars?.rows?.length && out.length) {
    const posR = revBars.rows.find((r) => r.key === 'pos');
    const ecomR = revBars.rows.find((r) => r.key === 'ecom');
    const refundLab = _parserFieldLabel(parsedData, 'refund_volume');
    for (let i = 0; i < out.length; i++) {
      const b = out[i];
      if (b.label === refundLab) continue;
      const lab = String(b.label ?? '');
      if (posR && Number(posR.gross) > 0.005 && (lab === L.pos || lab.startsWith(`${L.pos} ·`))) {
        out[i] = { ...b, value: Math.round(Number(posR.gross) * 100) / 100 };
      }
      if (ecomR && Number(ecomR.gross) > 0.005 && (lab === L.ecom || lab.startsWith(`${L.ecom} ·`))) {
        out[i] = { ...b, value: Math.round(Number(ecomR.gross) * 100) / 100 };
      }
    }
  }
  const refundV = _pickRefundVolumeForOverview(parsedData);
  if (refundV != null && refundV > 0.01) {
    out.push({
      label: _parserFieldLabel(parsedData, 'refund_volume'),
      value: refundV,
      color: CHANNEL_BAR_COLORS[ci++ % CHANNEL_BAR_COLORS.length],
    });
  }
  return _reorderOverviewVolumeBars(out, parsedData);
}

/**
 * Card brand rows from parser (`card_brand_mix`) or nested preview (some sessions only stored preview).
 * @returns {unknown[] | null}
 */
export function getCardBrandMixFromParsed(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  const candidates = [
    parsedData.card_brand_mix,
    parsedData.raw_extracted_preview?.card_brand_mix,
    parsedData.raw_extracted?.card_brand_mix,
  ];
  for (const top of candidates) {
    if (Array.isArray(top) && top.length > 0) {
      const sane = sanitizeCardBrandMixRows(top);
      if (sane && sane.length) return sane;
    }
  }
  return null;
}

/**
 * Channel tab: only these `parse_issues` trigger applying `resolved_transaction_counts` for display.
 * (Other codes, e.g. `transaction_count_inconsistent`, do not force per-channel hiding by themselves.)
 */
export const TX_COUNT_FORCED_CHANNEL_TXN_RESOLUTION = new Set([
  'transaction_count_duplicate_channels',
  'transaction_count_exceeds_total',
]);

function _niNonnegCh(x) {
  if (x == null || x === '') return null;
  const n = Math.round(Number(x));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Best-effort **statement** transaction count for Dashboard / Report Overview.
 * Prefers `total_transactions`, else POS + e‑commerce scalars (`pos_transaction_count`, `channel_split.*.txn_count`, …),
 * else sum of non-cash `channel_split` `txn_count`, else longest POS / e‑commerce line-array lengths (combined when both exist).
 *
 * @param {object|null} parsed
 * @returns {number|null}
 */
export function overviewStatementTransactionCount(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const total = _niNonnegCh(parsed.total_transactions);
  if (total != null && total > 0) return total;

  const posScalar =
    _niNonnegCh(parsed.pos_transaction_count) ??
    _niNonnegCh(Array.isArray(parsed.pos_transactions) ? null : parsed.pos_transactions) ??
    _niNonnegCh(parsed.channel_split?.pos?.txn_count);
  const ecScalar =
    _niNonnegCh(parsed.ecomm_transaction_count) ??
    _niNonnegCh(Array.isArray(parsed.ecommerce_transactions) ? null : parsed.ecommerce_transactions) ??
    _niNonnegCh(parsed.channel_split?.cnp?.txn_count);

  if (posScalar != null && ecScalar != null) return posScalar + ecScalar;
  if (posScalar != null) return posScalar;
  if (ecScalar != null) return ecScalar;

  const cs = parsed.channel_split;
  if (cs && typeof cs === 'object' && !Array.isArray(cs)) {
    let sum = 0;
    let any = false;
    for (const key of Object.keys(cs)) {
      const row = cs[key];
      if (!row || typeof row !== 'object') continue;
      if (resolveChannelSplitBucket(key, row) === 'cash') continue;
      const n = _niNonnegCh(row.txn_count);
      if (n != null && n > 0) {
        sum += n;
        any = true;
      }
    }
    if (any && sum > 0) return sum;
  }

  const posArrMax = _overviewMaxTxnArrayLen([
    parsed.pos_transactions,
    parsed.pos_transaction_details,
    parsed.pos_settlement_transactions,
    parsed.card_present_transactions,
    parsed.in_store_transactions,
    parsed.batch_transactions,
    parsed.transactions,
    parsed.raw_extracted?.pos_transactions,
    parsed.raw_extracted?.pos_transaction_details,
    parsed.raw_extracted?.transactions,
    parsed.raw_extracted_preview?.pos_transactions,
    parsed.raw_extracted_preview?.pos_transaction_details,
    parsed.raw_extracted_preview?.transactions,
    parsed.extracted?.pos_transactions,
    parsed.extracted?.pos_transaction_details,
    parsed.extracted?.transactions,
  ]);
  const ecArrMax = _overviewMaxTxnArrayLen([
    parsed.ecomm_settlement_orders,
    parsed.ecommerce_settlement_orders,
    parsed.shopify_orders,
    parsed.ecomm_orders,
    parsed.ecommerce_orders,
    parsed.raw_extracted?.ecomm_settlement_orders,
    parsed.raw_extracted?.ecommerce_orders,
    parsed.extracted?.ecomm_settlement_orders,
    parsed.extracted?.ecommerce_orders,
  ]);

  if (posArrMax != null && ecArrMax != null) return posArrMax + ecArrMax;
  if (posArrMax != null) return posArrMax;
  if (ecArrMax != null) return ecArrMax;

  return null;
}

function _overviewMaxTxnArrayLen(lists) {
  let n = 0;
  if (!Array.isArray(lists)) return null;
  for (const L of lists) {
    if (Array.isArray(L) && L.length > n) n = L.length;
  }
  return n >= 1 ? n : null;
}

function _txnBudgetForTotal(total) {
  if (total == null || total <= 0) return 0;
  return Math.max(0, Math.min(3, Math.floor(0.02 * total)));
}

/**
 * True only for impossible / duplicate-all-equal patterns (matches backend `validate_transaction_counts`
 * duplicate + exceeds branches). Does **not** flag normal splits like 20 + 11 = 31.
 */
export function strictChannelTxnDuplicateOrExceedsTotal(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  const total = _niNonnegCh(parsed.total_transactions);
  const pos =
    _niNonnegCh(parsed.pos_transaction_count) ??
    _niNonnegCh(parsed.pos_transactions) ??
    _niNonnegCh(parsed.channel_split?.pos?.txn_count);
  const ec =
    _niNonnegCh(parsed.ecomm_transaction_count) ??
    _niNonnegCh(parsed.ecommerce_transactions) ??
    _niNonnegCh(parsed.channel_split?.cnp?.txn_count);
  if (total == null || !(total > 0)) return false;
  if (pos == null || ec == null) return false;
  const b = _txnBudgetForTotal(total);
  if (pos + ec > total + b) return true;
  if (pos > 0 && ec > 0 && pos === ec && pos === total) return true;
  return false;
}

/**
 * True when summed card-mix row volumes match **POS + CNP** gross (whole-statement mix table).
 * In that shape, txn counts in the mix are not attributable to a single channel — do not force "—/—".
 */
export function cardMixVolumeMatchesPosPlusCnpGross(parsed, posGrossVol, cnpGrossVol) {
  const rows = getCardBrandMixFromParsed(parsed);
  if (!Array.isArray(rows) || rows.length < 2) return false;
  let mixVol = 0;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const vr = cardMixRowVolume(r, parsed);
    if (vr != null && Number.isFinite(Number(vr)) && Number(vr) > 0) mixVol += Number(vr);
  }
  const posG = Number(posGrossVol) || 0;
  const cnpG = Number(cnpGrossVol) || 0;
  const combined = posG + cnpG;
  if (mixVol <= 0 || posG <= 0.005 || cnpG <= 0.005 || combined <= 0) return false;
  const tol = Math.max(5, 0.02 * Math.max(mixVol, combined, 1));
  return Math.abs(mixVol - combined) <= tol;
}

/** True when POS + online counts already reconcile to the statement total (no card-mix override needed). */
function channelTxnCountsAlreadyConsistentWithTotal(parsed) {
  const total = _niNonnegCh(parsed?.total_transactions);
  if (total == null || total <= 0) return false;
  const pos =
    _niNonnegCh(parsed?.pos_transaction_count) ??
    _niNonnegCh(parsed?.pos_transactions) ??
    _niNonnegCh(parsed?.channel_split?.pos?.txn_count);
  const ec =
    _niNonnegCh(parsed?.ecomm_transaction_count) ??
    _niNonnegCh(parsed?.ecommerce_transactions) ??
    _niNonnegCh(parsed?.channel_split?.cnp?.txn_count);
  if (pos == null || ec == null) return false;
  const b = _txnBudgetForTotal(total);
  const s = pos + ec;
  return s >= total - b && s <= total + b;
}

/** Client-only display split when API omitted `resolved_transaction_counts` (card-mix volume vs channels). */
/** @returns {object | null} `null` = skip override (e.g. whole-statement mix); unresolved object = hide both when forced */
export function resolveTransactionCountsClientSide(parsed, posGrossVol, cnpGrossVol) {
  if (channelTxnCountsAlreadyConsistentWithTotal(parsed)) return null;
  const total = _niNonnegCh(parsed?.total_transactions);
  const rows = getCardBrandMixFromParsed(parsed);
  const unresolved = () => ({
    pos: null,
    ecommerce: null,
    total,
    source: 'unresolved',
    confidence: 'low',
  });

  if (!Array.isArray(rows) || rows.length < 2) return null;

  let mixVol = 0;
  let mixTx = 0;
  let txSeen = false;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const vr = cardMixRowVolume(r, parsed);
    if (vr != null && Number.isFinite(Number(vr)) && Number(vr) > 0) mixVol += Number(vr);
    const tv = r.transactions;
    if (tv != null && String(tv).trim() !== '' && !Number.isNaN(Number(tv))) {
      mixTx += Math.round(Number(tv));
      txSeen = true;
    }
  }

  if (mixVol <= 0 || !txSeen || mixTx <= 0) return null;

  const posG = Number(posGrossVol) || 0;
  const cnpG = Number(cnpGrossVol) || 0;
  if (cardMixVolumeMatchesPosPlusCnpGross(parsed, posGrossVol, cnpGrossVol)) {
    return null;
  }

  const tol = Math.max(5, 0.02 * Math.max(mixVol, posG, cnpG, 1));

  if (Math.abs(mixVol - cnpG) <= tol) {
    return { pos: null, ecommerce: mixTx, total, source: 'card_brand_mix', confidence: 'high' };
  }
  if (Math.abs(mixVol - posG) <= tol) {
    return { pos: mixTx, ecommerce: null, total, source: 'card_brand_mix', confidence: 'high' };
  }
  return unresolved();
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function triggerPrint() {
  window.print();
}

// ── Statement settlement layers (POS / e-commerce / bank / reconciliation) ──

const SETTLEMENT_LAYER_EPS = 0.005;

function settlementLayerNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * True when the parse clearly carries **POS / in-store** sales signals beyond an empty `channel_split.pos` row.
 * Used so single POS uploads still get a POS settlement layer and overview volume bar when the processor omits split.
 * @param {object} parsedData
 */
export function parsedDataHasPosSalesBeyondChannelSplit(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return false;
  const n = settlementLayerNum;
  if (n(parsedData.pos_volume) > SETTLEMENT_LAYER_EPS) return true;
  if (n(parsedData.pos_net_deposit_volume) > SETTLEMENT_LAYER_EPS) return true;
  const batches = parsedData.pos_settlement_batches;
  if (Array.isArray(batches) && batches.length >= 1) return true;
  const lists = [
    parsedData.pos_transactions,
    parsedData.pos_transaction_details,
    parsedData.raw_extracted?.pos_transactions,
    parsedData.extracted?.pos_transactions,
  ];
  for (const L of lists) {
    if (Array.isArray(L) && L.length >= 2) return true;
  }
  return false;
}

function inferStatementSettlementLayers(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return [];
  const out = [];
  const cs = parsedData.channel_split;
  const L = channelBucketDisplayLabels(parsedData);
  const posNet = settlementLayerNum(parsedData.pos_net_deposit_volume);
  const ecNet = settlementLayerNum(parsedData.ecomm_net_deposit_volume);
  const posVol = settlementLayerNum(cs?.pos?.volume) + settlementLayerNum(cs?.pos?.net_settled_volume);
  const cnpVol = settlementLayerNum(cs?.cnp?.volume) + settlementLayerNum(cs?.cnp?.net_settled_volume);

  if (
    posVol > SETTLEMENT_LAYER_EPS ||
    posNet > SETTLEMENT_LAYER_EPS ||
    parsedDataHasPosSalesBeyondChannelSplit(parsedData)
  ) {
    out.push({ key: 'pos', label: L.pos });
  }
  if (cnpVol > SETTLEMENT_LAYER_EPS || ecNet > SETTLEMENT_LAYER_EPS) {
    out.push({ key: 'ecommerce', label: L.ecom });
  }
  const bank = settlementLayerNum(parsedData.bank_credits_total_verified);
  if (bank > SETTLEMENT_LAYER_EPS) {
    out.push({ key: 'bank', label: _parserFieldLabel(parsedData, 'bank_credits_total_verified') });
  }
  const recon = settlementLayerNum(parsedData.reconciliation_total_deposits);
  if (recon > SETTLEMENT_LAYER_EPS) {
    out.push({ key: 'reconciliation', label: _parserFieldLabel(parsedData, 'reconciliation_total_deposits') });
  }

  const seen = new Set();
  return out.filter((x) => {
    if (seen.has(x.key)) return false;
    seen.add(x.key);
    return true;
  });
}

/**
 * Prefer tab names from a multi-sheet workbook when present; otherwise use parsed inference.
 * @param {object} parsedData
 * @returns {{ source: 'file' | 'parsed', roles: { name: string, role: string }[] }}
 */
export function settlementDisplayRoles(parsedData) {
  const fromFile = Array.isArray(parsedData?.workbook_sheet_roles) ? parsedData.workbook_sheet_roles : null;
  if (fromFile?.length) {
    return {
      source: 'file',
      roles: fromFile.map((r) => ({ name: r.name, role: r.role })),
    };
  }
  const inferred = inferStatementSettlementLayers(parsedData);
  return {
    source: 'parsed',
    roles: inferred.map((r) => ({ name: r.label, role: r.key })),
  };
}

/** Tabular uploads where we can scan for daily POS batch tables (SheetJS). PDF is parsed only via the Python service — no augment here. */
export function isTabularStatementFileName(fileName) {
  return /\.(xlsx|xls|xlsm|csv)$/i.test(String(fileName || ''));
}

function _sentenceWorkbookTab(tabName, role) {
  return `${tabName} · ${humanizeFieldKey(role)}`;
}

function _sentenceInferredLayer(role, displayName) {
  const n = displayName || role;
  return `${humanizeFieldKey(role)}: ${n}`;
}

/**
 * One-line summary of gross sales by POS / e-commerce / cash after parse (cash omitted when absent).
 */
function _parsedChannelMixSummaryLine(parsedData) {
  const agg = _aggregatePosEcomCashBuckets(parsedData);
  if (!agg) return '';
  const L = channelBucketDisplayLabels(parsedData);
  const ccy = getStatementDisplayCurrency(parsedData);
  const parts = [];
  if (agg.pos.gross > 0.005) parts.push(`${L.pos} ${formatMoney(agg.pos.gross, ccy)}`);
  if (agg.ecom.gross > 0.005) parts.push(`${L.ecom} ${formatMoney(agg.ecom.gross, ccy)}`);
  if (agg.cash.gross > 0.005) parts.push(`${L.cash} ${formatMoney(agg.cash.gross, ccy)}`);
  if (!parts.length) return '';
  return `${_parserFieldLabel(parsedData, 'gross_volume')}: ${parts.join(' · ')}`;
}

/**
 * Human copy for upload shape: multi-tab workbook vs single sheet/PDF, plus per-layer sentences.
 * @param {object|null|undefined} parsedData
 * @param {{ fileType?: string|null, fileName?: string }} [opts]
 */
export function getStatementStructureNarrative(parsedData, opts = {}) {
  const fileName = opts.fileName ?? '';
  const ft = normalizeStatementFileType(opts.fileType ?? parsedData?.file_type, fileName, '');
  const parsedAsLabel = (ft && ft !== 'unknown' ? humanizeFieldKey(ft) : '') || 'Unknown format';

  if (!parsedData || typeof parsedData !== 'object') {
    return {
      layoutKind: 'single_document',
      headline: '',
      perLayer: [],
      parsedAsLabel,
    };
  }

  const sheets = Array.isArray(parsedData.workbook_sheet_roles) ? parsedData.workbook_sheet_roles : [];
  const meta = settlementDisplayRoles(parsedData);
  const isTabularKind = ['xlsx', 'xls', 'csv', 'xlsm'].includes(ft);

  const rui =
    parsedData?.report_ui && typeof parsedData.report_ui === 'object' && !Array.isArray(parsedData.report_ui)
      ? parsedData.report_ui
      : null;
  const pickHead = (fb) => (typeof rui?.structure_headline === 'string' && rui.structure_headline.trim() ? rui.structure_headline.trim() : fb);

  let layoutKind = 'single_document';
  let headline = '';

  if (sheets.length >= 2) {
    layoutKind = 'multi_workbook';
    const names = sheets.map((s) => s.name).filter(Boolean);
    headline = pickHead(`${humanizeFieldKey('workbook_sheet_roles')}: ${sheets.length} · ${names.join('; ')}`);
  } else if (isTabularKind && sheets.length === 1) {
    layoutKind = 'single_tabular';
    headline = pickHead(`${humanizeFieldKey('file_type')}: ${parsedAsLabel} · ${humanizeFieldKey('workbook_sheet_roles')}: 1`);
  } else if (isTabularKind && sheets.length === 0) {
    layoutKind = 'single_tabular';
    headline = pickHead(`${humanizeFieldKey('file_type')}: ${parsedAsLabel} · ${humanizeFieldKey('workbook_sheet_roles')}: 0`);
  } else {
    headline = pickHead(`${humanizeFieldKey('file_type')}: ${parsedAsLabel}`);
  }

  const perLayer = [];
  if (meta.source === 'file' && sheets.length) {
    for (const row of sheets) {
      perLayer.push({
        role: row.role,
        label: row.name,
        text: _sentenceWorkbookTab(row.name, row.role),
      });
    }
  } else {
    for (const r of meta.roles) {
      perLayer.push({
        role: r.role,
        label: r.name,
        text: _sentenceInferredLayer(r.role, r.name),
      });
    }
  }

  const mixLine = _parsedChannelMixSummaryLine(parsedData);
  if (mixLine) {
    perLayer.push({
      role: 'other',
      label: _parserFieldLabel(parsedData, 'channel_split'),
      text: mixLine,
    });
  }

  const ecm = parsedData.ecomm_workbook_column_mapping;
  if (ecm && typeof ecm === 'object' && !Array.isArray(ecm)) {
    const u = ecm.columns_used;
    const bits = [];
    if (u?.order?.header) bits.push(`${humanizeFieldKey('order')}: "${u.order.header}"`);
    if (u?.gross?.header) bits.push(`${humanizeFieldKey('gross_sales')}: "${u.gross.header}"`);
    if (u?.fee?.header) bits.push(`${humanizeFieldKey('fees')}: "${u.fee.header}"`);
    if (u?.net?.header) bits.push(`net: "${u.net.header}"`);
    if (bits.length) {
      const sn = typeof ecm.sheet_name === 'string' && ecm.sheet_name.trim() ? ` · ${ecm.sheet_name.trim()}` : '';
      const extra =
        Array.isArray(ecm.unmapped_columns) && ecm.unmapped_columns.length
          ? ` (${ecm.unmapped_columns.length} other column${ecm.unmapped_columns.length === 1 ? '' : 's'} not required for this grid).`
          : '';
      perLayer.push({
        role: 'ecommerce',
        label: 'Workbook order columns',
        text: `Mapped headers from the order export${sn}: ${bits.join('; ')}.${extra}`,
      });
    }
  }

  return { layoutKind, headline, perLayer, parsedAsLabel };
}

/**
 * Upload success blurb: **from parsed data** — uses the same layer detection as the report
 * (`inferStatementSettlementLayers`: channel_split, nets, bank credits, reconciliation totals),
 * plus `reconciliation_variance` and fee-line channels when volumes are thin.
 * Two or more layers → **Combined file — …** listing what was found (not tab names).
 * @param {object|null|undefined} parsedData
 * @param {string} [fileName]
 * @returns {string}
 */
export function getUploadFileKindDescription(parsedData, fileName = '') {
  const stem = String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[-]+/g, '_')
    .trim();
  if (!parsedData || typeof parsedData !== 'object') {
    return stem ? humanizeFieldKey(stem) : humanizeFieldKey('upload');
  }

  const sheetRoles = Array.isArray(parsedData.workbook_sheet_roles) ? parsedData.workbook_sheet_roles : [];
  const nSheets = sheetRoles.length;
  const sheetSuffix = nSheets >= 2 ? ` · ${humanizeFieldKey('workbook_sheet_roles')}: ${nSheets}` : '';

  const inferred = inferStatementSettlementLayers(parsedData);
  const keys = new Set(inferred.map((x) => x.key));
  const labelByKey = Object.fromEntries(inferred.map((x) => [x.key, x.label]));

  if (!keys.has('reconciliation')) {
    const rv = parsedData.reconciliation_variance;
    if (rv != null && rv !== '' && Math.abs(settlementLayerNum(rv)) > SETTLEMENT_LAYER_EPS) {
      keys.add('reconciliation');
    }
  }

  let feePosHints = 0;
  let feeEcHints = 0;
  if (Array.isArray(parsedData.fee_lines)) {
    for (const line of parsedData.fee_lines) {
      const ch = String(line?.channel || '').toLowerCase();
      if (!ch) continue;
      if (/\b(online|cnp|e-?com|web)\b/i.test(ch) || ch.includes('online')) feeEcHints += 1;
      else if (/\bpos\b/i.test(ch) || ch.includes('in-store') || ch.includes('card present')) feePosHints += 1;
    }
  }
  if (!keys.has('pos') && feePosHints > 0 && feePosHints >= feeEcHints + 1) keys.add('pos');
  if (!keys.has('ecommerce') && feeEcHints > 0 && feeEcHints >= feePosHints + 1) keys.add('ecommerce');

  const ORDER = ['pos', 'ecommerce', 'bank', 'reconciliation'];
  const present = ORDER.filter((k) => keys.has(k));

  const core =
    present.length === 0
      ? stem
        ? humanizeFieldKey(stem)
        : humanizeFieldKey('statement')
      : present.length === 1
        ? labelByKey[present[0]] || humanizeFieldKey(present[0])
        : present.map((k) => labelByKey[k] || humanizeFieldKey(k)).join(' + ');

  return `${core}${sheetSuffix}`;
}

/**
 * Expected deposits: POS + e‑commerce Net Bank from {@link getChannelNetBankPairForReconciliation} when present;
 * else top-level processor nets, then `reconciliation_total_deposits`.
 * @param {object} parsedData
 * @param {{ pos: number, ecom: number, sum: number } | null | undefined} [channelNetBankPair] pass when you already called {@link getChannelNetBankPairForReconciliation}
 */
export function getReconciliationExpectedDeposits(parsedData, channelNetBankPair) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  const pair =
    channelNetBankPair !== undefined
      ? channelNetBankPair
      : getChannelNetBankPairForReconciliation(parsedData);
  if (pair != null && pair.sum > _RECON_DIFF_EPS) return pair.sum;
  const posNet = _dispNum(parsedData.pos_net_deposit_volume);
  const ecNet = _dispNum(parsedData.ecomm_net_deposit_volume ?? parsedData.ecommerce_net_deposit);
  const sum = _dispRound2(posNet + ecNet);
  if (sum > _RECON_DIFF_EPS) return sum;
  const rt = _dispNum(parsedData.reconciliation_total_deposits);
  if (rt > _RECON_DIFF_EPS) return _dispRound2(rt);
  return null;
}

/**
 * Bank recon difference: **`getReconciliationExpectedDeposits` − `bank_credits_total_verified`** when both exist.
 * @param {object} parsedData
 * @returns {number | null}
 */
export function computeReconciliationDifferenceValue(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;
  const expected = getReconciliationExpectedDeposits(parsedData);
  const bankOpt = _optionalFiniteNum(parsedData.bank_credits_total_verified);
  const varOpt = _optionalFiniteNum(parsedData.reconciliation_variance);

  if (expected != null && expected > _RECON_DIFF_EPS && bankOpt != null && bankOpt > _RECON_DIFF_EPS) {
    const r = _dispRound2(expected - bankOpt);
    return Math.abs(r) <= _RECON_DIFF_EPS ? 0 : r;
  }
  if (varOpt != null) {
    const r = _dispRound2(varOpt);
    return Math.abs(r) <= _RECON_DIFF_EPS ? 0 : r;
  }
  return null;
}
