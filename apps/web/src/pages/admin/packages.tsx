import { Package, Eye, EyeOff, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@/lib/data/query';
import { loadPlans, loadAdminCompanies } from '@/lib/data/admin';
import { LoadingState, ErrorState } from '@/components/data-state';
import { integer } from '@/lib/format';

/**
 * What is for sale.
 *
 * Read-only, and that is a decision rather than an unfinished screen. A plan is
 * published commercial terms: migration 0030 versions them, and every tenant
 * that bought under a version points at the same row. Editing one in place
 * would silently change what a customer already agreed to, so a change to a
 * plan publishes a new version — which is a governed act, not a form field.
 *
 * What this screen is for is seeing the ladder as customers see it, and where
 * everybody sits on it.
 */
export function AdminPackages() {
  const plansQ = useQuery(loadPlans, []);
  const companiesQ = useQuery(loadAdminCompanies, []);

  const plans = plansQ.status === 'ready' ? plansQ.data : [];
  const companies = companiesQ.status === 'ready' ? companiesQ.data : [];

  const failure = [plansQ, companiesQ].find((q) => q.status === 'error');
  if (failure) return <ErrorState message={failure.message} onRetry={failure.refetch} />;

  const onPlan = (id: string) => companies.filter((c) => c.planId === id).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Packages</h1>
        <p className="mt-1 text-sm text-charcoal-500">
          The ladder customers buy on, and how many are on each rung.
        </p>
      </div>

      {plansQ.status === 'loading' ? <LoadingState label="Reading the plan catalog" /> : null}

      <Alert tone="neutral" icon={<Package className="size-4" />}
        title="A plan is versioned, not edited">
        Published commercial terms are what a customer agreed to. Changing a plan publishes a
        new version and leaves every existing subscription pointing at the one it bought
        under — so terms cannot move underneath somebody after the fact. That is why there
        is nothing to edit here.
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Plans</CardTitle>
          <CardDescription>
            A plan that is not public is still sellable by hand — it simply does not appear
            on the pricing page.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Seats</TableHead>
                <TableHead className="text-right">Estimates</TableHead>
                <TableHead className="text-right">Projects</TableHead>
                <TableHead className="text-right">AI credits</TableHead>
                <TableHead className="text-right">Trial</TableHead>
                <TableHead>Visibility</TableHead>
                <TableHead className="text-right">Customers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <p className="font-medium text-charcoal-900">{p.name}</p>
                    <p className="font-mono text-xs text-charcoal-500">{p.id}</p>
                    {p.tagline ? (
                      <p className="mt-0.5 max-w-64 text-xs text-charcoal-500">{p.tagline}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {p.maxSeats ?? 'unlimited'}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {p.maxActiveEstimates ?? 'unlimited'}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {p.maxActiveProjects ?? 'unlimited'}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {p.aiCreditsPerMonth ?? 'unlimited'}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {p.trialDays ? `${p.trialDays} days` : 'none'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {p.isPublic
                        ? <Eye className="size-3.5 text-success-600" />
                        : <EyeOff className="size-3.5 text-charcoal-400" />}
                      <span className="text-xs text-charcoal-600">
                        {p.isPublic ? 'On the pricing page' : 'Sold by hand'}
                      </span>
                      {!p.isActive ? <Badge variant="danger">Retired</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="tabular text-right font-medium">
                    {integer(onPlan(p.id))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What each plan unlocks</CardTitle>
          <CardDescription>
            These are the feature keys the platform actually checks. A feature turned on for
            one customer by override composes on top of whatever their plan grants.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {plans.map((p) => (
            <div key={p.id} className="border-b border-charcoal-100 pb-3 last:border-0 last:pb-0">
              <p className="text-sm font-medium text-charcoal-900">{p.name}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {p.features.length ? p.features.map((f) => (
                  <span key={f}
                    className="inline-flex items-center gap-1 rounded bg-charcoal-100 px-2 py-0.5 font-mono text-[11px] text-charcoal-700">
                    <Check className="size-3 text-success-600" />{f}
                  </span>
                )) : <span className="text-xs text-charcoal-500">No features listed</span>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
