import { describe, expect, it } from 'vitest';
import {
  expandAssembly, findAssemblyCycles, AssemblyCycleError, MAX_NESTING_DEPTH,
  type Assembly, type AssemblyComponent,
} from '../src/assemblies.js';

const c = (
  id: string, kind: AssemblyComponent['kind'], name: string, qty: number,
  extra: Partial<AssemblyComponent> = {},
): AssemblyComponent => ({
  id, sortOrder: 0, kind, referenceId: `${kind}-${id}`, name,
  quantityPerUnit: qty, ...extra,
});

/** A storm structure: the recipe an estimator forgets a piece of on the eleventh one. */
const STRUCTURE: Assembly = {
  id: 'A-STRM', code: 'ASM-STRM', name: 'Storm structure, 4 ft', quantityUnit: 'EA',
  components: [
    { ...c('c1', 'material', 'Precast barrel section', 3, { unit: 'EA', sortOrder: 1 }) },
    { ...c('c2', 'material', 'Frame and grate', 1, { unit: 'EA', sortOrder: 2 }) },
    { ...c('c3', 'material', 'Bedding stone', 1.5, { unit: 'TON', sortOrder: 3 }) },
    { ...c('c4', 'equipment', 'Excavator 20t', 2.5, { unit: 'HR', sortOrder: 4 }) },
    { ...c('c5', 'labor', 'Pipe crew', 5, { unit: 'HR', sortOrder: 5 }) },
    { ...c('c6', 'material', 'Bituminous seal', 1, { unit: 'EA', sortOrder: 6, isOptional: true }) },
  ],
};

describe('expanding a flat assembly', () => {
  const r = expandAssembly(STRUCTURE, 11);

  it('scales every component by the assembly quantity', () => {
    // 11 structures x 3 barrel sections = 33
    const barrel = r.components.find((x) => x.name.includes('barrel'))!;
    expect(barrel.quantity).toBe(33);
    // 11 x 1.5 TON = 16.5
    expect(r.components.find((x) => x.name.includes('Bedding'))!.quantity).toBe(16.5);
    // 11 x 5 HR = 55
    expect(r.components.find((x) => x.name.includes('crew'))!.quantity).toBe(55);
  });

  it('excludes an optional component unless it is chosen', () => {
    // An option nobody selected is a scope exclusion, not a silent inclusion.
    expect(r.components.some((x) => x.name.includes('Bituminous'))).toBe(false);
    expect(r.optionalExcluded).toEqual(['ASM-STRM: Bituminous seal']);
  });

  it('includes an optional component when it is chosen by id', () => {
    const chosen = expandAssembly(STRUCTURE, 11, { optional: new Set(['c6']) });
    expect(chosen.components.some((x) => x.name.includes('Bituminous'))).toBe(true);
    expect(chosen.optionalIncluded).toEqual(['ASM-STRM: Bituminous seal']);
  });

  it('includes every option when asked for all', () => {
    const all = expandAssembly(STRUCTURE, 2, { optional: 'all' });
    expect(all.components).toHaveLength(6);
  });

  it('totals quantity by component kind, keeping the buckets separate', () => {
    // material: 33 + 11 + 16.5 = 60.5
    expect(r.quantityByKind.material).toBe(60.5);
    expect(r.quantityByKind.equipment).toBe(27.5);
    expect(r.quantityByKind.labor).toBe(55);
    expect(r.countByKind.material).toBe(3);
  });

  it('keeps components in their declared order', () => {
    expect(r.components.map((x) => x.name)).toEqual([
      'Precast barrel section', 'Frame and grate', 'Bedding stone',
      'Excavator 20t', 'Pipe crew',
    ]);
  });

  it('shows the arithmetic for every component', () => {
    const barrel = r.components.find((x) => x.name.includes('barrel'))!;
    expect(barrel.derivation).toBe('Precast barrel section: 3 per EA x 11 EA = 33 EA');
  });

  it('reports a flat assembly as depth zero', () => {
    expect(r.maxDepth).toBe(0);
  });
});

describe('nesting', () => {
  const REBAR: Assembly = {
    id: 'A-RBR', code: 'ASM-RBR', name: 'Reinforcement', quantityUnit: 'CY',
    components: [{ ...c('r1', 'material', 'No. 4 bar', 85, { unit: 'LB' }) }],
  };
  const CONCRETE: Assembly = {
    id: 'A-CONC', code: 'ASM-CONC', name: 'Concrete in place', quantityUnit: 'CY',
    components: [
      { ...c('k1', 'material', '4000 psi mix', 1, { unit: 'CY', sortOrder: 1 }) },
      { id: 'k2', sortOrder: 2, kind: 'assembly', referenceId: 'A-RBR', name: 'Reinforcement', quantityPerUnit: 1 },
    ],
  };
  const APRON: Assembly = {
    id: 'A-APR', code: 'ASM-APR', name: 'Driveway apron', quantityUnit: 'EA',
    components: [
      { id: 'a1', sortOrder: 1, kind: 'assembly', referenceId: 'A-CONC', name: 'Concrete in place', quantityPerUnit: 0.4 },
      { ...c('a2', 'labor', 'Finisher', 1.5, { unit: 'HR', sortOrder: 2 }) },
    ],
  };
  const library = new Map([[REBAR.id, REBAR], [CONCRETE.id, CONCRETE], [APRON.id, APRON]]);

  it('multiplies quantities down the tree', () => {
    // 6 aprons x 0.4 CY concrete = 2.4 CY mix
    // 2.4 CY x 85 LB rebar per CY = 204 LB
    const r = expandAssembly(APRON, 6, { library });
    expect(r.components.find((x) => x.name.includes('mix'))!.quantity).toBe(2.4);
    expect(r.components.find((x) => x.name.includes('No. 4'))!.quantity).toBe(204);
    expect(r.components.find((x) => x.name === 'Finisher')!.quantity).toBe(9);
  });

  it('records the path a nested quantity came through', () => {
    const r = expandAssembly(APRON, 6, { library });
    expect(r.components.find((x) => x.name.includes('No. 4'))!.path)
      .toBe('ASM-APR > ASM-CONC > ASM-RBR > No. 4 bar');
  });

  it('reports the nesting depth reached', () => {
    const r = expandAssembly(APRON, 1, { library });
    expect(r.maxDepth).toBe(2);
    expect(r.expandedAssemblies).toEqual(['ASM-APR', 'ASM-CONC', 'ASM-RBR']);
  });

  it('warns rather than silently dropping a nested assembly it was not given', () => {
    const r = expandAssembly(APRON, 6, { library: new Map([[APRON.id, APRON]]) });
    // Pretending the nested assembly is empty would under-quantify the job
    // without saying so.
    expect(r.components.map((x) => x.name)).toEqual(['Finisher']);
    expect(r.warnings.join(' ')).toContain('was not supplied');
  });
});

describe('cycles', () => {
  const A: Assembly = {
    id: 'A', code: 'ASM-A', name: 'A', quantityUnit: 'EA',
    components: [{ id: 'x', sortOrder: 1, kind: 'assembly', referenceId: 'B', name: 'B', quantityPerUnit: 1 }],
  };
  const B: Assembly = {
    id: 'B', code: 'ASM-B', name: 'B', quantityUnit: 'EA',
    components: [{ id: 'y', sortOrder: 1, kind: 'assembly', referenceId: 'A', name: 'A', quantityPerUnit: 1 }],
  };
  const library = new Map([['A', A], ['B', B]]);

  it('refuses an indirect cycle by name', () => {
    // The database only prevents an assembly nesting itself directly. A
    // through B back to A would recurse until the stack gave out.
    expect(() => expandAssembly(A, 1, { library })).toThrow(AssemblyCycleError);
    expect(() => expandAssembly(A, 1, { library })).toThrow(/ASM-A > ASM-B > ASM-A/);
  });

  it('finds cycles in a library without expanding anything', () => {
    const cycles = findAssemblyCycles(library);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toContain('ASM-A');
    expect(cycles[0]).toContain('ASM-B');
  });

  it('reports no cycle in a well-formed library', () => {
    expect(findAssemblyCycles(new Map([[STRUCTURE.id, STRUCTURE]]))).toEqual([]);
  });

  it('refuses nesting deeper than the limit', () => {
    // A chain of MAX + 2 assemblies, each nesting the next.
    const deep = new Map<string, Assembly>();
    for (let i = 0; i <= MAX_NESTING_DEPTH + 1; i++) {
      deep.set(`D${i}`, {
        id: `D${i}`, code: `ASM-D${i}`, name: `D${i}`, quantityUnit: 'EA',
        components: i < MAX_NESTING_DEPTH + 1
          ? [{ id: `n${i}`, sortOrder: 1, kind: 'assembly', referenceId: `D${i + 1}`, name: `D${i + 1}`, quantityPerUnit: 1 }]
          : [{ ...c('leaf', 'material', 'Leaf', 1) }],
      });
    }
    expect(() => expandAssembly(deep.get('D0')!, 1, { library: deep }))
      .toThrow(/nests deeper than/);
  });
});

describe('validation and edge cases', () => {
  it('refuses a negative assembly quantity', () => {
    expect(() => expandAssembly(STRUCTURE, -1)).toThrow(RangeError);
  });

  it('refuses a negative component quantity', () => {
    const bad: Assembly = { ...STRUCTURE, components: [c('b', 'material', 'Bad', -2)] };
    expect(() => expandAssembly(bad, 1)).toThrow(RangeError);
  });

  it('warns when an assembly expands to nothing', () => {
    const empty: Assembly = { ...STRUCTURE, components: [] };
    expect(expandAssembly(empty, 5).warnings.join(' ')).toContain('no components');
  });

  it('warns when expanded at zero quantity', () => {
    const r = expandAssembly(STRUCTURE, 0);
    expect(r.warnings.join(' ')).toContain('quantity of zero');
    expect(r.components.every((x) => x.quantity === 0)).toBe(true);
  });

  it('produces a derivation naming the assembly and its component count', () => {
    const r = expandAssembly(STRUCTURE, 11);
    expect(r.derivation[0]).toBe('ASM-STRM "Storm structure, 4 ft" x 11 EA expanded to 5 component line(s)');
    expect(r.derivation.length).toBe(1 + 5 + 1); // header, components, exclusions
  });
});
