/**
 * Merge three finalized parses (POS processor, e‑commerce processor, bank) into one `parsedData`
 * so Overview / Discrepancy behave like a single multi-source workbook.
 *
 * Channel rows are taken from each file with **sales-channel sanity checks** so parser stubs
 * (e.g. empty `pos` with a tiny high-fee `cash` row) do not wipe POS/CNP volumes for the combined report.
 */

import {
  channelSalesVolume,
  channelRollupVolume,
  sumChannelSplitFees,
  sumChannelSplitPlainVolumes,
  buildRevenueByChannelTable,
  feeLineRowAmount,
  slugifyCardOrKey,
  sumEcommOrderGrossBestFromParsed,
  ecommOrderExcludedFromReportedSalesTotals,
  buildReconciliationVariancePlainEnglishExplanation,
  RECONCILIATION_VARIANCE_GUIDANCE_DEFAULT,
  resolveChannelSplitBucket,
} from '@/lib/utils';
import { applyLinkedBundlePosTxnInference } from '@/lib/currencyConversion';
import { finalizeParsedForClient } from '@/lib/statementFinalize';
import { getPosSettlementBatchRows } from '@/lib/posBatchSettlementLag';
import { getStatementHeuristics } from '@/lib/statementHeuristics';

function cloneJson(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj && typeof obj === 'object' ? { ...obj } : obj;
  }
}

/** POS parses sometimes attach empty `bank_transactions` / bogus recon scalars; those must not mask the bank file on linked merge. */
const LINKED_STRIP_FROM_POS_BEFORE_BANK = [
  'bank_transactions',
  'bank_ledger_lines',
  'bank_statement_lines',
  'account_transactions',
  'bank_deposits',
  'deposit_transactions',
  'raw_bank_lines',
  'bank_credits_total_verified',
  'reconciliation_total_deposits',
  'reconciliation_variance',
  'reconciliation_discrepancy_lines',
];

const BANK_LEDGER_ARRAY_KEYS = [
  'bank_transactions',
  'raw_bank_lines',
  'bank_ledger_lines',
  'bank_statement_lines',
  'account_transactions',
  'bank_deposits',
  'deposit_transactions',
];

function stripLinkedPosBankNoise(posPd) {
  const o = cloneJson(posPd);
  for (const k of LINKED_STRIP_FROM_POS_BEFORE_BANK) {
    if (k in o) delete o[k];
  }
  if (o.raw_extracted && typeof o.raw_extracted === 'object' && !Array.isArray(o.raw_extracted)) {
    const rx = { ...o.raw_extracted };
    for (const k of BANK_LEDGER_ARRAY_KEYS) {
      if (k in rx) delete rx[k];
    }
    o.raw_extracted = rx;
  }
  if (o.raw_extracted_preview && typeof o.raw_extracted_preview === 'object' && !Array.isArray(o.raw_extracted_preview)) {
    const rx = { ...o.raw_extracted_preview };
    for (const k of BANK_LEDGER_ARRAY_KEYS) {
      if (k in rx) delete rx[k];
    }
    o.raw_extracted_preview = rx;
  }
  if (o.extracted && typeof o.extracted === 'object' && !Array.isArray(o.extracted)) {
    const ex = { ...o.extracted };
    for (const k of BANK_LEDGER_ARRAY_KEYS) {
      if (k in ex) delete ex[k];
    }
    o.extracted = ex;
  }
  return o;
}

/**
 * Bank file lines often live only under `raw_extracted.*`; linked merge used to keep POS `raw_extracted` only,
 * so finalize could not sum credits. Lift bank arrays to top-level (when missing) and merge into `raw_extracted` for promotion/repair.
 */
function liftBankLedgerArraysForLinkedMerge(merged, bankPd) {
  if (!merged || typeof merged !== 'object' || !bankPd || typeof bankPd !== 'object') return merged;
  const sources = [bankPd.raw_extracted, bankPd.raw_extracted_preview, bankPd.extracted].filter(
    (x) => x && typeof x === 'object' && !Array.isArray(x),
  );
  const topPatch = {};
  for (const key of BANK_LEDGER_ARRAY_KEYS) {
    const cur = merged[key];
    if (Array.isArray(cur) && cur.length > 0) continue;
    for (const src of sources) {
      const L = src[key];
      if (Array.isArray(L) && L.length > 0) {
        topPatch[key] = cloneJson(L);
        break;
      }
    }
  }
  const posRe =
    merged.raw_extracted && typeof merged.raw_extracted === 'object' && !Array.isArray(merged.raw_extracted)
      ? merged.raw_extracted
      : {};
  const rawPatch = {};
  for (const key of BANK_LEDGER_ARRAY_KEYS) {
    if (topPatch[key]) rawPatch[key] = topPatch[key];
    else {
      const curN = posRe[key];
      if (Array.isArray(curN) && curN.length > 0) continue;
      for (const src of sources) {
        const L = src[key];
        if (Array.isArray(L) && L.length > 0) {
          rawPatch[key] = cloneJson(L);
          break;
        }
      }
    }
  }
  if (!Object.keys(topPatch).length && !Object.keys(rawPatch).length) return merged;
  return {
    ...merged,
    ...topPatch,
    ...(Object.keys(rawPatch).length
      ? { raw_extracted: { ...posRe, ...rawPatch } }
      : {}),
  };
}

function mergeLinkedCardBrandMix(posMix, ecomMix) {
  const a = Array.isArray(posMix) ? posMix : [];
  const b = Array.isArray(ecomMix) ? ecomMix : [];
  if (!a.length && !b.length) return null;
  if (!a.length) return cloneJson(b);
  if (!b.length) return cloneJson(a);
  const m = new Map();
  for (const row of [...a, ...b]) {
    if (!row || typeof row !== 'object') continue;
    const lab = String(row.label ?? row.brand ?? '').trim();
    const vol = Number(row.volume ?? row.volume_usd);
    if (!lab || !Number.isFinite(vol) || !(vol > 0.005)) continue;
    const slug = slugifyCardOrKey(lab) || lab.toLowerCase().replace(/\s+/g, '-');
    const prev = m.get(slug);
    const rounded = Math.round(vol * 100) / 100;
    if (prev) {
      const vs = Math.round((prev.volume + rounded) * 100) / 100;
      m.set(slug, {
        ...prev,
        volume: vs,
        volume_usd: vs,
      });
    } else {
      m.set(slug, {
        label: lab,
        slug,
        volume: rounded,
        volume_usd: rounded,
        source: 'linked_merge_card_brand',
      });
    }
  }
  const out = [...m.values()];
  return out.length ? out : null;
}

function n(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

function firstPosRow(cs) {
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) return null;
  if (cs.pos && typeof cs.pos === 'object') return cloneJson(cs.pos);
  return null;
}

function firstCnpRow(cs) {
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) return null;
  for (const k of ['cnp', 'ecommerce', 'ecomm', 'online', 'web', 'digital']) {
    const row = cs[k];
    if (row && typeof row === 'object') return cloneJson(row);
  }
  return null;
}

function firstPosRowFlexible(cs) {
  const direct = firstPosRow(cs);
  if (direct) return direct;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) return null;
  for (const key of Object.keys(cs)) {
    const row = cs[key];
    if (!row || typeof row !== 'object') continue;
    if (resolveChannelSplitBucket(key, row) === 'pos') return cloneJson(row);
  }
  return null;
}

function firstCnpRowFlexible(cs) {
  const direct = firstCnpRow(cs);
  if (direct) return direct;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) return null;
  for (const key of Object.keys(cs)) {
    const row = cs[key];
    if (!row || typeof row !== 'object') continue;
    if (resolveChannelSplitBucket(key, row) === 'ecom') return cloneJson(row);
  }
  return null;
}

function mergeBillingPeriod(a, b, c) {
  const parts = [a, b, c].filter((x) => x && typeof x === 'object' && (x.from || x.to));
  if (!parts.length) return null;
  const froms = parts.map((p) => p.from).filter(Boolean);
  const tos = parts.map((p) => p.to).filter(Boolean);
  const from = froms.length ? froms.sort()[0] : null;
  const to = tos.length ? tos.sort().slice(-1)[0] : null;
  if (!from && !to) return null;
  return { from: from || to, to: to || from };
}

function concatFeeLines(...arrays) {
  const out = [];
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      if (row && typeof row === 'object') out.push(cloneJson(row));
    }
  }
  return out;
}

/** @param {string|undefined|null} ch */
function feeLineChannelLooksOnline(ch) {
  const s = String(ch ?? '')
    .trim()
    .toLowerCase();
  if (!s) return false;
  return (
    s === 'online' ||
    s === 'cnp' ||
    s.includes('e-commerce') ||
    s.includes('ecommerce') ||
    s.includes('card not present') ||
    s.includes('card-not-present') ||
    s.includes('digital') ||
    s.includes('web')
  );
}

function feeLineLooksLikeBankCharge(row) {
  if (!row || typeof row !== 'object') return false;
  const blob = [
    row.type,
    row.description,
    row.memo,
    row.category,
    row.channel,
    row.name,
    row.detail,
    row.line_text,
    row.transaction_description,
    row.notes,
  ]
    .filter((x) => x != null && String(x).trim() !== '')
    .map((x) => String(x).toLowerCase())
    .join(' ');
  if (!blob.trim()) return false;
  if (
    /\b(bank fee|wire fee|incoming wire|outgoing wire|ach reject|returned ach|monthly service|account fee|nsf|overdraft|transfer fee|loan payment|merchant cash advance|mc advance|service charge)\b/.test(
      blob,
    )
  )
    return true;
  if (/\b(bank|wire transfer|ach transfer)\b/.test(blob) && /\b(fee|charge|cost)\b/.test(blob)) return true;
  return false;
}

/**
 * When the linked e‑commerce file has CNP fees on `channel_split` but no `fee_lines` rows tagged as online,
 * add / backfill lines so Fee Breakdown matches the Overview donut.
 * @param {object[]} fee_lines
 * @param {object} channel_split
 * @param {number | null | undefined} [ecomDeclaredFees] E‑commerce processor fee component from merge pick (declared or coherent line sum).
 */
function ensureLinkedFeeLinesCoverOnlineChannel(fee_lines, channel_split, ecomDeclaredFees) {
  const ecomDecl = n(ecomDeclaredFees);
  let lines = Array.isArray(fee_lines) ? fee_lines.map((r) => cloneJson(r)) : [];

  if (!lines.length && ecomDecl > 0.005) {
    return [
      {
        type: 'E‑commerce processing (from declared total)',
        rate: '—',
        amount: Math.round(ecomDecl * 100) / 100,
        channel: 'Online',
        confidence: 'high',
        linked_merge_synthetic_channel_fee: true,
        from_channel_split: true,
      },
    ];
  }

  const feeLineLooksEcomTagged = (f) => {
    if (!f || typeof f !== 'object') return false;
    const typ = String(f.fee_type ?? f.type ?? '').toLowerCase();
    const ch = String(f.channel ?? '').toLowerCase();
    if (feeLineChannelLooksOnline(f.channel)) return true;
    return /ecom|online|cnp|shopify|stripe|digital|web/.test(typ) || /ecom|online|cnp|digital|web/.test(ch);
  };

  const hasEcomFee = lines.some(feeLineLooksEcomTagged);
  if (!hasEcomFee && ecomDecl > 0.005) {
    lines.push({
      type: 'E‑commerce processing (backfill)',
      rate: '—',
      amount: Math.round(ecomDecl * 100) / 100,
      channel: 'Online',
      confidence: 'high',
      linked_merge_synthetic_channel_fee: true,
      from_channel_split: true,
    });
  }

  const cnpFees = Math.max(n(channel_split?.cnp?.fees), ecomDecl);
  if (!(cnpFees > 0.005)) return lines;

  let onlineSum = 0;
  for (const row of lines) {
    if (!row || typeof row !== 'object') continue;
    if (row.linked_merge_synthetic_channel_fee) continue;
    if (feeLineLooksLikeBankCharge(row)) continue;
    if (!feeLineChannelLooksOnline(row.channel)) continue;
    const a = feeLineRowAmount(row);
    if (Number.isFinite(a) && a > 0.005) onlineSum += a;
  }
  const tol = Math.max(0.5, cnpFees * 0.08);
  if (onlineSum + tol >= cnpFees) return lines;

  lines.push({
    type: 'E‑commerce processing fees',
    rate: '—',
    amount: Math.round(cnpFees * 100) / 100,
    channel: 'Online',
    confidence: 'high',
    linked_merge_synthetic_channel_fee: true,
  });
  return lines;
}

function sumProcessorFeeLineAmounts(pd) {
  const L = pd?.fee_lines;
  if (!Array.isArray(L)) return 0;
  let s = 0;
  for (const row of L) {
    if (!row || typeof row !== 'object') continue;
    if (feeLineLooksLikeBankCharge(row)) continue;
    const a = feeLineRowAmount(row);
    if (Number.isFinite(a) && a > 0.005) s += a;
  }
  return Math.round(s * 100) / 100;
}

/**
 * Per-file processor fee basis during linked merge normalizers (POS or e‑com parse only).
 * Prefer Σ processor `fee_lines` when coherent with `total_fees_charged`; else header; else grid sum.
 */
function pickSingleFileProcessorFeeTotal(pd, gridFeeSum) {
  const lineSum = sumProcessorFeeLineAmounts(pd);
  const header = n(pd.total_fees_charged);
  const grid = n(gridFeeSum);
  const tol = (x) => Math.max(1, Math.abs(x) * 0.05);

  if (lineSum > 0.005 && header > 0.005) {
    const diff = Math.abs(lineSum - header);
    if (diff <= tol(header)) return Math.round(lineSum * 100) / 100;
    if (lineSum > header + tol(header)) return Math.round(header * 100) / 100;
    if (lineSum + tol(header) < header) return Math.round(header * 100) / 100;
  }

  if (lineSum > 0.005) return Math.round(lineSum * 100) / 100;
  if (header > 0.005) return Math.round(header * 100) / 100;
  if (grid > 0.005) return Math.round(grid * 100) / 100;
  return 0;
}

function filterProcessorFeeLinesForMerge(feeLines) {
  if (!Array.isArray(feeLines)) return [];
  return feeLines.filter((f) => {
    if (!f || typeof f !== 'object') return false;
    if (feeLineLooksLikeBankCharge(f)) return false;
    const type = String(f.fee_type || f.type || '').toLowerCase();
    if (/bank|wire|transfer|monthly|nsf|overdraft|maintenance/.test(type)) return false;
    return true;
  });
}

/**
 * Linked merge: POS + e‑commerce processor fees only (no bank fee_lines). Prefer detailed fee_lines when
 * their sum is within 5% of declared file totals; otherwise declared totals (avoids summary + detail double-count).
 * @returns {{ total: number, source: string, posComponent: number, ecomComponent: number }}
 */
function pickLinkedProcessorFeeTotal(posPd, ecomPd) {
  const posProcessorFees = filterProcessorFeeLinesForMerge(posPd?.fee_lines);
  const ecomProcessorFees = filterProcessorFeeLinesForMerge(ecomPd?.fee_lines);

  let posFeeSum = 0;
  for (const f of posProcessorFees) {
    const a = feeLineRowAmount(f);
    if (Number.isFinite(a) && a > 0.005) posFeeSum += a;
  }
  let ecomFeeSum = 0;
  for (const f of ecomProcessorFees) {
    const a = feeLineRowAmount(f);
    if (Number.isFinite(a) && a > 0.005) ecomFeeSum += a;
  }
  posFeeSum = Math.round(posFeeSum * 100) / 100;
  ecomFeeSum = Math.round(ecomFeeSum * 100) / 100;
  const combinedFeeLineSum = Math.round((posFeeSum + ecomFeeSum) * 100) / 100;

  const posDeclaredFees = n(posPd?.total_fees_charged);
  const ecomDeclaredFees = n(ecomPd?.total_fees_charged);
  const combinedDeclaredFees = Math.round((posDeclaredFees + ecomDeclaredFees) * 100) / 100;

  if (combinedFeeLineSum > 0.005 && combinedDeclaredFees > 0.005) {
    const variance = Math.abs(combinedFeeLineSum - combinedDeclaredFees);
    const variancePercent = (variance / combinedDeclaredFees) * 100;
    if (variancePercent <= 5) {
      return {
        total: combinedFeeLineSum,
        source: 'fee_lines_detailed',
        posComponent: posFeeSum,
        ecomComponent: ecomFeeSum,
      };
    }
  }

  if (combinedFeeLineSum > 0.005 && combinedDeclaredFees <= 0.005) {
    return {
      total: combinedFeeLineSum,
      source: 'fee_lines_only',
      posComponent: posFeeSum,
      ecomComponent: ecomFeeSum,
    };
  }

  return {
    total: combinedDeclaredFees,
    source: 'declared_totals',
    posComponent: posDeclaredFees,
    ecomComponent: ecomDeclaredFees,
  };
}

/** Sum per-order / batch processing fees on e-commerce parses (Shopify exports, etc.). */
function sumEcommSettlementOrderFees(pd) {
  if (!pd || typeof pd !== 'object') return 0;
  const lists = [
    pd.ecomm_settlement_orders,
    pd.ecommerce_settlement_orders,
    pd.shopify_orders,
    pd.ecomm_orders,
  ].filter((x) => Array.isArray(x) && x.length > 0);
  let best = 0;
  for (const L of lists) {
    let s = 0;
    for (const o of L) {
      if (!o || typeof o !== 'object') continue;
      if (ecommOrderExcludedFromReportedSalesTotals(o)) continue;
      const f =
        o.processing_fee ??
        o.processing_fees ??
        o.fee ??
        o.transaction_fee ??
        o.total_fees ??
        o.shopify_fee;
      const x = Number(f);
      if (Number.isFinite(x)) s += Math.abs(x);
    }
    if (s > best) best = s;
  }
  return Math.round(best * 100) / 100;
}

/** Sum batch-level processing fees on POS parses (Square settlement batches, tabular augment, etc.). */
function sumPosSettlementBatchFees(pd) {
  if (!pd || typeof pd !== 'object') return 0;
  const rows = getPosSettlementBatchRows(pd);
  if (!Array.isArray(rows) || !rows.length) return 0;
  let s = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const f = Number(row.fees ?? row.processing_fee ?? row.processing_fees ?? row.total_fees);
    if (Number.isFinite(f)) s += Math.abs(f);
  }
  return Math.round(s * 100) / 100;
}

function posFileRefundTotalForLinkedMerge(pd) {
  if (!pd || typeof pd !== 'object') return 0;
  const candidates = [
    pd.refund_volume,
    pd.total_refunds,
    pd.refund_total,
    pd.refunds_total,
    pd.pos_refund_volume,
    pd.pos_refunds,
    pd.total_return_volume,
  ];
  let best = 0;
  for (const x of candidates) {
    const v = Math.abs(n(x));
    if (v > best) best = v;
  }
  return Math.round(best * 100) / 100;
}

/**
 * POS exports often put **refund_volume** only at file level while `channel_split.pos` omits it.
 * Split file-level refunds vs in-file CNP gross when both exist (same idea as Shopify inference).
 */
function inferPosRefundVolumeForLinkedNormalize(pd, rowLike) {
  let rf = n(rowLike?.refund_volume ?? rowLike?.refunds);
  if (rf > 0.005) return rf;
  const fileTot = posFileRefundTotalForLinkedMerge(pd);
  if (!(fileTot > 0.005)) return 0;
  const cs = pd?.channel_split;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) return fileTot;
  const posG = rowLike?.volume != null ? n(rowLike.volume) : cs.pos ? channelSalesVolume(cs.pos) : 0;
  const cnpRow = firstCnpRow(cs);
  const cnpG = cnpRow ? channelSalesVolume(cnpRow) : 0;
  if (!(cnpG > 500)) return fileTot;
  const denom = posG + cnpG;
  if (!(denom > 0.005)) return fileTot;
  const share = posG / denom;
  return Math.round(fileTot * share * 100) / 100;
}

/**
 * Many Shopify-style parses put **refund_volume** only at file level while `volume` is net sales.
 * When the online bucket dominates this file, attribute file-level refunds to CNP for gross inference.
 */
/** File-level refund totals on e-commerce parses (keys vary by export). */
function ecommerceFileRefundTotalForLinkedMerge(pd) {
  if (!pd || typeof pd !== 'object') return 0;
  const candidates = [
    pd.refund_volume,
    pd.total_refunds,
    pd.refund_total,
    pd.refunds_total,
    pd.ecommerce_refunds,
    pd.ecomm_refund_volume,
  ];
  let best = 0;
  for (const x of candidates) {
    const v = Math.abs(n(x));
    if (v > best) best = v;
  }
  return Math.round(best * 100) / 100;
}

function inferEcomRefundVolumeForLinkedNormalize(pd, rowLike) {
  let rf = n(rowLike?.refund_volume ?? rowLike?.refunds);
  if (rf > 0.005) return rf;
  const fileTot = ecommerceFileRefundTotalForLinkedMerge(pd);
  if (!(fileTot > 0.005)) return 0;
  const cs = pd?.channel_split;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) return fileTot;
  const posG = cs.pos ? channelSalesVolume(cs.pos) : 0;
  const volHint = n(rowLike?.volume);
  // No in-file POS / in-store channel: attribute file refunds to the online row.
  if (!posG || posG < 500) return fileTot;
  const aq = String(pd?.acquirer_name ?? '').toLowerCase();
  if (aq.includes('shopify') && volHint > 500 && posG > volHint * 2.5) {
    // Mis-attributed in-person totals on a Shopify-only workbook — do not shrink refunds by that POS stub.
    return fileTot;
  }
  const denom = volHint + posG;
  if (!(denom > 0.005)) return fileTot;
  // Split file-level refunds by gross share (previously we returned 0 when online share ≤55%, which
  // dropped refunds entirely and left net sales mislabeled as gross).
  const share = volHint / denom;
  return Math.round(fileTot * share * 100) / 100;
}

/**
 * Shopify exports often put **net sales** in `volume` and under-count `fees` vs the file total.
 * Prefer gross = volume + refunds when fee÷volume is implausibly low, then align fees to file total.
 */
function normalizeLinkedEcommerceSplit(pd, row) {
  if (!row || typeof row !== 'object') return row;
  const lm = getStatementHeuristics(pd).linkedMerge;
  const out = { ...row };
  const inferredRf = inferEcomRefundVolumeForLinkedNormalize(pd, out);
  if (inferredRf > 0.005 && n(out.refund_volume ?? out.refunds) < 0.005) {
    out.refund_volume = Math.round(inferredRf * 100) / 100;
  }
  let vol = n(out.volume);
  const rf = n(out.refund_volume ?? out.refunds);
  let fees = n(out.fees);
  const explicitGross = n(out.gross_sales ?? out.gross_volume);
  const orderHint = sumEcommOrderGrossBestFromParsed(pd);
  const highFeeMaterialRefundBranch =
    rf > 15 &&
    vol > 0 &&
    fees / (vol + rf) > 0.005 &&
    fees / (vol + rf) <= lm.ecomFeeAlignMaxFeesVsVolume &&
    fees / vol >= lm.ecomMaxFeeToVolumeBeforeGrossBump;
  let allowVolBump = highFeeMaterialRefundBranch;
  if (allowVolBump && orderHint > 0.005) {
    allowVolBump =
      orderHint > vol + Math.max(25, vol * 0.004) &&
      Math.abs(vol + rf - orderHint) <= Math.max(120, orderHint * 0.035);
  }
  if (
    explicitGross < 0.005 &&
    rf > 0.005 &&
    vol > lm.ecomNetPlusRefundMinVolume &&
    fees > 0 &&
    vol > 0 &&
    (fees / vol < lm.ecomMaxFeeToVolumeBeforeGrossBump || allowVolBump)
  ) {
    vol = Math.round((vol + rf) * 100) / 100;
    out.volume = vol;
    out.gross_volume = vol;
  }
  const tf = pickSingleFileProcessorFeeTotal(pd, sumEcommSettlementOrderFees(pd));
  if (
    tf > fees * lm.ecomFeeAlignVsRowMultiplier + lm.ecomFeeAlignMinGapDollars &&
    tf < vol * lm.ecomFeeAlignMaxFeesVsVolume &&
    vol > lm.ecomFeeAlignMinVolume
  ) {
    fees = Math.round(tf * 100) / 100;
    out.fees = fees;
  }
  const apiNet = n(pd.ecomm_net_deposit_volume ?? pd.ecommerce_net_deposit);
  if (apiNet > lm.minApiNetDepositDollars) {
    out.net_settled_volume = Math.round(apiNet * 100) / 100;
  }
  return out;
}

/**
 * Square / POS exports often put **net sales** in `volume` and under-count row `fees` vs the file total.
 * Mirror {@link normalizeLinkedEcommerceSplit} so linked-merge POS gross, fees, and nets match single-file behavior.
 */
function normalizeLinkedPosChannelSplit(pd, row) {
  if (!row || typeof row !== 'object') return row;
  const lm = getStatementHeuristics(pd).linkedMerge;
  const out = { ...row };
  const inferredRf = inferPosRefundVolumeForLinkedNormalize(pd, out);
  if (inferredRf > 0.005 && n(out.refund_volume ?? out.refunds) < 0.005) {
    out.refund_volume = Math.round(inferredRf * 100) / 100;
  }
  const vol = n(out.volume);
  let fees = n(out.fees);
  // Do not apply volume + refunds as “gross” here (used for Shopify-style net-in-volume). Square/POS rows
  // usually already carry gross in `volume`; bumping double-counts refunds vs reconciliation workbook Gross Sales.
  const tf = pickSingleFileProcessorFeeTotal(pd, sumPosSettlementBatchFees(pd));
  if (
    tf > fees * lm.ecomFeeAlignVsRowMultiplier + lm.ecomFeeAlignMinGapDollars &&
    tf < vol * lm.ecomFeeAlignMaxFeesVsVolume &&
    vol > lm.ecomFeeAlignMinVolume
  ) {
    fees = Math.round(tf * 100) / 100;
    out.fees = fees;
  }
  return out;
}

function patchLinkedPosNetFromParser(pd, row) {
  if (!row || typeof row !== 'object') return row;
  const lm = getStatementHeuristics(pd).linkedMerge;
  const pnv = n(pd.pos_net_deposit_volume ?? pd.pos_net_deposit);
  if (!(pnv > lm.minApiNetDepositDollars)) return row;
  const existing = n(row.net_settled_volume);
  // Prefer batch / workbook net already on the row; only back-fill from file-level settlement when missing.
  if (existing > lm.minApiNetDepositDollars) return row;
  return { ...row, net_settled_volume: Math.round(pnv * 100) / 100 };
}

function _positiveTxnIntForMerge(v) {
  const x = Math.floor(Number(v));
  return Number.isFinite(x) && x >= 1 && x <= 1e9 ? x : null;
}

/** Longest POS payment-line list on the POS processor parse (same slots as finalize / txn inference). */
function _maxPosTransactionLinesForMerge(pd) {
  if (!pd || typeof pd !== 'object') return 0;
  const lists = [
    pd.pos_transactions,
    pd.pos_transaction_details,
    pd.pos_settlement_transactions,
    pd.card_present_transactions,
    pd.in_store_transactions,
    pd.batch_transactions,
    pd.raw_extracted?.pos_transactions,
    pd.raw_extracted?.pos_transaction_details,
    pd.raw_extracted_preview?.pos_transactions,
    pd.raw_extracted_preview?.pos_transaction_details,
    pd.extracted?.pos_transactions,
    pd.extracted?.pos_transaction_details,
  ];
  let best = 0;
  for (const L of lists) {
    if (Array.isArray(L) && L.length > best) best = L.length;
  }
  return best;
}

function _sumTxnCountsFromPosBatchRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  let sum = 0;
  let any = false;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    let v = NaN;
    if (Array.isArray(r.transactions) && r.transactions.length >= 1) v = r.transactions.length;
    else
      v = Number(
        r.transaction_count ??
          r.txn_count ??
          r.transactions_count ??
          r.transactions ??
          r.batch_transaction_count,
      );
    if (Number.isFinite(v) && v >= 1 && v <= 1e9) {
      sum += Math.round(v);
      any = true;
    }
  }
  return any ? sum : null;
}

/**
 * Linked merge rebuilds `channel_split.pos` from roll-ups and drops `txn_count` / `avg_txn`.
 * Restore from the POS file’s scalars, batch table, or longest payment export so the Channel tab matches e‑com.
 */
function enrichLinkedPosChannelTxnMetrics(posPd, posRow, posBatchRows) {
  if (!posRow || typeof posRow !== 'object') return posRow;
  if (_positiveTxnIntForMerge(posRow.txn_count)) return posRow;
  const raw =
    posPd?.raw_extracted_preview && typeof posPd.raw_extracted_preview === 'object'
      ? posPd.raw_extracted_preview
      : posPd?.raw_extracted && typeof posPd.raw_extracted === 'object'
        ? posPd.raw_extracted
        : null;
  const ext = posPd?.extracted && typeof posPd.extracted === 'object' ? posPd.extracted : null;
  const fromTop =
    _positiveTxnIntForMerge(posPd?.pos_transaction_count) ??
    _positiveTxnIntForMerge(posPd?.channel_split?.pos?.txn_count);
  const fromNested =
    (raw ? _positiveTxnIntForMerge(raw.pos_transaction_count) : null) ??
    (raw ? _positiveTxnIntForMerge(raw.channel_split?.pos?.txn_count) : null) ??
    (ext ? _positiveTxnIntForMerge(ext.pos_transaction_count) : null);
  const fromBatches = _sumTxnCountsFromPosBatchRows(posBatchRows);
  const lineHint = _maxPosTransactionLinesForMerge(posPd);
  const pick =
    fromTop ?? fromNested ?? (fromBatches != null ? fromBatches : null) ?? (lineHint > 0 ? lineHint : null);
  if (!pick) return posRow;
  const vol =
    n(posRow.volume) || n(posRow.gross_volume) || n(posRow.net_settled_volume) || n(posRow.gross_sales);
  const avg = vol > 0.005 && pick >= 1 ? Math.round((vol / pick) * 100) / 100 : undefined;
  const out = { ...posRow, txn_count: pick };
  if (avg != null && Number.isFinite(avg)) out.avg_txn = avg;
  return out;
}

function pickBankFields(bankPd) {
  if (!bankPd || typeof bankPd !== 'object') return {};
  const o = {};
  const keys = [
    'bank_transactions',
    'bank_credits_total_verified',
    'reconciliation_total_deposits',
    'reconciliation_variance',
    'reconciliation_discrepancy_lines',
    'raw_bank_lines',
    'bank_statement_meta',
  ];
  for (const k of keys) {
    if (bankPd[k] != null) o[k] = cloneJson(bankPd[k]);
  }
  const nestedRoots = [bankPd.raw_extracted, bankPd.raw_extracted_preview, bankPd.extracted].filter(
    (x) => x && typeof x === 'object' && !Array.isArray(x),
  );
  const hasBankTx = Array.isArray(o.bank_transactions) && o.bank_transactions.length > 0;
  if (!hasBankTx) {
    const nested = nestedRoots
      .map((r) => r.bank_transactions)
      .find((L) => Array.isArray(L) && L.length > 0);
    const nestedLedgerFirst = nestedRoots.flatMap((r) => [
      r.bank_ledger_lines,
      r.bank_statement_lines,
      r.account_transactions,
      r.bank_deposits,
      r.deposit_transactions,
    ]);
    const fallbacks = [
      nested,
      bankPd.transactions,
      bankPd.ledger_transactions,
      bankPd.bank_ledger_lines,
      bankPd.bank_statement_lines,
      bankPd.account_transactions,
      ...nestedLedgerFirst,
      ...nestedRoots.map((r) => r.transactions),
      ...nestedRoots.map((r) => r.ledger_transactions),
    ];
    for (const L of fallbacks) {
      if (Array.isArray(L) && L.length > 0) {
        o.bank_transactions = cloneJson(L);
        break;
      }
    }
  }
  const hasRaw = Array.isArray(o.raw_bank_lines) && o.raw_bank_lines.length > 0;
  if (!hasRaw) {
    const raw =
      bankPd.raw_bank_lines ||
      nestedRoots.map((r) => r.raw_bank_lines).find((L) => Array.isArray(L) && L.length > 0);
    if (Array.isArray(raw) && raw.length > 0) o.raw_bank_lines = cloneJson(raw);
  }
  return o;
}

/** Longest non-empty e‑commerce order list (parser keys vary by export / augment path). */
function pickEcommerceOrdersArrayForMerge(ecomPd) {
  if (!ecomPd || typeof ecomPd !== 'object') return [];
  const keys = [
    'ecomm_settlement_orders',
    'ecommerce_settlement_orders',
    'shopify_orders',
    'ecomm_orders',
  ];
  let best = [];
  for (const k of keys) {
    const L = ecomPd[k];
    if (!Array.isArray(L) || !L.length) continue;
    if (L.length > best.length) best = L;
  }
  return best.length ? cloneJson(best) : [];
}

function rowLooksLikeSalesChannel(gross, fees, parsedData) {
  const lm = getStatementHeuristics(parsedData).linkedMerge;
  const g = n(gross);
  const f = n(fees);
  if (g < lm.grossEps && f < lm.grossEps) return false;
  if (g < lm.grossEps) return true;
  if (g < lm.minGrossDollarsForFeeRatioCheck && f / g > lm.maxFeesToGrossRatio) return false;
  return true;
}

/** Merge extract: accept split row if strict sanity passes, or gross is real and fees are not an obvious stub. */
function mergeAcceptChannelSplitRowForLinkedExtract(row, parsedData) {
  if (!row || typeof row !== 'object') return null;
  const g = channelSalesVolume(row);
  const f = n(row.fees);
  const eps = getStatementHeuristics(parsedData).linkedMerge.grossEps;
  if (!(g > eps)) return null;
  if (rowLooksLikeSalesChannel(g, f, parsedData)) return cloneJson(row);
  const insaneStub = g < 1000 && f > Math.max(g * 3, 500);
  if (!insaneStub) return cloneJson(row);
  return null;
}

/** Best-effort POS gross when `channel_split.pos` / `pos_volume` are missing (Month Summary, header total). */
function linkedMergePosVolumeFallback(pd) {
  if (!pd || typeof pd !== 'object') return 0;
  const eps = getStatementHeuristics(pd).linkedMerge.grossEps;
  const ms = pd.pos_workbook_month_summary;
  const candidates = [
    n(pd.pos_volume),
    n(pd.total_transaction_volume),
    n(ms?.total_gross_sales),
    n(ms?.total_card_sales),
  ];
  let best = 0;
  for (const v of candidates) {
    if (v > best) best = v;
  }
  return best > eps ? Math.round(best * 100) / 100 : 0;
}

/** Best-effort e‑commerce gross when split / `ecomm_volume` are missing (orders grid, header total). */
function linkedMergeEcomVolumeFallback(pd) {
  if (!pd || typeof pd !== 'object') return 0;
  const eps = getStatementHeuristics(pd).linkedMerge.grossEps;
  const orderSum = sumEcommOrderGrossBestFromParsed(pd);
  const candidates = [n(pd.ecomm_volume ?? pd.ecommerce_volume), n(pd.total_transaction_volume), orderSum];
  let best = 0;
  for (const v of candidates) {
    if (v > best) best = v;
  }
  return best > eps ? Math.round(best * 100) / 100 : 0;
}

/**
 * POS processor parse often carries `channel_split.pos.gross_volume` / **gross_sales** that match the workbook while the
 * merged roll-up still uses an inflated `volume` (gross + refunds). Prefer source gross when it differs modestly.
 */
function alignLinkedPosVolumeUsingPosSourceGross(channel_split, posPd) {
  const pos = channel_split?.pos;
  const src = posPd?.channel_split?.pos;
  if (!pos || !src || typeof pos !== 'object' || typeof src !== 'object') return channel_split;
  const gv = n(src.gross_volume ?? src.gross_sales);
  const mergedVol = channelSalesVolume(pos);
  const eps = getStatementHeuristics(posPd).linkedMerge.grossEps;
  if (!(gv > eps)) return channel_split;
  if (Math.abs(gv - mergedVol) <= 0.5) return channel_split;
  if (Math.abs(gv - mergedVol) > Math.max(500, 0.06 * Math.max(mergedVol, 1))) return channel_split;
  return {
    ...channel_split,
    pos: { ...pos, volume: Math.round(gv * 100) / 100, gross_volume: Math.round(gv * 100) / 100 },
  };
}

/**
 * When a reconciliation workbook scalar total is present, shrink inflated POS `volume` / `gross_volume` so Σ
 * channels match it. The pre-shrink POS total is kept on **`statement_gross_volume`** for Channel tab / roll-ups
 * (statement gross), while `volume` stays aligned to the recon headline.
 */
function alignLinkedPosVolumeToReconciliationTotal(channel_split, posPd, reconTtv) {
  const gtv = n(reconTtv);
  if (!(gtv > 0.005)) return channel_split;
  const cs = channel_split;
  const pos = cs.pos;
  const cnp = cs.cnp;
  if (!pos || !cnp) return channel_split;
  const preVol = channelSalesVolume(pos);
  let rf = n(pos.refund_volume ?? pos.refunds);
  if (!(rf > 0.005)) rf = inferPosRefundVolumeForLinkedNormalize(posPd, pos);
  if (!(rf > 0.005)) return channel_split;
  const implied = Math.round((preVol - rf) * 100) / 100;
  let sumOthers = channelSalesVolume(cnp);
  if (cs.cash && typeof cs.cash === 'object') sumOthers += channelSalesVolume(cs.cash);
  const sumImplied = implied + sumOthers;
  const sumRaw = preVol + sumOthers;
  const tol = Math.max(2, 0.0005 * Math.max(gtv, sumRaw, 1));
  if (Math.abs(sumImplied - gtv) <= tol && Math.abs(sumRaw - gtv) > tol) {
    const preGrossField = n(pos.gross_volume ?? pos.gross_sales);
    const statementGross = Math.max(preVol, preGrossField);
    const keepStmtGross =
      statementGross > implied + 0.005 ? { statement_gross_volume: Math.round(statementGross * 100) / 100 } : {};
    return {
      ...cs,
      pos: { ...pos, volume: implied, gross_volume: implied, ...keepStmtGross },
    };
  }
  return channel_split;
}

/**
 * When merged `channel_split.pos` is net of refunds / recon-aligned but the **POS file** still carries a higher
 * statement gross (split row, month summary, or scalars), stamp `statement_gross_volume` for Channel tab roll-ups.
 */
function posSourceStatementGrossVolumeHint(posPd, mergedPosRow) {
  if (!posPd || typeof posPd !== 'object' || !mergedPosRow || typeof mergedPosRow !== 'object') return null;
  const mergedPrimary = Math.max(
    n(mergedPosRow.statement_gross_volume),
    n(mergedPosRow.gross_volume ?? mergedPosRow.gross_sales),
    channelSalesVolume(mergedPosRow),
  );
  const src = posPd.channel_split?.pos;
  let fromPosFile = 0;
  if (src && typeof src === 'object') {
    fromPosFile = Math.max(n(src.gross_volume ?? src.gross_sales), channelSalesVolume(src));
  }
  const ms = posPd.pos_workbook_month_summary;
  const fromMonth = n(ms?.total_gross_sales);
  const fromScalars = Math.max(n(posPd.pos_volume), n(posPd.total_transaction_volume));
  const candidate = Math.max(fromPosFile, fromMonth, fromScalars);
  const tol = Math.max(0.5, 0.002 * Math.max(mergedPrimary, 1));
  if (!(candidate > mergedPrimary + tol)) return null;
  return Math.round(candidate * 100) / 100;
}

function channelRowFromRevenueRow(row, parsedData) {
  if (!row) return null;
  if (!rowLooksLikeSalesChannel(row.gross, row.fees, parsedData)) return null;
  const lm = getStatementHeuristics(parsedData).linkedMerge;
  const o = {
    channel_label: String(row.label || '').trim() || undefined,
    volume: row.gross,
    fees: row.fees,
  };
  if (row.refunds != null && n(row.refunds) > lm.grossEps) {
    o.refund_volume = row.refunds;
  } else if (row.key === 'ecom' && parsedData) {
    const inf = inferEcomRefundVolumeForLinkedNormalize(parsedData, { ...o, volume: row.gross });
    if (inf > 0.005) o.refund_volume = Math.round(inf * 100) / 100;
  } else if (row.key === 'pos' && parsedData) {
    const inf = inferPosRefundVolumeForLinkedNormalize(parsedData, { ...o, volume: row.gross });
    if (inf > 0.005) o.refund_volume = Math.round(inf * 100) / 100;
  }
  return o;
}

/**
 * Pull POS or e-commerce (CNP) roll-up from parsed JSON: prefer `buildRevenueByChannelTable` buckets,
 * then POS/e‑commerce classified `channel_split` rows (flexible keys), scalars, Month Summary / order totals.
 * @param {object} pd
 * @param {'pos' | 'ecommerce'} slot
 */
function extractLinkedChannelRow(pd, slot) {
  const tableKey = slot === 'pos' ? 'pos' : 'ecom';
  const eps = getStatementHeuristics(pd).linkedMerge.grossEps;
  const t = buildRevenueByChannelTable(pd);
  const fromAgg = t?.rows?.find((r) => r.key === tableKey);
  let row = fromAgg ? channelRowFromRevenueRow(fromAgg, pd) : null;
  if (row) return row;

  if (fromAgg && n(fromAgg.gross) > eps) {
    const g = n(fromAgg.gross);
    const f = n(fromAgg.fees);
    if (!rowLooksLikeSalesChannel(g, f, pd)) {
      const insaneStub = g < 1000 && f > Math.max(g * 3, 500);
      if (!insaneStub) {
        const lm = getStatementHeuristics(pd).linkedMerge;
        const o = {
          channel_label: String(fromAgg.label || '').trim() || undefined,
          volume: fromAgg.gross,
          fees: fromAgg.fees,
        };
        if (fromAgg.refunds != null && n(fromAgg.refunds) > lm.grossEps) {
          o.refund_volume = fromAgg.refunds;
        } else if (fromAgg.key === 'ecom' && pd) {
          const inf = inferEcomRefundVolumeForLinkedNormalize(pd, { ...o, volume: fromAgg.gross });
          if (inf > 0.005) o.refund_volume = Math.round(inf * 100) / 100;
        } else if (fromAgg.key === 'pos' && pd) {
          const inf = inferPosRefundVolumeForLinkedNormalize(pd, { ...o, volume: fromAgg.gross });
          if (inf > 0.005) o.refund_volume = Math.round(inf * 100) / 100;
        }
        return o;
      }
    }
  }

  const cs = pd?.channel_split;
  if (slot === 'pos') {
    const r = firstPosRowFlexible(cs);
    const accepted = r ? mergeAcceptChannelSplitRowForLinkedExtract(r, pd) : null;
    if (accepted) return accepted;
    const pv = n(pd.pos_volume);
    if (pv > eps) {
      const feeFallback = pickSingleFileProcessorFeeTotal(pd, sumPosSettlementBatchFees(pd));
      return {
        channel_label: String(cs?.pos?.channel_label || 'POS (linked file)').trim() || 'POS (linked file)',
        volume: pv,
        fees: Math.round(feeFallback * 100) / 100,
      };
    }
    const ttv = n(pd.total_transaction_volume);
    if (ttv > eps && !firstCnpRowFlexible(cs) && n(pd.ecomm_volume ?? pd.ecommerce_volume) <= eps) {
      const feeFallback = pickSingleFileProcessorFeeTotal(pd, sumPosSettlementBatchFees(pd));
      return {
        channel_label: String(cs?.pos?.channel_label || 'POS (linked file)').trim() || 'POS (linked file)',
        volume: ttv,
        fees: Math.round(feeFallback * 100) / 100,
      };
    }
    const fb = linkedMergePosVolumeFallback(pd);
    if (fb > eps) {
      const feeFallback = pickSingleFileProcessorFeeTotal(pd, sumPosSettlementBatchFees(pd));
      return {
        channel_label: String(cs?.pos?.channel_label || 'POS (linked file)').trim() || 'POS (linked file)',
        volume: fb,
        fees: Math.round(feeFallback * 100) / 100,
      };
    }
  } else {
    const r = firstCnpRowFlexible(cs);
    const accepted = r ? mergeAcceptChannelSplitRowForLinkedExtract(r, pd) : null;
    if (accepted) return accepted;
    const ev = n(pd.ecomm_volume ?? pd.ecommerce_volume);
    if (ev > eps) {
      const feeFb = pickSingleFileProcessorFeeTotal(pd, sumEcommSettlementOrderFees(pd));
      return {
        channel_label: String(cs?.cnp?.channel_label || 'E-commerce (linked file)').trim() || 'E-commerce (linked file)',
        volume: ev,
        fees: Math.round(feeFb * 100) / 100,
      };
    }
    const ttv = n(pd.total_transaction_volume);
    if (ttv > eps && !firstPosRowFlexible(cs) && n(pd.pos_volume) <= eps) {
      const feeFb = pickSingleFileProcessorFeeTotal(pd, sumEcommSettlementOrderFees(pd));
      return {
        channel_label: String(cs?.cnp?.channel_label || 'E-commerce (linked file)').trim() || 'E-commerce (linked file)',
        volume: ttv,
        fees: Math.round(feeFb * 100) / 100,
      };
    }
    const fb = linkedMergeEcomVolumeFallback(pd);
    if (fb > eps) {
      const feeFb = pickSingleFileProcessorFeeTotal(pd, sumEcommSettlementOrderFees(pd));
      return {
        channel_label: String(cs?.cnp?.channel_label || 'E-commerce (linked file)').trim() || 'E-commerce (linked file)',
        volume: fb,
        fees: Math.round(feeFb * 100) / 100,
      };
    }
  }
  return null;
}

/** Optional real cash tender from POS / e-commerce workbooks only (not bank file). Revenue table may omit cash—use `channel_split.cash` when needed. */
function extractLinkedCashRow(posPd, ecomPd) {
  for (const pd of [posPd, ecomPd]) {
    const t = buildRevenueByChannelTable(pd);
    const revCash = t?.rows?.find((r) => r.key === 'cash');
    if (revCash) {
      const row = channelRowFromRevenueRow(revCash, pd);
      const minCash = getStatementHeuristics(pd).linkedMerge.minCashTenderGrossDollars;
      if (row && n(revCash?.gross) > minCash) return row;
    }
    const cs = pd?.channel_split;
    const raw = cs?.cash && typeof cs.cash === 'object' ? cs.cash : null;
    if (!raw) continue;
    const g = channelSalesVolume(raw);
    const f = n(raw.fees);
    const minCash = getStatementHeuristics(pd).linkedMerge.minCashTenderGrossDollars;
    if (rowLooksLikeSalesChannel(g, f, pd) && g > minCash) return raw;
  }
  return null;
}

/**
 * Stamp **POS** refunds from the POS processor file and **CNP** refunds from the e‑commerce file so linked
 * bundles never show file-level `refund_volume` while `channel_split` rows stay at zero (revenue table footnote).
 * Prefers workbook Month Summary scalars, then each file’s `channel_split` row, then file-level refund keys.
 */
function stampLinkedChannelRefundsFromProcessorSources(posPd, ecomPd, channel_split) {
  const posRow = channel_split?.pos;
  const cnpRow = channel_split?.cnp;
  if (!posRow || !cnpRow || typeof posRow !== 'object' || typeof cnpRow !== 'object') return channel_split;
  const eps = getStatementHeuristics(posPd).linkedMerge.grossEps;

  const posMonth = n(posPd?.pos_workbook_month_summary?.total_refunds);
  const posFromSplit = n(firstPosRow(posPd?.channel_split)?.refund_volume ?? firstPosRow(posPd?.channel_split)?.refunds);
  const posFile = posFileRefundTotalForLinkedMerge(posPd);
  const posRf =
    posMonth > eps ? Math.round(posMonth * 100) / 100 : posFromSplit > eps ? Math.round(posFromSplit * 100) / 100 : posFile > eps ? posFile : 0;

  const ecomMs = ecomPd?.ecomm_workbook_month_summary;
  const ecomMonth = n(ecomMs?.refunds);
  const ecomFromSplit = n(firstCnpRow(ecomPd?.channel_split)?.refund_volume ?? firstCnpRow(ecomPd?.channel_split)?.refunds);
  const ecomFile = ecommerceFileRefundTotalForLinkedMerge(ecomPd);
  const cnpRf =
    ecomMonth > eps ? Math.round(ecomMonth * 100) / 100 : ecomFromSplit > eps ? Math.round(ecomFromSplit * 100) / 100 : ecomFile > eps ? ecomFile : 0;

  let nextPos = { ...posRow };
  let nextCnp = { ...cnpRow };
  if (posRf > eps) {
    nextPos = { ...nextPos, refund_volume: posRf, refunds: posRf };
  }
  if (cnpRf > eps) {
    nextCnp = { ...nextCnp, refund_volume: cnpRf, refunds: cnpRf };
  }
  return {
    ...channel_split,
    pos: nextPos,
    cnp: nextCnp,
    ...(channel_split.cash && typeof channel_split.cash === 'object' ? { cash: channel_split.cash } : {}),
  };
}

/**
 * Stamp **POS** and **CNP** `fees` from each processor file’s Month Summary (or that file’s `channel_split` row)
 * after {@link normalizeLinkedEcommerceSplit} / {@link normalizeLinkedPosChannelSplit}. Those normalizers use
 * `Math.max(total_fees_charged, Σ fee_lines, Σ order/batch fees)` which can inflate the e‑commerce row when order grids
 * carry fee-like columns — the workbook summary / pre-merge row is authoritative for linked Overview charges.
 */
function stampLinkedProcessorChannelFeesFromSources(posPd, ecomPd, channel_split) {
  const posRow = channel_split?.pos;
  const cnpRow = channel_split?.cnp;
  if (!posRow || !cnpRow || typeof posRow !== 'object' || typeof cnpRow !== 'object') return channel_split;
  const eps = getStatementHeuristics(posPd).linkedMerge.grossEps;

  const posMs = n(posPd?.pos_workbook_month_summary?.total_card_fees);
  const posFromSplit = n(firstPosRow(posPd?.channel_split)?.fees);
  const posStamp =
    posMs > eps ? Math.round(posMs * 100) / 100 : posFromSplit > eps ? Math.round(posFromSplit * 100) / 100 : null;

  const ecomMs = n(ecomPd?.ecomm_workbook_month_summary?.total_stripe_fees);
  const ecomFromSplit = n(firstCnpRow(ecomPd?.channel_split)?.fees);
  const cnpStamp =
    ecomMs > eps ? Math.round(ecomMs * 100) / 100 : ecomFromSplit > eps ? Math.round(ecomFromSplit * 100) / 100 : null;

  return {
    ...channel_split,
    pos: posStamp != null ? { ...posRow, fees: posStamp } : posRow,
    cnp: cnpStamp != null ? { ...cnpRow, fees: cnpStamp } : cnpRow,
    ...(channel_split.cash && typeof channel_split.cash === 'object' ? { cash: channel_split.cash } : {}),
  };
}

/**
 * @param {{
 *   pos: { fileName: string; parsedData: object };
 *   ecommerce: { fileName: string; parsedData: object };
 *   bank: { fileName: string; parsedData: object };
 *   reconciliation?: { fileName: string; parsedData: object };
 * }} parts
 */
export function mergeLinkedStatementUploads(parts) {
  const posPd = parts?.pos?.parsedData;
  const ecomPd = parts?.ecommerce?.parsedData;
  const bankPd = parts?.bank?.parsedData;
  if (!posPd || !ecomPd || !bankPd) {
    throw new Error('mergeLinkedStatementUploads: pos, ecommerce, and bank parsedData are required.');
  }

  const grossEps = getStatementHeuristics(posPd).linkedMerge.grossEps;

  const posBatchesForLinkedMerge = getPosSettlementBatchRows(posPd);

  const posRow = extractLinkedChannelRow(posPd, 'pos');
  const cnpRow = extractLinkedChannelRow(ecomPd, 'ecommerce');
  if (!posRow || !cnpRow) {
    throw new Error(
      'mergeLinkedStatementUploads: could not derive POS and e-commerce channel rows from the two processor files. Check parses or channel_split / volumes.',
    );
  }

  const cashRow = extractLinkedCashRow(posPd, ecomPd);
  const linkedFileNamesForUi = [
    parts.pos.fileName,
    parts.ecommerce.fileName,
    parts.bank.fileName,
    ...(parts.reconciliation?.fileName ? [parts.reconciliation.fileName] : []),
  ].filter(Boolean);
  let channel_split = (() => {
    const cs = { pos: posRow, cnp: cnpRow };
    if (cashRow) cs.cash = cashRow;
    let out = cs;
    out.cnp = normalizeLinkedEcommerceSplit(ecomPd, out.cnp);
    out.pos = normalizeLinkedPosChannelSplit(posPd, out.pos);
    out.pos = patchLinkedPosNetFromParser(posPd, out.pos);
    out.pos = enrichLinkedPosChannelTxnMetrics(posPd, out.pos, posBatchesForLinkedMerge);
    return out;
  })();
  channel_split = stampLinkedChannelRefundsFromProcessorSources(posPd, ecomPd, channel_split);
  channel_split = stampLinkedProcessorChannelFeesFromSources(posPd, ecomPd, channel_split);

  channel_split = alignLinkedPosVolumeUsingPosSourceGross(channel_split, posPd);
  channel_split = alignLinkedPosVolumeToReconciliationTotal(
    channel_split,
    posPd,
    parts?.reconciliation?.parsedData?.total_transaction_volume,
  );
  const stmtHint = posSourceStatementGrossVolumeHint(posPd, channel_split.pos);
  const prevStmt = n(channel_split.pos?.statement_gross_volume);
  if (stmtHint != null || prevStmt > 0.005) {
    const sg = Math.max(stmtHint || 0, prevStmt);
    const mv = Math.max(
      n(channel_split.pos?.gross_volume ?? channel_split.pos?.gross_sales),
      channelSalesVolume(channel_split.pos),
    );
    if (sg > mv + 0.5) {
      channel_split = {
        ...channel_split,
        pos: { ...channel_split.pos, statement_gross_volume: Math.round(sg * 100) / 100 },
      };
    }
  }

  const feePickResult = pickLinkedProcessorFeeTotal(posPd, ecomPd);

  // Processor fee breakdown only: bank CSV exports often attach wires / monthly fees / NSF lines to `fee_lines`.
  // Those are bank charges, not POS or e‑commerce processing fees — merging them inflates charge totals and breaks categorization.
  const fee_lines = ensureLinkedFeeLinesCoverOnlineChannel(
    concatFeeLines(posPd.fee_lines, ecomPd.fee_lines),
    channel_split,
    feePickResult.ecomComponent,
  );

  let merged = {
    ...stripLinkedPosBankNoise(posPd),
    ...pickBankFields(bankPd),
    channel_split,
    fee_lines,
    workbook_sheet_roles: [
      { name: String(parts.pos.fileName || 'POS'), role: 'pos' },
      { name: String(parts.ecommerce.fileName || 'E-commerce'), role: 'ecommerce' },
      { name: String(parts.bank.fileName || 'Bank'), role: 'bank' },
      ...(parts.reconciliation?.fileName
        ? [{ name: String(parts.reconciliation.fileName), role: 'reconciliation' }]
        : []),
    ],
    pos_settlement_batches: posBatchesForLinkedMerge.length ? cloneJson(posBatchesForLinkedMerge) : [],
    pos_settlement_batch_count: posBatchesForLinkedMerge.length || undefined,
    ecomm_settlement_orders: pickEcommerceOrdersArrayForMerge(ecomPd),
    pos_net_deposit_volume: posPd.pos_net_deposit_volume ?? posPd.pos_net_deposit ?? null,
    ecomm_net_deposit_volume: ecomPd.ecomm_net_deposit_volume ?? ecomPd.ecommerce_net_deposit ?? null,
    billing_period: mergeBillingPeriod(posPd.billing_period, ecomPd.billing_period, bankPd.billing_period),
    currency: posPd.currency || ecomPd.currency || bankPd.currency || 'USD',
    acquirer_name:
      [posPd.acquirer_name, ecomPd.acquirer_name, bankPd.acquirer_name || bankPd.bank_name].filter(Boolean).join(' · ') ||
      null,
    merchant_id: [posPd.merchant_id, ecomPd.merchant_id, bankPd.merchant_id].filter(Boolean).join(' · ') || null,
    card_brand_mix: mergeLinkedCardBrandMix(posPd.card_brand_mix, ecomPd.card_brand_mix) ?? bankPd.card_brand_mix,
    linked_statement_bundle: {
      pos_file: parts.pos.fileName,
      ecommerce_file: parts.ecommerce.fileName,
      bank_file: parts.bank.fileName,
      ...(parts.reconciliation?.fileName ? { reconciliation_file: parts.reconciliation.fileName } : {}),
    },
    report_ui: {
      ...(typeof posPd.report_ui === 'object' && posPd.report_ui && !Array.isArray(posPd.report_ui) ? posPd.report_ui : {}),
      structure_headline: linkedFileNamesForUi.join(' · '),
      reconciliation_subtitle: linkedFileNamesForUi.join(' · '),
    },
  };

  merged = liftBankLedgerArraysForLinkedMerge(merged, bankPd);

  const revForNets = buildRevenueByChannelTable(merged);
  if (revForNets?.rows?.length) {
    for (const r of revForNets.rows) {
      const nb = Number(r.netBank);
      if (!Number.isFinite(nb) || !(nb > grossEps)) continue;
      const v = Math.round(nb * 100) / 100;
      if (r.key === 'pos') merged.pos_net_deposit_volume = v;
      if (r.key === 'ecom') merged.ecomm_net_deposit_volume = v;
    }
  } else {
    const posNetCh = n(channel_split.pos?.net_settled_volume);
    if (posNetCh > grossEps) merged.pos_net_deposit_volume = Math.round(posNetCh * 100) / 100;
    const cnpNetCh = n(channel_split.cnp?.net_settled_volume);
    if (cnpNetCh > grossEps) merged.ecomm_net_deposit_volume = Math.round(cnpNetCh * 100) / 100;
  }

  if (!merged.pos_settlement_batches?.length) {
    delete merged.pos_settlement_batch_count;
  }
  if (!merged.ecomm_settlement_orders?.length) {
    delete merged.ecomm_settlement_orders;
  }

  const pg = channelRollupVolume(channel_split.pos, merged);
  const cg = channelRollupVolume(channel_split.cnp, merged);
  const cashG = channel_split.cash ? channelSalesVolume(channel_split.cash) : 0;
  merged.pos_volume = pg > grossEps ? pg : undefined;
  merged.ecomm_volume = cg > grossEps ? cg : undefined;
  if (cashG > grossEps) merged.cash_volume = cashG;
  else delete merged.cash_volume;

  const splitGrossForTtv = sumChannelSplitPlainVolumes(merged, { excludeCash: true });
  merged.total_transaction_volume =
    splitGrossForTtv != null && splitGrossForTtv > grossEps
      ? Math.round(splitGrossForTtv * 100) / 100
      : Math.round((pg + cg) * 100) / 100;

  const feeSum = sumChannelSplitFees(merged);
  if (feeSum > feePickResult.total + 0.01) {
    merged.total_fees_charged = Math.round(feeSum * 100) / 100;
  } else {
    merged.total_fees_charged = feePickResult.total;
  }

  if (process.env.DEBUG_FEES === 'true' || process.env.NEXT_PUBLIC_DEBUG_FEES === 'true') {
    console.log('Fee calculation:', {
      source: feeSum > feePickResult.total + 0.01 ? 'channel_split_sum' : feePickResult.source,
      total: merged.total_fees_charged,
      posComponent: feePickResult.posComponent,
      ecomComponent: feePickResult.ecomComponent,
      channelSplitFeeSum: feeSum,
      pickTotal: feePickResult.total,
    });
  }

  const gv = n(merged.total_transaction_volume);
  const tf = n(merged.total_fees_charged);

  /** Σ `channel_split.*.refund_volume` — single source for headline refunds on linked bundles. */
  const sumChannelSplitRefundVolumes = () => {
    const cs = merged.channel_split;
    if (!cs || typeof cs !== 'object') return 0;
    let s = 0;
    for (const k of Object.keys(cs)) {
      const row = cs[k];
      if (!row || typeof row !== 'object') continue;
      const v = Math.abs(n(row.refund_volume ?? row.refunds));
      if (v > 0.005) s += v;
    }
    return Math.round(s * 100) / 100;
  };
  const refundTot = sumChannelSplitRefundVolumes();
  if (refundTot > 0.005) {
    merged.refund_volume = refundTot;
  } else if (merged.linked_statement_bundle) {
    /** Avoid a lone file-level refund scalar from the POS spread when channel rows carry no refunds after merge. */
    if (merged.refund_volume != null) delete merged.refund_volume;
  }

  if (gv > grossEps && tf >= 0) {
    const revSnap = buildRevenueByChannelTable(merged);
    if (revSnap?.totals?.netBank != null && revSnap.totals.netBank > grossEps) {
      merged.net_revenue = Math.round(Number(revSnap.totals.netBank) * 100) / 100;
    } else {
      merged.net_revenue = Math.round((gv - refundTot - tf) * 100) / 100;
    }
    merged.effective_rate = gv > 0 ? Math.round((10000 * tf) / gv) / 100 : 0;
  }

  const posTxSrc =
    Array.isArray(posPd.pos_transactions) && posPd.pos_transactions.length > 0
      ? posPd.pos_transactions
      : posPd.raw_extracted?.pos_transactions ||
        posPd.raw_extracted_preview?.pos_transactions ||
        posPd.extracted?.pos_transactions ||
        (Array.isArray(posPd.transactions) && posPd.transactions.length > 0 ? posPd.transactions : null) ||
        posPd.raw_extracted?.transactions ||
        posPd.raw_extracted_preview?.transactions ||
        posPd.extracted?.transactions;
  if (Array.isArray(posTxSrc) && posTxSrc.length > 0) {
    merged.pos_transactions = cloneJson(posTxSrc);
  }
  const posDetSrc =
    Array.isArray(posPd.pos_transaction_details) && posPd.pos_transaction_details.length > 0
      ? posPd.pos_transaction_details
      : posPd.raw_extracted?.pos_transaction_details ||
        posPd.raw_extracted_preview?.pos_transaction_details ||
        posPd.extracted?.pos_transaction_details;
  if (Array.isArray(posDetSrc) && posDetSrc.length > 0) {
    merged.pos_transaction_details = cloneJson(posDetSrc);
  }

  const posCntMerged =
    _positiveTxnIntForMerge(posPd.pos_transaction_count) ??
    _positiveTxnIntForMerge(posPd.channel_split?.pos?.txn_count) ??
    _positiveTxnIntForMerge(posPd.raw_extracted?.pos_transaction_count) ??
    _positiveTxnIntForMerge(posPd.raw_extracted_preview?.pos_transaction_count) ??
    _positiveTxnIntForMerge(posPd.extracted?.pos_transaction_count);
  const eCntMerged =
    _positiveTxnIntForMerge(ecomPd.ecomm_transaction_count) ??
    _positiveTxnIntForMerge(ecomPd.ecommerce_transactions) ??
    _positiveTxnIntForMerge(ecomPd.channel_split?.cnp?.txn_count) ??
    _positiveTxnIntForMerge(ecomPd.raw_extracted?.ecomm_transaction_count) ??
    _positiveTxnIntForMerge(ecomPd.raw_extracted_preview?.ecomm_transaction_count) ??
    _positiveTxnIntForMerge(ecomPd.extracted?.ecomm_transaction_count);
  if (posCntMerged && eCntMerged) {
    merged.total_transactions = posCntMerged + eCntMerged;
    if (!_positiveTxnIntForMerge(merged.pos_transaction_count)) merged.pos_transaction_count = posCntMerged;
    if (!_positiveTxnIntForMerge(merged.ecomm_transaction_count)) merged.ecomm_transaction_count = eCntMerged;
  }

  const txnGenericSrc =
    Array.isArray(posPd.transactions) && posPd.transactions.length > 0
      ? posPd.transactions
      : posPd.raw_extracted?.transactions ||
        posPd.raw_extracted_preview?.transactions ||
        posPd.extracted?.transactions;
  if (Array.isArray(txnGenericSrc) && txnGenericSrc.length > 0 && !(Array.isArray(merged.transactions) && merged.transactions.length)) {
    merged.transactions = cloneJson(txnGenericSrc);
  }

  merged = applyLinkedBundlePosTxnInference(merged);
  if (parts?.reconciliation?.parsedData) {
    merged = overlayGoldenReconciliationWorkbook(merged, parts.reconciliation.parsedData);
  }
  return finalizeParsedForClient(merged);
}

/**
 * Merge bank reconciliation scalars from a cross-channel reconciliation workbook (golden layout)
 * onto a linked POS + e-commerce + bank statement so expected inflows, actual credits, and variance
 * are populated for the Discrepancy tab.
 * @param {object} mergedParsedData
 * @param {object|null|undefined} reconParsedData
 */
/**
 * Accept reconciliation uploads whose rows foot to `total_transaction_volume` even if the golden layout
 * flag was dropped during parse (API strips / augment edge cases).
 */
function reconciliationRollUpMatchesTotals(reconPd) {
  if (!reconPd?.channel_split?.pos || !reconPd?.channel_split?.cnp) return false;
  const gtv = Number(reconPd.total_transaction_volume);
  if (!(gtv > 0.005)) return false;
  const pg = channelSalesVolume(reconPd.channel_split.pos);
  const cg = channelSalesVolume(reconPd.channel_split.cnp);
  if (!(pg > 0.005) || !(cg > 0.005)) return false;
  return Math.abs(pg + cg - gtv) <= Math.max(5, 0.006 * gtv);
}

/**
 * When a golden reconciliation workbook is merged, copy its roll-up numbers onto `channel_split` rows so
 * headline gross / fees match the reconciliation sheet (POS + Shopify files alone can differ slightly).
 * Preserves merged extras (e.g. txn_count) not present on the golden row.
 * @param {object} mergedRow
 * @param {object} goldenRow
 */
function overlayGoldenReconciliationChannelRow(mergedRow, goldenRow) {
  if (!mergedRow || typeof mergedRow !== 'object') return mergedRow;
  if (!goldenRow || typeof goldenRow !== 'object') return mergedRow;
  const next = { ...mergedRow };
  const gv = goldenRow.volume ?? goldenRow.gross_volume ?? goldenRow.gross_sales;
  if (gv != null && Number(gv) > 0.005) {
    const v = Math.round(Number(gv) * 100) / 100;
    next.volume = v;
    next.gross_volume = v;
  }
  const rf = goldenRow.refund_volume ?? goldenRow.refunds;
  if (rf != null && Number(rf) > 0.005) next.refund_volume = Math.round(Number(rf) * 100) / 100;
  const fees = goldenRow.fees;
  if (fees != null && Number(fees) >= 0) next.fees = Math.round(Number(fees) * 100) / 100;
  const ns = goldenRow.net_settled_volume;
  if (ns != null && Number(ns) > 0.005) next.net_settled_volume = Math.round(Number(ns) * 100) / 100;
  const lab = goldenRow.channel_label;
  if (lab != null && String(lab).trim()) next.channel_label = String(lab).trim();
  return next;
}

export function overlayGoldenReconciliationWorkbook(mergedParsedData, reconParsedData) {
  if (!mergedParsedData || typeof mergedParsedData !== 'object') return mergedParsedData;
  if (!reconParsedData || typeof reconParsedData !== 'object') return mergedParsedData;
  const rollUpOk =
    reconParsedData.golden_reconciliation_workbook === true || reconciliationRollUpMatchesTotals(reconParsedData);
  if (!rollUpOk) return mergedParsedData;
  const out = { ...mergedParsedData };
  const round2 = (x) => {
    const v = Number(x);
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  };
  const bc = round2(reconParsedData.bank_credits_total_verified);
  const exp = round2(reconParsedData.reconciliation_total_deposits);
  const rv = reconParsedData.reconciliation_variance;
  const rvN = Number(rv);
  if (bc != null && bc > 0.005) out.bank_credits_total_verified = bc;
  if (exp != null && exp > 0.005) out.reconciliation_total_deposits = exp;
  if (Number.isFinite(rvN)) out.reconciliation_variance = round2(rvN);
  if (Array.isArray(reconParsedData.reconciliation_discrepancy_lines) && reconParsedData.reconciliation_discrepancy_lines.length) {
    out.reconciliation_discrepancy_lines = cloneJson(reconParsedData.reconciliation_discrepancy_lines);
  }

  const gtv = round2(reconParsedData.total_transaction_volume);
  if (gtv != null && gtv > 0.005) out.total_transaction_volume = gtv;

  const tfGolden = round2(reconParsedData.total_fees_charged);
  if (tfGolden != null && tfGolden >= 0) out.total_fees_charged = tfGolden;

  const rfGolden = reconParsedData.refund_volume;
  if (rfGolden != null && Number(rfGolden) > 0.005) {
    out.refund_volume = Math.round(Number(rfGolden) * 100) / 100;
  }

  const nrGolden = round2(reconParsedData.net_revenue);
  if (nrGolden != null && nrGolden > 0.005) out.net_revenue = nrGolden;

  const pnGolden = round2(reconParsedData.pos_net_deposit_volume);
  const enGolden = round2(reconParsedData.ecomm_net_deposit_volume);
  if (pnGolden != null && pnGolden > 0.005) out.pos_net_deposit_volume = pnGolden;
  if (enGolden != null && enGolden > 0.005) out.ecomm_net_deposit_volume = enGolden;

  const gcs = reconParsedData.channel_split;
  if (gcs && typeof gcs === 'object' && !Array.isArray(gcs) && gcs.pos && gcs.cnp && out.channel_split?.pos && out.channel_split?.cnp) {
    out.channel_split = {
      ...out.channel_split,
      pos: overlayGoldenReconciliationChannelRow(out.channel_split.pos, gcs.pos),
      cnp: overlayGoldenReconciliationChannelRow(out.channel_split.cnp, gcs.cnp),
      ...(out.channel_split.cash ? { cash: out.channel_split.cash } : {}),
    };
    const pg = channelRollupVolume(out.channel_split.pos, out);
    const cg = channelRollupVolume(out.channel_split.cnp, out);
    if (pg > getStatementHeuristics(out).linkedMerge.grossEps) out.pos_volume = pg;
    if (cg > getStatementHeuristics(out).linkedMerge.grossEps) out.ecomm_volume = cg;
  }

  const gvEff = Number(out.total_transaction_volume);
  const tfEff = Number(out.total_fees_charged);
  if (gvEff > 0 && tfEff >= 0) {
    out.effective_rate = Math.round((10000 * tfEff) / gvEff) / 100;
  }

  const prevUi = typeof out.report_ui === 'object' && out.report_ui && !Array.isArray(out.report_ui) ? out.report_ui : {};
  const plain = buildReconciliationVariancePlainEnglishExplanation(out);
  out.report_ui = {
    ...prevUi,
    reconciliation_variance_guidance: RECONCILIATION_VARIANCE_GUIDANCE_DEFAULT,
    ...(plain.length ? { reconciliation_plain_english_explanation: plain } : {}),
  };
  out.golden_reconciliation_workbook = true;
  return out;
}
