import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import {
  CalendarClock, Banknote, Activity, AlertTriangle, ShieldCheck, TrendingUp,
  Check, X, Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@/lib/data/query';
import {
  loadCompanyActivity, loadExpiring, loadEarningsBy, loadProposals, loadAdminCompanies,
  decideUpsell, type EarningsGrain,
} from '@/lib/data/admin';
import { ExportButton } from '@/components/admin/export-button';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { money, integer, date, dateTime } from '@/lib/format';
import type { OperatorContext } from './shell';

const STANDING_TONE = {
  active: 'success', quiet: 'warn', 'gone dark': 'danger', 'never used': 'default',
} as const;

const KIND_LABEL = {
  trial: 'Trial', granted: 'Manual grant', canceling: 'Canceling',
  terms: 'Terms', allowance: 'Allowance',
} as const;

/**
 * What is ending, what is alive, and what came in.
 *
 * Three questions that each had an answer scattered across tables nobody would
 * think to open. The most useful of them is the first pair together: paying is
 * not the same as using, and the customers where those two answers differ are
 * the only ones worth a phone call this week.
 */
export function AdminReports() {
  const { can } = useOutletContext<OperatorContext>();
  const activityQ = useQuery(loadCompanyActivity, []);
  const expiringQ = useQuery(loadExpiring, []);
  const [grain, setGrain] = useState<EarningsGrain>('month');
  // Enough periods that each grain covers a comparable span: half a year of
  // weeks, two years of months, five years.
  const periods = grain === 'week' ? 26 : grain === 'month' ? 24 : 5;
  const earningsQ = useQuery(loadEarningsBy(grain, periods), [grain]);
  const [standing, setStanding] = useState<string>('all');
  /*
   * Upsell proposals live here rather than on a screen of their own. They were
   * on "Controls", a name that told nobody what was behind it — and the
   * dashboard tile that counted them led to a page where they were the third
   * thing down.
   */
  const proposalsQ = useQuery(loadProposals, []);
  const companiesQ = useQuery(loadAdminCompanies, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const activity = activityQ.status === 'ready' ? activityQ.data : [];
  const expiring = expiringQ.status === 'ready' ? expiringQ.data : [];
  const earnings = earningsQ.status === 'ready' ? earningsQ.data : [];

  const proposals = (proposalsQ.status === 'ready' ? proposalsQ.data : [])
    .filter((p) => p.state === 'proposed');
  const companies = companiesQ.status === 'ready' ? companiesQ.data : [];
  const companyName = (id: string) =>
    companies.find((c) => c.companyId === id)?.name ?? id;

  async function decide(id: string, approve: boolean) {
    if (!supabase) return;
    setBusy(id); setError(null);
    try {
      await decideUpsell(supabase, id, approve, note[id]?.trim() || null);
      proposalsQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That decision could not be recorded.');
    } finally { setBusy(null); }
  }

  const failure = [activityQ, expiringQ, earningsQ, proposalsQ, companiesQ]
    .find((q) => q.status === 'error');
  if (failure) return <ErrorState message={failure.message} onRetry={failure.refetch} />;

  const shown = standing === 'all'
    ? activity : activity.filter((a) => a.standing === standing);
  const payingAndGone = activity.filter((a) => a.payingAndGone);
  const soon = expiring.filter((e) =>
    new Date(e.endsAt).getTime() < Date.now() + 14 * 86400_000);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Reports</h1>
        <p className="mt-1 text-sm text-charcoal-500">
          Who is alive, what ends soon, and what actually came in.
        </p>
      </div>

      {activityQ.status === 'loading' ? <LoadingState label="Reading the platform" /> : null}

      {payingAndGone.length ? (
        <Alert tone="danger" icon={<AlertTriangle className="size-4" />}
          title={`${integer(payingAndGone.length)} account(s) are paying and have gone dark`}>
          Nobody has opened these in six weeks and the card is still being charged. That is a
          cancellation that has not been written yet, and it looks identical on the tenant
          list to a customer who is in the platform every day.
        </Alert>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {proposals.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-4" /> Upsells waiting on you ({proposals.length})
            </CardTitle>
            <CardDescription>
              Somebody wrote these up with a reason. You cannot approve one you proposed
              yourself — the same rule the platform applies inside a customer&apos;s own
              account when an estimate is approved.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {proposals.map((p) => (
              <div key={p.id} className="rounded border border-charcoal-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-charcoal-900">
                      {companyName(p.companyId)}
                      {p.estimatedMonthlyCents != null ? (
                        <span className="ml-2 text-sm font-normal text-charcoal-600">
                          {money(p.estimatedMonthlyCents / 100)} a month estimated
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-sm text-charcoal-600">{p.rationale}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {p.proposedPlanId ? (
                        <Badge variant="success">Move to {p.proposedPlanId}</Badge>
                      ) : null}
                      {p.proposedFeatures.map((f) => (
                        <Badge key={f} variant="default">{f}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Input value={note[p.id] ?? ''} className="h-8 w-56 text-xs"
                      placeholder="Note (required to reject)"
                      aria-label="Decision note"
                      onChange={(e) => setNote({ ...note, [p.id]: e.target.value })} />
                    <div className="flex gap-1.5">
                      <Button size="sm" disabled={busy === p.id}
                        onClick={() => decide(p.id, true)}>
                        <Check className="size-3.5" /> Approve
                      </Button>
                      <Button size="sm" variant="ghost"
                        disabled={busy === p.id || (note[p.id] ?? '').trim().length < 5}
                        onClick={() => decide(p.id, false)}>
                        <X className="size-3.5" /> Reject
                      </Button>
                      {busy === p.id ? (
                        <Loader2 className="mt-1.5 size-4 animate-spin text-charcoal-400" />
                      ) : null}
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-xs text-charcoal-500">
                  Approving records the decision. Applying it to the customer is a separate,
                  audited act on their own page — so what was agreed and what was done stay
                  two facts rather than one.
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="size-4" /> Ending within sixty days ({expiring.length})
              </CardTitle>
              <CardDescription>
                Trials, manual grants, subscriptions already canceled, comps and discounts,
                and allowances given for a while. Five kinds of ending on five tables, which
                is why nobody was watching any of them.
              </CardDescription>
            </div>
            <ExportButton what="Expiring" rows={expiring} columns={[
              { header: 'Company', value: (e) => e.companyName },
              { header: 'What', value: (e) => e.what },
              { header: 'Kind', value: (e) => e.kind },
              { header: 'Detail', value: (e) => e.detail },
              { header: 'Ends', value: (e) => e.endsAt },
              { header: 'Seats', value: (e) => e.seats },
            ]} />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {soon.length ? (
            <div className="border-b border-warn-200 bg-warn-50/60 px-4 py-2 text-sm
                            text-warn-800">
              {integer(soon.length)} of these end within a fortnight.
            </div>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>What ends</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead className="text-right">Seats</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expiring.map((e) => (
                <TableRow key={`${e.companyId}:${e.kind}:${e.endsAt}`}>
                  <TableCell className="font-medium text-charcoal-900">
                    <Link to={`/admin/companies/${e.companyId}`}
                      className="underline-offset-2 hover:underline">{e.companyName}</Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={e.kind === 'canceling' ? 'danger' : 'warn'}>
                      {KIND_LABEL[e.kind]}
                    </Badge>
                    <span className="ml-1.5 text-xs text-charcoal-600">{e.what}</span>
                  </TableCell>
                  <TableCell className="text-xs text-charcoal-600">{e.detail || '—'}</TableCell>
                  <TableCell className="tabular text-right text-charcoal-700">{e.seats}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                    {dateTime(e.endsAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!expiring.length && expiringQ.status === 'ready' ? (
            <EmptyState title="Nothing ends in the next two months" />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-4" /> Who is actually using it
              </CardTitle>
              <CardDescription>
                Beside whether they are paying. The interesting customers are the ones where
                those two answers differ — paying and gone dark is a cancellation waiting to
                happen, and busy on the free plan is a sale.
              </CardDescription>
            </div>
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="standing" className="text-xs">Standing</Label>
                <select id="standing" value={standing}
                  className="h-9 rounded border border-charcoal-300 bg-white px-2 text-sm"
                  onChange={(e) => setStanding(e.target.value)}>
                  <option value="all">All companies</option>
                  <option value="active">Active</option>
                  <option value="quiet">Quiet</option>
                  <option value="gone dark">Gone dark</option>
                  <option value="never used">Never used</option>
                </select>
              </div>
              <ExportButton what="Company activity" rows={shown} columns={[
                { header: 'Company', value: (a) => a.name },
                { header: 'Plan', value: (a) => a.planId },
                { header: 'Subscription', value: (a) => a.subscriptionStatus },
                { header: 'Standing', value: (a) => a.standing },
                { header: 'Days quiet', value: (a) => a.daysQuiet },
                { header: 'Last seen', value: (a) => a.lastSeen },
                { header: 'Seats', value: (a) => a.seats },
                { header: 'Estimates', value: (a) => a.estimates },
                { header: 'Projects', value: (a) => a.projects },
              ]} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Standing</TableHead>
                <TableHead>Paying</TableHead>
                <TableHead className="text-right">Seats</TableHead>
                <TableHead className="text-right">Built</TableHead>
                <TableHead>Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.slice(0, 100).map((a) => (
                <TableRow key={a.companyId}
                  className={a.payingAndGone ? 'bg-danger-50/40' : undefined}>
                  <TableCell className="font-medium text-charcoal-900">
                    <Link to={`/admin/companies/${a.companyId}`}
                      className="underline-offset-2 hover:underline">{a.name}</Link>
                    {a.suspended ? (
                      <Badge variant="danger" className="ml-1.5">read-only</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STANDING_TONE[a.standing]}>{a.standing}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-charcoal-600">
                    {a.subscriptionStatus ?? a.planId}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-700">{a.seats}</TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {integer(a.estimates)} / {integer(a.projects)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                    {a.lastSeen ? `${date(a.lastSeen)} · ${a.daysQuiet}d` : 'never'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!shown.length && activityQ.status === 'ready' ? (
            <EmptyState title="No company matches that" />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Banknote className="size-4" /> What came in
              </CardTitle>
              <CardDescription>
                Money, by the month the invoice covers rather than the day it was raised —
                an invoice issued on the thirty-first for the following month is next
                month&apos;s money, and mixing those is how a revenue report stops matching
                the accounts.
              </CardDescription>
            </div>
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="grain" className="text-xs">By</Label>
                <select id="grain" value={grain}
                  className="h-9 rounded border border-charcoal-300 bg-white px-2 text-sm"
                  onChange={(e) => setGrain(e.target.value as EarningsGrain)}>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                  <option value="year">Year</option>
                </select>
              </div>
            <ExportButton what={`Earnings by ${grain}`} rows={earnings} columns={[
              { header: 'Period', value: (m) => m.month },
              { header: 'Invoiced', value: (m) => (m.invoicedCents / 100).toFixed(2) },
              { header: 'Paid', value: (m) => (m.paidCents / 100).toFixed(2) },
              { header: 'Outstanding', value: (m) => (m.outstandingCents / 100).toFixed(2) },
              { header: 'Refunded', value: (m) => (m.refundedCents / 100).toFixed(2) },
              { header: 'Net', value: (m) => (m.netCents / 100).toFixed(2) },
              { header: 'Invoices', value: (m) => m.invoices },
              { header: 'Paying companies', value: (m) => m.payingCompanies },
            ]} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{grain === 'week' ? 'Week of' : grain === 'year' ? 'Year' : 'Month'}</TableHead>
                <TableHead className="text-right">Invoiced</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">Refunded</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Customers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {earnings.filter((m) => m.invoices > 0).map((m) => (
                <TableRow key={m.month}>
                  <TableCell className="whitespace-nowrap text-charcoal-700">
                    {date(m.month)}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-700">
                    {money(m.invoicedCents / 100)}
                  </TableCell>
                  <TableCell className="tabular text-right text-success-700">
                    {money(m.paidCents / 100)}
                  </TableCell>
                  <TableCell className="tabular text-right text-warn-700">
                    {m.outstandingCents ? money(m.outstandingCents / 100) : '—'}
                  </TableCell>
                  <TableCell className="tabular text-right text-danger-700">
                    {m.refundedCents ? money(m.refundedCents / 100) : '—'}
                  </TableCell>
                  <TableCell className="tabular text-right font-medium text-charcoal-900">
                    {money(m.netCents / 100)}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {m.payingCompanies || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!earnings.some((m) => m.invoices > 0) && earningsQ.status === 'ready' ? (
            <EmptyState title="No invoices yet"
              hint="Money appears here as Stripe issues invoices." />
          ) : null}
        </CardContent>
      </Card>

      <Alert tone="neutral" icon={<ShieldCheck className="size-4" />}
        title="Why this is not the same as the dashboard figure">
        The dashboard reports recurring revenue, which is a rate: what the subscriptions
        would bill if nothing changed. This is money — invoiced, paid, refunded, net. They
        will not match, and neither is wrong.
        {!can('billing.read') ? ' You are seeing none of the money, because you hold no permission to.' : ''}
      </Alert>
    </div>
  );
}
