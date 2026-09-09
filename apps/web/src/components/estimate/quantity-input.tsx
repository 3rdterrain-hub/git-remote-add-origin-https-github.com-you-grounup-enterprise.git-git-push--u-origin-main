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
           * Narrower than it was. "Keep the line item boxes smaller" — and a
           * quantity is six or seven digits, so w-32 was buying blank space at
           * the description's expense.
           */
          className={cn('tabular h-8 w-24 pr-6 text-right', error && 'border-danger-400')}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
        {looksCalculated(draft) ? (
          <Calculator className="pointer-events-none absolute right-1.5 top-1/2 size-3.5 -translate-y-1/2 text-charcoal-400" />
        ) : null}
      </div>

      {error ? (
        <p className="text-xs text-danger-700">{error}</p>
      ) : preview != null && String(preview) !== draft.trim() ? (
        <p className="text-xs text-charcoal-500">
          = {qty(preview)}{unit ? ` ${unit}` : ''}
        </p>
      ) : expression && draft === expression ? (
        <p className="text-xs text-charcoal-400">
          = {qty(quantity)}{unit ? ` ${unit}` : ''}
        </p>
      ) : null}
    </div>
  );
}
