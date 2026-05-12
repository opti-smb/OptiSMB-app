'use client';
import { useState, useRef, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import * as Icon from '@/components/Icons';
import { Btn, Card, Disclaimer } from '@/components/UI';
import { StatementParseLoading } from '@/components/StatementParseLoading';
import { useApp } from '@/components/AppContext';
import { useToast } from '@/components/Toast';
import { tierOk, normalizeStatementFileType, getUploadFileKindDescription, overviewPrimarySalesVolumeGross } from '@/lib/utils';
import { finalizeParsedForClient } from '@/lib/statementFinalize';
import { getStatementDisplayCurrency, formatMoney } from '@/lib/currencyConversion';
import { parseStatementUploadFile } from '@/lib/parseStatementUpload';
import { mergeLinkedStatementUploads } from '@/lib/mergeLinkedStatementUploads';
import { inferStatementRole, readWorkbookSheetNamesFromFile, resolveRoleWhenSlotTaken, statementCategoryUploadedLabel } from '@/lib/inferStatementFileRole';
import {
  PLEASE_UPLOAD_PROPER_BANK_STATEMENT,
  PAYMENT_FILE_INPUT_ACCEPT,
  handleParseDemoOutcome,
  validateUploadFile,
} from '@/lib/statementUploadGate';
import { buildStatementClientModel } from '@/lib/statementClientModel';

/** Detach parser output from any shared buffers the next upload may overwrite. */
function cloneJsonUpload(obj) {
  if (obj == null || typeof obj !== 'object') return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}

/** @typedef {{ fileName: string; fileSizeBytes: number; parsedData: object; isDemo: boolean; parseMethod: string; extractionRatio: number | null; inferenceConfidence: string; inferenceReasons: string[]; inferenceScores: { pos: number; ecommerce: number; bank: number; reconciliation: number } }} LinkedPart */

const ROLE_SLOTS = [
  { key: 'pos', title: '1 · POS / in-store', hint: 'Square, Clover, terminal, in-store card sales.' },
  { key: 'ecommerce', title: '2 · E-commerce / online', hint: 'Shopify, Stripe, web orders, CNP.' },
  { key: 'bank', title: '3 · Bank statement', hint: 'Business checking — where deposits land.' },
  {
    key: 'reconciliation',
    title: '4 · Reconciliation workbook (optional)',
    hint: 'Cross-channel report with expected inflows vs actual bank credits and variance (e.g. 04_Reconciliation_Report).',
  },
];

/** Parser returned JSON, but field coverage / consistency suggests numbers may be wrong on unfamiliar layouts. */
function liveParseLooksUnreliable(parsedResult) {
  if (!parsedResult || parsedResult.source !== 'live') return false;
  if (parsedResult.parsingConfidence === 'low') return true;
  const er = parsedResult.extractionRatio != null ? Number(parsedResult.extractionRatio) : null;
  const erNorm = er != null && Number.isFinite(er) ? (er > 1 ? er / 100 : er) : null;
  if (erNorm != null && erNorm < 0.4) return true;
  const issues = parsedResult.parsedData?.parse_issues;
  if (!Array.isArray(issues) || issues.length === 0) return false;
  if (issues.length >= 2) return true;
  const risky = new Set([
    'extraction_empty_or_weak',
    'critical_volume_inconsistent',
    'ocr_confidence_low',
    'fee_component_mismatch_total_fees',
    'fees_exceed_total_volume',
    'formula_net_from_gross_minus_fees',
    'formula_channel_sum_vs_gross',
    'formula_expected_deposits_vs_bank',
    'tabular_pos_semantic_map_failed',
    'tabular_pos_semantic_map_low_confidence',
    'tabular_pos_card_mix_unverified',
  ]);
  return issues.some((x) => risky.has(String(x)) || String(x).startsWith('formula_'));
}

export default function UploadPage() {
  const [uploadFlow, setUploadFlow] = useState('single');
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const parsingRef = useRef(false);
  const [isDrag, setIsDrag] = useState(false);
  const [parsedResult, setParsedResult] = useState(null);
  const [parseError, setParseError] = useState(null);
  const fileInputRef = useRef(null);
  /** Mirrors `file` so save uses the actual File name/size even if React state lags one frame */
  const fileRef = useRef(null);
  useEffect(() => {
    fileRef.current = file;
  }, [file]);

  const [linkedParts, setLinkedParts] = useState(
    /** @type {{ pos: LinkedPart | null; ecommerce: LinkedPart | null; bank: LinkedPart | null; reconciliation: LinkedPart | null }} */ ({
      pos: null,
      ecommerce: null,
      bank: null,
      reconciliation: null,
    }),
  );
  const [linkedLoadingFile, setLinkedLoadingFile] = useState(/** @type {string | null} */ (null));
  const linkedInputAny = useRef(null);

  const { user, addStatement } = useApp();
  const { addToast } = useToast();
  const router = useRouter();

  const processFile = async (f) => {
    if (!validateUploadFile(f, user, addToast)) return;
    if (parsingRef.current) return;
    parsingRef.current = true;
    setFile(f);
    setStep(1);
    setParseError(null);

    try {
      const r = await parseStatementUploadFile(f);
      if (!r.ok) {
        addToast({
          type: 'error',
          title: 'Not a statement',
          message: r.error || PLEASE_UPLOAD_PROPER_BANK_STATEMENT,
        });
        setStep(0);
        return;
      }

      if (r.isDemo) {
        if (handleParseDemoOutcome(r.apiResult, r.demoReason, addToast) === 'abort') {
          setStep(0);
          setFile(null);
          return;
        }
      }

      const now = new Date();
      const uploadDate = now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
      const { parsedDataForStmt: rawPdForStmt, finalData, apiResult, isDemo, parseMethod, fileTypeNorm, uploadKindDescription, ccy } = r;
      const parsedDataForStmt = cloneJsonUpload(rawPdForStmt) ?? rawPdForStmt;

      const sheetNames = await readWorkbookSheetNamesFromFile(f);
      const roleInf = inferStatementRole({
        fileName: f.name,
        sheetNames,
        parsedData: parsedDataForStmt,
      });
      const statementCategory = roleInf.statementCategory;

      const stmt = {
        fileName: f.name,
        fileSizeBytes: typeof f.size === 'number' && f.size >= 0 ? f.size : 0,
        fileType: fileTypeNorm,
        statementCategory,
        acquirer: finalData.acquirer_name || 'Unknown Acquirer',
        period: finalData.billing_period
          ? new Date(finalData.billing_period.to).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
          : now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        uploadDate,
        status: finalData.parsing_confidence === 'low' ? 'Reviewing' : 'Parsed',
        parsingConfidence: finalData.parsing_confidence || (isDemo ? 'medium' : 'high'),
        rateConfidence: 'medium',
        dataAsOf: uploadDate,
        source: apiResult?.success ? 'live' : 'demo',
        parseMethod,
        parseFailureReason: isDemo ? (apiResult?.reason ?? null) : null,
        parseFailureMessage: isDemo ? (apiResult?.message ?? null) : null,
        extractionRatio: apiResult?.success ? (apiResult?.extraction_ratio ?? null) : null,
        uploadKindDescription,
        parsedData: parsedDataForStmt,
        discrepancies: [],
        benchmarks: [],
        rateTrend: null,
      };

      setParsedResult(stmt);
      setStep(2);

      if (apiResult?.success) {
        const volPd = finalizeParsedForClient(stmt.parsedData);
        const vol = overviewPrimarySalesVolumeGross(volPd);
        const volStr =
          vol != null && Number.isFinite(Number(vol)) && Number(vol) > 0 ? formatMoney(Number(vol), ccy) : '—';
        addToast({
          type: 'success',
          title: statementCategoryUploadedLabel(statementCategory),
          message: `${volStr} (${ccy}). ${uploadKindDescription}`,
        });
      }

      if (stmt.parsingConfidence === 'low') {
        addToast({
          type: 'info',
          title: 'Under human review',
          message: 'Document confidence is low. Our team will verify this analysis within 4 business hours.',
        });
      }
    } catch (err) {
      setParseError(String(err));
      setStep(0);
      addToast({ type: 'error', title: 'Upload failed', message: 'Please try again or contact support.' });
    } finally {
      parsingRef.current = false;
    }
  };

  const parseAndClassifyLinkedFile = async (f) => {
    if (!validateUploadFile(f, user, addToast)) return;
    if (parsingRef.current) return;
    parsingRef.current = true;
    setLinkedLoadingFile(f.name);
    try {
      const sheetNames = await readWorkbookSheetNamesFromFile(f);
      const r = await parseStatementUploadFile(f);
      if (!r.ok) {
        addToast({
          type: 'error',
          title: 'Not a statement',
          message: r.error || PLEASE_UPLOAD_PROPER_BANK_STATEMENT,
        });
        return;
      }
      if (r.isDemo) {
        if (handleParseDemoOutcome(r.apiResult, r.demoReason, addToast) === 'abort') {
          return;
        }
      }

      const pdForSlot = cloneJsonUpload(r.parsedDataForStmt) ?? r.parsedDataForStmt;
      const inf = inferStatementRole({
        fileName: f.name,
        sheetNames,
        parsedData: pdForSlot,
      });

      const maxScore = Math.max(
        inf.scores.pos,
        inf.scores.ecommerce,
        inf.scores.bank,
        inf.scores.reconciliation,
      );
      const outcome = {
        role: inf.role,
        replacedPrev: /** @type {string | null} */ (null),
        slotAdjusted: false,
      };

      setLinkedParts((prev) => {
        let useRole = inf.role;
        if (inf.confidence === 'low' && maxScore < 4) {
          const alt = resolveRoleWhenSlotTaken(prev, inf.role);
          if (alt !== useRole) {
            useRole = alt;
            outcome.slotAdjusted = alt !== inf.role;
          }
        }

        const had = prev[useRole];
        const part = {
          fileName: f.name,
          fileSizeBytes: typeof f.size === 'number' && f.size >= 0 ? f.size : 0,
          parsedData: pdForSlot,
          isDemo: r.isDemo,
          parseMethod: r.parseMethod,
          extractionRatio: r.apiResult?.success ? (r.apiResult?.extraction_ratio ?? null) : null,
          inferenceConfidence: inf.confidence,
          inferenceReasons: inf.reasons,
          inferenceScores: inf.scores,
        };
        if (had) {
          outcome.replacedPrev = had.fileName;
        }
        outcome.role = useRole;
        return { ...prev, [useRole]: part };
      });

      if (outcome.slotAdjusted) {
        addToast({
          type: 'info',
          title: 'Ambiguous file',
          message: `Low signal for “${f.name}”; placed in the ${outcome.role} slot first. Use Move to… if that is wrong.`,
        });
      }

      const label =
        outcome.role === 'pos'
          ? 'POS / in-store'
          : outcome.role === 'ecommerce'
            ? 'E-commerce / online'
            : outcome.role === 'reconciliation'
              ? 'Reconciliation workbook'
              : 'Bank statement';
      if (outcome.replacedPrev) {
        addToast({
          type: 'info',
          title: `Replacing ${label} file`,
          message: `Previous: ${outcome.replacedPrev} → now: ${f.name}`,
        });
      }

      addToast({
        type: r.apiResult?.success ? 'success' : 'info',
        title: statementCategoryUploadedLabel(inf.statementCategory),
        message: `${f.name} · ${inf.confidence} confidence${inf.reasons.length ? ` (${inf.reasons.slice(0, 2).join(' · ')})` : ''}`,
      });
    } finally {
      setLinkedLoadingFile(null);
      parsingRef.current = false;
    }
  };

  const clearLinkedSlot = (role) => {
    setLinkedParts((prev) => ({ ...prev, [role]: null }));
  };

  const reassignLinkedRole = (fromRole, toRole) => {
    if (fromRole === toRole) return;
    setLinkedParts((prev) => {
      const a = prev[fromRole];
      const b = prev[toRole];
      if (!a) return prev;
      return { ...prev, [fromRole]: b ?? null, [toRole]: a };
    });
  };

  const buildCombinedLinkedStatement = () => {
    const { pos, ecommerce, bank, reconciliation } = linkedParts;
    if (!pos || !ecommerce || !bank) {
      addToast({ type: 'error', title: 'Need three files', message: 'Upload POS, e-commerce, and bank files before combining.' });
      return;
    }
    let mergedPd;
    try {
      mergedPd = mergeLinkedStatementUploads({
        pos: { fileName: pos.fileName, parsedData: pos.parsedData },
        ecommerce: { fileName: ecommerce.fileName, parsedData: ecommerce.parsedData },
        bank: { fileName: bank.fileName, parsedData: bank.parsedData },
        ...(reconciliation
          ? { reconciliation: { fileName: reconciliation.fileName, parsedData: reconciliation.parsedData } }
          : {}),
      });
      mergedPd = cloneJsonUpload(mergedPd) ?? mergedPd;
    } catch (e) {
      addToast({ type: 'error', title: 'Could not merge', message: String(e) });
      return;
    }

    const now = new Date();
    const uploadDate = now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
    const ccy = getStatementDisplayCurrency(mergedPd);
    const period = mergedPd.billing_period
      ? new Date(mergedPd.billing_period.to).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      : now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const anyLive = !pos.isDemo || !ecommerce.isDemo || !bank.isDemo || (reconciliation && !reconciliation.isDemo);
    const fileLabel = `Combined — ${period}`;
    const uploadKindDescription = getUploadFileKindDescription(mergedPd, fileLabel);

    const linkedBytes =
      (pos.fileSizeBytes || 0) +
      (ecommerce.fileSizeBytes || 0) +
      (bank.fileSizeBytes || 0) +
      (reconciliation?.fileSizeBytes || 0);

    const stmt = {
      fileName: fileLabel,
      fileSizeBytes: linkedBytes,
      fileType: normalizeStatementFileType(mergedPd.file_type ?? null, fileLabel, ''),
      statementCategory: 'triple_set',
      acquirer: mergedPd.acquirer_name || 'Combined',
      period,
      uploadDate,
      status: 'Parsed',
      parsingConfidence: 'high',
      rateConfidence: 'medium',
      dataAsOf: uploadDate,
      source: anyLive ? 'live' : 'demo',
      parseMethod: 'linked-merge',
      parseFailureReason: anyLive ? null : 'linked_partial_demo',
      parseFailureMessage: anyLive ? null : 'One or more linked files used demo data.',
      extractionRatio: null,
      uploadKindDescription,
      parsedData: mergedPd,
      discrepancies: [],
      benchmarks: [],
      rateTrend: null,
      linkedSourceFiles: [pos.fileName, ecommerce.fileName, bank.fileName, ...(reconciliation ? [reconciliation.fileName] : [])],
    };

    setParsedResult(stmt);
    setStep(2);
    setFile(null);
    addToast({
      type: 'success',
      title: 'Combined report ready',
      message: `${formatMoney(Number(overviewPrimarySalesVolumeGross(mergedPd)) || 0, ccy)} (${ccy}) · ${uploadKindDescription}`,
    });
  };

  const handleFileSelect = (f) => {
    if (!validateUploadFile(f, user, addToast)) return;
    processFile(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDrag(false);
    const f = e.dataTransfer.files[0];
    handleFileSelect(f);
  };

  const openReport = async () => {
    if (!parsedResult) return;
    const f = fileRef.current;
    const m = buildStatementClientModel(parsedResult.parsedData);
    const chosenName =
      (typeof f?.name === 'string' && f.name.trim()) ||
      (typeof parsedResult.fileName === 'string' && parsedResult.fileName.trim()) ||
      'statement';
    const chosenBytes =
      typeof f?.size === 'number' && f.size >= 0 ? f.size : Number(parsedResult.fileSizeBytes) || 0;

    let fileSha256;
    try {
      if (f && !parsedResult.linkedSourceFiles?.length && globalThis.crypto?.subtle) {
        const buf = await f.arrayBuffer();
        const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', buf);
        fileSha256 = Array.from(new Uint8Array(hashBuffer))
          .map((x) => x.toString(16).padStart(2, '0'))
          .join('');
      }
    } catch {
      /* optional hash for server dedup */
    }

    const payload = JSON.parse(
      JSON.stringify({
        ...parsedResult,
        fileName: chosenName,
        fileSizeBytes: chosenBytes,
        ...(fileSha256 ? { fileSha256 } : {}),
        parsedData: m?.parsedData ?? parsedResult.parsedData,
      }),
    );
    const save = await addStatement(payload);
    if (save.duplicate) {
      addToast({
        type: 'info',
        title: 'Already saved in your account',
        message:
          'The server found the same file or the same acquirer and billing period in your database. You are viewing the existing saved statement.',
      });
    } else if (!save.savedToServer) {
      addToast({
        type: 'warning',
        title: 'Not saved to your account',
        message:
          save.message ||
          'Sign in again from the login page so statements persist to the database.',
      });
      return;
    }
    router.push('/report');
  };

  const resetLinked = () => {
    setLinkedParts({ pos: null, ecommerce: null, bank: null, reconciliation: null });
  };

  const switchFlow = (flow) => {
    setUploadFlow(flow);
    setStep(0);
    setFile(null);
    setParsedResult(null);
    resetLinked();
  };

  const STEPPER_SINGLE = ['01 Select file', '02 Parsing', '03 Review & open'];
  const STEPPER_LINKED = ['01 Add files (any order)', '02 Detect & extract', '03 Combine & open'];

  const reviewCcy = parsedResult ? getStatementDisplayCurrency(parsedResult.parsedData) : 'USD';
  const reviewPdFin = parsedResult?.parsedData ? finalizeParsedForClient(parsedResult.parsedData) : null;
  const reviewVol = reviewPdFin != null ? overviewPrimarySalesVolumeGross(reviewPdFin) : null;
  const reviewVolStr =
    reviewVol != null && Number.isFinite(Number(reviewVol)) && Number(reviewVol) > 0
      ? formatMoney(Number(reviewVol), reviewCcy)
      : '—';

  const reviewUnreliableLive =
    parsedResult?.source === 'live' && liveParseLooksUnreliable(parsedResult);
  const reviewCautionIcon =
    !!parsedResult &&
    (parsedResult.source !== 'live' ||
      parsedResult.parsingConfidence === 'low' ||
      reviewUnreliableLive);

  const reviewStatementModel = useMemo(
    () => (parsedResult?.parsedData ? buildStatementClientModel(parsedResult.parsedData) : null),
    [parsedResult?.parsedData],
  );

  const handleLinkedDrop = async (e) => {
    e.preventDefault();
    setIsDrag(false);
    const list = e.dataTransfer.files;
    if (!list?.length) return;
    for (let i = 0; i < list.length; i++) {
      await parseAndClassifyLinkedFile(list[i]);
    }
  };

  const linkedReady = linkedParts.pos && linkedParts.ecommerce && linkedParts.bank;

  return (
    <div className="space-y-6">
      <div>
        <div className="smallcaps text-ink-400 mb-2">Upload</div>
        <h1 className="font-serif text-5xl leading-tight">Drop a statement. <em className="text-teal">We'll read it.</em></h1>
        <p className="text-ink-500 text-[14px] mt-2 max-w-xl">
          One combined workbook, or three separate files (POS, online sales, bank) we merge into one report.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => switchFlow('single')}
          className={`h-9 px-4 rounded-full text-[12px] border transition ${
            uploadFlow === 'single' ? 'bg-ink text-cream border-ink' : 'hair text-ink-500 hover:bg-ink/5'
          }`}
        >
          Single file
        </button>
        <button
          type="button"
          onClick={() => switchFlow('linked')}
          className={`h-9 px-4 rounded-full text-[12px] border transition ${
            uploadFlow === 'linked' ? 'bg-ink text-cream border-ink' : 'hair text-ink-500 hover:bg-ink/5'
          }`}
        >
          Link POS + e-commerce + bank
        </button>
      </div>

      <div className="flex items-center gap-4 text-[12px] font-mono text-ink-400 flex-wrap">
        {(uploadFlow === 'single' ? STEPPER_SINGLE : STEPPER_LINKED).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <span className={`dot ${step > i ? 'bg-teal' : step === i ? 'bg-teal-bright pulse-ring' : 'bg-ink/20'}`} />
            <span className={step >= i ? 'text-ink' : ''}>{s}</span>
            {i < 2 && <span className="w-8 hair-t hidden sm:block" />}
          </div>
        ))}
      </div>

      {uploadFlow === 'linked' && step === 0 && (
        <Disclaimer tone="info">
          Add your three required files in <span className="font-medium text-ink-600">any order</span> (or drop many at once). Use payment-related PDF, CSV, Excel, or clear scans only (see accepted types on the uploader). Optionally add a{' '}
          <span className="font-medium text-ink-600">reconciliation workbook</span> (expected inflows vs actual bank credits). We detect POS, e-commerce, bank, or reconciliation from the name, tabs, and parsed fields.
        </Disclaimer>
      )}

      {uploadFlow === 'single' && step === 0 && (
        <Card className="p-2">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDrag(true);
            }}
            onDragLeave={() => setIsDrag(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-12 text-center transition ${isDrag ? 'border-teal bg-teal-dim/30' : 'hair bg-cream-100'}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={PAYMENT_FILE_INPUT_ACCEPT}
              onChange={(e) => handleFileSelect(e.target.files?.[0])}
            />
            <div className="w-14 h-14 mx-auto rounded-full bg-ink text-cream flex items-center justify-center mb-5">
              <Icon.Upload size={22} />
            </div>
            <h3 className="font-serif text-3xl leading-tight">Drag & drop your statement</h3>
            <p className="text-ink-500 text-[13px] mt-2">
              PDF, CSV, Excel, payment scans (JPEG, PNG, WebP, TIFF, …) · payment-related files only · up to 50MB
              {tierOk(user.tier, 'L2') ? ' · Bulk upload' : ''}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Btn variant="primary" icon={<Icon.Upload size={14} />} onClick={() => fileInputRef.current?.click()}>
                Choose file
              </Btn>
              <Btn
                variant="ghost"
                onClick={() => processFile(new File(['demo'], 'worldpay-mar26.pdf', { type: 'application/pdf' }))}
              >
                Use demo statement
              </Btn>
            </div>
            <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] text-ink-400 font-mono max-w-md mx-auto">
              {['AES-256 ENCRYPTED', 'US DATA RESIDENCY', 'AI PARSED <60s', 'DELETABLE ANYTIME'].map((t) => (
                <div key={t} className="flex items-center gap-1.5">
                  <Icon.Shield size={10} />
                  {t}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {uploadFlow === 'linked' && step === 0 && (
        <div className="space-y-4">
          <Card className="p-2">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDrag(true);
              }}
              onDragLeave={() => setIsDrag(false)}
              onDrop={handleLinkedDrop}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition ${isDrag ? 'border-teal bg-teal-dim/30' : 'hair bg-cream-100'}`}
            >
              <input
                ref={linkedInputAny}
                type="file"
                multiple
                className="hidden"
                accept={PAYMENT_FILE_INPUT_ACCEPT}
                onChange={async (e) => {
                  const files = e.target.files ? [...e.target.files] : [];
                  e.target.value = '';
                  for (const f of files) {
                    await parseAndClassifyLinkedFile(f);
                  }
                }}
              />
              {linkedLoadingFile ? (
                <p className="text-[13px] text-teal font-medium py-4">Extracting {linkedLoadingFile}…</p>
              ) : (
                <>
                  <div className="w-12 h-12 mx-auto rounded-full bg-ink text-cream flex items-center justify-center mb-4">
                    <Icon.Upload size={20} />
                  </div>
                  <h3 className="font-serif text-2xl leading-tight">Drop files here or choose one or many</h3>
                  <p className="text-ink-500 text-[12px] mt-2 max-w-md mx-auto">
                    We classify each upload (e.g. Square → POS, Shopify → e-commerce, bank statement → bank), then show the link below.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <Btn variant="primary" size="sm" icon={<Icon.Upload size={14} />} onClick={() => linkedInputAny.current?.click()}>
                      Choose file(s)
                    </Btn>
                  </div>
                </>
              )}
            </div>
          </Card>

          <div className="space-y-2">
            <div className="text-[11px] text-ink-400 smallcaps tracking-wide">Linked for your combined report</div>
            {ROLE_SLOTS.map(({ key, title, hint }) => {
              const role = /** @type {'pos'|'ecommerce'|'bank'|'reconciliation'} */ (key);
              const part = linkedParts[role];
              return (
                <Card key={role} className="p-4">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm">{title}</div>
                      <p className="text-[11px] text-ink-500 mt-0.5">{hint}</p>
                      {part ? (
                        <>
                          <div className="font-mono text-[12px] text-ink mt-2 truncate" title={part.fileName}>
                            {part.fileName}
                          </div>
                          <div className="text-[11px] text-ink-500 mt-1 leading-relaxed">
                            <span className="font-medium text-ink-600">{part.inferenceConfidence}</span>
                            {part.inferenceReasons?.length ? ` · ${part.inferenceReasons.slice(0, 5).join(' · ')}` : null}
                          </div>
                        </>
                      ) : (
                        <div className="text-[12px] text-ink-400 mt-2">Waiting for a file…</div>
                      )}
                    </div>
                    {part ? (
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <span className="text-[11px] text-ink-400">Move to</span>
                        <select
                          key={part.fileName}
                          className="text-[12px] border rounded-lg px-2 py-1.5 hair bg-cream min-w-[10rem]"
                          defaultValue=""
                          aria-label={`Move ${part.fileName} to another slot`}
                          onChange={(e) => {
                            const to = e.target.value;
                            e.target.value = '';
                            if (to && to !== role) reassignLinkedRole(role, to);
                          }}
                        >
                          <option value="">Slot…</option>
                          {['pos', 'ecommerce', 'bank', 'reconciliation']
                            .filter((k) => k !== role)
                            .map((k) => (
                              <option key={k} value={k}>
                                {k === 'pos'
                                  ? 'POS / in-store'
                                  : k === 'ecommerce'
                                    ? 'E-commerce'
                                    : k === 'bank'
                                      ? 'Bank'
                                      : 'Reconciliation'}
                              </option>
                            ))}
                        </select>
                        <Btn variant="ghost" size="sm" onClick={() => clearLinkedSlot(role)}>
                          Remove
                        </Btn>
                      </div>
                    ) : null}
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Btn variant="primary" disabled={!linkedReady} onClick={buildCombinedLinkedStatement} icon={<Icon.LayoutDashboard size={14} />}>
              Create combined report
            </Btn>
            <Btn variant="ghost" onClick={resetLinked}>
              Clear all
            </Btn>
          </div>
        </div>
      )}

      {step === 1 && (
        <Card className="p-6 sm:p-10">
          <StatementParseLoading active fileName={file?.name} />
        </Card>
      )}

      {step === 2 && parsedResult && (
        <>
          <Card className="p-6 flex flex-wrap items-center gap-5">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                reviewCautionIcon ? 'bg-amber-soft' : 'bg-teal-dim'
              }`}
            >
              {reviewCautionIcon ? (
                <Icon.AlertTriangle className="text-amber" size={18} />
              ) : (
                <Icon.CircleCheck className="text-teal" size={18} />
              )}
            </div>
            <div className="flex-1 min-w-[260px]">
              <div className="text-sm font-medium">
                {parsedResult.parseMethod === 'linked-merge'
                  ? 'Combined from three linked files — open the full report below.'
                  : parsedResult.source !== 'live'
                    ? 'Sample report — not from this upload'
                    : parsedResult.parsingConfidence === 'low' || reviewUnreliableLive
                      ? 'Parsed from your file — verify totals (weak or inconsistent extraction)'
                      : 'Parsed successfully — from your file.'}
              </div>
              <div className="text-[12px] text-ink-500 mt-1 font-mono truncate max-w-xl" title={parsedResult.fileName}>
                {parsedResult.linkedSourceFiles?.length ? (
                  <>
                    Combined: {parsedResult.linkedSourceFiles.join(' · ')}
                  </>
                ) : (
                  <>File: {parsedResult.fileName}</>
                )}
              </div>
              {parsedResult.source === 'live' &&
              parsedResult.extractionRatio != null &&
              Number.isFinite(Number(parsedResult.extractionRatio)) ? (
                <div className="text-[11px] text-ink-400 mt-0.5">
                  Parser extraction:{' '}
                  {(() => {
                    const er = Number(parsedResult.extractionRatio);
                    const pct = er > 1 ? er : er * 100;
                    return `${pct.toFixed(0)}%`;
                  })()}{' '}
                  · {parsedResult.parseMethod || 'python'}
                </div>
              ) : null}
              {parsedResult.uploadKindDescription ? (
                <div className="text-[12px] text-ink-600 mt-1 leading-snug max-w-xl">{parsedResult.uploadKindDescription}</div>
              ) : null}
              {parsedResult.statementCategory === 'pos' &&
              !(Array.isArray(parsedResult.linkedSourceFiles) && parsedResult.linkedSourceFiles.length > 0) ? (
                <p className="text-[11px] text-ink-500 mt-2 max-w-xl leading-snug">
                  POS-only file: the report surfaces POS totals, fees, and card mix wherever this parse has data. Use{' '}
                  <span className="font-medium">Linked files</span> on Upload to combine POS + e-commerce + bank into one
                  report.
                </p>
              ) : null}
              <div className="text-[12px] text-ink-400 mt-1">
                {parsedResult.acquirer} · {parsedResult.period} · {reviewVolStr} volume ({reviewCcy}) · effective rate{' '}
                {parsedResult.parsedData?.effective_rate != null && Number.isFinite(Number(parsedResult.parsedData.effective_rate))
                  ? `${Number(parsedResult.parsedData.effective_rate).toFixed(2)}%`
                  : '—'}
              </div>
            </div>
            <Btn variant="primary" onClick={openReport} icon={<Icon.ArrowRight size={14} />}>
              Open report
            </Btn>
          </Card>

          {reviewStatementModel?.fromStatement?.length ? (
            <Card className="p-5 mt-4 border border-ink/10 bg-cream-100/20">
              <p className="smallcaps text-ink-400 mb-3 text-[10px]">One read — where POS amounts go in the report</p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-x-6">
                {reviewStatementModel.fromStatement.map((row) => (
                  <div key={row.id} className="min-w-0">
                    <dt className="text-[12px] text-ink-400 mb-0.5">{row.label}</dt>
                    <dd className="text-sm text-ink font-mono tabular-nums font-medium">{row.value}</dd>
                    {row.hint ? (
                      <dd className="text-[11px] text-ink-500 mt-1 leading-snug">{row.hint}</dd>
                    ) : null}
                  </div>
                ))}
              </dl>
            </Card>
          ) : null}

          {parsedResult.source === 'demo' && (
            <Disclaimer tone="warn">
              This preview uses sample data because live parsing did not return a result (parser unavailable, unsupported content, or network error). In production, configure the parser API URL for your host (e.g. STATEMENT_PARSER_URL on Vercel). Locally, run the Python service on port 8000. CSV uploads usually give the most reliable extraction.
            </Disclaimer>
          )}

          {parsedResult.source === 'live' &&
          typeof parsedResult.parsedData?.report_ui?.format_compatibility_notice === 'string' &&
          parsedResult.parsedData.report_ui.format_compatibility_notice.trim() ? (
            <Disclaimer tone="warn">
              <p className="font-medium text-ink-800 mb-1">Column map not verified for this layout</p>
              <p className="text-[13px] text-ink-600 leading-relaxed">{parsedResult.parsedData.report_ui.format_compatibility_notice.trim()}</p>
            </Disclaimer>
          ) : null}

          {parsedResult.source === 'live' && reviewUnreliableLive && (
            <Disclaimer tone="warn">
              <p className="font-medium text-ink-800 mb-1">Numbers may not match this statement</p>
              <p className="mb-2">
                The parser uses generic layouts and keywords. New processors or unusual PDFs often fill the wrong row or miss fields
                even when the upload “succeeds.” Prefer CSV/XLSX exports when your gateway offers them.
              </p>
              {parsedResult.extractionRatio != null && Number.isFinite(Number(parsedResult.extractionRatio)) ? (
                <p className="text-[12px] text-ink-600 mb-1">
                  Field coverage index:{' '}
                  {(() => {
                    const er = Number(parsedResult.extractionRatio);
                    const pct = er > 1 ? er : er * 100;
                    return `${pct.toFixed(0)}%`;
                  })()}
                  . When this index is <span className="font-medium text-ink-700">under about 40%</span>, headline totals
                  are often less trustworthy; higher values are generally better.
                </p>
              ) : null}
              {Array.isArray(parsedResult.parsedData?.parse_issues) && parsedResult.parsedData.parse_issues.length > 0 ? (
                <p className="text-[11px] font-mono text-ink-500 break-words">
                  Checks: {parsedResult.parsedData.parse_issues.slice(0, 12).join(' · ')}
                  {parsedResult.parsedData.parse_issues.length > 12 ? ' …' : ''}
                </p>
              ) : null}
              <p className="text-[11px] text-ink-500 mt-2">
                On the parser host you can try improved engines:{' '}
                <code className="bg-ink-100 px-1 rounded">OPTISMB_TABLE_ENGINE=scoring</code>,{' '}
                <code className="bg-ink-100 px-1 rounded">OPTISMB_PDF_ENGINE=v2</code>,{' '}
                <code className="bg-ink-100 px-1 rounded">OPTISMB_FORMULA_ENGINE=v2</code> (optional consistency hints).
              </p>
            </Disclaimer>
          )}

          <div className="flex gap-3">
            <Btn
              variant="ghost"
              onClick={() => {
                setStep(0);
                setFile(null);
                setParsedResult(null);
                if (uploadFlow === 'linked') resetLinked();
              }}
            >
              {uploadFlow === 'linked' ? 'Start over' : 'Upload another'}
            </Btn>
          </div>
        </>
      )}

      {step === 0 && (
        <div className="grid md:grid-cols-3 gap-4">
          {[
            {
              icon: <Icon.FileText size={18} />,
              label: 'PDF statements',
              desc: 'All tiers. Text-extractable PDFs parsed via AI. Scanned PDFs fall back to demo data in this release.',
              tier: null,
            },
            {
              icon: <Icon.Download size={18} />,
              label: 'CSV / XLSX',
              desc: 'All tiers. Best accuracy — structured data feeds directly into AI parsing. Full fee-line extraction.',
              tier: null,
            },
            {
              icon: <Icon.Sparkles size={18} />,
              label: 'JPG / PNG (OCR)',
              desc: 'Level 1+. Image statements processed via OCR. Confidence is typically 10–20% lower than digital formats.',
              tier: 'L1',
            },
          ].map((fc) => (
            <Card key={fc.label} className={`p-5 ${fc.tier && !tierOk(user.tier, fc.tier) ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-3 mb-2">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    fc.tier && !tierOk(user.tier, fc.tier) ? 'bg-ink/10 text-ink-400' : 'bg-ink text-cream'
                  }`}
                >
                  {fc.icon}
                </div>
                <div className="font-medium text-sm">{fc.label}</div>
                {fc.tier && !tierOk(user.tier, fc.tier) && <span className="text-[11px] text-ink-400 font-mono">L1+</span>}
              </div>
              <p className="text-[12px] text-ink-500 leading-relaxed">{fc.desc}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
