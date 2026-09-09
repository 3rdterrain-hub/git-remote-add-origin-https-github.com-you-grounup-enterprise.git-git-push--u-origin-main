/**
 * This line's markup, typed on the line.
 *
 * It showed the word "profile" or a percentage and took nothing. Overriding one
 * line meant opening the markup panel, which is where the *company's* markup
 * lives — so changing one line and changing every line looked like the same
 * control, and an estimator shading a single risky item had to go somewhere
 * that suggested they were about to reprice the bid.
 *
 * Then it became a button that opened an editor under the row, because an input
 * inside a table cell widened its column and shoved every number on the line
 * sideways. The column is a fixed track now, so that cannot happen, and the
 * control goes back to what it should always have been: a box you type in.
 *
 * Empty means the profile decides, and that is not the same as zero. Clearing
 * it puts the line back under the company's markup; typing 0 says this line
 * carries none, which is a real thing to say about a pass-through cost.
 *
 * The number and the sign are stacked because the number is what is read and
 * the sign is only what it is read as.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { updateLine } from '@/lib/data/estimates';
import { useSelectOnFocus } from '@/lib/select-on-focus';
import { cn } from '@/lib/utils';

/** A fraction on the record, a percentage on the screen. */
const asPercentText = (markupOverride: number | null) =>
  markupOverride == null ? '' : String(Math.round(markupOverride * 1000) / 10);

export function MarkupCell({ lineId, description, markupOverride, editable, onChanged }: {
  lineId: string;
  description: string;
  /** A fraction, or null when the pricing profile decides. */
  markupOverride: number | null;
  editable: boolean;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState(asPercentText(markupOverride));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  /*
   * A raw input rather than the shared one, because it sits inside a fixed grid
   * track and carries the percent sign under it — so it takes the same
   * select-what-you-hold behavior directly. Typing 15 over a 10 gives 15.
   */
  const select = useSelectOnFocus<HTMLInputElement>();

  useEffect(() => { setDraft(asPercentText(markupOverride)); }, [markupOverride]);

  if (!editable) {
    return markupOverride == null
      ? <span className="block text-center text-charcoal-400">profile</span>
      : (
        <span className="tabular block text-center">
          {Math.round(markupOverride * 100)}
          <span className="block text-[10px] leading-none text-charcoal-400">%</span>
        </span>
      );
  }

  const commit = async () => {
    const text = draft.trim();
    const next = text === '' ? null : Number(text) / 100;
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      setError('A markup is a percentage and cannot be negative.');
      setDraft(asPercentText(markupOverride));
      return;
    }
    if (next === markupOverride) { setError(null); return; }
    if (!supabase) return;
    setBusy(true); setError(null);
    try {
      /*
       * `markup_override`, not `markupOverride`. The camelCase key matched
       * nothing, the update wrote nothing, and the call returned without an
       * error — the markup typed here had never once been saved. Migration 0136
       * makes an unknown key an error rather than a silence.
       */
      await updateLine(supabase, lineId, { markup_override: next });
      onChanged();
    } catch (err) {
      setError(messageFor(err));
      setDraft(asPercentText(markupOverride));
    } finally { setBusy(false); }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void commit(); field.current?.blur(); }
    if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(asPercentText(markupOverride));
      setError(null);
      field.current?.blur();
    }
  };

  return (
    <span className="block">
      <input
        ref={field}
        value={draft}
        disabled={busy}
        inputMode="decimal"
        aria-label={`Markup for ${description}`}
        placeholder="profile"
        title={error ?? 'Empty uses the company pricing profile. Zero means this line carries none.'}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={select.onFocus}
        onMouseDown={select.onMouseDown}
        onMouseUp={select.onMouseUp}
        onBlur={() => void commit()}
        onKeyDown={onKeyDown}
        className={cn(
          'tabular h-7 w-full rounded border bg-white px-1 text-center text-sm',
          'placeholder:text-charcoal-300 focus:border-yellow-500 focus:outline-none',
          error ? 'border-danger-400' : 'border-charcoal-200',
        )}
      />
      <span className="block text-center text-[10px] leading-none text-charcoal-400">%</span>
    </span>
  );
}
