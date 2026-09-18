/**
 * Saying how fast this company does a task. WORKFLOW.
 *
 * 2,143 shipped rates and no way to add one, so a contractor who knows their
 * crew trenches 140 feet an hour — not the 120 the seed guessed — had nowhere
 * to put it. That figure is the one an estimate lives or dies on.
 *
 * Stored as `estimator_judgment`, and the screen says so. It is deliberately
 * *not* `company_actual`: that value means the field measured it, and only a
 * reported day's production against a budgeted task earns it. Calling a typed
 * figure measured would make it outrank a regional benchmark everywhere the
 * source is read, and quietly raise the confidence of every estimate priced
 * from it.
 */
import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { messageFor, useQuery } from '@/lib/data/query';
import { createProductionRate, loadTasks, UNITS } from '@/lib/data/library';
import { qty } from '@/lib/format';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

export function AddProductionRate({ companyId, canWrite, onAdded }: {
  companyId: string | null;
  canWrite: boolean;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const tasksQ = useQuery(loadTasks, [open]);
  const tasks = tasksQ.status === 'ready' ? tasksQ.data : [];

  const [taskId, setTaskId] = useState('');
  const [perHour, setPerHour] = useState('');
  const [unit, setUnit] = useState('CY');
  const [utilization, setUtilization] = useState('0.83');
  const [shift, setShift] = useState('8');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const task = tasks.find((t) => t.id === taskId) ?? null;
  const rate = Number(perHour || 0);
  const perShift = rate * Number(utilization || 0) * Number(shift || 0);
  const ready = companyId !== null && taskId !== '' && rate > 0;

  if (!open) {
    return (
      <Button size="sm" disabled={!canWrite || !companyId}
        title={canWrite ? undefined : 'Needs permission to write the libraries'}
        onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add a production rate
      </Button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1 lg:col-span-2">
          <Label htmlFor="pr-task">For which task</Label>
          <select id="pr-task" className={field} value={taskId}
            onChange={(e) => {
              setTaskId(e.target.value);
              const t = tasks.find((x) => x.id === e.target.value);
              /* The task's own unit is the sensible default — a trench is
                 measured in feet whoever is digging it. */
              if (t?.defaultUnit) setUnit(t.defaultUnit);
            }}>
            <option value="">Choose a task…</option>
            {tasks.slice(0, 500).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pr-rate">How much an hour</Label>
          <Input id="pr-rate" type="number" step="0.1" min="0" value={perHour} placeholder="140"
            onChange={(e) => setPerHour(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pr-unit">Measured in</Label>
          <select id="pr-unit" className={field} value={unit}
            onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pr-util">Utilization</Label>
          <Input id="pr-util" type="number" step="0.01" min="0.01" max="1" value={utilization}
            onChange={(e) => setUtilization(e.target.value)} />
          <p className="text-xs text-charcoal-500">Fifty working minutes is 0.83.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="pr-shift">Hours in a shift</Label>
          <Input id="pr-shift" type="number" step="0.5" min="1" max="24" className="w-28"
            value={shift} onChange={(e) => setShift(e.target.value)} />
        </div>
        {rate > 0 ? (
          <p className="pb-1.5 text-sm text-charcoal-600">
            That is <strong>{qty(perShift, 0)} {unit}</strong> in a shift
            {task ? ` of ${task.name.toLowerCase()}` : ''} — the rate, times utilization,
            times the shift.
          </p>
        ) : null}
      </div>

      <Alert tone="info" title="Recorded as your judgment, not as a measurement">
        This is what somebody here says the work goes at. It is kept apart from a rate the
        field actually produced, because a figure that claims to be measured outranks one
        that does not — and raises the confidence of every estimate priced from it.
      </Alert>

      {error ? <Alert tone="danger" title="That rate was not added">{error}</Alert> : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" disabled={!ready || busy}
          title={ready ? undefined : 'A task and a rate above zero'}
          onClick={() => {
            if (!companyId) return;
            setBusy(true); setError(null);
            createProductionRate(companyId, {
              taskId,
              ratePerHour: rate,
              rateUnit: unit,
              utilizationFactor: Number(utilization || 0.83),
              shiftHours: Number(shift || 8),
            })
              .then(() => {
                setTaskId(''); setPerHour(''); setUtilization('0.83'); setShift('8');
                setOpen(false); onAdded();
              })
              .catch((e: unknown) => setError(messageFor(e)))
              .finally(() => setBusy(false));
          }}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Add it
        </Button>
      </div>
    </div>
  );
}
