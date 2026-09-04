/**
 * PGlite-backed migration harness.
 *
 * PGlite is PostgreSQL 18 compiled to WASM — the same planner, the same RLS
 * implementation, the same constraint semantics. Running the production
 * migrations here proves the SQL is valid and the policies actually isolate
 * tenants, without needing Docker or a hosted project.
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(HERE, '..', '..', 'supabase', 'migrations');
export const SEED_DIR = join(HERE, '..', '..', 'supabase', 'seed');

export interface Harness {
  db: PGlite;
  /** Run as a specific authenticated user (sets auth.uid() and the DB role). */
  asUser<T>(userId: string, fn: () => Promise<T>): Promise<T>;
  /** Run with no JWT at all — the anonymous case. */
  asAnon<T>(fn: () => Promise<T>): Promise<T>;
  /** Run as the privileged service role (used by Edge Functions). */
  asService<T>(fn: () => Promise<T>): Promise<T>;
  sql<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>;
  reset(): Promise<void>;
}

export async function listMigrations(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith('.sql')).sort();
}

export async function createHarness(opts: { seed?: boolean } = {}): Promise<Harness> {
  // The same three extensions the production migration enables. Loading them
  // here is what lets the migrations run byte-identical against PGlite and
  // against a hosted Supabase project.
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });
  await db.exec(await readFile(join(HERE, 'bootstrap.sql'), 'utf8'));

  for (const file of await listMigrations()) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }

  if (opts.seed) {
    for (const file of (await readdir(SEED_DIR)).filter((f) => f.endsWith('.sql')).sort()) {
      const sql = await readFile(join(SEED_DIR, file), 'utf8');
      try {
        await db.exec(sql);
      } catch (err) {
        throw new Error(`Seed ${file} failed: ${(err as Error).message}`);
      }
    }
  }

  const resetSession = async () => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  };

  const asUser = async <T>(userId: string, fn: () => Promise<T>): Promise<T> => {
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`,
    );
    try {
      return await fn();
    } finally {
      await resetSession();
    }
  };

  const asAnon = async <T>(fn: () => Promise<T>): Promise<T> => {
    await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`);
    try {
      return await fn();
    } finally {
      await resetSession();
    }
  };

  const asService = async <T>(fn: () => Promise<T>): Promise<T> => {
    await db.exec(`set role service_role;`);
    try {
      return await fn();
    } finally {
      await resetSession();
    }
  };

  return {
    db,
    asUser,
    asAnon,
    asService,
    sql: async <T>(query: string, params: unknown[] = []) =>
      (await db.query<T>(query, params)).rows,
    reset: resetSession,
  };
}
