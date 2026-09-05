import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Banknote, Loader2, Check, X, Send, ShieldAlert, AlertTriangle,
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
  loadRefunds, loadAdminCompanies, requestRefund, decideRefund, applyRefund,
  type RefundKind,
} from '@/lib/data/admin';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { supabase } from '@/lib/supabase';
import { money, dateTime } from '@/lib/format';
import type { OperatorContext } from './shell';

const STATE_TONE: Record<string, 'default' | 'success' | 'warn' | 'danger'> = {
  requested: 'warn', approved: 'default', applied: 'success',
  rejected: 'default', failed: 'danger',
};

/**
 * Money going back to a customer.
 *
 * The decision is made here; the money moves in Stripe. Three stages, and each
 * one is somebody different where it can be: asked for, released, sent. The
 * screen never decides who may release a given request — the database returns
 * `youMayDecide` on each row, because the rule is three separate facts and a
 * screen that rebuilt it would eventually rebuild it wrong.
 */
export function AdminRefunds() {
  const { can } = useOutletContext<OperatorContext>();
  const refundsQ = useQuery(loadRefunds, []);
  const companiesQ = useQuery(loadAdminCompanies, []);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState<{
    companyId: string; kind: RefundKind; amount: string; reason: string; invoice: string;
  }>({ companyId: '', kind: 'refund', amount: '', reason: '', invoice: '' });

  const refunds = refundsQ.status === 'ready' ? refundsQ.data : [];
  const companies = companiesQ.status === 'ready' ? companiesQ.data : [];
  const mayAsk = can('refunds.request') || can('refunds.approve');

  const failure = [refundsQ, companiesQ].find((q) => q.status === 'error');
  if (failure) return <ErrorState message={failure.message} onRetry={failure.refetch} />;

  const open = refunds.filter((r) => r.state === 'requested');
  const ready = refunds.filter((r) => r.state === 'approved');

  async function request() {
    if (!supabase) return;
    setBusy('ask'); setError(null);
    try {
      await requestRefund(supabase, {
        companyId: ask.companyId, kind: ask.kind,
        amountCents: Math.round(Number(ask.amount) * 100),
        reason: ask.reason, stripeInvoiceId: ask.invoice || null,
      });
      setAsk({ companyId: '', kind: 'refund', amount: '', reason: '', invoice: '' });
      refundsQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be requested.');
    } finally { setBusy(null); }
  }

  async function decide(id: string, approve: boolean) {
    if (!supabase) return;
    setBusy(id); setError(null);
    try {
      await decideRefund(supabase, id, approve, note[id]?.trim() || null);
      refundsQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That decision could not be recorded.');
    } finally { setBusy(null); }
  }

  async function send(id: string) {
    if (!supabase) return;
    setBusy(id); setError(null);
    try {
      await applyRefund(id);
      refundsQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message
        : 'That could not be sent to Stripe. The reason is recorded against it.');
      refundsQ.refetch();
    } finally { setBusy(null); }
  }

  const askComplete = ask.companyId && Number(ask.amount) > 0
    && ask.reason.trim().length >= 10
    && (ask.kind === 'credit' || ask.invoice.trim().length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">
          Refunds and credits
        </h1>
        <p className="mt-1 text-sm text-charcoal-500">
          The decision is made here. The money moves in Stripe.
        </p>
      </div>

      {refundsQ.status === 'loading' ? <LoadingState label="Reading refunds" /> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {open.length ? (
        <Alert tone="warn" icon={<AlertTriangle className="size-4" />}
          title={`${open.length} waiting to be released`}>
          You cannot release one you asked for yourself unless you are the superadmin — the
          same rule the platform applies to upsell proposals and to approving an estimate
          inside a customer&apos;s own account.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="size-4" /> Ask for one
          </CardTitle>
          <CardDescription>
            A <strong>refund</strong> puts money back on the card and cannot be undone. A{' '}
            <strong>credit</strong> reduces the next invoice, moves no money, and is usually
            what a customer who is staying would rather have.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="refund-company">Company</Label>
              <select id="refund-company" value={ask.companyId}
                className="h-9 w-full rounded border border-charcoal-300 bg-white px-2 text-sm"
                onChange={(e) => setAsk({ ...ask, companyId: e.target.value })}>
                <option value="">Choose a company</option>
                {companies.map((c) => (
                  <option key={c.companyId} value={c.companyId}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="refund-kind">Kind</Label>
              <select id="refund-kind" value={ask.kind}
                className="h-9 w-full rounded border border-charcoal-300 bg-white px-2 text-sm"
                onChange={(e) => setAsk({ ...ask, kind: e.target.value as RefundKind })}>
                <option value="refund">Refund to the card</option>
                <option value="credit">Credit against the next invoice</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="refund-amount">Amount</Label>
              <Input id="refund-amount" type="number" min="0.01" step="0.01"
                value={ask.amount}
                onChange={(e) => setAsk({ ...ask, amount: e.target.value })} />
            </div>
          </div>

          {ask.kind === 'refund' ? (
            <div className="space-y-1.5">
              <Label htmlFor="refund-invoice">Stripe invoice id</Label>
              <Input id="refund-invoice" value={ask.invoice} placeholder="in_..."
                onChange={(e) => setAsk({ ...ask, invoice: e.target.value })} />
              <p className="text-xs text-charcoal-500">
                Checked against that company&apos;s own invoices, so a mistyped id cannot
                refund somebody else&apos;s charge.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="refund-reason">Why. At length — this is money leaving.</Label>
            <Input id="refund-reason" value={ask.reason}
              placeholder="Charged for September after they had already canceled in August"
              onChange={(e) => setAsk({ ...ask, reason: e.target.value })} />
          </div>

          <Button disabled={!mayAsk || busy === 'ask' || !askComplete} onClick={request}>
            {busy === 'ask' ? <Loader2 className="size-4 animate-spin" /> : null}
            Request it
          </Button>
        </CardContent>
      </Card>

      {ready.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Released, and not yet sent ({ready.length})</CardTitle>
            <CardDescription>
              Approved by somebody. Sending is the last step, and the amount comes from the
              request rather than from this screen.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {ready.map((r) => (
              <div key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded border
                           border-charcoal-200 p-3">
                <div className="min-w-0">
                  <p className="font-medium text-charcoal-900">
                    {r.companyName} · {money(r.amountCents / 100)}
                    <Badge variant="default" className="ml-1.5">{r.kind}</Badge>
                  </p>
                  <p className="text-xs text-charcoal-600">{r.reason}</p>
                  <p className="text-xs text-charcoal-400">
                    Asked by {r.requestedByEmail ?? 'somebody'}, released by{' '}
                    {r.decidedByEmail ?? 'somebody'}
                  </p>
                </div>
                <Button disabled={busy === r.id} onClick={() => send(r.id)}>
                  {busy === r.id ? <Loader2 className="size-4 animate-spin" />
                    : <Send className="size-4" />}
                  Send to Stripe
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Every request</CardTitle>
          <CardDescription>Asked for, decided, and what Stripe did with it.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Why</TableHead>
                <TableHead>Standing</TableHead>
                <TableHead>Asked</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {refunds.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-charcoal-900">
                    {r.companyName}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-900">
                    {money(r.amountCents / 100)}
                  </TableCell>
                  <TableCell className="text-xs text-charcoal-600">{r.kind}</TableCell>
                  <TableCell className="max-w-64 text-xs text-charcoal-600">
                    {r.reason}
                    {r.decisionNote ? (
                      <span className="mt-1 block text-charcoal-400">{r.decisionNote}</span>
                    ) : null}
                    {r.error ? (
                      <span className="mt-1 block text-danger-700">{r.error}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATE_TONE[r.state] ?? 'default'}>{r.state}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                    {dateTime(r.requestedAt)}
                    <span className="block text-charcoal-400">
                      {r.requestedByEmail ?? ''}
                    </span>
                  </TableCell>
                  <TableCell>
                    {r.state === 'requested' && r.youMayDecide ? (
                      <div className="space-y-1.5">
                        <Input value={note[r.id] ?? ''} placeholder="Note (required to refuse)"
                          className="h-8 w-48 text-xs"
                          onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />
                        <div className="flex gap-1.5">
                          <Button size="sm" disabled={busy === r.id}
                            onClick={() => decide(r.id, true)}>
                            <Check className="size-3.5" /> Release
                          </Button>
                          <Button size="sm" variant="ghost"
                            disabled={busy === r.id || (note[r.id] ?? '').trim().length < 5}
                            onClick={() => decide(r.id, false)}>
                            <X className="size-3.5" /> Refuse
                          </Button>
                        </div>
                      </div>
                    ) : r.state === 'requested' ? (
                      <span className="text-xs text-charcoal-400">
                        Somebody else has to decide this
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!refunds.length && refundsQ.status === 'ready' ? (
            <EmptyState title="Nothing has been refunded"
              hint="Requests appear here from the moment somebody asks for one." />
          ) : null}
        </CardContent>
      </Card>

      {!mayAsk ? (
        <Alert tone="warn" icon={<ShieldAlert className="size-4" />}
          title="Refunds are somebody else's">
          You can see what is happening. Asking for one and releasing one are separate
          permissions, and the database refuses both here regardless of what this screen
          shows.
        </Alert>
      ) : null}
    </div>
  );
}
