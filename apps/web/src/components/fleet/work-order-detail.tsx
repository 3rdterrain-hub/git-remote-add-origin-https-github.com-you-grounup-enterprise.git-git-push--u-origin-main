/**
 * A work order after it is opened.
 *
 * `create_work_order` (0161) was the whole of it. A machine could be reported
 * broken and never reported fixed, so every work order ever raised on this
 * platform stayed open, the count on the Fleet page only ever went up, and
 * downtime was zero on every machine because nothing could record any.
 *
 * Completing is separate from editing, on screen as in the database, because it
 * needs something editing does not: a resolution. "Complete" with no resolution
 * tells the next mechanic nothing, and the next mechanic is why the record
 * exists.
 */
import { useState } from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { messageFor } from '@/lib/data/query';
import {
  updateWorkOrder, completeWorkOrder, cancelWorkOrder, type WorkOrderRow,
} from '@/lib/data/fleet';
import { money } from '@/lib/format';

const field = 'h-9 rounded-md border border-charcoal-200 bg-white px-2 text-sm';

const OPEN_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'awaiting_parts', label: 'Waiting on parts' },
];

export function WorkOrderDetail({ order, canWrite, onChanged, onClose }: {
  order: WorkOrderRow;
  canWrite: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const closed = order.status === 'complete' || order.status === 'canceled';

  const [resolution, setResolution] = useState(order.resolution ?? '');
  const [labor, setLabor] = useState(String(order.laborCost || ''));
  const [parts, setParts] = useState(String(order.partsCost || ''));
  const [outside, setOutside] = useState(String(order.outsideCost || ''));
  const [downtime, setDowntime] = useState(String(order.downtimeHours || ''));
  const [meterHours, setMeterHours] = useState('');
  const [canceling, setCanceling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await work(); onChanged(); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  const total = (Number(labor) || 0) + (Number(parts) || 0) + (Number(outside) || 0);

  if (closed) {
    return (
      <div className="space-y-2 border-t border-charcoal-200 bg-charcoal-50/70 p-4">
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-charcoal-600">
            {order.number} · {order.status === 'complete' ? 'Complete' : 'Canceled'}
          </h4>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        <p className="text-sm text-charcoal-700">{order.resolution ?? '—'}</p>
        <p className="text-xs text-charcoal-500">
          A closed work order is not reopened. Raise a new one, so the machine&rsquo;s history
          reads as what actually happened rather than as one record edited twice.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 border-t border-charcoal-200 bg-charcoal-50/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-xs font-medium uppercase tracking-wide text-charcoal-600">
          {order.number} · {order.title}
        </h4>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>

      {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1">
          <Label htmlFor={`ws-${order.id}`}>Where it stands</Label>
          <select id={`ws-${order.id}`} className={`${field} w-full`} value={order.status}
            disabled={!canWrite || busy}
            onChange={(e) => run(() => updateWorkOrder({
              workOrderId: order.id, status: e.target.value,
            }))}>
            {OPEN_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`wl-${order.id}`}>Labor</Label>
          <Input id={`wl-${order.id}`} type="number" value={labor} disabled={!canWrite}
            onChange={(e) => setLabor(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`wp-${order.id}`}>Parts</Label>
          <Input id={`wp-${order.id}`} type="number" value={parts} disabled={!canWrite}
            onChange={(e) => setParts(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`wo-${order.id}`}>Outside</Label>
          <Input id={`wo-${order.id}`} type="number" value={outside} disabled={!canWrite}
            onChange={(e) => setOutside(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`wd-${order.id}`}>Hours down</Label>
          <Input id={`wd-${order.id}`} type="number" value={downtime} disabled={!canWrite}
            onChange={(e) => setDowntime(e.target.value)} />
        </div>
      </div>

      <p className="text-xs text-charcoal-500">
        {money(total)} so far. The three are kept apart because they answer different
        questions: the shop&rsquo;s own time, what was bought, and what was sent out.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`wr-${order.id}`}>What was done</Label>
          <Input id={`wr-${order.id}`} value={resolution} disabled={!canWrite}
            placeholder="Oil, filters and a hydraulic hose"
            onChange={(e) => setResolution(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`wm-${order.id}`}>Meter at completion</Label>
          <Input id={`wm-${order.id}`} type="number" value={meterHours} disabled={!canWrite}
            onChange={(e) => setMeterHours(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!canWrite || busy}
          onClick={() => run(() => updateWorkOrder({
            workOrderId: order.id,
            laborCost: Number(labor) || 0,
            partsCost: Number(parts) || 0,
            outsideCost: Number(outside) || 0,
            downtimeHours: Number(downtime) || 0,
          }))}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save the costs
        </Button>
        <Button size="sm" disabled={!canWrite || busy || resolution.trim().length < 3}
          title={resolution.trim().length < 3
            ? 'Say what was done — the next person to open this machine reads this and nothing else'
            : undefined}
          onClick={() => run(async () => {
            await completeWorkOrder({
              workOrderId: order.id,
              resolution,
              laborCost: Number(labor) || 0,
              partsCost: Number(parts) || 0,
              outsideCost: Number(outside) || 0,
              downtimeHours: Number(downtime) || 0,
              meterHours: meterHours ? Number(meterHours) : null,
            });
            onClose();
          })}>
          <CheckCircle2 className="size-4" /> Complete it
        </Button>
        {!canceling ? (
          <Button size="sm" variant="ghost" className="text-danger-700"
            disabled={!canWrite} onClick={() => setCanceling(true)}>
            <XCircle className="size-4" /> Cancel it
          </Button>
        ) : null}
      </div>

      {canceling ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={`wc-${order.id}`}>Why it is being canceled</Label>
            <Input id={`wc-${order.id}`} value={cancelReason} className="w-72" autoFocus
              placeholder="Raised against the wrong machine"
              onChange={(e) => setCancelReason(e.target.value)} />
          </div>
          <Button size="sm" variant="ghost" className="text-danger-700"
            disabled={busy || cancelReason.trim().length < 3}
            onClick={() => run(async () => {
              await cancelWorkOrder(order.id, cancelReason);
              onClose();
            })}>
            Cancel the work order
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCanceling(false)}>Keep it</Button>
        </div>
      ) : null}

      <p className="text-xs text-charcoal-500">
        A meter reading entered at completion resets a preventive interval from exactly that
        number — the mechanic standing at the machine is the person best placed to read it.
      </p>
    </div>
  );
}
