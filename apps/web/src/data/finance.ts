/**
 * Finance and procurement records for the demo tenant.
 *
 * The schedule of values sums to the contract, the pay application bills
 * against that schedule, and committed purchase orders sit inside the budget
 * they draw on. Figures that did not tie would make the WIP and cash screens
 * decorative rather than useful.
 */
import { PROJECTS } from './operations';

const PROJECT = PROJECTS[0]!; // PRJ-2026-011, contract $1,482,000

export interface SovItem {
  id: string; itemNumber: string; description: string; scheduledValue: number;
  previousCompleted: number; thisPeriod: number; storedMaterials: number;
}

export const SCHEDULE_OF_VALUES: SovItem[] = [
  { id: 'sov-1', itemNumber: '01', description: 'Mobilization and general conditions', scheduledValue: 92_000, previousCompleted: 82_800, thisPeriod: 4_600, storedMaterials: 0 },
  { id: 'sov-2', itemNumber: '02', description: 'Erosion control and SWPPP', scheduledValue: 38_500, previousCompleted: 30_800, thisPeriod: 3_850, storedMaterials: 0 },
  { id: 'sov-3', itemNumber: '03', description: 'Sanitary sewer — mains and structures', scheduledValue: 486_000, previousCompleted: 340_200, thisPeriod: 72_900, storedMaterials: 0 },
  { id: 'sov-4', itemNumber: '04', description: 'Storm sewer — trunk and structures', scheduledValue: 418_000, previousCompleted: 238_260, thisPeriod: 46_400, storedMaterials: 18_200 },
  { id: 'sov-5', itemNumber: '05', description: 'Water main and services', scheduledValue: 264_000, previousCompleted: 0, thisPeriod: 0, storedMaterials: 31_400 },
  { id: 'sov-6', itemNumber: '06', description: 'Undercut and granular backfill', scheduledValue: 96_500, previousCompleted: 28_950, thisPeriod: 19_300, storedMaterials: 0 },
  { id: 'sov-7', itemNumber: '07', description: 'Final grading and restoration', scheduledValue: 87_000, previousCompleted: 0, thisPeriod: 0, storedMaterials: 0 },
];

export const RETAINAGE_PERCENT = 0.05;

/** Derived so the certificate and its lines can never disagree. */
export function payApplicationTotals() {
  const scheduled = SCHEDULE_OF_VALUES.reduce((a, s) => a + s.scheduledValue, 0);
  const previous = SCHEDULE_OF_VALUES.reduce((a, s) => a + s.previousCompleted, 0);
  const thisPeriod = SCHEDULE_OF_VALUES.reduce((a, s) => a + s.thisPeriod, 0);
  const stored = SCHEDULE_OF_VALUES.reduce((a, s) => a + s.storedMaterials, 0);
  const completedToDate = previous + thisPeriod;
  const totalEarned = completedToDate + stored;
  const retainage = totalEarned * RETAINAGE_PERCENT;
  const previousPayments = (previous) * (1 - RETAINAGE_PERCENT);
  return {
    scheduled,
    approvedChanges: 11_175, // CO-002, approved
    previous, thisPeriod, stored, completedToDate, totalEarned,
    retainage,
    previousPayments,
    currentDue: totalEarned - retainage - previousPayments,
  };
}

export interface PayApplication {
  id: string; number: number; periodStart: string; periodEnd: string;
  totalEarned: number; retainage: number; currentDue: number;
  status: string; submittedAt?: string; approvedAt?: string; paidAt?: string; amountPaid: number;
}

export const PAY_APPLICATIONS: PayApplication[] = [
  { id: 'pa-4', number: 4, periodStart: '2026-08-01', periodEnd: '2026-08-31', totalEarned: payApplicationTotals().totalEarned, retainage: payApplicationTotals().retainage, currentDue: payApplicationTotals().currentDue, status: 'draft', amountPaid: 0 },
  { id: 'pa-3', number: 3, periodStart: '2026-07-01', periodEnd: '2026-07-31', totalEarned: 721_010, retainage: 36_050, currentDue: 148_820, status: 'paid', submittedAt: '2026-08-05', approvedAt: '2026-08-12', paidAt: '2026-08-26', amountPaid: 148_820 },
  { id: 'pa-2', number: 2, periodStart: '2026-06-01', periodEnd: '2026-06-30', totalEarned: 564_400, retainage: 28_220, currentDue: 189_240, status: 'paid', submittedAt: '2026-07-06', approvedAt: '2026-07-14', paidAt: '2026-07-28', amountPaid: 189_240 },
  { id: 'pa-1', number: 1, periodStart: '2026-05-01', periodEnd: '2026-05-31', totalEarned: 365_200, retainage: 18_260, currentDue: 346_940, status: 'paid', submittedAt: '2026-06-04', approvedAt: '2026-06-11', paidAt: '2026-06-25', amountPaid: 346_940 },
];

export interface WipRow {
  project: string; name: string; contract: number; budget: number;
  actualCost: number; percentComplete: number; billedToDate: number;
}

/** Work-in-progress: the schedule that tells you whether you are over or under billed. */
export const WIP: WipRow[] = PROJECTS.map((p) => ({
  project: p.number,
  name: p.name,
  contract: p.contractValue,
  budget: p.budget,
  actualCost: p.actualCost,
  percentComplete: p.percentComplete,
  // Billing tends to run slightly behind cost on unit-price work.
  billedToDate: p.contractValue * Math.max(p.percentComplete - 0.03, 0),
}));

export interface Rfq {
  id: string; number: string; title: string; trade: string; dueAt: string;
  status: string; awardedVendor?: string; awardReason?: string;
  responses: { vendor: string; quoted: number | null; levelingAdjustment: number; leadTimeDays: number | null; status: string; note?: string }[];
}

export const RFQS: Rfq[] = [
  {
    id: 'rfq-1', number: 'RFQ-2026-018', title: 'Precast storm structures — Phase 1', trade: 'Precast concrete',
    dueAt: '2026-09-08', status: 'leveling',
    responses: [
      { vendor: 'Norwalk Concrete', quoted: 33_850, levelingAdjustment: 0, leadTimeDays: 28, status: 'leveled' },
      { vendor: 'Fort Miami Precast', quoted: 31_200, levelingAdjustment: 3_400, leadTimeDays: 42, status: 'leveled', note: 'Excludes delivery and setting; adjustment adds freight for 17 structures.' },
      { vendor: 'Buckeye Precast', quoted: 35_900, levelingAdjustment: 0, leadTimeDays: 21, status: 'leveled' },
      { vendor: 'Lima Precast', quoted: null, levelingAdjustment: 0, leadTimeDays: null, status: 'declined', note: 'Declined — capacity booked through November.' },
    ],
  },
  {
    id: 'rfq-2', number: 'RFQ-2026-016', title: 'Aggregate supply — ODOT 304 and #57', trade: 'Aggregate',
    dueAt: '2026-08-22', status: 'awarded', awardedVendor: 'Stoneco',
    awardReason: 'Low leveled price and the only quote holding through the full construction window.',
    responses: [
      { vendor: 'Stoneco', quoted: 128_400, levelingAdjustment: 0, leadTimeDays: 7, status: 'awarded' },
      { vendor: 'Gerken Materials', quoted: 126_900, levelingAdjustment: 4_800, leadTimeDays: 7, status: 'not_awarded', note: 'Price held only 30 days; adjustment reflects escalation exposure over the balance of the job.' },
      { vendor: 'Kokosing Materials', quoted: 134_100, levelingAdjustment: 0, leadTimeDays: 10, status: 'not_awarded' },
    ],
  },
  {
    id: 'rfq-3', number: 'RFQ-2026-021', title: 'Asphalt paving — subcontract', trade: 'Asphalt',
    dueAt: '2026-09-19', status: 'issued',
    responses: [
      { vendor: 'Gerken Paving', quoted: null, levelingAdjustment: 0, leadTimeDays: null, status: 'invited' },
      { vendor: 'Shelly Company', quoted: null, levelingAdjustment: 0, leadTimeDays: null, status: 'invited' },
    ],
  },
];

export interface PurchaseOrder {
  id: string; number: string; vendor: string; title: string; type: string;
  project: string; committed: number; invoiced: number; received: number; paid: number;
  neededBy: string; status: string; issuedAt?: string;
}

export const PURCHASE_ORDERS: PurchaseOrder[] = [
  { id: 'po-1', number: 'PO-2026-0412', vendor: 'Stoneco', title: 'ODOT 304 and #57 aggregate', type: 'material', project: 'PRJ-2026-011', committed: 128_400, invoiced: 86_720, received: 88_100, paid: 62_400, neededBy: '2026-09-15', status: 'partially_received', issuedAt: '2026-08-25' },
  { id: 'po-2', number: 'PO-2026-0418', vendor: 'Core & Main', title: '8" PVC SDR-35 and fittings', type: 'material', project: 'PRJ-2026-011', committed: 41_620, invoiced: 41_620, received: 41_620, paid: 41_620, neededBy: '2026-07-20', status: 'closed', issuedAt: '2026-07-02' },
  { id: 'po-3', number: 'PO-2026-0426', vendor: 'Norwalk Concrete', title: 'Precast storm structures', type: 'material', project: 'PRJ-2026-011', committed: 33_850, invoiced: 0, received: 0, paid: 0, neededBy: '2026-09-29', status: 'issued', issuedAt: '2026-08-28' },
  { id: 'po-4', number: 'PO-2026-0431', vendor: 'Buckeye Dewatering', title: 'Wellpoint dewatering — MH-4 to MH-6', type: 'subcontract', project: 'PRJ-2026-011', committed: 24_800, invoiced: 18_600, received: 0, paid: 0, neededBy: '2026-09-04', status: 'issued', issuedAt: '2026-08-19' },
  { id: 'po-5', number: 'PO-2026-0402', vendor: 'Gerken', title: '4000 psi ready-mix — curb and walk', type: 'material', project: 'PRJ-2026-008', committed: 68_940, invoiced: 52_100, received: 54_300, paid: 52_100, neededBy: '2026-09-30', status: 'partially_received', issuedAt: '2026-06-14' },
];

export interface ApInvoice {
  id: string; vendor: string; invoiceNumber: string; invoiceDate: string; dueDate: string;
  amount: number; retainageWithheld: number; amountPaid: number;
  matchStatus: string; status: string; po?: string; project?: string;
}

export const AP_INVOICES: ApInvoice[] = [
  { id: 'ap-1', vendor: 'Stoneco', invoiceNumber: 'SC-88412-3', invoiceDate: '2026-08-28', dueDate: '2026-09-27', amount: 24_320, retainageWithheld: 0, amountPaid: 0, matchStatus: 'matched', status: 'approved', po: 'PO-2026-0412', project: 'PRJ-2026-011' },
  { id: 'ap-2', vendor: 'Buckeye Dewatering', invoiceNumber: 'BD-2211', invoiceDate: '2026-08-30', dueDate: '2026-09-29', amount: 18_600, retainageWithheld: 930, amountPaid: 0, matchStatus: 'no_po', status: 'on_hold', project: 'PRJ-2026-011' },
  { id: 'ap-3', vendor: 'Gerken', invoiceNumber: 'GK-5520-7', invoiceDate: '2026-08-26', dueDate: '2026-09-25', amount: 14_680, retainageWithheld: 0, amountPaid: 0, matchStatus: 'quantity_variance', status: 'disputed', po: 'PO-2026-0402', project: 'PRJ-2026-008' },
  { id: 'ap-4', vendor: 'Core & Main', invoiceNumber: 'CM-7741-2', invoiceDate: '2026-07-30', dueDate: '2026-08-29', amount: 41_620, retainageWithheld: 0, amountPaid: 41_620, matchStatus: 'matched', status: 'paid', po: 'PO-2026-0418', project: 'PRJ-2026-011' },
  { id: 'ap-5', vendor: 'Norwalk Concrete', invoiceNumber: 'NC-2210-1', invoiceDate: '2026-08-20', dueDate: '2026-09-19', amount: 9_400, retainageWithheld: 0, amountPaid: 9_400, matchStatus: 'matched', status: 'paid', po: 'PO-2026-0426', project: 'PRJ-2026-011' },
];

export interface InventoryItem {
  id: string; sku: string; name: string; category: string; unit: string;
  location: string; onHand: number; reserved: number; reorderPoint: number; unitCost: number;
}

export const INVENTORY: InventoryItem[] = [
  { id: 'inv-1', sku: 'PVC-8-SDR35', name: '8" PVC SDR-35 pipe', category: 'Pipe', unit: 'LF', location: 'Main yard', onHand: 640, reserved: 480, reorderPoint: 400, unitCost: 18.9 },
  { id: 'inv-2', sku: 'RCP-12-C3', name: '12" RCP Class III', category: 'Pipe', unit: 'LF', location: 'Main yard', onHand: 212, reserved: 200, reorderPoint: 300, unitCost: 34.5 },
  { id: 'inv-3', sku: 'AGG-57', name: '#57 bedding stone', category: 'Aggregate', unit: 'TON', location: 'Main yard', onHand: 148, reserved: 60, reorderPoint: 120, unitCost: 24.0 },
  { id: 'inv-4', sku: 'AGG-304', name: 'ODOT 304 granular fill', category: 'Aggregate', unit: 'TON', location: 'Main yard', onHand: 820, reserved: 540, reorderPoint: 500, unitCost: 18.75 },
  { id: 'inv-5', sku: 'MH-48-PC', name: '48" precast manhole barrel', category: 'Structures', unit: 'EA', location: 'Main yard', onHand: 6, reserved: 4, reorderPoint: 4, unitCost: 685 },
  { id: 'inv-6', sku: 'SILT-FENCE', name: 'Silt fence, 36" reinforced', category: 'Erosion control', unit: 'LF', location: 'Main yard', onHand: 2_400, reserved: 0, reorderPoint: 1_000, unitCost: 1.85 },
  { id: 'inv-7', sku: 'TRK-BOX-8', name: '8 ft trench box, 12 ft panels', category: 'Safety', unit: 'EA', location: 'Main yard', onHand: 3, reserved: 2, reorderPoint: 2, unitCost: 8_400 },
];

export { PROJECT };
