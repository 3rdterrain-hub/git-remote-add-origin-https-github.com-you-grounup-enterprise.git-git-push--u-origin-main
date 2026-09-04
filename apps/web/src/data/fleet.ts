import { calculateSchedule, type ScheduleDependency, type ScheduleResult, type WorkCalendar } from '@grounup/engine';

/**
 * Fleet, workforce and schedule records for the demo tenant.
 *
 * Asset hours, fuel gallons and maintenance intervals are internally
 * consistent: a machine's next service is computed from its actual meter and
 * its interval, and its fuel burn is in the range the catalog rate assumes.
 * Figures that contradicted the estimating catalog would make the utilization
 * and calibration screens meaningless.
 */

export interface Asset {
  id: string; assetNumber: string; name: string; assetClass: string;
  make: string; model: string; modelYear: number; ownership: string;
  equipmentCode: string | null;
  currentHours: number; fuelType: string;
  assignedProject: string | null; assignedOperator: string | null;
  status: 'available' | 'assigned' | 'in_maintenance' | 'down';
  location: string; lastTelemetryAt: string | null;
  /** Utilization over the last 30 days: operating hours ÷ available hours. */
  utilization30d: number;
  acquisitionCost: number;
}

export const ASSETS: Asset[] = [
  { id: 'a-1', assetNumber: 'EX-4412', name: 'Excavator 20-25 ton', assetClass: 'Excavator', make: 'Caterpillar', model: '325', modelYear: 2022, ownership: 'owned', equipmentCode: 'EQ-EX-20', currentHours: 4_182, fuelType: 'diesel', assignedProject: 'PRJ-2026-011', assignedOperator: 'Marco Silva', status: 'assigned', location: 'Maumee Commerce Park', lastTelemetryAt: '2026-09-02T14:20:00Z', utilization30d: 0.78, acquisitionCost: 285_000 },
  { id: 'a-2', assetNumber: 'EX-4418', name: 'Excavator 35-40 ton', assetClass: 'Excavator', make: 'Komatsu', model: 'PC360', modelYear: 2021, ownership: 'owned', equipmentCode: 'EQ-EX-35', currentHours: 6_940, fuelType: 'diesel', assignedProject: null, assignedOperator: null, status: 'available', location: 'Toledo yard', lastTelemetryAt: '2026-09-01T22:10:00Z', utilization30d: 0.34, acquisitionCost: 412_000 },
  { id: 'a-3', assetNumber: 'DZ-2201', name: 'Dozer D6 class', assetClass: 'Dozer', make: 'Caterpillar', model: 'D6', modelYear: 2020, ownership: 'owned', equipmentCode: 'EQ-D6', currentHours: 8_755, fuelType: 'diesel', assignedProject: null, assignedOperator: null, status: 'in_maintenance', location: 'Toledo shop', lastTelemetryAt: '2026-08-30T16:45:00Z', utilization30d: 0.41, acquisitionCost: 368_000 },
  { id: 'a-4', assetNumber: 'DZ-2205', name: 'Dozer D6 class', assetClass: 'Dozer', make: 'Caterpillar', model: 'D6', modelYear: 2023, ownership: 'leased', equipmentCode: 'EQ-D6', currentHours: 2_106, fuelType: 'diesel', assignedProject: 'PRJ-2026-008', assignedOperator: 'Dee Harmon', status: 'assigned', location: 'Bowling Green', lastTelemetryAt: '2026-09-02T13:05:00Z', utilization30d: 0.83, acquisitionCost: 0 },
  { id: 'a-5', assetNumber: 'LD-1180', name: 'Wheel Loader 3-4 CY', assetClass: 'Loader', make: 'Volvo', model: 'L110', modelYear: 2019, ownership: 'owned', equipmentCode: 'EQ-LDR', currentHours: 11_240, fuelType: 'diesel', assignedProject: 'PRJ-2026-011', assignedOperator: 'Jess Toma', status: 'assigned', location: 'Maumee Commerce Park', lastTelemetryAt: '2026-09-02T15:02:00Z', utilization30d: 0.69, acquisitionCost: 298_000 },
  { id: 'a-6', assetNumber: 'RL-0904', name: 'Single Drum Roller', assetClass: 'Compactor', make: 'Bomag', model: 'BW211', modelYear: 2021, ownership: 'owned', equipmentCode: 'EQ-RLR', currentHours: 3_418, fuelType: 'diesel', assignedProject: 'PRJ-2026-008', assignedOperator: null, status: 'assigned', location: 'Bowling Green', lastTelemetryAt: '2026-09-02T11:40:00Z', utilization30d: 0.52, acquisitionCost: 142_000 },
  { id: 'a-7', assetNumber: 'GR-3310', name: 'Motor Grader', assetClass: 'Grader', make: 'John Deere', model: '772G', modelYear: 2018, ownership: 'owned', equipmentCode: 'EQ-GRD', currentHours: 9_880, fuelType: 'diesel', assignedProject: null, assignedOperator: null, status: 'down', location: 'Toledo shop', lastTelemetryAt: '2026-08-26T09:15:00Z', utilization30d: 0.11, acquisitionCost: 341_000 },
  { id: 'a-8', assetNumber: 'WT-0651', name: 'Water Truck', assetClass: 'Truck', make: 'Freightliner', model: 'M2 4000gal', modelYear: 2020, ownership: 'owned', equipmentCode: 'EQ-WTR', currentHours: 5_602, fuelType: 'diesel', assignedProject: 'PRJ-2026-011', assignedOperator: 'Ruth Alvarez', status: 'assigned', location: 'Maumee Commerce Park', lastTelemetryAt: '2026-09-02T14:55:00Z', utilization30d: 0.61, acquisitionCost: 178_000 },
  { id: 'a-9', assetNumber: 'SS-7702', name: 'Skid Steer', assetClass: 'Skid Steer', make: 'Bobcat', model: 'S76', modelYear: 2023, ownership: 'owned', equipmentCode: 'EQ-SSL', currentHours: 1_412, fuelType: 'diesel', assignedProject: 'PRJ-2026-011', assignedOperator: null, status: 'assigned', location: 'Maumee Commerce Park', lastTelemetryAt: '2026-09-02T12:30:00Z', utilization30d: 0.74, acquisitionCost: 78_000 },
  { id: 'a-10', assetNumber: 'PV-5501', name: 'Asphalt Paver', assetClass: 'Paving', make: 'Caterpillar', model: 'AP555F', modelYear: 2022, ownership: 'rented', equipmentCode: 'EQ-PAV', currentHours: 842, fuelType: 'diesel', assignedProject: null, assignedOperator: null, status: 'available', location: 'Toledo yard', lastTelemetryAt: null, utilization30d: 0.22, acquisitionCost: 0 },
];

export interface MaintenanceItem {
  id: string; assetId: string; assetNumber: string; assetName: string;
  scheduleName: string; intervalHours: number;
  lastPerformedHours: number; currentHours: number;
  /** Hours remaining until due. Negative means overdue. */
  hoursRemaining: number;
}

export const MAINTENANCE_DUE: MaintenanceItem[] = ASSETS
  .filter((a) => a.equipmentCode)
  .map((a, i) => {
    const interval = [250, 500, 500, 250, 500, 250, 500, 250, 250, 500][i] ?? 500;
    // Last service is placed so a couple of machines land overdue, which is
    // what the screen needs to demonstrate.
    const sinceService = [188, 240, 545, 96, 470, 132, 612, 205, 88, 40][i] ?? 100;
    const lastPerformed = a.currentHours - sinceService;
    return {
      id: `m-${a.id}`, assetId: a.id, assetNumber: a.assetNumber, assetName: a.name,
      scheduleName: interval === 250 ? '250-hour service' : '500-hour service',
      intervalHours: interval, lastPerformedHours: lastPerformed,
      currentHours: a.currentHours, hoursRemaining: interval - sinceService,
    };
  })
  .sort((x, y) => x.hoursRemaining - y.hoursRemaining);

export interface WorkOrder {
  id: string; number: string; assetNumber: string; assetName: string;
  title: string; type: string; priority: string; status: string;
  openedAt: string; completedAt?: string;
  downtimeHours: number; laborCost: number; partsCost: number; outsideCost: number;
  resolution?: string; assignedTo?: string;
}

export const WORK_ORDERS: WorkOrder[] = [
  { id: 'wo-1', number: 'WO-1188', assetNumber: 'GR-3310', assetName: 'Motor Grader', title: 'Hydraulic circle drive failure', type: 'corrective', priority: 'critical', status: 'awaiting_parts', openedAt: '2026-08-26', downtimeHours: 168, laborCost: 1_840, partsCost: 6_420, outsideCost: 0, assignedTo: 'Curtis Mbeki' },
  { id: 'wo-2', number: 'WO-1191', assetNumber: 'DZ-2201', assetName: 'Dozer D6 class', title: '500-hour service — overdue by 45 hours', type: 'preventive', priority: 'high', status: 'in_progress', openedAt: '2026-08-30', downtimeHours: 16, laborCost: 640, partsCost: 1_180, outsideCost: 0, assignedTo: 'Curtis Mbeki' },
  { id: 'wo-3', number: 'WO-1186', assetNumber: 'EX-4412', assetName: 'Excavator 20-25 ton', title: '250-hour service', type: 'preventive', priority: 'normal', status: 'complete', openedAt: '2026-08-14', completedAt: '2026-08-15', downtimeHours: 6, laborCost: 380, partsCost: 620, outsideCost: 0, resolution: 'Oil and filters changed, tracks tensioned, undercarriage inspected. No defects found.', assignedTo: 'Curtis Mbeki' },
  { id: 'wo-4', number: 'WO-1190', assetNumber: 'WT-0651', assetName: 'Water Truck', title: 'DOT annual inspection', type: 'inspection', priority: 'normal', status: 'scheduled', openedAt: '2026-08-29', downtimeHours: 0, laborCost: 0, partsCost: 0, outsideCost: 450 },
  { id: 'wo-5', number: 'WO-1184', assetNumber: 'LD-1180', assetName: 'Wheel Loader 3-4 CY', title: 'Bucket cutting edge replacement', type: 'corrective', priority: 'normal', status: 'complete', openedAt: '2026-08-08', completedAt: '2026-08-09', downtimeHours: 8, laborCost: 520, partsCost: 2_140, outsideCost: 0, resolution: 'Replaced cutting edge and both bolt-on corner segments. Wear consistent with hours.', assignedTo: 'Curtis Mbeki' },
];

export interface FuelTransaction {
  id: string; transactedAt: string; assetNumber: string | null; assetName: string;
  gallons: number; pricePerGallon: number; location: string; source: string;
  operator?: string; exception?: 'no_asset' | 'meter_regression' | 'volume_outlier' | 'duplicate';
}

export const FUEL_TRANSACTIONS: FuelTransaction[] = [
  { id: 'f-1', transactedAt: '2026-09-02T07:12:00Z', assetNumber: 'EX-4412', assetName: 'Excavator 20-25 ton', gallons: 46.2, pricePerGallon: 4.19, location: 'On-site tank', source: 'onsite_tank', operator: 'Marco Silva' },
  { id: 'f-2', transactedAt: '2026-09-02T06:48:00Z', assetNumber: 'LD-1180', assetName: 'Wheel Loader 3-4 CY', gallons: 52.8, pricePerGallon: 4.19, location: 'On-site tank', source: 'onsite_tank', operator: 'Jess Toma' },
  { id: 'f-3', transactedAt: '2026-09-01T16:30:00Z', assetNumber: 'WT-0651', assetName: 'Water Truck', gallons: 38.4, pricePerGallon: 4.31, location: 'Pilot #412, Perrysburg', source: 'fuel_card', operator: 'Ruth Alvarez' },
  { id: 'f-4', transactedAt: '2026-09-01T14:05:00Z', assetNumber: null, assetName: 'Unmatched card transaction', gallons: 41.1, pricePerGallon: 4.31, location: 'Pilot #412, Perrysburg', source: 'fuel_card', exception: 'no_asset' },
  { id: 'f-5', transactedAt: '2026-08-31T07:20:00Z', assetNumber: 'DZ-2205', assetName: 'Dozer D6 class', gallons: 61.5, pricePerGallon: 4.19, location: 'On-site tank', source: 'onsite_tank', operator: 'Dee Harmon' },
  { id: 'f-6', transactedAt: '2026-08-30T18:44:00Z', assetNumber: 'EX-4418', assetName: 'Excavator 35-40 ton', gallons: 118.9, pricePerGallon: 4.24, location: 'Toledo yard', source: 'onsite_tank', exception: 'volume_outlier' },
  { id: 'f-7', transactedAt: '2026-08-30T07:05:00Z', assetNumber: 'SS-7702', assetName: 'Skid Steer', gallons: 17.2, pricePerGallon: 4.19, location: 'On-site tank', source: 'onsite_tank' },
];

export interface Employee {
  id: string; employeeNumber: string; name: string; classification: string;
  employmentType: string; isUnion: boolean; hireDate: string;
  hourlyRate: number; status: string; assignedProject: string | null;
  credentials: { name: string; expiresOn: string | null; status: 'valid' | 'expiring' | 'expired' }[];
}

export const EMPLOYEES: Employee[] = [
  { id: 'e-1', employeeNumber: 'EMP-0104', name: 'Ray Delgado', classification: 'Foreman', employmentType: 'full_time', isUnion: false, hireDate: '2019-03-11', hourlyRate: 48, status: 'active', assignedProject: 'PRJ-2026-011', credentials: [{ name: 'OSHA 30', expiresOn: '2027-04-02', status: 'valid' }, { name: 'Competent Person — Excavation', expiresOn: '2026-11-14', status: 'valid' }, { name: 'First Aid / CPR', expiresOn: '2026-09-20', status: 'expiring' }] },
  { id: 'e-2', employeeNumber: 'EMP-0118', name: 'Marco Silva', classification: 'Heavy Equipment Operator II', employmentType: 'full_time', isUnion: true, hireDate: '2020-06-01', hourlyRate: 44, status: 'active', assignedProject: 'PRJ-2026-011', credentials: [{ name: 'OSHA 10', expiresOn: null, status: 'valid' }, { name: 'CDL Class A', expiresOn: '2028-02-19', status: 'valid' }] },
  { id: 'e-3', employeeNumber: 'EMP-0132', name: 'Nina Barros', classification: 'Superintendent', employmentType: 'full_time', isUnion: false, hireDate: '2017-09-25', hourlyRate: 58, status: 'active', assignedProject: 'PRJ-2026-008', credentials: [{ name: 'OSHA 30', expiresOn: '2028-01-08', status: 'valid' }, { name: 'Competent Person — Excavation', expiresOn: '2026-09-11', status: 'expiring' }] },
  { id: 'e-4', employeeNumber: 'EMP-0147', name: 'Jess Toma', classification: 'Heavy Equipment Operator I', employmentType: 'full_time', isUnion: true, hireDate: '2022-04-18', hourlyRate: 40, status: 'active', assignedProject: 'PRJ-2026-011', credentials: [{ name: 'OSHA 10', expiresOn: null, status: 'valid' }] },
  { id: 'e-5', employeeNumber: 'EMP-0151', name: 'Dee Harmon', classification: 'Heavy Equipment Operator II', employmentType: 'full_time', isUnion: true, hireDate: '2021-08-02', hourlyRate: 44, status: 'active', assignedProject: 'PRJ-2026-008', credentials: [{ name: 'OSHA 10', expiresOn: null, status: 'valid' }, { name: 'CDL Class A', expiresOn: '2026-09-08', status: 'expiring' }] },
  { id: 'e-6', employeeNumber: 'EMP-0163', name: 'Ruth Alvarez', classification: 'CDL Truck Driver', employmentType: 'full_time', isUnion: false, hireDate: '2023-01-09', hourlyRate: 34, status: 'active', assignedProject: 'PRJ-2026-011', credentials: [{ name: 'CDL Class B', expiresOn: '2027-06-30', status: 'valid' }, { name: 'DOT Medical Card', expiresOn: '2026-08-28', status: 'expired' }] },
  { id: 'e-7', employeeNumber: 'EMP-0170', name: 'Curtis Mbeki', classification: 'Field Mechanic', employmentType: 'full_time', isUnion: false, hireDate: '2018-11-05', hourlyRate: 45, status: 'active', assignedProject: null, credentials: [{ name: 'OSHA 10', expiresOn: null, status: 'valid' }, { name: 'ASE Heavy Equipment', expiresOn: '2027-03-15', status: 'valid' }] },
  { id: 'e-8', employeeNumber: 'EMP-0181', name: 'Tomas Reyes', classification: 'Pipe Layer', employmentType: 'seasonal', isUnion: true, hireDate: '2026-04-01', hourlyRate: 36, status: 'active', assignedProject: 'PRJ-2026-011', credentials: [{ name: 'OSHA 10', expiresOn: null, status: 'valid' }, { name: 'Confined Space Entry', expiresOn: '2026-10-02', status: 'expiring' }] },
];

export interface TimeEntry {
  id: string; employeeName: string; workDate: string; project: string;
  costCode: string; straight: number; overtime: number;
  approvalState: 'pending' | 'approved'; exported: boolean;
}

export const TIME_ENTRIES: TimeEntry[] = [
  { id: 't-1', employeeName: 'Ray Delgado', workDate: '2026-09-01', project: 'PRJ-2026-011', costCode: 'CC-0340', straight: 8, overtime: 1.5, approvalState: 'pending', exported: false },
  { id: 't-2', employeeName: 'Marco Silva', workDate: '2026-09-01', project: 'PRJ-2026-011', costCode: 'CC-0340', straight: 8, overtime: 1.5, approvalState: 'pending', exported: false },
  { id: 't-3', employeeName: 'Tomas Reyes', workDate: '2026-09-01', project: 'PRJ-2026-011', costCode: 'CC-0340', straight: 8, overtime: 1.5, approvalState: 'pending', exported: false },
  { id: 't-4', employeeName: 'Ruth Alvarez', workDate: '2026-09-01', project: 'PRJ-2026-011', costCode: 'CC-0220', straight: 8, overtime: 0, approvalState: 'pending', exported: false },
  { id: 't-5', employeeName: 'Nina Barros', workDate: '2026-09-01', project: 'PRJ-2026-008', costCode: 'CC-0610', straight: 9, overtime: 0, approvalState: 'approved', exported: false },
  { id: 't-6', employeeName: 'Dee Harmon', workDate: '2026-09-01', project: 'PRJ-2026-008', costCode: 'CC-0610', straight: 9, overtime: 0, approvalState: 'approved', exported: false },
  { id: 't-7', employeeName: 'Ray Delgado', workDate: '2026-08-29', project: 'PRJ-2026-011', costCode: 'CC-0340', straight: 8, overtime: 0, approvalState: 'approved', exported: true },
  { id: 't-8', employeeName: 'Marco Silva', workDate: '2026-08-29', project: 'PRJ-2026-011', costCode: 'CC-0340', straight: 8, overtime: 0, approvalState: 'approved', exported: true },
];

/* -----------------------------------------------------------------------------
 * Schedule
 *
 * Only the inputs are written down here: the activities, how long each takes,
 * the logic between them, and the calendar the crews work. Every date, every
 * float figure and every critical flag below is computed by
 * `calculateSchedule` from @grounup/engine.
 *
 * They used to be typed. An activity said its float was four days because
 * somebody wrote 4, and the screen displayed it the same way it displays a
 * derived number — which is the same defect as a settings toggle that switches
 * nothing. A float figure nothing computed is a picture of a schedule.
 * -------------------------------------------------------------------------- */

/** Ohio, five days a week, with the holidays that fall inside this job. */
export const FIELD_CALENDAR: WorkCalendar = {
  id: 'OH-FIELD',
  name: 'Ohio field calendar',
  workingWeekdays: [1, 2, 3, 4, 5],
  holidays: [
    '2026-05-25', // Memorial Day
    '2026-07-03', // Independence Day observed — the 4th is a Saturday in 2026
    '2026-09-07', // Labor Day
  ],
};

/** What a superintendent supplies: the work, its duration, and its crew. */
interface PlannedActivity {
  id: string; wbs: string; name: string; project: string;
  durationDays: number; percentComplete: number; crew: string | null;
}

const PLANNED: PlannedActivity[] = [
  { id: 'sa-1', wbs: '1.1', name: 'Mobilization and site setup', project: 'PRJ-2026-011', durationDays: 5, percentComplete: 1, crew: 'CRW-EW-01' },
  { id: 'sa-2', wbs: '1.2', name: 'Erosion control and construction entrance', project: 'PRJ-2026-011', durationDays: 5, percentComplete: 1, crew: 'CRW-EW-01' },
  { id: 'sa-3', wbs: '2.1', name: 'Deep sanitary sewer — MH-1 to MH-4', project: 'PRJ-2026-011', durationDays: 30, percentComplete: 1, crew: 'CRW-UTL-01' },
  { id: 'sa-4', wbs: '2.2', name: 'Deep sanitary sewer — MH-4 to MH-8', project: 'PRJ-2026-011', durationDays: 40, percentComplete: 0.92, crew: 'CRW-UTL-01' },
  { id: 'sa-5', wbs: '2.3', name: 'Storm sewer trunk and structures', project: 'PRJ-2026-011', durationDays: 50, percentComplete: 0.68, crew: 'CRW-UTL-01' },
  { id: 'sa-6', wbs: '2.4', name: 'Undercut and granular backfill — MH-4 to MH-6', project: 'PRJ-2026-011', durationDays: 15, percentComplete: 0.4, crew: 'CRW-EW-01' },
  { id: 'sa-7', wbs: '3.1', name: 'Water main and services', project: 'PRJ-2026-011', durationDays: 18, percentComplete: 0, crew: 'CRW-UTL-01' },
  { id: 'sa-8', wbs: '3.2', name: 'Final grading and restoration', project: 'PRJ-2026-011', durationDays: 10, percentComplete: 0, crew: 'CRW-GRD-01' },
  { id: 'sa-9', wbs: '4.0', name: 'Substantial completion', project: 'PRJ-2026-011', durationDays: 0, percentComplete: 0, crew: null },
];

/** The sequence, as a superintendent would describe it. */
const LOGIC: ScheduleDependency[] = [
  // Erosion control starts two days into mobilization rather than after it.
  { predecessorId: 'sa-1', successorId: 'sa-2', type: 'start_to_start', lagDays: 2 },
  { predecessorId: 'sa-1', successorId: 'sa-3', type: 'finish_to_start' },
  // Perimeter control and the construction entrance go in before soil is
  // disturbed — the SWPPP requires it, and without the link erosion control
  // would be open-ended and report float bounded only by the end of the job.
  { predecessorId: 'sa-2', successorId: 'sa-3', type: 'finish_to_start' },
  { predecessorId: 'sa-3', successorId: 'sa-4', type: 'finish_to_start' },
  // Storm follows the sanitary crew down the same corridor, ten days back.
  { predecessorId: 'sa-4', successorId: 'sa-5', type: 'start_to_start', lagDays: 10 },
  { predecessorId: 'sa-4', successorId: 'sa-6', type: 'finish_to_start' },
  { predecessorId: 'sa-6', successorId: 'sa-7', type: 'finish_to_start' },
  { predecessorId: 'sa-7', successorId: 'sa-8', type: 'finish_to_start' },
  // Nothing gets its final grade until the storm structures are set.
  { predecessorId: 'sa-5', successorId: 'sa-8', type: 'finish_to_start' },
  { predecessorId: 'sa-8', successorId: 'sa-9', type: 'finish_to_start' },
];

/** The critical path run behind every date on the schedule screen. */
export const SCHEDULE_CALCULATION: ScheduleResult = calculateSchedule({
  dataDate: '2026-05-04',
  calendars: [FIELD_CALENDAR],
  defaultCalendarId: FIELD_CALENDAR.id,
  activities: PLANNED.map((a) => ({ id: a.id, name: a.name, durationDays: a.durationDays })),
  dependencies: LOGIC,
});

export interface ScheduleActivity {
  id: string; wbs: string; name: string; project: string;
  plannedStart: string; plannedFinish: string; durationDays: number;
  percentComplete: number; totalFloatDays: number; freeFloatDays: number;
  isCritical: boolean; isMilestone: boolean; crew: string | null;
  lateStart: string; lateFinish: string;
  /** One line saying where these dates came from. */
  derivation: string;
}

export const SCHEDULE: ScheduleActivity[] = PLANNED.map((a) => {
  const computed = SCHEDULE_CALCULATION.activities.find((c) => c.id === a.id)!;
  return {
    id: a.id, wbs: a.wbs, name: a.name, project: a.project,
    durationDays: computed.durationDays,
    percentComplete: a.percentComplete,
    crew: a.crew,
    plannedStart: computed.earlyStart,
    plannedFinish: computed.earlyFinish,
    lateStart: computed.lateStart,
    lateFinish: computed.lateFinish,
    totalFloatDays: computed.totalFloatDays,
    freeFloatDays: computed.freeFloatDays,
    isCritical: computed.isCritical,
    isMilestone: computed.isMilestone,
    derivation: computed.derivation,
  };
});
