'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import * as Icon from '@/components/Icons';
import { Btn, Pill, Card } from '@/components/UI';

function HeroGraphic() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStage(s => (s + 1) % 4), 1800);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="relative aspect-[5/4] rounded-2xl border hair bg-cream-100 overflow-hidden grain">
      <div className="absolute inset-0 p-6 flex flex-col">
        <div className="flex items-center justify-between text-[10px] text-ink-400 font-mono">
          <span>STATEMENT · WORLDPAY · Q1 2026</span>
          <span>{(stage + 1).toString().padStart(2, '0')}/04</span>
        </div>
        <div className={`mt-4 flex-1 rounded-lg border hair bg-cream p-4 transition-all ${stage >= 1 ? 'scale-95 -rotate-1' : ''}`}>
          <div className="h-2 w-20 bg-ink/20 rounded mb-3" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 py-1">
              <div className={`h-1.5 flex-1 rounded ${i % 3 === 0 ? 'bg-ink/30' : 'bg-ink/15'}`} />
              <div className="h-1.5 w-10 rounded bg-ink/20 font-mono" />
              {stage >= 2 && i === 2 && <span className="text-[9px] font-mono text-rose">+0.18%</span>}
              {stage >= 2 && i === 5 && <span className="text-[9px] font-mono text-amber">rebate?</span>}
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3 text-[10px] font-mono text-ink-400">
          {['UPLOAD', 'PARSE', 'SCORE', 'RESULT'].map((s, i) => (
            <div key={i} className={`flex items-center gap-1.5 ${stage >= i ? 'text-ink' : ''}`}>
              <span className={`dot ${stage > i ? 'bg-teal' : stage === i ? 'bg-teal-bright pulse-ring' : 'bg-ink/20'}`} />{s}
            </div>
          ))}
        </div>
        <div className={`absolute right-5 bottom-5 transition-all duration-500 ${stage >= 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
          <div className="bg-ink text-cream rounded-xl px-4 py-3 shadow-pop">
            <div className="smallcaps text-teal-bright">Statement summary</div>
            <div className="font-serif text-3xl tabular">1.84%</div>
            <div className="text-[11px] text-cream/60 mt-1 font-mono">effective rate</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PricingTable() {
  const [annual, setAnnual] = useState(true);
  const plans = [
    {
      tier: 'Free', price: '$0', per: 'forever', cta: 'Start free', features: [
        ['Single statement parse', true], ['Fee breakdown + confidence', true],
        ['Channel & payment mix views', true], ['Q&A assistant', false],
        ['What-if modelling', false], ['Bulk upload & exports', false],
      ]
    },
    {
      tier: 'Level 1', price: annual ? '$390' : '$39', per: annual ? '/year · save 2 months' : '/month',
      badge: 'Most popular', cta: 'Start 14-day trial', features: [
        ['Unlimited statement parses', true], ['Fee breakdown + confidence', true],
        ['Channel & payment mix views', true], ['Q&A assistant', true],
        ['What-if modelling', false], ['Bulk upload & exports', false],
      ]
    },
    {
      tier: 'Level 2', price: annual ? '$990' : '$99', per: annual ? '/year · save 2 months' : '/month',
      cta: 'Start 14-day trial', features: [
        ['Unlimited statement parses', true], ['Fee breakdown + confidence', true],
        ['Channel & payment mix views', true], ['Q&A assistant', true],
        ['What-if modelling (sliders)', true], ['Bulk upload, OCR & exports', true],
      ]
    },
  ];
  return (
    <section id="pricing" className="bg-cream-200/50 hair-t hair-b">
      <div className="max-w-[1200px] mx-auto px-6 py-24">
        <div className="flex items-end justify-between flex-wrap gap-6 mb-10">
          <div>
            <div className="smallcaps text-ink-400 mb-3">Plans</div>
            <h2 className="font-serif text-5xl leading-tight">Pay less than you're overpaying.</h2>
          </div>
          <div className="flex items-center gap-3 text-sm bg-cream-100 border hair rounded-full p-1">
            <button onClick={() => setAnnual(false)} className={`px-3 h-8 rounded-full transition ${!annual ? 'bg-ink text-cream' : 'text-ink-500'}`}>Monthly</button>
            <button onClick={() => setAnnual(true)} className={`px-3 h-8 rounded-full flex items-center gap-2 transition ${annual ? 'bg-ink text-cream' : 'text-ink-500'}`}>
              Annual <Pill tone="teal" className="!text-[10px] !py-0 !px-1.5">-17%</Pill>
            </button>
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {plans.map((p, i) => (
            <Card key={i} className={`p-7 flex flex-col ${p.badge ? 'ring-1 ring-ink' : ''}`}>
              <div className="flex items-center justify-between mb-4">
                <span className="smallcaps text-ink-400">{p.tier}</span>
                {p.badge && <Pill tone="teal">{p.badge}</Pill>}
              </div>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="font-serif text-5xl tabular">{p.price}</span>
                <span className="text-ink-400 text-[13px]">{p.per}</span>
              </div>
              <Link href="/register">
                <Btn variant={p.badge ? 'primary' : 'outline'} className="mt-5 w-full">{p.cta}</Btn>
              </Link>
              <div className="mt-6 space-y-2.5">
                {p.features.map((f, fi) => (
                  <div key={fi} className="flex items-center gap-2 text-[13px]">
                    {f[1] ? <Icon.Check size={14} className="text-leaf" /> : <Icon.X size={14} className="text-ink-300" />}
                    <span className={f[1] ? 'text-ink-700' : 'text-ink-400 line-through'}>{f[0]}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
        <p className="text-[11px] text-ink-400 mt-6 max-w-3xl">
          All prices exclude sales tax. OptiSMB may receive referral fees from acquirers you contact via our platform; disclosure appears wherever that applies.
        </p>
      </div>
    </section>
  );
}

export default function MarketingPage() {
  const compareRows = [
    ['Time to first analysis', '60 seconds', '2–6 weeks', '1–3 weeks'],
    ['Line-level fee extraction', 'Automated', 'Manual, limited', 'Variable'],
    ['Structured channel split', 'Yes', 'Sometimes', 'Depends on scope'],
    ['Dual confidence disclosure', 'Yes', 'No', 'No'],
    ['Cost', 'From $39/mo', '$500–2,000 one-off', '% of savings (5–20%)'],
    ['Referral disclosure', 'Always shown', 'N/A', 'Rarely shown'],
  ];

  return (
    <div className="min-h-screen bg-cream text-ink">
      {/* Nav */}
      <header className="hair-b sticky top-0 bg-cream z-40">
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon.Logo size={26} />
            <span className="font-serif text-xl tracking-tight">OptiSMB</span>
            <span className="smallcaps text-ink-400 ml-2">US</span>
          </div>
          <nav className="hidden md:flex items-center gap-7 text-[13px] text-ink-500">
            <a className="hover:text-ink" href="#how">How it works</a>
            <a className="hover:text-ink" href="#pricing">Pricing</a>
            <a className="hover:text-ink" href="#compare">Compare</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login"><Btn variant="ghost" size="sm">Sign in</Btn></Link>
            <Link href="/register"><Btn variant="primary" size="sm">Start free</Btn></Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="max-w-[1200px] mx-auto px-6 pt-20 pb-24 grid md:grid-cols-12 gap-10 items-center">
          <div className="md:col-span-7">
            <div className="smallcaps text-ink-400 mb-5 flex items-center gap-2">
              <span className="dot bg-teal-bright" /> For US small businesses · No advice given
            </div>
            <h1 className="font-serif text-[64px] md:text-[84px] leading-[0.95] tracking-tight">
              Stop overpaying<br />your <em className="text-teal">payment acquirer</em>.
            </h1>
            <p className="mt-6 text-[17px] text-ink-500 max-w-xl">
              Upload your acquiring statement. We read the fine print, extract every fee line, and summarise volume, channels, and payment mix — in about sixty seconds.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/register">
                <Btn variant="primary" size="lg" icon={<Icon.ArrowRight size={18} />}>
                  Analyse my statement — it's free
                </Btn>
              </Link>
              <span className="text-[12px] text-ink-400 font-mono">WCAG 2.1 AA · US CCPA/GLBA</span>
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-5 text-[12px] text-ink-400">
              <div className="flex items-center gap-2"><Icon.Shield size={14} /> US data residency</div>
              <div className="flex items-center gap-2"><Icon.Lock size={14} /> AES-256 for personal &amp; sensitive data</div>
              <div className="flex items-center gap-2"><Icon.Info size={14} /> Not a financial adviser</div>
            </div>
          </div>
          <div className="md:col-span-5"><HeroGraphic /></div>
        </div>
        <div className="hair-t hair-b bg-cream-200/60">
          <div className="max-w-[1200px] mx-auto px-6 py-4 flex items-center justify-between text-[12px] text-ink-500 font-mono tabular overflow-x-auto gap-6">
            <span>AVG. OVERPAYMENT · <span className="text-ink">$14,275/yr</span></span>
            <span className="hidden sm:inline">STATEMENTS PARSED · <span className="text-ink">18,392</span></span>
            <span className="hidden md:inline">FEE LINES READ · <span className="text-ink">2.4M</span></span>
            <span>P95 PARSE · <span className="text-ink">54s</span></span>
          </div>
        </div>
      </section>

      {/* Value props */}
      <section id="how" className="max-w-[1200px] mx-auto px-6 py-24">
        <div className="grid md:grid-cols-3 gap-px bg-ink/10 border hair rounded-2xl overflow-hidden">
          {[
            { icon: <Icon.Receipt size={18} />, t: 'See every fee line', d: 'Per-line fee categories and pass-throughs from your file — structured so you can trace amounts without rebuilding the spreadsheet yourself.' },
            { icon: <Icon.BarChart size={18} />, t: 'Channel & mix clarity', d: 'Channel volumes, effective rate, and parsed mix tables with dual confidence so you know what is rock-solid versus estimated.' },
            { icon: <Icon.Sparkles size={18} />, t: 'Plan with your numbers', d: 'Q&A on your parsed statement and what-if sliders on higher tiers — model scenarios with your own volumes, not a generic pitch deck.' },
          ].map((v, i) => (
            <div key={i} className="bg-cream p-8">
              <div className="w-10 h-10 rounded-lg bg-ink text-cream flex items-center justify-center mb-5">{v.icon}</div>
              <h3 className="font-serif text-2xl mb-2">{v.t}</h3>
              <p className="text-sm text-ink-500 leading-relaxed">{v.d}</p>
            </div>
          ))}
        </div>
      </section>

      <PricingTable />

      {/* Compare */}
      <section id="compare" className="max-w-[1200px] mx-auto px-6 py-24">
        <div className="max-w-2xl mb-10">
          <div className="smallcaps text-ink-400 mb-3">The alternatives</div>
          <h2 className="font-serif text-5xl leading-tight">Three ways to audit fees.<br />Only one finishes today.</h2>
        </div>
        <div className="border hair rounded-2xl overflow-hidden bg-cream-100">
          <div className="grid grid-cols-4 text-[12px] smallcaps text-ink-400 bg-cream-200/60 px-6 py-3">
            <div /><div>OptiSMB</div><div>Accountant review</div><div>Broker-assisted</div>
          </div>
          {compareRows.map((r, i) => (
            <div key={i} className={`grid grid-cols-4 px-6 py-4 text-[13px] ${i > 0 ? 'hair-t' : ''}`}>
              <div className="text-ink-500">{r[0]}</div>
              <div className="font-medium text-ink flex items-center gap-2"><span className="dot bg-teal" />{r[1]}</div>
              <div className="text-ink-500">{r[2]}</div>
              <div className="text-ink-500">{r[3]}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-[1200px] mx-auto px-6 pb-28">
        <div className="relative border hair rounded-2xl bg-ink text-cream p-10 md:p-16 overflow-hidden">
          <div className="absolute -right-20 -top-20 w-80 h-80 rounded-full bg-teal/15 blur-3xl" />
          <div className="relative grid md:grid-cols-2 gap-10 items-end">
            <div>
              <div className="smallcaps text-teal-bright mb-4">60 seconds · Free</div>
              <h2 className="font-serif text-5xl md:text-6xl leading-[0.95]">Drag in your<br />last statement.</h2>
            </div>
            <div>
              <p className="text-cream/70 text-[15px] mb-6 max-w-md">We show what you are being charged, how it breaks down, and where to dig deeper on the full report — so you can decide next steps with your adviser.</p>
              <Link href="/register"><Btn variant="teal" size="lg" icon={<Icon.ArrowRight size={16} />}>Start free analysis</Btn></Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="hair-t">
        <div className="max-w-[1200px] mx-auto px-6 py-10 flex flex-wrap items-center justify-between gap-4 text-[12px] text-ink-400">
          <div className="flex items-center gap-2">
            <Icon.Logo size={18} /><span className="font-serif text-base text-ink">OptiSMB</span>
            <span>· © 2026 OptiSMB Inc., New York</span>
          </div>
          <div className="flex gap-5">
            <a href="#">Privacy</a><a href="#">Terms</a><a href="#">Referral disclosures</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
