/**
 * Client-side mirror of the governed plan catalog.
 *
 * Prices are never hard-coded in components: they come from here, and here is
 * refreshed from the `plans` / `plan_prices` tables when Supabase is
 * configured. Changing a price is a data change, not a release.
 */
import { supabase } from '@/lib/supabase';

export interface PlanFeature { label: string; included: boolean; detail?: string }

export interface Plan {
  id: string;
  name: string;
  tagline: string;
  monthlyCents: number;
  yearlyCents: number;
  seats: string;
  highlight?: boolean;
  contactSales?: boolean;
  trialDays: number;
  /**
   * Whether checkout can actually charge this, per interval.
   *
   * Per interval rather than per plan, because they differ: a monthly price can
   * be connected to Stripe while the annual one is not, and a page that treated
   * the plan as chargeable would send somebody toggling to Annual into a
   * checkout that fails at Stripe in front of them.
   */
  chargeable?: { month: boolean; year: boolean };
  /**
   * Whether this plan is free on purpose.
   *
   * Distinct from a plan whose price is simply unknown: both read as zero, and
   * the two need opposite calls to action. A free plan says "start free" and
   * goes to signup; a plan with no published price says "talk to us".
   */
  free?: boolean;
  headline: string[];
  limits: { estimates: string; projects: string; storage: string; ai: string };
  /**
   * What the catalog actually grants this plan, verbatim.
   *
   * `['*']` means everything. The comparison table is derived from this rather
   * than written beside it, because two copies of one decision is how the page
   * ended up selling an arrangement the database had stopped offering.
   */
  features: string[];
}

export const PLANS: Plan[] = [
  {
    id: 'starter', name: 'Starter',
    tagline: 'For the owner-estimator getting off spreadsheets.',
    monthlyCents: 9_900, yearlyCents: 99_000, seats: 'Up to 3 users', trialDays: 14,
    headline: [
      'Production-based estimating engine',
      'Full GrounUp master library, seeded',
      'Takeoff quantity chain with confidence scoring',
      'Proposals and document storage',
      'Basic CRM: customers, contacts, opportunities',
    ],
    limits: { estimates: '25 active estimates', projects: '10 active projects', storage: '10 GB', ai: '250 AI credits / month' },
    features: ['estimating', 'takeoff', 'master_libraries', 'crm_basic', 'proposals', 'documents'],
  },
  {
    id: 'professional', name: 'Professional',
    tagline: 'For the contractor running several jobs at once.',
    monthlyCents: 29_900, yearlyCents: 299_000, seats: 'Up to 10 users', trialDays: 14, highlight: true,
    headline: [
      'Everything in Starter',
      'AI plan and specification review with citations',
      'Award converts estimates into projects',
      'Job cost, field production and change orders',
      'Full CRM pipeline and win/loss analysis',
      'Reporting and executive dashboards',
    ],
    limits: { estimates: '250 active estimates', projects: '75 active projects', storage: '100 GB', ai: '2,000 AI credits / month' },
    features: ['estimating', 'takeoff', 'master_libraries', 'crm_basic', 'crm_full', 'proposals',
      'documents', 'projects', 'job_cost', 'field_production', 'change_orders', 'ai_plan_review',
      'reports', 'workforce', 'safety'],
  },
  {
    id: 'business', name: 'Business',
    tagline: 'For the growing company with divisions and a back office.',
    monthlyCents: 79_900, yearlyCents: 799_000, seats: 'Up to 50 users', trialDays: 14,
    headline: [
      'Everything in Professional',
      'Divisions, offices and regional pricing',
      'Procurement, fleet and scheduling',
      'Production rate calibration from actuals',
      'Analytics and the public API',
    ],
    limits: { estimates: 'Unlimited estimates', projects: 'Unlimited projects', storage: '500 GB', ai: '10,000 AI credits / month' },
    features: ['estimating', 'takeoff', 'master_libraries', 'crm_basic', 'crm_full', 'proposals',
      'documents', 'projects', 'job_cost', 'field_production', 'change_orders', 'ai_plan_review',
      'reports', 'workforce', 'safety', 'survey', 'finance', 'divisions', 'procurement', 'fleet',
      'scheduling', 'analytics', 'api_access', 'calibration'],
  },
  {
    id: 'enterprise', name: 'Enterprise',
    tagline: 'For multi-company groups that need corporate standards.',
    monthlyCents: 249_900, yearlyCents: 2_499_000, seats: 'Unlimited users', trialDays: 0, contactSales: true,
    headline: [
      'Everything in Business',
      'Enterprise groups and corporate standard libraries',
      'Local company overrides with governed approval',
      'Forced row-level tenant isolation and an append-only audit ledger',
      'White-label options and dedicated support',
    ],
    limits: { estimates: 'Unlimited', projects: 'Unlimited', storage: 'Unlimited', ai: 'Unlimited' },
    features: ['*'],
  },
];

/**
 * The feature comparison shown on the pricing page.
 *
 * A row carrying a `feature` key is a commercial promise: the boolean must
 * agree with what `plans.features` actually grants, and a test checks every one
 * against the seeded catalog. Rows without a key describe platform properties
 * that are not entitlement-gated — tenancy, the audit ledger — and are true for
 * everyone.
 *
 * The page previously advertised SSO and data residency to Enterprise buyers.
 * Neither exists. Selling a capability the code does not have is the same
 * defect as a settings toggle that switches nothing, on the page where somebody
 * decides to pay.
 */
export interface ComparisonRow {
  label: string;
  /**
   * Entitlement key from the governed catalog. Included when the plan's own
   * `features` hold it, or hold `*`.
   */
  feature?: string;
  /** A limit the catalog carries, rendered as the plan's own value. */
  limit?: 'estimates' | 'projects' | 'storage' | 'ai';
  /**
   * True for every plan: a property of the platform rather than something
   * sold. Row level tenancy is not a tier.
   */
  platform?: true;
  /**
   * The handful of rows the entitlement vocabulary cannot express, keyed by
   * plan id.
   *
   * By id, never by position. `values: [false, true, true, true]` was written
   * for a four-tier ladder that the catalog retired; the page renders whatever
   * plans the catalog publishes, and `values[i]` then handed each live plan a
   * *retired* plan's column. With two plans published, the only paid one was
   * being shown Professional's answers — telling buyers that procurement,
   * fleet, scheduling, divisions and calibration were not included in the plan
   * they were about to buy. They are: it grants `*`.
   */
  byPlan?: Record<string, string | boolean>;
}

/** Whether a plan's own entitlements cover a feature key. */
export const grants = (plan: Pick<Plan, 'features'>, feature: string): boolean =>
  plan.features.includes('*') || plan.features.includes(feature);

/** What a comparison row says about one plan, from the catalog outward. */
export function comparisonValue(row: ComparisonRow, plan: Plan): string | boolean {
  if (row.platform) return true;
  if (row.feature) return grants(plan, row.feature);
  if (row.limit) return plan.limits[row.limit];
  return row.byPlan?.[plan.id] ?? false;
}

export const COMPARISON: { group: string; rows: ComparisonRow[] }[] = [
  {
    group: 'Estimating',
    rows: [
      { label: 'Deterministic estimating engine', feature: 'estimating' },
      { label: 'Master service, task and assembly library', feature: 'master_libraries' },
      { label: 'Takeoff quantity chain', feature: 'takeoff' },
      /*
       * Platform, not tier. Nothing in the code refuses a haul balance, a
       * confidence score or a markup profile to anybody — they are how the
       * engine works, and listing them as though they were bought would be
       * selling something that is not for sale.
       */
      { label: 'Cycle-based haul and fleet balance', platform: true },
      { label: 'Confidence scoring and approval gates', platform: true },
      { label: 'Parallel and stacked markup profiles', platform: true },
      { label: 'Regional pricing factors', platform: true },
      { label: 'Production rate calibration from actuals', feature: 'calibration' },
      { label: 'Active estimates', limit: 'estimates' },
    ],
  },
  {
    group: 'AI & documents',
    rows: [
      { label: 'Document storage and versioning', feature: 'documents' },
      { label: 'Proposals from a priced estimate', feature: 'proposals' },
      { label: 'AI plan and specification review', feature: 'ai_plan_review' },
      { label: 'Revision comparison across addenda', feature: 'ai_plan_review' },
      { label: 'Storage', limit: 'storage' },
      { label: 'AI credits per month', limit: 'ai' },
    ],
  },
  {
    group: 'Operations',
    rows: [
      { label: 'Award estimate to project', feature: 'projects' },
      { label: 'Job cost and field production', feature: 'job_cost' },
      { label: 'Change orders and RFIs', feature: 'change_orders' },
      { label: 'Workforce and time', feature: 'workforce' },
      { label: 'Safety and quality', feature: 'safety' },
      { label: 'Procurement and fleet', feature: 'procurement' },
      { label: 'Scheduling and resource planning', feature: 'scheduling' },
      { label: 'Active projects', limit: 'projects' },
    ],
  },
  {
    group: 'Governance & scale',
    rows: [
      { label: 'Row level tenant isolation', platform: true },
      { label: 'Append-only audit ledger', platform: true },
      { label: 'Role-based permissions and approval tiers', platform: true },
      { label: 'Reporting and executive dashboards', feature: 'reports' },
      { label: 'Divisions, offices and regions', feature: 'divisions' },
      { label: 'The public API', feature: 'api_access' },
      /*
       * Two rows the entitlement vocabulary has no key for, so they are stated
       * per plan rather than guessed. A plan granting `*` gets them because it
       * grants everything; a plan with a listed set does not.
       */
      { label: 'Enterprise groups and corporate libraries',
        byPlan: { grounup: true, grounup_enterprise: true } },
      { label: 'White label', byPlan: { partner_white_label: true, grounup_enterprise: true } },
    ],
  },
];

/**
 * Refresh prices from the governed catalog.
 *
 * Falls back to the shipped defaults when Supabase is not configured, so the
 * pricing page always renders something truthful rather than an empty state.
 */
/**
 * The plans a visitor is shown, read from the catalog.
 *
 * This used to render a hardcoded list and overlay live prices onto it, which
 * meant the pricing page and the plan catalog were two copies of the same
 * decision. Retiring four tiers in the database changed nothing a visitor saw —
 * and the operator console asserted, wrongly, that the page read the catalog
 * directly.
 *
 * It does now. `plans` and `plan_prices` are the only two tables an anonymous
 * visitor may read at all, which is precisely so this page can be honest
 * without opening anything else.
 *
 * The fixture remains as the unconfigured fallback, because a build with no
 * workspace still has a pricing page to show.
 */
export async function loadPlanPrices(): Promise<Plan[]> {
  if (!supabase) return PLANS;

  const [{ data: catalog, error: catalogError }, { data: prices, error: priceError }] =
    await Promise.all([
    supabase.from('plans')
      .select('id, name, tagline, description, features, max_seats, max_active_estimates, max_active_projects, storage_gb, ai_credits_per_month, trial_days, sort_order')
      .eq('is_public', true).eq('is_active', true)
      .order('sort_order'),
    supabase.from('plan_prices')
      .select('plan_id, interval, unit_amount_cents, is_active, is_chargeable')
      .eq('is_active', true),
  ]);

  /*
   * Both reads, or neither.
   *
   * The price query's error was discarded, and every price is read out of
   * `prices` with `?? 0`. So a failed price read — a tightened policy, a
   * renamed column, a dropped connection — rendered the catalog correctly with
   * every plan at $0, on the page where somebody decides to pay. The catalog
   * read was checked and the price read was not, which meant the fallback
   * never fired for the half that mattered most.
   */
  if (catalogError || priceError || !catalog?.length) return PLANS;

  const price = (planId: string, interval: string) =>
    (prices ?? []).find((d) => d.plan_id === planId && d.interval === interval)
      ?.unit_amount_cents ?? 0;

  /** "Unlimited" is the honest word for a null limit, not "0". */
  const limit = (v: number | null, unit: string) =>
    v === null || v === undefined ? 'Unlimited' : `${v.toLocaleString()} ${unit}`;

  return catalog.map((p) => {
    const known = PLANS.find((x) => x.id === p.id);
    return {
      id: String(p.id),
      name: String(p.name),
      tagline: String(p.tagline ?? ''),
      monthlyCents: price(String(p.id), 'month'),
      yearlyCents: price(String(p.id), 'year'),
      // A published price of zero, rather than no published price at all.
      free: (prices ?? []).some(
        (d) => d.plan_id === p.id && Number(d.unit_amount_cents) === 0),
      // A plan with no seat cap is priced per seat rather than capped at one.
      seats: p.max_seats === null ? 'Per user, per month' : `Up to ${p.max_seats} users`,
      trialDays: Number(p.trial_days ?? 0),
      // With a free tier beside it, the paid plan is the one to highlight —
      // "the only plan" is no longer a reason on its own.
      highlight: catalog.length === 1
        ? true
        : known?.highlight ?? (Number(price(String(p.id), 'month')) > 0),
      /*
       * A price that is real but not yet chargeable — decided before Stripe was
       * connected — shows the number and routes to sales. Sending somebody into
       * a checkout that will fail at Stripe is the one outcome worse than not
       * quoting at all.
       */
      chargeable: {
        month: (prices ?? []).some(
          (d) => d.plan_id === p.id && d.interval === 'month' && d.is_chargeable),
        year: (prices ?? []).some(
          (d) => d.plan_id === p.id && d.interval === 'year' && d.is_chargeable),
      },
      contactSales: known?.contactSales,
      features: (p.features as string[] | null) ?? [],
      headline: known?.headline ?? splitDescription(String(p.description ?? '')),
      limits: {
        estimates: limit(p.max_active_estimates as number | null, 'active estimates'),
        projects: limit(p.max_active_projects as number | null, 'active projects'),
        storage: p.storage_gb === null ? 'Unlimited' : `${p.storage_gb} GB included`,
        ai: p.ai_credits_per_month === null
          ? 'Unlimited' : `${Number(p.ai_credits_per_month).toLocaleString()} AI credits a month`,
      },
    };
  });
}

/**
 * Bullet points from a plan's own description.
 *
 * Used only where the catalog carries a plan the fixture has never heard of —
 * which is the normal case now that the catalog is the authority.
 */
function splitDescription(description: string): string[] {
  return description
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 6);
}

