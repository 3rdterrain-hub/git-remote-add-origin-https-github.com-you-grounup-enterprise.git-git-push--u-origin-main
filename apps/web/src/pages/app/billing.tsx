/**
 * Billing, on the company's own numbers.
 *
 * This was the last screen in the application computing from literals. Five
 * usage bars, four invoices, a plan, a period, a card and the word "Active"
 * were typed into the component and drawn in the same shapes and colors as
 * everything real beside them, so a customer looking at their own billing page
 * saw somebody else's figures presented as theirs. On this page that matters
 * more than on any other: it is where a dispute starts.
 *
 * Every figure now comes from state a signature-verified Stripe webhook wrote —
 * `subscriptions`, `billing_invoices`, `entitlements` — or from the two views
 * the limit checks themselves read. So the seat count on the bar and the
 * refusal on the eleventh invitation come from one place and cannot drift.
 *
 * Nothing on this screen can be written from the browser. There is no INSERT or
 * UPDATE policy for `authenticated` on any of these tables; the webhook writes
 * them under the service role. Changing a subscription means Stripe Checkout or
 * the Stripe portal, both of which are opened by an Edge Function that holds
 * the secret key server-side.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CreditCard, ExternalLink, Loader2, ShieldCheck, Receipt, Gauge, AlertTriangle, ArrowUpRight,
  FileText,
} from 'lucide-react';
import { PageHeader, StatTile, Field, useAnswerBelow } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, Progress, Separator } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState, ErrorState, EmptyState, DemonstrationNotice } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import {
  loadMyPlan, loadMySubscription, loadUsage, loadInvoices, loadBillableSeats, STATUS_SAYS,
  type UsageLine,
} from '@/lib/data/billing';
import { callFunction, isSupabaseConfigured } from '@/lib/supabase';
import { money, date, percent, integer, titleCase, plural } from '@/lib/format';
import { usePermissions, useCompanyId } from '@/lib/data/session';
import { CancelDialog } from '@/components/billing/cancel-dialog';

export function BillingPage() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [canceled, setCanceled] = useState<string | null>(null);
  /* The card each of the four boxes above sends you to. */
  const { showing, show } = useAnswerBelow();

  const { companyId } = useCompanyId();
  const planQ = useQuery(loadMyPlan(companyId), [companyId]);
  const subQ = useQuery(loadMySubscription(companyId), [companyId]);
  const usageQ = useQuery(loadUsage(companyId), [companyId]);
  const invoicesQ = useQuery(loadInvoices(companyId), [companyId]);
  const seatsQ = useQuery(loadBillableSeats(companyId), [companyId]);

  const { can } = usePermissions();
  const canManage = can('billing.manage');

  const plan = planQ.status === 'ready' ? planQ.data : null;
  const sub = subQ.status === 'ready' ? subQ.data : null;
  const usage: UsageLine[] = usageQ.status === 'ready' ? usageQ.data : [];
  const invoices = invoicesQ.status === 'ready' ? invoicesQ.data : [];
  const billableSeats = seatsQ.status === 'ready' ? seatsQ.data : null;

  const demonstration = planQ.status === 'demonstration';
  const loading = planQ.status === 'loading' || subQ.status === 'loading';
  const failure = [planQ, subQ, usageQ, invoicesQ]
    .find((q) => q.status === 'error') as { status: 'error'; message: string; refetch: () => void } | undefined;

  /*
   * The plan name comes from the entitlement rather than the subscription: an
   * enterprise contract or an attributed manual grant entitles a company that
   * has no Stripe subscription at all, and a canceled subscription still
   * entitles until its period ends.
   */
  const planName = plan?.planName ?? sub?.planName ?? null;
  const status = sub ? STATUS_SAYS[sub.status] ?? { label: titleCase(sub.status), tone: 'default' as const } : null;
  const entitled = plan?.entitlementSource ?? null;

  async function openPortal() {
    setError(null);
    if (!isSupabaseConfigured || !companyId) {
      setError('The billing portal requires a configured Supabase project with the Stripe Edge Functions deployed.');
      return;
    }
    setPending('portal');
    try {
      const { url } = await callFunction<{ url: string }>('create-billing-portal-session', {
        companyId, returnPath: '/app/billing',
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The billing portal could not be opened.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      {canceling && companyId ? (
        <CancelDialog companyId={companyId} onClose={() => setCanceling(false)}
          onDone={(until) => {
            setCanceling(false);
            setCanceled(until);
            subQ.refetch();
            planQ.refetch();
          }} />
      ) : null}

      {canceled !== null ? (
        <Alert tone="warn" icon={<AlertTriangle className="size-4" />}
          title="Your subscription will not renew">
          You keep everything until {date(canceled)}, and nothing you have made is deleted
          after that — estimates, projects and documents stay readable and exportable.
        </Alert>
      ) : null}

      <PageHeader
        title="Billing & Subscription"
        description="Payment is handled entirely by Stripe. GrounUp stores the customer and subscription identifiers, the plan, the status and the period — never a card number."
        actions={
          <>
            <Button variant="outline" onClick={openPortal}
              disabled={!canManage || !companyId || pending === 'portal'}>
              {pending === 'portal' ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
              Manage payment method
            </Button>
            <Button asChild><Link to="/pricing">Change plan <ArrowUpRight className="size-4" /></Link></Button>
            <Button variant="ghost" disabled={!canManage || !companyId || !sub?.isLive}
              onClick={() => setCanceling(true)}>
              Cancel subscription
            </Button>
          </>
        }
      />

      {demonstration ? <DemonstrationNotice what="this page" /> : null}
      {loading ? <LoadingState label="Reading your subscription" /> : null}
      {failure ? <ErrorState message={failure.message} onRetry={failure.refetch} /> : null}

      {!canManage ? (
        <Alert tone="warn" icon={<AlertTriangle className="size-4" />} title="You can view billing but not change it">
          Your role holds <code className="font-mono text-[12px]">billing.read</code> but not{' '}
          <code className="font-mono text-[12px]">billing.manage</code>. Ask a company owner or
          administrator to make subscription changes.
        </Alert>
      ) : null}

      {sub?.cancelAtPeriodEnd && sub.currentPeriodEnd ? (
        <Alert tone="warn" icon={<AlertTriangle className="size-4" />}
          title="This subscription will not renew">
          Access continues until {date(sub.currentPeriodEnd)}. Nothing is deleted after that.
        </Alert>
      ) : null}

      {error ? <Alert tone="danger" icon={<AlertTriangle className="size-4" />}>{error}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Current plan" value={planName ?? '—'} tone="accent"
          icon={<ShieldCheck className="size-4" />}
          hint={plan?.tagline ?? (demonstration ? 'connect a workspace to read it' : 'from your entitlement')}
          onClick={() => show('subscription-detail')} active={showing === 'subscription-detail'}
          actionLabel="Show what this subscription is" />
        <StatTile label="Plan cost"
          value={sub?.recurringCents != null ? money(sub.recurringCents / 100) : '—'}
          icon={<Receipt className="size-4" />}
          hint={costHint(sub)}
          onClick={() => show('billing-history')} active={showing === 'billing-history'}
          actionLabel="Show what has actually been charged" />
        <StatTile label="Subscription status" value={status?.label ?? '—'}
          tone={status?.tone === 'default' ? 'neutral' : status?.tone ?? 'neutral'}
          hint={sub?.lastEventAt
            ? `from the Stripe webhook of ${date(sub.lastEventAt)}`
            : 'from the last verified Stripe webhook'}
          detail={
            <div className="space-y-2">
              <p>
                Read from subscription state written by a signature-verified Stripe webhook, and from
                nowhere else. Coming back from a checkout page does not activate anything: a browser
                that has been redirected has proved nothing about whether a payment succeeded, and
                treating a redirect as payment is how paid access gets handed out for free.
              </p>
              <p>
                So there is a gap between paying and this reading Active — the length of a webhook —
                and that gap is deliberate.
              </p>
              {entitled && entitled !== 'stripe_webhook' ? (
                <p>
                  This company&apos;s access comes from {titleCase(entitled.replace(/_/g, ' ')).toLowerCase()} rather
                  than from a subscription, which is why the status above may not be the whole story.
                </p>
              ) : null}
            </div>
          } />
        <StatTile label="Seats used"
          value={seatLabel(usage, billableSeats)}
          icon={<Gauge className="size-4" />}
          hint={billableSeats == null
            ? 'people who can sign in, plus invitations'
            : `${plural(billableSeats, 'billable seat')} on the invoice`}
          onClick={() => show('usage-this-period')} active={showing === 'usage-this-period'}
          actionLabel="Show every limit and what is used against it" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card id="usage-this-period">
          <CardHeader>
            <CardTitle>Usage this period</CardTitle>
            <CardDescription>
              Read from the same two views the limit checks read, so the bar that says 7 of 10 and
              the refusal on the eleventh cannot disagree. An unlimited allowance is shown as
              unlimited rather than as a full bar.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {usageQ.status === 'loading' ? <LoadingState label="Reading usage" /> : null}
            {usage.length === 0 && usageQ.status !== 'loading' ? (
              <EmptyState
                title="No usage to report"
                hint="Usage appears here once there is a workspace behind this page with a plan on it." />
            ) : null}
            {usage.map((u) => {
              const ratio = u.limit ? u.used / u.limit : 0;
              return (
                <div key={u.metric}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-charcoal-900">{u.metric}</span>
                    <span className="tabular text-sm text-charcoal-700">
                      {integer(u.used)}{u.unit}{' '}
                      <span className="text-charcoal-400">
                        {u.limit == null ? 'of unlimited' : `of ${integer(u.limit)}${u.unit}`}
                      </span>
                    </span>
                  </div>
                  <Progress value={u.limit ? Math.min(ratio * 100, 100) : 0} className="mt-1.5"
                    indicatorClassName={ratio > 0.9 ? 'bg-danger-500' : ratio > 0.75 ? 'bg-warn-600' : 'bg-success-600'} />
                  <p className="mt-0.5 text-xs text-charcoal-500">
                    {u.limit == null ? 'No limit on this plan' : `${percent(ratio, 0)} of the plan limit`}
                    {' · '}{u.note}
                  </p>
                </div>
              );
            })}
          </CardContent>
          <CardFooter>
            <Alert tone="neutral" icon={<ShieldCheck className="size-4" />}>
              Reaching a limit does not silently degrade the platform. GrounUp tells you which limit
              was reached and what it blocks, so an estimate is never quietly truncated.
            </Alert>
          </CardFooter>
        </Card>

        <Card id="subscription-detail">
          <CardHeader>
            <CardTitle>Subscription detail</CardTitle>
            <CardDescription>Written only from signature-verified Stripe webhooks.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sub ? (
              <dl className="grid grid-cols-2 gap-4">
                <Field label="Plan">{sub.planName}</Field>
                <Field label="Status">
                  <Badge variant={status?.tone === 'default' ? 'default' : status?.tone ?? 'default'}>
                    {status?.label ?? titleCase(sub.status)}
                  </Badge>
                </Field>
                <Field label="Period start">
                  {sub.currentPeriodStart ? date(sub.currentPeriodStart) : '—'}
                </Field>
                <Field label="Period end">
                  {sub.currentPeriodEnd ? date(sub.currentPeriodEnd) : '—'}
                </Field>
                <Field label="Payment method">
                  {sub.paymentLast4
                    ? `${sub.paymentBrand ? titleCase(sub.paymentBrand) : 'Card'} ···· ${sub.paymentLast4}`
                    : <span className="text-charcoal-400">none on file</span>}
                </Field>
                <Field label="Auto-renew">
                  <Badge variant={sub.cancelAtPeriodEnd ? 'warn' : 'success'}>
                    {sub.cancelAtPeriodEnd ? 'Off' : 'On'}
                  </Badge>
                </Field>
                {sub.trialEnd ? (
                  <Field label="Trial ends">{date(sub.trialEnd)}</Field>
                ) : null}
                {billableSeats != null ? (
                  <Field label="Billable seats">{billableSeats}</Field>
                ) : null}
              </dl>
            ) : (
              <EmptyState
                title={plan?.onTheFreePlan ? 'No paid subscription' : 'No subscription on record'}
                hint={plan?.onTheFreePlan
                  ? 'This company is on the free plan, which needs no subscription. Everything it includes is listed under Change plan.'
                  : 'A subscription appears here once one has been started and Stripe has told the platform about it.'} />
            )}
            <Separator />
            <div className="space-y-2 text-xs leading-relaxed text-charcoal-500">
              <p className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success-600" />
                Card details are collected by Stripe Checkout and never pass through GrounUp&apos;s
                frontend or database. Only the brand and last four digits are stored, for display.
              </p>
              <p className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success-600" />
                A successful redirect from Stripe grants nothing. Access changes only when the signed
                webhook is verified and processed, and each event is applied exactly once.
              </p>
              <p className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success-600" />
                Entitlement is necessary but not sufficient: a user still needs the matching
                permission from their role.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card id="billing-history">
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Billing history</CardTitle>
            <CardDescription>
              Mirrored from Stripe by the webhook, so it renders when Stripe is unreachable. Stripe
              remains the system of record, which is what the links go to.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={openPortal} disabled={!canManage || !companyId}>
            Open Stripe portal <ExternalLink className="size-4" />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {invoicesQ.status === 'loading' ? (
            <div className="p-6"><LoadingState label="Reading invoices" /></div>
          ) : invoices.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Nothing has been invoiced yet"
                hint="An invoice appears here when Stripe issues one and the webhook records it." />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead className="text-right">Document</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-mono text-sm text-charcoal-900">
                      {i.number ?? <span className="font-sans text-charcoal-400">not numbered</span>}
                    </TableCell>
                    <TableCell className="text-charcoal-600">
                      {i.periodStart ? date(i.periodStart) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={i.status === 'paid' ? 'success'
                        : i.status === 'open' ? 'warn'
                          : i.status === 'uncollectible' || i.status === 'void' ? 'danger' : 'default'}>
                        {titleCase(i.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular text-right font-medium">
                      {money(i.amountDueCents / 100)}
                      {i.amountPaidCents !== i.amountDueCents ? (
                        <span className="block text-xs font-normal text-charcoal-500">
                          {money(i.amountPaidCents / 100)} paid
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-charcoal-600">
                      {i.paidAt ? date(i.paidAt) : <span className="text-charcoal-400">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {/*
                        * A real link to Stripe's own document rather than a
                        * disabled button. The URL is on the row the webhook
                        * wrote; where it is absent there is nothing to open and
                        * the cell says so.
                        */}
                      {i.pdfUrl || i.hostedUrl ? (
                        <Button asChild variant="ghost" size="sm">
                          <a href={(i.pdfUrl ?? i.hostedUrl)!} target="_blank" rel="noreferrer noopener">
                            <FileText className="size-4" /> {i.pdfUrl ? 'PDF' : 'View'}
                          </a>
                        </Button>
                      ) : (
                        <span className="text-xs text-charcoal-400">not published</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** What the cost figure is per, and when it is next taken. */
function costHint(sub: { interval: 'month' | 'year' | null; currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean; hasMeteredItems: boolean; recurringCents: number | null } | null): string {
  if (!sub || sub.recurringCents == null) return 'no priced subscription item';
  const per = sub.interval === 'year' ? 'billed yearly' : 'billed monthly';
  const metered = sub.hasMeteredItems ? ', plus metered usage' : '';
  if (!sub.currentPeriodEnd) return `${per}${metered}`;
  return sub.cancelAtPeriodEnd
    ? `${per}${metered}, ends ${date(sub.currentPeriodEnd)}`
    : `${per}${metered}, next on ${date(sub.currentPeriodEnd)}`;
}

/**
 * Seats used against the seat limit.
 *
 * The limit line, not the billable count — they are different numbers and both
 * are right. Billing counts people who can sign in; the limit counts them plus
 * the invitations already sent, and it is the limit that refuses the next one.
 */
function seatLabel(usage: UsageLine[], billableSeats: number | null): string {
  const seats = usage.find((u) => u.metric === 'Seats');
  if (!seats) return billableSeats == null ? '—' : String(billableSeats);
  return seats.limit == null ? `${seats.used}` : `${seats.used} / ${seats.limit}`;
}
