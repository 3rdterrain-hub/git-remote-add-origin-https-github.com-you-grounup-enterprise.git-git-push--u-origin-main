import { useOutletContext } from 'react-router-dom';
import { Webhook, Settings as SettingsIcon, Info, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@/lib/data/query';
import { loadWebhookHealth, loadAdminCompanies, loadPlans } from '@/lib/data/admin';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { dateTime, date, integer, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { OperatorContext } from './shell';

/**
 * Billing: what customers are paying and whether the machinery agrees.
 *
 * The figures come from subscription state that Stripe wrote and the webhook
 * verified, never from a browser redirect — which is the rule the whole billing
 * design rests on. An event that arrived and never finished is therefore the
 * most important thing on this screen: it means somebody's money moved and
 * their access did not.
 */
export function AdminBilling() {
  const webhooksQ = useQuery(loadWebhookHealth, []);
  const companiesQ = useQuery(loadAdminCompanies, []);

  const webhooks = webhooksQ.status === 'ready' ? webhooksQ.data : [];
  const companies = companiesQ.status === 'ready' ? companiesQ.data : [];

  const failure = [webhooksQ, companiesQ].find((q) => q.status === 'error');
  if (failure) return <ErrorState message={failure.message} onRetry={failure.refetch} />;

  const stuck = webhooks.filter((w) => w.unprocessed);
  const byStatus = companies.reduce<Record<string, number>>((a, c) => {
    const k = c.subscriptionStatus ?? (c.entitlementSource === 'trial' ? 'trial' : 'none');
    a[k] = (a[k] ?? 0) + 1;
    return a;
  }, {});
  const canceling = companies.filter((c) => c.cancelAtPeriodEnd);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Billing</h1>
        <p className="mt-1 text-sm text-charcoal-500">
          Subscription standing, and whether the machinery behind it is keeping up.
        </p>
      </div>

      {webhooksQ.status === 'loading' ? <LoadingState label="Reading billing state" /> : null}

      {stuck.length ? (
        <Alert tone="danger" title={`${integer(stuck.length)} event(s) never finished`}>
          Access comes from verified webhook state and never from a browser redirect, so an
          event that did not process is a customer whose access did not change — after their
          money did.
        </Alert>
      ) : null}

      {canceling.length ? (
        <Alert tone="warn" title={`${integer(canceling.length)} subscription(s) set to cancel`}>
          {canceling.map((c) => c.name).slice(0, 5).join(', ')}
          {canceling.length > 5 ? ` and ${canceling.length - 5} more` : ''}. Still paying
          until the period ends, and worth a call before it does.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Object.entries(byStatus).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => (
          <div key={k} className="rounded-[--radius-card] border border-charcoal-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">
              {titleCase(k)}
            </p>
            <p className="tabular mt-1 text-2xl font-bold text-charcoal-900">{integer(n)}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Subscriptions</CardTitle>
          <CardDescription>
            What Stripe says, as the webhook recorded it. Where this and the Stripe dashboard
            disagree, an event is stuck.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Period ends</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.companyId} className={cn(c.cancelAtPeriodEnd && 'bg-warn-50/40')}>
                  <TableCell className="font-medium text-charcoal-900">{c.name}</TableCell>
                  <TableCell><Badge variant="default">{c.planId ?? 'none'}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={
                      c.subscriptionStatus === 'active' || c.subscriptionStatus === 'trialing'
                        ? 'success' : c.subscriptionStatus ? 'danger' : 'warn'}>
                      {c.subscriptionStatus ?? c.entitlementSource ?? 'none'}
                    </Badge>
                    {c.cancelAtPeriodEnd ? (
                      <p className="mt-1 text-[11px] text-warn-700">cancels at period end</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                    {c.currentPeriodEnd ? date(c.currentPeriodEnd)
                      : c.entitlementValidUntil ? date(c.entitlementValidUntil) : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-charcoal-600">
                    {c.entitlementSource ? titleCase(c.entitlementSource) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!companies.length && companiesQ.status === 'ready' ? (
            <EmptyState title="No companies yet" />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stripe events</CardTitle>
          <CardDescription>
            The event id is the idempotency barrier: the same event delivered twice is
            claimed once, so a retry cannot double-charge access.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {webhooks.slice(0, 60).map((w) => (
                <TableRow key={w.eventId} className={cn(w.unprocessed && 'bg-danger-50/40')}>
                  <TableCell className="font-mono text-xs">{w.eventId}</TableCell>
                  <TableCell className="text-xs">
                    {w.type}
                    {!w.livemode ? <Badge variant="default" className="ml-2">test</Badge> : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                    {dateTime(w.receivedAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={w.unprocessed ? 'danger' : 'success'}>
                      {w.unprocessed ? 'unprocessed' : (w.processingState ?? 'processed')}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">{w.attempts}</TableCell>
                  <TableCell className="max-w-64 truncate text-xs text-danger-700">
                    {w.processingError ?? ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!webhooks.length && webhooksQ.status === 'ready' ? (
            <EmptyState title="No Stripe events yet"
              hint="They appear here the moment the webhook receives one." />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * What the public site shows.
 *
 * The pricing page reads `plans` and `plan_prices` — the only two tables an
 * anonymous visitor may read at all — so whether a plan appears there is a
 * property of the plan rather than of a separate content system.
 *
 * That was not true when this screen first claimed it. The page rendered a
 * hardcoded list of five tiers and overlaid live prices onto it, so retiring
 * four of them in the database changed nothing a visitor saw. The claim was
 * written here before the behavior existed; the behavior exists now.
 */
export function AdminFrontEnd() {
  const plansQ = useQuery(loadPlans, []);
  const plans = plansQ.status === 'ready' ? plansQ.data : [];
  if (plansQ.status === 'error') {
    return <ErrorState message={plansQ.message} onRetry={plansQ.refetch} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Front end</h1>
        <p className="mt-1 text-sm text-charcoal-500">
          What an anonymous visitor sees before they sign up.
        </p>
      </div>

      <Alert tone="neutral" icon={<Info className="size-4" />}
        title="There is no second copy of the pricing">
        The public pricing page reads the plan catalog directly. `plans` and `plan_prices` are
        the only two tables an anonymous visitor may read at all, and everything else on this
        platform is closed to them — so what is on sale and what is advertised cannot drift
        apart, because they are the same rows.
      </Alert>

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>On the pricing page</CardTitle>
            <CardDescription>
              A plan hidden here is still sellable by hand — it simply does not advertise.
            </CardDescription>
          </div>
          <a href="/pricing" target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-charcoal-600 hover:text-charcoal-900">
            View it <ExternalLink className="size-3.5" />
          </a>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Tagline</TableHead>
                <TableHead>Shown publicly</TableHead>
                <TableHead>Still sold</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-charcoal-900">{p.name}</TableCell>
                  <TableCell className="max-w-80 text-xs text-charcoal-600">
                    {p.tagline ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.isPublic ? 'success' : 'default'}>
                      {p.isPublic ? 'Yes' : 'Hidden'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.isActive ? 'success' : 'danger'}>
                      {p.isActive ? 'Yes' : 'Retired'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Public surface</CardTitle>
          <CardDescription>Everything an unauthenticated visitor can reach.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {[
            ['/', 'Landing page'],
            ['/pricing', 'Pricing, read live from the plan catalog'],
            ['/signup', 'Create an account'],
            ['/login', 'Sign in'],
            ['/reset-password', 'Password reset'],
          ].map(([path, what]) => (
            <div key={path} className="flex items-baseline justify-between gap-4 border-b border-charcoal-100 pb-2 last:border-0">
              <a href={path} target="_blank" rel="noreferrer"
                className="font-mono text-xs text-charcoal-700 hover:underline">{path}</a>
              <span className="text-xs text-charcoal-500">{what}</span>
            </div>
          ))}
          <p className="pt-2 text-xs text-charcoal-500">
            A public lead form has its own address per form, issued from a company&apos;s CRM
            rather than listed here — a form is switched off by retiring its key, and there is
            no single public endpoint to find.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Settings, and an honest account of which of them exist.
 *
 * Most platform configuration in GrounUp is deliberately not a setting: the
 * plan catalog is versioned, operator access is granted in the database, and
 * feature overrides are audited decisions. What is left is genuinely small, and
 * saying so is better than a screen of switches that do nothing.
 */
export function AdminSettings() {
  const { can } = useOutletContext<OperatorContext>();
  const isSuper = can('pricing.manage');

  const rows: { name: string; where: string; why: string }[] = [
    { name: 'Plan terms and limits', where: 'Versioned in the database',
      why: 'A plan is what a customer agreed to. Editing one in place would change terms after the fact, so a change publishes a new version and existing subscriptions keep the one they bought under.' },
    { name: 'Operator access', where: 'Granted in the database',
      why: 'The most powerful grant in the system. One place to give it, one place to take it back, and no screen that can be tricked into either.' },
    { name: 'Feature overrides', where: 'Superadmin controls',
      why: 'An audited decision with a reason attached, not a switch.' },
    { name: 'Stripe keys and webhook secret', where: 'Edge Function secrets',
      why: 'Never in anything the browser downloads. The build refuses to ship if one appears in the bundle, by name or by shape.' },
    { name: 'Company settings', where: "Inside each tenant's own application",
      why: 'A customer configures their own workspace. An operator changing it for them would be invisible to the people it affects.' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Settings</h1>
        <p className="mt-1 text-sm text-charcoal-500">
          Where each kind of platform configuration actually lives.
        </p>
      </div>

      <Alert tone="neutral" icon={<SettingsIcon className="size-4" />}
        title="Most of this is deliberately not a setting">
        A screen of switches is easy to build and hard to answer questions about later.
        Where a change has commercial or security consequences, GrounUp makes it a versioned
        or audited act instead — so six months on, somebody can ask why and get an answer.
      </Alert>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Configuration</TableHead>
                <TableHead>Where it lives</TableHead>
                <TableHead>Why there</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="font-medium text-charcoal-900">{r.name}</TableCell>
                  <TableCell className="whitespace-nowrap text-charcoal-600">{r.where}</TableCell>
                  <TableCell className="max-w-lg text-xs text-charcoal-500">{r.why}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {isSuper ? (
        <Card>
          <CardHeader>
            <CardTitle>Adding an operator</CardTitle>
            <CardDescription>
              Run this once against the database, with the person&apos;s own sign-in email.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded bg-charcoal-900 p-4 text-xs text-charcoal-100">
{`insert into platform_admins (user_id, reason, role)
select id, 'Why this person', 'sales'
from auth.users where email = 'them@example.com';`}
            </pre>
            <p className="mt-2 text-xs text-charcoal-500">
              Use <code className="font-mono">&apos;sales&apos;</code> for somebody who sells and
              proposes. There can only be one <code className="font-mono">&apos;superadmin&apos;</code>,
              and the database refuses a second.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <p className="flex items-center gap-2 text-xs text-charcoal-500">
        <Webhook className="size-3.5" />
        Webhook health and subscription state are on the Billing screen.
      </p>
    </div>
  );
}
