import {
  CalendarDays, AlertTriangle, GitBranch, Flag, Users2, Truck, Plus,
} from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, Progress } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SCHEDULE, SCHEDULE_CALCULATION, FIELD_CALENDAR, ASSETS, EMPLOYEES } from '@/data/fleet';
import { CREWS } from '@/data/catalog';
import { percent, qty, date, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The bar chart window: earliest planned start to latest planned finish.
 *
 * The bounds are kept as the original "YYYY-MM-DD" strings for display, because
 * round-tripping them through `toISOString()` would reintroduce the UTC shift
 * that renders a 4 May start as 3 May.
 */
const START_STR = SCHEDULE.reduce((min, a) => (a.plannedStart < min ? a.plannedStart : min), SCHEDULE[0]!.plannedStart);
const END_STR = SCHEDULE.reduce((max, a) => (a.plannedFinish > max ? a.plannedFinish : max), SCHEDULE[0]!.plannedFinish);
const START = new Date(START_STR);
const END = new Date(END_STR);
const SPAN_MS = END.getTime() - START.getTime();

function barGeometry(a: (typeof SCHEDULE)[number]) {
  const s = new Date(a.plannedStart).getTime();
  const e = new Date(a.plannedFinish).getTime();
  return {
    left: ((s - START.getTime()) / SPAN_MS) * 100,
    // A milestone has zero duration; give it a visible minimum width.
    width: Math.max(((e - s) / SPAN_MS) * 100, 0.8),
  };
}

export function SchedulePage() {
  const critical = SCHEDULE.filter((a) => a.isCritical);
  const complete = SCHEDULE.filter((a) => a.percentComplete >= 1);
  const inProgress = SCHEDULE.filter((a) => a.percentComplete > 0 && a.percentComplete < 1);
  const criticalInProgress = critical.filter((a) => a.percentComplete > 0 && a.percentComplete < 1);

  const assignedAssets = ASSETS.filter((a) => a.assignedProject);
  const assignedPeople = EMPLOYEES.filter((e) => e.assignedProject);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule & Resources"
        description="Activities carry the estimate line they were scheduled from, so a duration can always be read against the production rate that produced it."
        actions={
          <>
            <Button variant="outline"><GitBranch className="size-4" /> Look-ahead</Button>
            <Button><Plus className="size-4" /> Add activity</Button>
          </>
        }
      />

      {criticalInProgress.length ? (
        <Alert tone="warn" icon={<AlertTriangle className="size-4" />}
          title={`${plural(criticalInProgress.length, 'critical-path activity', 'critical-path activities')} in progress with zero float`}>
          {criticalInProgress.map((a) => `${a.wbs} ${a.name}`).join('; ')}. Any slip here moves substantial
          completion day for day — there is no float to absorb it.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Activities" value={SCHEDULE.length} icon={<CalendarDays className="size-4" />}
          hint={`${complete.length} complete, ${inProgress.length} in progress`} />
        <StatTile label="Critical path" value={critical.length} tone="warn" icon={<AlertTriangle className="size-4" />}
          hint="zero float — a slip moves the finish date" />
        <StatTile label="Crews assigned" value={assignedPeople.length} icon={<Users2 className="size-4" />}
          hint={`across ${new Set(assignedPeople.map((e) => e.assignedProject)).size} projects`} />
        <StatTile label="Equipment assigned" value={assignedAssets.length} icon={<Truck className="size-4" />}
          hint={`${ASSETS.length - assignedAssets.length} unassigned`} />
      </div>

      <Tabs defaultValue="gantt">
        <TabsList>
          <TabsTrigger value="gantt">Schedule</TabsTrigger>
          <TabsTrigger value="resources">Resource loading</TabsTrigger>
        </TabsList>

        <TabsContent value="gantt">
          <Card>
            <CardHeader>
              <CardTitle>PRJ-2026-011 — Maumee Commerce Park Phase 2</CardTitle>
              <CardDescription>
                {date(START_STR)} to {date(END_STR)}, {qty(SCHEDULE_CALCULATION.durationWorkingDays, 0)} working
                days on the {FIELD_CALENDAR.name}. Dates and float are computed by the critical path
                engine from durations and logic — nothing here is typed in. The path runs{' '}
                <span className="font-medium text-charcoal-700">
                  {SCHEDULE_CALCULATION.criticalPath
                    .map((id) => SCHEDULE.find((a) => a.id === id)?.wbs ?? id).join(' → ')}
                </span>
                . Three holidays fall inside it — Memorial Day, Independence Day observed and Labor
                Day — and the schedule works around them rather than through them.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="w-full overflow-x-auto">
                <table className="w-full min-w-[52rem] text-sm">
                  <thead>
                    <tr className="border-b border-charcoal-200">
                      <th className="w-16 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-500">WBS</th>
                      <th className="min-w-56 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-500">Activity</th>
                      <th className="w-20 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-charcoal-500">Days</th>
                      <th className="w-20 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-charcoal-500">Float</th>
                      <th className="min-w-72 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-500">Timeline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SCHEDULE.map((a) => {
                      const g = barGeometry(a);
                      return (
                        <tr key={a.id} className="border-b border-charcoal-200 last:border-0 hover:bg-charcoal-50/70">
                          <td className="px-3 py-2.5 font-mono text-xs text-charcoal-500" title={a.derivation}>{a.wbs}</td>
                          <td className="px-3 py-2.5">
                            <p className="flex items-center gap-1.5 font-medium text-charcoal-900">
                              {a.isMilestone ? <Flag className="size-3.5 text-yellow-600" /> : null}
                              {a.name}
                            </p>
                            <p className="text-xs text-charcoal-500">
                              {date(a.plannedStart)} → {date(a.plannedFinish)}
                              {a.crew ? ` · ${CREWS[a.crew]?.name ?? a.crew}` : ''}
                            </p>
                          </td>
                          <td className="tabular px-3 py-2.5 text-right text-charcoal-600">
                            {a.isMilestone ? '—' : qty(a.durationDays, 0)}
                          </td>
                          <td className={cn('tabular px-3 py-2.5 text-right font-medium',
                            a.totalFloatDays <= 0 ? 'text-danger-700' : 'text-success-700')}
                            title={a.derivation}>
                            {qty(a.totalFloatDays, 0)}
                            {a.freeFloatDays !== a.totalFloatDays ? (
                              // Free float is the slip that moves nobody else. Where it
                              // differs from total float, that difference is the whole
                              // question of who else is affected.
                              <span className="block text-xs font-normal text-charcoal-500">
                                {qty(a.freeFloatDays, 0)} free
                              </span>
                            ) : null}
                            {a.freeFloatDays !== a.totalFloatDays ? (
                              <span className="block text-xs font-normal text-charcoal-500">
                                {qty(a.freeFloatDays, 0)} free
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="relative h-6 rounded bg-charcoal-100">
                              <div
                                className={cn('absolute inset-y-0 rounded',
                                  a.isMilestone ? 'bg-charcoal-900'
                                    : a.isCritical ? 'bg-yellow-500' : 'bg-charcoal-400')}
                                style={{ left: `${g.left}%`, width: `${g.width}%` }}
                                title={`${a.name}: ${date(a.plannedStart)} → ${date(a.plannedFinish)}`}
                              />
                              {a.percentComplete > 0 && !a.isMilestone ? (
                                <div
                                  className="absolute inset-y-0 rounded bg-success-600"
                                  style={{ left: `${g.left}%`, width: `${g.width * a.percentComplete}%` }}
                                />
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="resources" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Equipment assignments</CardTitle>
              <CardDescription>
                A machine cannot be booked to two jobs over the same dates — the database enforces it with an
                exclusion constraint, so the clash surfaces when it is scheduled rather than on Monday morning.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Operator</TableHead>
                    <TableHead className="min-w-32">Utilization</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ASSETS.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <p className="font-medium text-charcoal-900">{a.assetNumber}</p>
                        <p className="text-xs text-charcoal-500">{a.name}</p>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-charcoal-600">
                        {a.assignedProject ?? <span className="font-sans text-charcoal-400">unassigned</span>}
                      </TableCell>
                      <TableCell className="text-charcoal-600">{a.assignedOperator ?? '—'}</TableCell>
                      <TableCell>
                        <Progress value={a.utilization30d * 100}
                          indicatorClassName={a.utilization30d < 0.35 ? 'bg-danger-500' : 'bg-success-600'} />
                        <p className="tabular mt-1 text-xs text-charcoal-500">{percent(a.utilization30d, 0)}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.status === 'assigned' ? 'info' : a.status === 'available' ? 'success' : 'warn'}>
                          {a.status.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Crew loading</CardTitle>
              <CardDescription>Who is on which job this week.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Classification</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Credentials</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {EMPLOYEES.map((e) => {
                    const bad = e.credentials.filter((c) => c.status !== 'valid').length;
                    return (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium text-charcoal-900">{e.name}</TableCell>
                        <TableCell className="text-charcoal-600">{e.classification}</TableCell>
                        <TableCell className="font-mono text-xs text-charcoal-600">
                          {e.assignedProject ?? <span className="font-sans text-charcoal-400">unassigned</span>}
                        </TableCell>
                        <TableCell>
                          {bad ? <Badge variant="warn">{bad} need attention</Badge> : <Badge variant="success">All valid</Badge>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
