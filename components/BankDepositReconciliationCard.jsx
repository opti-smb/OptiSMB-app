'use client';

import { Card } from '@/components/UI';
import { formatMoney } from '@/lib/currencyConversion';
import { parsedBalanceAmount } from '@/components/CashFlowSummaryCard';

/** True when the parse included Section B–style bank deposit / bank credit lines (not POS net alone). */
export function hasBankDepositReconciliation(d) {
  if (!d) return false;
  return (
    parsedBalanceAmount(d.reconciliation_total_deposits) != null ||
    parsedBalanceAmount(d.bank_credits_pos_statement) != null ||
    parsedBalanceAmount(d.bank_credits_ecomm_statement) != null ||
    parsedBalanceAmount(d.bank_credits_total_verified) != null ||
    parsedBalanceAmount(d.reconciliation_variance) != null
  );
}

export function BankDepositReconciliationCard({ data, currency, className = '' }) {
  if (!hasBankDepositReconciliation(data)) return null;

  const posNet = parsedBalanceAmount(data.pos_net_deposit_volume);
  const ecNet = parsedBalanceAmount(data.ecomm_net_deposit_volume);
  const totalDep = parsedBalanceAmount(data.reconciliation_total_deposits);
  const bankPos = parsedBalanceAmount(data.bank_credits_pos_statement);
  const bankEc = parsedBalanceAmount(data.bank_credits_ecomm_statement);
  const bankTot = parsedBalanceAmount(data.bank_credits_total_verified);
  const variance = parsedBalanceAmount(data.reconciliation_variance);

  const posBatches = Number(data.pos_settlement_batch_count);
  const ecOrders = Number(data.ecomm_transaction_count ?? data.ecomm_net_deposit_order_count);

  const row = (label, value, opts = {}) => {
    const { emphasize, sub } = opts;
    const show = value != null;
    return (
      <div
        className={`flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 py-2 border-b border-ink/6 last:border-0 ${emphasize ? 'bg-cream-200/30 -mx-2 px-2 rounded' : ''}`}
      >
        <div>
          <div className="text-[12px] text-ink leading-snug">{label}</div>
          {sub != null && sub !== '' ? (
            <div className="text-[11px] text-ink-400 mt-0.5">{sub}</div>
          ) : null}
        </div>
        <div
          className={`font-mono tabular-nums text-right text-lg shrink-0 ${emphasize ? 'text-ink font-medium' : 'text-ink'}`}
        >
          {show ? formatMoney(value, currency) : '—'}
        </div>
      </div>
    );
  };

  return (
    <Card className={`p-5 min-w-0 border border-ink/8 bg-cream-100/40 ${className}`}>
      <div className="mb-4">
        <div className="smallcaps text-ink-400">Reconciliation</div>
        <div className="font-serif text-xl mt-0.5">Bank deposit reconciliation</div>
        <p className="text-[12px] text-ink-400 mt-2 leading-relaxed">
          Net amounts settled to your bank vs credits on the bank statement (when present in the uploaded
          workbook).
        </p>
      </div>
      <div className="space-y-0">
        {row('POS net deposits to bank', posNet, {
          sub:
            Number.isFinite(posBatches) && posBatches > 0 ? `${posBatches} batch${posBatches === 1 ? '' : 'es'}` : null,
        })}
        {row('E-commerce net deposits to bank', ecNet, {
          sub:
            Number.isFinite(ecOrders) && ecOrders > 0 ? `${ecOrders} order${ecOrders === 1 ? '' : 's'}` : null,
        })}
        {row('Total deposits (expect to match bank credits)', totalDep, { emphasize: true })}
        {row('Bank credits — POS (per bank statement)', bankPos)}
        {row('Bank credits — E-commerce (per bank statement)', bankEc)}
        {row('Total bank credits verified', bankTot, { emphasize: true })}
        {row('Variance', variance, {
          emphasize: variance != null && Math.abs(variance) > 0.005,
        })}
      </div>
    </Card>
  );
}
