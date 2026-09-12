/**
 * Entity — the schedule of one project, as the screen that opens it needs it.
 *
 * `schedule.tsx` read `SCHEDULE` from `@/data/fleet`: a fixture whose dates
 * were computed once, at module load, by running the real CPM engine over
 * invented activities. So the page showed a correct calculation of a job that
 * does not exist, under a real project number — the billing-page defect again,
 * and the same shape as `project-detail` before 0142.
 *
 * Everything it needs was already in the schema and had never been read.
 * `schedule_activities` (0015) carries the WBS code, the planned and actual
 * dates, the duration, the float, whether the activity is critical, whether it
 * is a milestone, its crew and its constraint; `schedule_dependencies` carries
 * the logic with its type and lag; `resource_assignments` carries who and what
 * is on the job and for how long. Not one of the three had a reader anywhere in
 * the application before this file.
 *
 * **Float and critical are read, never computed here.** They are engine
 * outputs, and this platform does not let a browser write one — the same rule
 * that stops a typed price (0058). `recalculateSchedule` asks the Edge Function
 * that carries the engine to run the forward and backward pass and write the
 * result back, which is exactly how an estimate is priced.
 */
import { unwrap, type Query } from './query';
import { callFunction } from '@/lib/supabase';

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const maybeNum = (v: unknown): number | null =>
  (v === null || v === undefined ? null : Number(v));
const one = <T,>(v: unknown): T | null =>
  (Array.isArray(v) ? (v[0] as T | undefined) ?? null : (v as T | null));

export interface ScheduleActivityRow {
  id: string;
  wbsCode: string | null;
  name: string;
  plannedStart: string;
  plannedFinish: string;
  actualStart: string | null;
  actualFinish: string | null;
  durationDays: number;
  percentComplete: number;
  /** Null until the schedule has been calculated; it is an engine output. */
  totalFloatDays: number | null;
  freeFloatDays: number | null;
  earlyStart: string | null;
  earlyFinish: string | null;
  lateStart: string | null;
  lateFinish: string | null;
  /**
   * The run these came from. Null is the honest state of an activity nobody has
   * calculated, and 0029 says so out loud: float cannot be asserted, only
   * computed, so a row with no calculation has no float to show.
   */
  calculationId: string | null;
  isCritical: boolean;
  isMilestone: boolean;
  crewName: string | null;
  constraintType: string | null;
  constraintDate: string | null;
  sortOrder: number;
}

export interface ScheduleDependencyRow {
  id: string;
  predecessorId: string;
  successorId: string;
  dependencyType: 'finish_to_start' | 'start_to_start' | 'finish_to_finish' | 'start_to_finish';
  lagDays: number;
}

export interface ResourceAssignmentRow {
  id: string;
  activityId: string | null;
  activityName: string | null;
  kind: 'crew' | 'employee' | 'asset' | 'subcontractor';
  /** Whichever of the four the row points at, named. */
  resourceName: string | null;
  /** An asset's own code, so `EX-4412` is clickable rather than described. */
  assetCode: string | null;
  assetId: string | null;
  startsOn: string;
  endsOn: string;
  allocation: number;
  notes: string | null;
}

/**
 * The activities on one project, in the order a schedule is read.
 *
 * Sorted by `sort_order` then start, so two activities sharing an order do not
 * swap places between loads — the same reason every other list in this
 * application orders on a tiebreak.
 */
export const loadScheduleActivities = (projectId: string): Query<ScheduleActivityRow[]> =>
  async (client) => {
    const rows = unwrap(await client
      .from('schedule_activities')
      .select('id, wbs_code, name, planned_start, planned_finish, actual_start, actual_finish, '
        + 'duration_days, percent_complete, total_float_days, free_float_days, '
        + 'early_start, early_finish, late_start, late_finish, calculation_id, '
        + 'is_critical, is_milestone, constraint_type, constraint_date, sort_order, crews(name)')
      .eq('project_id', projectId)
      .order('sort_order')
      .order('planned_start')) as unknown as Array<Record<string, unknown>>;

    return rows.map((a) => ({
      id: String(a.id),
      wbsCode: (a.wbs_code as string | null) ?? null,
      name: String(a.name),
      plannedStart: String(a.planned_start),
      plannedFinish: String(a.planned_finish),
      actualStart: (a.actual_start as string | null) ?? null,
      actualFinish: (a.actual_finish as string | null) ?? null,
      durationDays: num(a.duration_days),
      percentComplete: num(a.percent_complete),
      totalFloatDays: maybeNum(a.total_float_days),
      freeFloatDays: maybeNum(a.free_float_days),
      earlyStart: (a.early_start as string | null) ?? null,
      earlyFinish: (a.early_finish as string | null) ?? null,
      lateStart: (a.late_start as string | null) ?? null,
      lateFinish: (a.late_finish as string | null) ?? null,
      calculationId: (a.calculation_id as string | null) ?? null,
      isCritical: a.is_critical === true,
      isMilestone: a.is_milestone === true,
      crewName: one<{ name: string }>(a.crews)?.name ?? null,
      constraintType: (a.constraint_type as string | null) ?? null,
      constraintDate: (a.constraint_date as string | null) ?? null,
      sortOrder: Number(a.sort_order ?? 0),
    }));
  };

/** The logic between them: which activity waits on which, in what way, and by how long. */
export const loadScheduleDependencies = (projectId: string): Query<ScheduleDependencyRow[]> =>
  async (client) => {
    /*
     * Filtered through the predecessor's project rather than carrying a
     * project of its own, because a dependency belongs to the two activities
     * and duplicating the project on it would be a third place to disagree.
     */
    const rows = unwrap(await client
      .from('schedule_dependencies')
      .select('id, predecessor_id, successor_id, dependency_type, lag_days, '
        + 'predecessor:schedule_activities!schedule_dependencies_predecessor_id_fkey(project_id)')
    ) as unknown as Array<Record<string, unknown>>;

    return rows
      .filter((d) => one<{ project_id: string }>(d.predecessor)?.project_id === projectId)
      .map((d) => ({
        id: String(d.id),
        predecessorId: String(d.predecessor_id),
        successorId: String(d.successor_id),
        dependencyType: d.dependency_type as ScheduleDependencyRow['dependencyType'],
        lagDays: num(d.lag_days),
      }));
  };

/** Who and what is on the job, and when. */
export const loadResourceAssignments = (projectId: string): Query<ResourceAssignmentRow[]> =>
  async (client) => {
    const rows = unwrap(await client
      .from('resource_assignments')
      .select('id, schedule_activity_id, resource_kind, starts_on, ends_on, allocation, notes, '
        + 'crews(name), employees(first_name, last_name), assets(code, name), vendors(name), '
        + 'schedule_activities(name)')
      .eq('project_id', projectId)
      .order('starts_on')) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => {
      const crew = one<{ name: string }>(r.crews);
      const emp = one<{ first_name: string; last_name: string }>(r.employees);
      const asset = one<{ code: string; name: string }>(r.assets);
      const vendor = one<{ name: string }>(r.vendors);
      const kind = r.resource_kind as ResourceAssignmentRow['kind'];
      return {
        id: String(r.id),
        activityId: (r.schedule_activity_id as string | null) ?? null,
        activityName: one<{ name: string }>(r.schedule_activities)?.name ?? null,
        kind,
        resourceName:
          kind === 'crew' ? crew?.name ?? null
            : kind === 'employee' ? (emp ? `${emp.first_name} ${emp.last_name}` : null)
              : kind === 'asset' ? asset?.name ?? null
                : vendor?.name ?? null,
        assetCode: asset?.code ?? null,
        assetId: (r.asset_id as string | null) ?? null,
        startsOn: String(r.starts_on),
        endsOn: String(r.ends_on),
        allocation: num(r.allocation),
        notes: (r.notes as string | null) ?? null,
      };
    });
  };

export interface ScheduleRecalculation {
  activities: number;
  /** Where the critical path ends, which is the date the job finishes. */
  projectFinish: string | null;
  criticalCount: number;
  /** Anything the engine could not do cleanly: a cycle, a dangling constraint. */
  warnings: string[];
}

/**
 * Recalculate the float and the critical path.
 *
 * The engine does this, not the browser and not a second implementation in SQL.
 * `calculateSchedule` already handles calendars, all four dependency types, lag
 * and constraints, and two implementations of a forward and backward pass would
 * eventually disagree about a job somebody has already bid. The Edge Function
 * carries the same compiled engine the pricing function does and writes the
 * result under the service role, because float and critical are engine outputs
 * and a browser may not write one.
 */
export async function recalculateSchedule(
  companyId: string, projectId: string,
): Promise<ScheduleRecalculation> {
  return callFunction<ScheduleRecalculation>('recalculate-schedule', { companyId, projectId });
}

export interface ScheduleCalculationRow {
  id: string;
  dataDate: string;
  engineVersion: string;
  projectStart: string;
  projectFinish: string;
  durationWorkingDays: number;
  requiredFinish: string | null;
  /** Working days between the computed finish and the required one. Negative is late. */
  finishFloatDays: number | null;
  criticalPath: string[];
  warnings: string[];
  calculatedAt: string;
}

/**
 * The latest run of the method on this project, or null because there has not
 * been one.
 *
 * Null is a state the page has to show rather than hide. An uncalculated
 * schedule is a list of intentions; saying so is more useful than rendering
 * empty float columns that look like zeros.
 */
export const loadLatestScheduleCalculation = (projectId: string): Query<ScheduleCalculationRow | null> =>
  async (client) => {
    const rows = unwrap(await client
      .from('my_latest_schedule_calculation')
      .select('id, data_date, engine_version, project_start, project_finish, '
        + 'duration_working_days, required_finish, finish_float_days, critical_path, '
        + 'warnings, calculated_at')
      .eq('project_id', projectId)
      .limit(1)) as unknown as Array<Record<string, unknown>>;

    const c = rows[0];
    if (!c) return null;
    return {
      id: String(c.id),
      dataDate: String(c.data_date),
      engineVersion: String(c.engine_version),
      projectStart: String(c.project_start),
      projectFinish: String(c.project_finish),
      durationWorkingDays: num(c.duration_working_days),
      requiredFinish: (c.required_finish as string | null) ?? null,
      finishFloatDays: maybeNum(c.finish_float_days),
      criticalPath: (c.critical_path as string[] | null) ?? [],
      warnings: (c.warnings as string[] | null) ?? [],
      calculatedAt: String(c.calculated_at),
    };
  };

export interface ProjectOption { id: string; number: string; name: string; status: string }

/** The projects a schedule could be read for, newest first. */
export const loadScheduleProjects: Query<ProjectOption[]> = async (client) => {
  const rows = unwrap(await client
    .from('projects')
    .select('id, number, name, status')
    .in('status', ['preconstruction', 'active', 'on_hold'])
    .order('number', { ascending: false })) as Array<Record<string, unknown>>;
  return rows.map((p) => ({
    id: String(p.id), number: String(p.number),
    name: String(p.name), status: String(p.status),
  }));
};
