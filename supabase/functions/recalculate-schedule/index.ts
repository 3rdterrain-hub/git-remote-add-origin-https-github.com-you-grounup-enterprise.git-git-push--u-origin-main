/**
 * POST /functions/v1/recalculate-schedule
 *
 * Run the critical path method over a project's schedule.
 *
 * This is the only path by which float comes to exist. Since migration 0158 the
 * computed columns on `schedule_activities` — the early and late dates, total
 * and free float, the critical flag and the calculation link — refuse a
 * hand-written value, and `app.record_schedule_calculation` is granted to
 * `service_role` alone. A browser holds the anon key and a user's JWT and can
 * reach neither. The same boundary 0058 drew around a price, for the same
 * reason: a person plans, and the method says what the plan implies.
 *
 * The checks stand in the same order as `price-estimate`:
 *
 *   1. **Authentication.** No caller, no calculation.
 *   2. **Authorization**, asked of the database through the caller's own client,
 *      so the answer is the one row level security would give.
 *   3. **Loading through the caller's client.** A caller who cannot see a
 *      project cannot cause it to be scheduled; the service role is used for
 *      the write and for nothing else.
 *
 * The data date is the caller's or today's, and it is not cosmetic: on an
 * update cycle the forward pass starts from the data date rather than the
 * project start, which is the difference between a schedule and a plan somebody
 * drew once.
 *
 * Deploy: supabase functions deploy recalculate-schedule
 */
import { getCaller, requirePermission, isUuid, adminClient } from '../_shared/auth.ts';
import { fail, json, preflight } from '../_shared/http.ts';
import { calculateSchedule } from '../_shared/engine/schedule.js';
import type {
  ConstraintType, DependencyType, ScheduleActivity, ScheduleDependency,
} from '../_shared/engine/schedule.d.ts';
import type { WorkCalendar, Weekday } from '../_shared/engine/calendar.d.ts';

/** A PostgREST row, once past the client's own view of what a select returns. */
type Row = Record<string, unknown>;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The engine's own version, reported so a calculation names what produced it. */
const ENGINE_VERSION = 'grounup-engine/schedule@1';

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405, origin);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  if (!isUuid(projectId)) return fail('bad_request', 'projectId must be a uuid.', 400, origin);
  if (!isUuid(companyId)) return fail('bad_request', 'companyId must be a uuid.', 400, origin);

  const caller = await getCaller(req);
  if (!caller) return fail('unauthenticated', 'Sign in first.', 401, origin);

  const allowed = await requirePermission(caller, companyId, 'projects.write');
  if (!allowed.ok) return fail('forbidden', allowed.reason, 403, origin);

  const client = caller.client;

  // Read as the caller. A project they cannot see is a project they cannot
  // cause to be calculated.
  const { data: activities, error: actError } = await client
    .from('schedule_activities')
    .select('id, name, duration_days, is_milestone, constraint_type, constraint_date, '
      + 'calendar_id, planned_start')
    .eq('project_id', projectId)
    .order('sort_order');
  if (actError) return fail('read_failed', actError.message, 400, origin);
  if (!activities || activities.length === 0) {
    return json({ error: {
      code: 'nothing_to_calculate',
      message: 'This project has no schedule activities yet.',
    } }, 422, origin);
  }

  const rows = activities as unknown as Row[];
  const ids = new Set(rows.map((a) => String(a.id)));

  const { data: deps, error: depError } = await client
    .from('schedule_dependencies')
    .select('predecessor_id, successor_id, dependency_type, lag_days');
  if (depError) return fail('read_failed', depError.message, 400, origin);

  /*
   * Only the logic inside this project. A dependency row carries no project of
   * its own — it belongs to the two activities — so the filter is on those.
   */
  const dependencies: ScheduleDependency[] = ((deps ?? []) as unknown as Row[])
    .filter((d) => ids.has(String(d.predecessor_id)) && ids.has(String(d.successor_id)))
    .map((d) => ({
      predecessorId: String(d.predecessor_id),
      successorId: String(d.successor_id),
      type: String(d.dependency_type) as DependencyType,
      lagDays: Number(d.lag_days ?? 0),
    }));

  const { data: calendars, error: calError } = await client
    .from('work_calendars')
    .select('id, name, working_weekdays, is_default, work_calendar_exceptions(exception_date, kind)')
    .eq('company_id', companyId);
  if (calError) return fail('read_failed', calError.message, 400, origin);
  if (!calendars || calendars.length === 0) {
    /*
     * A duration in days is not a span of dates until something says which days
     * are worked (0029). Refusing is the honest answer; inventing a five-day
     * week here would put dates on a page that the company never agreed to.
     */
    return json({ error: {
      code: 'no_calendar',
      message: 'This company has no work calendar, so a duration in days is not yet a span of dates.',
    } }, 422, origin);
  }

  const calendarRows = calendars as unknown as Row[];
  const engineCalendars: WorkCalendar[] = calendarRows.map((c) => {
    const exceptions = (c.work_calendar_exceptions ?? []) as Row[];
    return {
      id: String(c.id),
      name: String(c.name),
      workingWeekdays: (c.working_weekdays as number[]) as Weekday[],
      holidays: exceptions.filter((e) => e.kind === 'holiday')
        .map((e) => String(e.exception_date)),
      workingExceptions: exceptions.filter((e) => e.kind === 'working')
        .map((e) => String(e.exception_date)),
    };
  });

  const fallback = calendarRows.find((c) => c.is_default === true) ?? calendarRows[0]!;
  const defaultCalendarId = String(fallback.id);

  const dataDate = typeof body.dataDate === 'string' && ISO.test(body.dataDate)
    ? body.dataDate
    : new Date().toISOString().slice(0, 10);
  const requiredFinish = typeof body.requiredFinish === 'string' && ISO.test(body.requiredFinish)
    ? body.requiredFinish
    : undefined;

  let result;
  try {
    result = calculateSchedule({
      dataDate,
      defaultCalendarId,
      calendars: engineCalendars,
      activities: rows.map((a): ScheduleActivity => ({
        id: String(a.id),
        name: String(a.name),
        /* A milestone is an event with a date and no span, which the engine
           expresses as a duration of zero rather than as a separate kind. */
        durationDays: a.is_milestone === true ? 0 : Number(a.duration_days ?? 0),
        calendarId: a.calendar_id ? String(a.calendar_id) : undefined,
        constraintType: a.constraint_type
          ? String(a.constraint_type) as ConstraintType : undefined,
        constraintDate: a.constraint_date ? String(a.constraint_date) : undefined,
      })),
      dependencies,
      requiredFinish,
    });
  } catch (err) {
    /*
     * The method refusing to run is a real answer about the schedule — a cycle
     * in the logic, a constraint that cannot be met — not a server fault.
     */
    return json({ error: {
      code: 'cannot_calculate',
      message: err instanceof Error ? err.message : 'The schedule could not be calculated.',
    } }, 422, origin);
  }

  const calculated = result.activities;
  /*
   * The engine's own `criticalPath` is the longest connected chain in order,
   * which is not the same set as "every activity with zero float" — a schedule
   * can carry several critical strands and only one of them is the path. The
   * column stores the path; the count reports the strands, and saying either
   * one was the other would be a different claim about the job.
   */
  const criticalPath = [...result.criticalPath];
  const criticalCount = calculated.filter((a) => a.isCritical).length;

  // The one writer. Service role, because nothing else may write float.
  const { data: calcId, error: writeError } = await adminClient()
    .rpc('record_schedule_calculation', {
      p_company: companyId,
      p_project: projectId,
      p_data_date: dataDate,
      p_engine_version: ENGINE_VERSION,
      p_calendar: defaultCalendarId,
      p_project_start: result.projectStart,
      p_project_finish: result.projectFinish,
      p_duration_working_days: result.durationWorkingDays,
      p_required_finish: requiredFinish ?? null,
      p_finish_float_days: result.finishFloatDays ?? null,
      p_critical_path: criticalPath,
      p_warnings: [...result.warnings],
      p_activities: calculated.map((a) => ({
        id: a.id,
        early_start: a.earlyStart,
        early_finish: a.earlyFinish,
        late_start: a.lateStart,
        late_finish: a.lateFinish,
        total_float_days: a.totalFloatDays,
        free_float_days: a.freeFloatDays,
        is_critical: a.isCritical,
      })),
    });
  if (writeError) return fail('write_failed', writeError.message, 400, origin);

  return json({
    calculationId: calcId,
    engineVersion: ENGINE_VERSION,
    activities: calculated.length,
    projectStart: result.projectStart,
    projectFinish: result.projectFinish,
    durationWorkingDays: result.durationWorkingDays,
    criticalCount,
    criticalPathLength: criticalPath.length,
    finishFloatDays: result.finishFloatDays ?? null,
    warnings: [...result.warnings],
  }, 200, origin);
});
