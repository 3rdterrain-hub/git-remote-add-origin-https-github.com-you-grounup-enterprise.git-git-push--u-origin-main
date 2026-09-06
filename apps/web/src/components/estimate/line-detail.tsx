/**
 * What a line is actually made of.
 *
 * An estimate line is a service and a quantity until somebody says who is doing
 * it and with what. This is that: the crew, the machines, the materials, the
 * trucks and the subcontracts, each a row in `estimate_line_resources` — a
 * table that has existed since migration 0006 with no way to put anything in it.
 *
 * Two rules govern every field below.
 *
 *   * **Nothing here is a cost.** The figures on the right are the engine's,
 *     written when the estimate is priced, and this screen never computes one.
 *     Where it does show arithmetic — a loaded rate, a cycle time — it is the
 *     estimator's own inputs added up, and it says so.
 *
 *   * **A frozen version refuses all of it.** RULE-009 freezes an approved
 *     version, and until migration 0108 its resources were the way around that.
 *     The fields are read-only here, and the database refuses them anyway.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Package, Plus, Ruler, ShoppingCart, Trash2, Truck, Users2, Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  loadLineResources, saveLineResource, deleteLineResource, updateLine,
  type LineResource, type LineRow,
} from '@/lib/data/estimates';
import { UnitSelect } from '@/components/ui/unit-select';
import { ProductionRatePanel } from '@/components/estimate/production-rate';
import { FromLibrary } from '@/components/estimate/from-library';
import { money, qty } from '@/lib/format';
import { cn } from '@/lib/utils';

const KIND_LABEL: Record<LineResource['kind'], string> = {
  labor: 'Crew', equipment: 'Equipment', material: 'Materials',
  trucking: 'Hauling', subcontract: 'Subs', disposal: 'Disposal',
};

const TABS: Array<{ kind: LineResource['kind']; icon: typeof Users2 }> = [
  { kind: 'labor', icon: Users2 },
  { kind: 'equipment', icon: Wrench },
  { kind: 'material', icon: Package },
  { kind: 'trucking', icon: Truck },
  { kind: 'subcontract', icon: ShoppingCart },
];

/** How many hours a rented period covers, for the note under an equipment row. */
const PERIOD_HOURS: Record<string, number> = { hour: 1, day: 8, week: 40, month: 160 };

export function LineDetail({ line, editable, onChanged }: {
  line: LineRow;
  editable: boolean;
  onChanged: () => void;
}) {
  const resourcesQ = useQuery(loadLineResources(line.id), [line.id]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const resources = resourcesQ.status === 'ready' ? resourcesQ.data : [];
  const of = (kind: LineResource['kind']) => resources.filter((r) => r.kind === kind);

  const run = async (fn: () => Promise<unknown>) => {
    if (!supabase) return;
    setBusy(true); setError(null);
    try { await fn(); resourcesQ.refetch(); onChanged(); }
    catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  };

  const save: SaveFn = (kind, fields, id) =>
    run(() => saveLineResource(supabase!, { lineId: line.id, kind, fields, resourceId: id ?? null }));
  const remove = (id: string) => { void run(() => deleteLineResource(supabase!, id)); };

  /*
   * The fleet rate: what the rows somebody ticked produce between them. Two
   * dozers at 100 an hour are 200, and every other row on the line works those
   * same hours. Shown, not stored — the hours the estimate is priced at are the
   * engine's, computed from the same inputs.
   */
  const drivers = resources.filter((r) => r.drivesHours && r.productionPerHour);
  const fleetRate = drivers.reduce(
    (a, r) => a + (r.productionPerHour ?? 0) * Math.max(1, r.headcount ?? r.quantity ?? 1), 0);
  const impliedHours = fleetRate > 0 ? line.measuredQuantity / fleetRate : null;

  return (
    <div className="space-y-3 border-t border-charcoal-200 bg-charcoal-50/60 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-charcoal-700">Production rate</span>
        {drivers.length > 0 ? (
          <span className="text-charcoal-600">
            Fleet rate from the rows that drive it:{' '}
            <strong>{qty(fleetRate)} {line.unit}/hr</strong> — rates add up
            {drivers.length > 1 ? ` (${drivers.length} rows)` : ''}, and every row on the line
            works those same hours.
            {impliedHours != null ? (
              <> ≈ {qty(impliedHours, 2)} hr for {qty(line.measuredQuantity)} {line.unit}</>
            ) : null}
          </span>
        ) : (
          <span className="text-charcoal-500">
            Off — hours are entered by hand, so the line total does not move when the quantity
            changes. Tick a machine or a crew row below to drive the hours from the quantity.
          </span>
        )}
      </div>

      {/*
        * The library rate under the line, beside the fleet rate the rows below
        * imply. They answer the same question two ways, and an estimator needs
        * to see both to know which one is deciding the hours.
        */}
      <ProductionRatePanel lineId={line.id} editable={editable} onChanged={onChanged} />

      {error ? <ErrorState message={error} /> : null}
      {resourcesQ.status === 'loading' ? <LoadingState label="Loading the build-up" /> : null}
      {resourcesQ.status === 'error'
        ? <ErrorState message={resourcesQ.message} onRetry={resourcesQ.refetch} /> : null}

      <Tabs defaultValue="labor">
        <TabsList>
          {TABS.map(({ kind, icon: Icon }) => (
            <TabsTrigger key={kind} value={kind}>
              <Icon className="size-3.5" /> {KIND_LABEL[kind]}
              {of(kind).length ? (
                <Badge variant="default" className="ml-1.5">{of(kind).length}</Badge>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="labor">
          <CrewTab rows={of('labor')} editable={editable} busy={busy}
            hours={impliedHours} onSave={save} onRemove={remove} />
        </TabsContent>
        <TabsContent value="equipment">
          <EquipmentTab rows={of('equipment')} editable={editable} busy={busy}
            hours={impliedHours} onSave={save} onRemove={remove} />
        </TabsContent>
        <TabsContent value="material">
          <MaterialTab rows={of('material')} editable={editable} busy={busy}
            onSave={save} onRemove={remove} />
        </TabsContent>
        <TabsContent value="trucking">
          <HaulTab rows={of('trucking')} editable={editable} busy={busy}
            onSave={save} onRemove={remove} />
        </TabsContent>
        <TabsContent value="subcontract">
          <SubTab rows={of('subcontract')} editable={editable} busy={busy}
            onSave={save} onRemove={remove} />
        </TabsContent>
      </Tabs>

      {editable ? <LineSettings line={line} onSaved={onChanged} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
type SaveFn = (kind: LineResource['kind'], fields: Record<string, unknown>, id?: string)
  => Promise<void>;

/** A number field that commits on blur, and only when it changed. */
function Num({ label, value, onCommit, disabled, width = 'w-20', placeholder }: {
  label?: string; value: number | null; onCommit: (v: number | null) => void;
  disabled?: boolean; width?: string; placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      {label ? <Label className="text-xs text-charcoal-500">{label}</Label> : null}
      <Input
        className={cn('h-8 tabular', width)}
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        defaultValue={value === null ? '' : String(value)}
        aria-label={label}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          const next = raw === '' ? null : Number(raw);
          if (next !== null && !Number.isFinite(next)) return;
          if (next === value) return;
          onCommit(next);
        }}
      />
    </div>
  );
}

function Text({ label, value, onCommit, disabled, width = 'flex-1', placeholder }: {
  label?: string; value: string | null; onCommit: (v: string) => void;
  disabled?: boolean; width?: string; placeholder?: string;
}) {
  return (
    <div className={cn('space-y-1', width)}>
      {label ? <Label className="text-xs text-charcoal-500">{label}</Label> : null}
      <Input
        className="h-8" disabled={disabled} placeholder={placeholder}
        defaultValue={value ?? ''} aria-label={label}
        onBlur={(e) => { if (e.target.value !== (value ?? '')) onCommit(e.target.value); }}
      />
    </div>
  );
}

function AddRow({ label, onAdd, disabled }: {
  label: string; onAdd: () => void; disabled?: boolean;
}) {
  return (
    <Button variant="outline" size="sm" className="mt-2" onClick={onAdd} disabled={disabled}>
      <Plus className="size-4" /> {label}
    </Button>
  );
}

function Empty({ what }: { what: string }) {
  return <p className="py-3 text-sm text-charcoal-500">Nothing on this line yet — {what}</p>;
}

function Cost({ value }: { value: number }) {
  return value
    ? <>{money(value)}</>
    : <span className="text-charcoal-400">unpriced</span>;
}

// ---------------------------------------------------------------------- crew
function CrewTab({ rows, editable, busy, hours, onSave, onRemove }: {
  rows: LineResource[]; editable: boolean; busy: boolean; hours: number | null;
  onSave: SaveFn; onRemove: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      {rows.length === 0 ? <Empty what="add the crew doing the work." /> : (
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-charcoal-500">
              <th className="font-medium">Role</th>
              <th className="font-medium">Who</th>
              <th className="font-medium">Count</th>
              <th className="font-medium">Base</th>
              <th className="font-medium">Burden</th>
              <th className="font-medium">Loaded</th>
              <th className="font-medium">Hours</th>
              <th className="font-medium">Drives hours</th>
              <th className="text-right font-medium">Cost</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              // Their own two numbers added up, not a rate anybody looked up.
              const loaded = (r.baseRate ?? 0) + (r.burdenRate ?? 0);
              return (
                <tr key={r.id} className="align-bottom">
                  <td><Text value={r.role} disabled={!editable} width="w-32"
                    placeholder="Operator"
                    onCommit={(v) => { void onSave('labor', { role: v }, r.id); }} /></td>
                  <td><Text value={r.description} disabled={!editable} width="w-44"
                    placeholder="Excavator Operator"
                    onCommit={(v) => { void onSave('labor', { description: v }, r.id); }} /></td>
                  <td><Num value={r.headcount} disabled={!editable} width="w-16"
                    onCommit={(v) => { void onSave('labor', { headcount: v ?? 1 }, r.id); }} /></td>
                  <td><Num value={r.baseRate} disabled={!editable} width="w-20"
                    onCommit={(v) => { void onSave('labor', { base_rate: v }, r.id); }} /></td>
                  <td><Num value={r.burdenRate} disabled={!editable} width="w-20"
                    onCommit={(v) => { void onSave('labor', { burden_rate: v }, r.id); }} /></td>
                  <td className="tabular px-2 text-charcoal-700">{money(loaded)}</td>
                  <td className="tabular px-2 text-xs text-charcoal-500">
                    {r.drivesHours && hours != null ? `auto ${qty(hours, 2)}` : (
                      <Num value={r.hours || null} disabled={!editable} width="w-20"
                        onCommit={(v) => { void onSave('labor', { hours: v ?? 0 }, r.id); }} />
                    )}
                  </td>
                  <td className="px-2">
                    <input type="checkbox" checked={r.drivesHours} disabled={!editable}
                      aria-label={`${r.description ?? 'This row'} drives the hours`}
                      onChange={(e) => { void onSave('labor', {
                        drives_hours: e.target.checked,
                        // A driver has to say at what rate; the database refuses
                        // one that does not, so a default is offered rather than
                        // an error thrown at somebody ticking a box.
                        production_per_hour: e.target.checked
                          ? (r.productionPerHour ?? 1) : r.productionPerHour,
                      }, r.id); }} />
                  </td>
                  <td className="tabular px-2 text-right font-medium">
                    <Cost value={r.extendedCost} />
                  </td>
                  <td>
                    {editable ? (
                      <Button variant="ghost" size="icon" className="size-7"
                        aria-label={`Remove ${r.description ?? 'this crew row'}`}
                        onClick={() => onRemove(r.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <AddRow label="Add crew member" disabled={busy}
            onAdd={() => { void onSave('labor',
              { role: 'Operator', headcount: 1, base_rate: 0, burden_rate: 0 }); }} />
          <FromLibrary kind="labor" disabled={busy} label="From labor rates"
            onPick={(f) => { void onSave('labor', f); }} />
          <FromLibrary kind="crew" disabled={busy} label="From a crew preset"
            onPickCrew={(members) => {
              /*
               * A crew is a composition, so every member comes across at once
               * — picking one and then adding the rest by hand would defeat
               * the point of having saved it.
               */
              for (const m of members) {
                void onSave('labor', {
                  labor_rate_id: m.laborRateId,
                  description: m.classification,
                  role: m.classification,
                  headcount: m.headcount,
                  base_rate: m.baseWagePerHour,
                  burden_rate:
                    Math.round(m.baseWagePerHour * m.burdenPercent * 100) / 100,
                });
              }
            }} />
        </div>
      ) : null}
      <p className="mt-2 text-xs text-charcoal-500">
        The wage and the burden are kept apart so the loaded rate is derived rather than a third
        number that can contradict them. The cost on the right is the engine's, written when the
        estimate is priced.
      </p>
    </div>
  );
}

// ----------------------------------------------------------------- equipment
function EquipmentTab({ rows, editable, busy, hours, onSave, onRemove }: {
  rows: LineResource[]; editable: boolean; busy: boolean; hours: number | null;
  onSave: SaveFn; onRemove: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {rows.length === 0 ? <Empty what="add the machines on it." /> : null}
      {rows.map((r) => {
        const periodHours = PERIOD_HOURS[r.rateBasis] ?? 1;
        const billed = hours != null && periodHours > 0
          ? Math.max(Math.ceil(hours / periodHours), 1) : null;
        return (
          <div key={r.id} className="rounded-md border border-charcoal-200 bg-white p-3">
            <div className="flex flex-wrap items-end gap-3">
              <Text label="Machine" value={r.description} disabled={!editable}
                width="min-w-48 flex-1" placeholder="Dozer D5"
                onCommit={(v) => { void onSave('equipment', { description: v }, r.id); }} />
              <div className="space-y-1">
                <Label className="text-xs text-charcoal-500">Billed by</Label>
                <select
                  className="h-8 rounded-md border border-charcoal-200 bg-white px-2 text-sm"
                  value={r.rateBasis} disabled={!editable}
                  aria-label={`How ${r.description ?? 'this machine'} is billed`}
                  onChange={(e) => {
                    void onSave('equipment', { rate_basis: e.target.value }, r.id);
                  }}>
                  {['hour', 'day', 'week', 'month'].map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
              <Num label="Rate" value={r.unitRate || null} disabled={!editable} width="w-24"
                onCommit={(v) => { void onSave('equipment', { unit_rate: v ?? 0 }, r.id); }} />
              <Num label="Count" value={r.quantity || null} disabled={!editable} width="w-16"
                onCommit={(v) => { void onSave('equipment', { quantity: v ?? 1 }, r.id); }} />
              <Num label="Prod/hr" value={r.productionPerHour} disabled={!editable} width="w-20"
                onCommit={(v) => { void onSave('equipment', {
                  production_per_hour: v, drives_hours: v != null && r.drivesHours,
                }, r.id); }} />
              <label className="flex items-center gap-1.5 pb-2 text-xs text-charcoal-600">
                <input type="checkbox" checked={r.drivesHours} disabled={!editable}
                  aria-label={`${r.description ?? 'This machine'} drives the hours`}
                  onChange={(e) => { void onSave('equipment', {
                    drives_hours: e.target.checked,
                    production_per_hour: e.target.checked
                      ? (r.productionPerHour ?? 1) : r.productionPerHour,
                  }, r.id); }} />
                drives hours
              </label>
              <label className="flex items-center gap-1.5 pb-2 text-xs text-charcoal-600">
                <input type="checkbox" checked={r.isOwned} disabled={!editable}
                  aria-label={`${r.description ?? 'This machine'} is owned`}
                  onChange={(e) => {
                    void onSave('equipment', { is_owned: e.target.checked }, r.id);
                  }} />
                owned
              </label>
              <span className="tabular ml-auto pb-2 text-right font-medium">
                <Cost value={r.extendedCost} />
              </span>
              {editable ? (
                <Button variant="ghost" size="icon" className="mb-1 size-7"
                  aria-label={`Remove ${r.description ?? 'this machine'}`}
                  onClick={() => onRemove(r.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </div>

            <div className="mt-2 flex flex-wrap items-end gap-3 border-t border-charcoal-100 pt-2">
              <Num label="Mobilization" value={r.mobilizationCost || null} disabled={!editable}
                width="w-24"
                onCommit={(v) => {
                  void onSave('equipment', { mobilization_cost: v ?? 0 }, r.id);
                }} />
              <Num label="Standby days" value={r.standbyDays || null} disabled={!editable}
                width="w-24"
                onCommit={(v) => { void onSave('equipment', { standby_days: v ?? 0 }, r.id); }} />
              <Num label="Minimum hours" value={r.minimumHours} disabled={!editable} width="w-24"
                onCommit={(v) => { void onSave('equipment', { minimum_hours: v }, r.id); }} />
              {billed != null && r.rateBasis !== 'hour' ? (
                <p className="pb-2 text-xs text-charcoal-500">
                  Billed: {billed} {r.rateBasis}{billed === 1 ? '' : 's'}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <AddRow label="Add equipment" disabled={busy}
            onAdd={() => {
              void onSave('equipment', { description: '', rate_basis: 'hour', quantity: 1 });
            }} />
          <FromLibrary kind="equipment" disabled={busy} label="From your fleet"
            onPick={(f) => { void onSave('equipment', { quantity: 1, ...f }); }} />
        </div>
      ) : null}
      <p className="text-xs text-charcoal-500">
        Production hours convert to the basis the machine is rented at and round up to whole
        periods, which is most of what a weekly rate costs. A rate quoted here is treated as a
        project quote and ranks above the library under RULE-003.
      </p>
    </div>
  );
}

// ----------------------------------------------------------------- materials
function MaterialTab({ rows, editable, busy, onSave, onRemove }: {
  rows: LineResource[]; editable: boolean; busy: boolean;
  onSave: SaveFn; onRemove: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {rows.length === 0 ? <Empty what="add what gets installed or placed." /> : null}
      {rows.map((r) => (
        <div key={r.id}
          className="flex flex-wrap items-end gap-3 rounded-md border border-charcoal-200 bg-white p-3">
          <Text label="Material" value={r.description} disabled={!editable}
            width="min-w-48 flex-1" placeholder="Aggregate base"
            onCommit={(v) => { void onSave('material', { description: v }, r.id); }} />
          <Num label="Quantity" value={r.quantity || null} disabled={!editable} width="w-24"
            onCommit={(v) => { void onSave('material', { quantity: v ?? 0 }, r.id); }} />
          <div className="space-y-1">
            <Label className="text-xs text-charcoal-500">Unit</Label>
            <UnitSelect value={r.unit} disabled={!editable} allowEmpty
              label={`Unit for ${r.description ?? 'this material'}`}
              onChange={(u) => { void onSave('material', { unit: u }, r.id); }} />
          </div>
          <Num label="Unit cost" value={r.unitRate || null} disabled={!editable} width="w-24"
            onCommit={(v) => { void onSave('material', { unit_rate: v ?? 0 }, r.id); }} />
          <span className="tabular ml-auto pb-2 font-medium"><Cost value={r.extendedCost} /></span>
          {editable ? (
            <Button variant="ghost" size="icon" className="mb-1 size-7"
              aria-label={`Remove ${r.description ?? 'this material'}`}
              onClick={() => onRemove(r.id)}>
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ))}
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <AddRow label="Add material" disabled={busy}
            onAdd={() => {
              void onSave('material', { description: '', quantity: 0, unit_rate: 0 });
            }} />
          <FromLibrary kind="material" disabled={busy}
            onPick={(f) => { void onSave('material', { quantity: 0, ...f }); }} />
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------- hauling
function HaulTab({ rows, editable, busy, onSave, onRemove }: {
  rows: LineResource[]; editable: boolean; busy: boolean;
  onSave: SaveFn; onRemove: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {rows.length === 0 ? <Empty what="add the trucks moving material." /> : null}
      {rows.map((r) => {
        const trip = r.haulMode === 'trip';
        /*
         * The cycle, from the numbers in front of them. Shown so an estimator
         * can sanity-check the route as they type it. The trips, the fleet size
         * and the cost come from the engine, which sizes the trucks from what
         * the loader can actually load rather than from a count somebody hoped
         * for.
         */
        const cycle = trip && r.roundTripMiles && r.averageSpeedMph
          ? (r.roundTripMiles / r.averageSpeedMph) * 60
            + (r.loadMinutes ?? 0) + (r.dumpMinutes ?? 0) + (r.queueMinutes ?? 0)
          : null;
        return (
          <div key={r.id} className="rounded-md border border-charcoal-200 bg-white p-3">
            <div className="flex flex-wrap items-end gap-3">
              <Text label="Truck" value={r.description} disabled={!editable}
                width="min-w-48 flex-1" placeholder="Quad-Axle Dump Truck"
                onCommit={(v) => { void onSave('trucking', { description: v }, r.id); }} />
              <div className="space-y-1">
                <Label className="text-xs text-charcoal-500">Priced by</Label>
                <select
                  className="h-8 rounded-md border border-charcoal-200 bg-white px-2 text-sm"
                  value={r.haulMode} disabled={!editable}
                  aria-label="How the haul is priced"
                  onChange={(e) => { void onSave('trucking', {
                    haul_mode: e.target.value,
                    // A trip haul refuses to save without a route, so switching
                    // to it brings starting numbers rather than an error.
                    ...(e.target.value === 'trip' ? {
                      round_trip_miles: r.roundTripMiles ?? 10,
                      average_speed_mph: r.averageSpeedMph ?? 25,
                      truck_capacity: r.truckCapacity ?? 16,
                    } : {}),
                  }, r.id); }}>
                  <option value="hours">hours</option>
                  <option value="trip">trip-based</option>
                </select>
              </div>
              <Num label="Trucks" value={r.quantity || null} disabled={!editable} width="w-16"
                onCommit={(v) => { void onSave('trucking', { quantity: v ?? 1 }, r.id); }} />
              <Num label="Rate/hr" value={r.unitRate || null} disabled={!editable} width="w-24"
                onCommit={(v) => { void onSave('trucking', { unit_rate: v ?? 0 }, r.id); }} />
              {!trip ? (
                <Num label="Hours" value={r.hours || null} disabled={!editable} width="w-20"
                  onCommit={(v) => { void onSave('trucking', { hours: v ?? 0 }, r.id); }} />
              ) : null}
              <label className="flex items-center gap-1.5 pb-2 text-xs text-charcoal-600">
                <input type="checkbox" checked={r.includesDisposal} disabled={!editable}
                  aria-label="Includes disposal"
                  onChange={(e) => {
                    void onSave('trucking', { includes_disposal: e.target.checked }, r.id);
                  }} />
                disposal
              </label>
              <span className="tabular ml-auto pb-2 font-medium"><Cost value={r.extendedCost} /></span>
              {editable ? (
                <Button variant="ghost" size="icon" className="mb-1 size-7"
                  aria-label={`Remove ${r.description ?? 'this truck'}`}
                  onClick={() => onRemove(r.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </div>

            {trip ? (
              <>
                <div className="mt-2 flex flex-wrap items-end gap-3 border-t border-charcoal-100 pt-2">
                  <Num label="Round-trip miles" value={r.roundTripMiles} disabled={!editable}
                    width="w-28"
                    onCommit={(v) => { void onSave('trucking', { round_trip_miles: v }, r.id); }} />
                  <Num label="Speed (mph)" value={r.averageSpeedMph} disabled={!editable}
                    width="w-24"
                    onCommit={(v) => { void onSave('trucking', { average_speed_mph: v }, r.id); }} />
                  <Num label="Truck cap" value={r.truckCapacity} disabled={!editable} width="w-24"
                    onCommit={(v) => { void onSave('trucking', { truck_capacity: v }, r.id); }} />
                  <Num label="Tons/load" value={r.tonsPerLoad} disabled={!editable} width="w-24"
                    onCommit={(v) => { void onSave('trucking', { tons_per_load: v }, r.id); }} />
                  <Num label="Load (min)" value={r.loadMinutes} disabled={!editable} width="w-24"
                    onCommit={(v) => { void onSave('trucking', { load_minutes: v }, r.id); }} />
                  <Num label="Dump (min)" value={r.dumpMinutes} disabled={!editable} width="w-24"
                    onCommit={(v) => { void onSave('trucking', { dump_minutes: v }, r.id); }} />
                  <Num label="Queue (min)" value={r.queueMinutes} disabled={!editable} width="w-24"
                    onCommit={(v) => { void onSave('trucking', { queue_minutes: v }, r.id); }} />
                </div>
                <p className="mt-1.5 text-xs text-charcoal-500">
                  {cycle != null
                    ? `Cycle: ${qty(cycle, 1)} min — the route you entered, added up. The trips, `
                      + 'the fleet size and the cost come from the engine, which sizes the trucks '
                      + 'from what the loader can actually load.'
                    : 'Give it a distance, a speed and a capacity and the cycle follows.'}
                </p>
              </>
            ) : null}
          </div>
        );
      })}
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <AddRow label="Add hauling" disabled={busy}
            onAdd={() => {
              void onSave('trucking', { description: '', haul_mode: 'hours', quantity: 1 });
            }} />
          <FromLibrary kind="trucking" disabled={busy} label="From a haul profile"
            onPick={(f) => { void onSave('trucking', { quantity: 1, ...f }); }} />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------- subs
function SubTab({ rows, editable, busy, onSave, onRemove }: {
  rows: LineResource[]; editable: boolean; busy: boolean;
  onSave: SaveFn; onRemove: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {rows.length === 0 ? <Empty what="add work somebody else is doing." /> : null}
      {rows.map((r) => (
        <div key={r.id}
          className="flex flex-wrap items-end gap-3 rounded-md border border-charcoal-200 bg-white p-3">
          <Text label="Scope" value={r.description} disabled={!editable}
            width="min-w-48 flex-1" placeholder="Seeding and erosion control"
            onCommit={(v) => { void onSave('subcontract', { description: v }, r.id); }} />
          <Num label="Quoted" value={r.unitRate || null} disabled={!editable} width="w-28"
            onCommit={(v) => { void onSave('subcontract', { unit_rate: v ?? 0 }, r.id); }} />
          <span className="tabular ml-auto pb-2 font-medium"><Cost value={r.extendedCost} /></span>
          {editable ? (
            <Button variant="ghost" size="icon" className="mb-1 size-7"
              aria-label={`Remove ${r.description ?? 'this subcontract'}`}
              onClick={() => onRemove(r.id)}>
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ))}
      {editable ? (
        <AddRow label="Add subcontract" disabled={busy}
          onAdd={() => {
            void onSave('subcontract', { description: '', unit_rate: 0, quantity: 1 });
          }} />
      ) : null}
      <p className="text-xs text-charcoal-500">
        A subcontract is a price rather than a build-up, so the engine takes it as direct cost and
        does not resolve resources behind it.
      </p>
    </div>
  );
}

// ------------------------------------------------------------- line settings
/**
 * A fraction shown as a percentage.
 *
 * Rounded because floating point makes 0.3 into 30.000000000000004, and an
 * estimator opening a line they set to thirty percent should see thirty.
 */
const asPercent = (v: number | null): number | null =>
  v === null ? null : Math.round(v * 1e6) / 1e4;

function LineSettings({ line, onSaved }: { line: LineRow; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const set = async (fields: Record<string, unknown>) => {
    if (!supabase) return;
    setError(null);
    try { await updateLine(supabase, line.id, fields); onSaved(); }
    catch (err) { setError(messageFor(err)); }
  };

  return (
    <div className="flex flex-wrap items-end gap-4 border-t border-charcoal-200 pt-3">
      {/*
        * The way to a quantity. Takeoff could apply a measurement to a line
        * from the moment it was built; nothing went the other way, so an
        * estimator looking at an empty quantity had to leave the estimate,
        * find the drawing, trace it, and then hunt for the line again in a
        * dropdown. The line travels with them now.
        */}
      <Button variant="outline" size="sm" className="mb-1" asChild>
        <Link to={`/app/takeoff?line=${line.id}`}>
          <Ruler className="size-4" /> Measure on a drawing
        </Link>
      </Button>
      <label className="flex items-center gap-2 pb-2 text-sm text-charcoal-700">
        <input type="checkbox" checked={line.clientVisible}
          aria-label="Show this line to the customer"
          onChange={(e) => { void set({ client_visible: e.target.checked }); }} />
        Show on the proposal
      </label>
      <Num label="Markup %" value={asPercent(line.markupOverride)}
        width="w-24" placeholder="profile"
        onCommit={(v) => { void set({ markup_override: v === null ? null : v / 100 }); }} />
      <Num label="Waste %" value={line.wastePercent ? asPercent(line.wastePercent) : null}
        width="w-24"
        onCommit={(v) => { void set({ waste_percent: (v ?? 0) / 100 }); }} />
      <Num label="Condition" value={line.productionModifier} width="w-24"
        onCommit={(v) => { void set({ production_modifier: v ?? 1 }); }} />
      <p className="pb-2 text-xs text-charcoal-500">
        A blank markup uses the pricing profile. A hidden line is still priced and still counted
        internally; it is left off the document.
      </p>
      {error ? <ErrorState message={error} /> : null}
    </div>
  );
}
