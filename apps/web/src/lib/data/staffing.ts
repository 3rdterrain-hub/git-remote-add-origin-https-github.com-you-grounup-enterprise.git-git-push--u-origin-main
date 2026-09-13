/**
 * Engine — who is short of what, and when.
 *
 * Migration 0035 refuses to assign somebody to work they are not credentialed
 * for, and it asks that question once, on the day the assignment is made. A CDL
 * expiring three weeks into a six week assignment passes that check and lapses
 * in the middle of the work with nothing to notice. So does one revoked
 * afterwards.
 *
 * A recruitment module was considered for this and rejected: a candidate
 * database connects to nothing else here, while the question a contractor
 * actually has is answerable from the schedule and the credentials that were
 * already in the platform.
 */
import { unwrap, type Query } from './query';

export interface StaffingGap {
  assignmentId: string;
  projectId: string;
  projectNumber: string;
  employeeId: string;
  employeeName: string;
  workType: string;
  startsOn: string;
  endsOn: string;
  credentialName: string;
  isMandatory: boolean;
  credentialStatus: string;
  expiresOn: string | null;
  /** The day cover runs out inside the assignment, or its start where it never had any. */
  uncoveredFrom: string | null;
  /** Somebody on site unqualified today, as against a date to book a renewal for. */
  alreadyLapsed: boolean;
  reason: string;
}

export const loadStaffingGaps: Query<StaffingGap[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_staffing_gaps')
    .select('*')
    .order('uncovered_from')) as unknown as Array<Record<string, unknown>>;

  return rows.map((g) => ({
    assignmentId: String(g.assignment_id),
    projectId: String(g.project_id),
    projectNumber: String(g.project_number ?? ''),
    employeeId: String(g.employee_id),
    employeeName: String(g.employee_name ?? ''),
    workType: String(g.work_type ?? ''),
    startsOn: String(g.starts_on),
    endsOn: String(g.ends_on),
    credentialName: String(g.credential_name),
    isMandatory: Boolean(g.is_mandatory),
    credentialStatus: String(g.credential_status ?? ''),
    expiresOn: (g.expires_on as string | null) ?? null,
    uncoveredFrom: (g.uncovered_from as string | null) ?? null,
    alreadyLapsed: Boolean(g.already_lapsed),
    reason: String(g.reason ?? ''),
  }));
};

export interface QualifiedPerson {
  employeeId: string;
  employeeName: string;
  classification: string | null;
  fullyQualified: boolean;
  missing: string[];
  committedDays: number;
  windowDays: number;
}

/**
 * The supply side, and only that.
 *
 * `resource_assignments` is one row per person, so the platform knows exactly
 * who is committed and cannot know how many a job needs without being told. A
 * required headcount nobody entered would be a number invented to fill a
 * column, so this answers who could go rather than how many are short.
 */
export const loadQualifiedFor = (
  workType: string, from?: string, to?: string,
): Query<QualifiedPerson[]> => async (client) => {
  const { data, error } = await client.rpc('qualified_and_available', {
    p_work_type: workType,
    ...(from ? { p_from: from } : {}),
    ...(to ? { p_to: to } : {}),
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    employeeId: String(r.employee_id),
    employeeName: String(r.employee_name ?? ''),
    classification: (r.classification as string | null) ?? null,
    fullyQualified: Boolean(r.fully_qualified),
    missing: ((r.missing as string[] | null) ?? []),
    committedDays: Number(r.committed_days ?? 0),
    windowDays: Number(r.window_days ?? 0),
  }));
};
