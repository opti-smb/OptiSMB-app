'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Icon from '@/components/Icons';
import { Card, Btn, Pill, TierBadge } from '@/components/UI';
import { useApp } from '@/components/AppContext';
import { useToast } from '@/components/Toast';

const PLANS = [
  {
    id: 'Free', name: 'Free', monthlyPrice: 0, annualPrice: 0, per: 'forever',
    features: {
      'Single statement parse': true,
      'Fee breakdown with confidence': true,
      'Last 3 months of history': true,
      'Discrepancy report': false,
      'Benchmarking savings': false,
      'Q&A assistant': false,
      'Merchant agreement upload': false,
      'What-if modelling': false,
      'Bulk upload + OCR': false,
      'Excel exports': false,
      'Multi-currency support': false,
      'API access': false,
    },
  },
  {
    id: 'L1', name: 'Level 1', monthlyPrice: 39, annualPrice: 390, per: '/month', badge: 'Most popular',
    features: {
      'Single statement parse': true,
      'Fee breakdown with confidence': true,
      'Last 3 months of history': true,
      'Discrepancy report': true,
      'Benchmarking savings': true,
      'Q&A assistant': true,
      'Merchant agreement upload': true,
      'What-if modelling': false,
      'Bulk upload + OCR': false,
      'Excel exports': false,
      'Multi-currency support': false,
      'API access': false,
    },
  },
  {
    id: 'L2', name: 'Level 2', monthlyPrice: 99, annualPrice: 990, per: '/month',
    features: {
      'Single statement parse': true,
      'Fee breakdown with confidence': true,
      'Last 3 months of history': true,
      'Discrepancy report': true,
      'Benchmarking savings': true,
      'Q&A assistant': true,
      'Merchant agreement upload': true,
      'What-if modelling': true,
      'Bulk upload + OCR': true,
      'Excel exports': true,
      'Multi-currency support': true,
      'API access': true,
    },
  },
];

export default function UpgradePage() {
  const [annual, setAnnual] = useState(true);
  const { user, updateTier } = useApp();
  const { addToast } = useToast();
  const router = useRouter();

  const featureKeys = Object.keys(PLANS[0].features);

  const handleChoose = (plan) => {
    updateTier(plan.id);
    addToast({
      type: 'success',
      title: `Switched to ${plan.name}`,
      message: plan.id === 'Free' ? 'You\'re now on the Free tier.' : `${plan.name} features are now unlocked.`,
    });
    router.push('/dashboard');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="smallcaps text-ink-400 mb-2">Billing</div>
          <h1 className="font-serif text-5xl leading-tight">Pick a plan that earns itself back.</h1>
        </div>
        <div className="flex items-center gap-3 text-sm bg-cream-100 border hair rounded-full p-1">
          <button onClick={() => setAnnual(false)} className={`px-3 h-8 rounded-full transition ${!annual ? 'bg-ink text-cream' : 'text-ink-500'}`}>Monthly</button>
          <button onClick={() => setAnnual(true)} className={`px-3 h-8 rounded-full flex items-center gap-2 transition ${annual ? 'bg-ink text-cream' : 'text-ink-500'}`}>
            Annual <Pill tone="teal" className="!text-[10px] !py-0 !px-1.5">save 2 months</Pill>
          </button>
        </div>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left px-6 py-5 w-[40%]" />
              {PLANS.map(p => (
                <th key={p.id} className={`px-5 py-5 text-left align-top ${p.badge ? 'bg-ink text-cream' : ''}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`smallcaps ${p.badge ? 'text-teal-bright' : 'text-ink-400'}`}>{p.name}</span>
                    {p.badge && <Pill tone="teal">{p.badge}</Pill>}
                    {user.tier === p.id && <Pill tone="leaf">Current</Pill>}
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="font-serif text-4xl tabular">
                      {p.id === 'Free' ? '$0' : annual ? `$${p.annualPrice}` : `$${p.monthlyPrice}`}
                    </span>
                    <span className={`text-[12px] ${p.badge ? 'text-cream/60' : 'text-ink-400'}`}>
                      {p.id === 'Free' ? 'forever' : annual ? '/year' : '/month'}
                    </span>
                  </div>
                  {annual && p.id !== 'Free' && (
                    <div className={`text-[11px] mt-1 ${p.badge ? 'text-cream/50' : 'text-ink-400'}`}>= ${p.monthlyPrice}/mo billed annually</div>
                  )}
                  <div className="mt-4">
                    {user.tier === p.id
                      ? <Btn variant={p.badge ? 'teal' : 'outline'} size="sm" className="w-full" disabled>Current plan</Btn>
                      : <Btn variant={p.badge ? 'teal' : 'outline'} size="sm" className="w-full" onClick={() => handleChoose(p)}>
                        {p.id === 'Free' ? 'Downgrade' : 'Choose plan'}
                      </Btn>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-hair">
            {featureKeys.map(k => (
              <tr key={k}>
                <td className="px-6 py-3 text-ink-500">{k}</td>
                {PLANS.map(p => (
                  <td key={p.id} className="px-5 py-3">
                    {p.features[k]
                      ? <Icon.Check size={16} className="text-leaf" />
                      : <Icon.X size={14} className="text-ink-300" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="text-[11px] text-ink-400 max-w-3xl">
        OptiSMB may receive a referral fee from acquirers you engage via our platform. This income funds the free tier and does not affect rankings or recommendations, which are driven solely by projected saving for your profile. Disclosures appear beside every recommendation.
      </div>

      {/* ROI calculator */}
      <Card className="p-6 bg-ink text-cream border-ink">
        <div className="grid md:grid-cols-2 gap-6 items-center">
          <div>
            <div className="smallcaps text-teal-bright mb-2">ROI reality check</div>
            <h3 className="font-serif text-3xl">Level 1 pays for itself in 3 days.</h3>
            <p className="text-cream/70 text-[14px] mt-3">If we find even one overcharge on your monthly statement — a volume rebate not applied, an interchange rate miscalculated — the $39/month subscription is recouped in minutes.</p>
          </div>
          <div className="space-y-3">
            {[
              ['Average overpayment found', '$14,275/yr'],
              ['Level 1 cost', '$390/yr'],
              ['Return on subscription', '36x'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between border-b border-cream/10 pb-3 last:border-0">
                <span className="text-cream/70 text-[14px]">{label}</span>
                <span className="font-serif text-2xl text-teal-bright tabular">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
