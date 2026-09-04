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

export const ENGINE_VERSION = '1.0.0';

/**
 * Governed rule set the engine implements, surfaced so the application can
 * show a user which rule produced a given warning.
 */
export const GOVERNING_RULES = Object.freeze([
  { id: 'RULE-001', name: 'Direct cost separation', module: 'pricing' },
  { id: 'RULE-002', name: 'Production-based duration', module: 'production' },
  { id: 'RULE-003', name: 'Equipment rate hierarchy', module: 'resources' },
  { id: 'RULE-004', name: 'Trip-based hauling', module: 'trucking' },
  { id: 'RULE-005', name: 'Controlling resource', module: 'production' },
  { id: 'RULE-006', name: 'Modifiers by target', module: 'production' },
  { id: 'RULE-007', name: 'Markup transparency', module: 'pricing' },
  { id: 'RULE-008', name: 'No silent writeback', module: 'confidence' },
  { id: 'RULE-009', name: 'Estimate version integrity', module: 'estimate' },
  { id: 'RULE-010', name: 'Source confidence', module: 'confidence' },
] as const);
