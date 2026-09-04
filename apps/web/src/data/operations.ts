/**
 * CRM, project, document and AI-finding records for the demo tenant.
 *
 * These carry the same shapes the PostgreSQL schema defines, so swapping the
 * demo adapter for the Supabase adapter is a data-source change rather than a
 * rewrite of every screen.
 */
import { ESTIMATE } from './demo';

export interface Customer {
  id: string; code: string; name: string; type: string; city: string; state: string;
  contact: string; email: string; phone: string;
  openOpportunities: number; wonValue: number; since: string;
}

export const CUSTOMERS: Customer[] = [
  { id: 'cu-1', code: 'CUST-014', name: 'Maumee Development Partners', type: 'Developer', city: 'Maumee', state: 'OH', contact: 'Priya Raman', email: 'praman@maumeedev.test', phone: '(419) 555-0142', openOpportunities: 2, wonValue: 4_180_000, since: '2023-04-11' },
  { id: 'cu-2', code: 'CUST-007', name: 'Lucas County Engineer', type: 'Municipal', city: 'Toledo', state: 'OH', contact: 'Marcus Bell', email: 'mbell@lucascounty.test', phone: '(419) 555-0188', openOpportunities: 1, wonValue: 2_940_000, since: '2021-09-02' },
  { id: 'cu-3', code: 'CUST-021', name: 'Northwood Industrial REIT', type: 'Commercial', city: 'Northwood', state: 'OH', contact: 'Elena Vasquez', email: 'evasquez@nwreit.test', phone: '(419) 555-0219', openOpportunities: 1, wonValue: 1_260_000, since: '2024-02-20' },
  { id: 'cu-4', code: 'CUST-033', name: 'Perrysburg Schools', type: 'Municipal', city: 'Perrysburg', state: 'OH', contact: 'Tom Okonkwo', email: 'tokonkwo@pburgschools.test', phone: '(419) 555-0277', openOpportunities: 1, wonValue: 0, since: '2026-05-14' },
  { id: 'cu-5', code: 'CUST-009', name: 'Gerken Paving (GC)', type: 'General Contractor', city: 'Napoleon', state: 'OH', contact: 'Rachel Kim', email: 'rkim@gerken.test', phone: '(419) 555-0301', openOpportunities: 0, wonValue: 3_520_000, since: '2020-06-30' },
];

export interface Opportunity {
  id: string; number: string; name: string; customerId: string; customerName: string;
  stage: 'identified' | 'qualifying' | 'estimating' | 'proposed' | 'negotiating' | 'won' | 'lost';
  value: number; probability: number; bidDueAt: string; owner: string;
  estimateNumber?: string; lossReason?: string;
}

export const OPPORTUNITIES: Opportunity[] = [
  { id: 'op-1', number: 'OPP-2026-041', name: 'Maumee Commerce Park — Phase 1 Sitework', customerId: 'cu-1', customerName: 'Maumee Development Partners', stage: 'estimating', value: 2_330_000, probability: 0.55, bidDueAt: '2026-09-11T15:00:00Z', owner: 'Dana Whitfield', estimateNumber: 'EST-2026-0184' },
  { id: 'op-2', number: 'OPP-2026-038', name: 'Airport Highway culvert replacement', customerId: 'cu-2', customerName: 'Lucas County Engineer', stage: 'proposed', value: 1_140_000, probability: 0.4, bidDueAt: '2026-09-04T14:00:00Z', owner: 'Dana Whitfield', estimateNumber: 'EST-2026-0179' },
  { id: 'op-3', number: 'OPP-2026-044', name: 'Northwood distribution center — mass grading', customerId: 'cu-3', customerName: 'Northwood Industrial REIT', stage: 'qualifying', value: 860_000, probability: 0.25, bidDueAt: '2026-09-26T17:00:00Z', owner: 'Alice Okafor' },
  { id: 'op-4', number: 'OPP-2026-045', name: 'Perrysburg HS athletic complex earthwork', customerId: 'cu-4', customerName: 'Perrysburg Schools', stage: 'identified', value: 640_000, probability: 0.15, bidDueAt: '2026-10-09T16:00:00Z', owner: 'Alice Okafor' },
  { id: 'op-5', number: 'OPP-2026-030', name: 'Maumee Commerce Park — Phase 2 utilities', customerId: 'cu-1', customerName: 'Maumee Development Partners', stage: 'negotiating', value: 1_480_000, probability: 0.7, bidDueAt: '2026-09-18T15:00:00Z', owner: 'Dana Whitfield', estimateNumber: 'EST-2026-0171' },
  { id: 'op-6', number: 'OPP-2026-022', name: 'Oregon Road industrial pad', customerId: 'cu-3', customerName: 'Northwood Industrial REIT', stage: 'lost', value: 720_000, probability: 0, bidDueAt: '2026-06-19T15:00:00Z', owner: 'Dana Whitfield', lossReason: 'Low bid was 8.4% under our number; competitor self-performed the haul.' },
];

export interface EstimateSummary {
  id: string; number: string; name: string; customer: string; version: number;
  status: string; value: number; confidence: number; decision: string;
  updatedAt: string; estimator: string; blocked: boolean;
}

export const ESTIMATES: EstimateSummary[] = [
  {
    id: ESTIMATE.id, number: ESTIMATE.number, name: ESTIMATE.name, customer: 'Maumee Development Partners',
    version: ESTIMATE.version, status: ESTIMATE.status, value: ESTIMATE.bidPrice,
    confidence: ESTIMATE.weightedConfidence, decision: ESTIMATE.executiveDecision,
    updatedAt: '2026-08-30T18:12:00Z', estimator: 'Dana Whitfield', blocked: ESTIMATE.blockedFromIssue,
  },
  { id: 'e-2', number: 'EST-2026-0179', name: 'Airport Highway culvert replacement', customer: 'Lucas County Engineer', version: 2, status: 'issued', value: 1_142_500, confidence: 93.4, decision: 'ready_with_assumptions', updatedAt: '2026-08-28T14:40:00Z', estimator: 'Dana Whitfield', blocked: false },
  { id: 'e-3', number: 'EST-2026-0171', name: 'Maumee Commerce Park — Phase 2 utilities', customer: 'Maumee Development Partners', version: 4, status: 'issued', value: 1_482_000, confidence: 91.8, decision: 'ready_with_assumptions', updatedAt: '2026-08-21T11:05:00Z', estimator: 'Dana Whitfield', blocked: false },
  { id: 'e-4', number: 'EST-2026-0186', name: 'Northwood distribution center — mass grading', customer: 'Northwood Industrial REIT', version: 1, status: 'draft', value: 0, confidence: 0, decision: 'document_set_incomplete', updatedAt: '2026-08-31T09:22:00Z', estimator: 'Alice Okafor', blocked: true },
  { id: 'e-5', number: 'EST-2026-0158', name: 'Oregon Road industrial pad', customer: 'Northwood Industrial REIT', version: 3, status: 'lost', value: 786_400, confidence: 94.1, decision: 'ready_for_estimating', updatedAt: '2026-06-19T16:00:00Z', estimator: 'Dana Whitfield', blocked: false },
];

export interface Project {
  id: string; number: string; name: string; customer: string; status: string;
  contractValue: number; budget: number; actualCost: number; percentComplete: number;
  plannedStart: string; plannedFinish: string; pm: string; superintendent: string;
  openChangeOrders: number; openRfis: number;
}

export const PROJECTS: Project[] = [
  { id: 'p-1', number: 'PRJ-2026-011', name: 'Maumee Commerce Park — Phase 2 utilities', customer: 'Maumee Development Partners', status: 'active', contractValue: 1_482_000, budget: 1_186_000, actualCost: 742_318, percentComplete: 0.61, plannedStart: '2026-05-04', plannedFinish: '2026-10-16', pm: 'Alice Okafor', superintendent: 'Ray Delgado', openChangeOrders: 2, openRfis: 3 },
  { id: 'p-2', number: 'PRJ-2026-008', name: 'Gerken Paving — Bowling Green subdivision', customer: 'Gerken Paving (GC)', status: 'active', contractValue: 934_000, budget: 748_000, actualCost: 701_442, percentComplete: 0.88, plannedStart: '2026-03-16', plannedFinish: '2026-09-12', pm: 'Alice Okafor', superintendent: 'Nina Barros', openChangeOrders: 1, openRfis: 0 },
  { id: 'p-3', number: 'PRJ-2026-004', name: 'Lucas County — Sylvania Ave storm rehab', customer: 'Lucas County Engineer', status: 'substantially_complete', contractValue: 612_000, budget: 489_600, actualCost: 471_205, percentComplete: 0.97, plannedStart: '2026-02-02', plannedFinish: '2026-07-31', pm: 'Dana Whitfield', superintendent: 'Ray Delgado', openChangeOrders: 0, openRfis: 0 },
  { id: 'p-4', number: 'PRJ-2026-014', name: 'Northwood REIT — Oregon Road detention basin', customer: 'Northwood Industrial REIT', status: 'preconstruction', contractValue: 388_000, budget: 310_400, actualCost: 0, percentComplete: 0, plannedStart: '2026-09-21', plannedFinish: '2026-12-05', pm: 'Alice Okafor', superintendent: 'Nina Barros', openChangeOrders: 0, openRfis: 1 },
];

export interface DocumentRecord {
  id: string; name: string; type: string; discipline: string; version: number;
  pages: number; issueDate: string; state: 'indexed' | 'extracting' | 'pending' | 'failed';
  superseded: boolean; findings: number;
}

export const DOCUMENTS: DocumentRecord[] = [
  { id: 'd-1', name: 'Maumee Commerce Park — Civil plan set', type: 'plan_set', discipline: 'Civil', version: 3, pages: 47, issueDate: '2026-08-12', state: 'indexed', superseded: false, findings: 14 },
  { id: 'd-2', name: 'Addendum No. 2 — grading limits and undercut', type: 'addendum', discipline: 'Civil', version: 1, pages: 6, issueDate: '2026-08-22', state: 'indexed', superseded: false, findings: 5 },
  { id: 'd-3', name: 'Geotechnical exploration report', type: 'geotechnical', discipline: 'Geotechnical', version: 1, pages: 88, issueDate: '2026-07-30', state: 'indexed', superseded: false, findings: 9 },
  { id: 'd-4', name: 'Project manual — Divisions 31–33', type: 'specification', discipline: 'Civil', version: 1, pages: 214, issueDate: '2026-08-12', state: 'indexed', superseded: false, findings: 7 },
  { id: 'd-5', name: 'Maumee Commerce Park — Civil plan set', type: 'plan_set', discipline: 'Civil', version: 2, pages: 45, issueDate: '2026-07-18', state: 'indexed', superseded: true, findings: 0 },
  { id: 'd-6', name: 'Bid form and quantity schedule', type: 'bid_form', discipline: 'Commercial', version: 2, pages: 4, issueDate: '2026-08-22', state: 'indexed', superseded: false, findings: 3 },
  { id: 'd-7', name: 'ALTA survey and topographic base', type: 'survey', discipline: 'Survey', version: 1, pages: 3, issueDate: '2026-06-04', state: 'indexed', superseded: false, findings: 2 },
  { id: 'd-8', name: 'Wetland delineation report', type: 'environmental', discipline: 'Environmental', version: 1, pages: 22, issueDate: '2026-07-11', state: 'extracting', superseded: false, findings: 0 },
];

export interface AiFinding {
  id: string; agent: string; type: string; title: string; description: string;
  citations: string[]; confidence: number; gate: string;
  state: 'proposed' | 'accepted' | 'rejected'; severity?: 'low' | 'moderate' | 'high' | 'critical';
  reviewedBy?: string;
}

export const AI_FINDINGS: AiFinding[] = [
  {
    id: 'f-1', agent: 'AGT-TAKEOFF', type: 'quantity_candidate',
    title: 'Storm sewer length differs from the bid schedule by 68 LF',
    description: 'Structure-to-structure lengths measured from the C-302 profile total 2,572 LF after deducting 17 structures at 4 ft. The bid schedule lists 2,640 LF, which appears to measure center-to-center without the structure deduction.',
    citations: ['C-301 storm plan', 'C-302 storm profile', 'C-402 structure schedule'],
    confidence: 91, gate: 'estimator_review', state: 'accepted', reviewedBy: 'Dana Whitfield',
  },
  {
    id: 'f-2', agent: 'AGT-DOC', type: 'conflict',
    title: 'MH-3 rim elevation disagrees between plan and profile',
    description: 'C-303 shows the MH-3 rim at 634.20; the C-304 profile shows 635.60. The 1.4 ft difference changes the sanitary trench depth for roughly 240 LF and moves the run across a depth band.',
    citations: ['C-303 sanitary plan', 'C-304 sanitary profile'],
    confidence: 96, gate: 'senior_review', state: 'proposed', severity: 'high',
  },
  {
    id: 'f-3', agent: 'AGT-EST', type: 'missing_information',
    title: 'Undercut limits are not defined on the drawings',
    description: 'The geotechnical report recommends undercut "where unsuitable material is encountered" but no plan limit, depth or quantity is given, and the bid schedule carries an arbitrary 3,000 CY. The exposure between the report language and the bid quantity is roughly $126,000.',
    citations: ['Geotechnical report Section 6.4', 'Bid form item 204'],
    confidence: 89, gate: 'rfi_required', state: 'accepted', severity: 'critical', reviewedBy: 'Dana Whitfield',
  },
  {
    id: 'f-4', agent: 'AGT-REV', type: 'scope_item',
    title: 'Addendum 2 added 4,100 SF of pavement not in the base bid',
    description: 'Comparing plan set v2 to v3, the truck court on the east side grew by approximately 4,100 SF. The bid schedule quantities for items 301 and 448 were not revised in Addendum 2.',
    citations: ['C-301 rev 3', 'C-301 rev 2', 'Addendum No. 2'],
    confidence: 87, gate: 'estimator_review', state: 'proposed', severity: 'moderate',
  },
  {
    id: 'f-5', agent: 'AGT-EST', type: 'assumption',
    title: 'Erosion control is specified but carries no bid item',
    description: 'Spec Section 31 25 00 requires silt fence, inlet protection, a stabilized construction entrance and weekly SWPPP inspection. No bid item covers them, so they are incidental and belong in general conditions.',
    citations: ['Spec 31 25 00', 'Bid form'],
    confidence: 93, gate: 'estimator_review', state: 'accepted', reviewedBy: 'Alice Okafor',
  },
  {
    id: 'f-6', agent: 'AGT-SAFE', type: 'risk',
    title: 'Groundwater sits above the sanitary invert for the full run',
    description: 'Borings B-2, B-4 and B-7 report groundwater at 7.5 ft. The sanitary invert runs 8–12 ft deep, so dewatering is probable rather than possible across the entire alignment.',
    citations: ['Geotechnical report Section 4.3', 'C-304 sanitary profile'],
    confidence: 94, gate: 'senior_review', state: 'proposed', severity: 'high',
  },
];

export interface RfiRecord {
  id: string; number: string; title: string; discipline: string; priority: string;
  status: 'open' | 'answered' | 'closed'; submittedAt: string; dueAt: string;
  question: string; costImpact: string;
}

export const RFIS: RfiRecord[] = [
  { id: 'r-1', number: 'RFI-004', title: 'Undercut limits and payment basis', discipline: 'Civil', priority: 'critical', status: 'open', submittedAt: '2026-08-26', dueAt: '2026-09-05', question: 'The geotechnical report recommends undercut where unsuitable material is encountered, but no plan limit, depth or quantity is shown. Please define the undercut limits and confirm whether item 204 is measured in place or as a plan quantity.', costImpact: 'Approximately $126,000 of exposure against a 3,000 CY bid quantity.' },
  { id: 'r-2', number: 'RFI-005', title: 'MH-3 rim elevation conflict', discipline: 'Civil', priority: 'high', status: 'open', submittedAt: '2026-08-27', dueAt: '2026-09-05', question: 'C-303 shows the MH-3 rim at 634.20 and C-304 shows 635.60. Please confirm the governing elevation.', costImpact: 'Changes trench depth band for approximately 240 LF of 8" sanitary.' },
  { id: 'r-3', number: 'RFI-006', title: 'Truck court pavement quantities after Addendum 2', discipline: 'Civil', priority: 'normal', status: 'answered', submittedAt: '2026-08-24', dueAt: '2026-09-02', question: 'Addendum 2 enlarged the east truck court but the bid quantities for items 301 and 448 were not revised. Please confirm the bid quantities.', costImpact: 'Approximately 4,100 SF of additional pavement.' },
];

export interface ActivityEvent {
  id: string; at: string; actor: string; action: string; detail: string;
  tone: 'neutral' | 'success' | 'warn' | 'danger';
}

export const ACTIVITY: ActivityEvent[] = [
  { id: 'a-1', at: '2026-08-31T09:41:00Z', actor: 'AGT-REV', action: 'AI finding proposed', detail: 'Addendum 2 added 4,100 SF of pavement not reflected in the bid schedule.', tone: 'warn' },
  { id: 'a-2', at: '2026-08-30T18:12:00Z', actor: 'Dana Whitfield', action: 'Estimate revised', detail: 'EST-2026-0184 version 3 created — Addendum 2 changed the grading limits.', tone: 'neutral' },
  { id: 'a-3', at: '2026-08-30T16:55:00Z', actor: 'Dana Whitfield', action: 'AI finding accepted', detail: 'Storm sewer length reconciled to 2,572 LF after the structure deduction.', tone: 'success' },
  { id: 'a-4', at: '2026-08-29T14:02:00Z', actor: 'Ray Delgado', action: 'Production recorded', detail: 'PRJ-2026-011: 412 LF of 8" sanitary installed in 34.5 crew hours.', tone: 'neutral' },
  { id: 'a-5', at: '2026-08-28T11:30:00Z', actor: 'System', action: 'Calibration proposed', detail: 'Storm sewer production is running 8.4% under the catalog rate across 6 jobs.', tone: 'warn' },
  { id: 'a-6', at: '2026-08-27T09:15:00Z', actor: 'Dana Whitfield', action: 'RFI submitted', detail: 'RFI-005 — MH-3 rim elevation conflict between C-303 and C-304.', tone: 'danger' },
  { id: 'a-7', at: '2026-08-26T15:48:00Z', actor: 'Alice Okafor', action: 'Estimate issued', detail: 'EST-2026-0179 issued to Lucas County Engineer at $1,142,500.', tone: 'success' },
];

export interface CalibrationProposal {
  id: string; rateCode: string; rateName: string; currentRate: number; proposedRate: number;
  variancePercent: number; sampleSize: number; conditions: string; state: 'pending' | 'approved' | 'rejected';
}

export const CALIBRATIONS: CalibrationProposal[] = [
  { id: 'cal-1', rateCode: 'PR-UTL-STORM', rateName: '12" storm sewer installation, 6–8 ft', currentRate: 21, proposedRate: 19.24, variancePercent: -0.084, sampleSize: 6, conditions: 'Normal access, wet material, 6–8 ft depth band', state: 'pending' },
  { id: 'cal-2', rateCode: 'PR-EW-MASS', rateName: 'Mass excavation — excavator and two dozers', currentRate: 185, proposedRate: 176.4, variancePercent: -0.046, sampleSize: 9, conditions: 'Normal access, wet material, haul under 8 miles', state: 'pending' },
  { id: 'cal-3', rateCode: 'PR-CON-CURB', rateName: '24" integral curb and gutter', currentRate: 46, proposedRate: 49.1, variancePercent: 0.067, sampleSize: 5, conditions: 'Normal access, machine-placed, continuous runs over 400 LF', state: 'pending' },
];
