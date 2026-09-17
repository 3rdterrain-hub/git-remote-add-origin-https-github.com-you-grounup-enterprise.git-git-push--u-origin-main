/**
 * The GrounUp Network — a shared directory of subcontractors and suppliers.
 * LIBRARY.
 *
 * The only deliberately cross-tenant data in this schema, which is why this
 * module is written around what it will *not* show rather than what it will.
 *
 *   * **A listing is private until somebody consents and somebody publishes.**
 *     Two separate acts, in that order. A draft is visible to the company that
 *     wrote it and to nobody else — row level security, not a filter here.
 *   * **A rating never names who left it.** `my_network_ratings` returns the
 *     rater's identity only to the rater's own company. A directory where the
 *     reader can see who said what is a place people settle scores, and the
 *     value of the record is that it is on the record, not that it is signed.
 *   * **An average is never shown without its count.** One rating rendered as
 *     "4.5" is a number with more authority than it has earned, so the two
 *     travel together out of the view and through every screen that reads it.
 *
 * Nothing here filters for tenancy. Both views are `security_invoker`, so the
 * rows that arrive are the rows the caller is allowed to see.
 */
import { unwrap, type Query } from './query';
import { NETWORK_VENDORS } from '@/data/survey';
import { supabase } from '@/lib/supabase';

const maybeNum = (v: unknown): number | null =>
  (v === null || v === undefined ? null : Number(v));

export interface NetworkVendor {
  id: string;
  legalName: string;
  displayName: string;
  trades: string[];
  regions: string[];
  city: string | null;
  state: string | null;
  website: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  insuranceExpiresOn: string | null;
  bondingCapacity: number | null;
  isDbe: boolean;
  isMbe: boolean;
  isWbe: boolean;
  certifications: string[];
  isPublished: boolean;
  publishedAt: string | null;
  /** Whether this company wrote the listing — and so may edit or publish it. */
  isMine: boolean;
  consentOnRecord: boolean;
  consentNote: string | null;
  ratingCount: number;
  /** Null where nobody has rated. Rounded to one place by the view. */
  averageOverall: number | null;
  averageSafety: number | null;
  wouldHireAgainCount: number;
  /** Negative once it has lapsed; null where no certificate is on file. */
  daysUntilInsuranceLapses: number | null;
  insuranceLapsed: boolean;
}

export interface NetworkRating {
  id: string;
  vendorId: string;
  vendorName: string;
  quality: number;
  schedule: number;
  safety: number;
  communication: number;
  overall: number;
  wouldHireAgain: boolean;
  comment: string | null;
  contractValue: number | null;
  createdAt: string;
  /** True only for a rating this company left. Nobody else is ever named. */
  isMine: boolean;
  /** The project it came off, and only for the company that left it. */
  projectNumber: string | null;
}

export const loadNetworkVendors: Query<NetworkVendor[]> = async (client) => {
  const rows = unwrap<Record<string, unknown>[]>(
    await client.from('my_network_vendors')
      // One literal, not a concatenation: supabase-js parses this string at the
      // type level and cannot see through `+`, and what comes back instead is
      // `GenericStringError[]` — which typechecks against the loose config and
      // fails the gate's strict one.
      .select('id, legal_name, display_name, trades, service_regions, city, state_province, website, contact_email, contact_phone, insurance_expires_on, bonding_capacity, is_dbe, is_mbe, is_wbe, certifications, is_published, published_at, is_mine, consent_on_record, consent_note, rating_count, average_overall, average_safety, would_hire_again_count, days_until_insurance_lapses, insurance_lapsed')
      .order('display_name'),
  );
  return rows.map((r) => ({
    id: String(r.id),
    legalName: String(r.legal_name),
    displayName: String(r.display_name ?? r.legal_name),
    trades: (r.trades as string[] | null) ?? [],
    regions: (r.service_regions as string[] | null) ?? [],
    city: (r.city as string | null) ?? null,
    state: (r.state_province as string | null) ?? null,
    website: (r.website as string | null) ?? null,
    contactEmail: (r.contact_email as string | null) ?? null,
    contactPhone: (r.contact_phone as string | null) ?? null,
    insuranceExpiresOn: (r.insurance_expires_on as string | null) ?? null,
    bondingCapacity: maybeNum(r.bonding_capacity),
    isDbe: Boolean(r.is_dbe),
    isMbe: Boolean(r.is_mbe),
    isWbe: Boolean(r.is_wbe),
    certifications: (r.certifications as string[] | null) ?? [],
    isPublished: Boolean(r.is_published),
    publishedAt: (r.published_at as string | null) ?? null,
    isMine: Boolean(r.is_mine),
    consentOnRecord: Boolean(r.consent_on_record),
    consentNote: (r.consent_note as string | null) ?? null,
    ratingCount: Number(r.rating_count ?? 0),
    averageOverall: maybeNum(r.average_overall),
    averageSafety: maybeNum(r.average_safety),
    wouldHireAgainCount: Number(r.would_hire_again_count ?? 0),
    daysUntilInsuranceLapses: maybeNum(r.days_until_insurance_lapses),
    insuranceLapsed: Boolean(r.insurance_lapsed),
  }));
};

export const loadNetworkRatings: Query<NetworkRating[]> = async (client) => {
  const rows = unwrap<Record<string, unknown>[]>(
    await client.from('my_network_ratings')
      .select('id, network_vendor_id, vendor_name, quality, schedule, safety, communication, overall, would_hire_again, comment, contract_value, created_at, is_mine, project_number')
      .order('created_at', { ascending: false }),
  );
  return rows.map((r) => ({
    id: String(r.id),
    vendorId: String(r.network_vendor_id),
    vendorName: String(r.vendor_name),
    quality: Number(r.quality),
    schedule: Number(r.schedule),
    safety: Number(r.safety),
    communication: Number(r.communication),
    overall: Number(r.overall),
    wouldHireAgain: Boolean(r.would_hire_again),
    comment: (r.comment as string | null) ?? null,
    contractValue: maybeNum(r.contract_value),
    createdAt: String(r.created_at),
    isMine: Boolean(r.is_mine),
    projectNumber: (r.project_number as string | null) ?? null,
  }));
};

function client() {
  if (!supabase) throw new Error('Not connected to a workspace.');
  return supabase;
}

function done(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

/** Put a subcontractor in this company's own list. It arrives unpublished. */
export async function listNetworkVendor(companyId: string, vendor: {
  legalName: string;
  displayName?: string | null;
  trades?: string[];
  regions?: string[];
  city?: string | null;
  state?: string | null;
  website?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  insuranceExpiresOn?: string | null;
  bondingCapacity?: number | null;
  isDbe?: boolean;
  isMbe?: boolean;
  isWbe?: boolean;
  certifications?: string[];
}): Promise<string> {
  const { data, error } = await client().rpc('list_network_vendor', {
    p_company: companyId,
    p_legal_name: vendor.legalName,
    p_display_name: vendor.displayName ?? null,
    p_trades: vendor.trades ?? [],
    p_service_regions: vendor.regions ?? [],
    p_city: vendor.city ?? null,
    p_state_province: vendor.state ?? null,
    p_website: vendor.website ?? null,
    p_contact_email: vendor.contactEmail ?? null,
    p_contact_phone: vendor.contactPhone ?? null,
    p_insurance_expires_on: vendor.insuranceExpiresOn ?? null,
    p_bonding_capacity: vendor.bondingCapacity ?? null,
    p_is_dbe: vendor.isDbe ?? false,
    p_is_mbe: vendor.isMbe ?? false,
    p_is_wbe: vendor.isWbe ?? false,
    p_certifications: vendor.certifications ?? [],
  });
  if (error) throw new Error(error.message);
  return String(data);
}

/**
 * Change a listing this company owns.
 *
 * Every argument is optional and a null one is left alone, so a screen may send
 * the single field somebody edited rather than the whole record back.
 */
export async function updateNetworkVendor(listingId: string, changes: {
  displayName?: string | null;
  trades?: string[] | null;
  regions?: string[] | null;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  insuranceExpiresOn?: string | null;
  bondingCapacity?: number | null;
  isDbe?: boolean | null;
  isMbe?: boolean | null;
  isWbe?: boolean | null;
  certifications?: string[] | null;
}): Promise<void> {
  done(await client().rpc('update_network_vendor', {
    p_listing: listingId,
    p_display_name: changes.displayName ?? null,
    p_trades: changes.trades ?? null,
    p_service_regions: changes.regions ?? null,
    p_city: changes.city ?? null,
    p_state_province: changes.state ?? null,
    p_website: changes.website ?? null,
    p_contact_email: changes.contactEmail ?? null,
    p_contact_phone: changes.contactPhone ?? null,
    p_insurance_expires_on: changes.insuranceExpiresOn ?? null,
    p_bonding_capacity: changes.bondingCapacity ?? null,
    p_is_dbe: changes.isDbe ?? null,
    p_is_mbe: changes.isMbe ?? null,
    p_is_wbe: changes.isWbe ?? null,
    p_certifications: changes.certifications ?? null,
  }));
}

/**
 * Record how the vendor agreed to be listed.
 *
 * Its own act, and the reason it is not a checkbox beside "publish": a field
 * somebody initials on the way past is not a record of anything. Publishing is
 * refused until this exists.
 */
export async function recordNetworkConsent(listingId: string, how: string): Promise<void> {
  done(await client().rpc('record_network_consent', { p_listing: listingId, p_how: how }));
}

/** Put the listing in front of every company on the network, or take it back. */
export async function publishNetworkVendor(
  listingId: string, published = true,
): Promise<void> {
  done(await client().rpc('publish_network_vendor', {
    p_listing: listingId, p_published: published,
  }));
}

/**
 * Rate a vendor this company held a contract with.
 *
 * One rating per company per project, and never on your own listing — both
 * refused in the database rather than hidden from the screen, so the reason
 * comes back in words a person can act on.
 */
export async function rateNetworkVendor(listingId: string, companyId: string, rating: {
  quality: number;
  schedule: number;
  safety: number;
  communication: number;
  wouldHireAgain: boolean;
  projectId?: string | null;
  comment?: string | null;
  contractValue?: number | null;
}): Promise<string> {
  const { data, error } = await client().rpc('rate_network_vendor', {
    p_listing: listingId,
    p_company: companyId,
    p_quality: rating.quality,
    p_schedule: rating.schedule,
    p_safety: rating.safety,
    p_communication: rating.communication,
    p_would_hire_again: rating.wouldHireAgain,
    p_project: rating.projectId ?? null,
    p_comment: rating.comment ?? null,
    p_contract_value: rating.contractValue ?? null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

/**
 * The sample directory, for an environment with no workspace connected.
 *
 * Mapped into the live shape rather than rendered from its own, so the screen
 * has one set of fields to reason about — and so the demonstration teaches the
 * real behavior: the sample ratings are anonymous here exactly as they are in
 * production, because that is what the view returns to a company that did not
 * leave them.
 */
export function demonstrationNetwork(): {
  vendors: NetworkVendor[]; ratings: NetworkRating[];
} {
  const today = new Date();
  const vendors = NETWORK_VENDORS.map((v): NetworkVendor => {
    const scores = v.ratings.map(
      (r) => (r.quality + r.schedule + r.safety + r.communication) / 4,
    );
    const mean = (xs: number[]) =>
      (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)) : null);
    const days = v.insuranceExpiresOn
      ? Math.round(
        (new Date(`${v.insuranceExpiresOn}T12:00:00`).getTime() - today.getTime()) / 86_400_000,
      )
      : null;
    return {
      id: v.id,
      legalName: v.legalName,
      displayName: v.displayName,
      trades: v.trades,
      regions: v.regions,
      city: v.city,
      state: v.state,
      website: null,
      contactEmail: null,
      contactPhone: null,
      insuranceExpiresOn: v.insuranceExpiresOn,
      bondingCapacity: v.bondingCapacity,
      isDbe: v.isDbe,
      isMbe: v.isMbe,
      isWbe: v.isWbe,
      certifications: v.certifications,
      isPublished: v.isPublished,
      publishedAt: null,
      isMine: v.ownedByUs,
      consentOnRecord: v.isPublished,
      consentNote: v.isPublished ? 'Sample listing — consent on file' : null,
      ratingCount: v.ratings.length,
      averageOverall: mean(scores),
      averageSafety: mean(v.ratings.map((r) => r.safety)),
      wouldHireAgainCount: v.ratings.filter((r) => r.wouldHireAgain).length,
      daysUntilInsuranceLapses: days,
      insuranceLapsed: days !== null && days < 0,
    };
  });
  const ratings = NETWORK_VENDORS.flatMap((v) => v.ratings.map((r, i): NetworkRating => ({
    id: `${v.id}-r${i}`,
    vendorId: v.id,
    vendorName: v.displayName,
    quality: r.quality,
    schedule: r.schedule,
    safety: r.safety,
    communication: r.communication,
    overall: (r.quality + r.schedule + r.safety + r.communication) / 4,
    wouldHireAgain: r.wouldHireAgain,
    comment: r.comment,
    contractValue: r.contractValue,
    createdAt: new Date().toISOString(),
    isMine: false,
    projectNumber: null,
  })));
  return { vendors, ratings };
}
