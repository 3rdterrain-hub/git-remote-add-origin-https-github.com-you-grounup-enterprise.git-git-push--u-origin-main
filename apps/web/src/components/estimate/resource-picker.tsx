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
 * This sits beside `from-library.tsx` rather than replacing it, and the two do
 * different jobs. That dialog loads the library once and filters it in the
 * browser, which is right for browsing a fleet of forty and wrong for typing
 * against two thousand materials; these searches ask the server and take
 * twenty-five. Somebody who knows the name types it; somebody looking for a
 * crew preset or a haul profile still opens the dialog.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Plus, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useQuery } from '@/lib/data/query';
import {
  searchLaborRates, searchEquipment, searchMaterials, searchVendors, type LibraryPick,
} from '@/lib/data/estimates';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';

export type PickKind = 'labor' | 'equipment' | 'material' | 'subcontract';

const SEARCH = {
  labor: searchLaborRates,
  equipment: searchEquipment,
  material: searchMaterials,
  subcontract: searchVendors,
} as const;

const PLACEHOLDER: Record<PickKind, string> = {
  labor: 'Type a classification — operator, laborer, foreman',
  equipment: 'Type a machine — excavator, roller, lift',
  material: 'Type a material — stone, pipe, cement',
  subcontract: 'Type a subcontractor',
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
  }
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
  const [term, setTerm] = useState('');
  const [cursor, setCursor] = useState(-1);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) field.current?.focus(); }, [open]);

  const results = useQuery(SEARCH[kind](open ? term : ''), [kind, open, term]);
  const rows = results.status === 'ready' ? results.data : [];
  const showing = open && rows.length > 0;

  const choose = (p: LibraryPick) => {
    onPick(asFields(kind, p));
    setTerm(''); setCursor(-1); setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setTerm(''); return; }
    if (!showing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, -1)); }
    if (e.key === 'Enter' && cursor >= 0) { e.preventDefault(); choose(rows[cursor]!); }
  };

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
    <div className="relative mt-2">
      <Input
        ref={field}
        value={term}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={showing}
        aria-autocomplete="list"
        aria-label={`${label} from the library`}
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
              onClick={() => choose(p)}
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

      <div className="mt-1 flex items-center gap-2 text-xs text-charcoal-500">
        <span>Type to search. Escape closes it.</span>
        <button type="button" onClick={() => { setOpen(false); onBlank(); }}
          className="underline hover:text-charcoal-800">
          Not in the library — add a blank row
        </button>
      </div>
    </div>
  );
}
