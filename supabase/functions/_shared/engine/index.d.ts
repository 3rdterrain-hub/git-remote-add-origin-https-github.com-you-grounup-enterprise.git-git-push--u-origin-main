/**
 * @grounup/engine — the deterministic construction estimating engine.
 *
 * Every authoritative number GrounUp shows a user is produced here. AI agents
 * may propose scope, quantities and conditions; they never compute the price.
 * That separation is the platform's core safety property (Master AI
 * specification Section 40, RULE-008).
 */
export * from './numeric.js';
export * from './units.js';
export * from './quantity.js';
export * from './production.js';
export * from './resources.js';
export * from './trucking.js';
export * from './surfaces.js';
export * from './takeoff.js';
export * from './basins.js';
export * from './hierarchy.js';
export * from './assemblies.js';
export * from './materials.js';
export * from './pricing.js';
export * from './confidence.js';
export * from './estimate.js';
export * from './portable.js';
export * from './snapshot.js';
export * from './scenarios.js';
export * from './overrides.js';
export * from './calendar.js';
export * from './schedule.js';
export declare const ENGINE_VERSION = "1.0.0";
/**
 * Governed rule set the engine implements, surfaced so the application can
 * show a user which rule produced a given warning.
 */
export declare const GOVERNING_RULES: readonly [{
    readonly id: "RULE-001";
    readonly name: "Direct cost separation";
    readonly module: "pricing";
}, {
    readonly id: "RULE-002";
    readonly name: "Production-based duration";
    readonly module: "production";
}, {
    readonly id: "RULE-003";
    readonly name: "Equipment rate hierarchy";
    readonly module: "resources";
}, {
    readonly id: "RULE-004";
    readonly name: "Trip-based hauling";
    readonly module: "trucking";
}, {
    readonly id: "RULE-005";
    readonly name: "Controlling resource";
    readonly module: "production";
}, {
    readonly id: "RULE-006";
    readonly name: "Modifiers by target";
    readonly module: "production";
}, {
    readonly id: "RULE-007";
    readonly name: "Markup transparency";
    readonly module: "pricing";
}, {
    readonly id: "RULE-008";
    readonly name: "No silent writeback";
    readonly module: "confidence";
}, {
    readonly id: "RULE-009";
    readonly name: "Estimate version integrity";
    readonly module: "estimate";
}, {
    readonly id: "RULE-010";
    readonly name: "Source confidence";
    readonly module: "confidence";
}];
