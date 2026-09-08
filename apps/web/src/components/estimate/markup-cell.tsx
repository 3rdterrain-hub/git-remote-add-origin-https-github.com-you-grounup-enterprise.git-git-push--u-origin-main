/**
 * This line's markup, typed on the line.
 *
 * It showed the word "profile" or a percentage and took nothing. Overriding one
 * line meant opening the markup panel, which is where the *company's* markup
 * lives — so changing one line and changing every line looked like the same
 * control, and an estimator shading a single risky item had to go somewhere
 * that suggested they were about to reprice the bid.
 *
 * Empty means the profile decides, and that is not the same as zero. Clearing
 * the field puts the line back under the company's markup; typing 0 says this
 * line carries none, which is a real thing to say about a pass-through cost.
 *
 * Like the unit cost beside it, the editor is a row rather than something
 * inside the cell. A `min-w-[13rem]` in a markup column made every column in
 * the estimate shift the moment somebody clicked one percentage.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { updateLine } from '@/lib/data/estimates';
import { cn } from '@/lib/utils';

/** A fraction on the record, a percentage on the screen. */
const asPercentText = (markupOverride: number | null) =>
  markupOverride == null ? '' : String(Math.round(markupOverride * 1000) / 10);

/** What sits in the column. Nothing here may set a minimum width. */
export function MarkupCell({ description, markupOverride, editable, open, onOpen }: {
  description: string;
  /** A fraction, or null when the pricing profile decides. */
  markupOverride: number | null;
  editable: boolean;
  open: boolean;
  onOpen: (next: boolean) => void;
}) {
  if (!editable) {
    return markupOverride == null
      ? <span className="text-charcoal-400">profile</span>
      : <span className="tabular">{Math.round(markupOverride * 100)}%</span>;
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(!open)}
      title={markupOverride == null
        ? 'The company pricing profile decides this line'
        : `This line carries ${Math.round(markupOverride * 100)}% instead of the profile`}
      aria-label={`Markup for ${description}`}
      aria-expanded={open}
      className={cn('tabular w-full truncate rounded px-1 py-0.5 text-right hover:bg-charcoal-50',
        open && 'bg-charcoal-100')}>
      {markupOverride == null
        ? <span className="text-charcoal-400">profile</span>
        : `${Math.round(markupOverride * 100)}%`}
    </button>
  );
}

/** The editor, as a row of its own under the line it belongs to. */
export function MarkupEditor({
  lineId, description, markupOverride, columns, onClose, onChanged,
}: {
  lineId: string;
  description: string;
  markupOverride: number | null;
  columns: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState(asPercentText(markupOverride));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  /*
   * Focus, then select. `select()` alone leaves the caret in the field and the
   * focus on the button that opened it, so the first thing typed goes nowhere
   * and Escape does not reach the handler that closes this.
   */
  useEffect(() => { field.current?.focus(); field.current?.select(); }, []);

  const save = async () => {
    if (!supabase || busy) return;
    const text = draft.trim();
    const next = text === '' ? null : Number(text) / 100;
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      setError('A markup is a percentage and cannot be negative.');
      return;
    }
    setBusy(true); setError(null);
    try {
      /*
       * `markup_override`, not `markupOverride`.
       *
       * `update_estimate_line` reads `p_fields ? 'markup_override'`, so the
       * camelCase key matched nothing, the update wrote nothing, and the call
       * returned without an error — the markup typed here had never once been
       * saved. Migration 0136 makes an unknown key an error rather than a
       * silence, so the next one of these fails at the write.
       */
      await updateLine(supabase, lineId, { markup_override: next });
      onClose();
      onChanged();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); setError(null); onClose(); return; }
    if (e.key === 'Enter') { e.preventDefault(); void save(); }
  };

  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={columns} className="border-l-2 border-l-yellow-500 bg-charcoal-50 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-charcoal-700">
            Markup for {description}
          </span>
          <Input
            ref={field}
            value={draft}
            inputMode="decimal"
            disabled={busy}
            aria-label={`Markup for ${description}`}
            placeholder="profile"
            className="h-8 w-24 bg-white text-right"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown} />
          <span className="text-xs text-charcoal-500">%</span>
        </div>
        <p className="mt-1 text-xs text-charcoal-500">
          Empty puts it back under the company profile, which is not the same as zero —
          zero says this line carries no markup at all. Enter saves it, Escape leaves it.
        </p>
        {error ? <p role="alert" className="mt-1 text-xs text-danger-700">{error}</p> : null}
      </TableCell>
    </TableRow>
  );
}
