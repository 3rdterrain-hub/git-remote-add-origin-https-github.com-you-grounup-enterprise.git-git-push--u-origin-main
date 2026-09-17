/**
 * What the search bar is allowed to answer with.
 *
 * This module used to fall through to the demonstration fixtures whenever the
 * remote call failed, with a comment explaining that an empty dropdown looks
 * like "nothing matched". Right about the symptom, wrong about the cure: a
 * signed-in person searching their own workspace could be shown seven invented
 * estimates, five invented projects and a fleet of machines that do not exist,
 * presented as their records, with nothing on screen saying so.
 *
 * `lib/data/query.ts` states the rule for every other reader on this platform —
 * live, demonstration, or a visible error, and never a silent substitution.
 * These tests hold this file to it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  configured: true,
  rows: [] as Record<string, unknown>[],
  error: null as { message: string } | null,
  calls: [] as { query: string; limit: number }[],
}));

vi.mock('./supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() {
    return hoisted.configured
      ? {
        rpc: async (_fn: string, args: { p_query: string; p_limit: number }) => {
          hoisted.calls.push({ query: args.p_query, limit: args.p_limit });
          return { data: hoisted.rows, error: hoisted.error };
        },
      }
      : null;
  },
}));

const { search } = await import('./search');

beforeEach(() => {
  hoisted.configured = true;
  hoisted.error = null;
  hoisted.calls = [];
  hoisted.rows = [{
    kind: 'estimate', id: 'e-1', title: 'E-2026-0005 — Auburn Ave',
    subtitle: 'Auburn Partners', path: '/app/estimates/e-1',
  }];
});

describe('a configured workspace', () => {
  it('answers from the records, not the fixtures', async () => {
    const hits = await search('Auburn');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.title).toBe('E-2026-0005 — Auburn Ave');
    expect(hoisted.calls).toEqual([{ query: 'Auburn', limit: 12 }]);
  });

  it('raises when the search fails, rather than answering with invented rows', async () => {
    /*
     * The defect this file existed with: `Ridgeline Excavating`, `Maumee
     * Commerce Park` and the rest are fixture names. If any of them can reach a
     * signed-in person's dropdown, the silent fallback is back.
     */
    hoisted.error = { message: 'permission denied for function search' };
    await expect(search('Maumee')).rejects.toThrow(/permission denied/);
  });

  it('returns nothing when nothing matched, and nothing is not a fixture', async () => {
    hoisted.rows = [];
    await expect(search('Maumee')).resolves.toEqual([]);
  });

  it('drops a malformed row instead of crashing the dropdown', async () => {
    hoisted.rows = [
      { kind: 'estimate', id: '', title: 'No id' },
      { kind: 'project', id: 'p-1', title: '' },
      { kind: 'project', id: 'p-2', title: 'Kept' },
    ];
    const hits = await search('xx');
    expect(hits.map((h) => h.title)).toEqual(['Kept']);
  });

  it('asks for nothing until there are two characters to ask about', async () => {
    expect(await search('a')).toEqual([]);
    expect(await search(' ')).toEqual([]);
    expect(hoisted.calls).toEqual([]);
  });
});

describe('no workspace configured', () => {
  it('searches the demonstration dataset, which is what it is for', async () => {
    hoisted.configured = false;
    const hits = await search('Maumee');
    expect(hits.length).toBeGreaterThan(0);
    expect(hoisted.calls).toEqual([]);
  });

  it('still finds a word inside a name rather than only a prefix', async () => {
    /* The demonstration path has always matched on substring; the live one did
       not until 0214, and the two should behave the same way. */
    hoisted.configured = false;
    const hits = await search('Commerce');
    expect(hits.length).toBeGreaterThan(0);
  });
});
