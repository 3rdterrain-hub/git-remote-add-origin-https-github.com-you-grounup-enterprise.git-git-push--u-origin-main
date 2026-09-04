/**
 * Assembly expansion.
 *
 * An assembly is a recipe: "storm structure, 4 ft diameter" is a precast
 * barrel, a casting, a frame and grate, bedding stone, an excavator hour and a
 * two-person crew. Estimating with assemblies is what stops an estimator
 * forgetting the frame and grate on the eleventh structure.
 *
 * Expansion turns the recipe into flat, quantified component lines. Three
 * things make it more than a loop:
 *
 *   * **Nesting.** An assembly may contain another. A driveway apron contains a
 *     concrete assembly which contains a reinforcement assembly.
 *   * **Cycles.** The database prevents an assembly nesting *itself*, but not
 *     A containing B containing A. Expanding that would recurse until the stack
 *     gave out, and a partially expanded assembly would silently under-quantify
 *     the job. Cycles are detected and refused by name.
 *   * **Options.** A component may be optional — a bituminous seal that some
 *     owners specify and others do not. What was included has to be visible on
 *     the estimate, because an excluded option is a scope exclusion.
 */
export type ComponentKind = 'task' | 'labor' | 'equipment' | 'material' | 'assembly' | 'subcontract' | 'trucking';
export declare const COMPONENT_KINDS: readonly ComponentKind[];
export interface AssemblyComponent {
    id: string;
    sortOrder: number;
    kind: ComponentKind;
    /** Task, labor rate, equipment, material or nested assembly id. */
    referenceId: string;
    name: string;
    /** How much of this component one unit of the parent assembly needs. */
    quantityPerUnit: number;
    unit?: string;
    isOptional?: boolean;
    notes?: string;
}
export interface Assembly {
    id: string;
    code: string;
    name: string;
    quantityUnit: string;
    components: readonly AssemblyComponent[];
}
export interface ExpandedComponent {
    /** `ASM-STORM > ASM-CONCRETE > 4000 psi mix`, so a quantity can be traced. */
    path: string;
    componentId: string;
    kind: ComponentKind;
    referenceId: string;
    name: string;
    unit?: string;
    /** Depth below the requested assembly; 0 is a direct component. */
    depth: number;
    /** The assembly this component came from. */
    fromAssemblyCode: string;
    /** Quantity per one unit of the *requested* assembly, after nesting. */
    quantityPerRootUnit: number;
    /** Quantity for the requested assembly quantity. */
    quantity: number;
    isOptional: boolean;
    derivation: string;
}
export interface ExpansionResult {
    assemblyId: string;
    assemblyCode: string;
    assemblyName: string;
    quantity: number;
    unit: string;
    components: readonly ExpandedComponent[];
    /** Total quantity per component kind, for the cost buckets (RULE-001). */
    quantityByKind: Readonly<Record<ComponentKind, number>>;
    countByKind: Readonly<Record<ComponentKind, number>>;
    /** Deepest nesting reached. 0 means the assembly is flat. */
    maxDepth: number;
    optionalIncluded: readonly string[];
    optionalExcluded: readonly string[];
    /** Nested assemblies expanded, in the order they were visited. */
    expandedAssemblies: readonly string[];
    derivation: readonly string[];
    warnings: readonly string[];
}
/** Nesting deeper than this is a modeling mistake, not a recipe. */
export declare const MAX_NESTING_DEPTH = 8;
export declare class AssemblyCycleError extends Error {
    readonly cycle: readonly string[];
    constructor(cycle: readonly string[]);
}
export interface ExpandOptions {
    /** Every assembly that may be nested, by id. */
    library?: ReadonlyMap<string, Assembly>;
    /**
     * Which optional components to include.
     * `'none'` is the default: an option nobody chose is an exclusion, and
     * including it silently would put unbid scope into the price.
     */
    optional?: 'none' | 'all' | ReadonlySet<string>;
    maxDepth?: number;
}
/**
 * Expand an assembly into flat, quantified component lines.
 *
 * Quantities multiply down the tree: two structures, each needing three barrel
 * sections, each needing 0.4 CY of concrete, is 2.4 CY — and the derivation
 * says so, because "2.4 CY of concrete" with no working is a number nobody can
 * check against the recipe.
 */
export declare function expandAssembly(assembly: Assembly, quantity: number, options?: ExpandOptions): ExpansionResult;
/**
 * Check an assembly library for cycles without expanding anything.
 *
 * Worth running when a library is imported: a cycle discovered at import is a
 * data problem, and the same cycle discovered mid-estimate is an outage.
 */
export declare function findAssemblyCycles(library: ReadonlyMap<string, Assembly>): readonly (readonly string[])[];
