/**
 * An activity that came from no priced line.
 *
 * Mobilization, a permit, an inspection, a concrete cure, a milestone the owner
 * named. These have duration and logic and no cost of their own, and a schedule
 * that can only hold work somebody bid is not a schedule — every job has a
 * week of waiting on somebody else in it.
 */
import { useState } from 'react';
import { Plus, Loader2, Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { messageFor } from '@/lib/data/query';
import { addScheduleActivity } from '@/lib/data/schedule';

export function AddActivity({ projectId, defaultStart, canWrite, onAdded }: {
  projectId: string;
  defaultStart: string | null;
  canWrite: boolean;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [start, setStart] = useState(defaultStart?.slice(0, 10) ?? '');
  const [duration, setDuration] = useState('1');
  const [milestone, setMilestone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!supabase || busy) return;
    setBusy(true); setError(null);
    try {
      await addScheduleActivity(supabase, {
        projectId,
        name,
        start,
        durationDays: milestone ? 1 : Number(duration) || 1,
        isMilestone: milestone,
      });
      setOpen(false); setName(''); setDuration('1'); setMilestone(false);
      onAdded();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!canWrite}
        title={canWrite ? undefined : 'Needs permission to change the project'}>
        <Plus className="size-4" /> Add an activity
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="new-act-name">What it is</Label>
          <Input id="new-act-name" value={name} autoFocus
            placeholder="Cure slab, await permit, substantial completion…"
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-act-start">Starts</Label>
          <Input id="new-act-start" type="date" value={start}
            onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-act-days">Working days</Label>
          <Input id="new-act-days" type="number" min={1} value={duration}
            disabled={milestone} onChange={(e) => setDuration(e.target.value)} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-charcoal-700">
        <input type="checkbox" checked={milestone}
          onChange={(e) => setMilestone(e.target.checked)} />
        <Flag className="size-3.5 text-yellow-600" />
        It is a moment, not a span — a milestone
      </label>
      {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void add()} disabled={busy || !name.trim() || !start}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Add it
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
