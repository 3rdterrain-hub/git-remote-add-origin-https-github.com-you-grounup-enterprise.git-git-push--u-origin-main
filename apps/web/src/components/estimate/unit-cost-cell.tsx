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
 * estimate that cannot tell them apart cannot be reviewed.
 *
 * **The editor is not in the cell.** It used to be, carrying a `min-w-[22rem]`
 * so the two fields would fit — and a table sizes its columns from what is in
 * them, so clicking one rate made that column demand twenty-two rems, every
 * other column give up width to pay for it, and every row in the estimate shift
 * sideways at once. The row being edited was the only one anybody was looking
 * at and the whole grid moved under it.
 *
 * So it opens as its own row underneath, the way `NewLineRow` and the build-up
 * panel already do. The cell keeps a button and nothing that can push a column,
 * the editor gets the full width of the table, and the two fields sit side by
 * side with room to read instead of crammed into a numeric column.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { setLineUnitCost, clearLineUnitCost } from '@/lib/data/estimates';
import { unitRate } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface UnitCostProps {
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
}

/**
 * What sits in the column: a button the width of the number it shows.
 *
 * Nothing here may set a minimum width. The column is shared by every row, and
 * a width demanded by one of them is paid for by all of them.
 */
export function UnitCostCell({
  description, unit, unitCost, typedRate, basis, hasResources, editable, open, onOpen,
}: Pick<UnitCostProps, 'description' | 'unit' | 'unitCost' | 'typedRate' | 'basis'
  | 'hasResources' | 'editable'> & { open: boolean; onOpen: (next: boolean) => void }) {
  const shown = typedRate ?? unitCost;

  if (!editable) {
    return shown
      ? <span className="tabular">{unitRate(shown)}</span>
      : <span className="text-charcoal-400">—</span>;
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(!open)}
      title={typedRate
        ? `${unitRate(typedRate)} per ${unit} — ${basis}`
        : hasResources
          ? 'Priced from the crew, machines and materials on this line'
          : 'Type a unit cost'}
      aria-label={`Unit cost for ${description}`}
      aria-expanded={open}
      className={cn('tabular w-full truncate rounded px-1 py-0.5 text-right hover:bg-charcoal-50',
        open && 'bg-charcoal-100')}>
      {shown ? unitRate(shown) : <span className="text-charcoal-400">—</span>}
      {typedRate ? <span className="ml-1 text-xs text-info-700">typed</span> : null}
    </button>
  );
}

/**
 * The editor, as a row of its own under the line it belongs to.
 *
 * `columns` spans the table so the panel is laid out against the table's width
 * rather than against one column's, which is the whole point: no column is
 * asked to be any wider than the number it holds.
 */
export function UnitCostEditor({
  lineId, description, typedRate, basis, hasResources, columns, onClose, onChanged,
}: Pick<UnitCostProps, 'lineId' | 'description' | 'typedRate' | 'basis' | 'hasResources'>
  & { columns: number; onClose: () => void; onChanged: () => void }) {
  const [rate, setRate] = useState(typedRate ? String(typedRate) : '');
  const [why, setWhy] = useState(basis ?? '');
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
    const n = Number(rate);
    if (!Number.isFinite(n) || why.trim().length < 3) return;
    setBusy(true); setError(null);
    try {
      await setLineUnitCost(supabase, lineId, n, why.trim());
      onClose();
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
            Unit cost for {description}
          </span>
          <Input
            ref={field}
            value={rate}
            inputMode="decimal"
            disabled={busy}
            aria-label={`Unit cost for ${description}`}
            placeholder="0.00"
            className="h-8 w-28 bg-white text-right"
            onChange={(e) => setRate(e.target.value)}
            onKeyDown={onKeyDown} />
          <Input
            value={why}
            disabled={busy}
            aria-label="Where the rate came from"
            placeholder="Sub quote, Delaney Bros, 14 Aug"
            className="h-8 w-80 max-w-full bg-white"
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
            number from a remembered one. Enter saves it, Escape leaves it.
          </p>
        )}
        {error ? <p role="alert" className="mt-1 text-xs text-danger-700">{error}</p> : null}
      </TableCell>
    </TableRow>
  );
}
