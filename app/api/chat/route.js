import { getBenchmarkAnalysis } from '@/lib/computeBenchmarkAnalysis';
import { getStatementDisplayCurrency } from '@/lib/currencyConversion';

export const runtime = 'nodejs';

/**
 * Q&A: uses parsed statement + benchmark summary (deterministic).
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const messages = body.messages || [];
    const last = messages[messages.length - 1];
    const q = String(last?.content || '').toLowerCase();
    const pd = body.statementContext?.parsedData;
    const ba = getBenchmarkAnalysis(pd);
    const sum = ba?.summary;
    const bench = ba?.benchmark;

    const n = (x) => (x == null || Number.isNaN(Number(x)) ? '—' : Number(x).toLocaleString('en-US', { maximumFractionDigits: 2 }));
    const displayCcy = getStatementDisplayCurrency(pd);
    const money = (x, cur = displayCcy) => {
      if (x == null || Number.isNaN(Number(x))) return '—';
      try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(Number(x));
      } catch {
        return `$${n(x)}`;
      }
    };

    if (sum && bench && /interchange|scheme|benchmark|volume|effective|fee|overpay|saving|difference|rate/.test(q)) {
      const parts = [];
      if (/volume/.test(q)) {
        parts.push(`Total transaction volume (parsed): ${money(sum.total_gross_volume)}.`);
      }
      if (/effective|rate/.test(q)) {
        parts.push(
          `Your effective rate: ${sum.effective_rate_pct != null ? `${sum.effective_rate_pct}%` : '—'}; benchmark rate: ${bench.benchmark_rate_pct}%; gap ${bench.rate_gap_pp != null ? `${bench.rate_gap_pp >= 0 ? '+' : ''}${bench.rate_gap_pp}pp` : '—'}.`
        );
      }
      if (/interchange/.test(q) && pd) {
        parts.push(`Interchange fees (parsed): ${money(pd.interchange_fees)}.`);
      }
      if (/scheme/.test(q) && pd) {
        parts.push(`Scheme fees (parsed): ${money(pd.scheme_fees)}.`);
      }
      if (/benchmark|overpay|saving|difference/.test(q)) {
        parts.push(
          `Versus benchmark (${bench.benchmark_rate_pct}%): estimated fees at benchmark rate ${money(bench.fees_at_benchmark_rate)}; your fees ${money(sum.total_fees_charged)}; estimated overpayment ${money(bench.estimated_overpayment)}.`
        );
      }
      if (parts.length > 0) {
        return Response.json({
          content: parts.join('\n\n'),
        });
      }
    }

    return Response.json({
      content:
        'Ask about volume, effective rate, fees, or benchmark comparison — answers use your parsed statement data when available. ' +
        'For full detail open the Overview tab.',
    });
  } catch (err) {
    console.error('Chat route error:', err);
    return Response.json({ error: 'Internal error', detail: String(err) }, { status: 500 });
  }
}
