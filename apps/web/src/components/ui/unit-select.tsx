/**
 * Picking a unit, everywhere.
 *
 * `app.unit_code` is an enum of fourteen values and `@grounup/engine` exports
 * the same fourteen. A free-text unit field can only produce one of two
 * outcomes: a value the database refuses, or — worse — a value it accepts that
 * means something different from what the estimator meant. "Tons" is not
 * "TON", "cy" is not "CY", and a line measured in a unit the engine cannot
 * dimension prices as nothing.
 *
 * So a unit is chosen from the list the schema actually holds. The list comes
 * from the engine rather than being typed here, so adding a unit is one change
 * in one place instead of a search for every dropdown that needs to learn it.
 */
import { UNITS, UNIT_DIMENSION, type Unit } from '@grounup/engine';
import { cn } from '@/lib/utils';

/** What each unit is, in the words somebody would use on a jobsite. */
export const UNIT_LABEL: Readonly<Record<Unit, string>> = {
  LS: 'Lump sum', EA: 'Each', LF: 'Linear feet', SF: 'Square feet',
  SY: 'Square yards', CY: 'Cubic yards', TON: 'Tons', HR: 'Hours',
  DAY: 'Days', ACRE: 'Acres', GAL: 'Gallons', LB: 'Pounds',
  MO: 'Months', WK: 'Weeks',
};

/** Grouped by what they measure, so a list of fourteen reads as four short ones. */
const DIMENSION_ORDER = [
  'lumpsum', 'count', 'length', 'area', 'volume', 'mass', 'liquid', 'time',
] as const;

const DIMENSION_LABEL: Record<string, string> = {
  lumpsum: 'Lump sum', count: 'Count', length: 'Length', area: 'Area',
  volume: 'Volume', mass: 'Weight', liquid: 'Liquid', time: 'Time',
};

export function UnitSelect({
  value, onChange, disabled, allowed, allowEmpty, className, id, label,
}: {
  value: string | null | undefined;
  onChange: (unit: string) => void;
  disabled?: boolean;
  /**
   * Narrow the list. A service says which units it can be bid in, and offering
   * one it cannot is a choice the database will refuse after the estimator has
   * already made it.
   */
  allowed?: readonly string[];
  allowEmpty?: boolean;
  className?: string;
  id?: string;
  /** For the accessible name when there is no visible label beside it. */
  label?: string;
}) {
  const permitted = allowed && allowed.length > 0
    ? UNITS.filter((u) => allowed.includes(u))
    : UNITS;

  /*
   * A value that is no longer permitted is still offered, marked, rather than
   * silently vanishing from the field: a line already measured in TON on a
   * service that has since dropped TON should show what it says, so somebody
   * can see the mismatch and fix it.
   */
  const stale = value && !permitted.includes(value as Unit);

  const grouped = DIMENSION_ORDER
    .map((d) => [d, permitted.filter((u) => UNIT_DIMENSION[u] === d)] as const)
    .filter(([, us]) => us.length > 0);

  return (
    <select
      id={id}
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-8 rounded-md border border-charcoal-200 bg-white px-2 text-sm',
        'focus:border-yellow-500 focus:outline-none disabled:opacity-60',
        stale && 'border-warn-400',
        className,
      )}
    >
      {allowEmpty ? <option value="">—</option> : null}
      {stale ? (
        <option value={value as string}>{value} (not offered here)</option>
      ) : null}
      {grouped.map(([dimension, units]) => (
        <optgroup key={dimension} label={DIMENSION_LABEL[dimension] ?? dimension}>
          {units.map((u) => (
            <option key={u} value={u}>{u} — {UNIT_LABEL[u]}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
