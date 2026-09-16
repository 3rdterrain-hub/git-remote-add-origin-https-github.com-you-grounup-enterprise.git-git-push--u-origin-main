/**
 * A machine, opened.
 *
 * Everything about one machine that somebody in a yard actually changes, in one
 * place under its own row: what the meter reads, what services it is on, where
 * it is and who is running it, whether it is down, and eventually that it is
 * gone.
 *
 * The meter is first because everything else is measured from it, and because
 * before migration 0186 nothing anywhere could record one. Every machine's
 * hours stood at whatever they were typed in as, no interval could ever come
 * due, and `notify_maintenance_due` — written in 0038 — had never once fired.
 */
import { useState } from 'react';
import { Gauge, Wrench, Loader2, Trash2, Plus, CircleOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  loadAssetServices, loadAssetMeter, recordMeterReading, setMaintenanceSchedule,
  retireMaintenanceSchedule, updateAsset, setAssetStatus, disposeAsset,
  type AssetRow,
} from '@/lib/data/fleet';
import { qty, date, dateTime, plural } from '@/lib/format';

const field = 'h-9 rounded-md border border-charcoal-200 bg-white px-2 text-sm';

const STATUSES = [
  { value: 'available', label: 'Available' },
  { value: 'assigned', label: 'On a job' },
  { value: 'in_maintenance', label: 'In the shop' },
  { value: 'down', label: 'Down' },
  { value: 'rented_out', label: 'Rented out' },
];

export function AssetDetail({ asset, canWrite, onChanged, onClose }: {
  asset: AssetRow;
  canWrite: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [nonce, setNonce] = useState(0);
  const servicesQ = useQuery(loadAssetServices(asset.id), [asset.id, nonce]);
  const meterQ = useQuery(loadAssetMeter(asset.id), [asset.id, nonce]);
  const services = servicesQ.status === 'ready' ? servicesQ.data : [];
  const meter = meterQ.status === 'ready' ? meterQ.data : null;

  const [reading, setReading] = useState('');
  const [replacement, setReplacement] = useState(false);

  const [serviceName, setServiceName] = useState('');
  const [serviceHours, setServiceHours] = useState('');
  const [addingService, setAddingService] = useState(false);

  const [name, setName] = useState(asset.name);
  const [serial, setSerial] = useState(asset.serialNumber ?? '');
  const [home, setHome] = useState(asset.location ?? '');

  const [disposing, setDisposing] = useState(false);
  const [disposedOn, setDisposedOn] = useState('');
  const [disposalNote, setDisposalNote] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await work(); setNonce((n) => n + 1); onChanged(); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  const hoursRun = meter && meter.hours30DaysAgo !== null
    ? meter.currentHours - meter.hours30DaysAgo : null;

  return (
    <div className="space-y-5 border-t border-charcoal-200 bg-charcoal-50/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-xs font-medium uppercase tracking-wide text-charcoal-600">
          {asset.assetNumber} · {asset.name}
        </h4>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>

      {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

      {/* The meter */}
      <div className="space-y-2">
        <h5 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-charcoal-600">
          <Gauge className="size-3.5" /> The meter
        </h5>
        {meterQ.status === 'loading' ? <LoadingState label="Reading the meter" /> : null}
        {meter ? (
          <p className="text-sm text-charcoal-600">
            {qty(meter.currentHours, 0)} hours
            {meter.lastReadingAt ? `, last read ${dateTime(meter.lastReadingAt)}` : ', never read'}
            {hoursRun !== null
              ? ` · ${qty(hoursRun, 0)} hours run in the last thirty days`
              : ' · no reading inside the last thirty days, so hours run cannot be said'}
            {meter.downtime30Days > 0
              ? ` · ${qty(meter.downtime30Days, 0)} hours down` : ''}
          </p>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={`m-${asset.id}`}>Meter now</Label>
            <Input id={`m-${asset.id}`} type="number" className="w-36" value={reading}
              onChange={(e) => setReading(e.target.value)} disabled={!canWrite} />
          </div>
          <label className="flex h-9 items-center gap-2 text-sm text-charcoal-700">
            <input type="checkbox" checked={replacement} disabled={!canWrite}
              onChange={(e) => setReplacement(e.target.checked)} />
            The meter was replaced
          </label>
          <Button size="sm" variant="outline" disabled={!canWrite || busy || !reading}
            onClick={() => run(async () => {
              await recordMeterReading({
                assetId: asset.id, hours: Number(reading), isReplacement: replacement,
              });
              setReading(''); setReplacement(false);
            })}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Record it
          </Button>
        </div>
        <p className="text-xs text-charcoal-500">
          A reading below the current meter is refused unless the unit was replaced, because
          a machine cannot un-run hours — and a low reading accepted quietly would write off
          the service history it is measured against.
        </p>
      </div>

      {/* Services */}
      <div className="space-y-2">
        <h5 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-charcoal-600">
          <Wrench className="size-3.5" /> Services
        </h5>
        {servicesQ.status === 'error'
          ? <ErrorState message={servicesQ.message} onRetry={servicesQ.refetch} /> : null}
        {services.length === 0 ? (
          <p className="text-sm text-charcoal-500">
            None set. A machine with no interval never comes due, which is not the same as
            a machine that needs nothing.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {services.map((s) => (
              <li key={s.scheduleId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-charcoal-900">{s.name}</span>
                {s.intervalHours ? (
                  <span className="text-xs text-charcoal-500">
                    every {qty(s.intervalHours, 0)} h
                  </span>
                ) : null}
                {s.hoursRemaining !== null ? (
                  <Badge variant="outline"
                    className={s.hoursRemaining < 0 ? 'border-danger-300 text-danger-700'
                      : s.hoursRemaining <= 50 ? 'border-yellow-300 text-yellow-700' : ''}>
                    {s.hoursRemaining < 0
                      ? `${qty(Math.abs(s.hoursRemaining), 0)} h overdue`
                      : `${qty(s.hoursRemaining, 0)} h to go`}
                  </Badge>
                ) : null}
                {s.lastPerformedAt ? (
                  <span className="text-xs text-charcoal-500">
                    last done {date(s.lastPerformedAt)}
                  </span>
                ) : null}
                {s.openWorkOrders > 0 ? (
                  <span className="text-xs text-charcoal-500">
                    {plural(s.openWorkOrders, 'work order')} open
                  </span>
                ) : null}
                <Button variant="ghost" size="sm" className="text-danger-700"
                  aria-label={`Stop watching ${s.name}`} disabled={!canWrite || busy}
                  onClick={() => run(() => retireMaintenanceSchedule(s.scheduleId))}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {canWrite && addingService ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor={`sn-${asset.id}`}>What it is</Label>
              <Input id={`sn-${asset.id}`} value={serviceName} autoFocus
                placeholder="250-hour service" className="w-56"
                onChange={(e) => setServiceName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`sh-${asset.id}`}>Every (hours)</Label>
              <Input id={`sh-${asset.id}`} type="number" className="w-32" value={serviceHours}
                onChange={(e) => setServiceHours(e.target.value)} />
            </div>
            <Button size="sm" variant="outline"
              disabled={busy || !serviceName.trim() || !serviceHours}
              onClick={() => run(async () => {
                await setMaintenanceSchedule({
                  assetId: asset.id, name: serviceName, intervalHours: Number(serviceHours),
                });
                setServiceName(''); setServiceHours(''); setAddingService(false);
              })}>
              <Plus className="size-4" /> Add it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAddingService(false)}>Cancel</Button>
          </div>
        ) : canWrite ? (
          <Button size="sm" variant="outline" onClick={() => setAddingService(true)}>
            <Plus className="size-4" /> Add a service
          </Button>
        ) : null}
        {services.length > 0 ? (
          <p className="text-xs text-charcoal-500">
            The first one is measured from the meter as it stands now, so a machine with
            four thousand hours on it is not instantly sixteen services overdue.
          </p>
        ) : null}
      </div>

      {/* The machine itself */}
      <div className="space-y-2">
        <h5 className="text-xs font-medium uppercase tracking-wide text-charcoal-600">
          The machine
        </h5>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor={`an-${asset.id}`}>Name</Label>
            <Input id={`an-${asset.id}`} value={name} disabled={!canWrite}
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`as-${asset.id}`}>Serial number</Label>
            <Input id={`as-${asset.id}`} value={serial} disabled={!canWrite}
              onChange={(e) => setSerial(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`ah-${asset.id}`}>Home yard</Label>
            <Input id={`ah-${asset.id}`} value={home} disabled={!canWrite}
              onChange={(e) => setHome(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`at-${asset.id}`}>Status</Label>
            <select id={`at-${asset.id}`} className={`${field} w-full`} value={asset.status}
              disabled={!canWrite || busy}
              onChange={(e) => run(() => setAssetStatus(asset.id, e.target.value))}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!canWrite || busy}
            onClick={() => run(() => updateAsset({
              assetId: asset.id, name, serialNumber: serial, homeLocation: home,
            }))}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save the machine
          </Button>
          {!disposing ? (
            <Button size="sm" variant="ghost" className="text-danger-700"
              disabled={!canWrite} onClick={() => setDisposing(true)}>
              <CircleOff className="size-4" /> Take it off the books
            </Button>
          ) : null}
        </div>

        {disposing ? (
          <div className="space-y-2 rounded-md border border-danger-200 bg-danger-50/40 p-3">
            <p className="text-sm text-charcoal-700">
              Disposing of a machine takes it out of every list and report at once, and needs
              the date because those reports are read by period. Open work orders are refused
              first, so their cost lands before the machine leaves.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor={`dd-${asset.id}`}>Gone on</Label>
                <Input id={`dd-${asset.id}`} type="date" value={disposedOn}
                  onChange={(e) => setDisposedOn(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`dn-${asset.id}`}>What happened to it</Label>
                <Input id={`dn-${asset.id}`} value={disposalNote} className="w-64"
                  placeholder="Sold at auction, traded in, written off"
                  onChange={(e) => setDisposalNote(e.target.value)} />
              </div>
              <Button size="sm" variant="ghost" className="text-danger-700"
                disabled={busy || !disposedOn}
                onClick={() => run(async () => {
                  await disposeAsset(asset.id, disposedOn, disposalNote);
                  setDisposing(false); onClose();
                })}>
                Dispose of it
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDisposing(false)}>Cancel</Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
