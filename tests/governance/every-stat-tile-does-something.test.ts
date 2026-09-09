/**
 * A number on a tile is a question, and every tile answers it.
 *
 * There were 135 `StatTile`s across this application and 117 of them were
 * `div`s. "Blocked from issue: 3" told an estimator there were three and left
 * them to find which — with the three of them already on the same screen, four
 * hundred pixels below. "OSHA recordable: 2" over eleven incident cards was a
 * number and a search. Every one of them was a control that took a value and
 * changed nothing, which is the defect this repository keeps producing in its
 * second form.
 *
 * A tile now does one of two things, and which one depends on whether the
 * answer is somewhere else or nowhere yet:
 *
 *   * `onClick` — the answer is on the page. Filter the list, open the tab, or
 *     go to the section that accounts for the number, and mark the tile pressed
 *     while that is what the screen is showing.
 *   * `detail` — the answer is nowhere else. It opens underneath the tile: what
 *     the figure is made of, how it was counted, what it excludes.
 *
 * This test holds the property rather than the hundred edits that established
 * it. A tile written next month with neither is a tile that went back to being
 * a `div`, and the build says so on the commit that did it rather than on the
 * day somebody clicks it.
 *
 * Read as text rather than rendered: this is a question about every call site
 * in the repository, and rendering twenty-three screens to ask it would test
 * the fixtures rather than the property.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const WEB = join(ROOT, 'apps/web/src');

/** Where `StatTile` itself lives — the definition, not a use of it. */
const DEFINITION = join(WEB, 'components/layout/page.tsx');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...sourceFiles(path)); continue; }
    if (!entry.name.endsWith('.tsx')) continue;
    if (entry.name.includes('.test.')) continue;
    if (path === DEFINITION) continue;
    out.push(path);
  }
  return out;
}

/**
 * Every `<StatTile … />` in a file, as text.
 *
 * Brace-counted rather than matched with a regular expression, because the
 * props hold JSX of their own — a `detail` is a paragraph with elements in it —
 * and a lazy match stops at the first `/>` inside an icon.
 */
function statTiles(source: string): string[] {
  const tiles: string[] = [];
  const opening = /<StatTile\b/g;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(source)) !== null) {
    let depth = 0;
    for (let i = match.index + match[0].length; i < source.length; i += 1) {
      const c = source[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (depth === 0 && c === '/' && source[i + 1] === '>') {
        tiles.push(source.slice(match.index, i + 2));
        break;
      }
    }
  }
  return tiles;
}

/** The label, for a failure message that names the tile rather than a line. */
const labelOf = (tile: string): string =>
  tile.match(/label="([^"]*)"/)?.[1]
  ?? tile.match(/label=\{([^}]*)\}/)?.[1]
  ?? '(unlabeled)';

const files = sourceFiles(WEB);

describe('every stat tile does something when it is pressed', () => {
  it('finds the tiles at all, so a silent pass is not possible', () => {
    const total = files.reduce((n, f) => n + statTiles(readFileSync(f, 'utf8')).length, 0);
    // Guards the parser, not the count: if this ever reads zero the test above
    // would pass on an empty set and report a screen full of dead tiles green.
    expect(total).toBeGreaterThan(100);
  });

  it('gives each one either somewhere to go or something to say', () => {
    const inert: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const tile of statTiles(source)) {
        /*
         * Spread props count. A screen with four tiles filtering one table
         * shares a helper — `{...connectorTile('failed')}` — rather than
         * repeating the same two lines four times.
         */
        const acts = tile.includes('onClick') || tile.includes('detail') || /\{\.\.\./.test(tile);
        if (!acts) inert.push(`${file.slice(ROOT.length + 1)} — ${labelOf(tile)}`);
      }
    }
    expect(inert).toEqual([]);
  });

  it('names what it does where the label alone would not say', () => {
    /*
     * A tile that filters a list is a button whose accessible name has to say
     * what pressing it does. "Open pipeline" is what the number is; "List the
     * active projects" is what the control does, and a screen reader announces
     * the second only if somebody wrote it.
     */
    const unnamed: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const tile of statTiles(source)) {
        if (!tile.includes('onClick') && !/\{\.\.\./.test(tile)) continue;
        if (!tile.includes('actionLabel')) {
          unnamed.push(`${file.slice(ROOT.length + 1)} — ${labelOf(tile)}`);
        }
      }
    }
    expect(unnamed).toEqual([]);
  });
});
