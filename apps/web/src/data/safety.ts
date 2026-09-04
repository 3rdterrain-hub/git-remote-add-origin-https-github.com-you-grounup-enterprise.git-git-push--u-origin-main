/** Safety, quality and connector records for the demo tenant. */

export interface Incident {
  id: string; number: string; occurredAt: string; type: string; severity: string;
  project: string; employee: string | null; description: string;
  isOshaRecordable: boolean; oshaCaseNumber: string | null;
  daysAway: number; daysRestricted: number;
  rootCause: string | null; correctiveAction: string | null;
  investigationState: 'open' | 'investigating' | 'corrective_action' | 'closed';
}

export const INCIDENTS: Incident[] = [
  { id: 'i-1', number: 'INC-2026-014', occurredAt: '2026-08-28T09:40:00Z', type: 'near_miss', severity: 'high', project: 'PRJ-2026-011', employee: 'Tomas Reyes', description: 'Trench wall sloughed at Sta. 6+40 while the crew was outside the box. No one was in the excavation.', isOshaRecordable: false, oshaCaseNumber: null, daysAway: 0, daysRestricted: 0, rootCause: 'Overnight rain saturated the spoil pile, which was stored within 2 ft of the trench edge.', correctiveAction: 'Spoil relocated to 6 ft minimum from the edge on all runs; re-benched before re-entry; added to the daily pre-task plan.', investigationState: 'closed' },
  { id: 'i-2', number: 'INC-2026-013', occurredAt: '2026-08-14T13:15:00Z', type: 'first_aid', severity: 'low', project: 'PRJ-2026-008', employee: 'Dee Harmon', description: 'Laceration to the left forearm on a pipe band while unloading. Cleaned and bandaged on site.', isOshaRecordable: false, oshaCaseNumber: null, daysAway: 0, daysRestricted: 0, rootCause: 'Banding cut under tension without a guard.', correctiveAction: 'Band cutters issued to both crews; toolbox talk on unloading held 15 August.', investigationState: 'closed' },
  { id: 'i-3', number: 'INC-2026-015', occurredAt: '2026-09-01T11:05:00Z', type: 'utility_strike', severity: 'critical', project: 'PRJ-2026-011', employee: null, description: 'Excavator bucket contacted an unmarked 1" gas service at Sta. 9+20. No ignition. Line isolated by the utility within 40 minutes; area evacuated.', isOshaRecordable: false, oshaCaseNumber: null, daysAway: 0, daysRestricted: 0, rootCause: null, correctiveAction: null, investigationState: 'investigating' },
  { id: 'i-4', number: 'INC-2026-011', occurredAt: '2026-06-22T15:30:00Z', type: 'lost_time', severity: 'high', project: 'PRJ-2026-004', employee: 'Marco Silva', description: 'Ankle fracture stepping from the excavator track onto uneven spoil.', isOshaRecordable: true, oshaCaseNumber: 'OSHA-2026-002', daysAway: 12, daysRestricted: 18, rootCause: 'No three-point access maintained; ground at the dismount point was not leveled.', correctiveAction: 'Dismount zones leveled and marked on all machines; three-point contact added to the equipment pre-use check.', investigationState: 'closed' },
];

export interface ToolboxTalk {
  id: string; heldOn: string; topic: string; presenter: string; project: string; attendees: number;
}

export const TOOLBOX_TALKS: ToolboxTalk[] = [
  { id: 'tt-1', heldOn: '2026-09-01', topic: 'Utility strike response and one-call verification', presenter: 'Ray Delgado', project: 'PRJ-2026-011', attendees: 6 },
  { id: 'tt-2', heldOn: '2026-08-29', topic: 'Excavation entry and competent person duties', presenter: 'Ray Delgado', project: 'PRJ-2026-011', attendees: 6 },
  { id: 'tt-3', heldOn: '2026-08-28', topic: 'Spoil pile placement and trench edge control', presenter: 'Nina Barros', project: 'PRJ-2026-008', attendees: 7 },
  { id: 'tt-4', heldOn: '2026-08-22', topic: 'Heat illness prevention', presenter: 'Nina Barros', project: 'PRJ-2026-008', attendees: 7 },
];

export interface Observation {
  id: string; observedAt: string; observer: string; project: string; category: string;
  isPositive: boolean; description: string; correctedOnSite: boolean; correctiveAction: string | null;
}

export const OBSERVATIONS: Observation[] = [
  { id: 'ob-1', observedAt: '2026-09-01T08:20:00Z', observer: 'Ray Delgado', project: 'PRJ-2026-011', category: 'excavation', isPositive: true, description: 'Trench box set correctly ahead of entry; ladder within 25 ft as required.', correctedOnSite: false, correctiveAction: null },
  { id: 'ob-2', observedAt: '2026-08-31T14:45:00Z', observer: 'Nina Barros', project: 'PRJ-2026-008', category: 'ppe', isPositive: false, description: 'Two operators without hi-vis while working near the haul route.', correctedOnSite: true, correctiveAction: null },
  { id: 'ob-3', observedAt: '2026-08-30T10:10:00Z', observer: 'Ray Delgado', project: 'PRJ-2026-011', category: 'traffic', isPositive: false, description: 'Flagger station set inside the taper rather than ahead of it on the Dussel Drive approach.', correctedOnSite: false, correctiveAction: 'Traffic control plan re-briefed; station relocated 120 ft upstream and marked on the site plan.' },
  { id: 'ob-4', observedAt: '2026-08-29T07:55:00Z', observer: 'Curtis Mbeki', project: 'PRJ-2026-011', category: 'equipment', isPositive: false, description: 'Excavator back-up alarm intermittent on EX-4412.', correctedOnSite: true, correctiveAction: null },
];

export interface Inspection {
  id: string; number: string; type: string; title: string; specReference: string;
  station: string; inspectedAt: string; inspector: string; agency: string;
  required: number | null; achieved: number | null; unit: string | null;
  result: 'pending' | 'pass' | 'fail' | 'conditional'; notes: string | null; isRetest: boolean;
}

export const INSPECTIONS: Inspection[] = [
  { id: 'in-1', number: 'QC-2026-088', type: 'compaction', title: 'Trench backfill compaction, MH-4 to MH-5', specReference: '31 23 33', station: '6+00 – 8+40', inspectedAt: '2026-09-01T13:20:00Z', inspector: 'A. Whitlock', agency: 'Bowser-Morner', required: 95, achieved: 97.2, unit: '% Standard Proctor', result: 'pass', notes: null, isRetest: false },
  { id: 'in-2', number: 'QC-2026-087', type: 'pipe_test', title: 'Low-pressure air test, MH-3 to MH-4', specReference: '33 31 00', station: '3+20 – 6+00', inspectedAt: '2026-08-31T10:00:00Z', inspector: 'Lucas County', agency: 'Lucas County Engineer', required: 3.5, achieved: 3.5, unit: 'psi held 5 min', result: 'pass', notes: null, isRetest: false },
  { id: 'in-3', number: 'QC-2026-085', type: 'compaction', title: 'Trench backfill compaction, MH-2 to MH-3', specReference: '31 23 33', station: '1+40 – 3+20', inspectedAt: '2026-08-27T15:40:00Z', inspector: 'A. Whitlock', agency: 'Bowser-Morner', required: 95, achieved: 91.4, unit: '% Standard Proctor', result: 'fail', notes: 'Moisture 4.2% above optimum. Backfill removed to 3 ft, aerated and recompacted. Retest QC-2026-086 passed.', isRetest: false },
  { id: 'in-4', number: 'QC-2026-086', type: 'compaction', title: 'Retest — trench backfill, MH-2 to MH-3', specReference: '31 23 33', station: '1+40 – 3+20', inspectedAt: '2026-08-28T11:15:00Z', inspector: 'A. Whitlock', agency: 'Bowser-Morner', required: 95, achieved: 96.8, unit: '% Standard Proctor', result: 'pass', notes: null, isRetest: true },
  { id: 'in-5', number: 'QC-2026-089', type: 'proof_roll', title: 'Subgrade proof roll, building pad', specReference: '31 22 00', station: 'Pad A', inspectedAt: '2026-09-02T09:00:00Z', inspector: 'A. Whitlock', agency: 'Bowser-Morner', required: null, achieved: null, unit: null, result: 'pending', notes: null, isRetest: false },
];

export interface Deficiency {
  id: string; number: string; description: string; location: string; trade: string;
  responsible: string; identifiedOn: string; dueOn: string;
  status: 'open' | 'in_progress' | 'ready_for_review' | 'closed'; verificationNote: string | null;
}

export const DEFICIENCIES: Deficiency[] = [
  { id: 'df-1', number: 'PL-014', description: 'Manhole MH-5 casting sits 1.5" above finished grade.', location: 'Sta. 8+40', trade: 'Utilities', responsible: 'Self-perform', identifiedOn: '2026-08-30', dueOn: '2026-09-12', status: 'open', verificationNote: null },
  { id: 'df-2', number: 'PL-013', description: 'Silt fence detached along the north property line for approximately 80 LF.', location: 'North line', trade: 'Erosion control', responsible: 'Self-perform', identifiedOn: '2026-08-29', dueOn: '2026-09-05', status: 'in_progress', verificationNote: null },
  { id: 'df-3', number: 'PL-011', description: 'Storm structure STM-08 sump 6" shallower than the C-402 schedule.', location: 'Sta. 4+10', trade: 'Utilities', responsible: 'Norwalk Concrete', identifiedOn: '2026-08-21', dueOn: '2026-09-04', status: 'ready_for_review', verificationNote: null },
  { id: 'df-4', number: 'PL-009', description: 'Curb joint spacing exceeds 10 ft at the east entrance return.', location: 'East entrance', trade: 'Concrete', responsible: 'Self-perform', identifiedOn: '2026-08-12', dueOn: '2026-08-26', status: 'closed', verificationNote: 'Saw-cut joints added at 8 ft on center and verified against the C-501 detail on 25 August.' },
];

export interface Connector {
  id: string; type: string; provider: string; name: string;
  status: 'not_connected' | 'connected' | 'degraded' | 'failed' | 'disabled';
  isEnabled: boolean; lastRunAt: string | null; lastSuccessAt: string | null;
  consecutiveFailures: number; schedule: string | null;
  lastRun?: { recordsRead: number; recordsWritten: number; recordsSkipped: number; status: string; error?: string };
}

export const CONNECTORS: Connector[] = [
  { id: 'cx-1', type: 'accounting', provider: 'Sage 300 CRE', name: 'Job cost and AP export', status: 'connected', isEnabled: true, lastRunAt: '2026-09-02T06:00:00Z', lastSuccessAt: '2026-09-02T06:00:00Z', consecutiveFailures: 0, schedule: '0 6 * * *', lastRun: { recordsRead: 0, recordsWritten: 418, recordsSkipped: 2, status: 'succeeded' } },
  { id: 'cx-2', type: 'telematics', provider: 'Caterpillar VisionLink', name: 'Machine hours and location', status: 'connected', isEnabled: true, lastRunAt: '2026-09-02T15:00:00Z', lastSuccessAt: '2026-09-02T15:00:00Z', consecutiveFailures: 0, schedule: '0 */1 * * *', lastRun: { recordsRead: 62, recordsWritten: 62, recordsSkipped: 0, status: 'succeeded' } },
  { id: 'cx-3', type: 'fuel_card', provider: 'WEX', name: 'Fuel transactions', status: 'degraded', isEnabled: true, lastRunAt: '2026-09-02T05:30:00Z', lastSuccessAt: '2026-09-01T05:30:00Z', consecutiveFailures: 1, schedule: '30 5 * * *', lastRun: { recordsRead: 41, recordsWritten: 40, recordsSkipped: 1, status: 'partial', error: 'One transaction could not be matched to an asset and was flagged for reconciliation rather than posted.' } },
  { id: 'cx-4', type: 'payroll', provider: 'ADP Workforce Now', name: 'Timecard export', status: 'not_connected', isEnabled: false, lastRunAt: null, lastSuccessAt: null, consecutiveFailures: 0, schedule: null },
  { id: 'cx-5', type: 'machine_control', provider: 'Trimble WorksManager', name: 'Design surfaces and as-builts', status: 'not_connected', isEnabled: false, lastRunAt: null, lastSuccessAt: null, consecutiveFailures: 0, schedule: null },
  { id: 'cx-6', type: 'weather', provider: 'NOAA', name: 'Site weather for daily reports', status: 'connected', isEnabled: true, lastRunAt: '2026-09-02T12:00:00Z', lastSuccessAt: '2026-09-02T12:00:00Z', consecutiveFailures: 0, schedule: '0 12 * * *', lastRun: { recordsRead: 4, recordsWritten: 4, recordsSkipped: 0, status: 'succeeded' } },
];
