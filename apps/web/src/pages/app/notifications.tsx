import { useState } from 'react';
import { Bell, Check, Settings2, Inbox } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Separator, Switch } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NOTIFICATIONS, type Notification } from '@/data/field';
import { dateTime, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

const SEVERITY: Record<Notification['severity'], { dot: string; badge: 'default' | 'success' | 'warn' | 'danger' }> = {
  info: { dot: 'bg-info-600', badge: 'default' },
  success: { dot: 'bg-success-600', badge: 'success' },
  warning: { dot: 'bg-warn-600', badge: 'warn' },
  critical: { dot: 'bg-danger-500', badge: 'danger' },
};

const CATEGORIES = [
  'estimate', 'project', 'rfi', 'submittal', 'change_order',
  'approval', 'ai_finding', 'calibration', 'billing', 'safety', 'schedule', 'system',
] as const;

export function NotificationsPage() {
  const [items, setItems] = useState(NOTIFICATIONS);
  const unread = items.filter((n) => !n.readAt);

  const markRead = (id: string) =>
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
  const markAllRead = () =>
    setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Raised by the platform when something needs a person: an unanswered RFI approaching its date, a submittal returned, an AI finding waiting for review, a calibration proposal."
        actions={unread.length ? <Button variant="outline" onClick={markAllRead}><Check className="size-4" /> Mark all read</Button> : null}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Unread" value={unread.length} tone={unread.length ? 'warn' : 'success'} icon={<Bell className="size-4" />} />
        <StatTile label="Critical" value={items.filter((n) => n.severity === 'critical' && !n.readAt).length}
          tone={items.some((n) => n.severity === 'critical' && !n.readAt) ? 'danger' : 'success'}
          hint="needs attention today" />
        <StatTile label="Total" value={items.length} icon={<Inbox className="size-4" />} hint="last 30 days" />
      </div>

      <Tabs defaultValue="inbox">
        <TabsList>
          <TabsTrigger value="inbox">Inbox ({unread.length})</TabsTrigger>
          <TabsTrigger value="all">All ({items.length})</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
        </TabsList>

        <TabsContent value="inbox">
          <Card><CardContent className="p-0">
            {unread.length === 0 ? (
              <EmptyState icon={<Check className="size-5" />} title="Nothing needs your attention"
                description="Everything raised has been read." />
            ) : (
              <ul className="divide-y divide-charcoal-200">
                {unread.map((n) => <NotificationRow key={n.id} n={n} onRead={markRead} />)}
              </ul>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="all">
          <Card><CardContent className="p-0">
            <ul className="divide-y divide-charcoal-200">
              {items.map((n) => <NotificationRow key={n.id} n={n} onRead={markRead} />)}
            </ul>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="preferences">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Settings2 className="size-4" /> What reaches you</CardTitle>
              <CardDescription>
                Per category, per channel. A minimum severity stops routine notices from burying the ones that matter.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 gap-y-1 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">Category</span>
                <span className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">In app</span>
                <span className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">Email</span>
                {CATEGORIES.map((c) => (
                  <>
                    <span key={`${c}-l`} className="border-t border-charcoal-200 py-2.5 text-charcoal-700">{titleCase(c)}</span>
                    <span key={`${c}-a`} className="border-t border-charcoal-200 py-2.5">
                      <Switch defaultChecked aria-label={`${c} in app`} />
                    </span>
                    <span key={`${c}-e`} className="border-t border-charcoal-200 py-2.5">
                      <Switch defaultChecked={['rfi', 'approval', 'billing', 'safety'].includes(c)} aria-label={`${c} email`} />
                    </span>
                  </>
                ))}
              </div>
              <Separator className="my-4" />
              <p className="text-xs text-charcoal-500">
                Preferences are per user and per company, so someone who works for two companies in GrounUp can
                be reachable differently in each.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NotificationRow({ n, onRead }: { n: Notification; onRead: (id: string) => void }) {
  const s = SEVERITY[n.severity];
  return (
    <li className={cn('flex gap-3 p-4', !n.readAt && 'bg-yellow-50/40')}>
      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-charcoal-300' : s.dot)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn('text-sm', n.readAt ? 'text-charcoal-700' : 'font-semibold text-charcoal-900')}>{n.title}</p>
          <Badge variant={s.badge}>{titleCase(n.category)}</Badge>
        </div>
        <p className="mt-0.5 text-sm leading-relaxed text-charcoal-500">{n.body}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {n.actionPath ? (
            <Button asChild size="sm" variant="outline" onClick={() => onRead(n.id)}>
              <Link to={n.actionPath}>{n.actionLabel ?? 'Open'}</Link>
            </Button>
          ) : null}
          {!n.readAt ? (
            <Button size="sm" variant="ghost" onClick={() => onRead(n.id)}>Mark read</Button>
          ) : null}
          <span className="text-xs text-charcoal-400">{dateTime(n.createdAt)}</span>
        </div>
      </div>
    </li>
  );
}
