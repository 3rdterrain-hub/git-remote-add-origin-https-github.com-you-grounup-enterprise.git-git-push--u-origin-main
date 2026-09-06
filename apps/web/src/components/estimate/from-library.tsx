/**
 * Pulling a rate you already set into the line you are building.
 *
 * A company sets its labor rates, its fleet and its haul profiles once, and
 * until now none of that reached an estimate: every crew member, machine and
 * truck on a line was typed by hand. So a company with a governed rate sheet
 * retyped it on every line, and the rate sheet was decoration.
 *
 * What picking one does is not only convenience. A resource that names a
 * library row carries `labor_rate_id` or `equipment_id`, and the pricing engine
 * then uses the **approved rate under RULE-003** rather than the number in the
 * form — the library wins over what was typed beside it, because an approved
 * rate is not overridden by a value in a field. Picking is therefore how an
 * estimate becomes defensible, not just how it becomes faster.
 */
import { useState } from 'react';
import { Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import {
  loadLaborRates, loadCrews, loadEquipmentOptions, loadMaterials, loadTruckingRates,
  type CrewPreset,
} from '@/lib/data/library';
import { money, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

/** What the caller gets back: the fields to write onto the resource row. */
export type PickedFields = Record<string, unknown>;

export type LibraryKind = 'labor' | 'crew' | 'equipment' | 'material' | 'trucking';

const TITLE: Record<LibraryKind, string> = {
  labor: 'Labor rates', crew: 'Crew presets', equipment: 'Your fleet',
  material: 'Materials', trucking: 'Haul profiles',
};

const BLURB: Record<LibraryKind, string> = {
  labor: 'Picking one prices this row at the approved rate rather than the number typed beside it.',
  crew: 'A saved composition. Every member comes across with their classification and count.',
  equipment: 'Picking one prices this machine at the rate in force under RULE-003.',
  material: 'Unit cost and unit come across with it.',
  trucking: 'A truck profile with its capacity and cycle times already set.',
};

export function FromLibrary({ kind, onPick, onPickCrew, disabled, label }: {
  kind: LibraryKind;
  /** One row picked. Returns the fields to write. */
  onPick?: (fields: PickedFields) => void;
  /** A crew is several rows at once, so it has its own hand-off. */
  onPickCrew?: (members: CrewPreset['members'], preset: CrewPreset) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        <Library className="size-4" /> {label ?? 'From library'}
      </Button>
      {open ? (
        <Picker kind={kind} onClose={() => setOpen(false)}
          {...(onPick ? { onPick } : {})} {...(onPickCrew ? { onPickCrew } : {})} />
      ) : null}
    </>
  );
}

function Picker({ kind, onPick, onPickCrew, onClose }: {
  kind: LibraryKind;
  onPick?: (fields: PickedFields) => void;
  onPickCrew?: (members: CrewPreset['members'], preset: CrewPreset) => void;
  onClose: () => void;
}) {
  const [term, setTerm] = useState('');

  const labor = useQuery(loadLaborRates, [kind]);
  const crews = useQuery(loadCrews, [kind]);
  const equipment = useQuery(loadEquipmentOptions, [kind]);
  const materials = useQuery(loadMaterials, [kind]);
  const trucking = useQuery(loadTruckingRates, [kind]);

  const active = kind === 'labor' ? labor
    : kind === 'crew' ? crews
    : kind === 'equipment' ? equipment
    : kind === 'material' ? materials
    : trucking;

  const q = term.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);

  const take = (fields: PickedFields) => { onPick?.(fields); onClose(); };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{TITLE[kind]}</DialogTitle>
          <DialogDescription>{BLURB[kind]}</DialogDescription>
        </DialogHeader>

        <Input value={term} onChange={(e) => setTerm(e.target.value)}
          placeholder="Search" aria-label={`Search ${TITLE[kind]}`} autoFocus />

        {active.status === 'loading' ? <LoadingState label={`Loading ${TITLE[kind]}`} /> : null}
        {active.status === 'error' ? <ErrorState message={active.message} /> : null}

        <div className="max-h-80 overflow-y-auto rounded-[--radius-card] border border-charcoal-200">
          {kind === 'labor' && labor.status === 'ready' ? (
            <Rows
              rows={labor.data.filter((l) => matches(`${l.classification} ${l.code}`))}
              render={(l) => ({
                key: l.id,
                title: l.classification,
                subtitle: `${l.code}${l.laborGroup ? ` · ${l.laborGroup}` : ''}`
                  + `${l.isUnion ? ' · union' : ''}`,
                right: `${money(l.burdenedCostPerHour)}/hr loaded`,
                scope: l.scope,
                onPick: () => take({
                  labor_rate_id: l.id,
                  description: l.classification,
                  role: l.laborGroup ?? l.classification,
                  base_rate: l.baseWagePerHour,
                  // Burden is stored as a fraction on the library row and
                  // entered as dollars beside the wage on a line, because that
                  // is how it reads on a rate sheet.
                  burden_rate: Math.round(l.baseWagePerHour * l.burdenPercent * 100) / 100,
                }),
              })}
            />
          ) : null}

          {kind === 'crew' && crews.status === 'ready' ? (
            <Rows
              rows={crews.data.filter((c) => matches(`${c.name} ${c.code}`))}
              render={(c) => ({
                key: c.id,
                title: c.name,
                subtitle: c.members.length
                  ? c.members.map((m) => `${m.headcount}x ${m.classification}`).join(', ')
                  : 'No members on this crew',
                right: `${c.members.reduce((a, m) => a + m.headcount, 0)} people`,
                scope: c.scope,
                onPick: () => { onPickCrew?.(c.members, c); onClose(); },
              })}
            />
          ) : null}

          {kind === 'equipment' && equipment.status === 'ready' ? (
            <Rows
              rows={equipment.data.filter((e) => matches(`${e.name} ${e.equipmentClass}`))}
              render={(e) => ({
                key: e.id,
                title: e.name,
                subtitle: titleCase(e.equipmentClass),
                right: e.hourlyRate ? `${money(e.hourlyRate)}/hr`
                  : e.weeklyRate ? `${money(e.weeklyRate)}/wk` : 'no rate on file',
                scope: e.scope,
                onPick: () => take({
                  equipment_id: e.id,
                  description: e.name,
                  role: e.equipmentClass,
                  // The basis it actually carries a rate at. Reading a weekly
                  // machine as hourly would be wrong by a factor of forty.
                  ...(e.hourlyRate > 0
                    ? { rate_basis: 'hour', unit_rate: e.hourlyRate }
                    : e.weeklyRate
                      ? { rate_basis: 'week', unit_rate: e.weeklyRate }
                      : e.dailyRate
                        ? { rate_basis: 'day', unit_rate: e.dailyRate }
                        : { rate_basis: 'hour', unit_rate: 0 }),
                  ...(e.mobilizationCost ? { mobilization_cost: e.mobilizationCost } : {}),
                }),
              })}
            />
          ) : null}

          {kind === 'material' && materials.status === 'ready' ? (
            <Rows
              rows={materials.data.filter((m) => matches(`${m.name} ${m.code}`))}
              render={(m) => ({
                key: m.id,
                title: m.name,
                subtitle: m.code,
                right: `${money(m.unitCost)}/${m.unit}`,
                scope: m.scope,
                onPick: () => take({
                  material_id: m.id, description: m.name,
                  unit: m.unit, unit_rate: m.unitCost,
                }),
              })}
            />
          ) : null}

          {kind === 'trucking' && trucking.status === 'ready' ? (
            <Rows
              rows={trucking.data.filter((t) => matches(`${t.truckType} ${t.code}`))}
              render={(t) => ({
                key: t.id,
                title: t.truckType,
                subtitle: `${t.code} · ${t.capacity} ${t.capacityUnit} · `
                  + `${t.loadMinutes}/${t.dumpMinutes}/${t.delayMinutes} min load, dump, delay`,
                right: `${money(t.hourlyRate)}/hr`,
                // Trucking rates are company records; the shipped catalog has
                // none, so there is nothing to distinguish here.
                scope: 'company',
                onPick: () => take({
                  trucking_rate_id: t.id,
                  description: t.truckType,
                  unit_rate: t.hourlyRate,
                  /*
                   * The whole cycle, not just the capacity. A profile exists
                   * precisely so an estimator does not re-enter load, dump and
                   * queue times on every haul — and the speeds it carries are
                   * loaded and empty separately, which the line holds as one
                   * average because that is the number people know.
                   */
                  haul_mode: 'trip',
                  truck_capacity: t.capacity,
                  load_minutes: t.loadMinutes,
                  dump_minutes: t.dumpMinutes,
                  queue_minutes: t.delayMinutes,
                  average_speed_mph:
                    Math.round(((t.loadedSpeedMph + t.emptySpeedMph) / 2) * 100) / 100,
                }),
              })}
            />
          ) : null}
        </div>

        <p className="text-xs text-charcoal-500">
          A row that names a library record prices at the approved rate under RULE-003, not at
          whatever is typed beside it — so picking is what makes the number defensible, and not
          only what makes it quicker.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function Rows<T>({ rows, render }: {
  rows: readonly T[];
  render: (row: T) => {
    key: string; title: string; subtitle: string; right: string;
    scope: string; onPick: () => void;
  };
}) {
  if (rows.length === 0) {
    return (
      <div className="p-6">
        <EmptyState title="Nothing here yet"
          hint="Add it in Master Libraries and it will be offered here." />
      </div>
    );
  }
  return (
    <ul>
      {rows.map((row) => {
        const r = render(row);
        return (
          <li key={r.key}>
            <button type="button" onClick={r.onPick}
              className={cn('flex w-full items-center justify-between gap-3 border-b',
                'border-charcoal-100 px-3 py-2 text-left last:border-0 hover:bg-charcoal-50')}>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-charcoal-900">
                  {r.title}
                </span>
                <span className="block truncate text-xs text-charcoal-500">{r.subtitle}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tabular text-xs text-charcoal-600">{r.right}</span>
                {/* Whose record it is. A company's own beats the shipped
                    catalog under RULE-003, and an estimator should see which
                    one they are reaching for. */}
                <Badge variant={r.scope === 'company' ? 'info' : 'default'}>
                  {r.scope === 'company' ? 'yours' : 'catalog'}
                </Badge>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
