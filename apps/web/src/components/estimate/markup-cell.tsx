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
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import { messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { updateLine } from '@/lib/data/estimates';

export function MarkupCell({ lineId, description, markupOverride, editable, onChanged }: {
  lineId: string;
  description: string;
  /** A fraction, or null when the pricing profile decides. */
  markupOverride: number | null;
  editable: boolean;
  onChanged: () => void;
}) {
  const asPercent = markupOverride == null ? '' : String(Math.round(markupOverride * 1000) / 10);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(asPercent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) field.current?.select(); }, [open]);
  useEffect(() => { if (!open) setDraft(asPercent); }, [asPercent, open]);

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
      await updateLine(supabase, lineId, { markupOverride: next });
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); setDraft(asPercent); setOpen(false); setError(null); return; }
    if (e.key === 'Enter') { e.preventDefault(); void save(); }
  };

  if (!editable) {
    return markupOverride == null
      ? <span className="text-charcoal-400">profile</span>
      : <span className="tabular">{Math.round(markupOverride * 100)}%</span>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={markupOverride == null
          ? 'The company pricing profile decides this line'
          : `This line carries ${Math.round(markupOverride * 100)}% instead of the profile`}
        aria-label={`Markup for ${description}`}
        className="tabular w-full rounded px-1 py-0.5 text-right hover:bg-charcoal-50">
        {markupOverride == null
          ? <span className="text-charcoal-400">profile</span>
          : `${Math.round(markupOverride * 100)}%`}
      </button>
    );
  }

  return (
    <div className="relative z-30 min-w-[13rem] text-left">
      <div className="flex items-center gap-1">
        <Input
          ref={field}
          value={draft}
          inputMode="decimal"
          disabled={busy}
          aria-label={`Markup for ${description}`}
          placeholder="profile"
          className="h-8 w-20 bg-white text-right"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown} />
        <span className="text-xs text-charcoal-500">%</span>
      </div>
      <p className="mt-1 text-xs text-charcoal-500">
        Empty puts it back under the company profile. Enter saves.
      </p>
      {error ? <p role="alert" className="mt-1 text-xs text-danger-700">{error}</p> : null}
    </div>
  );
}
