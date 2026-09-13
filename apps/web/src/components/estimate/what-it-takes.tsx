/**
 * What the library says this line is made of.
 *
 * Engine support, with a door on it at last. `assembly_components` has held the
 * answer since migration 0004 — 8,142 rows in the shipped catalog — and 0126
 * built both halves of the machinery to use them: a view that says what *would*
 * go on a line, and a writer that puts it there without ever overwriting a kind
 * somebody has already priced.
 *
 * Nothing called either. An estimator picking "Mass excavation" got a
 * production rate and five empty tabs, and rebuilt by hand what the library
 * already knew — which is the slowest possible way to use a catalog that ships
 * seeded.
 *
 * Two things this is careful about.
 *
 * **It shows before it writes.** The list is a read, so somebody can see the
 * crew, the machines and the materials a service implies — with the rates that
 * would actually land, resolved under RULE-003 — and decide. A button that
 * silently dropped eleven rows onto a line would be the platform estimating on
 * somebody's behalf.
 *
 * **It never overwrites.** A kind already carrying resources is left alone by
 * the writer, so this offers only what is missing and says so. Somebody who has
 * priced the equipment does not want the library's opinion of it dropped on
 * top.
 */
import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { LoadingState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  loadResourceSuggestions, applyResourceSuggestions, type ResourceSuggestion,
} from '@/lib/data/estimates';
import { money, qty, titleCase } from '@/lib/format';

const KIND_LABEL: Record<ResourceSuggestion['kind'], string> = {
  labor: 'Crew', equipment: 'Equipment', material: 'Materials', trucking: 'Hauling',
};

export function WhatItTakes({ lineId, editable, onApplied }: {
  lineId: string;
  editable: boolean;
  onApplied: () => void;
}) {
  const suggestions = useQuery(loadResourceSuggestions(lineId), [lineId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<number | null>(null);

  if (suggestions.status === 'loading') {
    return <LoadingState label="Reading what this service takes" />;
  }
  if (suggestions.status !== 'ready' || suggestions.data.length === 0) return null;

  const all = suggestions.data;
  /* Optional components are offered by the library and not taken by default —
     the writer skips them, so listing them as "will be added" would lie. */
  const missing = all.filter((s) => !s.alreadyOnLine && !s.isOptional);
  const onLine = all.filter((s) => s.alreadyOnLine);
  const optional = all.filter((s) => s.isOptional && !s.alreadyOnLine);

  const byKind = (rows: ResourceSuggestion[]) => {
    const groups = new Map<ResourceSuggestion['kind'], ResourceSuggestion[]>();
    for (const r of rows) {
      const g = groups.get(r.kind);
      if (g) g.push(r); else groups.set(r.kind, [r]);
    }
    return [...groups.entries()];
  };

  const apply = async () => {
    if (!supabase) return;
    setBusy(true); setError(null);
    try {
      const n = await applyResourceSuggestions(supabase, lineId);
      setAdded(n);
      suggestions.refetch();
      onApplied();
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  };

  const total = missing.reduce((a, s) => a + s.extendedCost, 0);

  return (
    <div className="mb-3 rounded-md border border-info-600/25 bg-info-50/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-charcoal-900">
            <Sparkles className="size-4 text-info-700" />
            What the library says this takes
          </p>
          <p className="mt-0.5 text-xs text-charcoal-600">
            From the service's assembly, scaled to this line's quantity, at the rates that
            would actually price it. Nothing is added until you say so, and nothing you have
            already priced is touched.
          </p>
        </div>
        {editable && missing.length > 0 ? (
          <Button size="sm" onClick={apply} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Add the {missing.length} missing
          </Button>
        ) : null}
      </div>

      {error ? <Alert tone="danger" className="mt-2" title="That did not apply">{error}</Alert> : null}
      {added !== null && !error ? (
        <p className="mt-2 text-xs text-success-700">
          {added === 0
            ? 'Nothing to add — every kind the library names is already on this line.'
            : `${added} added. The estimate needs pricing again to cost them.`}
        </p>
      ) : null}

      {missing.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {byKind(missing).map(([kind, rows]) => (
            <div key={kind} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
              <span className="w-20 shrink-0 font-medium text-charcoal-700">
                {KIND_LABEL[kind]}
              </span>
              <span className="min-w-0 flex-1 text-charcoal-600">
                {rows.map((r) => `${qty(r.quantity)} ${r.unit} ${r.name}`).join(' · ')}
              </span>
              <span className="tabular shrink-0 text-charcoal-500">
                {money(rows.reduce((a, r) => a + r.extendedCost, 0))}
              </span>
            </div>
          ))}
          <p className="tabular pt-1 text-xs font-medium text-charcoal-900">
            About {money(total)} of build-up, before markup.
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-charcoal-600">
          Everything the library names is already on this line.
        </p>
      )}

      {/*
        * Said rather than hidden. An optional component is the library's way of
        * saying "sometimes" — a trench box, a flagger, a second pump — and an
        * estimator who cannot see the list cannot decide it is needed.
        */}
      {optional.length > 0 ? (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-charcoal-600">
          <Badge variant="outline">Optional</Badge>
          {optional.map((r) => `${r.name} (${KIND_LABEL[r.kind]})`).join(' · ')}
          <span className="text-charcoal-500">— add these from the tabs if the job needs them.</span>
        </p>
      ) : null}

      {onLine.length > 0 && missing.length > 0 ? (
        <p className="mt-1 text-xs text-charcoal-500">
          {onLine.length} already on the line and left alone: {
            [...new Set(onLine.map((r) => titleCase(KIND_LABEL[r.kind])))].join(', ')}.
        </p>
      ) : null}
    </div>
  );
}
