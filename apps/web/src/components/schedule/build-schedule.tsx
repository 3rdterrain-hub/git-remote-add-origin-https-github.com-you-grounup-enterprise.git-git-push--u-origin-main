/**
 * The offer to build a schedule from the work that was won.
 *
 * `award_estimate_version` already produces one `project_tasks` row per priced
 * line, with the hours the estimate priced and the crew it priced them for. The
 * Schedule page said "a schedule is built from the project's tasks" and offered
 * no way to build one, because until migration 0183 nothing anywhere inserted a
 * `schedule_activities` row.
 *
 * The count comes from `my_schedulable_projects` rather than from counting rows
 * in the browser, so what the button promises and what the function does are
 * read from the same place through the same rules.
 */
import { useState } from 'react';
import { ListPlus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { loadSchedulable, buildScheduleFromTasks } from '@/lib/data/schedule';
import { plural } from '@/lib/format';

export function BuildSchedule({ projectId, plannedStart, canWrite, onBuilt }: {
  projectId: string;
  /** The project's own start, offered as the default so the dates mean something. */
  plannedStart: string | null;
  canWrite: boolean;
  onBuilt: () => void;
}) {
  const countQ = useQuery(loadSchedulable(projectId), [projectId]);
  const counts = countQ.status === 'ready' ? countQ.data : null;

  const [start, setStart] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<number | null>(null);

  if (!counts || counts.unscheduledTaskCount === 0) return null;

  const build = async () => {
    if (!supabase || busy) return;
    setBusy(true); setError(null); setMade(null);
    try {
      const n = await buildScheduleFromTasks(supabase, projectId,
        start || plannedStart || null);
      setMade(n);
      countQ.refetch();
      onBuilt();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  return (
    <Alert tone="info" icon={<ListPlus className="size-4" />}
      title={counts.activityCount === 0
        ? `${plural(counts.unscheduledTaskCount, 'budgeted task')} and no schedule yet`
        : `${plural(counts.unscheduledTaskCount, 'budgeted task')} not on the schedule`}>
      <div className="space-y-3">
        <p>
          Each one becomes an activity, laid end to end, with its duration taken from the
          hours the estimate priced over the hours in a working day. That is a starting
          position and not a plan — it assumes one crew straight through with no overlap —
          which is what the logic and the critical path are then for.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="sched-start">Start the work on</Label>
            <Input id="sched-start" type="date" className="h-9 w-44"
              value={start || plannedStart?.slice(0, 10) || ''}
              onChange={(e) => setStart(e.target.value)} />
          </div>
          <Button onClick={() => void build()} disabled={!canWrite || busy}
            title={canWrite ? undefined : 'Needs permission to change the project'}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ListPlus className="size-4" />}
            Build {plural(counts.unscheduledTaskCount, 'activity', 'activities')}
          </Button>
        </div>
        {made !== null ? (
          <p className="text-sm font-medium text-success-700">
            {made === 0
              ? 'Nothing to add — every task already has an activity.'
              : `${plural(made, 'activity', 'activities')} added. Tie the logic together, then calculate.`}
          </p>
        ) : null}
        {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}
      </div>
    </Alert>
  );
}
