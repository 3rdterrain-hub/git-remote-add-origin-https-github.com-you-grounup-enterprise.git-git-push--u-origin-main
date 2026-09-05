import { useOutletContext } from 'react-router-dom';
import {
  Building2, Banknote, TrendingUp, AlertTriangle, Webhook, Clock, ArrowUpRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@/lib/data/query';
import {
  loadAdminCompanies, loadWebhookHealth, loadUpsellPotential, loadProposals,
} from '@/lib/data/admin';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
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
 * Every number is counted rather than tracked. Monthly revenue is summed from
 * the plans companies are actually on, not from a figure somebody updates —
 * which means it cannot be stale, and it means it will disagree with Stripe
 * whenever a subscription is mid-change. The screen says which it is.
 */
export function AdminDashboard() {
  const { isSuper } = useOutletContext<OperatorContext>();
  const companiesQ = useQuery(loadAdminCompanies, []);
  const webhooksQ = useQuery(loadWebhookHealth, []);
  const potentialQ = useQuery(loadUpsellPotential, []);
  const proposalsQ = useQuery(loadProposals, []);

  const companies = companiesQ.status === 'ready' ? companiesQ.data : [];
  const webhooks = webhooksQ.status === 'ready' ? webhooksQ.data : [];
  const potential = potentialQ.status === 'ready' ? potentialQ.data : [];
  const proposals = proposalsQ.status === 'ready' ? proposalsQ.data : [];

  const failure = [companiesQ, webhooksQ, potentialQ, proposalsQ]
    .find((q) => q.status === 'error');
  if (failure) return <ErrorState message={failure.message} onRetry={failure.refetch} />;

  const paying = companies.filter((c) =>
    c.subscriptionStatus === 'active' || c.subscriptionStatus === 'trialing');
  const trials = companies.filter((c) => c.entitlementSource === 'trial');
  const stuck = webhooks.filter((w) => w.unprocessed);
  const open = proposals.filter((p) => p.state === 'proposed');
  const signals = potential.filter((p) => p.signal && p.signal !== 'Room to move up');

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
        <Tile label="Companies" value={integer(companies.length)}
          hint={`${integer(paying.length)} paying, ${integer(trials.length)} on trial`}
          icon={<Building2 className="size-4" />} />
        <Tile label="Proposal pipeline" value={money(pipelineCents / 100)}
          hint={`${integer(open.length)} open, per month as estimated`}
          icon={<TrendingUp className="size-4" />} tone={open.length ? 'warn' : 'neutral'} />
        <Tile label="Worth a call" value={integer(signals.length)}
          hint="at a limit, or a trial ending"
          icon={<ArrowUpRight className="size-4" />} />
        <Tile label="Stuck webhooks" value={integer(stuck.length)}
          hint={stuck.length ? 'someone paid and did not get access' : 'all events processed'}
          icon={<Webhook className="size-4" />}
          tone={stuck.length ? 'danger' : 'success'} />
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
                      <Badge variant="default">{p.currentPlan ?? 'none'}</Badge>
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
              <EmptyState title="Nobody is near a limit"
                hint="Which is either good news or a sign the limits are generous." />
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
