/**
 * Library — the haul rates, and the door onto them.
 *
 * `trucking_rates` has existed since migration 0004 and has never held a row.
 * Six things read it — the Hauling tab, `app.haul_cost`, the haul-profile
 * dialog, the typed picker on a line, `WhatAHaulCosts`, the fleet view — and
 * nothing could write one. `company_id` is `not null`, so the platform cannot
 * ship a haul rate even in principle, and `createTruckingRate` sat in the data
 * layer with no caller anywhere in the application. Six readers, no writer.
 *
 * That is not an oversight about a button. A haul rate is a negotiated position
 * with a specific trucker — there is no catalog default for one and there never
 * will be — so the company entering its own *is* the feature, and it was the
 * only part missing.
 *
 * The shape follows what migration 0067 decided:
 *
 *   * **The basis is chosen first, because it decides which number prices.**
 *     A cycle rate gives a cost, a duration and a truck count. A trip rate pays
 *     for the truck that arrives rather than the dirt in it. A unit rate has no
 *     schedule in it at all, and RULE-004 treats an estimate built on one as
 *     preliminary. The form shows the figure the chosen basis requires and
 *     refuses to submit without it — the table has a constraint saying the same
 *     thing, and being told by a form beats being told by a CHECK.
 *
 *   * **The cycle is always asked for.** Load, dump and delay minutes and the
 *     two speeds cost nothing to state and are what turn a rate into a
 *     schedule; a profile exists so nobody re-enters them on every haul.
 *
 *   * **The code is the database's.** Two people adding a profile at the same
 *     moment would otherwise read the same highest code and collide on the
 *     unique index (migration 0156).
 */
import { useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2, Truck, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { UnitSelect } from '@/components/ui/unit-select';
import { messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { money, qty } from '@/lib/format';
import {
  createTruckingRate, updateTruckingRate, retireTruckingRate, nextHaulCode,
  type TruckingRateRow, type TruckingRateInput,
} from '@/lib/data/library';

type Basis = 'cycle' | 'per_trip' | 'per_unit';

const BASIS: Array<{ value: Basis; label: string; blurb: string }> = [
  { value: 'cycle', label: 'By the hour, with a cycle',
    blurb: 'The only basis that also gives a duration and a truck count.' },
  { value: 'per_trip', label: 'By the trip',
    blurb: 'Pays for the truck that arrives, so a partial load is a whole trip.' },
  { value: 'per_unit', label: 'By the ton or yard',
    blurb: 'A number with no schedule in it. RULE-004 treats the estimate as preliminary.' },
];

/** What a new profile starts as. Nothing here is a price; the person supplies those. */
const BLANK = {
  name: '', truckType: 'tandem', capacity: 12, capacityUnit: 'CY',
  pricingBasis: 'cycle' as Basis,
  hourlyRate: 0, ratePerTrip: 0, preliminaryUnitRate: 0,
  minimumBillableQuantity: 0, chargesWholeTrips: true,
  loadMinutes: 10, dumpMinutes: 5, delayMinutes: 5,
  loadedSpeedMph: 30, emptySpeedMph: 35,
};

type Draft = typeof BLANK;

const fromRow = (t: TruckingRateRow): Draft => ({
  name: t.name, truckType: t.truckType,
  capacity: t.capacity, capacityUnit: t.capacityUnit,
  pricingBasis: t.pricingBasis,
  hourlyRate: t.hourlyRate,
  ratePerTrip: t.ratePerTrip ?? 0,
  preliminaryUnitRate: t.preliminaryUnitRate ?? 0,
  minimumBillableQuantity: t.minimumBillableQuantity ?? 0,
  chargesWholeTrips: t.chargesWholeTrips,
  loadMinutes: t.loadMinutes, dumpMinutes: t.dumpMinutes, delayMinutes: t.delayMinutes,
  loadedSpeedMph: t.loadedSpeedMph, emptySpeedMph: t.emptySpeedMph,
});

/** The figure the chosen basis has to carry, or null when it carries it. */
export function whatIsMissing(d: Draft): string | null {
  if (!d.name.trim()) return 'Give the profile a name.';
  if (d.capacity <= 0) return 'A truck holds something — say what its capacity is.';
  if (d.pricingBasis === 'cycle' && d.hourlyRate <= 0) {
    return 'An hourly haul needs an hourly rate.';
  }
  if (d.pricingBasis === 'per_trip' && d.ratePerTrip <= 0) {
    return 'A trip-priced haul needs a price a trip.';
  }
  if (d.pricingBasis === 'per_unit' && d.preliminaryUnitRate <= 0) {
    return 'A unit-priced haul needs a rate per unit.';
  }
  return null;
}

/** The round trip the numbers describe, so a person can check it as they type. */
export function cycleMinutes(d: Draft, oneWayMiles = 10): number | null {
  if (d.loadedSpeedMph <= 0 || d.emptySpeedMph <= 0) return null;
  const driving = (oneWayMiles / d.loadedSpeedMph + oneWayMiles / d.emptySpeedMph) * 60;
  return driving + d.loadMinutes + d.dumpMinutes + d.delayMinutes;
}

export function HaulProfiles({ rates, companyId, canEdit, onChanged }: {
  rates: TruckingRateRow[];
  companyId: string | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (draft: Draft, id: string | null) => {
    if (!supabase || !companyId) return;
    const missing = whatIsMissing(draft);
    if (missing) { setError(missing); return; }
    setBusy(true); setError(null);
    try {
      const fields: Partial<TruckingRateInput> = {
        name: draft.name, truckType: draft.truckType,
        capacity: draft.capacity, capacityUnit: draft.capacityUnit,
        pricingBasis: draft.pricingBasis,
        hourlyRate: draft.pricingBasis === 'cycle' ? draft.hourlyRate : 0,
        ratePerTrip: draft.pricingBasis === 'per_trip' ? draft.ratePerTrip : null,
        preliminaryUnitRate:
          draft.pricingBasis === 'per_unit' ? draft.preliminaryUnitRate : null,
        /* "$12 a ton, 22-ton minimum". Left unstated it is the truck's capacity,
           which is the usual arrangement — so zero means "no separate minimum". */
        minimumBillableQuantity:
          draft.minimumBillableQuantity > 0 ? draft.minimumBillableQuantity : null,
        chargesWholeTrips: draft.chargesWholeTrips,
        loadMinutes: draft.loadMinutes, dumpMinutes: draft.dumpMinutes,
        delayMinutes: draft.delayMinutes,
        loadedSpeedMph: draft.loadedSpeedMph, emptySpeedMph: draft.emptySpeedMph,
      };
      if (id) {
        await updateTruckingRate(supabase, id, fields);
      } else {
        const code = await nextHaulCode(supabase, companyId);
        await createTruckingRate(supabase, { companyId, code, ...fields } as TruckingRateInput);
      }
      setAdding(false); setEditing(null);
      onChanged();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const retire = async (id: string) => {
    if (!supabase) return;
    setBusy(true); setError(null);
    try { await retireTruckingRate(supabase, id); onChanged(); }
    catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  };

  const live = rates.filter((t) => t.status !== 'archived');

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Truck className="size-4" /> Your haul profiles
          </CardTitle>
          <CardDescription>
            A haul rate is a position you negotiated with a specific trucker, so there is no
            catalog default for one — these are yours. A profile carries the cycle as well as
            the rate, which is what stops anyone re-entering load and dump times on every haul.
          </CardDescription>
        </div>
        {canEdit && !adding ? (
          <Button size="sm" variant="outline" disabled={!companyId}
            onClick={() => { setAdding(true); setEditing(null); setError(null); }}>
            <Plus className="mr-1.5 size-4" /> Add a haul profile
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-3">
        {error ? <Alert tone="danger" title="That did not save">{error}</Alert> : null}

        {adding ? (
          <HaulForm initial={BLANK} busy={busy}
            onSave={(d) => void save(d, null)}
            onCancel={() => { setAdding(false); setError(null); }} />
        ) : null}

        {live.length === 0 && !adding ? (
          <p className="text-sm text-charcoal-500">
            No haul profiles yet. Add the trucks you actually use — what one holds, what it
            costs, and how long it takes to load and dump — and every trucking line can start
            from one instead of being typed out.
          </p>
        ) : null}

        <ul className="space-y-2">
          {live.map((t) => (
            <li key={t.id} className="rounded-md border border-charcoal-200 bg-white p-3">
              {editing === t.id ? (
                <HaulForm initial={fromRow(t)} busy={busy} code={t.code}
                  onSave={(d) => void save(d, t.id)}
                  onCancel={() => { setEditing(null); setError(null); }} />
              ) : (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-xs text-charcoal-500">{t.code}</span>
                  <span className="font-medium text-charcoal-900">{t.name}</span>
                  <Badge variant={t.pricingBasis === 'cycle' ? 'success'
                    : t.pricingBasis === 'per_trip' ? 'default' : 'warn'}>
                    {BASIS.find((b) => b.value === t.pricingBasis)?.label}
                  </Badge>
                  <span className="tabular text-sm text-charcoal-700">
                    {t.pricingBasis === 'per_trip' && t.ratePerTrip != null
                      ? `${money(t.ratePerTrip)} / trip`
                      : t.pricingBasis === 'per_unit' && t.preliminaryUnitRate != null
                        ? `${money(t.preliminaryUnitRate)} / ${t.capacityUnit}`
                        : `${money(t.hourlyRate)} / hr`}
                  </span>
                  <span className="text-xs text-charcoal-500">
                    {qty(t.capacity, 1)} {t.capacityUnit} · {t.loadMinutes}/{t.dumpMinutes}/
                    {t.delayMinutes} min load, dump, delay · {t.loadedSpeedMph}/{t.emptySpeedMph} mph
                  </span>
                  {canEdit ? (
                    <span className="ml-auto flex items-center gap-1">
                      <button type="button" aria-label={`Edit ${t.name}`} disabled={busy}
                        onClick={() => { setEditing(t.id); setAdding(false); setError(null); }}
                        className="rounded-md border border-charcoal-200 p-1.5 text-charcoal-600 hover:border-charcoal-400">
                        <Pencil className="size-3.5" />
                      </button>
                      <button type="button" aria-label={`Stop offering ${t.name}`} disabled={busy}
                        onClick={() => void retire(t.id)}
                        className="rounded-md border border-charcoal-200 p-1.5 text-charcoal-600 hover:border-danger-400 hover:text-danger-700">
                        <Trash2 className="size-3.5" />
                      </button>
                    </span>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function HaulForm({ initial, busy, code, onSave, onCancel }: {
  initial: Draft; busy: boolean; code?: string;
  onSave: (d: Draft) => void; onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  useEffect(() => { setD(initial); }, [initial]);
  const set = <K extends keyof Draft,>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const cycle = cycleMinutes(d);
  const basis = BASIS.find((b) => b.value === d.pricingBasis)!;

  const num = (label: string, k: keyof Draft, width = 'w-24', step?: string) => (
    <div className="space-y-1">
      <Label className="text-xs text-charcoal-500" htmlFor={`haul-${String(k)}`}>{label}</Label>
      <Input id={`haul-${String(k)}`} type="number" step={step} className={`h-8 ${width}`}
        value={String(d[k] ?? '')} disabled={busy}
        onChange={(e) => set(k, Number(e.target.value) as Draft[typeof k])} />
    </div>
  );

  return (
    <div className="space-y-3 rounded-md border border-charcoal-300 bg-charcoal-50 p-3">
      <div className="flex flex-wrap items-end gap-3">
        {code ? (
          <div className="space-y-1">
            <Label className="text-xs text-charcoal-500">Code</Label>
            <p className="flex h-8 items-center font-mono text-xs text-charcoal-600">{code}</p>
          </div>
        ) : null}
        <div className="min-w-48 flex-1 space-y-1">
          <Label className="text-xs text-charcoal-500" htmlFor="haul-name">Name</Label>
          <Input id="haul-name" className="h-8" value={d.name} disabled={busy} autoFocus
            placeholder="Quad-axle dump — Vasquez Trucking"
            onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-charcoal-500" htmlFor="haul-type">Truck</Label>
          <Input id="haul-type" className="h-8 w-32" value={d.truckType} disabled={busy}
            placeholder="tandem" onChange={(e) => set('truckType', e.target.value)} />
        </div>
        {num('Capacity', 'capacity', 'w-20')}
        <div className="space-y-1">
          <Label className="text-xs text-charcoal-500">Unit</Label>
          <UnitSelect value={d.capacityUnit} label="What the truck capacity counts"
            onChange={(u) => set('capacityUnit', u)} />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-charcoal-500" htmlFor="haul-basis">Priced by</Label>
        <select id="haul-basis" value={d.pricingBasis} disabled={busy}
          onChange={(e) => set('pricingBasis', e.target.value as Basis)}
          className="h-8 rounded-md border border-charcoal-200 bg-white px-2 text-sm">
          {BASIS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
        <p className="text-xs text-charcoal-500">{basis.blurb}</p>
      </div>

      {/*
        * Only the figure this basis prices from. Showing all three would invite
        * somebody to fill in two and wonder which one the bid used.
        */}
      <div className="flex flex-wrap items-end gap-3">
        {d.pricingBasis === 'cycle' ? num('Rate / hr', 'hourlyRate') : null}
        {d.pricingBasis === 'per_trip' ? num('Rate / trip', 'ratePerTrip') : null}
        {d.pricingBasis === 'per_unit' ? (
          <>
            {num(`Rate / ${d.capacityUnit}`, 'preliminaryUnitRate')}
            {num('Minimum billed', 'minimumBillableQuantity')}
          </>
        ) : null}
        {d.pricingBasis === 'per_trip' ? (
          <label className="flex items-center gap-1.5 pb-2 text-xs text-charcoal-600">
            <input type="checkbox" checked={d.chargesWholeTrips} disabled={busy}
              onChange={(e) => set('chargesWholeTrips', e.target.checked)} />
            A partial load is a whole trip
          </label>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-charcoal-200 pt-3">
        {num('Load (min)', 'loadMinutes', 'w-20')}
        {num('Dump (min)', 'dumpMinutes', 'w-20')}
        {num('Delay (min)', 'delayMinutes', 'w-20')}
        {num('Loaded mph', 'loadedSpeedMph', 'w-20')}
        {num('Empty mph', 'emptySpeedMph', 'w-20')}
      </div>
      <p className="text-xs text-charcoal-500">
        {cycle != null
          ? `A ten-mile haul on these numbers is a ${qty(cycle, 1)} minute round trip. `
            + 'The trip count and the truck count come from the engine, which sizes the '
            + 'fleet from what the loader can actually load.'
          : 'Give it two speeds and the cycle follows.'}
      </p>

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => onSave(d)}>
          {busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
          Save the profile
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          <X className="mr-1.5 size-4" /> Cancel
        </Button>
      </div>
    </div>
  );
}
