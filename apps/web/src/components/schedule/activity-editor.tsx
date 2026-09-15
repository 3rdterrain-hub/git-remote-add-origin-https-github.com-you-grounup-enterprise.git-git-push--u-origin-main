/**
 * An activity, opened.
 *
 * Three things a scheduler does, in one place, because they are one decision:
 * change the bar, say what it waits on, and say who is on it. Splitting them
 * across three screens is how a schedule stops being maintained.
 *
 * Opens *under* the row rather than in a cell or a modal — the same rule the
 * estimate line follows, and for the same reason: the row above stays legible
 * while the thing it describes is being changed.
 *
 * **Nothing here writes float, the critical flag or the early and late dates.**
 * 0158 refuses a write to one, and the temptation to blank them on a hand edit
 * so the screen looks tidy is exactly the hole that guard exists to close. A
 * moved bar shows its float as stale instead, with the date it was computed.
 */
import { useState } from 'react';
import { Link2, Loader2, Trash2, Plus, Users2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { messageFor } from '@/lib/data/query';
import {
  updateScheduleActivity, removeScheduleActivity,
  addScheduleDependency, removeScheduleDependency, updateScheduleDependency,
  assignResource, releaseResource,
  type ScheduleActivityRow, type ScheduleDependencyRow,
  type ResourceAssignmentRow, type AssignableResource,
} from '@/lib/data/schedule';
import { percent, qty } from '@/lib/format';

const LINK_TYPES: Array<{ value: ScheduleDependencyRow['dependencyType']; label: string }> = [
  { value: 'finish_to_start', label: 'Finish → start' },
  { value: 'start_to_start', label: 'Start → start' },
  { value: 'finish_to_finish', label: 'Finish → finish' },
  { value: 'start_to_finish', label: 'Start → finish' },
];

const CONSTRAINTS = [
  { value: 'start_no_earlier', label: 'Start no earlier than' },
  { value: 'finish_no_later', label: 'Finish no later than' },
  { value: 'must_start_on', label: 'Must start on' },
  { value: 'must_finish_on', label: 'Must finish on' },
];

const field = 'h-9 rounded-md border border-charcoal-200 bg-white px-2 text-sm';

export function ActivityEditor({
  activity, activities, dependencies, assignments, resources, canWrite, onChanged, onClose,
}: {
  activity: ScheduleActivityRow;
  /** Every other activity on the project, so a predecessor can be chosen. */
  activities: ScheduleActivityRow[];
  dependencies: ScheduleDependencyRow[];
  assignments: ResourceAssignmentRow[];
  resources: AssignableResource[];
  canWrite: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(activity.name);
  const [wbs, setWbs] = useState(activity.wbsCode ?? '');
  const [start, setStart] = useState(activity.plannedStart.slice(0, 10));
  const [duration, setDuration] = useState(String(activity.durationDays));
  const [complete, setComplete] = useState(String(Math.round(activity.percentComplete * 100)));
  const [actualStart, setActualStart] = useState(activity.actualStart?.slice(0, 10) ?? '');
  const [actualFinish, setActualFinish] = useState(activity.actualFinish?.slice(0, 10) ?? '');
  const [constraintType, setConstraintType] = useState(activity.constraintType ?? '');
  const [constraintDate, setConstraintDate] = useState(activity.constraintDate?.slice(0, 10) ?? '');

  const [predecessor, setPredecessor] = useState('');
  const [linkType, setLinkType] = useState<ScheduleDependencyRow['dependencyType']>('finish_to_start');
  const [lag, setLag] = useState('0');

  const [resource, setResource] = useState('');
  const [allocation, setAllocation] = useState('100');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const named = new Map(activities.map((a) => [a.id, a]));
  const predecessors = dependencies.filter((d) => d.successorId === activity.id);
  const successors = dependencies.filter((d) => d.predecessorId === activity.id);
  const mine = assignments.filter((r) => r.activityId === activity.id);
  const takenIds = new Set(predecessors.map((d) => d.predecessorId));

  const run = async (work: () => Promise<unknown>) => {
    if (!supabase || busy) return;
    setBusy(true); setError(null);
    try { await work(); onChanged(); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  const save = () => run(async () => {
    await updateScheduleActivity(supabase!, {
      activityId: activity.id,
      name,
      wbsCode: wbs,
      start,
      durationDays: Number(duration) || 1,
      percentComplete: Math.min(1, Math.max(0, (Number(complete) || 0) / 100)),
      actualStart: actualStart || null,
      actualFinish: actualFinish || null,
      constraintType: constraintType || null,
      constraintDate: constraintDate || null,
      clearConstraint: constraintType === '',
    });
  });

  const link = () => run(async () => {
    await addScheduleDependency(supabase!, {
      predecessorId: predecessor,
      successorId: activity.id,
      type: linkType,
      lagDays: Number(lag) || 0,
    });
    setPredecessor(''); setLag('0');
  });

  const staff = () => run(async () => {
    const chosen = resources.find((r) => `${r.kind}:${r.id}` === resource);
    if (!chosen) return;
    await assignResource(supabase!, {
      activityId: activity.id,
      kind: chosen.kind,
      crewId: chosen.kind === 'crew' ? chosen.id : null,
      employeeId: chosen.kind === 'employee' ? chosen.id : null,
      assetId: chosen.kind === 'asset' ? chosen.id : null,
      vendorId: chosen.kind === 'subcontractor' ? chosen.id : null,
      allocation: Math.min(1, Math.max(0.01, (Number(allocation) || 100) / 100)),
    });
    setResource(''); setAllocation('100');
  });

  return (
    <div className="space-y-5 border-t border-charcoal-200 bg-charcoal-50/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-xs font-medium uppercase tracking-wide text-charcoal-600">
          {activity.isMilestone ? 'Milestone' : 'Activity'}
        </h4>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close the activity">
          <X className="size-4" />
        </Button>
      </div>

      {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

      {/* What the bar is */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`n-${activity.id}`}>Activity</Label>
          <Input id={`n-${activity.id}`} value={name} onChange={(e) => setName(e.target.value)}
            disabled={!canWrite} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`w-${activity.id}`}>WBS</Label>
          <Input id={`w-${activity.id}`} value={wbs} onChange={(e) => setWbs(e.target.value)}
            placeholder="optional" disabled={!canWrite} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`s-${activity.id}`}>Starts</Label>
          <Input id={`s-${activity.id}`} type="date" value={start}
            onChange={(e) => setStart(e.target.value)} disabled={!canWrite} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`d-${activity.id}`}>Working days</Label>
          <Input id={`d-${activity.id}`} type="number" min={1} value={duration}
            onChange={(e) => setDuration(e.target.value)}
            disabled={!canWrite || activity.isMilestone} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`p-${activity.id}`}>Percent complete</Label>
          <Input id={`p-${activity.id}`} type="number" min={0} max={100} value={complete}
            onChange={(e) => setComplete(e.target.value)} disabled={!canWrite} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`as-${activity.id}`}>Actually started</Label>
          <Input id={`as-${activity.id}`} type="date" value={actualStart}
            onChange={(e) => setActualStart(e.target.value)} disabled={!canWrite} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`af-${activity.id}`}>Actually finished</Label>
          <Input id={`af-${activity.id}`} type="date" value={actualFinish}
            onChange={(e) => setActualFinish(e.target.value)} disabled={!canWrite} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`ct-${activity.id}`}>Constraint</Label>
          <select id={`ct-${activity.id}`} className={`${field} w-full`} value={constraintType}
            onChange={(e) => setConstraintType(e.target.value)} disabled={!canWrite}>
            <option value="">None — the logic decides</option>
            {CONSTRAINTS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        {constraintType ? (
          <div className="space-y-1">
            <Label htmlFor={`cd-${activity.id}`}>On</Label>
            <Input id={`cd-${activity.id}`} type="date" value={constraintDate}
              onChange={(e) => setConstraintDate(e.target.value)} disabled={!canWrite} />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={!canWrite || busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save the activity
        </Button>
        <Button size="sm" variant="ghost" className="text-danger-700"
          onClick={() => run(async () => { await removeScheduleActivity(supabase!, activity.id); onClose(); })}
          disabled={!canWrite || busy}>
          <Trash2 className="size-4" /> Remove it
        </Button>
        {activity.totalFloatDays !== null ? (
          <span className="text-xs text-charcoal-500">
            Float and the critical path are the engine&rsquo;s, not this form&rsquo;s. Changing
            the dates here leaves the last calculation standing until you run it again.
          </span>
        ) : null}
      </div>

      {/* What it waits on */}
      <div className="space-y-2">
        <h5 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-charcoal-600">
          <Link2 className="size-3.5" /> What it waits on
        </h5>
        {predecessors.length === 0 ? (
          <p className="text-sm text-charcoal-500">
            Nothing. An activity with no predecessor starts on day one of the calculation,
            which is right for the first one and wrong for everything after it.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {predecessors.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-charcoal-900">
                  {named.get(d.predecessorId)?.name ?? 'an activity'}
                </span>
                <select className={field} value={d.dependencyType} disabled={!canWrite || busy}
                  aria-label="Kind of link"
                  onChange={(e) => run(() => updateScheduleDependency(supabase!, {
                    linkId: d.id,
                    type: e.target.value as ScheduleDependencyRow['dependencyType'],
                  }))}>
                  {LINK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <Input type="number" className="h-9 w-20" defaultValue={d.lagDays}
                  aria-label="Lag in days" disabled={!canWrite || busy}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v !== d.lagDays) void run(() => updateScheduleDependency(supabase!, {
                      linkId: d.id, lagDays: v,
                    }));
                  }} />
                <span className="text-xs text-charcoal-500">days lag</span>
                <Button variant="ghost" size="sm" className="text-danger-700"
                  aria-label="Remove this link" disabled={!canWrite || busy}
                  onClick={() => run(() => removeScheduleDependency(supabase!, d.id))}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {canWrite ? (
          <div className="flex flex-wrap items-end gap-2">
            <select className={field} value={predecessor} aria-label="Add a predecessor"
              onChange={(e) => setPredecessor(e.target.value)}>
              <option value="">Add a predecessor…</option>
              {activities
                .filter((a) => a.id !== activity.id && !takenIds.has(a.id))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.wbsCode ? `${a.wbsCode} · ` : ''}{a.name}
                  </option>
                ))}
            </select>
            <select className={field} value={linkType} aria-label="Kind of link to add"
              onChange={(e) => setLinkType(e.target.value as ScheduleDependencyRow['dependencyType'])}>
              {LINK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <Input type="number" className="h-9 w-20" value={lag} aria-label="Lag in days to add"
              onChange={(e) => setLag(e.target.value)} />
            <Button size="sm" variant="outline" disabled={!predecessor || busy}
              onClick={link}>
              <Plus className="size-4" /> Link
            </Button>
          </div>
        ) : null}

        {successors.length > 0 ? (
          <p className="text-xs text-charcoal-500">
            {`${successors.length === 1 ? '1 activity waits' : `${successors.length} activities wait`}`
              + ` on this one: ${successors.map((d) => named.get(d.successorId)?.name ?? '—').join(', ')}.`}
          </p>
        ) : null}
      </div>

      {/* Who is on it */}
      <div className="space-y-2">
        <h5 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-charcoal-600">
          <Users2 className="size-3.5" /> Who and what is on it
        </h5>
        {mine.length === 0 ? (
          <p className="text-sm text-charcoal-500">
            Nobody yet. An assignment is what puts this activity on a crew&rsquo;s phone.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {mine.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-charcoal-900">{r.resourceName ?? '—'}</span>
                <Badge variant="outline">{r.kind}</Badge>
                {r.allocation < 1 ? (
                  <span className="text-xs text-charcoal-500">{percent(r.allocation, 0)}</span>
                ) : null}
                <Button variant="ghost" size="sm" className="text-danger-700"
                  aria-label={`Take ${r.resourceName ?? 'this'} off`} disabled={!canWrite || busy}
                  onClick={() => run(() => releaseResource(supabase!, r.id))}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {canWrite ? (
          <div className="flex flex-wrap items-end gap-2">
            <select className={field} value={resource} aria-label="Put somebody on it"
              onChange={(e) => setResource(e.target.value)}>
              <option value="">Put a crew, a person or a machine on it…</option>
              {(['crew', 'employee', 'asset', 'subcontractor'] as const).map((kind) => {
                const group = resources.filter((r) => r.kind === kind);
                if (group.length === 0) return null;
                return (
                  <optgroup key={kind} label={
                    kind === 'crew' ? 'Crews'
                      : kind === 'employee' ? 'People'
                        : kind === 'asset' ? 'Machines' : 'Subcontractors'}>
                    {group.map((r) => (
                      <option key={`${r.kind}:${r.id}`} value={`${r.kind}:${r.id}`}>
                        {r.code ? `${r.code} · ` : ''}{r.label}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            <div className="space-y-1">
              <Label htmlFor={`al-${activity.id}`}>Share %</Label>
              <Input id={`al-${activity.id}`} type="number" min={1} max={100}
                className="h-9 w-24" value={allocation}
                onChange={(e) => setAllocation(e.target.value)} />
            </div>
            <Button size="sm" variant="outline" disabled={!resource || busy} onClick={staff}>
              <Plus className="size-4" /> Assign
            </Button>
          </div>
        ) : null}
        {mine.length > 0 ? (
          <p className="text-xs text-charcoal-500">
            Assigned for {qty(activity.durationDays, 0)} day{activity.durationDays === 1 ? '' : 's'},
            from the activity&rsquo;s own dates. Move the bar and the assignment stays where it
            was put, because somebody may have been booked for those days on purpose.
          </p>
        ) : null}
      </div>
    </div>
  );
}
