/**
 * The words the customer reads, under the words the estimator wrote.
 *
 * A line has two audiences. "Mobilization/ Demobilization" is what the
 * estimator calls it and what the build-up hangs off; the customer's copy often
 * needs something else — plainer, or longer, or naming a road. `notes` has been
 * the column for that since migration 0006 and `update_estimate_line` has
 * always accepted it; nothing on the line ever offered a place to type it, so
 * every proposal said whatever the estimator had called the line internally.
 *
 * Borderless until it is used, because it sits under every line on the estimate
 * and most of them will never need one. A field with a box around it on three
 * hundred rows is three hundred boxes of nothing.
 */
import { useEffect, useState } from 'react';
import { messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { updateLine } from '@/lib/data/estimates';
import { cn } from '@/lib/utils';

export function ClientDescription({ lineId, description, value, editable, onChanged }: {
  lineId: string;
  /** The line's own words, for the accessible name. */
  description: string;
  value: string | null;
  editable: boolean;
  onChanged: () => void;
}) {
  const [text, setText] = useState(value ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setText(value ?? ''); }, [value]);

  if (!editable) {
    return value
      ? <span className="truncate text-xs text-charcoal-500">{value}</span>
      : null;
  }

  const commit = async () => {
    const next = text.trim();
    if (next === (value ?? '')) return;
    if (!supabase) return;
    setBusy(true); setError(null);
    try {
      await updateLine(supabase, lineId, { notes: next || null });
      onChanged();
    } catch (err) {
      setError(messageFor(err));
      setText(value ?? '');
    } finally { setBusy(false); }
  };

  return (
    <input
      value={text}
      disabled={busy}
      aria-label={`Description for the customer on ${description}`}
      placeholder="Description for client…"
      title={error ?? 'What the customer reads for this line on the proposal'}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); void commit(); (e.target as HTMLInputElement).blur(); }
        if (e.key === 'Escape') { setText(value ?? ''); (e.target as HTMLInputElement).blur(); }
      }}
      className={cn(
        'min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-1',
        'text-xs text-charcoal-500 placeholder:text-charcoal-300',
        'hover:border-charcoal-200 focus:border-yellow-500 focus:bg-white focus:outline-none',
        error && 'border-danger-400',
      )}
    />
  );
}
