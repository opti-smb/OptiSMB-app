'use client';

/**
 * Centered loading UI while `/api/parse` runs. Cycles human-readable steps every 1–1.5s
 * and shows a slow-path reassurance after ~7s.
 *
 * Integration (upload flow):
 *   const [step, setStep] = useState(0);
 *   setStep(1);
 *   const result = await fetch('/api/parse', { method: 'POST', body: formData }).then(...);
 *   setStep(2);
 *   // Render: <StatementParseLoading active={step === 1} fileName={file?.name} />
 */

import { useEffect, useState } from 'react';
import * as Icon from '@/components/Icons';

const STEP_MESSAGES = [
  'Uploading file...',
  'Reading statement...',
  'Extracting data...',
  'Analyzing fees...',
  'Finalizing insights...',
];

const CYCLE_MS_MIN = 1000;
const CYCLE_MS_MAX = 1500;
const SLOW_HINT_AFTER_MS = 7000;

function nextCycleMs() {
  return CYCLE_MS_MIN + Math.floor(Math.random() * (CYCLE_MS_MAX - CYCLE_MS_MIN + 1));
}

export function StatementParseLoading({ active, fileName }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [showSlowHint, setShowSlowHint] = useState(false);

  useEffect(() => {
    if (!active) {
      setStepIndex(0);
      setShowSlowHint(false);
      return;
    }

    setStepIndex(0);
    setShowSlowHint(false);

    let cancelled = false;
    const cycleRef = { id: null };
    let slowTimer;

    const loop = () => {
      if (cancelled) return;
      setStepIndex((i) => (i + 1) % STEP_MESSAGES.length);
      cycleRef.id = setTimeout(loop, nextCycleMs());
    };
    cycleRef.id = setTimeout(loop, nextCycleMs());

    slowTimer = setTimeout(() => {
      if (!cancelled) setShowSlowHint(true);
    }, SLOW_HINT_AFTER_MS);

    return () => {
      cancelled = true;
      clearTimeout(cycleRef.id);
      clearTimeout(slowTimer);
    };
  }, [active]);

  if (!active) return null;

  const message = STEP_MESSAGES[stepIndex];

  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-10 max-w-lg mx-auto">
      <div className="relative w-24 h-24 mb-8" aria-hidden>
        <div className="absolute inset-0 rounded-full border-2 border-ink/10" />
        <div className="absolute inset-0 rounded-full border-2 border-ink border-t-transparent spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Icon.FileText size={28} className="text-ink/80" />
        </div>
      </div>

      <h3 className="font-serif text-2xl sm:text-3xl leading-tight text-ink mb-2">Processing your statement</h3>

      <p
        key={stepIndex}
        className="text-[15px] sm:text-base text-ink-600 font-medium min-h-[3rem] flex items-center justify-center px-2 fade-up"
      >
        {message}
      </p>

      {showSlowHint && (
        <p className="mt-3 text-[13px] text-amber-700 bg-amber-soft/80 border border-amber/25 rounded-lg px-4 py-2 max-w-md">
          This is taking longer than usual, still processing...
        </p>
      )}

      <div className="w-full max-w-sm mt-8 h-1.5 bg-ink/10 rounded-full overflow-hidden relative" role="progressbar" aria-valuetext={message}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-teal parse-indeterminate-fill" />
      </div>

      {fileName && fileName !== 'worldpay-mar26.pdf' && (
        <p className="mt-6 font-mono text-[11px] text-ink-400 truncate max-w-full">{fileName}</p>
      )}
    </div>
  );
}
