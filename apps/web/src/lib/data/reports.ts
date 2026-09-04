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
