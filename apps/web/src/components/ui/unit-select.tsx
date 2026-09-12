/**
 * Picking a unit, everywhere.
 *
 * `app.unit_code` is a closed enum and `@grounup/engine` exports the same
 * values in the same order, held there by a governance test. A free-text unit field can only produce one of two
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

/**
 * What each unit is, in the words somebody would use on a jobsite.
 *
 * Not what the picker shows. An estimator reads CY, LF and TON faster than
 * "Cubic yards" — they are the words of the trade, and a column of them lines
 * up where a column of prose does not. The long form stays here for a tooltip
 * and for anywhere a unit has to be explained rather than picked.
 */
export const UNIT_LABEL: Readonly<Record<Unit, string>> = {
  LS: 'Lump sum', EA: 'Each', LF: 'Linear feet', SF: 'Square feet',
  SY: 'Square yards', CY: 'Cubic yards', TON: 'Tons', HR: 'Hours',
  DAY: 'Days', ACRE: 'Acres', GAL: 'Gallons', LB: 'Pounds',
  MO: 'Months', WK: 'Weeks',
  BF: 'Board feet', SQ: 'Roofing squares', KW: 'Kilowatts', CF: 'Cubic feet',
};

/** Grouped by what they measure, so a list of fourteen reads as four short ones. */
const DIMENSION_ORDER = [
  'lumpsum', 'count', 'length', 'area', 'volume', 'lumber', 'mass', 'liquid',
  'power', 'time',
] as const;

const DIMENSION_LABEL: Record<string, string> = {
  lumpsum: 'Lump sum', count: 'Count', length: 'Length', area: 'Area',
  volume: 'Volume', lumber: 'Lumber', mass: 'Weight', liquid: 'Liquid',
  power: 'Power', time: 'Time',
};

export function UnitSelect({
  value, onChange, disabled, allowed, allowEmpty, className, id, label,
}: {
  value: string | null | undefined;
  onChange: (unit: string) => void;
  disabled?: boolean;
  /**
   * The units a service says it is normally measured in.
   *
   * A recommendation, not a wall. Migration 0117 stopped refusing anything
   * else, because a company that bids topsoil by the load rather than the cubic
   * yard is not making a mistake — the catalog's list is GrounUp's opinion
   * about how a trade is usually measured, and how a contractor sells their own
   * work outranks it. So these are offered first, under a heading that says so,
   * and every other unit stays available beneath.
   */
  allowed?: readonly string[];
  allowEmpty?: boolean;
  className?: string;
  id?: string;
  /** For the accessible name when there is no visible label beside it. */
  label?: string;
}) {
  const recommended = allowed && allowed.length > 0
    ? UNITS.filter((u) => allowed.includes(u))
    : [];
  const rest = recommended.length > 0
    ? UNITS.filter((u) => !allowed!.includes(u))
    : UNITS;

  /*
   * Off the service's list is not an error any more, but it is worth seeing:
   * an estimator who picked TON on a service the catalog measures in CY should
   * be able to tell at a glance that they are off the recommendation.
   */
  const offList = Boolean(value && recommended.length > 0
    && !recommended.includes(value as Unit));

  const grouped = DIMENSION_ORDER
    .map((d) => [d, rest.filter((u) => UNIT_DIMENSION[u] === d)] as const)
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
        offList && 'border-warn-400',
        className,
      )}
    >
      {allowEmpty ? <option value="">—</option> : null}
      {recommended.length > 0 ? (
        <optgroup label="Usually measured in">
          {recommended.map((u) => (
            <option key={u} value={u} title={UNIT_LABEL[u]}>{u}</option>
          ))}
        </optgroup>
      ) : null}
      {grouped.map(([dimension, units]) => (
        <optgroup key={dimension}
          label={recommended.length > 0
            ? `Other · ${DIMENSION_LABEL[dimension] ?? dimension}`
            : (DIMENSION_LABEL[dimension] ?? dimension)}>
          {units.map((u) => (
            <option key={u} value={u} title={UNIT_LABEL[u]}>{u}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
