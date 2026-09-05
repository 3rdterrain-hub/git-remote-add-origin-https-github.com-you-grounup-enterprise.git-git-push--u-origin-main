import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import {
  Building2, ShieldAlert, Webhook, AlertTriangle, Loader2, Check, X, Search,
  RotateCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery } from '@/lib/data/query';
import {
  loadAdminCompanies, loadWebhookHealth, loadOverrides, loadStuckEvents,
  isPlatformAdmin, setFeatureOverride, clearFeatureOverride, replayStripeEvent,
  type AdminCompany,
} from '@/lib/data/admin';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { ExportButton } from '@/components/admin/export-button';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { date, dateTime, integer, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The operator console.
 *
 * Deliberately outside `/app`. Everything under that route assumes a company
 * and reads that company's own records; this reads across all of them, which is
 * a different kind of screen and should not sit in the customer's navigation.
 *
 * There is no permission check here beyond a courtesy message. The privilege is
 * enforced in the database: `admin_companies` and `admin_webhook_health` return
 * nothing to somebody who is not a platform operator, and the override
 * functions refuse them outright. A screen that hid the buttons but left the
 * calls reachable would be the more dangerous arrangement.
 *
 * What is absent is as deliberate as what is here. There is no way to read a
 * customer's estimates, projects, costs or documents — only counts of them.
 * Knowing that Ridgeline exists and is paying is the operator's business.
 * Knowing what Ridgeline bid is not.
 */
export function AdminCompanies() {
  const companiesQ = useQuery(loadAdminCompanies, []);
  const webhooksQ = useQuery(loadWebhookHealth, []);
  const overridesQ = useQuery(loadOverrides, []);
  const stuckQ = useQuery(loadStuckEvents, []);

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<AdminCompany | null>(null);
  const [replaying, setReplaying] = useState<string | null>(null);
  const [replayWhy, setReplayWhy] = useState<Record<string, string>>({});
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayed, setReplayed] = useState<string | null>(null);

  const stuck = stuckQ.status === 'ready' ? stuckQ.data : [];

  /**
   * Apply a stored event again.
   *
   * Nothing is sent but the event id and the reason: the payload comes out of
   * the database inside the function, so this button cannot influence what
   * reaches a customer's subscription.
   */
  async function replay(eventId: string) {
    setReplaying(eventId); setReplayError(null); setReplayed(null);
    try {
      await replayStripeEvent(eventId, replayWhy[eventId] ?? '');
      setReplayed(eventId);
      setReplayWhy({ ...replayWhy, [eventId]: '' });
      stuckQ.refetch(); webhooksQ.refetch(); companiesQ.refetch();
    } catch (err) {
      setReplayError(err instanceof Error ? err.message
        : 'That event could not be applied. The reason is recorded against it.');
      stuckQ.refetch();
    } finally { setReplaying(null); }
  }

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) { setIsAdmin(false); return; }
    let canceled = false;
    void isPlatformAdmin(supabase)
      .then((v) => { if (!canceled) setIsAdmin(v); })
      .catch(() => { if (!canceled) setIsAdmin(false); });
    return () => { canceled = true; };
  }, []);

  const companies = companiesQ.status === 'ready' ? companiesQ.data : [];
  const webhooks = webhooksQ.status === 'ready' ? webhooksQ.data : [];
  const overrides = overridesQ.status === 'ready' ? overridesQ.data : [];

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) =>
      c.name.toLowerCase().includes(q) || c.slug.includes(q)
      || (c.ownerEmail ?? '').toLowerCase().includes(q));
  }, [companies, filter]);


  if (!isSupabaseConfigured) {
    return (
      <>
        <Alert tone="info" icon={<ShieldAlert className="size-4" />}
          title="The operator console needs a configured workspace">
          This build runs against the demonstration dataset, which has one company in it
          and no subscriptions. Connect a Supabase project to see the tenants of a real
          deployment.
        </Alert>
      </>
    );
  }

  if (isAdmin === false) {
    return (
      <>
        <Alert tone="warn" icon={<ShieldAlert className="size-4" />}
          title="This console is for platform operators">
          Your account is not one. Nothing here would load for you in any case — the
          views behind this screen return nothing to a caller who is not an operator,
          and the controls refuse them.
        </Alert>
      </>
    );
  }

  const failure = [companiesQ, webhooksQ, overridesQ].find((q) => q.status === 'error');
  if (failure) return <><ErrorState message={failure.message} onRetry={failure.refetch} /></>;

  return (
    <>
      {stuck.length ? (
        <Alert tone="danger" icon={<AlertTriangle className="size-4" />}
          title={`${integer(stuck.length)} Stripe event(s) arrived and never finished`}>
          A subscription that silently failed to activate is a customer who paid and cannot
          use what they paid for. {stuck.slice(0, 3).map((s) => s.type).join(', ')}
          {stuck.length > 3 ? ` and ${stuck.length - 3} more` : ''}.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Companies" value={integer(companies.length)} icon={<Building2 className="size-4" />} />
        <Tile label="Paying" value={integer(companies.filter((c) =>
          c.subscriptionStatus === 'active' || c.subscriptionStatus === 'trialing').length)} />
        <Tile label="Feature overrides" value={integer(overrides.length)}
          tone={overrides.length ? 'warn' : 'neutral'} />
        <Tile label="Stuck webhooks" value={integer(stuck.length)}
          tone={stuck.length ? 'danger' : 'success'} icon={<Webhook className="size-4" />} />
      </div>

      <Tabs defaultValue="companies">
        <TabsList>
          <TabsTrigger value="companies">Companies ({companies.length})</TabsTrigger>
          <TabsTrigger value="overrides">Overrides ({overrides.length})</TabsTrigger>
          <TabsTrigger value="webhooks">
            Stripe events{stuck.length ? ` (${stuck.length} stuck)` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="companies" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal-400" />
              <Input value={filter} className="pl-9" placeholder="Name, address or owner"
                onChange={(e) => setFilter(e.target.value)} aria-label="Filter companies" />
            </div>
            {/*
              * Exports what is on screen, filter and all. A button that widened
              * the query to "everything" would be a quiet escalation dressed as
              * a convenience, and every export is recorded in the ledger.
              */}
            <ExportButton what="Companies" rows={shown} columns={[
              { header: 'Company', value: (c) => c.name },
              { header: 'Address', value: (c) => c.slug },
              { header: 'Owner', value: (c) => c.ownerEmail },
              { header: 'Plan', value: (c) => c.planId },
              { header: 'Entitlement active', value: (c) => c.entitlementActive },
              { header: 'Entitlement source', value: (c) => c.entitlementSource },
              { header: 'Subscription', value: (c) => c.subscriptionStatus },
              { header: 'Period ends', value: (c) => c.currentPeriodEnd },
              { header: 'People', value: (c) => c.memberCount },
              { header: 'Estimates', value: (c) => c.estimateCount },
              { header: 'Projects', value: (c) => c.projectCount },
              { header: 'Customer since', value: (c) => c.createdAt },
            ]} />
          </div>

          <Card>
            <CardContent className="p-0">
              {companiesQ.status === 'loading' ? <LoadingState label="Reading tenants" /> : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Subscription</TableHead>
                    <TableHead className="text-right">People</TableHead>
                    <TableHead className="text-right">Estimates</TableHead>
                    <TableHead className="text-right">Projects</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((c) => (
                    <TableRow key={c.companyId}>
                      <TableCell>
                        <Link to={`/admin/companies/${c.companyId}`}
                          className="font-medium text-charcoal-900 underline-offset-2
                                     hover:underline">
                          {c.name}
                        </Link>
                        <p className="font-mono text-xs text-charcoal-500">{c.slug}</p>
                      </TableCell>
                      <TableCell className="text-xs text-charcoal-600">{c.ownerEmail ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={c.entitlementActive ? 'success' : 'danger'}>
                          {c.planId ?? 'none'}
                        </Badge>
                        {c.entitlementSource && c.entitlementSource !== 'stripe_webhook' ? (
                          <p className="mt-1 text-[11px] text-charcoal-500">
                            {titleCase(c.entitlementSource)}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <SubscriptionBadge c={c} />
                      </TableCell>
                      <TableCell className="tabular text-right">{integer(c.memberCount)}</TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">{integer(c.estimateCount)}</TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">{integer(c.projectCount)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                        {date(c.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          {/*
                            * Opening the account is a support session, not a way in:
                            * the screen it leads to shows billing only, for a stated
                            * reason, for an hour, and writes itself into this
                            * company's own history.
                            */}
                          <Button asChild size="sm" variant="ghost">
                            <Link to={`/admin/companies/${c.companyId}`}>Manage</Link>
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setSelected(c)}>
                            Features{c.overrideCount ? ` (${c.overrideCount})` : ''}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!shown.length && companiesQ.status === 'ready' ? (
                <EmptyState title={filter ? 'No company matches that' : 'No companies yet'} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="overrides">
          <Card>
            <CardHeader>
              <CardTitle>Feature overrides in force</CardTitle>
              <CardDescription>
                These compose on top of whatever the plan grants, which is why they survive
                a Stripe event rewriting the entitlement. A revoke beats a grant beats the plan.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Feature</TableHead>
                    <TableHead>Effect</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Expires</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overrides.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium text-charcoal-900">
                        {companies.find((c) => c.companyId === o.companyId)?.name ?? o.companyId}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{o.feature}</TableCell>
                      <TableCell>
                        <Badge variant={o.effect === 'grant' ? 'success' : 'danger'}>
                          {o.effect}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-64 text-xs text-charcoal-600">{o.reason}</TableCell>
                      <TableCell className="text-xs text-charcoal-500">
                        {o.validUntil ? date(o.validUntil) : (
                          <span className="text-warn-700">no end date</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!overrides.length && overridesQ.status === 'ready' ? (
                <EmptyState title="No overrides in force"
                  hint="Every company is on exactly what its plan grants." />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="webhooks">
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4" />
                Arrived and never finished ({stuck.length})
              </CardTitle>
              <CardDescription>
                Each of these is a customer who may have paid and got nothing. Applying one
                again re-runs the exact message Stripe sent, from the copy stored when it
                arrived — nothing here supplies a payload, and an event that already
                finished cannot be applied twice.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {replayError ? <Alert tone="danger">{replayError}</Alert> : null}
              {replayed ? (
                <Alert tone="success">
                  {replayed} was applied. The customer&apos;s access now matches what Stripe
                  says they bought.
                </Alert>
              ) : null}

              {stuck.map((e) => (
                <div key={e.eventId} className="rounded border border-danger-200 bg-danger-50/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-charcoal-900">
                        {e.type}
                        {!e.livemode ? (
                          <Badge variant="default" className="ml-2">test</Badge>
                        ) : null}
                      </p>
                      <p className="font-mono text-xs text-charcoal-500">{e.eventId}</p>
                      <p className="mt-1 text-xs text-charcoal-600">
                        {e.companyName ?? (
                          <>
                            No company resolved
                            {e.stripeCustomerId ? ` — Stripe customer ${e.stripeCustomerId}` : ''}
                          </>
                        )}
                        {' · arrived '}{dateTime(e.receivedAt)}
                      </p>
                      {e.processingError ? (
                        <p className="mt-1 text-xs text-danger-700">{e.processingError}</p>
                      ) : null}
                      {e.attemptsByHand > 0 ? (
                        <p className="mt-1 text-xs text-charcoal-500">
                          Tried {e.attemptsByHand} time{e.attemptsByHand === 1 ? '' : 's'} by hand
                          {e.lastAttempt ? `, last ${dateTime(e.lastAttempt)}` : ''}
                          {e.lastError ? ` — ${e.lastError}` : ''}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                    <div className="space-y-1.5">
                      <Label htmlFor={`why-${e.eventId}`} className="text-xs">
                        Why you are applying it
                      </Label>
                      <Input id={`why-${e.eventId}`} value={replayWhy[e.eventId] ?? ''}
                        placeholder="Customer paid on the 3rd and still has no access"
                        onChange={(ev) => setReplayWhy({ ...replayWhy, [e.eventId]: ev.target.value })} />
                    </div>
                    <div className="flex items-end">
                      <Button disabled={replaying === e.eventId
                        || (replayWhy[e.eventId] ?? '').trim().length < 5}
                        onClick={() => replay(e.eventId)}>
                        {replaying === e.eventId
                          ? <Loader2 className="size-4 animate-spin" />
                          : <RotateCw className="size-4" />}
                        Apply it again
                      </Button>
                    </div>
                  </div>
                </div>
              ))}

              {!stuck.length && stuckQ.status === 'ready' ? (
                <EmptyState title="Every Stripe event has landed"
                  hint="Nobody has paid and been left without access." />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stripe events</CardTitle>
              <CardDescription>
                Subscription access comes from verified webhook state and never from a browser
                redirect, so an event that did not finish is a customer whose access did not change.
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
                  {webhooks.map((w) => (
                    <TableRow key={w.eventId} className={cn(w.unprocessed && 'bg-danger-50/40')}>
                      <TableCell className="font-mono text-xs">{w.eventId}</TableCell>
                      <TableCell className="text-xs">
                        {w.type}
                        {!w.livemode ? (
                          <Badge variant="default" className="ml-2">test</Badge>
                        ) : null}
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
                <EmptyState title="No Stripe events yet" />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {selected ? (
        <FeatureDialog company={selected} onClose={() => setSelected(null)}
          overrides={overrides.filter((o) => o.companyId === selected.companyId)}
          onChanged={() => { overridesQ.refetch(); companiesQ.refetch(); }} />
      ) : null}
    </>
  );
}

function Tile({ label, value, icon, tone = 'neutral' }: {
  label: string; value: string; icon?: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warn' | 'danger';
}) {
  return (
    <div className="rounded-[--radius-card] border border-charcoal-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">{label}</p>
        <span className="text-charcoal-400">{icon}</span>
      </div>
      <p className={cn('tabular mt-1 text-2xl font-bold',
        tone === 'danger' ? 'text-danger-700' : tone === 'warn' ? 'text-warn-700'
        : tone === 'success' ? 'text-success-700' : 'text-charcoal-900')}>{value}</p>
    </div>
  );
}

function SubscriptionBadge({ c }: { c: AdminCompany }) {
  if (!c.subscriptionStatus) {
    return <span className="text-xs text-charcoal-500">
      {c.entitlementSource === 'trial' ? 'trial' : 'none'}
    </span>;
  }
  const good = ['active', 'trialing'].includes(c.subscriptionStatus);
  return (
    <div>
      <Badge variant={good ? 'success' : 'danger'}>{c.subscriptionStatus}</Badge>
      {c.cancelAtPeriodEnd ? (
        <p className="mt-1 text-[11px] text-warn-700">
          cancels {c.currentPeriodEnd ? date(c.currentPeriodEnd) : 'at period end'}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Turning a feature on or off for one company.
 *
 * The reason field is not optional and the form says why: an override nobody
 * can explain eighteen months later is the failure being prevented. The
 * database refuses one without a reason regardless, so this is the form
 * agreeing with the rule rather than being the rule.
 */
function FeatureDialog({ company, overrides, onClose, onChanged }: {
  company: AdminCompany;
  overrides: { id: string; feature: string; effect: 'grant' | 'revoke'; reason: string }[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [feature, setFeature] = useState('');
  const [effect, setEffect] = useState<'grant' | 'revoke'>('grant');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!supabase) return;
    setBusy(true); setError(null);
    try {
      await setFeatureOverride(supabase, {
        companyId: company.companyId, feature: feature.trim(), effect,
        reason: reason.trim(), validUntil: until ? new Date(until).toISOString() : null,
      });
      setFeature(''); setReason(''); setUntil('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That override could not be set.');
    } finally { setBusy(false); }
  }

  async function withdraw(f: string) {
    if (!supabase) return;
    setBusy(true); setError(null);
    try {
      await clearFeatureOverride(supabase, company.companyId, f, 'Withdrawn from the console');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That override could not be withdrawn.');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal-950/40 p-4"
      role="dialog" aria-modal="true" aria-label={`Features for ${company.name}`}>
      <Card className="max-h-[85vh] w-full max-w-lg overflow-auto">
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>{company.name}</CardTitle>
            <CardDescription>
              On {company.planId ?? 'no plan'}. Overrides here compose on top of it and
              survive a Stripe event rewriting the entitlement.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}

          {overrides.length ? (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">
                In force
              </p>
              {overrides.map((o) => (
                <div key={o.id} className="flex items-start justify-between gap-3 rounded border border-charcoal-200 p-2.5">
                  <div>
                    <p className="font-mono text-xs text-charcoal-800">{o.feature}</p>
                    <p className="text-xs text-charcoal-500">{o.reason}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={o.effect === 'grant' ? 'success' : 'danger'}>{o.effect}</Badge>
                    <Button size="sm" variant="ghost" disabled={busy}
                      onClick={() => withdraw(o.feature)}>Withdraw</Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="space-y-3 border-t border-charcoal-200 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="feature">Feature key</Label>
              <Input id="feature" value={feature} placeholder="ai_plan_review"
                onChange={(e) => setFeature(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="effect">Effect</Label>
              <Select value={effect} onValueChange={(v) => setEffect(v as 'grant' | 'revoke')}>
                <SelectTrigger id="effect"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="grant">Grant — on regardless of plan</SelectItem>
                  <SelectItem value="revoke">Revoke — off regardless of plan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reason">Why</Label>
              <Input id="reason" value={reason} placeholder="Evaluating for an enterprise upgrade"
                onChange={(e) => setReason(e.target.value)} />
              <p className="text-xs text-charcoal-500">
                Required, and at least five characters. "Why does this customer have this"
                is the question nobody can answer eighteen months later.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="until">Expires (optional)</Label>
              <Input id="until" type="date" value={until}
                onChange={(e) => setUntil(e.target.value)} />
              <p className="text-xs text-charcoal-500">
                An override with no end is a decision somebody has to remember.
              </p>
            </div>
            <Button className="w-full" disabled={busy || !feature.trim() || reason.trim().length < 5}
              onClick={submit}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Apply override
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
