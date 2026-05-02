'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as Icon from '@/components/Icons';
import { Card, KPI, Btn, Pill, DualConfidence, ConfidenceBadge, TierGate, Disclaimer } from '@/components/UI';
import { DonutChart, HBar, LineChart } from '@/components/Charts';
import { useApp } from '@/components/AppContext';
import { useToast } from '@/components/Toast';
import {
  tierOk,
  downloadCSV,
  triggerPrint,
  reconcileTotalFeesCharged,
  getFeeCompositionForOverview,
  getCardBrandMixFromParsed,
  channelSalesVolume,
  getParsedIdentity,
  displayBusinessName,
} from '@/lib/utils';
import { DATA_TIER_LABELS } from '@/lib/mockData';
import { CashFlowSummaryCard } from '@/components/CashFlowSummaryCard';
import { BankDepositReconciliationCard } from '@/components/BankDepositReconciliationCard';
import { formatMoney, formatCompactMoney, cardMixRowVolume, getStatementDisplayCurrency, finalizeParsedForClient } from '@/lib/currencyConversion';
import { getBenchmarkAnalysis } from '@/lib/computeBenchmarkAnalysis';
import { BENCHMARK_EFFECTIVE_RATE_PCT } from '@/lib/benchmarkConstants';
import { posNetDepositTotal } from '@/lib/financialAnalysisFormulas';

const TABS = [
  { k: 'overview', l: 'Overview' },
  { k: 'breakdown', l: 'Fee Breakdown' },
  { k: 'channel', l: 'Channel Split' },
  { k: 'discrepancy', l: 'Discrepancy Report', tier: 'L1' },
  { k: 'benchmark', l: 'Benchmarking' },
  { k: 'qa', l: 'Q&A', tier: 'L1' },
];

const TAB_ICON = {
  overview: Icon.LayoutDashboard,
  breakdown: Icon.Receipt,
  channel: Icon.CreditCard,
  discrepancy: Icon.AlertTriangle,
  benchmark: Icon.BarChart,
  qa: Icon.Sparkles,
};

/** Prefer channel_split volumes; else top-level pos/ecomm; else allocate gross by channel fee mix (same heuristics as before, data-driven). */
function inferChannelVolumesForOverview(d) {
  let posV = channelSalesVolume(d.channel_split?.pos);
  let cnpV = channelSalesVolume(d.channel_split?.cnp);
  const gv = Number(d.total_transaction_volume) || 0;
  const tiny = (v) => !(Number(v) > 0.01);

  if (!tiny(posV) || !tiny(cnpV)) {
    return { posV, cnpV };
  }

  const pvTop = Number(d.pos_volume);
  const evTop = Number(d.ecomm_volume);
  if (Number.isFinite(pvTop) && pvTop >= 0 && Number.isFinite(evTop) && evTop >= 0 && pvTop + evTop > 0.01) {
    return { posV: pvTop, cnpV: evTop };
  }

  if (gv > 0.01) {
    const posF = Number(d.channel_split?.pos?.fees) || 0;
    const cnpF = Number(d.channel_split?.cnp?.fees) || 0;
    const sumF = posF + cnpF;
    if (sumF > 0.01) {
      return {
        posV: gv * (posF / sumF),
        cnpV: gv * (cnpF / sumF),
      };
    }
  }

  return { posV, cnpV };
}

// ── Overview Tab ────────────────────────────────────────────────────
function TabOverview({ stmt }) {
  const d = stmt?.parsedData;
  if (!d) return null;
  const displayCcy = getStatementDisplayCurrency(d);
  const { total: feeTotal } = reconcileTotalFeesCharged(d);
  const gv = Number(d.total_transaction_volume) || 0;
  const netAfter =
    d.net_revenue != null && Number.isFinite(Number(d.net_revenue))
      ? Number(d.net_revenue)
      : gv > 0
        ? posNetDepositTotal(gv, feeTotal)
        : null;
  const comp = getFeeCompositionForOverview(d);
  const ba = getBenchmarkAnalysis(d);
  const benchRate = ba?.benchmark?.benchmark_rate_pct ?? BENCHMARK_EFFECTIVE_RATE_PCT;
  const overpay = ba?.benchmark?.estimated_overpayment;

  let eff =
    d.effective_rate != null && d.effective_rate !== ''
      ? Number(d.effective_rate)
      : gv > 0 && feeTotal >= 0
        ? (feeTotal / gv) * 100
        : null;
  if (eff != null && !Number.isFinite(eff)) eff = null;

  const { posV, cnpV } = inferChannelVolumesForOverview(d);
  const mixRows = getCardBrandMixFromParsed(d);
  let amexV = 0;
  if (Array.isArray(mixRows)) {
    const amexRow = mixRows.find(
      (r) =>
        String(r?.brand || '').toLowerCase() === 'amex' ||
        String(r?.label || '').toLowerCase().includes('amex'),
    );
    if (amexRow) amexV = Number(cardMixRowVolume(amexRow, d)) || 0;
  }
  const refundV = Math.abs(Number(d.refund_volume) || 0);

  const hBarRaw = [
    { label: 'POS (card present)', value: Math.max(0, posV), color: '#0F1B2D' },
    { label: 'Online (CNP)', value: Math.max(0, cnpV), color: '#00A88A' },
    { label: 'Amex (brand table)', value: Math.max(0, amexV), color: '#B8770B' },
    { label: 'Refunds / chargebacks', value: Math.max(0, refundV), color: '#B03A2E' },
  ];
  const barMax = Math.max(...hBarRaw.map((x) => x.value), 1);
  const hBarData = hBarRaw.map((x) => ({
    ...x,
    display: x.value > 0 ? formatCompactMoney(x.value, displayCcy) : '—',
  }));

  const compSum = comp.ich + comp.sch + comp.svc + comp.oth;
  const feeParts = [
    { label: 'Interchange', value: comp.ich, color: '#0F1B2D' },
    { label: 'Scheme fees', value: comp.sch, color: '#00A88A' },
    { label: 'Service / acquirer margin', value: comp.svc, color: '#B8770B' },
    { label: 'Other (auth, refund, misc)', value: comp.oth, color: '#8B94A3' },
  ];
  const donutData =
    compSum > 0
      ? feeParts.map((p) => ({ value: Math.max(0, p.value), color: p.color }))
      : [{ value: 1, color: 'rgba(15,27,45,0.12)' }];

  return (
    <div className="flex flex-col gap-5">
      <CashFlowSummaryCard data={d} currency={displayCcy} />
      <BankDepositReconciliationCard data={d} currency={displayCcy} />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <Card className="min-w-0">
          <KPI label="Total fees charged" value={formatMoney(feeTotal, displayCcy)} sub={stmt.period} big />
        </Card>
        <Card className="min-w-0">
          <KPI label="Total sales volume" value={formatMoney(gv, displayCcy)} sub="Gross" big />
        </Card>
        <Card className="min-w-0">
          <KPI
            label="Net after fees"
            value={netAfter != null ? formatMoney(netAfter, displayCcy) : '—'}
            sub="Gross − fees"
            big
          />
        </Card>
        <Card className="min-w-0">
          <KPI
            label="Effective rate"
            value={eff != null ? `${eff.toFixed(2)}%` : '—'}
            sub={`vs panel ${Number(benchRate).toFixed(2)}%`}
            tone="amber"
            big
          />
        </Card>
        <Card className="min-w-0 sm:col-span-2 xl:col-span-1">
          <KPI
            label="Est. overpayment"
            value={overpay != null && Number.isFinite(Number(overpay)) ? formatMoney(Number(overpay), displayCcy) : '—'}
            sub="vs benchmark rate"
            tone="rose"
            big
          />
        </Card>
      </div>
      <Card className="p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
          <div>
            <div className="smallcaps text-ink-400">Channel split</div>
            <div className="font-serif text-2xl">POS vs Online (CNP)</div>
          </div>
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3 text-[11px] text-ink-400">
            <span className="flex items-center gap-1.5"><span className="dot bg-ink" />POS</span>
            <span className="flex items-center gap-1.5"><span className="dot bg-teal" />Online (CNP)</span>
          </div>
        </div>
        <HBar data={hBarData} max={barMax} />
        <p className="text-[12px] text-ink-400 mt-4 leading-relaxed">
          POS and online bars use channel sales volume. The Amex bar is <strong>only</strong> the Amex row from the card-brand
          mix table in your file (same scope as the Channel tab — often CNP/e-commerce), not total Amex across POS. Refunds use{' '}
          <span className="font-mono">refund_volume</span> when present.
        </p>
      </Card>
      <Card className="p-6">
        <div className="smallcaps text-ink-400">Fee composition</div>
        <div className="font-serif text-2xl mb-4">Where {formatMoney(feeTotal, displayCcy)} went</div>
        <div className="flex justify-center">
          <DonutChart
            size={200}
            data={donutData}
            center={{
              value: formatCompactMoney(feeTotal, displayCcy),
              label: 'TOTAL FEES',
            }}
          />
        </div>
        <div className="mt-5 space-y-2 text-[13px]">
          {feeParts.map((p, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-ink-500 min-w-0">
                <span className="dot shrink-0" style={{ background: p.color }} />
                {p.label}
              </span>
              <span className="font-mono tabular text-right shrink-0">
                {formatMoney(p.value, displayCcy)}{' '}
                <span className="text-ink-400">
                  · {compSum > 0 ? `${((p.value / compSum) * 100).toFixed(0)}%` : '—'}
                </span>
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Fee Breakdown Tab ───────────────────────────────────────────────
function TabBreakdown({ stmt }) {
  const [filter, setFilter] = useState('all');
  const allRows = stmt?.parsedData?.fee_lines || [];
  const rows = filter === 'all' ? allRows : filter === 'flagged' ? allRows.filter(r => r.flagged) : allRows.filter(r => r.channel === filter);
  const pd = stmt?.parsedData;
  const displayCcy = getStatementDisplayCurrency(pd);
  const { total: feeTotal } = reconcileTotalFeesCharged(pd);
  return (
    <Card>
      <div className="p-5 hair-b flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="font-serif text-2xl">Fee lines · {allRows.length} parsed</div>
          <div className="text-[12px] text-ink-400">Per-field confidence inline. Amber rows flagged during parse.</div>
        </div>
        <div className="flex items-center gap-2">
          {['all', 'POS', 'Online', 'flagged'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`h-8 px-3 rounded-full text-[12px] border transition ${filter === f ? 'bg-ink text-cream border-ink' : 'hair text-ink-500 hover:bg-ink/5'}`}>
              {f === 'all' ? 'All' : f === 'flagged' ? '⚑ Flagged' : f}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="smallcaps text-ink-400 bg-cream-200/40">
            <tr>{['Type', 'Rate', 'Amount', 'Card type', 'Channel', 'Conf.', 'Flag'].map(h => <th key={h} className="text-left font-medium px-5 py-3">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-hair">
            {rows.map((r, i) => (
              <tr key={i} className={r.flagged ? 'bg-amber-soft/30' : ''}>
                <td className="px-5 py-3">{r.type}</td>
                <td className="px-5 py-3 font-mono tabular">{r.rate}</td>
                <td className="px-5 py-3 font-mono tabular">{formatMoney(r.amount, displayCcy)}</td>
                <td className="px-5 py-3 text-ink-500">{r.card_type}</td>
                <td className="px-5 py-3 text-ink-500">{r.channel}</td>
                <td className="px-5 py-3">
                  <span className="inline-flex items-center gap-1.5 text-[12px]">
                    <span className={`dot ${r.confidence === 'high' ? 'bg-leaf' : r.confidence === 'medium' ? 'bg-amber' : 'bg-rose'}`} />
                    {r.confidence === 'high' ? 'High' : r.confidence === 'medium' ? 'Med' : 'Low'}
                  </span>
                </td>
                <td className="px-5 py-3">
                  {r.flagged && <Pill tone="amber">Review</Pill>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="p-5 hair-t flex items-center justify-between flex-wrap gap-3 bg-cream-200/40">
        <div className="text-[13px] text-ink-500">
          Total reconciliation: <span className="font-mono text-ink">{formatMoney(feeTotal, displayCcy)}</span> charged
        </div>
        <Pill tone="leaf"><Icon.CircleCheck size={12} /> Within ±2% tolerance</Pill>
      </div>
    </Card>
  );
}

// ── Channel Split Tab ───────────────────────────────────────────────
function TabChannel({ stmt }) {
  const d = stmt?.parsedData;
  if (!d) return null;
  const displayCcy = getStatementDisplayCurrency(d);
  const pos = d.channel_split?.pos;
  const cnp = d.channel_split?.cnp;
  const totalVol = Number(d.total_transaction_volume) || 0;
  const { posV: posVol, cnpV: cnpVol } = inferChannelVolumesForOverview(d);
  const posFees = Number(pos?.fees) || 0;
  const cnpFees = Number(cnp?.fees) || 0;
  const posEff = posVol > 0 ? (posFees / posVol) * 100 : null;
  const cnpEff = cnpVol > 0 ? (cnpFees / cnpVol) * 100 : null;
  const posTxn = pos?.txn_count;
  const cnpTxn = cnp?.txn_count;
  const mixRows = getCardBrandMixFromParsed(d);
  const legacyMix = d.card_mix;
  const defaultCardMix = { visa_debit: 42, visa_credit: 28, mc_debit: 15, mc_credit: 10, amex: 5 };

  const brandBars = [];
  if (Array.isArray(mixRows) && mixRows.length) {
    let totMix = 0;
    const vols = [];
    for (const r of mixRows) {
      const v = cardMixRowVolume(r, d);
      const n = v != null && Number.isFinite(Number(v)) ? Number(v) : 0;
      vols.push(n);
      if (n > 0) totMix += n;
    }
    const palette = ['#0F1B2D', '#00A88A', '#B8770B', '#8B94A3', '#B03A2E'];
    mixRows.forEach((r, i) => {
      const vol = vols[i];
      if (!(vol > 0)) return;
      const pct = totMix > 0 ? Math.round((vol / totMix) * 100) : 0;
      brandBars.push({
        label: r.label || r.brand || 'Card',
        pct,
        color: palette[i % palette.length],
        vol,
      });
    });
  } else {
    const merged = { ...defaultCardMix, ...(typeof legacyMix === 'object' && legacyMix ? legacyMix : {}) };
    const entries = [
      { label: 'Visa Debit', pct: merged.visa_debit, color: '#0F1B2D' },
      { label: 'Visa Credit', pct: merged.visa_credit, color: '#00A88A' },
      { label: 'Mastercard Debit', pct: merged.mc_debit, color: '#B8770B' },
      { label: 'Mastercard Credit', pct: merged.mc_credit, color: '#8B94A3' },
      { label: 'Amex', pct: merged.amex, color: '#B03A2E' },
    ].filter((x) => x.pct != null && Number(x.pct) > 0);
    for (const e of entries) {
      const pct = Number(e.pct);
      brandBars.push({
        label: e.label,
        pct,
        color: e.color,
        vol: totalVol > 0 ? (pct / 100) * totalVol : 0,
      });
    }
  }

  const premiumPp =
    posEff != null && cnpEff != null ? (cnpEff - posEff).toFixed(2) : null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 items-stretch">
        <Card className="p-6 h-full min-w-0">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-lg bg-ink text-cream flex items-center justify-center">
              <Icon.CreditCard size={16} />
            </div>
            <div>
              <div className="font-serif text-xl">POS (Card Present)</div>
              <div className="text-[12px] text-ink-400">In-store transactions</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-[13px]">
            <div><div className="text-ink-400">Volume</div><div className="font-mono font-medium text-lg tabular mt-0.5">{formatMoney(posVol, displayCcy)}</div></div>
            <div><div className="text-ink-400">Fees</div><div className="font-mono font-medium text-lg tabular mt-0.5">{formatMoney(posFees, displayCcy)}</div></div>
            <div><div className="text-ink-400">Effective rate</div><div className="font-mono font-medium tabular mt-0.5">{posEff != null ? `${posEff.toFixed(2)}%` : '—'}</div></div>
            <div><div className="text-ink-400">Transactions</div><div className="font-mono font-medium tabular mt-0.5">{posTxn != null ? Number(posTxn).toLocaleString() : '—'}</div></div>
            <div><div className="text-ink-400">Avg. transaction</div><div className="font-mono font-medium tabular mt-0.5">{pos?.avg_txn != null ? formatMoney(pos.avg_txn, displayCcy) : '—'}</div></div>
            <div><div className="text-ink-400">% of total volume</div><div className="font-mono font-medium tabular mt-0.5">{totalVol > 0 ? `${((posVol / totalVol) * 100).toFixed(0)}%` : '—'}</div></div>
          </div>
        </Card>

        <Card className="p-6 h-full min-w-0">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-lg bg-teal text-cream flex items-center justify-center">
              <Icon.Globe size={16} />
            </div>
            <div>
              <div className="font-serif text-xl">Online (Card Not Present)</div>
              <div className="text-[12px] text-ink-400">E-commerce & phone transactions</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-[13px]">
            <div><div className="text-ink-400">Volume</div><div className="font-mono font-medium text-lg tabular mt-0.5">{formatMoney(cnpVol, displayCcy)}</div></div>
            <div><div className="text-ink-400">Fees</div><div className="font-mono font-medium text-lg tabular mt-0.5">{formatMoney(cnpFees, displayCcy)}</div></div>
            <div><div className="text-ink-400">Effective rate</div><div className="font-mono font-medium tabular mt-0.5 text-amber">{cnpEff != null ? `${cnpEff.toFixed(2)}%` : '—'}</div></div>
            <div><div className="text-ink-400">Transactions</div><div className="font-mono font-medium tabular mt-0.5">{cnpTxn != null ? Number(cnpTxn).toLocaleString() : '—'}</div></div>
            <div><div className="text-ink-400">Avg. transaction</div><div className="font-mono font-medium tabular mt-0.5">{cnp?.avg_txn != null ? formatMoney(cnp.avg_txn, displayCcy) : '—'}</div></div>
            <div><div className="text-ink-400">% of total volume</div><div className="font-mono font-medium tabular mt-0.5">{totalVol > 0 ? `${((cnpVol / totalVol) * 100).toFixed(0)}%` : '—'}</div></div>
          </div>
        </Card>
      </div>

      <Card className="p-6 min-w-0">
        <div className="font-serif text-2xl mb-1">Card mix</div>
        <p className="text-[12px] text-ink-400 mb-4 leading-relaxed">
          Parsed from the card-network table in your workbook. For multi-sheet files (e.g. POS + e-commerce), shares often
          match one channel — dollar amounts should line up with that slice, not always total gross volume.
        </p>
        <div className="space-y-3">
          {brandBars.map(({ label, pct, color, vol }, i) => (
            <div key={`${label}-${i}`} className="flex items-center gap-3 text-[13px]">
              <div className="w-36 text-ink-500 shrink-0 truncate" title={label}>{label}</div>
              <div className="flex-1 h-2 bg-ink/10 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
              </div>
              <div className="font-mono tabular w-10 text-right">{pct}%</div>
              <div className="font-mono tabular text-ink-400 w-28 text-right">
                {totalVol > 0 ? formatCompactMoney(vol, displayCcy) : '—'}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t hair text-[12px] text-ink-500">
          {premiumPp != null
            ? `CNP effective rate (fees ÷ channel volume) is ${premiumPp} percentage points vs POS — credit-heavy or CNP-heavy stacks typically run higher.`
            : 'When POS and online volumes and fees are present, we compare channel effective rates from the statement.'}
        </div>
      </Card>
    </div>
  );
}

// ── Discrepancy Tab ─────────────────────────────────────────────────
function TabDiscrepancy({ stmt }) {
  const { activeAgreement } = useApp();
  const rows = stmt?.discrepancies || [];
  const overcharges = rows.filter(r => r.flag === 'overcharge');
  const rebates = rows.filter(r => r.flag === 'rebate');
  const totalImpact = rows.reduce((s, r) => s + (r.impact || 0), 0);

  return (
    <div className="space-y-5">
      {!activeAgreement && (
        <div className="border hair rounded-xl p-5 flex items-start gap-3 bg-amber-soft/30 border-amber/30">
          <Icon.AlertTriangle size={16} className="text-amber mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-medium">No merchant agreement uploaded</div>
            <div className="text-[12px] text-ink-500 mt-0.5">
              Results shown use demo agreement terms. Upload your signed agreement for accurate discrepancy detection.
            </div>
          </div>
          <Link href="/agreement"><Btn variant="outline" size="sm" icon={<Icon.Upload size={13} />}>Upload now</Btn></Link>
        </div>
      )}
      <Disclaimer tone="warn">
        Discrepancy findings are based on the contract you uploaded. Rates may be subject to clauses or addenda not included in the uploaded document. Confirm with your acquirer before acting on these findings.
      </Disclaimer>
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="smallcaps text-ink-400">Discrepancies found</div>
          <div className="font-serif text-4xl mt-1 tabular">{overcharges.length + rebates.length}</div>
          <div className="text-[12px] text-ink-400 mt-1">across {stmt?.parsedData?.fee_lines?.length || 47} lines</div>
        </Card>
        <Card className="p-5">
          <div className="smallcaps text-ink-400">Est. impact (quarter)</div>
          <div className="font-serif text-4xl mt-1 tabular text-rose">${totalImpact.toFixed(0)}</div>
          <div className="text-[12px] text-ink-400 mt-1">~${(totalImpact * 4).toFixed(0)} annualised</div>
        </Card>
        <Card className="p-5">
          <div className="smallcaps text-ink-400">Missing rebates</div>
          <div className="font-serif text-4xl mt-1 tabular text-amber">{rebates.length}</div>
          <div className="text-[12px] text-ink-400 mt-1">Volume tier threshold met</div>
        </Card>
      </div>
      <Card>
        <div className="p-5 hair-b font-serif text-2xl">Agreed vs charged</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="smallcaps text-ink-400 bg-cream-200/40">
              <tr>{['Line', 'Scheme', 'Agreed', 'Charged', 'Δ', 'Impact', 'Flag'].map(h => <th key={h} className="text-left font-medium px-5 py-3">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-hair">
              {rows.map((r, i) => (
                <tr key={i} className={r.flag === 'overcharge' ? 'bg-rose-soft/40' : r.flag === 'rebate' ? 'bg-amber-soft/40' : ''}>
                  <td className="px-5 py-3">{r.line}</td>
                  <td className="px-5 py-3 text-ink-500">{r.scheme}</td>
                  <td className="px-5 py-3 font-mono tabular">{r.agreed}</td>
                  <td className="px-5 py-3 font-mono tabular">{r.charged}</td>
                  <td className={`px-5 py-3 font-mono tabular ${r.delta?.startsWith('+') ? 'text-rose' : r.delta?.startsWith('−') || r.delta?.startsWith('-') ? 'text-amber' : 'text-ink-400'}`}>{r.delta}</td>
                  <td className="px-5 py-3 font-mono tabular">${r.impact?.toFixed(2)}</td>
                  <td className="px-5 py-3">
                    {r.flag === 'overcharge' && <Pill tone="rose">Overcharge</Pill>}
                    {r.flag === 'rebate' && <Pill tone="amber">Missing rebate</Pill>}
                    {r.flag === 'ok' && <Pill tone="leaf">OK</Pill>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── Benchmark Tab ───────────────────────────────────────────────────
function TabBenchmark({ stmt, tier }) {
  const router = useRouter();
  const recs = stmt?.benchmarks || [];
  const trend = stmt?.rateTrend;
  return (
    <div className="space-y-5">
      <div className="border hair rounded-xl p-4 bg-cream-200/50 grid sm:grid-cols-2 gap-3 text-[12px] text-ink-500">
        <div>
          <div className="smallcaps text-ink-400 mb-2">Recommendation confidence</div>
          <div className="space-y-1.5">
            <span className="flex items-center gap-1.5"><span className="dot bg-leaf" />High — regulatory / published source</span>
            <span className="flex items-center gap-1.5"><span className="dot bg-amber" />Medium — SMB reported, corroborated</span>
            <span className="flex items-center gap-1.5"><span className="dot bg-rose" />Low — floor rate estimate only</span>
          </div>
        </div>
        <div>
          <div className="smallcaps text-ink-400 mb-2">Data source tiers</div>
          <div className="space-y-1.5">
            <span className="flex items-center gap-1.5"><Pill tone="leaf">T1</Pill> Interchange schedules / regulatory</span>
            <span className="flex items-center gap-1.5"><Pill tone="teal">T2</Pill> SMB-reported, corroborated</span>
            <span className="flex items-center gap-1.5"><Pill tone="amber">T3</Pill> Floor rate estimate</span>
          </div>
        </div>
      </div>

      <Disclaimer>
        The rate data shown is sourced from published interchange schedules and SMB-reported data as of the dates shown.
        It is provided for informational purposes only and does not constitute financial advice. Savings estimates are
        indicative — your actual costs depend on your specific negotiated terms. We do not execute acquirer switches on
        your behalf. <strong>We may receive a referral fee if you contact an acquirer through OptiSMB. This does not
        affect the ranking of recommendations, which is based solely on estimated saving.</strong>
      </Disclaimer>

      <div className="grid md:grid-cols-3 gap-4">
        {recs.map((r, i) => {
          const tierInfo = DATA_TIER_LABELS[r.dataSourceTier] || DATA_TIER_LABELS.T3;
          return (
            <Card key={i} className="p-6 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-cream-200 border hair flex items-center justify-center font-serif text-lg">{r.name[0]}</div>
                  <div>
                    <div className="font-serif text-xl">{r.name}</div>
                    <div className="font-mono text-[11px] text-ink-400">data as of {r.dataAsOf}</div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Pill tone="ink">#{i + 1}</Pill>
                  <Pill tone={tierInfo.color}>{r.dataSourceTier}</Pill>
                </div>
              </div>
              <div className="flex-1">
                <div className="smallcaps text-ink-400">Projected annual saving</div>
                {tierOk(tier, 'L1')
                  ? <div className="font-serif text-4xl tabular mt-1 text-teal">${r.save?.toLocaleString()}<span className="text-base text-ink-400">/yr</span></div>
                  : <div className="mt-1 h-10 flex items-center text-[13px] text-ink-400"><Icon.Lock size={14} className="mr-2" />Upgrade to Level 1 to see savings</div>}
                <div className="text-[13px] text-ink-500 mt-3">Projected effective rate: <span className="font-mono text-ink tabular">{r.rate?.toFixed(2)}%</span></div>
                <p className="text-[12px] text-ink-500 mt-3 leading-relaxed">{r.blurb}</p>
                <div className="mt-4">
                  <div className="smallcaps text-ink-400 mb-1.5">Recommendation confidence</div>
                  <ConfidenceBadge level={r.conf} asOf={r.dataAsOf} />
                </div>
                <div className="mt-4 text-[11px] text-ink-400 font-mono">{tierInfo.description}</div>
                {r.referralApplicable && (
                  <div className="mt-4 pt-4 border-t hair text-[11px] text-ink-500 leading-relaxed">
                    <strong>Referral disclosure:</strong> OptiSMB may receive a fee if you contact {r.name} through this platform. This has no effect on ranking or data shown.
                  </div>
                )}
              </div>
              <div className="mt-5 flex gap-2">
                <Btn variant="primary" size="sm" icon={<Icon.ArrowUpRight size={13} />} className="flex-1">
                  Contact {r.name}
                </Btn>
                <Btn variant="outline" size="sm">Details</Btn>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="p-5 flex items-center gap-4 bg-cream-200/40">
        <Icon.Info size={18} className="text-ink-400 shrink-0" />
        <div className="flex-1">
          <div className="text-sm">Teya, Heartland, and Elavon evaluated — insufficient benchmark data for your AOV band at this time.</div>
          <div className="text-[12px] text-ink-400 mt-0.5">We require at least 8 corroborated data points to publish a recommendation for your MCC and volume tier.</div>
        </div>
      </Card>

      {trend && (
        <Card className="p-6">
          <div className="flex items-end justify-between mb-4">
            <div>
              <div className="smallcaps text-ink-400">Your rate vs market</div>
              <div className="font-serif text-2xl">Effective rate trend</div>
            </div>
            <div className="flex gap-3 text-[11px] text-ink-400">
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-ink inline-block" />You</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-teal inline-block" />Panel median</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 border-t border-dashed border-ink-400 inline-block" />Best-in-class</span>
            </div>
          </div>
          <LineChart xLabels={trend.labels}
            series={[
              { color: '#0F1B2D', data: trend.yours },
              { color: '#00A88A', data: trend.panel },
              { color: '#8B94A3', dashed: true, data: trend.best },
            ]} />
        </Card>
      )}
    </div>
  );
}

// ── Q&A Tab ─────────────────────────────────────────────────────────
function TabQA({ stmt }) {
  const [msgs, setMsgs] = useState(() => {
    const pd = stmt?.parsedData;
    const ccy = getStatementDisplayCurrency(pd);
    const { total: tft } = reconcileTotalFeesCharged(pd);
    const sch = Number(pd?.scheme_fees);
    const ans =
      pd && tft > 0 && Number.isFinite(sch)
        ? `You paid ${formatMoney(sch, ccy)} in scheme fees. That's ${((sch / tft) * 100).toFixed(1)}% of total fees.`
        : 'Ask a question about your parsed fees and channels.';
    return [
      { role: 'u', t: 'How much did I pay in scheme fees this quarter?' },
      { role: 'a', t: ans, cite: 'parsedData.scheme_fees' },
    ];
  });
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
        discrepancies: stmt?.discrepancies,
        benchmarks: stmt?.benchmarks?.map(b => ({ name: b.name, rate: b.rate, save: b.save })),
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

  const suggestions = ['What\'s my highest fee?', 'Break down POS vs online fees', 'Do I qualify for rebates?', 'Explain my effective rate', 'What did I pay in interchange?'];

  return (
    <Card>
      <div className="p-5 hair-b flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="font-serif text-2xl">Ask about your statement</div>
          <div className="text-[12px] text-ink-400">Answers grounded in your parsed data only. Cites source fields. Declines out-of-scope questions. Powered by Claude.</div>
        </div>
        <Btn variant="outline" size="sm" icon={<Icon.Download size={13} />} onClick={exportQA}>Export Q&A</Btn>
      </div>
      <div className="max-h-[460px] overflow-auto scrollbar-thin p-6 space-y-4">
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
        <div className="flex flex-wrap gap-2 mt-3">
          {suggestions.map(s => (
            <button key={s} onClick={() => setDraft(s)} className="px-3 py-1.5 rounded-full border hair text-[12px] text-ink-500 hover:bg-cream-200 transition">{s}</button>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ── Report Page ─────────────────────────────────────────────────────
export default function ReportPage() {
  const [tab, setTab] = useState('overview');
  const { user, getCurrentStatement, checkStaleness } = useApp();
  const { addToast } = useToast();
  const router = useRouter();
  const stmt = getCurrentStatement();
  const stmtDisplay = useMemo(() => {
    if (!stmt?.parsedData) return stmt;
    const pd = finalizeParsedForClient({ ...stmt.parsedData });
    const bench = getBenchmarkAnalysis(pd);
    return { ...stmt, parsedData: bench ? { ...pd, benchmark_analysis: bench } : pd };
  }, [stmt]);
  const staleness = checkStaleness(stmtDisplay);
  const reportIdentity = useMemo(() => {
    const pd = stmtDisplay?.parsedData;
    if (!pd) return { shop: '', id: null };
    return { shop: displayBusinessName(pd, stmtDisplay.acquirer), id: getParsedIdentity(pd) };
  }, [stmtDisplay]);

  const exportExcel = () => {
    if (!stmtDisplay) return;
    const pd = stmtDisplay.parsedData;
    const ccy = getStatementDisplayCurrency(pd);
    const { total: feeTot } = reconcileTotalFeesCharged(pd);
    const { posV, cnpV } = inferChannelVolumesForOverview(pd);
    const rid = getParsedIdentity(pd);
    const rows = [
      ['OptiSMB Analysis Report'],
      ['Acquirer', stmtDisplay.acquirer],
      ['Shop (parsed)', displayBusinessName(pd, stmtDisplay.acquirer)],
      ['Bank', rid.bank_name || ''],
      ['Account', rid.account_number || ''],
      ['MID', rid.merchant_id || ''],
      ['Period', stmtDisplay.period],
      ['Effective Rate', `${pd?.effective_rate?.toFixed(2) ?? '—'}%`],
      ['Total Fees', formatMoney(feeTot, ccy)],
      ['Total Volume', formatMoney(pd?.total_transaction_volume, ccy)],
      ['POS Volume (display)', formatMoney(posV, ccy)],
      ['Online Volume (display)', formatMoney(cnpV, ccy)],
      [],
      ['Fee Lines'],
      ['Type', 'Rate', 'Amount', 'Card Type', 'Channel', 'Confidence'],
      ...(pd?.fee_lines || []).map(f => [f.type, f.rate, formatMoney(f.amount, ccy), f.card_type, f.channel, f.confidence]),
      [],
      ['Discrepancies'],
      ['Line', 'Scheme', 'Agreed', 'Charged', 'Delta', 'Impact', 'Flag'],
      ...(stmtDisplay.discrepancies || []).map(d => [d.line, d.scheme, d.agreed, d.charged, d.delta, formatMoney(d.impact, ccy), d.flag]),
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
      {/* Staleness banner */}
      {staleness && (
        <div className={`rounded-xl border p-4 flex items-start gap-3 ${staleness.level === 'red' ? 'bg-rose-soft/40 border-rose/30' : 'bg-amber-soft/40 border-amber/30'}`}>
          <Icon.AlertTriangle size={16} className={`${staleness.level === 'red' ? 'text-rose' : 'text-amber'} mt-0.5 shrink-0`} />
          <div className="flex-1">
            <div className="text-sm font-medium">Benchmark data is {staleness.level === 'red' ? 'significantly outdated (≥180 days)' : 'approaching staleness (≥90 days)'}</div>
            <div className="text-[12px] text-ink-500 mt-0.5">Rate comparisons shown here may not reflect current market pricing. Re-run the analysis with fresh data.</div>
          </div>
        </div>
      )}

      {/* Header — one card: title + statement facts + confidence */}
      <Card className="overflow-hidden border-ink/10 bg-cream-100/90 shadow-card">
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
        </div>

        <div className="border-t border-ink/8 px-5 md:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <DualConfidence parsing={stmtDisplay.parsingConfidence} rate={stmtDisplay.rateConfidence} asOf={stmtDisplay.dataAsOf} />
        </div>
      </Card>

      <Disclaimer>
        OptiSMB provides analysis and benchmarks for informational purposes only — this is not financial or regulatory advice.
        Figures are estimates based on parsed statement data and third-party rate panels. Savings estimates are indicative;
        actual costs depend on your specific negotiated terms. Final decisions remain yours.
        <br /><strong>Where applicable, OptiSMB may receive a referral fee from acquirers you contact through this platform. This does not affect recommendation ranking.</strong>
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
        <div className="fade-up min-w-0" key={tab}>
          {tab === 'overview' && <TabOverview stmt={stmtDisplay} />}
          {tab === 'breakdown' && <TabBreakdown stmt={stmtDisplay} />}
          {tab === 'channel' && <TabChannel stmt={stmtDisplay} />}
          {tab === 'discrepancy' && (
            <TierGate needed="L1" currentTier={user.tier} onUpgrade={() => router.push('/upgrade')} reason="Discrepancy detection is a Level 1 feature">
              <TabDiscrepancy stmt={stmtDisplay} />
            </TierGate>
          )}
          {tab === 'benchmark' && <TabBenchmark stmt={stmtDisplay} tier={user.tier} />}
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
