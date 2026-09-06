/**
 * Every link goes somewhere.
 *
 * Deleting a screen is easy; finding the four tiles that still point at it is
 * not, and a dead link in a console is silent — the click does nothing and the
 * person assumes they misread the tile. The operator dashboard shipped with
 * `/admin/accounts` on a tile for exactly as long as it took somebody to click
 * it, because that screen was removed and the link was not.
 *
 * So this reads the router and the source, and refuses any internal link that
 * no route can serve. It is a lint rather than a behavior test, which is the
 * right shape: the failure it prevents is one nobody would write a behavior
 * test for.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/**
 * The routes the application declares, as patterns.
 *
 * Parsed out of App.tsx rather than imported, because importing it would pull
 * in every screen and every one of their dependencies to answer a question
 * about strings.
 */
function declaredRoutes(): string[] {
  const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
  const routes: string[] = [];
  // Nested <Route path="x"> inside <Route path="/parent"> — the parent is
  // tracked so a child path resolves to the full pattern.
  const lines = app.split('\n');
  const stack: string[] = [];
  for (const line of lines) {
    const open = line.match(/<Route\s+path="([^"]*)"/);
    if (open) {
      const path = open[1]!;
      const full = path.startsWith('/')
        ? path
        : `${stack[stack.length - 1] ?? ''}/${path}`.replace(/\/+/g, '/');
      routes.push(full);
      /*
       * Whether the tag closes itself, decided on the end of the line rather
       * than on containing "/>": `element={<AppShell />}` contains one and the
       * <Route> around it is still open.
       */
      if (!line.trimEnd().endsWith('/>')) stack.push(full);
    }
    if (line.includes('</Route>')) stack.pop();
  }
  return routes;
}

/** Does any declared route pattern serve this concrete path? */
function isServed(path: string, routes: string[]): boolean {
  const segments = path.split('/').filter(Boolean);
  return routes.some((pattern) => {
    if (pattern === '*') return true;
    const parts = pattern.split('/').filter(Boolean);
    if (parts.length !== segments.length) return false;
    return parts.every((part, i) => part.startsWith(':') || part === segments[i]);
  });
}

describe('internal links', () => {
  const routes = declaredRoutes();

  it('finds the routes the application declares', () => {
    expect(routes).toContain('/app/estimates');
    expect(routes).toContain('/admin/companies');
    expect(routes.length).toBeGreaterThan(20);
  });

  it('would have caught the link that went nowhere', () => {
    /*
     * The actual defect: `/admin/accounts` was on the operator dashboard's
     * "Given away" tile after that screen was deleted. A checker that passes
     * on a tree with no dead links proves nothing on its own.
     */
    expect(isServed('/admin/accounts', routes)).toBe(false);
    expect(isServed('/admin/companies', routes)).toBe(true);
  });

  it('follows a route with a parameter in it', () => {
    expect(isServed('/admin/companies/8f14e45f-ceea-467a-9575-9f0e5fb0a4c1', routes)).toBe(true);
    // But not one segment deeper than any route goes.
    expect(isServed('/admin/companies/abc/def/ghi', routes)).toBe(false);
  });

  it('serves every internal link in the source', () => {
    const dead: string[] = [];
    for (const file of walk(SRC)) {
      const source = readFileSync(file, 'utf8');
      // Only literal internal paths. A template or a variable is checked by
      // the router at runtime and is not knowable here.
      for (const m of source.matchAll(/\bto="(\/[a-z0-9/-]*)"/gi)) {
        const path = m[1]!;
        if (!isServed(path, routes)) {
          dead.push(`${file.replace(SRC, 'src')}: ${path}`);
        }
      }
    }
    expect(dead).toEqual([]);
  });
});
