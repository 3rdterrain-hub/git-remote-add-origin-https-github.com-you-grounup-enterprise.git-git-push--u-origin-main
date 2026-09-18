/**
 * The proposal as a file the customer keeps. WORKFLOW.
 *
 * `renderProposal` has been in `packages/pdf` since the package was written —
 * a pure function from data to bytes, with a letterhead, a line table, an
 * inclusions and exclusions block, terms, and a theme it takes from the
 * company's own colors. It is complete, it is tested, and until now its only
 * callers were its own tests. The Proposals screen had a button labeled "PDF"
 * with no `onClick` at all.
 *
 * Everything here is assembly: turn what the screen already has into the shape
 * that function takes, and hand the bytes to the browser. No arithmetic — the
 * totals are the ones the engine wrote, because a document that recomputes a
 * price is a document that can disagree with the estimate it came from.
 */
import { renderProposal, type ProposalInput } from '@grounup/pdf';

/** The company, as the document's letterhead needs it. */
export interface BrandFor {
  name: string;
  primaryColor: string;
  accentColor: string;
  city?: string | null;
  stateProvince?: string | null;
  addressLine1?: string | null;
  postalCode?: string | null;
}

export interface ProposalForPdf {
  number: string;
  title: string;
  customerName: string | null;
  projectName?: string | null;
  issuedAt: string | null;
  validityDays: number;
  totalPrice: number;
  coverLetter: string | null;
  commercialTerms?: string | null;
  paymentTerms: string | null;
  showLineDetail: boolean;
  showUnitPrices: boolean;
  /**
   * What the estimate said this price excludes and what it assumes.
   *
   * Carried on the proposal rather than recomputed here: they belong to the
   * estimate version the proposal was made from, and an issued version cannot
   * change. Optional so every existing caller and test keeps working — an
   * absent list and an empty one mean the same thing to the document, which
   * prints no heading over nothing.
   */
  exclusions?: Array<{ exclusion: string; reason: string }>;
  assumptions?: Array<{ assumption: string; reason: string }>;
  lines: Array<{
    code?: string | null;
    description: string;
    quantity: number | null;
    unit: string | null;
    unitPrice: number | null;
    total: number | null;
  }>;
}

const addressOf = (b: BrandFor): string[] => [
  b.addressLine1 ?? '',
  [b.city, b.stateProvince].filter(Boolean).join(', ')
    + (b.postalCode ? ` ${b.postalCode}` : ''),
].map((l) => l.trim()).filter((l) => l !== '');

/** `issuedOn` plus the validity, which is the date the offer stops standing. */
function validUntil(issuedAt: string | null, days: number): string {
  const from = issuedAt ? new Date(issuedAt) : new Date();
  const until = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return until.toISOString().slice(0, 10);
}

/**
 * Shape a proposal for the renderer.
 *
 * Line detail and unit prices honor the proposal's own settings, the same two
 * flags the signing page reads — a customer who was shown a lump sum on screen
 * must not receive a PDF itemizing it.
 */
export function proposalPdfInput(
  proposal: ProposalForPdf, brand: BrandFor, createdAt?: Date,
): ProposalInput {
  const issuedOn = (proposal.issuedAt ?? new Date().toISOString()).slice(0, 10);
  const lines = proposal.showLineDetail
    ? proposal.lines.map((l) => ({
      code: l.code ?? '',
      description: l.description,
      quantity: l.quantity ?? 0,
      unit: l.unit ?? '',
      /* Zero rather than a guess: the renderer prints what it is given. */
      unitPrice: proposal.showUnitPrices ? (l.unitPrice ?? 0) : 0,
      total: l.total ?? 0,
    }))
    : [];

  return {
    brand: {
      companyName: brand.name,
      primary: brand.primaryColor,
      accent: brand.accentColor,
      addressLines: addressOf(brand),
    },
    customer: { name: proposal.customerName ?? 'Customer' },
    number: proposal.number,
    title: proposal.title,
    projectName: proposal.projectName ?? proposal.title,
    issuedOn,
    validUntil: validUntil(proposal.issuedAt, proposal.validityDays),
    lines,
    subtotal: proposal.totalPrice,
    total: proposal.totalPrice,
    /*
     * The proposal's own prose, split into the blocks the document has. Empty
     * arrays where a company has written nothing — a heading over nothing is
     * worse than no heading.
     */
    inclusions: [],
    /*
     * Each exclusion with the reason beside it, because the reason is the half
     * that settles the argument. "Rock excavation" alone invites "well, you
     * should have allowed for it"; "Rock excavation — no geotechnical report
     * was provided with the set" does not.
     *
     * These two arrays were `[]` from the day this file was written. The
     * document has always had the sections; nothing had ever written a row into
     * `estimate_exclusions`, so every bid this platform produced went out
     * silent about what it did not cover.
     */
    exclusions: (proposal.exclusions ?? [])
      .map((e) => `${e.exclusion} — ${e.reason}`),
    /*
     * Assumptions read as clarifications on the document, under the cover
     * letter. That is what they are to the person receiving it: the basis the
     * number was worked out on. Only the ones marked as shown to the customer
     * reach here; the filter is applied where they are read, not printed.
     */
    clarifications: [
      ...(proposal.coverLetter ? [proposal.coverLetter] : []),
      ...(proposal.assumptions ?? []).map((a) => `${a.assumption} — ${a.reason}`),
    ],
    terms: [proposal.commercialTerms, proposal.paymentTerms]
      .filter((t): t is string => Boolean(t && t.trim())),
    preparedBy: brand.name,
    ...(createdAt ? { createdAt } : {}),
  };
}

/** The bytes, ready to hand to a browser or to storage. */
export function proposalPdfBytes(
  proposal: ProposalForPdf, brand: BrandFor, createdAt?: Date,
): Uint8Array {
  return renderProposal(proposalPdfInput(proposal, brand, createdAt));
}

/** What the saved file should be called: the proposal number, not "download". */
export function proposalFileName(proposal: { number: string; title: string }): string {
  const safe = proposal.title.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-');
  return `${proposal.number}${safe ? `-${safe}` : ''}.pdf`;
}

/**
 * Hand the file to the person who asked for it.
 *
 * Kept apart from the rendering so the bytes can be tested without a DOM, and
 * so the same document can later be written to storage — `proposals.storage_path`
 * has existed since migration 0006 and nothing has ever written it.
 */
export function downloadProposalPdf(
  proposal: ProposalForPdf, brand: BrandFor,
): void {
  const bytes = proposalPdfBytes(proposal, brand);
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = proposalFileName(proposal);
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* Freed on the next tick: revoking synchronously races the click in Safari. */
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
