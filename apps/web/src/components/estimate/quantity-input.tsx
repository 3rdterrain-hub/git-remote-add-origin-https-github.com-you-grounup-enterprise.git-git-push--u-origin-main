/**
 * A quantity cell that does the arithmetic.
 *
 * A quantity is almost never a number somebody knows. It is 120 by 4 by 8
 * inches, or 42 footings at 1.2 cubic yards, or a takeoff of 3,180 less the 240
 * already in place. Estimators do that arithmetic somewhere and type the
 * answer, and the answer is a number with no account of itself — which is how a
 * decimal point ends up in the wrong place inside a calculation nobody can see.
 *
 * So the cell takes the expression. Three properties make it worth trusting:
 *
 *   * **The engine evaluates it**, in a parser rather than an interpreter, so
 *     what an estimator types is never a code path.
 *   * **A refusal is never a number.** An expression that cannot be read leaves
 *     the field alone and says what is wrong, because a calculator that
 *     silently dropped the tail of `120 * 4 +` would be worse than none.
 *   * **The working is kept.** The expression is stored beside the quantity it
 *     produced, and shown under the cell, so a reviewer can ask "of what?" and
 *     get an answer.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { evaluateQuantity, looksCalculated } from '@grounup/engine';
import { Calculator } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { qty } from '@/lib/format';
import { cn } from '@/lib/utils';

/** What the box reads. Zero reads as empty; anything else reads as itself. */
const textFor = (quantity: number, expression: string | null) =>
  expression ?? (quantity === 0 ? '' : String(quantity));

export function QuantityInput({
  quantity, expression, unit, disabled, label, className, onCommit,
}: {
  quantity: number;
  /** The calculation this quantity came from, when it came from one. */
  expression: string | null;
  unit?: string;
  disabled?: boolean;
  label: string;
  className?: string;
  /** Called only when something actually changed. */
  onCommit: (quantity: number, expression: string | null) => void;
}) {
  /*
   * The field shows the expression when there is one, because that is what the
   * estimator wrote and what they will want to edit. The number is underneath.
   *
   * A quantity of zero shows nothing. Every new line starts at zero, and a box
   * reading `0` is a box you have to clear before you can use it — "when I type
   * a value in any box I want to see the typed value not 0 first". Zero is not
   * a quantity anybody means; it is the absence of one, and the placeholder
   * says so without occupying the field.
   */
  const initial = textFor(quantity, expression);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  /*
   * Whether the cell is being typed in.
   *
   * "No text under quantity in estimator." At rest the cell is the box and
   * nothing else — a second line under one cell is what made a row taller than
   * its neighbors, and a column of quantities you cannot scan is worse than a
   * working shown twice. While the cell has focus the answer appears, because
   * an estimator typing `3,180 - 240` needs to see what it comes to before
   * they leave it; the moment they do, it goes away and the number is in the
   * box. The result stays reachable at rest on the field itself, where hover
   * and a screen reader both find it.
   */
  const [focused, setFocused] = useState(false);
  const committed = useRef(initial);

  useEffect(() => {
    const next = textFor(quantity, expression);
    setDraft(next);
    committed.current = next;
    setError(null);
  }, [quantity, expression]);

  const live = looksCalculated(draft) ? evaluateQuantity(draft) : null;
  const preview = live?.ok ? live.value : null;

  const commit = () => {
    if (draft === committed.current) { setError(null); return; }

    const trimmed = draft.trim();
    if (trimmed.length === 0) { setDraft(committed.current); setError(null); return; }

    const result = evaluateQuantity(trimmed);
    if (!result.ok) {
      // The field keeps what was typed: it is wrong, and losing it would be worse.
      setError(result.error.message);
      return;
    }
    setError(null);
    committed.current = draft;
    onCommit(result.value, looksCalculated(trimmed) ? trimmed : null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur(); }
    if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(committed.current);
      setError(null);
    }
  };

  return (
    <div className={cn('flex flex-col items-end gap-0.5', className)}>
      <div className="relative">
        <Input
          value={draft}
          disabled={disabled}
          placeholder="0"
          /*
           * An expression, not only a number, so the keypad would be the wrong
           * one — but typing still replaces what is there, which is the whole
           * point of the cell on a line being repriced.
           */
          inputMode="text"
          selectOnFocus
          aria-label={label}
          aria-invalid={error ? true : undefined}
          /*
           * The width of its column, not a width of its own.
           *
           * `w-24` was 96px inside a 64px grid track: it overflowed 16px each
           * side, touched the unit picker with no gap, and reached back over the
           * wrench. A fixed width in a fixed track is two sources of truth about
           * one number, and this is the one that cannot be wrong.
           */
          className={cn('tabular h-8 w-full pr-6 text-right', error && 'border-danger-400')}
          title={expression ? `${expression} = ${qty(quantity)}${unit ? ` ${unit}` : ''}` : undefined}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); commit(); }}
          onKeyDown={onKeyDown}
        />
        {looksCalculated(draft) ? (
          <Calculator className="pointer-events-none absolute right-1.5 top-1/2 size-3.5 -translate-y-1/2 text-charcoal-400" />
        ) : null}
      </div>

      {/*
        * An error is shown whether or not the cell has focus — a refusal that
        * disappeared when you looked away would be a refusal nobody read. The
        * answer to a calculation is shown only while it is being typed.
        */}
      {error ? (
        <p className="text-xs text-danger-700">{error}</p>
      ) : focused && preview != null && String(preview) !== draft.trim() ? (
        <p className="text-xs text-charcoal-500">
          = {qty(preview)}{unit ? ` ${unit}` : ''}
        </p>
      ) : null}
    </div>
  );
}
