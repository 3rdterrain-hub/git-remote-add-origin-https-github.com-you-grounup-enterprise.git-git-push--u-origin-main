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
  headline: string[];
  limits: { estimates: string; projects: string; storage: string; ai: string };
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
  /** Entitlement key from the governed plan catalog, where one applies. */
  feature?: string;
  values: (string | boolean)[];
}

export const COMPARISON: { group: string; rows: ComparisonRow[] }[] = [
  {
    group: 'Estimating',
    rows: [
      { label: 'Deterministic estimating engine', feature: 'estimating', values: [true, true, true, true] },
      { label: 'Master service, task and assembly library', feature: 'master_libraries', values: [true, true, true, true] },
      { label: 'Cycle-based haul and fleet balance', values: [true, true, true, true] },
      { label: 'Confidence scoring and approval gates', values: [true, true, true, true] },
      { label: 'Parallel and stacked markup profiles', values: [true, true, true, true] },
      { label: 'Regional pricing factors', values: [false, true, true, true] },
      { label: 'Production rate calibration from actuals', feature: 'calibration', values: [false, false, true, true] },
    ],
  },
  {
    group: 'AI & documents',
    rows: [
      { label: 'Document storage and versioning', feature: 'documents', values: [true, true, true, true] },
      { label: 'AI plan and specification review', feature: 'ai_plan_review', values: [false, true, true, true] },
      { label: 'Revision comparison across addenda', values: [false, true, true, true] },
      { label: 'AI credits per month', values: ['250', '2,000', '10,000', 'Unlimited'] },
    ],
  },
  {
    group: 'Operations',
    rows: [
      { label: 'Award estimate to project', feature: 'projects', values: [false, true, true, true] },
      { label: 'Job cost and field production', feature: 'job_cost', values: [false, true, true, true] },
      { label: 'Change orders and RFIs', feature: 'change_orders', values: [false, true, true, true] },
      { label: 'Procurement and fleet', values: [false, false, true, true] },
      { label: 'Scheduling and resource planning', feature: 'scheduling', values: [false, false, true, true] },
    ],
  },
  {
    group: 'Governance & scale',
    rows: [
      { label: 'Row level tenant isolation', values: [true, true, true, true] },
      { label: 'Append-only audit ledger', values: [true, true, true, true] },
      { label: 'Role-based permissions and approval tiers', values: [true, true, true, true] },
      { label: 'Divisions, offices and regions', feature: 'divisions', values: [false, false, true, true] },
      { label: 'Enterprise groups and corporate libraries', values: [false, false, false, true] },
      { label: 'White label', values: [false, false, false, true] },
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

  const [{ data: catalog, error: catalogError }, { data: prices }] = await Promise.all([
    supabase.from('plans')
      .select('id, name, tagline, description, max_seats, max_active_estimates, max_active_projects, storage_gb, ai_credits_per_month, trial_days, sort_order')
      .eq('is_public', true).eq('is_active', true)
      .order('sort_order'),
    supabase.from('plan_prices')
      .select('plan_id, interval, unit_amount_cents, is_active, is_chargeable')
      .eq('is_active', true),
  ]);

  // A pricing page that fails to a blank screen is worse than one showing the
  // shipped defaults, so an unreadable catalog falls back rather than throwing.
  if (catalogError || !catalog?.length) return PLANS;

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
      // A plan with no seat cap is priced per seat rather than capped at one.
      seats: p.max_seats === null ? 'Per user, per month' : `Up to ${p.max_seats} users`,
      trialDays: Number(p.trial_days ?? 0),
      highlight: catalog.length === 1 ? true : known?.highlight,
      /*
       * A price that is real but not yet chargeable — decided before Stripe was
       * connected — shows the number and routes to sales. Sending somebody into
       * a checkout that will fail at Stripe is the one outcome worse than not
       * quoting at all.
       */
      contactSales: !(prices ?? []).some(
        (d) => d.plan_id === p.id && d.is_chargeable) || known?.contactSales,
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

