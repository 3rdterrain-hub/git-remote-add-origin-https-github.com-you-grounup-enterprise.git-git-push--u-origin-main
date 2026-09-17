/**
 * The library shows everything it has.
 *
 * Every reader in `library.ts` used to carry a hand-picked ceiling, and the
 * catalog grew past three of them. On the live database that meant the Master
 * Libraries screen was hiding 820 services, 4,532 tasks and 200 machines —
 * silently, because the tile above each list counted rows in the database and
 * the list under it counted what had been fetched. "2,820" over "50 of 2,000".
 *
 * These tests use a client that answers in pages, so a reader that goes back to
 * a single bounded request fails them.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({ ranges: [] as [number, number][] }));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

const { loadServices, loadTasks } = await import('./library');

/** A stand-in PostgREST that holds `total` rows and serves them by range. */
function client(total: number, row: (i: number) => Record<string, unknown>) {
  const builder = {
    select: () => builder,
    order: () => builder,
    eq: () => builder,
    range: (from: number, to: number) => {
      hoisted.ranges.push([from, to]);
      const slice: Record<string, unknown>[] = [];
      for (let i = from; i <= to && i < total; i += 1) slice.push(row(i));
      return Promise.resolve({ data: slice, error: null });
    },
  };
  return { from: () => builder } as never;
}

beforeEach(() => { hoisted.ranges = []; });

describe('reading a catalog bigger than one page', () => {
  it('returns all 2,820 services, not the first 2,000', async () => {
    const rows = await loadServices(client(2820, (i) => ({
      id: `s-${i}`, code: `SVC-${i}`, name: `Service ${i}`,
      default_unit: 'EA', supported_units: ['EA'], pricing_method: 'unit',
      status: 'active', version: '1', company_id: null, enterprise_group_id: null,
    })));
    expect(rows).toHaveLength(2820);
    expect(rows[2819]!.code).toBe('SVC-2819');
  });

  it('returns all 8,532 tasks, not the first 4,000', async () => {
    const rows = await loadTasks(client(8532, (i) => ({
      id: `t-${i}`, code: `TSK-${i}`, name: `Task ${i}`, default_unit: 'HR',
      category: 'Support', status: 'active', company_id: null, enterprise_group_id: null,
    })));
    expect(rows).toHaveLength(8532);
  });

  it('asks for consecutive pages and stops on a short one', async () => {
    await loadServices(client(2820, (i) => ({
      id: `s-${i}`, code: `SVC-${i}`, name: `x`, default_unit: 'EA',
      supported_units: [], pricing_method: 'unit', status: 'active', version: '1',
      company_id: null, enterprise_group_id: null,
    })));
    /* Three pages: 1000, 1000, 820. The short one ends it — no fourth call. */
    expect(hoisted.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('costs one empty request when the last page happens to be full', async () => {
    /* Exactly 2,000 rows cannot be told from "2,000 and more" without asking,
       and asking is the honest price of not guessing a ceiling. */
    await loadServices(client(2000, (i) => ({
      id: `s-${i}`, code: `SVC-${i}`, name: 'x', default_unit: 'EA',
      supported_units: [], pricing_method: 'unit', status: 'active', version: '1',
      company_id: null, enterprise_group_id: null,
    })));
    expect(hoisted.ranges).toHaveLength(3);
  });

  it('handles a catalog that fits in one page without a second request', async () => {
    const rows = await loadServices(client(42, (i) => ({
      id: `s-${i}`, code: `SVC-${i}`, name: 'x', default_unit: 'EA',
      supported_units: [], pricing_method: 'unit', status: 'active', version: '1',
      company_id: null, enterprise_group_id: null,
    })));
    expect(rows).toHaveLength(42);
    expect(hoisted.ranges).toEqual([[0, 999]]);
  });

  it('returns nothing, rather than hanging, on an empty table', async () => {
    const rows = await loadServices(client(0, () => ({})));
    expect(rows).toEqual([]);
    expect(hoisted.ranges).toEqual([[0, 999]]);
  });
});
