import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Mail, Send, Loader2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@/lib/data/query';
import { loadOutbox, loadOutboxHealth, sendQueuedEmail } from '@/lib/data/admin';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { integer, dateTime } from '@/lib/format';
import type { OperatorContext } from './shell';

const STATE_TONE = {
  queued: 'warn', sent: 'success', failed: 'danger', suppressed: 'default',
} as const;

/**
 * Whether mail is actually going out.
 *
 * Nothing on this platform sends inline — a webhook blocking on a mail provider
 * times out, and a timed-out Stripe webhook is retried, so the customer gets
 * charged once and emailed twice. Mail is queued beside the thing that caused
 * it and drained afterwards, which makes the queue the thing worth watching:
 * an outbox that is not emptying is a customer who was never told.
 */
export function AdminOutbox() {
  const { can } = useOutletContext<OperatorContext>();
  const outboxQ = useQuery(loadOutbox, []);
  const healthQ = useQuery(loadOutboxHealth, []);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const messages = outboxQ.status === 'ready' ? outboxQ.data : [];
  const health = healthQ.status === 'ready' ? healthQ.data : null;

  const failure = [outboxQ, healthQ].find((q) => q.status === 'error');
  if (failure) return <ErrorState message={failure.message} onRetry={failure.refetch} />;

  async function drain() {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await sendQueuedEmail();
      setResult(r.configured
        ? `Sent ${integer(r.sent)}. ${integer(r.waiting)} still waiting.`
        : r.note ?? 'No mail provider is configured.');
      outboxQ.refetch(); healthQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The outbox could not be drained.');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Outbox</h1>
          <p className="mt-1 text-sm text-charcoal-500">
            Every message the platform meant to send, and what happened to it.
          </p>
        </div>
        <Button disabled={!can('billing.read') || busy} onClick={drain}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Send what is waiting
        </Button>
      </div>

      {outboxQ.status === 'loading' ? <LoadingState label="Reading the outbox" /> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {result ? <Alert tone="info">{result}</Alert> : null}

      {health && health.stuck > 0 ? (
        <Alert tone="danger" icon={<AlertTriangle className="size-4" />}
          title={`${integer(health.stuck)} message(s) have been waiting over an hour`}>
          Either nothing is draining the outbox or the provider is refusing everything, and a
          plain queue count cannot tell those apart. Every one of these is somebody who was
          not told something the platform decided they should hear.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Waiting" value={health ? integer(health.waiting) : '—'}
          tone={health && health.stuck ? 'danger' : health && health.waiting ? 'warn' : 'neutral'} />
        <Tile label="Sent" value={health ? integer(health.sent) : '—'} tone="success" />
        <Tile label="Failed" value={health ? integer(health.failed) : '—'}
          tone={health && health.failed ? 'danger' : 'neutral'} />
        <Tile label="Switched off by the reader"
          value={health ? integer(health.switchedOff) : '—'} tone="neutral" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="size-4" /> Messages
          </CardTitle>
          <CardDescription>
            A message marked <strong>always</strong> is one the reader cannot switch off — a
            declined card is not marketing, and a preference that could suppress it would
            produce a customer who loses their account without ever being told.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>To</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Standing</TableHead>
                <TableHead>Queued</TableHead>
                <TableHead>Sent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {messages.slice(0, 100).map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs text-charcoal-800">
                    {m.toEmail}
                    {m.companyName ? (
                      <span className="block text-charcoal-400">{m.companyName}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-72 text-charcoal-700">
                    {m.subject}
                    {m.error ? (
                      <span className="mt-1 block text-xs text-danger-700">{m.error}</span>
                    ) : null}
                    {m.suppressedReason ? (
                      <span className="mt-1 block text-xs text-charcoal-500">
                        {m.suppressedReason}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-charcoal-600">
                    {m.category}
                    {m.transactional ? (
                      <Badge variant="default" className="ml-1.5">always</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATE_TONE[m.state]}>{m.state}</Badge>
                    {m.attempts > 1 ? (
                      <span className="ml-1.5 text-xs text-charcoal-500">
                        {m.attempts} tries
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                    {dateTime(m.queuedAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-charcoal-500">
                    {m.sentAt ? dateTime(m.sentAt) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!messages.length && outboxQ.status === 'ready' ? (
            <EmptyState title="Nothing has been queued"
              hint="Messages appear here the moment something happens that is worth telling somebody about." />
          ) : null}
        </CardContent>
      </Card>

      <Alert tone="neutral" icon={<ShieldCheck className="size-4" />}
        title="Why there is a queue at all">
        A webhook that blocked on a mail provider would time out, and Stripe retries a
        timed-out webhook — so the customer would be charged once and emailed twice. Mail is
        written beside the thing that caused it, with a key that makes a second copy
        impossible, and sent afterwards. Nothing is lost when the provider is down; it waits.
      </Alert>
    </div>
  );
}

function Tile({ label, value, tone }: {
  label: string; value: string; tone: 'neutral' | 'success' | 'warn' | 'danger';
}) {
  const tint = tone === 'danger' ? 'text-danger-700'
    : tone === 'warn' ? 'text-warn-700'
    : tone === 'success' ? 'text-success-700' : 'text-charcoal-900';
  return (
    <div className="rounded-[--radius-card] border border-charcoal-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">{label}</p>
      <p className={`tabular mt-1 text-2xl font-bold ${tint}`}>{value}</p>
    </div>
  );
}
