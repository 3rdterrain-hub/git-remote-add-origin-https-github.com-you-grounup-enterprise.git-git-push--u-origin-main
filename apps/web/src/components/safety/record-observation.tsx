/**
 * What somebody saw.
 *
 * `safety_observations` had no writer, so near misses and good catches — the
 * leading indicators, the ones that stop the recordable happening — could not be
 * captured at all.
 *
 * The form enforces the schema's rule in the schema's spirit: an unsafe
 * observation is either fixed on the spot or carries an action. A hazard written
 * down and left is a record of somebody walking past it.
 */
import { useState } from 'react';
import { Loader2, Eye, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { messageFor } from '@/lib/data/query';
import { recordSafetyObservation, OBSERVATION_CATEGORIES } from '@/lib/data/safety';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

export function RecordObservation({ companyId, canWrite, onRecorded }: {
  companyId: string | null;
  canWrite: boolean;
  onRecorded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('ppe');
  const [description, setDescription] = useState('');
  const [isPositive, setIsPositive] = useState(false);
  const [correctedOnSite, setCorrectedOnSite] = useState(false);
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* The schema's rule, stated on screen before the database has to state it. */
  const needsAnAction = !isPositive && !correctedOnSite && !correctiveAction.trim();

  const record = async () => {
    if (!companyId || busy) return;
    setBusy(true); setError(null);
    try {
      await recordSafetyObservation(companyId, {
        category, description, isPositive, correctedOnSite, correctiveAction,
      });
      setDescription(''); setCorrectiveAction('');
      setIsPositive(false); setCorrectedOnSite(false);
      setOpen(false);
      onRecorded();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!canWrite}
        title={canWrite ? undefined : 'Needs permission to record safety observations'}>
        <Eye className="size-4" /> Record what you saw
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="ob-cat">What it is about</Label>
          <select id="ob-cat" className={field} value={category}
            onChange={(e) => setCategory(e.target.value)}>
            {OBSERVATION_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-3">
          <Label htmlFor="ob-desc">What you saw</Label>
          <Input id="ob-desc" value={description} autoFocus
            placeholder="Spoil pile within three feet of the trench edge"
            onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-charcoal-700">
          <input type="checkbox" checked={isPositive}
            onChange={(e) => setIsPositive(e.target.checked)} />
          It was a good catch, not a hazard
        </label>
        {!isPositive ? (
          <label className="flex items-center gap-2 text-sm text-charcoal-700">
            <input type="checkbox" checked={correctedOnSite}
              onChange={(e) => setCorrectedOnSite(e.target.checked)} />
            Fixed on the spot
          </label>
        ) : null}
      </div>

      {!isPositive && !correctedOnSite ? (
        <div className="space-y-1">
          <Label htmlFor="ob-action">What is being done about it</Label>
          <Input id="ob-action" value={correctiveAction}
            placeholder="Spoil set back and the crew re-briefed before the next pull"
            onChange={(e) => setCorrectiveAction(e.target.value)} />
          <p className="text-xs text-charcoal-500">
            A hazard written down and left is a record of somebody walking past it. Either it
            was fixed on the spot, or say what is being done.
          </p>
        </div>
      ) : null}

      {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => void record()}
          disabled={busy || description.trim().length < 5 || needsAnAction}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Record it
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
