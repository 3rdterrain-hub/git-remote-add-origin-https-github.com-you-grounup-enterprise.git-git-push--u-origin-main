/**
 * Notifications, on real data.
 *
 * The fixture behind this page also fed the bell in the header, so five sample
 * notices and a permanent "3 unread" followed every signed-in person around the
 * application regardless of whose workspace it was.
 *
 * The preferences half of the screen already reads live: migration 0091 built
 * `notification_categories` as a table precisely so a settings screen reads the
 * same list the mail-sending code uses rather than carrying a second copy that
 * drifts. This is the other half.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Check, Inbox, Settings2 } from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  loadMyNotifications, markNotificationRead, dismissNotification,
  type NotificationRow,
} from '@/lib/data/session';
import { dateTime, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

const SEVERITY: Record<NotificationRow['severity'],
  { dot: string; badge: 'default' | 'success' | 'warn' | 'danger' }> = {
  info: { dot: 'bg-info-600', badge: 'default' },
  success: { dot: 'bg-success-600', badge: 'success' },
  warning: { dot: 'bg-warn-600', badge: 'warn' },
  critical: { dot: 'bg-danger-500', badge: 'danger' },
};

type Filter = 'unread' | 'attention' | 'all';

const TITLES: Record<Filter, string> = {
  unread: 'Waiting on you',
  attention: 'Warnings and critical notices',
  all: 'Everything',
};

const EMPTY: Record<Filter, string> = {
  unread: 'Nothing unread',
  attention: 'Nothing needing attention',
  all: 'Nothing here yet',
};

export function NotificationsLivePage() {
  const notificationsQ = useQuery(loadMyNotifications, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('unread');

  const items = notificationsQ.status === 'ready' ? notificationsQ.data : [];
  const unread = useMemo(() => items.filter((n) => !n.readAt), [items]);
  /*
   * Warnings and critical notices, which the tile above counted and nothing on
   * the screen could then show. They are their own view rather than a fourth
   * severity badge because "eleven notices, two of which matter" is the
   * question this screen is opened with.
   */
  const attention = useMemo(
    () => items.filter((n) => n.severity === 'critical' || n.severity === 'warning'),
    [items]);
  const shown = filter === 'unread' ? unread : filter === 'attention' ? attention : items;

  /*
   * The categories actually present, rather than the twelve the schema allows.
   * A filter offering eleven empty categories is a filter nobody uses.
   */
  const categories = useMemo(
    () => [...new Set(items.map((n) => n.category))].sort(), [items]);

  /* What each kind is made of, for the tile that counts them. */
  const countByCategory = useMemo(() => categories.map((c) => ({
    category: c,
    total: items.filter((n) => n.category === c).length,
    unread: items.filter((n) => n.category === c && !n.readAt).length,
  })), [categories, items]);

  const markAll = async () => {
    const client = supabase;
    if (!client || unread.length === 0) return;
    setBusy(true); setError(null);
    try {
      // One at a time rather than a bulk update, so row level security decides
      // each one and a failure on any single notice is reported rather than
      // taking the whole batch down.
      await Promise.all(unread.map((n) => markNotificationRead(client, n.id)));
      notificationsQ.refetch();
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  };

  const markOne = async (id: string) => {
    if (!supabase) return;
    setError(null);
    try {
      await markNotificationRead(supabase, id);
      notificationsQ.refetch();
    } catch (err) { setError(messageFor(err)); }
  };

  /*
   * Putting one away is not deleting it: the notice survives, and so does the
   * record that this person saw it. It only leaves their inbox.
   */
  const dismissOne = async (id: string) => {
    if (!supabase) return;
    setError(null);
    try {
      await dismissNotification(supabase, id);
      notificationsQ.refetch();
    } catch (err) { setError(messageFor(err)); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="What the platform needed to tell you, and what it has already told you. Which of these reach your inbox is set in your notification preferences."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/app/settings"><Settings2 className="size-4" /> Preferences</Link>
            </Button>
            <Button onClick={markAll} disabled={busy || unread.length === 0}>
              <Check className="size-4" /> {busy ? 'Marking…' : 'Mark all read'}
            </Button>
          </div>
        }
      />

      {notificationsQ.status === 'error'
        ? <ErrorState message={notificationsQ.message} onRetry={notificationsQ.refetch} /> : null}
      {notificationsQ.status === 'loading' ? <LoadingState label="Loading notifications" /> : null}
      {error ? <ErrorState message={error} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Unread" value={unread.length}
          tone={unread.length ? 'warn' : 'success'} icon={<Bell className="size-4" />}
          hint={unread.length ? 'waiting on you' : 'nothing waiting'}
          onClick={() => setFilter('unread')} active={filter === 'unread'}
          actionLabel="Show only what is unread" />
        <StatTile label="Total" value={items.length} icon={<Inbox className="size-4" />}
          hint="not dismissed"
          onClick={() => setFilter('all')} active={filter === 'all'}
          actionLabel="Show everything, read and unread" />
        <StatTile label="Needing attention" value={attention.length}
          tone={items.some((n) => n.severity === 'critical' && !n.readAt) ? 'danger' : undefined}
          hint="warnings and critical"
          onClick={() => setFilter('attention')} active={filter === 'attention'}
          actionLabel="Show only warnings and critical notices" />
        <StatTile label="Kinds" value={categories.length}
          hint={categories.length ? categories.map((c) => titleCase(c.replace(/_/g, ' '))).slice(0, 3).join(', ') : 'none yet'}
          detail={countByCategory.length === 0 ? (
            <p>
              Nothing has been sent yet. A kind appears here the first time the platform sends
              you one of that kind — an estimate waiting on approval, a payment that failed, a
              rate you priced with that changed.
            </p>
          ) : (
            <ul className="space-y-1">
              {countByCategory.map((c) => (
                <li key={c.category} className="flex items-baseline justify-between gap-3">
                  <span>{titleCase(c.category.replace(/_/g, ' '))}</span>
                  <span className="tabular text-charcoal-500">
                    {c.total} {c.total === 1 ? 'notice' : 'notices'}
                    {c.unread ? `, ${c.unread} unread` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )} />
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList>
          <TabsTrigger value="unread">Unread ({unread.length})</TabsTrigger>
          <TabsTrigger value="attention">Needing attention ({attention.length})</TabsTrigger>
          <TabsTrigger value="all">Everything ({items.length})</TabsTrigger>
        </TabsList>

        <TabsContent value={filter}>
          <Card>
            <CardHeader>
              <CardTitle>{TITLES[filter]}</CardTitle>
              <CardDescription>
                Opening one marks it read. Dismissing takes it out of your inbox and leaves it on
                the record — nothing here is deleted, and a notice you dismissed still shows the
                time you saw it.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {notificationsQ.status === 'ready' && shown.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title={EMPTY[filter]}
                    hint={items.length > 0
                      ? (filter === 'unread'
                        ? 'Everything has been read.'
                        : 'Nothing here is a warning or a critical notice.')
                      : 'The platform will tell you when an estimate needs approval, a payment fails, or a rate you priced with changes.'} />
                </div>
              ) : (
                <ul className="divide-y divide-charcoal-200">
                  {shown.map((n) => {
                    const tone = SEVERITY[n.severity] ?? SEVERITY.info;
                    return (
                      <li key={n.id}
                        className={cn('flex gap-3 px-4 py-3', !n.readAt && 'bg-charcoal-50/60')}>
                        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', tone.dot)}
                          aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <p className="font-medium text-charcoal-900">{n.title}</p>
                            <Badge variant={tone.badge}>
                              {titleCase(n.category.replace(/_/g, ' '))}
                            </Badge>
                            {!n.readAt ? (
                              <span className="text-xs font-medium text-yellow-700">unread</span>
                            ) : null}
                          </div>
                          {n.body ? (
                            <p className="mt-0.5 text-sm leading-relaxed text-charcoal-600">{n.body}</p>
                          ) : null}
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                            <span className="text-charcoal-500">{dateTime(n.createdAt)}</span>
                            {n.actionPath ? (
                              <Link to={n.actionPath} onClick={() => markOne(n.id)}
                                className="font-medium text-yellow-700 hover:underline">
                                {n.actionLabel ?? 'Open it'}
                              </Link>
                            ) : null}
                            {!n.readAt ? (
                              <button onClick={() => markOne(n.id)}
                                className="text-charcoal-500 hover:text-charcoal-900">
                                Mark read
                              </button>
                            ) : null}
                            <button onClick={() => dismissOne(n.id)}
                              className="text-charcoal-500 hover:text-charcoal-900">
                              Dismiss
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
