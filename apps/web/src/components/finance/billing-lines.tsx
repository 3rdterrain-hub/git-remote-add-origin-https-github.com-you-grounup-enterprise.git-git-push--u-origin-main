/**
 * Billing the period. WORKFLOW.
 *
 * `pay_application_lines` had no writer, so an application could be opened and
 * submitted and never filled in — `submit_pay_application` would happily certify
 * a bill for zero dollars.
 *
 * Two things this screen does deliberately.
 *
 * **It bills by amount or by percent, in the same cell.** Estimators work both
 * ways, and a screen that insists on one gets the other typed into it wrong. The
 * percent is converted on the way in and only the dollar figure is stored, so
 * there is one number on file rather than two that can disagree.
 *
 * **Nothing here sends a total.** Completed to date, retainage, previous
 * payments and the amount due are recomputed by the database from these lines
 * and from what earlier applications were actually paid.
 */
import { useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, EmptyState } from '@/components/ui/misc';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { LoadingState, ErrorState } from '@/components/data-state';
import { messageFor, useQuery } from '@/lib/data/query';
import {
  loadPayApplicationLines, buildPayApplicationLines, setPayApplicationLine,
  removePayApplicationLine, type PayAppLineRow,
} from '@/lib/data/finance';
import { money, percent } from '@/lib/format';
import { cn } from '@/lib/utils';

/** A cell that takes a dollar figure, or a percent when it ends in `%`. */
function BilledCell({ line, draft, canWrite, onSaved, onError }: {
  line: PayAppLineRow;
  draft: boolean;
  canWrite: boolean;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setEditing(false);
    const raw = text.trim();
    if (raw === '') return;
    setBusy(true);
    try {
      if (raw.endsWith('%')) {
        const pct = Number(raw.slice(0, -1));
        if (!Number.isFinite(pct)) return;
        await setPayApplicationLine(line.id, { percentComplete: pct / 100 });
      } else {
        const amount = Number(raw);
        if (!Number.isFinite(amount)) return;
        await setPayApplicationLine(line.id, { thisPeriod: amount });
      }
      onSaved();
    } catch (e) { onError(messageFor(e)); } finally { setBusy(false); }
  };

  if (!draft || !canWrite) {
    return <span className={cn(line.thisPeriod > 0 && 'font-medium text-charcoal-900')}>
      {line.thisPeriod ? money(line.thisPeriod) : '—'}
    </span>;
  }

  return editing ? (
    <Input value={text} autoFocus className="h-8 text-right"
      placeholder="0 or 25%"
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
      onBlur={() => { void save(); }} />
  ) : (
    <button type="button"
      className="hover:underline"
      title="Bill this line — a dollar figure, or a percent complete ending in %"
      onClick={() => { setEditing(true); setText(line.thisPeriod ? String(line.thisPeriod) : ''); }}>
      {busy ? <Loader2 className="inline size-3 animate-spin" /> : null}
      {line.thisPeriod ? money(line.thisPeriod) : '—'}
    </button>
  );
}

export function BillingLines({ applicationId, status, canWrite, onChanged }: {
  applicationId: string;
  status: string;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [nonce, setNonce] = useState(0);
  const linesQ = useQuery(loadPayApplicationLines(applicationId), [applicationId, nonce]);
  const lines = linesQ.status === 'ready' ? linesQ.data : [];
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = status === 'draft';

  const again = () => { setNonce((n) => n + 1); onChanged(); };

  const totals = lines.reduce((a, l) => ({
    scheduled: a.scheduled + l.scheduledValue,
    previous: a.previous + l.previousCompleted,
    thisPeriod: a.thisPeriod + l.thisPeriod,
    stored: a.stored + l.storedMaterials,
    toDate: a.toDate + l.completedToDate,
    retainage: a.retainage + l.retainage,
  }), { scheduled: 0, previous: 0, thisPeriod: 0, stored: 0, toDate: 0, retainage: 0 });

  return (
    <div className="space-y-3">
      {error ? (
        <div className="px-6"><Alert tone="danger" title="That line was not billed">{error}</Alert></div>
      ) : null}

      {linesQ.status === 'loading' ? <LoadingState label="Reading the lines" /> : null}
      {linesQ.status === 'error'
        ? <ErrorState message={linesQ.message} onRetry={linesQ.refetch} /> : null}

      {linesQ.status === 'ready' && lines.length === 0 ? (
        <div className="space-y-3 p-6">
          <EmptyState title="No lines on this application"
            description="An application bills against the schedule of values, one line per item. Fill it in and the previous column is carried from the last application rather than retyped." />
          <div className="flex justify-center">
            <Button size="sm" disabled={!canWrite || !draft || busy}
              title={!canWrite ? 'Needs permission to bill'
                : !draft ? 'This application is certified' : undefined}
              onClick={() => {
                setBusy(true); setError(null);
                buildPayApplicationLines(applicationId)
                  .then(again)
                  .catch((e: unknown) => setError(messageFor(e)))
                  .finally(() => setBusy(false));
              }}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Fill it from the schedule of values
            </Button>
          </div>
        </div>
      ) : null}

      {lines.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Item</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Scheduled value</TableHead>
              <TableHead className="text-right">Previous</TableHead>
              <TableHead className="text-right">This period</TableHead>
              <TableHead className="text-right">Stored</TableHead>
              <TableHead className="text-right">To date</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead className="text-right">Retainage</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-mono text-xs text-charcoal-500">{l.itemNumber}</TableCell>
                <TableCell className="font-medium text-charcoal-900">{l.description}</TableCell>
                <TableCell className="tabular text-right">{money(l.scheduledValue)}</TableCell>
                <TableCell className="tabular text-right text-charcoal-600">
                  {/* Carried from the last application, never retyped. */}
                  {money(l.previousCompleted)}
                </TableCell>
                <TableCell className="tabular text-right">
                  <BilledCell line={l} draft={draft} canWrite={canWrite}
                    onSaved={again} onError={setError} />
                </TableCell>
                <TableCell className="tabular text-right text-charcoal-600">
                  {l.storedMaterials ? money(l.storedMaterials) : '—'}
                </TableCell>
                <TableCell className="tabular text-right font-medium">
                  {money(l.completedToDate)}
                </TableCell>
                <TableCell className="tabular text-right text-charcoal-600">
                  {l.percentComplete === null ? '—' : percent(l.percentComplete, 0)}
                </TableCell>
                <TableCell className="tabular text-right text-charcoal-600">
                  {l.retainage ? money(l.retainage) : '—'}
                </TableCell>
                <TableCell className="tabular text-right text-charcoal-600">
                  {money(l.balanceToFinish)}
                </TableCell>
                <TableCell className="text-right">
                  {canWrite && draft ? (
                    <button type="button" className="text-charcoal-400 hover:text-danger-700"
                      title="Take this line off the application"
                      onClick={() => {
                        setError(null);
                        removePayApplicationLine(l.id).then(again)
                          .catch((e: unknown) => setError(messageFor(e)));
                      }}>
                      <Trash2 className="size-3.5" />
                    </button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-charcoal-50">
              <TableCell colSpan={2}>Totals</TableCell>
              <TableCell className="tabular text-right">{money(totals.scheduled)}</TableCell>
              <TableCell className="tabular text-right">{money(totals.previous)}</TableCell>
              <TableCell className="tabular text-right">{money(totals.thisPeriod)}</TableCell>
              <TableCell className="tabular text-right">{money(totals.stored)}</TableCell>
              <TableCell className="tabular text-right">{money(totals.toDate)}</TableCell>
              <TableCell className="tabular text-right">
                {totals.scheduled ? percent(totals.toDate / totals.scheduled, 0) : '—'}
              </TableCell>
              <TableCell className="tabular text-right">{money(totals.retainage)}</TableCell>
              <TableCell className="tabular text-right">
                {money(totals.scheduled - totals.toDate)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      ) : null}
    </div>
  );
}
