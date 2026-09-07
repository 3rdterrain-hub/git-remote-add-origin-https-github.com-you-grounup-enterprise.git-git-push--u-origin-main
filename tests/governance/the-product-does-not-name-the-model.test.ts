/**
 * A customer reads "AI", not the name of a vendor's model.
 *
 * "Upload the bid set and Claude reads it for scope" shipped on the takeoff
 * panel. It is accurate and it is the wrong sentence to put in front of a
 * contractor: it names a supplier the customer has no relationship with, it
 * dates the moment the model is swapped, and it makes a third party's brand
 * part of the product's own voice.
 *
 * The rule is not "never write the word". Two places must name a model exactly:
 *
 *   * The AI model registry, which is an administrator choosing between models
 *     and cannot do that from the word "AI".
 *   * Code comments and identifiers, where naming the model that a function
 *     actually calls is the accurate thing to write.
 *
 * Everywhere else — the strings a customer reads — the platform says AI.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const WEB = join(ROOT, 'apps/web/src');

/** Where naming a model is the point rather than a leak. */
const REGISTRY = new Set([
  'apps/web/src/data/field.ts',
]);

const SKIP_DIRS = new Set(['node_modules', 'dist', '__snapshots__']);

/** The vendors whose brand should not appear in product copy. */
const MODEL_NAMES = /\b(Claude|Anthropic|GPT-[0-9o]|OpenAI|Gemini|Llama|Mistral)\b/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * The parts of a file a person could end up reading on screen.
 *
 * Comments are removed, because a comment naming the model a function calls is
 * the accurate thing to write and never reaches a customer. What is left is
 * string literals and the text between JSX tags, which is everything that can.
 */
function readableText(source: string): string {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

  const strings = [...withoutComments.matchAll(/'([^'\\\n]|\\.)*'|"([^"\\\n]|\\.)*"|`([^`\\]|\\.)*`/g)]
    .map((m) => m[0]);
  /* Text sitting directly between JSX tags: >Some words< */
  const jsxText = [...withoutComments.matchAll(/>([^<>{}\n]{4,})</g)].map((m) => m[1]!);

  return [...strings, ...jsxText].join('\n');
}

interface Hit { file: string; line: number; text: string }

function sweep(): Hit[] {
  const hits: Hit[] = [];
  for (const path of sourceFiles(WEB)) {
    if (statSync(path).size > 2_000_000) continue;
    const file = relative(ROOT, path);
    if (REGISTRY.has(file)) continue;

    const source = readFileSync(path, 'utf8');
    const readable = readableText(source);
    if (!MODEL_NAMES.test(readable)) continue;

    /* Report the real line, so the message points somewhere. */
    source.split('\n').forEach((line, i) => {
      const visible = readableText(line);
      const m = MODEL_NAMES.exec(visible);
      if (m) hits.push({ file, line: i + 1, text: m[0] });
    });
  }
  return hits;
}

describe('the product does not name the model', () => {
  it('has files to check, so the sweep is not vacuously green', () => {
    expect(sourceFiles(WEB).length).toBeGreaterThan(50);
  });

  it('names no vendor model in anything a customer reads', () => {
    expect(sweep().map((h) => `${h.file}:${h.line}  ${h.text}`)).toEqual([]);
  });

  it('still lets an administrator see which model they are choosing', () => {
    /*
     * The exception, checked rather than assumed. A registry that said "AI"
     * three times would be a picker nobody could pick from.
     */
    const registry = readFileSync(join(ROOT, 'apps/web/src/data/field.ts'), 'utf8');
    expect(registry).toMatch(/Claude/);
  });

  it('reads comments as comments, not as copy', () => {
    expect(readableText('// Calls Claude for this\nconst a = 1;')).not.toMatch(/Claude/);
    expect(readableText('/* Claude reads the sheets */\nconst a = 1;')).not.toMatch(/Claude/);
    expect(readableText("const s = 'Claude reads the sheets';")).toMatch(/Claude/);
    expect(readableText('<p>Claude reads the sheets</p>')).toMatch(/Claude/);
  });
});
