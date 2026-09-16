/**
 * What a purchase order is actually for.
 *
 * `purchase_order_items` had no writer, so every order was worth $0.00 at the
 * moment it was issued — and migration 0037 checks the company's signing limit
 * against exactly that figure as the order crosses into `issued`. A limit
 * checked against zero passes for every order whatever it is really worth, so
 * the one commercial control on the commitment a contractor makes most often
 * was inert.
 *
 * Lines can be changed while the order is a draft and not afterwards: once it
 * is issued the vendor holds a document the company is bound by, and editing it
 * is how a commitment and the approval on it stop describing the same thing.
 */
import { useState } from 'react';
import { Loader2, Plus, Trash2, PackageCheck, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  loadPurchaseOrderItems, addPurchaseOrderItem, removePurchaseOrderItem,
  issuePurchaseOrder, receivePurchaseOrderItem,
} from '@/lib/data/procurement';
import { money, qty } from '@/lib/format';

export function PurchaseOrderLines({ purchaseOrderId, status, canWrite, onChanged }: {
  purchaseOrderId: string;
  status: string;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [nonce, setNonce] = useState(0);
  const itemsQ = useQuery(loadPurchaseOrderItems(purchaseOrderId), [purchaseOrderId, nonce]);
  const items = itemsQ.status === 'ready' ? itemsQ.data : [];

  const draft = status === 'draft';
  const receivable = status === 'issued' || status === 'partially_received';

  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const committed = items.reduce((a, i) => a + i.extended, 0);

  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await work(); setNonce((n) => n + 1); onChanged(); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3 border-t border-charcoal-200 bg-charcoal-50/70 p-4">
      <h4 className="text-xs font-medium uppercase tracking-wide text-charcoal-600">
        What it is for
      </h4>

      {itemsQ.status === 'loading' ? <LoadingState label="Reading the lines" /> : null}
      {itemsQ.status === 'error'
        ? <ErrorState message={itemsQ.message} onRetry={itemsQ.refetch} /> : null}

      {items.length === 0 && itemsQ.status === 'ready' ? (
        <p className="text-sm text-charcoal-500">
          Nothing on it, so it commits you to nothing. An order with no lines cannot be
          reconciled against a delivery and cannot be issued.
        </p>
      ) : null}

      {items.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Line</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Unit price</TableHead>
              <TableHead className="text-right">Extended</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <p className="font-medium text-charcoal-900">{i.description}</p>
                  {i.costCode ? (
                    <p className="font-mono text-xs text-charcoal-500">{i.costCode}</p>
                  ) : null}
                </TableCell>
                <TableCell className="tabular text-right">
                  {qty(i.quantity, 2)} {i.unit ?? ''}
                </TableCell>
                <TableCell className="tabular text-right text-charcoal-600">
                  {money(i.unitPrice)}
                </TableCell>
                <TableCell className="tabular text-right font-medium">
                  {money(i.extended)}
                </TableCell>
                <TableCell className="tabular text-right">
                  {qty(i.quantityReceived, 2)}
                  {i.quantityOutstanding > 0 ? (
                    <span className="block text-xs text-charcoal-500">
                      {qty(i.quantityOutstanding, 2)} to come
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right">
                  {draft && canWrite ? (
                    <Button variant="ghost" size="sm" className="text-danger-700"
                      aria-label={`Remove ${i.description}`} disabled={busy}
                      onClick={() => run(() => removePurchaseOrderItem(i.id))}>
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                  {receivable && canWrite && i.quantityOutstanding > 0 ? (
                    <Button variant="outline" size="sm" disabled={busy}
                      onClick={() => {
                        const said = window.prompt(
                          `How much of "${i.description}" arrived? `
                          + `${qty(i.quantityOutstanding, 2)} still outstanding.`);
                        const amount = Number(said);
                        if (!said || !Number.isFinite(amount) || amount <= 0) return;
                        void run(() => receivePurchaseOrderItem(i.id, amount));
                      }}>
                      <PackageCheck className="size-4" /> Receive
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

      {draft && canWrite ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1 lg:col-span-2">
            <Label htmlFor={`pd-${purchaseOrderId}`}>What it is</Label>
            <Input id={`pd-${purchaseOrderId}`} value={description}
              placeholder="Crushed stone 304"
              onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`pq-${purchaseOrderId}`}>How much</Label>
            <Input id={`pq-${purchaseOrderId}`} type="number" value={quantity}
              onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`pu-${purchaseOrderId}`}>Unit</Label>
            <Input id={`pu-${purchaseOrderId}`} value={unit} placeholder="TON"
              onChange={(e) => setUnit(e.target.value.toUpperCase())} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`pp-${purchaseOrderId}`}>Unit price</Label>
            <Input id={`pp-${purchaseOrderId}`} type="number" step="0.01" value={price}
              onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="flex items-end lg:col-span-5">
            <Button size="sm" variant="outline"
              disabled={busy || !description.trim() || !quantity || !price}
              onClick={() => run(async () => {
                await addPurchaseOrderItem({
                  purchaseOrderId,
                  description,
                  quantity: Number(quantity),
                  unitPrice: Number(price),
                  unit: unit || null,
                });
                setDescription(''); setQuantity(''); setUnit(''); setPrice('');
              })}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Add the line
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-medium text-charcoal-900">
          Committed {money(committed)}
        </p>
        {draft && canWrite ? (
          <Button size="sm" disabled={busy || items.length === 0}
            onClick={() => run(() => issuePurchaseOrder(purchaseOrderId))}>
            <Send className="size-4" /> Issue it
          </Button>
        ) : null}
        {draft ? (
          <span className="text-xs text-charcoal-500">
            Issuing checks this against your signing limit — which is what the limit is for,
            and what it could never see while an order was worth nothing.
          </span>
        ) : null}
      </div>
    </div>
  );
}
