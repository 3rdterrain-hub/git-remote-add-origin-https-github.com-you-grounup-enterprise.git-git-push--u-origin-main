/**
 * Workflow — the accounting periods, and closing one.
 *
 * `financial_periods` and `app.enforce_open_period` have existed since
 * migration 0034: a posting into a closed period is refused, and so is moving
 * one out of a closed period. `app.close_financial_period` has existed just as
 * long, carrying the check that makes closing mean anything — it refuses to
 * close over a pay application still in draft, because a period shut over one
 * produces a total that is going to move.
 *
 * None of it had a door. The table was read by nothing, the function had no
 * `public.` wrapper until 0147, and a company running a month-end close had the
 * whole mechanism and no way to see or operate it.
 *
 * The count of open pay applications is shown beside each period rather than
 * discovered on refusal. A button that fails when pressed, having looked
 * pressable, is worse than one that says what is in the way first — and the
 * refusal is still the authority, because a count on a screen is a moment old
 * and the database's is not.
 */
import { useState } from 'react';
import { BookLock, Loader2, Lock, Unlock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  loadFinancialPeriods, closeFinancialPeriod, type FinancialPeriod,
} from '@/lib/data/finance';
import { supabase } from '@/lib/supabase';
import { date, plural } from '@/lib/format';

export function ClosingTheBooks({ canClose }: { canClose: boolean }) {
  const periodsQ = useQuery(loadFinancialPeriods, []);
  const [closing, setClosing] = useState<FinancialPeriod | null>(null);

  if (periodsQ.status === 'loading') return <LoadingState label="Reading the periods" />;
  if (periodsQ.status === 'error') {
    return <ErrorState message={periodsQ.message} onRetry={periodsQ.refetch} />;
  }

  const periods = periodsQ.status === 'ready' ? periodsQ.data : [];

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookLock className="size-4 text-charcoal-500" />
            Accounting periods
          </CardTitle>
          <CardDescription>
            A closed period refuses a posting into it, and refuses one being moved out of it.
            Closing is therefore not a label — it is what makes a period total stop changing,
            which is why it will not close over a pay application still in draft.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {periods.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No periods defined"
                hint="A company with no periods is not running a close, and the platform does not invent one. Define them when your accounting calendar needs them." />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Covers</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>In the way</TableHead>
                  <TableHead className="text-right">Close</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-charcoal-900">{p.name}</TableCell>
                    <TableCell className="whitespace-nowrap text-charcoal-600">
                      {date(p.periodStart)} → {date(p.periodEnd)}
                    </TableCell>
                    <TableCell>
                      {p.status === 'closed' ? (
                        <Badge variant="success"><Lock className="size-3" /> Closed</Badge>
                      ) : (
                        <Badge variant="info"><Unlock className="size-3" /> Open</Badge>
                      )}
                      {p.closedAt ? (
                        <p className="text-xs text-charcoal-500">{date(p.closedAt)}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {p.status === 'closed' ? (
                        <span className="text-charcoal-400">—</span>
                      ) : p.openPayApplications > 0 ? (
                        <span className="text-sm text-warn-700">
                          {plural(p.openPayApplications, 'pay application')} still open
                        </span>
                      ) : (
                        <span className="text-sm text-charcoal-500">nothing</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.status === 'closed' ? null : (
                        <Button variant="outline" size="sm" disabled={!canClose}
                          title={canClose
                            ? 'Close this period'
                            : 'You do not have permission to close a period'}
                          onClick={() => setClosing(p)}>
                          <Lock className="size-3.5" /> Close
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CloseDialog period={closing} onClose={() => setClosing(null)}
        onClosed={() => { setClosing(null); periodsQ.refetch(); }} />
    </>
  );
}

function CloseDialog({ period, onClose, onClosed }: {
  period: FinancialPeriod | null;
  onClose: () => void;
  onClosed: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (!supabase || !period) return;
    setBusy(true); setError(null);
    try {
      await closeFinancialPeriod(supabase, period.id, note);
      setNote('');
      onClosed();
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={period !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close {period?.name}</DialogTitle>
          <DialogDescription>
            Nothing can be posted into a closed period, and nothing already in it can be moved
            out. The database checks first that no pay application inside it is still open —
            closing over one would fix a total that is still going to move.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {period && period.openPayApplications > 0 ? (
            <Alert tone="warn" title="This will be refused">
              {plural(period.openPayApplications, 'pay application')} inside this period
              {period.openPayApplications === 1 ? ' is' : ' are'} still in draft or submitted.
              Approve or withdraw {period.openPayApplications === 1 ? 'it' : 'them'} first.
            </Alert>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="close-note">Note</Label>
            <Input id="close-note" value={note}
              placeholder="Month end, reviewed with the controller"
              onChange={(e) => setNote(e.target.value)} />
            <p className="text-xs text-charcoal-500">Optional, and kept with the period.</p>
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void go()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
            Close the period
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
