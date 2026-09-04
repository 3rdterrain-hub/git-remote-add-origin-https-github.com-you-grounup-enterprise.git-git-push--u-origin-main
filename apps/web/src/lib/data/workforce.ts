/**
 * Workforce, read from the governed schema — and the first write path.
 *
 * Approving a timecard is not a display change. Since migration 0044 an
 * approved entry posts wages, burden and per diem onto the job it was worked
 * on, and withdrawing the approval takes them back off. So the button on this
 * page moves money, and it is worth saying that plainly: this is the first
 * place in the application where a click changes a governed record.
 *
 * Two views here exist because of what earlier phases found. Credential
 * standing is derived rather than stored, because P09 found a license that had
 * expired still reading valid. And the labor reconciliation compares what the
 * foreman wrote on the daily report against what the timecards say, which the
 * platform recorded in two places and compared in none.
 */
import { unwrap, type Query } from './query';
import { supabase } from '@/lib/supabase';
import { EMPLOYEES, TIME_ENTRIES } from '@/data/fleet';

export interface EmployeeRow {
  id: string; employeeNumber: string; name: string; classification: string | null;
  employmentType: string; isUnion: boolean; hireDate: string | null;
  hourlyRate: number | null; status: string;
  /** The project this person is assigned to today, if any. */
  assignedProject: string | null;
  credentials: { name: string; expiresOn: string | null; standing: string }[];
}

export interface TimeEntryRow {
  id: string; employeeName: string; workDate: string; project: string | null;
  costCode: string | null; straight: number; overtime: number; doubletime: number;
  approvalState: string; exported: boolean;
}

export interface ProductivityRow {
  project: string | null; weekOf: string; totalHours: number; premiumHourRatio: number | null;
}

export interface ReconciliationRow {
  project: string | null; workDate: string;
  dailyReportHours: number; timecardHours: number; varianceHours: number; finding: string;
}

const embedded = <T,>(v: unknown): T | null => {
  const one = Array.isArray(v) ? (v as T[])[0] : (v as T | null);
  return one ?? null;
};

/**
 * The roster, with each person's credentials and where each one stands.
 *
 * Standing comes from `reporting_credential_expiry` rather than being
 * recomputed here. That view derives it from the expiry date on read, and
 * deriving it a second time in the browser is how two answers to the same
 * question start disagreeing — anything the view does not list is current.
 */
export const loadEmployees: Query<EmployeeRow[]> = async (client) => {
  const today = new Date().toISOString().slice(0, 10);
  const [people, lapsed, assignments] = await Promise.all([
    unwrap(await client
      .from('employees')
      .select('id, employee_number, full_name, classification, employment_type, is_union, hire_date, hourly_rate, status, credentials(id, name, expires_on)')
      .neq('status', 'terminated')
      .order('employee_number')) as Array<Record<string, unknown>>,
    unwrap(await client
      .from('reporting_credential_expiry')
      .select('credential_id, standing')) as Array<Record<string, unknown>>,
    // Where somebody is today, rather than wherever they were last booked.
    unwrap(await client
      .from('resource_assignments')
      .select('employee_id, starts_on, ends_on, projects(number)')
      .eq('resource_kind', 'employee')
      .lte('starts_on', today)
      .gte('ends_on', today)) as Array<Record<string, unknown>>,
  ]);
  const standing = new Map(lapsed.map((c) => [String(c.credential_id), String(c.standing)]));
  const assignedTo = new Map(assignments.map((a) => [
    String(a.employee_id), embedded<{ number: string }>(a.projects)?.number ?? null,
  ]));
  return people.map((p) => ({
    id: String(p.id),
    employeeNumber: String(p.employee_number),
    name: String(p.full_name),
    classification: (p.classification as string | null) ?? null,
    employmentType: String(p.employment_type),
    isUnion: Boolean(p.is_union),
    hireDate: (p.hire_date as string | null) ?? null,
    hourlyRate: p.hourly_rate == null ? null : Number(p.hourly_rate),
    status: String(p.status),
    assignedProject: assignedTo.get(String(p.id)) ?? null,
    credentials: ((p.credentials as Array<Record<string, unknown>> | null) ?? []).map((c) => ({
      name: String(c.name),
      expiresOn: (c.expires_on as string | null) ?? null,
      standing: standing.get(String(c.id)) ?? 'valid',
    })),
  }));
};

export const loadTimeEntries: Query<TimeEntryRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('time_entries')
    .select('id, work_date, straight_hours, overtime_hours, doubletime_hours, approval_state, exported_at, employees(full_name), projects(number), cost_codes(code)')
    .order('work_date', { ascending: false })
    .limit(200)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    employeeName: embedded<{ full_name: string }>(r.employees)?.full_name ?? 'Unknown',
    workDate: String(r.work_date),
    project: embedded<{ number: string }>(r.projects)?.number ?? null,
    costCode: embedded<{ code: string }>(r.cost_codes)?.code ?? null,
    straight: Number(r.straight_hours ?? 0),
    overtime: Number(r.overtime_hours ?? 0),
    doubletime: Number(r.doubletime_hours ?? 0),
    approvalState: String(r.approval_state),
    exported: r.exported_at != null,
  }));
};

export const loadProductivity: Query<ProductivityRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('reporting_labor_productivity')
    .select('week_of, total_hours, premium_hour_ratio, projects(number)')
    .order('week_of', { ascending: false })
    .limit(50)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    project: embedded<{ number: string }>(r.projects)?.number ?? null,
    weekOf: String(r.week_of),
    totalHours: Number(r.total_hours ?? 0),
    premiumHourRatio: r.premium_hour_ratio == null ? null : Number(r.premium_hour_ratio),
  }));
};

/**
 * The daily report against the timecards.
 *
 * The oldest labor control on a construction job and it is a subtraction: hours
 * reported and never put on a timecard are work somebody is not being paid for;
 * hours on a timecard with no report behind them are payroll nobody accounted
 * for. Only rows that disagree are worth a person's attention.
 */
export const loadReconciliation: Query<ReconciliationRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('reporting_labor_reconciliation')
    .select('work_date, daily_report_hours, timecard_hours, variance_hours, finding, projects(number)')
    .neq('finding', 'agreed')
    .order('work_date', { ascending: false })
    .limit(50)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    project: embedded<{ number: string }>(r.projects)?.number ?? null,
    workDate: String(r.work_date),
    dailyReportHours: Number(r.daily_report_hours ?? 0),
    timecardHours: Number(r.timecard_hours ?? 0),
    varianceHours: Number(r.variance_hours ?? 0),
    finding: String(r.finding),
  }));
};

/**
 * Approve a timecard.
 *
 * The first write in this application, and it moves money: an approved entry
 * posts wages, burden and per diem to the job. The database refuses an approval
 * that does not name its approver, so the caller is read from the session
 * rather than assumed — and a refusal is returned rather than swallowed,
 * because a button that silently fails to approve a timecard is worse than one
 * that does nothing at all.
 */
export async function approveTimeEntry(id: string): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured, so nothing can be approved.');
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) throw new Error('You are signed out. Sign in again to approve time.');

  const { error } = await supabase
    .from('time_entries')
    .update({ approval_state: 'approved', approved_by: user.id, approved_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/** The sample dataset in the same shapes. */
export const demonstrationEmployees = (): EmployeeRow[] =>
  EMPLOYEES.map((e) => ({
    id: e.id, employeeNumber: e.employeeNumber, name: e.name,
    classification: e.classification, employmentType: e.employmentType,
    isUnion: e.isUnion, hireDate: e.hireDate, hourlyRate: e.hourlyRate, status: e.status,
    assignedProject: e.assignedProject,
    credentials: e.credentials.map((c) => ({
      name: c.name, expiresOn: c.expiresOn, standing: c.status,
    })),
  }));

export const demonstrationTimeEntries = (): TimeEntryRow[] =>
  TIME_ENTRIES.map((t) => ({
    id: t.id, employeeName: t.employeeName, workDate: t.workDate, project: t.project,
    costCode: t.costCode, straight: t.straight, overtime: t.overtime, doubletime: 0,
    approvalState: t.approvalState, exported: t.exported,
  }));
