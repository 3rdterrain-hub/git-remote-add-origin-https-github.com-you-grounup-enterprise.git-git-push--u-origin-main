/**
 * Workflow — the customer answering a proposal for themselves.
 *
 * `record_proposal_outcome` was the only way a customer's answer had ever been
 * recorded: gated on `estimates.issue`, taking the customer's name as free
 * text. An acceptance was a member of staff typing the customer's name, and a
 * disputed bid rested on that.
 *
 * Two halves live here. The company's half issues and withdraws links and reads
 * what came back. The customer's half calls two functions in `public` — never
 * `app`, which a visitor holds no rights on at all — passing the raw token,
 * which is the only credential they have and the only one they need.
 */
import { supabase } from '@/lib/supabase';
import { unwrap, type Query } from './query';

// ---------------------------------------------------------------------------
// The company's half
// ---------------------------------------------------------------------------
export interface ShareLink {
  id: string;
  tokenPrefix: string;
  recipientName: string;
  recipientEmail: string | null;
  expiresAt: string;
  openedAt: string | null;
  openedCount: number;
  respondedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
  /** Live, spent, withdrawn or lapsed — one word for what this link is now. */
  standing: 'live' | 'answered' | 'withdrawn' | 'expired';
}

const standingOf = (r: {
  responded_at: string | null; revoked_at: string | null; expires_at: string;
}): ShareLink['standing'] => {
  if (r.responded_at) return 'answered';
  if (r.revoked_at) return 'withdrawn';
  return new Date(r.expires_at) <= new Date() ? 'expired' : 'live';
};

export const loadShareLinks = (proposalId: string): Query<ShareLink[]> => async (client) => {
  const rows = unwrap(await client
    .from('proposal_share_links')
    .select('id, token_prefix, recipient_name, recipient_email, expires_at, opened_at, '
      + 'opened_count, responded_at, revoked_at, revoke_reason, created_at')
    .eq('proposal_id', proposalId)
    .order('created_at', { ascending: false })) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    tokenPrefix: String(r.token_prefix),
    recipientName: String(r.recipient_name),
    recipientEmail: (r.recipient_email as string | null) ?? null,
    expiresAt: String(r.expires_at),
    openedAt: (r.opened_at as string | null) ?? null,
    openedCount: Number(r.opened_count ?? 0),
    respondedAt: (r.responded_at as string | null) ?? null,
    revokedAt: (r.revoked_at as string | null) ?? null,
    revokeReason: (r.revoke_reason as string | null) ?? null,
    createdAt: String(r.created_at),
    standing: standingOf(r as never),
  }));
};

export interface IssuedLink { token: string; expiresAt: string; linkId: string; url: string }

/**
 * Issue one, and hand back the address to send.
 *
 * The token comes back exactly once and is never stored — only its hash is —
 * so the caller has to do something with it now. Losing it means issuing
 * another, which is the same bargain an API key strikes.
 */
export async function createShareLink(input: {
  proposalId: string; recipientName: string; recipientEmail?: string | null; days?: number;
}): Promise<IssuedLink> {
  if (!supabase) throw new Error('Not connected');
  const { data, error } = await supabase.rpc('create_proposal_share_link', {
    p_proposal: input.proposalId,
    p_recipient_name: input.recipientName,
    p_recipient_email: input.recipientEmail ?? null,
    p_days: input.days ?? 30,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as
    { token: string; expires_at: string; link_id: string };
  return {
    token: row.token,
    expiresAt: row.expires_at,
    linkId: row.link_id,
    url: `${window.location.origin}/sign/${row.token}`,
  };
}

export async function revokeShareLink(linkId: string, reason?: string): Promise<void> {
  if (!supabase) throw new Error('Not connected');
  const { error } = await supabase.rpc('revoke_proposal_share_link', {
    p_link: linkId, p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
}

export interface Signature {
  outcome: 'accepted' | 'declined';
  signedName: string;
  signedTitle: string | null;
  signedEmail: string | null;
  declineReason: string | null;
  totalPriceAtSigning: number | null;
  ipAddress: string | null;
  signedAt: string;
}

export const loadSignatures = (proposalId: string): Query<Signature[]> => async (client) => {
  const rows = unwrap(await client
    .from('proposal_signatures')
    .select('outcome, signed_name, signed_title, signed_email, decline_reason, '
      + 'total_price_at_signing, ip_address, signed_at')
    .eq('proposal_id', proposalId)
    .order('signed_at', { ascending: false })) as unknown as Array<Record<string, unknown>>;

  return rows.map((s) => ({
    outcome: s.outcome as Signature['outcome'],
    signedName: String(s.signed_name),
    signedTitle: (s.signed_title as string | null) ?? null,
    signedEmail: (s.signed_email as string | null) ?? null,
    declineReason: (s.decline_reason as string | null) ?? null,
    totalPriceAtSigning: s.total_price_at_signing == null
      ? null : Number(s.total_price_at_signing),
    ipAddress: (s.ip_address as string | null) ?? null,
    signedAt: String(s.signed_at),
  }));
};

// ---------------------------------------------------------------------------
// The customer's half
// ---------------------------------------------------------------------------
export interface SignableProposal {
  proposalId: string;
  number: string;
  title: string;
  coverLetter: string | null;
  commercialTerms: string | null;
  paymentTerms: string | null;
  totalPrice: number;
  issuedAt: string | null;
  validityDays: number;
  showLineDetail: boolean;
  showUnitPrices: boolean;
  lines: Array<{
    description: string; quantity: number | null; unit: string | null;
    unitPrice: number | null; total: number | null;
  }>;
  /**
   * What the bid does not cover, and what it was priced on.
   *
   * Carried on the token payload from migration 0235, and not optional. They
   * reached the contractor's own copy of the document the day the doors opened
   * and not this one, so for a few hours the person being asked to sign was the
   * only party who could not see what was excluded. An exclusion protects a
   * contractor only if the customer received it.
   *
   * Assumptions here are already filtered to those marked as shown to the
   * customer; the estimator's internal working never leaves the company.
   */
  exclusions: Array<{ exclusion: string; reason: string }>;
  assumptions: Array<{ assumption: string; reason: string }>;
  /**
   * Who is sending it, and what they look like.
   *
   * The branding travels with the proposal rather than being fetched
   * separately, because the person reading this page has no account and no
   * session: a second call would have nothing to authorize it. It is also the
   * only place tenant data reaches an anonymous caller, so what is here is
   * deliberate — a name, a mark and two colors.
   */
  company: {
    name: string; city: string | null; state: string | null;
    logoPath: string | null; primaryColor: string; accentColor: string;
  };
  recipientName: string;
  expiresAt: string;
}

/** Opened with the token alone, through `public` — `app` stays shut to a visitor. */
export async function openProposalByToken(token: string): Promise<SignableProposal> {
  if (!supabase) throw new Error('Not connected');
  const { data, error } = await supabase.rpc('open_proposal_by_token', { p_token: token });
  if (error) throw new Error(error.message);
  const d = data as Record<string, unknown>;
  return {
    proposalId: String(d.proposalId),
    number: String(d.number),
    title: String(d.title),
    coverLetter: (d.coverLetter as string | null) ?? null,
    commercialTerms: (d.commercialTerms as string | null) ?? null,
    paymentTerms: (d.paymentTerms as string | null) ?? null,
    totalPrice: Number(d.totalPrice ?? 0),
    issuedAt: (d.issuedAt as string | null) ?? null,
    validityDays: Number(d.validityDays ?? 30),
    showLineDetail: Boolean(d.showLineDetail),
    showUnitPrices: Boolean(d.showUnitPrices),
    lines: ((d.lines as Array<Record<string, unknown>> | null) ?? []).map((l) => ({
      description: String(l.description),
      quantity: l.quantity == null ? null : Number(l.quantity),
      unit: (l.unit as string | null) ?? null,
      unitPrice: l.unitPrice == null ? null : Number(l.unitPrice),
      total: l.total == null ? null : Number(l.total),
    })),
    exclusions: ((d.exclusions as Array<Record<string, unknown>> | null) ?? []).map((e) => ({
      exclusion: String(e.exclusion), reason: String(e.reason),
    })),
    assumptions: ((d.assumptions as Array<Record<string, unknown>> | null) ?? []).map((a) => ({
      assumption: String(a.assumption), reason: String(a.reason),
    })),
    company: (() => {
      const c = (d.company ?? {}) as Record<string, unknown>;
      return {
        name: String(c.name ?? ''),
        city: (c.city as string | null) ?? null,
        state: (c.state as string | null) ?? null,
        logoPath: (c.logoPath as string | null) ?? null,
        /* The company row's own defaults, not this module's guess at one. */
        primaryColor: String(c.primaryColor ?? '#111827'),
        accentColor: String(c.accentColor ?? '#F6C101'),
      };
    })(),
    recipientName: String(d.recipientName),
    expiresAt: String(d.expiresAt),
  };
}

/**
 * What was on screen when they signed, as a hash.
 *
 * Stored with the signature so "they accepted" keeps meaning something: without
 * it, a proposal edited afterwards carries a signature for a version nobody
 * ever saw. Built from the fields the page actually rendered, in a fixed order,
 * so the same document always hashes the same way.
 */
export async function hashDocument(p: SignableProposal): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  const canonical = JSON.stringify([
    p.proposalId, p.number, p.title, p.coverLetter, p.commercialTerms,
    p.paymentTerms, p.totalPrice,
    p.lines.map((l) => [l.description, l.quantity, l.unit, l.unitPrice, l.total]),
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function respondToProposal(input: {
  token: string;
  outcome: 'accepted' | 'declined';
  signedName: string;
  signedTitle?: string | null;
  signedEmail?: string | null;
  signatureText?: string | null;
  declineReason?: string | null;
  documentHash?: string | null;
}): Promise<{ outcome: string; number: string; signedBy: string; signedAt: string }> {
  if (!supabase) throw new Error('Not connected');
  const { data, error } = await supabase.rpc('respond_to_proposal_by_token', {
    p_token: input.token,
    p_outcome: input.outcome,
    p_signed_name: input.signedName,
    p_signed_title: input.signedTitle ?? null,
    p_signed_email: input.signedEmail ?? null,
    p_signature_text: input.signatureText ?? null,
    p_decline_reason: input.declineReason ?? null,
    p_document_hash: input.documentHash ?? null,
    // The address is the server's to know. A browser reporting its own is
    // reporting whatever it likes.
    p_ip: null,
    p_user_agent: typeof navigator === 'undefined' ? null : navigator.userAgent,
  });
  if (error) throw new Error(error.message);
  return data as { outcome: string; number: string; signedBy: string; signedAt: string };
}
