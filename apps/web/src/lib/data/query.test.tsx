/**
 * Reading governed data, and never quietly inventing it.
 *
 * Twenty-two of the twenty-three application screens computed from fixtures and
 * the one that touched Supabase only *called* a function — no screen read a
 * record. The risk in fixing that is not that a query fails; it is that a
 * failure gets papered over with sample numbers and a signed-in user reads
 * invented figures as their own.
 *
 * The last test in this file is the one that matters.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const hoisted = vi.hoisted(() => ({ configured: true, client: {} as unknown }));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? hoisted.client : null; },
}));

const { useQuery, messageFor, unwrap } = await import('./query');

describe('useQuery', () => {
  beforeEach(() => { hoisted.configured = true; });
  afterEach(() => vi.restoreAllMocks());

  it('reports demonstration when there is no project to read from', async () => {
    hoisted.configured = false;
    const query = vi.fn();
    const { result } = renderHook(() => useQuery(query as never, []));
    expect(result.current.status).toBe('demonstration');
    // And it does not attempt a read it cannot make.
    expect(query).not.toHaveBeenCalled();
  });

  it('loads, then reports what it read', async () => {
    const { result } = renderHook(() => useQuery(async () => [{ id: 'p-1' }], []));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.status === 'ready' && result.current.data).toEqual([{ id: 'p-1' }]);
  });

  it('reports a failure as a failure', async () => {
    const { result } = renderHook(() =>
      useQuery(async () => { throw new Error('relation does not exist'); }, []));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.status === 'error' && result.current.message).toBe('relation does not exist');
  });

  it('says something a person can act on when the network is the problem', async () => {
    expect(messageFor(new Error('Failed to fetch'))).toMatch(/Could not reach the server/);
    expect(messageFor('nonsense')).toMatch(/Something went wrong/);
  });

  it('re-reads on demand', async () => {
    let calls = 0;
    const { result } = renderHook(() => useQuery(async () => ++calls, []));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.status === 'ready' && result.current.data).toBe(2));
  });

  it('discards a result that arrives after its inputs changed', async () => {
    /*
     * The stale-write bug this shape exists to prevent: a slow first query
     * resolving after a second one has already answered would otherwise
     * overwrite the current view with the previous project's numbers.
     */
    const resolvers: Array<(v: number) => void> = [];
    const query = () => new Promise<number>((res) => resolvers.push(res));
    const { result, rerender } = renderHook(({ id }) => useQuery(query, [id]), {
      initialProps: { id: 'a' },
    });
    rerender({ id: 'b' });
    await waitFor(() => expect(resolvers).toHaveLength(2));

    resolvers[1]!(2);                       // the current query answers
    await waitFor(() => expect(result.current.status === 'ready' && result.current.data).toBe(2));
    resolvers[0]!(1);                       // the stale one answers late
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.status === 'ready' && result.current.data).toBe(2);
  });

  it('surfaces what PostgREST reported rather than swallowing it', () => {
    expect(() => unwrap({ data: null, error: { message: 'permission denied' } }))
      .toThrow('permission denied');
    expect(unwrap({ data: [1, 2], error: null })).toEqual([1, 2]);
    // A read that matched nothing is an empty list, not a failure — row level
    // security filters rather than refuses.
    expect(unwrap({ data: null, error: null })).toEqual([]);
  });

  it('never falls back to sample data when a live read fails', async () => {
    /*
     * The one behavior that would make all of this worse than leaving the
     * fixtures in place. A signed-in user whose query failed must see an error,
     * not somebody else's invented project.
     */
    const { result } = renderHook(() =>
      useQuery(async () => { throw new Error('boom'); }, []));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.status).not.toBe('demonstration');
    expect(result.current).not.toHaveProperty('data');
  });
});
