/**
 * "What if I know my unit cost?"
 *
 * The cell showed a number the engine had computed and took nothing. An
 * estimator with a subcontract quote in their hand — $48,250 for the sitework,
 * $4.25 a yard because that is what it went for last time — had to open a
 * panel to say so, and most never found it.
 *
 * So the cell takes it. Click the figure, type the rate, say where it came
 * from, done.
 *
 * The reason is not paperwork and it is not optional. `parametric_cost_per_unit`
 * has required a basis since migration 0066, because "Sub quote, Delaney Bros,
 * 14 Aug" and "roughly what we got last year" are different numbers and an
 * estimate that cannot tell them apart cannot be reviewed. Both fields sit on
 * one line so saying it costs a few words rather than a detour.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { setLineUnitCost, clearLineUnitCost } from '@/lib/data/estimates';
import { unitRate } from '@/lib/format';

export function UnitCostCell({
  lineId, description, unit, unitCost, typedRate, basis, hasResources, editable, onChanged,
}: {
  lineId: string;
  description: string;
  unit: string;
  /** What the engine computed, when it computed anything. */
  unitCost: number;
  /** What somebody typed, when they typed one. */
  typedRate: number | null;
  basis: string | null;
  hasResources: boolean;
  editable: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rate, setRate] = useState(typedRate ? String(typedRate) : '');
  const [why, setWhy] = useState(basis ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) field.current?.select(); }, [open]);

  const save = async () => {
    if (!supabase || busy) return;
    const n = Number(rate);
    if (!Number.isFinite(n) || why.trim().length < 3) return;
    setBusy(true); setError(null);
    try {
      await setLineUnitCost(supabase, lineId, n, why.trim());
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!supabase || busy) return;
    setBusy(true); setError(null);
    try {
      await clearLineUnitCost(supabase, lineId);
      setRate(''); setWhy('');
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setError(null); return; }
    if (e.key === 'Enter') { e.preventDefault(); void save(); }
  };

  const shown = typedRate ?? unitCost;

  if (!editable) {
    return shown
      ? <span className="tabular">{unitRate(shown)}</span>
      : <span className="text-charcoal-400">—</span>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={typedRate
          ? `${unitRate(typedRate)} per ${unit} — ${basis}`
          : hasResources
            ? 'Priced from the crew, machines and materials on this line'
            : 'Type a unit cost'}
        aria-label={`Unit cost for ${description}`}
        className="tabular w-full rounded px-1 py-0.5 text-right hover:bg-charcoal-50">
        {shown ? unitRate(shown) : <span className="text-charcoal-400">—</span>}
        {typedRate ? <span className="ml-1 text-xs text-info-700">typed</span> : null}
      </button>
    );
  }

  return (
    <div className="relative z-30 min-w-[22rem] text-left">
      <div className="flex items-center gap-1">
        <Input
          ref={field}
          value={rate}
          inputMode="decimal"
          disabled={busy}
          aria-label={`Unit cost for ${description}`}
          placeholder="0.00"
          className="h-8 w-24 bg-white text-right"
          onChange={(e) => setRate(e.target.value)}
          onKeyDown={onKeyDown} />
        <Input
          value={why}
          disabled={busy}
          aria-label="Where the rate came from"
          placeholder="Sub quote, Delaney Bros, 14 Aug"
          className="h-8 flex-1 bg-white"
          onChange={(e) => setWhy(e.target.value)}
          onKeyDown={onKeyDown} />
        {typedRate !== null ? (
          <button type="button" onClick={() => void clear()} disabled={busy}
            aria-label="Price it from the build-up instead"
            title="Price it from the crew, machines and materials instead"
            className="rounded p-1 text-charcoal-400 hover:bg-charcoal-100">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
          </button>
        ) : null}
      </div>
      {hasResources && typedRate === null ? (
        <p className="mt-1 text-xs text-warn-700">
          This line is priced from its crew and machines. Remove those first, or the rate
          will be refused — a line carrying both reports a number nobody can reproduce.
        </p>
      ) : (
        <p className="mt-1 text-xs text-charcoal-500">
          A quote, a past job, an allowance — enough that a reviewer can tell a quoted
          number from a remembered one. Enter saves it.
        </p>
      )}
      {error ? <p role="alert" className="mt-1 text-xs text-danger-700">{error}</p> : null}
    </div>
  );
}
