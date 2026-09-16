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
import { supabase } from '@/lib/supabase';

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

const projectOf = (row: Record<string, unknown>): string | null => {
  const p = row.projects as { number?: string } | { number?: string }[] | null;
  const one = Array.isArray(p) ? p[0] : p;
  return one?.number ?? null;
};

export const loadIncidents: Query<IncidentRow[]> = async (client) => {
  const rows = unwrap(await client
    /*
     * `my_safety_incidents` rather than the table: it carries days_open, which
     * is the number that matters once an investigation can actually be closed —
     * and flat columns instead of embeds, which cannot silently return nothing
     * the way a mistyped embed does.
     */
    .from('my_safety_incidents')
    .select('id, number, occurred_at, incident_type, severity, description, '
      + 'is_osha_recordable, osha_case_number, days_away, days_restricted, '
      + 'root_cause, corrective_action, investigation_state, days_open, '
      + 'project_number, employee_name')
    .order('occurred_at', { ascending: false })) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    number: String(r.number),
    occurredAt: String(r.occurred_at),
    type: String(r.incident_type),
    severity: String(r.severity),
    project: (r.project_number as string | null) ?? '—',
    employee: (r.employee_name as string | null) ?? null,
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
  /**
   * A failure nothing has retested. The work stays unaccepted until a later
   * test names this one, so it belongs on the list rather than being found at
   * closeout.
   */
  failedAndNotRetested: boolean;
  /** The number of the test that answered this failure, where one did. */
  retestedBy: string | null;
}
export interface DeficiencyRow {
  id: string; number: string; description: string; location: string | null; trade: string | null;
  identifiedOn: string; dueOn: string | null; status: string; verificationNote: string | null;
  /** The vendor answerable for it, where one was named. */
  responsible: string | null;
}

/** A person's name from an embedded profile, however the client shaped it. */
/*
 * The person is an `employees` row, not a `user_profiles` one. Both carry a
 * `full_name`, so naming the wrong one read perfectly — but `observer_id` and
 * `presenter_id` point at `employees`, and PostgREST refuses an embed whose
 * named constraint does not lead to the table asked for. The screen showed a
 * database error where the observer's name belongs. A person doing the work is
 * not necessarily a person with a login, which is why it is `employees`.
 */
const nameOf = (row: Record<string, unknown>, key: string): string => {
  const p = row[key] as { full_name?: string; email?: string } | { full_name?: string; email?: string }[] | null;
  const one = Array.isArray(p) ? p[0] : p;
  return one?.full_name ?? one?.email ?? 'Unknown';
};

export const loadObservations: Query<ObservationRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_safety_observations')
    .select('id, observed_at, category, is_positive, description, '
      + 'corrected_on_site, corrective_action, project_number, observer_name')
    .order('observed_at', { ascending: false })) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    observedAt: String(r.observed_at),
    observer: (r.observer_name as string | null) ?? '—',
    project: (r.project_number as string | null) ?? '—',
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
    .select('id, held_on, topic, attendee_count, projects(number), employees!toolbox_talks_presenter_id_fkey(full_name, email)')
    .order('held_on', { ascending: false })) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    heldOn: String(r.held_on),
    topic: String(r.topic),
    presenter: nameOf(r, 'employees'),
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
    /*
     * `my_inspections` carries `failed_and_not_retested` and the number of the
     * retest that answered a failure. A failed test nothing has retested leaves
     * the work unaccepted, and that belongs on the list rather than being
     * discovered at closeout.
     */
    .from('my_inspections')
    .select('id, number, inspection_type, title, spec_reference, station, '
      + 'inspected_at, inspector_name, inspecting_agency, result_values, result, '
      + 'notes, retest_of_id, retested_by, failed_and_not_retested, project_number')
    .order('inspected_at', { ascending: false })) as unknown as Array<Record<string, unknown>>;
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
    failedAndNotRetested: r.failed_and_not_retested === true,
    retestedBy: (r.retested_by as string | null) ?? null,
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
    failedAndNotRetested: i.result === 'fail' && !i.isRetest,
    retestedBy: null,
  }));
export const demonstrationDeficiencies = (): DeficiencyRow[] =>
  DEFICIENCIES.map((d) => ({
    id: d.id, number: d.number, description: d.description, location: d.location, trade: d.trade,
    identifiedOn: d.identifiedOn, dueOn: d.dueOn, status: d.status,
    verificationNote: d.verificationNote, responsible: d.responsible,
  }));

// ---------------------------------------------------------------------------
// What happened, and the talk before the shift
//
// "Report incident" and "Toolbox talk" both had no handler. `safety_incidents`
// and `toolbox_talks` have been governed since 0021 and the page already read
// both — it could show a safety record and could not add to one.
// ---------------------------------------------------------------------------

export interface NewIncident {
  occurredAt: string;
  incidentType: string;
  description: string;
  severity?: string;
  projectId?: string | null;
  location?: string | null;
}

/**
 * Record an incident, with its investigation open.
 *
 * OSHA recordability is deliberately not set here. Whether a medical-treatment
 * case is recordable is a determination a person makes against the rule, and a
 * form that decided it from the incident type would be inventing a regulatory
 * finding.
 */
export async function createSafetyIncident(
  companyId: string, incident: NewIncident,
): Promise<string> {
  if (!supabase) throw new Error('Not connected.');
  const { data, error } = await supabase.rpc('create_safety_incident', {
    p_company: companyId,
    p_occurred_at: incident.occurredAt,
    p_incident_type: incident.incidentType,
    p_description: incident.description,
    p_severity: incident.severity ?? 'low',
    p_project_id: incident.projectId ?? null,
    p_location: incident.location ?? null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export interface NewToolboxTalk {
  heldOn: string;
  topic: string;
  attendeeCount?: number;
  projectId?: string | null;
}

/** Record a toolbox talk and who was at it. */
export async function createToolboxTalk(
  companyId: string, talk: NewToolboxTalk,
): Promise<string> {
  if (!supabase) throw new Error('Not connected.');
  const { data, error } = await supabase.rpc('create_toolbox_talk', {
    p_company: companyId,
    p_held_on: talk.heldOn,
    p_topic: talk.topic,
    p_attendee_count: talk.attendeeCount ?? 0,
    p_project_id: talk.projectId ?? null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}


// -----------------------------------------------------------------------------
// The doors
//
// `create_safety_incident` and `create_toolbox_talk` (0162) were the whole write
// side. An incident could be opened and never closed — `investigation_state`
// started at 'open' and nothing could move it — so every incident this platform
// recorded stayed open forever, including every recordable it notified the
// company about. Near misses and tests could not be recorded at all.
// -----------------------------------------------------------------------------

const call = async (fn: string, args: Record<string, unknown>) => {
  if (!supabase) throw new Error('No workspace is configured.');
  const { data, error } = await (supabase as unknown as {
    rpc: (f: string, a: Record<string, unknown>) =>
      PromiseLike<{ data: unknown; error: { message: string } | null }>;
  }).rpc(fn, args);
  if (error) throw new Error(error.message);
  return data === null || data === undefined ? '' : String(data);
};

export const OBSERVATION_CATEGORIES = [
  { value: 'ppe', label: 'PPE' },
  { value: 'excavation', label: 'Excavation' },
  { value: 'fall_protection', label: 'Fall protection' },
  { value: 'traffic', label: 'Traffic' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'housekeeping', label: 'Housekeeping' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'environmental', label: 'Environmental' },
  { value: 'other', label: 'Other' },
] as const;

export const INSPECTION_TYPES = [
  { value: 'compaction', label: 'Compaction' },
  { value: 'concrete', label: 'Concrete' },
  { value: 'asphalt', label: 'Asphalt' },
  { value: 'pipe_test', label: 'Pipe test' },
  { value: 'proof_roll', label: 'Proof roll' },
  { value: 'survey', label: 'Survey' },
  { value: 'material', label: 'Material' },
  { value: 'punch_list', label: 'Punch list' },
  { value: 'other', label: 'Other' },
] as const;

/** Move an investigation along. Closing has its own door. */
export async function updateSafetyIncident(input: {
  incidentId: string; investigationState?: string | null; severity?: string | null;
  rootCause?: string | null; correctiveAction?: string | null;
  immediateAction?: string | null; isOshaRecordable?: boolean | null;
  oshaCaseNumber?: string | null; daysAway?: number | null; daysRestricted?: number | null;
}): Promise<void> {
  await call('update_safety_incident', {
    p_incident: input.incidentId,
    p_investigation_state: input.investigationState ?? null,
    p_severity: input.severity ?? null,
    p_root_cause: input.rootCause?.trim() || null,
    p_corrective_action: input.correctiveAction?.trim() || null,
    p_immediate_action: input.immediateAction?.trim() || null,
    p_is_osha_recordable: input.isOshaRecordable ?? null,
    p_osha_case_number: input.oshaCaseNumber?.trim() || null,
    p_days_away: input.daysAway ?? null,
    p_days_restricted: input.daysRestricted ?? null,
  });
}

/**
 * Close an investigation.
 *
 * A root cause and a corrective action are both required by the database, and
 * the reason is worth repeating on screen: an incident closed without them is
 * one filed rather than fixed, and the next one has the same cause.
 */
export async function closeSafetyIncident(
  incidentId: string, rootCause: string, correctiveAction: string,
): Promise<void> {
  await call('close_safety_incident', {
    p_incident: incidentId,
    p_root_cause: rootCause.trim(),
    p_corrective_action: correctiveAction.trim(),
  });
}

/** Record a near miss, a good catch, or a hazard fixed on the spot. */
export async function recordSafetyObservation(companyId: string, input: {
  category: string; description: string; isPositive?: boolean;
  correctedOnSite?: boolean; correctiveAction?: string | null;
  projectId?: string | null; observerId?: string | null;
}): Promise<string> {
  return call('record_safety_observation', {
    p_company: companyId,
    p_category: input.category,
    p_description: input.description.trim(),
    p_is_positive: input.isPositive ?? false,
    p_corrected_on_site: input.correctedOnSite ?? false,
    p_corrective_action: input.correctiveAction?.trim() || null,
    p_project: input.projectId ?? null,
    p_observer: input.observerId ?? null,
  });
}

/**
 * Record a test, with what it measured.
 *
 * `resultValues` is the point: a pass with no numbers behind it is a word, and
 * the numbers are what an owner's engineer asks for.
 */
export async function recordInspection(input: {
  projectId: string; inspectionType: string; title: string; result?: string;
  resultValues?: Record<string, unknown>; specReference?: string | null;
  location?: string | null; station?: string | null; inspectorName?: string | null;
  inspectingAgency?: string | null; taskId?: string | null; notes?: string | null;
  retestOf?: string | null;
}): Promise<string> {
  return call('record_inspection', {
    p_project: input.projectId,
    p_inspection_type: input.inspectionType,
    p_title: input.title.trim(),
    p_result: input.result ?? 'pending',
    p_result_values: input.resultValues ?? {},
    p_spec_reference: input.specReference?.trim() || null,
    p_location: input.location?.trim() || null,
    p_station: input.station?.trim() || null,
    p_inspector_name: input.inspectorName?.trim() || null,
    p_inspecting_agency: input.inspectingAgency?.trim() || null,
    p_task: input.taskId ?? null,
    p_notes: input.notes?.trim() || null,
    p_retest_of: input.retestOf ?? null,
  });
}

/** Record the result of a test that was pending. A failure still says why. */
export async function setInspectionResult(input: {
  inspectionId: string; result: string;
  resultValues?: Record<string, unknown> | null; notes?: string | null;
}): Promise<void> {
  await call('set_inspection_result', {
    p_inspection: input.inspectionId,
    p_result: input.result,
    p_result_values: input.resultValues ?? null,
    p_notes: input.notes?.trim() || null,
  });
}
