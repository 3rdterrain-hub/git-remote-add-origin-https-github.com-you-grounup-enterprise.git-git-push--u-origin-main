/**
 * The rate this line goes at, where it came from, and how to change it.
 *
 * A production rate is the number that turns a quantity into hours, and hours
 * into crew cost, machine cost, fuel, duration and the schedule. It was picked
 * once, silently, when the line was created, and an estimator had no way back
 * to it — which made the most consequential number on a line the only one they
 * could not see.
 *
 * Three things are on purpose here.
 *
 * The hours are shown beside the rate, because "240 CY/hr" is not what anybody
 * is actually asking; "1,800 CY takes about 9 hours" is. The figure comes from
 * the database, derived from the quantity and the rate, so it cannot disagree
 * with either.
 *
 * Where the rate came from is stated in words rather than a code. "GrounUp
 * benchmark" and "your measured actual, 6 jobs" are different claims and an
 * estimator should not have to know that `seed_benchmark` is the weaker one.
 *
 * And overriding asks for a sentence. The database refuses a bare number, and
 * saying so before the refusal is the difference between a rule and a wall.
 */
import { useState } from 'react';
import { Check, Gauge, Loader2, PencilLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  loadLineProduction, loadRateOptions, setLineRate, overrideLineProduction,
  SOURCE_LABEL, type ProductionSource,
} from '@/lib/data/production';
import { qty } from '@/lib/format';
import { cn } from '@/lib/utils';

/** How far a source should be trusted, in the badge that carries it. */
const SOURCE_TONE: Record<ProductionSource, 'success' | 'info' | 'warn' | 'default'> = {
  company_actual: 'success',
  company_historical: 'info',
  regional_benchmark: 'default',
  seed_benchmark: 'warn',
  manufacturer: 'default',
  estimator_judgment: 'warn',
};

export function ProductionRatePanel({ lineId, editable, onChanged }: {
  lineId: string;
  editable: boolean;
  onChanged: () => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const [picking, setPicking] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [perHour, setPerHour] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const production = useQuery(loadLineProduction(lineId), [lineId, refresh]);
  const options = useQuery(loadRateOptions(lineId), [lineId, refresh, picking]);

  const done = () => { setRefresh((n) => n + 1); onChanged(); };

  const choose = async (rateId: string | null) => {
    if (!supabase) return;
    setBusy(true); setError(null);
    try { await setLineRate(supabase, lineId, rateId); setPicking(false); done(); }
    catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  };

  const override = async () => {
    if (!supabase) return;
    setBusy(true); setError(null);
    try {
      await overrideLineProduction(supabase, {
        lineId, perHour: Number(perHour), reason,
      });
      setOverriding(false); setPerHour(''); setReason('');
      done();
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  };

  if (production.status === 'loading') {
    return <LoadingState label="Reading the production rate" />;
  }
  if (production.status === 'error') {
    return <ErrorState message={production.message} onRetry={production.refetch} />;
  }
  if (production.status !== 'ready' || !production.data) return null;

  const p = production.data;
  const list = options.status === 'ready' ? options.data : [];

  return (
    <div className="space-y-2 rounded-lg border border-charcoal-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-charcoal-900">
            <Gauge className="size-4 text-charcoal-400" />
            {p.ratePerHour != null ? (
              <>
                {qty(p.ratePerHour)} {p.rateUnit}/hr
                <span className="font-normal text-charcoal-500">
                  at {Math.round((p.utilizationFactor ?? 0) * 100)}% utilization
                </span>
              </>
            ) : (
              <span className="font-normal text-charcoal-500">
                No production rate on this line, so its hours come from the crew and machines below.
              </span>
            )}
            {p.sourceType ? (
              <Badge variant={SOURCE_TONE[p.sourceType]}>
                {SOURCE_LABEL[p.sourceType]}
                {p.sourceType === 'company_actual' && p.sampleSize
                  ? `, ${p.sampleSize} ${p.sampleSize === 1 ? 'job' : 'jobs'}` : ''}
              </Badge>
            ) : null}
            {p.approvalState === 'pending' ? (
              <Badge variant="warn">Not approved</Badge>
            ) : null}
          </p>

          {/*
            * The sentence somebody is actually asking for. Derived by the
            * database from the quantity and the rate, so it cannot drift from
            * either of them.
            */}
          {p.hoursAtThisRate != null ? (
            <p className="mt-0.5 text-xs text-charcoal-600">
              {qty(p.measuredQuantity)} {p.unit} takes about{' '}
              <strong>{qty(p.hoursAtThisRate, 1)} hours</strong> at this rate
              {p.taskName ? ` · ${p.taskName}` : ''}
            </p>
          ) : p.ratePerHour != null && p.rateUnit !== p.unit ? (
            <p className="mt-0.5 text-xs text-danger-700">
              This rate is measured in {p.rateUnit} and the line is bid in {p.unit}, so it says
              nothing about these hours. Pick one measured the same way.
            </p>
          ) : null}

          {p.sourceType === 'estimator_judgment' && p.note ? (
            <p className="mt-0.5 text-xs text-charcoal-500">Your reason: {p.note}</p>
          ) : null}
        </div>

        {editable ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => { setPicking((v) => !v); setOverriding(false); }}>
              {picking ? 'Close' : 'Change rate'}
            </Button>
            <Button variant="outline" size="sm"
              onClick={() => { setOverriding((v) => !v); setPicking(false); }}>
              <PencilLine className="size-4" /> Use my own
            </Button>
          </div>
        ) : null}
      </div>

      {error ? <ErrorState message={error} /> : null}

      {overriding ? (
        <div className="space-y-2 rounded-md border border-charcoal-200 bg-charcoal-50 p-3">
          <p className="text-xs text-charcoal-600">
            This files a rate against your company carrying your reason, and points the line at
            it. It is recorded as estimator judgment and marked not approved, so the estimate says
            plainly what it rests on — and it can be approved into your library later.
          </p>
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="pr-per-hour">{p.unit} per hour</Label>
              <Input id="pr-per-hour" type="number" min={0} step="any" value={perHour}
                onChange={(e) => setPerHour(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-reason">Why this is right for this work</Label>
              <Input id="pr-reason" value={reason}
                placeholder="Our crew ran this at 240 on the last two ponds"
                onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={override}
              disabled={busy || !(Number(perHour) > 0) || reason.trim().length < 12}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Use this rate
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOverriding(false)}>Cancel</Button>
            {reason.trim().length > 0 && reason.trim().length < 12 ? (
              <span className="text-xs text-charcoal-500">
                A sentence, not a word — this is what a reviewer will read.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {picking ? (
        <div className="max-h-56 overflow-y-auto rounded-md border border-charcoal-200">
          {options.status === 'loading' ? (
            <div className="p-3"><LoadingState label="Reading the library" /></div>
          ) : list.length === 0 ? (
            <p className="p-3 text-xs text-charcoal-500">
              The library has no rate for this service. Use your own, or add one to the library
              against the task this work belongs to.
            </p>
          ) : (
            <>
              {list.map((o) => (
                <button key={o.rateId} type="button" disabled={busy || !o.unitMatches}
                  onClick={() => choose(o.rateId)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 border-b border-charcoal-100 px-3 py-2 text-left last:border-0',
                    o.isCurrent ? 'bg-yellow-50' : 'hover:bg-charcoal-50',
                    !o.unitMatches && 'cursor-not-allowed opacity-50',
                  )}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-charcoal-900">
                      {qty(o.ratePerHour)} {o.rateUnit}/hr
                      {o.taskName ? ` · ${o.taskName}` : ''}
                    </span>
                    <span className="block text-xs text-charcoal-500">
                      {SOURCE_LABEL[o.sourceType]}
                      {o.sampleSize ? `, ${o.sampleSize} measured` : ''}
                      {!o.unitMatches ? ` · not measured in ${p.unit}` : ''}
                    </span>
                  </span>
                  {o.isCurrent ? <Badge variant="accent">On this line</Badge> : null}
                </button>
              ))}
              <button type="button" disabled={busy} onClick={() => choose(null)}
                className="w-full px-3 py-2 text-left text-xs text-charcoal-600 hover:bg-charcoal-50">
                No production rate — drive the hours from the crew and machines instead
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
