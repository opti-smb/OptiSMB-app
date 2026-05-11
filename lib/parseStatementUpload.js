/**
 * Shared client pipeline: POST /api/parse → unwrap → finalize → XLSX augment → normalized parsed payload.
 * Used by single-file upload and linked POS + e‑commerce + bank flows.
 *
 * Intended data flow (document-intel / UI contract):
 * 1. **Raw** — Parser preserves tables/lines (`raw_extracted`, grids); never drop on finalize.
 * 2. **Semantic map** — Columns bound to canonical roles (Python parser + client `heading_role_aliases` + built-in rules in `lib/statementHeadingRoleMap.js` + scored headers in XLSX augment).
 * 3. **Derive** — `finalizeParsedForClient` reconciles scalars only when necessary (see currencyConversion).
 * 4. **Display** — Report/dashboard read canonical fields + `fee_totals_by_slug` / `fee_slug_labels` for extra fee buckets + show parse_issues when mapping is weak.
 */

import { getStatementDisplayCurrency } from '@/lib/currencyConversion';
import { finalizeParsedForClient } from '@/lib/statementFinalize';
import { syncParsedDataVolumeScalars } from '@/lib/statementVolumeSync';
import { unwrapParserPayload } from '@/lib/parserPayload';
import { getStatementUploadKindFromFile, normalizeStatementFileType, getUploadFileKindDescription } from '@/lib/utils';
import { demoParsedFallback } from '@/lib/mockData';
import { PLEASE_UPLOAD_PROPER_BANK_STATEMENT } from '@/lib/statementUploadMessages';
import { applyFormatCompatibilityLayer } from '@/lib/statementFormatValidation';

/**
 * @param {File} file
 * @returns {Promise<
 *   | {
 *       ok: true;
 *       parsedDataForStmt: object;
 *       finalData: object;
 *       apiResult: object | null;
 *       isDemo: boolean;
 *       parseMethod: string;
 *       fileTypeNorm: string;
 *       uploadKindDescription: string;
 *       ccy: string;
 *       demoReason: string | null;
 *     }
 *   | { ok: false; error: string; apiResult?: object | null }
 * >}
 */
export async function parseStatementUploadFile(file) {
  try {
    if (getStatementUploadKindFromFile(file.name, file.type) === 'unknown') {
      return {
        ok: false,
        error: PLEASE_UPLOAD_PROPER_BANK_STATEMENT,
        apiResult: {
          success: false,
          reason: 'unsupported_file_kind',
          message: 'Unsupported file type for statement intake.',
        },
      };
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('fileName', file.name);
    formData.append('fileType', file.type);
    formData.append('currency', 'AUTO');

    const res = await fetch('/api/parse', { method: 'POST', body: formData });
    const apiResult = await res.json().catch(() => null);

    const hardRejectReasons = new Set(['not_statement', 'unsupported_type', 'unsupported_file_kind']);
    const reason = apiResult?.reason;
    if (!apiResult?.success && reason && hardRejectReasons.has(reason)) {
      return {
        ok: false,
        error: PLEASE_UPLOAD_PROPER_BANK_STATEMENT,
        apiResult,
      };
    }

    let finalData;
    let parseMethod = 'demo';
    let isDemo = false;
    let demoReason = null;

    if (apiResult?.success && apiResult?.data) {
      finalData = finalizeParsedForClient(unwrapParserPayload(apiResult.data));
      parseMethod = apiResult.method || apiResult.parser || 'python';
    } else {
      isDemo = true;
      finalData = finalizeParsedForClient({ ...demoParsedFallback });
      demoReason = apiResult?.reason ?? 'parse_failed';
    }

    const { augmentParsedDataWithPosBatchesFromXlsxIfNeeded } = await import('@/lib/augmentPosBatchesFromXlsx');
    finalData = await augmentParsedDataWithPosBatchesFromXlsxIfNeeded(file, finalData);

    if (!finalData.golden_reconciliation_workbook && /\.(xlsx|xls|csv)$/i.test(String(file.name || ''))) {
      try {
        const buf = await file.arrayBuffer();
        const goldenModule = await import('@/lib/reconciliationGoldenWorkbook.js');
        let golden = null;
        if (/\.csv$/i.test(String(file.name || ''))) {
          const text = new TextDecoder('utf-8').decode(buf);
          golden = goldenModule.tryParseGoldenReconciliationCsvText(text);
        } else {
          golden = goldenModule.tryParseGoldenReconciliationWorkbookBuffer(new Uint8Array(buf));
        }
        if (golden?.golden_reconciliation_workbook) {
          finalData = { ...finalData, ...golden };
        }
      } catch {
        /* noop */
      }
    }

    finalData = syncParsedDataVolumeScalars(finalData);
    finalData = applyFormatCompatibilityLayer(finalData);

    const fileTypeNorm = normalizeStatementFileType(finalData.file_type ?? null, file.name, file.type);
    finalData = { ...finalData, file_type: fileTypeNorm };

    const workbookRolesPatch =
      Array.isArray(finalData.workbook_sheet_roles) && finalData.workbook_sheet_roles.length > 0
        ? { workbook_sheet_roles: finalData.workbook_sheet_roles }
        : {};

    const posBatchPatch =
      Array.isArray(finalData.pos_settlement_batches) && finalData.pos_settlement_batches.length > 0
        ? {
            pos_settlement_batches: finalData.pos_settlement_batches,
            pos_settlement_batch_count:
              finalData.pos_settlement_batch_count ?? finalData.pos_settlement_batches.length,
          }
        : {};

    const parsedDataForStmt = {
      ...finalData,
      file_type: fileTypeNorm,
      fee_lines: Array.isArray(finalData.fee_lines) ? finalData.fee_lines : [],
      ...workbookRolesPatch,
      ...posBatchPatch,
    };

    const uploadKindDescription = getUploadFileKindDescription(parsedDataForStmt, file.name);
    const ccy = getStatementDisplayCurrency(finalData);

    return {
      ok: true,
      parsedDataForStmt,
      finalData,
      apiResult,
      isDemo,
      parseMethod,
      fileTypeNorm,
      uploadKindDescription,
      ccy,
      demoReason: isDemo ? demoReason : null,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
