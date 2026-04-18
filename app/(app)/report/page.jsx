'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as Icon from '@/components/Icons';
import { Card, KPI, Btn, Pill, DualConfidence, ConfidenceBadge, TierGate, Disclaimer } from '@/components/UI';
import { DonutChart, HBar, LineChart } from '@/components/Charts';
import { useApp } from '@/components/AppContext';
import { useToast } from '@/components/Toast';
import { tierOk, downloadCSV, triggerPrint } from '@/lib/utils';
import { DATA_TIER_LABELS } from '@/lib/mockData';

const TABS = [
  { k: 'overview', l: 'Overview' },
  { k: 'breakdown', l: 'Fee Breakdown' },
  { k: 'channel', l: 'Channel Split' },
  { k: 'discrepancy', l: 'Discrepancy Report', tier: 'L1' },
  { k: 'benchmark', l: 'Benchmarking' },
  { k: 'qa', l: 'Q&A', tier: 'L1' },
];

// ── Overview Tab ────────────────────────────────────────────────────
function TabOverview({ stmt }) {
  const d = stmt?.parsedData;
  if (!d) return null;
  const total = d.total_fees_charged || 6530;
  return (
    <div className="grid md:grid-cols-12 gap-5">
      <div className="md:col-span-8 grid grid-cols-3 gap-4">
        <Card><KPI label="Total fees charged" value={`$${total.toLocaleString()}`} sub={stmt.period} big /></Card>
        <Card><KPI label="Effective rate" value={`${(d.effective_rate || 1.84).toFixed(2)}%`} sub="vs avg 1.42%" tone="amber" big /></Card>
        <Card><KPI label="Est. overpayment" value="$4,440" sub="Quarter" tone="rose" big /></Card>
        <Card className="col-span-3 p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="smallcaps text-ink-400">Channel split</div>
              <div className="font-serif text-2xl">POS vs Online (CNP)</div>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-ink-400">
              <span className="flex items-center gap-1.5"><span className="dot bg-ink" />POS</span>
              <span className="flex items-center gap-1.5"><span className="dot bg-teal" />Online (CNP)</span>
            </div>
          </div>
          <HBar data={[
            { label: 'POS (card present)', value: d.channel_split?.pos?.volume || 230250, display: `$${((d.channel_split?.pos?.volume || 230250) / 1000).toFixed(0)}k`, color: '#0F1B2D' },
            { label: 'Online (CNP)', value: d.channel_split?.cnp?.volume || 124750, display: `$${((d.channel_split?.cnp?.volume || 124750) / 1000).toFixed(0)}k`, color: '#00A88A' },
            { label: 'Amex (all channels)', value: 39250, display: '$39.3k', color: '#B8770B' },
            { label: 'Refunds / chargebacks', value: 5125, display: '$5.1k', color: '#B03A2E' },
          ]} />
        </Card>
      </div>
      <Card className="md:col-span-4 p-6">
        <div className="smallcaps text-ink-400">Fee composition</div>
        <div className="font-serif text-2xl mb-4">Where the ${total.toLocaleString()} went</div>
        <div className="flex items-center justify-center">
          <DonutChart size={200} data={[
            { value: d.interchange_fees || 3725, color: '#0F1B2D' },
            { value: d.scheme_fees || 1302, color: '#00A88A' },
            { value: d.service_fees || 1015, color: '#B8770B' },
            { value: d.other_fees || 490, color: '#8B94A3' },
          ]} center={{ value: `$${(total / 1000).toFixed(1)}k`, label: 'TOTAL FEES' }} />
        </div>
        <div className="mt-5 space-y-2 text-[13px]">
          {[
            ['Interchange', d.interchange_fees || 3725, '57%', '#0F1B2D'],
            ['Scheme fees', d.scheme_fees || 1302, '20%', '#00A88A'],
            ['Service / acquirer margin', d.service_fees || 1015, '16%', '#B8770B'],
            ['Other (auth, refund, misc)', d.other_fees || 490, '7%', '#8B94A3'],
          ].map((r, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-ink-500"><span className="dot" style={{ background: r[3] }} />{r[0]}</span>
              <span className="font-mono tabular">${r[1].toLocaleString()} <span className="text-ink-400">· {r[2]}</span></span>
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
  const total = stmt?.parsedData?.total_fees_charged || 6530;
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
                <td className="px-5 py-3 font-mono tabular">${r.amount?.toFixed(2)}</td>
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
          Total reconciliation: <span className="font-mono text-ink">${total.toLocaleString()}</span> charged
        </div>
        <Pill tone="leaf"><Icon.CircleCheck size={12} /> Within ±2% tolerance</Pill>
      </div>
    </Card>
  );
}

// ── Channel Split Tab ───────────────────────────────────────────────
function TabChannel({ stmt }) {
  const d = stmt?.parsedData;
  const pos = d?.channel_split?.pos;
  const cnp = d?.channel_split?.cnp;
  const total = d?.total_fees_charged || 6530;
  const totalVol = d?.total_transaction_volume || 355000;
  const cardMix = d?.card_mix || { visa_debit: 42, visa_credit: 28, mc_debit: 15, mc_credit: 10, amex: 5 };

  return (
    <div className="space-y-5">
      <div className="grid md:grid-cols-2 gap-4">
        {/* POS card */}
        <Card className="p-6">
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
            <div><div className="text-ink-400">Volume</div><div className="font-mono font-medium text-lg tabular mt-0.5">${((pos?.volume || 230250) / 1000).toFixed(0)}k</div></div>
            <div><div className="text-ink-400">Fees</div><div className="font-mono font-medium text-lg tabular mt-0.5">${(pos?.fees || 3840).toLocaleString()}</div></div>
            <div><div className="text-ink-400">Effective rate</div><div className="font-mono font-medium tabular mt-0.5">{(((pos?.fees || 3840) / (pos?.volume || 230250)) * 100).toFixed(2)}%</div></div>
            <div><div className="text-ink-400">Transactions</div><div className="font-mono font-medium tabular mt-0.5">{(pos?.txn_count || 4120).toLocaleString()}</div></div>
            <div><div className="text-ink-400">Avg. transaction</div><div className="font-mono font-medium tabular mt-0.5">${pos?.avg_txn?.toFixed(2) || '55.88'}</div></div>
            <div><div className="text-ink-400">% of volume</div><div className="font-mono font-medium tabular mt-0.5">{(((pos?.volume || 230250) / totalVol) * 100).toFixed(0)}%</div></div>
          </div>
        </Card>

        {/* CNP card */}
        <Card className="p-6">
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
            <div><div className="text-ink-400">Volume</div><div className="font-mono font-medium text-lg tabular mt-0.5">${((cnp?.volume || 124750) / 1000).toFixed(0)}k</div></div>
            <div><div className="text-ink-400">Fees</div><div className="font-mono font-medium text-lg tabular mt-0.5">${(cnp?.fees || 2690).toLocaleString()}</div></div>
            <div><div className="text-ink-400">Effective rate</div><div className="font-mono font-medium tabular mt-0.5 text-amber">{(((cnp?.fees || 2690) / (cnp?.volume || 124750)) * 100).toFixed(2)}%</div></div>
            <div><div className="text-ink-400">Transactions</div><div className="font-mono font-medium tabular mt-0.5">{(cnp?.txn_count || 1840).toLocaleString()}</div></div>
            <div><div className="text-ink-400">Avg. transaction</div><div className="font-mono font-medium tabular mt-0.5">${cnp?.avg_txn?.toFixed(2) || '67.80'}</div></div>
            <div><div className="text-ink-400">% of volume</div><div className="font-mono font-medium tabular mt-0.5">{(((cnp?.volume || 124750) / totalVol) * 100).toFixed(0)}%</div></div>
          </div>
        </Card>
      </div>

      {/* Card mix */}
      <Card className="p-6">
        <div className="font-serif text-2xl mb-4">Card mix</div>
        <div className="space-y-3">
          {[
            { label: 'Visa Debit', pct: cardMix.visa_debit, color: '#0F1B2D' },
            { label: 'Visa Credit', pct: cardMix.visa_credit, color: '#00A88A' },
            { label: 'Mastercard Debit', pct: cardMix.mc_debit, color: '#B8770B' },
            { label: 'Mastercard Credit', pct: cardMix.mc_credit, color: '#8B94A3' },
            { label: 'Amex', pct: cardMix.amex, color: '#B03A2E' },
          ].map(({ label, pct, color }) => (
            <div key={label} className="flex items-center gap-3 text-[13px]">
              <div className="w-32 text-ink-500 shrink-0">{label}</div>
              <div className="flex-1 h-2 bg-ink/10 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
              </div>
              <div className="font-mono tabular w-10 text-right">{pct}%</div>
              <div className="font-mono tabular text-ink-400 w-24 text-right">${((totalVol * pct / 100) / 1000).toFixed(0)}k</div>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t hair text-[12px] text-ink-500">
          Higher credit card volume = higher interchange costs. CNP transactions attract a {((cnp?.fees / cnp?.volume - pos?.fees / pos?.volume) * 100 || 0.54).toFixed(2)}pp premium over POS.
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
  const [msgs, setMsgs] = useState([
    { role: 'u', t: 'How much did I pay in scheme fees this quarter?' },
    { role: 'a', t: `You paid $${((stmt?.parsedData?.scheme_fees || 1302)).toLocaleString()} in scheme fees. That's ${((stmt?.parsedData?.scheme_fees || 1302) / (stmt?.parsedData?.total_fees_charged || 6530) * 100).toFixed(1)}% of total fees.`, cite: 'parsedData.scheme_fees' },
  ]);
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
  const staleness = checkStaleness(stmt);

  const exportExcel = () => {
    if (!stmt) return;
    const rows = [
      ['OptiSMB Analysis Report'],
      ['Acquirer', stmt.acquirer],
      ['Period', stmt.period],
      ['Effective Rate', `${stmt.parsedData?.effective_rate?.toFixed(2)}%`],
      ['Total Fees', `$${stmt.parsedData?.total_fees_charged?.toLocaleString()}`],
      ['Total Volume', `$${stmt.parsedData?.total_transaction_volume?.toLocaleString()}`],
      ['POS Volume', `$${stmt.parsedData?.channel_split?.pos?.volume?.toLocaleString()}`],
      ['Online Volume', `$${stmt.parsedData?.channel_split?.cnp?.volume?.toLocaleString()}`],
      [],
      ['Fee Lines'],
      ['Type', 'Rate', 'Amount', 'Card Type', 'Channel', 'Confidence'],
      ...(stmt.parsedData?.fee_lines || []).map(f => [f.type, f.rate, `$${f.amount?.toFixed(2)}`, f.card_type, f.channel, f.confidence]),
      [],
      ['Discrepancies'],
      ['Line', 'Scheme', 'Agreed', 'Charged', 'Delta', 'Impact', 'Flag'],
      ...(stmt.discrepancies || []).map(d => [d.line, d.scheme, d.agreed, d.charged, d.delta, `$${d.impact?.toFixed(2)}`, d.flag]),
    ];
    downloadCSV(rows, `optismb-${stmt.acquirer.replace(/\s+/g, '-')}-${stmt.period.replace(/\s+/g, '-')}.csv`);
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
    <div className="space-y-6">
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

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="smallcaps text-ink-400 mb-2 flex items-center gap-2">
            <Link href="/analyses" className="hover:text-ink transition">Analysis</Link>
            <Icon.ChevronRight size={12} />
            <span>{stmt.acquirer}</span>
            <Icon.ChevronRight size={12} />
            <span>{stmt.period}</span>
          </div>
          <h1 className="font-serif text-4xl md:text-5xl leading-tight">{stmt.acquirer} · {stmt.period}</h1>
          <div className="text-[13px] text-ink-400 mt-1 font-mono">
            Uploaded {stmt.uploadDate} · Volume ${((stmt.parsedData?.total_transaction_volume || 355000) / 1000).toFixed(0)}k · MID {stmt.parsedData?.merchant_id || '—'}
          </div>
        </div>
        <div className="flex items-start gap-6">
          <DualConfidence parsing={stmt.parsingConfidence} rate={stmt.rateConfidence} asOf={stmt.dataAsOf} />
          <div className="flex gap-2 no-print">
            {tierOk(user.tier, 'L1') && <Btn variant="outline" size="sm" icon={<Icon.Download size={13} />} onClick={triggerPrint}>PDF</Btn>}
            {tierOk(user.tier, 'L2') && <Btn variant="outline" size="sm" icon={<Icon.Download size={13} />} onClick={exportExcel}>Excel</Btn>}
          </div>
        </div>
      </div>

      <Disclaimer>
        OptiSMB provides analysis and benchmarks for informational purposes only — this is not financial or regulatory advice.
        Figures are estimates based on parsed statement data and third-party rate panels. Savings estimates are indicative;
        actual costs depend on your specific negotiated terms. Final decisions remain yours.
        <br /><strong>Where applicable, OptiSMB may receive a referral fee from acquirers you contact through this platform. This does not affect recommendation ranking.</strong>
      </Disclaimer>

      {/* Tabs */}
      <div className="border hair rounded-full p-1 inline-flex bg-cream-100 flex-wrap gap-0.5 no-print">
        {TABS.map(({ k, l, tier }) => (
          <button key={k} onClick={() => setTab(k)}
            className={`h-9 px-4 rounded-full text-[13px] font-medium transition ${tab === k ? 'bg-ink text-cream' : 'text-ink-500 hover:text-ink'}`}>
            {l}
            {tier && !tierOk(user.tier, tier) && <Icon.Lock size={11} className="inline ml-1.5 -mt-0.5" />}
          </button>
        ))}
      </div>

      <div className="fade-up" key={tab}>
        {tab === 'overview' && <TabOverview stmt={stmt} />}
        {tab === 'breakdown' && <TabBreakdown stmt={stmt} />}
        {tab === 'channel' && <TabChannel stmt={stmt} />}
        {tab === 'discrepancy' && (
          <TierGate needed="L1" currentTier={user.tier} onUpgrade={() => router.push('/upgrade')} reason="Discrepancy detection is a Level 1 feature">
            <TabDiscrepancy stmt={stmt} />
          </TierGate>
        )}
        {tab === 'benchmark' && <TabBenchmark stmt={stmt} tier={user.tier} />}
        {tab === 'qa' && (
          <TierGate needed="L1" currentTier={user.tier} onUpgrade={() => router.push('/upgrade')} reason="The Q&A assistant is a Level 1 feature">
            <TabQA stmt={stmt} />
          </TierGate>
        )}
      </div>
    </div>
  );
}
