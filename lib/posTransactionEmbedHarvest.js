/**
 * Harvest POS-style **line rows** from embedded tabular shapes in parser payloads (PDF, image, CSV, XLSX).
 * Converts array-of-array tables and `{ headers, rows }` blobs into plain objects so
 * {@link pickPosTransactionArrays} + semantic header mapping see the same row shape for every file type.
 * Does not inspect English row text — only structure (2D grids / explicit header+body tables).
 */

import { normalizeStatementHeader } from './statementHeaderNormalize.js';

/** @type {Set<string>} */
const SKIP_SUBTREE_KEYS = new Set([
  'fee_lines',
  'bank_transactions',
  'account_transactions',
  'deposit_transactions',
  'bank_ledger_lines',
  'raw_bank_lines',
  'ecomm_settlement_orders',
  'ecommerce_orders',
  'ecomm_transactions',
  'ecomm_settlement_batches',
  'cnp_transactions',
  'online_transactions',
  'discrepancies',
  'benchmarks',
  'parse_issues',
  'card_mix',
  'card_brand_mix',
  'linked_statement_bundle',
  'golden_reconciliation_workbook',
  'workbook_sheet_roles',
  'channel_split',
]);

const MAX_GRID_BODY_ROWS = 8000;
const MAX_TOTAL_HARVESTED_ROWS = 6000;
const MAX_WALK_DEPTH = 10;

/** @param {unknown} cell @param {number} idx */
function columnKeyFromHeaderCell(cell, idx) {
  const raw = String(cell ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) return `col_${idx}`;
  const norm = normalizeStatementHeader(raw);
  let base = norm && norm.length > 0 ? norm.replace(/\s+/g, '_') : `col_${idx}`;
  if (base.length > 120) base = `${base.slice(0, 117)}_`;
  return base;
}

/**
 * @param {unknown[]} headerRow
 * @param {unknown[][]} bodyRows
 * @returns {object[]}
 */
export function gridToRowObjects(headerRow, bodyRows) {
  if (!Array.isArray(headerRow) || headerRow.length < 2) return [];
  const keys = [];
  const used = new Set();
  for (let i = 0; i < headerRow.length; i += 1) {
    let k = columnKeyFromHeaderCell(headerRow[i], i);
    let base = k;
    let n = 2;
    while (used.has(k)) {
      k = `${base}_${n}`;
      n += 1;
    }
    used.add(k);
    keys.push(k);
  }
  const out = [];
  let nBody = 0;
  for (const row of bodyRows) {
    if (!Array.isArray(row)) continue;
    if (nBody >= MAX_GRID_BODY_ROWS) break;
    const o = {};
    for (let c = 0; c < keys.length; c += 1) {
      o[keys[c]] = row[c] ?? null;
    }
    out.push(o);
    nBody += 1;
  }
  return out;
}

/**
 * @param {unknown[][]} grid
 * @returns {boolean}
 */
function isRectangular2DGrid(grid) {
  return (
    Array.isArray(grid) &&
    grid.length >= 2 &&
    grid.every((r) => Array.isArray(r)) &&
    grid[0].length >= 2 &&
    grid.every((r) => r.length === grid[0].length)
  );
}

/**
 * @param {unknown} node
 * @returns {object[]}
 */
function tryKeyedHeaderBodyTable(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [];
  const headers =
    node.headers ??
    node.columns ??
    node.column_headers ??
    node.columnNames ??
    node.column_names ??
    null;
  const body =
    node.rows ??
    node.data ??
    node.body ??
    node.values ??
    node.row_values ??
    null;
  if (!Array.isArray(headers) || headers.length < 2 || !Array.isArray(body) || body.length < 1) return [];
  if (body.length && Array.isArray(body[0])) {
    return gridToRowObjects(headers, /** @type {unknown[][]} */ (body));
  }
  if (body.length && body[0] && typeof body[0] === 'object' && !Array.isArray(body[0])) {
    return body.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
  }
  return [];
}

/**
 * @param {unknown[]} node
 * @returns {object[]}
 */
function tryArrayAsGridOrGridList(node) {
  if (!Array.isArray(node) || node.length < 1) return [];
  if (node.length && node.every((el) => isRectangular2DGrid(el))) {
    const out = [];
    for (const g of node) {
      const grid = /** @type {unknown[][]} */ (g);
      const hdr = grid[0];
      const body = grid.slice(1);
      out.push(...gridToRowObjects(hdr, body));
    }
    return out;
  }
  if (node.length === 1 && isRectangular2DGrid(node[0])) {
    const grid = /** @type {unknown[][]} */ (node[0]);
    return gridToRowObjects(grid[0], grid.slice(1));
  }
  if (isRectangular2DGrid(node)) {
    const grid = /** @type {unknown[][]} */ (node);
    return gridToRowObjects(grid[0], grid.slice(1));
  }
  return [];
}

/**
 * Walk `parsedData` (and nested `raw_extracted` / preview / `extracted`) for 2D grids and header/body tables.
 * @param {object|null|undefined} parsedData
 * @returns {object[]}
 */
export function collectEmbeddedGridPosRowObjects(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return [];
  /** @type {WeakSet<unknown>} */
  const gridRefs = new WeakSet();
  const harvested = [];

  const pushRows = (rows) => {
    if (!Array.isArray(rows) || !rows.length) return;
    for (const r of rows) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
      if (harvested.length >= MAX_TOTAL_HARVESTED_ROWS) return;
      harvested.push(r);
    }
  };

  const tryHarvestValue = (v) => {
    if (!v || typeof v !== 'object' || !Array.isArray(v)) return;
    if (gridRefs.has(v)) return;
    const fromGrid = tryArrayAsGridOrGridList(v);
    if (fromGrid.length) {
      gridRefs.add(v);
      pushRows(fromGrid);
    }
  };

  /**
   * @param {unknown} node
   * @param {number} depth
   */
  function walk(node, depth) {
    if (node == null || depth > MAX_WALK_DEPTH || harvested.length >= MAX_TOTAL_HARVESTED_ROWS) return;
    if (Array.isArray(node)) {
      tryHarvestValue(node);
      if (isRectangular2DGrid(node)) return;
      if (node.length === 1 && isRectangular2DGrid(node[0])) return;
      if (node.length && node.every((el) => isRectangular2DGrid(el))) return;
      for (const el of node) {
        if (el != null && typeof el === 'object') walk(el, depth + 1);
      }
      return;
    }
    if (typeof node !== 'object') return;

    const keyedRows = tryKeyedHeaderBodyTable(node);
    if (keyedRows.length) {
      pushRows(keyedRows);
      return;
    }

    for (const [k, v] of Object.entries(node)) {
      if (SKIP_SUBTREE_KEYS.has(k)) continue;
      if (v == null || typeof v !== 'object') continue;
      walk(v, depth + 1);
    }
  }

  /** Prefer nested extract blobs (PDF / image / OCR) so we do not duplicate rows already on `parsedData.pos_transactions`. */
  const roots = [
    parsedData.raw_extracted,
    parsedData.raw_extracted_preview,
    parsedData.extracted,
  ].filter((x) => x && typeof x === 'object');
  for (const k of [
    'tables',
    'grids',
    'embedded_tables',
    'document_tables',
    'parse_tables',
    'sheet_matrices',
    'extracted_tables',
  ]) {
    const v = parsedData[k];
    if (v && typeof v === 'object') roots.push(v);
  }

  for (const r of roots) walk(r, 0);

  return harvested;
}
