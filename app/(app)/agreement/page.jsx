'use client';
import { useState, useRef } from 'react';
import Link from 'next/link';
import * as Icon from '@/components/Icons';
import { Btn, Card, Pill, Disclaimer, TierGate, Field, Input, Select } from '@/components/UI';
import { useApp } from '@/components/AppContext';
import { useToast } from '@/components/Toast';
import { tierOk } from '@/lib/utils';

function AgreementRow({ agr, onDelete }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <tr className="group hair-t hover:bg-cream-200/30 transition">
      <td className="px-5 py-3">
        <div className="flex items-center gap-2">
          <Icon.FileText size={14} className="text-ink-400 shrink-0" />
          <span className="text-sm">{agr.fileName}</span>
        </div>
      </td>
      <td className="px-5 py-3">
        <span className="font-mono text-[12px]">{agr.version}</span>
      </td>
      <td className="px-5 py-3 font-mono text-[12px] text-ink-400">{agr.uploadDate}</td>
      <td className="px-5 py-3 font-mono text-[12px] text-ink-400">{agr.effectiveDate || '—'}</td>
      <td className="px-5 py-3">{agr.acquirer || '—'}</td>
      <td className="px-5 py-3">
        <Pill tone={agr.status === 'Active' ? 'teal' : 'ink'}>{agr.status}</Pill>
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center gap-2">
          {confirm ? (
            <>
              <Btn variant="danger" size="sm" onClick={() => { onDelete(agr.id); setConfirm(false); }}>Confirm delete</Btn>
              <Btn variant="ghost" size="sm" onClick={() => setConfirm(false)}>Cancel</Btn>
            </>
          ) : (
            <button onClick={() => setConfirm(true)} className="opacity-0 group-hover:opacity-100 transition p-1.5 rounded-lg hover:bg-rose-soft text-rose">
              <Icon.Trash size={14} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function AgreementPage() {
  const { user, merchantAgreements, activeAgreement, addMerchantAgreement, deleteAgreement, addNotification } = useApp();
  const { addToast } = useToast();
  const fileRef = useRef(null);
  const [isDrag, setIsDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ acquirer: '', effectiveDate: '' });

  const handleFile = async (f) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      addToast({ type: 'error', title: 'PDF only', message: 'Merchant agreements must be uploaded as PDF files.' });
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      addToast({ type: 'error', title: 'File too large', message: 'Maximum file size is 50MB.' });
      return;
    }
    setUploading(true);
    await new Promise(r => setTimeout(r, 1200));
    addMerchantAgreement({
      fileName: f.name,
      uploadDate: new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
      effectiveDate: form.effectiveDate || new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
      acquirer: form.acquirer || 'Unknown acquirer',
    });
    setUploading(false);
    setForm({ acquirer: '', effectiveDate: '' });
    addToast({ type: 'success', title: 'Agreement uploaded', message: 'Version-controlled and linked to your analyses.' });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDrag(false);
    handleFile(e.dataTransfer.files[0]);
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="smallcaps text-ink-400 mb-2">Reconciliation</div>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <h1 className="font-serif text-4xl md:text-5xl leading-tight">Merchant agreements</h1>
          <Btn variant="primary" icon={<Icon.Upload size={14} />} onClick={() => fileRef.current?.click()}>
            Upload new version
          </Btn>
        </div>
        <p className="text-ink-500 text-[14px] mt-3 max-w-2xl">
          Upload your signed merchant agreement to enable line-level discrepancy detection. OptiSMB cross-references
          every fee line against your contracted rates and flags overcharges or missing rebates automatically.
        </p>
      </div>

      <TierGate needed="L1" currentTier={user.tier} onUpgrade={() => window.location.href = '/upgrade'} reason="Merchant agreement cross-referencing is a Level 1 feature">
        <>
          <Disclaimer>
            Discrepancy analysis is based on the agreement text we can extract. Rates may be subject to addenda, side letters or clauses that were not part of the uploaded document. Always confirm with your acquirer before raising a dispute.
          </Disclaimer>

          {/* Upload zone */}
          <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
          <Card className="p-2">
            <div
              onDragOver={e => { e.preventDefault(); setIsDrag(true); }}
              onDragLeave={() => setIsDrag(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-10 text-center transition ${isDrag ? 'border-teal bg-teal-dim/20' : 'hair bg-cream-100'} ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
              <div className="w-12 h-12 mx-auto rounded-full bg-ink text-cream flex items-center justify-center mb-4">
                {uploading ? <span className="spin block w-5 h-5 border-2 border-cream border-t-transparent rounded-full" /> : <Icon.FileText size={20} />}
              </div>
              <h3 className="font-serif text-2xl">{uploading ? 'Processing agreement…' : 'Drag & drop your merchant agreement'}</h3>
              {!uploading && (
                <>
                  <p className="text-ink-500 text-[13px] mt-2">PDF only · max 50MB · version-controlled automatically</p>
                  <div className="mt-5 grid sm:grid-cols-2 gap-3 max-w-sm mx-auto text-left">
                    <Field label="Acquirer name">
                      <Input
                        placeholder="e.g. Chase Merchant Services"
                        value={form.acquirer}
                        onChange={e => setForm(f => ({ ...f, acquirer: e.target.value }))}
                        className="mt-1"
                      />
                    </Field>
                    <Field label="Effective from">
                      <Input
                        type="date"
                        value={form.effectiveDate}
                        onChange={e => setForm(f => ({ ...f, effectiveDate: e.target.value }))}
                        className="mt-1"
                      />
                    </Field>
                  </div>
                  <div className="mt-5 flex items-center justify-center gap-3">
                    <Btn variant="primary" icon={<Icon.Upload size={14} />} onClick={() => fileRef.current?.click()}>
                      Choose PDF
                    </Btn>
                    <Btn variant="ghost" onClick={() => {
                      handleFile(new File(['demo'], 'merchant-agreement-demo.pdf', { type: 'application/pdf' }));
                      setForm({ acquirer: 'Chase Merchant Services', effectiveDate: '2024-02-01' });
                    }}>
                      Use demo agreement
                    </Btn>
                  </div>
                </>
              )}
            </div>
          </Card>

          {/* Active agreement */}
          {activeAgreement && (
            <Card className="p-5 border-teal/30 bg-teal-dim/10">
              <div className="flex items-start gap-4 flex-wrap">
                <div className="w-10 h-10 rounded-lg bg-teal-dim flex items-center justify-center shrink-0">
                  <Icon.CircleCheck size={18} className="text-teal" />
                </div>
                <div className="flex-1 min-w-[240px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-sm font-medium">{activeAgreement.fileName}</div>
                    <Pill tone="teal">Active · {activeAgreement.version}</Pill>
                  </div>
                  <div className="text-[12px] text-ink-400 mt-0.5 font-mono">
                    Uploaded {activeAgreement.uploadDate}
                    {activeAgreement.effectiveDate ? ` · Effective from ${activeAgreement.effectiveDate}` : ''}
                    {activeAgreement.acquirer ? ` · ${activeAgreement.acquirer}` : ''}
                  </div>
                  <div className="text-[12px] text-teal mt-2 flex items-center gap-1">
                    <Icon.CircleCheck size={12} /> Discrepancy checking active on all new analyses
                  </div>
                </div>
                <Link href="/report">
                  <Btn variant="outline" size="sm" icon={<Icon.ArrowRight size={13} />}>View latest report</Btn>
                </Link>
              </div>
              {activeAgreement.terms && (
                <div className="mt-4 pt-4 border-t hair grid sm:grid-cols-3 gap-3 text-[12px]">
                  <div><div className="text-ink-400">POS service rate</div><div className="font-mono font-medium mt-0.5">{activeAgreement.terms.pos_service_rate}</div></div>
                  <div><div className="text-ink-400">Online (CNP) rate</div><div className="font-mono font-medium mt-0.5">{activeAgreement.terms.cnp_service_rate}</div></div>
                  <div><div className="text-ink-400">Volume rebate</div><div className="font-mono font-medium mt-0.5">{activeAgreement.terms.volume_rebate_rate} above ${(activeAgreement.terms.volume_rebate_threshold || 0).toLocaleString()}</div></div>
                  <div><div className="text-ink-400">Amex mark-up</div><div className="font-mono font-medium mt-0.5">{activeAgreement.terms.amex_markup}</div></div>
                  <div><div className="text-ink-400">IC pass-through</div><div className="font-mono font-medium mt-0.5">{activeAgreement.terms.interchange_passthrough ? 'Yes' : 'No'}</div></div>
                  <div><div className="text-ink-400">Monthly minimum</div><div className="font-mono font-medium mt-0.5">${activeAgreement.terms.monthly_min?.toFixed(2)}</div></div>
                </div>
              )}
            </Card>
          )}

          {/* Version history table */}
          {merchantAgreements.length > 0 && (
            <Card>
              <div className="p-5 hair-b">
                <h3 className="font-serif text-2xl">Version history</h3>
                <div className="text-[12px] text-ink-400">{merchantAgreements.length} agreement{merchantAgreements.length !== 1 ? 's' : ''} on file · latest is active</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="smallcaps text-ink-400 bg-cream-200/40">
                    <tr>
                      {['File', 'Version', 'Uploaded', 'Effective from', 'Acquirer', 'Status', ''].map(h => (
                        <th key={h} className="text-left font-medium px-5 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {merchantAgreements.map(agr => (
                      <AgreementRow key={agr.id} agr={agr} onDelete={deleteAgreement} />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {merchantAgreements.length === 0 && (
            <Card className="p-12 text-center">
              <div className="w-14 h-14 mx-auto rounded-full bg-cream-200 border hair flex items-center justify-center mb-4">
                <Icon.FileText size={22} className="text-ink-400" />
              </div>
              <h3 className="font-serif text-2xl mb-2">No agreements uploaded yet</h3>
              <p className="text-ink-500 text-[14px] max-w-sm mx-auto">
                Upload your signed merchant agreement to unlock discrepancy detection. We'll flag every line where you're being charged more than you agreed.
              </p>
            </Card>
          )}

          {/* What we check */}
          <Card className="p-6">
            <h3 className="font-serif text-2xl mb-4">What discrepancy checking covers</h3>
            <div className="grid sm:grid-cols-2 gap-4 text-[13px]">
              {[
                ['Interchange pass-through', 'Verifies interchange is passed at published Visa/MC/Amex rates, not inflated.'],
                ['Acquirer service margin', 'Compares your contracted mark-up against what\'s charged on each fee line.'],
                ['Volume rebates', 'Checks whether qualifying volume thresholds trigger the rebates in your agreement.'],
                ['Scheme fee accuracy', 'Validates Visa, Mastercard, and Amex scheme fees against published schedules.'],
                ['Unrecognised fee lines', 'Flags any charge not referenced in your agreement — hidden fees surfaced.'],
                ['Auth and misc fees', 'Validates per-transaction auth fees, chargeback fees, and monthly minimums.'],
              ].map(([t, d]) => (
                <div key={t} className="flex gap-3">
                  <Icon.Check size={14} className="text-leaf mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">{t}</div>
                    <div className="text-ink-400 mt-0.5">{d}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      </TierGate>
    </div>
  );
}
