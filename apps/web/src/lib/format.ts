/**
 * Display formatting.
 *
 * Money and quantities are formatted for scanning down a column, not for prose:
 * fixed decimals, grouped thousands, tabular figures applied by the `.tabular`
 * utility at the call site.
 */

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const usd0 = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0,
});
const rate = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4,
});

export const money = (v: number | null | undefined): string => (v == null ? '—' : usd.format(v));
export const moneyWhole = (v: number | null | undefined): string => (v == null ? '—' : usd0.format(v));
export const unitRate = (v: number | null | undefined): string => (v == null ? '—' : rate.format(v));

/** Compact money for KPI tiles: $1.2M, $840K. */
export function moneyCompact(v: number | null | undefined): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return usd0.format(v);
}

export function qty(v: number | null | undefined, decimals = 2): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(v);
}

export function integer(v: number | null | undefined): string {
  return v == null ? '—' : new Intl.NumberFormat('en-US').format(Math.round(v));
}

/** Fraction to percent. 0.125 -> "12.5%". */
export function percent(v: number | null | undefined, decimals = 1): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(decimals)}%`;
}

/**
 * A bare "YYYY-MM-DD" is parsed by `new Date` as UTC midnight, which then
 * renders as the previous day for anyone west of Greenwich. A calendar date on
 * a daily report or a submittal has no time zone — it is the day the work
 * happened — so those are parsed as local time instead.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  if (DATE_ONLY.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y!, m! - 1, d!);
  }
  return new Date(value);
}

export function date(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "in 3 days" / "2 days ago", for bid due dates and follow-ups. */
export function relativeDays(value: string | Date | null | undefined, now = new Date()): string {
  if (!value) return '—';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '—';
  const days = Math.round((d.getTime() - now.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

/** Words that must keep their conventional capitalization, not be title-cased. */
const ACRONYMS: Record<string, string> = {
  rfi: 'RFI', rfis: 'RFIs', ai: 'AI', crm: 'CRM', pdf: 'PDF',
  cy: 'CY', lf: 'LF', sf: 'SF', sy: 'SY', bcy: 'BCY', lcy: 'LCY', ccy: 'CCY',
  qa: 'QA', hse: 'HSE', gps: 'GPS', api: 'API', sso: 'SSO', dot: 'DOT',
};

export function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .split(' ')
    .map((w) => ACRONYMS[w.toLowerCase()] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** "1 estimate" / "3 estimates", with an optional irregular plural. */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : pluralForm ?? `${singular}s`}`;
}
