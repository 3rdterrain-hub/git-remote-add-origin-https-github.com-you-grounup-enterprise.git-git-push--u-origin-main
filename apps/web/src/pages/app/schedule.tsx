/**
 * Schedule and resources, live.
 *
 * This page read `SCHEDULE` from `@/data/fleet`, and that fixture was not a
 * sketch: it ran the *real* critical path engine over invented activities at
 * module load. So the page showed a correct calculation of a job that does not
 * exist, under a real project number — which is why it looked so convincing,
 * and why it was worse than an obviously fake table.
 *
 * Everything it needed was already in the schema and had never been read.
 * Migration 0015 stored the activities, the four kinds of dependency and the
 * resource assignments; 0029 added calendars, the append-only
 * `schedule_calculations` and the rule that float cannot exist on an activity
 * that does not name the run which produced it. Five tables, no reader
 * anywhere. 0158 cut the door and drew around float the boundary 0058 drew
 * around a price.
 *
 * Three things follow from that, and they are what this page is:
 *
 *   * **A schedule nobody has calculated says so.** Float is null until the
 *     method has run, and rendering that as `0` would be the worst available
 *     lie: zero float means *on the critical path*. The page shows the state
 *     plainly and offers the button that fixes it.
 *
 *   * **Calculating is not typing.** The button calls the Edge Function that
 *     carries the engine; the browser never computes a date or a float, because
 *     it is not allowed to and should not want to be.
 *
 *   * **The warnings are shown.** A cycle in the logic, a constraint that
 *     cannot be met, an activity with no predecessor — the engine reports these
 *     and a schedule that hid them would be a picture of a plan rather than a
 *     plan.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays, AlertTriangle, Flag, Users2, Truck, Loader2, Calculator, CircleSlash,
} from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, EmptyState } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState, ErrorState, DemonstrationNotice } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { usePermissions, useCompanyId } from '@/lib/data/session';
import {
  loadScheduleProjects, loadScheduleActivities, loadLatestScheduleCalculation,
  loadResourceAssignments, recalculateSchedule,
  type ScheduleActivityRow,
} from '@/lib/data/schedule';
import { percent, qty, date, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The window the bars are drawn in: earliest planned start to latest finish. */
function windowOf(rows: ScheduleActivityRow[]) {
  if (rows.length === 0) return null;
  const start = rows.reduce((m, a) => (a.plannedStart < m ? a.plannedStart : m), rows[0]!.plannedStart);
  const end = rows.reduce((m, a) => (a.plannedFinish > m ? a.plannedFinish : m), rows[0]!.plannedFinish);
  /*
   * Kept as the original "YYYY-MM-DD" strings for display: round-tripping them
   * through `toISOString()` reintroduces the UTC shift that renders a 4 May
   * start as 3 May.
   */
  const span = new Date(end).getTime() - new Date(start).getTime();
  return { start, end, span: span > 0 ? span : 1 };
}

export function SchedulePage() {
  const { can } = usePermissions();
  const { companyId } = useCompanyId();
  const canWrite = can('projects.write');

  const projectsQ = useQuery(loadScheduleProjects, []);
  const projects = projectsQ.status === 'ready' ? projectsQ.data : [];
  const [chosen, setChosen] = useState<string | null>(null);
  const projectId = chosen ?? projects[0]?.id ?? '';
  const project = projects.find((p) => p.id === projectId) ?? null;

  const [nonce, setNonce] = useState(0);
  const activitiesQ = useQuery(loadScheduleActivities(projectId), [projectId, nonce]);
  const calcQ = useQuery(loadLatestScheduleCalculation(projectId), [projectId, nonce]);
  const assignmentsQ = useQuery(loadResourceAssignments(projectId), [projectId, nonce]);

  const activities = activitiesQ.status === 'ready' ? activitiesQ.data : [];
  const calculation = calcQ.status === 'ready' ? calcQ.data : null;
  const assignments = assignmentsQ.status === 'ready' ? assignmentsQ.data : [];

  const [tab, setTab] = useState('gantt');
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showTab = (next: string) => { setTab(next); if (next !== 'gantt') setCriticalOnly(false); };

  const bounds = useMemo(() => windowOf(activities), [activities]);
  /* Null float is not zero float. An activity nobody has calculated is a
     different thing from one with no room to move, and the two must never
     render alike. */
  const calculated = activities.filter((a) => a.calculationId !== null);
  const critical = activities.filter((a) => a.isCritical);
  const shown = criticalOnly ? critical : activities;
  const complete = activities.filter((a) => a.percentComplete >= 1);
  const inProgress = activities.filter((a) => a.percentComplete > 0 && a.percentComplete < 1);
  const criticalInProgress = critical.filter((a) => a.percentComplete > 0 && a.percentComplete < 1);

  const crewAssignments = assignments.filter((r) => r.kind === 'crew' || r.kind === 'employee');
  const assetAssignments = assignments.filter((r) => r.kind === 'asset');

  const recalculate = async () => {
    if (!companyId || !projectId) return;
    setBusy(true); setError(null);
    try {
      await recalculateSchedule(companyId, projectId);
      setNonce((n) => n + 1);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  if (projectsQ.status === 'demonstration') {
    return (
      <div className="space-y-6">
        <PageHeader title="Schedule &amp; Resources"
          description="Activities carry the estimate line they were scheduled from, so a duration can always be read against the production rate that produced it." />
        <DemonstrationNotice />
      </div>
    );
  }
  if (projectsQ.status === 'error') {
    return <ErrorState message={projectsQ.message} onRetry={projectsQ.refetch} />;
  }
  if (projectsQ.status === 'loading') return <LoadingState label="Reading the projects" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule &amp; Resources"
        description="Activities carry the estimate line they were scheduled from, so a duration can always be read against the production rate that produced it."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {projects.length > 0 ? (
              <select
                aria-label="Which project"
                value={projectId}
                onChange={(e) => { setChosen(e.target.value); setCriticalOnly(false); }}
                className="h-9 rounded-md border border-charcoal-200 bg-white px-2 text-sm">
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.number} — {p.name}</option>
                ))}
              </select>
            ) : null}
            <Button disabled={!canWrite || busy || activities.length === 0}
              onClick={() => void recalculate()}
              title={canWrite ? undefined : 'Needs permission to change the project'}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Calculator className="size-4" />}
              Calculate the schedule
            </Button>
          </div>
        }
      />

      {projects.length === 0 ? (
        <EmptyState title="No live projects"
          description="A schedule belongs to a project. Award an estimate and the project it becomes will appear here." />
      ) : null}

      {error ? <Alert tone="danger" title="The schedule was not calculated">{error}</Alert> : null}

      {/*
        * Every warning the engine reported, verbatim. A cycle in the logic or a
        * constraint that cannot be met is a fact about the plan, and a page
        * that hid it would be a picture of a schedule rather than one.
        */}
      {calculation && calculation.warnings.length > 0 ? (
        <Alert tone="warn" icon={<AlertTriangle className="size-4" />}
          title={`${plural(calculation.warnings.length, 'warning')} from the last calculation`}>
          <ul className="list-disc space-y-0.5 pl-4">
            {calculation.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </Alert>
      ) : null}

      {activities.length > 0 && calculated.length === 0 ? (
        <Alert tone="info" icon={<CircleSlash className="size-4" />}
          title="This schedule has not been calculated">
          The activities carry the dates somebody planned. Float, the critical path and the
          early and late dates come from running the method over the logic — until then there
          is nothing to show in those columns, and showing zero would say the opposite of the
          truth, because zero float means an activity is on the critical path.
        </Alert>
      ) : null}

      {criticalInProgress.length ? (
        <Alert tone="warn" icon={<AlertTriangle className="size-4" />}
          title={`${plural(criticalInProgress.length, 'critical-path activity', 'critical-path activities')} in progress with zero float`}>
          {criticalInProgress.map((a) => `${a.wbsCode ?? ''} ${a.name}`.trim()).join('; ')}. Any slip
          here moves the finish day for day — there is no float to absorb it.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Activities" value={activities.length} icon={<CalendarDays className="size-4" />}
          hint={`${complete.length} complete, ${inProgress.length} in progress`}
          onClick={() => { setTab('gantt'); setCriticalOnly(false); }}
          active={tab === 'gantt' && !criticalOnly}
          actionLabel="Show every activity on the schedule" />
        <StatTile label="Critical path" value={calculated.length === 0 ? '—' : critical.length}
          tone="warn" icon={<AlertTriangle className="size-4" />}
          hint={calculated.length === 0
            ? 'not calculated yet'
            : 'zero float — a slip moves the finish date'}
          onClick={() => { setTab('gantt'); setCriticalOnly((v) => !v); }}
          active={criticalOnly}
          actionLabel="Show only the activities on the critical path" />
        <StatTile label="Crew assignments" value={crewAssignments.length} icon={<Users2 className="size-4" />}
          hint={`${new Set(crewAssignments.map((r) => r.resourceName)).size} distinct`}
          onClick={() => showTab('resources')} active={tab === 'resources'}
          actionLabel="Show the crew loading" />
        <StatTile label="Equipment assignments" value={assetAssignments.length} icon={<Truck className="size-4" />}
          hint={`${new Set(assetAssignments.map((r) => r.assetId)).size} machines`}
          onClick={() => showTab('resources')} active={tab === 'resources'}
          actionLabel="Show the equipment assignments" />
      </div>

      <Tabs value={tab} onValueChange={showTab}>
        <TabsList>
          <TabsTrigger value="gantt">Schedule</TabsTrigger>
          <TabsTrigger value="resources">Resource loading</TabsTrigger>
        </TabsList>

        <TabsContent value="gantt">
          <Card>
            <CardHeader>
              <CardTitle>
                {project ? (
                  <Link to={`/app/projects/${project.id}`} className="hover:underline">
                    {project.number} — {project.name}
                  </Link>
                ) : 'Schedule'}
              </CardTitle>
              <CardDescription>
                {calculation ? (
                  <>
                    {date(calculation.projectStart)} to {date(calculation.projectFinish)},{' '}
                    {qty(calculation.durationWorkingDays, 0)} working days. Calculated{' '}
                    {date(calculation.calculatedAt)} by {calculation.engineVersion} from a data date
                    of {date(calculation.dataDate)} — the dates and the float are computed from
                    durations and logic, and nothing here is typed in.
                    {calculation.finishFloatDays !== null ? (
                      <> The job finishes {qty(Math.abs(calculation.finishFloatDays), 0)} working
                        {' '}days {calculation.finishFloatDays < 0 ? 'after' : 'before'} the date
                        required of it.</>
                    ) : null}
                  </>
                ) : bounds ? (
                  <>
                    {date(bounds.start)} to {date(bounds.end)} as planned. Nobody has run the
                    critical path over this yet, so there is no float and no path to show.
                  </>
                ) : (
                  'No activities on this project yet.'
                )}
              </CardDescription>
              {criticalOnly ? (
                <div className="flex flex-wrap items-center gap-3 pt-2 text-sm text-charcoal-600">
                  <span>
                    Showing the {critical.length} {critical.length === 1 ? 'activity' : 'activities'} with
                    zero float.
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setCriticalOnly(false)}>
                    Show all {activities.length}
                  </Button>
                </div>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              {activitiesQ.status === 'loading' ? <LoadingState label="Reading the schedule" /> : null}
              {activitiesQ.status === 'error'
                ? <ErrorState message={activitiesQ.message} onRetry={activitiesQ.refetch} /> : null}
              {activitiesQ.status === 'ready' && activities.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No activities on this project"
                    description="A schedule is built from the project's tasks. Until there are activities there is nothing to calculate." />
                </div>
              ) : null}

              {activities.length > 0 ? (
                <div className="w-full overflow-x-auto">
                  <table className="w-full min-w-[52rem] text-sm">
                    <thead>
                      <tr className="border-b border-charcoal-200">
                        <th className="w-16 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-500">WBS</th>
                        <th className="min-w-56 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-500">Activity</th>
                        <th className="w-20 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-charcoal-500">Days</th>
                        <th className="w-24 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-charcoal-500">Float</th>
                        <th className="min-w-72 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-500">Timeline</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((a) => {
                        const s = new Date(a.plannedStart).getTime();
                        const e = new Date(a.plannedFinish).getTime();
                        const left = bounds
                          ? ((s - new Date(bounds.start).getTime()) / bounds.span) * 100 : 0;
                        // A milestone has no span; give it a visible minimum width.
                        const width = bounds
                          ? Math.max(((e - s) / bounds.span) * 100, 0.8) : 0.8;
                        return (
                          <tr key={a.id} className="border-b border-charcoal-200 last:border-0 hover:bg-charcoal-50/70">
                            <td className="px-3 py-2.5 font-mono text-xs text-charcoal-500">
                              {a.wbsCode ?? '—'}
                            </td>
                            <td className="px-3 py-2.5">
                              <p className="flex items-center gap-1.5 font-medium text-charcoal-900">
                                {a.isMilestone ? <Flag className="size-3.5 text-yellow-600" /> : null}
                                {a.name}
                              </p>
                              <p className="text-xs text-charcoal-500">
                                {date(a.plannedStart)} → {date(a.plannedFinish)}
                                {a.crewName ? ` · ${a.crewName}` : ''}
                              </p>
                            </td>
                            <td className="tabular px-3 py-2.5 text-right text-charcoal-600">
                              {a.isMilestone ? '—' : qty(a.durationDays, 0)}
                            </td>
                            <td className="tabular px-3 py-2.5 text-right font-medium">
                              {a.totalFloatDays === null ? (
                                <span className="text-xs font-normal text-charcoal-400"
                                  title="Float is computed by the critical path method, not typed. Calculate the schedule to fill this in.">
                                  not calculated
                                </span>
                              ) : (
                                <>
                                  <span className={a.totalFloatDays <= 0
                                    ? 'text-danger-700' : 'text-success-700'}>
                                    {qty(a.totalFloatDays, 0)}
                                  </span>
                                  {/*
                                    * Free float is the slip that moves nobody else. Where it
                                    * differs from total float, that difference is the whole
                                    * question of who else is affected.
                                    */}
                                  {a.freeFloatDays !== null && a.freeFloatDays !== a.totalFloatDays ? (
                                    <span className="block text-xs font-normal text-charcoal-500">
                                      {qty(a.freeFloatDays, 0)} free
                                    </span>
                                  ) : null}
                                </>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="relative h-6 rounded bg-charcoal-100">
                                <div
                                  className={cn('absolute inset-y-0 rounded',
                                    a.isMilestone ? 'bg-charcoal-900'
                                      : a.isCritical ? 'bg-yellow-500' : 'bg-charcoal-400')}
                                  style={{ left: `${left}%`, width: `${width}%` }}
                                  title={`${a.name}: ${date(a.plannedStart)} → ${date(a.plannedFinish)}`}
                                />
                                {a.percentComplete > 0 && !a.isMilestone ? (
                                  <div className="absolute inset-y-0 rounded bg-success-600"
                                    style={{ left: `${left}%`, width: `${width * a.percentComplete}%` }} />
                                ) : null}
                              </div>
                              <p className="tabular mt-1 text-xs text-charcoal-500">
                                {a.isMilestone ? 'Milestone' : `${percent(a.percentComplete, 0)} complete`}
                              </p>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="resources" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Equipment assignments</CardTitle>
              <CardDescription>
                Which machine is on which activity, and for how long. An assignment carries the
                fraction of the machine it consumes, so a hoe split across two activities is two
                halves rather than two whole machines.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {assignmentsQ.status === 'error'
                ? <ErrorState message={assignmentsQ.message} onRetry={assignmentsQ.refetch} /> : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Machine</TableHead>
                    <TableHead>Activity</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead className="text-right">Allocation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assetAssignments.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        {r.assetId ? (
                          <Link to={`/app/fleet?asset=${r.assetId}`}
                            className="font-mono text-xs hover:underline">
                            {r.assetCode ?? r.resourceName}
                          </Link>
                        ) : <span className="font-mono text-xs">{r.assetCode ?? '—'}</span>}
                        <p className="text-xs text-charcoal-500">{r.resourceName}</p>
                      </TableCell>
                      <TableCell className="text-charcoal-700">{r.activityName ?? '—'}</TableCell>
                      <TableCell className="text-charcoal-600">{date(r.startsOn)}</TableCell>
                      <TableCell className="text-charcoal-600">{date(r.endsOn)}</TableCell>
                      <TableCell className="tabular text-right">
                        {percent(r.allocation, 0)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {assetAssignments.length === 0 && assignmentsQ.status === 'ready' ? (
                <div className="p-6">
                  <EmptyState title="No equipment assigned on this project"
                    description="An assignment ties a machine to an activity for a span of days." />
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Crew loading</CardTitle>
              <CardDescription>Who is on this job, and against which activity.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Who</TableHead>
                    <TableHead>Activity</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead className="text-right">Allocation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {crewAssignments.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <span className="font-medium text-charcoal-900">{r.resourceName ?? '—'}</span>
                        <Badge variant="outline" className="ml-2">{r.kind}</Badge>
                      </TableCell>
                      <TableCell className="text-charcoal-700">{r.activityName ?? '—'}</TableCell>
                      <TableCell className="text-charcoal-600">{date(r.startsOn)}</TableCell>
                      <TableCell className="text-charcoal-600">{date(r.endsOn)}</TableCell>
                      <TableCell className="tabular text-right">{percent(r.allocation, 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {crewAssignments.length === 0 && assignmentsQ.status === 'ready' ? (
                <div className="p-6">
                  <EmptyState title="Nobody assigned on this project"
                    description="A crew or an employee is assigned to an activity for a span of days." />
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
