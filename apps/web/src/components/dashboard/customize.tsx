/**
 * Arranging your own dashboard.
 *
 * A dashboard is the first screen somebody sees every morning, and what belongs
 * on it depends entirely on the job: a chief estimator wants bids due and the
 * weather, a controller wants what is under-billed, a safety manager wants
 * whose certification lapses this month. One fixed arrangement makes four
 * people out of five scroll past the part that matters to them.
 *
 * Two things this deliberately does not do. It does not offer a panel the
 * person may not see — permission is applied by the catalog, not by hiding a
 * checkbox, so an arrangement saved while somebody held safety permission stops
 * showing safety the moment it is taken away. And it does not let an
 * arrangement freeze the product: a panel added to GrounUp next year appears
 * for everybody who never turned it off, rather than being invisible because
 * their saved order predates it.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, LayoutGrid, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/misc';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ErrorState } from '@/components/data-state';
import { messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { saveDashboardPreference } from '@/lib/data/preferences';
import {
  PANELS, DEFAULT_DASHBOARD, type DashboardPreference, type PanelDefinition,
} from '@/lib/dashboard-panels';
import { cn } from '@/lib/utils';

export function CustomizeDashboard({ open, onOpenChange, preference, can, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  preference: DashboardPreference;
  can: (permission: string) => boolean;
  onSaved: (next: DashboardPreference) => void;
}) {
  const [draft, setDraft] = useState<DashboardPreference>(preference);
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setDraft(preference); setError(null); } }, [open, preference]);

  /* Only panels this person may see are offered at all. */
  const allowed = PANELS.filter((p) => can(p.permission));

  const ordered: PanelDefinition[] = (() => {
    const byKey = new Map(allowed.map((p) => [p.key, p]));
    const out: PanelDefinition[] = [];
    for (const key of draft.order) {
      const p = byKey.get(key);
      if (p) { out.push(p); byKey.delete(key); }
    }
    for (const p of allowed) if (byKey.has(p.key)) out.push(p);
    return out;
  })();

  const isOn = (p: PanelDefinition) =>
    !draft.hidden.includes(p.key) && (draft.order.includes(p.key) || p.defaultOn);

  const toggle = (p: PanelDefinition) => {
    setDraft((d) => {
      const on = isOn(p);
      return on
        ? { ...d, hidden: [...new Set([...d.hidden, p.key])] }
        : {
            ...d,
            hidden: d.hidden.filter((k) => k !== p.key),
            order: d.order.includes(p.key) ? d.order : [...d.order, p.key],
          };
    });
  };

  const reorder = (from: string, to: string) => {
    if (from === to) return;
    setDraft((d) => {
      const keys = ordered.map((p) => p.key);
      const next = keys.filter((k) => k !== from);
      next.splice(next.indexOf(to), 0, from);
      return { ...d, order: next };
    });
  };

  const nudge = (key: string, by: -1 | 1) => {
    setDraft((d) => {
      const keys = ordered.map((p) => p.key);
      const i = keys.indexOf(key);
      const j = i + by;
      if (i < 0 || j < 0 || j >= keys.length) return d;
      const next = [...keys];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return { ...d, order: next };
    });
  };

  const save = async () => {
    if (!supabase) return;
    setBusy(true); setError(null);
    try {
      await saveDashboardPreference(supabase, draft);
      onSaved(draft);
      onOpenChange(false);
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  };

  const shownCount = ordered.filter(isOn).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Arrange your dashboard</DialogTitle>
          <DialogDescription>
            Yours alone — nobody else's dashboard changes. Drag to reorder, or use the arrows.
            {allowed.length < PANELS.length ? (
              <> Panels your role cannot see are not offered.</>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-charcoal-200 p-3">
            <div>
              <p className="text-sm font-medium text-charcoal-900">Group into tabs</p>
              <p className="text-xs text-charcoal-500">
                Off shows every panel on one page, in this order.
              </p>
            </div>
            <Switch checked={draft.layout === 'tabs'} aria-label="Group into tabs"
              onCheckedChange={(c) => setDraft((d) => ({ ...d, layout: c ? 'tabs' : 'single' }))} />
          </div>

          <ul className="max-h-80 space-y-0.5 overflow-y-auto rounded-lg border border-charcoal-200 p-2">
            {ordered.map((p, i) => (
              <li key={p.key}
                draggable
                onDragStart={() => setDragging(p.key)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragging) reorder(dragging, p.key); setDragging(null); }}
                className={cn('flex items-start gap-2 rounded-md px-2 py-1.5',
                  dragging === p.key ? 'opacity-40' : 'hover:bg-charcoal-50')}>
                <GripVertical className="mt-0.5 size-4 shrink-0 cursor-grab text-charcoal-400"
                  aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-sm',
                    isOn(p) ? 'text-charcoal-900' : 'text-charcoal-400')}>
                    {p.title}
                    <span className="ml-1.5 text-xs text-charcoal-400">{p.tab}</span>
                  </p>
                  <p className="text-xs text-charcoal-500">{p.blurb}</p>
                </div>
                <Button variant="ghost" size="icon" className="size-7"
                  onClick={() => nudge(p.key, -1)} disabled={i === 0}
                  aria-label={`Move ${p.title} up`}>
                  <ChevronUp className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7"
                  onClick={() => nudge(p.key, 1)} disabled={i === ordered.length - 1}
                  aria-label={`Move ${p.title} down`}>
                  <ChevronDown className="size-3.5" />
                </Button>
                <Switch checked={isOn(p)} aria-label={`Show ${p.title}`}
                  onCheckedChange={() => toggle(p)} />
              </li>
            ))}
          </ul>

          <p className="text-xs text-charcoal-500">
            {shownCount} of {allowed.length} panels on. A dashboard with nothing on it is allowed —
            the figures across the top stay either way.
          </p>

          {error ? <ErrorState message={error} /> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setDraft(DEFAULT_DASHBOARD)} disabled={busy}>
            <RotateCcw className="size-4" /> Back to the shipped arrangement
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <LayoutGrid className="size-4" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
