/**
 * The five-category rule, enforced.
 *
 * "Everything in GrounUp must belong to one of five things: Engine, Library,
 * Entity, Workflow, AI Agent. Nothing should exist outside these five
 * categories."
 *
 * A rule written only in a document is a rule the build cannot keep. These
 * tests read the live schema and the real source tree and fail when anything
 * is unclassified, doubly classified, or violates the invariants its category
 * promises. Adding a table without classifying it breaks the build, which is
 * the only version of this rule that survives contact with a deadline.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness, type Harness } from '../db/harness.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const registry = JSON.parse(readFileSync(join(ROOT, 'governance/registry.json'), 'utf8')) as {
  tables: Record<string, string>;
  library_scope: Record<string, string>;
  library_parent: Record<string, string>;
  engines: { id: string; name: string; path: string; purpose: string }[];
  ai_agents: { id: string; name: string; path: string; max_authority: string }[];
};
const categories = JSON.parse(readFileSync(join(ROOT, 'governance/categories.json'), 'utf8')) as {
  categories: { id: string; invariants: { id: string }[] }[];
};

const CATEGORY_IDS = categories.categories.map((c) => c.id);

let h: Harness;
beforeAll(async () => { h = await createHarness({ seed: false }); }, 180_000);
afterAll(async () => { await h?.db.close(); });

async function liveTables(): Promise<string[]> {
  const rows = await h.sql<{ relname: string }>(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' order by c.relname`);
  return rows.map((r) => r.relname);
}

// ---------------------------------------------------------------- completeness
describe('nothing exists outside the five categories', () => {
  it('declares exactly five categories', () => {
    expect(CATEGORY_IDS).toEqual(['ENGINE', 'LIBRARY', 'ENTITY', 'WORKFLOW', 'AI_AGENT']);
  });

  it('classifies every table in the live database', async () => {
    const unclassified = (await liveTables()).filter((t) => !(t in registry.tables));
    // A new table with no category is the failure this whole file exists to
    // catch. Classify it in governance/registry.json.
    expect(unclassified).toEqual([]);
  });

  it('has no registry entry for a table that does not exist', async () => {
    const live = new Set(await liveTables());
    expect(Object.keys(registry.tables).filter((t) => !live.has(t))).toEqual([]);
  });

  it('gives every table exactly one category from the five', () => {
    for (const [table, cat] of Object.entries(registry.tables)) {
      expect(CATEGORY_IDS, `${table} has category "${cat}"`).toContain(cat);
    }
  });

  it('classifies every engine and AI agent to a real path', () => {
    for (const e of [...registry.engines, ...registry.ai_agents]) {
      expect(existsSync(join(ROOT, e.path)), `${e.id} ${e.name} → ${e.path}`).toBe(true);
    }
  });

  it('gives every engine a stated purpose', () => {
    for (const e of registry.engines) {
      expect(e.purpose.length, e.name).toBeGreaterThan(30);
    }
  });
});

// ------------------------------------------------------------------- LIBRARY
describe('LIBRARY — stores reusable knowledge', () => {
  it('declares a scope for every library table', () => {
    const libs = Object.entries(registry.tables).filter(([, c]) => c === 'LIBRARY').map(([t]) => t);
    for (const t of libs) expect(registry.library_scope[t], t).toBeDefined();
  });

  it('matches each declared scope against the actual schema', async () => {
    const rows = await h.sql<{
      table_name: string; has_company: boolean; nullable: boolean; has_group: boolean;
    }>(`
      select c.relname as table_name,
        bool_or(a.attname = 'company_id') as has_company,
        bool_or(a.attname = 'company_id' and not a.attnotnull) as nullable,
        bool_or(a.attname = 'enterprise_group_id') as has_group
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r' group by c.relname`);
    const shape = new Map(rows.map((r) => [r.table_name, r]));

    for (const [table, scope] of Object.entries(registry.library_scope)) {
      const s = shape.get(table)!;
      const actual =
        !s.has_company ? 'platform_only'
        : !s.nullable ? 'company_only'
        : s.has_group ? 'three_tier'
        : 'global_or_company_or_child';
      if (scope === 'company_only') {
        expect(actual, `${table} is declared company_only`).toBe('company_only');
      } else if (scope === 'child_of_library') {
        // A child restating the tier columns could disagree with its parent.
        expect(actual, `${table} is declared a child of ${registry.library_parent[table]}`)
          .toBe('global_or_company_or_child');
      } else if (scope === 'global_or_company') {
        expect(actual, table).toBe('global_or_company_or_child');
      } else {
        expect(actual, `${table} is declared ${scope}`).toBe(scope);
      }
    }
  });

  it('points every child library at a three-tier parent', () => {
    for (const [child, parent] of Object.entries(registry.library_parent)) {
      expect(registry.library_scope[child], child).toBe('child_of_library');
      expect(registry.library_scope[parent], `${child} → ${parent}`).toBe('three_tier');
    }
  });

  it('keeps the canonical three-tier libraries three-tier', () => {
    // These twelve are what an estimate is priced from. Losing the tier on any
    // one of them means a company can no longer override a seeded rate.
    const threeTier = Object.entries(registry.library_scope)
      .filter(([, s]) => s === 'three_tier').map(([t]) => t).sort();
    expect(threeTier).toEqual([
      'assemblies', 'condition_modifiers', 'cost_codes', 'crews', 'equipment',
      'labor_rates', 'materials', 'pricing_profiles', 'production_rates',
      'regional_factors', 'services', 'tasks',
    ]);
  });
});

// -------------------------------------------------------------------- ENTITY
describe('ENTITY — stores business records', () => {
  it('forces row level security on every entity table', async () => {
    const entities = Object.entries(registry.tables)
      .filter(([, c]) => c === 'ENTITY').map(([t]) => t);
    const rows = await h.sql<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`);
    const rls = new Map(rows.map((r) => [r.relname, r]));
    const open = entities.filter((t) => {
      const r = rls.get(t)!;
      return !r.relrowsecurity || !r.relforcerowsecurity;
    });
    // ENABLE without FORCE still lets the table owner read past every policy.
    expect(open).toEqual([]);
  });

  it('gives every tenant-owned entity a company_id', async () => {
    const rows = await h.sql<{ table_name: string }>(`
      select c.relname as table_name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (
          select 1 from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'company_id' and a.attnum > 0 and not a.attisdropped)`);
    const withoutCompany = rows.map((r) => r.table_name).filter((t) => registry.tables[t] === 'ENTITY');
    // The platform-level entities that legitimately have no owning company.
    // `plan_versions` joins them for the same reason `plans` is platform_only:
    // published commercial terms are the platform's, and every tenant that
    // bought under a version is pointing at the same row.
    expect(withoutCompany.sort()).toEqual([
      'companies', 'enterprise_groups', 'network_ratings', 'network_vendors',
      'plan_versions', 'user_profiles',
    ]);
  });
});

// ------------------------------------------------------------------ WORKFLOW
describe('WORKFLOW — defines processes', () => {
  it('gives every workflow an explicit, constrained state', async () => {
    const workflows = Object.entries(registry.tables)
      .filter(([, c]) => c === 'WORKFLOW').map(([t]) => t);
    for (const table of workflows) {
      const rows = await h.sql<{ attname: string; constrained: boolean }>(`
        select a.attname,
               (t.typtype = 'e' or exists (
                 select 1 from pg_constraint k
                 where k.conrelid = c.oid and k.contype = 'c'
                   and pg_get_constraintdef(k.oid) like '%' || a.attname || '%'
               )) as constrained
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        join pg_type t on t.oid = a.atttypid
        where n.nspname = 'public' and c.relname = $1
          and a.attname in ('status','state','stage','approval_state','investigation_state')`,
        [table]);
      expect(rows.length, `${table} must have an explicit state column`).toBeGreaterThan(0);
      // A free-text state column is a state machine nobody can reason about.
      expect(rows.some((r) => r.constrained), `${table} state must be constrained`).toBe(true);
    }
  });
});

// ------------------------------------------------------------------ AI_AGENT
describe('AI_AGENT — assists within governance', () => {
  it('caps every agent at draft authority', () => {
    for (const a of registry.ai_agents) {
      // RULE-008: an agent proposes; it never commits.
      expect(a.max_authority, a.name).toBe('draft');
    }
  });

  it('caps agent authority in the database as well as the registry', async () => {
    const rows = await h.sql<{ definition: string }>(`
      select pg_get_constraintdef(k.oid) as definition
      from pg_constraint k join pg_class c on c.oid = k.conrelid
      where c.relname = 'ai_agents' and k.contype = 'c'`);
    const text = rows.map((r) => r.definition).join(' ');
    // The allowed set is the cap. Searching for forbidden words instead would
    // fail on the constraint that exists precisely to forbid them:
    // `check (default_authority <> 'autonomous')`.
    expect(text).toMatch(/default_authority[\s\S]*'read_only'/);
    expect(text).toMatch(/default_authority[\s\S]*'draft_recommend'/);
    expect(text).toMatch(/default_authority <> 'autonomous'/);
    for (const granted of ['write', 'approve', 'publish', 'execute']) {
      expect(text.includes(`'${granted}'`), `no agent may be configured with ${granted} authority`).toBe(false);
    }
  });

  it('writes every finding as proposed, never as accepted', () => {
    const source = readFileSync(join(ROOT, 'supabase/functions/_shared/plan-analysis.ts'), 'utf8');
    expect(source).toContain("state: 'proposed'");
  });
});

// -------------------------------------------------------------------- ENGINE
describe('ENGINE — performs calculations or business logic', () => {
  it('keeps the estimating engine free of runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'packages/engine/package.json'), 'utf8')) as
      { dependencies?: Record<string, string> };
    // An engine that pulls in a dependency inherits that dependency's bugs into
    // every number the platform produces.
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('keeps the document engine free of runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'packages/pdf/package.json'), 'utf8')) as
      { dependencies?: Record<string, string> };
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('performs no I/O inside the estimating engine', () => {
    const dir = join(ROOT, 'packages/engine/src');
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      for (const forbidden of ['fetch(', 'require(', 'process.env', 'node:fs', 'localStorage']) {
        expect(src.includes(forbidden), `${f} must not use ${forbidden}`).toBe(false);
      }
    }
  });

  it('reads no clock inside the estimating engine', () => {
    const dir = join(ROOT, 'packages/engine/src');
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      // A figure that depends on when it was computed cannot be reproduced,
      // and an estimate that cannot be reproduced cannot be defended.
      expect(src.includes('Date.now()'), `${f} must not read the clock`).toBe(false);
      expect(/new Date\(\s*\)/.test(src), `${f} must not read the clock`).toBe(false);
    }
  });

  it('takes injected I/O in the engines that genuinely need it', () => {
    const connectors = readFileSync(join(ROOT, 'supabase/functions/_shared/connectors/types.ts'), 'utf8');
    expect(connectors).toContain('HttpFetch');
    const ingestion = readFileSync(join(ROOT, 'supabase/functions/_shared/ingestion/pipeline.ts'), 'utf8');
    expect(ingestion).toContain('OcrProvider');
  });

  it('gives every engine module a registry entry', () => {
    const dir = join(ROOT, 'packages/engine/src');
    const modules = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts');
    const registered = new Set(registry.engines.map((e) => e.path));
    for (const m of modules) {
      expect(registered.has(`packages/engine/src/${m}`), `${m} is not in the engine registry`).toBe(true);
    }
  });

  it('points every registered engine at something that exists', () => {
    for (const e of registry.engines) {
      const p = join(ROOT, e.path);
      expect(existsSync(p), `${e.id} ${e.path}`).toBe(true);
      expect(statSync(p).size, e.path).toBeGreaterThan(0);
    }
  });
});

describe('the documentation states the counts the repository actually has', () => {
  /*
   * The same drift the traceability README had, one directory over. The root
   * README said 122 tables while the registry held 131, governance/README.md
   * said 16 engines while there were 28, and both were written truthfully on
   * the day. A count nobody rechecks is the count somebody quotes.
   */
  const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'));
  const tables = Object.keys(registry.tables).length;
  const engines = registry.engines.length;
  const agents = registry.ai_agents.length;

  function claim(file: string, pattern: RegExp): number[] {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const m = text.match(pattern);
    expect(m, `${file} no longer contains: ${pattern}`).not.toBeNull();
    return m!.slice(1).map((v) => Number(v.replace(/,/g, '')));
  }

  it('states the database size the migrations actually build', () => {
    const [count, tableCount] = claim('README.md', /(\d+) migrations, ([\d,]+) tables/);
    expect(count).toBe(migrations.length);
    expect(tableCount).toBe(tables);
  });

  it('states the table count in the security section too', () => {
    // Two places in one file said different numbers, which is how a reader
    // learns not to trust either.
    const [count] = claim('README.md', /every one of the ([\d,]+) tables/);
    expect(count).toBe(tables);
  });

  it('states what the registry holds', () => {
    const [t, e, a] = claim('governance/README.md',
      /([\d,]+) tables, ([\d,]+) engines, ([\d,]+) agent/);
    expect(t).toBe(tables);
    expect(e).toBe(engines);
    expect(a).toBe(agents);
  });

  it('states the migration count in the build summary', () => {
    const [files, tableCount] = claim('docs/BUILD-SUMMARY.md',
      /Database migrations \((\d+) files, ([\d,]+) tables/);
    expect(files).toBe(migrations.length);
    expect(tableCount).toBe(tables);
  });

  it('states the migration and function counts in the architecture', () => {
    const [migrationCount] = claim('docs/ARCHITECTURE.md', /(\d+) ordered migrations/);
    expect(migrationCount).toBe(migrations.length);
    const [functionCount] = claim('docs/ARCHITECTURE.md', /(\d+) functions — six for billing/);
    const deployed = readdirSync(join(ROOT, 'supabase/functions'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('_'));
    expect(functionCount).toBe(deployed.length);
  });

  it('lists every engine module in the architecture table', () => {
    // The table had nine rows while packages/engine had eighteen modules. A
    // reader takes an incomplete list as a complete one.
    const text = readFileSync(join(ROOT, 'docs/ARCHITECTURE.md'), 'utf8');
    const modules = readdirSync(join(ROOT, 'packages/engine/src'))
      .filter((f) => f.endsWith('.ts') && f !== 'index.ts');
    for (const m of modules) expect(text, m).toContain(`\`${m}\``);
  });

  it('counts every engine file the registry names as existing on disk', () => {
    for (const engine of registry.engines) {
      expect(existsSync(join(ROOT, engine.path)), engine.path).toBe(true);
    }
  });
});

describe('every table leaves a record of what happened to it', () => {
  /*
   * Migration 0011 attached the audit trigger by looping over the tables that
   * existed at the time. Nothing ran that loop for tables added afterwards, so
   * everything from 0026 onward arrived unaudited — including a work calendar
   * whose holidays move every date on a project schedule, and the Stripe event
   * ledger the whole billing story rests on.
   *
   * The rule: a table is either audited, or it is frozen. A row nobody can
   * change is its own record; a row anybody can change needs a ledger. Nothing
   * may be neither.
   */
  const EXEMPT: Record<string, string> = {
    // High volume, no governance value, and genuinely mutable: read_at flips
    // every time somebody opens the bell menu. Auditing it would bury the
    // ledger in noise and protect nothing.
    notifications: 'Per-user notices. Mutable by design, and of no evidentiary value.',
    // The ledger itself. Auditing the audit table would recurse.
    audit_events: 'The ledger. It is frozen and it cannot audit itself.',
  };

  let tables: { table_name: string; audited: boolean; frozen: boolean }[] = [];

  beforeAll(async () => {
    tables = await h.sql(`
      select c.relname as table_name,
        exists (select 1 from pg_trigger t
                 where t.tgrelid = c.oid and t.tgname = 'audit_row') as audited,
        exists (select 1 from pg_trigger t
                  join pg_proc p on p.oid = t.tgfoid
                 where t.tgrelid = c.oid and not t.tgisinternal
                   and p.proname like 'forbid\\_%') as frozen
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by 1`);
  });

  it('finds every table in the schema', () => {
    expect(tables.length).toBe(Object.keys(registry.tables).length);
  });

  it('leaves no table both unaudited and unfrozen', () => {
    const orphans = tables
      .filter((t) => !t.audited && !t.frozen && !(t.table_name in EXEMPT))
      .map((t) => t.table_name);
    expect(orphans).toEqual([]);
  });

  it('keeps the exemption list short and reasoned', () => {
    // An exemption is a decision somebody has to defend, not a place to put
    // whatever failed the rule today.
    expect(Object.keys(EXEMPT).length).toBeLessThanOrEqual(3);
    for (const [table, reason] of Object.entries(EXEMPT)) {
      expect(tables.some((t) => t.table_name === table), table).toBe(true);
      expect(reason.length, table).toBeGreaterThan(40);
    }
  });

  it('freezes the ledgers that are cited as evidence', () => {
    // Named individually because each is quoted in a verification verdict as
    // proof of something, and a log that can be edited proves nothing.
    for (const name of ['audit_events', 'api_requests', 'ai_messages', 'stripe_events',
                        'library_row_versions', 'plan_versions', 'schedule_calculations']) {
      const t = tables.find((x) => x.table_name === name);
      expect(t, name).toBeDefined();
      expect(t!.frozen, `${name} must be frozen`).toBe(true);
    }
  });

  it('audits every table a person edits in the course of their work', () => {
    for (const name of ['estimates', 'projects', 'plans', 'entitlements', 'subscriptions',
                        'work_calendars', 'labor_rates', 'employees']) {
      const t = tables.find((x) => x.table_name === name);
      expect(t, name).toBeDefined();
      expect(t!.audited, `${name} must be audited`).toBe(true);
    }
  });
});
