'use client';
import { useState } from 'react';
import * as Icon from '@/components/Icons';
import { Card, Btn } from '@/components/UI';
import { useToast } from '@/components/Toast';

const FAQS = [
  {
    q: 'How does parsing confidence work?',
    a: 'Each field we extract is scored against our format library. High = exact match to a known template. Medium = recovered through fuzzy alignment. Low = best-guess, flagged for review. Overall document confidence is the weighted average of all field scores.',
  },
  {
    q: 'Why are parsing and rate confidence separate?',
    a: "Because extraction quality and how 'typical' your fee pattern looks are different questions. Merging them would hide uncertainty. We never collapse them — both scores are shown independently on every report.",
  },
  {
    q: 'Is this financial advice?',
    a: "No. OptiSMB produces structured analysis from your statement data. All decisions remain with you, your accountant or your registered financial adviser. We are an informational tool — we do not execute acquirer switches on your behalf.",
  },
  {
    q: 'How is my data kept secure?',
    a: 'US data residency on AWS, encrypted at rest with AES-256 and in transit with TLS 1.3. You can delete everything in Settings. Audit logs are retained for 7 years per US financial regulations, but your statements and personal data are purged within 30 days of a deletion request.',
  },
  {
    q: 'What formats can I upload?',
    a: 'PDF, CSV, and XLSX files up to 50MB. Level 1 and above also support JPG and PNG uploads via OCR. Level 2 supports bulk upload of multiple files simultaneously. Parsing runs in the OptiSMB statement engine (FastAPI service); supported formats return structured fee and volume data.',
  },
  {
    q: 'How does the referral fee model work?',
    a: 'We may receive a fee from acquirers when you contact them through our platform. This is disclosed clearly wherever it applies. It does not change how we parse or present your own statement data.',
  },
  {
    q: 'What is the Q&A feature?',
    a: 'The Q&A assistant answers plain-language questions using only your parsed statement fields — deterministic rules, no external model call. It focuses on volume, rates, fees, and channel split. For full detail, use the report tabs.',
  },
  {
    q: 'How accurate is statement parsing?',
    a: 'We target ≥90% accuracy across common statement layouts. For large-processor templates, accuracy is typically highest. Scanned PDF or image uploads vary more and receive an explicit confidence warning. All low-confidence fields are flagged — never silently dropped.',
  },
];

export default function HelpPage() {
  const [open, setOpen] = useState(null);
  const [contactMsg, setContactMsg] = useState('');
  const { addToast } = useToast();

  const sendMessage = () => {
    if (!contactMsg.trim()) { addToast({ type: 'error', title: 'Please enter a message' }); return; }
    addToast({ type: 'success', title: 'Message sent', message: 'We\'ll respond within 3 business hours.' });
    setContactMsg('');
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <div className="smallcaps text-ink-400 mb-2">Support</div>
        <h1 className="font-serif text-5xl leading-tight">Help & FAQs</h1>
      </div>

      <Card>
        <div className="divide-hair">
          {FAQS.map(({ q, a }, i) => (
            <div key={i} className="px-6 py-5">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between text-left gap-4">
                <span className="font-serif text-xl">{q}</span>
                <span className={`shrink-0 transition-transform duration-200 ${open === i ? 'rotate-180' : ''}`}>
                  <Icon.ChevronDown size={16} className="text-ink-400" />
                </span>
              </button>
              {open === i && (
                <p className="mt-3 text-[14px] text-ink-500 leading-relaxed fade-up">{a}</p>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Contact form */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <Icon.HelpCircle size={20} className="text-ink-500" />
          <div>
            <div className="text-sm font-medium">Can't find your answer?</div>
            <div className="text-[12px] text-ink-400">Average first response time: 3 hours during US business hours (ET).</div>
          </div>
        </div>
        <textarea
          value={contactMsg}
          onChange={e => setContactMsg(e.target.value)}
          placeholder="Describe your question or issue…"
          rows={4}
          className="w-full px-3 py-2.5 bg-cream-100 border hair rounded-lg text-sm outline-none focus:border-ink resize-none mb-3" />
        <div className="flex gap-2">
          <Btn variant="primary" size="sm" onClick={sendMessage} icon={<Icon.Send size={13} />}>Send message</Btn>
          <Btn variant="ghost" size="sm" icon={<Icon.ArrowUpRight size={13} />}
            onClick={() => addToast({ type: 'info', message: 'Status page would open in production.' })}>
            Status page
          </Btn>
        </div>
      </Card>

      {/* Quick links */}
      <div className="grid md:grid-cols-3 gap-4">
        {[
          { icon: <Icon.FileText size={18} />, title: 'Documentation', body: 'Full API docs, parsing schema, and integration guides.', cta: 'View docs' },
          { icon: <Icon.Shield size={18} />, title: 'Privacy policy', body: 'How we collect, use, and protect your data under US CCPA/GLBA.', cta: 'Read policy' },
          { icon: <Icon.CreditCard size={18} />, title: 'Billing help', body: 'Invoices, payment methods, and plan changes.', cta: 'Billing FAQ' },
        ].map((card, i) => (
          <Card key={i} className="p-5">
            <div className="w-9 h-9 rounded-lg bg-cream-200 border hair flex items-center justify-center mb-3 text-ink-500">{card.icon}</div>
            <div className="font-medium text-sm mb-1">{card.title}</div>
            <p className="text-[12px] text-ink-500 mb-3">{card.body}</p>
            <Btn variant="outline" size="sm" icon={<Icon.ArrowUpRight size={12} />}
              onClick={() => addToast({ type: 'info', message: 'This would open in production.' })}>{card.cta}</Btn>
          </Card>
        ))}
      </div>
    </div>
  );
}
