'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as Icon from '@/components/Icons';
import { Pill, TierBadge, Btn } from '@/components/UI';
import { useApp } from '@/components/AppContext';
import { tierOk } from '@/lib/utils';

const NAV = [
  { key: '/dashboard', label: 'Dashboard', icon: <Icon.LayoutDashboard /> },
  { key: '/upload', label: 'Upload statement', icon: <Icon.Upload /> },
  { key: '/analyses', label: 'Analyses', icon: <Icon.History /> },
  { key: '/report', label: 'Report', icon: <Icon.Receipt /> },
  { key: '/whatif', label: 'What-if modelling', icon: <Icon.Bolt />, tier: 'L2' },
  { key: '/notifications', label: 'Notifications', icon: <Icon.Bell /> },
  { key: '/settings', label: 'Settings', icon: <Icon.Settings /> },
  { key: '/upgrade', label: 'Subscription', icon: <Icon.CreditCard /> },
  { key: '/help', label: 'Help & support', icon: <Icon.HelpCircle /> },
];

export default function AppLayout({ children }) {
  const { isAuthenticated, user, statements, getCurrentStatement } = useApp();
  const [navOpen, setNavOpen] = useState(false);
  const [searchVal, setSearchVal] = useState('');
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login');
  }, [isAuthenticated, router]);

  if (!isAuthenticated) return null;

  const currentStmt = getCurrentStatement();
  const recentStmts = statements.slice(0, 3);

  const activeLabel = NAV.find(n => pathname.startsWith(n.key))?.label || 'Dashboard';

  return (
    <div className="min-h-screen grain">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 w-[260px] bg-cream-100 hair-r z-40 p-5 flex flex-col transition-transform duration-200 ${navOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
        <Link href="/" className="flex items-center gap-2 mb-8">
          <Icon.Logo size={28} />
          <div>
            <div className="font-serif text-xl leading-none">OptiSMB</div>
            <div className="smallcaps text-ink-400 text-[10px]">Acquirer audit</div>
          </div>
        </Link>

        <div className="smallcaps text-ink-400 text-[10px] mb-2">Workspace</div>
        <nav className="space-y-0.5 mb-6">
          {NAV.map(({ key, label, icon, tier }) => {
            const locked = tier && !tierOk(user.tier, tier);
            const active = pathname.startsWith(key);
            return (
              <Link key={key} href={key} onClick={() => setNavOpen(false)}
                className={`w-full flex items-center gap-3 px-3 h-9 rounded-lg text-[13px] transition ${active ? 'bg-ink text-cream' : 'text-ink-500 hover:bg-ink/5'}`}>
                {icon && <span className="shrink-0">{icon}</span>}
                <span className="flex-1 truncate">{label}</span>
                {tier === 'L2' && !active && <Pill tone="leaf" className="!text-[9px] !py-0">L2</Pill>}
                {key === '/upgrade' && user.tier === 'Free' && !active && <Pill tone="teal" className="!text-[9px] !py-0">Upgrade</Pill>}
              </Link>
            );
          })}
        </nav>

        {recentStmts.length > 0 && (
          <div className="mb-4">
            <div className="smallcaps text-ink-400 text-[10px] mb-2">Recent reports</div>
            <div className="space-y-0.5 text-[12px]">
              {recentStmts.map((s, i) => (
                <Link key={s.id} href="/report" onClick={() => setNavOpen(false)}
                  className={`w-full text-left px-3 h-8 rounded-md flex items-center gap-2 ${i === 0 ? 'bg-cream-200' : 'hover:bg-cream-200/60'}`}>
                  <span className={`dot ${i === 0 ? 'bg-teal' : 'bg-ink/20'}`} />
                  {s.acquirer} · {s.period}
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="mt-auto">
          <div className="bg-cream-200/60 border hair rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-ink text-cream flex items-center justify-center text-[12px] font-medium">{user.initials || 'HR'}</div>
              <div className="min-w-0">
                <div className="text-[13px] truncate">{user.business || user.name}</div>
                <div className="flex items-center gap-1"><TierBadge tier={user.tier} /></div>
              </div>
            </div>
            {user.tier === 'Free' && (
              <Link href="/upgrade"><Btn variant="primary" size="sm" className="w-full mt-1">Upgrade</Btn></Link>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="md:pl-[260px] flex flex-col min-h-screen">
        {/* Topbar */}
        <header className="hair-b bg-cream sticky top-0 z-30 no-print">
          <div className="h-16 px-5 md:px-8 flex items-center gap-4">
            <button className="md:hidden w-9 h-9 rounded-lg border hair flex items-center justify-center" onClick={() => setNavOpen(o => !o)}>
              <Icon.LayoutDashboard size={16} />
            </button>
            <div className="flex items-center gap-2 text-[13px] text-ink-500 truncate">
              <span className="truncate">{user.business || user.name}</span>
              <Icon.ChevronRight size={12} className="text-ink-300 shrink-0" />
              <span className="text-ink truncate">{activeLabel}</span>
            </div>
            <div className="flex-1" />
            <div className="relative hidden md:flex items-center w-72 h-9 rounded-full border hair bg-cream-100 px-3 text-[13px] text-ink-400">
              <Icon.Search size={14} />
              <input
                value={searchVal}
                onChange={e => setSearchVal(e.target.value)}
                placeholder="Search statements, fees, acquirers…"
                className="bg-transparent flex-1 px-2 outline-none text-ink"
              />
              <span className="font-mono text-[10px]">⌘K</span>
            </div>
            <Link
              href="/notifications"
              className="w-9 h-9 rounded-full border hair flex items-center justify-center hover:bg-ink/5 transition shrink-0"
              aria-label="Notifications"
            >
              <Icon.Bell size={15} />
            </Link>
            <div className="w-9 h-9 rounded-full bg-ink text-cream flex items-center justify-center text-[12px] font-medium">{user.initials || 'HR'}</div>
          </div>
        </header>

        <main className="p-5 md:p-8 max-w-[1280px] w-full flex-1">
          {children}
        </main>
      </div>

      {navOpen && <div className="fixed inset-0 bg-ink/30 z-30 md:hidden" onClick={() => setNavOpen(false)} />}
    </div>
  );
}
