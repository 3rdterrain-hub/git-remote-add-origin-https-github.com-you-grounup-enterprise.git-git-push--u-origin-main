import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Package, Eye, EyeOff, Check, Loader2, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useQuery } from '@/lib/data/query';
import {
  loadPlans, loadAdminCompanies, loadPlanPrices, setPlanPrice,
} from '@/lib/data/admin';
import { LoadingState, ErrorState } from '@/components/data-state';
import { supabase } from '@/lib/supabase';
import { integer, money } from '@/lib/format';
import type { OperatorContext } from './shell';

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
  const { isSuper } = useOutletContext<OperatorContext>();
  const plansQ = useQuery(loadPlans, []);
  const companiesQ = useQuery(loadAdminCompanies, []);
  const pricesQ = useQuery(loadPlanPrices, []);

  const [editing, setEditing] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [stripeId, setStripeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plans = plansQ.status === 'ready' ? plansQ.data : [];
  const companies = companiesQ.status === 'ready' ? companiesQ.data : [];
  const prices = pricesQ.status === 'ready' ? pricesQ.data : [];

  const failure = [plansQ, companiesQ, pricesQ].find((q) => q.status === 'error');
  if (failure) return <ErrorState message={failure.message} onRetry={failure.refetch} />;

  const priceFor = (planId: string, interval: 'month' | 'year') =>
    prices.find((p) => p.planId === planId && p.interval === interval && p.isActive);

  const key = (planId: string, interval: string) => `${planId}:${interval}`;

  function startEdit(planId: string, interval: 'month' | 'year') {
    const existing = priceFor(planId, interval);
    setAmount(existing ? String(existing.unitAmountCents / 100) : '');
    setStripeId(existing?.stripePriceId ?? '');
    setError(null);
    setEditing(key(planId, interval));
  }

  async function save(planId: string, interval: 'month' | 'year') {
    if (!supabase) return;
    const dollars = Number(amount);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setError('A price must be zero or more.');
      return;
    }
    setBusy(true); setError(null);
    try {
      await setPlanPrice(supabase, {
        planId, interval,
        unitAmountCents: Math.round(dollars * 100),
        stripePriceId: stripeId.trim(),
      });
      setEditing(null);
      pricesQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That price could not be published.');
    } finally { setBusy(false); }
  }

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

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Price</CardTitle>
          <CardDescription>
            What a seat costs, per month and per year. A price needs the Stripe price it
            corresponds to: GrounUp does not create prices in Stripe, and quoting a number
            checkout cannot charge would be worse than quoting none.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Billed</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Stripe price</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.filter((p) => p.isActive).flatMap((p) =>
                (['month', 'year'] as const).map((interval) => {
                  const existing = priceFor(p.id, interval);
                  const isEditing = editing === key(p.id, interval);
                  return (
                    <TableRow key={key(p.id, interval)}>
                      <TableCell className="font-medium text-charcoal-900">{p.name}</TableCell>
                      <TableCell className="text-charcoal-600">
                        {interval === 'month' ? 'Monthly' : 'Annually'}
                      </TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-charcoal-500">$</span>
                            <Input value={amount} inputMode="decimal" autoFocus
                              className="h-8 w-24 text-right"
                              aria-label={`${p.name} ${interval} price`}
                              onChange={(e) => setAmount(e.target.value)} />
                          </div>
                        ) : existing ? (
                          <span className="tabular font-medium text-charcoal-900">
                            {money(existing.unitAmountCents / 100)}
                            <span className="text-charcoal-400">
                              {interval === 'month' ? ' / user / mo' : ' / user / yr'}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-warn-700">not published</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input value={stripeId} className="h-8 font-mono text-xs"
                            placeholder="price_1AbC..."
                            aria-label={`${p.name} ${interval} Stripe price id`}
                            onChange={(e) => setStripeId(e.target.value)} />
                        ) : (
                          <span className="font-mono text-xs text-charcoal-500">
                            {existing?.stripePriceId ?? '—'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <div className="flex gap-1">
                            <Button size="sm" disabled={busy || !stripeId.trim()}
                              onClick={() => save(p.id, interval)}>
                              {busy ? <Loader2 className="size-4 animate-spin" />
                                : <Save className="size-4" />} Publish
                            </Button>
                            <Button size="sm" variant="ghost"
                              onClick={() => setEditing(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" disabled={!isSuper}
                            onClick={() => startEdit(p.id, interval)}>
                            {existing ? 'Change' : 'Set price'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                }))}
            </TableBody>
          </Table>
          <p className="border-t border-charcoal-200 p-4 text-xs text-charcoal-500">
            Create the price in Stripe first (Products &rarr; your product &rarr; Add price,
            recurring, per unit), then paste its id here. Changing a price affects new
            subscriptions; existing ones keep what they were created at until they renew.
          </p>
        </CardContent>
      </Card>

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
