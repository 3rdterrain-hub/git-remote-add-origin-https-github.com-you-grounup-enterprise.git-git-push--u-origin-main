/**
 * Starting a work sequence. WORKFLOW.
 *
 * An assembly could only be copied from a shipped one, so a company doing work
 * the catalog has never heard of had to start from the nearest thing and edit
 * it into shape.
 *
 * It arrives empty. An assembly is the order work happens in, and nobody has
 * said what the work is yet — a first step put there automatically would be a
 * guess at a job nobody described. Steps are added to it afterwards, which is
 * what the sequence editor already does.
 */
import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { messageFor } from '@/lib/data/query';
import { createAssembly, UNITS } from '@/lib/data/library';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

export function AddAssembly({ companyId, canWrite, onAdded }: {
  companyId: string | null;
  canWrite: boolean;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('EA');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button size="sm" disabled={!canWrite || !companyId}
        title={canWrite ? undefined : 'Needs permission to write the libraries'}
        onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add a work sequence
      </Button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="asm-name">What the sequence builds</Label>
          <Input id="asm-name" value={name} autoFocus placeholder="Trench, bed and backfill"
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="asm-unit">Measured in</Label>
          <select id="asm-unit" className={field} value={unit}
            onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>

      <Alert tone="info" title="It starts empty">
        Add the steps afterwards, in the order the work happens. Nothing is put in for you —
        a first step chosen automatically would be a guess at a job nobody has described yet.
      </Alert>

      {error ? <Alert tone="danger" title="That sequence was not added">{error}</Alert> : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" disabled={busy || !name.trim() || !companyId}
          title={name.trim() ? undefined : 'A name, at least'}
          onClick={() => {
            if (!companyId) return;
            setBusy(true); setError(null);
            createAssembly(companyId, { name: name.trim(), quantityUnit: unit })
              .then(() => { setName(''); setOpen(false); onAdded(); })
              .catch((e: unknown) => setError(messageFor(e)))
              .finally(() => setBusy(false));
          }}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Add it
        </Button>
      </div>
    </div>
  );
}
