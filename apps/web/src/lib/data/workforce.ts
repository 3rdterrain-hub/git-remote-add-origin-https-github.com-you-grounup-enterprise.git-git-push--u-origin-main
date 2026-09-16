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
import { localDay } from '@/lib/format';

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
  const today = localDay();
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

// ---------------------------------------------------------------------------
// Adding somebody
//
// "Add employee" sat in the Workforce header with no handler from the day the
// screen shipped, so a company could not record a single member of staff. That
// is not only a Workforce gap: the clock matches a punch to a login through
// `employees.user_id` (migration 0122), so the person who created the company
// had nothing to punch and the dashboard told them so every morning.
// ---------------------------------------------------------------------------

export interface NewEmployee {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  employmentType?: string;
  classification?: string | null;
  hourlyRate?: number | null;
  hireDate?: string | null;
  /** Attach this record to the caller's own login, so they can clock in. */
  linkMe?: boolean;
}

/**
 * Add somebody who works here, and return their id.
 *
 * The employee number is generated in the database rather than here: employees
 * is unique on (company_id, employee_number), so two people adding staff at the
 * same moment would otherwise collide on the index.
 */
export async function createEmployee(
  companyId: string, employee: NewEmployee,
): Promise<string> {
  if (!supabase) throw new Error('Not connected.');
  const { data, error } = await supabase.rpc('create_employee', {
    p_company: companyId,
    p_first_name: employee.firstName,
    p_last_name: employee.lastName,
    p_email: employee.email ?? null,
    p_phone: employee.phone ?? null,
    p_employment_type: employee.employmentType ?? 'full_time',
    p_classification: employee.classification ?? null,
    p_hourly_rate: employee.hourlyRate ?? null,
    p_hire_date: employee.hireDate ?? null,
    p_link_me: employee.linkMe ?? false,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

// -----------------------------------------------------------------------------
// The doors
//
// `create_employee` (0161) was the whole write side: a person could be hired and
// never corrected, never put on leave and never ended — and the schema requires
// a termination date that nothing could supply. Migration 0187 added the rest,
// along with the first writer of `credentials`, on which the platform's only
// blocking safety control depends.
// -----------------------------------------------------------------------------

type RpcCapable = {
  rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const call = async (fn: string, args: Record<string, unknown>) => {
  if (!supabase) throw new Error('No workspace is configured.');
  const { data, error } = await (supabase as unknown as RpcCapable).rpc(fn, args);
  if (error) throw new Error(error.message);
  return data === null || data === undefined ? '' : String(data);
};

export const EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full time' },
  { value: 'part_time', label: 'Part time' },
  { value: 'seasonal', label: 'Seasonal' },
  { value: 'temporary', label: 'Temporary' },
  { value: 'subcontract', label: 'Subcontract' },
] as const;

/** Where somebody stands, short of having left — ending is its own door. */
export const EMPLOYEE_STATUSES = [
  { value: 'applicant', label: 'Applicant' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'active', label: 'Active' },
  { value: 'on_leave', label: 'On leave' },
] as const;

/** Correct a person's record, or put them on leave. */
export async function updateEmployee(input: {
  employeeId: string; firstName?: string | null; lastName?: string | null;
  email?: string | null; phone?: string | null; classification?: string | null;
  employmentType?: string | null; isUnion?: boolean | null; unionLocal?: string | null;
  hireDate?: string | null; hourlyRate?: number | null; burdenPercent?: number | null;
  emergencyContact?: string | null; emergencyPhone?: string | null; status?: string | null;
}): Promise<void> {
  await call('update_employee', {
    p_employee: input.employeeId,
    p_first_name: input.firstName?.trim() || null,
    p_last_name: input.lastName?.trim() || null,
    p_email: input.email?.trim() || null,
    p_phone: input.phone?.trim() || null,
    p_classification: input.classification?.trim() || null,
    p_employment_type: input.employmentType ?? null,
    p_is_union: input.isUnion ?? null,
    p_union_local: input.unionLocal?.trim() || null,
    p_hire_date: input.hireDate || null,
    p_hourly_rate: input.hourlyRate ?? null,
    p_burden_percent: input.burdenPercent ?? null,
    p_emergency_contact: input.emergencyContact?.trim() || null,
    p_emergency_phone: input.emergencyPhone?.trim() || null,
    p_status: input.status ?? null,
  });
}

/**
 * End somebody's employment on a date.
 *
 * Its own door because the schema requires the date with it, and because the
 * assignments that run past that date are ended too — a schedule that still
 * shows somebody who has left is a schedule people staff from.
 */
export async function endEmployment(
  employeeId: string, on: string, reason?: string | null,
): Promise<void> {
  await call('end_employment', {
    p_employee: employeeId, p_on: on, p_reason: reason?.trim() || null,
  });
}

export const CREDENTIAL_TYPES = [
  { value: 'license', label: 'License' },
  { value: 'certification', label: 'Certification' },
  { value: 'training', label: 'Training' },
  { value: 'medical', label: 'Medical' },
  { value: 'clearance', label: 'Clearance' },
] as const;

/**
 * Record that somebody holds a ticket.
 *
 * The standing — valid, expiring, expired — is never sent: migration 0043
 * removed the stored one because a state derived from a date and written down
 * goes stale the day the date passes, and the safety gate failed open on
 * exactly the case it exists to catch.
 */
export async function recordCredential(input: {
  employeeId: string; name: string; type?: string; issuingBody?: string | null;
  identifier?: string | null; issuedOn?: string | null; expiresOn?: string | null;
  requiredFor?: string[]; pending?: boolean;
}): Promise<string> {
  return call('record_credential', {
    p_employee: input.employeeId,
    p_name: input.name.trim(),
    p_type: input.type ?? 'certification',
    p_issuing_body: input.issuingBody?.trim() || null,
    p_identifier: input.identifier?.trim() || null,
    p_issued_on: input.issuedOn || null,
    p_expires_on: input.expiresOn || null,
    p_required_for: input.requiredFor ?? [],
    p_pending: input.pending ?? false,
  });
}

/** Renew or correct a ticket. A renewal edits the row rather than adding a second. */
export async function updateCredential(input: {
  credentialId: string; name?: string | null; issuingBody?: string | null;
  identifier?: string | null; issuedOn?: string | null; expiresOn?: string | null;
  requiredFor?: string[] | null; issued?: boolean | null;
}): Promise<void> {
  await call('update_credential', {
    p_credential: input.credentialId,
    p_name: input.name?.trim() || null,
    p_issuing_body: input.issuingBody?.trim() || null,
    p_identifier: input.identifier?.trim() || null,
    p_issued_on: input.issuedOn || null,
    p_expires_on: input.expiresOn || null,
    p_required_for: input.requiredFor ?? null,
    p_issued: input.issued ?? null,
  });
}

/** Take a ticket away, with the reason. Different from letting one lapse. */
export async function revokeCredential(credentialId: string, reason: string): Promise<void> {
  await call('revoke_credential', { p_credential: credentialId, p_reason: reason.trim() });
}

export interface EmployeeCredentialRow {
  id: string;
  employeeId: string;
  name: string;
  credentialType: string;
  issuingBody: string | null;
  identifier: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  requiredFor: string[];
  /** Derived from the date every time it is asked for, never stored (0043). */
  status: string;
  daysRemaining: number | null;
}

/** What one person holds. */
export const loadEmployeeCredentials = (employeeId: string): Query<EmployeeCredentialRow[]> =>
  async (client) => {
    if (!employeeId) return [];
    const rows = unwrap(await client
      .from('my_employee_credentials')
      .select('id, employee_id, name, credential_type, issuing_body, identifier, '
        + 'issued_on, expires_on, required_for, status, days_remaining')
      .eq('employee_id', employeeId)
      .order('expires_on', { ascending: true, nullsFirst: false })) as unknown as
        Array<Record<string, unknown>>;
    return rows.map((c) => ({
      id: String(c.id),
      employeeId: String(c.employee_id),
      name: String(c.name),
      credentialType: String(c.credential_type),
      issuingBody: (c.issuing_body as string | null) ?? null,
      identifier: (c.identifier as string | null) ?? null,
      issuedOn: (c.issued_on as string | null) ?? null,
      expiresOn: (c.expires_on as string | null) ?? null,
      requiredFor: (c.required_for as string[] | null) ?? [],
      status: String(c.status),
      daysRemaining: c.days_remaining == null ? null : Number(c.days_remaining),
    }));
  };

export interface WorkRequirementRow {
  id: string;
  workType: string;
  credentialName: string;
  credentialType: string | null;
  isMandatory: boolean;
  notes: string | null;
  /** How many people currently hold it — whether the rule can be staffed. */
  peopleWhoHoldIt: number;
}

/**
 * What each kind of work requires.
 *
 * `app.enforce_assignment_credentials` has read this since migration 0043 and
 * had nothing to read: no company could state a requirement, so the platform's
 * only blocking safety control had never fired.
 */
export const loadWorkRequirements: Query<WorkRequirementRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_work_credential_requirements')
    .select('id, work_type, credential_name, credential_type, is_mandatory, notes, '
      + 'people_who_hold_it')
    .order('work_type')
    .order('credential_name')) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    workType: String(r.work_type),
    credentialName: String(r.credential_name),
    credentialType: (r.credential_type as string | null) ?? null,
    isMandatory: r.is_mandatory === true,
    notes: (r.notes as string | null) ?? null,
    peopleWhoHoldIt: Number(r.people_who_hold_it ?? 0),
  }));
};

/** Say what a kind of work requires. Mandatory blocks; recommended warns. */
export async function setWorkRequirement(companyId: string, input: {
  workType: string; credentialName: string; mandatory?: boolean;
  credentialType?: string | null; notes?: string | null;
}): Promise<string> {
  return call('set_work_credential_requirement', {
    p_company: companyId,
    p_work_type: input.workType.trim().toLowerCase().replace(/\s+/g, '_'),
    p_credential: input.credentialName.trim(),
    p_mandatory: input.mandatory ?? true,
    p_type: input.credentialType ?? null,
    p_notes: input.notes?.trim() || null,
  });
}

/** Stop requiring a credential for a kind of work. */
export async function removeWorkRequirement(requirementId: string): Promise<void> {
  await call('remove_work_credential_requirement', { p_requirement: requirementId });
}
