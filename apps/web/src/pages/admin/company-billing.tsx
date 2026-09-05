import { useEffect, useState } from 'react';
import { useParams, Link, useOutletContext } from 'react-router-dom';
import {
  ArrowLeft, Eye, EyeOff, Loader2, ShieldAlert, AlertTriangle, ExternalLink,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@/lib/data/query';
import {
  loadCompanyBilling, loadCompanyInvoices, openSupportSession, closeSupportSession,
  isSupporting,
} from '@/lib/data/admin';
import { ErrorState, EmptyState } from '@/components/data-state';
import { supabase } from '@/lib/supabase';
import { money, date, dateTime, integer } from '@/lib/format';
import type { OperatorContext } from './shell';

/**
 * One customer's subscription, from the inside.
 *
 * Not impersonation, deliberately. Becoming the customer would show an
 * operator every estimate, margin and contract they hold — none of which
 * answers a billing question — and would record whatever the operator did as
 * the customer having done it. This opens a view instead: one company, billing
 * only, for a stated reason, for an hour, written into the customer's own
 * account history where they can read it.
 *
 * Everything on this screen is closed until a session is open. That is the
 * database's answer, not this screen's: the views return nothing without one.
 */
export function AdminCompanyBilling() {
  const { companyId = '' } = useParams();
  const { can } = useOutletContext<OperatorContext>();
  const maySupport = can('support.open');

  const [open, setOpen] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const billingQ = useQuery(loadCompanyBilling(companyId), [companyId, open]);
  const invoicesQ = useQuery(loadCompanyInvoices(companyId), [companyId, open]);

  useEffect(() => {
    if (!supabase || !companyId) { setOpen(false); return; }
    let canceled = false;
    void isSupporting(supabase, companyId)
      .then((v) => { if (!canceled) setOpen(v); })
      .catch(() => { if (!canceled) setOpen(false); });
    return () => { canceled = true; };
  }, [companyId]);

  const billing = billingQ.status === 'ready' ? billingQ.data : null;
  const invoices = invoicesQ.status === 'ready' ? invoicesQ.data : [];

  const failure = [billingQ, invoicesQ].find((q) => q.status === 'error');
  if (failure) return <ErrorState message={failure.message} onRetry={failure.refetch} />;

  async function start() {
    if (!supabase) return;
    setBusy(true); setError(null);
    try {
      await openSupportSession(supabase, companyId, reason);
      setReason(''); setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That session could not be opened.');
    } finally { setBusy(false); }
  }

  async function stop() {
    if (!supabase) return;
    setBusy(true); setError(null);
    try {
      await closeSupportSession(supabase, companyId);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That session could not be closed.');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
            <Link to="/admin/companies"><ArrowLeft className="size-4" /> All companies</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">
            {billing?.companyName ?? 'Customer account'}
          </h1>
          <p className="mt-1 text-sm text-charcoal-500">
            Their subscription, as they see it. Billing only.
          </p>
        </div>
        {open ? (
          <Button variant="outline" disabled={busy} onClick={stop}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <EyeOff className="size-4" />}
            Close the session
          </Button>
        ) : null}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {open === false ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="size-4" /> Open this account
            </CardTitle>
            <CardDescription>
              For an hour, and for a reason the customer will read. This shows their
              subscription, invoices, seats, allowances and any arrangement in force — and
              nothing they have built. It never signs you in as them, so nothing you do here
              can appear in their history as something they did.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="support-why">What you are looking into</Label>
              <Input id="support-why" value={reason}
                placeholder="Customer says they were charged twice in March"
                onChange={(e) => setReason(e.target.value)} />
            </div>
            <Button disabled={!maySupport || busy || reason.trim().length < 10}
              onClick={start}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
              Open for an hour
            </Button>
            <p className="text-xs text-charcoal-500">
              This is written into the company&apos;s own account history, where the customer
              can read who opened it, why, and when it ends.
              {!maySupport ? (
                <> Opening an account is its own permission, separate from reading billing —
                  set it per role under <strong>Roles</strong>.</>
              ) : null}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {open && !billing && billingQ.status === 'ready' ? (
        <EmptyState title="That session has ended"
          hint="Sessions last an hour. Open another if you still need to look." />
      ) : null}

      {billing ? (
        <>
          {billing.unprocessedEvents > 0 ? (
            <Alert tone="danger" icon={<AlertTriangle className="size-4" />}
              title={`${integer(billing.unprocessedEvents)} Stripe event(s) for this customer never finished`}>
              This is the usual answer to &quot;I paid and nothing happened&quot;. The payment
              reached Stripe; the message telling GrounUp about it did not land.
            </Alert>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Subscription</CardTitle>
                <CardDescription>What Stripe says, mirrored from its webhooks.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  <Row label="Standing">
                    <Badge variant={billing.subscriptionStatus === 'active' ? 'success'
                      : billing.subscriptionStatus ? 'warn' : 'default'}>
                      {billing.subscriptionStatus ?? 'No subscription'}
                    </Badge>
                    {billing.cancelAtPeriodEnd ? (
                      <Badge variant="danger" className="ml-1.5">Canceling</Badge>
                    ) : null}
                  </Row>
                  <Row label="Plan">
                    {billing.planName ?? billing.planId}
                    {billing.entitlementSource ? (
                      <span className="ml-1.5 text-charcoal-500">
                        via {billing.entitlementSource.replace(/_/g, ' ')}
                      </span>
                    ) : null}
                  </Row>
                  <Row label="Billed a month">{money(billing.billedMonthlyCents / 100)}</Row>
                  <Row label="Seats">
                    {integer(billing.seats)} in use
                    {billing.seatsBilled != null
                      ? ` · ${integer(billing.seatsBilled)} billed` : ''}
                  </Row>
                  <Row label="Per seat">
                    {billing.seatPriceMonthCents == null ? '—'
                      : money(billing.seatPriceMonthCents / 100)}
                  </Row>
                  <Row label="This period">
                    {billing.currentPeriodStart && billing.currentPeriodEnd
                      ? `${date(billing.currentPeriodStart)} – ${date(billing.currentPeriodEnd)}`
                      : '—'}
                  </Row>
                  <Row label="Card">
                    {billing.cardBrand
                      ? `${billing.cardBrand} ending ${billing.cardLast4}`
                      : 'None on file'}
                  </Row>
                  <Row label="Stripe">
                    <code className="text-xs text-charcoal-600">
                      {billing.stripeCustomerId ?? '—'}
                    </code>
                  </Row>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>What they are using</CardTitle>
                <CardDescription>
                  Against what their plan includes. The same figures their own usage screen
                  shows, from the same function.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  <Row label="AI credits">
                    {integer(billing.aiRequestsThisPeriod)} this period
                    {billing.aiCreditsIncluded != null
                      ? ` of ${integer(billing.aiCreditsIncluded)}` : ' · unlimited'}
                  </Row>
                  <Row label="Storage">
                    {billing.storageGb} GB
                    {billing.storageGbIncluded != null
                      ? ` of ${billing.storageGbIncluded} GB` : ' · unlimited'}
                  </Row>
                  <Row label="Arrangement">
                    {billing.terms ? (
                      <>
                        <Badge variant="warn">
                          {billing.terms === 'free' ? 'Comped'
                            : billing.terms === 'percent_off'
                              ? `${billing.percentOff}% off`
                              : money((billing.agreedSeatPriceCents ?? 0) / 100) + ' a seat'}
                        </Badge>
                        <span className="ml-1.5 text-charcoal-500">{billing.termsReason}</span>
                      </>
                    ) : 'List price'}
                  </Row>
                  <Row label="Features turned on by hand">
                    {billing.liveOverrides || 'None'}
                  </Row>
                  <Row label="Access good until">
                    {billing.accessValidUntil ? dateTime(billing.accessValidUntil)
                      : 'No end date'}
                  </Row>
                  <Row label="Customer since">{date(billing.companySince)}</Row>
                </dl>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
              <CardDescription>
                Stripe&apos;s own documents. Sending the customer this link sends them the
                same page they can already open themselves.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Standing</TableHead>
                    <TableHead className="text-right">Due</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((i) => (
                    <TableRow key={i.stripeInvoiceId}>
                      <TableCell className="text-charcoal-800">
                        {i.number ?? i.stripeInvoiceId}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                        {i.periodStart && i.periodEnd
                          ? `${date(i.periodStart)} – ${date(i.periodEnd)}` : date(i.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={i.status === 'paid' ? 'success' : 'warn'}>
                          {i.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular text-right text-charcoal-700">
                        {money(i.amountDueCents / 100)}
                      </TableCell>
                      <TableCell className="tabular text-right text-charcoal-900">
                        {money(i.amountPaidCents / 100)}
                      </TableCell>
                      <TableCell>
                        {i.hostedInvoiceUrl ? (
                          <Button asChild size="sm" variant="ghost">
                            <a href={i.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                              Open <ExternalLink className="size-3.5" />
                            </a>
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!invoices.length && invoicesQ.status === 'ready' ? (
                <EmptyState title="No invoices yet"
                  hint="Stripe writes these here as it issues them." />
              ) : null}
            </CardContent>
          </Card>

          <Alert tone="neutral" icon={<ShieldAlert className="size-4" />}
            title="This is the whole of what a session opens">
            No estimates, no projects, no documents, no margins, and no card number — brand
            and last four are all Stripe gives anybody. If a ticket needs more than this,
            it needs the customer on the call rather than a wider door.
          </Alert>
        </>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b
                    border-charcoal-100 pb-2 last:border-0">
      <dt className="text-charcoal-500">{label}</dt>
      <dd className="text-right font-medium text-charcoal-900">{children}</dd>
    </div>
  );
}
