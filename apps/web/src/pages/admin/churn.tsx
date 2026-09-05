import { useOutletContext } from 'react-router-dom';
import { TrendingDown, HelpCircle, Users, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@/lib/data/query';
import { loadChurnReasons, loadChurnByMonth, loadCancellations } from '@/lib/data/admin';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { money, integer, date } from '@/lib/format';
import type { OperatorContext } from './shell';

/**
 * Why customers leave.
 *
 * The one figure a subscription business cannot go back for: somebody who left
 * in March will not answer the question in June. So it is asked at the moment
 * of cancellation, and what they were worth is written down then — after the
 * subscription ends, its items are gone and the value cannot be recovered.
 *
 * "Nobody was asked" is a row here rather than an omission. How often it
 * appears is how often the question is failing to reach anybody, which is
 * itself the most actionable number on the screen.
 */
export function AdminChurn() {
  const { can } = useOutletContext<OperatorContext>();
  const reasonsQ = useQuery(loadChurnReasons, []);
  const monthsQ = useQuery(loadChurnByMonth, []);
  const listQ = useQuery(loadCancellations, []);

  const reasons = reasonsQ.status === 'ready' ? reasonsQ.data : [];
  const months = monthsQ.status === 'ready' ? monthsQ.data : [];
  const list = listQ.status === 'ready' ? listQ.data : [];

  const failure = [reasonsQ, monthsQ, listQ].find((q) => q.status === 'error');
  if (failure) return <ErrorState message={failure.message} onRetry={failure.refetch} />;

  const total = reasons.reduce((a, r) => a + r.customers, 0);
  const notAsked = reasons.find((r) => r.reasonKey === 'not_asked');
  const competitors = [...new Set(reasons.flatMap((r) => r.competitors))];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Why they left</h1>
        <p className="mt-1 text-sm text-charcoal-500">
          {total
            ? `${integer(total)} cancellations over twelve months, worth `
              + `${money(reasons.reduce((a, r) => a + r.monthlyCentsLost, 0) / 100)} a month.`
            : 'Twelve months of cancellations, what each reason cost, and how long they '
              + 'stayed first.'}
        </p>
      </div>

      {monthsQ.status === 'loading' ? <LoadingState label="Reading cancellations" /> : null}

      {notAsked && total > 0 && notAsked.customers / total > 0.3 ? (
        <Alert tone="warn" icon={<HelpCircle className="size-4" />}
          title={`${Math.round((notAsked.customers / total) * 100)}% of these left without being asked why`}>
          Those canceled somewhere other than in GrounUp — Stripe&apos;s own billing page,
          or a card that finally gave up. The question only reaches somebody who cancels
          from inside the product, so a high number here is a gap in the flow rather than a
          gap in the customers.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="size-4" /> What each reason cost
            </CardTitle>
            <CardDescription>
              Ordered by how many customers, not by how much money — a cheap reason that
              happens constantly is the one to fix.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Customers</TableHead>
                  <TableHead className="text-right">A month</TableHead>
                  <TableHead className="text-right">Stayed</TableHead>
                  <TableHead className="text-right">Would return</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reasons.map((r) => (
                  <TableRow key={r.reasonKey}>
                    <TableCell className="text-charcoal-800">
                      {r.label}
                      {r.reasonKey === 'not_asked' ? (
                        <Badge variant="warn" className="ml-1.5">not a reason</Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-900">
                      {integer(r.customers)}
                    </TableCell>
                    <TableCell className="tabular text-right text-danger-700">
                      {money(r.monthlyCentsLost / 100)}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {r.averageMonths == null ? '—' : `${r.averageMonths} mo`}
                    </TableCell>
                    <TableCell className="tabular text-right text-success-700">
                      {r.wouldComeBack || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!reasons.length && reasonsQ.status === 'ready' ? (
              <EmptyState title="Nobody has canceled"
                hint="Which is either very good news or a very new platform." />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4" /> Gained against lost
            </CardTitle>
            <CardDescription>
              Either number alone is half a sentence.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Gained</TableHead>
                  <TableHead className="text-right">Lost</TableHead>
                  <TableHead className="text-right">Said why</TableHead>
                  <TableHead className="text-right">A month</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell className="whitespace-nowrap text-charcoal-700">
                      {date(m.month)}
                    </TableCell>
                    <TableCell className="tabular text-right text-success-700">
                      {m.customersGained || '—'}
                    </TableCell>
                    <TableCell className="tabular text-right text-danger-700">
                      {m.customersLost || '—'}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {m.customersLost ? `${m.gaveAReason}/${m.customersLost}` : '—'}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {m.monthlyCentsLost ? money(m.monthlyCentsLost / 100) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {competitors.length ? (
        <Alert tone="neutral" title="Who they moved to">
          {competitors.join(', ')}. Losing to the same one twice is a pattern; losing to it
          five times is a decision somebody has to make.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Every cancellation</CardTitle>
          <CardDescription>
            What they said, what they were worth, and whether they have come back since.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>What they said</TableHead>
                <TableHead className="text-right">Was worth</TableHead>
                <TableHead className="text-right">Stayed</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.slice(0, 40).map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium text-charcoal-900">
                    {c.companyName}
                  </TableCell>
                  <TableCell>
                    {c.reasonLabel ? (
                      <Badge variant="default">{c.reasonLabel}</Badge>
                    ) : (
                      <Badge variant="warn">Nobody was asked</Badge>
                    )}
                    {c.competitor ? (
                      <span className="mt-1 block text-xs text-charcoal-500">
                        → {c.competitor}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-72 text-xs text-charcoal-600">
                    {c.detail ?? '—'}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-700">
                    {c.monthlyCentsAtCancellation == null ? '—'
                      : money(c.monthlyCentsAtCancellation / 100)}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {c.monthsAsACustomer == null ? '—' : `${c.monthsAsACustomer} mo`}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                    {date(c.occurredAt)}
                  </TableCell>
                  <TableCell>
                    {c.cameBack ? <Badge variant="success">Came back</Badge> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!list.length && listQ.status === 'ready' ? (
            <EmptyState title="Nobody has canceled yet" />
          ) : null}
        </CardContent>
      </Card>

      <Alert tone="neutral" icon={<ShieldCheck className="size-4" />}
        title="Why the money here is stored rather than calculated">
        Once a subscription ends, its items are gone and what the customer was paying
        cannot be recovered. It is written down at the moment they cancel, which is the one
        place in this platform where storing a computed number is the correct choice.
        {!can('billing.read') ? ' You are seeing none of it, because you hold no permission to.' : ''}
      </Alert>
    </div>
  );
}
