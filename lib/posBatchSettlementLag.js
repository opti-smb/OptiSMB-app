/**
 * POS batch → bank credit vs T+N business-day settlement (Mon–Fri).
 * Input: `parsedData.pos_settlement_batches` or `pos_batches` (from parser or tabular file augment).
 */

/** Read first non-empty field by exact key, then by keys normalized like `Batch Close Date` → `batch_close_date`. */
function _rowFieldLoose(row, keys) {
  if (!row || typeof row !== 'object') return null;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(row, k) && row[k] != null && row[k] !== '') return row[k];
  }
  const norm = Object.create(null);
  for (const rk of Object.keys(row)) {
    if (typeof rk !== 'string') continue;
    norm[rk.toLowerCase().replace(/\s+/g, '_')] = row[rk];
  }
  for (const k of keys) {
    const nk = String(k).toLowerCase().replace(/\s+/g, '_');
    const v = norm[nk];
    if (v != null && v !== '') return v;
  }
  return null;
}

function _validYmdParts(y, mo, da) {
  if (!(y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && da >= 1 && da <= 31)) return null;
  const d = new Date(y, mo - 1, da);
  if (Number.isNaN(d.getTime()) || d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
  return d;
}

function _parseIsoDate(s) {
  if (s == null || s === '') return null;
  if (typeof s === 'number' && Number.isFinite(s)) {
    const whole = Math.floor(Math.abs(s));
    if (whole >= 10000 && whole <= 800000) {
      const epoch = Date.UTC(1899, 11, 30);
      const ms = epoch + whole * 86400000;
      const d = new Date(ms);
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
  }
  const str = String(s).trim();
  if (!str) return null;

  const compactNum = str.replace(/,/g, '').match(/^(\d+)(?:\.(\d+))?$/);
  if (compactNum) {
    const whole = Math.floor(Number(compactNum[1]));
    if (whole >= 10000 && whole <= 800000) {
      const epoch = Date.UTC(1899, 11, 30);
      const ms = epoch + whole * 86400000;
      const d = new Date(ms);
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
  }

  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return _validYmdParts(Number(m[1]), Number(m[2]), Number(m[3]));

  const ymdSl = str.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\b/);
  if (ymdSl) return _validYmdParts(Number(ymdSl[1]), Number(ymdSl[2]), Number(ymdSl[3]));

  const us = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (us) {
    const a = Number(us[1]);
    const b = Number(us[2]);
    const yr = Number(us[3]);
    if (yr >= 1990 && yr <= 2100) {
      if (a > 12) {
        const d = _validYmdParts(yr, b, a);
        if (d) return d;
      }
      if (b > 12) {
        const d = _validYmdParts(yr, a, b);
        if (d) return d;
      }
      const md = _validYmdParts(yr, a, b);
      if (md) return md;
      const dm = _validYmdParts(yr, b, a);
      if (dm) return dm;
    }
  }

  const dmyDash = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmyDash) {
    const a = Number(dmyDash[1]);
    const b = Number(dmyDash[2]);
    const yr = Number(dmyDash[3]);
    if (a > 12) return _validYmdParts(yr, b, a);
    if (b > 12) return _validYmdParts(yr, a, b);
    const md = _validYmdParts(yr, a, b);
    if (md) return md;
    const dm = _validYmdParts(yr, b, a);
    if (dm) return dm;
  }

  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function _isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function _addBusinessDays(d, n) {
  const x = new Date(d);
  let left = Math.max(0, Math.floor(Number(n)) || 0);
  while (left > 0) {
    x.setDate(x.getDate() + 1);
    if (!_isWeekend(x)) left -= 1;
  }
  return x;
}

function _businessDaysAfter(deadline, actual) {
  if (!deadline || !actual || actual <= deadline) return 0;
  let n = 0;
  const d = new Date(deadline);
  d.setDate(d.getDate() + 1);
  while (d <= actual) {
    if (!_isWeekend(d)) n += 1;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

function _batchId(row) {
  if (!row || typeof row !== 'object') return '';
  const v =
    row.batch_number ??
    row.batch_id ??
    row.batch_num ??
    row.id ??
    row.batch ??
    row.reference;
  if (v == null || v === '') return '';
  return String(v).trim();
}

function _batchCloseDate(row) {
  const raw = _rowFieldLoose(row, [
    'batch_close_date',
    'batch_settlement_date',
    'settlement_date',
    'pos_settlement_date',
    'batch_date',
    'close_date',
    'funding_date',
    'batchCloseDate',
    'settlementDate',
    'closeDate',
    'batch_close',
    'settlement_close_date',
  ]);
  return _parseIsoDate(raw);
}

function _bankCreditDate(row) {
  const raw = _rowFieldLoose(row, [
    'bank_credit_date',
    'bank_deposit_date',
    'bank_posting_date',
    'deposit_date',
    'bank_statement_date',
    'value_date',
    'payout_date',
    'bankCreditDate',
    'depositDate',
    'credit_date',
    'bank_credit',
    'paid_out_date',
    'deposit_to_bank_date',
  ]);
  return _parseIsoDate(raw);
}

function _ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function _normPosBatchDedupeKey(row) {
  const id = _batchId(row);
  if (!id) return null;
  return id
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/** Prefer the row with more populated fee / gross / net fields when the same batch id appears in multiple arrays. */
function _posBatchRowMergeScore(row) {
  if (!row || typeof row !== 'object') return 0;
  let s = 0;
  const bump = (x) => {
    if (x == null || x === '') return;
    if (typeof x === 'number' && Number.isFinite(x)) s += 1;
    else if (typeof x === 'string' && x.trim()) s += 1;
  };
  bump(row.gross_sales);
  bump(row.batch_gross);
  bump(row.gross_volume);
  bump(row.fees);
  bump(row.processing_fee);
  bump(row.net_batch_deposit);
  bump(row.net_deposit);
  bump(row.batch_close_date);
  bump(row.transaction_count);
  const g = Number(row.gross_sales ?? row.batch_gross ?? row.gross_volume);
  const f = Number(row.fees ?? row.processing_fee);
  if (Number.isFinite(g) && g > 0) s += 3;
  if (Number.isFinite(f) && f >= 0) s += 3;
  return s;
}

/**
 * Merge POS batch arrays from every slot the parser / augment may fill — previously we returned only
 * the **first** non-empty list, which hid real batches behind a short stub list.
 */
function pickRawBatchRows(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return [];
  const lists = [
    parsedData.pos_settlement_batches,
    parsedData.pos_batches,
    parsedData.raw_extracted?.pos_settlement_batches,
    parsedData.raw_extracted?.pos_batches,
    parsedData.raw_extracted_preview?.pos_settlement_batches,
    parsedData.raw_extracted_preview?.pos_batches,
    parsedData.extracted?.pos_settlement_batches,
    parsedData.extracted?.pos_batches,
  ];
  /** @type {Map<string, object>} */
  const byKey = new Map();
  const noId = [];
  for (const L of lists) {
    if (!Array.isArray(L) || !L.length) continue;
    for (const row of L) {
      if (!row || typeof row !== 'object') continue;
      const k = _normPosBatchDedupeKey(row);
      if (!k) {
        noId.push(row);
        continue;
      }
      const prev = byKey.get(k);
      if (!prev || _posBatchRowMergeScore(row) > _posBatchRowMergeScore(prev)) byKey.set(k, row);
    }
  }
  if (!byKey.size && !noId.length) return [];
  return [...byKey.values(), ...noId];
}

function pickEcommerceSettlementRows(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return [];
  const lists = [
    parsedData.ecomm_settlement_orders,
    parsedData.ecommerce_settlement_orders,
    parsedData.ecommerce_orders,
    parsedData.ecomm_orders,
    parsedData.online_orders,
    parsedData.web_orders,
    parsedData.shopify_orders,
    parsedData.cnp_orders,
    parsedData.ecomm_transactions,
    parsedData.ecommerce_transactions,
    parsedData.cnp_transactions,
    parsedData.online_transactions,
    parsedData.ecomm_settlement_batches,
    parsedData.ecommerce_settlement_batches,
    parsedData.cnp_settlement_batches,
    parsedData.raw_extracted?.ecomm_settlement_orders,
    parsedData.raw_extracted?.ecommerce_orders,
    parsedData.raw_extracted?.ecomm_transactions,
    parsedData.raw_extracted?.ecomm_settlement_batches,
    parsedData.raw_extracted_preview?.ecomm_settlement_orders,
    parsedData.raw_extracted_preview?.ecomm_settlement_batches,
    parsedData.extracted?.ecomm_settlement_orders,
    parsedData.extracted?.ecommerce_orders,
    parsedData.extracted?.ecomm_settlement_batches,
  ];
  const out = [];
  for (const L of lists) {
    if (!Array.isArray(L) || !L.length) continue;
    for (const row of L) {
      if (row && typeof row === 'object') out.push(row);
    }
  }
  return out;
}

function _isEcommerceSummaryOrderId(id) {
  const s = String(id ?? '').trim();
  if (!s) return true;
  if (/^(total|totals|grand\s*total|subtotal|summary|net\s*total|gross\s*total)$/i.test(s)) return true;
  if (/^total[\s_-]/i.test(s)) return true;
  return false;
}

function _ecomOrderId(row) {
  if (!row || typeof row !== 'object') return '';
  const v =
    row.order_id ??
    row.batch_number ??
    row.batch_id ??
    row.order_number ??
    row.order_no ??
    row.transaction_id ??
    row.primary_id ??
    row.id;
  if (v == null || v === '') return '';
  const s = String(v).trim();
  return _isEcommerceSummaryOrderId(s) ? '' : s;
}

/** Activity / sale date for e‑commerce row (not bank posting). */
function _ecomActivityDate(row) {
  const raw =
    row.order_date ??
    row.order_datetime ??
    row.date_time ??
    row.datetime ??
    row.created_at ??
    row.created_date ??
    row.transaction_date ??
    row.txn_date ??
    row.sale_date ??
    row.purchase_date ??
    row.batch_close_date ??
    row.settlement_date ??
    row.pos_settlement_date;
  return _parseIsoDate(raw);
}

/** Raw POS settlement batch rows from the parse (same source as settlement lag). */
export function getPosSettlementBatchRows(parsedData) {
  return pickRawBatchRows(parsedData);
}

/**
 * Calendar-day settlement stats for batches with a batch-close date.
 * @returns {{ totalRows: number, datedPairs: number, missingBankCreditDate: number, maxCalendarDaysToBank: number }}
 */
export function getPosBatchSettlementCalendarStats(parsedData) {
  const raw = pickRawBatchRows(parsedData);
  let datedPairs = 0;
  let missingBankCreditDate = 0;
  let maxCalendarDaysToBank = 0;
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const posDate = _batchCloseDate(row);
    const bankDate = _bankCreditDate(row);
    if (!posDate) continue;
    if (!bankDate) {
      missingBankCreditDate += 1;
      continue;
    }
    datedPairs += 1;
    const cal = Math.round((bankDate - posDate) / 86400000);
    if (cal > maxCalendarDaysToBank) maxCalendarDaysToBank = cal;
  }
  return { totalRows: raw.length, datedPairs, missingBankCreditDate, maxCalendarDaysToBank };
}

/**
 * @param {object} parsedData
 * @returns {{ expectedBusinessDays: number, slow: object[], rawBatchCount: number, datedBatchCount: number, missingBatchCloseRows: { batchId: string }[], missingBankCreditRows: { batchId: string, batchCloseYmd: string }[] }}
 */
export function getSlowPosBatchSettlementRows(parsedData) {
  const empty = {
    expectedBusinessDays: 1,
    slow: [],
    rawBatchCount: 0,
    datedBatchCount: 0,
    missingBatchCloseRows: [],
    missingBankCreditRows: [],
  };
  if (!parsedData || typeof parsedData !== 'object') {
    return empty;
  }
  const raw = pickRawBatchRows(parsedData);
  if (!raw.length) {
    return empty;
  }

  const expectedBd = Math.max(
    0,
    Math.floor(Number(parsedData.pos_settlement_expected_business_days ?? parsedData.settlement_expected_business_days)) || 1,
  );

  const slow = [];
  const missingBatchCloseRows = [];
  const missingBankCreditRows = [];
  let datedBatchCount = 0;
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const posDate = _batchCloseDate(row);
    const bankDate = _bankCreditDate(row);
    const bid = _batchId(row) || '';
    if (!posDate) {
      if (bid && missingBatchCloseRows.length < 250) missingBatchCloseRows.push({ batchId: bid });
      continue;
    }
    if (!bankDate) {
      if (bid && missingBankCreditRows.length < 250) {
        missingBankCreditRows.push({ batchId: bid, batchCloseYmd: _ymd(posDate) });
      }
      continue;
    }

    datedBatchCount += 1;

    const latestOk = _addBusinessDays(posDate, expectedBd);
    if (bankDate <= latestOk) continue;

    const businessDaysPastT = _businessDaysAfter(latestOk, bankDate);
    const id = _batchId(row) || '—';
    const calendarDaysToSettle = Math.max(0, Math.round((bankDate - posDate) / 86400000));

    slow.push({
      batchId: id,
      calendarDaysToSettle,
      businessDaysPastT: businessDaysPastT,
      batchCloseYmd: _ymd(posDate),
      bankCreditYmd: _ymd(bankDate),
      latestOkYmd: _ymd(latestOk),
    });
  }

  return {
    expectedBusinessDays: expectedBd,
    slow,
    rawBatchCount: raw.length,
    datedBatchCount,
    missingBatchCloseRows,
    missingBankCreditRows,
  };
}

/**
 * Every POS batch row with both batch-close and bank-credit dates: batch id and calendar days to bank.
 * @param {object} parsedData
 * @returns {{ rows: { batchId: string, calendarDaysToBank: number, isSlow: boolean, batchCloseYmd: string, bankCreditYmd: string }[], rawBatchCount: number, datedBatchCount: number, missingBankCreditDate: number, expectedBusinessDays: number }}
 */
export function getPosBatchBankCalendarLagRows(parsedData) {
  const empty = {
    rows: [],
    rawBatchCount: 0,
    datedBatchCount: 0,
    missingBankCreditDate: 0,
    expectedBusinessDays: 1,
  };
  if (!parsedData || typeof parsedData !== 'object') return empty;
  const raw = pickRawBatchRows(parsedData);
  if (!raw.length) return empty;

  const expectedBd = Math.max(
    0,
    Math.floor(
      Number(parsedData.pos_settlement_expected_business_days ?? parsedData.settlement_expected_business_days),
    ) || 1,
  );

  const rows = [];
  let missingBankCreditDate = 0;

  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const posDate = _batchCloseDate(row);
    const bankDate = _bankCreditDate(row);
    if (!posDate) continue;
    if (!bankDate) {
      missingBankCreditDate += 1;
      continue;
    }
    const cal = Math.max(0, Math.round((bankDate - posDate) / 86400000));
    const latestOk = _addBusinessDays(posDate, expectedBd);
    rows.push({
      batchId: _batchId(row) || '—',
      calendarDaysToBank: cal,
      isSlow: bankDate > latestOk,
      batchCloseYmd: _ymd(posDate),
      bankCreditYmd: _ymd(bankDate),
    });
  }

  rows.sort(
    (a, b) =>
      a.batchCloseYmd.localeCompare(b.batchCloseYmd) || String(a.batchId).localeCompare(String(b.batchId)),
  );

  return {
    rows,
    rawBatchCount: raw.length,
    datedBatchCount: rows.length,
    missingBankCreditDate,
    expectedBusinessDays: expectedBd,
  };
}

/**
 * Max calendar days from activity / batch-close to bank credit used **only** to classify “calendar-slow” rows
 * together with T+N rules — not a bank-wide SLA. Parsed override: `settlement_calendar_ok_days` (1–14). Default 2 →
 * calendar span must exceed that allowance for the calendar flag (see report “late counts” copy).
 * @param {object | null | undefined} parsedData
 * @returns {number}
 */
export function getSettlementCalendarOkMaxDays(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return 2;
  const n = Math.floor(Number(parsedData.settlement_calendar_ok_days));
  if (!Number.isFinite(n)) return 2;
  return Math.min(14, Math.max(1, n));
}

/**
 * E‑commerce / CNP lines where bank credit arrived after T+N business days from the activity date.
 * Uses the same bank-date fields as POS; activity date prefers order / transaction / sale fields.
 * @returns {{ expectedBusinessDays: number, slow: { orderId: string, calendarDaysToSettle: number, activityYmd: string, bankCreditYmd: string, latestOkYmd: string, businessDaysPastT: number }[], rawOrderCount: number, datedPairCount: number, missingBankDate: number, missingActivityDate: number, missingActivityOrderIds: { orderId: string, bankCreditYmd: string | null }[], missingBankOrderRows: { orderId: string, activityYmd: string }[], allCalendarPairs: { orderId: string, calendarDays: number, activityYmd: string, bankCreditYmd: string }[] }}
 */
export function getSlowEcommerceSettlementRows(parsedData) {
  const empty = {
    expectedBusinessDays: 1,
    slow: [],
    rawOrderCount: 0,
    datedPairCount: 0,
    missingBankDate: 0,
    missingActivityDate: 0,
    missingActivityOrderIds: [],
    missingBankOrderRows: [],
    allCalendarPairs: [],
  };
  if (!parsedData || typeof parsedData !== 'object') return empty;
  const raw = pickEcommerceSettlementRows(parsedData);
  if (!raw.length) return empty;

  const expectedBd = Math.max(
    0,
    Math.floor(
      Number(
        parsedData.ecomm_settlement_expected_business_days ?? parsedData.settlement_expected_business_days,
      ),
    ) || 1,
  );

  let rawOrderCount = 0;
  for (const row of raw) {
    if (_ecomOrderId(row)) rawOrderCount += 1;
  }

  const slow = [];
  const allCalendarPairs = [];
  const missingActivityOrderIds = [];
  const missingBankOrderRows = [];
  let datedPairCount = 0;
  let missingBankDate = 0;
  let missingActivityDate = 0;

  for (const row of raw) {
    const orderId = _ecomOrderId(row);
    if (!orderId) continue;

    const act = _ecomActivityDate(row);
    const bankDate = _bankCreditDate(row);
    if (!act) {
      missingActivityDate += 1;
      if (missingActivityOrderIds.length < 250) {
        const bankOnly = _bankCreditDate(row);
        missingActivityOrderIds.push({
          orderId,
          bankCreditYmd: bankOnly ? _ymd(bankOnly) : null,
        });
      }
      continue;
    }
    if (!bankDate) {
      missingBankDate += 1;
      if (missingBankOrderRows.length < 250) missingBankOrderRows.push({ orderId, activityYmd: _ymd(act) });
      continue;
    }

    datedPairCount += 1;
    const calendarDaysToSettle = Math.max(0, Math.round((bankDate - act) / 86400000));
    if (allCalendarPairs.length < 4000) {
      allCalendarPairs.push({
        orderId,
        calendarDays: calendarDaysToSettle,
        activityYmd: _ymd(act),
        bankCreditYmd: _ymd(bankDate),
      });
    }
    const latestOk = _addBusinessDays(act, expectedBd);
    if (bankDate <= latestOk) continue;

    const calendarDaysForSlow = calendarDaysToSettle;
    slow.push({
      orderId,
      calendarDaysToSettle: calendarDaysForSlow,
      activityYmd: _ymd(act),
      bankCreditYmd: _ymd(bankDate),
      latestOkYmd: _ymd(latestOk),
      businessDaysPastT: _businessDaysAfter(latestOk, bankDate),
    });
  }

  slow.sort(
    (a, b) => a.activityYmd.localeCompare(b.activityYmd) || String(a.orderId).localeCompare(String(b.orderId)),
  );

  allCalendarPairs.sort(
    (a, b) => b.calendarDays - a.calendarDays || String(a.orderId).localeCompare(String(b.orderId)),
  );

  return {
    expectedBusinessDays: expectedBd,
    slow,
    rawOrderCount,
    datedPairCount,
    missingBankDate,
    missingActivityDate,
    missingActivityOrderIds,
    missingBankOrderRows,
    allCalendarPairs,
  };
}

function _posTxnActivityDate(row) {
  if (!row || typeof row !== 'object') return null;
  const raw =
    row.transaction_date ??
    row.txn_date ??
    row.date ??
    row.sale_date ??
    row.datetime ??
    row.created_at ??
    row.batch_close_date;
  return _parseIsoDate(raw);
}

function pickPosTransactionRowsForLag(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return [];
  const lists = [
    parsedData.pos_transactions,
    parsedData.raw_extracted?.pos_transactions,
    parsedData.raw_extracted_preview?.pos_transactions,
    parsedData.extracted?.pos_transactions,
  ];
  const out = [];
  for (const L of lists) {
    if (!Array.isArray(L)) continue;
    for (const row of L) {
      if (row && typeof row === 'object') out.push(row);
    }
  }
  return out;
}

function _posBatchRowNetForNarrative(row) {
  if (!row || typeof row !== 'object') return null;
  const direct = Number(row.net_batch_deposit ?? row.net_deposit ?? row.net ?? row.amount);
  if (Number.isFinite(direct) && Math.abs(direct) > 0.005) return Math.round(direct * 100) / 100;
  const g = Number(row.gross_sales ?? row.batch_gross ?? row.gross_volume);
  const f = Number(row.fees ?? row.processing_fee ?? 0);
  if (Number.isFinite(g) && g > 0.005) {
    const ff = Number.isFinite(f) ? f : 0;
    return Math.round((g - ff) * 100) / 100;
  }
  return null;
}

function _ecomRowNetForNarrative(row) {
  if (!row || typeof row !== 'object') return null;
  const direct = Number(
    row.net_settled_volume ?? row.net_amount ?? row.net ?? row.payout ?? row.settlement_amount ?? row.total_net,
  );
  if (Number.isFinite(direct) && Math.abs(direct) > 0.005) return Math.round(direct * 100) / 100;
  const g = Number(row.gross ?? row.order_total ?? row.total ?? row.amount ?? row.volume);
  const f = Number(row.fees ?? row.processing_fee ?? 0);
  if (Number.isFinite(g) && g > 0.005) {
    const ff = Number.isFinite(f) ? f : 0;
    return Math.round((g - ff) * 100) / 100;
  }
  return null;
}

/**
 * Batches / orders with activity dates but no bank credit date in the parse — used to explain
 * bank-vs-processor variance (funds still in flight across statement windows).
 * @returns {{
 *   pos: { pendingCount: number, latestPendingCloseYmd: string | null, pendingNetTotal: number | null, netKnownCount: number, expectedBusinessDays: number },
 *   ecom: { pendingCount: number, latestPendingActivityYmd: string | null, pendingNetTotal: number | null, netKnownCount: number, expectedBusinessDays: number },
 *   lastPosTxnYmd: string | null,
 * }}
 */
export function getPendingSettlementNarrativeFacts(parsedData) {
  const emptyPos = {
    pendingCount: 0,
    latestPendingCloseYmd: null,
    pendingNetTotal: null,
    netKnownCount: 0,
    expectedBusinessDays: 1,
  };
  const emptyEcom = {
    pendingCount: 0,
    latestPendingActivityYmd: null,
    pendingNetTotal: null,
    netKnownCount: 0,
    expectedBusinessDays: 1,
  };
  const out = { pos: { ...emptyPos }, ecom: { ...emptyEcom }, lastPosTxnYmd: null };
  if (!parsedData || typeof parsedData !== 'object') return out;

  const posLag = getSlowPosBatchSettlementRows(parsedData);
  out.pos.expectedBusinessDays = posLag.expectedBusinessDays;

  const pendingPos = [];
  const rawB = pickRawBatchRows(parsedData);
  for (const row of rawB) {
    if (!row || typeof row !== 'object') continue;
    const posDate = _batchCloseDate(row);
    const bankDate = _bankCreditDate(row);
    if (!posDate || bankDate) continue;
    const net = _posBatchRowNetForNarrative(row);
    pendingPos.push({ ymd: _ymd(posDate), net });
  }
  pendingPos.sort((a, b) => b.ymd.localeCompare(a.ymd));
  out.pos.pendingCount = pendingPos.length;
  out.pos.latestPendingCloseYmd = pendingPos.length ? pendingPos[0].ymd : null;
  let posNetSum = 0;
  let posNetN = 0;
  for (const p of pendingPos) {
    if (p.net != null && Number.isFinite(p.net)) {
      posNetSum += p.net;
      posNetN += 1;
    }
  }
  if (posNetN > 0) {
    out.pos.pendingNetTotal = Math.round(posNetSum * 100) / 100;
    out.pos.netKnownCount = posNetN;
  }

  const eLag = getSlowEcommerceSettlementRows(parsedData);
  out.ecom.expectedBusinessDays = eLag.expectedBusinessDays;

  const rawE = pickEcommerceSettlementRows(parsedData);
  const pendingEc = [];
  for (const row of rawE) {
    if (!row || typeof row !== 'object') continue;
    if (!_ecomOrderId(row)) continue;
    const act = _ecomActivityDate(row);
    const bankDate = _bankCreditDate(row);
    if (!act || bankDate) continue;
    const net = _ecomRowNetForNarrative(row);
    pendingEc.push({ ymd: _ymd(act), net });
  }
  pendingEc.sort((a, b) => b.ymd.localeCompare(a.ymd));
  out.ecom.pendingCount = pendingEc.length;
  out.ecom.latestPendingActivityYmd = pendingEc.length ? pendingEc[0].ymd : null;
  let ecNetSum = 0;
  let ecNetN = 0;
  for (const p of pendingEc) {
    if (p.net != null && Number.isFinite(p.net)) {
      ecNetSum += p.net;
      ecNetN += 1;
    }
  }
  if (ecNetN > 0) {
    out.ecom.pendingNetTotal = Math.round(ecNetSum * 100) / 100;
    out.ecom.netKnownCount = ecNetN;
  }

  let lastTxn = '';
  for (const row of pickPosTransactionRowsForLag(parsedData)) {
    const d = _posTxnActivityDate(row);
    if (!d) continue;
    const y = _ymd(d);
    if (!lastTxn || y > lastTxn) lastTxn = y;
  }
  out.lastPosTxnYmd = lastTxn || null;

  return out;
}

/**
 * POS batches to list under “delayed settlement”: **calendar** gap strictly exceeds `settlement_calendar_ok_days`,
 * plus T+N business-day slow rows **only when** the calendar span also exceeds that threshold (short calendar spans
 * with only a T+N flag are omitted).
 * @returns {{ batchId: string, calendarDaysToBank: number, batchCloseYmd: string, bankCreditYmd: string, flag: 'calendar' | 'business_T+N', businessDaysPastT?: number }[]}
 */
export function getPosSettlementDelayReportRows(parsedData) {
  const ok = getSettlementCalendarOkMaxDays(parsedData);
  const bank = getPosBatchBankCalendarLagRows(parsedData);
  const biz = getSlowPosBatchSettlementRows(parsedData);
  const map = new Map();
  for (const r of bank.rows) {
    if (r.calendarDaysToBank > ok) {
      map.set(`${String(r.batchId)}|${r.batchCloseYmd}`, {
        batchId: r.batchId,
        calendarDaysToBank: r.calendarDaysToBank,
        batchCloseYmd: r.batchCloseYmd,
        bankCreditYmd: r.bankCreditYmd,
        flag: 'calendar',
      });
    }
  }
  for (const s of biz.slow) {
    if (!(s.calendarDaysToSettle > ok)) continue;
    const key = `${String(s.batchId)}|${s.batchCloseYmd}`;
    if (!map.has(key)) {
      map.set(key, {
        batchId: s.batchId,
        calendarDaysToBank: s.calendarDaysToSettle,
        batchCloseYmd: s.batchCloseYmd,
        bankCreditYmd: s.bankCreditYmd,
        flag: 'business_T+N',
        businessDaysPastT: s.businessDaysPastT,
      });
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      b.calendarDaysToBank - a.calendarDaysToBank || String(a.batchId).localeCompare(String(b.batchId)),
  );
}

/**
 * E‑commerce orders whose **calendar** days from activity to bank credit are **strictly greater than**
 * `settlement_calendar_ok_days` (default 2 → **3+** calendar days). T+N-only rows with a 2‑day calendar span
 * are omitted so this table matches “more than two days to settle.”
 * @returns {{ orderId: string, calendarDays: number, activityYmd: string, bankCreditYmd: string, flag: 'calendar' | 'business_T+N', businessDaysPastT?: number }[]}
 */
export function getEcommerceSettlementDelayReportRows(parsedData) {
  const ok = getSettlementCalendarOkMaxDays(parsedData);
  const lag = getSlowEcommerceSettlementRows(parsedData);
  const map = new Map();
  for (const r of lag.allCalendarPairs || []) {
    if (r.calendarDays > ok) {
      map.set(`${String(r.orderId)}|${r.activityYmd}`, {
        orderId: r.orderId,
        calendarDays: r.calendarDays,
        activityYmd: r.activityYmd,
        bankCreditYmd: r.bankCreditYmd,
        flag: 'calendar',
      });
    }
  }
  for (const s of lag.slow || []) {
    if (!(s.calendarDaysToSettle > ok)) continue;
    const key = `${String(s.orderId)}|${s.activityYmd}`;
    if (!map.has(key)) {
      map.set(key, {
        orderId: s.orderId,
        calendarDays: s.calendarDaysToSettle,
        activityYmd: s.activityYmd,
        bankCreditYmd: s.bankCreditYmd,
        flag: 'business_T+N',
        businessDaysPastT: s.businessDaysPastT,
      });
    }
  }
  return [...map.values()].sort(
    (a, b) => b.calendarDays - a.calendarDays || String(a.orderId).localeCompare(String(b.orderId)),
  );
}
