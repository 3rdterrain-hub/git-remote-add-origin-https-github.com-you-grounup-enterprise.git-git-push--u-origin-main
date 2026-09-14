/**
 * A value is not read before it exists.
 *
 * `takeoff.tsx` derived the sheet's measurements at the top of the component:
 *
 *     const measurements = measurementsQ.status === 'ready'
 *       ? measurementsQ.data.filter((m) => m.sheetId === sheetId) : [];
 *     ...
 *     const [sheetId, setSheetId] = useState('');
 *
 * `Array.prototype.filter` runs its callback *now*, while the component body is
 * still executing, so `sheetId` was read eight lines before its `const`. Every
 * render in which the query had answered threw
 * `ReferenceError: Cannot access 'sheetId' before initialization` — which is to
 * say the takeoff screen crashed for every company that had ever saved a
 * measurement, and worked perfectly for every company that had not.
 *
 * TypeScript will not catch this. It refuses a *direct* read before a
 * declaration (TS2448) and deliberately permits one inside a closure, because
 * in general a closure runs later. The array methods below are the case where
 * it does not: they call back immediately, so the ordinary rule applies and
 * nothing enforced it.
 *
 * So this walks the syntax tree and enforces it. GOVERNANCE.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'node:fs';
import ts from 'typescript';

const ROOT = join(import.meta.dirname, '../..');

/** Array methods that invoke their callback before they return. */
const IMMEDIATE = new Set([
  'filter', 'map', 'find', 'findIndex', 'findLast', 'findLastIndex',
  'some', 'every', 'reduce', 'reduceRight', 'forEach', 'flatMap', 'sort',
]);

interface Offense {
  file: string;
  line: number;
  name: string;
  declaredOn: number;
}

/** Every block-scoped name a function body declares, and where. */
function declarationsIn(body: ts.Node, source: ts.SourceFile) {
  const declared = new Map<string, number>();
  const walk = (node: ts.Node) => {
    /*
     * Only this function's own body. A nested function's declarations are its
     * own scope and shadow rather than clash.
     */
    if (node !== body && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
      || ts.isArrowFunction(node) || ts.isClassDeclaration(node))) return;
    if (ts.isVariableStatement(node)
      && (node.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let))) {
      for (const d of node.declarationList.declarations) {
        const line = source.getLineAndCharacterOfPosition(d.getStart(source)).line + 1;
        const names: string[] = [];
        const collect = (n: ts.BindingName) => {
          if (ts.isIdentifier(n)) names.push(n.text);
          else for (const el of n.elements) {
            if (ts.isBindingElement(el)) collect(el.name);
          }
        };
        collect(d.name);
        for (const n of names) if (!declared.has(n)) declared.set(n, line);
      }
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(body, walk);
  return declared;
}

function offensesIn(file: string): Offense[] {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Offense[] = [];

  const inspectFunction = (fn: ts.SignatureDeclaration & { body?: ts.Node }) => {
    const body = fn.body;
    if (!body) return;
    const declared = declarationsIn(body, source);
    if (declared.size === 0) return;

    const walkCalls = (node: ts.Node) => {
      /*
       * A nested function's body runs when *it* is called, not while this one
       * is still executing, so its reads are not this scope's hazard — and its
       * own `const columns` is a different binding from an outer one of the
       * same name. Each nested function is inspected in its own right by the
       * outer walk. Without this stop the check reported
       * `import-panel.tsx:141` for a local shadowing a later outer name.
       */
      if (node !== body && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
        || ts.isArrowFunction(node) || ts.isClassDeclaration(node))) return;
      if (ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && IMMEDIATE.has(node.expression.name.text)) {
        const callLine =
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        for (const arg of node.arguments) {
          if (!ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg)) continue;
          /* Names the callback binds itself are not the enclosing ones. */
          const bound = new Set<string>();
          for (const p of arg.parameters) {
            if (ts.isIdentifier(p.name)) bound.add(p.name.text);
          }
          const scan = (n: ts.Node) => {
            if (ts.isIdentifier(n)
              && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)
              && !(ts.isPropertyAssignment(n.parent) && n.parent.name === n)
              && !bound.has(n.text)) {
              const declaredOn = declared.get(n.text);
              if (declaredOn !== undefined && declaredOn > callLine) {
                found.push({ file, line: callLine, name: n.text, declaredOn });
              }
            }
            ts.forEachChild(n, scan);
          };
          ts.forEachChild(arg, scan);
        }
      }
      ts.forEachChild(node, walkCalls);
    };
    ts.forEachChild(body, walkCalls);
  };

  const walk = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
      || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) {
      inspectFunction(node as ts.SignatureDeclaration & { body?: ts.Node });
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(source, walk);
  return found;
}

describe('a value is not read before it exists', () => {
  const files = globSync('apps/web/src/**/*.{ts,tsx}', { cwd: ROOT })
    .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
    .map((f) => join(ROOT, f));

  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('never calls back into a binding that does not exist yet', () => {
    const offenses = files.flatMap(offensesIn);
    const said = offenses.map((o) =>
      `${o.file.slice(ROOT.length + 1)}:${o.line} reads "${o.name}", `
      + `declared on line ${o.declaredOn}`);
    expect(said).toEqual([]);
  });

  it('catches the shape that crashed the takeoff screen', () => {
    /*
     * The check earns its place by failing on the original. Written to a
     * string rather than a fixture file so it cannot be silently "fixed".
     */
    const original = `
      function Takeoff() {
        const measurementsQ = useQuery(loadMeasurements, []);
        const measurements = measurementsQ.status === 'ready'
          ? measurementsQ.data.filter((m) => m.sheetId === sheetId) : [];
        const [sheetId, setSheetId] = useState('');
        return null;
      }`;
    const tmp = join(ROOT, 'node_modules/.tmp-tdz-check.tsx');
    writeFileSync(tmp, original);
    try {
      const found = offensesIn(tmp);
      expect(found.map((f) => f.name)).toEqual(['sheetId']);
    } finally {
      rmSync(tmp, { force: true });
    }
  });
});
