/**
 * Company reporting, read from the semantic layer.
 *
 * These are the figures the platform publishes about itself: sixteen governed
 * metric definitions evaluated through `app.evaluate_metric`, and the project
 * financials the metrics are defined over. Reading them rather than recomputing
 * them is the point — the same number reaches this page, the public API and any
 * report, because it is computed once in one place.
 *
 * There is no demonstration equivalent, deliberately. A governed metric is a
 * definition executed against a view; without a workspace there is nothing to
 * execute it against, and inventing values would produce exactly the confident
 * fiction this layer exists to prevent. The page says so instead.
 */
import { unwrap, type Query } from './query';

export interface MetricValue {
  key: string;
  name: string;
  description: string;
  domain: string;
  unit: string;
  value: number | null;
  targetValue: number | null;
  higherIsBetter: boolean | null;
}

export const loadMetrics: Query<MetricValue[]> = async (client) => {
  const rows = unwrap(await client
    .from('reporting_metric_values')
    .select('key, name, description, domain, unit, value, target_value, higher_is_better')
    .order('domain')
    .order('name')) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    key: String(r.key),
    name: String(r.name),
    description: String(r.description),
    domain: String(r.domain),
    unit: String(r.unit),
    value: r.value == null ? null : Number(r.value),
    targetValue: r.target_value == null ? null : Number(r.target_value),
    higherIsBetter: r.higher_is_better == null ? null : Boolean(r.higher_is_better),
  }));
};

/**
 * A metric rendered the way its own definition says it should be.
 *
 * The unit is carried on the definition rather than guessed from the key, so a
 * ratio is not printed as dollars because somebody assumed.
 */
export function formatMetric(m: MetricValue): string {
  if (m.value == null) return '—';
  switch (m.unit) {
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD', maximumFractionDigits: 0,
      }).format(m.value);
    case 'percent':
      return `${(m.value * 100).toFixed(1)}%`;
    case 'ratio':
      return m.value.toFixed(2);
    case 'hours':
      return `${Math.round(m.value).toLocaleString('en-US')} hr`;
    case 'days':
      return `${m.value.toFixed(1)} days`;
    case 'count':
      return Math.round(m.value).toLocaleString('en-US');
    default:
      return m.value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
}

/** Whether a metric is on the right side of its target, when it has one. */
export function metricTone(m: MetricValue): 'success' | 'warn' | 'neutral' {
  if (m.value == null || m.targetValue == null || m.higherIsBetter == null) return 'neutral';
  const good = m.higherIsBetter ? m.value >= m.targetValue : m.value <= m.targetValue;
  return good ? 'success' : 'warn';
}

/**
 * A comma-separated export of what is on screen.
 *
 * Built from the same rows the page rendered rather than from a second query,
 * so an export cannot disagree with the figures somebody was looking at when
 * they asked for it. Values are quoted and internal quotes doubled, which is
 * the whole of CSV escaping and the part people skip.
 */
export function metricsToCsv(rows: MetricValue[]): string {
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['key', 'name', 'domain', 'unit', 'value', 'target', 'higher_is_better', 'description'];
  const body = rows.map((m) => [
    m.key, m.name, m.domain, m.unit,
    m.value ?? '', m.targetValue ?? '',
    m.higherIsBetter == null ? '' : String(m.higherIsBetter),
    m.description,
  ].map(cell).join(','));
  return [head.join(','), ...body].join('\n') + '\n';
}

/* ---------------------------------------------------------------------------
 * The reporting views that nothing read
 *
 * The semantic layer exists so a report and a customer's integration cannot
 * disagree about a number. Five of its twenty views had no reader anywhere —
 * the same defect as a function nobody calls, one layer up. A view nobody reads
 * cannot disagree with anything, which is not the same as being right.
 *
 * `scripts/build-door-inventory.mjs` now counts `reporting_*` as doors, so this
 * cannot happen quietly again.
 * ------------------------------------------------------------------------- */

export interface TakeoffStatusRow {
  measurementId: string;
  name: string;
  trade: string | null;
  kind: string;
  unit: string;
  sheetNumber: string | null;
  sheetTitle: string | null;
  statedScale: string | null;
  measurementMethod: string | null;
  appliedLineItemId: string | null;
  appliedQuantity: number | null;
  appliedAt: string | null;
  /**
   * The measurement moved after it was carried onto a line.
   *
   * The single most useful column in the semantic layer and nothing read it. A
   * trace that has been edited since it was applied leaves the line priced on a
   * quantity that is no longer on the drawing, and nothing else on any screen
   * says so.
   */
  staleOnLine: boolean;
}

export const loadTakeoffStatus: Query<TakeoffStatusRow[]> = async (client) => {
  const rows = unwrap(await client
    .from('reporting_takeoff_status')
    .select('measurement_id, name, trade, kind, unit, sheet_number, sheet_title, '
      + 'stated_scale, measurement_method, applied_line_item_id, applied_quantity, '
      + 'applied_at, stale_on_line')
    .order('applied_at', { ascending: false })
    .limit(500)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    measurementId: String(r.measurement_id),
    name: String(r.name),
    trade: (r.trade as string | null) ?? null,
    kind: String(r.kind),
    unit: String(r.unit),
    sheetNumber: (r.sheet_number as string | null) ?? null,
    sheetTitle: (r.sheet_title as string | null) ?? null,
    statedScale: (r.stated_scale as string | null) ?? null,
    measurementMethod: (r.measurement_method as string | null) ?? null,
    appliedLineItemId: (r.applied_line_item_id as string | null) ?? null,
    appliedQuantity: r.applied_quantity === null || r.applied_quantity === undefined
      ? null : Number(r.applied_quantity),
    appliedAt: (r.applied_at as string | null) ?? null,
    staleOnLine: r.stale_on_line === true,
  }));
};

export interface EstimateStructureRow {
  id: string;
  estimateVersionId: string;
  parentLineId: string | null;
  description: string;
  unit: string | null;
  depth: number;
  path: string;
  measuredQuantity: number | null;
  grossQuantity: number | null;
  totalDirectCost: number;
  /** What this line costs on its own, with its children's cost taken out. */
  immediateCost: number;
  isRollup: boolean;
  parametricBasis: string | null;
  perParentUnit: number | null;
}

/** One estimate version's hierarchy, with rollups separated from own cost. */
export const loadEstimateStructure = (versionId: string): Query<EstimateStructureRow[]> =>
  async (client) => {
    if (!versionId) return [];
    const rows = unwrap(await client
      .from('reporting_estimate_structure')
      .select('id, estimate_version_id, parent_line_id, description, unit, depth, path, '
        + 'measured_quantity, gross_quantity, total_direct_cost, immediate_cost, '
        + 'is_rollup, parametric_basis, per_parent_unit, sort_path')
      .eq('estimate_version_id', versionId)
      .order('sort_path')) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      estimateVersionId: String(r.estimate_version_id),
      parentLineId: (r.parent_line_id as string | null) ?? null,
      description: String(r.description),
      unit: (r.unit as string | null) ?? null,
      depth: Number(r.depth ?? 0),
      path: String(r.path ?? ''),
      measuredQuantity: r.measured_quantity === null || r.measured_quantity === undefined
        ? null : Number(r.measured_quantity),
      grossQuantity: r.gross_quantity === null || r.gross_quantity === undefined
        ? null : Number(r.gross_quantity),
      totalDirectCost: Number(r.total_direct_cost ?? 0),
      immediateCost: Number(r.immediate_cost ?? 0),
      isRollup: r.is_rollup === true,
      parametricBasis: (r.parametric_basis as string | null) ?? null,
      perParentUnit: r.per_parent_unit === null || r.per_parent_unit === undefined
        ? null : Number(r.per_parent_unit),
    }));
  };
