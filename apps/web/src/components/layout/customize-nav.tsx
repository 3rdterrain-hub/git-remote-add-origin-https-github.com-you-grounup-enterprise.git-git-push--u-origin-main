/**
 * Arranging the navigation.
 *
 * Two things a person can change: the order, and where the bar lives. Both are
 * saved to their own profile rather than the browser, so the arrangement
 * follows them to the next machine — a preference that only exists in one
 * browser's storage is one they will set again on Monday.
 *
 * Reordering is drag-and-drop *and* a pair of buttons on every row. The
 * buttons are not a fallback for browsers that cannot drag; they are the
 * accessible way to do it, they work on a phone, and they are how somebody
 * moves an item eleven places without holding the mouse down for eleven rows.
 */
import { Fragment, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, PanelLeft, PanelTop, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ErrorState } from '@/components/data-state';
import { cn } from '@/lib/utils';
import { messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  saveNavPreference, DEFAULT_NAV, type NavPreference, type NavPlacement,
} from '@/lib/data/preferences';

export interface NavChoice {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Which part of the job it belongs to. Moving is within a group. */
  group?: string;
}

export function CustomizeNavDialog({
  open, onOpenChange, items, value, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Every item that could be shown, in the application's own order. */
  items: readonly NavChoice[];
  value: NavPreference;
  onSaved: (next: NavPreference) => void;
}) {
  const [draft, setDraft] = useState<NavPreference>(value);
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reopening shows what is saved, not what was abandoned last time.
  useEffect(() => { if (open) { setDraft(value); setError(null); } }, [open, value]);

  /*
   * The working list is every item, in the person's order, including the ones
   * they have hidden — hidden is a flag on the row rather than a second list,
   * because an item you have put away still has a place to come back to.
   */
  const ordered = (() => {
    const byKey = new Map(items.map((i) => [i.key, i]));
    const out: NavChoice[] = [];
    for (const key of draft.order) {
      const item = byKey.get(key);
      if (item) { out.push(item); byKey.delete(key); }
    }
    for (const item of items) if (byKey.has(item.key)) out.push(item);
    return out;
  })();

  /*
   * Moving happens inside a group. Letting an item cross a heading would
   * scatter the grouping the sidebar renders, and the person moving it would
   * watch their arrangement come apart rather than tighten up.
   */
  const move = (key: string, by: number) => {
    const item = ordered.find((i) => i.key === key);
    if (!item) return;
    const siblings = ordered.filter((i) => i.group === item.group);
    const at = siblings.findIndex((i) => i.key === key);
    const swapWith = siblings[at + by];
    if (!swapWith) return;

    const keys = ordered.map((i) => i.key);
    const a = keys.indexOf(key);
    const b = keys.indexOf(swapWith.key);
    [keys[a], keys[b]] = [keys[b]!, keys[a]!];
    setDraft({ ...draft, order: keys });
  };

  const dropOn = (key: string) => {
    if (!dragging || dragging === key) return;
    const from = ordered.find((i) => i.key === dragging);
    const onto = ordered.find((i) => i.key === key);
    // Same reason as the buttons: a drag across a heading would break the
    // grouping rather than rearrange it.
    if (!from || !onto || from.group !== onto.group) { setDragging(null); return; }

    const keys = ordered.map((i) => i.key);
    const a = keys.indexOf(dragging);
    const b = keys.indexOf(key);
    keys.splice(b, 0, keys.splice(a, 1)[0]!);
    setDraft({ ...draft, order: keys });
    setDragging(null);
  };

  const toggleHidden = (key: string) =>
    setDraft({
      ...draft,
      hidden: draft.hidden.includes(key)
        ? draft.hidden.filter((k) => k !== key)
        : [...draft.hidden, key],
    });

  const setPlacement = (placement: NavPlacement) => setDraft({ ...draft, placement });

  const save = async () => {
    setBusy(true); setError(null);
    try {
      // The order is written out in full, so an item the person has never
      // touched still has a recorded position rather than drifting when the
      // application adds a screen above it.
      const next = { ...draft, order: ordered.map((i) => i.key) };
      if (supabase) await saveNavPreference(supabase, next);
      onSaved(next);
      onOpenChange(false);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const visibleCount = ordered.filter((i) => !draft.hidden.includes(i.key)).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Arrange your workspace</DialogTitle>
          <DialogDescription>
            Saved to your account, not this browser, so it follows you to the next machine.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Where the bar sits</Label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'side' as const, label: 'Down the side', icon: PanelLeft,
                  hint: 'Room for every screen at once.' },
                { value: 'top' as const, label: 'Across the top', icon: PanelTop,
                  hint: 'More width for wide tables and drawings.' },
              ]).map(({ value: v, label, icon: Icon, hint }) => (
                <button key={v} type="button" onClick={() => setPlacement(v)}
                  aria-pressed={draft.placement === v}
                  className={cn(
                    'rounded-[--radius-card] border p-3 text-left transition-colors',
                    draft.placement === v
                      ? 'border-yellow-500 bg-yellow-50'
                      : 'border-charcoal-200 hover:bg-charcoal-50',
                  )}>
                  <Icon className="size-4 text-charcoal-700" />
                  <p className="mt-1.5 text-sm font-medium text-charcoal-900">{label}</p>
                  <p className="text-xs text-charcoal-500">{hint}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label>Order and what to show</Label>
              <span className="text-xs text-charcoal-500">{visibleCount} of {items.length} shown</span>
            </div>
            <ul className="max-h-80 space-y-1 overflow-y-auto rounded-[--radius-card]
                           border border-charcoal-200 p-1">
              {ordered.map((item, i) => {
                const hidden = draft.hidden.includes(item.key);
                const Icon = item.icon;
                const siblings = ordered.filter((s) => s.group === item.group);
                const first = siblings[0]?.key === item.key;
                const last = siblings[siblings.length - 1]?.key === item.key;
                const opensGroup = i === 0 || ordered[i - 1]!.group !== item.group;
                return (
                  <Fragment key={item.key}>
                  {opensGroup && item.group ? (
                    <li className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase
                                   tracking-[0.14em] text-charcoal-500">
                      {item.group}
                    </li>
                  ) : null}
                  <li
                    draggable
                    onDragStart={() => setDragging(item.key)}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => dropOn(item.key)}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5',
                      dragging === item.key ? 'opacity-40' : 'hover:bg-charcoal-50',
                      hidden && 'opacity-60',
                    )}>
                    <GripVertical className="size-4 shrink-0 cursor-grab text-charcoal-400" />
                    <Icon className="size-4 shrink-0 text-charcoal-600" />
                    <span className={cn('flex-1 truncate text-sm',
                      hidden ? 'text-charcoal-400 line-through' : 'text-charcoal-800')}>
                      {item.label}
                    </span>
                    <Button variant="ghost" size="icon" className="size-7"
                      onClick={() => move(item.key, -1)} disabled={first}
                      aria-label={`Move ${item.label} up`}>
                      <ChevronUp className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7"
                      onClick={() => move(item.key, 1)} disabled={last}
                      aria-label={`Move ${item.label} down`}>
                      <ChevronDown className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7"
                      onClick={() => toggleHidden(item.key)}
                      aria-label={hidden ? `Show ${item.label}` : `Hide ${item.label}`}>
                      {hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </Button>
                  </li>
                  </Fragment>
                );
              })}
            </ul>
            <p className="text-xs text-charcoal-500">
              Items move within their group: crossing a heading would scatter the grouping rather
              than rearrange it. Hiding a screen only takes it off your bar — it does not change
              what you are permitted to open, and search still reaches it.
            </p>
          </div>

          {error ? <ErrorState message={error} /> : null}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => setDraft(DEFAULT_NAV)} disabled={busy}>
            <RotateCcw className="size-4" /> Back to the original
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save arrangement'}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
