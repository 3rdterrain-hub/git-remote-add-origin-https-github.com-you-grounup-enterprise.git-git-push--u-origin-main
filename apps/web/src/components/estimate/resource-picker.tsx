/**
 * Finding a crew, a machine, a material or a sub, by typing.
 *
 * "Add crew member" dropped a blank row and left the estimator to type the
 * classification, the burdened rate and the hours from memory — with 44 labor
 * classifications, 240 machines and however many materials sitting in the
 * library one table away. It was a button that made work rather than saving it.
 *
 * Now it searches. Type two letters, pick the row, and the line takes the
 * library's name, its rate and its unit.
 *
 * Three things it is careful about.
 *
 * **A library row with no rate says so.** A machine from the resource catalog
 * has no rate at all, and a material nobody has costed reads as `not_costed`
 * rather than free. Both come through as "no rate yet" instead of a zero that
 * looks like a price — a resource priced at nothing still lets the line total,
 * which is the quietest way for a bid to be wrong.
 *
 * **Nothing is forced through it.** The blank row stays: somebody adding a
 * machine the library has never heard of should not have to put it in the
 * library first, mid-bid, to price a job today.
 *
 * **The rate is a starting point, not a lock.** What lands on the line is
 * editable the moment it arrives, because the library's number is the
 * company's usual and this job may not be usual.
 *
 * Two things were still missing and are here now.
 *
 * **Hauling had no typed search.** "Add hauling" dropped a blank row and the
 * dialog was the only way to reach a haul profile — the one tab still doing
 * what every other tab stopped doing in 0108.
 *
 * **A row already on the line could not be repointed.** Its name was a plain
 * text box, so renaming "Crushed stone" to "Pit run" left `material_id`
 * pointing at crushed stone — and `capture_library_snapshot` reads that link to
 * record what priced the version, so the audit trail and the line disagreed.
 * `ResourceName` is the identity of an existing row: it searches like the add
 * control, and a name typed by hand clears the link rather than leaving a stale
 * one. Migration 0151 is what makes the second half of that possible; before
 * it, the update path ignored all six library links.
 *
 * This sits beside `from-library.tsx` rather than replacing it, and the two do
 * different jobs. That dialog loads the library once and filters it in the
 * browser, which is right for browsing a fleet of forty and wrong for typing
 * against two thousand materials; these searches ask the server and take
 * twenty-five. Somebody who knows the name types it; somebody looking for a
 * crew preset or a haul profile still opens the dialog.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Pencil, Plus, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useQuery } from '@/lib/data/query';
import {
  searchLaborRates, searchEquipment, searchMaterials, searchVendors, searchTruckingRates,
  type LibraryPick,
} from '@/lib/data/estimates';
import { money } from '@/lib/format';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type PickKind = 'labor' | 'equipment' | 'material' | 'subcontract' | 'trucking';

const SEARCH = {
  labor: searchLaborRates,
  equipment: searchEquipment,
  material: searchMaterials,
  subcontract: searchVendors,
  trucking: searchTruckingRates,
} as const;

const PLACEHOLDER: Record<PickKind, string> = {
  labor: 'Type a classification — operator, laborer, foreman',
  equipment: 'Type a machine — excavator, roller, lift',
  material: 'Type a material — stone, pipe, cement',
  subcontract: 'Type a subcontractor',
  trucking: 'Type a truck — tandem, quad, tri-axle',
};

/**
 * The column each kind links through.
 *
 * Sending one as null removes the link, which migration 0151 made expressible
 * and which is the whole point of typing a name the library does not have.
 */
const LINK: Record<PickKind, keyof PickedResource> = {
  labor: 'labor_rate_id',
  equipment: 'equipment_id',
  material: 'material_id',
  subcontract: 'vendor_id',
  trucking: 'trucking_rate_id',
};

/** What the picked row becomes on the line. */
export interface PickedResource {
  description: string;
  unit_rate?: number;
  unit?: string;
  base_rate?: number;
  labor_rate_id?: string;
  equipment_id?: string;
  material_id?: string;
  vendor_id?: string;
  trucking_rate_id?: string;
  /** A haul profile brings its own cycle; `extra` on the pick carries them. */
  [field: string]: string | number | undefined;
}

function asFields(kind: PickKind, p: LibraryPick): PickedResource {
  const base: PickedResource = { description: p.name };
  if (p.rate !== null && !p.unpriced) base.unit_rate = p.rate;
  if (p.unit) base.unit = p.unit;
  switch (kind) {
    case 'labor':
      base.labor_rate_id = p.id;
      /* The line reads base_rate for a crew row; the burdened figure is the one
         that costs the job, and it is what the search returns. */
      if (p.rate !== null) base.base_rate = p.rate;
      return base;
    case 'equipment': base.equipment_id = p.id; return base;
    case 'material': base.material_id = p.id; return base;
    case 'subcontract': base.vendor_id = p.id; return base;
    case 'trucking':
      base.trucking_rate_id = p.id;
      /*
       * The truck's own properties, not the job's. Capacity and the load, dump
       * and queue times belong to the machine and come with it; the route —
       * how far and to where — is the job's and is never overwritten by
       * choosing a different truck.
       */
      return { ...base, ...(p.extra ?? {}) };
  }
}

/**
 * The search box and its list, shared by adding a row and renaming one.
 *
 * One implementation because the two controls have to behave identically —
 * an estimator who learns the arrow keys on "Add material" should not find
 * them missing when they click the name of a material already on the line.
 */
function Combobox({
  kind, seed, ariaLabel, disabled, onChoose, onFreeText, onCancel, footer,
}: {
  kind: PickKind;
  /** What the box starts with. Empty when adding, the current name when renaming. */
  seed: string;
  ariaLabel: string;
  disabled?: boolean;
  onChoose: (p: LibraryPick) => void;
  /** A name the library does not have. Null where free text is not offered. */
  onFreeText: ((text: string) => void) | null;
  onCancel: () => void;
  footer: React.ReactNode;
}) {
  const [term, setTerm] = useState(seed);
  const [cursor, setCursor] = useState(-1);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => { field.current?.focus(); field.current?.select(); }, []);

  /*
   * Seeded with the current name, the first search would be for that name and
   * would return the row it already is. An untouched box searches the whole
   * list instead, which is what somebody who opened it to change something
   * wants to see.
   */
  const touched = term !== seed;
  const results = useQuery(SEARCH[kind](touched ? term : ''), [kind, touched, term]);
  const rows = results.status === 'ready' ? results.data : [];
  const showing = rows.length > 0;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showing && cursor >= 0) { onChoose(rows[cursor]!); return; }
      if (onFreeText && term.trim() && term !== seed) onFreeText(term.trim());
      return;
    }
    if (!showing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, -1)); }
  };

  return (
    <div className="relative">
      <Input
        ref={field}
        value={term}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={showing}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        placeholder={PLACEHOLDER[kind]}
        className="h-8"
        onChange={(e) => { setTerm(e.target.value); setCursor(-1); }}
        onKeyDown={onKeyDown} />

      {showing ? (
        <div role="listbox" aria-label={`Matching ${kind}`}
          className="absolute left-0 right-0 top-9 z-30 max-h-60 overflow-y-auto rounded-md
                     border border-charcoal-200 bg-white shadow-lg">
          {rows.map((p, i) => (
            <button key={p.id} type="button" role="option" aria-selected={i === cursor}
              onMouseEnter={() => setCursor(i)}
              onClick={() => onChoose(p)}
              className={cn(
                'flex w-full items-center justify-between gap-3 border-b border-charcoal-100',
                'px-3 py-1.5 text-left last:border-0',
                i === cursor ? 'bg-yellow-50' : 'hover:bg-charcoal-50')}>
              <span className="min-w-0">
                <span className="block truncate text-sm text-charcoal-900">{p.name}</span>
                <span className="block truncate text-xs text-charcoal-500">
                  {[p.code, p.detail].filter(Boolean).join(' · ')}
                </span>
              </span>
              {/*
                * What it costs, or that nobody knows. A zero here would read as
                * free, which is the one thing it must not say.
                */}
              {p.unpriced ? (
                <Badge variant="warn" className="shrink-0">no rate yet</Badge>
              ) : (
                <span className="shrink-0 text-xs tabular text-charcoal-700">
                  {money(p.rate ?? 0)}{p.unit ? `/${p.unit}` : ''}
                </span>
              )}
              {p.isOwn ? <Badge variant="info" className="shrink-0">yours</Badge> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-charcoal-500">
        {footer}
      </div>
    </div>
  );
}

/**
 * What an existing row *is*, and how to change it.
 *
 * This replaces a plain text box, and the difference is not cosmetic. The box
 * wrote `description` and nothing else, so a row renamed by hand went on
 * pointing at the library record it used to be — and that link is what
 * `capture_library_snapshot` records as the thing that priced the version.
 *
 * So: pick a library row and the link moves with the name; type a name the
 * library does not have and the link is removed, because the row is no longer
 * that record and a stale link is the same lie in the other direction. Typing
 * is still allowed — a bid today should not wait on a library entry.
 */
export function ResourceName({
  kind, value, linked, label, disabled, onChange, width = 'min-w-48 flex-1', hideLabel,
}: {
  kind: PickKind;
  value: string | null;
  /** Whether the row still points at a library record. */
  linked: boolean;
  /** "Material", "Truck", "Machine". Always the accessible name; see hideLabel. */
  label: string;
  /** In a table the column header is the label, so the visible one would repeat it. */
  hideLabel?: boolean;
  disabled?: boolean;
  /** The fields to save. Includes the link, set or cleared. */
  onChange: (fields: PickedResource) => void;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = value ?? '';

  if (!open) {
    return (
      <div className={cn('space-y-1', width)}>
        {hideLabel ? null : <Label className="text-xs text-charcoal-500">{label}</Label>}
        <button
          type="button"
          disabled={disabled}
          aria-label={`${label}: ${current || 'not set'} — click to change it`}
          onClick={() => setOpen(true)}
          className={cn(
            'flex h-8 w-full items-center gap-1.5 rounded-md border border-charcoal-200',
            'bg-white px-2 text-left text-sm text-charcoal-900',
            'hover:border-charcoal-400 disabled:opacity-60 disabled:hover:border-charcoal-200')}>
          <span className={cn('min-w-0 flex-1 truncate', !current && 'text-charcoal-400')}>
            {current || PLACEHOLDER[kind]}
          </span>
          {/*
            * Said where it matters. A row with no library link prices from what
            * is typed on it and nothing else — which is legitimate, and is not
            * the same as a row the library stands behind.
            */}
          {!linked && current ? (
            <Badge variant="outline" className="shrink-0 text-charcoal-500">typed</Badge>
          ) : null}
          {!disabled ? <Pencil className="size-3 shrink-0 text-charcoal-400" /> : null}
        </button>
      </div>
    );
  }

  const close = () => setOpen(false);

  return (
    <div className={cn('space-y-1', width)}>
      {hideLabel ? null : <Label className="text-xs text-charcoal-500">{label}</Label>}
      <Combobox
        kind={kind}
        seed={current}
        ariaLabel={`${label} — type to search the library`}
        disabled={disabled}
        onChoose={(p) => { onChange(asFields(kind, p)); close(); }}
        onFreeText={(text) => {
          /*
           * The link goes with the name. Null rather than omitted: migration
           * 0151 reads these six by key presence precisely so that removing one
           * can be said at all.
           */
          onChange({ description: text, [LINK[kind]]: null } as unknown as PickedResource);
          close();
        }}
        onCancel={close}
        footer={
          <>
            <span>Pick one, or type a name of your own. Escape cancels.</span>
            {linked ? (
              <button type="button"
                onClick={() => {
                  onChange({ [LINK[kind]]: null } as unknown as PickedResource);
                  close();
                }}
                className="underline hover:text-charcoal-800">
                Unlink from the library, keep the name
              </button>
            ) : null}
          </>
        } />
    </div>
  );
}

export function ResourcePicker({ kind, label, disabled, onPick, onBlank }: {
  kind: PickKind;
  /** What the blank-row button says, kept from before so nothing moves. */
  label: string;
  disabled?: boolean;
  onPick: (fields: PickedResource) => void;
  /** Still offered: the library does not have everything, and today's bid is today's. */
  onBlank: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
          <Search className="size-4" /> {label} from the library
        </Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={onBlank}>
          <Plus className="size-4" /> Blank row
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <Combobox
        kind={kind}
        seed=""
        ariaLabel={`${label} from the library`}
        disabled={disabled}
        onChoose={(p) => {
          /*
           * A haul profile brings its cycle, and a row being created from one
           * is priced by the trip — which is what the profile is for. An
           * existing row keeps however it was already priced, which is why this
           * is here rather than in `asFields`.
           */
          onPick(kind === 'trucking'
            ? { haul_mode: 'trip', ...asFields(kind, p) }
            : asFields(kind, p));
          setOpen(false);
        }}
        onFreeText={null}
        onCancel={() => setOpen(false)}
        footer={
          <>
            <span>Type to search. Escape closes it.</span>
            <button type="button" onClick={() => { setOpen(false); onBlank(); }}
              className="underline hover:text-charcoal-800">
              Not in the library — add a blank row
            </button>
          </>
        } />
    </div>
  );
}
