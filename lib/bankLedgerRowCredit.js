/**
 * Shared extraction of **credit / deposit** dollars from heterogeneous bank ledger rows.
 * Used by {@link finalizeParsedForClient} repair and {@link splitBankTransactionsByChannel}.
 */

const EPS = 0.02;

function num(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : NaN;
}

/**
 * @param {object|null|undefined} row
 * @returns {number|null} Positive credit amount, or null if not a credit row.
 */
export function pickBankLedgerRowCreditAmount(row) {
  if (!row || typeof row !== 'object') return null;

  const c = num(
    row.credit ??
      row.credit_amount ??
      row.Credit ??
      row.deposit ??
      row.deposit_amount ??
      row.Deposit ??
      row.amount_in ??
      row.payment_amount ??
      row.credits ??
      row.credit_amt ??
      row.cr_amount,
  );
  if (c != null && c > EPS) return Math.round(c * 100) / 100;

  const debitVal = num(
    row.debit ?? row.debit_amount ?? row.Debit ?? row.withdrawal ?? row.Withdrawal ?? row.dr_amount,
  );
  const amt = num(
    row.amount ?? row.Amount ?? row.value ?? row.transaction_amount ?? row.trx_amount ?? row.running_amount,
  );

  /** Bank exports with a Type column (Credit / Debit) and a single Amount column. */
  const typeEarly = String(row.transaction_type ?? row.Type ?? row.type ?? row.dr_cr ?? '').toLowerCase();
  if (typeEarly.includes('credit') && amt != null && Math.abs(amt) > EPS) {
    return Math.round(Math.abs(amt) * 100) / 100;
  }
  if (typeEarly.includes('debit') || typeEarly.includes('withdraw')) return null;

  if (amt != null && amt > EPS) {
    const t = String(
      row.transaction_type ?? row.type ?? row.dr_cr ?? row.dc ?? row.side ?? row.entry_type ?? row.category ?? '',
    ).toLowerCase();
    if (
      t.includes('credit') ||
      t.includes('deposit') ||
      t.includes('received') ||
      t === 'cr' ||
      t === 'c' ||
      t === 'inflow'
    ) {
      return Math.round(amt * 100) / 100;
    }
    if (t.includes('debit') || t.includes('withdraw') || t === 'dr' || t === 'd') return null;
    if (!Number.isFinite(debitVal) || debitVal < EPS) {
      const memo = String(
        row.description ??
          row.memo ??
          row.narrative ??
          row.detail ??
          row.payee ??
          row.transaction_description ??
          row.Name ??
          row.name ??
          '',
      ).toLowerCase();
      if (
        memo.includes('deposit') ||
        memo.includes('credit') ||
        memo.includes('transfer in') ||
        memo.includes('ach credit') ||
        memo.includes('wire in') ||
        memo.includes('merchant') ||
        memo.includes('settlement') ||
        memo.includes('square') ||
        memo.includes('shopify') ||
        memo.includes('stripe') ||
        memo.includes('payout') ||
        memo.includes('funding') ||
        memo.includes('processor')
      ) {
        return Math.round(amt * 100) / 100;
      }
    }
  }

  if (amt != null && amt < -EPS && (!Number.isFinite(debitVal) || debitVal < EPS)) {
    const memo = String(
      row.description ?? row.memo ?? row.Name ?? row.name ?? '',
    ).toLowerCase();
    if (memo.includes('deposit') || memo.includes('credit') || memo.includes('payout')) {
      return Math.round(-amt * 100) / 100;
    }
  }

  return null;
}
