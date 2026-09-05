import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { ShieldAlert, Check, X, Loader2, UserPlus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@/lib/data/query';
import {
  loadProposals, loadAdminCompanies, loadOperators, loadOverrides, loadPlatformRoles,
  decideUpsell, clearFeatureOverride, hireOperator, revokeOperator, setOperatorRole,
} from '@/lib/data/admin';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { supabase } from '@/lib/supabase';
import { money, date, dateTime } from '@/lib/format';
import type { OperatorContext } from './shell';

/**
 * What only the superadmin does.
 *
 * Approving what sales proposed, withdrawing an override, and seeing who else
 * holds operator access. Every control here is refused by the database for
 * anybody else — this screen not rendering them is a courtesy, not the
 * protection.
 */
export function AdminControls() {
  const { can } = useOutletContext<OperatorContext>();
  const mayDecide = can('upsell.decide');
  const mayHire = can('operators.manage');
  const mayFeature = can('features.manage');
  const proposalsQ = useQuery(loadProposals, []);
  const companiesQ = useQuery(loadAdminCompanies, []);
  const operatorsQ = useQuery(loadOperators, []);
  const overridesQ = useQuery(loadOverrides, []);
  const rolesQ = useQuery(loadPlatformRoles, []);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [hireEmail, setHireEmail] = useState('');
  const [hireReason, setHireReason] = useState('');
  const [hireRole, setHireRole] = useState('sales');

  const proposals = proposalsQ.status === 'ready' ? proposalsQ.data : [];
  const companies = companiesQ.status === 'ready' ? companiesQ.data : [];
  const operators = operatorsQ.status === 'ready' ? operatorsQ.data : [];
  const overrides = overridesQ.status === 'ready' ? overridesQ.data : [];
  const roles = rolesQ.status === 'ready' ? rolesQ.data : [];
  const grantable = roles.filter((r) => r.assignable);

  const failure = [proposalsQ, companiesQ, operatorsQ, overridesQ, rolesQ]
    .find((q) => q.status === 'error');
  if (failure) return <ErrorState message={failure.message} onRetry={failure.refetch} />;

  const open = proposals.filter((p) => p.state === 'proposed');
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

  async function hire() {
    if (!supabase) return;
    setBusy('hire'); setError(null);
    try {
      await hireOperator(supabase, hireEmail, hireReason, hireRole);
      setHireEmail(''); setHireReason('');
      operatorsQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That person could not be taken on.');
    } finally { setBusy(null); }
  }

  async function letGo(userId: string) {
    if (!supabase) return;
    setBusy(userId); setError(null);
    try {
      await revokeOperator(supabase, userId, 'Access withdrawn from the console');
      operatorsQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That access could not be withdrawn.');
    } finally { setBusy(null); }
  }

  async function changeRole(userId: string, roleKey: string) {
    if (!supabase) return;
    setBusy(userId); setError(null);
    try {
      await setOperatorRole(supabase, userId, roleKey, 'Role changed from the console');
      operatorsQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That role could not be changed.');
    } finally { setBusy(null); }
  }

  async function withdraw(companyId: string, feature: string) {
    if (!supabase) return;
    setBusy(feature); setError(null);
    try {
      await clearFeatureOverride(supabase, companyId, feature, 'Withdrawn from the console');
      overridesQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That override could not be withdrawn.');
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">
          Superadmin controls
        </h1>
        <p className="mt-1 text-sm text-charcoal-500">
          Deciding what sales proposed, and what is in force because of it.
        </p>
      </div>

      {proposalsQ.status === 'loading' ? <LoadingState label="Reading proposals" /> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Waiting on you ({open.length})</CardTitle>
          <CardDescription>
            You cannot approve a proposal you wrote yourself — the same rule the platform
            enforces inside a customer&apos;s account, applied to its own commercial decisions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {open.map((p) => (
            <div key={p.id} className="rounded border border-charcoal-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-charcoal-900">{companyName(p.companyId)}</p>
                  <p className="text-xs text-charcoal-500">
                    Proposed {date(p.proposedAt)}
                    {p.estimatedMonthlyCents != null
                      ? ` · ${money(p.estimatedMonthlyCents / 100)} a month estimated` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {p.proposedPlanId ? (
                    <Badge variant="success">Move to {p.proposedPlanId}</Badge>
                  ) : null}
                  {p.proposedFeatures.map((f) => (
                    <Badge key={f} variant="default">{f}</Badge>
                  ))}
                </div>
              </div>

              <p className="mt-3 rounded bg-charcoal-50 p-3 text-sm text-charcoal-700">
                {p.rationale}
              </p>

              <div className="mt-3 space-y-2">
                <Label htmlFor={`note-${p.id}`} className="text-xs">
                  Note (required to reject)
                </Label>
                <Input id={`note-${p.id}`} value={note[p.id] ?? ''}
                  placeholder="Agreed at the quoted price"
                  onChange={(e) => setNote({ ...note, [p.id]: e.target.value })} />
                <div className="flex gap-2">
                  <Button size="sm" variant="success" disabled={!mayDecide || busy === p.id}
                    onClick={() => decide(p.id, true)}>
                    {busy === p.id ? <Loader2 className="size-4 animate-spin" />
                      : <Check className="size-4" />} Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={!mayDecide || busy === p.id}
                    onClick={() => decide(p.id, false)}>
                    <X className="size-4" /> Reject
                  </Button>
                </div>
                <p className="text-xs text-charcoal-500">
                  Approving records the decision. It does not switch anything on — applying
                  it is a separate act, so &quot;we agreed&quot; and &quot;it is live&quot; stay
                  distinguishable.
                </p>
              </div>
            </div>
          ))}
          {!open.length && proposalsQ.status === 'ready' ? (
            <EmptyState title="Nothing waiting" hint="Sales has nothing on your desk." />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Overrides in force ({overrides.length})</CardTitle>
          <CardDescription>
            Features turned on or off for one customer, composing on top of their plan. A
            revoke beats a grant beats the plan.
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
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {overrides.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium text-charcoal-900">
                    {companyName(o.companyId)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{o.feature}</TableCell>
                  <TableCell>
                    <Badge variant={o.effect === 'grant' ? 'success' : 'danger'}>
                      {o.effect}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-64 text-xs text-charcoal-600">{o.reason}</TableCell>
                  <TableCell className="text-xs text-charcoal-500">
                    {o.validUntil ? date(o.validUntil)
                      : <span className="text-warn-700">no end date</span>}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" disabled={!mayFeature || busy === o.feature}
                      onClick={() => withdraw(o.companyId, o.feature)}>Withdraw</Button>
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

      <Card>
        <CardHeader>
          <CardTitle>Who operates this platform</CardTitle>
          <CardDescription>
            There is exactly one superadmin, enforced by the database rather than by
            convention. Access is granted deliberately and never from a screen.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Why</TableHead>
                <TableHead>Since</TableHead>
                <TableHead>Standing</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {operators.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="text-charcoal-800">{o.email ?? o.userId}</TableCell>
                  <TableCell>
                    {o.roleKey === 'superadmin' || o.revokedAt ? (
                      <Badge variant={o.roleKey === 'superadmin' ? 'warn' : 'default'}>
                        {roles.find((r) => r.key === o.roleKey)?.name ?? o.roleKey}
                      </Badge>
                    ) : (
                      <select value={o.roleKey} disabled={!mayHire || busy === o.userId}
                        className="h-8 rounded border border-charcoal-300 bg-white px-1.5 text-xs"
                        onChange={(e) => changeRole(o.userId, e.target.value)}>
                        {grantable.map((r) => (
                          <option key={r.key} value={r.key}>{r.name}</option>
                        ))}
                      </select>
                    )}
                  </TableCell>
                  <TableCell className="max-w-64 text-xs text-charcoal-600">{o.reason}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                    {dateTime(o.grantedAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={o.revokedAt ? 'danger' : 'success'}>
                      {o.revokedAt ? 'Revoked' : 'Active'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {/*
                      * No withdraw on the superadmin. Giving that seat up from
                      * a screen would leave nobody able to grant anything, and
                      * recovering means the database anyway — so handover stays
                      * a deliberate act outside the product.
                      */}
                    {!o.revokedAt && o.roleKey !== 'superadmin' ? (
                      <Button size="sm" variant="ghost"
                        disabled={!mayHire || busy === o.userId}
                        onClick={() => letGo(o.userId)}>Withdraw</Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="space-y-3 border-t border-charcoal-200 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">
              Take somebody on
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.5fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="hire-email">Their email</Label>
                <Input id="hire-email" type="email" value={hireEmail}
                  placeholder="them@example.com"
                  onChange={(e) => setHireEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hire-role">Role</Label>
                <select id="hire-role" value={hireRole}
                  className="h-9 w-full rounded border border-charcoal-300 bg-white px-2 text-sm"
                  onChange={(e) => setHireRole(e.target.value)}>
                  {grantable.map((r) => (
                    <option key={r.key} value={r.key}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hire-reason">Who they are and why</Label>
                <Input id="hire-reason" value={hireReason}
                  placeholder="Joining to sell into the Ohio market"
                  onChange={(e) => setHireReason(e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button disabled={!mayHire || busy === 'hire'
                  || !hireEmail.trim() || hireReason.trim().length < 5}
                  onClick={hire}>
                  {busy === 'hire' ? <Loader2 className="size-4 animate-spin" />
                    : <UserPlus className="size-4" />} Grant access
                </Button>
              </div>
            </div>
            <p className="text-xs text-charcoal-500">
              They sign up first, at the normal address, and then you grant them access —
              GrounUp does not create logins for people.{' '}
              {grantable.find((r) => r.key === hireRole)?.description}{' '}
              The superadmin role is not among these: there is one, the database enforces
              one, and handing that seat over is done deliberately outside the product.
              What each role may do is set under <strong>Roles</strong>.
            </p>
          </div>
        </CardContent>
      </Card>

      {!mayDecide && !mayHire && !mayFeature ? (
        <Alert tone="warn" icon={<ShieldAlert className="size-4" />}
          title="These controls are somebody else's">
          You can see what is in force. Changing it is refused by the database, not by
          these buttons being disabled.
        </Alert>
      ) : null}
    </div>
  );
}
