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

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const maybeNum = (v: unknown): number | null =>
  (v === null || v === undefined ? null : Number(v));
const one = <T,>(v: unknown): T | null =>
  (Array.isArray(v) ? (v[0] as T | undefined) ?? null : (v as T | null));

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
}

const dayDiff = (from: Date, to: string) =>
  Math.round((new Date(to).getTime() - from.getTime()) / 86_400_000);

export const loadClaims: Query<ClaimRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('claims')
    .select('id, number, title, claim_type, description, status, event_date, notice_given_on, '
      + 'notice_due_on, claim_submitted_on, claim_due_on, cost_claimed, time_claimed_days, '
      + 'cost_awarded, time_awarded_days, resolution, resolved_on, project_id, '
      + 'supporting_daily_reports, supporting_rfis, supporting_documents, '
      + 'projects(number, name), contracts(number)')
    .order('event_date', { ascending: false })) as unknown as Array<Record<string, unknown>>;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return rows.map((c) => {
    const noticeGivenOn = (c.notice_given_on as string | null) ?? null;
    const noticeDueOn = (c.notice_due_on as string | null) ?? null;
    const project = one<{ number: string; name: string }>(c.projects);
    const daysToNotice = noticeDueOn ? dayDiff(today, noticeDueOn) : null;
    return {
      id: String(c.id),
      number: String(c.number),
      title: String(c.title),
      claimType: String(c.claim_type),
      description: String(c.description),
      status: c.status as ClaimStatus,
      eventDate: String(c.event_date),
      noticeGivenOn,
      noticeDueOn,
      claimSubmittedOn: (c.claim_submitted_on as string | null) ?? null,
      claimDueOn: (c.claim_due_on as string | null) ?? null,
      costClaimed: num(c.cost_claimed),
      timeClaimedDays: num(c.time_claimed_days),
      costAwarded: maybeNum(c.cost_awarded),
      timeAwardedDays: maybeNum(c.time_awarded_days),
      resolution: (c.resolution as string | null) ?? null,
      resolvedOn: (c.resolved_on as string | null) ?? null,
      projectId: String(c.project_id),
      projectNumber: project?.number ?? null,
      projectName: project?.name ?? null,
      contractNumber: one<{ number: string }>(c.contracts)?.number ?? null,
      supportingReports: ((c.supporting_daily_reports ?? []) as string[]).length,
      supportingRfis: ((c.supporting_rfis ?? []) as string[]).length,
      supportingDocuments: ((c.supporting_documents ?? []) as string[]).length,
      /*
       * Only while the claim is still live. A settled claim whose notice date
       * has passed is not at risk of anything, and flagging it would bury the
       * ones that are.
       */
      noticeAtRisk: noticeGivenOn === null && noticeDueOn !== null
        && !['settled', 'denied', 'withdrawn'].includes(String(c.status)),
      daysToNotice,
    };
  });
};
