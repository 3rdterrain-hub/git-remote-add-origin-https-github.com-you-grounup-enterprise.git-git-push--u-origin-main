/**
 * Everything under the line has a name.
 *
 * The build-up panel is forty-odd fields in five tables, and almost none of
 * them had an accessible name. They sat under column headers, which is enough
 * for somebody looking at the screen and nothing at all for somebody who is
 * not: a screen reader announced "edit box", forty times, with no way to tell
 * the burden rate from the base rate from the hours.
 *
 * A column header is not an accessible name. This holds every control in the
 * panel to having one, so the next field somebody adds cannot quietly be the
 * forty-first.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderPage } from '@/test/render';
import userEvent from '@testing-library/user-event';
import type { LineResource, LineRow } from '@/lib/data/estimates';

const hoisted = vi.hoisted(() => ({ resources: [] as LineResource[] }));

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));

vi.mock('@/lib/data/estimates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/estimates')>(
    '@/lib/data/estimates');
  return {
    ...actual,
    loadLineResources: () => async () => hoisted.resources,
    loadResourceSuggestions: () => async () => [],
    searchLaborRates: () => async () => [],
    searchEquipment: () => async () => [],
    searchMaterials: () => async () => [],
    searchVendors: () => async () => [],
    saveLineResource: async () => 'r-1',
  };
});

vi.mock('@/lib/data/library', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/library')>('@/lib/data/library');
  return {
    ...actual,
    loadLaborRates: async () => [], loadCrews: async () => [],
    loadEquipmentOptions: async () => [], loadMaterials: async () => [],
    loadTruckingRates: async () => [],
  };
});

const { LineDetail } = await import('./line-detail');

const resource = (over: Partial<LineResource> = {}): LineResource => ({
  id: 'r-1', kind: 'labor', sortOrder: 10, description: 'Excavator Operator',
  role: 'Operator', notes: null, quantity: 1, unit: null, unitRate: 0, hours: 8,
  headcount: 1, baseRate: 40, burdenRate: 15, drivesHours: false,
  productionPerHour: null, rateBasis: 'hour', mobilizationCost: 0, standbyDays: 0,
  minimumHours: null, isOwned: true, haulMode: 'hours', roundTripMiles: null,
  averageSpeedMph: null, truckCapacity: null, capacityUnit: null, tonsPerLoad: null,
  loadMinutes: null, dumpMinutes: null, queueMinutes: null, includesDisposal: false,
  extendedCost: 0, ...over,
} as LineResource);

const line: LineRow = {
  id: 'l-1', sortOrder: 10, lineNumber: null, description: 'Mass excavation',
  serviceId: 's-1', serviceName: 'Mass excavation', costCode: 'CC-0006',
  unit: 'CY', measuredQuantity: 1000, adjustedQuantity: 1000,
  unitCost: 0, totalDirectCost: 0, laborHours: 0, equipmentHours: 0,
  confidenceBand: 'high', blocksIssue: false, hasProductionRate: true,
  clientVisible: true, markupOverride: null, wastePercent: 0,
  quantityExpression: null, productionModifier: 1,
  parametricCostPerUnit: null, parametricBasis: null,
} as LineRow;

/** Every control the panel renders, whatever tab it is on. */
const controls = () => [
  ...screen.queryAllByRole('textbox'),
  ...screen.queryAllByRole('spinbutton'),
  ...screen.queryAllByRole('combobox'),
  ...screen.queryAllByRole('checkbox'),
  ...screen.queryAllByRole('switch'),
];

const nameless = () => controls().filter((el) => {
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return false;
  const id = el.getAttribute('id');
  if (id && document.querySelector(`label[for="${id}"]`)) return false;
  return !el.closest('label');
});

beforeEach(() => { hoisted.resources = [resource()]; });

describe('everything under the line has a name', () => {
  it('names every field on the crew tab', async () => {
    renderPage(<LineDetail line={line} editable onChanged={() => {}} />);
    await screen.findByRole('tab', { name: /Crew/ });
    expect(nameless().map((el) => el.outerHTML.slice(0, 90))).toEqual([]);
  });

  it.each(['Equipment', 'Materials', 'Hauling', 'Subs'])(
    'names every field on the %s tab', async (tab) => {
      hoisted.resources = [resource({
        kind: tab === 'Equipment' ? 'equipment'
          : tab === 'Materials' ? 'material'
          : tab === 'Hauling' ? 'trucking' : 'subcontract',
        description: `A ${tab} row`,
      })];
      renderPage(<LineDetail line={line} editable onChanged={() => {}} />);
      await userEvent.click(await screen.findByRole('tab', { name: new RegExp(tab) }));
      expect(nameless().map((el) => el.outerHTML.slice(0, 90))).toEqual([]);
    });

  it('gives two rows of the same kind different names', async () => {
    /*
     * The reason the name carries the row's description. Two crew rows both
     * announcing "Base rate" is the same problem as announcing nothing.
     */
    hoisted.resources = [
      resource({ id: 'r-1', description: 'Excavator Operator' }),
      resource({ id: 'r-2', description: 'Laborer' }),
    ];
    renderPage(<LineDetail line={line} editable onChanged={() => {}} />);
    await screen.findByRole('tab', { name: /Crew/ });
    const names = controls().map((el) => el.getAttribute('aria-label')).filter(Boolean);
    expect(new Set(names).size).toBe(names.length);
  });
});
