/**
 * Survey, machine control, claims and vendor network records.
 *
 * The surface volumes here are computed by @grounup/engine from real elevation
 * grids, not typed in — the same code path a drone flight would take.
 */
import { compareSurfaces, gridFrom, progressAgainstDesign, averageEndArea, type CrossSection } from '@grounup/engine';

/**
 * A 40 × 40 grid of 25 ft cells (1,000 × 1,000 ft = 22.96 acres).
 *
 * Existing ground is a gentle ridge falling to the north-east; the design is a
 * flat building pad at 632.0 with a 2% fall across the parking area. Generated
 * rather than hand-typed so the surface is smooth and the volumes are the ones
 * the geometry actually produces.
 */
const ROWS = 40;
const COLS = 40;
const CELL = 25;

function buildExisting(): (number | null)[] {
  const out: (number | null)[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      // A ridge running north-west to south-east, plus a shallow swale.
      const ridge = 636.5 - (r * 0.09) - (c * 0.055);
      const swale = Math.sin((c / COLS) * Math.PI * 1.5) * 0.9;
      // The survey boundary clips the far corner.
      if (r > 35 && c > 35) { out.push(null); continue; }
      out.push(Number((ridge + swale).toFixed(3)));
    }
  }
  return out;
}

function buildDesign(): (number | null)[] {
  const out: (number | null)[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (r > 35 && c > 35) { out.push(null); continue; }
      // Building pad flat at 632.00 over the first 20 columns; parking falls at
      // 2% away from the pad. The north-east quadrant is raised to a detention
      // berm, which puts that corner in fill — a site with cut everywhere and
      // no fill anywhere would be a poor demonstration of a balance.
      const base = c < 20 ? 632.0 : 632.0 - (c - 20) * CELL * 0.02;
      const berm = r > 26 && c > 26 ? 8.0 : 0;
      out.push(Number((base + berm).toFixed(3)));
    }
  }
  return out;
}

/** As-built after roughly two-thirds of the cut: partway down toward design. */
function buildAsBuilt(): (number | null)[] {
  const existing = buildExisting();
  const design = buildDesign();
  return existing.map((e, i) => {
    const d = design[i];
    if (e === null || d === null || d === undefined) return null;
    // A band of cells was taken past grade by an operator working without the
    // current machine control file — real, and the reason progress separates
    // over-excavation from completion.
    if (i % 97 === 0) return Number((d - 0.35).toFixed(3));
    // Everything else is roughly 68% of the way from existing to design.
    return Number((e - (e - d) * 0.68).toFixed(3));
  });
}

export const EXISTING_SURFACE = gridFrom(buildExisting(), ROWS, COLS, CELL, 'Existing ground');
export const DESIGN_SURFACE = gridFrom(buildDesign(), ROWS, COLS, CELL, 'Design subgrade');
export const ASBUILT_SURFACE = gridFrom(buildAsBuilt(), ROWS, COLS, CELL, 'As-built 2 September');

/** Computed by the engine, exactly as a drone flight would be. */
export const SURFACE_COMPARISON = compareSurfaces(EXISTING_SURFACE, DESIGN_SURFACE);
export const SURFACE_PROGRESS = progressAgainstDesign(
  EXISTING_SURFACE, ASBUILT_SURFACE, DESIGN_SURFACE, 0.1,
);

/** Roadway cross sections for the entrance drive, with one surveyed mid-section. */
const ROAD_SECTIONS: CrossSection[] = [
  { station: 0, cutAreaSf: 0, fillAreaSf: 62 },
  { station: 100, cutAreaSf: 0, fillAreaSf: 41, midCutAreaSf: 0, midFillAreaSf: 38 },
  { station: 200, cutAreaSf: 18, fillAreaSf: 12 },
  { station: 300, cutAreaSf: 54, fillAreaSf: 0 },
  { station: 400, cutAreaSf: 71, fillAreaSf: 0 },
  { station: 500, cutAreaSf: 44, fillAreaSf: 0 },
];
export const ROAD_AEA = averageEndArea(ROAD_SECTIONS);
export const ROAD_PRISMOIDAL = averageEndArea(ROAD_SECTIONS, true);

export interface SurveyRecord {
  id: string; name: string; method: string; capturedOn: string; capturedBy: string;
  verticalDatum: string; pointCount: number; areaSf: number; surfaces: string[];
}

export const SURVEYS: SurveyRecord[] = [
  { id: 'sv-1', name: 'Pre-construction topographic survey', method: 'gps_rover', capturedOn: '2026-04-28', capturedBy: 'Feller Finch & Associates', verticalDatum: 'NAVD88', pointCount: 4_812, areaSf: 986_000, surfaces: ['Existing ground'] },
  { id: 'sv-2', name: 'Design model — Phase 1 subgrade', method: 'design_model', capturedOn: '2026-04-30', capturedBy: 'Feller Finch & Associates', verticalDatum: 'NAVD88', pointCount: 1_600, areaSf: 986_000, surfaces: ['Design subgrade'] },
  { id: 'sv-3', name: 'Drone flight — 2 September progress', method: 'drone_photogrammetry', capturedOn: '2026-09-02', capturedBy: 'Ridgeline (in-house, Part 107)', verticalDatum: 'NAVD88', pointCount: 1_284_000, areaSf: 986_000, surfaces: ['As-built 2 September'] },
];

export interface MachineControlFile {
  id: string; name: string; format: string; vendor: string; version: number;
  status: 'draft' | 'published' | 'superseded'; publishedAt: string | null; publishedBy: string | null;
  assignedTo: string[];
}

export const MC_FILES: MachineControlFile[] = [
  { id: 'mc-1', name: 'Phase 1 subgrade', format: 'ttm', vendor: 'trimble', version: 3, status: 'published', publishedAt: '2026-08-24', publishedBy: 'Alice Okafor', assignedTo: ['DZ-2205', 'GR-3310'] },
  { id: 'mc-2', name: 'Phase 1 subgrade', format: 'ttm', vendor: 'trimble', version: 2, status: 'superseded', publishedAt: '2026-07-11', publishedBy: 'Alice Okafor', assignedTo: [] },
  { id: 'mc-3', name: 'Detention basin', format: 'xml_landxml', vendor: 'trimble', version: 1, status: 'published', publishedAt: '2026-08-18', publishedBy: 'Alice Okafor', assignedTo: ['EX-4418'] },
  { id: 'mc-4', name: 'Phase 2 subgrade', format: 'ttm', vendor: 'trimble', version: 1, status: 'draft', publishedAt: null, publishedBy: null, assignedTo: [] },
];

export interface Claim {
  id: string; number: string; title: string; type: string; description: string;
  eventDate: string; noticeGivenOn: string | null; noticeDueOn: string; claimDueOn: string;
  costClaimed: number; timeClaimedDays: number;
  costAwarded: number | null; timeAwardedDays: number | null;
  status: string; resolution: string | null;
  supporting: { dailyReports: number; rfis: number; documents: number };
}

export const CLAIMS: Claim[] = [
  {
    id: 'cl-1', number: 'CL-2026-002', title: 'Differing site condition — saturated subgrade MH-4 to MH-6',
    type: 'differing_site_condition',
    description: 'Saturated silty clay encountered 2.5 ft below the design invert for 340 LF. The geotechnical report shows firm clay at that depth in borings B-2 and B-4, and no groundwater above 9 ft.',
    eventDate: '2026-08-24', noticeGivenOn: '2026-08-26', noticeDueOn: '2026-08-31', claimDueOn: '2026-09-23',
    costClaimed: 51_600, timeClaimedDays: 4, costAwarded: null, timeAwardedDays: null,
    status: 'submitted', resolution: null,
    supporting: { dailyReports: 6, rfis: 1, documents: 4 },
  },
  {
    id: 'cl-2', number: 'CL-2026-001', title: 'Delay — utility relocation at STM-11',
    type: 'delay',
    description: 'Gas main relocation by the utility took 9 working days against the 3 shown on the coordination schedule, suspending storm installation on the east half.',
    eventDate: '2026-07-02', noticeGivenOn: '2026-07-06', noticeDueOn: '2026-07-09', claimDueOn: '2026-08-01',
    costClaimed: 28_400, timeClaimedDays: 6, costAwarded: 21_300, timeAwardedDays: 6,
    status: 'settled',
    resolution: 'Settled at $21,300 and 6 days of excusable, compensable delay. Time extension executed as CO-002A.',
    supporting: { dailyReports: 9, rfis: 2, documents: 3 },
  },
  {
    id: 'cl-3', number: 'CL-2026-003', title: 'Potential — undercut limits not defined',
    type: 'defective_documents',
    description: 'The geotechnical report recommends undercut where unsuitable material is found but gives no plan limit, and the bid schedule carries an arbitrary 3,000 CY. RFI-004 is unanswered.',
    eventDate: '2026-08-26', noticeGivenOn: null, noticeDueOn: '2026-09-02', claimDueOn: '2026-09-25',
    costClaimed: 0, timeClaimedDays: 0, costAwarded: null, timeAwardedDays: null,
    status: 'potential', resolution: null,
    supporting: { dailyReports: 0, rfis: 1, documents: 2 },
  },
];

export interface NetworkVendor {
  id: string; displayName: string; legalName: string; trades: string[];
  city: string; state: string; regions: string[];
  isPublished: boolean; ownedByUs: boolean;
  insuranceExpiresOn: string | null; bondingCapacity: number | null;
  isDbe: boolean; isMbe: boolean; isWbe: boolean; certifications: string[];
  ratings: { company: string; quality: number; schedule: number; safety: number; communication: number; wouldHireAgain: boolean; comment: string | null; contractValue: number | null }[];
}

export const NETWORK_VENDORS: NetworkVendor[] = [
  {
    id: 'nv-1', displayName: 'Buckeye Dewatering', legalName: 'Buckeye Dewatering LLC',
    trades: ['Dewatering', 'Wellpoint', 'Bypass pumping'], city: 'Toledo', state: 'OH',
    regions: ['Northwest Ohio', 'Southeast Michigan'], isPublished: true, ownedByUs: true,
    insuranceExpiresOn: '2027-03-31', bondingCapacity: 2_000_000,
    isDbe: false, isMbe: false, isWbe: false, certifications: ['OSHA 30', 'Confined space'],
    ratings: [
      { company: 'Ridgeline Excavating', quality: 5, schedule: 4, safety: 5, communication: 4, wouldHireAgain: true, comment: 'Mobilized inside 48 hours on the MH-4 undercut. Kept the hole dry through 3 in of rain.', contractValue: 24_800 },
      { company: 'Kesler Site Works', quality: 4, schedule: 4, safety: 5, communication: 5, wouldHireAgain: true, comment: null, contractValue: 41_200 },
    ],
  },
  {
    id: 'nv-2', displayName: 'Norwalk Concrete Industries', legalName: 'Norwalk Concrete Industries Inc',
    trades: ['Precast structures', 'RCP', 'Box culvert'], city: 'Norwalk', state: 'OH',
    regions: ['Ohio', 'Northern Indiana'], isPublished: true, ownedByUs: true,
    insuranceExpiresOn: '2026-12-31', bondingCapacity: 8_000_000,
    isDbe: false, isMbe: false, isWbe: false, certifications: ['ODOT prequalified', 'NPCA certified plant'],
    ratings: [
      { company: 'Ridgeline Excavating', quality: 4, schedule: 3, safety: 4, communication: 3, wouldHireAgain: true, comment: 'Product is right every time; shop drawings came back late twice and needed a resubmit.', contractValue: 33_850 },
    ],
  },
  {
    id: 'nv-3', displayName: 'Vega Traffic Control', legalName: 'Vega Traffic Control LLC',
    trades: ['Maintenance of traffic', 'Flagging', 'Signage'], city: 'Perrysburg', state: 'OH',
    regions: ['Northwest Ohio'], isPublished: true, ownedByUs: false,
    insuranceExpiresOn: '2026-09-15', bondingCapacity: 500_000,
    isDbe: true, isMbe: false, isWbe: true, certifications: ['ODOT MOT certified', 'ATSSA flagger instructor'],
    ratings: [
      { company: 'Gerken Paving', quality: 5, schedule: 5, safety: 5, communication: 5, wouldHireAgain: true, comment: 'Best MOT crew in the region. Setups match the plan without being asked twice.', contractValue: 88_400 },
      { company: 'Kesler Site Works', quality: 5, schedule: 4, safety: 5, communication: 4, wouldHireAgain: true, comment: null, contractValue: 32_100 },
    ],
  },
  {
    id: 'nv-4', displayName: 'Maumee Valley Trucking', legalName: 'Maumee Valley Trucking Co',
    trades: ['Trucking', 'Aggregate haul', 'Spoil disposal'], city: 'Maumee', state: 'OH',
    regions: ['Northwest Ohio'], isPublished: true, ownedByUs: false,
    insuranceExpiresOn: '2026-10-08', bondingCapacity: null,
    isDbe: false, isMbe: true, isWbe: false, certifications: ['DOT compliant', 'MSHA Part 46'],
    ratings: [
      { company: 'Ridgeline Excavating', quality: 4, schedule: 5, safety: 4, communication: 4, wouldHireAgain: true, comment: 'Held the cycle time we sized the fleet on across the whole export.', contractValue: 44_700 },
    ],
  },
  {
    id: 'nv-5', displayName: 'Fort Miami Precast', legalName: 'Fort Miami Precast Inc',
    trades: ['Precast structures'], city: 'Maumee', state: 'OH',
    regions: ['Northwest Ohio'], isPublished: false, ownedByUs: true,
    insuranceExpiresOn: '2026-11-20', bondingCapacity: 1_500_000,
    isDbe: false, isMbe: false, isWbe: false, certifications: [],
    ratings: [],
  },
];

export function vendorScore(v: NetworkVendor): number | null {
  if (v.ratings.length === 0) return null;
  const total = v.ratings.reduce(
    (a, r) => a + (r.quality + r.schedule + r.safety + r.communication) / 4, 0,
  );
  return Number((total / v.ratings.length).toFixed(2));
}
