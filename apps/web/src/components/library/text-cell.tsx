/**
 * A word you can change where it is shown. LIBRARY.
 *
 * `CostCell` did this for numbers and there was no equivalent for anything
 * else, so a machine's name, its class, a classification and a labor group were
 * all read-only text — the owner's "you can't add nothing, edit nothing, and
 * delete nothing. That is not customizable."
 *
 * Deliberately the same shape as `CostCell`: click the value, it becomes a box;
 * Enter saves, Escape abandons; a refusal is shown beside the field and the box
 * stays open with what was typed still in it, because throwing away somebody's
 * input on a failed save is how they lose the thing twice.
 */
import { useState } from 'react';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { messageFor } from '@/lib/data/query';

export function TextCell({
  value, editable, label, placeholder, busy = false, onSave, options,
}: {
  value: string | null;
  editable: boolean;
  /** What this field is, for the screen reader and the title. */
  label: string;
  placeholder?: string;
  busy?: boolean;
  onSave: (next: string) => Promise<unknown>;
  /** When given, a select rather than a free box — a choice, not typing. */
  options?: readonly string[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editable) {
    return <span className="text-charcoal-700">{value ?? <span className="text-charcoal-300">—</span>}</span>;
  }

  if (!editing) {
    return (
      <button type="button"
        className="group inline-flex items-center gap-1.5 text-left text-charcoal-700 hover:text-charcoal-900"
        title={`Change the ${label}`}
        onClick={() => { setDraft(value ?? ''); setError(null); setEditing(true); }}>
        {value ?? <span className="text-charcoal-300">—</span>}
        <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
      </button>
    );
  }

  const commit = () => {
    const next = draft.trim();
    if (next === (value ?? '').trim()) { setEditing(false); return; }
    setSaving(true); setError(null);
    onSave(next)
      .then(() => setEditing(false))
      /* The box stays open holding what was typed: a refusal that also loses
         the input makes somebody do the work twice. */
      .catch((e: unknown) => setError(messageFor(e)))
      .finally(() => setSaving(false));
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1">
        {options ? (
          <select autoFocus value={draft} aria-label={label}
            className="h-8 rounded-md border border-charcoal-200 bg-white px-2 text-sm"
            onChange={(e) => setDraft(e.target.value)}>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <Input autoFocus value={draft} aria-label={label} placeholder={placeholder}
            className="h-8 w-40"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') { setEditing(false); setError(null); }
            }} />
        )}
        <Button size="sm" variant="ghost" disabled={saving || busy}
          aria-label={`Save the ${label}`} onClick={commit}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        </Button>
        <Button size="sm" variant="ghost" aria-label="Cancel"
          onClick={() => { setEditing(false); setError(null); }}>
          <X className="size-4" />
        </Button>
      </span>
      {error ? <span className="text-xs text-danger-700">{error}</span> : null}
    </span>
  );
}
