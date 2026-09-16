/**
 * Every button does something.
 *
 * `<Button><UserPlus /> Add customer</Button>` — the primary action in the top
 * right of the Customers page, with no `onClick`, no `type="submit"`, and no
 * link inside it. It rendered, it looked enabled, it highlighted on hover, and
 * clicking it did nothing at all. The same on Proposals: "New proposal".
 *
 * These were found by a person using the product and asking why nothing
 * happened — which is the most expensive way to find anything, and the way this
 * repository keeps finding things. A door with no reader is caught by
 * `build-door-inventory.mjs`; a tab with no trigger by
 * `every-tab-can-be-reached`; a stat tile that answers nothing by
 * `every-stat-tile-does-something`. A button that does nothing had no guard at
 * all, and it is the most visible of the four.
 *
 * What counts as doing something: an `onClick`, a `type="submit"` inside a
 * form, `asChild` wrapping a link, `disabled` (deliberately inert, and the
 * reason belongs in a `title`), or a spread of props that may carry any of
 * them. Anything else is a control that takes a click and changes nothing.
 *
 * GOVERNANCE.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');

/** Attributes that make a button a button rather than a shape. */
const ACTIVE = [
  'onClick', 'onPointerDown', 'onMouseDown', 'type=', 'asChild',
  'disabled', '{...', 'form=', 'onSubmit',
];

interface Dead { file: string; line: number; label: string }

/**
 * Every `<Button …>` opening tag in a file, with the attributes it carries.
 *
 * Tags are matched across newlines because the house style wraps long prop
 * lists, and a regex that stopped at the first newline would call every
 * multi-line button dead.
 */
function deadButtonsIn(file: string): Dead[] {
  const raw = readFileSync(join(ROOT, file), 'utf8');
  /*
   * Comments are blanked rather than removed, so line numbers still point at
   * the real line. A file that explains this very defect quotes `<Button>` in
   * its header comment, and the first version of this test failed on its own
   * documentation.
   */
  const text = raw
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
  const found: Dead[] = [];

  for (const m of text.matchAll(/<Button(\s[^>]*?)?>/gs)) {
    const attrs = m[1] ?? '';
    if (ACTIVE.some((a) => attrs.includes(a))) continue;

    /* What the button says, so the failure names it rather than a line number. */
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 200);
    const label = (after.match(/>\s*([A-Za-z][^<>{}]{2,40})/)?.[1]
      ?? after.match(/^\s*([A-Za-z][^<>{}]{2,40})/)?.[1] ?? '')
      .replace(/\s+/g, ' ').trim();

    found.push({
      file,
      line: text.slice(0, m.index).split('\n').length,
      label: label || '(no text)',
    });
  }
  return found;
}

describe('every button does something', () => {
  const files = globSync('apps/web/src/{pages,components}/**/*.tsx', { cwd: ROOT })
    .filter((f) => !f.endsWith('.test.tsx'))
    .sort();

  it('finds the files it is checking', () => {
    /* A sweep that quietly matched nothing would pass forever. */
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no button that takes a click and changes nothing', () => {
    const dead = files.flatMap(deadButtonsIn);
    const said = dead.map((d) => `${d.file}:${d.line} — "${d.label}"`).join('\n');
    expect(dead, `Buttons with no handler:\n${said}`).toEqual([]);
  });
});
