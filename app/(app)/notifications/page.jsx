'use client';
import Link from 'next/link';
import * as Icon from '@/components/Icons';
import { Card, Btn, Pill } from '@/components/UI';
import { useApp } from '@/components/AppContext';
import { useToast } from '@/components/Toast';

const TYPE_META = {
  report_ready: { icon: <Icon.FileText size={16} />, tone: 'teal', label: 'Report ready' },
  parse_complete: { icon: <Icon.CircleCheck size={16} />, tone: 'leaf', label: 'Parsed' },
  stale_data: { icon: <Icon.AlertTriangle size={16} />, tone: 'amber', label: 'Data update' },
  staleness_warn: { icon: <Icon.AlertTriangle size={16} />, tone: 'amber', label: 'Staleness alert' },
  discrepancy: { icon: <Icon.AlertTriangle size={16} />, tone: 'rose', label: 'Discrepancy' },
  agreement_uploaded: { icon: <Icon.FileText size={16} />, tone: 'leaf', label: 'Agreement' },
  default: { icon: <Icon.Bell size={16} />, tone: 'ink', label: 'Notification' },
};

function NotifRow({ n, onRead, onDismiss, dimmed }) {
  const meta = TYPE_META[n.type] || TYPE_META.default;
  const iconBg = {
    teal: 'bg-teal-dim text-teal',
    leaf: 'bg-leaf-soft text-leaf',
    amber: 'bg-amber-soft text-amber',
    rose: 'bg-rose-soft text-rose',
  }[meta.tone] || 'bg-cream-200 text-ink-500';

  return (
    <div className={`p-5 flex items-start gap-4 transition group ${dimmed ? 'opacity-60 hover:opacity-100' : 'hover:bg-cream-200/30'}`}>
      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${dimmed ? 'bg-cream-200 border hair text-ink-400' : iconBg}`}>
        {meta.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-sm font-medium">{n.title}</span>
          {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-teal inline-block" />}
          {n.emailSent && (
            <span className="text-[10px] font-mono text-ink-400 flex items-center gap-1">
              <Icon.Send size={10} /> email sent (simulated)
            </span>
          )}
        </div>
        <div className="text-[13px] text-ink-500">{n.message}</div>
        <div className="text-[11px] text-ink-400 font-mono mt-1">{n.date}</div>
      </div>
      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition shrink-0">
        {!n.read && (
          <button onClick={() => onRead(n.id)} className="text-[12px] text-ink-500 hover:text-ink underline underline-offset-2 whitespace-nowrap">
            Mark read
          </button>
        )}
        <button onClick={() => onDismiss(n.id)} className="text-rose hover:opacity-70">
          <Icon.X size={14} />
        </button>
      </div>
    </div>
  );
}

export default function NotificationsPage() {
  const { notifications, markNotificationRead, markAllRead, dismissNotification, user } = useApp();
  const { addToast } = useToast();

  const unread = notifications.filter(n => !n.read);
  const read = notifications.filter(n => n.read);
  const stalenessUnread = unread.filter(n => n.type === 'staleness_warn' || n.type === 'stale_data');

  const handleMarkAllRead = () => {
    markAllRead();
    addToast({ type: 'success', title: 'All notifications marked as read' });
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="smallcaps text-ink-400 mb-2">Inbox</div>
          <h1 className="font-serif text-5xl leading-tight">Notifications</h1>
        </div>
        <div className="flex gap-2">
          {unread.length > 0 && (
            <Btn variant="outline" size="sm" onClick={handleMarkAllRead} icon={<Icon.Check size={13} />}>
              Mark all read
            </Btn>
          )}
        </div>
      </div>

      {/* Staleness alert banner */}
      {stalenessUnread.length > 0 && (
        <div className="border border-amber/30 bg-amber-soft/40 rounded-xl p-4 flex items-start gap-3">
          <Icon.AlertTriangle size={18} className="text-amber mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-medium text-amber">Benchmark data staleness alert</div>
            <div className="text-[12px] text-ink-500 mt-0.5">
              Some acquirer rate data in your saved reports is older than 90 days (amber threshold).
              Recommendations may not reflect current market pricing. Re-run an analysis to refresh.
            </div>
          </div>
          <Link href="/benchmark">
            <Btn variant="outline" size="sm">View rates</Btn>
          </Link>
        </div>
      )}

      {/* Email simulation note */}
      {user.notifyParseComplete || user.notifyReportReady ? (
        <div className="border hair rounded-xl p-4 bg-cream-200/50 flex items-start gap-3 text-[12px] text-ink-500">
          <Icon.Send size={14} className="text-ink-400 mt-0.5 shrink-0" />
          <div>
            <strong>Email delivery is simulated</strong> — notifications marked with "email sent" would be delivered to{' '}
            <span className="font-mono">{user.email}</span> in production.
            {' '}Configure preferences in <Link href="/settings" className="underline underline-offset-2 text-ink">Settings → Notifications</Link>.
          </div>
        </div>
      ) : null}

      {notifications.length === 0 ? (
        <Card className="p-14 text-center">
          <div className="w-14 h-14 rounded-full bg-cream-200 border hair flex items-center justify-center mx-auto mb-4">
            <Icon.Bell size={22} className="text-ink-400" />
          </div>
          <h3 className="font-serif text-2xl mb-2">All caught up</h3>
          <p className="text-[14px] text-ink-500 max-w-sm mx-auto">No notifications yet. Upload a statement to get your first analysis and report.</p>
          <Link href="/upload"><Btn variant="primary" className="mt-5" icon={<Icon.Upload size={14} />}>Upload statement</Btn></Link>
        </Card>
      ) : (
        <>
          {unread.length > 0 && (
            <div>
              <div className="smallcaps text-ink-400 mb-3">{unread.length} unread</div>
              <Card>
                <div className="divide-hair">
                  {unread.map(n => (
                    <NotifRow key={n.id} n={n} onRead={markNotificationRead} onDismiss={dismissNotification} dimmed={false} />
                  ))}
                </div>
              </Card>
            </div>
          )}

          {read.length > 0 && (
            <div>
              <div className="smallcaps text-ink-400 mb-3">Earlier ({read.length})</div>
              <Card>
                <div className="divide-hair">
                  {read.map(n => (
                    <NotifRow key={n.id} n={n} onRead={markNotificationRead} onDismiss={dismissNotification} dimmed={true} />
                  ))}
                </div>
              </Card>
            </div>
          )}
        </>
      )}

      <Card className="p-5 flex items-center gap-4 bg-cream-200/40">
        <Icon.Info size={16} className="text-ink-400 shrink-0" />
        <div className="flex-1 text-[13px] text-ink-500">
          Manage email and in-app notification preferences in{' '}
          <Link href="/settings" className="underline underline-offset-2 text-ink">Settings → Notifications</Link>.
          Staleness alerts fire when rate panel data for any acquirer exceeds 90 days.
        </div>
      </Card>
    </div>
  );
}
