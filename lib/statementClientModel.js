/**
 * Single client-side pass over a parse: finalize → POS UI bundle → headline strip → Channel tab card mix.
 * Report, upload preview, and plain-English copy should use this instead of ad-hoc `extractPosDataForUi` / card mix calls.
 * Headline volume denominator uses {@link overviewPrimarySalesVolumeGross} (same as Channel / Discrepancy / dashboard).
 */

import { formatMoney, getStatementDisplayCurrency, cardMixRowVolume } from './currencyConversion.js';
import { extractPosDataForUi } from './extractPosDataForUi.js';
import { finalizeParsedForClient } from './statementFinalize.js';
import { buildPosOrderLineTenderVolumeMix } from './posOrderSemanticRollup.js';
import { mergeChannelCardSlugMap, displayLabelForCardSlug } from './channelCardSlugDisplay.js';
import {
  getCardBrandMixFromParsed,
  overviewPrimarySalesVolumeGross,
  cardBrandMixRowHumanLabel,
  cardMixRowDisplayId,
  slugifyCardOrKey,
} from './utils.js';

const CARD_MIX_PALETTE = ['#0F1B2D', '#00A88A', '#B8770B', '#8B94A3', '#B03A2E'];

/**
 * @typedef {{ id: string, label: string, value: string, hint?: string }} StatementUiStripRow
 * @typedef {{ label: string, pct: number, color: string, vol: number, slug: string, displayLabel: string, sourceLabel?: string }} ChannelCardMixBar
 */

/**
 * Parser `card_brand_mix` → bars, else POS order-line tender mix, else legacy `card_mix`.
 *
 * @param {{ parsedData: object, totalVol: number, posLineCardMix: ReturnType<typeof buildPosOrderLineTenderVolumeMix>, slugMap?: Record<string, string> | null }} p
 * @returns {{ brandBars: ChannelCardMixBar[], cardMixKind: 'parser' | 'pos_lines' | 'legacy' | null, posLineCardMix: ReturnType<typeof buildPosOrderLineTenderVolumeMix>, slugDisplayAdditions: Record<string, string> }}
 */
export function buildChannelTabCardMixDisplay(p) {
  const { parsedData: d, totalVol, posLineCardMix, slugMap: slugMapOpt } = p;
  const slugMap =
    slugMapOpt && typeof slugMapOpt === 'object' && !Array.isArray(slugMapOpt)
      ? slugMapOpt
      : d.channel_card_display_slug_map && typeof d.channel_card_display_slug_map === 'object' && !Array.isArray(d.channel_card_display_slug_map)
        ? d.channel_card_display_slug_map
        : {};

  /** New slug → first-seen label for this parse (merged onto `parsedData` by the client model). */
  const slugDisplayAdditions = /** @type {Record<string, string>} */ ({});

  const mixRows = getCardBrandMixFromParsed(d);
  const legacyMix =
    d.card_mix && typeof d.card_mix === 'object' && !Array.isArray(d.card_mix) ? d.card_mix : null;
  const palette = CARD_MIX_PALETTE;

  const brandBars = /** @type {ChannelCardMixBar[]} */ ([]);
  /** @type {'parser' | 'pos_lines' | 'legacy' | null} */
  let cardMixKind = null;

  if (Array.isArray(mixRows) && mixRows.length) {
    /** @type {Map<string, { vol: number, sourceLabel: string }>} */
    const bySlug = new Map();
    mixRows.forEach((r, i) => {
      const v = cardMixRowVolume(r, d);
      const vol = v != null && Number.isFinite(Number(v)) ? Number(v) : 0;
      if (!(vol > 0)) return;
      const slug = cardMixRowDisplayId(r, i);
      const sourceLabel = String(cardBrandMixRowHumanLabel(r, i) || '').trim() || slug;
      const ex = bySlug.get(slug);
      if (ex) {
        ex.vol = Math.round((ex.vol + vol) * 100) / 100;
      } else {
        bySlug.set(slug, { vol, sourceLabel });
      }
    });
    const sorted = [...bySlug.entries()].sort((a, b) => b[1].vol - a[1].vol);
    let totMix = 0;
    for (const [, { vol }] of sorted) totMix += vol;
    sorted.forEach(([slug, { vol, sourceLabel }], i) => {
      if (!(slugMap[slug] != null && String(slugMap[slug]).trim() !== '') && sourceLabel) {
        slugDisplayAdditions[slug] = sourceLabel;
      }
      const pct = totMix > 0 ? Math.round((vol / totMix) * 100) : 0;
      const displayLabel = displayLabelForCardSlug(slug, sourceLabel, slugMap);
      brandBars.push({
        slug,
        displayLabel,
        label: displayLabel,
        sourceLabel,
        pct,
        color: palette[i % palette.length],
        vol,
      });
    });
    if (brandBars.length) cardMixKind = 'parser';
  }

  if (!cardMixKind && posLineCardMix?.rows?.length >= 2) {
    const tot = posLineCardMix.totalVolume;
    posLineCardMix.rows.forEach((r, i) => {
      const vol = r.volume;
      if (!(vol > 0)) return;
      const slug = r.slug || r.key || slugifyCardOrKey(r.label) || `row-${i}`;
      const sourceLabel = String(r.sourceLabel ?? r.label ?? '').trim();
      if (!(slugMap[slug] != null && String(slugMap[slug]).trim() !== '') && sourceLabel) {
        slugDisplayAdditions[slug] = sourceLabel;
      }
      const pct = tot > 0 ? Math.round((vol / tot) * 100) : 0;
      const displayLabel = displayLabelForCardSlug(slug, sourceLabel, slugMap);
      brandBars.push({
        slug,
        displayLabel,
        label: displayLabel,
        sourceLabel,
        pct,
        color: palette[i % palette.length],
        vol,
      });
    });
    if (brandBars.length) cardMixKind = 'pos_lines';
  }

  if (!cardMixKind && legacyMix) {
    /** @type {Map<string, { vol: number, pctShare: number, sourceLabel: string, origKey: string }>} */
    const bySlug = new Map();
    const keys = Object.keys(legacyMix);
    let totPct = 0;
    const nums = keys.map((k) => ({ k, n: Number(legacyMix[k]) || 0 }));
    for (const { n } of nums) totPct += n;
    nums.forEach(({ k, n }) => {
      if (!(n > 0)) return;
      const slug = cardMixRowDisplayId(null, 0, k) || slugifyCardOrKey(k) || 'unknown';
      const sourceLabel = String(cardBrandMixRowHumanLabel(null, 0, k) || k).trim();
      const vol = totalVol > 0 && totPct > 0.01 ? (n / totPct) * totalVol : 0;
      const ex = bySlug.get(slug);
      if (ex) {
        ex.vol += vol;
        ex.pctShare += n;
      } else {
        bySlug.set(slug, { vol, pctShare: n, sourceLabel, origKey: k });
      }
    });
    const sorted = [...bySlug.entries()].sort((a, b) => b[1].vol - a[1].vol);
    sorted.forEach(([slug, { vol, pctShare, sourceLabel }], i) => {
      if (!(slugMap[slug] != null && String(slugMap[slug]).trim() !== '') && sourceLabel) {
        slugDisplayAdditions[slug] = sourceLabel;
      }
      const pct = totPct > 0.01 ? Math.round((pctShare / totPct) * 100) : Math.round(pctShare);
      const displayLabel = displayLabelForCardSlug(slug, sourceLabel, slugMap);
      brandBars.push({
        slug,
        displayLabel,
        label: displayLabel,
        sourceLabel,
        pct,
        color: palette[i % palette.length],
        vol,
      });
    });
    if (brandBars.length) cardMixKind = 'legacy';
  }

  return { brandBars, cardMixKind, posLineCardMix, slugDisplayAdditions };
}

/**
 * @param {object|null|undefined} pos result of {@link extractPosDataForUi}
 * @param {string} ccy
 * @returns {StatementUiStripRow[]}
 */
function buildFromStatementStripRows(pos, ccy) {
  /** @type {StatementUiStripRow[]} */
  const fromStatement = [];

  const s = pos?.summary;
  if (s?.posGross != null) {
    fromStatement.push({
      id: 'pos-gross',
      label: 'POS gross (orders)',
      value: formatMoney(s.posGross, ccy),
      hint: 'Σ line amounts · header map on POS transactions',
    });
  }
  if (s?.totalFees != null && s.totalFees > 0.005) {
    fromStatement.push({
      id: 'pos-line-fees',
      label: 'POS processing fees (non-cash lines)',
      value: formatMoney(s.totalFees, ccy),
      hint: 'Shown under Fees / channel totals where applicable',
    });
  }
  if (s?.totalAfterFees != null) {
    fromStatement.push({
      id: 'pos-net',
      label: 'POS after card fees',
      value: formatMoney(s.totalAfterFees, ccy),
      hint: 'Gross − fees on non-cash rows',
    });
  }

  const sb = pos?.spotlightAnalysis?.spotlightBatch;
  if (sb && sb.commission != null && Number.isFinite(sb.commission) && sb.impliedPct != null) {
    const idLab = sb.orderOrTxnId ?? sb.batchId;
    const idStr = idLab != null && String(idLab).trim() ? String(idLab).trim() : null;
    fromStatement.push({
      id: 'pos-top-fee',
      label: 'Largest POS fee (batch or line)',
      value: formatMoney(sb.commission, ccy),
      hint: [sb.impliedPct != null ? `${sb.impliedPct.toFixed(2)}% effective` : null, idStr ? `· ${idStr}` : null]
        .filter(Boolean)
        .join(' '),
    });
  }

  return fromStatement;
}

/**
 * @param {object|null|undefined} parsedData
 * @returns {null | {
 *   currency: string,
 *   parsedData: object,
 *   pos: ReturnType<typeof extractPosDataForUi>,
 *   fromStatement: StatementUiStripRow[],
 *   posLineCardMix: ReturnType<typeof buildPosOrderLineTenderVolumeMix>,
 *   channelCardMix: ReturnType<typeof buildChannelTabCardMixDisplay>,
 *   cardSlugDisplayMap: Record<string, string>,
 * }}
 */
export function buildStatementClientModel(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;

  const pd0 = finalizeParsedForClient(parsedData);
  const ccy = getStatementDisplayCurrency(pd0);
  const pos = extractPosDataForUi(pd0);
  const totalVol = Number(overviewPrimarySalesVolumeGross(pd0)) || 0;
  const fromStatement = buildFromStatementStripRows(pos, ccy);

  const baseSlugMap =
    pd0.channel_card_display_slug_map && typeof pd0.channel_card_display_slug_map === 'object' && !Array.isArray(pd0.channel_card_display_slug_map)
      ? { ...pd0.channel_card_display_slug_map }
      : {};

  const posLineDraft = buildPosOrderLineTenderVolumeMix(pd0, baseSlugMap);
  const channelCardMixDraft = buildChannelTabCardMixDisplay({
    parsedData: pd0,
    totalVol,
    posLineCardMix: posLineDraft,
    slugMap: baseSlugMap,
  });
  const pd1 = mergeChannelCardSlugMap(pd0, channelCardMixDraft.slugDisplayAdditions);
  const finalSlugMap =
    pd1.channel_card_display_slug_map && typeof pd1.channel_card_display_slug_map === 'object' && !Array.isArray(pd1.channel_card_display_slug_map)
      ? { ...pd1.channel_card_display_slug_map }
      : {};

  const posLineCardMix = buildPosOrderLineTenderVolumeMix(pd1, finalSlugMap);
  const channelCardMix = buildChannelTabCardMixDisplay({
    parsedData: pd1,
    totalVol,
    posLineCardMix,
    slugMap: finalSlugMap,
  });

  return {
    currency: ccy,
    parsedData: pd1,
    pos,
    fromStatement,
    posLineCardMix,
    channelCardMix,
    cardSlugDisplayMap: finalSlugMap,
  };
}
