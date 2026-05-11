import { getStatementDisplayCurrency } from '@/lib/currencyConversion';
import { finalizeParsedForClient } from '@/lib/statementFinalize';
import { reconcileTotalFeesCharged, overviewPrimarySalesVolumeGross, isSyntheticInterchangeSchemeProcessorFeeLine, listParsedFeeScalarEntries } from '@/lib/utils';
import { effectiveRatePercentFromTotals } from '@/lib/financialAnalysisFormulas';

export const runtime = 'nodejs';

/**
 * Q&A: deterministic answers from parsed statement fields only.
 * No LLM — extend by adding keyword branches and pure helpers (see docs/DETERMINISTIC_PIPELINE.md).
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const messages = body.messages || [];
    const last = messages[messages.length - 1];
    const q = String(last?.content || '').toLowerCase();
    const rawPd = body.statementContext?.parsedData;
    const pd =
      rawPd && typeof rawPd === 'object' ? finalizeParsedForClient({ ...rawPd }) : null;
    const gv = pd != null ? overviewPrimarySalesVolumeGross(pd) : NaN;
    const { total: feeTotal } = reconcileTotalFeesCharged(pd || {});
    const eff = effectiveRatePercentFromTotals(feeTotal, gv);

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

    if (pd && /interchange|scheme|volume|effective|fee|rate/.test(q)) {
      const parts = [];
      const feeLineMentionsInterchange = () =>
        Array.isArray(pd.fee_lines) &&
        pd.fee_lines.some(
          (row) =>
            row &&
            typeof row === 'object' &&
            !isSyntheticInterchangeSchemeProcessorFeeLine(row) &&
            /\binterchange\b/i.test(`${String(row.type ?? '')} ${String(row.label ?? '')}`),
        );
      const feeLineMentionsScheme = () =>
        Array.isArray(pd.fee_lines) &&
        pd.fee_lines.some(
          (row) =>
            row &&
            typeof row === 'object' &&
            !isSyntheticInterchangeSchemeProcessorFeeLine(row) &&
            /\bscheme\b/i.test(`${String(row.type ?? '')} ${String(row.label ?? '')}`) &&
            /\b(fee|fees|assessment|charge)\b/i.test(`${String(row.type ?? '')} ${String(row.label ?? '')}`),
        );
      if (/volume/.test(q)) {
        parts.push(`Total transaction volume (parsed): ${money(gv)}.`);
      }
      if (/effective|rate/.test(q)) {
        parts.push(`Your effective rate: ${eff != null && Number.isFinite(eff) ? `${eff.toFixed(2)}%` : '—'} (fees ÷ gross volume where available).`);
      }
      if (/interchange/.test(q) && pd) {
        const ic = Number(pd.interchange_fees);
        if (Number.isFinite(ic) && Math.abs(ic) > 0.005) {
          parts.push(`Interchange fees (parsed): ${money(pd.interchange_fees)}.`);
        } else if (feeLineMentionsInterchange()) {
          parts.push('Interchange appears on itemized fee lines in this parse — see the report Fee breakdown for those rows.');
        } else {
          parts.push('This parse does not include separate interchange totals or interchange-labeled fee lines.');
        }
      }
      if (/scheme/.test(q) && pd) {
        const sc = Number(pd.scheme_fees);
        if (Number.isFinite(sc) && Math.abs(sc) > 0.005) {
          parts.push(`Scheme fees (parsed): ${money(pd.scheme_fees)}.`);
        } else if (feeLineMentionsScheme()) {
          parts.push('Scheme or assessment fees appear on itemized fee lines in this parse — see the report Fee breakdown for those rows.');
        } else {
          parts.push('This parse does not include separate scheme-fee totals or scheme-labeled fee lines.');
        }
      }
      if (/fee|total fee/.test(q) && pd) {
        parts.push(`Total fees charged (parsed / reconciled): ${money(feeTotal)}.`);
        const extras = listParsedFeeScalarEntries(pd);
        if (extras.length > 0 && !/interchange|scheme/.test(q)) {
          const lines = extras.slice(0, 12).map((e) => `${e.label} (${e.slug}): ${money(e.value)}.`);
          parts.push(`Fee buckets on file: ${lines.join(' ')}`);
        }
      }
      if (parts.length > 0) {
        return Response.json({
          content: parts.join('\n\n'),
        });
      }
    }

    return Response.json({
      content:
        'Ask about volume, effective rate, or total fees — answers use your parsed statement data when available. ' +
        'For full detail open the Overview tab.',
    });
  } catch (err) {
    console.error('Chat route error:', err);
    return Response.json({ error: 'Internal error', detail: String(err) }, { status: 500 });
  }
}
