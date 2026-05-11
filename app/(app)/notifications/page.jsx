'use client';

import Link from 'next/link';
import * as Icon from '@/components/Icons';
import { Card, Btn } from '@/components/UI';

/** In-app notification queue removed; bell remains for future use. */
export default function NotificationsPage() {
  return (
    <div className="max-w-xl mx-auto space-y-6">
      <header>
        <h1 className="font-serif text-3xl md:text-4xl tracking-tight">Notifications</h1>
        <p className="text-[14px] text-ink-500 mt-2">You have no notifications right now.</p>
      </header>
      <Card className="p-8 text-center">
        <div className="w-12 h-12 rounded-full border hair mx-auto flex items-center justify-center text-ink-400 mb-4">
          <Icon.Bell size={22} />
        </div>
        <p className="text-[14px] text-ink-500">We will surface parse and report updates here when enabled.</p>
        <Link href="/dashboard" className="inline-block mt-6">
          <Btn variant="outline" icon={<Icon.LayoutDashboard size={14} />}>
            Back to dashboard
          </Btn>
        </Link>
      </Card>
    </div>
  );
}
