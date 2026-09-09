/**
 * The words on a line, which are not read-only.
 *
 * They were, from the day the workspace was built. An estimator could change a
 * line's quantity, unit, crew, production rate and markup, and could not fix a
 * typo in what the line said — an asymmetry that is invisible to whoever built
 * it and obvious to whoever uses it every day.
 *
 * Typing does two things at once, deliberately, because from where the
 * estimator sits it is one gesture:
 *
 *   * **It changes the words.** Press Enter and the line says what you typed.
 *     "Mass excavation" becomes "Mass excavation — north half" and the library
 *     link stays, because that is describing this job rather than renaming a
 *     service.
 *   * **It searches the library.** Matches appear under the cursor from the
 *     first letters. Choosing one repoints the line at that service and brings
 *     its unit, cost code and production rate with it — and says which of those
 *     actually moved, rather than leaving somebody to notice later.
 *
 * The unit is the one that does not always follow. Once resources are priced on
 * a line, changing CY to LF underneath a measured quantity leaves the number and
 * changes what it means, so the database holds the unit and this says so.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  searchServices, updateLine, setLineService, type LibraryService,
} from '@/lib/data/estimates';
import { cn } from '@/lib/utils';

export function LineDescription({
  lineId, description, serviceName, serviceId, editable, note, onChanged,
}: {
  lineId: string;
  description: string;
  /** What the library calls it, when the line came from there. */
  serviceName: string | null;
  serviceId: string | null;
  editable: boolean;
  /** The line under the words — a warning, a provenance note. */
  note?: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState(description);
  const [cursor, setCursor] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) field.current?.select(); }, [open]);
  useEffect(() => { if (!open) setTerm(description); }, [description, open]);

  const services = useQuery(searchServices(open ? term : '', null), [open, term]);
  const results = services.status === 'ready' ? services.data : [];
  /*
   * Only suggest once the words have actually changed. Opening a cell to fix a
   * comma should not offer to replace the line with something else.
   */
  const suggesting = open && term.trim().length >= 2 && term !== description && results.length > 0;

  const close = () => { setOpen(false); setCursor(-1); setError(null); };

  const saveWords = async () => {
    if (!supabase || busy) return;
    const next = term.trim();
    if (next.length === 0 || next === description) { close(); return; }
    setBusy(true); setError(null);
    try {
      await updateLine(supabase, lineId, { description: next });
      setSaid(null);
      close();
      onChanged();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const choose = async (s: LibraryService) => {
    if (!supabase || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await setLineService(supabase, lineId, s.id);
      /*
       * Say what moved. A swap that silently changes the unit and the cost code
       * is a swap somebody discovers in a total.
       */
      const moved = r.changed.filter((c) => c !== 'link');
      setSaid(
        r.unitHeld
          ? `Now ${s.name}. The unit stayed ${s.defaultUnit === undefined ? '' : ''}as it was — this line is already priced.`
          : moved.length
            ? `Now ${s.name}, with its ${moved.map(readable).join(', ')}.`
            : `Now ${s.name}.`,
      );
      close();
      onChanged();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!supabase || busy) return;
    setBusy(true); setError(null);
    try {
      await setLineService(supabase, lineId, null);
      setSaid('Taken off the library. The words are yours now.');
      close();
      onChanged();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); setTerm(description); close(); return; }
    if (suggesting) {
      if (e.key === 'ArrowDown') {
        e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); return;
      }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, -1)); return; }
      if (e.key === 'Enter' && cursor >= 0) { e.preventDefault(); void choose(results[cursor]!); return; }
    }
    if (e.key === 'Enter') { e.preventDefault(); void saveWords(); }
  };

  if (!editable) {
    return (
      <div>
        <p className="font-medium text-charcoal-900">{description}</p>
        {note ? <p className="text-xs text-charcoal-400">{note}</p> : null}
      </div>
    );
  }

  if (!open) {
    return (
      <div className="min-w-0">
        {/*
          * One line, always. A description that wraps pushes every row in the
          * table to a different height and an estimator loses the column they
          * were reading down.
          */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={description}
          aria-label={`Change what line "${description}" says`}
          className="block w-full truncate rounded px-1 py-0.5 text-left font-medium
                     text-charcoal-900 hover:bg-charcoal-50">
          {description}
        </button>
        {said ? <p className="truncate px-1 text-xs text-ok-700">{said}</p> : null}
        {note && !said ? <p className="truncate px-1 text-xs text-warn-700">{note}</p> : null}
      </div>
    );
  }

  return (
    /*
     * While it is open the editor is wider than its cell. A description column
     * sized for reading is too narrow for typing into, and shrinking the words
     * to fit the box is the wrong way round — the box gets bigger instead.
     */
    /*
     * `w-full`, not a minimum.
     *
     * This carried `min-w-[26rem]` so the words being typed had room. Inside
     * the estimate's grid that forced the description column wider than its
     * share and pushed every number on the row to the right — which is the
     * "everything gets out of line" that kept coming back. The column is
     * already the widest thing on the line; the input takes all of it, and the
     * suggestion list below floats free of the layout because it is absolute.
     */
    <div className="relative z-30 w-full">
      <div className="flex items-center gap-1">
        <Input
          ref={field}
          value={term}
          disabled={busy}
          autoComplete="off"
          role="combobox"
          aria-expanded={suggesting}
          aria-autocomplete="list"
          aria-label="What this line says"
          className="h-8 w-full whitespace-nowrap bg-white"
          onChange={(e) => { setTerm(e.target.value); setCursor(-1); }}
          onKeyDown={onKeyDown}
        />
        <button type="button" onClick={() => void saveWords()} disabled={busy}
          aria-label="Save these words"
          className="rounded p-1 text-charcoal-500 hover:bg-charcoal-100 hover:text-charcoal-900">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        </button>
        <button type="button" onClick={() => { setTerm(description); close(); }} disabled={busy}
          aria-label="Leave it as it was"
          className="rounded p-1 text-charcoal-400 hover:bg-charcoal-100">
          <X className="size-4" />
        </button>
      </div>

      <p className="mt-1 truncate text-xs text-charcoal-500">
        Enter keeps your words. Pick a match below to change what the line is.
        {serviceId ? (
          <>
            {' '}
            <button type="button" onClick={() => void unlink()} disabled={busy}
              className="underline hover:text-charcoal-800">
              Take it off the library
            </button>
          </>
        ) : null}
      </p>

      {suggesting ? (
        <div role="listbox" aria-label="Matching library services"
          className="absolute left-0 right-0 top-9 z-20 max-h-52 overflow-y-auto rounded-md
                     border border-charcoal-200 bg-white shadow-lg">
          {results.slice(0, 12).map((s, i) => (
            <button key={s.id} type="button" role="option" aria-selected={i === cursor}
              onMouseEnter={() => setCursor(i)}
              onClick={() => void choose(s)}
              className={cn(
                'flex w-full items-center justify-between gap-3 border-b border-charcoal-100 px-3 py-1.5 text-left last:border-0',
                i === cursor ? 'bg-yellow-50' : 'hover:bg-charcoal-50')}>
              <span className="min-w-0">
                <span className="block truncate text-sm text-charcoal-900">{s.name}</span>
                <span className="block text-xs text-charcoal-500">
                  {s.code}{s.category ? ` · ${s.category}` : ''}
                  {serviceName === s.name ? ' · already this one' : ''}
                </span>
              </span>
              <Badge variant={s.isOwn ? 'info' : 'default'}>
                {s.isOwn ? 'yours' : s.defaultUnit}
              </Badge>
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p role="alert" className="mt-1 text-xs text-danger-700">{error}</p> : null}
    </div>
  );
}

/** "production_rate" is not a word anybody says out loud. */
function readable(change: string): string {
  switch (change) {
    case 'unit': return 'unit';
    case 'cost_code': return 'cost code';
    case 'production_rate': return 'production rate';
    case 'description': return 'name';
    default: return change.replace(/_/g, ' ');
  }
}
