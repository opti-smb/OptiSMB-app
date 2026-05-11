'use client';
import { useState } from 'react';
import { Lock, ArrowRight, Info, Check } from './Icons';
import { tierOk } from '@/lib/utils';

export function Btn({ variant = 'primary', size = 'md', icon, children, className = '', disabled, ...p }) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium transition ring-focus disabled:opacity-40 disabled:cursor-not-allowed';
  const sz = { sm: 'h-8 px-3 text-[13px]', md: 'h-10 px-4 text-sm', lg: 'h-12 px-5 text-[15px]' }[size];
  const v = {
    primary: 'bg-ink text-cream hover:bg-ink-900 rounded-full',
    teal: 'bg-teal-bright text-ink hover:bg-teal rounded-full',
    ghost: 'text-ink hover:bg-ink/5 rounded-full',
    outline: 'border hair text-ink hover:bg-ink/5 rounded-full',
    danger: 'bg-rose text-cream hover:opacity-90 rounded-full',
  }[variant] ?? 'bg-ink text-cream hover:bg-ink-900 rounded-full';
  return (
    <button disabled={disabled} className={`${base} ${sz} ${v} ${className}`} {...p}>
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
}

export function Card({ className = '', children, ...p }) {
  return <div className={`bg-cream-100 border hair rounded-xl shadow-card ${className}`} {...p}>{children}</div>;
}

export function Pill({ tone = 'ink', children, className = '' }) {
  const tones = {
    ink: 'bg-ink/5 text-ink-700 border-ink/10',
    teal: 'bg-teal-dim text-teal border-teal/20',
    amber: 'bg-amber-soft text-amber border-amber/20',
    rose: 'bg-rose-soft text-rose border-rose/20',
    leaf: 'bg-leaf-soft text-leaf border-leaf/20',
    cream: 'bg-cream-200 text-ink border-ink/10',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${tones[tone] || tones.ink} ${className}`}>
      {children}
    </span>
  );
}

export function TierBadge({ tier = 'L1' }) {
  const map = { Free: { tone: 'ink', label: 'Free' }, L1: { tone: 'teal', label: 'Level 1' }, L2: { tone: 'leaf', label: 'Level 2' } }[tier] || { tone: 'ink', label: tier };
  return <Pill tone={map.tone}>{map.label}</Pill>;
}

export function TierGate({ needed = 'L1', currentTier = 'Free', onUpgrade, children, reason, inline = false }) {
  if (tierOk(currentTier, needed)) return children;
  if (inline) {
    return (
      <div className="border hair rounded-xl bg-cream-200/60 p-4 flex items-center gap-3">
        <Lock size={18} className="text-ink-500" />
        <div className="flex-1">
          <div className="text-sm font-medium">{reason || 'Locked on your current plan'}</div>
          <div className="text-xs text-ink-400">Upgrade to {needed === 'L2' ? 'Level 2' : 'Level 1'} to unlock.</div>
        </div>
        <Btn variant="teal" size="sm" onClick={onUpgrade}>Upgrade</Btn>
      </div>
    );
  }
  return (
    <div className="relative border hair rounded-xl overflow-hidden bg-cream-100">
      <div className="pointer-events-none select-none opacity-40 blur-[2px]">{children}</div>
      <div className="absolute inset-0 bg-cream-100/80 backdrop-blur-[1px] flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="w-10 h-10 mx-auto rounded-full border hair flex items-center justify-center mb-3 bg-cream">
            <Lock size={18} />
          </div>
          <div className="smallcaps text-ink-400 mb-1">{needed === 'L2' ? 'Level 2' : 'Level 1'} feature</div>
          <h3 className="font-serif text-2xl leading-tight mb-2">{reason || 'Unlock this analysis'}</h3>
          <p className="text-sm text-ink-500 mb-4">Available from $39/month.</p>
          <Btn variant="primary" onClick={onUpgrade}>View plans <ArrowRight size={14} /></Btn>
        </div>
      </div>
    </div>
  );
}

export function Disclaimer({ tone = 'info', children, collapsible = true }) {
  const [open, setOpen] = useState(true);
  const color = tone === 'warn' ? 'bg-amber-soft/60 border-amber/30' : 'bg-cream-200 border-ink/10';
  return (
    <div className={`border rounded-lg px-3 py-2 text-[12px] text-ink-500 ${color} flex gap-2 items-start`}>
      <Info size={14} className="mt-0.5 shrink-0" />
      <div className="flex-1">{open ? children : <span className="opacity-70">Disclaimer available.</span>}</div>
      {collapsible && (
        <button className="text-ink-400 hover:text-ink whitespace-nowrap text-[11px]" onClick={() => setOpen(o => !o)}>
          {open ? 'Collapse' : 'Expand'}
        </button>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <button type="button" role="switch" aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 shrink-0 w-9 h-5 rounded-full transition relative ${checked ? 'bg-ink' : 'bg-ink/20'}`}>
        <span className={`absolute top-0.5 ${checked ? 'left-4' : 'left-0.5'} w-4 h-4 rounded-full bg-cream transition-all`} />
      </button>
      {(label || hint) && (
        <div className="flex-1">
          <div className="text-sm">{label}</div>
          {hint && <div className="text-xs text-ink-400">{hint}</div>}
        </div>
      )}
    </label>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="smallcaps text-ink-400 mb-1.5">{typeof label === 'string' ? label : label}</div>
      {children}
      {hint && <div className="text-[11px] text-ink-400 mt-1">{hint}</div>}
    </label>
  );
}

export function Input({ className = '', ...props }) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-cream-100 border hair rounded-lg text-sm outline-none focus:border-ink transition ${className}`}
    />
  );
}

export function Select({ children, className = '', ...p }) {
  return (
    <select {...p} className={`w-full h-10 px-3 bg-cream-100 border hair rounded-lg text-sm outline-none focus:border-ink ${className}`}>
      {children}
    </select>
  );
}

export function KPI({ label, value, delta, tone = 'ink', sub, big = false }) {
  const toneClass = { ink: 'text-ink', teal: 'text-teal', amber: 'text-amber', leaf: 'text-leaf', rose: 'text-rose' }[tone] || 'text-ink';
  const valueSz = big ? 'text-3xl sm:text-4xl xl:text-5xl leading-tight' : 'text-3xl sm:text-4xl leading-tight';
  return (
    <div className="p-5 flex flex-col gap-1 min-w-0">
      <div className="smallcaps text-ink-400">{label}</div>
      <div className={`font-serif ${valueSz} tabular break-words ${toneClass}`}>{value}</div>
      {sub && <div className="text-[12px] text-ink-400 mt-1">{sub}</div>}
      {delta && <div className={`text-[12px] mt-1 tabular ${delta.tone === 'good' ? 'text-leaf' : delta.tone === 'bad' ? 'text-rose' : 'text-ink-400'}`}>{delta.text}</div>}
    </div>
  );
}

export function ConfidenceBadge({ level = 'high', label, asOf }) {
  const cfg = {
    high: { cls: 'bg-leaf-soft text-leaf border-leaf/30', dot: 'bg-leaf', text: label || '✓ Verified — Regulatory Source' },
    medium: { cls: 'bg-amber-soft text-amber border-amber/30', dot: 'bg-amber', text: label || '~ Indicative — SMB Reported' },
    low: { cls: 'bg-rose-soft text-rose border-rose/30', dot: 'bg-rose', text: label || '⚠ Estimated — Floor Rate Only' },
  }[level] || { cls: 'bg-cream-200 text-ink-400 border-ink/10', dot: 'bg-ink/20', text: label || '— Unknown' };
  return (
    <div className="inline-flex flex-col">
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium ${cfg.cls}`}>
        <span className={`dot ${cfg.dot}`} />{cfg.text}
      </span>
      {asOf && <span className="text-[10px] text-ink-400 mt-1 font-mono">data as of {asOf}</span>}
    </div>
  );
}

export function DualConfidence({ parsing = 'high', rate = 'medium', asOf = '12 Apr 2026' }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="smallcaps text-ink-400 mb-1">Parsing Confidence</div>
        <ConfidenceBadge level={parsing} asOf={asOf} />
      </div>
      <div>
        <div className="smallcaps text-ink-400 mb-1">Rate Data Confidence</div>
        <ConfidenceBadge level={rate} asOf={asOf} />
      </div>
    </div>
  );
}

export function Tooltip({ label, children }) {
  return (
    <span className="relative group inline-flex items-center">
      {children}
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-2 -translate-y-full whitespace-nowrap bg-ink text-cream text-[11px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition">
        {label}
      </span>
    </span>
  );
}

export function EmptyState({ icon, title, body, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="w-14 h-14 rounded-full bg-cream-200 border hair flex items-center justify-center mb-4 text-ink-400">{icon}</div>}
      <h3 className="font-serif text-2xl mb-2">{title}</h3>
      {body && <p className="text-[14px] text-ink-500 max-w-sm mb-5">{body}</p>}
      {action}
    </div>
  );
}

export function SectionHeader({ eyebrow, title, children }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-1">
      <div>
        {eyebrow && <div className="smallcaps text-ink-400 mb-2">{eyebrow}</div>}
        <h1 className="font-serif text-4xl md:text-[40px] leading-[1.1]">{title}</h1>
      </div>
      {children && <div className="flex gap-2 shrink-0">{children}</div>}
    </div>
  );
}
