/**
 * A fuel ticket, and what looks wrong with it.
 *
 * `fuel_transactions.exception_flag` has allowed four values since migration
 * 0015 and nothing ever set one, so the Fuel tab's "exceptions" count was
 * structurally zero. `post_fuel_to_job_cost` (0038) posts a purchase into
 * `project_costs` under its own bucket — RULE-001 keeps fuel out of the
 * equipment rate precisely so it can be seen — and that bucket was empty on
 * every job this platform has ever run.
 *
 * Flagged, never refused. The money was spent whether or not the ticket makes
 * sense: refusing the row loses the cost, accepting it silently loses the
 * question.
 */
import { useState } from 'react';
import { Fuel, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { messageFor } from '@/lib/data/query';
import { recordFuel, resolveFuelException, type AssetRow } from '@/lib/data/fleet';
import { money } from '@/lib/format';

const field = 'h-9 rounded-md border border-charcoal-200 bg-white px-2 text-sm';

export const EXCEPTION_SAID: Record<string, string> = {
  no_asset: 'No machine on the ticket — this cost cannot be attributed to anything',
  meter_regression: 'The meter on the ticket reads below the machine — usually the wrong unit number',
  volume_outlier: 'Far outside this machine’s own fill history',
  duplicate: 'The same volume against the same machine at the same moment',
};

export function RecordFuel({ companyId, assets, canWrite, onRecorded }: {
  companyId: string | null;
  assets: AssetRow[];
  canWrite: boolean;
  onRecorded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState('');
  const [gallons, setGallons] = useState('');
  const [price, setPrice] = useState('');
  const [odometer, setOdometer] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<string | null>(null);

  const total = (Number(gallons) || 0) * (Number(price) || 0);

  const record = async () => {
    if (!companyId || busy) return;
    setBusy(true); setError(null); setFlagged(null);
    try {
      await recordFuel(companyId, {
        gallons: Number(gallons),
        pricePerGallon: Number(price),
        assetId: assetId || null,
        odometerHours: odometer ? Number(odometer) : null,
        location: location || null,
      });
      if (!assetId) setFlagged('no_asset');
      setGallons(''); setPrice(''); setOdometer(''); setLocation('');
      setOpen(false);
      onRecorded();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!canWrite}
        title={canWrite ? undefined : 'Needs permission to change fleet records'}>
        <Fuel className="size-4" /> Record a fuel ticket
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="fuel-asset">Which machine</Label>
          <select id="fuel-asset" className={`${field} w-full`} value={assetId}
            onChange={(e) => setAssetId(e.target.value)}>
            <option value="">Not known — flag it for somebody to match</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.assetNumber} · {a.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="fuel-gal">Gallons</Label>
          <Input id="fuel-gal" type="number" value={gallons} autoFocus
            onChange={(e) => setGallons(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fuel-price">Price per gallon</Label>
          <Input id="fuel-price" type="number" step="0.001" value={price}
            onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fuel-odo">Meter on the ticket</Label>
          <Input id="fuel-odo" type="number" value={odometer}
            onChange={(e) => setOdometer(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="fuel-loc">Where</Label>
          <Input id="fuel-loc" value={location} placeholder="Yard tank, Pilot on 23"
            onChange={(e) => setLocation(e.target.value)} />
        </div>
      </div>

      <p className="text-xs text-charcoal-500">
        {total > 0 ? `${money(total)}. ` : ''}
        A meter on the ticket is recorded as a reading too, so the same fact is entered once.
        Fuel posts to the job under its own cost bucket and is never folded into the
        machine&rsquo;s hourly rate.
      </p>

      {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}
      {flagged ? (
        <p className="text-sm text-yellow-700">{EXCEPTION_SAID[flagged]}</p>
      ) : null}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => void record()}
          disabled={busy || !gallons || !price}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Record it
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

/** Put an unmatched or suspect ticket right. */
export function ResolveFuelException({ transactionId, exception, assets, canWrite, onResolved }: {
  transactionId: string;
  exception: string;
  assets: AssetRow[];
  canWrite: boolean;
  onResolved: () => void;
}) {
  const [assetId, setAssetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolve = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await resolveFuelException({
        transactionId, assetId: assetId || null, clear: true,
      });
      onResolved();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {exception === 'no_asset' ? (
        <select className={field} value={assetId} aria-label="Match it to a machine"
          onChange={(e) => setAssetId(e.target.value)} disabled={!canWrite}>
          <option value="">Match it to a machine…</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>{a.assetNumber} · {a.name}</option>
          ))}
        </select>
      ) : null}
      <Button size="sm" variant="outline" disabled={!canWrite || busy
        || (exception === 'no_asset' && !assetId)}
        onClick={() => void resolve()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        {exception === 'no_asset' ? 'Attribute it' : 'Mark it looked at'}
      </Button>
      {error ? <span className="text-sm text-danger-700">{error}</span> : null}
    </div>
  );
}
