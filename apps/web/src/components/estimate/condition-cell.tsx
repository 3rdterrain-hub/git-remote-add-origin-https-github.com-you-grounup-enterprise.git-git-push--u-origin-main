/**
 * Engine — the conditions on a line, opened by clicking the factor.
 *
 * `estimate_line_modifiers` has existed since migration 0006 and the engine has
 * always read it: `modifiers.combined` multiplies labor, equipment, material,
 * trucking and disposal cost by what comes out. The only writers were the
 * template and revision copiers, so the COND. column rendered `1.0x` as gray
 * text — a number that could never be anything else, on a column whose entire
 * purpose is to be changed. Migration 0149 gave it a door and this is it.
 *
 * Three things the control has to get right:
 *
 *   * **It asks why.** The table refuses a justification under ten characters,
 *     because a condition multiplies what a job costs and a bid carrying one
 *     nobody explained is what that check exists to stop. Asking here means it
 *     is typed once rather than after the refusal.
 *   * **It shows what each condition does**, per cost bucket, from the factors
 *     as applied — not as the library currently holds them. A modifier retuned
 *     next month must not silently re-price a bid that already went out.
 *   * **It says the price has not moved yet.** The engine is the only thing
 *     permitted to write a cost, so the factor is recorded and the estimate is
 *     priced again. A panel that implied otherwise would be lying about which
 *     number is the bid.
 */
import { useState } from 'react';
import { Check, Loader2, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  loadLineConditions, applyLineCondition, removeLineCondition, type LineCondition,
} from '@/lib/data/estimates';
import { loadConditionModifiers, type ConditionModifierRow } from '@/lib/data/library';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

/** The buckets a condition can touch, in the order the engine applies them. */
const BUCKETS: Array<[string, string]> = [
  ['labor_cost', 'Labor'],
  ['equipment_cost', 'Equipment'],
  ['material_cost', 'Material'],
  ['trucking_cost', 'Trucking'],
  ['disposal_cost', 'Disposal'],
  ['production', 'Production'],
];

/**
 * `1.15` reads as `+15%`, `0.9` as `−10%`. A factor is easier as a change.
 *
 * Rounded to a tenth *before* asking whether it is a whole number, because
 * `(1.35 - 1) * 100` is `34.999999999999996` in binary floating point — so the
 * whole-number test failed and every clean factor in the library rendered as
 * `+35.0%`, `+20.0%`, `+15.0%`. The trailing zero was the float showing through.
 */
export function asChange(factor: number): string {
  const pct = Math.round((factor - 1) * 1000) / 10;
  if (Math.abs(pct) < 0.05) return 'no change';
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(pct % 1 === 0 ? 0 : 1)}%`;
}

function Factors({ factors }: { factors: Record<string, number> }) {
  const shown = BUCKETS.filter(([k]) => typeof factors[k] === 'number');
  if (shown.length === 0) return <span className="text-xs text-charcoal-400">no factors</span>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-charcoal-600">
      {shown.map(([k, label]) => (
        <span key={k}>
          {label} <span className={cn('tabular font-medium',
            factors[k]! > 1 ? 'text-danger-700' : factors[k]! < 1 ? 'text-success-700' : '')}>
            {asChange(factors[k]!)}
          </span>
        </span>
      ))}
    </span>
  );
}

export function ConditionCell({ lineId, description, productionModifier, editable, onChanged }: {
  lineId: string;
  description: string;
  /** What the engine computed. Shown when nothing is applied, as it always was. */
  productionModifier: number;
  editable: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const applied = useQuery(loadLineConditions(lineId), [lineId]);
  const count = applied.status === 'ready' ? applied.data.length : 0;

  return (
    <>
      <button type="button"
        className="tabular w-full text-center text-sm hover:underline"
        aria-label={count > 0
          ? `${count} condition${count === 1 ? '' : 's'} on ${description}`
          : `Add a condition to ${description}`}
        title={count > 0 ? 'The conditions on this line' : 'No conditions — click to add one'}
        onClick={() => setOpen(true)}>
        {count > 0 ? (
          <span className="font-medium text-charcoal-900">
            {count} cond.
          </span>
        ) : productionModifier === 1 ? (
          <span className="text-charcoal-400">1.0x</span>
        ) : (
          <span className="font-medium text-charcoal-900">{productionModifier}x</span>
        )}
      </button>

      <ConditionDialog open={open} onOpenChange={setOpen}
        lineId={lineId} description={description} editable={editable}
        applied={applied.status === 'ready' ? applied.data : []}
        loading={applied.status === 'loading'}
        error={applied.status === 'error' ? applied.message : null}
        onChanged={() => { applied.refetch(); onChanged(); }} />
    </>
  );
}

function ConditionDialog({
  open, onOpenChange, lineId, description, editable, applied, loading, error, onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lineId: string;
  description: string;
  editable: boolean;
  applied: LineCondition[];
  loading: boolean;
  error: string | null;
  onChanged: () => void;
}) {
  const library = useQuery(loadConditionModifiers, []);
  const [picked, setPicked] = useState<ConditionModifierRow | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const onLine = new Set(applied.map((a) => a.modifierId));
  const available = (library.status === 'ready' ? library.data : [])
    .filter((m) => !onLine.has(m.id));

  async function add() {
    if (!supabase || !picked) return;
    setBusy('add'); setFailure(null);
    try {
      await applyLineCondition(supabase, lineId, picked.id, why);
      setPicked(null); setWhy('');
      onChanged();
    } catch (err) { setFailure(messageFor(err)); }
    finally { setBusy(null); }
  }

  async function drop(modifierId: string) {
    if (!supabase) return;
    setBusy(modifierId); setFailure(null);
    try {
      await removeLineCondition(supabase, lineId, modifierId);
      onChanged();
    } catch (err) { setFailure(messageFor(err)); }
    finally { setBusy(null); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="size-4" /> Conditions on {description}
          </DialogTitle>
          <DialogDescription>
            A condition multiplies what this line costs — rock in the trench, work over water,
            night shift, restricted access. The factors are recorded as they stand today, so a
            library that is retuned later cannot re-price a bid that already went out.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {failure ? <Alert tone="danger">{failure}</Alert> : null}
          {error ? <ErrorState message={error} /> : null}
          {loading ? <LoadingState label="Reading the conditions" /> : null}

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
              On this line
            </p>
            {applied.length === 0 ? (
              <p className="text-sm text-charcoal-500">
                None. The line prices at the library&apos;s own rates.
              </p>
            ) : (
              <ul className="divide-y divide-charcoal-200 rounded-md border border-charcoal-200">
                {applied.map((c) => (
                  <li key={c.modifierId} className="space-y-1 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="flex items-baseline gap-2">
                        <span className="font-medium text-charcoal-900">{c.name}</span>
                        <span className="font-mono text-xs text-charcoal-500">{c.code}</span>
                        {c.category ? <Badge variant="default">{c.category}</Badge> : null}
                      </span>
                      {editable ? (
                        <Button variant="ghost" size="sm" disabled={busy !== null}
                          aria-label={`Remove ${c.name}`}
                          onClick={() => void drop(c.modifierId)}>
                          {busy === c.modifierId
                            ? <Loader2 className="size-3.5 animate-spin" />
                            : <X className="size-3.5" />}
                        </Button>
                      ) : null}
                    </div>
                    <Factors factors={c.appliedFactors} />
                    <p className="text-xs italic text-charcoal-500">{c.justification}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {editable ? (
            <div className="space-y-2 border-t border-charcoal-200 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
                Add one
              </p>
              {library.status === 'loading' ? <LoadingState label="Reading the library" /> : null}
              {available.length === 0 && library.status === 'ready' ? (
                <p className="text-sm text-charcoal-500">
                  Every condition in the library is already on this line.
                </p>
              ) : (
                <ul className="max-h-56 divide-y divide-charcoal-200 overflow-y-auto rounded-md border border-charcoal-200">
                  {available.map((m) => (
                    <li key={m.id}>
                      <button type="button"
                        className={cn('w-full space-y-1 p-3 text-left hover:bg-charcoal-50',
                          picked?.id === m.id && 'bg-yellow-50')}
                        onClick={() => { setPicked(m); setFailure(null); }}>
                        <span className="flex flex-wrap items-baseline gap-2">
                          <span className="font-medium text-charcoal-900">{m.name}</span>
                          <span className="font-mono text-xs text-charcoal-500">{m.code}</span>
                          {m.category ? <Badge variant="default">{m.category}</Badge> : null}
                          {picked?.id === m.id
                            ? <Check className="size-3.5 text-success-700" /> : null}
                        </span>
                        <Factors factors={m.factors} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {picked ? (
                <div className="space-y-1.5">
                  <Label htmlFor="cond-why">Why {picked.name} applies here</Label>
                  <Input id="cond-why" value={why} autoFocus
                    placeholder="Limestone ledge at 9 ft, not shown on the borings"
                    onChange={(e) => setWhy(e.target.value)} />
                  <p className="text-xs text-charcoal-500">
                    Ten characters at least. A condition multiplies what the work costs, and a bid
                    carrying one nobody explained is what that check exists to stop.
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-charcoal-500">
              This version is frozen. Create a revision to change what conditions apply.
            </p>
          )}

          <p className="text-xs leading-relaxed text-charcoal-500">
            Nothing here has moved the price yet. The engine is the only thing permitted to write a
            cost — price the estimate again and these factors are applied to labor, equipment,
            material, trucking and disposal, each kept in its own bucket.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy !== null}>
            Close
          </Button>
          {editable ? (
            <Button onClick={() => void add()}
              disabled={busy !== null || !picked || why.trim().length < 10}>
              {busy === 'add' ? <Loader2 className="size-4 animate-spin" /> : null}
              Apply the condition
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
