'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Icon from '@/components/Icons';
import { Card, Btn, Field, Input, Select, Toggle, TierBadge } from '@/components/UI';
import { useApp } from '@/components/AppContext';
import { useToast } from '@/components/Toast';
import { downloadCSV } from '@/lib/utils';

const INDUSTRIES = ['Fashion & apparel', 'Hospitality', 'Professional services', 'Grocery & convenience', 'Health & beauty', 'E-commerce (multi)', 'Retail (general)', 'Food & beverage', 'Auto & transport', 'Healthcare', 'Other'];

export default function SettingsPage() {
  const { user, updateUser, updateTier, deleteAccount, logout, exportUserData } = useApp();
  const { addToast } = useToast();
  const router = useRouter();

  const [biz, setBiz] = useState(user.business || '');
  const [email, setEmail] = useState(user.email || '');
  const [industry, setIndustry] = useState(user.industry || 'Fashion & apparel');
  const [country, setCountry] = useState(user.country || 'United States');

  const [t3Consent, setT3Consent] = useState(user.t3DataConsent || false);
  const [notifyParse, setNotifyParse] = useState(user.notifyParseComplete ?? true);
  const [notifyReport, setNotifyReport] = useState(user.notifyReportReady ?? true);
  const [notifyStale, setNotifyStale] = useState(user.notifyStaleness ?? true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [currency, setCurrency] = useState('USD');

  const saveProfile = () => {
    updateUser({ business: biz, name: biz, email, industry, country });
    addToast({ type: 'success', title: 'Profile saved', message: 'Your business profile has been updated.' });
  };

  const saveNotifications = () => {
    updateUser({ notifyParseComplete: notifyParse, notifyReportReady: notifyReport, notifyStaleness: notifyStale });
    addToast({ type: 'success', title: 'Notification preferences saved' });
  };

  const handleDeleteAccount = () => {
    if (deleteConfirmText !== 'DELETE') {
      addToast({ type: 'error', title: 'Type DELETE to confirm' });
      return;
    }
    deleteAccount();
    logout();
    router.push('/');
  };

  const handleDataExport = () => {
    const data = exportUserData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `optismb-data-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast({ type: 'success', title: 'Data exported', message: 'Your account data downloaded as JSON.' });
  };

  const handleT3Consent = (v) => {
    setT3Consent(v);
    updateUser({ t3DataConsent: v });
    if (v) {
      addToast({ type: 'info', title: 'Data contribution enabled', message: 'Anonymised rate data will contribute to benchmarking. Thank you.' });
    }
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <div className="smallcaps text-ink-400 mb-2">Account</div>
        <h1 className="font-serif text-5xl leading-tight">Settings</h1>
      </div>

      {/* Profile */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="font-serif text-2xl">Profile</div>
          <TierBadge tier={user.tier} />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Business name"><Input value={biz} onChange={e => setBiz(e.target.value)} placeholder="Horizon Retail Inc" /></Field>
          <Field label="Contact email"><Input value={email} onChange={e => setEmail(e.target.value)} type="email" /></Field>
          <Field label="Industry">
            <Select value={industry} onChange={e => setIndustry(e.target.value)}>
              {INDUSTRIES.map(o => <option key={o}>{o}</option>)}
            </Select>
          </Field>
          <Field label="Country">
            <Select value={country} onChange={e => setCountry(e.target.value)}>
              {['United States', 'Canada', 'Mexico', 'Other'].map(o => <option key={o}>{o}</option>)}
            </Select>
          </Field>
        </div>
        <Btn variant="primary" className="mt-4" onClick={saveProfile} icon={<Icon.Check size={14} />}>Save profile</Btn>
      </Card>

      {/* Subscription */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="font-serif text-2xl">Subscription</div>
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-ink-400 text-[12px]">Simulate tier:</span>
            {['Free', 'L1', 'L2'].map(t => (
              <button key={t} onClick={() => { updateTier(t); addToast({ type: 'success', title: `Switched to ${t}` }); }}
                className={`px-2.5 h-7 rounded-full border text-[12px] transition ${user.tier === t ? 'bg-ink text-cream border-ink' : 'hair text-ink-500 hover:bg-ink/5'}`}>{t}</button>
            ))}
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <div className="smallcaps text-ink-400">Current plan</div>
            <div className="font-serif text-3xl">{user.tier === 'Free' ? 'Free' : user.tier === 'L1' ? 'Level 1' : 'Level 2'}</div>
            <div className="text-[12px] text-ink-400 font-mono mt-0.5">
              {user.tier === 'Free' ? '$0 / forever' : user.tier === 'L1' ? '$39 / month' : '$99 / month'}
            </div>
          </div>
          <div>
            <div className="smallcaps text-ink-400">Next billing</div>
            <div className="font-mono text-[15px] tabular">{user.billingDate || '12 May 2026'}</div>
            <div className="text-[12px] text-ink-400">{user.card || 'VISA •••• 4210'}</div>
          </div>
          <div className="flex items-end">
            <a href="/upgrade"><Btn variant="primary" icon={<Icon.ArrowRight size={13} />}>{user.tier === 'Free' ? 'Upgrade plan' : 'Change plan'}</Btn></a>
          </div>
        </div>
        <div className="mt-5 pt-5 border-t hair">
          <div className="smallcaps text-ink-400 mb-3">Plan features</div>
          <div className="grid sm:grid-cols-3 gap-3 text-[12px]">
            {[
              { feature: 'Statements / month', free: '1', l1: '5', l2: 'Unlimited' },
              { feature: 'Discrepancy report', free: '—', l1: 'Yes', l2: 'Yes' },
              { feature: 'Q&A assistant', free: '—', l1: 'Yes', l2: 'Yes' },
              { feature: 'What-if modelling', free: '—', l1: '—', l2: 'Yes' },
              { feature: 'Export to Excel', free: '—', l1: '—', l2: 'Yes' },
              { feature: 'History retention', free: '3 months', l1: '12 months', l2: 'Unlimited' },
            ].map(r => (
              <div key={r.feature} className="p-2 rounded-lg bg-cream-200/50">
                <div className="text-ink-400 mb-1">{r.feature}</div>
                <div className={`font-medium ${user.tier === 'Free' ? 'text-ink' : user.tier === 'L1' ? 'text-teal' : 'text-leaf'}`}>
                  {user.tier === 'Free' ? r.free : user.tier === 'L1' ? r.l1 : r.l2}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Multi-currency (L2) */}
      <Card className="p-6">
        <div className="font-serif text-2xl mb-5">Currency preferences</div>
        {user.tier === 'L2' ? (
          <div className="space-y-4">
            <Field label="Base currency for reports" hint="Multi-statement analysis normalises to this currency at statement-date rates. Exchange rate cited in every report.">
              <Select value={currency} onChange={e => { setCurrency(e.target.value); addToast({ type: 'success', title: `Base currency set to ${e.target.value}` }); }}>
                {['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'MXN'].map(c => <option key={c}>{c}</option>)}
              </Select>
            </Field>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-4 bg-cream-200/60 rounded-xl border hair">
            <Icon.Lock size={16} className="text-ink-400 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium">Multi-currency support is a Level 2 feature.</div>
              <div className="text-[12px] text-ink-400">Analyse statements in EUR, GBP, CAD, AUD and more with automatic conversion.</div>
            </div>
            <a href="/upgrade"><Btn variant="teal" size="sm">Upgrade</Btn></a>
          </div>
        )}
      </Card>

      {/* Notifications */}
      <Card className="p-6">
        <div className="font-serif text-2xl mb-5">Email & notification preferences</div>
        <div className="space-y-5">
          <Toggle
            checked={notifyParse}
            onChange={setNotifyParse}
            label="Parsing complete"
            hint="In-app + simulated email notification when a statement finishes parsing (simulated in demo mode)."
          />
          <Toggle
            checked={notifyReport}
            onChange={setNotifyReport}
            label="Report ready"
            hint="In-app + simulated email when a full analysis with benchmarks is available."
          />
          <Toggle
            checked={notifyStale}
            onChange={setNotifyStale}
            label="Benchmark staleness alerts"
            hint="In-app alert when rate panel data for an acquirer exceeds 90 days (amber threshold)."
          />
        </div>
        <div className="mt-4 p-3 bg-amber-soft/30 border border-amber/30 rounded-lg text-[12px] text-ink-500 flex items-start gap-2">
          <Icon.Info size={14} className="text-amber mt-0.5 shrink-0" />
          Email delivery is simulated in demo mode. In production, emails are sent via a registered sending domain (e.g. Resend or SendGrid). Connect a real email service in Settings → Integrations.
        </div>
        <Btn variant="outline" size="sm" className="mt-4" onClick={saveNotifications} icon={<Icon.Check size={14} />}>Save preferences</Btn>
      </Card>

      {/* Data & privacy */}
      <Card className="p-6">
        <div className="font-serif text-2xl mb-5">Data & privacy (GDPR · CCPA)</div>
        <div className="divide-hair">
          <div className="py-4 first:pt-0 flex items-start gap-4">
            <Icon.Download size={16} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium">Download my data</div>
              <div className="text-[12px] text-ink-400">Export all statements, analyses, and account data as JSON. Your right under CCPA/GDPR.</div>
            </div>
            <Btn variant="outline" size="sm" onClick={handleDataExport}>Export now</Btn>
          </div>
          <div className="py-4 flex items-start gap-4">
            <Icon.Sparkles size={16} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <Toggle
                checked={t3Consent}
                onChange={handleT3Consent}
                label="Contribute anonymised rate data to benchmarking (T3)"
                hint="Your parsed rates (never your business details or MID) contribute to OptiSMB's SMB rate panel. This improves benchmark accuracy for all users. Explicit opt-in required — off by default."
              />
            </div>
          </div>
          <div className="py-4 flex items-start gap-4">
            <Icon.X size={16} className="text-rose mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-rose">Delete my account</div>
              <div className="text-[12px] text-ink-400">Your data will be permanently purged within 30 days. Audit logs are retained for 7 years under US financial data retention rules (explained upon deletion).</div>
            </div>
            <Btn variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete account</Btn>
          </div>
        </div>
      </Card>

      {/* Security */}
      <Card className="p-6">
        <div className="font-serif text-2xl mb-5">Security</div>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Icon.Lock size={16} className="text-ink-400 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium">Password</div>
              <div className="text-[12px] text-ink-400">Last changed: not available in demo mode</div>
            </div>
            <Btn variant="outline" size="sm" onClick={() => addToast({ type: 'info', title: 'Password reset email sent (simulated)' })}>Change password</Btn>
          </div>
          <div className="flex items-center gap-4">
            <Icon.Shield size={16} className="text-ink-400 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium">Two-factor authentication</div>
              <div className="text-[12px] text-ink-400">MFA available for Level 2 accounts — adds TOTP authenticator app protection.</div>
            </div>
            {user.tier === 'L2'
              ? <Btn variant="outline" size="sm" onClick={() => addToast({ type: 'info', title: 'MFA setup (simulated)' })}>Enable MFA</Btn>
              : <Btn variant="outline" size="sm" disabled icon={<Icon.Lock size={13} />}>Level 2</Btn>}
          </div>
          <div className="flex items-center gap-4">
            <Icon.History size={16} className="text-ink-400 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium">Active sessions</div>
              <div className="text-[12px] text-ink-400">1 active session · this browser</div>
            </div>
            <Btn variant="outline" size="sm" onClick={() => { logout(); router.push('/login'); }}>Sign out all</Btn>
          </div>
        </div>
      </Card>

      {/* Delete modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-6">
          <Card className="max-w-md w-full p-6">
            <div className="flex items-start gap-3 mb-5">
              <Icon.AlertTriangle className="text-rose mt-0.5 shrink-0" size={18} />
              <div>
                <div className="font-serif text-2xl">Delete this account?</div>
                <div className="text-[13px] text-ink-500 mt-1">
                  All statements, analyses, and settings will be permanently deleted within 30 days. Audit logs are
                  retained for 7 years per US financial data retention requirements.
                </div>
              </div>
            </div>
            <Field label="Type DELETE to confirm">
              <Input placeholder="DELETE" value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)} />
            </Field>
            <div className="flex gap-2 justify-end mt-4">
              <Btn variant="ghost" onClick={() => { setConfirmDelete(false); setDeleteConfirmText(''); }}>Cancel</Btn>
              <Btn variant="danger" onClick={handleDeleteAccount}>Permanently delete</Btn>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
