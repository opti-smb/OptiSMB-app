'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as Icon from '@/components/Icons';
import { Btn, Field, Input, Select } from '@/components/UI';
import { useApp } from '@/components/AppContext';
import { useToast } from '@/components/Toast';

function AuthShell({ children, title, sub, footer }) {
  return (
    <div className="min-h-screen bg-cream flex grain">
      <div className="hidden md:flex md:w-[46%] hair-r relative overflow-hidden bg-ink text-cream">
        <div className="absolute -left-24 -bottom-24 w-96 h-96 rounded-full bg-teal/20 blur-3xl" />
        <div className="relative p-12 flex flex-col justify-between w-full">
          <Link href="/" className="flex items-center gap-2">
            <Icon.Logo size={28} /><span className="font-serif text-2xl">OptiSMB</span>
          </Link>
          <div>
            <div className="smallcaps text-teal-bright mb-4">Why sign up</div>
            <h2 className="font-serif text-5xl leading-[1]">
              The average business we audit is overpaying <em className="text-teal-bright">$14,275</em> per year.
            </h2>
            <p className="text-cream/60 text-sm mt-6 max-w-md">
              Upload one statement. Keep it or delete it — your data, your terms. No advice given.
            </p>
          </div>
          <div className="text-[11px] font-mono text-cream/40">US CCPA/GLBA · WCAG 2.1 AA · SOC 2 Type II</div>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-[420px]">
          <div className="mb-8">
            <div className="smallcaps text-ink-400 mb-2">{sub}</div>
            <h1 className="font-serif text-4xl leading-tight">{title}</h1>
          </div>
          {children}
          {footer && <div className="mt-8 text-[12px] text-ink-400">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

const INDUSTRIES = ['Fashion & apparel', 'Hospitality', 'Professional services', 'Grocery & convenience', 'Health & beauty', 'E-commerce (multi)', 'Retail (general)', 'Other'];
const VOLUMES = ['< $50k', '$50k – $250k', '$250k – $1M', '$1M+'];

export default function RegisterPage() {
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [biz, setBiz] = useState('');
  const [industry, setIndustry] = useState('Fashion & apparel');
  const [country, setCountry] = useState('United States');
  const [volume, setVolume] = useState('$50k – $250k');
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

  const { register } = useApp();
  const { addToast } = useToast();
  const router = useRouter();

  const next = async () => {
    if (step === 0) {
      if (!email) { addToast({ type: 'error', title: 'Email required' }); return; }
      if (!password || password.length < 10) {
        addToast({ type: 'error', title: 'Password too short', message: 'Use at least 10 characters.' });
        return;
      }
      if (!agreed) { addToast({ type: 'error', title: 'Please accept the terms' }); return; }
      setStep(1);
    } else if (step === 1) {
      setStep(2);
    } else {
      if (!biz) { addToast({ type: 'error', title: 'Business name required' }); return; }
      setLoading(true);
      await new Promise(r => setTimeout(r, 500));
      const result = await register({
        email,
        password,
        business: biz,
        name: biz,
        industry,
        country,
        monthlyVolume: volume,
      });
      setLoading(false);
      if (!result.ok) {
        const title =
          result.error === 'email_already_registered'
            ? 'This email is already registered'
            : 'Could not create account';
        addToast({
          type: 'error',
          title,
          message:
            result.message ||
            'Check DATABASE_URL and SESSION_SECRET in .env, then restart the dev server.',
        });
        if (result.error === 'email_already_registered') {
          setStep(0);
        }
        return;
      }
      if (result.demo) {
        addToast({
          type: 'info',
          title: 'Demo mode',
          message: 'Database is not configured; data stays on this device only.',
        });
      } else {
        addToast({ type: 'success', title: 'Account created!', message: 'Welcome to OptiSMB.' });
      }
      router.push('/dashboard');
    }
  };

  const titles = ['Create your account.', 'Verify your email.', 'Tell us about your business.'];
  const subs = [`Step ${step + 1} of 3`, `Step ${step + 1} of 3`, `Step ${step + 1} of 3`];

  return (
    <AuthShell sub={subs[step]} title={titles[step]}
      footer={step === 0 ? <>Already a user? <Link href="/login" className="text-ink underline underline-offset-2">Sign in</Link></> : null}>

      {step === 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 mb-6">
            {['Google', 'Microsoft'].map(p => (
              <button key={p} onClick={() => addToast({ type: 'info', message: 'SSO coming in Phase 2.' })}
                className="h-11 border hair rounded-full flex items-center justify-center gap-2 text-sm hover:bg-ink/5 transition">
                {p === 'Google' ? <Icon.Google size={16} /> : <Icon.Microsoft size={16} />}{p}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 text-[11px] smallcaps text-ink-400 mb-5">
            <div className="flex-1 hair-t" /><span>or with email</span><div className="flex-1 hair-t" />
          </div>
          <div className="space-y-4">
            <Field label="Work email"><Input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@company.com" /></Field>
            <Field label="Password" hint="10 characters minimum">
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••••" />
            </Field>
            <label className="flex items-start gap-2 text-[12px] text-ink-500 cursor-pointer">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5" />
              I agree to OptiSMB's Terms and acknowledge the Privacy Policy. No financial advice is provided.
            </label>
            <Btn className="w-full" size="lg" onClick={next} icon={<Icon.ArrowRight size={16} />}>Create account</Btn>
          </div>
        </>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <div className="border hair rounded-xl p-5 bg-cream-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-teal-dim flex items-center justify-center">
                <Icon.FileText className="text-teal" size={18} />
              </div>
              <div>
                <div className="text-sm">We sent a link to <span className="font-mono">{email || 'your email'}</span></div>
                <div className="text-[12px] text-ink-400">Click the link to continue.</div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[13px]">
            <button className="underline underline-offset-2 text-ink"
              onClick={() => addToast({ type: 'info', message: 'Verification email resent.' })}>Resend email</button>
            <span className="text-ink-300">·</span>
            <button className="underline underline-offset-2 text-ink-500" onClick={() => setStep(0)}>Use different email</button>
          </div>
          <Btn className="w-full" size="lg" variant="outline" onClick={next}>I've verified — continue</Btn>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Field label="Business name"><Input value={biz} onChange={e => setBiz(e.target.value)} placeholder="Horizon Retail Inc" /></Field>
          <Field label="Industry">
            <Select value={industry} onChange={e => setIndustry(e.target.value)}>
              {INDUSTRIES.map(o => <option key={o}>{o}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Country">
              <Select value={country} onChange={e => setCountry(e.target.value)}>
                {['United States', 'Canada', 'Mexico'].map(o => <option key={o}>{o}</option>)}
              </Select>
            </Field>
            <Field label="Est. monthly volume">
              <Select value={volume} onChange={e => setVolume(e.target.value)}>
                {VOLUMES.map(o => <option key={o}>{o}</option>)}
              </Select>
            </Field>
          </div>
          <Btn className="w-full" size="lg" onClick={next} disabled={loading} icon={<Icon.ArrowRight size={16} />}>
            {loading ? 'Creating account…' : 'Take me to the dashboard'}
          </Btn>
        </div>
      )}
    </AuthShell>
  );
}
