import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Megaphone, Loader2, ShieldAlert, Wrench, Info, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { useQuery } from '@/lib/data/query';
import {
  loadAnnouncements, publishAnnouncement, retractAnnouncement,
  type AnnouncementKind, type AnnouncementAudience,
} from '@/lib/data/admin';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { supabase } from '@/lib/supabase';
import { integer, dateTime } from '@/lib/format';
import type { OperatorContext } from './shell';

const KIND_ICON = {
  info: Info, maintenance: Wrench, warning: AlertTriangle,
} as const;

const AUDIENCE_LABEL: Record<AnnouncementAudience, string> = {
  everyone: 'Every customer',
  paying: 'Paying customers',
  free: 'Customers on the free plan',
};

/**
 * Saying something to everybody.
 *
 * A message here reaches people who did not ask to hear from you, which is why
 * it is the superadmin's alone by default and why the audience is three coarse
 * groups rather than a query builder — an audience nobody can describe in a
 * sentence is one somebody eventually gets wrong, and getting it wrong here
 * means telling the wrong customers something alarming.
 *
 * Retracting stops a message being shown. It never unsends it: somebody read
 * it, and a platform that could make that untrue is one whose history means
 * nothing.
 */
export function AdminAnnouncements() {
  const { can } = useOutletContext<OperatorContext>();
  const listQ = useQuery(loadAnnouncements, []);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [why, setWhy] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<{
    title: string; body: string; kind: AnnouncementKind;
    audience: AnnouncementAudience; startsAt: string; endsAt: string;
  }>({ title: '', body: '', kind: 'info', audience: 'everyone', startsAt: '', endsAt: '' });

  const list = listQ.status === 'ready' ? listQ.data : [];
  const mayPublish = can('announcements.publish');

  if (listQ.status === 'error') {
    return <ErrorState message={listQ.message} onRetry={listQ.refetch} />;
  }

  const live = list.filter((a) => a.live);

  async function publish() {
    if (!supabase) return;
    setBusy('publish'); setError(null);
    try {
      await publishAnnouncement(supabase, {
        title: draft.title, body: draft.body, kind: draft.kind, audience: draft.audience,
        startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : null,
        endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
      });
      setDraft({ title: '', body: '', kind: 'info', audience: 'everyone',
                 startsAt: '', endsAt: '' });
      listQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be published.');
    } finally { setBusy(null); }
  }

  async function retract(id: string) {
    if (!supabase) return;
    setBusy(id); setError(null);
    try {
      await retractAnnouncement(supabase, id, why[id] ?? '');
      setWhy({ ...why, [id]: '' });
      listQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be pulled.');
    } finally { setBusy(null); }
  }

  const complete = draft.title.trim().length >= 3 && draft.body.trim().length >= 10
    && (draft.kind !== 'maintenance' || draft.endsAt !== '');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Announcements</h1>
        <p className="mt-1 text-sm text-charcoal-500">
          A message in front of customers who did not ask to hear from you. Worth using
          sparingly for exactly that reason.
        </p>
      </div>

      {listQ.status === 'loading' ? <LoadingState label="Reading announcements" /> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="size-4" /> Say something
          </CardTitle>
          <CardDescription>
            Three audiences, on purpose. An audience nobody can describe in a sentence is
            one somebody eventually gets wrong, and getting it wrong here means telling the
            wrong customers something alarming.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ann-title">Title</Label>
            <Input id="ann-title" value={draft.title} placeholder="Maintenance on Sunday"
              onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ann-body">What it says</Label>
            <textarea id="ann-body" value={draft.body} rows={3}
              className="w-full rounded border border-charcoal-300 bg-white p-2 text-sm"
              placeholder="The platform will be unavailable between two and four in the morning."
              onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ann-kind">Kind</Label>
              <select id="ann-kind" value={draft.kind}
                className="h-9 w-full rounded border border-charcoal-300 bg-white px-2 text-sm"
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as AnnouncementKind })}>
                <option value="info">Something worth knowing</option>
                <option value="maintenance">Maintenance</option>
                <option value="warning">A warning</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ann-audience">Who sees it</Label>
              <select id="ann-audience" value={draft.audience}
                className="h-9 w-full rounded border border-charcoal-300 bg-white px-2 text-sm"
                onChange={(e) => setDraft({
                  ...draft, audience: e.target.value as AnnouncementAudience })}>
                <option value="everyone">Every customer</option>
                <option value="paying">Paying customers</option>
                <option value="free">Customers on the free plan</option>
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ann-start">Starts showing (optional)</Label>
              <Input id="ann-start" type="datetime-local" value={draft.startsAt}
                onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ann-end">
                Stops showing{draft.kind === 'maintenance' ? '' : ' (optional)'}
              </Label>
              <Input id="ann-end" type="datetime-local" value={draft.endsAt}
                onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} />
              {draft.kind === 'maintenance' ? (
                <p className="text-xs text-charcoal-500">
                  Required. A banner about last Sunday&apos;s maintenance is worse than no
                  banner.
                </p>
              ) : null}
            </div>
          </div>
          <Button disabled={!mayPublish || busy === 'publish' || !complete} onClick={publish}>
            {busy === 'publish' ? <Loader2 className="size-4 animate-spin" />
              : <Megaphone className="size-4" />}
            Publish it
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Showing now ({live.length})</CardTitle>
          <CardDescription>
            Cleared counts the people who dismissed it — not who read it, which nothing here
            can honestly claim to know.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {list.map((a) => {
            const Icon = KIND_ICON[a.kind];
            return (
              <div key={a.id}
                className={`rounded border p-4 ${a.live
                  ? 'border-charcoal-200' : 'border-charcoal-100 bg-charcoal-50/60'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium text-charcoal-900">
                      <Icon className="size-4" /> {a.title}
                      {!a.live ? (
                        <Badge variant="default">
                          {a.retractedAt ? 'pulled' : 'finished'}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="mt-1 text-sm text-charcoal-700">{a.body}</p>
                    <p className="mt-1 text-xs text-charcoal-500">
                      {AUDIENCE_LABEL[a.audience]} · from {dateTime(a.startsAt)}
                      {a.endsAt ? ` to ${dateTime(a.endsAt)}` : ''}
                      {' · '}{integer(a.dismissals)} cleared
                      {a.publishedByEmail ? ` · ${a.publishedByEmail}` : ''}
                    </p>
                    {a.retractReason ? (
                      <p className="mt-1 text-xs text-charcoal-500">
                        Pulled: {a.retractReason}
                      </p>
                    ) : null}
                  </div>
                  {a.live ? (
                    <div className="flex items-end gap-1.5">
                      <Input value={why[a.id] ?? ''} placeholder="Why you are pulling it"
                        className="h-8 w-56 text-xs"
                        onChange={(e) => setWhy({ ...why, [a.id]: e.target.value })} />
                      <Button size="sm" variant="ghost"
                        disabled={!mayPublish || busy === a.id
                          || (why[a.id] ?? '').trim().length < 5}
                        onClick={() => retract(a.id)}>
                        Pull it
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
          {!list.length && listQ.status === 'ready' ? (
            <EmptyState title="Nothing has been announced"
              hint="Which is usually the right number of announcements." />
          ) : null}
        </CardContent>
      </Card>

      <Alert tone="neutral" icon={<ShieldAlert className="size-4" />}
        title="Pulling one does not unsend it">
        Somebody read it. Retracting stops it being shown and records why, and the message
        stays in the history — a platform that could make a sent message untrue is one whose
        history means nothing.
        {!mayPublish ? ' Publishing is the superadmin’s by default; you can see what has gone out.' : ''}
      </Alert>
    </div>
  );
}
