/**
 * One shape for a project, however the screen came by it.
 *
 * The screen renders this and does not know or care whether it was read from a
 * governed schema or taken from the sample dataset — which is what lets the
 * demonstration path stay honest instead of becoming a second implementation
 * that drifts.
 *
 * Percent complete is deliberately absent. The sample dataset carries one and
 * nothing in the platform computes it: there is no progress measurement, no
 * earned value and no quantity-installed curve to derive it from. Presenting an
 * invented completion percentage beside real money would be the defect this
 * build has spent its time removing, so the live screen shows what it can
 * actually stand behind — how much has been billed, how much has been spent,
 * and how much of the budget is left after what is already promised.
 */
import { unwrap, type Query } from './query';
import { PROJECTS, CALIBRATIONS } from '@/data/operations';

export interface ProjectView {
  id: string;
  number: string;
  name: string;
  customer: string | null;
  status: string;
  contractValue: number;
  revisedContractValue: number;
  budget: number;
  actualCost: number;
  committedCost: number;
  billedToDate: number;
  /** Budget less what is spent and what is already committed. Negative is a hole. */
  costToComplete: number;
  openChangeOrders: number;
  openRfis: number;
}

export interface RateVarianceView {
  rateCode: string;
  unit: string;
  libraryRate: number;
  achievedRate: number;
  variancePercent: number;
  observations: number;
  hoursObserved: number;
  finding: string;
}

/**
 * Live projects, assembled from the governed schema.
 *
 * Four reads rather than one join: the financial view carries the money, the
 * project row carries the budget and the customer, and open change orders and
 * RFIs are counted from their own tables. Row level security scopes every one
 * of them, so none carries a company filter this code could get wrong.
 */
export const loadProjects: Query<ProjectView[]> = async (client) => {
  const [projects, financials, changeOrders, rfis] = await Promise.all([
    unwrap(await client
      .from('projects')
      .select('id, number, name, status, contract_value, approved_budget, customers(name)')
      .order('number')),
    unwrap(await client
      .from('reporting_project_financials')
      .select('project_id, revised_contract_value, actual_cost, committed_cost, billed_to_date')),
    unwrap(await client
      .from('change_orders')
      .select('project_id')
      .in('status', ['potential', 'submitted'])),
    unwrap(await client
      .from('rfis')
      .select('project_id')
      .in('status', ['open', 'draft'])),
  ]);

  const money = new Map(
    (financials as Array<Record<string, number | string | null>>).map(
      (f) => [String(f.project_id), f]),
  );
  const count = (rows: Array<{ project_id: string | null }>, id: string) =>
    rows.filter((r) => r.project_id === id).length;

  return (projects as Array<Record<string, unknown>>).map((p) => {
    const id = String(p.id);
    const f = money.get(id) ?? {};
    const budget = Number(p.approved_budget ?? 0);
    const actual = Number(f.actual_cost ?? 0);
    const committed = Number(f.committed_cost ?? 0);
    // Supabase returns an embedded to-one relation as an object or, on some
    // shapes, a single-element array. Both are handled rather than assumed.
    const embedded = p.customers as { name?: string } | { name?: string }[] | null;
    const customer = Array.isArray(embedded) ? embedded[0]?.name ?? null : embedded?.name ?? null;
    return {
      id,
      number: String(p.number),
      name: String(p.name),
      customer,
      status: String(p.status),
      contractValue: Number(p.contract_value ?? 0),
      revisedContractValue: Number(f.revised_contract_value ?? p.contract_value ?? 0),
      budget,
      actualCost: actual,
      committedCost: committed,
      billedToDate: Number(f.billed_to_date ?? 0),
      costToComplete: budget - actual - committed,
      openChangeOrders: count(changeOrders as Array<{ project_id: string | null }>, id),
      openRfis: count(rfis as Array<{ project_id: string | null }>, id),
    };
  });
};

/**
 * What the field achieved against what the library said.
 *
 * `reporting_production_variance` is the real version of the calibration card
 * this screen used to render from fixtures. It reports and does not propose: a
 * library rate is an approved record and changes through the approval workflow,
 * which is why nothing here writes one.
 */
export const loadRateVariance: Query<RateVarianceView[]> = async (client) => {
  const rows = unwrap(await client
    .from('reporting_production_variance')
    .select('rate_code, rate_unit, library_rate_per_hour, achieved_rate_per_hour, variance_percent, observations, hours_observed, finding')
    .order('variance_percent', { ascending: true })) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    rateCode: String(r.rate_code),
    unit: String(r.rate_unit),
    libraryRate: Number(r.library_rate_per_hour ?? 0),
    achievedRate: Number(r.achieved_rate_per_hour ?? 0),
    variancePercent: Number(r.variance_percent ?? 0),
    observations: Number(r.observations ?? 0),
    hoursObserved: Number(r.hours_observed ?? 0),
    finding: String(r.finding),
  }));
};

/** The sample dataset in the same shape, for a build with no project behind it. */
export function demonstrationProjects(): ProjectView[] {
  return PROJECTS.map((p) => ({
    id: p.id,
    number: p.number,
    name: p.name,
    customer: p.customer,
    status: p.status,
    contractValue: p.contractValue,
    revisedContractValue: p.contractValue,
    budget: p.budget,
    actualCost: p.actualCost,
    committedCost: 0,
    billedToDate: p.contractValue * p.percentComplete,
    costToComplete: p.budget - p.actualCost,
    openChangeOrders: p.openChangeOrders,
    openRfis: p.openRfis,
  }));
}

export function demonstrationRateVariance(): RateVarianceView[] {
  return CALIBRATIONS.map((c) => ({
    rateCode: c.rateCode,
    unit: c.rateName,
    libraryRate: c.currentRate,
    achievedRate: c.proposedRate,
    variancePercent: c.variancePercent * 100,
    observations: c.sampleSize,
    hoursObserved: 0,
    finding: c.proposedRate < c.currentRate
      ? 'library rate is optimistic'
      : 'library rate is conservative',
  }));
}
