/**
 * The first screen, on real data.
 *
 * The dashboard has shown a fixture since it was built: an invented pipeline, an
 * invented backlog, an invented win rate. Every one of those is now countable
 * from the caller's own tenant, and a figure the platform can stand behind is
 * worth more than a prettier one it cannot.
 *
 * What is on it is chosen by the same test: five things that cost a contractor
 * money when nobody looks at them.
 *
 *   * a bid due this week that nobody has started;
 *   * a proposal sitting with a customer that nobody has chased;
 *   * an estimate the engine has blocked, found on the day it is due;
 *   * days the weather is about to take, before the schedule promises them;
 *   * work billed and not collected.
 *
 * There is no "percent complete" and no win rate invented from nothing. Where
 * the platform cannot measure something, this says so rather than filling the
 * space.
 */
import { unwrap, type Query } from './query';

export interface DueBid {
  id: string;
  versionId: string | null;
  number: string;
  name: string;
  customerName: string | null;
  /** Whichever comes first: the bid deadline or the day the price goes stale. */
  dueAt: string;
  dueKind: 'bid' | 'expiry';
  status: string;
  bidPrice: number;
  priced: boolean;
  blockedFromIssue: boolean;
  daysAway: number;
}

export interface AwaitingAnswer {
  id: string;
  number: string;
  title: string;
  customerName: string | null;
  totalPrice: number;
  issuedAt: string | null;
  daysOut: number;
  /** Past the validity the proposal itself states. */
  lapsed: boolean;
}

export interface WeatherDay {
  day: string;
  highF: number | null;
  lowF: number | null;
  precipInches: number;
  precipChance: number | null;
  summary: string | null;
  workable: boolean;
  lostReason: string | null;
}

export interface MoneyOut {
  billedToDate: number;
  actualCost: number;
  committedCost: number;
  contractValue: number;
  activeProjects: number;
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const one = <T,>(v: unknown): T | null =>
  (Array.isArray(v) ? (v as T[])[0] : (v as T | null)) ?? null;

const daysBetween = (iso: string): number =>
  Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

/**
 * What is due, soonest first.
 *
 * A bid deadline and an expiry are the same kind of fact — a date after which
 * doing nothing costs you the job — so they are one list rather than two
 * panels. Which one it is is stated, because the answer to each is different:
 * a deadline means finish it, an expiry means reprice it.
 */
export const loadDueBids: Query<DueBid[]> = async (client) => {
  const rows = unwrap(await client
    .from('estimates')
    .select('id, number, name, status, bid_due_at, expires_at, current_version_id, customers(name), estimate_versions!estimates_current_version_fk(bid_price, total_price, blocked_from_issue, calculated_at)')
    .in('status', ['draft', 'in_review', 'approved', 'issued'])
    .limit(300)) as Array<Record<string, unknown>>;

  const due: DueBid[] = [];
  for (const e of rows) {
    const v = one<Record<string, unknown>>(e.estimate_versions);
    const candidates: Array<[string, 'bid' | 'expiry']> = [];
    if (e.bid_due_at) candidates.push([String(e.bid_due_at), 'bid']);
    if (e.expires_at) candidates.push([String(e.expires_at), 'expiry']);
    if (candidates.length === 0) continue;

    // The one that bites first is the one worth showing.
    candidates.sort((a, b) => a[0].localeCompare(b[0]));
    const [dueAt, dueKind] = candidates[0]!;
    due.push({
      id: String(e.id),
      versionId: (e.current_version_id as string | null) ?? null,
      number: String(e.number),
      name: String(e.name),
      customerName: one<{ name: string }>(e.customers)?.name ?? null,
      dueAt, dueKind,
      status: String(e.status),
      bidPrice: num(v?.bid_price) || num(v?.total_price),
      priced: v?.calculated_at != null,
      blockedFromIssue: v ? Boolean(v.blocked_from_issue) : true,
      daysAway: daysBetween(dueAt),
    });
  }
  return due.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
};

/**
 * Bids that went out and have not been answered.
 *
 * The panel nobody had, because until migration 0101 nothing could record an
 * answer — so every proposal ever issued sat in this state forever and the
 * list would have been meaningless.
 */
export const loadAwaitingAnswer: Query<AwaitingAnswer[]> = async (client) => {
  const rows = unwrap(await client
    .from('proposals')
    .select('id, number, title, total_price, issued_at, validity_days, customers(name)')
    .eq('status', 'issued')
    .order('issued_at', { ascending: true })
    .limit(100)) as Array<Record<string, unknown>>;

  return rows.map((p) => {
    const issuedAt = (p.issued_at as string | null) ?? null;
    const daysOut = issuedAt ? -daysBetween(issuedAt) : 0;
    return {
      id: String(p.id),
      number: String(p.number),
      title: String(p.title),
      customerName: one<{ name: string }>(p.customers)?.name ?? null,
      totalPrice: num(p.total_price),
      issuedAt,
      daysOut,
      // Past the validity the document itself states, so the price it names is
      // no longer one the company is standing behind.
      lapsed: daysOut > Number(p.validity_days ?? 30),
    };
  });
};

/** The forecast, as it was last fetched. Refreshing it is the function's job. */
export const loadWeather: Query<WeatherDay[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_weather')
    .select('day, high_f, low_f, precip_inches, precip_chance, summary, workable, lost_reason')
    .limit(14)) as Array<Record<string, unknown>>;
  return rows.map((w) => ({
    day: String(w.day),
    highF: w.high_f == null ? null : Number(w.high_f),
    lowF: w.low_f == null ? null : Number(w.low_f),
    precipInches: num(w.precip_inches),
    precipChance: w.precip_chance == null ? null : Number(w.precip_chance),
    summary: (w.summary as string | null) ?? null,
    workable: Boolean(w.workable),
    lostReason: (w.lost_reason as string | null) ?? null,
  }));
};

/**
 * Money, from the same governed view the reports and the public API read.
 *
 * One source, so what a dashboard says and what a report says cannot disagree
 * — which is the whole reason the reporting view exists.
 */
export const loadMoney: Query<MoneyOut> = async (client) => {
  const rows = unwrap(await client
    .from('reporting_project_financials')
    .select('status, revised_contract_value, billed_to_date, actual_cost, committed_cost')
    .limit(500)) as Array<Record<string, unknown>>;

  const active = rows.filter((r) => r.status === 'active');
  return {
    billedToDate: active.reduce((a, r) => a + num(r.billed_to_date), 0),
    actualCost: active.reduce((a, r) => a + num(r.actual_cost), 0),
    committedCost: active.reduce((a, r) => a + num(r.committed_cost), 0),
    contractValue: active.reduce((a, r) => a + num(r.revised_contract_value), 0),
    activeProjects: active.length,
  };
};

/**
 * How many live estimates the engine has not cleared to issue.
 *
 * A count rather than the rows, because the header wants a number and the
 * list belongs on the estimator screen. `head: true` asks PostgREST for the
 * count without the bodies.
 */
export const loadBlockedCount: Query<number> = async (client) => {
  const { count, error } = await client
    .from('estimate_versions')
    .select('id', { count: 'exact', head: true })
    .eq('blocked_from_issue', true)
    .in('status', ['draft', 'in_review', 'approved']);
  if (error) throw new Error(error.message);
  return count ?? 0;
};

type FunctionCaller = (name: string, body: unknown) => Promise<unknown>;

/**
 * Ask for a fresh forecast.
 *
 * Separate from reading it because they cost different things: reading is a
 * row from the caller's own tenant, refreshing is a request to somebody else's
 * service. A dashboard that refreshed on every open would make an external
 * call per page view for a number that changes four times a day.
 */
export async function refreshWeather(
  call: FunctionCaller, companyId: string,
): Promise<{ refreshed: boolean; efficiency: number | null }> {
  const result = await call('refresh-weather', { companyId }) as
    { refreshed?: boolean; efficiency?: number | null };
  return {
    refreshed: Boolean(result.refreshed),
    efficiency: result.efficiency ?? null,
  };
}

// ---------------------------------------------------------------------------
// The panels an advanced dashboard is built from
//
// Each of these reads a reporting view that already existed and that nothing
// rendered. The dashboard showed four figures and three panels while the
// semantic layer held nineteen views — so a company could be over-billed on a
// project, have a foreman's certification lapsing in nine days and an
// investigation still open, and the first screen they see every morning said
// none of it.
// ---------------------------------------------------------------------------

/** A certification about to lapse, and what it stops somebody doing. */
export interface CredentialExpiry {
  credentialId: string;
  employeeName: string;
  credentialName: string;
  standing: string;
  daysRemaining: number | null;
  blocksWorkTypes: string[];
}

export const loadCredentialExpiries: Query<CredentialExpiry[]> = async (client) => {
  const rows = unwrap(await client
    .from('reporting_credential_expiry')
    .select('credential_id, employee_name, credential_name, standing, days_remaining, blocks_work_types')
    .neq('standing', 'valid')
    .order('days_remaining', { ascending: true, nullsFirst: false })
    .limit(12)) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    credentialId: String(r.credential_id),
    employeeName: String(r.employee_name ?? ''),
    credentialName: String(r.credential_name ?? ''),
    standing: String(r.standing ?? ''),
    daysRemaining: r.days_remaining == null ? null : Number(r.days_remaining),
    blocksWorkTypes: (r.blocks_work_types as string[]) ?? [],
  }));
};

/** A project's billing against what it has earned. */
export interface ProjectBilling {
  projectId: string;
  projectNumber: string;
  projectName: string;
  contractValue: number;
  percentComplete: number;
  earnedRevenue: number;
  billedToDate: number;
  /** Positive is over-billed, negative is under-billed. */
  overUnderBilled: number;
  retainageHeld: number;
}

export const loadProjectBilling: Query<ProjectBilling[]> = async (client) => {
  const rows = unwrap(await client
    .from('reporting_project_financials')
    .select('project_id, project_number, project_name, contract_value, percent_complete, earned_revenue, billed_to_date, over_under_billed, retainage_held')
    .order('over_under_billed', { ascending: true })
    .limit(12)) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    projectId: String(r.project_id),
    projectNumber: String(r.project_number ?? ''),
    projectName: String(r.project_name ?? ''),
    contractValue: Number(r.contract_value ?? 0),
    percentComplete: Number(r.percent_complete ?? 0),
    earnedRevenue: Number(r.earned_revenue ?? 0),
    billedToDate: Number(r.billed_to_date ?? 0),
    overUnderBilled: Number(r.over_under_billed ?? 0),
    retainageHeld: Number(r.retainage_held ?? 0),
  }));
};

/** An activity that has moved away from the baseline it was sold on. */
export interface ScheduleSlip {
  activityId: string;
  activityName: string;
  baselineFinish: string | null;
  currentFinish: string | null;
  finishVarianceDays: number;
  status: string | null;
}

export const loadScheduleSlips: Query<ScheduleSlip[]> = async (client) => {
  const rows = unwrap(await client
    .from('reporting_schedule_variance')
    .select('schedule_activity_id, activity_name, baseline_finish, current_finish, finish_variance_days, status')
    .gt('finish_variance_days', 0)
    .order('finish_variance_days', { ascending: false })
    .limit(12)) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    activityId: String(r.schedule_activity_id),
    activityName: String(r.activity_name ?? ''),
    baselineFinish: (r.baseline_finish as string | null) ?? null,
    currentFinish: (r.current_finish as string | null) ?? null,
    finishVarianceDays: Number(r.finish_variance_days ?? 0),
    status: (r.status as string | null) ?? null,
  }));
};

/** Incidents this month and last, and what is still being investigated. */
export interface SafetyStanding {
  monthOf: string;
  incidents: number;
  recordables: number;
  lostTimeCases: number;
  openInvestigations: number;
}

export const loadSafetyStanding: Query<SafetyStanding[]> = async (client) => {
  const rows = unwrap(await client
    .from('reporting_safety_summary')
    .select('month_of, incidents, recordables, lost_time_cases, open_investigations')
    .order('month_of', { ascending: false })
    .limit(6)) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    monthOf: String(r.month_of),
    incidents: Number(r.incidents ?? 0),
    recordables: Number(r.recordables ?? 0),
    lostTimeCases: Number(r.lost_time_cases ?? 0),
    openInvestigations: Number(r.open_investigations ?? 0),
  }));
};

/** How bidding has gone, month by month. */
export interface BidMonth {
  monthOf: string;
  estimates: number;
  submitted: number;
  won: number;
  lost: number;
  wins: number;
  losses: number;
  hitRate: number | null;
}

export const loadBidPerformance: Query<BidMonth[]> = async (client) => {
  const rows = unwrap(await client
    .from('reporting_bid_performance')
    .select('month_of, estimates, submitted, won, lost, wins, losses, hit_rate')
    .order('month_of', { ascending: false })
    .limit(6)) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    monthOf: String(r.month_of),
    estimates: Number(r.estimates ?? 0),
    submitted: Number(r.submitted ?? 0),
    won: Number(r.won ?? 0),
    lost: Number(r.lost ?? 0),
    wins: Number(r.wins ?? 0),
    losses: Number(r.losses ?? 0),
    hitRate: r.hit_rate == null ? null : Number(r.hit_rate),
  }));
};
