/**
 * Every tab can be reached, and every tab goes somewhere.
 *
 * The project page grew a `<TabsContent value="work">` holding the budgeted
 * work an award carries across — and no `<TabsTrigger value="work">` to open
 * it. The content rendered into a tab nobody could select. Nothing failed: the
 * page looked complete, the tests passed, and the feature was invisible.
 *
 * That is this repository's own defect wearing different clothes. A door with
 * no reader is a function nothing calls; a tab body with no trigger is a screen
 * nothing opens. `scripts/build-door-inventory.mjs` catches the first. This
 * catches the second.
 *
 * The reverse is worth catching too: a trigger with no body is a tab that opens
 * onto nothing, which is worse, because somebody clicked it on purpose.
 *
 * GOVERNANCE.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');

const VALUE = /<Tabs(Trigger|Content)\b[^>]*?\bvalue=(?:"([^"]+)"|\{'([^']+)'\})/gs;

interface Mismatch { file: string; kind: string; value: string }

function mismatchesIn(file: string): Mismatch[] {
  const text = readFileSync(file, 'utf8');
  const triggers = new Set<string>();
  const contents = new Set<string>();

  for (const m of text.matchAll(VALUE)) {
    const value = m[2] ?? m[3];
    if (!value) continue;
    if (m[1] === 'Trigger') triggers.add(value);
    else contents.add(value);
  }

  /*
   * A file with only one of the two is not a broken pair — a tab list and its
   * panels are sometimes split across components, and this check has no way to
   * follow that. It only speaks where both appear together.
   */
  if (triggers.size === 0 || contents.size === 0) return [];

  const short = file.slice(ROOT.length + 1);
  return [
    ...[...contents].filter((v) => !triggers.has(v))
      .map((value) => ({ file: short, kind: 'content with no trigger', value })),
    ...[...triggers].filter((v) => !contents.has(v))
      .map((value) => ({ file: short, kind: 'trigger with no content', value })),
  ];
}

describe('every tab can be reached', () => {
  const files = globSync('apps/web/src/**/*.tsx', { cwd: ROOT })
    .filter((f) => !f.endsWith('.test.tsx'))
    .map((f) => join(ROOT, f))
    .filter((f) => readFileSync(f, 'utf8').includes('<TabsContent'));

  it('has files with tabs to check', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it('never renders a tab nobody can open, or opens one onto nothing', () => {
    const found = files.flatMap(mismatchesIn);
    const said = found.map((m) => `${m.file}: ${m.kind} — "${m.value}"`);
    expect(said).toEqual([]);
  });

  it('catches the shape that hid the budgeted work', () => {
    /*
     * The check earns its place by failing on the original. Written to a
     * temporary file rather than a fixture so it cannot be quietly "fixed".
     */
    const { writeFileSync, rmSync } = require('node:fs') as typeof import('node:fs');
    const tmp = join(ROOT, 'node_modules/.tmp-tab-check.tsx');
    writeFileSync(tmp, `
      export function Page() {
        return (
          <Tabs>
            <TabsList>
              <TabsTrigger value="field">Field reports</TabsTrigger>
            </TabsList>
            <TabsContent value="work"><BudgetedWork /></TabsContent>
            <TabsContent value="field">…</TabsContent>
          </Tabs>
        );
      }`);
    try {
      const found = mismatchesIn(tmp);
      expect(found.map((f) => f.value)).toEqual(['work']);
    } finally {
      rmSync(tmp, { force: true });
    }
  });
});
