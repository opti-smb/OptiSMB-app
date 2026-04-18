'use client';
import { useState } from 'react';
import Link from 'next/link';
import * as Icon from '@/components/Icons';
import { Card, Btn, TierGate } from '@/components/UI';
import { useApp } from '@/components/AppContext';
import { useToast } from '@/components/Toast';

function Slider({ label, value, min, max, step, onChange, display, compact = false }) {
  return (
    <div className={compact ? 'mb-2' : ''}>
      {!compact && (
        <div className="flex items-center justify-between mb-1.5">
          <span className="smallcaps text-ink-400">{label}</span>
          <span className="font-mono text-[13px] tabular">{display}</span>
        </div>
      )}
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))} className="w-full" />
      {compact && <div className="text-[10px] text-ink-400 font-mono tabular mt-0.5">{display}</div>}
    </div>
  );
}

export default function WhatIfPage() {
  const { user, savedScenarios, saveScenario, deleteScenario } = useApp();
  const { addToast } = useToast();
  const [vol, setVol] = useState(95);
  const [aov, setAov] = useState(48);
  const [debit, setDebit] = useState(58);
  const [credit, setCredit] = useState(32);
  const [growth, setGrowth] = useState(8);
  const [scenarioName, setScenarioName] = useState('');

  const amex = Math.max(0, 100 - debit - credit);
  const effective = Math.max(0, (1.84 - (vol - 95) * 0.004 - (debit - 58) * 0.006 + (amex - 10) * 0.008)).toFixed(2);
  const annualFees = (vol * 12 * parseFloat(effective) / 100 * 1000).toFixed(0);

  const savings = {
    Stripe: Math.max(0, Math.round(18400 + (vol - 95) * 180 - (aov - 48) * 60 + growth * 400)),
    Adyen: Math.max(0, Math.round(14200 + (vol - 95) * 140 - (aov - 48) * 40 + growth * 310)),
    Clover: Math.max(0, Math.round(9800 + (vol - 95) * 90 - (aov - 48) * 20 + growth * 180)),
  };

  const reset = () => { setVol(95); setAov(48); setDebit(58); setCredit(32); setGrowth(8); };

  const handleSave = () => {
    if (!scenarioName.trim()) { addToast({ type: 'error', title: 'Enter a scenario name' }); return; }
    saveScenario({ name: scenarioName, vol, aov, debit, credit, growth, effectiveRate: effective });
    setScenarioName('');
    addToast({ type: 'success', title: 'Scenario saved', message: scenarioName });
  };

  const loadScenario = (sc) => {
    setVol(sc.vol); setAov(sc.aov); setDebit(sc.debit); setCredit(sc.credit); setGrowth(sc.growth);
    addToast({ type: 'info', title: `Loaded: ${sc.name}` });
  };

  return (
    <TierGate needed="L2" currentTier={user.tier} onUpgrade={() => { window.location.href = '/upgrade'; }} reason="Upgrade to Level 2 to model scenarios">
      <div className="space-y-6">
        <div>
          <div className="smallcaps text-ink-400 mb-2">What-if modelling · Level 2</div>
          <h1 className="font-serif text-5xl leading-tight">Project what you'd pay, <em className="text-teal">at any scale.</em></h1>
          <p className="text-ink-500 text-[14px] max-w-2xl mt-2">Move the sliders. The panel recalculates your projected effective rate and savings across the three recommended acquirers in real time.</p>
        </div>

        <div className="grid md:grid-cols-12 gap-5">
          {/* Sliders panel */}
          <Card className="md:col-span-5 p-6">
            <div className="smallcaps text-ink-400 mb-4">Scenario inputs</div>
            <div className="space-y-6">
              <Slider label="Monthly volume" value={vol} min={10} max={500} step={5} onChange={setVol} display={`$${vol}k / month`} />
              <Slider label="Average transaction value" value={aov} min={5} max={200} step={1} onChange={setAov} display={`$${aov}`} />
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="smallcaps text-ink-400">Card mix</span>
                  <span className="font-mono text-[12px] tabular">{debit}% · {credit}% · {amex}%</span>
                </div>
                <Slider label="Debit %" value={debit} min={0} max={100} step={1} onChange={v => setDebit(Math.min(v, 100 - credit))} display={`${debit}% debit`} compact />
                <Slider label="Credit %" value={credit} min={0} max={100} step={1} onChange={v => setCredit(Math.min(v, 100 - debit))} display={`${credit}% credit`} compact />
                <div className="text-[11px] text-ink-400 mt-1">Amex fills remainder · {amex}%</div>
              </div>
              <Slider label="YoY growth rate" value={growth} min={-20} max={50} step={1} onChange={setGrowth} display={`${growth}%`} />
            </div>
            <div className="mt-6 space-y-3">
              <div className="flex gap-2">
                <input value={scenarioName} onChange={e => setScenarioName(e.target.value)}
                  placeholder="Name this scenario…"
                  className="flex-1 h-9 px-3 bg-cream-100 border hair rounded-full text-[13px] outline-none focus:border-ink"
                  onKeyDown={e => e.key === 'Enter' && handleSave()} />
                <Btn variant="primary" size="sm" icon={<Icon.Plus size={13} />} onClick={handleSave}>Save</Btn>
              </div>
              <Btn variant="outline" size="sm" className="w-full" onClick={reset}>Reset to baseline</Btn>
            </div>
          </Card>

          {/* Live output */}
          <div className="md:col-span-7 space-y-4">
            <Card className="p-6 bg-ink text-cream border-ink">
              <div className="flex items-center justify-between">
                <div>
                  <div className="smallcaps text-teal-bright">Projected effective rate</div>
                  <div className="font-serif text-6xl tabular mt-1">{effective}%</div>
                </div>
                <div className="text-right">
                  <div className="smallcaps text-cream/50">Annualised fees</div>
                  <div className="font-mono text-2xl tabular">${Number(annualFees).toLocaleString()}</div>
                </div>
              </div>
              <div className="mt-5 text-[12px] text-cream/60">
                Recalculates in real time as you move inputs. Press <em>Save</em> to store this scenario.
              </div>
            </Card>

            <Card>
              <div className="p-5 hair-b font-serif text-xl">Projected savings vs current</div>
              <div className="divide-hair">
                {Object.entries(savings).map(([name, sav]) => (
                  <div key={name} className="px-5 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-cream-200 border hair flex items-center justify-center font-serif">{name[0]}</div>
                      <div>
                        <div className="font-medium">{name}</div>
                        <div className="text-[11px] text-ink-400">under this scenario</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-serif text-2xl tabular text-teal">${sav.toLocaleString()}<span className="text-[12px] text-ink-400">/yr</span></div>
                      <div className="text-[11px] text-ink-400">vs Chase baseline</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Saved scenarios */}
            <Card className="p-5">
              <div className="smallcaps text-ink-400 mb-3">Saved scenarios ({savedScenarios.length})</div>
              {savedScenarios.length === 0 ? (
                <div className="text-[13px] text-ink-400 text-center py-4">No saved scenarios yet. Name and save one above.</div>
              ) : (
                <div className="space-y-2 text-[13px]">
                  {savedScenarios.map(sc => (
                    <div key={sc.id} className="flex items-center justify-between hair-b pb-2 last:border-0 last:pb-0">
                      <div className="font-medium">{sc.name}</div>
                      <div className="font-mono text-[12px] text-ink-500 tabular">vol ${sc.vol}k · eff {sc.effectiveRate}%</div>
                      <div className="text-[11px] text-ink-400 font-mono">{sc.date}</div>
                      <div className="flex gap-2">
                        <button onClick={() => loadScenario(sc)} className="text-[12px] underline underline-offset-2">Load</button>
                        <button onClick={() => { deleteScenario(sc.id); addToast({ type: 'info', title: `"${sc.name}" deleted` }); }}
                          className="text-[12px] underline underline-offset-2 text-rose">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </TierGate>
  );
}
