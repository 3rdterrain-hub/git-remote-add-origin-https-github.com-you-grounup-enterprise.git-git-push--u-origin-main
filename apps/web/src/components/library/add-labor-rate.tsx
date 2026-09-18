/**
 * Adding a classification to the labor library. WORKFLOW.
 *
 * There was no way to. The owner: "we need to be able to add a name, add a…
 * add a labor rate." Fifty-six shipped rates and no door to put a
 * fifty-seventh beside them, so a company whose operators are paid something
 * the seed does not list had nowhere to say so.
 *
 * The burden is asked for as a share rather than a percentage, and says so,
 * because 35 and 0.35 are both things people type and only one of them is a
 * burden. The database refuses anything above 3 with the same sentence.
 */
import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { messageFor } from '@/lib/data/query';
import { createLaborRate } from '@/lib/data/library';
import { money } from '@/lib/format';

export function AddLaborRate({ companyId, canWrite, onAdded }: {
  companyId: string | null;
  canWrite: boolean;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [classification, setClassification] = useState('');
  const [wage, setWage] = useState('');
  const [burden, setBurden] = useState('0.35');
  const [group, setGroup] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wageNumber = Number(wage || 0);
  const burdenNumber = Number(burden || 0);
  const ready = companyId !== null && classification.trim() !== '' && wageNumber > 0;

  if (!open) {
    return (
      <Button size="sm" disabled={!canWrite || !companyId}
        title={canWrite ? undefined : 'Needs permission to write the libraries'}
        onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add a labor rate
      </Button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="lr-class">Classification</Label>
          <Input id="lr-class" value={classification} autoFocus placeholder="Operator"
            onChange={(e) => setClassification(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lr-wage">Base wage an hour</Label>
          <Input id="lr-wage" type="number" step="0.01" min="0" value={wage} placeholder="44.50"
            onChange={(e) => setWage(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lr-burden">Burden</Label>
          <Input id="lr-burden" type="number" step="0.01" min="0" max="3" value={burden}
            onChange={(e) => setBurden(e.target.value)} />
          <p className="text-xs text-charcoal-500">A share of the wage: 38% is 0.38.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="lr-group">Labor group</Label>
          <Input id="lr-group" value={group} placeholder="Operating Engineers"
            onChange={(e) => setGroup(e.target.value)} />
        </div>
      </div>

      {wageNumber > 0 ? (
        <p className="text-sm text-charcoal-600">
          Loaded cost <strong>{money(wageNumber * (1 + burdenNumber))}</strong> an hour —
          the wage plus the burden. That figure is computed by the database, not stored,
          so it cannot drift from the two numbers above it.
        </p>
      ) : null}

      {error ? <Alert tone="danger" title="That rate was not added">{error}</Alert> : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" disabled={!ready || busy}
          title={ready ? undefined : 'A classification and a wage'}
          onClick={() => {
            if (!companyId) return;
            setBusy(true); setError(null);
            createLaborRate(companyId, {
              classification: classification.trim(),
              baseWagePerHour: wageNumber,
              burdenPercent: burdenNumber,
              laborGroup: group.trim() || null,
            })
              .then(() => {
                setClassification(''); setWage(''); setBurden('0.35'); setGroup('');
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
