/**
 * Entity — the claims a company is running, and whether they are still alive.
 *
 * `claims.tsx` read `CLAIMS` from `@/data/survey`. The `claims` table has
 * existed since migration 0023, fully governed, with no reader anywhere.
 *
 * The governance is the point, and the screen should show what it protects:
 *
 *   * **`claims_notice`** — a claim past `potential` must carry the date notice
 *     was given. Notice is what preserves entitlement; a claim with merit and
 *     no notice is usually worth nothing, and the constraint says so.
 *   * **`claims_notice_order`** — notice cannot precede the event it is about.
 *   * **`claims_resolved`** — settled or denied requires the date *and* the
 *     resolution. "Denied" with no reason recorded is not a resolution, it is
 *     an outcome nobody can learn from.
 *
 * A claim also carries arrays of the daily reports, RFIs and documents it is
 * argued from. Those are contemporaneous records — which is exactly why
 * migration 0157 mattered: until this afternoon a company could not create a
 * daily report at all, so a claim had nothing to point at.
 */
import { unwrap, type Query } from './query';
import { supabase } from '@/lib/supabase';

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const maybeNum = (v: unknown): number | null =>
  (v === null || v === undefined ? null : Number(v));

export type ClaimStatus =
  | 'potential' | 'notice_given' | 'submitted' | 'negotiating'
  | 'settled' | 'denied' | 'withdrawn' | 'litigation';

export interface ClaimRow {
  id: string;
  number: string;
  title: string;
  claimType: string;
  description: string;
  status: ClaimStatus;
  eventDate: string;
  noticeGivenOn: string | null;
  noticeDueOn: string | null;
  claimSubmittedOn: string | null;
  claimDueOn: string | null;
  costClaimed: number;
  timeClaimedDays: number;
  costAwarded: number | null;
  timeAwardedDays: number | null;
  resolution: string | null;
  resolvedOn: string | null;
  projectId: string;
  projectNumber: string | null;
  projectName: string | null;
  contractNumber: string | null;
  /** How much contemporaneous record stands behind it. */
  supportingReports: number;
  supportingRfis: number;
  supportingDocuments: number;
  /**
   * Notice is due, and nobody has given it.
   *
   * The single most expensive fact on this page. A claim whose notice period
   * lapses is usually worth nothing however good the argument, so it is
   * computed here rather than left for a reader to work out from two dates.
   */
  noticeAtRisk: boolean;
  /** Days until notice is due; negative means the date has passed. */
  daysToNotice: number | null;
  /**
   * Notice was given, and it was given after the deadline.
   *
   * Recorded rather than refused, deliberately: most construction claims are
   * lost on the notice clause rather than on their merits, and a screen that
   * hid a late notice to keep the record tidy would be hiding the most
   * expensive fact a company can know about its own claim.
   */
  noticeWasLate: boolean;
  noticeDaysLate: number | null;
  contractId: string | null;
}

export const loadClaims: Query<ClaimRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_claims')
    .select('id, number, title, claim_type, description, status, event_date, notice_given_on, '
      + 'notice_due_on, claim_submitted_on, claim_due_on, cost_claimed, time_claimed_days, '
      + 'cost_awarded, time_awarded_days, resolution, resolved_on, project_id, contract_id, '
      + 'project_number, project_name, contract_number, supporting_reports, supporting_rfis, '
      + 'supporting_documents, days_to_notice, notice_outstanding, notice_was_late, '
      + 'notice_days_late')
    .order('event_date', { ascending: false })) as unknown as Array<Record<string, unknown>>;

  return rows.map((c) => ({
    id: String(c.id),
    number: String(c.number),
    title: String(c.title),
    claimType: String(c.claim_type),
    description: String(c.description),
    status: c.status as ClaimStatus,
    eventDate: String(c.event_date),
    noticeGivenOn: (c.notice_given_on as string | null) ?? null,
    noticeDueOn: (c.notice_due_on as string | null) ?? null,
    claimSubmittedOn: (c.claim_submitted_on as string | null) ?? null,
    claimDueOn: (c.claim_due_on as string | null) ?? null,
    costClaimed: num(c.cost_claimed),
    timeClaimedDays: num(c.time_claimed_days),
    costAwarded: maybeNum(c.cost_awarded),
    timeAwardedDays: maybeNum(c.time_awarded_days),
    resolution: (c.resolution as string | null) ?? null,
    resolvedOn: (c.resolved_on as string | null) ?? null,
    projectId: String(c.project_id),
    contractId: (c.contract_id as string | null) ?? null,
    projectNumber: (c.project_number as string | null) ?? null,
    projectName: (c.project_name as string | null) ?? null,
    contractNumber: (c.contract_number as string | null) ?? null,
    supportingReports: num(c.supporting_reports),
    supportingRfis: num(c.supporting_rfis),
    supportingDocuments: num(c.supporting_documents),
    /*
     * Computed by the view, not again here. Only while the claim is still
     * live: a settled claim whose notice date has passed is not at risk of
     * anything, and flagging it would bury the ones that are.
     */
    noticeAtRisk: c.notice_outstanding === true,
    daysToNotice: maybeNum(c.days_to_notice),
    noticeWasLate: c.notice_was_late === true,
    noticeDaysLate: maybeNum(c.notice_days_late),
  }));
};

export interface ContractRow {
  id: string;
  projectId: string;
  projectNumber: string;
  projectName: string;
  number: string;
  title: string;
  contractType: string;
  originalValue: number;
  executedOn: string | null;
  substantialCompletionOn: string | null;
  finalCompletionOn: string | null;
  noticeDays: number | null;
  claimDays: number | null;
  liquidatedDamagesPerDay: number | null;
  retainagePercent: number;
  status: string;
  customerName: string | null;
  /**
   * Whether a claim under this contract will get a computed deadline at all.
   *
   * A contract with no clause on file is not a contract with no clause, and the
   * difference decides whether anybody is ever warned about a notice period.
   */
  noticeClauseOnFile: boolean;
  claimCount: number;
}

export const loadContracts: Query<ContractRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_contracts')
    .select('id, project_id, project_number, project_name, number, title, contract_type, '
      + 'original_value, executed_on, substantial_completion_on, final_completion_on, '
      + 'notice_days, claim_days, liquidated_damages_per_day, retainage_percent, status, '
      + 'customer_name, notice_clause_on_file, claim_count')
    .order('number')) as unknown as Array<Record<string, unknown>>;
  return rows.map((c) => ({
    id: String(c.id),
    projectId: String(c.project_id),
    projectNumber: String(c.project_number),
    projectName: String(c.project_name),
    number: String(c.number),
    title: String(c.title),
    contractType: String(c.contract_type),
    originalValue: num(c.original_value),
    executedOn: (c.executed_on as string | null) ?? null,
    substantialCompletionOn: (c.substantial_completion_on as string | null) ?? null,
    finalCompletionOn: (c.final_completion_on as string | null) ?? null,
    noticeDays: maybeNum(c.notice_days),
    claimDays: maybeNum(c.claim_days),
    liquidatedDamagesPerDay: maybeNum(c.liquidated_damages_per_day),
    retainagePercent: num(c.retainage_percent),
    status: String(c.status),
    customerName: (c.customer_name as string | null) ?? null,
    noticeClauseOnFile: c.notice_clause_on_file === true,
    claimCount: num(c.claim_count),
  }));
};

/* ---------------------------------------------------------------------------
 * Writers — migration 0197
 *
 * `contracts` and `claims` had no writer of any kind, so a company could read
 * the claims it was running and could not open one. `app.derive_claim_deadlines`
 * had never fired in its life.
 * ------------------------------------------------------------------------- */

const rpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
  if (!supabase) throw new Error('No workspace is configured.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};

/** The claim types the schema accepts, in the order a list should offer them. */
export const CLAIM_TYPES = [
  'differing_site_condition', 'delay', 'acceleration', 'disruption',
  'changed_scope', 'suspension', 'defective_documents', 'payment', 'other',
] as const;

export const CONTRACT_TYPES = [
  'lump_sum', 'unit_price', 'cost_plus', 'gmp', 'time_and_materials',
] as const;

export async function createContract(projectId: string, contract: {
  title: string; contractType?: string; originalValue?: number;
  customerId?: string | null; executedOn?: string | null;
  noticeDays?: number | null; claimDays?: number | null;
  liquidatedDamagesPerDay?: number | null; retainagePercent?: number | null;
}): Promise<string> {
  return String(await rpc('create_contract', {
    p_project: projectId,
    p_title: contract.title.trim(),
    p_contract_type: contract.contractType ?? 'lump_sum',
    p_original_value: contract.originalValue ?? 0,
    p_customer: contract.customerId ?? null,
    p_executed_on: contract.executedOn || null,
    p_notice_days: contract.noticeDays ?? null,
    p_claim_days: contract.claimDays ?? null,
    p_liquidated_damages_per_day: contract.liquidatedDamagesPerDay ?? null,
    p_retainage_percent: contract.retainagePercent ?? null,
  }));
}

export async function updateContract(contractId: string, changes: Partial<{
  title: string; contractType: string; originalValue: number; executedOn: string;
  substantialCompletionOn: string; finalCompletionOn: string;
  noticeDays: number; claimDays: number; liquidatedDamagesPerDay: number;
  retainagePercent: number; status: string;
}>): Promise<void> {
  await rpc('update_contract', {
    p_contract: contractId,
    p_title: changes.title ?? null,
    p_contract_type: changes.contractType ?? null,
    p_original_value: changes.originalValue ?? null,
    p_executed_on: changes.executedOn ?? null,
    p_substantial_completion_on: changes.substantialCompletionOn ?? null,
    p_final_completion_on: changes.finalCompletionOn ?? null,
    p_notice_days: changes.noticeDays ?? null,
    p_claim_days: changes.claimDays ?? null,
    p_liquidated_damages_per_day: changes.liquidatedDamagesPerDay ?? null,
    p_retainage_percent: changes.retainagePercent ?? null,
    p_status: changes.status ?? null,
  });
}

/**
 * Open a claim, as a potential one.
 *
 * The deadlines are not sent. They are derived from the contract's own clauses,
 * which is why those clauses are stored as numbers of days — a deadline typed by
 * hand stops agreeing with the contract the moment either is corrected.
 */
export async function createClaim(projectId: string, claim: {
  title: string; claimType: string; description: string; eventDate: string;
  contractId?: string | null; costClaimed?: number; timeClaimedDays?: number;
}): Promise<string> {
  return String(await rpc('create_claim', {
    p_project: projectId,
    p_title: claim.title.trim(),
    p_claim_type: claim.claimType,
    p_description: claim.description.trim(),
    p_event_date: claim.eventDate,
    p_contract: claim.contractId ?? null,
    p_cost_claimed: claim.costClaimed ?? 0,
    p_time_claimed_days: claim.timeClaimedDays ?? 0,
  }));
}

/** Record that notice was given. A late one is recorded, never refused. */
export async function giveClaimNotice(claimId: string, givenOn: string): Promise<void> {
  await rpc('give_claim_notice', { p_claim: claimId, p_given_on: givenOn });
}

export async function submitClaim(claimId: string, submitted: {
  submittedOn: string; costClaimed?: number | null; timeClaimedDays?: number | null;
}): Promise<void> {
  await rpc('submit_claim', {
    p_claim: claimId,
    p_submitted_on: submitted.submittedOn,
    p_cost_claimed: submitted.costClaimed ?? null,
    p_time_claimed_days: submitted.timeClaimedDays ?? null,
  });
}

export async function setClaimStatus(claimId: string, status: string): Promise<void> {
  await rpc('set_claim_status', { p_claim: claimId, p_status: status });
}

export async function resolveClaim(claimId: string, resolution: {
  status: 'settled' | 'denied'; resolution: string; resolvedOn?: string;
  costAwarded?: number | null; timeAwardedDays?: number | null;
}): Promise<void> {
  await rpc('resolve_claim', {
    p_claim: claimId,
    p_status: resolution.status,
    p_resolution: resolution.resolution.trim(),
    p_resolved_on: resolution.resolvedOn ?? new Date().toISOString().slice(0, 10),
    p_cost_awarded: resolution.costAwarded ?? null,
    p_time_awarded_days: resolution.timeAwardedDays ?? null,
  });
}

export async function attachClaimSupport(
  claimId: string, kind: 'daily_report' | 'rfi' | 'document', recordId: string,
): Promise<void> {
  await rpc('attach_claim_support', { p_claim: claimId, p_kind: kind, p_record: recordId });
}

export async function detachClaimSupport(
  claimId: string, kind: 'daily_report' | 'rfi' | 'document', recordId: string,
): Promise<void> {
  await rpc('detach_claim_support', { p_claim: claimId, p_kind: kind, p_record: recordId });
}
