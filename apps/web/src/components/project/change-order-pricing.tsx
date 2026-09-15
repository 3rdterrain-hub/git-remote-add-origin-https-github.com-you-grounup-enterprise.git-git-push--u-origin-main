/**
 * What a change order is worth.
 *
 * `change_orders.cost_impact` and `price_impact` have existed since migration
 * 0007 under a comment reading "Priced by the same deterministic engine as the
 * base estimate", and `change_order_items` since 0013 with row level security,
 * a tenant trigger and an index. Nothing ever wrote an item, so **every change
 * order this platform raised was worth $0.00, permanently** — and a change
 * order at zero does not look broken. It looks like one nobody has priced yet,
 * on a screen that offered no way to price it, while rolling into the revised
 * contract value as a real zero.
 *
 * Cost and price are asked separately because they are separate questions. The
 * cost is what the work takes; the price is what the owner is asked for; the
 * gap is the margin on the change, and it is the number that disappears when
 * only a total is shown.
 */
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  loadChangeOrderItems, addChangeOrderItem, removeChangeOrderItem,
} from '@/lib/data/project';
import { money, qty } from '@/lib/format';

export function ChangeOrderPricing({ changeOrderId, status, editable, onChanged }: {
  changeOrderId: string;
  status: string;
  editable: boolean;
  onChanged: () => void;
}) {
  const itemsQ = useQuery(loadChangeOrderItems(changeOrderId), [changeOrderId]);
  const rows = itemsQ.status === 'ready' ? itemsQ.data : [];
  const cost = rows.reduce((a, r) => a + r.costAmount, 0);
  const price = rows.reduce((a, r) => a + r.priceAmount, 0);

  /* Approved and executed are the amendment; the database refuses either way. */
  const open = status !== 'approved' && status !== 'executed'
    && status !== 'rejected' && status !== 'withdrawn';

  const [adding, setAdding] = useState(false);
  const [description, setDescription] = useState('');
  const [costAmount, setCostAmount] = useState('');
  const [priceAmount, setPriceAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!supabase || busy) return;
    setBusy(true); setError(null);
    try {
      await addChangeOrderItem(supabase, {
        changeOrderId,
        description,
        costAmount: Number(costAmount),
        priceAmount: priceAmount.trim() ? Number(priceAmount) : null,
      });
      setAdding(false); setDescription(''); setCostAmount(''); setPriceAmount('');
      itemsQ.refetch();
      onChanged();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  const drop = async (id: string) => {
    if (!supabase || busy) return;
    setBusy(true); setError(null);
    try {
      await removeChangeOrderItem(supabase, id);
      itemsQ.refetch();
      onChanged();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <h4 className="text-xs font-medium uppercase tracking-wide text-charcoal-600">
        What it is worth
      </h4>

      {itemsQ.status === 'loading' ? <LoadingState label="Reading the lines" /> : null}
      {itemsQ.status === 'error'
        ? <ErrorState message={itemsQ.message} onRetry={itemsQ.refetch} /> : null}

      {itemsQ.status === 'ready' && rows.length === 0 && !adding ? (
        <EmptyState title="Nothing priced on this change order"
          hint="It counts as zero against the contract until it is priced." />
      ) : null}

      {rows.length > 0 ? (
        <>
          <ul className="space-y-1">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2
                                        text-xs">
                <span className="min-w-0 text-charcoal-700">
                  {r.description}
                  {r.quantity > 0 ? (
                    <span className="ml-2 text-charcoal-500">
                      {qty(r.quantity)} {r.unit ?? ''} at {money(r.unitPrice)}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="tabular text-charcoal-500">{money(r.costAmount)} cost</span>
                  <span className="tabular text-charcoal-900">{money(r.priceAmount)}</span>
                  {editable && open ? (
                    <button type="button" disabled={busy}
                      aria-label={`Remove ${r.description}`}
                      onClick={() => void drop(r.id)}
                      className="rounded p-0.5 text-charcoal-400
                                 hover:bg-danger-50 hover:text-danger-700">
                      <Trash2 className="size-3" aria-hidden />
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between gap-2 border-t
                          border-charcoal-200 pt-1.5 text-xs font-medium">
            <span className="text-charcoal-600">
              {money(cost)} cost · {money(price - cost)} margin
            </span>
            <span className="tabular text-charcoal-900">{money(price)}</span>
          </div>
        </>
      ) : null}

      {error ? <Alert tone="danger" title="That could not be saved">{error}</Alert> : null}

      {editable && open && !adding ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="mr-1.5 size-3.5" aria-hidden /> Price a line
        </Button>
      ) : null}

      {!open && rows.length > 0 ? (
        <p className="text-xs text-charcoal-500">
          This change order is {status}. Its lines are the amendment and cannot change —
          raise a new one instead.
        </p>
      ) : null}

      {editable && open && adding ? (
        <div className="space-y-2 rounded-md border border-charcoal-200 bg-white p-3">
          <div className="space-y-1.5">
            <Label htmlFor={`d-${changeOrderId}`}>What the line is for</Label>
            <Input id={`d-${changeOrderId}`} value={description}
              placeholder="Rock excavation, north basin"
              onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`c-${changeOrderId}`}>What it costs us</Label>
              <Input id={`c-${changeOrderId}`} type="number" step="0.01" value={costAmount}
                onChange={(e) => setCostAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`p-${changeOrderId}`}>What the owner is asked</Label>
              <Input id={`p-${changeOrderId}`} type="number" step="0.01" value={priceAmount}
                onChange={(e) => setPriceAmount(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-charcoal-500">
            Leave the price blank to do the work at cost. That is a decision worth being
            able to see, which is why it is not a silent zero.
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm"
              disabled={busy || !description.trim() || !costAmount.trim()}
              onClick={() => void add()}>Add the line</Button>
            <Button type="button" size="sm" variant="ghost"
              onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
