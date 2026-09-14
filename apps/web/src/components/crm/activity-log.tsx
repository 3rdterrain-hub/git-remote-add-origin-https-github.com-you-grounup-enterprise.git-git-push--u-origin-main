/**
 * What was said, and what is due.
 *
 * `crm_activities` has carried eight activity types, a due date, an assignee
 * and a completion since migration 0005 — and an index on
 * `(company_id, due_at) where completed_at is null`, built to answer "what is
 * due next" for a list nobody ever wrote. Its only writer was `convert_lead`,
 * logging the conversion into a table nothing read.
 *
 * A call made and a call to make are the same record from either side of a
 * date, which is why one form writes both.
 */
import { useState } from 'react';
import { CalendarClock, Check, MessageSquarePlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  loadActivities, logActivity, completeActivity,
  ACTIVITY_TYPES, type ActivityRow, type ActivityType,
} from '@/lib/data/crm-pipeline';
import { date, titleCase, integer } from '@/lib/format';

const label = (s: string) => titleCase(s.replace(/_/g, ' '));

function Entry({ a, editable, onChanged }: {
  a: ActivityRow; editable: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const about = a.opportunityName ?? a.customerName ?? a.leadName ?? null;

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-charcoal-200
                   py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm text-charcoal-900">
          <Badge variant="default" className="mr-2">{label(a.activityType)}</Badge>
          {a.subject}
        </p>
        {a.body ? <p className="mt-0.5 text-xs text-charcoal-600">{a.body}</p> : null}
        <p className="mt-0.5 text-xs text-charcoal-500">
          {about ?? 'No subject'}
          {a.opportunityNumber ? ` · ${a.opportunityNumber}` : ''}
          {a.completedAt ? ` · done ${date(a.completedAt)}`
            : a.dueAt ? ` · due ${date(a.dueAt)}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {a.overdue ? <Badge variant="danger">overdue</Badge> : null}
        {!a.completedAt && editable ? (
          <Button type="button" size="sm" variant="outline" disabled={busy}
            onClick={async () => {
              if (!supabase) return;
              setBusy(true);
              try { await completeActivity(supabase, a.id); onChanged(); }
              finally { setBusy(false); }
            }}>
            <Check className="mr-1.5 size-3.5" aria-hidden /> Done
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function ActivityLog({ editable, customerId, opportunityId }: {
  editable: boolean;
  customerId?: string | null;
  opportunityId?: string | null;
}) {
  const activityQ = useQuery(loadActivities, []);
  const all = activityQ.status === 'ready' ? activityQ.data : [];
  const scoped = customerId || opportunityId
    ? all.filter((a) => (opportunityId ? a.opportunityId === opportunityId
      : a.customerId === customerId))
    : all;
  const due = scoped.filter((a) => !a.completedAt);
  const done = scoped.filter((a) => a.completedAt);

  /*
   * Controlled, not `defaultOpen`. `defaultOpen` is read once at mount, and at
   * mount the query has not answered — so a card told to open itself when
   * something is outstanding would mount shut and stay shut on exactly the
   * customer who had something outstanding.
   */
  const [openedByHand, setOpenedByHand] = useState<boolean | null>(null);
  const showing = openedByHand ?? (activityQ.status === 'ready' && due.length > 0);

  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<ActivityType>('call');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canLog = Boolean(customerId || opportunityId);

  const log = async () => {
    if (!supabase || busy) return;
    setBusy(true); setError(null);
    try {
      await logActivity(supabase, {
        activityType: type,
        subject,
        body: body || null,
        customerId: customerId ?? null,
        opportunityId: opportunityId ?? null,
        dueAt: dueAt || null,
        /* A due date in the future is something to do, not something done. */
        completed: !dueAt,
      });
      setAdding(false); setSubject(''); setBody(''); setDueAt('');
      activityQ.refetch();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  return (
    <CollapsibleCard
      id="activity-log"
      title={<span className="flex items-center gap-2">
        <CalendarClock className="size-4 text-charcoal-500" aria-hidden />
        What was said, and what is due
      </span>}
      description="Calls, emails, meetings, site visits and follow-ups. The table has carried an index for this list since migration 0005 and nothing ever read it."
      summary={due.length === 0 ? `${integer(done.length)} logged`
        : `${integer(due.length)} outstanding`}
      open={showing}
      onOpenChange={setOpenedByHand}
    >
      <div className="space-y-4">
        {activityQ.status === 'loading' ? <LoadingState label="Reading the log" /> : null}
        {activityQ.status === 'error'
          ? <ErrorState message={activityQ.message} onRetry={activityQ.refetch} /> : null}

        {activityQ.status === 'ready' && scoped.length === 0 && !adding ? (
          <EmptyState title="Nothing recorded yet"
            hint="Log a call after you make it, or a follow-up before you forget it." />
        ) : null}

        {due.length > 0 ? (
          <section>
            <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-500">
              Outstanding
            </h4>
            <ul>{due.map((a) => (
              <Entry key={a.id} a={a} editable={editable} onChanged={activityQ.refetch} />
            ))}</ul>
          </section>
        ) : null}

        {done.length > 0 ? (
          <section>
            <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-500">
              Done
            </h4>
            <ul>{done.slice(0, 20).map((a) => (
              <Entry key={a.id} a={a} editable={false} onChanged={activityQ.refetch} />
            ))}</ul>
          </section>
        ) : null}

        {editable && canLog && !adding ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            <MessageSquarePlus className="mr-1.5 size-3.5" aria-hidden /> Log something
          </Button>
        ) : null}

        {editable && adding ? (
          <div className="space-y-3 rounded-lg border border-charcoal-200 bg-charcoal-50/50 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="a-type">What kind</Label>
                <Select value={type} onValueChange={(v) => setType(v as ActivityType)}>
                  <SelectTrigger id="a-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACTIVITY_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{label(t)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="a-due">Due (leave blank if it already happened)</Label>
                <Input id="a-due" type="date" value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-subject">What about</Label>
              <Input id="a-subject" value={subject}
                placeholder="Spoke to Dana about the schedule"
                onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-body">Anything worth keeping</Label>
              <Textarea id="a-body" rows={2} value={body}
                onChange={(e) => setBody(e.target.value)} />
            </div>

            {error ? <Alert tone="danger" title="That could not be logged">{error}</Alert> : null}

            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={busy || !subject.trim()}
                onClick={() => void log()}>
                {dueAt ? 'Add the follow-up' : 'Log it'}
              </Button>
              <Button type="button" size="sm" variant="ghost"
                onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}
