'use client';
import Link from 'next/link';
import { finalizeParsedForClient } from '@/lib/statementFinalize';
import { useApp } from '@/components/AppContext';
import { Card, KPI, Btn, Pill } from '@/components/UI';
import { Sparkline } from '@/components/Charts';
import * as Icon from '@/components/Icons';
import {
  tierOk,
  reconcileTotalFeesCharged,
  overviewPrimarySalesVolumeGross,
  overviewStatementTransactionCount,
} from '@/lib/utils';

function OnboardingBanner() {
  const { user, statements } = useApp();
  const hasStatements = statements.some(s => s.source !== 'demo');
  if (hasStatements) return null;
  return (
    <div className="rounded-2xl bg-ink text-cream p-6 md:p-8 flex flex-wrap items-center gap-6">
      <div className="flex-1 min-w-[220px]">
        <div className="smallcaps text-teal-bright mb-2">Get started in 60 seconds</div>
        <h2 className="font-serif text-3xl leading-tight">Upload your first acquiring statement.</h2>
        <p className="text-cream/70 text-[14px] mt-2">
          We extract fee lines and summarise volume, channels, and payment mix — automatically.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link href="/upload"><Btn variant="teal" icon={<Icon.Upload size={14} />}>Upload statement</Btn></Link>
          <Link href="/upload">
            <Btn variant="ghost" className="text-cream/70 hover:text-cream hover:bg-cream/10">Use demo data</Btn>
          </Link>
        </div>
      </div>
      <div className="flex flex-col gap-2 text-[13px] text-cream/60">
        {[
          ['01', 'Drag & drop PDF, CSV, or XLSX'],
          ['02', 'AI extracts every fee line in <60s'],
          ['03', 'Fee breakdown by channel and brand'],
          ['04', 'Open the report for full detail'],
        ].map(([n, t]) => (
          <div key={n} className="flex items-center gap-3">
            <span className="font-mono text-teal-bright">{n}</span>
            <span>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HumanReviewBanner({ queue }) {
  if (!queue?.length) return null;
  return (
    <div className="rounded-xl border border-amber/30 bg-amber-soft/30 p-4 flex items-start gap-3">
      <Icon.RefreshCw size={16} className="text-amber mt-0.5 shrink-0" />
      <div className="flex-1">
        <div className="text-sm font-medium">{queue.length} statement{queue.length > 1 ? 's' : ''} under human review</div>
        <div className="text-[12px] text-ink-500 mt-0.5">
          Document confidence was below threshold. Our team will deliver a corrected report within 4 business hours.
        </div>
        <div className="mt-2 space-y-1">
          {queue.map(item => (
            <div key={item.id} className="flex items-center gap-2 text-[12px] font-mono text-ink-400">
              <span className="dot bg-amber pulse-ring" />
              {item.fileName} · submitted {new Date(item.submittedAt).toLocaleDateString()}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { effectiveRatePercentFromTotals } from '@/lib/financialAnalysisFormulas';

function formatEffectiveRatePct(raw, vol, fees) {
  const gv = Number(vol);
  const tf = Number(fees);
  const implied = effectiveRatePercentFromTotals(tf, gv);
  if (implied != null) return `${implied.toFixed(2)}%`;
  const n = raw != null && raw !== '' ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 0 && n <= 25) return `${n.toFixed(2)}%`;
  return '—';
}

export default function DashboardPage() {
  const { user, statements, getCurrentStatement, setCurrentStatementId, humanReviewQueue } = useApp();
  const stmt = getCurrentStatement();
  const d = stmt?.parsedData;
  const dFin = d && typeof d === 'object' ? finalizeParsedForClient(d) : null;
  const vol = dFin ? overviewPrimarySalesVolumeGross(dFin) : null;
  const fees = dFin ? reconcileTotalFeesCharged(dFin).total : null;
  const impliedFromFees =
    vol != null && fees != null && Number(vol) > 0
      ? (() => {
          const r = effectiveRatePercentFromTotals(fees, vol);
          return r != null ? r.toFixed(2) : null;
        })()
      : null;
  const feeLineCount = Array.isArray(d?.fee_lines) ? d.fee_lines.length : null;
  const txnTotal = dFin ? overviewStatementTransactionCount(dFin) : null;
  const effDisplay = formatEffectiveRatePct(dFin?.effective_rate, vol, fees);
  const feesCardSub = [vol != null ? `total_transaction_volume: ${Number(vol).toLocaleString()}` : null, txnTotal != null ? `transactions: ${txnTotal.toLocaleString()}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <header className="flex flex-col gap-5 border-b border-ink/8 pb-8">
        <div>
          <div className="smallcaps text-ink-400 mb-2">Welcome back, {user.business || user.name}</div>
          <h1 className="font-serif text-4xl md:text-[42px] leading-[1.08] tracking-tight">
            Your acquiring health, <em className="text-teal">at a glance.</em>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/upload">
            <Btn variant="primary" icon={<Icon.Upload size={14} />}>
              New statement
            </Btn>
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center justify-center gap-2 h-10 px-5 text-sm font-medium border hair rounded-full bg-cream-100 hover:bg-cream-200/80 transition no-print"
          >
            <Icon.Download size={14} />
            Export PDF
          </button>
        </div>
      </header>

      <OnboardingBanner />
      <HumanReviewBanner queue={humanReviewQueue} />

      {/* KPI grid — balanced 2×2 + featured strip */}
      <section aria-labelledby="dash-metrics-heading">
        <h2 id="dash-metrics-heading" className="sr-only">
          Key metrics
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="min-w-0">
            <KPI
              label="Effective rate"
              value={effDisplay}
              tone="amber"
              sub={
                impliedFromFees ? (
                  <span>
                    Fees ÷ gross volume <span className="font-mono text-ink">{impliedFromFees}%</span>
                  </span>
                ) : (
                  <span>{stmt?.period ? `period: ${stmt.period}` : '—'}</span>
                )
              }
            />
            <div className="px-5 pb-5">
              {Array.isArray(d?.rateTrend) && d.rateTrend.length >= 2 ? (
                <Sparkline points={d.rateTrend.map((x) => Number(x)).filter((n) => Number.isFinite(n))} />
              ) : null}
            </div>
          </Card>
          <Card className="min-w-0">
            <KPI
              label="Total fees (period)"
              value={fees != null ? `$${Number(fees).toLocaleString()}` : '—'}
              sub={feesCardSub || '—'}
              tone="ink"
            />
            <div className="px-5 pb-5">
              {Array.isArray(d?.fees_history) && d.fees_history.length >= 2 ? (
                <Sparkline points={d.fees_history.map((x) => Number(x)).filter((n) => Number.isFinite(n))} color="#2C3E50" />
              ) : null}
            </div>
          </Card>
          <Card className="min-w-0 sm:col-span-2">
            <div className="p-5 sm:p-6">
              <div className="rounded-2xl bg-ink text-cream p-5 flex flex-col justify-center border border-ink">
                <div className="smallcaps text-teal-bright">Full breakdown</div>
                <div className="font-serif text-3xl sm:text-4xl leading-none tabular mt-2">
                  {feeLineCount != null ? `${feeLineCount}` : '—'}
                  <span className="text-lg text-cream/50"> fee lines</span>
                </div>
                <p className="text-[12px] text-cream/60 mt-2 leading-relaxed">
                  {stmt?.period ? <span className="font-mono">period: {stmt.period}</span> : null}
                  {stmt?.parsedData?.billing_period?.from && (
                    <span className="block mt-1 font-mono text-[11px]">
                      billing_period: {stmt.parsedData.billing_period.from} → {stmt.parsedData.billing_period.to}
                    </span>
                  )}
                </p>
                <Link href="/report" className="mt-4">
                  <Btn variant="teal" size="sm" className="whitespace-nowrap" icon={<Icon.ArrowRight size={12} />}>
                    Open report
                  </Btn>
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* Recent analyses table */}
      <Card className="overflow-hidden">
        <div className="p-5 md:p-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between hair-b bg-cream-100/50">
          <div>
            <h3 className="font-serif text-2xl md:text-[26px]">Recent analyses</h3>
            <div className="text-[12px] text-ink-400 mt-1">
              {statements.length} statement{statements.length !== 1 ? 's' : ''} uploaded
            </div>
          </div>
          <Link href="/analyses">
            <span className="inline-flex h-10 px-4 rounded-full border hair text-[13px] items-center gap-2 hover:bg-cream-200/80 transition cursor-pointer">
              <Icon.Filter size={13} /> View all
            </span>
          </Link>
        </div>
        {statements.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-ink-500 text-[15px]">No statements uploaded yet.</div>
            <Link href="/upload">
              <Btn variant="primary" className="mt-5" icon={<Icon.Upload size={14} />}>
                Upload your first statement
              </Btn>
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="smallcaps text-ink-400 bg-cream-200/50">
                <tr>
                  {['Date', 'Period', 'Acquirer', 'Eff. rate', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="text-left font-medium px-5 py-3.5 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-hair">
                {statements.slice(0, 5).map((s) => {
                  const sFin =
                    s.parsedData && typeof s.parsedData === 'object' ? finalizeParsedForClient(s.parsedData) : null;
                  return (
                  <tr key={s.id} className="group hover:bg-cream-200/35 transition-colors">
                    <td className="px-5 py-3.5 font-mono text-[13px] tabular text-ink-500">{s.uploadDate}</td>
                    <td className="px-5 py-3.5 font-medium">{s.period}</td>
                    <td className="px-5 py-3.5 max-w-[10rem] truncate" title={s.acquirer}>
                      {s.acquirer}
                    </td>
                    <td className="px-5 py-3.5 font-mono tabular">
                      {formatEffectiveRatePct(
                        sFin?.effective_rate,
                        sFin ? overviewPrimarySalesVolumeGross(sFin) : NaN,
                        sFin ? reconcileTotalFeesCharged(sFin).total : NaN,
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <Pill tone={s.status === 'Parsed' ? 'leaf' : s.status === 'Reviewing' ? 'amber' : 'rose'}>
                        <span
                          className={`dot ${s.status === 'Parsed' ? 'bg-leaf' : s.status === 'Reviewing' ? 'bg-amber' : 'bg-rose'}`}
                        />
                        {s.status}
                      </Pill>
                    </td>
                    <td className="px-5 py-3.5">
                      <Link
                        href="/report"
                        onClick={() => setCurrentStatementId(s.id)}
                        className="text-[13px] font-medium text-teal hover:text-ink inline-flex items-center gap-1 transition-colors"
                      >
                        Open <Icon.ArrowUpRight size={12} />
                      </Link>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-6 bg-ink text-cream border-ink flex flex-col min-h-[200px]">
          <div className="smallcaps text-teal-bright mb-2">Primary</div>
          <h3 className="font-serif text-2xl leading-snug">New statement</h3>
          <p className="text-cream/55 text-[13px] mt-2 flex-1 leading-relaxed">
            PDF, CSV or XLSX up to 50MB. Typical analysis under 60 seconds.
          </p>
          <Link href="/upload" className="mt-5">
            <Btn variant="teal" icon={<Icon.Upload size={14} />}>
              Upload
            </Btn>
          </Link>
        </Card>
        <Card className="p-6 flex flex-col min-h-[200px] border-ink/12">
          <div className="smallcaps text-ink-400 mb-2">Library</div>
          <h3 className="font-serif text-2xl leading-snug">All analyses</h3>
          <p className="text-ink-500 text-[13px] mt-2 flex-1 leading-relaxed">
            Search, export CSV, and open any past statement from one place.
          </p>
          <div className="mt-5">
            <Link href="/analyses">
              <Btn variant="outline" icon={<Icon.Filter size={14} />}>
                Browse
              </Btn>
            </Link>
          </div>
        </Card>
        <Card className={`p-6 flex flex-col min-h-[200px] ${!tierOk(user.tier, 'L2') ? 'bg-cream-200/40' : ''}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="smallcaps text-ink-400">Forecast</span>
            {!tierOk(user.tier, 'L2') && <Pill tone="leaf">L2</Pill>}
          </div>
          <h3 className="font-serif text-2xl leading-snug">What-if model</h3>
          <p className="text-ink-500 text-[13px] mt-2 flex-1 leading-relaxed">Volume, AOV, and payment mix sliders.</p>
          <div className="mt-5">
            <Link href="/whatif">
              <Btn
                variant={tierOk(user.tier, 'L2') ? 'primary' : 'outline'}
                icon={tierOk(user.tier, 'L2') ? <Icon.Bolt size={14} /> : <Icon.Lock size={14} />}
              >
                {tierOk(user.tier, 'L2') ? 'Open' : 'Upgrade'}
              </Btn>
            </Link>
          </div>
        </Card>
      </div>

      {user.tier === 'Free' && (
        <div className="rounded-2xl border hair p-6 flex items-center gap-5 bg-cream-200/60">
          <div className="w-12 h-12 rounded-full bg-ink text-cream flex items-center justify-center"><Icon.Sparkles size={18} /></div>
          <div className="flex-1">
            <div className="text-sm font-medium">You're on the Free tier.</div>
            <div className="text-[12px] text-ink-400">Unlock Q&A, longer history, and exports. From $39/month.</div>
          </div>
          <Link href="/upgrade"><Btn variant="primary">See plans</Btn></Link>
        </div>
      )}
    </div>
  );
}
