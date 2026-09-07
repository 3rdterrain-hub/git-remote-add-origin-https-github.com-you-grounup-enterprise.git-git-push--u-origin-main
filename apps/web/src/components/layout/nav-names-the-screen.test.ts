import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every screen is called what the navigation calls it.
 *
 * The dashboard was headed "Good morning, Tyree". It was a nice sentence and it
 * was the wrong one: somebody clicked "Dashboard" and arrived at a screen that
 * never said the word, so confirming they were in the right place cost them an
 * inference on every visit. Four other screens introduced themselves under a
 * different name than the link that reached them.
 *
 * The rule is that a page's heading *starts with* its navigation label. It may
 * say more — "Claims & Change Management" under a link that says "Claims" is
 * the label plus what else lives there — but the first words have to match, so
 * the eye confirms the arrival without reading a whole line.
 *
 * This reads source rather than rendering, deliberately: it covers every screen
 * in the navigation, including ones whose data layer would need a mock apiece,
 * and it cannot be satisfied by a heading that only appears under some state.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const app = read('App.tsx');
const shell = read('components/layout/app-shell.tsx');

/** `const EstimatesPage = lazy(() => import('@/pages/app/estimates')…` */
const modules = new Map(
  [...app.matchAll(/const (\w+) = lazy\(\(\) => import\('@\/([^']+)'\)/g)]
    .map((m) => [m[1]!, `${m[2]!}.tsx`] as [string, string]),
);

/** Routes nested under `/app`, plus its index. */
const appBlock = app.slice(app.indexOf('path="/app" element={<AppShell />}'));
const routes = new Map<string, string>(
  [...appBlock.matchAll(/<Route path="([^"]+)" element=\{<(\w+) \/>\}/g)]
    .map((m) => [m[1]!, m[2]!] as [string, string]),
);
const index = appBlock.match(/<Route index element=\{<(\w+) \/>\}/);
if (index) routes.set('', index[1]!);

const nav = [...shell.matchAll(/\{ to: '([^']+)', label: '([^']+)'/g)]
  .map((m) => ({ to: m[1]!, label: m[2]! }));

/**
 * The title on a `PageHeader`. Accepts a string literal; a computed title is
 * reported as such rather than guessed at, because a heading assembled at run
 * time is exactly the case this test exists to catch.
 */
function headerTitle(source: string): string | null {
  const at = source.indexOf('<PageHeader');
  if (at === -1) return null;
  const literal = source.slice(at).match(/\btitle="([^"]*)"/);
  return literal ? literal[1]! : null;
}

describe('the navigation names the screen it opens', () => {
  it('finds every screen the navigation offers', () => {
    expect(nav.length).toBeGreaterThanOrEqual(21);
    for (const { to } of nav) {
      expect(routes.has(to.replace(/^\/app\/?/, '')), `${to} has no route`).toBe(true);
    }
  });

  it.each(nav)('$label opens a screen headed "$label…"', ({ to, label }) => {
    const component = routes.get(to.replace(/^\/app\/?/, ''));
    const module = modules.get(component ?? '');
    expect(module, `${to} → ${component} is not a lazy-imported page`).toBeTruthy();

    const title = headerTitle(read(module!));
    expect(title, `${module} has no PageHeader with a literal title`).not.toBeNull();
    expect(
      title!.startsWith(label),
      `"${label}" in the navigation opens a screen headed "${title}"`,
    ).toBe(true);
  });
});
