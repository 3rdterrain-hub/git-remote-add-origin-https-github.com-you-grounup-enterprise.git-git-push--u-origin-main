import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Building2, Gift, Percent, Tag, Loader2, ShieldAlert, AlertTriangle, PauseCircle,
  PlayCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@/lib/data/query';
import {
  loadAdminCompanies, loadBillingTerms, loadSuspensions, createCompanyFor,
  setBillingTerms, clearBillingTerms, suspendCompany, restoreCompany,
  type BillingTermKind, type SuspensionKind,
} from '@/lib/data/admin';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { supabase } from '@/lib/supabase';
import { money, date } from '@/lib/format';
import type { OperatorContext } from './shell';

const KIND_LABEL: Record<BillingTermKind, string> = {
  free: 'Free',
  percent_off: 'Percentage off',
  fixed_seat_price: 'Agreed seat price',
};

/**
 * Accounts, and what they pay.
 *
 * Two jobs live here that previously needed a database connection: putting a
 * company on the platform for somebody who signed on a call, and putting an
 * account on terms other than the list price.
 *
 * Every arrangement carries a reason, an author and — if it should — an end
 * date, because "why is this account free?" is a question somebody asks two
 * years later when nobody involved still works here.
 */
export function AdminAccounts() {
  const { can } = useOutletContext<OperatorContext>();
  const companiesQ = useQuery(loadAdminCompanies, []);
  const termsQ = useQuery(loadBillingTerms, []);
  const suspensionsQ = useQuery(loadSuspensions, []);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);

  const [newCo, setNewCo] = useState({ ownerEmail: '', name: '', reason: '' });
  const [susp, setSusp] = useState<{
    companyId: string; kind: SuspensionKind; reason: string; customerMessage: string;
  }>({ companyId: '', kind: 'nonpayment', reason: '', customerMessage: '' });

  const [term, setTerm] = useState<{
    companyId: string; kind: BillingTermKind; reason: string;
    percentOff: string; seatPrice: string; validUntil: string; coupon: string;
  }>({ companyId: '', kind: 'free', reason: '', percentOff: '',
       seatPrice: '', validUntil: '', coupon: '' });

  const companies = companiesQ.status === 'ready' ? companiesQ.data : [];
  const terms = termsQ.status === 'ready' ? termsQ.data : [];
  const suspensions = suspensionsQ.status === 'ready' ? suspensionsQ.data : [];
  const live = suspensions.filter((x) => x.live);
  const mayCreate = can('companies.manage');
  const mayPrice = can('billing.manage');

  const failure = [companiesQ, termsQ, suspensionsQ].find((q) => q.status === 'error');
  if (failure) return <ErrorState message={failure.message} onRetry={failure.refetch} />;

  async function create() {
    if (!supabase) return;
    setBusy('create'); setError(null); setMade(null);
    try {
      await createCompanyFor(supabase, newCo);
      setMade(`${newCo.name} is on the platform, owned by ${newCo.ownerEmail}.`);
      setNewCo({ ownerEmail: '', name: '', reason: '' });
      companiesQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That company could not be created.');
    } finally { setBusy(null); }
  }

  async function applyTerm() {
    if (!supabase) return;
    setBusy('term'); setError(null);
    try {
      await setBillingTerms(supabase, {
        companyId: term.companyId,
        kind: term.kind,
        reason: term.reason,
        percentOff: term.kind === 'percent_off' ? Number(term.percentOff) : null,
        seatPriceCents: term.kind === 'fixed_seat_price'
          ? Math.round(Number(term.seatPrice) * 100) : null,
        validUntil: term.validUntil ? new Date(term.validUntil).toISOString() : null,
        stripeCouponId: term.coupon || null,
      });
      setTerm({ ...term, reason: '', percentOff: '', seatPrice: '',
                validUntil: '', coupon: '' });
      termsQ.refetch(); companiesQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That arrangement could not be recorded.');
    } finally { setBusy(null); }
  }

  async function end(companyId: string) {
    if (!supabase) return;
    setBusy(companyId); setError(null);
    try {
      await clearBillingTerms(supabase, companyId, 'Ended from the operator console');
      termsQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That arrangement could not be ended.');
    } finally { setBusy(null); }
  }

  async function suspend() {
    if (!supabase) return;
    setBusy('suspend'); setError(null);
    try {
      await suspendCompany(supabase, susp);
      setSusp({ companyId: '', kind: 'nonpayment', reason: '', customerMessage: '' });
      suspensionsQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That account could not be suspended.');
    } finally { setBusy(null); }
  }

  async function restore(companyId: string) {
    if (!supabase) return;
    setBusy(companyId); setError(null);
    try {
      await restoreCompany(supabase, companyId, 'Restored from the operator console');
      suspensionsQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That account could not be restored.');
    } finally { setBusy(null); }
  }

  const termComplete = term.companyId && term.reason.trim().length >= 5
    && (term.kind !== 'percent_off' || Number(term.percentOff) > 0)
    && (term.kind !== 'fixed_seat_price' || Number(term.seatPrice) >= 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Accounts</h1>
        <p className="mt-1 text-sm text-charcoal-500">
          Putting a company on the platform, and deciding what it pays.
        </p>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {made ? <Alert tone="success">{made}</Alert> : null}
      {companiesQ.status === 'loading' ? <LoadingState label="Reading accounts" /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-4" /> Add a company
          </CardTitle>
          <CardDescription>
            For a customer who signed on a call, a demonstration tenant, or somebody moving
            over from another system. They sign up first at the normal address — GrounUp
            never issues a login on somebody&apos;s behalf — and then you name their address
            here and the company is theirs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="co-owner">The owner&apos;s email</Label>
              <Input id="co-owner" type="email" value={newCo.ownerEmail}
                placeholder="them@theircompany.com"
                onChange={(e) => setNewCo({ ...newCo, ownerEmail: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="co-name">Company name</Label>
              <Input id="co-name" value={newCo.name} placeholder="Ridgeline Excavating"
                onChange={(e) => setNewCo({ ...newCo, name: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="co-why">Why it is being created by hand</Label>
            <Input id="co-why" value={newCo.reason}
              placeholder="Signed on a call, migrating from spreadsheets"
              onChange={(e) => setNewCo({ ...newCo, reason: e.target.value })} />
          </div>
          <Button disabled={!mayCreate || busy === 'create' || !newCo.ownerEmail.trim()
            || newCo.name.trim().length < 2 || newCo.reason.trim().length < 5}
            onClick={create}>
            {busy === 'create' ? <Loader2 className="size-4 animate-spin" /> : null}
            Create the company
          </Button>
          <p className="text-xs text-charcoal-500">
            It arrives set up exactly as a self-serve signup does: default pricing profile,
            overhead, profit and contingency, and the trial the plan carries.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="size-4" /> Put an account on different terms
          </CardTitle>
          <CardDescription>
            Free, a percentage off, or an agreed price per seat. One arrangement per
            company — setting a second withdraws the first rather than stacking on it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="term-company">Company</Label>
              <select id="term-company" value={term.companyId}
                className="h-9 w-full rounded border border-charcoal-300 bg-white px-2 text-sm"
                onChange={(e) => setTerm({ ...term, companyId: e.target.value })}>
                <option value="">Choose a company</option>
                {companies.map((c) => (
                  <option key={c.companyId} value={c.companyId}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="term-kind">Arrangement</Label>
              <select id="term-kind" value={term.kind}
                className="h-9 w-full rounded border border-charcoal-300 bg-white px-2 text-sm"
                onChange={(e) => setTerm({ ...term, kind: e.target.value as BillingTermKind })}>
                <option value="free">Free — comped, no charge at all</option>
                <option value="percent_off">A percentage off the list price</option>
                <option value="fixed_seat_price">An agreed price per seat</option>
              </select>
            </div>
          </div>

          {term.kind === 'percent_off' ? (
            <div className="space-y-1.5 sm:max-w-48">
              <Label htmlFor="term-pct">Percent off</Label>
              <Input id="term-pct" type="number" min="1" max="100" value={term.percentOff}
                onChange={(e) => setTerm({ ...term, percentOff: e.target.value })} />
            </div>
          ) : null}

          {term.kind === 'fixed_seat_price' ? (
            <div className="space-y-1.5 sm:max-w-48">
              <Label htmlFor="term-seat">Dollars per seat, per month</Label>
              <Input id="term-seat" type="number" min="0" step="0.01" value={term.seatPrice}
                onChange={(e) => setTerm({ ...term, seatPrice: e.target.value })} />
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="term-until">Ends on (optional)</Label>
              <Input id="term-until" type="date" value={term.validUntil}
                onChange={(e) => setTerm({ ...term, validUntil: e.target.value })} />
            </div>
            {term.kind !== 'free' ? (
              <div className="space-y-1.5">
                <Label htmlFor="term-coupon">Stripe coupon id</Label>
                <Input id="term-coupon" value={term.coupon} placeholder="REFERRAL25"
                  onChange={(e) => setTerm({ ...term, coupon: e.target.value })} />
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="term-why">Why this account is on different terms</Label>
            <Input id="term-why" value={term.reason}
              placeholder="Founding customer, comped for a year"
              onChange={(e) => setTerm({ ...term, reason: e.target.value })} />
          </div>

          {term.kind !== 'free' && !term.coupon ? (
            <Alert tone="warn" icon={<AlertTriangle className="size-4" />}>
              Without a Stripe coupon this is recorded but not charged — Stripe is what bills
              the card, and it does not know about a discount it was never told about. Create
              the coupon in Stripe, paste its id here, and the arrangement reaches the invoice.
            </Alert>
          ) : null}

          <Button disabled={!mayPrice || busy === 'term' || !termComplete} onClick={applyTerm}>
            {busy === 'term' ? <Loader2 className="size-4 animate-spin" />
              : term.kind === 'free' ? <Gift className="size-4" />
              : <Percent className="size-4" />}
            Record the arrangement
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PauseCircle className="size-4" /> Put an account into read-only
          </CardTitle>
          <CardDescription>
            A suspension is read-only, never a lockout. They can still sign in, and still
            open, read, print and export every estimate, project and document they ever
            made — they simply cannot add to it until it is lifted. Holding a
            contractor&apos;s own records over an unpaid invoice is not leverage.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="susp-company">Company</Label>
              <select id="susp-company" value={susp.companyId}
                className="h-9 w-full rounded border border-charcoal-300 bg-white px-2 text-sm"
                onChange={(e) => setSusp({ ...susp, companyId: e.target.value })}>
                <option value="">Choose a company</option>
                {companies
                  .filter((c) => !live.some((s) => s.companyId === c.companyId))
                  .map((c) => (
                    <option key={c.companyId} value={c.companyId}>{c.name}</option>
                  ))}
              </select>
            </div>
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
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="susp-reason">Your note, for whoever reads this in a year</Label>
            <Input id="susp-reason" value={susp.reason}
              placeholder="Invoices from June and July unpaid after four reminders"
              onChange={(e) => setSusp({ ...susp, reason: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="susp-message">What the customer will see</Label>
            <Input id="susp-message" value={susp.customerMessage}
              placeholder="Your account is read-only until the outstanding invoice is paid. Everything you have made is still here."
              onChange={(e) => setSusp({ ...susp, customerMessage: e.target.value })} />
            <p className="text-xs text-charcoal-500">
              This is the exact sentence they get when they try to save something. Your note
              above is never shown to them.
            </p>
          </div>
          <Button variant="outline" disabled={!mayCreate || busy === 'suspend'
            || !susp.companyId || susp.reason.trim().length < 10
            || susp.customerMessage.trim().length < 10}
            onClick={suspend}>
            {busy === 'suspend' ? <Loader2 className="size-4 animate-spin" />
              : <PauseCircle className="size-4" />}
            Put it into read-only
          </Button>
        </CardContent>
      </Card>

      {live.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Currently suspended ({live.length})</CardTitle>
            <CardDescription>What each of them was told, and who decided.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Why</TableHead>
                  <TableHead>They were told</TableHead>
                  <TableHead className="text-right">Seats</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {live.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium text-charcoal-900">
                      {s.companyName}
                    </TableCell>
                    <TableCell>
                      <Badge variant="danger">{s.kind.replace(/_/g, ' ')}</Badge>
                      <span className="mt-1 block text-xs text-charcoal-600">{s.reason}</span>
                      {s.suspendedByEmail ? (
                        <span className="block text-xs text-charcoal-400">
                          {s.suspendedByEmail}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-72 text-xs text-charcoal-600">
                      {s.customerMessage}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-700">
                      {s.seats}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                      {date(s.suspendedAt)}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost"
                        disabled={!mayCreate || busy === s.companyId}
                        onClick={() => restore(s.companyId)}>
                        {busy === s.companyId ? <Loader2 className="size-4 animate-spin" />
                          : <PlayCircle className="size-4" />}
                        Restore
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Accounts not on the list price ({terms.length})</CardTitle>
          <CardDescription>
            What is being given away or discounted, why, and who decided.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Arrangement</TableHead>
                <TableHead className="text-right">Per seat</TableHead>
                <TableHead className="text-right">Seats</TableHead>
                <TableHead className="text-right">A month</TableHead>
                <TableHead>In effect</TableHead>
                <TableHead>Why</TableHead>
                <TableHead>Until</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {terms.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium text-charcoal-900">{t.companyName}</TableCell>
                  <TableCell>
                    <Badge variant={t.kind === 'free' ? 'warn' : 'default'}>
                      {KIND_LABEL[t.kind]}
                      {t.percentOff != null ? ` · ${t.percentOff}%` : ''}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-700">
                    {t.seatPriceMonthCents == null ? '—' : money(t.seatPriceMonthCents / 100)}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-700">{t.seats}</TableCell>
                  <TableCell className="tabular text-right text-charcoal-900">
                    {t.monthlyCents == null ? '—' : money(t.monthlyCents / 100)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={t.appliesInStripe ? 'success' : 'danger'}>
                      {t.appliesInStripe ? 'Yes' : 'Not in Stripe'}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-64 text-xs text-charcoal-600">
                    {t.reason}
                    {t.grantedByEmail ? (
                      <span className="block text-charcoal-400">{t.grantedByEmail}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                    {t.validUntil ? date(t.validUntil) : 'No end date'}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" disabled={!mayPrice || busy === t.companyId}
                      onClick={() => end(t.companyId)}>End</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!terms.length && termsQ.status === 'ready' ? (
            <EmptyState title="Everybody is on the list price"
              hint="Nothing is being given away or discounted." />
          ) : null}
        </CardContent>
      </Card>

      {!mayPrice && !mayCreate ? (
        <Alert tone="warn" icon={<ShieldAlert className="size-4" />}
          title="These controls are somebody else's">
          You can see what is in force. Changing it is refused by the database, not by
          these buttons being disabled.
        </Alert>
      ) : null}
    </div>
  );
}
