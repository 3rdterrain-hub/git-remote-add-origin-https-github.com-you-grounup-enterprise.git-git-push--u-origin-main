/**
 * Markup and adjustments on this bid.
 *
 * `markup_components` hangs off a pricing profile, which is right for a
 * company standard — overhead, profit and contingency are the same on most
 * jobs — and wrong for a bond that applies to one. An estimator making that
 * adjustment had two options and both were bad: edit the company profile and
 * move every other open estimate, or make a profile per bid.
 *
 * So a bid may carry its own. Until it does, this shows the profile's and says
 * so, because the difference decides what a change affects.
 *
 * The basis matters more than the percentages. Bond and tax are charged on the
 * marked-up total and are applied in a second pass; overhead, profit and
 * contingency are applied together against cost. Getting that backwards is a
 * few percent on every bonded bid, so the panel states which is which rather
 * than leaving five identical-looking fields.
 */
import { useState } from 'react';
import { Percent, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  loadEstimateMarkups, setEstimateMarkup, adoptProfileMarkups, removeEstimateMarkup,
  loadDiscount, setEstimateDiscount,
  type EstimateMarkup,
} from '@/lib/data/estimates';
import { previewPrice, previewDiffersFromStored } from '@/lib/data/price-preview';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The adjustments a contractor reaches for, and where each is charged.
 *
 * Offered rather than made up on the spot, because the code is what the
 * pricing engine matches on and a free-text one would silently price as an
 * unknown component.
 */
const STANDARD: Array<{
  code: string; label: string; basis: EstimateMarkup['basis'];
  sequence: number; disclosed: boolean; hint: string;
}> = [
  { code: 'OH', label: 'Overhead', basis: 'profile_default', sequence: 10, disclosed: false,
    hint: 'On cost, beside profit.' },
  { code: 'PROFIT', label: 'Profit', basis: 'profile_default', sequence: 20, disclosed: false,
    hint: 'On cost, beside overhead.' },
  { code: 'CONT', label: 'Contingency', basis: 'profile_default', sequence: 30, disclosed: false,
    hint: 'On cost. The engine also derives one from confidence.' },
  { code: 'BOND', label: 'Bond / permit', basis: 'marked_up_total', sequence: 40, disclosed: true,
    hint: 'On the marked-up total, in a second pass.' },
  { code: 'TAX', label: 'Tax', basis: 'marked_up_total', sequence: 50, disclosed: true,
    hint: 'On the marked-up total, in a second pass.' },
];

export function MarkupPanel({ versionId, editable, directCost, indirectCost, storedPrice }: {
  versionId: string;
  editable: boolean;
  /**
   * The engine's own figures from the last run. Not recomputed here — moving a
   * markup does not change what the work costs, which is what makes the
   * preview exact rather than an approximation.
   */
  directCost?: number;
  indirectCost?: number;
  storedPrice?: number;
}) {
  const markupsQ = useQuery(loadEstimateMarkups(versionId), [versionId]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped when the discount is saved, so the live total re-reads it.
  const [discountNonce, setDiscountNonce] = useState(0);

  const state = markupsQ.status === 'ready'
    ? markupsQ.data : { markups: [] as EstimateMarkup[], fromProfile: true };
  const byCode = new Map(state.markups.map((m) => [m.code, m]));

  const run = async (fn: () => Promise<unknown>) => {
    if (!supabase) return;
    setBusy(true); setError(null);
    try { await fn(); markupsQ.refetch(); }
    catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  };

  /*
   * The first change to a bid that has never been adjusted copies the profile
   * down first, so switching tax on does not silently drop the overhead and
   * profit that were coming from the profile.
   */
  const change = (code: string, fields: Record<string, unknown>) => run(async () => {
    if (state.fromProfile && state.markups.length > 0) {
      await adoptProfileMarkups(supabase!, versionId).catch(() => undefined);
    }
    const standard = STANDARD.find((s) => s.code === code);
    await setEstimateMarkup(supabase!, versionId, code, {
      ...(standard ? {
        label: standard.label, basis: standard.basis,
        sequence: standard.sequence, disclosed: standard.disclosed,
      } : {}),
      ...fields,
    });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Percent className="size-4 text-charcoal-500" /> Markup and adjustments
        </CardTitle>
        <CardDescription>
          {state.fromProfile
            ? 'Coming from your pricing profile. Changing one here copies the set onto this bid'
              + ' first, so the change affects this estimate and not every open one.'
            : 'This bid carries its own. Your pricing profile is unchanged.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {markupsQ.status === 'loading' ? <LoadingState label="Loading the markup" /> : null}
        {markupsQ.status === 'error'
          ? <ErrorState message={markupsQ.message} onRetry={markupsQ.refetch} /> : null}
        {error ? <ErrorState message={error} /> : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {STANDARD.map((s) => {
            const m = byCode.get(s.code);
            const on = m?.enabled ?? false;
            return (
              <div key={s.code}
                className={cn('rounded-[--radius-card] border p-3',
                  on ? 'border-charcoal-300 bg-white' : 'border-charcoal-200 bg-charcoal-50/60')}>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`mk-${s.code}`} className="text-sm font-medium">
                    {s.label}
                  </Label>
                  <input type="checkbox" checked={on} disabled={!editable || busy}
                    aria-label={`Apply ${s.label}`}
                    onChange={(e) => {
                      void change(s.code, {
                        enabled: e.target.checked,
                        ...(m ? {} : { percent: 0 }),
                      });
                    }} />
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Input
                    id={`mk-${s.code}`}
                    className="h-8 w-24 tabular"
                    inputMode="decimal"
                    disabled={!editable || busy}
                    defaultValue={m ? String(Math.round(m.percent * 1e6) / 1e4) : ''}
                    placeholder="0"
                    aria-label={`${s.label} percent`}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const pct = raw === '' ? 0 : Number(raw);
                      if (!Number.isFinite(pct)) return;
                      if (m && Math.abs(pct / 100 - m.percent) < 1e-9) return;
                      void change(s.code, { percent: pct / 100, enabled: true });
                    }}
                  />
                  <span className="text-sm text-charcoal-500">%</span>
                  {m && !state.fromProfile && editable ? (
                    <Button variant="ghost" size="icon" className="ml-auto size-7"
                      aria-label={`Remove ${s.label} from this bid`}
                      onClick={() => { void run(() =>
                        removeEstimateMarkup(supabase!, versionId, s.code)); }}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-charcoal-500">{s.hint}</p>
                {s.disclosed ? (
                  <Badge variant="default" className="mt-1">shown to the customer</Badge>
                ) : null}
              </div>
            );
          })}
        </div>

        {!state.fromProfile && editable ? (
          <p className="text-xs text-charcoal-500">
            <RotateCcw className="mr-1 inline size-3" />
            Removing every adjustment puts this bid back on the pricing profile.
          </p>
        ) : null}
        <p className="text-xs text-charcoal-500">
          Switching one off leaves it out of the breakdown rather than sending it as zero: a bond
          charged at nothing still reads as a line the customer was billed for. Switching them all
          off falls back to the profile, because an empty panel is not the same as a job with no
          overhead.
        </p>

        <DiscountRow versionId={versionId} editable={editable}
          onChanged={() => setDiscountNonce((n) => n + 1)} />

        <LivePrice
          versionId={versionId}
          markups={state.markups}
          discountNonce={discountNonce}
          directCost={directCost ?? 0}
          indirectCost={indirectCost ?? 0}
          storedPrice={storedPrice ?? 0}
        />
      </CardContent>
    </Card>
  );
}

/**
 * The total, moving while somebody types.
 *
 * Computed by `calculatePrice` from `@grounup/engine` — the same module the
 * pricing Edge Function runs, vendored with a fingerprint the build refuses to
 * let drift. Not a second opinion about the arithmetic: the first one, called
 * from the browser side so bid day does not wait on a round trip.
 *
 * It says plainly when it has drifted from the recorded price, because a
 * preview read as the bid is worse than no preview at all.
 */
function LivePrice({
  versionId, markups, discountNonce, directCost, indirectCost, storedPrice,
}: {
  versionId: string;
  markups: readonly EstimateMarkup[];
  discountNonce: number;
  directCost: number;
  indirectCost: number;
  storedPrice: number;
}) {
  const discountQ = useQuery(loadDiscount(versionId), [versionId, discountNonce]);
  const discount = discountQ.status === 'ready'
    ? discountQ.data : { percent: 0, amount: 0, reason: null };

  const preview = previewPrice({ directCost, indirectCost, markups, discount });
  if (!preview) {
    return (
      <p className="text-xs text-charcoal-500">
        {directCost > 0
          ? 'Those numbers cannot be priced as they stand.'
          : 'Price the estimate and the total will move with these as you change them.'}
      </p>
    );
  }

  const drifted = storedPrice > 0 && previewDiffersFromStored(preview.totalPrice, storedPrice);

  return (
    <div className={cn('rounded-[--radius-card] border p-3',
      drifted ? 'border-warn-300 bg-warn-50/50' : 'border-charcoal-200 bg-white')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-charcoal-700">
          {drifted ? 'With these adjustments' : 'Total price'}
        </span>
        <span className="tabular text-xl font-semibold text-charcoal-900">
          {money(preview.totalPrice)}
        </span>
      </div>
      <dl className="mt-1.5 space-y-0.5 text-xs">
        {preview.components.map((c) => (
          <div key={c.code} className="flex items-baseline justify-between gap-3">
            <dt className="text-charcoal-500">{c.label}</dt>
            <dd className="tabular text-charcoal-700">{money(c.amount)}</dd>
          </div>
        ))}
        {preview.discountAmount > 0 ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-warn-700">Discount</dt>
            <dd className="tabular text-warn-700">−{money(preview.discountAmount)}</dd>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-3 border-t
                        border-charcoal-200 pt-1">
          <dt className="text-charcoal-600">Gross margin</dt>
          <dd className="tabular text-charcoal-800">
            {Math.round(preview.grossMarginPercent * 1000) / 10}%
          </dd>
        </div>
      </dl>

      {preview.warnings.map((w) => (
        <p key={w} className="mt-1.5 text-xs text-warn-700">{w}</p>
      ))}

      {drifted ? (
        <p className="mt-1.5 text-xs text-warn-700">
          The estimate is still recorded at {money(storedPrice)}. Price it again to make this
          the number the platform stands behind — until then this is a preview, not the bid.
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-charcoal-500">
          Computed here by the same engine that writes the price, so this is what pricing will
          produce. What the work costs is not recomputed — changing a quantity or a crew still
          needs the engine, because those rates come from the library.
        </p>
      )}
    </div>
  );
}

/**
 * Selling for less than the estimate says.
 *
 * Kept apart from the adjustments above because it is not one of them: markup
 * is what the job is sold at over cost, and a discount is a decision to take
 * less than that. The engine refuses a negative markup component for exactly
 * this reason — a component that reduced the price would make "what is this
 * marked up at" unanswerable.
 */
function DiscountRow({ versionId, editable, onChanged }: {
  versionId: string; editable: boolean; onChanged: () => void;
}) {
  const discountQ = useQuery(loadDiscount(versionId), [versionId]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const d = discountQ.status === 'ready'
    ? discountQ.data : { percent: 0, amount: 0, reason: null };
  const on = d.percent > 0 || d.amount > 0;

  const set = async (next: { percent?: number; amount?: number; reason?: string | null }) => {
    if (!supabase) return;
    setBusy(true); setError(null);
    try {
      await setEstimateDiscount(supabase, {
        versionId,
        percent: next.percent ?? d.percent,
        amount: next.amount ?? d.amount,
        reason: next.reason === undefined ? d.reason : next.reason,
      });
      discountQ.refetch();
      onChanged();
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className={cn('rounded-[--radius-card] border p-3',
      on ? 'border-warn-300 bg-warn-50/50' : 'border-charcoal-200 bg-charcoal-50/60')}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="discount-pct" className="text-sm font-medium">Discount</Label>
        <input type="checkbox" checked={on} disabled={!editable || busy}
          aria-label="Apply a discount"
          onChange={(e) => {
            void set(e.target.checked ? { percent: d.percent || 0.05 } : { percent: 0, amount: 0 });
          }} />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Input id="discount-pct" className="h-8 w-24 tabular" inputMode="decimal"
          disabled={!editable || busy}
          defaultValue={d.percent ? String(Math.round(d.percent * 1e6) / 1e4) : ''}
          placeholder="0" aria-label="Discount percent"
          onBlur={(e) => {
            const pct = e.target.value.trim() === '' ? 0 : Number(e.target.value);
            if (!Number.isFinite(pct) || Math.abs(pct / 100 - d.percent) < 1e-9) return;
            void set({ percent: pct / 100 });
          }} />
        <span className="text-sm text-charcoal-500">%</span>
        <Input className="h-8 w-28 tabular" inputMode="decimal"
          disabled={!editable || busy}
          defaultValue={d.amount ? String(d.amount) : ''}
          placeholder="or a flat sum" aria-label="Discount amount"
          onBlur={(e) => {
            const amt = e.target.value.trim() === '' ? 0 : Number(e.target.value);
            if (!Number.isFinite(amt) || amt === d.amount) return;
            void set({ amount: amt });
          }} />
      </div>

      <Input className="mt-1.5 h-8" disabled={!editable || busy}
        defaultValue={d.reason ?? ''} placeholder="Why the price was cut"
        aria-label="Discount reason"
        onBlur={(e) => {
          if (e.target.value === (d.reason ?? '')) return;
          void set({ reason: e.target.value });
        }} />

      {error ? <ErrorState message={error} /> : null}

      <p className="mt-1 text-xs text-charcoal-500">
        Taken off the marked-up price, not off cost — five percent off means five percent off the
        number quoted. The markup is unchanged, so what this job is marked up at is still an
        answerable question, and the concession shows as the thinner margin it is.
      </p>
      {on && !d.reason ? (
        <p className="mt-1 text-xs text-warn-700">
          Nobody has recorded why. Somebody reviewing this bid cannot tell what was given away.
        </p>
      ) : null}
    </div>
  );
}
