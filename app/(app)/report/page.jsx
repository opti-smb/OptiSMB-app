'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as Icon from '@/components/Icons';
import { Card, KPI, Btn, Pill, TierGate, Disclaimer } from '@/components/UI';
import { DonutChart, HBar } from '@/components/Charts';
import { useApp } from '@/components/AppContext';
import { useToast } from '@/components/Toast';
import {
  tierOk,
  downloadCSV,
  triggerPrint,
  reconcileTotalFeesCharged,
  overviewPrimarySalesVolumeGross,
  getFeeLineOverviewRows,
  getChannelVolumeBarsFromParsed,
  channelSalesVolume,
  channelSplitCashRowDisplayVolume,
  channelSplitRowGrossForAggregate,
  resolveChannelSplitBucket,
  getParsedIdentity,
  displayBusinessName,
  cardMixRowDisplayId,
  feeLineCardDisplayId,
  feeLineDisplayLabel,
  feeLineResolvedCardLabel,
  feeLineRowAmount,
  getRevenueByChannelPosEcom,
  buildBankReconciliationRows,
  buildPlainEnglishSummaryLines,
  channelBucketDisplayLabels,
  humanizeFieldKey,
  settlementDisplayRoles,
  isTabularStatementFileName,
  getStatementStructureNarrative,
  RECONCILIATION_VARIANCE_GUIDANCE_DEFAULT,
  isSyntheticInterchangeSchemeProcessorFeeLine,
} from '@/lib/utils';
import { getOverviewNetRevenueDisplay } from '@/lib/overviewMetrics';
import { CashFlowSummaryCard } from '@/components/CashFlowSummaryCard';
import { formatMoney, formatCompactMoney, getStatementDisplayCurrency } from '@/lib/currencyConversion';
import { finalizeParsedForClient } from '@/lib/statementFinalize';
import { posNetDepositTotal, effectiveRatePercentFromTotals } from '@/lib/financialAnalysisFormulas';
import {
  getSlowPosBatchSettlementRows,
  getPosBatchBankCalendarLagRows,
  getSlowEcommerceSettlementRows,
  getSettlementCalendarOkMaxDays,
  getPosSettlementDelayReportRows,
  getEcommerceSettlementDelayReportRows,
} from '@/lib/posBatchSettlementLag';
import {
  getEcommerceCommissionSpotlight,
  getPosBatchCommissionAnalysis,
  buildEcomSpotlightReportUi,
  buildPosSpotlightReportUi,
  getEcommerceStatementOrderMetrics,
  buildEcomOrderUploadMetricsUi,
  pickPosTransactionArrays,
  aggregatePosPaymentLabelsFromPosTxnRows,
} from '@/lib/posBatchCommissionAnalysis';
import { getBankStatementPosEcomChargeSummary } from '@/lib/bankStatementChannelSplit';
import { reportSectionSlug, slugifyReportHeading } from '@/lib/reportSlugs';
import { ReportSlugFooter } from '@/components/ReportSlugFooter';
import { buildStatementClientModel } from '@/lib/statementClientModel';

const TABS = [
  { k: 'overview', l: 'Overview' },
  { k: 'breakdown', l: 'Fee Breakdown' },
  { k: 'channel', l: 'Channel Split' },
  { k: 'discrepancy', l: 'Discrepancy' },
  { k: 'qa', l: 'Q&A', tier: 'L1' },
];

/** Compact `channel_split` row fingerprint so report `useMemo` invalidates across different uploads (not only headline totals). */
function channelSplitRowFingerprint(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    v: row.volume,
    gv: row.gross_volume ?? row.gross_sales,
    sgv: row.statement_gross_volume,
    rf: row.refund_volume ?? row.refunds,
    f: row.fees,
    ns: row.net_settled_volume,
    disc: row.discount_volume ?? row.discounts ?? row.total_discounts,
    nts: row.net_sales ?? row.net_sales_volume ?? row.total_net_sales,
    lab: String(row.channel_label || row.label || row.name || '').slice(0, 48),
  };
}

function feeLineDisplayAmount(row) {
  const a = feeLineRowAmount(row);
  return Number.isFinite(a) ? a : Number(row?.amount);
}

/**
 * When `parsedData` is updated in place (same object reference), useMemo that only lists `stmt.parsedData` will not
 * re-run; these fields affect finalize + bank vs channel split. Recomputes when they change.
 */
function parsedDataFinalizeDeps(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return '';
  try {
    const cs = parsedData.channel_split;
    return JSON.stringify({
      bcv: parsedData.bank_credits_total_verified,
      ttv: parsedData.total_transaction_volume,
      pn: parsedData.pos_net_deposit_volume,
      en: parsedData.ecomm_net_deposit_volume,
      g: parsedData.golden_reconciliation_workbook,
      lb: parsedData.linked_statement_bundle
        ? (typeof parsedData.linked_statement_bundle === 'object' ? '1' : String(parsedData.linked_statement_bundle))
        : null,
      posNb: cs?.pos?.net_settled_volume,
      cnpNb: cs?.cnp?.net_settled_volume,
      posGv: cs?.pos?.gross_volume ?? cs?.pos?.gross_sales,
      cnpGv: cs?.cnp?.gross_volume ?? cs?.cnp?.gross_sales,
      bankLines: Array.isArray(parsedData.bank_transactions) ? parsedData.bank_transactions.length : 0,
      rtd: parsedData.reconciliation_total_deposits,
      rv: parsedData.reconciliation_variance,
      ptv: parsedData.refund_volume,
      tfc: parsedData.total_fees_charged,
      nr: parsedData.net_revenue,
      nri: parsedData.net_revenue_inferred,
      ch:
        cs && typeof cs === 'object' && !Array.isArray(cs)
          ? {
              pos: channelSplitRowFingerprint(cs.pos),
              cnp: channelSplitRowFingerprint(cs.cnp),
              cash: channelSplitRowFingerprint(cs.cash),
            }
          : null,
    });
  } catch {
    return '';
  }
}

const FEE_OVERVIEW_COLORS = ['#0F1B2D', '#00A88A', '#B8770B', '#8B94A3', '#5B6B7F', '#3D5A80', '#9A4D6A', '#8B6914', '#4A6741', '#6B4E71'];

const TAB_ICON = {
  overview: Icon.LayoutDashboard,
  breakdown: Icon.Receipt,
  channel: Icon.CreditCard,
  discrepancy: Icon.AlertTriangle,
  qa: Icon.Sparkles,
};

/** Card with stable `id` and visible permalink slug (new sections: add a unique `id` segment). */
function ReportCard({ id, className = '', children }) {
  return (
    <Card id={id} className={`scroll-mt-28 ${className}`}>
      {children}
      <ReportSlugFooter id={id} />
    </Card>
  );
}

// ── Overview Tab ────────────────────────────────────────────────────
function TabOverview({ stmt }) {
  const d = useMemo(
    () => (stmt?.parsedData ? finalizeParsedForClient(stmt.parsedData) : null),
    [stmt?.id, stmt?.parsedData, parsedDataFinalizeDeps(stmt?.parsedData)],
  );
  if (!d) return null;
  const displayCcy = getStatementDisplayCurrency(d);
  const { total: feeTotal } = reconcileTotalFeesCharged(d);
  const gv = overviewPrimarySalesVolumeGross(d);
  const comp = getFeeLineOverviewRows(d);
  const feeParts = comp.map((p, i) => ({
    label: p.label,
    value: Math.max(0, p.value),
    color: FEE_OVERVIEW_COLORS[i % FEE_OVERVIEW_COLORS.length],
    feeSlug: p.feeSlug,
  }));
  const compSum = feeParts.reduce((s, p) => s + p.value, 0);
  /** Same basis as the fee donut: Σ displayed slices when present, else reconciled `total_fees_charged` (no scaling to force a match). */
  const overviewFeesTotal = compSum > 0.01 ? compSum : feeTotal;
  const feeChartVsReconciled =
    compSum > 0.01 && Math.abs(compSum - feeTotal) > 0.5
      ? `${stmt.period} · Fee chart ${formatMoney(compSum, displayCcy)} (sum of rows shown); reconciled total ${formatMoney(feeTotal, displayCcy)} for effective rate tie-out`
      : compSum > 0.01
        ? `${stmt.period} · Same basis as reconciled processor fees`
        : `${stmt.period} · From reconciled total_fees_charged`;
  const impliedNet = gv > 0 && overviewFeesTotal >= 0 ? posNetDepositTotal(gv, overviewFeesTotal) : null;
  const netKpi = getOverviewNetRevenueDisplay(d, impliedNet);
  const netAfter = netKpi.amount;
  const netSub = netKpi.sub;
  /** Donut center + “% of fees” share the same total as the KPI when slices are shown. */
  const pctBase = overviewFeesTotal > 0 ? overviewFeesTotal : feeTotal;
  const donutData =
    compSum > 0
      ? feeParts.map((p) => ({ value: Math.max(0, p.value), color: p.color }))
      : [{ value: 1, color: 'rgba(15,27,45,0.12)' }];
  const impliedEff = effectiveRatePercentFromTotals(overviewFeesTotal, gv);
  const parsedEr = Number(d.effective_rate);
  const parsedErOk =
    d.effective_rate != null &&
    d.effective_rate !== '' &&
    Number.isFinite(parsedEr) &&
    !(parsedEr === 0 && overviewFeesTotal > 0.01 && gv > 0);
  let eff = impliedEff != null ? impliedEff : parsedErOk ? parsedEr : null;
  if (eff != null && !Number.isFinite(eff)) eff = null;

  const channelBars = getChannelVolumeBarsFromParsed(d, { statementCategory: stmt?.statementCategory });
  const barMax = Math.max(...channelBars.map((x) => x.value), 1);
  const hBarData = channelBars.map((x) => ({
    ...x,
    display: x.value > 0 ? formatCompactMoney(x.value, displayCcy) : '—',
  }));

  return (
    <div className="flex flex-col gap-5">
      <CashFlowSummaryCard
        data={d}
        currency={displayCcy}
        slugId={reportSectionSlug('overview', 'cash-flow')}
      />
      <section id={reportSectionSlug('overview', 'kpis')} className="scroll-mt-28 space-y-2">
        <ReportSlugFooter id={reportSectionSlug('overview', 'kpis')} variant="inline" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <Card className="min-w-0">
          <KPI
            label="Total fees charged"
            value={formatMoney(overviewFeesTotal, displayCcy)}
            sub={feeChartVsReconciled}
            big
          />
        </Card>
        <Card className="min-w-0">
          <KPI
            label={
              stmt?.statementCategory === 'pos' &&
              !(Array.isArray(stmt?.linkedSourceFiles) && stmt.linkedSourceFiles.length > 0)
                ? 'Gross volume'
                : 'Total sales volume'
            }
            value={formatMoney(gv, displayCcy)}
            sub={
              stmt?.statementCategory === 'pos' &&
              !(Array.isArray(stmt?.linkedSourceFiles) && stmt.linkedSourceFiles.length > 0)
                ? 'POS gross from this file — Channel / Discrepancy use the same roll-up when available'
                : 'POS gross + e‑commerce gross (processor card sales; cash and refunds are in the volume bars below)'
            }
            big
          />
        </Card>
        <Card className="min-w-0">
          <KPI
            label={netKpi.kpiLabel}
            value={netAfter != null ? formatMoney(netAfter, displayCcy) : '—'}
            sub={netSub}
            subSecondary={netKpi.subSecondary ?? undefined}
            big
          />
        </Card>
        <Card className="min-w-0">
          <KPI
            label="Effective rate"
            value={eff != null ? `${eff.toFixed(2)}%` : '—'}
            sub="total fees above ÷ sales volume above"
            tone="amber"
            big
          />
        </Card>
      </div>
      </section>
      <ReportCard id={reportSectionSlug('overview', 'channel-volumes')} className="p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
          <div>
            <div className="smallcaps text-ink-400">Volumes</div>
            <div className="font-serif text-2xl">Sales volumes</div>
            {stmt?.statementCategory === 'pos' &&
            !(Array.isArray(stmt?.linkedSourceFiles) && stmt.linkedSourceFiles.length > 0) ? (
              <p className="text-[12px] text-ink-500 mt-1 max-w-2xl leading-snug">
                Single POS upload — bars reflect this file. Linked POS + e‑commerce + bank uses the combined parse.
              </p>
            ) : null}
          </div>
          {channelBars.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-ink-400 max-w-xl justify-end">
              {channelBars.map((b) => (
                <span key={b.label} className="flex items-center gap-1.5">
                  <span className="dot shrink-0" style={{ background: b.color }} />
                  <span className="truncate max-w-[10rem]" title={b.label}>{b.label}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        {channelBars.length === 0 ? (
          <p className="text-[13px] text-ink-400">No channel_split volumes, pos_volume, ecomm_volume, cash_volume, or refund_volume in parsed data.</p>
        ) : (
          <HBar data={hBarData} max={barMax} />
        )}
        <p className="text-[12px] text-ink-400 mt-4 leading-relaxed">
          Bars are ordered <span className="font-medium text-ink-600">refunds</span>,{' '}
          <span className="font-medium text-ink-600">cash</span>, <span className="font-medium text-ink-600">e‑commerce</span>, then{' '}
          <span className="font-medium text-ink-600">POS</span> when those segments exist. Values come from{' '}
          <span className="font-mono">channel_split</span> (and top-level volume fields when the split is empty).
        </p>
      </ReportCard>
      <ReportCard id={reportSectionSlug('overview', 'fee-donut')} className="p-6">
        <div className="mb-5">
          <div className="smallcaps text-ink-400">Fees</div>
          <div className="font-serif text-2xl">Processor fees on this statement</div>
          <p className="text-[12px] text-ink-400 mt-2 leading-relaxed">
            Rows follow the parse in this order: itemized <span className="font-mono">fee_lines</span> (statement wording
            when present), else named totals: <span className="font-mono">interchange_fees</span>,{' '}
            <span className="font-mono">scheme_fees</span>, <span className="font-mono">service_fees</span>,{' '}
            <span className="font-mono">other_fees</span>, and any extra buckets in <span className="font-mono">fee_totals_by_slug</span>{' '}
            (stable snake_case slugs; optional <span className="font-mono">fee_slug_labels</span> for display names), else{' '}
            <span className="font-mono">channel_split</span> POS / e‑commerce fees, else a single reconciled{' '}
            <span className="font-mono">total_fees_charged</span> slice. Amounts are not scaled to force the slices to match
            the header when line items disagree. The <span className="font-medium text-ink-600">Fee Breakdown</span> tab lists
            the same rows. <span className="font-medium text-ink-600">· n%</span> is each slice&apos;s share of the fee chart
            total (not of sales).
          </p>
        </div>
        <div className="flex justify-center">
          <DonutChart
            size={200}
            data={donutData}
            center={{
              value: formatCompactMoney(overviewFeesTotal, displayCcy),
              label: 'TOTAL FEES',
            }}
          />
        </div>
        <div className="mt-5 space-y-2 text-[13px]">
          {feeParts.length === 0 ? (
            <p className="text-ink-400 text-[13px]">No fee lines or totals on this statement.</p>
          ) : (
            <>
              {feeParts.map((p, i) => (
                <div
                  key={`fee-${p.feeSlug ?? 'slice'}-${i}`}
                  className="flex flex-col gap-y-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-y-0 gap-x-3"
                >
                  <span className="flex items-center gap-2 text-ink-500 min-w-0">
                    <span className="dot shrink-0" style={{ background: p.color }} />
                    <span className="break-words min-w-0" title={p.label}>
                      {p.label}
                    </span>
                  </span>
                  <span className="font-mono tabular text-left sm:text-right shrink-0 w-full sm:w-auto">
                    {formatMoney(p.value, displayCcy)}{' '}
                    <span className="text-ink-400 whitespace-nowrap">
                      · {pctBase > 0 ? `${((p.value / pctBase) * 100).toFixed(0)}% of fees` : '—'}
                    </span>
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </ReportCard>
    </div>
  );
}

// ── Fee Breakdown Tab (same fee rows / amounts as Overview donut) ──
function TabBreakdown({ stmt }) {
  const [filter, setFilter] = useState('all');
  const d = useMemo(
    () => (stmt?.parsedData ? finalizeParsedForClient(stmt.parsedData) : null),
    [stmt?.id, stmt?.parsedData, parsedDataFinalizeDeps(stmt?.parsedData)],
  );
  const overviewRows = useMemo(() => (d ? getFeeLineOverviewRows(d) : []), [d]);
  const pd = stmt?.parsedData;
  const displayCcy = getStatementDisplayCurrency(d || pd);
  const { total: feeTotal } = reconcileTotalFeesCharged(d || {});

  const tableRows = useMemo(() => {
    const sliceSum = overviewRows.reduce((s, r) => s + (Number(r.value) || 0), 0);
    return overviewRows.map((r, i) => {
      const amount = Number(r.value) || 0;
      const sharePct = sliceSum > 0.01 ? (amount / sliceSum) * 100 : null;
      const ch =
        r.bucket === 'pos' ? 'POS' : r.bucket === 'ecom' ? 'Online' : r.bucket === 'total' ? '—' : '—';
      const chFilter = r.bucket === 'pos' ? 'POS' : r.bucket === 'ecom' ? 'Online' : null;
      return {
        key: `ov-fee-${r.feeSlug ?? i}-${i}`,
        label: r.label,
        amount,
        shareLabel: sharePct != null ? `${sharePct.toFixed(0)}%` : '—',
        channel: ch,
        chFilter,
      };
    });
  }, [overviewRows]);

  const feeChartSliceSum = useMemo(() => {
    const raw = tableRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    return Math.round(raw * 100) / 100;
  }, [tableRows]);

  const rows =
    filter === 'all' ? tableRows : tableRows.filter((r) => r.chFilter === filter);

  return (
    <ReportCard id={reportSectionSlug('breakdown', 'fee-lines')}>
      <div className="p-5 hair-b flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="font-serif text-2xl">Fee breakdown · {overviewRows.length} charge{overviewRows.length === 1 ? '' : 's'}</div>
          <div className="text-[12px] text-ink-400">
            Same rows and amounts as the <span className="font-medium text-ink-600">Overview</span> fee chart: statement{' '}
            <span className="font-mono">fee_lines</span> when present, else canonical fee scalars and{' '}
            <span className="font-mono">fee_totals_by_slug</span>, else <span className="font-mono">channel_split</span> POS /
            e‑commerce fees, else reconciled <span className="font-mono">total_fees_charged</span>. The chart total is the sum
            of these rows (not scaled to match the header when they differ).
          </div>
        </div>
        <div className="flex items-center gap-2">
          {['all', 'POS', 'Online'].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`h-8 px-3 rounded-full text-[12px] border transition ${
                filter === f ? 'bg-ink text-cream border-ink' : 'hair text-ink-500 hover:bg-ink/5'
              }`}
            >
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="smallcaps text-ink-400 bg-cream-200/40">
            <tr>
              {['Charge', '% of chart', 'Amount', 'Card (resolved)', 'Channel'].map((h) => (
                <th key={h} className="text-left font-medium px-5 py-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-hair">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-[13px] text-ink-400 leading-relaxed">
                  {filter !== 'all' && tableRows.length > 0 ? (
                    <>
                      No charge row for this channel filter. Choose <span className="font-medium text-ink-600">All</span>{' '}
                      to see every slice that appears on the Overview fee chart.
                    </>
                  ) : (
                    <>
                      No fee chart rows on this parse (same as an empty Overview fee donut). A reconciled total may
                      still exist under <span className="font-mono">total_fees_charged</span> without rows to list here.
                    </>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.key}>
                  <td className="px-5 py-3 break-words min-w-0 max-w-md">{r.label}</td>
                  <td className="px-5 py-3 font-mono tabular">{r.shareLabel}</td>
                  <td className="px-5 py-3 font-mono tabular">{formatMoney(r.amount, displayCcy)}</td>
                  <td className="px-5 py-3 font-mono text-[12px] text-ink-500">—</td>
                  <td className="px-5 py-3 text-ink-500">{r.channel}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="p-5 hair-t flex items-center justify-between flex-wrap gap-3 bg-cream-200/40">
        <div className="text-[13px] text-ink-500">
          {tableRows.length ? (
            <>
              Sum of chart rows:{' '}
              <span className="font-mono text-ink">{formatMoney(feeChartSliceSum, displayCcy)}</span>
              {Math.abs(feeChartSliceSum - feeTotal) > 0.5 ? (
                <>
                  {' '}
                  · Reconciled <span className="font-mono">total_fees_charged</span>:{' '}
                  <span className="font-mono text-ink">{formatMoney(feeTotal, displayCcy)}</span>
                </>
              ) : (
                <> · Matches reconciled processor fee total</>
              )}
            </>
          ) : (
            <>
              Reconciled <span className="font-mono">total_fees_charged</span>:{' '}
              <span className="font-mono text-ink">{formatMoney(feeTotal, displayCcy)}</span>
            </>
          )}
        </div>
        <Pill tone="leaf">
          <Icon.CircleCheck size={12} /> total_fees_charged
        </Pill>
      </div>
    </ReportCard>
  );
}

// ── Channel Split Tab ───────────────────────────────────────────────
function TabChannel({ stmt, statementModel }) {
  const d = useMemo(
    () => (stmt?.parsedData ? finalizeParsedForClient(stmt.parsedData) : null),
    [stmt?.id, stmt?.parsedData, parsedDataFinalizeDeps(stmt?.parsedData)],
  );

  /** One POS / e‑com card each — gross + fees from {@link getRevenueByChannelPosEcom} (same roll-up the bank charge summary uses on Discrepancy). */
  const channelCardsMerged = useMemo(() => {
    if (!d) return [];
    const totalVol0 = overviewPrimarySalesVolumeGross(d);
    const split =
      d.channel_split && typeof d.channel_split === 'object' && !Array.isArray(d.channel_split) ? d.channel_split : null;

    const channelCards = [];
    if (split) {
      let cashRowCount = 0;
      for (const key of Object.keys(split)) {
        const row = split[key];
        if (row && typeof row === 'object' && resolveChannelSplitBucket(key, row) === 'cash') cashRowCount++;
      }
      const cashFileHintOk = cashRowCount <= 1;
      for (const key of Object.keys(split)) {
        const row = split[key];
        if (!row || typeof row !== 'object') continue;
        const bucket = resolveChannelSplitBucket(key, row);
        let vol =
          bucket === 'cash'
            ? channelSplitCashRowDisplayVolume(d, row, { allowFileLevelCashHint: cashFileHintOk })
            : channelSplitRowGrossForAggregate(d, row, bucket);
        const fees = bucket === 'cash' ? 0 : Number(row.fees) || 0;
        const eff = vol > 0.01 ? (fees / vol) * 100 : null;
        const title =
          String(row.label || row.name || row.channel_label || '').trim() || `channel_split.${key}`;
        let txn = row.txn_count;
        if ((txn == null || txn === '') && bucket === 'cash') {
          const ct = d.pos_workbook_month_summary?.cash_transactions;
          if (Number.isFinite(Number(ct)) && Number(ct) >= 1) txn = Math.floor(Number(ct));
        }
        const avgTxn = row.avg_txn;
        channelCards.push({ key, title, vol, fees, eff, txn, avgTxn, bucket });
      }
    }

    const isSinglePosUpload =
      stmt?.statementCategory === 'pos' &&
      !(Array.isArray(stmt?.linkedSourceFiles) && stmt.linkedSourceFiles.length > 0);
    if (channelCards.length === 0 && isSinglePosUpload) {
      const labels = channelBucketDisplayLabels(d);
      const sum = statementModel?.pos?.summary;
      const revPack = getRevenueByChannelPosEcom(d);
      const posRevSingle = revPack?.posRow ?? null;
      const volFromRevenue =
        posRevSingle != null && Number(posRevSingle.gross) > 0.005 ? Number(posRevSingle.gross) : null;
      const volFromSemantic =
        volFromRevenue == null &&
        sum?.posGross != null &&
        Number.isFinite(Number(sum.posGross)) &&
        Number(sum.posGross) > 0.01
          ? Number(sum.posGross)
          : null;
      const volFromTotal = volFromRevenue == null && volFromSemantic == null && totalVol0 > 0.01 ? totalVol0 : null;
      const canonicalGross = totalVol0;
      const vol =
        canonicalGross > 0.01 ? canonicalGross : (volFromRevenue ?? volFromSemantic ?? volFromTotal);
      if (vol != null) {
        const feesFromRev =
          posRevSingle != null && Number.isFinite(Number(posRevSingle.fees)) ? Math.max(0, Number(posRevSingle.fees)) : null;
        const fees =
          feesFromRev != null
            ? feesFromRev
            : sum?.totalFees != null && Number.isFinite(Number(sum.totalFees))
              ? Math.max(0, Number(sum.totalFees))
              : 0;
        const eff = vol > 0.01 && fees >= 0 ? (fees / vol) * 100 : null;
        const txN = d.total_transactions;
        const avgTxn =
          txN != null && txN !== '' && Number.isFinite(Number(txN)) && Number(txN) > 0 ? vol / Number(txN) : null;
        channelCards.push({
          key: '__single_pos_statement__',
          title: labels.pos,
          vol,
          fees,
          eff,
          txn: txN,
          avgTxn,
          bucket: 'pos',
        });
      }
    }

    if (!channelCards.length) return channelCards;
    if (channelCards.length === 1 && channelCards[0].key === '__single_pos_statement__') return channelCards;

    const revPack = getRevenueByChannelPosEcom(d);
    if (!revPack) return channelCards;

    const posR = revPack.posRow;
    const ecomR = revPack.ecomRow;
    const L = channelBucketDisplayLabels(d);
    const by = { pos: [], ecom: [], cash: [] };
    for (const c of channelCards) {
      if (c.bucket === 'pos' || c.bucket === 'ecom' || c.bucket === 'cash') by[c.bucket].push(c);
    }

    const sumTxn = (arr) =>
      arr.reduce((s, x) => {
        const t = x.txn;
        if (t == null || t === '') return s;
        const n = Number(t);
        return s + (Number.isFinite(n) ? n : 0);
      }, 0);

    const mergedBucket = (bucket, rowR, defaultTitle) => {
      const arr = by[bucket];
      if (!arr.length) return null;
      const sumVol = arr.reduce((s, x) => s + (Number(x.vol) || 0), 0);
      const sumFees = arr.reduce((s, x) => s + (Number(x.fees) || 0), 0);
      const vol =
        rowR != null && (Number(rowR.gross) > 0.005 || Number(rowR.fees) > 0.005) ? Number(rowR.gross) : sumVol;
      const fees =
        rowR != null && Number.isFinite(Number(rowR.fees)) ? Math.max(0, Number(rowR.fees)) : sumFees;
      const st = sumTxn(arr);
      const txn = st > 0 ? st : arr.find((x) => x.txn != null)?.txn ?? null;
      const avgTxn = txn != null && Number(txn) > 0 && vol > 0.005 ? vol / Number(txn) : arr.find((x) => x.avgTxn != null)?.avgTxn ?? null;
      return {
        key: `__merged_${bucket}__`,
        title: arr.length === 1 ? arr[0].title : defaultTitle,
        vol,
        fees,
        eff: vol > 0.01 && fees >= 0 ? (fees / vol) * 100 : null,
        txn,
        avgTxn,
        bucket,
      };
    };

    const out = [];
    const seen = { pos: false, ecom: false };
    for (const c of channelCards) {
      if (c.bucket === 'cash') {
        out.push(c);
        continue;
      }
      if (c.bucket === 'pos' && !seen.pos) {
        seen.pos = true;
        const m = mergedBucket('pos', posR, L.pos);
        if (m) out.push(m);
        continue;
      }
      if (c.bucket === 'pos') continue;
      if (c.bucket === 'ecom' && !seen.ecom) {
        seen.ecom = true;
        const m = mergedBucket('ecom', ecomR, L.ecom);
        if (m) out.push(m);
        continue;
      }
      if (c.bucket === 'ecom') continue;
    }
    return out;
  }, [d, stmt?.statementCategory, stmt?.linkedSourceFiles, statementModel?.pos?.summary]);

  if (!d) return null;
  const displayCcy = getStatementDisplayCurrency(d);
  const totalVol = overviewPrimarySalesVolumeGross(d);

  const channelCardMix = statementModel?.channelCardMix ?? {
    brandBars: [],
    cardMixKind: null,
    posLineCardMix: null,
  };
  const { brandBars, cardMixKind, posLineCardMix } = channelCardMix;

  const effs = channelCardsMerged
    .filter((c) => c.bucket !== 'cash')
    .map((c) => c.eff)
    .filter((e) => e != null && Number.isFinite(e));
  const premiumPp =
    effs.length >= 2 ? (Math.max(...effs) - Math.min(...effs)).toFixed(2) : null;

  const cardIcons = [Icon.CreditCard, Icon.Globe, Icon.Receipt, Icon.FileText];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 items-stretch">
        {channelCardsMerged.length === 0 ? (
          <ReportCard id={reportSectionSlug('channel', 'empty')} className="p-6">
            <p className="text-[13px] text-ink-400">
              No channel_split on this file and no POS gross we could infer for a single-card view.
            </p>
            {stmt?.statementCategory === 'pos' &&
            !(Array.isArray(stmt?.linkedSourceFiles) && stmt.linkedSourceFiles.length > 0) ? (
              <p className="text-[12px] text-ink-500 mt-3 leading-relaxed">
                For a combined POS + e-commerce + bank report, use Upload → <span className="font-medium">Linked files</span>{' '}
                and merge all three statements.
              </p>
            ) : null}
          </ReportCard>
        ) : (
          channelCardsMerged.map((c, idx) => {
            const Ico = cardIcons[idx % cardIcons.length];
            return (
              <ReportCard
                key={c.key}
                id={reportSectionSlug('channel', 'split', c.key, slugifyReportHeading(c.title))}
                className="p-6 h-full min-w-0"
              >
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-9 h-9 rounded-lg bg-ink text-cream flex items-center justify-center">
                    <Ico size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-serif text-xl truncate" title={c.title}>{c.title}</div>
                    <div className="text-[12px] text-ink-400 font-mono truncate">
                      {c.key === '__single_pos_statement__'
                        ? 'single POS file · inferred from this upload'
                        : c.key === '__merged_pos__' || c.key === '__merged_ecom__'
                          ? 'merged channel_split rows · gross + fees match the Channel Split / Discrepancy roll-up'
                          : `channel_split.${c.key}`}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 text-[13px]">
                  {c.bucket === 'cash' ? (
                    <>
                      <div>
                        <div className="text-ink-400">Cash sales</div>
                        <div className="font-mono font-medium text-lg tabular mt-0.5">
                          {formatMoney(c.vol, displayCcy)}
                        </div>
                      </div>
                      <div>
                        <div className="text-ink-400">Transactions</div>
                        <div className="font-mono font-medium text-lg tabular mt-0.5">
                          {c.txn != null && c.txn !== '' ? Number(c.txn).toLocaleString() : '—'}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <div className="text-ink-400">Gross sales</div>
                        <div className="font-mono font-medium text-lg tabular mt-0.5">
                          {formatMoney(c.vol, displayCcy)}
                        </div>
                      </div>
                      <div>
                        <div className="text-ink-400">fees</div>
                        <div className="font-mono font-medium text-lg tabular mt-0.5">
                          {formatMoney(c.fees, displayCcy)}
                        </div>
                      </div>
                      <div>
                        <div className="text-ink-400">fees ÷ volume</div>
                        <div className="font-mono font-medium tabular mt-0.5">
                          {c.eff != null ? `${c.eff.toFixed(2)}%` : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-ink-400">txn_count</div>
                        <div className="font-mono font-medium tabular mt-0.5">
                          {c.txn != null && c.txn !== '' ? Number(c.txn).toLocaleString() : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-ink-400">
                          avg_txn{' '}
                          <span className="text-[10px] font-sans normal-case opacity-80">(gross sales ÷ txn_count)</span>
                        </div>
                        <div className="font-mono font-medium tabular mt-0.5">
                          {c.avgTxn != null ? formatMoney(c.avgTxn, displayCcy) : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-ink-400">% of total_transaction_volume</div>
                        <div className="font-mono font-medium tabular mt-0.5">
                          {totalVol > 0 ? `${((c.vol / totalVol) * 100).toFixed(0)}%` : '—'}
                        </div>
                      </div>
                      {c.bucket === 'pos' &&
                      posLineCardMix?.rows?.length >= 2 &&
                      brandBars.length === 0 ? (
                        <div className="col-span-2 mt-1 pt-3 border-t border-ink/8">
                          <div className="text-[11px] text-ink-500 mb-2">
                            Card / tender mix from POS order lines
                            {posLineCardMix.tenderColumn ? (
                              <span className="font-mono text-[10px] text-ink-400"> · column {posLineCardMix.tenderColumn}</span>
                            ) : null}
                          </div>
                          <div className="space-y-1.5">
                            {posLineCardMix.rows.map((r) => {
                              const pct =
                                posLineCardMix.totalVolume > 0
                                  ? Math.round((r.volume / posLineCardMix.totalVolume) * 100)
                                  : 0;
                              return (
                                <div key={r.slug || r.key} className="flex justify-between gap-3 text-[12px]">
                                  <span className="text-ink-600 min-w-0 flex-1">
                                    <span className="block truncate font-medium" title={r.label}>
                                      {r.label}
                                    </span>
                                    <span className="block font-mono text-[10px] text-ink-400 truncate" title={r.slug}>
                                      {r.slug}
                                    </span>
                                  </span>
                                  <span className="font-mono tabular text-ink shrink-0">
                                    {pct}% · {formatCompactMoney(r.volume, displayCcy)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </ReportCard>
            );
          })
        )}
      </div>

      <ReportCard id={reportSectionSlug('channel', 'card-mix')} className="p-6 min-w-0">
        <div className="font-serif text-2xl mb-1">Card mix</div>
        <p className="text-[12px] text-ink-400 mb-4 leading-relaxed">
          {cardMixKind === 'pos_lines' ? (
            <>
              Shares are computed from <span className="font-medium text-ink-600">POS transaction rows</span> on this
              file: each line’s gross is grouped by tender / payment column (or structured fields such as{' '}
              <span className="font-mono">card_type</span>, <span className="font-mono">network</span>) when the
              processor did not supply a <span className="font-mono">card_brand_mix</span> table.
            </>
          ) : cardMixKind === 'parser' ? (
            <>
              Uses <span className="font-mono">card_brand_mix</span> when rows look like tenders or cards:{' '}
              <span className="font-mono">network</span>, <span className="font-mono">card_type</span>, or similar fields
              (common on PDFs), Visa–style text, short
              ALL‑CAPS codes (VI, MC), or similar. Rows that look like product lines (menu keywords, very long labels)
              are dropped when mixed with real tenders; pure menu lists are hidden. If nothing qualifies, we try{' '}
              <span className="font-medium text-ink-600">POS order-line</span> tender columns, then{' '}
              <span className="font-mono">card_mix</span> when present.
            </>
          ) : cardMixKind === 'legacy' ? (
            <>
              From legacy <span className="font-mono">card_mix</span> percentages (processor-supplied keys), scaled to
              statement volume where possible.
            </>
          ) : (
            <>
              No <span className="font-mono">card_brand_mix</span> table, no usable POS line tender / card fields, and no
              legacy <span className="font-mono">card_mix</span> object.
            </>
          )}
        </p>
        <div className="space-y-3">
          {brandBars.length === 0 ? (
            <p className="text-[13px] text-ink-400">
              No card mix to show — add processor card tables or POS rows with tender / card columns.
            </p>
          ) : (
            brandBars.map(({ slug, displayLabel, pct, color, vol }, i) => (
              <div key={`${slug}-${i}`} className="flex items-center gap-3 text-[13px]">
                <div className="w-44 shrink-0 min-w-0">
                  <div className="text-ink-600 truncate font-medium text-[12px]" title={displayLabel}>
                    {displayLabel}
                  </div>
                  <div className="font-mono text-[10px] text-ink-400 truncate" title={slug}>
                    {slug}
                  </div>
                </div>
                <div className="flex-1 h-2 bg-ink/10 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
                </div>
                <div className="font-mono tabular w-10 text-right">{pct}%</div>
                <div className="font-mono tabular text-ink-400 w-28 text-right">
                  {totalVol > 0 ? formatCompactMoney(vol, displayCcy) : '—'}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="mt-4 pt-4 border-t hair text-[12px] text-ink-500">
          {premiumPp != null
            ? `Spread between highest and lowest channel fees ÷ volume among non-cash channel cards: ${premiumPp} percentage points.`
            : 'When at least two non-cash channel cards have fees ÷ volume, we show the spread here.'}
        </div>
      </ReportCard>
    </div>
  );
}

function buildQaSuggestions(pd) {
  if (!pd || typeof pd !== 'object') return [];
  const out = [];
  if (pd.effective_rate != null && Number.isFinite(Number(pd.effective_rate))) out.push('What is my effective rate?');
  const { total } = reconcileTotalFeesCharged(pd);
  if (total > 0) out.push('What are my total fees?');
  if (Array.isArray(pd.fee_lines) && pd.fee_lines.length) out.push('Summarize my fee lines');
  if (pd.channel_split && typeof pd.channel_split === 'object' && !Array.isArray(pd.channel_split)) {
    out.push('What is in my channel_split?');
  }
  if (pd.reconciliation_variance != null && Number.isFinite(Number(pd.reconciliation_variance))) {
    out.push('Explain my reconciliation variance');
  }
  if (pd.interchange_fees != null && Number.isFinite(Number(pd.interchange_fees)) && Math.abs(Number(pd.interchange_fees)) > 0.005) {
    out.push('How much are interchange_fees?');
  }
  if (pd.scheme_fees != null && Number.isFinite(Number(pd.scheme_fees)) && Math.abs(Number(pd.scheme_fees)) > 0.005) {
    out.push('How much are scheme_fees?');
  }
  return [...new Set(out)].slice(0, 6);
}

/** POS / e‑com gross vs bank-side credits (Discrepancy tab — below highest-commission spotlights). */
function GrossVsBankChannelTable({
  summary,
  fmt,
  anchorId,
  channelLabels,
  reconciliationStrip,
}) {
  if (!summary || summary.splitMode === 'none') return null;
  const posLab = channelLabels?.pos ?? 'POS';
  const ecomLab = channelLabels?.ecom ?? 'E‑commerce';

  const verifiedBankSplit = Boolean(summary.bankCreditsUsesVerifiedTotalShare);
  const settlementBasisProcessorNet = Boolean(summary.grossVsBankUsesProcessorNet);
  const vbStrip = reconciliationStrip?.verifiedBank;
  const expStrip = reconciliationStrip?.expectedSettlementSum;
  const showVerifiedVsExpectedExplainer =
    verifiedBankSplit &&
    reconciliationStrip != null &&
    Number.isFinite(vbStrip) &&
    Number.isFinite(expStrip) &&
    vbStrip > 0.02 &&
    expStrip > 0.02 &&
    vbStrip + 1 < expStrip;

  const posGross = summary.posGrossTotal;
  const ecomGross = summary.ecomGrossTotal;
  const posSettle =
    summary.posGrossVsBankSettlementAmount ?? summary.posBankCreditsTotal;
  const ecomSettle =
    summary.ecomGrossVsBankSettlementAmount ?? summary.ecomBankCreditsTotal;
  const combinedGross = summary.combinedGrossTotal;
  const combinedBank = summary.combinedBankSettlement;
  const combinedDiff = summary.combinedGrossVsBankDiff;
  const combinedPct = summary.combinedGrossVsBankPct;
  const rows = [
    {
      key: 'pos',
      label: posLab,
      gross: posGross,
      bank: posSettle,
      diff:
        posGross != null &&
        Number.isFinite(posGross) &&
        Number.isFinite(posSettle)
          ? posGross - posSettle
          : null,
      impliedPct: summary.posGrossVsBankPct,
    },
    {
      key: 'ecom',
      label: ecomLab,
      gross: ecomGross,
      bank: ecomSettle,
      diff:
        ecomGross != null &&
        Number.isFinite(ecomGross) &&
        Number.isFinite(ecomSettle)
          ? ecomGross - ecomSettle
          : null,
      impliedPct: summary.ecomGrossVsBankPct,
    },
  ];

  const unknownCredits =
    summary.splitMode === 'bank_lines' && summary.split?.unknown?.credits > 0.02
      ? summary.split.unknown.credits
      : 0;

  const footBase =
    summary.splitMode === 'reconciliation_nets'
      ? 'Without classified bank lines, settlement columns follow processor net deposits for comparison; gross and % still use channel gross vs those settlement amounts where gross exists.'
      : verifiedBankSplit && settlementBasisProcessorNet
        ? 'Settlement uses processor-reported net to bank per channel (same POS / e‑commerce figures as Channel Split Net Bank). Your verified bank deposit total may still be split differently when only one lump-sum credit exists on the bank statement. Percentage: (channel gross − settlement) ÷ channel gross × 100.'
      : verifiedBankSplit
        ? 'Net-to-bank matches Channel Split where applicable. When only one verified bank total exists, settlement is allocated by Net Bank mix. Percentage: (channel gross − channel bank settlement) ÷ channel gross × 100.'
        : 'Gross matches the channel roll-up (Channel Split). Bank settlement is memo-classified from your bank upload. Percentage: (gross − settlement) ÷ gross × 100.';

  const footUnknown =
    unknownCredits > 0.02
      ? ` ${fmt(unknownCredits)} in credits could not be assigned to POS or e‑commerce (unknown memo). Those amounts are excluded from both columns until the memo matches our rules.`
      : '';
  const footGolden = summary.bankCreditsAllocationNote ? ` ${summary.bankCreditsAllocationNote}` : '';
  const foot = `${footBase}${footUnknown}${footGolden}`;

  const inner = (
    <div className="mt-10 pt-8 border-t border-ink/10 w-full max-w-4xl">
      <div className="font-serif text-lg text-ink mb-1">Channel totals — gross vs bank settlement</div>
      <p className="text-[11px] text-ink-500 mb-4 max-w-3xl leading-relaxed">
        Per channel: <span className="font-medium text-ink-600">gross amount</span> (same basis as Channel Split),{' '}
        <span className="font-medium text-ink-600">bank settlement</span>{' '}
        {verifiedBankSplit && settlementBasisProcessorNet ? (
          <>
            shows each channel&apos;s <span className="font-medium text-ink-600">processor net to bank</span> (same basis
            as Channel Split Net Bank — POS statement vs e‑commerce statement); when bank lines lack batch/order IDs we do
            not infer POS vs e‑commerce amounts from the bank file alone,
          </>
        ) : verifiedBankSplit ? (
          <>
            splits your <span className="font-medium text-ink-600">verified bank total</span> using the same POS vs
            e‑commerce weights as Channel Split Net Bank — typical cross-channel reconciliation workbooks only publish one
            combined bank figure,
          </>
        ) : (
          <>
            Sums <span className="font-medium text-ink-600">classified bank credits</span> per channel: each deposit row
            is tagged using the parser <span className="font-mono">channel</span> when present, then by matching{' '}
            <span className="font-medium text-ink-600">settlement / batch / order IDs</span> (and related reference
            columns) against your POS batches and e‑commerce orders, then memo/description keywords,
          </>
        )}{' '}
        then <span className="font-medium text-ink-600">difference</span> (gross − settlement) and{' '}
        <span className="font-medium text-ink-600">(gross − settlement) ÷ gross × 100</span>. The{' '}
        <span className="font-medium text-ink-600">Total</span> row is POS + e‑commerce gross, sum of settlement columns,
        and combined difference / rate: <span className="font-medium text-ink-600">(Σ gross − Σ settlement) ÷ Σ gross × 100</span>.
      </p>
      {showVerifiedVsExpectedExplainer ? (
        <p className="text-[11px] text-ink-600 mb-4 max-w-3xl leading-relaxed rounded-md border border-ink/8 bg-cream-200/35 px-3 py-2.5">
          <span className="font-medium text-ink-700">Why allocated settlement is below Net Bank:</span> The parse has a{' '}
          <span className="font-medium">single</span> verified bank-credit total ({fmt(vbStrip)}); expected settlement (POS
          + e‑commerce Net Bank) sums to {fmt(expStrip)}. We split {fmt(vbStrip)} by Net Bank share for comparison — not two
          separate statement totals unless you supply per-channel bank fields.
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-ink/10">
        <table className="w-full text-sm min-w-[560px] border-collapse">
          <thead>
            <tr className="bg-cream-200/50 border-b hair text-left smallcaps text-ink-500 text-[11px]">
              <th className="py-2.5 px-3 font-medium">{humanizeFieldKey('channel')}</th>
              <th className="py-2.5 px-3 font-medium text-right">Channel gross amount</th>
              <th className="py-2.5 px-3 font-medium text-right">
                {verifiedBankSplit && settlementBasisProcessorNet
                  ? 'Net to bank (statements)'
                  : verifiedBankSplit
                    ? 'Allocated bank settlement'
                    : 'Channel total bank settlement'}
              </th>
              <th className="py-2.5 px-3 font-medium text-right">Difference (gross − settlement)</th>
              <th className="py-2.5 px-3 font-medium text-right">(Gross − settlement) ÷ gross</th>
            </tr>
          </thead>
          <tbody className="divide-hair">
            {rows.map((r) => (
              <tr key={r.key} className="text-ink">
                <td className="py-2.5 px-3 font-medium">{r.label}</td>
                <td className="py-2.5 px-3 font-mono tabular text-right">{r.gross != null ? fmt(r.gross) : '—'}</td>
                <td className="py-2.5 px-3 font-mono tabular text-right">{fmt(r.bank)}</td>
                <td className="py-2.5 px-3 font-mono tabular text-right">
                  {r.diff != null && Number.isFinite(r.diff) ? fmt(r.diff) : '—'}
                </td>
                <td className="py-2.5 px-3 font-mono tabular text-right">
                  {r.impliedPct != null && Number.isFinite(r.impliedPct) ? `${r.impliedPct.toFixed(2)}%` : '—'}
                </td>
              </tr>
            ))}
            {combinedGross != null || combinedBank > 0.02 ? (
              <tr className="text-ink bg-cream-200/40 border-t hair font-medium">
                <td className="py-2.5 px-3">Total (POS + e‑commerce)</td>
                <td className="py-2.5 px-3 font-mono tabular text-right">
                  {combinedGross != null ? fmt(combinedGross) : '—'}
                </td>
                <td className="py-2.5 px-3 font-mono tabular text-right">{fmt(combinedBank)}</td>
                <td className="py-2.5 px-3 font-mono tabular text-right">
                  {combinedDiff != null && Number.isFinite(combinedDiff) ? fmt(combinedDiff) : '—'}
                </td>
                <td className="py-2.5 px-3 font-mono tabular text-right">
                  {combinedPct != null && Number.isFinite(combinedPct) ? `${combinedPct.toFixed(2)}%` : '—'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-500 mt-3 leading-relaxed max-w-3xl">{foot}</p>
    </div>
  );
  if (!anchorId) return inner;
  return (
    <section id={anchorId} className="scroll-mt-28 w-full max-w-4xl">
      <ReportSlugFooter id={anchorId} variant="inline" />
      {inner}
    </section>
  );
}

// ── Discrepancy report tab (cross-channel reconciliation layout) ───
function TabDiscrepancy({ stmt, statementModel, peerStatementsForSummary = [] }) {
  const d = useMemo(
    () => (stmt?.parsedData ? finalizeParsedForClient(stmt.parsedData) : null),
    [stmt?.id, stmt?.parsedData, parsedDataFinalizeDeps(stmt?.parsedData)],
  );
  const revenue = useMemo(() => (d ? getRevenueByChannelPosEcom(d)?.table ?? null : null), [d]);
  const posBatchLag = useMemo(() => getSlowPosBatchSettlementRows(d), [d]);
  const posBatchBank = useMemo(() => getPosBatchBankCalendarLagRows(d), [d]);
  const ecomSettlementLag = useMemo(() => getSlowEcommerceSettlementRows(d), [d]);
  const posSettlementDelays = useMemo(() => getPosSettlementDelayReportRows(d), [d]);
  const ecomSettlementDelays = useMemo(() => getEcommerceSettlementDelayReportRows(d), [d]);
  const ecomSpotlight = useMemo(() => getEcommerceCommissionSpotlight(d), [d]);
  const ecomSpotlightUi = useMemo(() => buildEcomSpotlightReportUi(d, ecomSpotlight), [d, ecomSpotlight]);
  const ecomOrderMetrics = useMemo(() => (d ? getEcommerceStatementOrderMetrics(d) : null), [d]);
  const ecomOrderMetricsUi = useMemo(() => (d ? buildEcomOrderUploadMetricsUi(d) : null), [d]);
  const posCardPaymentLabels = useMemo(
    () => (d ? aggregatePosPaymentLabelsFromPosTxnRows(pickPosTransactionArrays(d)) : []),
    [d],
  );
  /** Passed into bank summary so Net Bank / allocation math stays aligned with {@link getRevenueByChannelPosEcom} (Channel Split tab uses the same roll-up). */
  const channelGrossBankSummary = useMemo(
    () => (d ? getBankStatementPosEcomChargeSummary(d, revenue ?? undefined) : null),
    [d, revenue],
  );
  const channelLabelsForBank = useMemo(() => (d ? channelBucketDisplayLabels(d) : null), [d]);
  const settlementMeta = useMemo(() => settlementDisplayRoles(d), [d]);
  const structureNarrative = useMemo(
    () => getStatementStructureNarrative(d, { fileType: stmt?.fileType ?? d?.file_type, fileName: stmt?.fileName || '' }),
    [d, stmt?.fileType, stmt?.fileName],
  );
  const isTabular = useMemo(() => isTabularStatementFileName(stmt?.fileName), [stmt?.fileName]);
  const hasPosLayer = settlementMeta.roles.some((r) => r.role === 'pos');

  const pillToneForRole = (role) => {
    if (role === 'pos') return 'teal';
    if (role === 'ecommerce') return 'amber';
    if (role === 'bank') return 'ink';
    if (role === 'reconciliation') return 'leaf';
    return 'cream';
  };

  const posSpotlightBatch = statementModel?.pos?.spotlightAnalysis?.spotlightBatch ?? null;
  const posSpotlightEffective = useMemo(() => {
    if (posSpotlightBatch) return posSpotlightBatch;
    if (!d) return null;
    return getPosBatchCommissionAnalysis(d)?.spotlightBatch ?? null;
  }, [d, posSpotlightBatch]);
  const posSpotlightTableUi = useMemo(
    () => (d && posSpotlightEffective ? buildPosSpotlightReportUi(d, posSpotlightEffective) : null),
    [d, posSpotlightEffective],
  );

  const summaryLines = useMemo(
    () =>
      d
        ? buildPlainEnglishSummaryLines(d, stmt, {
            pos: statementModel?.pos ?? null,
            peerStatements: peerStatementsForSummary,
          })
        : [],
    [d, stmt, statementModel?.pos, peerStatementsForSummary],
  );

  if (!d) return null;

  const displayCcy = getStatementDisplayCurrency(d);
  const shop = displayBusinessName(d, stmt?.acquirer);
  const bankRows = buildBankReconciliationRows(d);
  const showPosSpotlightSummaryTable =
    Boolean(posSpotlightEffective) &&
    Boolean(posSpotlightTableUi) &&
    (posSpotlightEffective.commission != null && Number.isFinite(Number(posSpotlightEffective.commission))
      ? true
      : posSpotlightEffective.impliedPct != null && Number.isFinite(Number(posSpotlightEffective.impliedPct)));
  const fmt = (n) => (n != null && Number.isFinite(Number(n)) ? formatMoney(Number(n), displayCcy) : '—');

  return (
    <div className="space-y-6">
      <ReportCard id={reportSectionSlug('discrepancy', 'summary')} className="p-6 md:p-8 overflow-x-auto">
        <div className="mb-8 space-y-1">
          <div className="font-serif text-2xl md:text-3xl text-ink">{shop !== 'Statement' ? shop : stmt?.acquirer} — {stmt?.period}</div>
          <div className="text-[15px] text-ink-600 font-medium">
            {typeof d?.report_ui?.reconciliation_subtitle === 'string' && d.report_ui.reconciliation_subtitle.trim()
              ? d.report_ui.reconciliation_subtitle.trim()
              : 'Discrepancy'}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 gap-y-2">
            {structureNarrative.parsedAsLabel ? (
              <>
                <span className="text-[11px] text-ink-400 smallcaps tracking-wide shrink-0">{humanizeFieldKey('parsed_as')}</span>
                <Pill tone="cream">{structureNarrative.parsedAsLabel}</Pill>
              </>
            ) : null}
            {settlementMeta.roles.length > 0 ? (
              <>
                <span className="text-[11px] text-ink-400 smallcaps tracking-wide shrink-0 sm:ml-2">{humanizeFieldKey('settlement_layers')}</span>
                {settlementMeta.roles.map((r, i) => (
                  <Pill key={`${r.role}-${i}`} tone={pillToneForRole(r.role)} title={settlementMeta.source === 'file' ? humanizeFieldKey('workbook_sheet_roles') : humanizeFieldKey('parsed_fields')}>
                    {r.name}
                  </Pill>
                ))}
              </>
            ) : null}
          </div>
          {structureNarrative.headline ? (
            <p className="text-[13px] text-ink-600 max-w-3xl leading-relaxed mt-3">{structureNarrative.headline}</p>
          ) : null}
          {structureNarrative.perLayer.length > 0 ? (
            <ul className="mt-2.5 space-y-1.5 text-[12px] text-ink-500 max-w-3xl list-disc pl-5 leading-relaxed">
              {structureNarrative.perLayer.map((row, i) => (
                <li key={`${row.role}-${row.label}-${i}`}>{row.text}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </ReportCard>

      <ReportCard id={reportSectionSlug('discrepancy', 'bank')} className="p-6 md:p-8">
        <div className="smallcaps text-ink-400 text-[11px] tracking-wide mb-2">
          {typeof d?.report_ui?.bank_section_title === 'string' && d.report_ui.bank_section_title.trim()
            ? d.report_ui.bank_section_title.trim()
            : humanizeFieldKey('bank_reconciliation')}
        </div>
        <div className="space-y-0 max-w-2xl">
          {bankRows.map((row) => (
            <div key={row.label} className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 py-3 border-b border-ink/6 last:border-0">
              <div>
                <div className="text-[13px] text-ink leading-snug">{row.label}</div>
                {row.sub ? <div className="text-[11px] text-ink-400 font-mono mt-0.5">{row.sub}</div> : null}
              </div>
              <div className="font-mono tabular text-right text-lg shrink-0">{fmt(row.value)}</div>
            </div>
          ))}
        </div>
        {(() => {
          const custom =
            typeof d?.report_ui?.reconciliation_variance_guidance === 'string' && d.report_ui.reconciliation_variance_guidance.trim()
              ? d.report_ui.reconciliation_variance_guidance.trim()
              : null;
          const fallback =
            !custom && d?.linked_statement_bundle && typeof d.linked_statement_bundle === 'object'
              ? RECONCILIATION_VARIANCE_GUIDANCE_DEFAULT
              : null;
          const text = custom || fallback;
          return text ? <p className="text-[12px] text-ink-500 mt-4 max-w-2xl leading-relaxed">{text}</p> : null;
        })()}
        {Array.isArray(d?.reconciliation_discrepancy_lines) && d.reconciliation_discrepancy_lines.length > 0 ? (
          <div className="mt-8 pt-6 border-t hair max-w-3xl">
            <div className="smallcaps text-ink-400 text-[11px] tracking-wide mb-3">
              Workbook line items that bridge processor to bank
            </div>
            <div className="overflow-x-auto rounded-lg border hair">
              <table className="w-full text-sm min-w-[520px]">
                <thead className="bg-cream-200/50 text-left smallcaps text-ink-500 text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3 font-medium">Item</th>
                    <th className="py-2.5 px-3 font-medium text-right">Amount</th>
                    <th className="py-2.5 px-3 font-medium">Explanation</th>
                  </tr>
                </thead>
                <tbody className="divide-hair">
                  {d.reconciliation_discrepancy_lines.map((line, i) => (
                    <tr key={i} className="text-ink">
                      <td className="py-2.5 px-3 align-top max-w-[14rem]">{line.label}</td>
                      <td className="py-2.5 px-3 font-mono tabular text-right align-top whitespace-nowrap">
                        {line.amount != null && Number.isFinite(Number(line.amount)) ? fmt(Number(line.amount)) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-ink-600 align-top text-[12px] leading-relaxed">{line.explanation || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {typeof d?.report_ui?.bank_reconciliation_footnote === 'string' && d.report_ui.bank_reconciliation_footnote.trim() ? (
          <p className="text-[12px] text-ink-500 mt-4 max-w-2xl leading-relaxed">{d.report_ui.bank_reconciliation_footnote.trim()}</p>
        ) : null}
      </ReportCard>

      {(ecomSpotlight && ecomSpotlightUi) ||
      showPosSpotlightSummaryTable ||
      (ecomOrderMetrics && ecomOrderMetricsUi) ? (
        <ReportCard id={reportSectionSlug('discrepancy', 'commissions')} className="p-6 md:p-8 overflow-x-auto">
          <div className="space-y-10 max-w-5xl">
            {(ecomSpotlight && ecomSpotlightUi) || showPosSpotlightSummaryTable || (ecomOrderMetrics && ecomOrderMetricsUi) ? (
              <>
                <div className="grid gap-6 lg:grid-cols-2">
                  {(ecomSpotlight && ecomSpotlightUi) || (ecomOrderMetrics && ecomOrderMetricsUi) ? (
                    <div className="space-y-4 min-w-0">
                      {ecomSpotlight && ecomSpotlightUi ? (
                        <div className="rounded-xl border border-ink/10 bg-cream-100/35 p-5">
                          <div className="smallcaps text-ink-400 text-[11px] tracking-wide mb-1">E-commerce</div>
                          <div className="font-serif text-lg text-ink mb-3">{ecomSpotlightUi.spotlightSectionTitle}</div>
                          <dl className="space-y-0 text-[13px] text-ink-600">
                            <div className="flex justify-between gap-4 border-b border-ink/8 py-2.5">
                              <dt className="text-ink-500 shrink-0">{ecomSpotlightUi.primaryIdLabel}</dt>
                              <dd className="font-mono text-right text-ink text-[12px] leading-snug break-all max-w-[min(100%,18rem)]">
                                {ecomSpotlight.primaryId != null && String(ecomSpotlight.primaryId).trim()
                                  ? String(ecomSpotlight.primaryId).trim()
                                  : '—'}
                              </dd>
                            </div>
                            <div className="flex justify-between gap-4 border-b border-ink/8 py-2.5">
                              <dt className="text-ink-500 shrink-0">{ecomSpotlightUi.commissionLabel}</dt>
                              <dd className="font-mono tabular text-right">
                                {ecomSpotlight.commission != null && Number.isFinite(Number(ecomSpotlight.commission))
                                  ? fmt(Number(ecomSpotlight.commission))
                                  : '—'}
                              </dd>
                            </div>
                            <div className="flex justify-between gap-4 py-2.5">
                              <dt className="text-ink-500 shrink-0">{ecomSpotlightUi.impliedPctLabel}</dt>
                              <dd className="font-mono tabular text-right">
                                {ecomSpotlight.impliedPct != null && Number.isFinite(Number(ecomSpotlight.impliedPct))
                                  ? `${Number(ecomSpotlight.impliedPct).toFixed(2)}%`
                                  : '—'}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      ) : null}
                      {ecomOrderMetrics && ecomOrderMetricsUi ? (
                        <div className="rounded-xl border border-ink/10 bg-cream-100/35 p-5">
                          <div className="smallcaps text-ink-400 text-[11px] tracking-wide mb-1">E-commerce</div>
                          <div className="font-serif text-lg text-ink mb-2">{ecomOrderMetricsUi.blockTitle}</div>
                          <p className="text-[11px] text-ink-400 leading-relaxed mb-3">{ecomOrderMetricsUi.footnote}</p>
                          <dl className="space-y-0 text-[13px] text-ink-600">
                            <div className="flex justify-between gap-4 border-b border-ink/8 py-2.5">
                              <dt className="text-ink-500 shrink-0">{ecomOrderMetricsUi.totalGrossLabel}</dt>
                              <dd className="font-mono tabular text-right">{fmt(ecomOrderMetrics.totalGross)}</dd>
                            </div>
                            <div className="flex justify-between gap-4 border-b border-ink/8 py-2.5">
                              <dt className="text-ink-500 shrink-0">{ecomOrderMetricsUi.totalFeesLabel}</dt>
                              <dd className="font-mono tabular text-right">{fmt(ecomOrderMetrics.totalFees)}</dd>
                            </div>
                            <div className="flex justify-between gap-4 border-b border-ink/8 py-2.5">
                              <dt className="text-ink-500 shrink-0">{ecomOrderMetricsUi.deductionsLabel}</dt>
                              <dd className="font-mono tabular text-right">{fmt(ecomOrderMetrics.totalDeductions)}</dd>
                            </div>
                            <div className="flex justify-between gap-4 border-b border-ink/8 py-2.5">
                              <dt className="text-ink-500 shrink-0">{ecomOrderMetricsUi.netLabel}</dt>
                              <dd className="font-mono tabular text-right">{fmt(ecomOrderMetrics.computedNet)}</dd>
                            </div>
                            {ecomOrderMetrics.netFromRows != null ? (
                              <div className="flex justify-between gap-4 py-2.5">
                                <dt className="text-ink-500 shrink-0">{ecomOrderMetricsUi.netFromFileLabel}</dt>
                                <dd className="font-mono tabular text-right">{fmt(ecomOrderMetrics.netFromRows)}</dd>
                              </div>
                            ) : null}
                            {ecomOrderMetrics.highest && !ecomSpotlight ? (
                              <>
                                <div className="pt-3 mt-1 text-[12px] text-ink-500">{ecomOrderMetricsUi.highestFeeLabel}</div>
                                <div className="flex justify-between gap-4 border-b border-ink/8 py-2.5">
                                  <dt className="text-ink-500 shrink-0">{ecomOrderMetricsUi.highestOrderLabel}</dt>
                                  <dd className="font-mono text-right text-[12px] break-all max-w-[min(100%,16rem)]">
                                    {ecomOrderMetrics.highest.orderId}
                                  </dd>
                                </div>
                                <div className="flex justify-between gap-4 border-b border-ink/8 py-2.5">
                                  <dt className="text-ink-500 shrink-0">{ecomOrderMetricsUi.highestAmountLabel}</dt>
                                  <dd className="font-mono tabular text-right">{fmt(ecomOrderMetrics.highest.fee)}</dd>
                                </div>
                                <div className="flex justify-between gap-4 py-2.5">
                                  <dt className="text-ink-500 shrink-0">{ecomOrderMetricsUi.highestPctLabel}</dt>
                                  <dd className="font-mono tabular text-right">
                                    {ecomOrderMetrics.highest.impliedPct != null
                                      ? `${Number(ecomOrderMetrics.highest.impliedPct).toFixed(2)}%`
                                      : '—'}
                                  </dd>
                                </div>
                              </>
                            ) : null}
                            {ecomOrderMetrics.cardPaymentLabels && ecomOrderMetrics.cardPaymentLabels.length > 0 ? (
                              <div className="pt-3 mt-1 border-t border-ink/8">
                                <div className="text-[12px] text-ink-500 mb-1.5">{ecomOrderMetricsUi.cardMixLabel}</div>
                                <ul className="text-[12px] text-ink-700 space-y-1 list-disc list-inside leading-snug">
                                  {ecomOrderMetrics.cardPaymentLabels.map((lab) => (
                                    <li key={lab}>{lab}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </dl>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {showPosSpotlightSummaryTable && posSpotlightTableUi && posSpotlightEffective ? (
                    <div className="rounded-xl border border-ink/10 bg-cream-100/35 p-5">
                      <div className="smallcaps text-ink-400 text-[11px] tracking-wide mb-1">POS</div>
                      <div className="font-serif text-lg text-ink mb-3">{posSpotlightTableUi.spotlightSectionTitle}</div>
                      <dl className="space-y-0 text-[13px] text-ink-600">
                        <div className="flex justify-between gap-4 border-b border-ink/8 py-2.5">
                          <dt className="text-ink-500 shrink-0">{posSpotlightTableUi.batchIdLabel}</dt>
                          <dd className="font-mono text-right text-ink text-[12px] leading-snug break-all max-w-[min(100%,18rem)]">
                            {(() => {
                              const p = posSpotlightEffective;
                              const b = p?.batchId != null && String(p.batchId).trim() ? String(p.batchId).trim() : '';
                              const o = p?.orderOrTxnId != null && String(p.orderOrTxnId).trim() ? String(p.orderOrTxnId).trim() : '';
                              if (p?.transactionLine && o) return o + (b && b !== '—' && b !== o ? ` · ${b}` : '');
                              return b || o || '—';
                            })()}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-4 border-b border-ink/8 py-2.5">
                          <dt className="text-ink-500 shrink-0 max-w-[55%] leading-snug">{posSpotlightTableUi.transactionCountLabel}</dt>
                          <dd className="font-mono tabular text-right">
                            {posSpotlightEffective.transactionCount != null &&
                            Number.isFinite(Number(posSpotlightEffective.transactionCount))
                              ? String(Math.round(Number(posSpotlightEffective.transactionCount)))
                              : '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-4 border-b border-ink/8 py-2.5">
                          <dt className="text-ink-500 shrink-0">{posSpotlightTableUi.commissionLabel}</dt>
                          <dd className="font-mono tabular text-right">
                            {posSpotlightEffective.commission != null && Number.isFinite(Number(posSpotlightEffective.commission))
                              ? fmt(Number(posSpotlightEffective.commission))
                              : '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-4 py-2.5">
                          <dt className="text-ink-500 shrink-0">{posSpotlightTableUi.impliedPctLabel}</dt>
                          <dd className="font-mono tabular text-right">
                            {posSpotlightEffective.impliedPct != null && Number.isFinite(Number(posSpotlightEffective.impliedPct))
                              ? `${Number(posSpotlightEffective.impliedPct).toFixed(2)}%`
                              : '—'}
                          </dd>
                        </div>
                        {posCardPaymentLabels.length > 0 ? (
                          <div className="pt-3 mt-1 border-t border-ink/8">
                            <div className="text-[12px] text-ink-500 mb-1.5">Card / payment (from POS rows)</div>
                            <ul className="text-[12px] text-ink-700 space-y-1 list-disc list-inside leading-snug">
                              {posCardPaymentLabels.map((lab) => (
                                <li key={lab}>{lab}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </dl>
                    </div>
                  ) : null}
                </div>
                <p className="text-[11px] text-ink-400 max-w-3xl leading-relaxed">
                  When several settlement lines share one batch, transaction counts follow the line with the largest fee
                  (not file order), then fall back to summed line counts.
                </p>
              </>
            ) : null}
          </div>
          <GrossVsBankChannelTable
            summary={channelGrossBankSummary}
            fmt={fmt}
            anchorId={reportSectionSlug('discrepancy', 'gross-vs-bank')}
            channelLabels={channelLabelsForBank}
            reconciliationStrip={
              channelGrossBankSummary?.bankCreditsUsesVerifiedTotalShare &&
              d?.bank_credits_total_verified != null &&
              Number.isFinite(Number(d.bank_credits_total_verified)) &&
              channelGrossBankSummary.posProcessorNetTotal != null &&
              channelGrossBankSummary.ecomProcessorNetTotal != null &&
              Number.isFinite(Number(channelGrossBankSummary.posProcessorNetTotal)) &&
              Number.isFinite(Number(channelGrossBankSummary.ecomProcessorNetTotal))
                ? {
                    verifiedBank: Number(d.bank_credits_total_verified),
                    expectedSettlementSum:
                      Number(channelGrossBankSummary.posProcessorNetTotal) +
                      Number(channelGrossBankSummary.ecomProcessorNetTotal),
                  }
                : null
            }
          />
        </ReportCard>
      ) : null}

      <ReportCard id={reportSectionSlug('discrepancy', 'plain-summary')} className="p-6 md:p-8">
        <div className="smallcaps text-ink-400 text-[11px] tracking-wide mb-3">
          {typeof d?.report_ui?.plain_summary_title === 'string' && d.report_ui.plain_summary_title.trim()
            ? d.report_ui.plain_summary_title.trim()
            : 'What to take from this statement'}
        </div>
        <p className="text-[12px] text-ink-500 mb-4 max-w-3xl leading-relaxed">
          Bullets use only fields present in the JSON. Lines that start with “Unknown here” mean the file did not
          carry enough structure for that conclusion—nothing is invented. Optional deltas vs other uploads (same
          currency) appear when you have more than one statement in the library. Order: variance notes, scope/limits,
          headline economics, then mix and line-item context.
        </p>
        {summaryLines.length > 0 ? (
          <ol className="list-decimal pl-5 space-y-2.5 text-[14px] text-ink-600 leading-relaxed marker:text-ink-400">
            {summaryLines.map((line, i) => (
              <li key={i} className="pl-1">
                {line}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[13px] text-ink-400">{humanizeFieldKey('parsed_fields')} —</p>
        )}
      </ReportCard>

      {(() => {
        const roles = Array.isArray(d?.workbook_sheet_roles) ? d.workbook_sheet_roles : null;
        const calOkDays = getSettlementCalendarOkMaxDays(d);
        const showSettlementLag =
          posSettlementDelays.length > 0 ||
          ecomSettlementDelays.length > 0 ||
          (posBatchLag.rawBatchCount > 0 && posBatchBank.rows.length === 0) ||
          (ecomSettlementLag.rawOrderCount > 0 && ecomSettlementLag.datedPairCount === 0) ||
          (isTabular && posBatchLag.rawBatchCount === 0);
        if (!showSettlementLag) return null;
        const posExpected = posBatchBank.expectedBusinessDays;
        const ecomExpected = ecomSettlementLag.expectedBusinessDays;
        return (
          <ReportCard id={reportSectionSlug('discrepancy', 'settlement-lag')} className="p-6 md:p-8 overflow-x-auto">
            <div className="smallcaps text-ink-400 text-[11px] tracking-wide mb-2">Settlement timing — late counts</div>
            <div className="mb-4 max-w-3xl rounded-xl border border-ink/10 bg-cream-100/45 px-4 py-3">
              <div className="font-serif text-xl text-ink leading-snug">
                {posSettlementDelays.length === 0 && ecomSettlementDelays.length === 0 ? (
                  <span>No POS batches or e‑commerce orders on this file were flagged late under the rules below.</span>
                ) : (
                  <>
                    {posSettlementDelays.length > 0 ? (
                      <span>
                        {posSettlementDelays.length} POS settlement{posSettlementDelays.length === 1 ? '' : 's'} late
                      </span>
                    ) : null}
                    {posSettlementDelays.length > 0 && ecomSettlementDelays.length > 0 ? (
                      <span className="text-ink-400 font-sans font-normal"> · </span>
                    ) : null}
                    {ecomSettlementDelays.length > 0 ? (
                      <span>
                        {ecomSettlementDelays.length} e‑commerce order{ecomSettlementDelays.length === 1 ? '' : 's'}{' '}
                        late
                      </span>
                    ) : null}
                  </>
                )}
              </div>
              {(posSettlementDelays.length > 0 && posBatchBank.datedBatchCount > 0) ||
              (ecomSettlementDelays.length > 0 && ecomSettlementLag.datedPairCount > 0) ? (
                <p className="text-[12px] text-ink-500 mt-2 leading-relaxed">
                  {posSettlementDelays.length > 0 && posBatchBank.datedBatchCount > 0 ? (
                    <span className="block sm:inline sm:mr-3">
                      POS: {posSettlementDelays.length} of {posBatchBank.datedBatchCount} batch
                      {posBatchBank.datedBatchCount === 1 ? '' : 'es'} with both close and bank dates exceeded the rule on
                      this statement.
                    </span>
                  ) : null}
                  {ecomSettlementDelays.length > 0 && ecomSettlementLag.datedPairCount > 0 ? (
                    <span className="block sm:inline">
                      E‑commerce: {ecomSettlementDelays.length} of {ecomSettlementLag.datedPairCount} order
                      {ecomSettlementLag.datedPairCount === 1 ? '' : 's'} with both activity and bank dates exceeded the
                      rule.
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
            <p className="text-[12px] text-ink-500 mb-5 max-w-3xl leading-relaxed">
              “Late” uses <span className="font-medium text-ink-600">only dates on this parse</span> vs the processor
              windows stamped on it (T+{posExpected} business days POS / T+{ecomExpected} e‑commerce from batch close or
              sale activity). Calendar-only rows can also appear when close → bank spans more than{' '}
              <span className="font-mono text-[11px]">{calOkDays}</span> calendar day
              {calOkDays === 1 ? '' : 's'} — adjust{' '}
              <span className="font-mono text-[11px]">settlement_calendar_ok_days</span> (1–14) on the payload. That is
              not a universal bank SLA; it is how we count outliers on <span className="font-medium text-ink-600">this</span>{' '}
              statement.
            </p>

            {posSettlementDelays.length > 0 ? (
              <div className="mb-8">
                <div className="font-serif text-lg text-ink mb-2">POS — late batches (detail)</div>
                <div className="overflow-x-auto rounded-lg border border-ink/10 max-w-4xl">
                  <table className="w-full text-sm min-w-[720px] border-collapse">
                    <thead>
                      <tr className="bg-cream-200/50 border-b hair text-left smallcaps text-ink-500 text-[11px]">
                        <th className="py-2.5 px-3 font-medium">{humanizeFieldKey('batch_number')}</th>
                        <th className="py-2.5 px-3 font-medium text-right">Calendar days</th>
                        <th className="py-2.5 px-3 font-medium">Notice</th>
                        <th className="py-2.5 px-3 font-medium text-right">Batch close</th>
                        <th className="py-2.5 px-3 font-medium text-right">Bank credit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-hair">
                      {posSettlementDelays.map((row, ri) => (
                        <tr key={`${ri}-${row.batchId}-${row.batchCloseYmd}`} className="bg-amber-soft/20 text-ink">
                          <td className="py-2 px-3 font-mono font-medium">{row.batchId}</td>
                          <td className="py-2 px-3 font-mono tabular text-right">{row.calendarDaysToBank}</td>
                          <td className="py-2 px-3 text-[12px] text-ink-600 leading-snug">
                            {row.flag === 'business_T+N' && row.businessDaysPastT != null ? (
                              <>
                                Late vs file T+{posExpected}: batch{' '}
                                <span className="font-mono font-medium text-ink">{row.batchId}</span> by{' '}
                                <span className="font-semibold text-ink">{row.businessDaysPastT}</span> business day
                                {row.businessDaysPastT === 1 ? '' : 's'} (calendar {row.calendarDaysToBank}).
                              </>
                            ) : (
                              <>
                                Late vs calendar allowance on parse: batch{' '}
                                <span className="font-mono font-medium text-ink">{row.batchId}</span>,{' '}
                                <span className="font-semibold text-ink">{row.calendarDaysToBank}</span> calendar day
                                {row.calendarDaysToBank === 1 ? '' : 's'} close → bank (threshold {calOkDays}).
                              </>
                            )}
                          </td>
                          <td className="py-2 px-3 font-mono tabular text-right">{row.batchCloseYmd}</td>
                          <td className="py-2 px-3 font-mono tabular text-right">{row.bankCreditYmd}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {ecomSettlementDelays.length > 0 ? (
              <div className="mb-8">
                <div className="font-serif text-lg text-ink mb-2">E‑commerce — late orders (detail)</div>
                <div className="overflow-x-auto rounded-lg border border-ink/10 max-w-4xl">
                  <table className="w-full text-sm min-w-[720px] border-collapse">
                    <thead>
                      <tr className="bg-cream-200/50 border-b hair text-left smallcaps text-ink-500 text-[11px]">
                        <th className="py-2.5 px-3 font-medium">{humanizeFieldKey('order_id')}</th>
                        <th className="py-2.5 px-3 font-medium text-right">Calendar days</th>
                        <th className="py-2.5 px-3 font-medium">Notice</th>
                        <th className="py-2.5 px-3 font-medium text-right">Activity</th>
                        <th className="py-2.5 px-3 font-medium text-right">Bank credit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-hair">
                      {ecomSettlementDelays.map((row, ri) => (
                        <tr key={`${ri}-${row.orderId}-${row.activityYmd}`} className="bg-amber-soft/20 text-ink">
                          <td className="py-2 px-3 font-mono font-medium break-all max-w-[14rem]">{row.orderId}</td>
                          <td className="py-2 px-3 font-mono tabular text-right">{row.calendarDays}</td>
                          <td className="py-2 px-3 text-[12px] text-ink-600 leading-snug">
                            {row.flag === 'business_T+N' && row.businessDaysPastT != null ? (
                              <>
                                Late vs file T+{ecomExpected}: order{' '}
                                <span className="font-mono font-medium text-ink">{row.orderId}</span> by{' '}
                                <span className="font-semibold text-ink">{row.businessDaysPastT}</span> business day
                                {row.businessDaysPastT === 1 ? '' : 's'} (calendar {row.calendarDays}).
                              </>
                            ) : (
                              <>
                                Late vs calendar allowance on parse: order{' '}
                                <span className="font-mono font-medium text-ink">{row.orderId}</span>,{' '}
                                <span className="font-semibold text-ink">{row.calendarDays}</span> calendar day
                                {row.calendarDays === 1 ? '' : 's'} activity → bank (threshold {calOkDays}).
                              </>
                            )}
                          </td>
                          <td className="py-2 px-3 font-mono tabular text-right">{row.activityYmd}</td>
                          <td className="py-2 px-3 font-mono tabular text-right">{row.bankCreditYmd}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {ecomSettlementLag.missingActivityOrderIds?.length > 0 ? (
              <div className="mb-6">
                <div className="font-serif text-base text-ink mb-1">E‑commerce — missing activity / order date</div>
                <p className="text-[11px] text-ink-500 mb-2 max-w-3xl">
                  These order IDs have no parseable <span className="font-mono">order_date</span> /{' '}
                  <span className="font-mono">transaction_date</span> (or workbook <span className="font-medium">Order Date</span> column){' '}
                  — so calendar days to the bank cannot be computed. Re-upload the .xlsx so the sheet merge can map dates, or fix the parser output.
                  {ecomSettlementLag.missingActivityOrderIds.length >= 250 && ecomSettlementLag.missingActivityDate > 250
                    ? ` Showing first 250 of ${ecomSettlementLag.missingActivityDate}.`
                    : ecomSettlementLag.missingActivityDate > ecomSettlementLag.missingActivityOrderIds.length
                      ? ` (${ecomSettlementLag.missingActivityDate} total in parse.)`
                      : null}
                </p>
                <div className="overflow-x-auto rounded-lg border border-ink/10 max-w-4xl">
                  <table className="w-full text-sm min-w-[480px] border-collapse">
                    <thead>
                      <tr className="bg-cream-200/50 border-b hair text-left smallcaps text-ink-500 text-[11px]">
                        <th className="py-2.5 px-3 font-medium">{humanizeFieldKey('order_id')}</th>
                        <th className="py-2.5 px-3 font-medium text-right">Bank credit (if parsed)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-hair">
                      {ecomSettlementLag.missingActivityOrderIds.map((r, ri) => (
                        <tr key={`${ri}-${r.orderId}`} className="text-ink">
                          <td className="py-2 px-3 font-mono font-medium break-all max-w-[18rem]">{r.orderId}</td>
                          <td className="py-2 px-3 font-mono tabular text-right text-ink-500">
                            {r.bankCreditYmd || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {ecomSettlementLag.missingBankOrderRows?.length > 0 ? (
              <div className="mb-6">
                <div className="font-serif text-base text-ink mb-1">E‑commerce — missing bank / payout date</div>
                <p className="text-[11px] text-ink-500 mb-2 max-w-3xl">
                  Activity present; no bank credit date on the row — cannot compute lag.
                  {ecomSettlementLag.missingBankOrderRows.length >= 250 && ecomSettlementLag.missingBankDate > 250
                    ? ` Showing first 250 of ${ecomSettlementLag.missingBankDate}.`
                    : ecomSettlementLag.missingBankDate > ecomSettlementLag.missingBankOrderRows.length
                      ? ` (${ecomSettlementLag.missingBankDate} total.)`
                      : null}
                </p>
                <div className="overflow-x-auto rounded-lg border border-ink/10 max-w-4xl">
                  <table className="w-full text-sm min-w-[480px] border-collapse">
                    <thead>
                      <tr className="bg-cream-200/50 border-b hair text-left smallcaps text-ink-500 text-[11px]">
                        <th className="py-2.5 px-3 font-medium">{humanizeFieldKey('order_id')}</th>
                        <th className="py-2.5 px-3 font-medium text-right">Activity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-hair">
                      {ecomSettlementLag.missingBankOrderRows.map((r, ri) => (
                        <tr key={`${ri}-${r.orderId}`} className="text-ink">
                          <td className="py-2 px-3 font-mono font-medium break-all max-w-[18rem]">{r.orderId}</td>
                          <td className="py-2 px-3 font-mono tabular text-right">{r.activityYmd}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {posBatchLag.missingBatchCloseRows?.length > 0 ? (
              <div className="mb-6">
                <div className="font-serif text-base text-ink mb-1">POS — missing batch-close date</div>
                <p className="text-[11px] text-ink-500 mb-2">Batch IDs from rows with no parseable close date — T+N not computed. Up to 250 rows.</p>
                <div className="overflow-x-auto rounded-lg border border-ink/10 max-w-2xl">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-cream-200/50 border-b hair text-left smallcaps text-ink-500 text-[11px]">
                        <th className="py-2.5 px-3 font-medium">{humanizeFieldKey('batch_number')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-hair">
                      {posBatchLag.missingBatchCloseRows.map((r, ri) => (
                        <tr key={`${ri}-${r.batchId}`} className="text-ink">
                          <td className="py-2 px-3 font-mono font-medium">{r.batchId}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {posBatchLag.missingBankCreditRows?.length > 0 ? (
              <div className="mb-6">
                <div className="font-serif text-base text-ink mb-1">POS — missing bank credit date</div>
                <p className="text-[11px] text-ink-500 mb-2">
                  Batch close present; bank credit date missing — cannot compute lag.
                  {posBatchLag.missingBankCreditRows.length >= 250 && posBatchBank.missingBankCreditDate > 250
                    ? ` Showing first 250 of ${posBatchBank.missingBankCreditDate}.`
                    : posBatchBank.missingBankCreditDate > posBatchLag.missingBankCreditRows.length
                      ? ` (${posBatchBank.missingBankCreditDate} total.)`
                      : null}
                </p>
                <div className="overflow-x-auto rounded-lg border border-ink/10 max-w-3xl">
                  <table className="w-full text-sm min-w-[360px] border-collapse">
                    <thead>
                      <tr className="bg-cream-200/50 border-b hair text-left smallcaps text-ink-500 text-[11px]">
                        <th className="py-2.5 px-3 font-medium">{humanizeFieldKey('batch_number')}</th>
                        <th className="py-2.5 px-3 font-medium text-right">Batch close</th>
                      </tr>
                    </thead>
                    <tbody className="divide-hair">
                      {posBatchLag.missingBankCreditRows.map((r, ri) => (
                        <tr key={`${ri}-${r.batchId}`} className="text-ink">
                          <td className="py-2 px-3 font-mono font-medium">{r.batchId}</td>
                          <td className="py-2 px-3 font-mono tabular text-right">{r.batchCloseYmd}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {posSettlementDelays.length === 0 &&
            ecomSettlementDelays.length === 0 &&
            posBatchLag.datedBatchCount > 0 &&
            ecomSettlementLag.datedPairCount > 0 ? (
              <p className="text-[12px] text-ink-500 mb-4 max-w-2xl">
                No order or batch exceeded <span className="font-medium">more than {calOkDays}</span> calendar day
                {calOkDays === 1 ? '' : 's'} from close / activity to bank credit — nothing listed above.
              </p>
            ) : null}

            {posSettlementDelays.length === 0 &&
            posBatchLag.datedBatchCount > 0 &&
            ecomSettlementLag.datedPairCount === 0 &&
            ecomSettlementLag.rawOrderCount === 0 ? (
              <p className="text-[12px] text-ink-500 mb-4 max-w-2xl">
                No e‑commerce order lines in the parse — only POS timing applies.
              </p>
            ) : null}

            {posBatchLag.rawBatchCount > 0 && posBatchBank.rows.length === 0 ? (
              <p className="text-[13px] text-amber-900/90 leading-relaxed max-w-3xl">
                This statement has {posBatchLag.rawBatchCount} POS batch record{posBatchLag.rawBatchCount === 1 ? '' : 's'}, but batch close or bank credit dates could not be read. Use{' '}
                <span className="font-mono text-[12px]">batch_close_date</span> and{' '}
                <span className="font-mono text-[12px]">bank_credit_date</span> (ISO or M/D/YYYY), or re-upload the tabular file (.xlsx, .xls, .csv).
              </p>
            ) : null}

            {!isTabular && hasPosLayer && posBatchLag.rawBatchCount === 0 && posBatchLag.datedBatchCount === 0 && posSettlementDelays.length === 0 ? (
              <p className="text-[13px] text-ink-600 leading-relaxed max-w-3xl mb-3">
                This upload is not a tabular export, so we cannot scan a daily POS batch grid from the file bytes. Per-batch timing needs{' '}
                <span className="font-mono text-[12px]">pos_settlement_batches</span> in the parsed snapshot—usually from a processor spreadsheet export or an enhanced parser—not from a typical PDF layout alone.
              </p>
            ) : null}

            {isTabular && posBatchLag.rawBatchCount === 0 ? (
              <>
                <p className="text-[13px] text-ink-600 leading-relaxed max-w-3xl">
                  No POS batch rows are on this snapshot. Use the <span className="font-medium">Upload</span> tab to add a fresh parse of{' '}
                  <span className="font-medium">{stmt?.fileName || 'your spreadsheet or CSV'}</span> so batch rows can be merged from the tabular file when the parser does not return them.
                </p>
                {roles?.length ? (
                  <p className="text-[12px] text-ink-400 mt-3 leading-relaxed max-w-3xl">
                    Tabs classified from the workbook:
                    <span className="block mt-1.5 font-mono text-[11px] text-ink-500">
                      {roles.map((r) => `${r.name} (${r.role})`).join(' · ')}
                    </span>
                  </p>
                ) : null}
              </>
            ) : null}

          </ReportCard>
        );
      })()}
    </div>
  );
}

// ── Q&A Tab ─────────────────────────────────────────────────────────
function TabQA({ stmt }) {
  const [msgs, setMsgs] = useState([]);
  const suggestions = useMemo(() => buildQaSuggestions(stmt?.parsedData), [stmt?.parsedData]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const { addToast } = useToast();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  const send = async () => {
    if (!draft.trim() || loading) return;
    const q = draft.trim();
    setDraft('');
    setMsgs(m => [...m, { role: 'u', t: q }]);
    setLoading(true);
    try {
      const statementContext = {
        acquirer: stmt?.acquirer,
        period: stmt?.period,
        parsedData: stmt?.parsedData,
      };
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: q }], statementContext }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const answer = data.content || 'No response.';
      const cite = answer.match(/\[Source: ([^\]]+)\]/)?.[1];
      const text = answer.replace(/\[Source: [^\]]+\]/, '').trim();
      setMsgs(m => [...m, { role: 'a', t: text, cite }]);
    } catch (err) {
      addToast({ type: 'error', title: 'Q&A error', message: String(err) });
      setMsgs(m => [...m, { role: 'a', t: 'Sorry, I encountered an error. Please try again.', cite: null }]);
    } finally {
      setLoading(false);
    }
  };

  const exportQA = () => {
    const rows = [['Role', 'Message', 'Source']];
    msgs.forEach(m => rows.push([m.role === 'u' ? 'User' : 'Assistant', m.t, m.cite || '']));
    downloadCSV(rows, 'qa-export.csv');
    addToast({ type: 'success', title: 'Q&A exported' });
  };

  return (
    <ReportCard id={reportSectionSlug('qa', 'assistant')}>
      <div className="p-5 hair-b flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="font-serif text-2xl">Ask about your statement</div>
          <div className="text-[12px] text-ink-400">Answers grounded in your parsed data only. Declines out-of-scope questions. Uses deterministic rules (no live LLM call in this build).</div>
        </div>
        <Btn variant="outline" size="sm" icon={<Icon.Download size={13} />} onClick={exportQA}>Export Q&A</Btn>
      </div>
      <div className="max-h-[460px] overflow-auto scrollbar-thin p-6 space-y-4">
        {msgs.length === 0 && !loading && (
          <p className="text-[13px] text-ink-400 text-center py-6">
            Answers use only fields from your parsed statement. Ask below or pick a suggestion when your data includes those fields.
          </p>
        )}
        {msgs.map((m, i) => (
          m.role === 'u' ? (
            <div key={i} className="flex justify-end">
              <div className="bg-ink text-cream rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] max-w-[80%]">{m.t}</div>
            </div>
          ) : (
            <div key={i} className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-teal-dim flex items-center justify-center shrink-0">
                <Icon.Sparkles size={14} className="text-teal" />
              </div>
              <div className="max-w-[80%]">
                <div className="bg-cream-200/60 border hair rounded-2xl rounded-tl-md px-4 py-2.5 text-[14px] whitespace-pre-wrap">{m.t}</div>
                {m.cite && <div className="font-mono text-[11px] text-ink-400 mt-1.5 ml-1">Source: {m.cite}</div>}
              </div>
            </div>
          )
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-teal-dim flex items-center justify-center shrink-0">
              <Icon.Sparkles size={14} className="text-teal" />
            </div>
            <div className="bg-cream-200/60 border hair rounded-2xl rounded-tl-md px-4 py-2.5">
              <div className="flex gap-1">
                {[0, 1, 2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-ink/40 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="p-4 hair-t bg-cream-200/30">
        <div className="flex gap-2">
          <input value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Ask a question about your statement…"
            className="flex-1 h-11 px-4 bg-cream-100 border hair rounded-full text-sm outline-none focus:border-ink transition" />
          <Btn variant="primary" onClick={send} disabled={loading} icon={<Icon.Send size={14} />}>Ask</Btn>
        </div>
        {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => setDraft(s)} className="px-3 py-1.5 rounded-full border hair text-[12px] text-ink-500 hover:bg-cream-200 transition">{s}</button>
          ))}
        </div>
        )}
      </div>
    </ReportCard>
  );
}

// ── Report Page ─────────────────────────────────────────────────────
export default function ReportPage() {
  const [tab, setTab] = useState('overview');
  const { user, getCurrentStatement, statements } = useApp();
  const { addToast } = useToast();
  const router = useRouter();
  const stmt = getCurrentStatement();

  const peerStatementsForSummary = useMemo(() => {
    if (!stmt?.id || !Array.isArray(statements)) return [];
    const others = statements.filter((s) => s && s.id !== stmt.id && s.parsedData && typeof s.parsedData === 'object');
    const scored = others.map((s) => {
      let t = 0;
      if (s.uploadDate) {
        const dt = new Date(s.uploadDate);
        if (!Number.isNaN(dt.getTime())) t = dt.getTime();
      }
      return { s, t };
    });
    scored.sort((a, b) => b.t - a.t);
    return scored.map(({ s }) => ({
      period: s.period,
      acquirer: s.acquirer,
      parsedData: finalizeParsedForClient({ ...s.parsedData }),
    }));
  }, [statements, stmt?.id]);

  const stmtDisplayRaw = useMemo(() => {
    if (!stmt?.parsedData) return stmt;
    const pd = finalizeParsedForClient({ ...stmt.parsedData });
    return { ...stmt, parsedData: pd };
  }, [stmt, parsedDataFinalizeDeps(stmt?.parsedData)]);

  const statementModel = useMemo(() => {
    const pd = stmtDisplayRaw?.parsedData;
    if (!pd) return null;
    return buildStatementClientModel(pd);
  }, [stmtDisplayRaw?.id, stmtDisplayRaw?.parsedData, parsedDataFinalizeDeps(stmtDisplayRaw?.parsedData)]);

  const stmtDisplay = useMemo(() => {
    if (!stmtDisplayRaw) return null;
    if (!statementModel?.parsedData) return stmtDisplayRaw;
    return { ...stmtDisplayRaw, parsedData: statementModel.parsedData };
  }, [stmtDisplayRaw, statementModel]);

  const reportIdentity = useMemo(() => {
    const pd = stmtDisplay?.parsedData;
    if (!pd) return { shop: '', id: null };
    return { shop: displayBusinessName(pd, stmtDisplay?.acquirer), id: getParsedIdentity(pd) };
  }, [stmtDisplay]);

  const exportExcel = () => {
    if (!stmtDisplay) return;
    const pd = stmtDisplay.parsedData;
    const ccy = getStatementDisplayCurrency(pd);
    const { total: feeTot } = reconcileTotalFeesCharged(pd);
    const gvExport = overviewPrimarySalesVolumeGross(pd);
    const erExport = effectiveRatePercentFromTotals(feeTot, gvExport);
    const chBars = getChannelVolumeBarsFromParsed(pd);
    const rid = getParsedIdentity(pd);
    const rows = [
      ['OptiSMB Analysis Report'],
      ['Acquirer', stmtDisplay.acquirer],
      ['Shop (parsed)', displayBusinessName(pd, stmtDisplay.acquirer)],
      ['Bank', rid.bank_name || ''],
      ['Account', rid.account_number || ''],
      ['MID', rid.merchant_id || ''],
      ['Period', stmtDisplay.period],
      [
        'Effective Rate',
        erExport != null ? `${erExport.toFixed(2)}%` : pd?.effective_rate != null ? `${Number(pd.effective_rate).toFixed(2)}%` : '—',
      ],
      ['Total Fees', formatMoney(feeTot, ccy)],
      ['Total Volume (overview basis)', formatMoney(gvExport, ccy)],
      ...chBars.map((b) => [`Volume — ${b.label}`, formatMoney(b.value, ccy)]),
      ...(() => {
        const raw = Array.isArray(pd?.fee_lines) ? pd.fee_lines : [];
        const exportFeeLines = raw.filter((f) => !isSyntheticInterchangeSchemeProcessorFeeLine(f));
        if (!exportFeeLines.length) return [];
        return [
          [],
          ['Fee lines (itemized)'],
          ['Type', 'Rate', 'Amount', 'Card Type', 'Channel'],
          ...exportFeeLines.map((f, i) => [
            feeLineDisplayLabel(f, i, pd),
            f.rate,
            formatMoney(feeLineDisplayAmount(f), ccy),
            feeLineResolvedCardLabel(f, i, pd) || feeLineCardDisplayId(f, i),
            f.channel,
          ]),
        ];
      })(),
    ];
    downloadCSV(rows, `optismb-${stmtDisplay.acquirer.replace(/\s+/g, '-')}-${stmtDisplay.period.replace(/\s+/g, '-')}.csv`);
    addToast({ type: 'success', title: 'Export downloaded', message: 'Saved as CSV (Excel compatible).' });
  };

  if (!stmt) {
    return (
      <div className="text-center py-20">
        <p className="text-ink-400 mb-4">No statement selected.</p>
        <Link href="/upload"><Btn variant="primary" icon={<Icon.Upload size={14} />}>Upload a statement</Btn></Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {stmtDisplay?.source === 'demo' ? (
        <Disclaimer tone="warn">
          <span className="font-medium text-ink-700">This report uses built-in sample data,</span> not the file you
          uploaded. Live parsing did not return usable JSON (parser offline, rejected file, timeout, or unsupported
          layout). Check the toast after upload for details. For local dev, run{' '}
          <span className="font-mono text-[11px]">npm run parser</span> on port 8000 with{' '}
          <span className="font-mono text-[11px]">npm run dev</span>. CSV / XLSX usually matches the workbook best.
          {stmtDisplay?.parseFailureReason ? (
            <span className="block mt-2 text-[11px] font-mono text-ink-500">
              Reason: {String(stmtDisplay.parseFailureReason)}
            </span>
          ) : null}
        </Disclaimer>
      ) : null}
      {stmtDisplay?.source !== 'demo' &&
      stmtDisplay?.statementCategory === 'pos' &&
      !(Array.isArray(stmtDisplay?.linkedSourceFiles) && stmtDisplay.linkedSourceFiles.length > 0) ? (
        <Disclaimer tone="info">
          <span className="font-medium text-ink-700">Single POS / processor upload.</span> Overview, fees, Channel (when
          we can infer gross), and the “one read” strip reflect <span className="font-medium">this file only</span>. Tables
          for e-commerce or bank stay empty unless that data is on the same parse. For a{' '}
          <span className="font-medium">combined</span> POS + online + bank report, use Upload →{' '}
          <span className="font-medium">Linked files</span> and add all three exports.
        </Disclaimer>
      ) : null}
      {stmtDisplay?.source !== 'demo' &&
      Array.isArray(stmtDisplay?.linkedSourceFiles) &&
      stmtDisplay.linkedSourceFiles.length > 0 ? (
        <Disclaimer tone="info">
          <span className="font-medium text-ink-700">Combined linked report.</span> Merged from{' '}
          {stmtDisplay.linkedSourceFiles.join(' · ')} — cross-channel POS, e-commerce, and bank views use this snapshot
          together.
        </Disclaimer>
      ) : null}
      {stmtDisplay?.source !== 'demo' &&
      typeof stmtDisplay?.parsedData?.report_ui?.format_compatibility_notice === 'string' &&
      stmtDisplay.parsedData.report_ui.format_compatibility_notice.trim() ? (
        <Disclaimer tone="warn">
          <p className="font-medium text-ink-800 mb-1">Column map not verified for this layout</p>
          <p className="text-[13px] text-ink-600 leading-relaxed max-w-3xl">
            {stmtDisplay.parsedData.report_ui.format_compatibility_notice.trim()}
          </p>
        </Disclaimer>
      ) : null}
      {/* Header — one card: title + statement facts */}
      <ReportCard id={reportSectionSlug('page', 'statement-header')} className="overflow-hidden border-ink/10 bg-cream-100/90 shadow-card">
        <div className="p-5 md:p-6 pb-4 md:pb-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1 space-y-3">
              <nav className="text-[11px] text-ink-400 flex flex-wrap items-center gap-x-1.5 gap-y-1" aria-label="Breadcrumb">
                <Link href="/analyses" className="hover:text-ink transition-colors">
                  Analysis
                </Link>
                <Icon.ChevronRight size={12} className="opacity-50 shrink-0 hidden sm:block" />
                <span className="text-ink-500 truncate max-w-[12rem] sm:max-w-none">{stmtDisplay.acquirer}</span>
                <Icon.ChevronRight size={12} className="opacity-50 shrink-0 hidden sm:block" />
                <span className="text-ink-500">{stmtDisplay.period}</span>
              </nav>
              <div>
                <h1 className="font-serif text-3xl sm:text-4xl leading-[1.12] text-ink tracking-tight">
                  {reportIdentity.shop && reportIdentity.shop !== 'Statement'
                    ? reportIdentity.shop
                    : stmtDisplay.acquirer}
                </h1>
                <p className="text-[15px] text-ink-500 mt-1.5 font-medium">{stmtDisplay.period}</p>
                <p className="text-[13px] text-ink-400 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>Uploaded {stmtDisplay.uploadDate}</span>
                  <span className="hidden sm:inline text-ink/25" aria-hidden>
                    |
                  </span>
                  <span>
                    Gross volume{' '}
                    {formatCompactMoney(
                      stmtDisplay.parsedData?.total_transaction_volume,
                      getStatementDisplayCurrency(stmtDisplay.parsedData),
                    )}
                  </span>
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 no-print lg:pt-7 shrink-0">
              {tierOk(user.tier, 'L1') && (
                <Btn variant="outline" size="sm" icon={<Icon.Download size={13} />} onClick={triggerPrint}>
                  PDF
                </Btn>
              )}
              {tierOk(user.tier, 'L2') && (
                <Btn variant="outline" size="sm" icon={<Icon.Download size={13} />} onClick={exportExcel}>
                  Excel
                </Btn>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-ink/8 bg-cream-200/35 px-5 md:px-6 py-4 md:py-5">
          <p className="smallcaps text-ink-400 mb-3 text-[10px]">From your statement</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 sm:gap-x-8 sm:gap-y-5">
            <div className="min-w-0">
              <dt className="text-[12px] text-ink-400 mb-0.5">Business</dt>
              <dd className="text-sm text-ink font-medium leading-snug break-words">
                {reportIdentity.shop && reportIdentity.shop !== 'Statement'
                  ? reportIdentity.shop
                  : stmtDisplay.acquirer || '—'}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[12px] text-ink-400 mb-0.5">Bank</dt>
              <dd className="text-sm text-ink font-mono tabular-nums leading-snug break-all">
                {reportIdentity.id?.bank_name || '—'}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[12px] text-ink-400 mb-0.5">Account</dt>
              <dd className="text-sm text-ink font-mono tabular-nums leading-snug break-all">
                {reportIdentity.id?.account_number || '—'}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[12px] text-ink-400 mb-0.5">Merchant ID</dt>
              <dd className="text-sm text-ink font-mono tabular-nums leading-snug break-all">
                {reportIdentity.id?.merchant_id || '—'}
              </dd>
            </div>
          </dl>
          {statementModel?.fromStatement?.length ? (
            <div className="mt-5 pt-5 border-t border-ink/8">
              <p className="smallcaps text-ink-400 mb-3 text-[10px]">One read — where POS amounts go in this UI</p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-x-6">
                {statementModel.fromStatement.map((row) => (
                  <div key={row.id} className="min-w-0">
                    <dt className="text-[12px] text-ink-400 mb-0.5">{row.label}</dt>
                    <dd className="text-sm text-ink font-mono tabular-nums font-medium">{row.value}</dd>
                    {row.hint ? (
                      <dd className="text-[11px] text-ink-500 mt-1 leading-snug">{row.hint}</dd>
                    ) : null}
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      </ReportCard>

      <Disclaimer>
        OptiSMB provides statement analysis for informational purposes only — this is not financial or regulatory advice.
        Figures are derived from parsed statement data; confirm material numbers with your acquirer before acting on them.
      </Disclaimer>

      {/* Tabs — horizontal strip (sticky on scroll) */}
      <div className="flex flex-col gap-6">
        <nav
          className="no-print sticky top-0 z-20 -mx-1 px-1 py-2 mb-0 bg-[#F8F5F0]/95 backdrop-blur-md border-b border-ink/10"
          aria-label="Report sections"
          role="tablist"
        >
          <div className="flex gap-1 sm:gap-1.5 overflow-x-auto pb-1 scrollbar-thin snap-x snap-mandatory sm:flex-wrap sm:overflow-visible">
            {TABS.map(({ k, l, tier }) => {
              const TabIc = TAB_ICON[k] || Icon.FileText;
              const active = tab === k;
              const locked = tier && !tierOk(user.tier, tier);
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(k)}
                  className={`snap-start shrink-0 inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-left text-[13px] font-medium transition border ${
                    active
                      ? 'bg-ink text-cream border-ink shadow-sm'
                      : 'bg-cream-100/80 text-ink-500 border-ink/10 hover:bg-cream-200/80 hover:border-ink/15'
                  }`}
                >
                  <TabIc size={15} className={active ? 'opacity-95' : 'opacity-70'} />
                  <span className="whitespace-nowrap">{l}</span>
                  {locked && <Icon.Lock size={12} className="shrink-0 opacity-60" />}
                </button>
              );
            })}
          </div>
        </nav>
        <div
          className="fade-up min-w-0 scroll-mt-28"
          key={`${stmt?.id ?? 'stmt'}-${tab}`}
          id={reportSectionSlug('tab', tab)}
        >
          {tab === 'overview' && <TabOverview stmt={stmtDisplay} />}
          {tab === 'breakdown' && <TabBreakdown stmt={stmtDisplay} />}
          {tab === 'channel' && <TabChannel stmt={stmtDisplay} statementModel={statementModel} />}
          {tab === 'discrepancy' && (
            <TabDiscrepancy
              stmt={stmtDisplay}
              statementModel={statementModel}
              peerStatementsForSummary={peerStatementsForSummary}
            />
          )}
          {tab === 'qa' && (
            <TierGate needed="L1" currentTier={user.tier} onUpgrade={() => router.push('/upgrade')} reason="The Q&A assistant is a Level 1 feature">
              <TabQA stmt={stmtDisplay} />
            </TierGate>
          )}
        </div>
      </div>
    </div>
  );
}
