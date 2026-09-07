/**
 * The time clock.
 *
 * `time_entries` — the only place time lived until migration 0122 — is a
 * timecard: hours per day, typed after the fact, behind `projects.write`. It is
 * what payroll needs and it is not what somebody does at 6:41 in the morning
 * standing at a job trailer.
 *
 * Two things in here are worth knowing before reading the components:
 *
 *   * The database refuses out-of-order punches with a sentence rather than an
 *     error code — "On break. End the break before clocking out." — so the
 *     screen shows what came back instead of translating it. There is one
 *     wording of each refusal and it lives in the migration, where the rule is.
 *
 *   * `standing` and `sinceMinutes` are read from the view, not computed here.
 *     A running total the browser calculates from a start time drifts from the
 *     one payroll will post, and the two disagreeing about a person's day is
 *     precisely the argument this feature exists to prevent.
 */
import { unwrap, type Query } from './query';
import { supabase } from '@/lib/supabase';

export type PunchKind = 'in' | 'out' | 'break_start' | 'break_end';
export type Standing = 'On the clock' | 'On break' | 'Off the clock';

export interface ClockRow {
  employeeId: string;
  companyId: string;
  employeeName: string;
  employeeNumber: string;
  standing: Standing;
  state: PunchKind | null;
  since: string | null;
  projectId: string | null;
  projectName: string | null;
  workedMinutes: number;
  breakMinutes: number;
  stillOpen: boolean;
}

export interface PunchRow {
  id: string;
  employeeId: string;
  employeeName: string;
  kind: PunchKind;
  punchedAt: string;
  workDate: string;
  projectName: string | null;
  costCode: string | null;
  source: string;
  note: string | null;
  voided: boolean;
  voidReason: string | null;
  punchedBySomebodyElse: boolean;
}

const CLOCK_COLUMNS =
  'employee_id, company_id, employee_name, employee_number, standing, state, since,'
  + ' project_id, project_name, worked_minutes, break_minutes, still_open';

const toClock = (r: Record<string, unknown>): ClockRow => ({
  employeeId: String(r.employee_id),
  companyId: String(r.company_id),
  employeeName: String(r.employee_name ?? ''),
  employeeNumber: String(r.employee_number ?? ''),
  standing: (r.standing as Standing) ?? 'Off the clock',
  state: (r.state as PunchKind | null) ?? null,
  since: r.since ? String(r.since) : null,
  projectId: r.project_id ? String(r.project_id) : null,
  projectName: r.project_name ? String(r.project_name) : null,
  workedMinutes: Number(r.worked_minutes ?? 0),
  breakMinutes: Number(r.break_minutes ?? 0),
  stillOpen: Boolean(r.still_open),
});

/** Everybody on the board, in the order a superintendent scans it. */
export const loadTimeClock: Query<ClockRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_time_clock')
    .select(CLOCK_COLUMNS)) as Array<Record<string, unknown>>;

  /*
   * On the clock first, then on break, then everybody else — the people whose
   * time is running are the ones a supervisor is looking for.
   */
  const rank: Record<Standing, number> = { 'On the clock': 0, 'On break': 1, 'Off the clock': 2 };
  return rows.map(toClock).sort((a, b) =>
    rank[a.standing] - rank[b.standing] || a.employeeName.localeCompare(b.employeeName));
};

/** The caller's own row, or null when they have no employee record here. */
export const loadMyClock: Query<ClockRow | null> = async (client) => {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  const mine = unwrap(await client
    .from('employees')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)) as unknown as Array<{ id: string }>;
  if (mine.length === 0) return null;

  const rows = unwrap(await client
    .from('my_time_clock')
    .select(CLOCK_COLUMNS)
    .eq('employee_id', mine[0]!.id)
    .limit(1)) as unknown as Array<Record<string, unknown>>;
  return rows[0] ? toClock(rows[0]) : null;
};

export const loadRecentPunches = (employeeId?: string): Query<PunchRow[]> => async (client) => {
  let q = client
    .from('my_time_punches')
    .select('id, employee_id, employee_name, kind, punched_at, work_date, project_name,'
      + ' cost_code, source, note, voided, void_reason, punched_by_somebody_else')
    .order('punched_at', { ascending: false })
    .limit(50);
  if (employeeId) q = q.eq('employee_id', employeeId);

  const rows = unwrap(await q) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    employeeId: String(r.employee_id),
    employeeName: String(r.employee_name ?? ''),
    kind: r.kind as PunchKind,
    punchedAt: String(r.punched_at),
    workDate: String(r.work_date),
    projectName: r.project_name ? String(r.project_name) : null,
    costCode: r.cost_code ? String(r.cost_code) : null,
    source: String(r.source ?? 'web'),
    note: r.note ? String(r.note) : null,
    voided: Boolean(r.voided),
    voidReason: r.void_reason ? String(r.void_reason) : null,
    punchedBySomebodyElse: Boolean(r.punched_by_somebody_else),
  }));
};

/**
 * Where the device thinks it is, when it will say and the person allows it.
 *
 * Never blocks a punch. A clock that will not record somebody's start because
 * they denied location, or because they are in a basement, is a clock that
 * costs them the hour — so the position is an attachment to the fact, not a
 * condition on it.
 */
export async function currentPosition(timeoutMs = 4000): Promise<
  { latitude: number; longitude: number; accuracy: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: { latitude: number; longitude: number; accuracy: number } | null) => {
      if (!settled) { settled = true; resolve(v); }
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(timer); done({
        latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }); },
      () => { clearTimeout(timer); done(null); },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

export interface PunchRequest {
  companyId: string;
  employeeId?: string;
  projectId?: string | null;
  costCodeId?: string | null;
  note?: string | null;
  withPosition?: boolean;
}

const RPC: Record<PunchKind, string> = {
  in: 'clock_in', out: 'clock_out', break_start: 'start_break', break_end: 'end_break',
};

/**
 * Punch, and let the database's refusal reach the person unchanged.
 *
 * The messages coming back — "Already clocked in", "End the break before
 * clocking out" — were written to be read by whoever is standing at the clock.
 * Rewording them here would put two copies of the same rule in the codebase and
 * guarantee they eventually disagree.
 */
export async function punch(kind: PunchKind, req: PunchRequest): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');

  const where = req.withPosition ? await currentPosition() : null;
  const args: Record<string, unknown> = {
    p_company: req.companyId,
    p_note: req.note ?? null,
    p_employee: req.employeeId ?? null,
  };
  if (kind === 'in') {
    args.p_project = req.projectId ?? null;
    args.p_cost_code = req.costCodeId ?? null;
  }
  if (kind === 'in' || kind === 'out') {
    args.p_latitude = where?.latitude ?? null;
    args.p_longitude = where?.longitude ?? null;
    args.p_accuracy = where?.accuracy ?? null;
  }

  const { error } = await supabase.rpc(RPC[kind], args);
  if (error) throw new Error(error.message);
}

export async function voidPunch(punchId: string, reason: string): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('void_punch', { p_punch: punchId, p_reason: reason });
  if (error) throw new Error(error.message);
}

export async function postDayToTimecard(employeeId: string, day: string): Promise<number> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { data, error } = await supabase.rpc('post_punches_to_timecard',
    { p_employee: employeeId, p_day: day });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data.length : 0;
}

export interface UnpostedDay {
  employeeId: string;
  employeeName: string;
  workDate: string;
  punches: number;
  hasAClockOut: boolean;
}

export const loadUnpostedDays: Query<UnpostedDay[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_unposted_days')
    .select('employee_id, employee_name, work_date, punches, has_a_clock_out')
    .order('work_date', { ascending: false })
    .limit(100)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    employeeName: String(r.employee_name ?? ''),
    workDate: String(r.work_date),
    punches: Number(r.punches ?? 0),
    hasAClockOut: Boolean(r.has_a_clock_out),
  }));
};

/** "6h 12m", the way a person says it. Never "6.2 hours". */
export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  if (h === 0) return `${m}m`;
  return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
}

/** How long they have been in the standing they are in. */
export function since(iso: string | null, now = new Date()): string | null {
  if (!iso) return null;
  const started = new Date(iso).getTime();
  if (Number.isNaN(started)) return null;
  return duration((now.getTime() - started) / 60_000);
}

export interface OvertimePolicy {
  /** Null means no daily overtime, which is the federal position. */
  dailyOvertimeAfter: number | null;
  dailyDoubletimeAfter: number | null;
  weeklyOvertimeAfter: number | null;
  weekStartsOn: number;
  roundingMinutes: number;
  roundingDirection: 'nearest' | 'up' | 'down';
}

export const DEFAULT_OVERTIME: OvertimePolicy = {
  dailyOvertimeAfter: null,
  dailyDoubletimeAfter: null,
  weeklyOvertimeAfter: 40,
  weekStartsOn: 0,
  roundingMinutes: 1,
  roundingDirection: 'nearest',
};

export const loadOvertimePolicy: Query<OvertimePolicy> = async (client) => {
  const rows = unwrap(await client
    .from('overtime_policies')
    .select('daily_overtime_after, daily_doubletime_after, weekly_overtime_after,'
      + ' week_starts_on, rounding_minutes, rounding_direction')
    .limit(1)) as unknown as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) return DEFAULT_OVERTIME;
  return {
    dailyOvertimeAfter: r.daily_overtime_after === null ? null : Number(r.daily_overtime_after),
    dailyDoubletimeAfter: r.daily_doubletime_after === null ? null : Number(r.daily_doubletime_after),
    weeklyOvertimeAfter: r.weekly_overtime_after === null ? null : Number(r.weekly_overtime_after),
    weekStartsOn: Number(r.week_starts_on ?? 0),
    roundingMinutes: Number(r.rounding_minutes ?? 1),
    roundingDirection: (r.rounding_direction as OvertimePolicy['roundingDirection']) ?? 'nearest',
  };
};

export async function saveOvertimePolicy(companyId: string, p: OvertimePolicy): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('set_overtime_policy', {
    p_company: companyId,
    p_daily_overtime_after: p.dailyOvertimeAfter,
    p_daily_doubletime_after: p.dailyDoubletimeAfter,
    p_weekly_overtime_after: p.weeklyOvertimeAfter,
    p_week_starts_on: p.weekStartsOn,
    p_rounding_minutes: p.roundingMinutes,
    p_rounding_direction: p.roundingDirection,
  });
  if (error) throw new Error(error.message);
}

/**
 * The rule in one sentence, the way it would be explained out loud.
 *
 * A settings screen that shows four numbers and leaves somebody to work out
 * what they mean together is how a company ends up paying overtime it does not
 * owe, or not paying overtime it does.
 */
export function describeOvertime(p: OvertimePolicy): string {
  const parts: string[] = [];
  if (p.dailyOvertimeAfter) parts.push(`overtime after ${p.dailyOvertimeAfter} hours in a day`);
  if (p.dailyDoubletimeAfter) parts.push(`double time after ${p.dailyDoubletimeAfter}`);
  if (p.weeklyOvertimeAfter) {
    parts.push(`${parts.length ? 'and ' : 'overtime after '}${p.weeklyOvertimeAfter} hours in a week`);
  }
  if (parts.length === 0) return 'Every hour at straight time. No overtime is calculated.';
  const rounding = p.roundingMinutes > 1
    ? ` Worked time is rounded ${p.roundingDirection === 'nearest'
        ? `to the nearest ${p.roundingMinutes} minutes`
        : `${p.roundingDirection} to ${p.roundingMinutes} minutes`}.`
    : ' Minutes are counted as worked, with no rounding.';
  return `${parts.join(', ').replace(/^./, (c) => c.toUpperCase())}.${rounding}`;
}
