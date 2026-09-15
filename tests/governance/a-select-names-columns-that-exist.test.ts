/**
 * A select names columns that exist.
 *
 * `loadResourceAssignments` asked PostgREST for `assets(code, name)`. The
 * column is `asset_number`, and always has been. PostgREST refuses the *whole*
 * request when one column in it is unknown, so that reader returned nothing
 * from the day it was written — and the screen showed an empty Resource-loading
 * tab, which is exactly what it would show if there were genuinely nobody on
 * the job. `loadMachineFiles` had the same mistake against the same table.
 *
 * Neither was caught by a test, because a component test mocks the loader, and
 * neither was caught by eye, because **an erroring query and an empty one look
 * identical on screen**. They were found by putting the first real row into
 * `resource_assignments` and noticing it did not appear.
 *
 * That is this repository's own defect one layer down: not a door with no
 * reader, but a reader asking for something that is not there. It costs nothing
 * to check, because the schema is in the migrations and the selects are string
 * literals.
 *
 * What is checked: the columns named inside an embedded relation —
 * `table(col, col)` — against that table's columns. Embeds are the risky half,
 * because the table name is right there to be read and the column list is
 * copied from whichever loader was nearest. Top-level column lists are left
 * alone: they are aliased, renamed and computed often enough that a parser
 * would produce more noise than findings.
 *
 * GOVERNANCE.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');

/** Every column on every table and view the migrations create. */
function schemaColumns(): Map<string, Set<string>> {
  const columns = new Map<string, Set<string>>();
  const files = globSync('supabase/migrations/*.sql', { cwd: ROOT }).sort();

  for (const file of files) {
    const sql = readFileSync(join(ROOT, file), 'utf8');

    /* create table <name> ( ... ); */
    for (const m of sql.matchAll(/create table (?:if not exists )?(\w+)\s*\(([\s\S]*?)\n\);/g)) {
      const table = m[1]!;
      const body = m[2]!;
      const set = columns.get(table) ?? new Set<string>();
      for (const line of body.split('\n')) {
        const col = /^\s{2}(\w+)\s+\S/.exec(line);
        /* Table-level constraints start with a keyword, not a column name. */
        if (col && !['constraint', 'unique', 'primary', 'foreign', 'check', 'exclude']
          .includes(col[1]!.toLowerCase())) set.add(col[1]!);
      }
      columns.set(table, set);
    }

    /* alter table <name> add column [if not exists] <col> */
    for (const m of sql.matchAll(/alter table (?:only )?(\w+)([\s\S]*?);/g)) {
      const table = m[1]!;
      const set = columns.get(table);
      if (!set) continue;
      for (const c of m[2]!.matchAll(/add column (?:if not exists )?(\w+)/g)) set.add(c[1]!);
      for (const c of m[2]!.matchAll(/drop column (?:if exists )?(\w+)/g)) set.delete(c[1]!);
      for (const c of m[2]!.matchAll(/rename column (\w+) to (\w+)/g)) {
        set.delete(c[1]!); set.add(c[2]!);
      }
    }

    /*
     * Views: the select list is too varied to parse reliably, so a view is
     * recorded as existing with an unknown column set and its embeds are
     * skipped rather than guessed at. PostgREST cannot embed through a view
     * anyway; this only stops a view name being mistaken for a missing table.
     */
    for (const m of sql.matchAll(/create (?:or replace )?view (\w+)/g)) {
      if (!columns.has(m[1]!)) columns.set(m[1]!, new Set());
    }
  }
  return columns;
}

/**
 * Embedded relations inside one `.select(...)` argument.
 *
 * The argument may be several string literals joined by `+`, which is how every
 * long select in this codebase is written, so the literals are concatenated
 * first and the result parsed as one.
 */
function embedsIn(text: string): Array<{ table: string; columns: string[]; alias: boolean }> {
  const found: Array<{ table: string; columns: string[]; alias: boolean }> = [];

  for (const call of text.matchAll(/\.select\(\s*((?:'[^']*'|"[^"]*"|\s|\+|\n)*?)\)/g)) {
    const joined = [...call[1]!.matchAll(/'([^']*)'|"([^"]*)"/g)]
      .map((m) => m[1] ?? m[2] ?? '').join('');

    /* `name(a, b)` — but not a PostgREST function call or a `!fk` hint target. */
    for (const e of joined.matchAll(/(\w+)\s*(?:!\w+)?\s*\(([^()]*)\)/g)) {
      const table = e[1]!;
      const columns = e[2]!.split(',').map((c) => c.trim()).filter(Boolean)
        /* An aliased or nested column is its own shape; only plain names here. */
        .filter((c) => /^\w+$/.test(c))
        /*
         * PostgREST aggregates. `leads(count)` is not a column named count, it
         * is "how many leads", and it is the one legitimate way an embed names
         * something the table does not have.
         */
        .filter((c) => !['count', 'sum', 'avg', 'min', 'max'].includes(c));
      found.push({
        table,
        columns,
        /* `alias:table(...)` renames the result, and the table is what precedes. */
        alias: new RegExp(`\\w+\\s*:\\s*${table}\\s*\\(`).test(joined),
      });
    }
  }
  return found;
}

describe('a select names columns that exist', () => {
  const columns = schemaColumns();

  it('finds the schema it is checking against', () => {
    /* A parser that quietly found nothing would pass every other test here. */
    expect(columns.size).toBeGreaterThan(150);
    expect(columns.get('assets')?.has('asset_number')).toBe(true);
    expect(columns.get('assets')?.has('code')).toBe(false);
    expect(columns.get('employees')?.has('full_name')).toBe(true);
    expect(columns.get('schedule_activities')?.has('calendar_id')).toBe(true);
  });

  it('every embedded relation asks for columns that table has', () => {
    const wrong: string[] = [];

    for (const file of globSync('apps/web/src/lib/data/*.ts', { cwd: ROOT }).sort()) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      for (const embed of embedsIn(text)) {
        const known = columns.get(embed.table);
        /* Not a table in this schema — a nested embed, a hint, a false match. */
        if (!known || known.size === 0) continue;
        for (const column of embed.columns) {
          if (!known.has(column)) {
            wrong.push(`${file}: ${embed.table}(… ${column} …) — `
              + `${embed.table} has no column ${column}`);
          }
        }
      }
    }

    expect(wrong, wrong.join('\n')).toEqual([]);
  });
});
