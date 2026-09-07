/**
 * How much a truck takes, and what that is measured in.
 *
 * There were two boxes here — "Truck cap" and "Tons/load" — and between them
 * they encoded an assumption the schema never made: that a truck is measured in
 * tons. A tri-axle hauling stone is bought by the ton. The same truck hauling
 * topsoil is bought by the yard, because topsoil is sold by the yard and nobody
 * is putting a scale on it. A lowboy move is one load whatever is on it.
 *
 * So it is one number with its unit beside it, and the unit list is four long
 * rather than fourteen: nobody hauls by the acre, and a picker offering the
 * impossible costs a reader a second look.
 */
import { useEffect, useState, type KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { setHaulCapacity, HAUL_CAPACITY_UNITS } from '@/lib/data/estimates';

export function HaulCapacity({ resourceId, capacity, unit, disabled, onSaved }: {
  resourceId: string;
  capacity: number | null;
  unit: string | null;
  disabled?: boolean;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(capacity == null ? '' : String(capacity));
  const [pick, setPick] = useState(unit ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setAmount(capacity == null ? '' : String(capacity)); }, [capacity]);
  useEffect(() => { setPick(unit ?? ''); }, [unit]);

  const save = async (nextAmount: string, nextUnit: string) => {
    if (!supabase) return;
    const n = nextAmount.trim() === '' ? null : Number(nextAmount);
    if (n !== null && !Number.isFinite(n)) return;
    setError(null);
    try {
      await setHaulCapacity(supabase, resourceId, n, nextUnit || null);
      onSaved();
    } catch (err) {
      setError(messageFor(err));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void save(amount, pick); }
  };

  const chosen = HAUL_CAPACITY_UNITS.find((u) => u.unit === pick);

  return (
    <div className="space-y-1">
      <Label htmlFor={`cap-${resourceId}`}>A load holds</Label>
      <div className="flex items-center gap-1">
        <Input
          id={`cap-${resourceId}`}
          value={amount}
          inputMode="decimal"
          disabled={disabled}
          className="h-8 w-20 text-right"
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => void save(amount, pick)}
          onKeyDown={onKeyDown} />
        <select
          value={pick}
          disabled={disabled}
          aria-label="What a load is measured in"
          onChange={(e) => { setPick(e.target.value); void save(amount, e.target.value); }}
          className="h-8 rounded-md border border-charcoal-200 bg-white px-2 text-sm
                     focus:border-yellow-500 focus:outline-none disabled:opacity-60">
          <option value="">—</option>
          {HAUL_CAPACITY_UNITS.map((u) => (
            <option key={u.unit} value={u.unit} title={u.note}>{u.unit}</option>
          ))}
        </select>
      </div>
      {chosen ? <p className="text-xs text-charcoal-500">{chosen.note}</p> : null}
      {error ? <p role="alert" className="text-xs text-danger-700">{error}</p> : null}
    </div>
  );
}
