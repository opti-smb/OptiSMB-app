/**
 * Infer whether an upload is POS, e-commerce / CNP, or a bank statement — from file name,
 * tab names (tabular), and parsed JSON (after /api/parse).
 */

import { workbookSheetRole } from '@/lib/augmentPosBatchesFromXlsx';

function n(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

/** @returns {Promise<string[]>} */
export async function readWorkbookSheetNamesFromFile(file) {
  const ext = String(file?.name || '')
    .split('.')
    .pop()
    ?.toLowerCase();
  if (!['xlsx', 'xls', 'csv'].includes(ext || '')) return [];
  try {
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', bookSheets: true });
    return Array.isArray(wb.SheetNames) ? [...wb.SheetNames] : [];
  } catch {
    return [];
  }
}

function scoreSheetNames(sheetNames) {
  let pos = 0;
  let ecommerce = 0;
  let bank = 0;
  let reconciliation = 0;
  const reasons = [];
  if (!Array.isArray(sheetNames)) return { pos, ecommerce, bank, reconciliation, reasons };
  for (const sn of sheetNames) {
    const r = workbookSheetRole(sn);
    if (r === 'pos') {
      pos += 3;
      reasons.push(`tab “${sn}” → POS`);
    } else if (r === 'ecommerce') {
      ecommerce += 3;
      reasons.push(`tab “${sn}” → e-commerce`);
    } else if (r === 'bank') {
      bank += 4;
      reasons.push(`tab “${sn}” → bank`);
    } else if (r === 'reconciliation') {
      reconciliation += 6;
      reasons.push(`tab “${sn}” → reconciliation`);
    } else if (r === 'summary') {
      pos += 1;
      ecommerce += 1;
    }
  }
  return { pos, ecommerce, bank, reconciliation, reasons };
}

function scoreFileName(fileName) {
  const fn = String(fileName || '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  let pos = 0;
  let ecommerce = 0;
  let bank = 0;
  let reconciliation = 0;
  const reasons = [];

  if (/\breconciliation\b|\breconcile\b|\bcross[-\s]?channel\b/.test(fn)) {
    reconciliation += 12;
    reasons.push('file name suggests cross-channel reconciliation workbook');
  }

  if (/\bshopify\b|\be-?commerce\b|\becom\b|\bonline\b|\border\s*export\b|\border\s*detail\b|\bcnp\b|\bgateway\b|\bweb\s*store\b/.test(fn)) {
    ecommerce += 6;
    reasons.push('file name suggests e-commerce / Shopify');
  }
  if (/\bsquare\b|\bpos\b|\bpoint\s*of\s*sale\b|\bterminal\b|\bclover\b|\bdaily\s*summary\b|\bin-?store\b/.test(fn)) {
    pos += 6;
    reasons.push('file name suggests POS / terminal');
  }
  if (
    /\bbank\b/.test(fn) &&
    (/\bstatement\b|\bchecking\b|\bcommercial\b|\baccount\b|\bnational\b|\bfdic\b|\bcredit\s*union\b/.test(fn) ||
      /\bfirst\s+national\b/.test(fn))
  ) {
    bank += 7;
    reasons.push('file name suggests bank statement');
  } else if (/\bbank\s*statement\b|\bchecking\s*account\b/.test(fn)) {
    bank += 5;
    reasons.push('file name suggests bank');
  }

  return { pos, ecommerce, bank, reconciliation, reasons };
}

function scoreParsedData(parsedData) {
  let pos = 0;
  let ecommerce = 0;
  let bank = 0;
  let reconciliation = 0;
  const reasons = [];
  if (!parsedData || typeof parsedData !== 'object') return { pos, ecommerce, bank, reconciliation, reasons };

  if (parsedData.golden_reconciliation_workbook) {
    reconciliation += 22;
    reasons.push('cross-channel reconciliation workbook layout detected');
  }

  const bt = parsedData.bank_transactions;
  if (Array.isArray(bt) && bt.length >= 2) {
    bank += 10;
    reasons.push(`${bt.length} bank transaction lines`);
  } else if (Array.isArray(bt) && bt.length === 1) {
    bank += 4;
    reasons.push('bank transaction lines present');
  }

  if (n(parsedData.bank_credits_total_verified) > 0.5) {
    bank += 3;
    reasons.push('bank credits total on parse');
  }

  const orders = parsedData.ecomm_settlement_orders;
  if (Array.isArray(orders) && orders.length >= 2) {
    ecommerce += 6;
    reasons.push(`${orders.length} e-commerce settlement orders`);
  }

  const batches = parsedData.pos_settlement_batches;
  if (Array.isArray(batches) && batches.length >= 1) {
    pos += 5;
    reasons.push(`${batches.length} POS settlement batch rows`);
  }

  const cs = parsedData.channel_split;
  if (cs && typeof cs === 'object' && !Array.isArray(cs)) {
    const pv = n(cs.pos?.volume ?? cs.pos?.gross_volume ?? cs.pos?.gross_sales);
    const cv = n(cs.cnp?.volume ?? cs.ecommerce?.volume ?? cs.online?.volume ?? cs.cnp?.gross_volume);
    const pf = n(cs.pos?.fees);
    const cf = n(cs.cnp?.fees ?? cs.ecommerce?.fees);
    if (pv > 100 && cv < 50 && pf >= 0) {
      pos += 4;
      reasons.push('channel_split dominated by POS');
    }
    if (cv > 100 && pv < 50 && cf >= 0) {
      ecommerce += 4;
      reasons.push('channel_split dominated by online / CNP');
    }
    if (pv > 50 && cv > 50) {
      pos += 1;
      ecommerce += 1;
    }
  }

  const aq = String(parsedData.acquirer_name || '').toLowerCase();
  if (/\bshopify\b|\bstripe\b.*shopify\b/.test(aq)) {
    ecommerce += 3;
    reasons.push('acquirer / processor label → online');
  }
  if (/\bsquare\b|\bclover\b/.test(aq)) {
    pos += 3;
    reasons.push('acquirer / processor label → POS');
  }
  if (/\bbank\b|\bnational\b|\bfirst\s+national\b|\bchecking\b/.test(aq)) {
    bank += 3;
    reasons.push('acquirer label → bank');
  }

  const roles = parsedData.workbook_sheet_roles;
  if (Array.isArray(roles)) {
    for (const row of roles) {
      if (row?.role === 'bank') bank += 2;
      if (row?.role === 'pos') pos += 2;
      if (row?.role === 'ecommerce') ecommerce += 2;
      if (row?.role === 'reconciliation') reconciliation += 3;
    }
    if (roles.length) reasons.push('workbook tab roles from parser');
  }

  return { pos, ecommerce, bank, reconciliation, reasons };
}

/**
 * One workbook/file shows POS + e-commerce + bank together (tabs, channel split + bank lines, or balanced scores).
 * @param {object | null} parsedData
 * @param {{ pos: number; ecommerce: number; bank: number; reconciliation: number }} scores
 * @returns {boolean}
 */
function inferTripleSetInOneFile(parsedData, scores) {
  if (!parsedData || typeof parsedData !== 'object') return false;
  const roles = parsedData.workbook_sheet_roles;
  if (Array.isArray(roles) && roles.length >= 3) {
    const set = new Set(roles.map((r) => String(r?.role || '').toLowerCase()));
    if (set.has('pos') && set.has('ecommerce') && set.has('bank')) return true;
  }
  const n = (x) => {
    const v = Number(x);
    return Number.isFinite(v) ? v : 0;
  };
  const cs = parsedData.channel_split;
  if (cs && typeof cs === 'object' && !Array.isArray(cs)) {
    const posVol = n(cs.pos?.volume ?? cs.pos?.gross_volume ?? cs.pos?.gross_sales) > 50;
    const cnpVol =
      n(cs.cnp?.volume ?? cs.ecommerce?.volume ?? cs.online?.volume ?? cs.cnp?.gross_volume) > 50;
    const bankish =
      (Array.isArray(parsedData.bank_transactions) && parsedData.bank_transactions.length >= 2) ||
      n(parsedData.bank_credits_total_verified) > 0.5;
    if (posVol && cnpVol && bankish) return true;
  }
  if (scores.pos >= 6 && scores.ecommerce >= 6 && scores.bank >= 6) return true;
  return false;
}

/**
 * Short confirmation for individual uploads (toast title / banner).
 * @param {'pos' | 'ecommerce' | 'bank' | 'triple_set' | 'reconciliation'} category
 */
export function statementCategoryUploadedLabel(category) {
  switch (category) {
    case 'pos':
      return 'POS uploaded';
    case 'ecommerce':
      return 'E-commerce uploaded';
    case 'bank':
      return 'Bank uploaded';
    case 'triple_set':
      return 'POS, e-commerce & bank (one file) uploaded';
    case 'reconciliation':
      return 'Reconciliation uploaded';
    default:
      return 'Statement uploaded';
  }
}

/**
 * @param {{ fileName: string; sheetNames?: string[]; parsedData?: object | null }} input
 * @returns {{ role: 'pos' | 'ecommerce' | 'bank' | 'reconciliation'; statementCategory: 'pos' | 'ecommerce' | 'bank' | 'triple_set' | 'reconciliation'; confidence: 'high' | 'medium' | 'low'; reasons: string[]; scores: { pos: number; ecommerce: number; bank: number; reconciliation: number } }}
 */
export function inferStatementRole(input) {
  const fileName = input.fileName || '';
  const sheetNames = input.sheetNames || [];
  const parsedData = input.parsedData || null;

  const sn = scoreSheetNames(sheetNames);
  const fn = scoreFileName(fileName);
  const pd = scoreParsedData(parsedData);

  const scores = {
    pos: sn.pos + fn.pos + pd.pos,
    ecommerce: sn.ecommerce + fn.ecommerce + pd.ecommerce,
    bank: sn.bank + fn.bank + pd.bank,
    reconciliation: sn.reconciliation + fn.reconciliation + pd.reconciliation,
  };

  const reasons = [...new Set([...fn.reasons, ...sn.reasons, ...pd.reasons])].slice(0, 8);
  const max = Math.max(scores.pos, scores.ecommerce, scores.bank, scores.reconciliation);
  const sorted = [scores.pos, scores.ecommerce, scores.bank, scores.reconciliation].sort((a, b) => b - a);
  const second = sorted[1] || 0;
  const margin = max - second;

  const fnLower = String(fileName).toLowerCase();
  const reconNameBias = /\breconciliation\b|\breconcile\b|\bcross[-\s]?channel\b/.test(fnLower);

  let role = 'pos';
  if (scores.reconciliation >= max && scores.reconciliation >= 8) {
    role = 'reconciliation';
  } else if (scores.reconciliation >= scores.bank && scores.reconciliation >= 8 && reconNameBias && scores.bank < scores.reconciliation + 3) {
    role = 'reconciliation';
  } else if (scores.bank >= scores.pos && scores.bank >= scores.ecommerce && scores.bank >= scores.reconciliation) {
    role = 'bank';
  } else if (scores.ecommerce >= scores.pos && scores.ecommerce >= scores.bank && scores.ecommerce >= scores.reconciliation) {
    role = 'ecommerce';
  } else {
    role = 'pos';
  }

  let statementCategory =
    role === 'reconciliation'
      ? 'reconciliation'
      : inferTripleSetInOneFile(parsedData, scores)
        ? 'triple_set'
        : role === 'bank'
          ? 'bank'
          : role === 'ecommerce'
            ? 'ecommerce'
            : 'pos';

  let confidence = 'low';
  if (max >= 10 && margin >= 3) confidence = 'high';
  else if (max >= 6 && margin >= 2) confidence = 'medium';
  else if (max >= 4) confidence = 'medium';

  return { role, statementCategory, confidence, reasons, scores };
}

/**
 * When scores are ambiguous, assign to the first empty slot in POS → e-commerce → bank → reconciliation order.
 * @param {{ pos: unknown; ecommerce: unknown; bank: unknown; reconciliation?: unknown }} linkedParts
 * @param {'pos'|'ecommerce'|'bank'|'reconciliation'} inferred
 */
export function resolveRoleWhenSlotTaken(linkedParts, inferred) {
  if (!linkedParts[inferred]) return inferred;
  const order = ['pos', 'ecommerce', 'bank', 'reconciliation'];
  for (const r of order) {
    if (!linkedParts[r]) return r;
  }
  return inferred;
}
