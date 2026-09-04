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
export async function loadPlanPrices(): Promise<Plan[]> {
  if (!supabase) return PLANS;
  const { data, error } = await supabase
    .from('plan_prices')
    .select('plan_id, interval, unit_amount_cents, is_active')
    .eq('is_active', true);
  if (error || !data) return PLANS;

  return PLANS.map((p) => {
    const monthly = data.find((d) => d.plan_id === p.id && d.interval === 'month');
    const yearly = data.find((d) => d.plan_id === p.id && d.interval === 'year');
    return {
      ...p,
      monthlyCents: monthly?.unit_amount_cents ?? p.monthlyCents,
      yearlyCents: yearly?.unit_amount_cents ?? p.yearlyCents,
    };
  });
}
