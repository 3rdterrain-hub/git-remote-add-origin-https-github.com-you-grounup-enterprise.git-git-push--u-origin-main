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
import { assertNonNegative, assertPositive, qty } from './numeric.js';
export const COMPONENT_KINDS = ['task', 'labor', 'equipment', 'material', 'assembly', 'subcontract', 'trucking'];
/** Nesting deeper than this is a modeling mistake, not a recipe. */
export const MAX_NESTING_DEPTH = 8;
export class AssemblyCycleError extends Error {
    cycle;
    constructor(cycle) {
        super(`Assembly ${cycle[0]} contains itself through ${cycle.join(' > ')}. `
            + 'Expanding it would never terminate, and a partial expansion would under-quantify the job.');
        this.cycle = cycle;
        this.name = 'AssemblyCycleError';
    }
}
function emptyByKind() {
    return { task: 0, labor: 0, equipment: 0, material: 0, assembly: 0, subcontract: 0, trucking: 0 };
}
/**
 * Expand an assembly into flat, quantified component lines.
 *
 * Quantities multiply down the tree: two structures, each needing three barrel
 * sections, each needing 0.4 CY of concrete, is 2.4 CY — and the derivation
 * says so, because "2.4 CY of concrete" with no working is a number nobody can
 * check against the recipe.
 */
export function expandAssembly(assembly, quantity, options = {}) {
    assertNonNegative(quantity, 'quantity');
    const library = options.library ?? new Map();
    const optional = options.optional ?? 'none';
    const maxDepth = options.maxDepth ?? MAX_NESTING_DEPTH;
    assertPositive(maxDepth, 'maxDepth');
    const components = [];
    const warnings = [];
    const derivation = [];
    const optionalIncluded = [];
    const optionalExcluded = [];
    const expandedAssemblies = [];
    let maxDepthSeen = 0;
    const includeOptional = (c) => {
        if (!c.isOptional)
            return true;
        if (optional === 'all')
            return true;
        if (optional === 'none')
            return false;
        return optional.has(c.id);
    };
    const visit = (current, multiplier, depth, codePath, idPath) => {
        if (idPath.includes(current.id)) {
            throw new AssemblyCycleError([...codePath, current.code]);
        }
        if (depth > maxDepth) {
            throw new RangeError(`Assembly ${current.code} nests deeper than ${maxDepth} levels at ${codePath.join(' > ')}. `
                + 'That is a modeling mistake rather than a recipe.');
        }
        expandedAssemblies.push(current.code);
        maxDepthSeen = Math.max(maxDepthSeen, depth);
        const ordered = [...current.components].sort((a, b) => a.sortOrder - b.sortOrder);
        for (const c of ordered) {
            assertNonNegative(c.quantityPerUnit, `quantityPerUnit for ${c.name}`);
            const label = `${c.name}${c.isOptional ? ' (optional)' : ''}`;
            if (!includeOptional(c)) {
                optionalExcluded.push(`${current.code}: ${c.name}`);
                continue;
            }
            if (c.isOptional)
                optionalIncluded.push(`${current.code}: ${c.name}`);
            const perRoot = qty(multiplier * c.quantityPerUnit);
            const path = [...codePath, current.code, c.name].join(' > ');
            if (c.kind === 'assembly') {
                const nested = library.get(c.referenceId);
                if (!nested) {
                    // Refusing outright would lose the rest of a large expansion, but
                    // pretending the nested assembly is empty would under-quantify the
                    // job without saying so.
                    warnings.push(`${current.code} nests assembly ${c.referenceId} (${c.name}), which was not supplied. `
                        + 'Its components are missing from this expansion.');
                    continue;
                }
                visit(nested, perRoot, depth + 1, [...codePath, current.code], [...idPath, current.id]);
                continue;
            }
            components.push({
                path,
                componentId: c.id,
                kind: c.kind,
                referenceId: c.referenceId,
                name: c.name,
                unit: c.unit,
                depth,
                fromAssemblyCode: current.code,
                quantityPerRootUnit: perRoot,
                quantity: qty(perRoot * quantity),
                isOptional: Boolean(c.isOptional),
                derivation: depth === 0
                    ? `${label}: ${c.quantityPerUnit} per ${current.quantityUnit} x ${quantity} ${current.quantityUnit} = ${qty(perRoot * quantity)}${c.unit ? ` ${c.unit}` : ''}`
                    : `${label}: ${c.quantityPerUnit} per ${current.quantityUnit} x ${multiplier} nested = ${perRoot} per root unit x ${quantity} = ${qty(perRoot * quantity)}${c.unit ? ` ${c.unit}` : ''}`,
            });
        }
    };
    visit(assembly, 1, 0, [], []);
    const quantityByKind = emptyByKind();
    const countByKind = emptyByKind();
    for (const c of components) {
        quantityByKind[c.kind] = qty(quantityByKind[c.kind] + c.quantity);
        countByKind[c.kind] += 1;
    }
    derivation.push(`${assembly.code} "${assembly.name}" x ${quantity} ${assembly.quantityUnit}`
        + ` expanded to ${components.length} component line(s)`
        + (maxDepthSeen > 0 ? ` across ${maxDepthSeen + 1} level(s)` : ''));
    for (const c of components)
        derivation.push(`  ${c.path}: ${c.derivation}`);
    if (optionalExcluded.length) {
        derivation.push(`  excluded ${optionalExcluded.length} optional component(s): ${optionalExcluded.join('; ')}`);
    }
    if (components.length === 0) {
        warnings.push(`${assembly.code} expanded to no components. It will contribute nothing to the estimate.`);
    }
    if (quantity === 0) {
        warnings.push(`${assembly.code} was expanded at a quantity of zero; every component quantity is zero.`);
    }
    return {
        assemblyId: assembly.id,
        assemblyCode: assembly.code,
        assemblyName: assembly.name,
        quantity: qty(quantity),
        unit: assembly.quantityUnit,
        components,
        quantityByKind,
        countByKind,
        maxDepth: maxDepthSeen,
        optionalIncluded,
        optionalExcluded,
        expandedAssemblies,
        derivation,
        warnings,
    };
}
/**
 * Check an assembly library for cycles without expanding anything.
 *
 * Worth running when a library is imported: a cycle discovered at import is a
 * data problem, and the same cycle discovered mid-estimate is an outage.
 */
export function findAssemblyCycles(library) {
    const cycles = [];
    const seen = new Set();
    const walk = (a, idPath, codePath) => {
        if (idPath.includes(a.id)) {
            const cycle = [...codePath, a.code];
            // Key on the distinct assemblies involved, not the walk. A > B > A and
            // B > A > B are one cycle seen from two entry points, and reporting it
            // twice is noise a reviewer has to work out is noise.
            const key = [...new Set(cycle)].sort().join('|');
            if (!seen.has(key)) {
                seen.add(key);
                cycles.push(cycle);
            }
            return;
        }
        for (const c of a.components) {
            if (c.kind !== 'assembly')
                continue;
            const nested = library.get(c.referenceId);
            if (nested)
                walk(nested, [...idPath, a.id], [...codePath, a.code]);
        }
    };
    for (const a of library.values())
        walk(a, [], []);
    return cycles;
}
