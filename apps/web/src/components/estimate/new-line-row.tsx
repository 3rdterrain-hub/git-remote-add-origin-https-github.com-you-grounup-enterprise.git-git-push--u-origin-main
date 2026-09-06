/**
 * A blank line, right where you are looking.
 *
 * The fast path, and the reason it is not a dialog: an estimator building a bid
 * adds a line as they think of it, thirty times. A dialog is a mode, and a mode
 * costs a click to enter and a click to leave on every one of those thirty. A
 * blank row costs nothing — type, arrow, Enter, tab to the quantity, Enter, and
 * the next blank row is already waiting.
 *
 * Typing searches the library from the first letter. Picking a match brings its
 * unit, cost code and production rate; ignoring the list keeps your own words.
 * The line is only written when there is something to write — a row that
 * created an empty line the moment it appeared would fill an estimate with
 * blanks every time somebody pressed the plus and changed their mind.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { TableCell, TableRow } from '@/components/ui/table';
import { UnitSelect } from '@/components/ui/unit-select';
import { QuantityInput } from '@/components/estimate/quantity-input';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { searchServices, addLine, insertLineAfter, type LibraryService }
  from '@/lib/data/estimates';
import { cn } from '@/lib/utils';

export function NewLineRow({ versionId, afterLineId, columns, onDone, onCancel }: {
  versionId: string;
  /** Null appends; otherwise the new line goes directly under this one. */
  afterLineId: string | null;
  /** How wide the table is, so the row spans it while it is being typed. */
  columns: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [term, setTerm] = useState('');
  const [chosen, setChosen] = useState<LibraryService | null>(null);
  const [unit, setUnit] = useState('LS');
  const [quantity, setQuantity] = useState(0);
  const [expression, setExpression] = useState<string | null>(null);
  const [cursor, setCursor] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => { field.current?.focus(); }, []);

  const services = useQuery(searchServices(term, null), [term]);
  const results = services.status === 'ready' ? services.data : [];
  const suggesting = !chosen && term.trim().length > 0 && results.length > 0;

  const choose = (s: LibraryService) => {
    setChosen(s); setTerm(s.name); setUnit(s.defaultUnit); setCursor(-1);
  };

  const save = async () => {
    if (!supabase || term.trim().length === 0 || busy) return;
    setBusy(true); setError(null);
    try {
      const fields = {
        serviceId: chosen?.id ?? null,
        description: chosen ? null : term.trim(),
        quantity,
        unit: unit || 'LS',
      };
      if (afterLineId) {
        await insertLineAfter(supabase, { afterLineId, ...fields });
      } else {
        await addLine(supabase, { versionId, ...fields });
      }
      onDone();
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
    if (suggesting) {
      if (e.key === 'ArrowDown') {
        e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault(); setCursor((c) => Math.max(c - 1, -1)); return;
      }
      if (e.key === 'Enter' && cursor >= 0) {
        e.preventDefault(); choose(results[cursor]!); return;
      }
    }
    if (e.key === 'Enter') { e.preventDefault(); void save(); }
  };

  return (
    <TableRow className="bg-yellow-50/60 hover:bg-yellow-50/60">
      <TableCell colSpan={columns} className="p-0">
        <div className="flex flex-wrap items-start gap-2 p-2">
          <div className="relative min-w-56 flex-1">
            <Input
              ref={field}
              value={term}
              autoComplete="off"
              role="combobox"
              aria-expanded={suggesting}
              aria-autocomplete="list"
              aria-label="What is this line?"
              placeholder="Type a line — the library suggests as you go"
              className="h-8"
              disabled={busy}
              onChange={(e) => { setTerm(e.target.value); setChosen(null); setCursor(-1); }}
              onKeyDown={onKeyDown}
            />
            {suggesting ? (
              <div role="listbox" aria-label="Matching library services"
                className="absolute left-0 right-0 top-9 z-20 max-h-52 overflow-y-auto rounded-md border border-charcoal-200 bg-white shadow-lg">
                {results.slice(0, 12).map((s, i) => (
                  <button key={s.id} type="button" role="option" aria-selected={i === cursor}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => { choose(s); field.current?.focus(); }}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 border-b border-charcoal-100 px-3 py-1.5 text-left last:border-0',
                      i === cursor ? 'bg-yellow-50' : 'hover:bg-charcoal-50',
                    )}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-charcoal-900">{s.name}</span>
                      <span className="block text-xs text-charcoal-500">
                        {s.code}{s.category ? ` · ${s.category}` : ''}
                      </span>
                    </span>
                    <Badge variant={s.isOwn ? 'info' : 'default'}>
                      {s.isOwn ? 'yours' : s.defaultUnit}
                    </Badge>
                  </button>
                ))}
              </div>
            ) : null}
            {chosen ? (
              <p className="mt-1 text-xs text-charcoal-500">
                From the library: {chosen.code}
                {chosen.category ? ` · ${chosen.category}` : ''}
              </p>
            ) : null}
          </div>

          <UnitSelect value={unit} onChange={setUnit} disabled={busy}
            allowed={chosen?.supportedUnits} label="Unit for this line" className="w-40" />

          {/* The same cell as the table's, so a line typed here and a line
              edited later take arithmetic the same way. */}
          <QuantityInput
            quantity={quantity} expression={expression} unit={unit} disabled={busy}
            label="Quantity for this line"
            onCommit={(n, expr) => { setQuantity(n); setExpression(expr); }} />

          <button type="button" onClick={() => void save()}
            disabled={busy || term.trim().length === 0}
            aria-label="Add this line"
            className="rounded-md border border-charcoal-200 bg-white p-1.5 text-charcoal-700 hover:border-charcoal-400 disabled:opacity-50">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          </button>
          <button type="button" onClick={onCancel} disabled={busy}
            aria-label="Cancel this line"
            className="rounded-md border border-charcoal-200 bg-white p-1.5 text-charcoal-500 hover:border-charcoal-400">
            <X className="size-4" />
          </button>

          {error ? (
            <p className="w-full text-xs text-danger-700">{error}</p>
          ) : (
            <p className="w-full text-xs text-charcoal-500">
              Enter adds it and opens the next blank row. Escape closes this one.
            </p>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
