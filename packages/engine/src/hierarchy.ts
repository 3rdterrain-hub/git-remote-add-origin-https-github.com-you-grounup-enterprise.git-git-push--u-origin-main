/**
 * Building an estimate from the top down.
 *
 * The platform could only ever be told about work one priced line at a time,
 * which is how an estimate is finished and not how one is started. A bid begins
 * as a shape — a subdivision of forty lots, a mile of roadway, four buildings —
 * and the quantities follow from that shape rather than preceding it.
 *
 * `estimate_line_items.parent_line_id` has existed since migration 0006 and has
 * been faithfully copied by every revision since. Nothing has ever computed
 * with it: the engine takes a flat list. So the hierarchy was stored, carried
 * forward, and meant nothing.
 *
 * Three things make top-down real, and they are separable:
 *
 *   1. **A tree that rolls up.** A parent's cost is its own work plus
 *      everything beneath it. That is a work breakdown structure, and it is
 *      what lets somebody read an estimate at the level they care about.
 *   2. **Quantities that flow down.** A child whose quantity is "two per lot"
 *      is answered by the parent's quantity. Change forty lots to sixty and
 *      every driven quantity beneath it changes, which is the whole point of
 *      entering the shape first.
 *   3. **A conceptual line, honestly labelled.** Early in a bid there are no
 *      drawings and the number is a rate per square foot from experience. That
 *      is a real and useful estimate and it is not a priced build-up, so it
 *      carries `estimator_allowance` — the weakest method on the scale — and
 *      the confidence engine and approval gate treat it accordingly. A
 *      conceptual number that scored like a measured one would be the most
 *      expensive lie the platform could tell.
 *
 * Deliberately absent: a child whose quantity is a percentage of its parent's
 * *cost*. It sounds symmetrical and it is not — cost is not known until the
 * subtree is priced, and the quantity would then depend on the price it is used
 * to compute. Percentage-of-cost belongs to indirects, where the estimate-level
 * arithmetic already handles it without circularity.
 */
import { roundTo, safeDivide } from './numeric.js';
import type { Unit } from './units.js';
import type { MeasurementMethod } from './quantity.js';

/** How a line's quantity is arrived at. */
export type QuantityBasis =
  /** Entered or measured directly. Every line worked this way before. */
  | { kind: 'measured' }
  /**
   * Driven by the parent: `perUnit` of this line for every one of the parent.
   * Two catch basins per lot, forty feet of pipe per station.
   */
  | { kind: 'per_parent_unit'; perUnit: number };

/** A line priced at a rate rather than built up. */
export interface ParametricPricing {
  /** Cost for one unit of this line's quantity. */
  costPerUnit: number;
  /** Where the rate came from. Required: an unattributable rate is a guess. */
  basis: string;
}

export interface HierarchyNode {
  id: string;
  parentId?: string;
  description: string;
  sortOrder?: number;
  /** Only meaningful where the basis is `measured`. */
  measuredQuantity?: number;
  unit: Unit;
  quantityBasis?: QuantityBasis;
  parametric?: ParametricPricing;
}

export interface ResolvedNode {
  id: string;
  parentId?: string;
  description: string;
  unit: Unit;
  depth: number;
  /** Ordered path from the root, so a line can say where it sits. */
  path: readonly string[];
  quantity: number;
  quantityBasis: QuantityBasis;
  /** Present only on a conceptual line. */
  parametric?: ParametricPricing;
  /** True where this node has children, whose costs roll into it. */
  isRollup: boolean;
  childIds: readonly string[];
  derivation: string;
  warnings: readonly string[];
}

export interface HierarchyResult {
  nodes: readonly ResolvedNode[];
  /** Root-first, parents always before their children. */
  order: readonly string[];
  warnings: readonly string[];
}

/**
 * The measurement method a conceptual line must carry.
 *
 * Exported rather than buried, because the honesty of a top-down estimate rests
 * entirely on this being applied and not quietly upgraded.
 */
export const PARAMETRIC_METHOD: MeasurementMethod = 'estimator_allowance';

/**
 * Resolve a set of lines into a tree with quantities flowing down.
 *
 * Refuses rather than guesses. A cycle, a parent that does not exist, a driven
 * quantity with no parent to be driven by — each is a broken estimate, and
 * carrying on with a zero would produce a confident total for a structure that
 * does not hold together.
 */
export function resolveHierarchy(input: readonly HierarchyNode[]): HierarchyResult {
  const warnings: string[] = [];
  const byId = new Map<string, HierarchyNode>();

  for (const n of input) {
    if (byId.has(n.id)) {
      throw new RangeError(`Two lines share the id ${JSON.stringify(n.id)}`);
    }
    byId.set(n.id, n);
  }

  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const n of input) {
    if (n.parentId === undefined) { roots.push(n.id); continue; }
    if (n.parentId === n.id) {
      throw new RangeError(`Line ${JSON.stringify(n.id)} is its own parent`);
    }
    if (!byId.has(n.parentId)) {
      throw new RangeError(
        `Line ${JSON.stringify(n.id)} names a parent that is not in this estimate: `
        + JSON.stringify(n.parentId));
    }
    const list = children.get(n.parentId);
    if (list) list.push(n.id); else children.set(n.parentId, [n.id]);
  }

  // A cycle among lines that all name a parent leaves no root at all.
  if (roots.length === 0 && input.length > 0) {
    throw new RangeError('Every line names a parent, so the structure is a cycle');
  }

  const order: string[] = [];
  const resolved = new Map<string, ResolvedNode>();
  const seen = new Set<string>();

  const sortSiblings = (ids: readonly string[]) =>
    [...ids].sort((a, b) => {
      const x = byId.get(a)!, y = byId.get(b)!;
      const s = (x.sortOrder ?? 0) - (y.sortOrder ?? 0);
      return s !== 0 ? s : a.localeCompare(b);
    });

  const walk = (id: string, depth: number, path: readonly string[]) => {
    if (seen.has(id)) {
      throw new RangeError(
        `The line structure contains a cycle, reached again at ${JSON.stringify(id)}`);
    }
    seen.add(id);

    const n = byId.get(id)!;
    const parent = n.parentId ? resolved.get(n.parentId) : undefined;
    const kids = sortSiblings(children.get(id) ?? []);
    const basis: QuantityBasis = n.quantityBasis ?? { kind: 'measured' };
    const nodeWarnings: string[] = [];

    let quantity: number;
    let derivation: string;

    if (basis.kind === 'per_parent_unit') {
      if (!parent) {
        throw new RangeError(
          `"${n.description}" is quantified per parent unit and has no parent`);
      }
      if (!(basis.perUnit > 0)) {
        throw new RangeError(
          `"${n.description}" needs a positive quantity per parent unit`);
      }
      quantity = roundTo(parent.quantity * basis.perUnit, 6);
      derivation =
        `${basis.perUnit} per ${parent.unit} x ${parent.quantity} ${parent.unit} `
        + `of "${parent.description}" = ${quantity} ${n.unit}`;
      if (n.measuredQuantity !== undefined && n.measuredQuantity !== quantity) {
        /*
         * A driven quantity that also carries a measured one is two answers to
         * the same question. The driver wins — that is what driving means — and
         * the discrepancy is reported rather than swallowed, because it usually
         * means somebody measured this line before it was reparented.
         */
        nodeWarnings.push(
          `"${n.description}" carries a measured quantity of ${n.measuredQuantity} `
          + `${n.unit} and is driven by its parent to ${quantity} ${n.unit}. `
          + 'The driven quantity is used.');
      }
    } else {
      quantity = n.measuredQuantity ?? 0;
      derivation = `${quantity} ${n.unit} measured`;
    }

    if (n.parametric) {
      if (kids.length > 0) {
        throw new RangeError(
          `"${n.description}" is priced at a rate and also has ${kids.length} `
          + 'lines beneath it. It can be one or the other, not both.');
      }
      if (!(n.parametric.costPerUnit >= 0)) {
        throw new RangeError(`"${n.description}" needs a rate of zero or more`);
      }
      if (!n.parametric.basis || n.parametric.basis.trim().length === 0) {
        throw new RangeError(
          `"${n.description}" is priced at a rate and does not say where the rate `
          + 'came from. An unattributable rate is a guess.');
      }
      derivation += ` at ${n.parametric.costPerUnit} per ${n.unit} (${n.parametric.basis})`;
    }

    order.push(id);
    resolved.set(id, {
      id,
      ...(n.parentId === undefined ? {} : { parentId: n.parentId }),
      description: n.description,
      unit: n.unit,
      depth,
      path: [...path, n.description],
      quantity,
      quantityBasis: basis,
      ...(n.parametric ? { parametric: n.parametric } : {}),
      isRollup: kids.length > 0,
      childIds: kids,
      derivation,
      warnings: nodeWarnings,
    });
    warnings.push(...nodeWarnings);

    for (const kid of kids) walk(kid, depth + 1, [...path, n.description]);
  };

  for (const root of sortSiblings(roots)) walk(root, 0, []);

  // A node never reached is in a cycle that does not touch a root.
  if (resolved.size !== byId.size) {
    const orphaned = [...byId.keys()].filter((id) => !resolved.has(id));
    throw new RangeError(
      `${orphaned.length} line(s) are unreachable from any root, which means a cycle: `
      + orphaned.slice(0, 5).map((o) => JSON.stringify(o)).join(', '));
  }

  return { nodes: order.map((id) => resolved.get(id)!), order, warnings };
}

/** A cost per line, from whatever priced it. */
export interface NodeCost {
  id: string;
  /** This line's own work, excluding anything beneath it. */
  ownCost: number;
  /** This line's own hours, excluding anything beneath it. */
  ownLaborHours?: number;
  ownEquipmentHours?: number;
}

export interface RolledNode extends ResolvedNode {
  ownCost: number;
  /** Own plus everything beneath. What a reader of this level wants. */
  totalCost: number;
  /** Cost of one unit of this line's quantity, including its children. */
  unitCost: number;
  laborHours: number;
  equipmentHours: number;
}

export interface RollupResult {
  nodes: readonly RolledNode[];
  /** The sum of the roots, which is the estimate's direct cost. */
  total: number;
  totalLaborHours: number;
  totalEquipmentHours: number;
}

/**
 * Roll costs up the tree.
 *
 * A parent's total is its own work plus its children's totals. Own work is
 * usually nothing on a structural line — "Sanitary sewer" is a heading — but it
 * need not be: a line can carry both its own resources and children beneath it,
 * and adding them is the only reading that does not silently drop one.
 *
 * Costs are supplied rather than computed. This module arranges; the estimating
 * engine prices. Keeping those apart is what stops a second opinion about cost
 * appearing here.
 */
export function rollUp(
  hierarchy: HierarchyResult,
  costs: readonly NodeCost[],
): RollupResult {
  const own = new Map(costs.map((c) => [c.id, c]));
  const totals = new Map<string, { cost: number; labor: number; equipment: number }>();

  // The resolved order is parents-before-children, so reversing it visits every
  // child before its parent.
  for (const node of [...hierarchy.nodes].reverse()) {
    const mine = own.get(node.id);
    let cost = mine?.ownCost ?? 0;
    let labor = mine?.ownLaborHours ?? 0;
    let equipment = mine?.ownEquipmentHours ?? 0;

    if (node.parametric) {
      cost += roundTo(node.parametric.costPerUnit * node.quantity, 2);
    }

    for (const childId of node.childIds) {
      const child = totals.get(childId);
      if (!child) continue;
      cost += child.cost;
      labor += child.labor;
      equipment += child.equipment;
    }
    totals.set(node.id, {
      cost: roundTo(cost, 2), labor: roundTo(labor, 4), equipment: roundTo(equipment, 4),
    });
  }

  const nodes: RolledNode[] = hierarchy.nodes.map((node) => {
    const t = totals.get(node.id)!;
    const mine = own.get(node.id);
    const ownCost = roundTo(
      (mine?.ownCost ?? 0)
      + (node.parametric ? node.parametric.costPerUnit * node.quantity : 0), 2);
    return {
      ...node,
      ownCost,
      totalCost: t.cost,
      unitCost: roundTo(safeDivide(t.cost, node.quantity), 4),
      laborHours: t.labor,
      equipmentHours: t.equipment,
    };
  });

  const roots = nodes.filter((n) => n.parentId === undefined);
  return {
    nodes,
    total: roundTo(roots.reduce((a, n) => a + n.totalCost, 0), 2),
    totalLaborHours: roundTo(roots.reduce((a, n) => a + n.laborHours, 0), 4),
    totalEquipmentHours: roundTo(roots.reduce((a, n) => a + n.equipmentHours, 0), 4),
  };
}
