/**
 * The company's own record — Library support for every screen that names it.
 *
 * Company Settings shipped as a form bound to a demonstration constant: the
 * City box read `COMPANY.city` from `@/data/demo`, "Save changes" set a boolean
 * and wrote nothing, and so no company using this platform could state where it
 * is. That is not only a settings gap. The weather refresh geocodes the
 * company's city and refuses with "This company has no city or postal code",
 * the calendar efficiency an estimate is priced with comes from that forecast,
 * and a proposal's letterhead reads from the same row — so a form that saved
 * nothing silently held back three features that were already built.
 *
 * There is no new function behind this. Migration 0010 gave `companies` an
 * update policy gated on `company.manage`, which is exactly the right rule:
 * a member may read their company, an owner may change it. This reads and
 * writes that row directly and lets the database decide who may.
 */
import type { Query } from './query';
import { unwrap } from './query';
import { supabase } from '@/lib/supabase';

export type CompanyProfile = {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateProvince: string | null;
  postalCode: string | null;
  country: string;
  timezone: string;
  currency: string;
  /** Estimating defaults, which the engine reads when a line does not override them. */
  defaultShiftHours: number;
  defaultCalendarEfficiency: number;
  defaultSwellPercent: number;
  defaultShrinkPercent: number;
  defaultFuelPrice: number;
  bidRoundingIncrement: number;
  /** `{"estimate":"Bid"}` — what this company calls things. */
  terminology: Record<string, string>;
};

const num = (v: unknown, fallback: number): number =>
  v == null || v === '' ? fallback : Number(v);

const COLUMNS =
  'id, name, legal_name, tax_id, phone, email, website, address_line1, address_line2, ' +
  'city, state_province, postal_code, country, timezone, currency, ' +
  'default_shift_hours, default_calendar_efficiency, default_swell_percent, ' +
  'default_shrink_percent, default_fuel_price, bid_rounding_increment, terminology';

const shape = (r: Record<string, unknown>): CompanyProfile => ({
  id: String(r.id),
  name: String(r.name),
  legalName: (r.legal_name as string | null) ?? null,
  taxId: (r.tax_id as string | null) ?? null,
  phone: (r.phone as string | null) ?? null,
  email: (r.email as string | null) ?? null,
  website: (r.website as string | null) ?? null,
  addressLine1: (r.address_line1 as string | null) ?? null,
  addressLine2: (r.address_line2 as string | null) ?? null,
  city: (r.city as string | null) ?? null,
  stateProvince: (r.state_province as string | null) ?? null,
  postalCode: (r.postal_code as string | null) ?? null,
  country: String(r.country ?? 'US'),
  timezone: String(r.timezone ?? 'America/New_York'),
  currency: String(r.currency ?? 'USD'),
  defaultShiftHours: num(r.default_shift_hours, 8),
  defaultCalendarEfficiency: num(r.default_calendar_efficiency, 0.85),
  defaultSwellPercent: num(r.default_swell_percent, 0.25),
  defaultShrinkPercent: num(r.default_shrink_percent, 0.1),
  defaultFuelPrice: num(r.default_fuel_price, 4.25),
  bidRoundingIncrement: num(r.bid_rounding_increment, 0),
  terminology: (r.terminology as Record<string, string> | null) ?? {},
});

/**
 * The signed-in person's company.
 *
 * `companies_select` already restricts this to companies the caller belongs to,
 * so no company id is passed in — asking the browser which company to read is
 * how a tenant boundary gets crossed. One row, because a person working in two
 * companies is working in one of them at a time and the shell decides which.
 */
export const loadCompanyProfile: Query<CompanyProfile | null> = async (client) => {
  const rows = unwrap(await client
    .from('companies')
    .select(COLUMNS)
    .limit(1)) as unknown as Array<Record<string, unknown>>;
  const row = rows[0];
  return row ? shape(row) : null;
};

/** What a save may change. Everything optional: a form sends what it touched. */
export type CompanyProfileEdit = Partial<Omit<CompanyProfile, 'id'>>;

const COLUMN_FOR: Record<keyof CompanyProfileEdit, string> = {
  name: 'name',
  legalName: 'legal_name',
  taxId: 'tax_id',
  phone: 'phone',
  email: 'email',
  website: 'website',
  addressLine1: 'address_line1',
  addressLine2: 'address_line2',
  city: 'city',
  stateProvince: 'state_province',
  postalCode: 'postal_code',
  country: 'country',
  timezone: 'timezone',
  currency: 'currency',
  defaultShiftHours: 'default_shift_hours',
  defaultCalendarEfficiency: 'default_calendar_efficiency',
  defaultSwellPercent: 'default_swell_percent',
  defaultShrinkPercent: 'default_shrink_percent',
  defaultFuelPrice: 'default_fuel_price',
  bidRoundingIncrement: 'bid_rounding_increment',
  terminology: 'terminology',
};

/**
 * Save the company record and return what the database now holds.
 *
 * The returned row is the one rendered afterwards rather than the values that
 * were typed. A check constraint the form does not know about — a malformed
 * email, a calendar efficiency above 1 — must show as a refusal, and a screen
 * that echoed its own input would report a save that did not happen.
 *
 * An empty text box clears the column rather than storing "". A company that
 * deletes its website has no website; `''` would be a value that is not one.
 */
export async function saveCompanyProfile(
  companyId: string, edit: CompanyProfileEdit,
): Promise<CompanyProfile> {
  if (!supabase) throw new Error('Not connected.');
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(edit)) {
    const column = COLUMN_FOR[key as keyof CompanyProfileEdit];
    if (!column) continue;
    patch[column] = typeof value === 'string' ? (value.trim() || null) : value;
  }
  // `name` is `not null` with a length check, so an emptied box is a refusal
  // rather than a company with no name.
  if ('name' in patch && !patch.name) {
    throw new Error('A company has to have a name.');
  }
  if (Object.keys(patch).length === 0) {
    const current = await loadCompanyProfile(supabase);
    if (!current) throw new Error('No company to save.');
    return current;
  }
  patch.updated_at = new Date().toISOString();

  const rows = unwrap(await supabase
    .from('companies')
    .update(patch)
    .eq('id', companyId)
    .select(COLUMNS)) as unknown as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) {
    // `companies_update` is gated on `company.manage`; a row that matched the
    // filter but returns nothing was refused by the policy, not missing.
    throw new Error('You do not have permission to change company settings.');
  }
  return shape(row);
}

/**
 * Who the application shell should say you are, and which company you are in.
 *
 * The shell rendered `COMPANY.name`, `COMPANY.city`, `COMPANY.planName`,
 * `USER.name` and `USER.role` straight out of `@/data/demo`, so every signed-in
 * person on the platform was shown "Ridgeline Excavating · Toledo, OH ·
 * Professional" and signed as "Dana Whitfield, Senior Estimator" regardless of
 * who they were or what company they had created. The name of the company you
 * are working in is not decoration — it is the one thing on screen that says a
 * write is going to land in the right tenant.
 *
 * Every part is nullable and the shell is written to read correctly without any
 * of them. A name that has not arrived is better as nothing than as somebody
 * else's.
 */
export type ShellIdentity = {
  companyName: string | null;
  /** "Toledo, OH" — whichever halves exist. */
  place: string | null;
  planName: string | null;
  roleName: string | null;
  personName: string | null;
  email: string | null;
};

export const loadShellIdentity: Query<ShellIdentity> = async (client) => {
  const [companyRows, membershipRows, planRows, profileRows] = await Promise.all([
    client.from('companies').select('name, city, state_province').limit(1),
    client.from('my_companies').select('name, role_name').limit(1),
    client.from('my_plan').select('plan_name').limit(1),
    client.from('user_profiles').select('full_name, email').limit(1),
  ]);

  const company = (unwrap(companyRows) as unknown as Array<Record<string, unknown>>)[0];
  const membership = (unwrap(membershipRows) as unknown as Array<Record<string, unknown>>)[0];
  /*
   * A company on no plan is a company in its trial, not an error, so a missing
   * plan row is read as "no plan name" rather than allowed to fail the shell.
   */
  const plan = (planRows.error ? [] : (planRows.data as unknown as Array<Record<string, unknown>>))[0];
  const profile = (unwrap(profileRows) as unknown as Array<Record<string, unknown>>)[0];

  const city = ((company?.city as string | null) ?? '').trim();
  const state = ((company?.state_province as string | null) ?? '').trim();
  const place = city && state ? `${city}, ${state}` : city || state || null;

  const fullName = ((profile?.full_name as string | null) ?? '').trim();
  const email = (profile?.email as string | null) ?? null;

  return {
    companyName: (company?.name as string | null)
      ?? (membership?.name as string | null) ?? null,
    place,
    planName: (plan?.plan_name as string | null) ?? null,
    roleName: (membership?.role_name as string | null) ?? null,
    personName: fullName || (email ? email.split('@')[0]! : null),
    email,
  };
};
