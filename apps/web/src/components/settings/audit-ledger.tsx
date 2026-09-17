/**
 * The audit ledger. ENTITY.
 *
 * This card used to show "Events recorded 18,442 — last 90 days", a number
 * somebody typed, on the one screen whose entire subject is records that cannot
 * be altered. It was an order of magnitude out on this database and would have
 * been a different wrong number for every company that read it.
 *
 * Every figure here is counted, and the count opens: a tile saying eighteen
 * thousand events raises the question "which ones?", and a ledger nobody can
 * open is not evidence of anything.
 */
import { useState } from 'react';
import { ScrollText, Lock, ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import { loadAuditSummary, loadAuditEvents } from '@/lib/data/team';
import { integer, date, dateTime, titleCase, plural } from '@/lib/format';

const ACTION_TONE = (action: string) =>
  (action.includes('delete') ? 'danger'
    : action.includes('approve') || action.includes('issue') ? 'info'
      : action.includes('create') || action.includes('insert') ? 'success' : 'default') as
  'danger' | 'info' | 'success' | 'default';

export function AuditLedger() {
  const [open, setOpen] = useState(false);
  const summaryQ = useQuery(loadAuditSummary, []);
  /* The entries are only fetched once somebody opens them. */
  const eventsQ = useQuery(loadAuditEvents(50), [open]);

  const summary = summaryQ.status === 'ready' ? summaryQ.data : null;
  const events = eventsQ.status === 'ready' ? eventsQ.data : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="size-4" /> Audit ledger
        </CardTitle>
        <CardDescription>
          Append-only. It cannot be edited or deleted by anyone, at any privilege level — including
          by GrounUp. Corrections are appended as new events.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {summaryQ.status === 'error'
          ? <ErrorState message={summaryQ.message} onRetry={summaryQ.refetch} />
          : null}

        {/*
          * The last two of these are statements about how the platform is
          * built, so they are always true and always shown. Only the first is
          * data, and a count that has not arrived is an em dash rather than a
          * number — which is the whole reason this card was rewritten.
          */}
        <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-md border border-charcoal-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
                Events recorded
              </p>
              <p className="tabular mt-1 text-lg font-bold text-charcoal-900">
                {summaryQ.status === 'ready' && summary ? integer(summary.eventCount) : '—'}
              </p>
              <p className="text-xs text-charcoal-500">
                {summaryQ.status === 'loading' ? 'counting'
                  : summaryQ.status === 'demonstration' ? 'connect a workspace to count it'
                    : summary && summary.firstEventAt
                      ? `${integer(summary.eventsLast90Days)} in the last 90 days, since ${date(summary.firstEventAt)}`
                      : 'nothing recorded yet'}
              </p>
            </div>
            <div className="rounded-md border border-charcoal-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
                Retention
              </p>
              <p className="tabular mt-1 text-lg font-bold text-charcoal-900">No policy set</p>
              <p className="text-xs text-charcoal-500">nothing expires entries today</p>
            </div>
            <div className="rounded-md border border-charcoal-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
                Tamper protection
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-lg font-bold text-success-700">
                <Lock className="size-4" /> Trigger-enforced
              </p>
              <p className="text-xs text-charcoal-500">UPDATE and DELETE blocked</p>
            </div>
        </div>

        {summary && summary.eventCount > 0 ? (
          <div>
            <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              {open ? 'Hide the entries' : 'Open the last 50 entries'}
            </Button>
            <p className="mt-1.5 text-xs text-charcoal-500">
              {plural(summary.actorCount, 'person')} across {plural(summary.tablesTouched, 'table')}
              {summary.lastEventAt ? `, most recently ${dateTime(summary.lastEventAt)}` : ''}.
            </p>
          </div>
        ) : null}

        {open ? (
          eventsQ.status === 'loading' ? <LoadingState label="Reading the ledger" />
            : eventsQ.status === 'error'
              ? <ErrorState message={eventsQ.message} onRetry={eventsQ.refetch} />
              : events.length === 0
                ? <EmptyState title="Nothing recorded yet" />
                : (
                  <div className="overflow-x-auto rounded-md border border-charcoal-200">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>When</TableHead>
                          <TableHead>Who</TableHead>
                          <TableHead>Did what</TableHead>
                          <TableHead>To which record</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {events.map((e) => (
                          <TableRow key={e.id}>
                            <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                              {dateTime(e.occurredAt)}
                            </TableCell>
                            <TableCell className="text-sm">
                              {e.actor}
                              {e.byThePlatform ? (
                                <Badge variant="outline" className="ml-1.5">Platform</Badge>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <Badge variant={ACTION_TONE(e.action)}>{titleCase(e.action)}</Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs text-charcoal-600">
                              {e.entityTable}
                              {e.reason ? (
                                <p className="font-sans text-xs text-charcoal-500">{e.reason}</p>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )
        ) : null}

        <p className="text-xs text-charcoal-500">
          What changed inside a record is recorded but not shown here. Permission to read the ledger
          and permission to read every column of every table it records are different things.
        </p>
      </CardContent>
    </Card>
  );
}
