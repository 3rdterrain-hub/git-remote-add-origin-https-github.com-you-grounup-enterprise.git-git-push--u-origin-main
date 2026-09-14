/**
 * The proposal as a file the customer keeps.
 *
 * `renderProposal` has been in `packages/pdf` since the package was written —
 * complete, tested, taking its theme from the company's own colors — and its
 * only callers were its own tests. The Proposals screen carried a button
 * labeled "PDF" with no handler on it.
 *
 * These hold the decisions rather than the layout: that the document says what
 * the screen says, that it honors what the customer was allowed to see, and
 * that no price in it is recomputed.
 */
import { describe, expect, it } from 'vitest';
import {
  proposalPdfInput, proposalPdfBytes, proposalFileName, type ProposalForPdf, type BrandFor,
} from './proposal-pdf';

const brand: BrandFor = {
  name: '3RD Terrain',
  primaryColor: '#1B4D3E',
  accentColor: '#F6C101',
  addressLine1: '1400 Industrial Pkwy',
  city: 'Toledo',
  stateProvince: 'OH',
  postalCode: '43607',
};

const proposal = (over: Partial<ProposalForPdf> = {}): ProposalForPdf => ({
  number: 'P-2026-0001',
  title: 'Site work — Kingsway',
  customerName: 'Kingsway Development',
  issuedAt: '2026-09-10T14:00:00Z',
  validityDays: 30,
  totalPrice: 486_250,
  coverLetter: 'Thank you for the opportunity to quote this work.',
  commercialTerms: 'Price held 30 days.',
  paymentTerms: 'Net 30',
  showLineDetail: true,
  showUnitPrices: true,
  lines: [
    { description: 'Mass excavation', quantity: 18_400, unit: 'CY', unitPrice: 9.25, total: 170_200 },
    { description: 'Storm drainage', quantity: 2_140, unit: 'LF', unitPrice: 147.69, total: 316_050 },
  ],
  ...over,
});

describe('a proposal as a document', () => {
  it('carries the company colors into the theme', () => {
    const input = proposalPdfInput(proposal(), brand);
    expect(input.brand.primary).toBe('#1B4D3E');
    expect(input.brand.accent).toBe('#F6C101');
    expect(input.brand.companyName).toBe('3RD Terrain');
  });

  it('prints the address as lines, and drops the parts that are missing', () => {
    expect(proposalPdfInput(proposal(), brand).brand.addressLines)
      .toEqual(['1400 Industrial Pkwy', 'Toledo, OH 43607']);
    expect(proposalPdfInput(proposal(), { ...brand, addressLine1: null, city: null,
      stateProvince: null, postalCode: null }).brand.addressLines).toEqual([]);
  });

  it('does not recompute a price', () => {
    /*
     * The total is the frozen figure the engine wrote. A document that adds up
     * its own lines is a document that can disagree with the estimate it came
     * from — and the sections are a rollup, so they need not sum to it exactly.
     */
    const input = proposalPdfInput(proposal({ totalPrice: 486_250 }), brand);
    expect(input.total).toBe(486_250);
    expect(input.subtotal).toBe(486_250);
  });

  it('honors a proposal sent as a lump sum', () => {
    // A customer shown one number must not receive a PDF itemizing it.
    const input = proposalPdfInput(proposal({ showLineDetail: false }), brand);
    expect(input.lines).toEqual([]);
    expect(input.total).toBe(486_250);
  });

  it('shows quantities without unit prices when that is what was sent', () => {
    const input = proposalPdfInput(proposal({ showUnitPrices: false }), brand);
    expect(input.lines).toHaveLength(2);
    expect(input.lines[0]!.quantity).toBe(18_400);
    expect(input.lines.every((l) => l.unitPrice === 0)).toBe(true);
  });

  it('ends the offer on the day the validity runs out', () => {
    const input = proposalPdfInput(proposal(), brand);
    expect(input.issuedOn).toBe('2026-09-10');
    expect(input.validUntil).toBe('2026-10-10');
  });

  it('carries the cover letter and both sets of terms', () => {
    const input = proposalPdfInput(proposal(), brand);
    expect(input.clarifications).toEqual(['Thank you for the opportunity to quote this work.']);
    expect(input.terms).toEqual(['Price held 30 days.', 'Net 30']);
  });

  it('leaves a heading off rather than heading an empty block', () => {
    const input = proposalPdfInput(
      proposal({ coverLetter: null, commercialTerms: null, paymentTerms: '  ' }), brand);
    expect(input.clarifications).toEqual([]);
    expect(input.terms).toEqual([]);
  });

  it('produces a PDF', () => {
    const bytes = proposalPdfBytes(proposal(), brand, new Date(0));
    expect(bytes.length).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toMatch(/^%PDF-/);
  });

  it('produces the same bytes twice, so a proposal can be reissued identically', () => {
    /*
     * The property that makes a PDF worth keeping as a record: regenerate it
     * years later and get the same file. Only true with the clock passed in.
     */
    const a = proposalPdfBytes(proposal(), brand, new Date(0));
    const b = proposalPdfBytes(proposal(), brand, new Date(0));
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('names the file after the proposal, not "download"', () => {
    expect(proposalFileName({ number: 'P-2026-0001', title: 'Site work — Kingsway' }))
      .toBe('P-2026-0001-Site-work-Kingsway.pdf');
    expect(proposalFileName({ number: 'P-2026-0002', title: '///' }))
      .toBe('P-2026-0002.pdf');
  });
});
