'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as Icon from '@/components/Icons';
import { Btn, Field, Input } from '@/components/UI';
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
              Upload one statement. Keep it or delete it — your data, your terms. No advice given; decisions remain yours.
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
          <div className="mt-8 text-[12px] text-ink-400">{footer}</div>
        </div>
      </div>
    </div>
  );
}

function SSO() {
  const { addToast } = useToast();
  const handleSSO = (provider) => {
    addToast({ type: 'info', title: `${provider} SSO`, message: 'SSO integration coming in Phase 2.' });
  };
  return (
    <div className="grid grid-cols-2 gap-3 mb-6">
      <button onClick={() => handleSSO('Google')} className="h-11 border hair rounded-full flex items-center justify-center gap-2 text-sm hover:bg-ink/5 transition">
        <Icon.Google size={16} /> Google
      </button>
      <button onClick={() => handleSSO('Microsoft')} className="h-11 border hair rounded-full flex items-center justify-center gap-2 text-sm hover:bg-ink/5 transition">
        <Icon.Microsoft size={16} /> Microsoft
      </button>
    </div>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState('owner@horizonretail.com');
  const [pw, setPw] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useApp();
  const { addToast } = useToast();
  const router = useRouter();

  const handleLogin = async () => {
    if (!email) { addToast({ type: 'error', title: 'Email required' }); return; }
    setLoading(true);
    await new Promise(r => setTimeout(r, 600));
    const result = await login({ email });
    setLoading(false);
    if (!result.ok) {
      addToast({
        type: 'error',
        title: 'Sign in failed',
        message: result.message || 'Check the terminal for server errors, then try again.',
      });
      return;
    }
    if (result.demo) {
      addToast({
        type: 'info',
        title: 'Demo mode',
        message: 'Database is not configured; your session and statements stay on this device only.',
      });
    } else {
      addToast({ type: 'success', title: 'Welcome back!', message: 'Redirecting to your dashboard.' });
    }
    router.push('/dashboard');
  };

  return (
    <AuthShell sub="Welcome back" title="Sign in to OptiSMB."
      footer={<>New here? <Link href="/register" className="text-ink underline underline-offset-2">Create a free account</Link></>}>
      <SSO />
      <div className="flex items-center gap-3 text-[11px] smallcaps text-ink-400 mb-5">
        <div className="flex-1 hair-t" /><span>or</span><div className="flex-1 hair-t" />
      </div>
      <div className="space-y-4">
        <Field label="Work email">
          <Input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@company.com" />
        </Field>
        <Field label={
          <span className="flex justify-between">
            Password
            <button className="text-ink-400 hover:text-ink underline underline-offset-2 !normal-case !tracking-normal text-[11px]"
              onClick={() => addToast({ type: 'info', message: 'Password reset email would be sent in production.' })}>
              Forgot?
            </button>
          </span>
        }>
          <Input value={pw} onChange={e => setPw(e.target.value)} type="password" placeholder="••••••••" />
        </Field>
        <Btn className="w-full" size="lg" onClick={handleLogin} disabled={loading} icon={<Icon.ArrowRight size={16} />}>
          {loading ? 'Signing in…' : 'Sign in'}
        </Btn>
      </div>
    </AuthShell>
  );
}
