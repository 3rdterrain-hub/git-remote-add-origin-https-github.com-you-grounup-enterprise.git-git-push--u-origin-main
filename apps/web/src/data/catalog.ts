/**
 * A working slice of the GrounUp master library, typed for the engine.
 *
 * These are the same records the global seed loads into PostgreSQL, expressed
 * as engine inputs so the demo estimate is computed by the real engine rather
 * than transcribed. Nothing in the UI hard-codes a price.
 */
import {
  resolveEquipmentRate, standardProfile,
  type ConditionModifier, type Crew, type EquipmentItem,
  type LaborClassification, type PricingProfile, type ProductionRate,
} from '@grounup/engine';

export const LABOR: Record<string, LaborClassification> = {
  'LAB-OP1': { id: 'LAB-OP1', classification: 'Heavy Equipment Operator I', group: 'Operator', baseWagePerHour: 40, burdenPercent: 0.35, overtimeMultiplier: 1.5, doubletimeMultiplier: 2, region: 'Toledo, Ohio' },
  'LAB-OP2': { id: 'LAB-OP2', classification: 'Heavy Equipment Operator II', group: 'Operator', baseWagePerHour: 44, burdenPercent: 0.35, overtimeMultiplier: 1.5, doubletimeMultiplier: 2, region: 'Toledo, Ohio' },
  'LAB-FRM': { id: 'LAB-FRM', classification: 'Foreman', group: 'Supervision', baseWagePerHour: 48, burdenPercent: 0.38, overtimeMultiplier: 1.5, doubletimeMultiplier: 2, region: 'Toledo, Ohio' },
  'LAB-LAB': { id: 'LAB-LAB', classification: 'Construction Laborer', group: 'Labor', baseWagePerHour: 30, burdenPercent: 0.35, overtimeMultiplier: 1.5, doubletimeMultiplier: 2, region: 'Toledo, Ohio' },
  'LAB-DRV': { id: 'LAB-DRV', classification: 'CDL Truck Driver', group: 'Driver', baseWagePerHour: 34, burdenPercent: 0.35, overtimeMultiplier: 1.5, doubletimeMultiplier: 2, region: 'Toledo, Ohio' },
  'LAB-PIPE': { id: 'LAB-PIPE', classification: 'Pipe Layer', group: 'Skilled Labor', baseWagePerHour: 36, burdenPercent: 0.35, overtimeMultiplier: 1.5, doubletimeMultiplier: 2, region: 'Toledo, Ohio' },
  'LAB-CONC': { id: 'LAB-CONC', classification: 'Concrete Finisher', group: 'Skilled Labor', baseWagePerHour: 38, burdenPercent: 0.35, overtimeMultiplier: 1.5, doubletimeMultiplier: 2, region: 'Toledo, Ohio' },
  'LAB-SURV': { id: 'LAB-SURV', classification: 'Grade/Survey Technician', group: 'Technical', baseWagePerHour: 42, burdenPercent: 0.35, overtimeMultiplier: 1.5, doubletimeMultiplier: 2, region: 'Toledo, Ohio' },
};

interface EquipmentSpec {
  id: string; name: string; equipmentClass: string; hourlyRate: number;
  fuelGallonsPerHour: number; defPercentOfFuel: number; mobilizationCost: number;
}

export const EQUIPMENT_SPECS: Record<string, EquipmentSpec> = {
  'EQ-EX-20': { id: 'EQ-EX-20', name: 'Excavator 20-25 ton', equipmentClass: 'Excavator', hourlyRate: 112.5, fuelGallonsPerHour: 5.5, defPercentOfFuel: 0.03, mobilizationCost: 450 },
  'EQ-EX-35': { id: 'EQ-EX-35', name: 'Excavator 35-40 ton', equipmentClass: 'Excavator', hourlyRate: 168.75, fuelGallonsPerHour: 8.5, defPercentOfFuel: 0.03, mobilizationCost: 750 },
  'EQ-D6': { id: 'EQ-D6', name: 'Dozer D6 class', equipmentClass: 'Dozer', hourlyRate: 137.5, fuelGallonsPerHour: 7.5, defPercentOfFuel: 0.03, mobilizationCost: 550 },
  'EQ-LDR': { id: 'EQ-LDR', name: 'Wheel Loader 3-4 CY', equipmentClass: 'Loader', hourlyRate: 131.25, fuelGallonsPerHour: 6.5, defPercentOfFuel: 0.03, mobilizationCost: 500 },
  'EQ-GRD': { id: 'EQ-GRD', name: 'Motor Grader', equipmentClass: 'Grader', hourlyRate: 137.5, fuelGallonsPerHour: 6.5, defPercentOfFuel: 0.03, mobilizationCost: 600 },
  'EQ-RLR': { id: 'EQ-RLR', name: 'Single Drum Roller', equipmentClass: 'Compactor', hourlyRate: 87.5, fuelGallonsPerHour: 4.5, defPercentOfFuel: 0.03, mobilizationCost: 350 },
  'EQ-PAV': { id: 'EQ-PAV', name: 'Asphalt Paver', equipmentClass: 'Paving', hourlyRate: 275, fuelGallonsPerHour: 11, defPercentOfFuel: 0.03, mobilizationCost: 900 },
  'EQ-SSL': { id: 'EQ-SSL', name: 'Skid Steer', equipmentClass: 'Skid Steer', hourlyRate: 62.5, fuelGallonsPerHour: 2.2, defPercentOfFuel: 0, mobilizationCost: 200 },
  'EQ-WTR': { id: 'EQ-WTR', name: 'Water Truck', equipmentClass: 'Truck', hourlyRate: 112.5, fuelGallonsPerHour: 4.5, defPercentOfFuel: 0.03, mobilizationCost: 300 },
};

/**
 * Build an equipment item at a given count.
 *
 * The rate is resolved through the RULE-003 hierarchy rather than read directly,
 * so the estimate carries which source won and warns when it fell through to a
 * seed rate that ought to be replaced.
 */
export function equip(code: keyof typeof EQUIPMENT_SPECS, count = 1, source: 'tenant_approved' | 'global_seed' | 'project_quote' = 'tenant_approved'): EquipmentItem {
  const spec = EQUIPMENT_SPECS[code]!;
  return {
    id: spec.id,
    name: spec.name,
    equipmentClass: spec.equipmentClass,
    rate: resolveEquipmentRate(
      [{ source, hourlyRate: spec.hourlyRate, effectiveDate: '2026-01-01', reference: source === 'tenant_approved' ? 'Company rate sheet 2026' : 'GrounUp seed' }],
      '2026-08-01',
    ),
    count,
    fuelGallonsPerHour: spec.fuelGallonsPerHour,
    defPercentOfFuel: spec.defPercentOfFuel,
    operatorRequired: true,
    mobilizationRequired: true,
    mobilizationCost: spec.mobilizationCost,
  };
}

const crew = (id: string, name: string, members: [keyof typeof LABOR, number][]): Crew => ({
  id, name, shiftHours: 8,
  members: members.map(([code, count]) => ({ classification: LABOR[code]!, count })),
});

export const CREWS: Record<string, Crew> = {
  'CRW-EW-02': crew('CRW-EW-02', 'Mass excavation crew', [['LAB-FRM', 1], ['LAB-OP2', 2], ['LAB-OP1', 1], ['LAB-LAB', 1], ['LAB-SURV', 1]]),
  'CRW-EW-01': crew('CRW-EW-01', 'Earthwork crew — small', [['LAB-FRM', 1], ['LAB-OP1', 1], ['LAB-LAB', 1]]),
  'CRW-GRD-01': crew('CRW-GRD-01', 'Fine grading crew', [['LAB-FRM', 1], ['LAB-OP2', 1], ['LAB-SURV', 1], ['LAB-LAB', 1]]),
  'CRW-UTL-01': crew('CRW-UTL-01', 'Underground utility crew', [['LAB-FRM', 1], ['LAB-OP1', 1], ['LAB-PIPE', 2], ['LAB-LAB', 1]]),
  'CRW-CON-01': crew('CRW-CON-01', 'Site concrete crew', [['LAB-FRM', 1], ['LAB-CONC', 2], ['LAB-LAB', 2]]),
  'CRW-ASP-01': crew('CRW-ASP-01', 'Asphalt paving crew', [['LAB-FRM', 1], ['LAB-OP2', 2], ['LAB-LAB', 3], ['LAB-DRV', 1]]),
};

const rate = (
  id: string, ratePerHour: number, unit: string, sourceType: ProductionRate['sourceType'],
  confidence: number, sampleSize = 0, utilization = 0.83,
): ProductionRate => ({
  id, ratePerHour, unit, utilizationFactor: utilization, shiftHours: 8,
  sourceType, confidence, sampleSize, approvalStatus: 'approved',
  region: 'Toledo, Ohio', effectiveDate: '2026-01-01',
});

export const PRODUCTION_RATES: Record<string, ProductionRate> = {
  'PR-EW-STRIP': rate('PR-EW-STRIP', 260, 'CY', 'company_actual', 0.94, 22, 0.85),
  'PR-EW-MASS': rate('PR-EW-MASS', 185, 'CY', 'company_actual', 0.91, 17, 0.83),
  'PR-EW-UNDERCUT': rate('PR-EW-UNDERCUT', 95, 'CY', 'company_historical', 0.78, 6, 0.78),
  'PR-EW-FINE': rate('PR-EW-FINE', 1850, 'SF', 'company_actual', 0.9, 14, 0.82),
  'PR-UTL-STORM': rate('PR-UTL-STORM', 21, 'LF', 'company_actual', 0.92, 19, 0.8),
  'PR-UTL-SAN': rate('PR-UTL-SAN', 18, 'LF', 'company_historical', 0.84, 8, 0.8),
  'PR-CON-CURB': rate('PR-CON-CURB', 46, 'LF', 'company_actual', 0.89, 11, 0.8),
  'PR-CON-WALK': rate('PR-CON-WALK', 210, 'SF', 'company_historical', 0.82, 7, 0.8),
  'PR-ASP-BASE': rate('PR-ASP-BASE', 78, 'TON', 'regional_benchmark', 0.72, 0, 0.8),
  'PR-ASP-SURF': rate('PR-ASP-SURF', 62, 'TON', 'regional_benchmark', 0.7, 0, 0.8),
};

export const MODIFIERS: Record<string, ConditionModifier> = {
  'MOD-ACCESS': { id: 'MOD-ACCESS', name: 'Restricted access', category: 'Site', factors: { production: 0.75 }, applicationRule: 'Working room restricts equipment movement or staging', status: 'active' },
  'MOD-WEATHER': { id: 'MOD-WEATHER', name: 'Adverse weather', category: 'Environment', factors: { production: 0.8 }, applicationRule: 'Sustained weather materially reduces working days', status: 'active' },
  'MOD-GW': { id: 'MOD-GW', name: 'Groundwater', category: 'Geotechnical', factors: { production: 0.7, equipment_cost: 1.1 }, applicationRule: 'Groundwater indicated within the excavation depth', status: 'active' },
  'MOD-DEEP': { id: 'MOD-DEEP', name: 'Deep excavation', category: 'Geotechnical', factors: { production: 0.7, labor_cost: 1.08 }, applicationRule: 'Excavation depth requires additional safety measures', status: 'active' },
  'MOD-SMALL': { id: 'MOD-SMALL', name: 'Small quantity inefficiency', category: 'Production', factors: { production: 0.65 }, applicationRule: 'Quantity is too small to reach steady-state production', status: 'active' },
  'MOD-WET-SOIL': { id: 'MOD-WET-SOIL', name: 'Wet soil', category: 'Section 7.1', factors: { labor_cost: 1.15, production: 0.85 }, applicationRule: 'Geotechnical report or field observation indicates saturated soil', status: 'active' },
  'MOD-ROCK': { id: 'MOD-ROCK', name: 'Rock', category: 'Section 7.1', factors: { labor_cost: 1.35, equipment_cost: 1.35, production: 0.65 }, applicationRule: 'Rock indicated by boring logs or observed in excavation', status: 'active' },
  'MOD-TIGHT-ACCESS': { id: 'MOD-TIGHT-ACCESS', name: 'Tight access', category: 'Section 7.1', factors: { equipment_cost: 1.2, production: 0.8 }, applicationRule: 'Working room restricts equipment size', status: 'active' },
  'MOD-WINTER-COST': { id: 'MOD-WINTER-COST', name: 'Winter conditions', category: 'Section 7.1', factors: { labor_cost: 1.12 }, applicationRule: 'Work scheduled during winter months', status: 'active' },
  'MOD-NIGHT-COST': { id: 'MOD-NIGHT-COST', name: 'Night work', category: 'Section 7.1', factors: { labor_cost: 1.18, production: 0.88 }, applicationRule: 'Owner or agency requires night work', status: 'active' },
};

export const PRICING_PROFILES: Record<string, PricingProfile> = {
  'PP-AVG': standardProfile('PP-AVG', 'Average Market', 'parallel', { overhead: 0.1, profit: 0.12, contingency: 0.03 }, { region: 'Northwest Ohio', regionalFactor: 1.0 }),
  'PP-UNION': standardProfile('PP-UNION', 'Union', 'stacked', { overhead: 0.12, profit: 0.12, contingency: 0.04 }, { region: 'Northwest Ohio', regionalFactor: 1.06 }),
  'PP-CUSTOM': standardProfile('PP-CUSTOM', 'Custom Company', 'parallel', { overhead: 0.1, profit: 0.15, contingency: 0.03, bond: 0.011 }, { region: 'Northwest Ohio', regionalFactor: 1.0 }),
};

export const FUEL_PRICE = 4.25;
export const DEF_PRICE = 12.0;
