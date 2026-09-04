import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CreditCard, ExternalLink, Loader2, ShieldCheck, Receipt, Gauge, AlertTriangle, ArrowUpRight,
} from 'lucide-react';
import { PageHeader, StatTile, Field } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, Progress, Separator } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { COMPANY, USER } from '@/data/demo';
import { PLANS } from '@/data/plans';
import { callFunction, isSupabaseConfigured } from '@/lib/supabase';
import { money, date, percent, integer } from '@/lib/format';

/** Usage against the plan's limits, as the entitlement endpoint reports it. */
const USAGE = [
  { metric: 'Seats', used: 7, limit: 10, unit: '' },
  { metric: 'Active estimates', used: 41, limit: 250, unit: '' },
  { metric: 'Active projects', used: 4, limit: 75, unit: '' },
  { metric: 'Storage', used: 34, limit: 100, unit: ' GB' },
  { metric: 'AI credits this period', used: 1_284, limit: 2_000, unit: '' },
];

const INVOICES = [
  { id: 'in_1', number: 'GU-2026-0812', status: 'paid', amount: 299_00, period: '2026-08-01', paid: '2026-08-01' },
  { id: 'in_2', number: 'GU-2026-0711', status: 'paid', amount: 299_00, period: '2026-07-01', paid: '2026-07-01' },
  { id: 'in_3', number: 'GU-2026-0610', status: 'paid', amount: 299_00, period: '2026-06-01', paid: '2026-06-01' },
  { id: 'in_4', number: 'GU-2026-0509', status: 'paid', amount: 299_00, period: '2026-05-01', paid: '2026-05-02' },
];

export function BillingPage() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plan = PLANS.find((p) => p.id === COMPANY.plan)!;
  const canManage = USER.permissions.includes('billing.manage');

  async function openPortal() {
    setError(null);
    if (!isSupabaseConfigured) {
      setError('The billing portal requires a configured Supabase project with the Stripe Edge Functions deployed.');
      return;
    }
    setPending('portal');
    try {
      const { url } = await callFunction<{ url: string }>('create-billing-portal-session', {
        companyId: COMPANY.id, returnPath: '/app/billing',
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
      <PageHeader
        title="Subscription & Billing"
        description="Payment is handled entirely by Stripe. GrounUp stores the customer and subscription identifiers, the plan, the status and the period — never a card number."
        actions={
          <>
            <Button variant="outline" onClick={openPortal} disabled={!canManage || pending === 'portal'}>
              {pending === 'portal' ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
              Manage payment method
            </Button>
            <Button asChild><Link to="/pricing">Change plan <ArrowUpRight className="size-4" /></Link></Button>
          </>
        }
      />

      {!canManage ? (
        <Alert tone="warn" icon={<AlertTriangle className="size-4" />} title="You can view billing but not change it">
          Your role holds <code className="font-mono text-[12px]">billing.read</code> but not{' '}
          <code className="font-mono text-[12px]">billing.manage</code>. Ask a company owner or
          administrator to make subscription changes.
        </Alert>
      ) : null}

      {error ? <Alert tone="danger" icon={<AlertTriangle className="size-4" />}>{error}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Current plan" value={plan.name} tone="accent" icon={<ShieldCheck className="size-4" />}
          hint={plan.seats} />
        <StatTile label="Monthly cost" value={money(plan.monthlyCents / 100)} icon={<Receipt className="size-4" />}
          hint="billed monthly, next on 1 September 2026" />
        <StatTile label="Subscription status" value="Active" tone="success"
          hint="from the last verified Stripe webhook" />
        <StatTile label="Seats used" value={`7 / ${plan.seats.replace(/\D/g, '') || '—'}`} icon={<Gauge className="size-4" />}
          hint="active company memberships" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Usage this period</CardTitle>
            <CardDescription>
              Metered from the usage ledger, which records what happened rather than what the browser
              claimed happened.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {USAGE.map((u) => {
              const ratio = u.used / u.limit;
              return (
                <div key={u.metric}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-charcoal-900">{u.metric}</span>
                    <span className="tabular text-sm text-charcoal-700">
                      {integer(u.used)}{u.unit} <span className="text-charcoal-400">of {integer(u.limit)}{u.unit}</span>
                    </span>
                  </div>
                  <Progress value={ratio * 100} className="mt-1.5"
                    indicatorClassName={ratio > 0.9 ? 'bg-danger-500' : ratio > 0.75 ? 'bg-warn-600' : 'bg-success-600'} />
                  <p className="mt-0.5 text-xs text-charcoal-500">{percent(ratio, 0)} of the plan limit</p>
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

        <Card>
          <CardHeader>
            <CardTitle>Subscription detail</CardTitle>
            <CardDescription>Written only from signature-verified Stripe webhooks.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Plan">{plan.name}</Field>
              <Field label="Status"><Badge variant="success">Active</Badge></Field>
              <Field label="Period start">{date('2026-08-01')}</Field>
              <Field label="Period end">{date('2026-09-01')}</Field>
              <Field label="Payment method">Visa ···· 4242</Field>
              <Field label="Auto-renew"><Badge variant="success">On</Badge></Field>
            </dl>
            <Separator />
            <div className="space-y-2 text-xs leading-relaxed text-charcoal-500">
              <p className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success-600" />
                Card details are collected by Stripe Checkout and never pass through GrounUp's
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

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Billing history</CardTitle>
            <CardDescription>Stripe remains the system of record; these rows mirror it for convenience.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={openPortal} disabled={!canManage}>
            Open Stripe portal <ExternalLink className="size-4" />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
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
              {INVOICES.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-mono text-sm text-charcoal-900">{i.number}</TableCell>
                  <TableCell className="text-charcoal-600">{date(i.period)}</TableCell>
                  <TableCell><Badge variant="success">Paid</Badge></TableCell>
                  <TableCell className="tabular text-right font-medium">{money(i.amount / 100)}</TableCell>
                  <TableCell className="text-charcoal-600">{date(i.paid)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" disabled={!canManage}>PDF</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
