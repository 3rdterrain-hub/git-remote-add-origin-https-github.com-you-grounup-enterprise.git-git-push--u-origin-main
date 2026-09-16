/**
 * Quotes against an RFQ, leveled.
 *
 * `rfq_responses` carried a generated `leveled_amount` — the quote plus a
 * leveling adjustment — from the day it was written, and nothing could record
 * a quote. So an RFQ could be sent, and nothing could ever come back.
 *
 * The adjustment is kept beside the quote rather than folded into it. One
 * vendor excludes traffic control and another includes it; the raw numbers are
 * not the same scope, and adding the difference back is the whole job. Keeping
 * them apart means the quote stays what the vendor actually said and the
 * comparison stays what the estimator decided — two facts, not one edited
 * number, and six months later you can still see which was which.
 *
 * Ranked on the leveled figure. Ranking raw quotes is the mistake leveling
 * exists to prevent, and it is the one that awards the wrong vendor.
 */
import { useState } from 'react';
import { Loader2, Plus, Trophy, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { loadRfqResponses, recordRfqResponse, awardRfq } from '@/lib/data/procurement';
import { loadVendors } from '@/lib/data/library';
import { money, integer } from '@/lib/format';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

export function BidLeveling({ rfqId, rfqStatus, canWrite, onChanged }: {
  rfqId: string;
  rfqStatus: string;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [nonce, setNonce] = useState(0);
  const quotesQ = useQuery(loadRfqResponses(rfqId), [rfqId, nonce]);
  const vendorsQ = useQuery(loadVendors, []);
  const quotes = quotesQ.status === 'ready' ? quotesQ.data : [];
  const vendors = vendorsQ.status === 'ready' ? vendorsQ.data : [];

  const awarded = rfqStatus === 'awarded';

  const [vendorId, setVendorId] = useState('');
  const [amount, setAmount] = useState('');
  const [adjustment, setAdjustment] = useState('');
  const [leadTime, setLeadTime] = useState('');
  const [exclusions, setExclusions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await work(); setNonce((n) => n + 1); onChanged(); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  const adjusted = quotes.filter((q) => q.levelingAdjustment !== 0);
  const lowRaw = quotes
    .filter((q) => q.quotedAmount !== null)
    .sort((a, b) => (a.quotedAmount ?? 0) - (b.quotedAmount ?? 0))[0];
  const lowLeveled = quotes.find((q) => q.leveledRank === 1);
  /* The case leveling exists for: the cheapest quote is not the best price. */
  const levelingChangedTheAnswer = Boolean(
    lowRaw && lowLeveled && lowRaw.vendorId !== lowLeveled.vendorId,
  );

  return (
    <div className="space-y-3 border-t border-charcoal-200 bg-charcoal-50/70 p-4">
      <h4 className="text-xs font-medium uppercase tracking-wide text-charcoal-600">
        What came back
      </h4>

      {quotesQ.status === 'loading' ? <LoadingState label="Reading the quotes" /> : null}
      {quotesQ.status === 'error'
        ? <ErrorState message={quotesQ.message} onRetry={quotesQ.refetch} /> : null}

      {quotes.length === 0 && quotesQ.status === 'ready' ? (
        <p className="text-sm text-charcoal-500">
          Nothing back yet. Record each quote as it arrives, with what the vendor left out —
          that is what makes two prices comparable.
        </p>
      ) : null}

      {levelingChangedTheAnswer ? (
        <p className="flex items-start gap-1.5 text-sm text-yellow-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          The cheapest quote is not the best price here. {lowRaw!.vendorName} is lower on
          paper; once scope is leveled, {lowLeveled!.vendorName} is.
        </p>
      ) : null}

      {quotes.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor</TableHead>
              <TableHead className="text-right">Quoted</TableHead>
              <TableHead className="text-right">Leveling</TableHead>
              <TableHead className="text-right">Leveled</TableHead>
              <TableHead className="text-right">Lead time</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.map((q) => (
              <TableRow key={q.id} className={q.status === 'awarded' ? 'bg-success-50/40' : undefined}>
                <TableCell>
                  <p className="font-medium text-charcoal-900">
                    {q.leveledRank === 1 ? '① ' : ''}{q.vendorName}
                  </p>
                  {q.exclusions ? (
                    <p className="max-w-64 text-xs text-charcoal-500">
                      excludes {q.exclusions}
                    </p>
                  ) : null}
                  {q.status === 'awarded' ? <Badge variant="success">Awarded</Badge> : null}
                  {q.status === 'declined' ? <Badge variant="outline">Declined</Badge> : null}
                  {q.isExpired ? <Badge variant="warn">Quote expired</Badge> : null}
                </TableCell>
                <TableCell className="tabular text-right text-charcoal-600">
                  {q.quotedAmount === null ? '—' : money(q.quotedAmount)}
                </TableCell>
                <TableCell className="tabular text-right text-charcoal-600">
                  {q.levelingAdjustment === 0 ? '—'
                    : `${q.levelingAdjustment > 0 ? '+' : ''}${money(q.levelingAdjustment)}`}
                </TableCell>
                <TableCell className="tabular text-right font-medium">
                  {q.leveledAmount === null ? '—' : money(q.leveledAmount)}
                </TableCell>
                <TableCell className="tabular text-right text-charcoal-600">
                  {q.leadTimeDays === null ? '—' : `${integer(q.leadTimeDays)} days`}
                </TableCell>
                <TableCell className="text-right">
                  {!awarded && canWrite && q.status !== 'declined' ? (
                    <Button size="sm" variant="outline" disabled={busy}
                      onClick={() => {
                        const why = window.prompt(
                          `Why ${q.vendorName}? Awarding to the lowest leveled number needs `
                          + 'no explanation; awarding to anybody else does.');
                        if (!why || why.trim().length < 3) return;
                        void run(() => awardRfq(rfqId, q.vendorId, why));
                      }}>
                      <Trophy className="size-4" /> Award
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {adjusted.length > 0 ? (
        <p className="text-xs text-charcoal-500">
          The quote is what the vendor said; the leveling is what you added back to make the
          scopes match. They are kept apart so that in six months you can still see which
          number came from whom.
        </p>
      ) : null}

      {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

      {!awarded && canWrite ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1 lg:col-span-2">
            <Label htmlFor={`qv-${rfqId}`}>Who quoted</Label>
            <select id={`qv-${rfqId}`} className={field} value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}>
              <option value="">Choose a vendor…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`qa-${rfqId}`}>Quoted</Label>
            <Input id={`qa-${rfqId}`} type="number" value={amount}
              onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`ql-${rfqId}`}>Leveling</Label>
            <Input id={`ql-${rfqId}`} type="number" value={adjustment}
              placeholder="0" onChange={(e) => setAdjustment(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`qt-${rfqId}`}>Lead time (days)</Label>
            <Input id={`qt-${rfqId}`} type="number" value={leadTime}
              onChange={(e) => setLeadTime(e.target.value)} />
          </div>
          <div className="space-y-1 lg:col-span-3">
            <Label htmlFor={`qe-${rfqId}`}>What they left out</Label>
            <Input id={`qe-${rfqId}`} value={exclusions}
              placeholder="Traffic control, mobilization"
              onChange={(e) => setExclusions(e.target.value)} />
          </div>
          <div className="flex items-end lg:col-span-2">
            <Button size="sm" variant="outline" disabled={busy || !vendorId || !amount}
              onClick={() => run(async () => {
                await recordRfqResponse({
                  rfqId, vendorId,
                  quotedAmount: Number(amount),
                  levelingAdjustment: adjustment ? Number(adjustment) : 0,
                  leadTimeDays: leadTime ? Number(leadTime) : null,
                  exclusions,
                });
                setVendorId(''); setAmount(''); setAdjustment('');
                setLeadTime(''); setExclusions('');
              })}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Record the quote
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
