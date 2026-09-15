/**
 * What you are measuring, picked before you trace.
 *
 * Every takeoff product estimators use has this panel, and all of them put it
 * ahead of the drawing tools: On-Screen Takeoff's Conditions window, PlanSwift's
 * conditions, STACK's takeoff list, eTakeoff's trace tree. The reason is not
 * habit. The thing owns the color, and forty overlapping traces are unreadable
 * unless each already knows what color it is; and it owns the depth, without
 * which no traced polygon becomes cubic yards.
 *
 * `traced` is on every row because a condition with nothing traced is something
 * somebody meant to measure and did not — and the only moment that is cheap to
 * notice is before the bid goes out.
 */
import { useState } from 'react';
import { Crosshair, Layers, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  loadConditions, createCondition, CONDITION_STYLES, UNITS_FOR_STYLE,
  type ConditionRow, type ConditionStyle,
} from '@/lib/data/conditions';
import { qty, integer } from '@/lib/format';

const STYLE_LABEL: Record<ConditionStyle, string> = {
  count: 'Count', linear: 'Length', area: 'Area', volume: 'Volume', basin: 'Pond',
};

export function ConditionList({ versionId, selectedId, onSelect, onHighlight, editable }: {
  versionId: string;
  selectedId: string | null;
  onSelect: (c: ConditionRow | null) => void;
  /** Light up every shape traced for one, the way OST's Select Objects does. */
  onHighlight: (conditionId: string | null) => void;
  editable: boolean;
}) {
  const conditionsQ = useQuery(loadConditions(versionId), [versionId]);
  const rows = conditionsQ.status === 'ready' ? conditionsQ.data : [];

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [style, setStyle] = useState<ConditionStyle>('area');
  const [unit, setUnit] = useState('SF');
  const [depth, setDepth] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseStyle = (next: ConditionStyle) => {
    setStyle(next);
    const allowed = UNITS_FOR_STYLE[next];
    if (!allowed.includes(unit)) setUnit(allowed[0]!);
  };

  const add = async () => {
    if (!supabase || busy) return;
    setBusy(true); setError(null);
    try {
      await createCondition(supabase, {
        versionId, name, style, unit,
        depthFeet: depth.trim() ? Number(depth) : null,
      });
      setAdding(false); setName(''); setDepth('');
      conditionsQ.refetch();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  const needsDepth = style === 'volume';

  return (
    <section className="space-y-3 rounded-[--radius-card] border border-charcoal-200 bg-white p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium text-charcoal-900">
          <Layers className="size-4 text-charcoal-500" aria-hidden /> What you are measuring
        </h3>
        <p className="text-xs text-charcoal-500">
          Pick one, then trace it wherever it appears. A sidewalk in twelve runs is twelve
          tracings and one line.
        </p>
      </div>

      {conditionsQ.status === 'loading' ? <LoadingState label="Reading the list" /> : null}
      {conditionsQ.status === 'error'
        ? <ErrorState message={conditionsQ.message} onRetry={conditionsQ.refetch} /> : null}

      {conditionsQ.status === 'ready' && rows.length === 0 && !adding ? (
        <EmptyState title="Nothing set up to measure yet"
          hint="Add the things this estimate is made of — sidewalk, curb, pavement — and each one gets its own color and its own line." />
      ) : null}

      {rows.length > 0 ? (
        <ul className="space-y-1">
          {rows.map((c) => {
            const chosen = c.id === selectedId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => onSelect(chosen ? null : c)}
                  onMouseEnter={() => onHighlight(c.id)}
                  onMouseLeave={() => onHighlight(null)}
                  className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5
                              text-left text-sm transition
                              ${chosen ? 'border-yellow-500 bg-yellow-50'
                                       : 'border-charcoal-200 hover:bg-charcoal-50'}`}
                >
                  <span className="size-3 shrink-0 rounded-sm" aria-hidden
                    style={{ backgroundColor: c.color }} />
                  <span className="min-w-0 flex-1 truncate text-charcoal-900">{c.name}</span>
                  <Badge variant="default">{STYLE_LABEL[c.style]}</Badge>
                  {c.traced === 0 ? (
                    <span className="shrink-0 text-xs text-charcoal-400">nothing traced</span>
                  ) : (
                    <span className="tabular shrink-0 text-xs text-charcoal-700">
                      {qty(c.quantity)} {c.unit}
                      <span className="ml-1 text-charcoal-400">
                        ({integer(c.traced)})
                      </span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {selectedId ? (
        <p className="flex items-center gap-1.5 text-xs text-charcoal-600">
          <Crosshair className="size-3.5" aria-hidden />
          Tracing goes onto this one. Pick it again to stop.
        </p>
      ) : null}

      {editable && !adding ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="mr-1.5 size-3.5" aria-hidden /> Add something to measure
        </Button>
      ) : null}

      {editable && adding ? (
        <div className="space-y-3 rounded-lg border border-charcoal-200 bg-charcoal-50/50 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="cond-name">What is it</Label>
            <Input id="cond-name" value={name} placeholder="6 inch concrete sidewalk"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cond-style">How it is measured</Label>
              <Select value={style} onValueChange={(v) => chooseStyle(v as ConditionStyle)}>
                <SelectTrigger id="cond-style"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONDITION_STYLES.map((s) => (
                    <SelectItem key={s} value={s}>{STYLE_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cond-unit">Reported in</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger id="cond-unit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UNITS_FOR_STYLE[style].map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {needsDepth ? (
            <div className="space-y-1.5">
              <Label htmlFor="cond-depth">Depth in feet</Label>
              <Input id="cond-depth" type="number" step="0.01" value={depth}
                onChange={(e) => setDepth(e.target.value)} />
              <p className="text-xs text-charcoal-500">
                The drawing does not supply it. Asked once here rather than once per tracing.
              </p>
            </div>
          ) : null}

          {error ? <Alert tone="danger" title="That could not be added">{error}</Alert> : null}

          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy || !name.trim()}
              onClick={() => void add()}>Add it</Button>
            <Button type="button" size="sm" variant="ghost"
              onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
