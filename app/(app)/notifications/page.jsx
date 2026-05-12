'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as Icon from '@/components/Icons';
import { Card, Btn } from '@/components/UI';
import { useApp } from '@/components/AppContext';

function formatWhen(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function NotificationsPage() {
  const router = useRouter();
  const {
    inAppNotifications,
    unreadNotificationCount,
    markNotificationRead,
    markAllNotificationsRead,
    dismissNotification,
    setCurrentStatementId,
  } = useApp();

  const onOpen = (n) => {
    markNotificationRead(n.id);
    if (n.statementId) setCurrentStatementId(n.statementId);
    if (n.href) router.push(n.href);
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl md:text-4xl tracking-tight">Notifications</h1>
          <p className="text-[14px] text-ink-500 mt-2">
            {inAppNotifications.length === 0
              ? 'Nothing here yet — upload a statement to get parse updates.'
              : `${inAppNotifications.length} notification${inAppNotifications.length === 1 ? '' : 's'}${unreadNotificationCount ? ` · ${unreadNotificationCount} unread` : ''}`}
          </p>
        </div>
        {unreadNotificationCount > 0 ? (
          <Btn variant="outline" size="sm" onClick={markAllNotificationsRead}>
            Mark all read
          </Btn>
        ) : null}
      </header>

      {inAppNotifications.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="w-12 h-12 rounded-full border hair mx-auto flex items-center justify-center text-ink-400 mb-4">
            <Icon.Bell size={22} />
          </div>
          <p className="text-[14px] text-ink-500">
            Parse and save events appear here. The bell in the header shows unread count.
          </p>
          <Link href="/upload" className="inline-block mt-6">
            <Btn variant="primary" icon={<Icon.Upload size={14} />}>
              Upload statement
            </Btn>
          </Link>
        </Card>
      ) : (
        <div className="space-y-2">
          {inAppNotifications.map((n) => (
            <Card
              key={n.id}
              className={`p-4 flex gap-3 ${n.read ? 'opacity-75' : 'ring-1 ring-teal/25 bg-cream-100'}`}
            >
              <div className={`mt-0.5 shrink-0 w-2 h-2 rounded-full ${n.read ? 'bg-ink/20' : 'bg-teal'}`} />
              <div className="flex-1 min-w-0 text-left">
                <div className="text-sm font-medium">{n.title}</div>
                {n.body ? <div className="text-[13px] text-ink-500 mt-1">{n.body}</div> : null}
                <div className="text-[11px] text-ink-400 font-mono mt-2">{formatWhen(n.createdAt)}</div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {n.href ? (
                    <Btn variant="primary" size="sm" onClick={() => onOpen(n)}>
                      Open report
                    </Btn>
                  ) : (
                    <Btn variant="outline" size="sm" onClick={() => markNotificationRead(n.id)}>
                      Mark read
                    </Btn>
                  )}
                  <button
                    type="button"
                    className="text-[12px] text-ink-400 hover:text-ink underline underline-offset-2"
                    onClick={() => dismissNotification(n.id)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="text-center">
        <Link href="/dashboard">
          <Btn variant="ghost" icon={<Icon.LayoutDashboard size={14} />}>
            Back to dashboard
          </Btn>
        </Link>
      </div>
    </div>
  );
}
