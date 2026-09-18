/**
 * Changing what a material is measured in. LIBRARY.
 *
 * The unit and the cost move together or not at all, because the database
 * refuses one without the other and it is right to: a unit cost is a price
 * *per unit*. Change TON to CY and leave $12.40 sitting there and the figure is
 * no longer anybody's price — it is a number that looks exactly as
 * authoritative as it did a moment ago, on every line that ever prices from it.
 *
 * So the editor shows both, pre-filled with the current cost, and says plainly
 * that the cost is the one being restated. Somebody who genuinely has the same
 * price in the new unit types it again; that is a second of work against a
 * class of error nobody can see afterwards.
 */
import { useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { messageFor } from '@/lib/data/query';

export function UnitAndCost({ unit, unitCost, units, editable, name, onSave }: {
  unit: string;
  unitCost: number;
  units: readonly string[];
  editable: boolean;
  name: string;
  onSave: (unit: string, unitCost: number) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [draftUnit, setDraftUnit] = useState(unit);
  const [draftCost, setDraftCost] = useState(String(unitCost));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editable) return <span className="text-charcoal-600">{unit}</span>;

  if (!open) {
    return (
      <button type="button"
        className="group inline-flex items-center gap-1.5 text-charcoal-700 hover:text-charcoal-900"
        title={`Change the unit ${name} is measured in`}
        onClick={() => {
          setDraftUnit(unit); setDraftCost(String(unitCost)); setError(null); setOpen(true);
        }}>
        {unit}
        <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
      </button>
    );
  }

  return (
    <div className="min-w-56 space-y-2 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-2">
      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`u-${name}`} className="text-xs">Unit</Label>
          <select id={`u-${name}`} value={draftUnit} autoFocus
            onChange={(e) => setDraftUnit(e.target.value)}
            className="h-8 rounded-md border border-charcoal-200 bg-white px-2 text-sm">
            {units.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`c-${name}`} className="text-xs">Cost per {draftUnit}</Label>
          <Input id={`c-${name}`} type="number" step="0.01" min="0" className="h-8 w-28"
            value={draftCost} onChange={(e) => setDraftCost(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-charcoal-500">
        The cost is restated in the new unit. {unitCost > 0
          ? `It was ${unitCost} per ${unit}.` : 'It had no cost before.'}
      </p>
      {error ? <p className="text-xs text-danger-700">{error}</p> : null}
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" disabled={busy || draftCost.trim() === ''}
          title={draftCost.trim() === '' ? 'Say what it costs in the new unit' : undefined}
          onClick={() => {
            setBusy(true); setError(null);
            onSave(draftUnit, Number(draftCost))
              .then(() => setOpen(false))
              .catch((e: unknown) => setError(messageFor(e)))
              .finally(() => setBusy(false));
          }}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save both
        </Button>
      </div>
    </div>
  );
}
