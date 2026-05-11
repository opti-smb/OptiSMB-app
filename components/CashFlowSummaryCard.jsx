'use client';

import { Card } from '@/components/UI';
import { ReportSlugFooter } from '@/components/ReportSlugFooter';
import { formatMoney } from '@/lib/currencyConversion';
import { humanizeFieldKey } from '@/lib/utils';

/** Parsed currency field: null if absent or non-numeric (0 is valid). */
export function parsedBalanceAmount(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function hasCashFlowSummary(d) {
  if (!d) return false;
  return (
    parsedBalanceAmount(d.opening_balance) != null ||
    parsedBalanceAmount(d.closing_balance) != null ||
    parsedBalanceAmount(d.net_cash_flow) != null
  );
}

/** Bank / workbook reconciliation: opening & closing balance and net cash movement when extracted. */
export function CashFlowSummaryCard({ data, currency, className = '', slugId }) {
  if (!hasCashFlowSummary(data)) return null;
  const ob = parsedBalanceAmount(data.opening_balance);
  const cb = parsedBalanceAmount(data.closing_balance);
  const ncfParsed = parsedBalanceAmount(data.net_cash_flow);
  const ncfDerived =
    ncfParsed == null && ob != null && cb != null ? Math.round((cb - ob) * 100) / 100 : null;
  const netShow = ncfParsed != null ? ncfParsed : ncfDerived;
  const netDerived = ncfParsed == null && ncfDerived != null;

  const cell = (label, value, opts = {}) => {
    const { emphasize } = opts;
    const show = value != null;
    return (
      <div className={!show ? 'opacity-50' : ''}>
        <div className="text-[11px] smallcaps text-ink-400 mb-1">{label}</div>
        <div
          className={`font-mono tabular-nums text-xl ${emphasize ? 'text-ink font-medium' : 'text-ink'}`}
        >
          {show ? formatMoney(value, currency) : '—'}
        </div>
      </div>
    );
  };

  return (
    <Card id={slugId || undefined} className={`p-5 min-w-0 border border-ink/8 bg-cream-100/40 scroll-mt-28 ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <div className="smallcaps text-ink-400">Cash position</div>
          <div className="font-serif text-xl mt-0.5">Opening, net change, and closing balance</div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {cell(humanizeFieldKey('opening_balance'), ob)}
        {cell(humanizeFieldKey('net_cash_flow'), netShow, { emphasize: false })}
        {cell(humanizeFieldKey('closing_balance'), cb, { emphasize: true })}
      </div>
      {netDerived ? (
        <p className="text-[11px] text-ink-400 mt-4 leading-relaxed border-t border-ink/5 pt-3">
          Net cash flow is calculated as closing balance minus opening balance (statement did not include an
          explicit net cash line).
        </p>
      ) : null}
      {slugId ? <ReportSlugFooter id={slugId} /> : null}
    </Card>
  );
}
