/**
 * Engine — what has been checked about this quantity.
 *
 * The estimating engine scores every line's confidence, and the score decides
 * whether the line blocks its estimate from being issued. Three of the four
 * inputs are attestations by the estimator: was the quantity taken from the
 * governing document, was it confirmed against a second source, was the
 * arithmetic reproduced. They are columns on the line, they are read by the
 * pricing function, they are handed to the engine — and until migration 0144
 * no screen could set one.
 *
 * That was not a cosmetic gap. All three false on a hand-entered quantity
 * scores around 30, which is below 80, which routes the line to senior review,
 * which blocks issue, which blocks approval — so an estimate somebody typed
 * could never be approved, issued, or awarded into a project, and the only
 * thing the screen could say was "1 line is not confident enough to bid" with
 * no control anywhere able to answer it.
 *
 * Two things about the shape:
 *
 *   * **These are claims, not observations.** The platform cannot tell whether
 *     somebody checked a dimension against the plan, which is exactly why it
 *     has to ask rather than derive. The labels are written as the claim being
 *     made, so ticking one is a statement a person would stand behind.
 *   * **It says what ticking one does.** A control that silently moves a bid
 *     from unbiddable to biddable, without saying that is what it does, is the
 *     kind of thing people tick without reading.
 */
import { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Alert } from '@/components/ui/misc';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { messageFor } from '@/lib/data/query';
import { updateLine, type LineRow } from '@/lib/data/estimates';
import { supabase } from '@/lib/supabase';

/** The three checks, in the order the engine weighs them. */
const CHECKS = [
  {
    field: 'check_primary_source' as const,
    of: (l: LineRow) => l.checkPrimarySource,
    label: 'Taken from the governing document',
    says: 'The quantity came off the drawing or specification that governs, not from a summary, a schedule or somebody’s note.',
  },
  {
    field: 'check_cross_source' as const,
    of: (l: LineRow) => l.checkCrossSource,
    label: 'Confirmed against a second source',
    says: 'A different sheet, the specification, or the owner’s own takeoff agrees with it.',
  },
  {
    field: 'check_reconciliation' as const,
    of: (l: LineRow) => l.checkReconciliation,
    label: 'Arithmetic reproduced and agreed',
    says: 'The areas sum to the whole, the lengths close, the counts match the schedule.',
  },
];

/**
 * How the quantity was arrived at.
 *
 * The engine treats a scaled or allowed quantity as needing a second pair of
 * eyes however confident the estimator is, which is why this is a separate
 * question from the three checks rather than a fourth tick box.
 */
/*
 * Exactly the eight values `app.measurement_method` holds, in the order from
 * strongest evidence to weakest. The list is not a superset and not a subset:
 * an option the enum does not have is a refused write, and an option it has
 * that is missing here is a quantity basis nobody can record.
 */
export const METHODS = [
  { value: 'explicit_dimension', label: 'Dimensioned on the plans' },
  { value: 'calculated', label: 'Calculated from dimensions on the plans' },
  { value: 'schedule_quantity', label: 'Taken from a schedule on the drawings' },
  { value: 'owner_quantity', label: 'Given by the owner' },
  { value: 'verified_scale', label: 'Scaled, and the scale was verified' },
  { value: 'derived', label: 'Derived from another quantity' },
  { value: 'approximate_scale', label: 'Scaled approximately' },
  { value: 'estimator_allowance', label: 'An allowance, not a measurement' },
];

export function HowSure({ line, editable, onChanged }: {
  line: LineRow;
  editable: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ticked = CHECKS.filter((c) => c.of(line)).length;
  /*
   * A line priced by a typed rate is an allowance, and migration 0066 makes
   * the database say so rather than trusting an application to remember:
   * `eli_parametric_is_an_allowance` refuses any other basis while
   * `parametric_cost_per_unit` is set. Offering the choice anyway would be a
   * control that takes a value and changes nothing — the second shape of the
   * defect this codebase keeps producing — so the reason is said instead.
   */
  const lockedToAllowance = line.parametricCostPerUnit !== null;

  async function set(field: string, value: string | boolean) {
    if (!supabase) return;
    setBusy(field); setError(null);
    try {
      await updateLine(supabase, line.id, { [field]: value });
      onChanged();
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-charcoal-500" />
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-charcoal-900">How sure are you of this quantity</p>
          <p className="text-xs leading-relaxed text-charcoal-500">
            The engine scores this line&apos;s confidence from these answers, and a line it scores
            below 80 routes to senior review and holds the whole estimate back from being issued.
            Nothing here changes a cost — it changes what the platform is willing to let you bid
            without a second pair of eyes.
          </p>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="space-y-1.5">
        <Label htmlFor={`method-${line.id}`}>How the quantity was arrived at</Label>
        <Select value={line.measurementMethod}
          disabled={!editable || busy !== null || lockedToAllowance}
          onValueChange={(v) => void set('measurement_method', v)}>
          <SelectTrigger id={`method-${line.id}`} className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METHODS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {lockedToAllowance ? (
          <p className="text-xs leading-relaxed text-charcoal-500">
            This line is priced at a rate you typed rather than built up from crew, machines and
            materials, which makes it an allowance by definition — the database holds it to that
            basis so a conceptual line cannot be relabeled into the approval gate the label
            decides. An allowance carries half the reliability of a dimensioned quantity, so
            ticking every box below still leaves it short of the 80 the engine wants before it
            will clear a bid. <strong>Build the line up</strong> to change that: give it the crew,
            machines and materials it actually takes, and the basis becomes yours to state.
          </p>
        ) : (
          <p className="text-xs text-charcoal-500">
            A scaled or allowed quantity routes to review however many boxes are ticked below. That
            is not a penalty — it is the difference between a number read off a plan and one
            somebody arrived at.
          </p>
        )}
      </div>

      {/*
        * The claim names the box; the sentence under it describes the box. A
        * wrapping label would fold both into one accessible name, so a screen
        * reader would read the whole explanation before saying what is being
        * ticked — the same defect the number fields in `line-detail` carried.
        */}
      <ul className="space-y-2">
        {CHECKS.map((c) => (
          <li key={c.field}>
            <div className="flex items-start gap-2">
              <input type="checkbox" id={`${c.field}-${line.id}`}
                className="mt-1 size-4 shrink-0 accent-yellow-500"
                aria-describedby={`${c.field}-${line.id}-says`}
                checked={c.of(line)} disabled={!editable || busy !== null}
                onChange={(e) => void set(c.field, e.target.checked)} />
              <div className="space-y-0.5">
                <label htmlFor={`${c.field}-${line.id}`}
                  className="flex cursor-pointer items-center gap-2 text-sm font-medium text-charcoal-900">
                  {c.label}
                  {busy === c.field
                    ? <Loader2 className="size-3.5 animate-spin text-charcoal-400" /> : null}
                </label>
                <p id={`${c.field}-${line.id}-says`}
                  className="text-xs leading-relaxed text-charcoal-500">{c.says}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs text-charcoal-500">
        {ticked === 0
          ? 'Nothing checked. A quantity nobody has verified is scored as one.'
          : `${ticked} of 3 checked.`}{' '}
        Price the estimate again to put the new score on the line — the engine is the only thing
        permitted to write a confidence, and it writes one when it prices.
      </p>
    </div>
  );
}
