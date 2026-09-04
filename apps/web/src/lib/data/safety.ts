/**
 * Safety and quality, read from the governed schema.
 *
 * Five record types and two computed views. The records are plain reads scoped
 * by row level security. The two views are the ones this build had to fix:
 *
 *   - `reporting_safety_rates` computes TRIR and DART from recordables against
 *     approved hours. P29 found both metrics defined against a view that could
 *     not produce them, and DART adding restricted *days* into a rate that
 *     counts *cases*. These are the two numbers a contractor is prequalified on
 *     and an insurer rates, and the page never showed them at all.
 *   - `reporting_credential_expiry` lists what has lapsed and the work each one
 *     blocks. P09 found expiry stored rather than derived, so a license that
 *     ran out kept reading valid and passed the gate that exists to catch it.
 */
import { unwrap, type Query } from './query';
import { INCIDENTS, TOOLBOX_TALKS, OBSERVATIONS, INSPECTIONS, DEFICIENCIES } from '@/data/safety';

export interface IncidentRow {
  id: string; number: string; occurredAt: string; type: string; severity: string;
  project: string | null; description: string;
  employee: string | null;
  isOshaRecordable: boolean; oshaCaseNumber: string | null;
  daysAway: number; daysRestricted: number;
  rootCause: string | null; correctiveAction: string | null;
  investigationState: string;
}

export interface SafetyRates {
  trir: number | null;
  dart: number | null;
  recordables: number;
  hoursObserved: number;
  lostTimeCases: number;
}

export interface LapsedCredential {
  credentialId: string;
  employeeName: string;
  credentialName: string;
  standing: string;
  expiresOn: string | null;
  daysRemaining: number | null;
  blocksWorkTypes: string[];
}

const employeeOf = (row: Record<string, unknown>): string | null => {
  const e = row.employees as { full_name?: string } | { full_name?: string }[] | null;
  const one = Array.isArray(e) ? e[0] : e;
  return one?.full_name ?? null;
};

const projectOf = (row: Record<string, unknown>): string | null => {
  const p = row.projects as { number?: string } | { number?: string }[] | null;
  const one = Array.isArray(p) ? p[0] : p;
  return one?.number ?? null;
};

export const loadIncidents: Query<IncidentRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('safety_incidents')
    .select('id, number, occurred_at, incident_type, severity, description, is_osha_recordable, osha_case_number, days_away, days_restricted, root_cause, corrective_action, investigation_state, projects(number), employees(full_name)')
    .order('occurred_at', { ascending: false })) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    number: String(r.number),
    occurredAt: String(r.occurred_at),
    type: String(r.incident_type),
    severity: String(r.severity),
    project: projectOf(r),
    employee: employeeOf(r),
    description: String(r.description),
    isOshaRecordable: Boolean(r.is_osha_recordable),
    oshaCaseNumber: (r.osha_case_number as string | null) ?? null,
    daysAway: Number(r.days_away ?? 0),
    daysRestricted: Number(r.days_restricted ?? 0),
    rootCause: (r.root_cause as string | null) ?? null,
    correctiveAction: (r.corrective_action as string | null) ?? null,
    investigationState: String(r.investigation_state),
  }));
};

/**
 * TRIR and DART for the whole company.
 *
 * Summed across every project and month rather than read per row, because the
 * rate is a company figure — that is the grain the metric definition declares.
 * A month with incidents and no approved hours contributes its recordables and
 * no hours, which is a timekeeping gap rather than an infinite rate: with no
 * hours anywhere the rate is null, not zero.
 */
export const loadSafetyRates: Query<SafetyRates> = async (client) => {
  const rows = unwrap(await client
    .from('reporting_safety_rates')
    .select('recordables, dart_cases, lost_time_cases, hours_worked')) as Array<Record<string, unknown>>;
  const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const hours = sum('hours_worked');
  const recordables = sum('recordables');
  const dartCases = sum('dart_cases');
  return {
    recordables,
    lostTimeCases: sum('lost_time_cases'),
    hoursObserved: hours,
    trir: hours > 0 ? (recordables * 200_000) / hours : null,
    dart: hours > 0 ? (dartCases * 200_000) / hours : null,
  };
};

export const loadLapsedCredentials: Query<LapsedCredential[]> = async (client) => {
  const rows = unwrap(await client
    .from('reporting_credential_expiry')
    .select('credential_id, employee_name, credential_name, standing, expires_on, days_remaining, blocks_work_types')
    .order('days_remaining', { ascending: true })) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    credentialId: String(r.credential_id),
    employeeName: String(r.employee_name),
    credentialName: String(r.credential_name),
    standing: String(r.standing),
    expiresOn: (r.expires_on as string | null) ?? null,
    daysRemaining: r.days_remaining == null ? null : Number(r.days_remaining),
    blocksWorkTypes: (r.blocks_work_types as string[] | null) ?? [],
  }));
};

export interface ObservationRow {
  id: string; observedAt: string; observer: string; project: string | null;
  category: string; isPositive: boolean; description: string;
  correctedOnSite: boolean; correctiveAction: string | null;
}
export interface TalkRow {
  id: string; heldOn: string; topic: string; presenter: string; project: string | null; attendees: number;
}
export interface InspectionRow {
  id: string; number: string; type: string; title: string; specReference: string | null;
  station: string | null; inspectedAt: string; inspector: string | null; agency: string | null;
  /* The measured values live in `result_values`, a jsonb object, because what a
   * compaction test records is not what a pipe pressure test records. Read
   * defensively: a key that is not there is absent rather than zero. */
  required: number | null; achieved: number | null; unit: string | null;
  result: string; notes: string | null; isRetest: boolean;
}
export interface DeficiencyRow {
  id: string; number: string; description: string; location: string | null; trade: string | null;
  identifiedOn: string; dueOn: string | null; status: string; verificationNote: string | null;
  /** The vendor answerable for it, where one was named. */
  responsible: string | null;
}

/** A person's name from an embedded profile, however the client shaped it. */
const nameOf = (row: Record<string, unknown>, key: string): string => {
  const p = row[key] as { full_name?: string; email?: string } | { full_name?: string; email?: string }[] | null;
  const one = Array.isArray(p) ? p[0] : p;
  return one?.full_name ?? one?.email ?? 'Unknown';
};

export const loadObservations: Query<ObservationRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('safety_observations')
    .select('id, observed_at, category, is_positive, description, corrected_on_site, corrective_action, projects(number), user_profiles!safety_observations_observer_id_fkey(full_name, email)')
    .order('observed_at', { ascending: false })) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    observedAt: String(r.observed_at),
    observer: nameOf(r, 'user_profiles'),
    project: projectOf(r),
    category: String(r.category),
    isPositive: Boolean(r.is_positive),
    description: String(r.description),
    correctedOnSite: Boolean(r.corrected_on_site),
    correctiveAction: (r.corrective_action as string | null) ?? null,
  }));
};

export const loadToolboxTalks: Query<TalkRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('toolbox_talks')
    .select('id, held_on, topic, attendee_count, projects(number), user_profiles!toolbox_talks_presenter_id_fkey(full_name, email)')
    .order('held_on', { ascending: false })) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    heldOn: String(r.held_on),
    topic: String(r.topic),
    presenter: nameOf(r, 'user_profiles'),
    project: projectOf(r),
    attendees: Number(r.attendee_count ?? 0),
  }));
};

/** Pull the three values the page shows out of a free-form results object. */
function measured(raw: unknown): { required: number | null; achieved: number | null; unit: string | null } {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (x: unknown) => (x == null || x === '' || Number.isNaN(Number(x)) ? null : Number(x));
  return {
    required: num(v.required),
    achieved: num(v.achieved),
    unit: v.unit == null ? null : String(v.unit),
  };
}

export const loadInspections: Query<InspectionRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('inspections')
    .select('id, number, inspection_type, title, spec_reference, station, inspected_at, inspector_name, inspecting_agency, result_values, result, notes, retest_of_id')
    .order('inspected_at', { ascending: false })) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    number: String(r.number),
    type: String(r.inspection_type),
    title: String(r.title),
    specReference: (r.spec_reference as string | null) ?? null,
    station: (r.station as string | null) ?? null,
    inspectedAt: String(r.inspected_at),
    inspector: (r.inspector_name as string | null) ?? null,
    agency: (r.inspecting_agency as string | null) ?? null,
    ...measured(r.result_values),
    result: String(r.result),
    notes: (r.notes as string | null) ?? null,
    isRetest: r.retest_of_id != null,
  }));
};

export const loadDeficiencies: Query<DeficiencyRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('deficiencies')
    .select('id, number, description, location, trade, identified_on, due_on, status, verification_note, vendors(name)')
    .order('due_on', { ascending: true })) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    number: String(r.number),
    description: String(r.description),
    location: (r.location as string | null) ?? null,
    trade: (r.trade as string | null) ?? null,
    identifiedOn: String(r.identified_on),
    dueOn: (r.due_on as string | null) ?? null,
    status: String(r.status),
    verificationNote: (r.verification_note as string | null) ?? null,
    responsible: (() => {
      const v = r.vendors as { name?: string } | { name?: string }[] | null;
      const one = Array.isArray(v) ? v[0] : v;
      return one?.name ?? null;
    })(),
  }));
};

/** The sample dataset in the same shapes. */
export function demonstrationIncidents(): IncidentRow[] {
  return INCIDENTS.map((i) => ({
    id: i.id, number: i.number, occurredAt: i.occurredAt, type: i.type, severity: i.severity,
    project: i.project, employee: i.employee, description: i.description,
    isOshaRecordable: i.isOshaRecordable, oshaCaseNumber: i.oshaCaseNumber,
    daysAway: i.daysAway, daysRestricted: i.daysRestricted,
    rootCause: i.rootCause, correctiveAction: i.correctiveAction,
    investigationState: i.investigationState,
  }));
}

/**
 * No demonstration TRIR.
 *
 * A rate needs recorded hours, and the sample dataset has none — it carries
 * incidents and no timesheets. Computing one from an invented denominator would
 * publish the exact kind of confident, unfounded safety figure P29 spent its
 * time removing, so the page says the rate is unavailable instead.
 */
export const demonstrationRates: SafetyRates = {
  trir: null, dart: null, recordables: INCIDENTS.filter((i) => i.isOshaRecordable).length,
  hoursObserved: 0, lostTimeCases: INCIDENTS.filter((i) => i.daysAway > 0).length,
};

export const demonstrationObservations = (): ObservationRow[] =>
  OBSERVATIONS.map((o) => ({ ...o, project: o.project }));
export const demonstrationTalks = (): TalkRow[] =>
  TOOLBOX_TALKS.map((t) => ({ ...t, project: t.project }));
export const demonstrationInspections = (): InspectionRow[] =>
  INSPECTIONS.map((i) => ({
    id: i.id, number: i.number, type: i.type, title: i.title, specReference: i.specReference,
    station: i.station, inspectedAt: i.inspectedAt, inspector: i.inspector, agency: i.agency,
    required: i.required, achieved: i.achieved, unit: i.unit,
    result: i.result, notes: i.notes, isRetest: i.isRetest,
  }));
export const demonstrationDeficiencies = (): DeficiencyRow[] =>
  DEFICIENCIES.map((d) => ({
    id: d.id, number: d.number, description: d.description, location: d.location, trade: d.trade,
    identifiedOn: d.identifiedOn, dueOn: d.dueOn, status: d.status,
    verificationNote: d.verificationNote, responsible: d.responsible,
  }));
