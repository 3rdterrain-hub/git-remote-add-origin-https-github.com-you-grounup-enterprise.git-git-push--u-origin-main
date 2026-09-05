import { useOutletContext } from 'react-router-dom';
import {
  Building2, Banknote, TrendingUp, AlertTriangle, Webhook, Clock, ArrowUpRight,
  Gift, UserPlus, Users, Scale,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@/lib/data/query';
import {
  loadAdminCompanies, loadWebhookHealth, loadUpsellPotential, loadProposals,
  loadRevenue, loadRevenueByCompany, loadGrowth, loadRecentSignups,
} from '@/lib/data/admin';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { ExportButton } from '@/components/admin/export-button';
import { money, integer, date } from '@/lib/format';
import type { OperatorContext } from './shell';

/**
 * What is going on, on one screen.
 *
 * Deliberately the business of running the platform and nothing else: how many
 * companies, who is paying, what is about to break, and who is worth a call.
 * There is no way from here into a customer's estimates, and there is not meant
 * to be.
 *
 * Every number is counted rather than tracked. Revenue is summed from the
 * subscription items Stripe's own webhooks mirrored — what Stripe bills, not
 * what GrounUp thinks it ought to. Where the two disagree the screen says so
 * and counts the accounts, rather than picking one and looking confident.
 */
export function AdminDashboard() {
  const { can } = useOutletContext<OperatorContext>();
  const isSuper = can('upsell.decide');
  const companiesQ = useQuery(loadAdminCompanies, []);
  const webhooksQ = useQuery(loadWebhookHealth, []);
  const potentialQ = useQuery(loadUpsellPotential, []);
  const proposalsQ = useQuery(loadProposals, []);
  const revenueQ = useQuery(loadRevenue, []);
  const byCompanyQ = useQuery(loadRevenueByCompany, []);
  const growthQ = useQuery(loadGrowth, []);
  const signupsQ = useQuery(loadRecentSignups, []);

  const companies = companiesQ.status === 'ready' ? companiesQ.data : [];
  const webhooks = webhooksQ.status === 'ready' ? webhooksQ.data : [];
  const potential = potentialQ.status === 'ready' ? potentialQ.data : [];
  const proposals = proposalsQ.status === 'ready' ? proposalsQ.data : [];
  const revenue = revenueQ.status === 'ready' ? revenueQ.data : null;
  const byCompany = byCompanyQ.status === 'ready' ? byCompanyQ.data : [];
  const growth = growthQ.status === 'ready' ? growthQ.data : [];
  const signups = signupsQ.status === 'ready' ? signupsQ.data : [];
  const thisMonth = growth.at(-1);
  const lastMonth = growth.at(-2);

  const failure = [companiesQ, webhooksQ, potentialQ, proposalsQ,
                   revenueQ, byCompanyQ, growthQ, signupsQ]
    .find((q) => q.status === 'error');
  if (failure) return <ErrorState message={failure.message} onRetry={failure.refetch} />;

  const paying = companies.filter((c) =>
    c.subscriptionStatus === 'active' || c.subscriptionStatus === 'trialing');
  const trials = companies.filter((c) => c.entitlementSource === 'trial');
  const stuck = webhooks.filter((w) => w.unprocessed);
  const open = proposals.filter((p) => p.state === 'proposed');
  // Null signal is a real answer under one plan: a customer inside every
  // allowance, billed for what they use, has no upsell to chase.
  const signals = potential.filter((p) => p.signal);

  /*
   * Estimated from the proposals on file rather than from the plan ladder: what
   * sales thinks an account is worth is a claim somebody made and can be asked
   * about, where a number derived from list prices would look authoritative and
   * mean nothing.
   */
  const pipelineCents = open.reduce((a, p) => a + (p.estimatedMonthlyCents ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Dashboard</h1>
        <p className="mt-1 text-sm text-charcoal-500">
          How the platform is doing. Counts and standing only — nothing here reaches into
          what a customer has built.
        </p>
      </div>

      {companiesQ.status === 'loading' ? <LoadingState label="Reading the platform" /> : null}

      {stuck.length ? (
        <Alert tone="danger" icon={<AlertTriangle className="size-4" />}
          title={`${integer(stuck.length)} Stripe event(s) arrived and never finished`}>
          A subscription that silently failed to activate is a customer who paid and cannot
          use what they paid for.
        </Alert>
      ) : null}

      {isSuper && open.length ? (
        <Alert tone="warn" icon={<Clock className="size-4" />}
          title={`${integer(open.length)} upsell proposal(s) waiting on you`}>
          Sales can propose; deciding is yours.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Recurring revenue"
          value={revenue ? money(revenue.mrrCents / 100) : '—'}
          hint={revenue ? `${money(revenue.arrCents / 100)} a year at this rate` : undefined}
          icon={<Banknote className="size-4" />}
          tone={revenue && revenue.mrrCents > 0 ? 'success' : 'neutral'} />
        <Tile label="Companies" value={integer(companies.length)}
          hint={`${integer(paying.length)} paying, ${integer(trials.length)} on trial`}
          icon={<Building2 className="size-4" />} />
        <Tile label="Seats"
          value={revenue ? integer(revenue.seatsInUse) : '—'}
          hint={revenue
            ? `${integer(revenue.seatsBilled)} billed${revenue.seatsUnbilled
                ? ` · ${integer(revenue.seatsUnbilled)} in use and not billed` : ''}`
            : undefined}
          icon={<Users className="size-4" />}
          tone={revenue && revenue.seatsUnbilled > 0 ? 'warn' : 'neutral'} />
        <Tile label="Stuck webhooks" value={integer(stuck.length)}
          hint={stuck.length ? 'someone paid and did not get access' : 'all events processed'}
          icon={<Webhook className="size-4" />}
          tone={stuck.length ? 'danger' : 'success'} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="New companies this month"
          value={thisMonth ? integer(thisMonth.newCompanies) : '—'}
          hint={lastMonth ? `${integer(lastMonth.newCompanies)} last month` : undefined}
          icon={<Building2 className="size-4" />} />
        <Tile label="New people this month"
          value={thisMonth ? integer(thisMonth.newUsers) : '—'}
          hint={lastMonth ? `${integer(lastMonth.newUsers)} last month` : undefined}
          icon={<UserPlus className="size-4" />} />
        <Tile label="Given away"
          value={revenue ? money((revenue.givenAwayCents + revenue.discountedCents) / 100) : '—'}
          hint={revenue
            ? `${integer(revenue.onTerms)} on terms, ${integer(revenue.onFree)} on the free plan`
            : undefined}
          icon={<Gift className="size-4" />}
          tone={revenue && revenue.givenAwayCents > 0 ? 'warn' : 'neutral'} />
        <Tile label="Stripe disagrees"
          value={revenue ? integer(revenue.accountsThatDisagree) : '—'}
          hint={revenue && revenue.accountsThatDisagree
            ? 'billed differently from what the plan says'
            : 'every account bills what its plan says'}
          icon={<Scale className="size-4" />}
          tone={revenue && revenue.accountsThatDisagree > 0 ? 'warn' : 'success'} />
      </div>

      {revenue && revenue.inArrears + revenue.leaving > 0 ? (
        <Alert tone="warn" icon={<AlertTriangle className="size-4" />}
          title={`${integer(revenue.inArrears)} account(s) behind on payment, `
            + `${integer(revenue.leaving)} canceling at the end of the period`}>
          Both are still using the platform today. Neither will be next month unless
          somebody calls.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Where the revenue comes from</CardTitle>
                <CardDescription>
                  What Stripe bills each account a month. A yearly subscription is shown
                  divided by twelve so it sits beside the monthly ones.
                </CardDescription>
              </div>
              <ExportButton what="Revenue by company" rows={byCompany} columns={[
                { header: 'Company', value: (r) => r.name },
                { header: 'Plan', value: (r) => r.planName },
                { header: 'Subscription', value: (r) => r.subscriptionStatus },
                { header: 'Canceling', value: (r) => r.cancelAtPeriodEnd },
                { header: 'Seats in use', value: (r) => r.seats },
                { header: 'Seats billed', value: (r) => r.seatsBilled },
                { header: 'Billed monthly', value: (r) => (r.billedMonthlyCents / 100).toFixed(2) },
                { header: 'Expected monthly', value: (r) => (r.expectedMonthlyCents / 100).toFixed(2) },
                { header: 'List monthly', value: (r) => (r.listMonthlyCents / 100).toFixed(2) },
                { header: 'Arrangement', value: (r) => r.terms },
                { header: 'Customer since', value: (r) => r.createdAt },
              ]} />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Standing</TableHead>
                  <TableHead className="text-right">Seats</TableHead>
                  <TableHead className="text-right">A month</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byCompany.slice(0, 12).map((r) => (
                  <TableRow key={r.companyId}>
                    <TableCell className="font-medium text-charcoal-900">
                      {r.name}
                      {r.terms ? (
                        <Badge variant="warn" className="ml-1.5">
                          {r.terms === 'free' ? 'Comped' : 'Discounted'}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.subscriptionStatus === 'active' ? 'success'
                        : r.subscriptionStatus ? 'warn' : 'default'}>
                        {r.subscriptionStatus ?? (r.onTheFreePlan ? 'Free' : 'No subscription')}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {r.seats}
                      {r.seatsBilled != null && r.seatsBilled !== r.seats
                        ? ` / ${r.seatsBilled} billed` : ''}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-900">
                      {money(r.billedMonthlyCents / 100)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!byCompany.length && byCompanyQ.status === 'ready' ? (
              <EmptyState title="Nothing is being billed yet"
                hint="Revenue appears here as Stripe confirms subscriptions." />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Who arrived</CardTitle>
            <CardDescription>
              The most recent people to sign up, and which company they landed in.
              Somebody with no company got stuck partway through.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Signed up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signups.slice(0, 12).map((u) => (
                  <TableRow key={u.userId}>
                    <TableCell className="text-charcoal-800">
                      {u.fullName ?? u.email ?? u.userId}
                    </TableCell>
                    <TableCell>
                      {u.noCompanyYet ? (
                        <Badge variant="warn">Never finished</Badge>
                      ) : (
                        <span className="text-charcoal-700">
                          {u.companyName}
                          {u.isOwner ? (
                            <Badge variant="default" className="ml-1.5">Owner</Badge>
                          ) : null}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                      {date(u.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!signups.length && signupsQ.status === 'ready' ? (
              <EmptyState title="Nobody has signed up yet" />
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Month by month</CardTitle>
          <CardDescription>
            Thirteen months, so this one has the same month last year beside it.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Companies</TableHead>
                <TableHead className="text-right">People</TableHead>
                <TableHead className="text-right">Subscriptions</TableHead>
                <TableHead className="text-right">Cancellations</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...growth].reverse().map((g) => (
                <TableRow key={g.month}>
                  <TableCell className="whitespace-nowrap text-charcoal-700">
                    {date(g.month)}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-900">
                    {g.newCompanies || '—'}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-700">
                    {g.newUsers || '—'}
                  </TableCell>
                  <TableCell className="tabular text-right text-success-700">
                    {g.newSubscriptions || '—'}
                  </TableCell>
                  <TableCell className="tabular text-right text-danger-700">
                    {g.canceledSubscriptions || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Proposal pipeline" value={money(pipelineCents / 100)}
          hint={`${integer(open.length)} open, per month as estimated`}
          icon={<TrendingUp className="size-4" />} tone={open.length ? 'warn' : 'neutral'} />
        <Tile label="Worth a call" value={integer(signals.length)}
          hint="over an allowance, or a trial ending"
          icon={<ArrowUpRight className="size-4" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Worth a call</CardTitle>
            <CardDescription>
              Derived from what the platform already knows — a limit reached, a trial
              running out — rather than from a guess about who might buy.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>On</TableHead>
                  <TableHead>Signal</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signals.slice(0, 12).map((p) => (
                  <TableRow key={p.companyId}>
                    <TableCell className="font-medium text-charcoal-900">{p.name}</TableCell>
                    <TableCell>
                      <Badge variant="default">
                        {p.currentPlanName ?? p.currentPlan ?? 'Free'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-charcoal-600">{p.signal}</TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {p.openProposals || ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!signals.length && potentialQ.status === 'ready' ? (
              <EmptyState title="Every account is inside its allowances"
                hint="Seats billed match seats used, and nobody is over on credits or storage." />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent proposals</CardTitle>
            <CardDescription>
              Every one carries the reason it was made, which is the point of proposing
              rather than simply doing.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Proposed</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposals.slice(0, 12).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-charcoal-900">
                      {companies.find((c) => c.companyId === p.companyId)?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-charcoal-600">
                      {p.proposedPlanId ?? ''}
                      {p.proposedFeatures.length
                        ? ` ${p.proposedFeatures.join(', ')}` : ''}
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        p.state === 'approved' ? 'success'
                        : p.state === 'rejected' ? 'danger'
                        : p.state === 'proposed' ? 'warn' : 'default'
                      }>{p.state}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                      {date(p.proposedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!proposals.length && proposalsQ.status === 'ready' ? (
              <EmptyState title="No proposals yet" />
            ) : null}
          </CardContent>
        </Card>
      </div>

      <p className="flex items-center gap-2 text-xs text-charcoal-500">
        <Banknote className="size-3.5" />
        Revenue figures here are estimates attached to proposals, not billed amounts.
        Billed revenue comes from Stripe and lives on the Billing screen.
      </p>
    </div>
  );
}

function Tile({ label, value, hint, icon, tone = 'neutral' }: {
  label: string; value: string; hint?: string; icon?: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warn' | 'danger';
}) {
  return (
    <div className="rounded-[--radius-card] border border-charcoal-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">{label}</p>
        <span className="text-charcoal-400">{icon}</span>
      </div>
      <p className={cnTone(tone)}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-charcoal-500">{hint}</p> : null}
    </div>
  );
}

function cnTone(tone: 'neutral' | 'success' | 'warn' | 'danger') {
  const base = 'tabular mt-1 text-2xl font-bold ';
  return base + (tone === 'danger' ? 'text-danger-700'
    : tone === 'warn' ? 'text-warn-700'
    : tone === 'success' ? 'text-success-700' : 'text-charcoal-900');
}
