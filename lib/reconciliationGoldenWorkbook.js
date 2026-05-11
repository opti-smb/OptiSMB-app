/**
 * Reconciliation Profile Intelligence (v2)
 * ----------------------------------------
 * Converts legacy "golden workbook" hardcoded reconciliation parsing
 * into a soft-profile semantic intelligence layer.
 *
 * IMPORTANT:
 * - Does NOT overwrite extraction output
 * - Does NOT directly parse authoritative values
 * - Only provides:
 *    - semantic hints
 *    - confidence boosts
 *    - profile metadata
 *    - reconciliation priors
 *    - candidate weighting
 *
 * Feature Flag:
 * OPTISMB_RECON_PROFILE=legacy|v2
 *
 * ## SpreadsheetBytes vs other uploads
 * The `xlsx` import below is **only** for turning **Excel workbook bytes** (.xlsx / .xls) into a 2D row matrix
 * so we can detect the OptiSMB **golden reconciliation grid** (“Revenue by channel”, …).
 * **CSV** exports of that same layout use {@link tryParseGoldenReconciliationCsvText} (no XLSX).
 * **PDF, images, proprietary exports** are not parsed in this file — they go through the Python `/api/parse`
 * service, which returns structured JSON (and may embed raw_extracted / tables separately).
 */

import { normHeaderCell as normCell } from './normHeaderCell.js';
import * as XLSXImport from 'xlsx';

const XLSX = /** @type {any} */ (XLSXImport).default ?? XLSXImport;

/**
 * Enhanced RFC-style CSV → string matrix with better support for different statement formats.
 * Handles quoted fields, escaped quotes, and various delimiters.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseDelimitedTextToMatrix(text) {
  const s = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cur = '';
  let i = 0;
  let inQ = false;
  let delimiter = detectDelimiter(s);
  
  function detectDelimiter(sample) {
    const firstLine = sample.split('\n')[0] || '';
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const pipeCount = (firstLine.match(/\|/g) || []).length;
    
    if (tabCount > commaCount && tabCount > semicolonCount) return '\t';
    if (pipeCount > commaCount && pipeCount > semicolonCount) return '|';
    if (semicolonCount > commaCount) return ';';
    return ',';
  }
  
  while (i < s.length) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQ = true;
      i++;
      continue;
    }
    if (c === delimiter) {
      row.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(cur.trim());
      rows.push(row);
      row = [];
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  row.push(cur.trim());
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}

/**
 * Same golden grid logic as {@link tryParseGoldenReconciliationWorkbookBuffer}, from an existing row matrix
 * (e.g. CSV or any caller that already built `string[][]`).
 * @param {unknown[][]} rows
 * @returns {object | null}
 */
export function tryParseGoldenReconciliationGrid(rows) {
  return parseGoldenReconciliationRows(rows);
}

/**
 * Golden reconciliation template saved/exported as **CSV** (comma-separated).
 * @param {string} text
 * @returns {object | null}
 */
export function tryParseGoldenReconciliationCsvText(text) {
  const matrix = parseDelimitedTextToMatrix(text);
  return parseGoldenReconciliationRows(matrix);
}

const RECON_PROFILE_SIGNALS = [
  'revenue by channel',
  'bank reconciliation',
  'expected bank inflow',
  'actual bank credits',
  'difference',
  'variance',
  'net to bank',
  'settled to bank',
];

const CHANNEL_HINTS = {
  pos: [
    'square',
    'pos',
    'terminal',
    'retail',
    'in-store',
    'instore',
  ],
  cnp: [
    'shopify',
    'online',
    'ecommerce',
    'e-comm',
    'cnp',
    'web',
  ],
};

function safeNum(v) {
  if (v == null || v === '') return null;

  if (typeof v === 'number' && Number.isFinite(v)) {
    return v;
  }

  const n = Number(String(v).replace(/[$,%(),]/g, '').trim());

  return Number.isFinite(n) ? n : null;
}

function normalizeText(v) {
  return normCell(String(v || ''));
}

function collectWorkbookSignals(rows) {
  const foundSignals = [];
  let score = 0;

  for (const row of rows) {
    if (!Array.isArray(row)) continue;

    for (const cell of row) {
      const txt = normalizeText(cell);

      if (!txt) continue;

      for (const sig of RECON_PROFILE_SIGNALS) {
        if (txt.includes(sig)) {
          foundSignals.push(sig);
          score += 1;
        }
      }
    }
  }

  return {
    signals: [...new Set(foundSignals)],
    rawScore: score,
  };
}

function detectChannelHints(rows) {
  const hints = {
    pos: 0,
    cnp: 0,
  };

  const matched = {
    pos: [],
    cnp: [],
  };

  for (const row of rows) {
    if (!Array.isArray(row)) continue;

    const joined = normalizeText(row.join(' '));

    for (const key of Object.keys(CHANNEL_HINTS)) {
      for (const hint of CHANNEL_HINTS[key]) {
        if (joined.includes(hint)) {
          hints[key] += 1;
          matched[key].push(hint);
        }
      }
    }
  }

  return {
    hints,
    matched,
  };
}

function detectReconciliationStructure(rows) {
  let hasRevenueSection = false;
  let hasBankSection = false;
  let hasVarianceSection = false;
  let hasTotals = false;

  for (const row of rows) {
    if (!Array.isArray(row)) continue;

    const txt = normalizeText(row.join(' '));

    if (txt.includes('revenue by channel')) {
      hasRevenueSection = true;
    }

    if (txt.includes('bank reconciliation')) {
      hasBankSection = true;
    }

    if (
      txt.includes('variance') ||
      txt.includes('difference')
    ) {
      hasVarianceSection = true;
    }

    if (
      txt.includes('total') &&
      /\d/.test(txt)
    ) {
      hasTotals = true;
    }
  }

  return {
    hasRevenueSection,
    hasBankSection,
    hasVarianceSection,
    hasTotals,
  };
}

function estimateProfileConfidence({
  signalScore,
  structure,
  channelHints,
}) {
  let confidence = 0;

  confidence += Math.min(signalScore * 0.05, 0.35);

  if (structure.hasRevenueSection) confidence += 0.15;
  if (structure.hasBankSection) confidence += 0.15;
  if (structure.hasVarianceSection) confidence += 0.10;
  if (structure.hasTotals) confidence += 0.10;

  if (channelHints.hints.pos > 0) confidence += 0.05;
  if (channelHints.hints.cnp > 0) confidence += 0.05;

  return Math.min(confidence, 0.95);
}

function inferSoftProfileHints(rows) {
  const softHints = [];

  for (const row of rows) {
    if (!Array.isArray(row)) continue;

    for (const cell of row) {
      const txt = normalizeText(cell);

      if (!txt) continue;

      if (
        txt.includes('gross') &&
        txt.includes('sales')
      ) {
        softHints.push({
          field: 'gross_sales',
          signal: txt,
          confidenceBoost: 0.04,
        });
      }

      if (
        txt.includes('fee') ||
        txt.includes('processing')
      ) {
        softHints.push({
          field: 'fees',
          signal: txt,
          confidenceBoost: 0.03,
        });
      }

      if (
        txt.includes('net') &&
        txt.includes('bank')
      ) {
        softHints.push({
          field: 'net_settlement',
          signal: txt,
          confidenceBoost: 0.05,
        });
      }

      if (
        txt.includes('refund')
      ) {
        softHints.push({
          field: 'refund_volume',
          signal: txt,
          confidenceBoost: 0.03,
        });
      }
    }
  }

  return softHints;
}

function buildProfileTrace({
  profileConfidence,
  signals,
  structure,
  channelHints,
  softHints,
}) {
  return {
    profile: 'reconciliation_workbook_v2',

    confidence: profileConfidence,

    matched_signals: signals,

    structure,

    channel_hints: channelHints,

    semantic_hints: softHints,

    timestamp: new Date().toISOString(),
  };
}

/**
 * Main reconciliation profile intelligence entrypoint.
 *
 * This DOES NOT parse authoritative financial output.
 * It only returns:
 * - semantic hints
 * - profile confidence
 * - reconciliation priors
 * - provenance
 *
 * @param {unknown[][]} rows
 * @returns {null | {
 *   profile: string,
 *   confidence: number,
 *   confidence_boosts: object[],
 *   semantic_hints: object[],
 *   reconciliation_priors: object,
 *   provenance: object
 * }}
 */
export function buildReconciliationProfile(rows) {
  if (!Array.isArray(rows) || rows.length < 5) {
    return null;
  }

  const {
    signals,
    rawScore,
  } = collectWorkbookSignals(rows);

  if (!signals.length) {
    return null;
  }

  const structure =
    detectReconciliationStructure(rows);

  const channelHints =
    detectChannelHints(rows);

  const profileConfidence =
    estimateProfileConfidence({
      signalScore: rawScore,
      structure,
      channelHints,
    });

  const softHints =
    inferSoftProfileHints(rows);

  const confidenceBoosts = [];

  if (structure.hasRevenueSection) {
    confidenceBoosts.push({
      area: 'revenue_detection',
      boost: 0.08,
      reason: 'revenue_by_channel_section',
    });
  }

  if (structure.hasBankSection) {
    confidenceBoosts.push({
      area: 'reconciliation_detection',
      boost: 0.10,
      reason: 'bank_reconciliation_section',
    });
  }

  if (channelHints.hints.pos > 0) {
    confidenceBoosts.push({
      area: 'pos_channel_detection',
      boost: 0.04,
      reason: 'pos_channel_terms_detected',
    });
  }

  if (channelHints.hints.cnp > 0) {
    confidenceBoosts.push({
      area: 'ecommerce_channel_detection',
      boost: 0.04,
      reason: 'ecommerce_channel_terms_detected',
    });
  }

  const reconciliationPriors = {
    expected_relationships: [
      'gross - fees ≈ net',
      'pos_net + ecommerce_net ≈ bank_credits',
      'gross ≈ pos + ecommerce',
    ],

    tolerances: {
      reconciliation: 0.02,
      fees: 0.03,
      totals: 0.015,
    },
  };

  const provenance = buildProfileTrace({
    profileConfidence,
    signals,
    structure,
    channelHints,
    softHints,
  });

  return {
    profile: 'reconciliation_workbook_v2',

    confidence: profileConfidence,

    confidence_boosts: confidenceBoosts,

    semantic_hints: softHints,

    reconciliation_priors: reconciliationPriors,

    provenance,
  };
}

/**
 * Optional integration helper.
 *
 * Applies soft profile boosts
 * WITHOUT overwriting extraction values.
 *
 * @param {object} payload
 * @param {object|null} profile
 * @returns {object}
 */
export function applyReconciliationProfile(
  payload,
  profile
) {
  if (!payload || !profile) {
    return payload;
  }

  const existingIssues = Array.isArray(payload.parse_issues)
    ? payload.parse_issues
    : [];

  return {
    ...payload,

    profile_intelligence: {
      reconciliation_profile: {
        profile: profile.profile,
        confidence: profile.confidence,
        provenance: profile.provenance,
      },
    },

    parse_issues: [
      ...existingIssues,
      ...(profile.confidence >= 0.7
        ? []
        : [
            {
              type: 'low_reconciliation_profile_confidence',
              severity: 'info',
            },
          ]),
    ],

    parsing_confidence_breakdown: {
      ...(payload.parsing_confidence_breakdown || {}),

      reconciliation_profile:
        profile.confidence,
    },
  };
}

// ── Legacy golden workbook extraction (authoritative roll-ups from OptiSMB template) ──────────────

/**
 * Resolve headline net for golden workbook “total” row vs Σ channel net-to-bank (see formula tests).
 * @param {{ totalGross?: number, totalFees?: number, totalRefunds?: number, totalRowNetSales?: number, sumChannelNetBank?: number }} input
 */
export function inferGoldenWorkbookNetRevenue(input) {
  if (!input || typeof input !== 'object') return 0;
  const trns = Number(input.totalRowNetSales);
  const sb = Number(input.sumChannelNetBank);
  const tf = Number(input.totalFees);
  if (!Number.isFinite(sb)) return Number.isFinite(trns) ? Math.round(trns * 100) / 100 : 0;
  const tol = Math.max(0.5, 0.002 * Math.max(Math.abs(trns), Math.abs(sb), 1));
  if (Number.isFinite(trns) && Math.abs(trns - sb) <= tol) return Math.round(sb * 100) / 100;
  if (Number.isFinite(trns) && Number.isFinite(tf) && Math.abs(trns - tf - sb) <= tol) return Math.round(sb * 100) / 100;
  return Math.round(sb * 100) / 100;
}

function rowText(rows, i, colIdx) {
  const r = rows[i];
  if (!Array.isArray(r) || colIdx == null || colIdx < 0) return '';
  const v = r[colIdx];
  if (v == null) return '';
  return String(v).trim();
}

/**
 * Parse “Revenue by channel” grid through optional Total row; requires POS + CNP rows by channel hints.
 * @param {unknown[][]} rows
 */
function parseGoldenReconciliationRows(rows) {
  if (!Array.isArray(rows) || rows.length < 10) return null;

  let revAnchor = -1;
  let bankAnchor = -1;
  for (let i = 0; i < rows.length; i++) {
    const c0 = normCell(rows[i]?.[0]);
    if (revAnchor < 0 && c0.includes('revenue by channel')) revAnchor = i;
    if (c0.includes('bank reconciliation')) bankAnchor = i;
  }
  if (revAnchor < 0 || bankAnchor < 0 || bankAnchor <= revAnchor) return null;

  let headerIdx = -1;
  /** @type {Record<string, number>} */
  const col = {};
  for (let i = revAnchor + 1; i < Math.min(revAnchor + 15, rows.length); i++) {
    const r = rows[i];
    if (!Array.isArray(r)) continue;
    const hdr = r.map(normCell);
    const hasChannelLike = hdr.some(
      (h) =>
        h === 'channel' ||
        h.includes('channel') ||
        h.includes('merchant') ||
        h.includes('seller') ||
        h.includes('segment') ||
        h.includes('location'),
    );
    const hasGrossLike = hdr.some(
      (h) =>
        (h.includes('gross') && (h.includes('sales') || h.includes('revenue') || h.includes('volume'))) ||
        h === 'gross sales' ||
        (h.includes('total') && h.includes('gross')) ||
        h.includes('gmv') ||
        (h.includes('card') && (h.includes('sales') || h.includes('turnover'))) ||
        (h.includes('sales') && h.includes('volume')) ||
        (h.includes('order') && h.includes('total')),
    );
    if (!hasChannelLike || !hasGrossLike) continue;
    headerIdx = i;
    for (let j = 0; j < r.length; j++) {
      const h = normCell(r[j]);
      if (h === 'channel' || (h.includes('channel') && !h.includes('fee'))) col.channel = j;
      if (
        (h.includes('gross') && (h.includes('sales') || h.includes('revenue') || h.includes('volume'))) ||
        h === 'gross sales' ||
        (h.includes('total') && h.includes('gross')) ||
        h.includes('gmv') ||
        (h.includes('card') && (h.includes('sales') || h.includes('turnover'))) ||
        (h.includes('sales') && h.includes('volume') && !h.includes('fee')) ||
        (h.includes('order') && h.includes('total') && !h.includes('fee') && !h.includes('net'))
      )
        col.gross = j;
      if (h === 'refunds' || h.includes('refund')) col.refunds = j;
      if (h.includes('net') && (h.includes('sales') || h.includes('revenue'))) col.netSales = j;
      if (
        h === 'fees' ||
        (h.includes('fee') && !h.includes('refund')) ||
        h.includes('processing cost') ||
        h.includes('card costs')
      )
        col.fees = j;
      if (
        (h.includes('net') && (h.includes('bank') || h.includes('payout') || h.includes('deposit'))) ||
        h.includes('net to bank') ||
        h === 'payout' ||
        h.includes('settled to bank')
      )
        col.netBank = j;
    }
    if (col.channel != null && col.gross != null) break;
    headerIdx = -1;
  }
  if (headerIdx < 0 || col.channel == null || col.gross == null) return null;

  /** @type {{ slot: 'pos'|'cnp', name: string, gross: number, refunds: number, netSales: number, fees: number, netBank: number }[]} */
  const chans = [];
  let totalGross = 0;
  let totalFees = 0;
  let totalRefunds = 0;
  let totalNetBankSum = 0;
  let totalRowNetSales = 0;
  let sawTotal = false;

  for (let i = headerIdx + 1; i < rows.length && i < bankAnchor; i++) {
    const r = rows[i];
    if (!Array.isArray(r)) break;
    const name = rowText(rows, i, col.channel);
    if (!name) continue;
    const lname = normCell(name);
    if (lname.includes('total') && !lname.includes('sub')) {
      sawTotal = true;
      if (col.netSales != null) totalRowNetSales = safeNum(r[col.netSales]) ?? 0;
      continue;
    }
    if (lname.includes('section') || lname.includes('---')) continue;

    const gross = safeNum(r[col.gross]) ?? 0;
    const refunds = col.refunds != null ? safeNum(r[col.refunds]) ?? 0 : 0;
    const fees = col.fees != null ? safeNum(r[col.fees]) ?? 0 : 0;
    let netSales = col.netSales != null ? safeNum(r[col.netSales]) : null;
    const netBank = col.netBank != null ? safeNum(r[col.netBank]) : null;
    if (netSales == null && gross > 0) netSales = Math.round((gross - refunds) * 100) / 100;

    let slot = null;
    if (CHANNEL_HINTS.pos.some((hint) => lname.includes(hint))) slot = 'pos';
    else if (CHANNEL_HINTS.cnp.some((hint) => lname.includes(hint))) slot = 'cnp';
    if (!slot) continue;

    const nb = netBank ?? (netSales != null && fees >= 0 ? Math.round((netSales - fees) * 100) / 100 : 0);
    chans.push({
      slot,
      name,
      gross,
      refunds,
      netSales: netSales ?? 0,
      fees,
      netBank: nb ?? 0,
    });
    totalGross += gross;
    totalFees += fees;
    totalRefunds += refunds;
    totalNetBankSum += nb ?? 0;
  }

  if (chans.length < 2) return null;
  const pos = chans.find((c) => c.slot === 'pos');
  const cnp = chans.find((c) => c.slot === 'cnp');
  if (!pos || !cnp) return null;

  const sumChannelNetBank = pos.netBank + cnp.netBank;
  const trnsForInfer = sawTotal && totalRowNetSales > 0 ? totalRowNetSales : pos.netSales + cnp.netSales;
  const net_revenue = inferGoldenWorkbookNetRevenue({
    totalGross,
    totalFees,
    totalRefunds,
    totalRowNetSales: trnsForInfer,
    sumChannelNetBank,
  });

  let reconciliation_total_deposits = totalNetBankSum;
  let bank_credits_total_verified = totalNetBankSum;
  for (let i = bankAnchor; i < Math.min(bankAnchor + 40, rows.length); i++) {
    const r = rows[i];
    if (!Array.isArray(r)) continue;
    const k = normCell(r[0]);
    const v = safeNum(r[1]);
    if (v == null) continue;
    if (k.includes('expected') && k.includes('bank')) reconciliation_total_deposits = v;
    if (k.includes('actual') && (k.includes('credit') || k.includes('deposit'))) bank_credits_total_verified = v;
  }
  const reconciliation_variance = Math.round((reconciliation_total_deposits - bank_credits_total_verified) * 100) / 100;

  const eff =
    totalGross > 0 && totalFees >= 0 ? Math.round((10000 * totalFees) / totalGross) / 100 : null;

  return {
    golden_reconciliation_workbook: true,
    total_transaction_volume: Math.round(totalGross * 100) / 100,
    total_fees_charged: Math.round(totalFees * 100) / 100,
    refund_volume: Math.round(totalRefunds * 100) / 100,
    net_revenue,
    effective_rate: eff,
    channel_split: {
      pos: {
        channel_label: pos.name,
        volume: pos.gross,
        gross_volume: pos.gross,
        refund_volume: pos.refunds,
        fees: pos.fees,
        net_settled_volume: pos.netBank,
      },
      cnp: {
        channel_label: cnp.name,
        volume: cnp.gross,
        gross_volume: cnp.gross,
        refund_volume: cnp.refunds,
        fees: cnp.fees,
        net_settled_volume: cnp.netBank,
      },
    },
    pos_net_deposit_volume: pos.netBank,
    ecomm_net_deposit_volume: cnp.netBank,
    reconciliation_total_deposits,
    bank_credits_total_verified,
    reconciliation_variance,
  };
}

/**
 * Parse OptiSMB golden reconciliation layout from **Excel** workbook bytes (.xlsx / .xls).
 * For **CSV** exports of the same layout, use {@link tryParseGoldenReconciliationCsvText}.
 * @param {Uint8Array} u8
 * @returns {object | null}
 */
export function tryParseGoldenReconciliationWorkbookBuffer(u8) {
  if (!u8 || !(u8 instanceof Uint8Array) || u8.length < 64) return null;
  try {
    const wb = XLSX.read(u8, { type: 'array', cellDates: false });
    const names = wb.SheetNames || [];
    for (let s = 0; s < names.length; s++) {
      const ws = wb.Sheets[names[s]];
      if (!ws) continue;
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      const parsed = parseGoldenReconciliationRows(rows);
      if (parsed) return parsed;
    }
    return null;
  } catch {
    return null;
  }
}