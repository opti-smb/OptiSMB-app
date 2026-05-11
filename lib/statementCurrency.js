/**
 * Statement display currency detection.
 *
 * Precedence:
 * 1. Parser-declared ISO fields (`display_currency` → `statement_currency` → `currency`, then `_currency_hint`)
 * 2. `original_currency` when it is a valid ISO code (legacy / FX payloads)
 * 3. Evidence from statement text and tables: currency symbols, ISO words (EUR, INR, …), India regulatory
 *    cues (GSTIN, IFSC, NPCI, UPI), and `volume_inr` on card-mix rows
 * 4. Fallback USD
 *
 * Amounts are never converted — this only picks which symbol Intl uses in the UI.
 */

const NON_ISO_CURRENCY = new Set(['', 'AUTO', 'DETECT', 'UNKNOWN', 'XXX', 'UNK']);

/** True when the parser field is missing, AUTO, or not a 3-letter ISO code. */
export function isPlaceholderWireCurrency(wire) {
  const w = String(wire ?? '')
    .trim()
    .toUpperCase();
  return !w || NON_ISO_CURRENCY.has(w) || w.length !== 3 || !/^[A-Z]{3}$/.test(w);
}

function intlCurrencyOk(code) {
  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Normalize to a valid ISO code for Intl; invalid → USD. */
export function resolveStatementCurrency(currency) {
  let ccy = String(currency ?? 'USD')
    .toUpperCase()
    .trim();
  if (!ccy || NON_ISO_CURRENCY.has(ccy) || ccy.length !== 3) {
    ccy = 'USD';
  }
  return intlCurrencyOk(ccy) ? ccy : 'USD';
}

function getDeclaredStatementCurrencyIso(parsed) {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const wire = parsed.display_currency ?? parsed.statement_currency ?? parsed.currency;
  if (!isPlaceholderWireCurrency(wire)) {
    return resolveStatementCurrency(wire);
  }
  const hint = parsed.raw_extracted_preview?._currency_hint ?? parsed.raw_extracted?._currency_hint;
  const h = String(hint ?? '')
    .trim()
    .toUpperCase();
  if (!isPlaceholderWireCurrency(h)) {
    return resolveStatementCurrency(h);
  }
  return undefined;
}

function _volumeInrPositive(v) {
  if (v == null || v === '') return false;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0;
}

function parsedCardMixUsesInrVolumes(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  const check = (rows) =>
    Array.isArray(rows) &&
    rows.some((r) => r && r.volume_inr != null && _volumeInrPositive(r.volume_inr));
  return (
    check(parsed.card_brand_mix) ||
    check(parsed.card_product_mix) ||
    check(parsed.raw_extracted_preview?.card_brand_mix) ||
    check(parsed.raw_extracted_preview?.card_product_mix) ||
    check(parsed.raw_extracted?.card_brand_mix) ||
    check(parsed.raw_extracted?.card_product_mix)
  );
}

function buildStatementCurrencyBlob(parsed) {
  if (!parsed || typeof parsed !== 'object') return '';
  const bits = [
    parsed.acquirer_name,
    parsed.bank_name,
    parsed.notes,
    parsed.fx_note,
  ];
  if (Array.isArray(parsed.fee_lines)) {
    for (const f of parsed.fee_lines.slice(0, 200)) {
      if (f && typeof f === 'object') {
        bits.push(f.type, f.card_type, f.channel, f.rate);
      }
    }
  }
  try {
    bits.push(JSON.stringify(parsed.raw_extracted_preview || {}));
  } catch {
    bits.push('');
  }
  try {
    bits.push(JSON.stringify(parsed.raw_extracted || {}));
  } catch {
    bits.push('');
  }
  if (Array.isArray(parsed.card_brand_mix) && parsed.card_brand_mix.length) {
    try {
      bits.push(JSON.stringify(parsed.card_brand_mix));
    } catch {
      bits.push('');
    }
  }
  const nestedMix =
    parsed.raw_extracted_preview?.card_brand_mix ||
    parsed.raw_extracted?.card_brand_mix;
  if (Array.isArray(nestedMix) && nestedMix.length && nestedMix !== parsed.card_brand_mix) {
    try {
      bits.push(JSON.stringify(nestedMix));
    } catch {
      bits.push('');
    }
  }
  return bits.filter(Boolean).join(' ');
}

function tryIsoFromOriginal(parsed) {
  const oc = String(parsed.original_currency || '')
    .trim()
    .toUpperCase();
  if (oc.length !== 3 || !/^[A-Z]{3}$/.test(oc) || NON_ISO_CURRENCY.has(oc)) return undefined;
  return intlCurrencyOk(oc) ? oc : undefined;
}

/**
 * When the parser did not emit a usable declared code, infer currency from statement-shaped evidence.
 * @returns {string|undefined} ISO code or undefined so caller can fall back.
 */
export function inferStatementCurrencyFromParsed(parsed) {
  if (!parsed || typeof parsed !== 'object') return undefined;

  const orig = tryIsoFromOriginal(parsed);
  if (orig) return orig;

  if (parsedCardMixUsesInrVolumes(parsed)) return 'INR';

  const s = buildStatementCurrencyBlob(parsed);
  if (!s) return undefined;

  // Symbols and words — order specific currencies before generic USD.
  if (/£|\b(gbp|sterling|pounds?\s*sterling)\b/i.test(s)) return 'GBP';
  if (/\u20ac|\b(eur|euros?)\b/i.test(s)) return 'EUR';
  if (/₹|\u20b9|\b(inr|indian\s*rupees?|rs\.)\b/i.test(s)) return 'INR';
  if (/\bvolume_inr\b|gross\s+sales\s+volume\s*inr\b|\(\s*inr\s*\)/i.test(s)) return 'INR';
  if (/\b(gstin|gst\s*no|ifsc|npci|upi\s*(id|ref)?)\b/i.test(s)) return 'INR';
  if (/\b(cad|canadian\s*dollars?)\b/i.test(s)) return 'CAD';
  if (/\b(aud|australian\s*dollars?)\b/i.test(s)) return 'AUD';
  if (/\b(chf|swiss\s*francs?)\b/i.test(s)) return 'CHF';
  if (/\b(jpy|yen|japanese\s*yen)\b/i.test(s)) return 'JPY';
  if (/\b(sgd|singapore\s*dollars?)\b/i.test(s)) return 'SGD';
  if (/\b(aed|uae\s*dirhams?)\b/i.test(s)) return 'AED';
  if (/\b(usd|u\.s\.\s*dollars?|us\s*dollars?)\b/i.test(s)) return 'USD';

  return undefined;
}

function declaredSource(parsed) {
  if (!isPlaceholderWireCurrency(parsed.display_currency)) return 'parser:display_currency';
  if (!isPlaceholderWireCurrency(parsed.statement_currency)) return 'parser:statement_currency';
  if (!isPlaceholderWireCurrency(parsed.currency)) return 'parser:currency';
  return 'parser:_currency_hint';
}

/**
 * Full detection result for UI or diagnostics (`source` explains which rule won).
 * @returns {{ code: string, source: string }}
 */
export function detectStatementCurrency(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { code: 'USD', source: 'empty_payload' };
  }
  const declared = getDeclaredStatementCurrencyIso(parsed);
  if (declared) {
    return { code: declared, source: declaredSource(parsed) };
  }
  const inferred = inferStatementCurrencyFromParsed(parsed);
  if (inferred) {
    return { code: resolveStatementCurrency(inferred), source: 'inferred:statement_evidence' };
  }
  return { code: 'USD', source: 'fallback:usd' };
}

/**
 * ISO currency for every money call: **parser fields first**, then `detectStatementCurrency`.
 */
export function getStatementDisplayCurrency(parsed) {
  const { code } = detectStatementCurrency(parsed);
  return code;
}
