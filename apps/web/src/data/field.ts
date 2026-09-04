/**
 * Field operations, commercial and notification records for the demo tenant.
 *
 * The production actuals below are deliberately consistent with the catalog
 * rates in `catalog.ts`: the storm sewer crew is running under its estimated
 * rate, which is what generates the calibration proposal on the projects screen.
 * Numbers that contradicted each other would make the learning loop meaningless.
 */

export interface DailyReport {
  id: string; projectId: string; date: string;
  weather: string; temperatureF: number; precipitationIn: number;
  crewCount: number; delayHours: number;
  workPerformed: string; delays?: string; visitors?: string; safetyNotes?: string;
  submittedBy: string; submittedAt: string;
  labor: { classification: string; headcount: number; straightHours: number; overtimeHours: number }[];
  equipment: { description: string; units: number; operatingHours: number; idleHours: number; downHours: number; fuelGallons: number }[];
  production: { task: string; quantity: number; unit: string; crewHours: number; costCode: string }[];
}

export const DAILY_REPORTS: DailyReport[] = [
  {
    id: 'dr-1', projectId: 'p-1', date: '2026-08-31',
    weather: 'Partly cloudy, dry', temperatureF: 79, precipitationIn: 0,
    crewCount: 6, delayHours: 0,
    workPerformed:
      'Installed 8" sanitary main from MH-4 to MH-6, 412 LF. Set MH-5 and MH-6. Pressure tested the MH-3 to MH-4 segment; passed. Backfilled and compacted to subgrade in 12" lifts.',
    visitors: 'Lucas County inspector, 10:15–11:00, witnessed the air test.',
    safetyNotes: 'Trench box in use for the full run. Toolbox talk on excavation entry.',
    submittedBy: 'Ray Delgado', submittedAt: '2026-08-31T17:42:00Z',
    labor: [
      { classification: 'Foreman', headcount: 1, straightHours: 9, overtimeHours: 1 },
      { classification: 'Heavy Equipment Operator I', headcount: 1, straightHours: 9, overtimeHours: 1 },
      { classification: 'Pipe Layer', headcount: 2, straightHours: 9, overtimeHours: 1 },
      { classification: 'Construction Laborer', headcount: 2, straightHours: 9, overtimeHours: 1 },
    ],
    equipment: [
      { description: 'Excavator 20-25 ton', units: 1, operatingHours: 8.5, idleHours: 1.5, downHours: 0, fuelGallons: 47 },
      { description: 'Skid Steer', units: 1, operatingHours: 6, idleHours: 4, downHours: 0, fuelGallons: 13 },
      { description: 'Plate Compactor', units: 2, operatingHours: 7, idleHours: 3, downHours: 0, fuelGallons: 5 },
    ],
    production: [{ task: '8" PVC sanitary sewer, 8–12 ft', quantity: 412, unit: 'LF', crewHours: 34.5, costCode: 'CC-0340' }],
  },
  {
    id: 'dr-2', projectId: 'p-1', date: '2026-08-28',
    weather: 'Rain overnight, wet subgrade', temperatureF: 68, precipitationIn: 0.9,
    crewCount: 6, delayHours: 3.5,
    workPerformed:
      'Dewatered the MH-4 excavation and hauled off 40 CY of saturated spoil. Installed 180 LF of 8" sanitary once the trench was stable.',
    delays: 'Lost 3.5 crew-hours to standing water and pump setup after overnight rain.',
    safetyNotes: 'Trench walls sloughed at Sta. 6+40; re-benched before entry.',
    submittedBy: 'Ray Delgado', submittedAt: '2026-08-28T18:05:00Z',
    labor: [
      { classification: 'Foreman', headcount: 1, straightHours: 8, overtimeHours: 0 },
      { classification: 'Heavy Equipment Operator I', headcount: 1, straightHours: 8, overtimeHours: 0 },
      { classification: 'Pipe Layer', headcount: 2, straightHours: 8, overtimeHours: 0 },
      { classification: 'Construction Laborer', headcount: 2, straightHours: 8, overtimeHours: 0 },
    ],
    equipment: [
      { description: 'Excavator 20-25 ton', units: 1, operatingHours: 6, idleHours: 2, downHours: 0, fuelGallons: 33 },
      { description: 'Trash pump 3"', units: 2, operatingHours: 8, idleHours: 0, downHours: 0, fuelGallons: 9 },
    ],
    production: [{ task: '8" PVC sanitary sewer, 8–12 ft', quantity: 180, unit: 'LF', crewHours: 28.5, costCode: 'CC-0340' }],
  },
  {
    id: 'dr-3', projectId: 'p-1', date: '2026-08-27',
    weather: 'Clear', temperatureF: 82, precipitationIn: 0,
    crewCount: 5, delayHours: 0,
    workPerformed: 'Storm structure setting at STM-08 through STM-11. Installed 268 LF of 12" RCP.',
    submittedBy: 'Ray Delgado', submittedAt: '2026-08-27T17:20:00Z',
    labor: [
      { classification: 'Foreman', headcount: 1, straightHours: 8, overtimeHours: 0 },
      { classification: 'Heavy Equipment Operator I', headcount: 1, straightHours: 8, overtimeHours: 0 },
      { classification: 'Pipe Layer', headcount: 2, straightHours: 8, overtimeHours: 0 },
      { classification: 'Construction Laborer', headcount: 1, straightHours: 8, overtimeHours: 0 },
    ],
    equipment: [
      { description: 'Excavator 20-25 ton', units: 1, operatingHours: 7.5, idleHours: 0.5, downHours: 0, fuelGallons: 41 },
      { description: 'Skid Steer', units: 1, operatingHours: 5, idleHours: 3, downHours: 0, fuelGallons: 11 },
    ],
    production: [{ task: '12" RCP storm sewer, 6–8 ft', quantity: 268, unit: 'LF', crewHours: 40, costCode: 'CC-0330' }],
  },
];

export interface Submittal {
  id: string; number: string; title: string; specSection: string; type: string;
  vendor: string; ballInCourt: string; status: string; revision: number;
  requiredOnSite: string; leadTimeDays: number;
  submittedAt?: string; dueAt?: string; returnedAt?: string; reviewerComment?: string;
}

export const SUBMITTALS: Submittal[] = [
  { id: 's-1', number: 'SUB-012', title: '12" RCP Class III — product data and mill certs', specSection: '33 41 00', type: 'product_data', vendor: 'Norwalk Concrete', ballInCourt: 'engineer', status: 'under_review', revision: 0, requiredOnSite: '2026-09-22', leadTimeDays: 21, submittedAt: '2026-08-25', dueAt: '2026-09-08' },
  { id: 's-2', number: 'SUB-013', title: 'Precast storm structures — shop drawings', specSection: '33 44 00', type: 'shop_drawing', vendor: 'Norwalk Concrete', ballInCourt: 'contractor', status: 'revise_resubmit', revision: 1, requiredOnSite: '2026-09-29', leadTimeDays: 28, submittedAt: '2026-08-14', dueAt: '2026-08-28', returnedAt: '2026-08-27', reviewerComment: 'Revise the STM-08 sump depth to match the C-402 schedule; resubmit for record.' },
  { id: 's-3', number: 'SUB-014', title: 'ODOT 304 aggregate — gradation and source', specSection: '32 11 23', type: 'test_report', vendor: 'Stoneco', ballInCourt: 'closed', status: 'approved', revision: 0, requiredOnSite: '2026-09-08', leadTimeDays: 7, submittedAt: '2026-08-11', dueAt: '2026-08-25', returnedAt: '2026-08-19', reviewerComment: 'Approved. Gradation conforms to 703.17.' },
  { id: 's-4', number: 'SUB-015', title: '4000 psi concrete mix design — curb and walk', specSection: '32 16 13', type: 'mix_design', vendor: 'Gerken', ballInCourt: 'engineer', status: 'submitted', revision: 0, requiredOnSite: '2026-10-06', leadTimeDays: 14, submittedAt: '2026-08-29', dueAt: '2026-09-12' },
  { id: 's-5', number: 'SUB-016', title: '8" PVC SDR-35 — product data', specSection: '33 31 00', type: 'product_data', vendor: 'Core & Main', ballInCourt: 'closed', status: 'approved_as_noted', revision: 0, requiredOnSite: '2026-08-25', leadTimeDays: 10, submittedAt: '2026-08-04', dueAt: '2026-08-18', returnedAt: '2026-08-15', reviewerComment: 'Approved as noted — use gasketed joints throughout, not solvent weld.' },
  { id: 's-6', number: 'SUB-017', title: 'Erosion control — silt fence and inlet protection', specSection: '31 25 00', type: 'product_data', vendor: 'Site Supply Co', ballInCourt: 'contractor', status: 'draft', revision: 0, requiredOnSite: '2026-09-15', leadTimeDays: 5 },
];

export interface ChangeOrderRecord {
  id: string; projectId: string; number: string; title: string; origin: string;
  status: string; reason: string;
  costImpact: number; priceImpact: number; scheduleImpactDays: number;
  submittedAt?: string; decidedAt?: string; decidedBy?: string;
  items: { description: string; quantity: number; unit: string; unitPrice: number; costAmount: number; priceAmount: number }[];
}

export const CHANGE_ORDERS: ChangeOrderRecord[] = [
  {
    id: 'co-1', projectId: 'p-1', number: 'CO-003',
    title: 'Additional undercut at the MH-4 to MH-6 run',
    origin: 'differing_site_condition', status: 'submitted',
    reason: 'Saturated silty clay encountered 2.5 ft below the design invert for 340 LF, not shown on the geotechnical borings.',
    costImpact: 41_280, priceImpact: 51_600, scheduleImpactDays: 4,
    submittedAt: '2026-08-29',
    items: [
      { description: 'Undercut and remove unsuitable material', quantity: 630, unit: 'CY', unitPrice: 34.5, costAmount: 17_388, priceAmount: 21_735 },
      { description: 'ODOT 304 granular backfill, placed and compacted', quantity: 945, unit: 'TON', unitPrice: 21.4, costAmount: 20_223, priceAmount: 25_279 },
      { description: 'Additional dewatering, 4 days', quantity: 4, unit: 'DAY', unitPrice: 917.25, costAmount: 3_669, priceAmount: 4_586 },
    ],
  },
  {
    id: 'co-2', projectId: 'p-1', number: 'CO-002',
    title: 'Relocate STM-11 to clear the gas main',
    origin: 'design_change', status: 'approved',
    reason: 'Field-located 4" gas main conflicts with the STM-11 structure at the design location.',
    costImpact: 8_940, priceImpact: 11_175, scheduleImpactDays: 1,
    submittedAt: '2026-08-12', decidedAt: '2026-08-19', decidedBy: 'Maumee Development Partners',
    items: [
      { description: 'Relocate structure and re-route 64 LF of 12" RCP', quantity: 64, unit: 'LF', unitPrice: 96.5, costAmount: 6_176, priceAmount: 7_720 },
      { description: 'Additional excavation and hand digging at the gas crossing', quantity: 1, unit: 'LS', unitPrice: 2_764, costAmount: 2_764, priceAmount: 3_455 },
    ],
  },
  {
    id: 'co-3', projectId: 'p-2', number: 'CO-001',
    title: 'Owner-added storm inlet at the cul-de-sac',
    origin: 'owner_request', status: 'executed',
    reason: 'Owner requested an additional catch basin after observing ponding at the cul-de-sac.',
    costImpact: 6_420, priceImpact: 8_025, scheduleImpactDays: 0,
    submittedAt: '2026-07-08', decidedAt: '2026-07-15', decidedBy: 'Gerken Paving (GC)',
    items: [
      { description: 'Catch basin, 2 ft x 2 ft, with casting', quantity: 1, unit: 'EA', unitPrice: 3_180, costAmount: 3_180, priceAmount: 3_975 },
      { description: '12" RCP lateral to the existing main', quantity: 38, unit: 'LF', unitPrice: 85.3, costAmount: 3_240, priceAmount: 4_050 },
    ],
  },
];

export interface Notification {
  id: string; category: string; severity: 'info' | 'success' | 'warning' | 'critical';
  title: string; body: string; actionPath?: string; actionLabel?: string;
  createdAt: string; readAt?: string;
}

export const NOTIFICATIONS: Notification[] = [
  { id: 'n-1', category: 'ai_finding', severity: 'warning', title: 'Addendum 2 changed pavement quantities', body: 'AGT-REV found roughly 4,100 SF of truck court added between plan set revisions 2 and 3, with no matching bid quantity revision.', actionPath: '/app/plans', actionLabel: 'Review finding', createdAt: '2026-08-31T09:41:00Z' },
  { id: 'n-2', category: 'rfi', severity: 'critical', title: 'RFI-004 is 3 days from its due date', body: 'The undercut limits question is still unanswered. EST-2026-0184 cannot be issued until it is resolved.', actionPath: '/app/estimates/e0000000-0000-4000-8000-000000000001', actionLabel: 'Open estimate', createdAt: '2026-08-31T08:00:00Z' },
  { id: 'n-3', category: 'submittal', severity: 'warning', title: 'SUB-013 returned as revise and resubmit', body: 'Precast storm structures need the STM-08 sump depth corrected. Required on site 29 September with a 28-day lead time — resubmit by 1 September.', actionPath: '/app/projects/p-1', actionLabel: 'Open submittal', createdAt: '2026-08-27T14:12:00Z' },
  { id: 'n-4', category: 'change_order', severity: 'info', title: 'CO-003 submitted to the owner', body: 'Additional undercut at MH-4 to MH-6, $51,600 and 4 days.', actionPath: '/app/projects/p-1', actionLabel: 'Open change order', createdAt: '2026-08-29T16:30:00Z', readAt: '2026-08-29T17:02:00Z' },
  { id: 'n-5', category: 'calibration', severity: 'info', title: 'Storm sewer production is running 8.4% under estimate', body: 'Six completed jobs suggest revising PR-UTL-STORM from 21.0 to 19.24 LF/hr. Awaiting approval.', actionPath: '/app/projects', actionLabel: 'Review calibration', createdAt: '2026-08-28T11:30:00Z', readAt: '2026-08-28T12:00:00Z' },
  { id: 'n-6', category: 'approval', severity: 'success', title: 'CO-002 approved by the owner', body: 'Relocate STM-11 to clear the gas main — $11,175 approved.', actionPath: '/app/projects/p-1', actionLabel: 'Open change order', createdAt: '2026-08-19T10:05:00Z', readAt: '2026-08-19T10:30:00Z' },
];

export interface AiModel {
  id: string; provider: string; displayName: string; capabilities: string[];
  contextTokens: number; inputCost: number; outputCost: number;
  isDefault: boolean; enabled: boolean;
}

export const AI_MODELS: AiModel[] = [
  { id: 'claude-opus-5', provider: 'Anthropic', displayName: 'Claude Opus 5', capabilities: ['plan_reading', 'extraction', 'reasoning', 'vision'], contextTokens: 200_000, inputCost: 15, outputCost: 75, isDefault: true, enabled: true },
  { id: 'claude-sonnet-5', provider: 'Anthropic', displayName: 'Claude Sonnet 5', capabilities: ['plan_reading', 'extraction', 'summarization', 'vision'], contextTokens: 200_000, inputCost: 3, outputCost: 15, isDefault: false, enabled: true },
  { id: 'claude-haiku-4-5-20251001', provider: 'Anthropic', displayName: 'Claude Haiku 4.5', capabilities: ['classification', 'summarization'], contextTokens: 200_000, inputCost: 1, outputCost: 5, isDefault: false, enabled: true },
];

export interface AiPrompt {
  id: string; agentId: string; agentName: string; version: string;
  state: 'draft' | 'evaluating' | 'active' | 'retired';
  evalPassRate?: number; evalSampleSize?: number;
  activatedBy?: string; activatedAt?: string; scope: 'GrounUp' | 'Company';
}

export const AI_PROMPTS: AiPrompt[] = [
  { id: 'pr-1', agentId: 'AGT-TAKEOFF', agentName: 'AI Takeoff Assistant', version: 'v1.4', state: 'active', evalPassRate: 0.94, evalSampleSize: 240, activatedBy: 'Alice Okafor', activatedAt: '2026-07-14', scope: 'GrounUp' },
  { id: 'pr-2', agentId: 'AGT-DOC', agentName: 'AI Document Reader', version: 'v1.2', state: 'active', evalPassRate: 0.97, evalSampleSize: 180, activatedBy: 'Alice Okafor', activatedAt: '2026-06-30', scope: 'GrounUp' },
  { id: 'pr-3', agentId: 'AGT-REV', agentName: 'AI Revision Analyst', version: 'v1.1', state: 'active', evalPassRate: 0.91, evalSampleSize: 96, activatedBy: 'Alice Okafor', activatedAt: '2026-08-02', scope: 'GrounUp' },
  { id: 'pr-4', agentId: 'AGT-TAKEOFF', agentName: 'AI Takeoff Assistant', version: 'v1.5-ridgeline', state: 'evaluating', evalPassRate: 0.89, evalSampleSize: 61, scope: 'Company' },
  { id: 'pr-5', agentId: 'AGT-EST', agentName: 'AI Estimator', version: 'v2.0-draft', state: 'draft', scope: 'Company' },
];
