/**
 * Benchmark analysis payloads (`benchmark_analysis`): normalize legacy shapes, compute client-side
 * when the API omits it, and pin the canonical panel rate. **Formula math** lives in
 * `./financialAnalysisFormulas.js` (Financial Analysis Formula sheet).
 */

import { BENCHMARK_EFFECTIVE_RATE_PCT, GST_RATE_BY_CURRENCY } from '@/lib/benchmarkConstants';
import {
  effectiveRatePercentFromTotals,
  estimatedOverpaymentVsBenchmark,
  feesAtBenchmarkRate,
  rateGapPercentagePoints,
  roundMoney2,
  roundRate4,
} from '@/lib/financialAnalysisFormulas';
import { getStatementDisplayCurrency } from '@/lib/currencyConversion';

export function normalizeBenchmarkAnalysis(ba) {
  if (!ba || typeof ba !== 'object') return null;
  if (ba.summary && ba.benchmark) {
    const s = ba.summary.effective_rate_pct;
    const b = ba.benchmark;
    if (b.your_effective_rate_pct == null && s != null) {
      b.your_effective_rate_pct = s;
    }
    if (ba.summary.effective_rate_pct == null && b?.your_effective_rate_pct != null) {
      ba.summary.effective_rate_pct = b.your_effective_rate_pct;
    }
    return ba;
  }
  const c = ba.computed;
  if (!c) return null;
  const br = Number(ba.fake_benchmark?.panel_effective_rate_pct ?? BENCHMARK_EFFECTIVE_RATE_PCT);
  const eff = c.your_effective_rate_pct;
  return {
    currency: ba.currency || 'USD',
    summary: {
      effective_rate_pct: eff,
      total_gross_volume: c.total_gross_volume,
      total_fees_charged: c.total_fees_charged,
    },
    benchmark: {
      your_effective_rate_pct: eff,
      benchmark_rate_pct: br,
      fees_at_benchmark_rate: c.fees_at_fake_panel_rate,
      estimated_overpayment: c.fee_difference_vs_panel,
      rate_gap_pp: c.rate_gap_vs_panel_pp,
    },
  };
}

export function computeBenchmarkAnalysis(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;

  const ccy = getStatementDisplayCurrency(parsed);
  const gv = Number(parsed.total_transaction_volume) || 0;
  const tf = Number(parsed.total_fees_charged) || 0;

  let eff =
    parsed.effective_rate != null && parsed.effective_rate !== '' ? Number(parsed.effective_rate) : null;
  const issues = parsed.parse_issues || [];
  if (issues.includes('effective_rate_implausible') || issues.includes('fees_exceed_volume')) {
    eff = null;
  }
  if (eff == null && gv > 0 && tf >= 0) {
    eff = effectiveRatePercentFromTotals(tf, gv);
  }

  const benchR = BENCHMARK_EFFECTIVE_RATE_PCT;
  const feesAtBench = feesAtBenchmarkRate(gv, benchR);
  const overpay = estimatedOverpaymentVsBenchmark(tf, feesAtBench);
  const gapPp = eff != null ? rateGapPercentagePoints(eff, benchR) : null;

  const effR = eff != null ? roundRate4(eff) : null;

  return {
    currency: ccy,
    summary: {
      effective_rate_pct: effR,
      total_gross_volume: roundMoney2(gv),
      total_fees_charged: roundMoney2(tf),
    },
    benchmark: {
      your_effective_rate_pct: effR,
      benchmark_rate_pct: benchR,
      fees_at_benchmark_rate: feesAtBench,
      estimated_overpayment: overpay,
      rate_gap_pp: gapPp,
    },
  };
}

export function applyCanonicalBenchmark(ba) {
  if (!ba?.summary || !ba.benchmark) return ba;
  const r = BENCHMARK_EFFECTIVE_RATE_PCT;
  const gv = Number(ba.summary.total_gross_volume) || 0;
  const tf = Number(ba.summary.total_fees_charged) || 0;
  const eff = ba.summary.effective_rate_pct != null ? Number(ba.summary.effective_rate_pct) : null;

  const feesAt = feesAtBenchmarkRate(gv, r);
  const overpay = estimatedOverpaymentVsBenchmark(tf, feesAt);
  const gap = eff != null ? rateGapPercentagePoints(eff, r) : null;

  ba.benchmark.benchmark_rate_pct = r;
  ba.benchmark.fees_at_benchmark_rate = feesAt;
  ba.benchmark.estimated_overpayment = overpay;
  ba.benchmark.rate_gap_pp = gap;
  ba.benchmark.your_effective_rate_pct = eff;
  return ba;
}

export function getBenchmarkAnalysis(parsedData) {
  if (!parsedData) return null;
  let ba = null;
  if (parsedData.benchmark_analysis) {
    ba = normalizeBenchmarkAnalysis(parsedData.benchmark_analysis);
  }
  if (!ba) ba = computeBenchmarkAnalysis(parsedData);
  return ba ? applyCanonicalBenchmark(ba) : null;
}

export { pctOfTotal, percentOfTotal } from '@/lib/financialAnalysisFormulas';
export { GST_RATE_BY_CURRENCY } from '@/lib/benchmarkConstants';
