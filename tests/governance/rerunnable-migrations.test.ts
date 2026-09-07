/**
 * A migration that fails partway must not brick the database.
 *
 * Migration 0103 added two columns to `takeoff_measurements` and then did five
 * more things. On a real project the push was interrupted after the columns
 * landed and before the migration was recorded, and every attempt after that
 * failed on the same line:
 *
 *     ERROR: column "lifts" of relation "takeoff_measurements" already exists
 *
 * There is no way out of that from the outside. Marking the migration applied
 * skips the five things it had not done yet; dropping the column by hand is
 * somebody editing a production schema from memory. The database was stuck, and
 * so was every migration behind it.
 *
 * The whole class was there to find: 519 statements across 73 of the 120
 * migrations could not survive being run twice. So every one of them says
 * `if not exists`, or drops what it is about to create, and this is the test
 * that keeps it that way.
 *
 * It reads the migration text rather than running anything, because the failure
 * it guards against only happens on a database that is *already* half-way
 * through — a state the harness, which builds every database from nothing,
 * can never reproduce.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations');

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

/**
 * The executable parts of a file: not a comment, a string, or a function body.
 *
 * All three produced false alarms. A `create trigger` inside a function body is
 * written when that function runs, and the guard belongs in the function. One
 * lives inside a `comment on function` string that tells a reader how to attach
 * it. And several `add constraint` lines are described in prose above the
 * statement that adds them. Read as flat text every one of those looks like an
 * unguarded statement; none of them is.
 */
function executableSql(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
    } else if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else if (sql[i] === '$') {
      const m = /^\$([A-Za-z_]*)\$/.exec(sql.slice(i));
      if (m) {
        const end = sql.indexOf(m[0], i + m[0].length);
        i = end === -1 ? sql.length : end + m[0].length;
      } else { out += sql[i]; i += 1; }
    } else if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j += 1; break; }
        j += 1;
      }
      i = j;
    } else {
      out += sql[i];
      i += 1;
    }
  }
  return out;
}

interface Violation { file: string; statement: string; name: string }

function sweep(): Violation[] {
  const out: Violation[] = [];
  for (const file of files) {
    const sql = executableSql(readFileSync(join(MIGRATIONS, file), 'utf8'));
    const low = sql.toLowerCase();

    for (const m of low.matchAll(/\badd column\s+(?!if not exists)([a-z_]+)/g)) {
      out.push({ file, statement: 'add column', name: m[1]! });
    }
    for (const m of low.matchAll(/\bcreate (?:unique )?index\s+(?!if not exists|concurrently)([a-z_]+)/g)) {
      out.push({ file, statement: 'create index', name: m[1]! });
    }
    for (const m of low.matchAll(/\bcreate trigger\s+([a-z_]+)/g)) {
      if (!low.includes(`drop trigger if exists ${m[1]}`)) {
        out.push({ file, statement: 'create trigger', name: m[1]! });
      }
    }
    for (const m of low.matchAll(/\badd constraint\s+([a-z_]+)/g)) {
      if (!low.includes(`drop constraint if exists ${m[1]}`)) {
        out.push({ file, statement: 'add constraint', name: m[1]! });
      }
    }
  }
  return out;
}

describe('every migration survives being run twice', () => {
  it('has migrations to check, so the sweep is not vacuously green', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('adds no column that would collide with one already there', () => {
    const bad = sweep().filter((o) => o.statement === 'add column');
    expect(bad.map((o) => `${o.file}: ${o.name}`)).toEqual([]);
  });

  it('creates no index that would collide with one already there', () => {
    const bad = sweep().filter((o) => o.statement === 'create index');
    expect(bad.map((o) => `${o.file}: ${o.name}`)).toEqual([]);
  });

  it('creates no trigger without first dropping the one it replaces', () => {
    const bad = sweep().filter((o) => o.statement === 'create trigger');
    expect(bad.map((o) => `${o.file}: ${o.name}`)).toEqual([]);
  });

  it('adds no constraint without first dropping the one it replaces', () => {
    const bad = sweep().filter((o) => o.statement === 'add constraint');
    expect(bad.map((o) => `${o.file}: ${o.name}`)).toEqual([]);
  });

  it('reads only what the database will actually execute', () => {
    /*
     * The three shapes that fooled an earlier version of this sweep, each
     * checked against the file it came from.
     */
    // A `do $$` block that drops the constraint dynamically before adding it.
    expect(executableSql(
      readFileSync(join(MIGRATIONS, '0072_deleting_a_company.sql'), 'utf8')))
      .not.toContain('add constraint audit_events_company_id_fkey');

    // A `create trigger` quoted inside a comment on a function.
    expect(executableSql(
      readFileSync(join(MIGRATIONS, '0011_triggers_provisioning.sql'), 'utf8')))
      .not.toContain('create trigger on_auth_user_created');

    // And a `--` comment is not a statement.
    expect(executableSql('-- create trigger t before insert on x\nselect 1;'))
      .not.toContain('create trigger');
  });
});
