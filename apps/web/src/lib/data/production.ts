/**
 * Production rates: the number that turns a quantity into hours.
 *
 * Everything downstream of a line rests on it — crew cost, machine cost, fuel,
 * duration, the schedule. The library ships 2,124 of them and until migration
 * 0115 an estimator could not see which one a line was using, could not choose
 * a different one, and could not say "that is not what my crew does".
 *
 * The one design point worth carrying into this module: an override is a
 * record. `overrideLineProduction` does not write a private number onto the
 * line — it files a company production rate of source `estimator_judgment`
 * carrying the reason, and points the line at that. So the override scores
 * through the same confidence engine as every other rate and can be approved
 * into the library later. A hidden number would have priced identically and
 * made the estimate's confidence a lie.
 */
import { unwrap, type Query } from './query';

export type ProductionSource =
  | 'company_actual' | 'company_historical' | 'regional_benchmark'
  | 'seed_benchmark' | 'manufacturer' | 'estimator_judgment';

/** How each source reads to a person, and how far it should be trusted. */
export const SOURCE_LABEL: Readonly<Record<ProductionSource, string>> = {
  company_actual: 'Your measured actual',
  company_historical: 'Your history',
  regional_benchmark: 'Regional benchmark',
  seed_benchmark: 'GrounUp benchmark',
  manufacturer: 'Manufacturer',
  estimator_judgment: 'Estimator judgment',
};

export interface LineProduction {
  lineItemId: string;
  description: string;
  unit: string;
  measuredQuantity: number;
  productionRateId: string | null;
  rateCode: string | null;
  ratePerHour: number | null;
  rateUnit: string | null;
  utilizationFactor: number | null;
  shiftHours: number | null;
  sourceType: ProductionSource | null;
  confidenceScore: number | null;
  sampleSize: number | null;
  approvalState: string | null;
  /** For an override this holds the reason the estimator gave. */
  note: string | null;
  isOwnRate: boolean;
  taskName: string | null;
  /** Derived by the database from the quantity and the rate, never stored. */
  hoursAtThisRate: number | null;
}

export interface RateOption {
  rateId: string;
  taskName: string | null;
  ratePerHour: number;
  rateUnit: string;
  utilizationFactor: number;
  shiftHours: number;
  sourceType: ProductionSource;
  confidenceScore: number;
  sampleSize: number;
  approvalState: string;
  isOwn: boolean;
  /** Whether it is measured in the unit this line is bid in. */
  unitMatches: boolean;
  rank: number;
  isCurrent: boolean;
}

type RpcCapable = {
  rpc: (fn: string, args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const rpc = async <T,>(client: RpcCapable, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The rate under one line, with where it came from and the hours it implies. */
export const loadLineProduction = (lineId: string): Query<LineProduction | null> =>
  async (client) => {
    const rows = unwrap(await client
      .from('estimate_line_production')
      .select('line_item_id, description, unit, measured_quantity, production_rate_id, rate_code, rate_per_hour, rate_unit, utilization_factor, shift_hours, source_type, confidence_score, sample_size, approval_state, controlling_resource, is_own_rate, task_name, hours_at_this_rate')
      .eq('line_item_id', lineId)
      .limit(1)) as Array<Record<string, unknown>>;
    const r = rows[0];
    if (!r) return null;
    return {
      lineItemId: String(r.line_item_id),
      description: String(r.description ?? ''),
      unit: String(r.unit ?? ''),
      measuredQuantity: Number(r.measured_quantity ?? 0),
      productionRateId: (r.production_rate_id as string | null) ?? null,
      rateCode: (r.rate_code as string | null) ?? null,
      ratePerHour: num(r.rate_per_hour),
      rateUnit: (r.rate_unit as string | null) ?? null,
      utilizationFactor: num(r.utilization_factor),
      shiftHours: num(r.shift_hours),
      sourceType: (r.source_type as ProductionSource | null) ?? null,
      confidenceScore: num(r.confidence_score),
      sampleSize: r.sample_size == null ? null : Number(r.sample_size),
      approvalState: (r.approval_state as string | null) ?? null,
      note: (r.controlling_resource as string | null) ?? null,
      isOwnRate: r.is_own_rate === true,
      taskName: (r.task_name as string | null) ?? null,
      hoursAtThisRate: num(r.hours_at_this_rate),
    };
  };

/** The rates this line could use instead, best first. */
export const loadRateOptions = (lineId: string): Query<RateOption[]> => async (client) => {
  const rows = await rpc<Array<Record<string, unknown>>>(
    client as unknown as RpcCapable, 'line_production_options', { p_line: lineId });
  return (rows ?? []).map((r) => ({
    rateId: String(r.rate_id),
    taskName: (r.task_name as string | null) ?? null,
    ratePerHour: Number(r.rate_per_hour ?? 0),
    rateUnit: String(r.rate_unit ?? ''),
    utilizationFactor: Number(r.utilization_factor ?? 0),
    shiftHours: Number(r.shift_hours ?? 0),
    sourceType: r.source_type as ProductionSource,
    confidenceScore: Number(r.confidence_score ?? 0),
    sampleSize: Number(r.sample_size ?? 0),
    approvalState: String(r.approval_state ?? ''),
    isOwn: r.is_own === true,
    unitMatches: r.unit_matches === true,
    rank: Number(r.rank ?? 0),
    isCurrent: r.is_current === true,
  }));
};

/** Point the line at a different library rate. Null clears it. */
export async function setLineRate(
  client: RpcCapable, lineId: string, rateId: string | null,
): Promise<void> {
  await rpc(client, 'set_line_production_rate', { p_line: lineId, p_rate: rateId });
}

/**
 * File the estimator's own rate for this line.
 *
 * The reason is required by the database and has to be a sentence: the rate
 * under a line decides its hours, and a bare number cannot be reviewed.
 */
export async function overrideLineProduction(
  client: RpcCapable,
  input: { lineId: string; perHour: number; reason: string;
           utilization?: number | null; shiftHours?: number | null },
): Promise<string> {
  return rpc<string>(client, 'override_line_production', {
    p_line: input.lineId,
    p_per_hour: input.perHour,
    p_reason: input.reason.trim(),
    p_utilization: input.utilization ?? null,
    p_shift_hours: input.shiftHours ?? null,
  });
}

// ---------------------------------------------------------------------------
// The library screen
// ---------------------------------------------------------------------------

export interface ProductionRateRow {
  id: string;
  code: string;
  taskId: string | null;
  taskName: string | null;
  taskCategory: string | null;
  ratePerHour: number;
  rateUnit: string;
  utilizationFactor: number;
  shiftHours: number;
  sourceType: ProductionSource;
  confidenceScore: number;
  sampleSize: number;
  approvalState: string;
  region: string | null;
  effectiveDate: string | null;
  note: string | null;
  isOwn: boolean;
}

/**
 * The company's production rates and the platform's together.
 *
 * The Master Libraries screen rendered a fixture of eight while the database
 * held 2,124. Capped rather than unbounded because 2,124 rows is a table
 * nobody scrolls; the search narrows it.
 */
export const loadProductionRates = (
  search: string, category: string | null,
): Query<ProductionRateRow[]> => async (client) => {
  let q = client
    .from('my_production_rates')
    .select('id, code, task_id, task_name, task_category, rate_per_hour, rate_unit, utilization_factor, shift_hours, source_type, confidence_score, sample_size, approval_state, region, effective_date, controlling_resource, is_own');
  const t = search.trim();
  if (t) q = q.ilike('task_name', `%${t}%`);
  if (category) q = q.eq('task_category', category);
  const rows = unwrap(await q
    .order('is_own', { ascending: false })
    .order('task_name')
    .limit(400)) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    taskId: (r.task_id as string | null) ?? null,
    taskName: (r.task_name as string | null) ?? null,
    taskCategory: (r.task_category as string | null) ?? null,
    ratePerHour: Number(r.rate_per_hour ?? 0),
    rateUnit: String(r.rate_unit ?? ''),
    utilizationFactor: Number(r.utilization_factor ?? 0),
    shiftHours: Number(r.shift_hours ?? 0),
    sourceType: r.source_type as ProductionSource,
    confidenceScore: Number(r.confidence_score ?? 0),
    sampleSize: Number(r.sample_size ?? 0),
    approvalState: String(r.approval_state ?? ''),
    region: (r.region as string | null) ?? null,
    effectiveDate: (r.effective_date as string | null) ?? null,
    note: (r.controlling_resource as string | null) ?? null,
    isOwn: r.is_own === true,
  }));
};

/** Record a rate this company has measured, which outranks the shipped benchmark. */
export async function recordProductionActual(
  client: RpcCapable,
  input: { taskId: string; perHour: number; unit: string; sampleSize: number;
           note?: string | null; utilization?: number | null; companyId?: string | null },
): Promise<string> {
  return rpc<string>(client, 'record_production_actual', {
    p_task: input.taskId,
    p_per_hour: input.perHour,
    p_unit: input.unit,
    p_sample_size: input.sampleSize,
    p_note: input.note?.trim() || null,
    p_utilization: input.utilization ?? null,
    p_company: input.companyId ?? null,
  });
}
