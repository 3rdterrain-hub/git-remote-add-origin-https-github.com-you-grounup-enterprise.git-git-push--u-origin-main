/**
 * Picking a category, and adding one without leaving the form.
 *
 * Nine columns across the master libraries were free text, and free text is how
 * a library fragments: "Site Work", "Sitework" and "Site work" are three
 * categories to a database and one to a person. Migration 0113 made them
 * records and refuses a value that is not one, so this is not a nicety over a
 * text box — it is the way a category is set.
 *
 * The add path is inline on purpose. A picker that could only pick would have
 * traded one problem for a worse one: a company whose word for the work is not
 * in the shipped list would be unable to file it at all. Typing a new name and
 * pressing Add files it against the company and selects it, in one step, and
 * the next form offers it.
 */
import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { loadCategories, addCategory, type CategoryKind } from '@/lib/data/categories';
import { cn } from '@/lib/utils';

export function CategorySelect({
  kind, value, onChange, disabled, allowEmpty = true, className, id, label,
  canAdd = true,
}: {
  kind: CategoryKind;
  value: string | null | undefined;
  onChange: (name: string) => void;
  disabled?: boolean;
  allowEmpty?: boolean;
  className?: string;
  id?: string;
  /** For the accessible name when no visible label sits beside it. */
  label?: string;
  /** Off where the caller knows the person may not write to the libraries. */
  canAdd?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const categories = useQuery(loadCategories(kind), [kind, refresh]);
  const options = categories.status === 'ready' ? categories.data : [];
  /*
   * An empty list and a list that failed to load look identical in a dropdown,
   * and the second one is a fault. Say which it is rather than presenting a
   * broken control as an empty one.
   */
  const failed = categories.status === 'error';

  /*
   * A value not in the list is still shown, marked, rather than silently
   * vanishing: a row carrying a category that has since been retired should
   * say what it says, so somebody can see it and change it.
   */
  const stale = value != null && value !== ''
    && !options.some((o) => o.name.toLowerCase() === value.toLowerCase());

  const submit = async () => {
    const name = draft.trim();
    if (!supabase || name.length < 1) return;
    setBusy(true); setError(null);
    try {
      await addCategory(supabase, { kind, name });
      setDraft(''); setAdding(false);
      setRefresh((n) => n + 1);
      onChange(name);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  if (adding) {
    return (
      <div className={cn('space-y-1', className)}>
        <div className="flex items-center gap-1.5">
          <Input
            value={draft}
            autoFocus
            disabled={busy}
            placeholder="New category name"
            aria-label={`New ${label ?? 'category'}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void submit(); }
              if (e.key === 'Escape') { setAdding(false); setDraft(''); setError(null); }
            }}
            className="h-8"
          />
          <button type="button" onClick={() => void submit()}
            disabled={busy || draft.trim().length < 1}
            aria-label="Add this category"
            className="rounded-md border border-charcoal-200 p-1.5 text-charcoal-700 hover:border-charcoal-400 disabled:opacity-50">
            <Check className="size-4" />
          </button>
          <button type="button" aria-label="Cancel adding a category"
            onClick={() => { setAdding(false); setDraft(''); setError(null); }}
            className="rounded-md border border-charcoal-200 p-1.5 text-charcoal-500 hover:border-charcoal-400">
            <X className="size-4" />
          </button>
        </div>
        {error ? <p className="text-xs text-danger-700">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <select
        id={id}
        aria-label={label}
        value={value ?? ''}
        disabled={disabled || categories.status === 'loading'}
        title={failed ? categories.message : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-8 min-w-0 flex-1 rounded-md border border-charcoal-200 bg-white px-2 text-sm',
          'focus:border-yellow-500 focus:outline-none disabled:opacity-60',
          (stale || failed) && 'border-warn-400',
        )}
      >
        {allowEmpty ? <option value="">—</option> : null}
        {failed ? <option value="" disabled>Could not load the list</option> : null}
        {stale ? (
          <option value={value as string}>{value} (no longer offered)</option>
        ) : null}
        {options.map((o) => (
          <option key={o.id} value={o.name}>
            {o.name}{o.isOwn ? ' · yours' : ''}
          </option>
        ))}
      </select>
      {canAdd && !disabled ? (
        <button type="button" onClick={() => setAdding(true)}
          aria-label={`Add a ${label ?? 'category'}`}
          title="Add a category"
          className="shrink-0 rounded-md border border-charcoal-200 p-1.5 text-charcoal-600 hover:border-charcoal-400 hover:text-charcoal-900">
          <Plus className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
