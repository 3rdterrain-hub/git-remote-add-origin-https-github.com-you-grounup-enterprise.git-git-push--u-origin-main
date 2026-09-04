/**
 * Reading governed data in the browser.
 *
 * Until now no screen in this application read a record. Twenty-two of the
 * twenty-three application screens computed from fixtures in `src/data`, and
 * the one that touched Supabase — Billing — only *called* an Edge Function.
 * That was defensible while there was no project to read from, and it stopped
 * being defensible the moment one is configured: a signed-in user looking at
 * their own workspace would see invented numbers presented as theirs.
 *
 * So a screen is in one of two states and always says which:
 *
 *   - **live** — Supabase is configured, the query ran, and what is on screen
 *     came from the caller's own tenant through row level security.
 *   - **demonstration** — Supabase is not configured, so the screen shows the
 *     sample dataset and the shell says so, plainly, on every page.
 *
 * There is deliberately no third state where live data silently falls back to
 * fixtures on error. An error is shown as an error. A screen that quietly
 * substitutes invented numbers when a query fails is the worst thing in this
 * file's problem space, and it is the thing this file exists to prevent.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export type QueryState<T> =
  | { status: 'demonstration' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

/** A query against the governed schema. Tenancy is row level security's job. */
export type Query<T> = (client: NonNullable<typeof supabase>) => Promise<T>;

/**
 * Run a query when the environment has something to query.
 *
 * `deps` behaves like a dependency array: change it and the query re-runs. A
 * result that arrives after the inputs changed, or after the component has
 * gone, is discarded rather than written into a stale view.
 */
export function useQuery<T>(query: Query<T>, deps: readonly unknown[] = []): QueryState<T> & {
  refetch: () => void;
} {
  const [state, setState] = useState<QueryState<T>>(
    isSupabaseConfigured ? { status: 'loading' } : { status: 'demonstration' },
  );
  const [nonce, setNonce] = useState(0);
  const run = useRef(0);

  // The query closure changes identity on every render; the caller's deps are
  // what actually decide when to re-run.
  const stable = useRef(query);
  stable.current = query;

  useEffect(() => {
    if (!supabase) {
      setState({ status: 'demonstration' });
      return;
    }
    const ticket = ++run.current;
    let alive = true;
    setState({ status: 'loading' });

    stable.current(supabase).then(
      (data) => { if (alive && ticket === run.current) setState({ status: 'ready', data }); },
      (err: unknown) => {
        if (!alive || ticket !== run.current) return;
        setState({ status: 'error', message: messageFor(err) });
      },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { ...state, refetch: useCallback(() => setNonce((n) => n + 1), []) };
}

/**
 * What to tell somebody when a read fails.
 *
 * Row level security returns no rows rather than an error, so a permission
 * problem arrives as an empty result and not here. What does arrive here is a
 * network failure or a genuine query error, and neither is the user's fault —
 * so the message says what happened rather than what they did wrong.
 */
export function messageFor(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const raw = String((err as { message: unknown }).message);
    if (/fetch|network|Failed to fetch/i.test(raw)) {
      return 'Could not reach the server. Check the connection and try again.';
    }
    return raw;
  }
  return 'Something went wrong reading this data.';
}

/** Throws whatever PostgREST reported, so `useQuery` can present it. */
export function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as T;
}
