import { useState } from 'react';
import { useParams, Link, useNavigate, useOutletContext } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Sliders, PauseCircle, PlayCircle, Trash2, AlertTriangle,
  CreditCard, RotateCcw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { useQuery } from '@/lib/data/query';
import {
  loadCompanyControls, loadPlans, setAllowance, clearAllowance, setCompanyPlan,
  deleteCompany, suspendCompany, restoreCompany,
  ALLOWANCE_LABEL, type Allowance, type SuspensionKind,
} from '@/lib/data/admin';
import { LoadingState, ErrorState } from '@/components/data-state';
import { supabase } from '@/lib/supabase';
import { date } from '@/lib/format';
import type { OperatorContext } from './shell';

const ALLOWANCES: Allowance[] = [
  'max_seats', 'max_active_estimates', 'max_active_projects',
  'storage_gb', 'ai_credits_per_month',
];

/**
 * One company, and everything about it that can be changed.
 *
 * The console was list-shaped: a screen per kind of change, each of which made
 * you pick the company again. This is the other axis — pick the customer, then
 * do anything. It is where somebody actually is when they are on the phone to
 * one.
 *
 * Nothing here decides what may be done. Every control calls a function that
 * checks for itself, and a button being enabled is a courtesy on top of that.
 */
export function AdminCompany() {
  const { companyId = '' } = useParams();
  const { can } = useOutletContext<OperatorContext>();
  const navigate = useNavigate();

  const controlsQ = useQuery(loadCompanyControls(companyId), [companyId]);
  const plansQ = useQuery(loadPlans, []);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [amount, setAmount] = useState<Record<string, string>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState('');
  const [planWhy, setPlanWhy] = useState('');
  const [susp, setSusp] = useState<{ kind: SuspensionKind; reason: string; message: string }>(
    { kind: 'nonpayment', reason: '', message: '' });
  const [confirmName, setConfirmName] = useState('');
  const [deleteWhy, setDeleteWhy] = useState('');

  const c = controlsQ.status === 'ready' ? controlsQ.data : null;
  const plans = plansQ.status === 'ready' ? plansQ.data : [];

  if (controlsQ.status === 'error') {
    return <ErrorState message={controlsQ.message} onRetry={controlsQ.refetch} />;
  }
  if (controlsQ.status === 'loading') return <LoadingState label="Reading the account" />;
  if (!c) {
    return (
      <Alert tone="warn" title="That company is not visible to you">
        Either it does not exist, or you hold no permission to read the tenant list.
      </Alert>
    );
  }

  const mayAllow = can('features.manage');
  const mayManage = can('companies.manage');

  const current: Record<Allowance, number | null> = {
    max_seats: c.maxSeats,
    max_active_estimates: c.maxActiveEstimates,
    max_active_projects: c.maxActiveProjects,
    storage_gb: c.storageGb,
    ai_credits_per_month: c.aiCreditsPerMonth,
  };

  async function run(key: string, work: () => Promise<void>, message: string) {
    setBusy(key); setError(null); setDone(null);
    try {
      await work();
      setDone(message);
      controlsQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be done.');
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
          <Link to="/admin/companies"><ArrowLeft className="size-4" /> All companies</Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">{c.name}</h1>
          <Badge variant={c.entitlementActive ? 'success' : 'danger'}>
            {c.planName ?? c.planId}
          </Badge>
          {c.suspended ? <Badge variant="danger">Read-only</Badge> : null}
          {c.terms ? <Badge variant="warn">{c.terms.replace(/_/g, ' ')}</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-charcoal-500">
          Customer since {date(c.createdAt)}
          {c.subscriptionStatus ? ` · subscription ${c.subscriptionStatus}` : ' · no subscription'}
          {c.accessValidUntil ? ` · access to ${date(c.accessValidUntil)}` : ''}
        </p>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {done ? <Alert tone="success">{done}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to={`/admin/companies/${c.companyId}/billing`}>
            <CreditCard className="size-4" /> Open their subscription
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/accounts">Terms, discounts and comps</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sliders className="size-4" /> What they are allowed
          </CardTitle>
          <CardDescription>
            These are what the customer actually runs into, after any override. An override
            composes over the plan rather than editing their entitlement — a hand-edited
            entitlement is overwritten by the next Stripe invoice, which is the trap this
            avoids. Leave the box empty for unlimited.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ALLOWANCES.map((a) => {
            const overridden = c.overridden.includes(a);
            return (
              <div key={a} className="grid gap-3 sm:grid-cols-[14rem_8rem_1fr_auto]">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-charcoal-800">
                    {ALLOWANCE_LABEL[a]}
                  </span>
                  {overridden ? <Badge variant="warn">override</Badge> : null}
                </div>
                <Input type="number" min="0" aria-label={ALLOWANCE_LABEL[a]}
                  placeholder={current[a] === null ? 'unlimited' : String(current[a])}
                  value={amount[a] ?? ''}
                  onChange={(e) => setAmount({ ...amount, [a]: e.target.value })} />
                <Input placeholder="Why they get something different"
                  aria-label={`Why ${ALLOWANCE_LABEL[a]}`}
                  value={why[a] ?? ''}
                  onChange={(e) => setWhy({ ...why, [a]: e.target.value })} />
                <div className="flex gap-1.5">
                  <Button size="sm" disabled={!mayAllow || busy === a
                    || (why[a] ?? '').trim().length < 5}
                    onClick={() => run(a, () => setAllowance(supabase!, {
                      companyId: c.companyId, allowance: a,
                      amount: (amount[a] ?? '') === '' ? null : Number(amount[a]),
                      reason: why[a] ?? '',
                    }), `${ALLOWANCE_LABEL[a]} changed.`)}>
                    {busy === a ? <Loader2 className="size-4 animate-spin" /> : null}
                    Set
                  </Button>
                  {overridden ? (
                    <Button size="sm" variant="ghost" disabled={!mayAllow || busy === a}
                      onClick={() => run(a, () => clearAllowance(
                        supabase!, c.companyId, a,
                        (why[a] ?? '').trim() || 'Back to the plan'),
                        `${ALLOWANCE_LABEL[a]} is back on the plan.`)}
                      title="Put it back on the plan">
                      <RotateCcw className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Which plan they are on</CardTitle>
          <CardDescription>
            {c.stripeSubscriptionId
              ? 'This company has a live Stripe subscription. Their plan changes in Stripe '
                + 'and the webhook brings it back — moving it here would leave GrounUp and '
                + 'Stripe disagreeing, which the dashboard counts as a problem.'
              : 'No Stripe subscription, so the plan is set here.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="plan">Plan</Label>
              <select id="plan" value={plan || c.planId}
                className="h-9 w-full rounded border border-charcoal-300 bg-white px-2 text-sm"
                disabled={Boolean(c.stripeSubscriptionId)}
                onChange={(e) => setPlan(e.target.value)}>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-why">Why</Label>
              <Input id="plan-why" value={planWhy}
                disabled={Boolean(c.stripeSubscriptionId)}
                placeholder="Downgraded at their request"
                onChange={(e) => setPlanWhy(e.target.value)} />
            </div>
          </div>
          <Button disabled={!mayAllow || Boolean(c.stripeSubscriptionId) || busy === 'plan'
            || !plan || plan === c.planId || planWhy.trim().length < 5}
            onClick={() => run('plan', () => setCompanyPlan(
              supabase!, c.companyId, plan, planWhy), 'Plan changed.')}>
            {busy === 'plan' ? <Loader2 className="size-4 animate-spin" /> : null}
            Move them
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {c.suspended ? <PlayCircle className="size-4" /> : <PauseCircle className="size-4" />}
            {c.suspended ? 'Restore this account' : 'Put this account into read-only'}
          </CardTitle>
          <CardDescription>
            Read-only, never a lockout. They keep signing in, keep reading and keep
            exporting everything they made.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {c.suspended ? (
            <>
              <Input placeholder="Why it is being lifted" value={susp.reason}
                aria-label="Why it is being lifted"
                onChange={(e) => setSusp({ ...susp, reason: e.target.value })} />
              <Button disabled={!mayManage || busy === 'restore' || susp.reason.trim().length < 5}
                onClick={() => run('restore', () => restoreCompany(
                  supabase!, c.companyId, susp.reason), 'Restored.')}>
                {busy === 'restore' ? <Loader2 className="size-4 animate-spin" /> : null}
                Restore them
              </Button>
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="susp-kind">Why</Label>
                  <select id="susp-kind" value={susp.kind}
                    className="h-9 w-full rounded border border-charcoal-300 bg-white px-2 text-sm"
                    onChange={(e) => setSusp({ ...susp, kind: e.target.value as SuspensionKind })}>
                    <option value="nonpayment">Not paying</option>
                    <option value="abuse">Abuse of the platform</option>
                    <option value="legal_hold">Legal hold</option>
                    <option value="requested">They asked for it</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="susp-note">Your note</Label>
                  <Input id="susp-note" value={susp.reason}
                    placeholder="Invoices from June and July unpaid after four reminders"
                    onChange={(e) => setSusp({ ...susp, reason: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="susp-message">What they will see, and be emailed</Label>
                <Input id="susp-message" value={susp.message}
                  placeholder="Your account is read-only until the outstanding invoice is paid."
                  onChange={(e) => setSusp({ ...susp, message: e.target.value })} />
              </div>
              <Button variant="outline" disabled={!mayManage || busy === 'suspend'
                || susp.reason.trim().length < 10 || susp.message.trim().length < 10}
                onClick={() => run('suspend', () => suspendCompany(supabase!, {
                  companyId: c.companyId, kind: susp.kind,
                  reason: susp.reason, customerMessage: susp.message,
                }), 'They are read-only, and have been told why.')}>
                {busy === 'suspend' ? <Loader2 className="size-4 animate-spin" /> : null}
                Put them into read-only
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-danger-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-danger-800">
            <Trash2 className="size-4" /> Delete this company
          </CardTitle>
          <CardDescription>
            Everything they ever made, gone. Estimates, projects, documents, costs. There is
            no undo and no export afterwards — if they want their data, take it out first.
            The record that you deleted it survives, with your reason.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {c.stripeSubscriptionId && c.subscriptionStatus !== 'canceled' ? (
            <Alert tone="warn" icon={<AlertTriangle className="size-4" />}>
              They still have a live Stripe subscription. Cancel it first, or they keep being
              charged for an account that no longer exists.
            </Alert>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Type <strong>{c.name}</strong> to confirm</Label>
            <Input id="confirm" value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delete-why">Why, at length</Label>
            <Input id="delete-why" value={deleteWhy}
              placeholder="They asked to be removed entirely under their own data request"
              onChange={(e) => setDeleteWhy(e.target.value)} />
          </div>
          <Button variant="outline" className="border-danger-400 text-danger-800"
            disabled={!mayManage || busy === 'delete'
              || confirmName.trim().toLowerCase() !== c.name.trim().toLowerCase()
              || deleteWhy.trim().length < 10}
            onClick={() => run('delete', async () => {
              await deleteCompany(supabase!, c.companyId, confirmName, deleteWhy);
              navigate('/admin/companies');
            }, 'Deleted.')}>
            {busy === 'delete' ? <Loader2 className="size-4 animate-spin" /> : null}
            Delete {c.name}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
