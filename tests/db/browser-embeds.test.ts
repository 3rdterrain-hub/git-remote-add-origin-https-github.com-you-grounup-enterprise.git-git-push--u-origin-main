/**
 * Every embed a screen asks PostgREST for has to be one PostgREST can resolve.
 *
 * This file exists because of a bug the whole test suite missed twice.
 *
 * `estimate_versions` and `estimates` reference each other — a version belongs
 * to an estimate, and an estimate points at its current version. PostgREST sees
 * two relationships and refuses to guess, so
 *
 *     .from('estimate_versions').select('..., estimates(number, name)')
 *
 * returns *"Could not embed because more than one relationship was found"* and
 * the estimate workspace renders an error instead of an estimate. Three
 * thousand passing tests said nothing, because every one of them mocks the
 * loader — the query string never reaches a database in any of them. The same
 * shape of miss produced the `notifications.read_at` defect earlier in this
 * build.
 *
 * So the query strings are read out of the data layer as text and checked
 * against the real schema:
 *
 *   * every table and view a screen selects from exists;
 *   * every embed names a real relationship;
 *   * an embed between two tables with more than one relationship carries the
 *     `!constraint` hint that says which — and that constraint exists.
 *
 * It runs against PGlite with the production migrations applied, so what it
 * checks is the schema that ships, not a description of it.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness, type Harness } from './harness.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '..', '..', 'apps', 'web', 'src', 'lib', 'data');

/** One embed asked for inside a select, with the relation it hangs off. */
interface Embed {
  file: string;
  parent: string;
  target: string;
  /** The `!name` disambiguation, when the query supplies one. */
  hint: string | null;
}

interface Selection {
  file: string;
  from: string;
  select: string;
}

/**
 * Pull `.from('x')...select('...')` pairs out of a module's text.
 *
 * Deliberately textual. The point is to read what the browser will actually
 * send, and the only place that string exists is in the source.
 */
function selections(file: string, source: string): Selection[] {
  const out: Selection[] = [];
  const re = /\.from\(\s*'([a-z0-9_]+)'\s*\)([\s\S]{0,4000}?)\.select\(\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    // A second `.from(` between the two would mean these are different queries.
    if (m[2]!.includes('.from(')) continue;
    out.push({ file, from: m[1]!, select: m[3]! });
  }
  return out;
}

/**
 * Walk a select string and return every embed in it, with its parent relation.
 *
 * PostgREST nests: `estimates(number, customers(name))` embeds `customers` on
 * `estimates`, not on the table the select started from.
 */
function embeds(file: string, from: string, select: string): Embed[] {
  const out: Embed[] = [];
  const stack: string[] = [from];
  let token = '';
  for (const ch of select) {
    if (ch === '(') {
      const name = token.trim().split(',').pop()!.trim();
      const [target, marker] = name.split('!');
      /*
       * `!inner` and `!left` say how to join, not which key to join on. Reading
       * them as a constraint name would report every inner join as naming a
       * constraint that does not exist.
       */
      const hint = marker && marker !== 'inner' && marker !== 'left' ? marker : null;
      if (target) {
        out.push({ file, parent: stack[stack.length - 1]!, target, hint });
        stack.push(target);
      }
      token = '';
    } else if (ch === ')') {
      if (stack.length > 1) stack.pop();
      token = '';
    } else {
      token += ch;
    }
  }
  return out;
}

describe('what a screen asks PostgREST for', () => {
  let h: Harness;
  let selects: Selection[] = [];
  let allEmbeds: Embed[] = [];
  /** Every table and view a query may name. */
  let relations = new Set<string>();
  /*
   * Base tables only. A view holds no foreign keys of its own — PostgREST works
   * its relationships out from the tables underneath it — so a view embed
   * cannot be judged by the constraint catalog and is not judged here.
   */
  let tables = new Set<string>();
  /** `child->parent` -> constraint names, both directions of each key. */
  let links = new Map<string, string[]>();

  beforeAll(async () => {
    h = await createHarness();

    for (const name of (await readdir(DATA_DIR)).filter((f) => f.endsWith('.ts'))) {
      if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue;
      const source = await readFile(join(DATA_DIR, name), 'utf8');
      selects.push(...selections(name, source));
    }
    allEmbeds = selects.flatMap((s) => embeds(s.file, s.from, s.select));

    const rels = await h.sql<{ name: string }>(
      `select table_name as name from information_schema.tables where table_schema = 'public'
       union
       select table_name from information_schema.views where table_schema = 'public'`);
    relations = new Set(rels.map((r) => r.name));

    const base = await h.sql<{ name: string }>(
      `select table_name as name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`);
    tables = new Set(base.map((r) => r.name));

    /*
     * Both directions, because PostgREST embeds either way across one key: a
     * version can embed its estimate, and an estimate can embed its versions.
     */
    const fks = await h.sql<{ child: string; parent: string; conname: string }>(
      `select c.conrelid::regclass::text as child,
              c.confrelid::regclass::text as parent,
              c.conname
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where c.contype = 'f' and n.nspname = 'public'`);
    for (const fk of fks) {
      for (const key of [`${fk.child}->${fk.parent}`, `${fk.parent}->${fk.child}`]) {
        links.set(key, [...(links.get(key) ?? []), fk.conname]);
      }
    }
  }, 240_000);

  afterAll(async () => { await h?.db.close(); });

  it('reads the queries the browser actually sends', () => {
    // A parser that found nothing would make every test below vacuous.
    expect(selects.length).toBeGreaterThan(30);
    expect(allEmbeds.length).toBeGreaterThan(10);
  });

  it('selects only from tables and views that exist', () => {
    const missing = selects
      .filter((s) => !relations.has(s.from))
      .map((s) => `${s.file}: from('${s.from}')`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('embeds only relations that exist', () => {
    const missing = allEmbeds
      .filter((e) => !relations.has(e.target))
      .map((e) => `${e.file}: ${e.parent} embeds ${e.target}`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('names which relationship it means wherever there is more than one', () => {
    /*
     * The failure this file was written for. Two foreign keys between the same
     * pair of tables and no hint is an error the browser sees and no test did.
     */
    const ambiguous = allEmbeds
      .filter((e) => e.hint == null)
      .filter((e) => (links.get(`${e.parent}->${e.target}`) ?? []).length > 1)
      .map((e) => `${e.file}: ${e.parent} embeds ${e.target} without saying which key`);
    expect([...new Set(ambiguous)]).toEqual([]);
  });

  it('embeds only where a relationship exists at all', () => {
    const unrelated = allEmbeds
      .filter((e) => tables.has(e.target) && tables.has(e.parent))
      .filter((e) => (links.get(`${e.parent}->${e.target}`) ?? []).length === 0)
      .map((e) => `${e.file}: ${e.parent} has no relationship to ${e.target}`);
    expect([...new Set(unrelated)]).toEqual([]);
  });

  it('names a constraint that exists when it names one', () => {
    const wrong = allEmbeds
      .filter((e) => e.hint != null)
      .filter((e) => !(links.get(`${e.parent}->${e.target}`) ?? []).includes(e.hint!))
      .map((e) => `${e.file}: ${e.parent} embeds ${e.target} via ${e.hint}, which is not a constraint on either`);
    expect([...new Set(wrong)]).toEqual([]);
  });

  it('holds the estimate workspace to it, since that is where this came from', () => {
    const pair = allEmbeds.find((e) =>
      e.parent === 'estimate_versions' && e.target === 'estimates');
    expect(pair).toBeDefined();
    expect((links.get('estimate_versions->estimates') ?? []).length).toBeGreaterThan(1);
    expect(pair!.hint).toBe('estimate_versions_estimate_id_fkey');
  });
});
