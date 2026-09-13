/**
 * What a dashboard may be built from.
 *
 * The dashboard showed four figures and three panels while the semantic layer
 * held nineteen reporting views that nothing rendered. So a company could be
 * over-billed on a project, have a foreman's certification lapsing in nine days
 * and an investigation still open, and the first screen they saw every morning
 * said none of it.
 *
 * One catalog, because three things have to agree about it: what the dashboard
 * renders, what the customizer offers, and what a person is allowed to see. A
 * panel offered that nothing renders is a broken checkbox; a panel rendered
 * that the customizer does not know about cannot be turned off; and a panel
 * showing safety records to somebody without safety permission is a leak. All
 * three read this list.
 */

/** The tabs a dashboard is grouped into, in the order they appear. */
export const DASHBOARD_TABS = [
  'Today',
  'Winning work',
  'Doing the work',
  'Getting paid',
  'People & safety',
] as const;

export type DashboardTab = typeof DASHBOARD_TABS[number];

export interface PanelDefinition {
  key: string;
  title: string;
  /** What the panel is for, shown in the customizer rather than on the panel. */
  blurb: string;
  tab: DashboardTab;
  /** The permission a person needs before this is offered or rendered. */
  permission: string;
  /** Whether a person who has never customized anything sees it. */
  defaultOn: boolean;
  /** Half width on a wide screen, or the full row. */
  width: 'half' | 'full';
}

export const PANELS: readonly PanelDefinition[] = [
  {
    key: 'shortcuts',
    title: 'Jump to',
    blurb: "What a day usually starts with, and every section of the platform one click away. A toolbar of eighteen items asks you to remember which one holds the thing you are about to do.",
    tab: 'Today', permission: 'estimates.read', defaultOn: true, width: 'full',
  },
  {
    key: 'due',
    title: 'What is due',
    blurb: 'Bid deadlines and estimate expiries — the dates after which doing nothing costs you the job.',
    tab: 'Today', permission: 'estimates.read', defaultOn: true, width: 'full',
  },
  {
    key: 'clock',
    title: 'Your clock',
    blurb: 'Clock in and out, and see who else is on the clock. The punches your timecard is posted from.',
    tab: 'Today', permission: 'projects.read', defaultOn: true, width: 'half',
  },
  {
    key: 'weather',
    title: 'The week ahead',
    blurb: "The forecast for your yard, with a workable verdict per day. It feeds the calendar efficiency an estimate is priced with.",
    tab: 'Today', permission: 'estimates.read', defaultOn: true, width: 'full',
  },
  {
    key: 'awaiting',
    title: 'Waiting on a customer',
    blurb: 'Proposals issued with no answer recorded, oldest first.',
    tab: 'Winning work', permission: 'estimates.read', defaultOn: true, width: 'half',
  },
  {
    key: 'bids',
    title: 'How bidding is going',
    blurb: 'Estimates, submissions, wins and losses by month, with the hit rate counted rather than asserted.',
    tab: 'Winning work', permission: 'estimates.read', defaultOn: false, width: 'half',
  },
  {
    key: 'production',
    title: 'Against the rate it was bid at',
    blurb: 'Field production measured against the library rate the work was priced with. It reports and never proposes a change.',
    tab: 'Doing the work', permission: 'projects.read', defaultOn: true, width: 'full',
  },
  {
    key: 'schedule',
    title: 'Slipping against the baseline',
    blurb: 'Activities finishing later than the baseline the job was sold on, worst first.',
    tab: 'Doing the work', permission: 'projects.read', defaultOn: false, width: 'half',
  },
  {
    key: 'billing',
    title: 'Over and under billed',
    blurb: 'What each project has earned against what it has invoiced. Under-billed is money you have already spent.',
    tab: 'Getting paid', permission: 'finance.read', defaultOn: false, width: 'full',
  },
  {
    key: 'credentials',
    title: 'Certifications lapsing',
    blurb: 'Credentials expiring or expired, and the work each one stops somebody doing.',
    tab: 'People & safety', permission: 'workforce.read', defaultOn: false, width: 'half',
  },
  {
    key: 'safety',
    title: 'Safety standing',
    blurb: 'Incidents and recordables by month, and what is still being investigated.',
    tab: 'People & safety', permission: 'safety.read', defaultOn: false, width: 'half',
  },
];

/** What a person has arranged, or the defaults if they never have. */
export interface DashboardPreference {
  /** Panel keys the person has switched on, in the order they should appear. */
  order: string[];
  /** Panel keys the person has switched off. */
  hidden: string[];
  /** Whether the dashboard is grouped into tabs or shown as one long page. */
  layout: 'tabs' | 'single';
}

export const DEFAULT_DASHBOARD: DashboardPreference = {
  order: [], hidden: [], layout: 'tabs',
};

/**
 * The panels to render, in order, for one person.
 *
 * Permission is applied last and cannot be overridden by a preference: a saved
 * layout from when somebody had safety permission must not keep showing safety
 * records after it was taken away.
 */
export function visiblePanels(
  preference: DashboardPreference,
  can: (permission: string) => boolean,
): PanelDefinition[] {
  const byKey = new Map(PANELS.map((p) => [p.key, p]));
  const ordered: PanelDefinition[] = [];

  for (const key of preference.order) {
    const p = byKey.get(key);
    if (p) { ordered.push(p); byKey.delete(key); }
  }
  /*
   * Anything the saved order does not mention keeps its shipped position. A
   * person who arranged three panels a year ago should still meet a new one
   * when it arrives, rather than having their layout freeze the product.
   */
  for (const p of PANELS) {
    if (byKey.has(p.key)) ordered.push(p);
  }

  return ordered.filter((p) => {
    // Switched off explicitly beats everything else.
    if (preference.hidden.includes(p.key)) return false;
    // Otherwise: chosen by the person, or on by default and never turned off.
    if (!preference.order.includes(p.key) && !p.defaultOn) return false;
    return can(p.permission);
  });
}
