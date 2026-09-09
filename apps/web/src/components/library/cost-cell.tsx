import { useState, type ReactNode } from 'react';
import { Check, Loader2, Pencil, X, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/misc';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * A cost you can change in place.
 *
 * These are the numbers every estimate is built from, so the thing this control
 * has to communicate is not how to type a number — it is what changing one
 * does. Two facts, and the second is the one that makes the first safe:
 *
 *   * Changing a rate changes what every **future** estimate prices at.
 *   * It changes nothing already issued. A library snapshot copies the rows
 *     that priced an estimate at the moment it was issued, so a bid sent in
 *     March still reproduces at March's rates.
 *
 * Without the second, editing a rate would silently rewrite history and nobody
 * would touch it. With it, this is the right place to keep a company's costs.
 *
 * A catalog row cannot be edited at all — row level security refuses it — and
 * the control says why rather than failing when it is pressed. Where the
 * library has a copy-on-write path for that row, the caller passes `note`
 * instead of `editable={false}`: the cell takes the number and says what
 * saving it will do, which for a catalog material is make the company's own
 * copy and price that.
 *
 * A cost of zero is only shown as `$0.00` when zero is the answer. A material
 * nobody has priced reads "Set a cost", because `$0.00` on 328 catalog rows is
 * the exact silence migration 0121 exists to break.
 */
export interface CostCellProps {
  value: number;
  editable: boolean;
  /** What the number means, for the label a screen reader reads. */
  label: string;
  suffix?: string;
  busy?: boolean;
  onSave: (next: number, source: string) => void | Promise<void>;
  /**
   * Ask where the price came from, and refuse to save without it.
   *
   * Not politeness. `app.set_material_cost` refuses a price called estimated or
   * quoted that does not name a supplier, a quote or how it was worked out —
   * "a quote and a guess are different claims and the estimate should be able
   * to tell them apart". Asking here means somebody types it once; not asking
   * means they meet the refusal after typing the number.
   */
  sourcePrompt?: string;
  /** Shown under the value: where the rate came from, when it took effect. */
  hint?: string;
  /**
   * What saving does, shown while editing in place of the default. Use it when
   * saving does something other than change this row — copying a catalog row
   * into the company's library, for one.
   */
  note?: ReactNode;
  /** True when the zero means nobody has costed this, rather than "free". */
  unset?: boolean;
}

export function CostCell({
  value, editable, label, suffix, busy = false, onSave, hint, note, unset = false,
  sourcePrompt,
}: CostCellProps) {
  const [editing, setEditing] = useState(false);
  /*
   * Zero opens as an empty box, not as `0`. A rate nobody has set is the
   * common case here, and a box already reading `0` is one the estimator has
   * to clear before it is usable — "I want to see the typed value not 0
   * first". The placeholder says what shape the number takes instead.
   */
  const [draft, setDraft] = useState(value === 0 ? '' : String(value));
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!editable) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="tabular inline-flex items-center gap-1.5 text-charcoal-700">
            {unset
              ? <span className="text-charcoal-400">Not costed</span>
              : <>{money(value)}{suffix
                  ? <span className="text-charcoal-400">{suffix}</span> : null}</>}
            <Lock className="size-3 text-charcoal-300" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          This is a catalog rate. Every company reads it and none may change it, which is
          what makes it a benchmark. Copy it to your library to set your own.
        </TooltipContent>
      </Tooltip>
    );
  }

  if (!editing) {
    return (
      <div className="group inline-flex flex-col items-end">
        <button type="button"
          className="tabular inline-flex items-center gap-1.5 text-charcoal-900 hover:underline"
          onClick={() => {
            setDraft(unset || value === 0 ? '' : String(value));
            setSource(''); setError(null); setEditing(true);
          }}
          aria-label={unset ? `Set ${label}` : `Change ${label}`}>
          {unset
            ? <span className="text-charcoal-500">Set a cost</span>
            : <>{money(value)}{suffix
                ? <span className="text-charcoal-400">{suffix}</span> : null}</>}
          <Pencil className="size-3 text-charcoal-300 group-hover:text-charcoal-600" />
        </button>
        {hint ? <span className="text-[11px] text-charcoal-400">{hint}</span> : null}
      </div>
    );
  }

  async function save() {
    const next = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(next) || next < 0) {
      setError('A cost must be zero or more');
      return;
    }
    if (sourcePrompt && source.trim().length < 3) {
      setError('Say where this price came from');
      return;
    }
    setError(null);
    await onSave(next, source.trim());
    setEditing(false);
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        {sourcePrompt ? (
          <Input value={source} className="h-8 w-44" aria-label={sourcePrompt}
            placeholder={sourcePrompt}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
              if (e.key === 'Escape') setEditing(false);
            }} />
        ) : null}
        <Input value={draft} inputMode="decimal" autoFocus placeholder="0.00"
          className="h-8 w-24 text-right" aria-label={label}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') setEditing(false);
          }} />
        <Button size="sm" variant="ghost" disabled={busy}
          onClick={() => void save()} aria-label={`Save ${label}`}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}
          aria-label="Cancel">
          <X className="size-4" />
        </Button>
      </div>
      {error ? <span className="text-[11px] text-danger-700">{error}</span> : null}
      <span className={cn('text-[11px] text-charcoal-500')}>
        {note ?? 'Applies to future estimates. Issued ones keep the rate that priced them.'}
      </span>
    </div>
  );
}
