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
  /** The task this was budgeted from, so an activity opens the cost it carries. */
  projectTaskId: string | null;
  /**
   * When somebody last changed it. Read against the calculation's own
   * `calculatedAt` this says whether the float on screen is still the float the
   * engine produced. 0158 forbids clearing an engine output by hand and is
   * right to, so staleness is shown rather than blanked.
   */
  updatedAt: string;
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
        + 'is_critical, is_milestone, constraint_type, constraint_date, sort_order, '
        + 'project_task_id, updated_at, crews(name)')
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
      projectTaskId: (a.project_task_id as string | null) ?? null,
      updatedAt: String(a.updated_at),
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
      /*
       * `assets(asset_number, ...)`, not `assets(code, ...)`. The column is
       * `asset_number` and always has been; the wrong name made PostgREST
       * refuse the whole request, so this reader returned nothing from the day
       * it was written. Invisible until 0183, because the table had no writer
       * and an erroring query and an empty one look identical on screen.
       *
       * `asset_id` is selected because the row maps it into a link to the
       * machine. It was read and never asked for, so every asset link was dead.
       */
      .select('id, schedule_activity_id, asset_id, resource_kind, starts_on, ends_on, '
        + 'allocation, notes, crews(name), employees(first_name, last_name), '
        + 'assets(asset_number, name), vendors(name), schedule_activities(name)')
      .eq('project_id', projectId)
      .order('starts_on')) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => {
      const crew = one<{ name: string }>(r.crews);
      const emp = one<{ first_name: string; last_name: string }>(r.employees);
      const asset = one<{ asset_number: string; name: string }>(r.assets);
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
        assetCode: asset?.asset_number ?? null,
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

export interface ProjectOption {
  id: string; number: string; name: string; status: string;
  /** Offered as the day the first activity starts, so built dates mean something. */
  plannedStart: string | null;
}

/** The projects a schedule could be read for, newest first. */
export const loadScheduleProjects: Query<ProjectOption[]> = async (client) => {
  const rows = unwrap(await client
    .from('projects')
    .select('id, number, name, status, planned_start')
    .in('status', ['preconstruction', 'active', 'on_hold'])
    .order('number', { ascending: false })) as Array<Record<string, unknown>>;
  return rows.map((p) => ({
    id: String(p.id), number: String(p.number),
    name: String(p.name), status: String(p.status),
    plannedStart: (p.planned_start as string | null) ?? null,
  }));
};

// -----------------------------------------------------------------------------
// The doors
//
// Everything above this line reads. Until migration 0183 there was nothing
// below it: no screen, no function and no migration wrote `work_calendars`,
// `schedule_activities`, `schedule_dependencies` or `resource_assignments`, so
// the engine had never run on a real job and the "Calculate the schedule"
// button was disabled on a condition that could never be false.
// -----------------------------------------------------------------------------

type RpcCapable = {
  rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const call = async (client: RpcCapable, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data === null || data === undefined ? '' : String(data);
};

export interface SchedulableProject {
  taskCount: number;
  /** Budgeted tasks with no activity yet — what "build the schedule" would make. */
  unscheduledTaskCount: number;
  activityCount: number;
}

/**
 * How much work on this project is waiting to be scheduled.
 *
 * Counted in the database rather than in the browser, so the offer and the
 * function that fulfills it read the same rows through the same rules.
 */
export const loadSchedulable = (projectId: string): Query<SchedulableProject | null> =>
  async (client) => {
    if (!projectId) return null;
    const rows = unwrap(await client
      .from('my_schedulable_projects')
      .select('task_count, unscheduled_task_count, activity_count')
      .eq('project_id', projectId)
      .limit(1)) as unknown as Array<Record<string, unknown>>;
    const r = rows[0];
    if (!r) return null;
    return {
      taskCount: num(r.task_count),
      unscheduledTaskCount: num(r.unscheduled_task_count),
      activityCount: num(r.activity_count),
    };
  };

/**
 * Build one activity per budgeted task.
 *
 * Returns how many were made. Zero is a real answer and the page says so: it
 * means every task already has an activity, which is what running it twice
 * should do.
 */
export async function buildScheduleFromTasks(
  client: RpcCapable, projectId: string, start?: string | null,
): Promise<number> {
  return Number(await call(client, 'build_schedule_from_tasks', {
    p_project: projectId, p_start: start || null,
  }));
}

/** Add an activity that came from no priced line — a permit, a cure, a milestone. */
export async function addScheduleActivity(
  client: RpcCapable,
  input: {
    projectId: string; name: string; start: string; durationDays?: number;
    isMilestone?: boolean; wbsCode?: string | null; crewId?: string | null;
  },
): Promise<string> {
  return call(client, 'add_schedule_activity', {
    p_project: input.projectId,
    p_name: input.name.trim(),
    p_start: input.start,
    p_duration: input.durationDays ?? 1,
    p_milestone: input.isMilestone ?? false,
    p_wbs_code: input.wbsCode?.trim() || null,
    p_crew: input.crewId ?? null,
  });
}

/**
 * Change an activity.
 *
 * Nothing here touches float, the critical flag or the calculation link. Those
 * are engine outputs and 0158 refuses a write to one, which is the point: a
 * plan moved by hand leaves the last calculation standing and visibly stale
 * rather than silently blanked.
 */
export async function updateScheduleActivity(
  client: RpcCapable,
  input: {
    activityId: string; name?: string | null; start?: string | null;
    finish?: string | null; durationDays?: number | null; crewId?: string | null;
    isMilestone?: boolean | null; wbsCode?: string | null;
    percentComplete?: number | null; actualStart?: string | null;
    actualFinish?: string | null; constraintType?: string | null;
    constraintDate?: string | null; clearConstraint?: boolean;
  },
): Promise<void> {
  await call(client, 'update_schedule_activity', {
    p_activity: input.activityId,
    p_name: input.name?.trim() || null,
    p_start: input.start || null,
    p_finish: input.finish || null,
    p_duration: input.durationDays ?? null,
    p_crew: input.crewId ?? null,
    p_milestone: input.isMilestone ?? null,
    p_wbs_code: input.wbsCode?.trim() || null,
    p_percent: input.percentComplete ?? null,
    p_actual_start: input.actualStart || null,
    p_actual_finish: input.actualFinish || null,
    p_constraint_type: input.constraintType || null,
    p_constraint_date: input.constraintDate || null,
    p_clear_constraint: input.clearConstraint ?? false,
  });
}

/** Remove an activity. Its logic goes with it; the task it was built from stays. */
export async function removeScheduleActivity(
  client: RpcCapable, activityId: string,
): Promise<void> {
  await call(client, 'remove_schedule_activity', { p_activity: activityId });
}

/** Say that one activity follows another. */
export async function addScheduleDependency(
  client: RpcCapable,
  input: {
    predecessorId: string; successorId: string;
    type?: ScheduleDependencyRow['dependencyType']; lagDays?: number;
  },
): Promise<string> {
  return call(client, 'add_schedule_dependency', {
    p_predecessor: input.predecessorId,
    p_successor: input.successorId,
    p_type: input.type ?? 'finish_to_start',
    p_lag_days: input.lagDays ?? 0,
  });
}

/** Change a link's type or its lag without removing and re-adding it. */
export async function updateScheduleDependency(
  client: RpcCapable,
  input: {
    linkId: string; type?: ScheduleDependencyRow['dependencyType'] | null;
    lagDays?: number | null;
  },
): Promise<void> {
  await call(client, 'update_schedule_dependency', {
    p_link: input.linkId,
    p_type: input.type ?? null,
    p_lag_days: input.lagDays ?? null,
  });
}

/** Unlink two activities. */
export async function removeScheduleDependency(
  client: RpcCapable, linkId: string,
): Promise<void> {
  await call(client, 'remove_schedule_dependency', { p_link: linkId });
}

/**
 * Put a crew, a person, a machine or a subcontractor on an activity.
 *
 * Dates default to the activity's own, because the common case is "this crew on
 * this activity" and asking for them again invites two answers to one question.
 */
export async function assignResource(
  client: RpcCapable,
  input: {
    activityId: string; kind: ResourceAssignmentRow['kind'];
    crewId?: string | null; employeeId?: string | null; assetId?: string | null;
    vendorId?: string | null; startsOn?: string | null; endsOn?: string | null;
    allocation?: number; notes?: string | null;
  },
): Promise<string> {
  return call(client, 'assign_resource', {
    p_activity: input.activityId,
    p_kind: input.kind,
    p_crew: input.crewId ?? null,
    p_employee: input.employeeId ?? null,
    p_asset: input.assetId ?? null,
    p_vendor: input.vendorId ?? null,
    p_starts_on: input.startsOn || null,
    p_ends_on: input.endsOn || null,
    p_allocation: input.allocation ?? 1,
    p_notes: input.notes?.trim() || null,
  });
}

/** Change the dates, the share or the note on an assignment. */
export async function updateResourceAssignment(
  client: RpcCapable,
  input: {
    assignmentId: string; startsOn?: string | null; endsOn?: string | null;
    allocation?: number | null; notes?: string | null;
  },
): Promise<void> {
  await call(client, 'update_resource_assignment', {
    p_assignment: input.assignmentId,
    p_starts_on: input.startsOn || null,
    p_ends_on: input.endsOn || null,
    p_allocation: input.allocation ?? null,
    p_notes: input.notes?.trim() || null,
  });
}

/** Take a crew, a person or a machine back off an activity. */
export async function releaseResource(
  client: RpcCapable, assignmentId: string,
): Promise<void> {
  await call(client, 'release_resource', { p_assignment: assignmentId });
}

export interface WorkCalendarRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  /** 0 is Sunday, matching every date library anyone will read this beside. */
  workingWeekdays: number[];
  hoursPerDay: number;
  isDefault: boolean;
  /** How much work is scheduled on it, so changing the day is a visible decision. */
  activityCount: number;
}

/** The company's working weeks. */
export const loadWorkCalendars: Query<WorkCalendarRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_work_calendars')
    .select('id, code, name, description, working_weekdays, hours_per_day, '
      + 'is_default, activity_count')
    .order('is_default', { ascending: false })
    .order('code')) as unknown as Array<Record<string, unknown>>;
  return rows.map((c) => ({
    id: String(c.id),
    code: String(c.code),
    name: String(c.name),
    description: (c.description as string | null) ?? null,
    workingWeekdays: ((c.working_weekdays as number[] | null) ?? []).map(Number),
    hoursPerDay: num(c.hours_per_day),
    isDefault: c.is_default === true,
    activityCount: num(c.activity_count),
  }));
};

/**
 * Give the company a working week if it has none.
 *
 * The Edge Function refuses to calculate without one, and it is right to:
 * dates produced from a week nobody agreed to are dates nobody can be held to.
 */
export async function ensureWorkCalendar(
  client: RpcCapable, companyId: string,
): Promise<string> {
  return call(client, 'ensure_work_calendar', { p_company: companyId });
}

/** Change a working week. */
export async function updateWorkCalendar(
  client: RpcCapable,
  input: {
    calendarId: string; name?: string | null; description?: string | null;
    workingWeekdays?: number[] | null; hoursPerDay?: number | null;
    isDefault?: boolean | null;
  },
): Promise<void> {
  await call(client, 'update_work_calendar', {
    p_calendar: input.calendarId,
    p_name: input.name?.trim() || null,
    p_description: input.description ?? null,
    p_weekdays: input.workingWeekdays ?? null,
    p_hours: input.hoursPerDay ?? null,
    p_is_default: input.isDefault ?? null,
  });
}

export interface AssignableResource {
  id: string;
  kind: ResourceAssignmentRow['kind'];
  /** What a person would call it: the crew's name, the operator's, the machine's. */
  label: string;
  /** The asset number or the crew code, shown beside the name so two alike are told apart. */
  code: string | null;
}

/**
 * Everything that can be put on an activity, in one list.
 *
 * Four lightweight reads rather than the full fleet and roster loaders, because
 * a picker needs a name and an id and nothing else, and pulling meter readings
 * and credential expiry to fill a dropdown is how a fast screen becomes a slow
 * one.
 */
export const loadAssignableResources: Query<AssignableResource[]> = async (client) => {
  const [crews, employees, assets, vendors] = await Promise.all([
    unwrap(await client.from('crews').select('id, code, name')
      .eq('status', 'active').order('name').limit(300)) as Array<Record<string, unknown>>,
    unwrap(await client.from('employees').select('id, employee_number, full_name')
      .neq('status', 'terminated').order('full_name').limit(500)) as Array<Record<string, unknown>>,
    unwrap(await client.from('assets').select('id, asset_number, name')
      .is('disposed_on', null).order('asset_number').limit(500)) as Array<Record<string, unknown>>,
    unwrap(await client.from('vendors').select('id, name')
      .eq('status', 'active').order('name').limit(500)) as Array<Record<string, unknown>>,
  ]);

  return [
    ...crews.map((c) => ({
      id: String(c.id), kind: 'crew' as const,
      label: String(c.name), code: (c.code as string | null) ?? null,
    })),
    ...employees.map((e) => ({
      id: String(e.id), kind: 'employee' as const,
      label: String(e.full_name), code: (e.employee_number as string | null) ?? null,
    })),
    ...assets.map((a) => ({
      id: String(a.id), kind: 'asset' as const,
      label: String(a.name), code: (a.asset_number as string | null) ?? null,
    })),
    ...vendors.map((v) => ({
      id: String(v.id), kind: 'subcontractor' as const,
      label: String(v.name), code: null,
    })),
  ];
};

export interface ScheduleBaselineRow {
  id: string;
  name: string;
  takenOn: string;
  reason: string;
  approvedBy: string | null;
  engineVersion: string | null;
  baselinedFinish: string | null;
  activityCount: number;
  /** Derived from the ordering, because an append-only table cannot carry a flag. */
  isCurrent: boolean;
}

/** The baselines on a project, newest first. */
export const loadScheduleBaselines = (projectId: string): Query<ScheduleBaselineRow[]> =>
  async (client) => {
    if (!projectId) return [];
    const rows = unwrap(await client
      .from('my_schedule_baselines')
      .select('id, name, taken_on, reason, approved_by, engine_version, '
        + 'baselined_finish, activity_count, is_current')
      .eq('project_id', projectId)
      .order('taken_on', { ascending: false })) as unknown as Array<Record<string, unknown>>;
    return rows.map((b) => ({
      id: String(b.id),
      name: String(b.name),
      takenOn: String(b.taken_on),
      reason: String(b.reason),
      approvedBy: (b.approved_by as string | null) ?? null,
      engineVersion: (b.engine_version as string | null) ?? null,
      baselinedFinish: (b.baselined_finish as string | null) ?? null,
      activityCount: num(b.activity_count),
      isCurrent: b.is_current === true,
    }));
  };

/**
 * Take a baseline: the schedule as approved, kept so today can be read against
 * it. Refused on a schedule nobody has calculated — a baseline of typed dates
 * would be a guess to measure every later variance against.
 */
export async function takeScheduleBaseline(
  client: RpcCapable,
  input: { projectId: string; name: string; reason: string; takenOn?: string | null },
): Promise<string> {
  return call(client, 'take_schedule_baseline', {
    p_project: input.projectId,
    p_name: input.name.trim(),
    p_reason: input.reason.trim(),
    p_taken_on: input.takenOn || null,
  });
}

export interface ScheduleVarianceRow {
  activityId: string;
  activityName: string;
  wbsCode: string | null;
  baselineStart: string | null;
  baselineFinish: string | null;
  currentStart: string;
  currentFinish: string;
  startVarianceDays: number | null;
  finishVarianceDays: number | null;
  status: 'behind' | 'ahead' | 'on_baseline' | 'not_in_baseline';
  isCritical: boolean;
  percentComplete: number;
}

/**
 * Every activity against the project's current baseline.
 *
 * `reporting_schedule_variance` has existed since 0029 and returned no rows on
 * every project, because it joins the current baseline and nothing could take
 * one. Variance is in calendar days here; working-day variance is the engine's,
 * which knows the calendar.
 */
export const loadScheduleVariance = (projectId: string): Query<ScheduleVarianceRow[]> =>
  async (client) => {
    if (!projectId) return [];
    const rows = unwrap(await client
      .from('reporting_schedule_variance')
      .select('schedule_activity_id, activity_name, wbs_code, baseline_start, '
        + 'baseline_finish, current_start, current_finish, start_variance_days, '
        + 'finish_variance_days, status, is_critical, percent_complete')
      .eq('project_id', projectId)) as unknown as Array<Record<string, unknown>>;
    return rows.map((v) => ({
      activityId: String(v.schedule_activity_id),
      activityName: String(v.activity_name),
      wbsCode: (v.wbs_code as string | null) ?? null,
      baselineStart: (v.baseline_start as string | null) ?? null,
      baselineFinish: (v.baseline_finish as string | null) ?? null,
      currentStart: String(v.current_start),
      currentFinish: String(v.current_finish),
      startVarianceDays: maybeNum(v.start_variance_days),
      finishVarianceDays: maybeNum(v.finish_variance_days),
      status: v.status as ScheduleVarianceRow['status'],
      isCritical: v.is_critical === true,
      percentComplete: num(v.percent_complete),
    }));
  };
