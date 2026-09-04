import type { Unit } from './units.js';
import type { MeasurementMethod } from './quantity.js';
/** How a line's quantity is arrived at. */
export type QuantityBasis = 
/** Entered or measured directly. Every line worked this way before. */
{
    kind: 'measured';
}
/**
 * Driven by the parent: `perUnit` of this line for every one of the parent.
 * Two catch basins per lot, forty feet of pipe per station.
 */
 | {
    kind: 'per_parent_unit';
    perUnit: number;
};
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
export declare const PARAMETRIC_METHOD: MeasurementMethod;
/**
 * Resolve a set of lines into a tree with quantities flowing down.
 *
 * Refuses rather than guesses. A cycle, a parent that does not exist, a driven
 * quantity with no parent to be driven by — each is a broken estimate, and
 * carrying on with a zero would produce a confident total for a structure that
 * does not hold together.
 */
export declare function resolveHierarchy(input: readonly HierarchyNode[]): HierarchyResult;
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
export declare function rollUp(hierarchy: HierarchyResult, costs: readonly NodeCost[]): RollupResult;
