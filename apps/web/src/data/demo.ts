/**
 * The demo tenant: Ridgeline Excavating, Toledo Ohio.
 *
 * Every currency figure below is produced by @grounup/engine from the catalog
 * in `catalog.ts` — nothing is a hand-written number pretending to be a
 * calculation. That is the point: the screens show what the engine actually
 * computes, including its warnings, confidence scores and approval gates.
 */
import {
  calculateEstimate, analyzeCutFill, reconcileBidQuantity,
  type EstimateInput, type EstimateLineInput, type EstimateResult,
} from '@grounup/engine';
import { CREWS, FUEL_PRICE, DEF_PRICE, MODIFIERS, PRICING_PROFILES, PRODUCTION_RATES, equip } from './catalog';

export interface Company {
  id: string; name: string; slug: string; city: string; state: string;
  plan: string; planName: string;
}

export const COMPANY: Company = {
  id: 'c0000000-0000-4000-8000-000000000001',
  name: 'Ridgeline Excavating',
  slug: 'ridgeline',
  city: 'Toledo', state: 'OH',
  plan: 'professional', planName: 'Professional',
};

export interface CurrentUser {
  id: string; name: string; email: string; role: string; roleKey: string; approvalTier: number;
  permissions: string[];
}

export const USER: CurrentUser = {
  id: 'u0000000-0000-4000-8000-000000000001',
  name: 'Dana Whitfield',
  email: 'dana@ridgeline.test',
  role: 'Senior Estimator',
  roleKey: 'senior_estimator',
  approvalTier: 2,
  permissions: [
    'libraries.read', 'libraries.write', 'estimates.read', 'estimates.write', 'estimates.approve',
    'crm.read', 'crm.write', 'projects.read', 'documents.read', 'documents.write',
    'reports.read', 'ai.accept_findings', 'billing.read',
  ],
};

const j = (text: string) => text;

// ---------------------------------------------------------------------------
// Earthwork balance — computed first, because the haul quantity on the mass
// excavation line is the export this analysis produces. Pricing a haul against
// a number typed by hand, rather than against the balance that produced it, is
// how an estimate ends up internally inconsistent.
// ---------------------------------------------------------------------------

export const CUT_FILL = analyzeCutFill({
  cutBcy: 43_054,
  fillCcy: 31_600,
  unsuitablePercent: 0.08,
  topsoilStripBcy: 8_150,
  topsoilReplaceCcy: 3_900,
  swellPercent: 0.25,
  shrinkPercent: 0.1,
});

// ---------------------------------------------------------------------------
// The flagship estimate: Maumee Commerce Park — Phase 1 Sitework
// ---------------------------------------------------------------------------

const LINES: EstimateLineInput[] = [
  {
    id: 'L-010',
    description: 'Clear, grub and strip topsoil — 6" average across the pad',
    discipline: 'Earthwork',
    costCode: 'CC-0210',
    serviceId: 'SVC-0006',
    quantity: {
      measured: 8_150, unit: 'CY', method: 'calculated',
      sources: ['C-201 grading plan', 'C-101 existing conditions'],
      wasteBasis: undefined,
    },
    productionRate: PRODUCTION_RATES['PR-EW-STRIP'],
    crew: CREWS['CRW-EW-01'],
    equipment: [equip('EQ-D6', 1), equip('EQ-LDR', 1)],
    fuelPricePerGallon: FUEL_PRICE,
    defPricePerGallon: DEF_PRICE,
    calendarEfficiency: 0.85,
    verification: { primarySource: true, crossSource: true, mathematicalReconciliation: true },
    assumptions: ['Topsoil depth averaged at 6" from the C-101 test pit log'],
  },
  {
    id: 'L-020',
    description: 'Mass excavation to subgrade — cut/fill balance per the grading plan',
    discipline: 'Earthwork',
    costCode: 'CC-0220',
    serviceId: 'SVC-0010',
    quantity: {
      measured: 41_800, unit: 'CY', method: 'explicit_dimension',
      adjustments: [{ code: 'OVERDIG', label: 'Building pad overdig', percent: 0.03, reason: 'Detail 3/C-401 requires 1 ft overdig beyond the building line' }],
      sources: ['C-201 grading plan', 'C-210 cross sections', 'C-215 earthwork summary'],
    },
    productionRate: PRODUCTION_RATES['PR-EW-MASS'],
    crew: CREWS['CRW-EW-02'],
    equipment: [equip('EQ-EX-35', 1), equip('EQ-D6', 2), equip('EQ-RLR', 1), equip('EQ-WTR', 1)],
    // The surplus this line generates has to leave the site. Sizing the fleet
    // against this line's own production is what keeps the excavator and the
    // trucks balanced rather than each being priced in isolation.
    haul: {
      quantity: CUT_FILL.exportLcy,
      unit: 'LCY',
      truckCapacity: 16,
      oneWayMiles: 7.4,
      loadedSpeedMph: 32,
      emptySpeedMph: 38,
      dumpMinutes: 2.5,
      delayMinutes: 4,
      truckHourlyRate: 98,
      disposalFeePerUnit: 6.25,
    },
    fuelPricePerGallon: FUEL_PRICE,
    defPricePerGallon: DEF_PRICE,
    calendarEfficiency: 0.85,
    modifiers: [{ modifier: MODIFIERS['MOD-WET-SOIL']!, justification: j('Boring B-4 and B-7 report saturated silty clay above the design subgrade across the north half of the pad.') }],
    verification: { primarySource: true, crossSource: true, mathematicalReconciliation: true },
    majorEarthworkDecision: true,
    materialGeotechnicalAssumption: true,
    assumptions: [
      'Shrink factor of 10% applied to reusable cut, per the geotechnical report Section 5.2',
      'Swell factor of 25% applied to hauled material',
    ],
  },
  {
    id: 'L-030',
    description: 'Undercut unsuitable subgrade and replace with granular fill',
    discipline: 'Earthwork',
    costCode: 'CC-0225',
    serviceId: 'SVC-0014',
    quantity: {
      measured: 3_400, unit: 'CY', method: 'estimator_allowance',
      sources: ['Geotechnical report Section 6.4'],
    },
    productionRate: PRODUCTION_RATES['PR-EW-UNDERCUT'],
    crew: CREWS['CRW-EW-01'],
    equipment: [equip('EQ-EX-20', 1), equip('EQ-RLR', 1)],
    materials: [
      { id: 'M-304', name: 'ODOT 304 granular fill', quantity: 5_100, unit: 'TON', unitCost: 18.75, deliveryCost: 0, quoteReference: 'Stoneco quote SQ-88412' },
    ],
    fuelPricePerGallon: FUEL_PRICE,
    defPricePerGallon: DEF_PRICE,
    calendarEfficiency: 0.85,
    modifiers: [
      { modifier: MODIFIERS['MOD-GW']!, justification: j('Groundwater encountered at 7.5 ft in borings B-2, B-4 and B-7, above the undercut depth.') },
    ],
    verification: { primarySource: true, crossSource: false, mathematicalReconciliation: false },
    materialGeotechnicalAssumption: true,
    documentsCannotResolve: true,
    hasOpenRfi: true,
    assumptions: [
      'Undercut quantity is an allowance; the geotechnical report gives a depth range, not a plan limit',
    ],
    notes: 'RFI-004 asks the engineer to define the undercut limits. Priced as an allowance until answered.',
  },
  {
    id: 'L-040',
    description: 'Fine grade building pad and parking subgrade to tolerance',
    discipline: 'Earthwork',
    costCode: 'CC-0230',
    serviceId: 'SVC-0019',
    quantity: {
      measured: 186_400, unit: 'SF', method: 'calculated',
      sources: ['C-201 grading plan', 'C-301 paving plan'],
    },
    productionRate: PRODUCTION_RATES['PR-EW-FINE'],
    crew: CREWS['CRW-GRD-01'],
    equipment: [equip('EQ-GRD', 1), equip('EQ-RLR', 1), equip('EQ-WTR', 1)],
    fuelPricePerGallon: FUEL_PRICE,
    defPricePerGallon: DEF_PRICE,
    calendarEfficiency: 0.85,
    verification: { primarySource: true, crossSource: true, mathematicalReconciliation: true },
  },
  {
    id: 'L-050',
    description: '12" RCP storm sewer, 6–8 ft depth — including structures and testing',
    discipline: 'Utilities',
    costCode: 'CC-0330',
    serviceId: 'SVC-0075',
    quantity: {
      measured: 2_640, unit: 'LF', method: 'derived',
      adjustments: [{ code: 'STRUCT', label: 'Structure deduction', amount: -68, reason: '17 structures at 4 ft each, per the C-402 structure schedule' }],
      sources: ['C-301 storm plan', 'C-302 storm profile', 'C-402 structure schedule'],
    },
    productionRate: PRODUCTION_RATES['PR-UTL-STORM'],
    crew: CREWS['CRW-UTL-01'],
    equipment: [equip('EQ-EX-20', 1), equip('EQ-SSL', 1)],
    materials: [
      { id: 'M-RCP12', name: '12" RCP Class III', quantity: 2_572, unit: 'LF', unitCost: 34.5, quoteReference: 'Norwalk Concrete quote NC-2210' },
      { id: 'M-57', name: '#57 bedding stone', quantity: 812, unit: 'TON', unitCost: 24.0, quoteReference: 'Stoneco quote SQ-88412' },
      { id: 'M-STRUCT', name: 'Precast storm structures, 4 ft dia.', quantity: 17, unit: 'EA', unitCost: 1_850, deliveryCost: 2_400, quoteReference: 'Norwalk Concrete quote NC-2210' },
    ],
    fuelPricePerGallon: FUEL_PRICE,
    defPricePerGallon: DEF_PRICE,
    calendarEfficiency: 0.85,
    modifiers: [{ modifier: MODIFIERS['MOD-DEEP']!, justification: j('Runs between STM-08 and STM-14 exceed 8 ft, requiring trench boxes and a wider working section.') }],
    verification: { primarySource: true, crossSource: true, mathematicalReconciliation: true },
    materialGeotechnicalAssumption: true,
    assumptions: ['Average trench depth of 7.0 ft derived from the C-302 profile inverts'],
  },
  {
    id: 'L-060',
    description: '8" PVC sanitary sewer, 8–12 ft depth',
    discipline: 'Utilities',
    costCode: 'CC-0340',
    serviceId: 'SVC-0081',
    quantity: {
      measured: 1_180, unit: 'LF', method: 'verified_scale',
      sources: ['C-303 sanitary plan'],
    },
    productionRate: PRODUCTION_RATES['PR-UTL-SAN'],
    crew: CREWS['CRW-UTL-01'],
    equipment: [equip('EQ-EX-20', 1), equip('EQ-SSL', 1)],
    materials: [
      { id: 'M-PVC8', name: '8" PVC SDR-35', quantity: 1_180, unit: 'LF', unitCost: 18.9, quoteReference: 'Core & Main quote CM-7741' },
      { id: 'M-MH', name: 'Sanitary manholes, 4 ft dia.', quantity: 6, unit: 'EA', unitCost: 2_650, deliveryCost: 900, quoteReference: 'Norwalk Concrete quote NC-2210' },
    ],
    fuelPricePerGallon: FUEL_PRICE,
    defPricePerGallon: DEF_PRICE,
    calendarEfficiency: 0.85,
    modifiers: [
      { modifier: MODIFIERS['MOD-DEEP']!, justification: j('Sanitary main runs 8–12 ft deep for its full length per the C-303 profile.') },
      { modifier: MODIFIERS['MOD-GW']!, justification: j('Groundwater at 7.5 ft sits above the sanitary invert for the entire run.') },
    ],
    verification: { primarySource: true, crossSource: false, mathematicalReconciliation: true },
    conflictCount: 1,
    assumptions: ['Sanitary alignment scaled from C-303; no stationing is shown on the plan'],
    notes: 'C-303 plan and C-304 profile disagree on the MH-3 rim elevation by 1.4 ft. Conflict CF-002 is open.',
  },
  {
    id: 'L-070',
    description: 'Concrete curb and gutter, 24" integral',
    discipline: 'Concrete',
    costCode: 'CC-0520',
    serviceId: 'SVC-0104',
    quantity: {
      measured: 4_310, unit: 'LF', method: 'explicit_dimension',
      wastePercent: 0.05, wasteBasis: 'Placement and trim waste per Spec 32 16 13',
      sources: ['C-301 paving plan', 'C-501 curb detail'],
    },
    productionRate: PRODUCTION_RATES['PR-CON-CURB'],
    crew: CREWS['CRW-CON-01'],
    equipment: [equip('EQ-SSL', 1)],
    materials: [
      { id: 'M-CONC', name: 'Ready-mix concrete, 4000 psi', quantity: 268, unit: 'CY', unitCost: 165, quoteReference: 'Gerken quote GK-5520' },
    ],
    fuelPricePerGallon: FUEL_PRICE,
    calendarEfficiency: 0.85,
    verification: { primarySource: true, crossSource: true, mathematicalReconciliation: true },
  },
  {
    id: 'L-080',
    description: 'Concrete sidewalk, 5" thick',
    discipline: 'Concrete',
    costCode: 'CC-0530',
    serviceId: 'SVC-0107',
    quantity: {
      measured: 9_800, unit: 'SF', method: 'calculated',
      wastePercent: 0.05, wasteBasis: 'Placement waste per Spec 32 16 13',
      sources: ['C-301 paving plan'],
    },
    productionRate: PRODUCTION_RATES['PR-CON-WALK'],
    crew: CREWS['CRW-CON-01'],
    equipment: [equip('EQ-SSL', 1)],
    materials: [
      { id: 'M-CONC-SW', name: 'Ready-mix concrete, 4000 psi', quantity: 159, unit: 'CY', unitCost: 165, quoteReference: 'Gerken quote GK-5520' },
    ],
    fuelPricePerGallon: FUEL_PRICE,
    calendarEfficiency: 0.85,
    verification: { primarySource: true, crossSource: true, mathematicalReconciliation: false },
  },
  {
    id: 'L-090',
    description: 'Asphalt base course, 3" ODOT 301',
    discipline: 'Asphalt',
    costCode: 'CC-0610',
    serviceId: 'SVC-0121',
    quantity: {
      measured: 2_845, unit: 'TON', method: 'calculated',
      sources: ['C-301 paving plan', 'C-502 pavement section'],
    },
    productionRate: PRODUCTION_RATES['PR-ASP-BASE'],
    crew: CREWS['CRW-ASP-01'],
    equipment: [equip('EQ-PAV', 1), equip('EQ-RLR', 2)],
    materials: [
      { id: 'M-301', name: 'ODOT 301 asphalt base', quantity: 2_845, unit: 'TON', unitCost: 78.5, quoteReference: 'Gerken quote GK-5521' },
    ],
    fuelPricePerGallon: FUEL_PRICE,
    defPricePerGallon: DEF_PRICE,
    calendarEfficiency: 0.85,
    verification: { primarySource: true, crossSource: true, mathematicalReconciliation: true },
    assumptions: ['Asphalt tonnage computed at 110 lb/SY/in from the C-502 section'],
  },
  {
    id: 'L-100',
    description: 'Asphalt surface course, 1.5" ODOT 448 Type 1',
    discipline: 'Asphalt',
    costCode: 'CC-0620',
    serviceId: 'SVC-0123',
    quantity: {
      measured: 1_425, unit: 'TON', method: 'calculated',
      sources: ['C-301 paving plan', 'C-502 pavement section'],
    },
    productionRate: PRODUCTION_RATES['PR-ASP-SURF'],
    crew: CREWS['CRW-ASP-01'],
    equipment: [equip('EQ-PAV', 1), equip('EQ-RLR', 2)],
    materials: [
      { id: 'M-448', name: 'ODOT 448 Type 1 surface', quantity: 1_425, unit: 'TON', unitCost: 89.0, quoteReference: 'Gerken quote GK-5521' },
    ],
    fuelPricePerGallon: FUEL_PRICE,
    defPricePerGallon: DEF_PRICE,
    calendarEfficiency: 0.85,
    verification: { primarySource: true, crossSource: true, mathematicalReconciliation: true },
  },
];

export const ESTIMATE_INPUT: EstimateInput = {
  id: 'e0000000-0000-4000-8000-000000000001',
  number: 'EST-2026-0184',
  name: 'Maumee Commerce Park — Phase 1 Sitework',
  version: 3,
  status: 'in_review',
  lines: LINES,
  pricingProfile: PRICING_PROFILES['PP-AVG']!,
  bidRoundingIncrement: 500,
  indirects: [
    { code: 'MOB', label: 'Mobilization and demobilization', amount: 38_500 },
    { code: 'GC', label: 'General conditions and supervision', perDay: 1_450, days: 96 },
    { code: 'SWPPP', label: 'Erosion control and SWPPP maintenance', amount: 27_800 },
    { code: 'SURVEY', label: 'Construction staking and as-builts', amount: 21_400 },
    { code: 'TEST', label: 'Compaction and materials testing allowance', percentOfDirect: 0.006 },
  ],
};

/** Computed once at module load; every screen reads the same engine output. */
export const ESTIMATE: EstimateResult = calculateEstimate(ESTIMATE_INPUT);

// ---------------------------------------------------------------------------
// Supporting analyses shown alongside the estimate
// ---------------------------------------------------------------------------

/**
 * The haul as the engine actually priced it on the mass excavation line.
 *
 * Read from the estimate rather than recomputed, so the earthwork tab and the
 * estimate total can never disagree about what the haul cost.
 */
export const HAUL = ESTIMATE.lines.find((l) => l.id === 'L-020')!.haul!;

export const BID_RECONCILIATION = [
  reconcileBidQuantity('202', 'CY', 41_000, 43_054),
  reconcileBidQuantity('204', 'CY', 3_000, 3_400),
  reconcileBidQuantity('611', 'LF', 2_640, 2_572),
  reconcileBidQuantity('609', 'LF', 4_310, 4_310),
  reconcileBidQuantity('441', 'TON', 1_500, 1_425),
];
