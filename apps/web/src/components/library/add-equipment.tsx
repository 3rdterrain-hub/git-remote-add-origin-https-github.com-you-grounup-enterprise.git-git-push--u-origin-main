/**
 * Putting a machine in the yard. WORKFLOW.
 *
 * 709 machines shipped and no way to add a 710th, so a company whose yard holds
 * something the seed does not list had nowhere to put it.
 *
 * It arrives with no rate on purpose. Somebody adding an excavator at eight in
 * the morning may not know what it costs an hour until they look it up, and the
 * equipment tab already renders that state honestly as "No rate yet". An
 * invented hourly figure would reach an estimate instead, which is the one
 * thing this platform refuses everywhere else.
 */
import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { CategorySelect } from '@/components/ui/category-select';
import { messageFor } from '@/lib/data/query';
import { createEquipment } from '@/lib/data/library';

export function AddEquipment({ companyId, canWrite, onAdded }: {
  companyId: string | null;
  canWrite: boolean;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [equipmentClass, setEquipmentClass] = useState('');
  const [fuel, setFuel] = useState('');
  const [mobilization, setMobilization] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button size="sm" disabled={!canWrite || !companyId}
        title={canWrite ? undefined : 'Needs permission to write the libraries'}
        onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add a machine
      </Button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="eq-name">What it is</Label>
          <Input id="eq-name" value={name} autoFocus placeholder="Excavator 210"
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="eq-class">Class</Label>
          <CategorySelect id="eq-class" kind="equipment_class" label="equipment class"
            value={equipmentClass} onChange={setEquipmentClass} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="eq-fuel">Fuel burn</Label>
          <Input id="eq-fuel" type="number" step="0.1" min="0" value={fuel} placeholder="6"
            onChange={(e) => setFuel(e.target.value)} />
          <p className="text-xs text-charcoal-500">Gallons an hour. Its own cost bucket.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="eq-mob">Mobilization</Label>
          <Input id="eq-mob" type="number" step="1" min="0" value={mobilization} placeholder="500"
            onChange={(e) => setMobilization(e.target.value)} />
          <p className="text-xs text-charcoal-500">What it costs to get it there.</p>
        </div>
      </div>

      <Alert tone="info" title="It arrives without a rate">
        The hourly, daily, weekly and monthly figures are set on the row once you have them.
        Nothing is guessed from nothing — the machine reads &ldquo;No rate yet&rdquo; until
        somebody says what it costs.
      </Alert>

      {error ? <Alert tone="danger" title="That machine was not added">{error}</Alert> : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" disabled={busy || !name.trim() || !companyId}
          title={name.trim() ? undefined : 'A name, at least'}
          onClick={() => {
            if (!companyId) return;
            setBusy(true); setError(null);
            createEquipment(companyId, {
              name: name.trim(),
              equipmentClass: equipmentClass || null,
              fuelGallonsPerHour: Number(fuel || 0),
              mobilizationCost: Number(mobilization || 0),
            })
              .then(() => {
                setName(''); setEquipmentClass(''); setFuel(''); setMobilization('');
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
