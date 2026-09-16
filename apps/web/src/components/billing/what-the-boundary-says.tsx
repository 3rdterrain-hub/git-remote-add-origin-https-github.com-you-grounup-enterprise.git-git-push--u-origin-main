/**
 * The allowance answer the platform actually enforces, and the charges that failed.
 *
 * Two reporting views with no reader anywhere.
 *
 * **`reporting_usage_allowance`** is the platform's own verdict — used, allowed,
 * remaining, and whether the company is within it — computed in the one place
 * the enforcement path evaluates. The bars above assemble their own answer from
 * two other views, which was reasonable and is now checkable: if the page ever
 * stops agreeing with what refuses the next action, this strip says so rather
 * than the customer finding out at the boundary.
 *
 * **`reporting_payment_problems`** is every failed charge with the reason Stripe
 * gave and whether Stripe has given up. That last fact is the whole difference
 * between a card that will retry itself on Tuesday and a subscription that ends
 * unless somebody acts, and nothing on this screen was saying which.
 */
import { AlertTriangle, Gauge } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import { loadAllowances, loadPaymentProblems } from '@/lib/data/billing';
import { integer, money, dateTime, plural } from '@/lib/format';

export function WhatTheBoundarySays({ companyId }: { companyId: string | null }) {
  const q = useQuery(loadAllowances(companyId), [companyId]);
  const rows = q.status === 'ready' ? q.data : [];
  const over = rows.filter((r) => !r.withinAllowance);

  if (q.status === 'demonstration') return null;

  return (
    <Card id="what-the-boundary-says">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4" /> What the boundary says
        </CardTitle>
        <CardDescription>
          The allowance verdict the platform enforces, read from the view the enforcement path
          evaluates. The bars above work it out from two other views; if the two ever stop
          agreeing, it shows here rather than at the moment something is refused.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.status === 'loading' ? <LoadingState label="Reading the allowances" /> : null}
        {q.status === 'error' ? <ErrorState message={q.message} onRetry={q.refetch} /> : null}

        {over.length > 0 ? (
          <Alert tone="danger" icon={<AlertTriangle className="size-4" />}
            title={`${plural(over.length, 'allowance')} exceeded`}>
            {over.map((r) => r.label).join(', ')}. The next action against{' '}
            {over.length === 1 ? 'it' : 'these'} is refused at the boundary, with the limit named.
          </Alert>
        ) : null}

        {rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Allowance</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead className="text-right">Allowed</TableHead>
                <TableHead className="text-right">Left</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.metric}>
                  <TableCell className="font-medium text-charcoal-900">{r.label}</TableCell>
                  <TableCell className="tabular text-right">{integer(r.used)}</TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {/* Unlimited is not the same as zero, and is said as words. */}
                    {r.allowed === null ? 'unlimited' : integer(r.allowed)}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {r.remaining === null ? '—' : integer(r.remaining)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.withinAllowance ? 'success' : 'danger'}>
                      {r.withinAllowance ? 'Within' : 'Over'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function PaymentProblems({ companyId }: { companyId: string | null }) {
  const q = useQuery(loadPaymentProblems(companyId), [companyId]);
  const rows = q.status === 'ready' ? q.data : [];

  /* Nothing failed: no card, rather than an empty card saying nothing failed. */
  if (q.status !== 'error' && rows.length === 0) return null;

  const givenUp = rows.filter((r) => r.stripeGaveUp);

  return (
    <Card id="payment-problems">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-danger-600" /> Charges that failed
        </CardTitle>
        <CardDescription>
          Written only from signature-verified Stripe webhooks. Whether Stripe is still retrying is
          the fact that decides what happens next, so it is said in words.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.status === 'error' ? <ErrorState message={q.message} onRetry={q.refetch} /> : null}

        {givenUp.length > 0 ? (
          <Alert tone="danger" title="Stripe has stopped retrying">
            {plural(givenUp.length, 'charge')} will not be attempted again. The subscription ends
            unless the invoice is paid.
          </Alert>
        ) : null}

        {rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Why it failed</TableHead>
                <TableHead>Last tried</TableHead>
                <TableHead>What happens next</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.stripeInvoiceId}
                  className={r.stripeGaveUp ? 'bg-danger-50/40' : undefined}>
                  <TableCell className="font-mono text-xs text-charcoal-600">
                    {r.hostedInvoiceUrl ? (
                      <a href={r.hostedInvoiceUrl} target="_blank" rel="noreferrer"
                        className="hover:underline">{r.stripeInvoiceId}</a>
                    ) : r.stripeInvoiceId}
                    <span className="block text-charcoal-400">
                      {plural(r.attempts, 'attempt')}
                    </span>
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {money(r.amountCents / 100)}
                  </TableCell>
                  <TableCell className="text-charcoal-700">
                    {r.failureMessage ?? r.failureCode ?? 'No reason given'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-charcoal-600">
                    {dateTime(r.lastFailedAt)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.stripeGaveUp ? (
                      <span className="font-medium text-danger-700">
                        Stripe has given up — pay the invoice to keep the subscription
                      </span>
                    ) : r.nextAttemptAt ? (
                      <span className="text-charcoal-600">
                        Retrying {dateTime(r.nextAttemptAt)}
                      </span>
                    ) : (
                      <span className="text-charcoal-500">No retry scheduled</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
