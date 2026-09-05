import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { History, ShieldCheck, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@/lib/data/query';
import { loadOperatorActivity, loadOperatorSummary } from '@/lib/data/admin';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { integer, dateTime, date } from '@/lib/format';
import type { OperatorContext } from './shell';

/** Table names as somebody would say them out loud. */
const WHAT: Record<string, string> = {
  'public.refund_requests': 'Refund',
  'public.entitlement_overrides': 'Feature override',
  'public.support_sessions': 'Opened an account',
  'public.company_billing_terms': 'Commercial terms',
  'public.company_suspensions': 'Suspension',
  'public.plan_prices': 'Published a price',
  'public.platform_roles': 'Changed a role',
  'public.platform_admins': 'Operator access',
  'public.upsell_proposals': 'Upsell',
  'public.stripe_events': 'Replayed a payment event',
  'public.companies': 'Created a company',
  'public.cancellations': 'Cancellation',
};

/**
 * What the people who operate this platform have been doing.
 *
 * Every one of these rows already existed — they are audited into the
 * customer's own ledger, so a company can read what was done to them. This
 * reads the same records down the operator axis, which is the question you
 * cannot answer from a tenant's history: what did the people I hired do this
 * week.
 *
 * Nothing here is a second log. A second log would immediately disagree with
 * the first.
 */
export function AdminActivity() {
  const { can } = useOutletContext<OperatorContext>();
  const activityQ = useQuery(loadOperatorActivity, []);
  const summaryQ = useQuery(loadOperatorSummary, []);
  const [filter, setFilter] = useState('');

  const activity = activityQ.status === 'ready' ? activityQ.data : [];
  const summary = summaryQ.status === 'ready' ? summaryQ.data : [];

  const failure = [activityQ, summaryQ].find((q) => q.status === 'error');
  if (failure) return <ErrorState message={failure.message} onRetry={failure.refetch} />;

  const q = filter.trim().toLowerCase();
  const shown = !q ? activity : activity.filter((a) =>
    (a.operatorEmail ?? '').toLowerCase().includes(q)
    || (a.companyName ?? '').toLowerCase().includes(q)
    || (a.reason ?? '').toLowerCase().includes(q)
    || (WHAT[a.entityTable] ?? a.entityTable).toLowerCase().includes(q));

  const dormant = summary.filter((s) => !s.accessWithdrawn && s.actions30Days === 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">
          What your staff did
        </h1>
        <p className="mt-1 text-sm text-charcoal-500">
          The same records a customer reads in their own account history, read the other
          way round.
        </p>
      </div>

      {activityQ.status === 'loading' ? <LoadingState label="Reading the ledger" /> : null}

      {dormant.length ? (
        <Alert tone="warn" title={
          `${dormant.length} operator${dormant.length === 1 ? ' has' : 's have'} access `
          + 'and have done nothing in thirty days'}>
          An account nobody uses is an account nobody would notice being used. Withdrawing
          access is a click, and granting it again later is another.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Each operator, over thirty days</CardTitle>
          <CardDescription>
            Counted by the thing acted on rather than by ledger entries — one action leaves
            two, the reason and the exact change, and counting rows would double everything.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Actions</TableHead>
                <TableHead className="text-right">Customers</TableHead>
                <TableHead className="text-right">Accounts opened</TableHead>
                <TableHead className="text-right">Refunds</TableHead>
                <TableHead className="text-right">Features</TableHead>
                <TableHead>Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.map((s) => (
                <TableRow key={s.operatorId}>
                  <TableCell className="text-charcoal-800">
                    {s.operatorEmail}
                    {s.accessWithdrawn ? (
                      <Badge variant="default" className="ml-1.5">access withdrawn</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.operatorRole === 'superadmin' ? 'warn' : 'default'}>
                      {s.operatorRole ?? '—'}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-900">
                    {integer(s.actions30Days)}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {s.companiesTouched || '—'}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {s.accountsOpened || '—'}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {s.refundActions || '—'}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {s.featureActions || '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                    {s.lastSeen ? date(s.lastSeen) : 'Never'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!summary.length && summaryQ.status === 'ready' ? (
            <EmptyState title="Nobody but you operates this platform yet" />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <History className="size-4" /> Everything, most recent first
              </CardTitle>
              <CardDescription>
                Six months. Includes people whose access has since been withdrawn — the week
                before somebody leaves is usually the week worth reading.
              </CardDescription>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="activity-filter" className="sr-only">Filter activity</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4
                                   text-charcoal-400" />
                <Input id="activity-filter" value={filter} className="w-64 pl-8"
                  placeholder="Person, company, or reason"
                  onChange={(e) => setFilter(e.target.value)} />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead>To whom</TableHead>
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.slice(0, 100).map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                    {dateTime(a.occurredAt)}
                  </TableCell>
                  <TableCell className="text-xs text-charcoal-800">
                    {a.operatorEmail ?? a.operatorId}
                    {a.operatorSinceRevoked ? (
                      <span className="block text-charcoal-400">since withdrawn</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-charcoal-700">
                    {WHAT[a.entityTable] ?? a.entityTable}
                    <span className="ml-1.5 text-xs text-charcoal-400">{a.action}</span>
                  </TableCell>
                  <TableCell className="text-charcoal-700">
                    {a.platformWide ? (
                      <Badge variant="default">the platform</Badge>
                    ) : (a.companyName ?? '—')}
                  </TableCell>
                  <TableCell className="max-w-96 text-xs text-charcoal-600">
                    {a.reason ?? <span className="text-charcoal-400">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!shown.length && activityQ.status === 'ready' ? (
            <EmptyState title={filter ? 'Nothing matches that' : 'Nothing has happened yet'} />
          ) : null}
        </CardContent>
      </Card>

      <Alert tone="neutral" icon={<ShieldCheck className="size-4" />}
        title="This is not a second log">
        Every row here is one the customer can already read in their own account history.
        Auditing operator actions into the tenant&apos;s ledger is what makes them answerable
        to the person they were done to; this page reads the same records down the other
        axis, and adds no recording of its own.
        {!can('operators.manage') ? ' You are seeing none of it, because you hold no permission to.' : ''}
      </Alert>
    </div>
  );
}
