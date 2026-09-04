import { describe, expect, it } from 'vitest';
import {
  resolveHierarchy, rollUp, PARAMETRIC_METHOD,
  type HierarchyNode, type NodeCost,
} from '../src/hierarchy.js';

/**
 * Building an estimate from the top down.
 *
 * A bid begins as a shape — forty lots, a mile of roadway — and the quantities
 * follow from it. Before this the platform could only be told about work one
 * priced line at a time, which is how an estimate is finished rather than how
 * one is started.
 *
 * `parent_line_id` has been in the schema since migration 0006 and faithfully
 * copied by every revision since, and nothing ever computed with it.
 */
const node = (over: Partial<HierarchyNode> & Pick<HierarchyNode, 'id'>): HierarchyNode => ({
  description: over.id, unit: 'EA', ...over,
});

/** A subdivision: forty lots, two catch basins each, a sanitary run per lot. */
const subdivision: HierarchyNode[] = [
  node({ id: 'site', description: 'Kingsway subdivision', unit: 'EA',
         measuredQuantity: 40, sortOrder: 0 }),
  node({ id: 'storm', description: 'Storm', parentId: 'site', unit: 'EA',
         measuredQuantity: 1, sortOrder: 10 }),
  node({ id: 'basins', description: 'Catch basins', parentId: 'storm', unit: 'EA',
         quantityBasis: { kind: 'per_parent_unit', perUnit: 2 }, sortOrder: 10 }),
  node({ id: 'sanitary', description: 'Sanitary', parentId: 'site', unit: 'LF',
         quantityBasis: { kind: 'per_parent_unit', perUnit: 85 }, sortOrder: 20 }),
];

describe('resolving the structure', () => {
  it('orders parents before their children', () => {
    const r = resolveHierarchy(subdivision);
    expect(r.order.indexOf('site')).toBeLessThan(r.order.indexOf('storm'));
    expect(r.order.indexOf('storm')).toBeLessThan(r.order.indexOf('basins'));
  });

  it('drives a child quantity from its parent', () => {
    // 85 LF of sanitary for each of 40 lots.
    const r = resolveHierarchy(subdivision);
    const sanitary = r.nodes.find((n) => n.id === 'sanitary')!;
    expect(sanitary.quantity).toBe(3400);
    expect(sanitary.derivation).toMatch(/85 per EA x 40 EA/);
  });

  it('changes every driven quantity when the shape changes', () => {
    /*
     * The whole point of entering the shape first. Forty lots becomes sixty and
     * the sanitary run follows without anybody retyping it.
     */
    const bigger = subdivision.map((n) =>
      n.id === 'site' ? { ...n, measuredQuantity: 60 } : n);
    const r = resolveHierarchy(bigger);
    expect(r.nodes.find((n) => n.id === 'sanitary')!.quantity).toBe(5100);
  });

  it('drives through more than one level', () => {
    // Basins are per storm system, and storm is one per site — so the multiplier
    // compounds down the tree rather than reading the root.
    const r = resolveHierarchy(subdivision);
    expect(r.nodes.find((n) => n.id === 'basins')!.quantity).toBe(2);
  });

  it('records where each line sits', () => {
    const r = resolveHierarchy(subdivision);
    expect(r.nodes.find((n) => n.id === 'basins')!.path)
      .toEqual(['Kingsway subdivision', 'Storm', 'Catch basins']);
    expect(r.nodes.find((n) => n.id === 'basins')!.depth).toBe(2);
  });

  it('marks a line with children as a rollup', () => {
    const r = resolveHierarchy(subdivision);
    expect(r.nodes.find((n) => n.id === 'site')!.isRollup).toBe(true);
    expect(r.nodes.find((n) => n.id === 'basins')!.isRollup).toBe(false);
  });

  it('sorts siblings by their stored order, not however they arrived', () => {
    const r = resolveHierarchy([...subdivision].reverse());
    const site = r.nodes.find((n) => n.id === 'site')!;
    expect(site.childIds).toEqual(['storm', 'sanitary']);
  });

  // ------------------------------------------------------------- refusals
  it('refuses a parent that is not in the estimate', () => {
    expect(() => resolveHierarchy([node({ id: 'a', parentId: 'ghost' })]))
      .toThrow(/names a parent that is not in this estimate/);
  });

  it('refuses a line that is its own parent', () => {
    expect(() => resolveHierarchy([node({ id: 'a', parentId: 'a' })]))
      .toThrow(/its own parent/);
  });

  it('refuses a cycle', () => {
    expect(() => resolveHierarchy([
      node({ id: 'a', parentId: 'b' }), node({ id: 'b', parentId: 'a' }),
    ])).toThrow(/cycle/);
  });

  it('refuses a longer cycle hanging off a real root', () => {
    /*
     * The nastier shape: a valid root exists, so the walk starts, and three
     * lines point round in a ring that is never reached. Detected by counting
     * what was visited rather than by hoping the walk stumbles into it.
     */
    expect(() => resolveHierarchy([
      node({ id: 'root' }),
      node({ id: 'a', parentId: 'c' }),
      node({ id: 'b', parentId: 'a' }),
      node({ id: 'c', parentId: 'b' }),
    ])).toThrow(/unreachable from any root/);
  });

  it('refuses two lines with the same id', () => {
    expect(() => resolveHierarchy([node({ id: 'a' }), node({ id: 'a' })]))
      .toThrow(/share the id/);
  });

  it('refuses a driven quantity with no parent to be driven by', () => {
    expect(() => resolveHierarchy([
      node({ id: 'a', quantityBasis: { kind: 'per_parent_unit', perUnit: 2 } }),
    ])).toThrow(/quantified per parent unit and has no parent/);
  });

  it('refuses a per-unit factor of zero', () => {
    expect(() => resolveHierarchy([
      node({ id: 'p', measuredQuantity: 10 }),
      node({ id: 'c', parentId: 'p', quantityBasis: { kind: 'per_parent_unit', perUnit: 0 } }),
    ])).toThrow(/positive quantity per parent unit/);
  });

  it('warns when a line is both measured and driven, and uses the driver', () => {
    /*
     * Two answers to the same question. The driver wins, because that is what
     * driving means, and the discrepancy is reported — it usually means the
     * line was measured before it was reparented.
     */
    const r = resolveHierarchy([
      node({ id: 'p', measuredQuantity: 40 }),
      node({ id: 'c', description: 'Basins', parentId: 'p', measuredQuantity: 99,
             quantityBasis: { kind: 'per_parent_unit', perUnit: 2 } }),
    ]);
    expect(r.nodes.find((n) => n.id === 'c')!.quantity).toBe(80);
    expect(r.warnings.join(' ')).toMatch(/carries a measured quantity of 99/);
  });
});

describe('a conceptual line', () => {
  it('prices at a rate, and says where the rate came from', () => {
    const r = resolveHierarchy([
      node({ id: 'bldg', description: 'Building pad', unit: 'SF', measuredQuantity: 12000,
             parametric: { costPerUnit: 4.25, basis: 'Three comparable pads, 2025-2026' } }),
    ]);
    const rolled = rollUp(r, []);
    expect(rolled.total).toBe(51000);
    expect(r.nodes[0]!.derivation).toMatch(/comparable pads/);
  });

  it('refuses a rate with no attribution', () => {
    // An unattributable rate is a guess, and a guess that looks like a price is
    // the most expensive thing an estimate can carry.
    expect(() => resolveHierarchy([
      node({ id: 'a', measuredQuantity: 100, parametric: { costPerUnit: 5, basis: '  ' } }),
    ])).toThrow(/does not say where the rate came from/);
  });

  it('refuses to be both a rate and a rollup', () => {
    expect(() => resolveHierarchy([
      node({ id: 'p', measuredQuantity: 1,
             parametric: { costPerUnit: 5, basis: 'experience' } }),
      node({ id: 'c', parentId: 'p', measuredQuantity: 1 }),
    ])).toThrow(/one or the other, not both/);
  });

  it('is the weakest method on the scale, and stays there', () => {
    /*
     * The honesty of the whole feature rests on this. A conceptual number that
     * scored like a measured one would let a rate-per-square-foot reach a
     * customer through the same approval gate as a taken-off quantity.
     */
    expect(PARAMETRIC_METHOD).toBe('estimator_allowance');
  });
});

describe('rolling costs up', () => {
  const costs: NodeCost[] = [
    { id: 'basins', ownCost: 9600, ownLaborHours: 48 },
    { id: 'sanitary', ownCost: 214200, ownLaborHours: 620, ownEquipmentHours: 310 },
  ];

  it('gives a parent its children total', () => {
    const rolled = rollUp(resolveHierarchy(subdivision), costs);
    expect(rolled.nodes.find((n) => n.id === 'storm')!.totalCost).toBe(9600);
    expect(rolled.nodes.find((n) => n.id === 'site')!.totalCost).toBe(223800);
    expect(rolled.total).toBe(223800);
  });

  it('keeps a heading line distinct from the work beneath it', () => {
    // "Storm" is a heading and does no work of its own. Reporting its own cost
    // as its total would make an estimate impossible to read at any level.
    const rolled = rollUp(resolveHierarchy(subdivision), costs);
    const storm = rolled.nodes.find((n) => n.id === 'storm')!;
    expect(storm.ownCost).toBe(0);
    expect(storm.totalCost).toBe(9600);
  });

  it('adds a line own work to its children rather than dropping one', () => {
    /*
     * A line can carry both. Adding them is the only reading that does not
     * silently lose one, and quietly dropping the parent's own resources is the
     * kind of error that shows up as a margin nobody can explain.
     */
    const rolled = rollUp(resolveHierarchy(subdivision),
      [...costs, { id: 'storm', ownCost: 1500 }]);
    expect(rolled.nodes.find((n) => n.id === 'storm')!.totalCost).toBe(11100);
    expect(rolled.total).toBe(225300);
  });

  it('reports a unit cost against the line own quantity', () => {
    const rolled = rollUp(resolveHierarchy(subdivision), costs);
    // 223,800 over 40 lots.
    expect(rolled.nodes.find((n) => n.id === 'site')!.unitCost).toBe(5595);
  });

  it('rolls hours up as well as money', () => {
    const rolled = rollUp(resolveHierarchy(subdivision), costs);
    expect(rolled.nodes.find((n) => n.id === 'site')!.laborHours).toBe(668);
    expect(rolled.totalEquipmentHours).toBe(310);
  });

  it('adds the roots rather than double counting the tree', () => {
    // The commonest arithmetic error in a work breakdown structure: summing
    // every node instead of the roots, so every cost is counted once per level.
    const rolled = rollUp(resolveHierarchy(subdivision), costs);
    const everyNode = rolled.nodes.reduce((a, n) => a + n.totalCost, 0);
    expect(everyNode).toBeGreaterThan(rolled.total);
    expect(rolled.total).toBe(223800);
  });

  it('reports zero for a line nothing priced', () => {
    const rolled = rollUp(resolveHierarchy(subdivision), []);
    expect(rolled.total).toBe(0);
  });

  it('handles an estimate with nothing in it', () => {
    const r = resolveHierarchy([]);
    expect(rollUp(r, []).total).toBe(0);
    expect(r.nodes).toEqual([]);
  });
});
