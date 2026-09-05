import { useOutletContext } from 'react-router-dom';
import { Eye, Users, Filter, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@/lib/data/query';
import {
  loadTraffic, loadTrafficSources, loadFunnel, loadFailedSignups,
} from '@/lib/data/admin';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { integer, date, dateTime } from '@/lib/format';
import type { OperatorContext } from './shell';

/**
 * Who came, and who tried.
 *
 * The funnel is counted end to end from what actually happened — a visitor, a
 * form, a submitted attempt, an account, a company, a subscription — so no two
 * stages can disagree and none can exceed the one above it by accident.
 *
 * What this cannot tell you is who an anonymous visitor is, and that is
 * deliberate. No address is stored, no cookie is set, and the identifier that
 * groups one browser's page views is a random value that browser keeps for
 * itself.
 */
export function AdminTraffic() {
  const { can } = useOutletContext<OperatorContext>();
  const trafficQ = useQuery(loadTraffic, []);
  const sourcesQ = useQuery(loadTrafficSources, []);
  const funnelQ = useQuery(loadFunnel, []);
  const failedQ = useQuery(loadFailedSignups, []);

  const traffic = trafficQ.status === 'ready' ? trafficQ.data : [];
  const sources = sourcesQ.status === 'ready' ? sourcesQ.data : [];
  const funnel = funnelQ.status === 'ready' ? funnelQ.data : [];
  const failed = failedQ.status === 'ready' ? failedQ.data : [];

  const failure = [trafficQ, sourcesQ, funnelQ, failedQ].find((q) => q.status === 'error');
  if (failure) return <ErrorState message={failure.message} onRetry={failure.refetch} />;

  // Thirty days, added up. A rate over one day is noise.
  const period = funnel.reduce((a, d) => ({
    visitors: a.visitors + d.visitors,
    reachedTheForm: a.reachedTheForm + d.reachedTheForm,
    attempted: a.attempted + d.attempted,
    failed: a.failed + d.failed,
    accountsCreated: a.accountsCreated + d.accountsCreated,
    companiesCreated: a.companiesCreated + d.companiesCreated,
    subscribed: a.subscribed + d.subscribed,
  }), { visitors: 0, reachedTheForm: 0, attempted: 0, failed: 0,
        accountsCreated: 0, companiesCreated: 0, subscribed: 0 });

  const stillStuck = failed.filter((f) => !f.hasAnAccountNow);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">
          Who came, and who tried
        </h1>
        <p className="mt-1 text-sm text-charcoal-500">
          Thirty days from a visitor to a paying customer.
        </p>
      </div>

      {trafficQ.status === 'loading' ? <LoadingState label="Reading traffic" /> : null}

      {stillStuck.length ? (
        <Alert tone="warn" icon={<AlertTriangle className="size-4" />}
          title={`${integer(stillStuck.length)} people tried to sign up and never did`}>
          Each one typed their email into the form and got an error. The reasons are below;
          most of them are fixable.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="size-4" /> The last thirty days
          </CardTitle>
          <CardDescription>
            Each stage counted from what happened, not from a running total.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Stage label="Visited the site" value={period.visitors} of={period.visitors} />
            <Stage label="Reached the signup form" value={period.reachedTheForm}
              of={period.visitors} />
            <Stage label="Submitted it" value={period.attempted} of={period.visitors} />
            <Stage label="Got an account" value={period.accountsCreated} of={period.visitors} />
            <Stage label="Got a company" value={period.companiesCreated} of={period.visitors} />
            <Stage label="Subscribed" value={period.subscribed} of={period.visitors} tone="success" />
          </div>
          {period.failed > 0 ? (
            <p className="mt-4 text-sm text-danger-700">
              {integer(period.failed)} of the {integer(period.attempted)} who submitted the
              form got an error instead of an account.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4" /> Where they came from
            </CardTitle>
            <CardDescription>
              A campaign tag if the link carried one, otherwise the referring site.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Visitors</TableHead>
                  <TableHead className="text-right">Reached pricing</TableHead>
                  <TableHead className="text-right">Reached signup</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.slice(0, 15).map((s) => (
                  <TableRow key={`${s.source}:${s.campaign ?? ''}`}>
                    <TableCell className="text-charcoal-800">
                      {s.source}
                      {s.campaign ? (
                        <Badge variant="default" className="ml-1.5">{s.campaign}</Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-900">
                      {integer(s.visitors)}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {s.reachedPricing || '—'}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {s.reachedSignup || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!sources.length && sourcesQ.status === 'ready' ? (
              <EmptyState title="Nobody has visited yet"
                hint="Traffic appears here from the moment this is deployed. There is no history before that." />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="size-4" /> By day
            </CardTitle>
            <CardDescription>Views, and the browsers behind them.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Visitors</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead className="text-right">Pricing</TableHead>
                  <TableHead className="text-right">On a phone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {traffic.slice(0, 14).map((t) => (
                  <TableRow key={t.day}>
                    <TableCell className="whitespace-nowrap text-charcoal-700">
                      {date(t.day)}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-900">
                      {integer(t.visitors)}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {integer(t.views)}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {t.pricingViews || '—'}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {t.phoneViews || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!traffic.length && trafficQ.status === 'ready' ? (
              <EmptyState title="No traffic recorded yet" />
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>People who tried and did not get in</CardTitle>
          <CardDescription>
            The reason each of them saw. A repeated &quot;already registered&quot; is
            somebody who forgot they had an account, which is a mail worth sending rather
            than a lost customer.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>What they saw</TableHead>
                <TableHead>Came from</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Since then</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failed.slice(0, 30).map((f) => (
                <TableRow key={`${f.email}:${f.occurredAt}`}>
                  <TableCell className="text-charcoal-800">{f.email}</TableCell>
                  <TableCell className="max-w-72 text-xs text-charcoal-600">
                    {f.failure ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs text-charcoal-500">
                    {f.utmSource ?? '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                    {dateTime(f.occurredAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={f.hasAnAccountNow ? 'success' : 'warn'}>
                      {f.hasAnAccountNow ? 'Signed up later' : 'Still has no account'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!failed.length && failedQ.status === 'ready' ? (
            <EmptyState title="Nobody has failed to sign up"
              hint="Which is either good news or a sign nobody has tried." />
          ) : null}
        </CardContent>
      </Card>

      <Alert tone="neutral" icon={<ShieldCheck className="size-4" />}
        title="What this deliberately cannot tell you">
        Who an anonymous visitor is. No address is stored, no cookie is set, and the
        identifier that groups one browser&apos;s page views is a random value that browser
        keeps for itself — clearing site data makes somebody a new visitor. An email appears
        here only when somebody typed it into the signup form and submitted it.
        {!can('companies.read') ? ' You are seeing none of it, because you hold no permission to.' : ''}
      </Alert>
    </div>
  );
}

function Stage({ label, value, of, tone = 'neutral' }: {
  label: string; value: number; of: number; tone?: 'neutral' | 'success';
}) {
  const pct = of > 0 ? Math.round((value / of) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-charcoal-700">{label}</span>
        <span className="tabular font-medium text-charcoal-900">
          {integer(value)}
          <span className="ml-1.5 text-xs font-normal text-charcoal-500">{pct}%</span>
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded bg-charcoal-100">
        <div className={tone === 'success' ? 'h-full bg-success-600' : 'h-full bg-charcoal-700'}
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
