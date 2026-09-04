import { useState } from 'react';
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
 * the control says why rather than failing when it is pressed.
 */
export interface CostCellProps {
  value: number;
  editable: boolean;
  /** What the number means, for the label a screen reader reads. */
  label: string;
  suffix?: string;
  busy?: boolean;
  onSave: (next: number) => void | Promise<void>;
  /** Shown under the value: where the rate came from, when it took effect. */
  hint?: string;
}

export function CostCell({
  value, editable, label, suffix, busy = false, onSave, hint,
}: CostCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);

  if (!editable) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="tabular inline-flex items-center gap-1.5 text-charcoal-700">
            {money(value)}{suffix ? <span className="text-charcoal-400">{suffix}</span> : null}
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
          onClick={() => { setDraft(String(value)); setError(null); setEditing(true); }}
          aria-label={`Change ${label}`}>
          {money(value)}{suffix ? <span className="text-charcoal-400">{suffix}</span> : null}
          <Pencil className="size-3 text-charcoal-300 group-hover:text-charcoal-600" />
        </button>
        {hint ? <span className="text-[11px] text-charcoal-400">{hint}</span> : null}
      </div>
    );
  }

  async function save() {
    const next = Number(draft);
    if (!Number.isFinite(next) || next < 0) {
      setError('A cost must be zero or more');
      return;
    }
    setError(null);
    await onSave(next);
    setEditing(false);
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <Input value={draft} inputMode="decimal" autoFocus
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
        Applies to future estimates. Issued ones keep the rate that priced them.
      </span>
    </div>
  );
}
