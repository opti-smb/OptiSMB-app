'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as Icon from '@/components/Icons';
import { Card, Btn, Pill } from '@/components/UI';
import { useApp } from '@/components/AppContext';
import { useToast } from '@/components/Toast';
import {
  tierOk,
  downloadCSV,
  triggerPrint,
  channelSplitRowGrossForAggregate,
  resolveChannelSplitBucket,
  reconcileTotalFeesCharged,
  overviewPrimarySalesVolumeGross,
} from '@/lib/utils';
import { finalizeParsedForClient } from '@/lib/statementFinalize';
import { effectiveRatePercentFromTotals } from '@/lib/financialAnalysisFormulas';

function statementBillingMonthKey(s) {
  if (s?.billingMonthKey) return s.billingMonthKey;
  const from = s?.parsedData?.billing_period?.from;
  if (!from) return null;
  const d = new Date(from);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function compareStatementsByBillingMonthAsc(a, b) {
  const ka = statementBillingMonthKey(a) || '\xff';
  const kb = statementBillingMonthKey(b) || '\xff';
  return ka.localeCompare(kb);
}

function momMetricsFromStatement(s) {
  const fin =
    s?.parsedData && typeof s.parsedData === 'object' ? finalizeParsedForClient(s.parsedData) : null;
  if (!fin) return { gv: null, fees: null, eff: null };
  const gv = overviewPrimarySalesVolumeGross(fin);
  const { total: fees } = reconcileTotalFeesCharged(fin);
  let eff = effectiveRatePercentFromTotals(fees, gv);
  if (eff == null && fin.effective_rate != null && Number.isFinite(Number(fin.effective_rate))) {
    eff = Number(fin.effective_rate);
  }
  return { gv: Number(gv), fees: Number(fees), eff: eff != null ? Number(eff) : null };
}

function momPctDelta(prev, cur) {
  if (prev == null || cur == null || !Number.isFinite(prev) || !Number.isFinite(cur) || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

function buildMonthOverMonthByAcquirer(statements, opts = {}) {
  const acquirerFilter = opts.acquirer && opts.acquirer !== 'all' ? opts.acquirer : null;
  const acquirers = [
    ...new Set(
      statements
        .filter((s) => s && statementBillingMonthKey(s))
        .map((s) => s.acquirer)
        .filter(Boolean),
    ),
  ].filter((a) => !acquirerFilter || a === acquirerFilter);

  return acquirers.map((acquirer) => {
    const rows = statements
      .filter((s) => s.acquirer === acquirer && statementBillingMonthKey(s))
      .sort(compareStatementsByBillingMonthAsc);

    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const s = rows[i];
      const prev = i > 0 ? rows[i - 1] : null;
      const m = momMetricsFromStatement(s);
      const pm = prev ? momMetricsFromStatement(prev) : { gv: null, fees: null, eff: null };
      out.push({
        monthKey: statementBillingMonthKey(s),
        periodLabel: s.period || statementBillingMonthKey(s),
        volume: Number.isFinite(m.gv) ? m.gv : null,
        fees: Number.isFinite(m.fees) ? m.fees : null,
        effPct: m.eff != null && Number.isFinite(m.eff) ? m.eff : null,
        dVol: prev ? momPctDelta(pm.gv, m.gv) : null,
        dFees: prev ? momPctDelta(pm.fees, m.fees) : null,
        dEff: prev && pm.eff != null && m.eff != null ? m.eff - pm.eff : null,
      });
    }
    return { acquirer, rows: out };
  });
}

function formatPctDelta(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function formatPpDelta(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)} pp`;
}

function displayChannelSplitVolume(parsedData, splitKey) {
  const fin =
    parsedData && typeof parsedData === 'object' ? finalizeParsedForClient(parsedData) : null;
  const row = fin?.channel_split?.[splitKey];
  if (!row || typeof row !== 'object') return '—';
  const bucket = resolveChannelSplitBucket(splitKey, row);
  const v =
    bucket != null
      ? channelSplitRowGrossForAggregate(fin, row, bucket)
      : Number(row.volume);
  return Number.isFinite(v) && v > 0 ? `$${Number(v).toLocaleString()}` : '—';
}

function displayEffectiveRatePct(parsedData) {
  const fin =
    parsedData && typeof parsedData === 'object' ? finalizeParsedForClient(parsedData) : null;
  if (!fin) return '—';
  let n = Number(fin.effective_rate);
  const { total: feeTot } = reconcileTotalFeesCharged(fin);
  const gv = overviewPrimarySalesVolumeGross(fin);
  if (n === 0 || !Number.isFinite(n)) {
    const alt = effectiveRatePercentFromTotals(feeTot, gv);
    if (alt != null) n = alt;
  }
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : '—';
}

function tierHistoryLabel(tier) {
  if (tier === 'L2') return 'Unlimited history';
  if (tier === 'L1') return '12 months';
  return '3 months (Free)';
}

function applyTierFilter(statements, tier) {
  if (tierOk(tier, 'L2')) return statements;
  if (tierOk(tier, 'L1')) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 12);
    return statements.filter(s => new Date(s.uploadDate) >= cutoff);
  }
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  return statements.filter(s => new Date(s.uploadDate) >= cutoff);
}

export default function AnalysesPage() {
  const { user, statements, setCurrentStatementId, deleteStatement } = useApp();
  const { addToast } = useToast();
  const router = useRouter();
  const [filter, setFilter] = useState('all');
  const [acquirerFilter, setAcquirerFilter] = useState('all');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const acquirers = [...new Set(statements.map(s => s.acquirer))];

  const tierFiltered = applyTierFilter(statements, user.tier);
  const hiddenCount = statements.length - tierFiltered.length;

  const visible = tierFiltered.filter(s => {
    if (filter !== 'all' && s.status.toLowerCase() !== filter) return false;
    if (acquirerFilter !== 'all' && s.acquirer !== acquirerFilter) return false;
    return true;
  });

  const monthOverMonth = useMemo(
    () => buildMonthOverMonthByAcquirer(tierFiltered, { acquirer: acquirerFilter }),
    [tierFiltered, acquirerFilter],
  );

  const openReport = (id) => {
    setCurrentStatementId(id);
    router.push('/report');
  };

  const exportAll = () => {
    const rows = [
      ['Date', 'Period', 'Acquirer', 'Effective Rate', 'Total Fees', 'POS Volume', 'Online Volume', 'Status'],
      ...tierFiltered.map(s => [
        s.uploadDate, s.period, s.acquirer,
        displayEffectiveRatePct(s.parsedData),
        `$${s.parsedData?.total_fees_charged?.toLocaleString() ?? '—'}`,
        displayChannelSplitVolume(s.parsedData, 'pos'),
        displayChannelSplitVolume(s.parsedData, 'cnp'),
        s.status,
      ]),
    ];
    downloadCSV(rows, 'optismb-analyses.csv');
    addToast({ type: 'success', title: 'CSV exported', message: `${tierFiltered.length} analyses exported.` });
  };

  const handleDelete = (id) => {
    deleteStatement(id);
    setConfirmDelete(null);
    addToast({ type: 'success', title: 'Statement deleted' });
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="smallcaps text-ink-400 mb-2">Analyses</div>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <h1 className="font-serif text-5xl leading-tight">Every statement you've run.</h1>
          <div className="flex gap-2">
            <Btn variant="outline" size="sm" icon={<Icon.Download size={13} />} onClick={exportAll}>Export CSV</Btn>
            <Link href="/upload"><Btn variant="primary" size="sm" icon={<Icon.Upload size={13} />}>Upload</Btn></Link>
          </div>
        </div>
        <div className="text-[13px] text-ink-400 mt-2 flex items-center gap-2">
          <Icon.History size={13} />
          History retention: {tierHistoryLabel(user.tier)}
          {!tierOk(user.tier, 'L2') && (
            <Link href="/upgrade" className="text-teal underline underline-offset-2">Upgrade for longer history</Link>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={acquirerFilter} onChange={e => setAcquirerFilter(e.target.value)}
          className="h-9 px-3 bg-cream-100 border hair rounded-full text-[13px] outline-none focus:border-ink">
          <option value="all">All acquirers</option>
          {acquirers.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={filter} onChange={e => setFilter(e.target.value)}
          className="h-9 px-3 bg-cream-100 border hair rounded-full text-[13px] outline-none focus:border-ink">
          <option value="all">All statuses</option>
          <option value="parsed">Parsed</option>
          <option value="reviewing">Reviewing</option>
        </select>
        <div className="text-[12px] text-ink-400 font-mono">{visible.length} result{visible.length !== 1 ? 's' : ''}</div>
      </div>

      {statements.length === 0 ? (
        <Card className="p-14 text-center">
          <div className="w-14 h-14 rounded-full bg-cream-200 border hair flex items-center justify-center mx-auto mb-4">
            <Icon.FileText size={22} className="text-ink-400" />
          </div>
          <h3 className="font-serif text-2xl mb-2">No statements yet</h3>
          <p className="text-[14px] text-ink-500 mb-5">Upload your first acquiring statement to get started.</p>
          <Link href="/upload"><Btn variant="primary" icon={<Icon.Upload size={14} />}>Upload statement</Btn></Link>
        </Card>
      ) : (
        <>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="smallcaps text-ink-400 bg-cream-200/40">
                <tr>
                  {['Date', 'Period', 'Acquirer', 'Eff. rate', 'Fees', 'Status', 'Actions'].map(h => (
                    <th key={h} className="text-left font-medium px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-hair">
                {visible.map(s => (
                    <tr key={s.id} className="hover:bg-cream-200/40 group">
                      <td className="px-5 py-3 font-mono text-[13px] tabular">{s.uploadDate}</td>
                      <td className="px-5 py-3">{s.period}</td>
                      <td className="px-5 py-3 max-w-[160px]">
                        <div className="truncate">{s.acquirer}</div>
                      </td>
                      <td className="px-5 py-3 font-mono tabular">{displayEffectiveRatePct(s.parsedData)}</td>
                      <td className="px-5 py-3 font-mono tabular">${(s.parsedData?.total_fees_charged || 0).toLocaleString()}</td>
                      <td className="px-5 py-3">
                        <Pill tone={s.status === 'Parsed' ? 'leaf' : 'amber'}>
                          <span className={`dot ${s.status === 'Parsed' ? 'bg-leaf' : 'bg-amber'}`} />{s.status}
                        </Pill>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex gap-3 text-[13px] opacity-60 group-hover:opacity-100 transition">
                          <button onClick={() => openReport(s.id)} className="underline underline-offset-2 flex items-center gap-1 text-ink">
                            View <Icon.ArrowUpRight size={11} />
                          </button>
                          {tierOk(user.tier, 'L1') && (
                            <button onClick={triggerPrint} className="underline underline-offset-2 text-ink">PDF</button>
                          )}
                          {tierOk(user.tier, 'L2') && (
                            <button onClick={() => {
                              const rows = [
                                ['Acquirer', 'Period', 'Rate', 'Fees', 'POS Volume', 'Online Volume'],
                                [s.acquirer, s.period, `${s.parsedData?.effective_rate?.toFixed(2)}%`, `$${s.parsedData?.total_fees_charged?.toLocaleString()}`, displayChannelSplitVolume(s.parsedData, 'pos'), displayChannelSplitVolume(s.parsedData, 'cnp')]
                              ];
                              downloadCSV(rows, `${s.acquirer.replace(/\s+/g, '-')}-${s.period}.csv`);
                              addToast({ type: 'success', title: 'Excel downloaded' });
                            }} className="underline underline-offset-2 text-ink">Excel</button>
                          )}
                          <button onClick={() => setConfirmDelete(s.id)} className="underline underline-offset-2 text-rose">Delete</button>
                        </div>
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hiddenCount > 0 && (
            <div className="p-5 hair-t bg-cream-200/60 flex items-center gap-4">
              <Icon.Lock size={16} className="text-ink-400 shrink-0" />
              <div className="flex-1 text-[13px]">
                {hiddenCount} older statement{hiddenCount > 1 ? 's' : ''} hidden.{' '}
                {tierOk(user.tier, 'L1') ? 'Upgrade to Level 2 for unlimited history.' : 'Upgrade to Level 1 for 12 months, Level 2 for unlimited.'}
              </div>
              <Link href="/upgrade"><Btn size="sm" variant="primary">Upgrade</Btn></Link>
            </div>
          )}

          {visible.length === 0 && statements.length > 0 && (
            <div className="p-8 text-center text-ink-400 text-[14px]">No statements match your filters.</div>
          )}
        </Card>

        {monthOverMonth.some((b) => b.rows.length >= 2) && (
          <div className="space-y-4">
            <div className="smallcaps text-ink-400">Month over month</div>
            <p className="text-[13px] text-ink-500 max-w-3xl">
              Compare gross volume, total fees, and effective rate across billing periods (same acquirer). Upload each
              month&apos;s statement so periods appear in order.
            </p>
            {monthOverMonth.map(
              ({ acquirer, rows }) =>
                rows.length >= 2 && (
                  <Card key={acquirer} className="overflow-hidden">
                    <div className="px-5 py-4 hair-b bg-cream-200/40 font-medium">{acquirer}</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="smallcaps text-ink-400 bg-cream-200/30">
                          <tr>
                            {['Billing month', 'Gross volume', 'Total fees', 'Eff. rate', 'Δ Volume', 'Δ Fees', 'Δ Rate'].map(
                              (h) => (
                                <th key={h} className="text-left font-medium px-5 py-3 whitespace-nowrap">
                                  {h}
                                </th>
                              ),
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-hair">
                          {rows.map((r, i) => (
                            <tr key={`${acquirer}-${r.monthKey}-${i}`} className="hover:bg-cream-200/35">
                              <td className="px-5 py-3 font-mono text-[13px]">{r.periodLabel}</td>
                              <td className="px-5 py-3 font-mono tabular">
                                {r.volume != null ? `$${r.volume.toLocaleString()}` : '—'}
                              </td>
                              <td className="px-5 py-3 font-mono tabular">
                                {r.fees != null ? `$${r.fees.toLocaleString()}` : '—'}
                              </td>
                              <td className="px-5 py-3 font-mono tabular">
                                {r.effPct != null ? `${r.effPct.toFixed(2)}%` : '—'}
                              </td>
                              <td className="px-5 py-3 font-mono tabular text-[13px]">{formatPctDelta(r.dVol)}</td>
                              <td className="px-5 py-3 font-mono tabular text-[13px]">{formatPctDelta(r.dFees)}</td>
                              <td className="px-5 py-3 font-mono tabular text-[13px]">{formatPpDelta(r.dEff)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                ),
            )}
          </div>
        )}
        </>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-6">
          <Card className="max-w-sm w-full p-6">
            <div className="flex items-start gap-3 mb-4">
              <Icon.AlertTriangle className="text-rose mt-0.5 shrink-0" size={18} />
              <div>
                <div className="font-serif text-2xl">Delete this statement?</div>
                <div className="text-[13px] text-ink-500 mt-1">The analysis and all associated data will be permanently removed.</div>
              </div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <Btn variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Btn>
              <Btn variant="danger" onClick={() => handleDelete(confirmDelete)}>Delete</Btn>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
