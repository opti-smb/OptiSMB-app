'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as Icon from '@/components/Icons';
import { Card, Btn, Pill, ConfidenceBadge, DualConfidence, Disclaimer } from '@/components/UI';
import { LineChart } from '@/components/Charts';
import { useApp } from '@/components/AppContext';
import { tierOk } from '@/lib/utils';
import { acquirerDatabase, DATA_TIER_LABELS } from '@/lib/mockData';

function StalenessStatus({ a }) {
  if (a.daysOld >= 180) return <Pill tone="rose"><span className="dot bg-rose" />Outdated ({a.daysOld}d)</Pill>;
  if (a.daysOld >= 90) return <Pill tone="amber"><span className="dot bg-amber" />Stale ({a.daysOld}d)</Pill>;
  return <Pill tone="leaf"><span className="dot bg-leaf" />Current ({a.daysOld}d)</Pill>;
}

export default function BenchmarkPage() {
  const { user, getCurrentStatement, checkStaleness } = useApp();
  const router = useRouter();
  const stmt = getCurrentStatement();
  const recs = stmt?.benchmarks || [];
  const trend = stmt?.rateTrend;
  const staleness = checkStaleness(stmt);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="smallcaps text-ink-400 mb-2">Benchmarking</div>
          <h1 className="font-serif text-4xl md:text-[40px] leading-[1.1]">
            What you should be paying, <em className="text-teal">right now.</em>
          </h1>
        </div>
        {stmt && <DualConfidence parsing={stmt.parsingConfidence} rate={stmt.rateConfidence} asOf={stmt.dataAsOf} />}
      </div>

      {staleness && (
        <div className={`rounded-xl border p-4 flex items-start gap-3 ${staleness.level === 'red' ? 'bg-rose-soft/40 border-rose/30' : 'bg-amber-soft/40 border-amber/30'}`}>
          <Icon.AlertTriangle size={16} className={`${staleness.level === 'red' ? 'text-rose' : 'text-amber'} mt-0.5 shrink-0`} />
          <div className="flex-1">
            <div className="text-sm font-medium">Benchmark data {staleness.level === 'red' ? 'is significantly outdated (≥180 days)' : 'is approaching staleness (≥90 days)'}</div>
            <div className="text-[12px] text-ink-500">Rate comparisons may not reflect current market pricing. Re-upload a recent statement to refresh.</div>
          </div>
        </div>
      )}

      <Disclaimer>
        The rate data shown is sourced from published interchange schedules, regulatory disclosures (T1), and SMB-reported data (T2/T3) as of the dates shown.
        It is provided for informational purposes only and does not constitute financial advice. Savings estimates are indicative.
        <strong> We may receive a referral fee if you contact an acquirer through OptiSMB. This does not affect the ranking of recommendations.</strong>
      </Disclaimer>

      {/* Confidence + tier legend */}
      <div className="border hair rounded-xl p-4 bg-cream-200/50 grid sm:grid-cols-2 gap-4 text-[12px] text-ink-500">
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
            {['T1', 'T2', 'T3'].map(t => (
              <span key={t} className="flex items-center gap-2">
                <Pill tone={DATA_TIER_LABELS[t].color}>{t}</Pill>
                <span>{DATA_TIER_LABELS[t].label.replace(`${t} — `, '')}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Top 3 recommendations */}
      {recs.length > 0 ? (
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
                      <div className="text-[11px] font-mono text-ink-400">data as of {r.dataAsOf}</div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Pill tone="ink">#{i + 1}</Pill>
                    <Pill tone={tierInfo.color}>{r.dataSourceTier}</Pill>
                  </div>
                </div>
                <div className="flex-1">
                  <div className="smallcaps text-ink-400">Projected annual saving</div>
                  {tierOk(user.tier, 'L1')
                    ? <div className="font-serif text-4xl tabular mt-1 text-teal">${r.save?.toLocaleString()}<span className="text-base text-ink-400">/yr</span></div>
                    : <div className="mt-1 h-10 flex items-center text-[13px] text-ink-400"><Icon.Lock size={14} className="mr-2" />Upgrade to Level 1 to see savings</div>}
                  <div className="text-[13px] text-ink-500 mt-3">Projected rate: <span className="font-mono text-ink tabular">{r.rate?.toFixed(2)}%</span></div>
                  <p className="text-[12px] text-ink-500 mt-3 leading-relaxed">{r.blurb}</p>
                  <div className="mt-4">
                    <div className="smallcaps text-ink-400 mb-1.5">Recommendation confidence</div>
                    <ConfidenceBadge level={r.conf} asOf={r.dataAsOf} />
                  </div>
                  <div className="mt-3 text-[11px] text-ink-400">{tierInfo.description}</div>
                  {r.referralApplicable && (
                    <div className="mt-4 pt-4 border-t hair text-[11px] text-ink-500">
                      <strong>Referral disclosure:</strong> OptiSMB may receive a fee if you contact {r.name} through this platform. This does not affect ranking.
                    </div>
                  )}
                </div>
                <div className="mt-5 flex gap-2">
                  <Btn variant="primary" size="sm" icon={<Icon.ArrowUpRight size={13} />} className="flex-1">Contact {r.name}</Btn>
                  <Btn variant="outline" size="sm">Details</Btn>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="p-12 text-center">
          <Icon.BarChart size={28} className="text-ink-400 mx-auto mb-4" />
          <h3 className="font-serif text-2xl mb-2">No benchmark data yet</h3>
          <p className="text-[14px] text-ink-500 mb-5">Upload a statement to see how your rates compare against 10 acquirers.</p>
          <Link href="/upload"><Btn variant="primary" icon={<Icon.Upload size={14} />}>Upload statement</Btn></Link>
        </Card>
      )}

      <Card className="p-5 flex items-center gap-4 bg-cream-200/40">
        <Icon.Info size={18} className="text-ink-400 shrink-0" />
        <div className="flex-1">
          <div className="text-sm">Teya, Heartland, and Elavon evaluated — insufficient corroborated data for your AOV band and MCC.</div>
          <div className="text-[12px] text-ink-400 mt-0.5">We require ≥8 corroborated data points to publish a recommendation. We never display a recommendation without at least Low confidence data.</div>
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
          <LineChart xLabels={trend.labels} series={[
            { color: '#0F1B2D', data: trend.yours },
            { color: '#00A88A', data: trend.panel },
            { color: '#8B94A3', dashed: true, data: trend.best },
          ]} />
        </Card>
      )}

      {/* Acquirer database status */}
      <Card>
        <div className="p-5 hair-b flex items-center justify-between">
          <div>
            <div className="font-serif text-2xl">Acquirer database</div>
            <div className="text-[12px] text-ink-400">{acquirerDatabase.length} acquirers tracked · staleness threshold: 90 days (amber) / 180 days (red)</div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="smallcaps text-ink-400 bg-cream-200/40">
              <tr>{['Acquirer', 'Data tier', 'MCC coverage', 'Last updated', 'Age', 'Status', 'Notes'].map(h => <th key={h} className="text-left font-medium px-5 py-3">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-hair">
              {acquirerDatabase.map((a, i) => {
                const tierInfo = DATA_TIER_LABELS[a.tier] || DATA_TIER_LABELS.T3;
                return (
                  <tr key={i} className="hover:bg-cream-200/40">
                    <td className="px-5 py-3 font-medium">{a.name}</td>
                    <td className="px-5 py-3"><Pill tone={tierInfo.color}>{a.tier}</Pill></td>
                    <td className="px-5 py-3 text-ink-500">{a.mccCoverage}</td>
                    <td className="px-5 py-3 font-mono text-[13px] tabular">{a.lastUpdated}</td>
                    <td className="px-5 py-3 font-mono text-[13px] tabular">{a.daysOld}d</td>
                    <td className="px-5 py-3"><StalenessStatus a={a} /></td>
                    <td className="px-5 py-3 text-[12px] text-ink-400 max-w-xs">{a.notes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="p-4 hair-t text-[11px] text-ink-400">
          Staleness monitoring: automated alert triggered if &gt;2 acquirer records exceed 90-day threshold simultaneously. Data Team reviews all records quarterly.
        </div>
      </Card>
    </div>
  );
}
