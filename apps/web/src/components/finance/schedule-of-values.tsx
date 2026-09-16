/**
 * The schedule of values. WORKFLOW.
 *
 * The spine of every pay application: the contracted breakdown the billing is
 * measured against. `schedule_of_values` had no writer at all (O-020), so every
 * application this platform could open was a header measured against nothing,
 * and the pay-application tab said so — "add the schedule to the project and the
 * lines appear here" — with no way to add it.
 *
 * It is built from the estimate rather than retyped. A number is entered once:
 * the estimate already holds a priced breakdown, `source_line_item_id` exists on
 * this table for exactly that, and retyping the bid into a billing schedule is
 * how the bill stops agreeing with the bid.
 */
import { useState } from 'react';
import { Loader2, ListTree, Plus, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, EmptyState } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { LoadingState, ErrorState } from '@/components/data-state';
import { messageFor, useQuery } from '@/lib/data/query';
import {
  loadScheduleOfValues, buildSovFromEstimate, addSovItem, updateSovItem, removeSovItem,
} from '@/lib/data/finance';
import { money, percent } from '@/lib/format';

export function ScheduleOfValues({ projectId, projectLabel, contractValue, canWrite }: {
  projectId: string;
  projectLabel: string;
  contractValue: number | null;
  canWrite: boolean;
}) {
  const [nonce, setNonce] = useState(0);
  const itemsQ = useQuery(loadScheduleOfValues(projectId), [projectId, nonce]);
  const items = itemsQ.status === 'ready' ? itemsQ.data : [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [itemNumber, setItemNumber] = useState('');
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const again = () => setNonce((n) => n + 1);
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await fn(); again(); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  const total = items.reduce((a, i) => a + i.scheduledValue, 0);
  const billed = items.reduce((a, i) => a + i.billedToDate, 0);
  /*
   * Stated rather than refused. A schedule of values that does not add up to the
   * contract is often correct mid-negotiation, and a screen that blocks on it
   * would be wrong more often than the person using it.
   */
  const difference = contractValue === null ? null : total - contractValue;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ListTree className="size-4" /> Schedule of values
          </CardTitle>
          <CardDescription>
            {projectLabel} · what every pay application is measured against. Billing past an
            item is a claim the owner will reject, so it is refused here rather than at their desk.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          {items.length === 0 ? (
            <Button variant="outline" size="sm" disabled={!canWrite || busy}
              title={canWrite ? 'Build it from the estimate this project was awarded on'
                : 'Needs permission to change the billing schedule'}
              onClick={() => { void run(() => buildSovFromEstimate(projectId)); }}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              Build it from the estimate
            </Button>
          ) : null}
          <Button variant="outline" size="sm" disabled={!canWrite}
            onClick={() => setAdding((v) => !v)}
            title={canWrite ? undefined : 'Needs permission to change the billing schedule'}>
            <Plus className="size-4" /> Add an item
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 p-0">
        {adding ? (
          <div className="mx-6 grid gap-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3 sm:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="sov-num">Item</Label>
              <Input id="sov-num" value={itemNumber} autoFocus placeholder="004"
                onChange={(e) => setItemNumber(e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="sov-desc">Description</Label>
              <Input id="sov-desc" value={description} placeholder="Temporary fencing"
                onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sov-val">Scheduled value</Label>
              <Input id="sov-val" type="number" value={value} placeholder="0"
                onChange={(e) => setValue(e.target.value)} />
            </div>
            <div className="sm:col-span-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
              <Button size="sm" disabled={busy || !itemNumber.trim() || !description.trim()}
                onClick={() => {
                  void run(async () => {
                    await addSovItem(projectId, {
                      itemNumber, description, scheduledValue: Number(value || 0),
                    });
                    setItemNumber(''); setDescription(''); setValue(''); setAdding(false);
                  });
                }}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null} Add it
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="px-6"><Alert tone="danger" title="That did not happen">{error}</Alert></div>
        ) : null}

        {itemsQ.status === 'loading' ? <LoadingState label="Reading the schedule" /> : null}
        {itemsQ.status === 'error'
          ? <ErrorState message={itemsQ.message} onRetry={itemsQ.refetch} /> : null}
        {itemsQ.status === 'ready' && items.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No schedule of values on this project"
              description="Build it from the estimate the job was awarded on, or add the items the owner agreed to. Until it exists, a pay application has nothing to bill against." />
          </div>
        ) : null}

        {items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Item</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Scheduled value</TableHead>
                <TableHead className="text-right">Billed to date</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-mono text-xs text-charcoal-500">{i.itemNumber}</TableCell>
                  <TableCell>
                    <span className="font-medium text-charcoal-900">{i.description}</span>
                    {i.fromTheEstimate ? (
                      <Badge variant="outline" className="ml-2 text-[10px]"
                        title="Carried from the estimate this project was awarded on">
                        from the estimate
                      </Badge>
                    ) : null}
                    {i.costCode ? (
                      <span className="ml-2 font-mono text-xs text-charcoal-400">{i.costCode}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {/*
                      * Editable where it is shown, until something has been
                      * billed against it — after that the database refuses, and
                      * the reason is that a change in scope is a change order.
                      */}
                    {editing === i.id ? (
                      <Input type="number" value={editValue} autoFocus className="h-8 text-right"
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => {
                          const next = Number(editValue);
                          setEditing(null);
                          if (Number.isFinite(next) && next !== i.scheduledValue) {
                            void run(() => updateSovItem(i.id, { scheduledValue: next }));
                          }
                        }} />
                    ) : (
                      <button type="button" disabled={!canWrite}
                        className="hover:underline disabled:cursor-default disabled:no-underline"
                        title={canWrite ? 'Change the scheduled value' : undefined}
                        onClick={() => { setEditing(i.id); setEditValue(String(i.scheduledValue)); }}>
                        {money(i.scheduledValue)}
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {i.billedToDate ? money(i.billedToDate) : '—'}
                  </TableCell>
                  <TableCell className="tabular text-right text-charcoal-600">
                    {i.scheduledValue ? percent(i.billedToDate / i.scheduledValue, 0) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {canWrite && i.billedToDate === 0 ? (
                      <button type="button" className="text-charcoal-400 hover:text-danger-700"
                        title="Remove this item"
                        onClick={() => { void run(() => removeSovItem(i.id)); }}>
                        <Trash2 className="size-3.5" />
                      </button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="hover:bg-charcoal-50">
                <TableCell colSpan={2}>
                  Totals
                  {difference !== null && Math.abs(difference) > 0.005 ? (
                    <span className="ml-2 text-xs text-warn-700">
                      {difference > 0 ? 'over' : 'under'} the contract by {money(Math.abs(difference))}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="tabular text-right">{money(total)}</TableCell>
                <TableCell className="tabular text-right">{money(billed)}</TableCell>
                <TableCell className="tabular text-right">
                  {total ? percent(billed / total, 0) : '—'}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
