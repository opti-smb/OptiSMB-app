'use client';
import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import * as Icon from '@/components/Icons';
import { Btn, Card, DualConfidence, Disclaimer } from '@/components/UI';
import { StatementParseLoading } from '@/components/StatementParseLoading';
import { useApp } from '@/components/AppContext';
import { useToast } from '@/components/Toast';
import { tierOk } from '@/lib/utils';
import { mockStatements } from '@/lib/mockData';
import { finalizeParsedForClient, getStatementDisplayCurrency, formatMoney } from '@/lib/currencyConversion';
import { getBenchmarkAnalysis } from '@/lib/computeBenchmarkAnalysis';

export default function UploadPage() {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const parsingRef = useRef(false);
  const [isDrag, setIsDrag] = useState(false);
  const [dupWarning, setDupWarning] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [parsedResult, setParsedResult] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [agreementFile, setAgreementFile] = useState(null);
  const fileInputRef = useRef(null);
  const agreementRef = useRef(null);

  const { user, addStatement, addMerchantAgreement, isDuplicate, activeAgreement } = useApp();
  const { addToast } = useToast();
  const router = useRouter();

  const processFile = async (f) => {
    if (parsingRef.current) return;
    parsingRef.current = true;
    setFile(f);
    setStep(1);
    setParseError(null);

    try {
      const formData = new FormData();
      formData.append('file', f);
      formData.append('fileName', f.name);
      formData.append('fileType', f.type);
      formData.append('currency', 'AUTO');

      const res = await fetch('/api/parse', { method: 'POST', body: formData });
      const apiResult = await res.json().catch(() => null);

      let finalData;
      let parseMethod = 'demo';
      let isDemo = false;

      if (apiResult?.success && apiResult?.data) {
        let pd = finalizeParsedForClient(apiResult.data);
        const bench = getBenchmarkAnalysis(pd);
        if (bench) pd = { ...pd, benchmark_analysis: bench };
        finalData = pd;
        parseMethod = apiResult.method || apiResult.parser || 'python';
      } else {
        isDemo = true;
        let pd = finalizeParsedForClient({ ...mockStatements[0].parsedData });
        const bench = getBenchmarkAnalysis(pd);
        if (bench) pd = { ...pd, benchmark_analysis: bench };
        finalData = pd;
        const reason = apiResult?.reason;
        if (reason === 'parser_unreachable') {
          addToast({
            type: 'error',
            title: 'Parser not reachable',
            message:
              apiResult?.message ||
              'The statement parser service is unavailable. On Vercel, set STATEMENT_PARSER_URL to your deployed API. Locally, run npm run parser (port 8000).',
          });
        } else if (reason === 'not_statement') {
          addToast({
            type: 'error',
            title: 'Not a payment statement',
            message: apiResult?.message || 'Upload a merchant or bank statement.',
          });
        } else {
          addToast({
            type: 'info',
            title: 'Using demo analysis',
            message:
              apiResult?.message ||
              'Live parse failed — showing sample data. Fix parser or upload CSV for best results.',
          });
        }
      }

      const now = new Date();
      const uploadDate = now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
      const ccy = getStatementDisplayCurrency(finalData);

      const stmt = {
        fileName: f.name,
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
        parsedData: {
          ...finalData,
          fee_lines: finalData.fee_lines?.length ? finalData.fee_lines : mockStatements[0].parsedData.fee_lines,
          channel_split: finalData.channel_split || mockStatements[0].parsedData.channel_split,
        },
        discrepancies: mockStatements[0].discrepancies,
        benchmarks: mockStatements[0].benchmarks,
        rateTrend: mockStatements[0].rateTrend,
      };

      setParsedResult(stmt);
      setStep(2);

      if (apiResult?.success) {
        const vol = stmt.parsedData?.total_transaction_volume;
        const volStr = vol != null && Number.isFinite(Number(vol)) ? formatMoney(Number(vol), ccy) : '—';
        addToast({
          type: 'success',
          title: 'Statement parsed',
          message: `${stmt.parsedData?.fee_lines?.length || 0} fee lines · ${volStr} (${ccy}) · ${parseMethod}`,
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

  const handleFileSelect = (f) => {
    if (!f) return;

    if (f.size > 50 * 1024 * 1024) {
      addToast({ type: 'error', title: 'File too large', message: 'Maximum file size is 50MB. Please compress or split the file.' });
      return;
    }

    const ext = f.name.split('.').pop()?.toLowerCase();
    const allowed = ['pdf', 'csv', 'xlsx', 'xls'];
    const imgAllowed = ['jpg', 'jpeg', 'png'];
    if (!allowed.includes(ext) && !(tierOk(user.tier, 'L1') && imgAllowed.includes(ext))) {
      addToast({
        type: 'error',
        title: 'Unsupported format',
        message: tierOk(user.tier, 'L1')
          ? 'Please upload PDF, CSV, XLSX, or an image file (JPG/PNG).'
          : 'Please upload PDF, CSV, or XLSX. Image upload (OCR) requires Level 1.',
      });
      return;
    }

    // Duplicate detection — warn before proceeding
    const guessedAcquirer = f.name.replace(/[-_]/g, ' ').replace(/\.(pdf|csv|xlsx?)$/i, '');
    if (isDuplicate && isDuplicate(guessedAcquirer, '')) {
      setPendingFile(f);
      setDupWarning(`A statement with a similar name already exists. This may be a duplicate. Proceed anyway?`);
      return;
    }

    processFile(f);
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDrag(false);
    const f = e.dataTransfer.files[0];
    handleFileSelect(f);
  }, [isDuplicate]);

  const openReport = () => {
    if (!parsedResult) return;
    addStatement(parsedResult);
    router.push('/report');
  };

  const handleAgreementUpload = (f) => {
    if (!f) return;
    setAgreementFile(f);
    addMerchantAgreement({
      fileName: f.name,
      uploadDate: new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
      acquirer: parsedResult?.acquirer || 'Unknown',
    });
    addToast({ type: 'success', title: 'Agreement uploaded', message: `${f.name} linked. Discrepancy checking now active.` });
    openReport();
  };

  const STEPPER = ['01 Select file', '02 Parsing', '03 Review & open'];

  const reviewCcy = parsedResult ? getStatementDisplayCurrency(parsedResult.parsedData) : 'USD';
  const reviewVol = parsedResult?.parsedData?.total_transaction_volume;
  const reviewVolStr =
    reviewVol != null && Number.isFinite(Number(reviewVol))
      ? formatMoney(Number(reviewVol), reviewCcy)
      : '—';

  return (
    <div className="space-y-6">
      <div>
        <div className="smallcaps text-ink-400 mb-2">Upload</div>
        <h1 className="font-serif text-5xl leading-tight">Drop a statement. <em className="text-teal">We'll read it.</em></h1>
        <p className="text-ink-500 text-[14px] mt-2 max-w-xl">
          AI extracts every fee line in under 60 seconds. Confidence-scored. Benchmarked against 10 acquirers automatically.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-4 text-[12px] font-mono text-ink-400 flex-wrap">
        {STEPPER.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className={`dot ${step > i ? 'bg-teal' : step === i ? 'bg-teal-bright pulse-ring' : 'bg-ink/20'}`} />
            <span className={step >= i ? 'text-ink' : ''}>{s}</span>
            {i < 2 && <span className="w-8 hair-t hidden sm:block" />}
          </div>
        ))}
      </div>

      {/* Duplicate warning modal */}
      {dupWarning && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-6">
          <Card className="max-w-sm w-full p-6">
            <div className="flex items-start gap-3 mb-4">
              <Icon.AlertTriangle className="text-amber mt-0.5 shrink-0" size={18} />
              <div>
                <div className="font-serif text-2xl">Possible duplicate</div>
                <div className="text-[13px] text-ink-500 mt-1">{dupWarning}</div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Btn variant="ghost" onClick={() => { setDupWarning(null); setPendingFile(null); }}>Cancel</Btn>
              <Btn variant="primary" onClick={() => { setDupWarning(null); processFile(pendingFile); setPendingFile(null); }}>Continue anyway</Btn>
            </div>
          </Card>
        </div>
      )}

      {/* Step 0: Drop zone */}
      {step === 0 && (
        <Card className="p-2">
          <div
            onDragOver={e => { e.preventDefault(); setIsDrag(true); }}
            onDragLeave={() => setIsDrag(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-12 text-center transition ${isDrag ? 'border-teal bg-teal-dim/30' : 'hair bg-cream-100'}`}>
            <input ref={fileInputRef} type="file" className="hidden"
              accept={tierOk(user.tier, 'L1') ? '.pdf,.csv,.xlsx,.xls,.jpg,.jpeg,.png' : '.pdf,.csv,.xlsx,.xls'}
              onChange={e => handleFileSelect(e.target.files?.[0])} />
            <div className="w-14 h-14 mx-auto rounded-full bg-ink text-cream flex items-center justify-center mb-5">
              <Icon.Upload size={22} />
            </div>
            <h3 className="font-serif text-3xl leading-tight">Drag & drop your statement</h3>
            <p className="text-ink-500 text-[13px] mt-2">
              PDF, CSV, XLSX · up to 50MB
              {tierOk(user.tier, 'L1') ? ' · JPG/PNG (OCR)' : ''}
              {tierOk(user.tier, 'L2') ? ' · Bulk upload' : ''}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Btn variant="primary" icon={<Icon.Upload size={14} />} onClick={() => fileInputRef.current?.click()}>
                Choose file
              </Btn>
              <Btn variant="ghost" onClick={() => processFile(new File(['demo'], 'worldpay-mar26.pdf', { type: 'application/pdf' }))}>
                Use demo statement
              </Btn>
            </div>
            <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] text-ink-400 font-mono max-w-md mx-auto">
              {['AES-256 ENCRYPTED', 'US DATA RESIDENCY', 'AI PARSED <60s', 'DELETABLE ANYTIME'].map(t => (
                <div key={t} className="flex items-center gap-1.5"><Icon.Shield size={10} />{t}</div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Step 1: Parsing (real await on /api/parse — no fake progress) */}
      {step === 1 && (
        <Card className="p-6 sm:p-10">
          <StatementParseLoading active fileName={file?.name} />
        </Card>
      )}

      {/* Step 2: Done */}
      {step === 2 && parsedResult && (
        <>
          <Card className="p-6 flex flex-wrap items-center gap-5">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${parsedResult.parsingConfidence === 'low' ? 'bg-amber-soft' : 'bg-teal-dim'}`}>
              {parsedResult.parsingConfidence === 'low'
                ? <Icon.AlertTriangle className="text-amber" size={18} />
                : <Icon.CircleCheck className="text-teal" size={18} />}
            </div>
            <div className="flex-1 min-w-[260px]">
              <div className="text-sm font-medium">
                {parsedResult.parsingConfidence === 'low'
                  ? 'Parsed — low confidence, routed to human review (4 business hours)'
                  : `Parsed successfully — ${parsedResult.parsedData?.fee_lines?.length || 0} fee lines, ${parsedResult.source === 'live' ? 'real AI extraction' : 'demo data'}.`}
              </div>
              <div className="text-[12px] text-ink-400">
                {parsedResult.acquirer} · {parsedResult.period} · {reviewVolStr} volume ({reviewCcy}) ·{' '}
                effective rate {parsedResult.parsedData?.effective_rate?.toFixed(2)}%
              </div>
            </div>
            <DualConfidence parsing={parsedResult.parsingConfidence} rate={parsedResult.rateConfidence} asOf={parsedResult.dataAsOf} />
            <Btn variant="primary" onClick={openReport} icon={<Icon.ArrowRight size={14} />}>Open report</Btn>
          </Card>

          {parsedResult.source === 'demo' && (
            <Disclaimer tone="warn">
              This preview uses sample data because live parsing did not return a result (parser unavailable, unsupported content, or network error). In production, configure the parser API URL for your host (e.g. STATEMENT_PARSER_URL on Vercel). Locally, run the Python service on port 8000. CSV uploads usually give the most reliable extraction.
            </Disclaimer>
          )}

          {/* Merchant agreement prompt */}
          <input ref={agreementRef} type="file" className="hidden" accept=".pdf"
            onChange={e => handleAgreementUpload(e.target.files?.[0])} />

          {activeAgreement ? (
            <Card className="p-5 flex items-center gap-4 bg-teal-dim/20 border-teal/30">
              <Icon.CircleCheck size={18} className="text-teal shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-medium">Merchant agreement active — discrepancy checking enabled</div>
                <div className="text-[12px] text-ink-400">{activeAgreement.fileName} ({activeAgreement.version}) · {activeAgreement.acquirer}</div>
              </div>
              <Btn variant="primary" onClick={openReport} icon={<Icon.ArrowRight size={14} />}>Open report with discrepancy check</Btn>
            </Card>
          ) : (
            <Card className="p-5 flex flex-wrap items-center gap-4 bg-cream-200/60">
              <Icon.FileText size={18} className="text-ink-500 shrink-0" />
              <div className="flex-1 min-w-[240px]">
                <div className="text-sm font-medium">Upload your merchant agreement to enable discrepancy checking.</div>
                <div className="text-[12px] text-ink-400">We'll reconcile every line against your contracted rates and flag overcharges or missing rebates.</div>
              </div>
              <div className="flex gap-2">
                {tierOk(user.tier, 'L1') ? (
                  <Btn variant="outline" icon={<Icon.Upload size={14} />} onClick={() => agreementRef.current?.click()}>
                    Upload agreement
                  </Btn>
                ) : (
                  <Link href="/upgrade"><Btn variant="outline" icon={<Icon.Lock size={14} />}>Level 1 feature</Btn></Link>
                )}
                <Btn variant="ghost" onClick={openReport}>Skip for now</Btn>
              </div>
            </Card>
          )}

          <div className="flex gap-3">
            <Btn variant="ghost" onClick={() => { setStep(0); setFile(null); setParsedResult(null); }}>
              Upload another
            </Btn>
          </div>
        </>
      )}

      {/* Supported formats guide */}
      {step === 0 && (
        <div className="grid md:grid-cols-3 gap-4">
          {[
            { icon: <Icon.FileText size={18} />, label: 'PDF statements', desc: 'All tiers. Text-extractable PDFs parsed via AI. Scanned PDFs fall back to demo data in this release.', tier: null },
            { icon: <Icon.Download size={18} />, label: 'CSV / XLSX', desc: 'All tiers. Best accuracy — structured data feeds directly into AI parsing. Full fee-line extraction.', tier: null },
            { icon: <Icon.Sparkles size={18} />, label: 'JPG / PNG (OCR)', desc: 'Level 1+. Image statements processed via OCR. Confidence is typically 10–20% lower than digital formats.', tier: 'L1' },
          ].map(f => (
            <Card key={f.label} className={`p-5 ${f.tier && !tierOk(user.tier, f.tier) ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${f.tier && !tierOk(user.tier, f.tier) ? 'bg-ink/10 text-ink-400' : 'bg-ink text-cream'}`}>{f.icon}</div>
                <div className="font-medium text-sm">{f.label}</div>
                {f.tier && !tierOk(user.tier, f.tier) && <span className="text-[11px] text-ink-400 font-mono">L1+</span>}
              </div>
              <p className="text-[12px] text-ink-500 leading-relaxed">{f.desc}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
