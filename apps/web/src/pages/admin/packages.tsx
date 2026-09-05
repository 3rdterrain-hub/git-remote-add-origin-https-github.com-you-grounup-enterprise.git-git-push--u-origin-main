import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Package, Eye, EyeOff, Check, Loader2, Save, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useQuery } from '@/lib/data/query';
import {
  loadPlans, loadAdminCompanies, loadPlanPrices, setPlanPrice,
} from '@/lib/data/admin';
import { LoadingState, ErrorState } from '@/components/data-state';
import {
  loadFeatureCatalog, setPlanLimits, setPlanFeatures, setPlanTrial, createPlan,
  setPlanVisibility,
} from '@/lib/data/admin';
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
  const { can } = useOutletContext<OperatorContext>();
  const isSuper = can('pricing.manage');
  const plansQ = useQuery(loadPlans, []);
  const companiesQ = useQuery(loadAdminCompanies, []);
  const pricesQ = useQuery(loadPlanPrices, []);

  const featuresQ = useQuery(loadFeatureCatalog, []);
  const catalog = featuresQ.status === 'ready' ? featuresQ.data : [];

  const [editingPlan, setEditingPlan] = useState<string | null>(null);
  const [planDraft, setPlanDraft] = useState<{
    maxSeats: string; maxEstimates: string; maxProjects: string; storageGb: string;
    aiCredits: string; trialDays: string; features: string[]; reason: string;
  }>({ maxSeats: '', maxEstimates: '', maxProjects: '', storageGb: '',
       aiCredits: '', trialDays: '', features: [], reason: '' });
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  /** Empty means unlimited, which is a real setting rather than a missing one. */
  const orNull = (v: string) => (v.trim() === '' ? null : Number(v));

  async function savePlan(planId: string) {
    if (!supabase) return;
    setPlanBusy(true); setPlanError(null);
    try {
      await setPlanLimits(supabase, {
        planId,
        maxSeats: orNull(planDraft.maxSeats),
        maxEstimates: orNull(planDraft.maxEstimates),
        maxProjects: orNull(planDraft.maxProjects),
        storageGb: orNull(planDraft.storageGb),
        aiCredits: orNull(planDraft.aiCredits),
        reason: planDraft.reason,
      });
      await setPlanFeatures(supabase, planId, planDraft.features, planDraft.reason);
      await setPlanTrial(supabase, planId, Number(planDraft.trialDays || 0), planDraft.reason);
      setEditingPlan(null);
      plansQ.refetch();
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'That could not be saved.');
    } finally { setPlanBusy(false); }
  }

  /*
   * A plan for one customer. The catalog was fixed at seed time, so making one
   * meant a migration — for the thing somebody negotiates on a call.
   */
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    id: '', name: '', tagline: '', description: '',
    maxSeats: '', maxEstimates: '', maxProjects: '', storageGb: '', aiCredits: '',
    trialDays: '0', features: [] as string[], isPublic: false,
  });

  async function makePlan() {
    if (!supabase) return;
    setPlanBusy(true); setPlanError(null);
    try {
      await createPlan(supabase, {
        id: draft.id, name: draft.name, tagline: draft.tagline,
        description: draft.description,
        maxSeats: orNull(draft.maxSeats), maxEstimates: orNull(draft.maxEstimates),
        maxProjects: orNull(draft.maxProjects), storageGb: orNull(draft.storageGb),
        aiCredits: orNull(draft.aiCredits), features: draft.features,
        trialDays: Number(draft.trialDays || 0), isPublic: draft.isPublic,
      });
      setDraft({ id: '', name: '', tagline: '', description: '', maxSeats: '',
                 maxEstimates: '', maxProjects: '', storageGb: '', aiCredits: '',
                 trialDays: '0', features: [], isPublic: false });
      setCreating(false);
      plansQ.refetch();
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'That plan could not be created.');
    } finally { setPlanBusy(false); }
  }

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
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((p) => (
                <TableRow key={p.id} className={editingPlan === p.id ? 'bg-charcoal-50' : undefined}>
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
                  <TableCell>
                    <Button size="sm" variant="ghost" disabled={!isSuper}
                      onClick={() => {
                        setEditingPlan(editingPlan === p.id ? null : p.id);
                        setPlanDraft({
                          maxSeats: p.maxSeats == null ? '' : String(p.maxSeats),
                          maxEstimates: p.maxActiveEstimates == null ? '' : String(p.maxActiveEstimates),
                          maxProjects: p.maxActiveProjects == null ? '' : String(p.maxActiveProjects),
                          storageGb: p.storageGb == null ? '' : String(p.storageGb),
                          aiCredits: p.aiCreditsPerMonth == null ? '' : String(p.aiCreditsPerMonth),
                          trialDays: String(p.trialDays ?? 0),
                          features: p.features ?? [],
                          reason: '',
                        });
                      }}>
                      {editingPlan === p.id ? 'Close' : 'Change'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {editingPlan ? (
            <div className="space-y-4 border-t border-charcoal-200 p-4">
              <div>
                <p className="font-medium text-charcoal-900">
                  What {plans.find((p) => p.id === editingPlan)?.name ?? editingPlan} allows
                </p>
                <p className="text-xs text-charcoal-500">
                  Leave a box empty for unlimited. Companies already on this plan feel the
                  change immediately — except where a paid subscription pinned their own
                  numbers, which keeps what they bought.
                </p>
              </div>

              {planError ? <Alert tone="danger">{planError}</Alert> : null}

              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {([
                  ['maxSeats', 'Seats'], ['maxEstimates', 'Active estimates'],
                  ['maxProjects', 'Active projects'], ['storageGb', 'Storage GB'],
                  ['aiCredits', 'AI credits'], ['trialDays', 'Trial days'],
                ] as const).map(([key, label]) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`plan-${key}`}>{label}</Label>
                    <Input id={`plan-${key}`} type="number" min="0"
                      placeholder={key === 'trialDays' ? '0' : 'unlimited'}
                      value={planDraft[key]}
                      onChange={(e) => setPlanDraft({ ...planDraft, [key]: e.target.value })} />
                  </div>
                ))}
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-charcoal-800">
                  What it includes
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {catalog.map((f) => (
                    <label key={f.key}
                      className="flex cursor-pointer items-start gap-2 rounded border
                                 border-charcoal-200 p-2 text-sm hover:bg-white">
                      <input type="checkbox" className="mt-0.5 size-4 accent-charcoal-900"
                        checked={planDraft.features.includes('*')
                          || planDraft.features.includes(f.key)}
                        disabled={planDraft.features.includes('*')}
                        onChange={(e) => setPlanDraft({
                          ...planDraft,
                          features: e.target.checked
                            ? [...planDraft.features, f.key]
                            : planDraft.features.filter((k) => k !== f.key),
                        })} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-medium
                                         text-charcoal-900">
                          {f.label}
                          {!f.enforced ? (
                            <Badge variant="default" title="Nothing refuses the work without it">
                              not gated
                            </Badge>
                          ) : null}
                        </span>
                        <span className="block text-xs text-charcoal-500">{f.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {planDraft.features.includes('*') ? (
                  <p className="mt-2 text-xs text-charcoal-500">
                    This plan includes everything, now and whatever is built later. Untick it
                    by removing the wildcard, which is deliberately not a checkbox.
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-charcoal-500">
                    A feature marked <strong>not gated</strong> is one the database does not
                    yet refuse. Turning it off makes the pricing page honest and stops
                    nothing — which is worth knowing before you price around it.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="plan-why">Why this is changing</Label>
                <Input id="plan-why" value={planDraft.reason}
                  placeholder="Two seats was too tight to evaluate it properly"
                  onChange={(e) => setPlanDraft({ ...planDraft, reason: e.target.value })} />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button disabled={!isSuper || planBusy || planDraft.reason.trim().length < 5}
                  onClick={() => savePlan(editingPlan)}>
                  {planBusy ? <Loader2 className="size-4 animate-spin" /> : null}
                  Save the plan
                </Button>
                {(() => {
                  const p = plans.find((x) => x.id === editingPlan);
                  if (!p) return null;
                  return (
                    <>
                      <Button variant="outline"
                        disabled={!isSuper || planBusy || planDraft.reason.trim().length < 5}
                        onClick={async () => {
                          if (!supabase) return;
                          setPlanBusy(true);
                          try {
                            await setPlanVisibility(supabase, p.id, !p.isPublic, p.isActive,
                              planDraft.reason);
                            plansQ.refetch();
                          } catch (err) {
                            setPlanError(err instanceof Error ? err.message
                              : 'That could not be changed.');
                          } finally { setPlanBusy(false); }
                        }}>
                        {p.isPublic ? 'Take off the pricing page' : 'Put on the pricing page'}
                      </Button>
                      <Button variant="ghost"
                        disabled={!isSuper || planBusy || planDraft.reason.trim().length < 5}
                        onClick={async () => {
                          if (!supabase) return;
                          setPlanBusy(true);
                          try {
                            await setPlanVisibility(supabase, p.id, p.isPublic, !p.isActive,
                              planDraft.reason);
                            plansQ.refetch();
                          } catch (err) {
                            setPlanError(err instanceof Error ? err.message
                              : 'That could not be changed.');
                          } finally { setPlanBusy(false); }
                        }}>
                        {p.isActive ? 'Retire it' : 'Sell it again'}
                      </Button>
                    </>
                  );
                })()}
                <Button variant="ghost" onClick={() => setEditingPlan(null)}>Cancel</Button>
              </div>
              <p className="text-xs text-charcoal-500">
                Retiring a plan stops anybody else buying it and moves nobody: an
                entitlement holds its own terms, so the customers on it keep what they
                agreed to.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>A plan for one customer</CardTitle>
          <CardDescription>
            For somebody on terms nobody else is on. Private unless you say otherwise —
            a negotiated plan appearing on the public pricing page is the one mistake here
            that everybody sees at once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!creating ? (
            <Button variant="outline" disabled={!isSuper} onClick={() => setCreating(true)}>
              <Plus className="size-4" /> Make a plan
            </Button>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="new-id">Id</Label>
                  <Input id="new-id" value={draft.id} placeholder="third_terrain"
                    onChange={(e) => setDraft({ ...draft, id: e.target.value })} />
                  <p className="text-xs text-charcoal-500">
                    Lower case, digits and underscores. It never changes.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-name">Name</Label>
                  <Input id="new-name" value={draft.name} placeholder="3RD Terrain"
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-tagline">Tagline</Label>
                <Input id="new-tagline" value={draft.tagline}
                  placeholder="Everything, on our own terms"
                  onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {([
                  ['maxSeats', 'Seats'], ['maxEstimates', 'Active estimates'],
                  ['maxProjects', 'Active projects'], ['storageGb', 'Storage GB'],
                  ['aiCredits', 'AI credits'], ['trialDays', 'Trial days'],
                ] as const).map(([key, label]) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`new-${key}`}>{label}</Label>
                    <Input id={`new-${key}`} type="number" min="0"
                      placeholder={key === 'trialDays' ? '0' : 'unlimited'}
                      value={draft[key]}
                      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
                  </div>
                ))}
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-charcoal-800">What it includes</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {catalog.map((f) => (
                    <label key={f.key}
                      className="flex cursor-pointer items-center gap-2 rounded border
                                 border-charcoal-200 p-2 text-sm hover:bg-charcoal-50">
                      <input type="checkbox" className="size-4 accent-charcoal-900"
                        checked={draft.features.includes(f.key)}
                        onChange={(e) => setDraft({
                          ...draft,
                          features: e.target.checked
                            ? [...draft.features, f.key]
                            : draft.features.filter((k) => k !== f.key),
                        })} />
                      {f.label}
                    </label>
                  ))}
                </div>
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-charcoal-900"
                    checked={draft.features.includes('*')}
                    onChange={(e) => setDraft({
                      ...draft,
                      features: e.target.checked
                        ? ['*'] : draft.features.filter((k) => k !== '*'),
                    })} />
                  Everything, including whatever is built later
                </label>
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-charcoal-900"
                    checked={draft.isPublic}
                    onChange={(e) => setDraft({ ...draft, isPublic: e.target.checked })} />
                  Put it on the public pricing page
                </label>
              </div>
              {planError ? <Alert tone="danger">{planError}</Alert> : null}
              <div className="flex gap-2">
                <Button disabled={!isSuper || planBusy || !draft.id.trim()
                  || draft.name.trim().length < 2} onClick={makePlan}>
                  {planBusy ? <Loader2 className="size-4 animate-spin" /> : null}
                  Create the plan
                </Button>
                <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              </div>
            </>
          )}
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
