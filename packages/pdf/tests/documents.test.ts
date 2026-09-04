import { describe, expect, it } from 'vitest';
import {
  renderProposal, renderPayApplication, renderReport, payApplicationTotals,
  type ProposalInput, type PayApplicationInput,
} from '../src/documents.js';
import { extractText, pageCount, checkXref, checkStreamLengths, decode, placedText } from './helpers.js';

const BRAND = {
  companyName: 'Ridgeline Excavating & Site Works',
  primary: '#111827', accent: '#f6c101',
  addressLines: ['1420 Industrial Parkway', 'Toledo, OH 43607'],
  license: 'OH-CC-118342',
};
const FIXED = new Date('2026-09-02T12:00:00Z');

const PROPOSAL: ProposalInput = {
  brand: BRAND,
  customer: { name: 'Northgate Development LLC' },
  number: 'P-2026-0184',
  title: 'Sitework — Northgate Logistics Park, Phase 1',
  projectName: 'Northgate Logistics Park',
  issuedOn: '2026-08-28',
  validUntil: '2026-09-27',
  preparedBy: 'Alice Okafor',
  lines: [
    { code: 'L-010', description: 'Mobilization and site preparation', quantity: 1, unit: 'LS', unitPrice: 42500, total: 42500 },
    { code: 'L-020', description: 'Mass excavation, cut to fill and export of surplus material', quantity: 135287, unit: 'CY', unitPrice: 4.85, total: 656141.95 },
    { code: 'L-030', description: 'Structural fill, placed and compacted in eight inch lifts', quantity: 8807, unit: 'CY', unitPrice: 11.4, total: 100399.8 },
  ],
  subtotal: 799041.75,
  total: 799041.75,
  inclusions: ['Erosion control installation and maintenance for the contract duration'],
  exclusions: [
    'Rock excavation of any kind',
    'Dewatering beyond routine sump pumping',
    'Undercut below the design subgrade shown on sheet C-301',
  ],
  clarifications: ['Pricing assumes continuous access to the full site from 15 September 2026.'],
  terms: ['Net 30 from the date of invoice.', 'Retainage at 5%, released at substantial completion.'],
  createdAt: FIXED,
};

const PAY_APP: PayApplicationInput = {
  brand: BRAND,
  owner: { name: 'Northgate Development LLC' },
  projectName: 'Northgate Logistics Park',
  projectNumber: 'PRJ-2026-014',
  applicationNumber: 3,
  periodStart: '2026-08-01',
  periodEnd: '2026-08-31',
  contractSum: 799041.75,
  approvedChanges: 51600,
  retainagePercent: 0.05,
  previousPayments: 228_000,
  lines: [
    { itemNumber: '1', description: 'Mobilization', scheduledValue: 42500, previouslyCompleted: 42500, completedThisPeriod: 0, storedMaterials: 0 },
    { itemNumber: '2', description: 'Mass excavation', scheduledValue: 656141.95, previouslyCompleted: 210000, completedThisPeriod: 240000, storedMaterials: 0 },
    { itemNumber: '3', description: 'Structural fill', scheduledValue: 100399.8, previouslyCompleted: 0, completedThisPeriod: 18000, storedMaterials: 12000 },
  ],
  createdAt: FIXED,
};

describe('every document is a structurally valid PDF', () => {
  const docs = {
    proposal: renderProposal(PROPOSAL),
    payApplication: renderPayApplication(PAY_APP),
    report: renderReport({
      brand: BRAND, title: 'Project cost report', generatedOn: '2026-09-02',
      generatedBy: 'Dana Whitfield',
      scopeNote: 'Active projects only. Committed cost excludes purchase orders not yet issued.',
      summary: [{ label: 'Projects', value: '6' }, { label: 'Backlog', value: '$4.2M' }],
      sections: [{
        heading: 'Margin by project',
        table: {
          columns: [
            { header: 'Project', width: 0.5, wrap: true },
            { header: 'Contract', width: 0.25, align: 'right' },
            { header: 'Margin', width: 0.25, align: 'right' },
          ],
          rows: [['Northgate Logistics Park', '$850,641.75', '18.4%']],
          totals: ['Total', '$850,641.75', ''],
        },
      }],
      createdAt: FIXED,
    }),
  };

  for (const [name, bytes] of Object.entries(docs)) {
    it(`${name} starts with a PDF header and ends with %%EOF`, () => {
      expect(decode(bytes).startsWith('%PDF-1.7')).toBe(true);
      expect(decode(bytes).trimEnd().endsWith('%%EOF')).toBe(true);
    });

    it(`${name} has a cross-reference table pointing at real objects`, () => {
      const check = checkXref(bytes);
      expect(check.problems).toEqual([]);
      expect(check.valid).toBe(true);
    });

    it(`${name} declares honest stream lengths`, () => {
      expect(checkStreamLengths(bytes)).toEqual([]);
    });

    it(`${name} declares a page count matching its page objects`, () => {
      const declared = pageCount(bytes);
      const actual = [...decode(bytes).matchAll(/\/Type \/Page[^s]/g)].length;
      expect(declared).toBe(actual);
      expect(declared).toBeGreaterThan(0);
    });
  }

  it('renders the same bytes twice for the same input', () => {
    // Determinism is what lets a pay application be hashed and compared. A
    // clock inside the renderer would quietly destroy it.
    expect(renderProposal(PROPOSAL)).toEqual(renderProposal(PROPOSAL));
  });
});

describe('the proposal says what a proposal must say', () => {
  const text = extractText(renderProposal(PROPOSAL)).join('\n');

  it('carries the issuing company and the proposal number', () => {
    expect(text).toContain('Ridgeline Excavating & Site Works');
    expect(text).toContain('P-2026-0184');
  });

  it('prints every line item and its amount', () => {
    for (const l of PROPOSAL.lines) {
      expect(text).toContain(l.code);
      expect(text).toContain(`$${l.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    }
  });

  it('prints the total exactly once as a total', () => {
    expect(text).toContain('$799,041.75');
  });

  it('gives exclusions the same prominence as inclusions', () => {
    // What a proposal does not cover is the most common source of dispute.
    expect(text).toContain('Not included');
    for (const e of PROPOSAL.exclusions) expect(text).toContain(e);
  });

  it('states the validity date, so an old price cannot be held against it', () => {
    expect(text).toContain('September 27, 2026');
  });

  it('provides a signature block', () => {
    expect(text).toContain('Authorized signature');
  });

  it('numbers its pages', () => {
    expect(text).toMatch(/Page \d+/);
  });
});

describe('the pay application certificate reconciles', () => {
  const t = payApplicationTotals(PAY_APP);

  it('totals completed work from the lines, never from a passed-in figure', () => {
    expect(t.completedToDate).toBe(510500);
    expect(t.storedMaterials).toBe(12000);
    expect(t.totalEarned).toBe(522500);
  });

  it('withholds retainage on the total earned', () => {
    expect(t.retainage).toBe(26125);
    expect(t.earnedLessRetainage).toBe(496375);
  });

  it('deducts previous certificates to reach the payment due', () => {
    expect(t.currentPaymentDue).toBe(268375);
  });

  it('adds approved changes into the contract sum to date', () => {
    expect(t.contractSumToDate).toBe(850641.75);
    expect(t.balanceToFinish).toBe(328141.75);
  });

  it('reconciles: earned less retainage less previous equals due', () => {
    expect(t.earnedLessRetainage - t.previousPayments).toBeCloseTo(t.currentPaymentDue, 2);
  });

  it('reconciles: earned plus balance equals the contract sum to date', () => {
    expect(t.totalEarned + t.balanceToFinish).toBeCloseTo(t.contractSumToDate, 2);
  });

  it('prints the payment due on the document itself', () => {
    const text = extractText(renderPayApplication(PAY_APP)).join('\n');
    expect(text).toContain('Current payment due');
    expect(text).toContain('$268,375.00');
  });

  it('never prints a percentage against a zero scheduled value', () => {
    const text = extractText(renderPayApplication({
      ...PAY_APP,
      lines: [{ itemNumber: '1', description: 'Allowance', scheduledValue: 0, previouslyCompleted: 0, completedThisPeriod: 500, storedMaterials: 0 }],
    })).join('\n');
    expect(text).not.toMatch(/Infinity|NaN/);
  });
});

describe('pagination', () => {
  it('runs a long table onto further pages', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      itemNumber: String(i + 1),
      description: `Line item ${i + 1}`,
      scheduledValue: 1000, previouslyCompleted: 400, completedThisPeriod: 100, storedMaterials: 0,
    }));
    const bytes = renderPayApplication({ ...PAY_APP, lines: many });
    expect(pageCount(bytes)).toBeGreaterThan(1);
  });

  it('repeats the table header on every page', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      itemNumber: String(i + 1), description: `Line item ${i + 1}`,
      scheduledValue: 1000, previouslyCompleted: 400, completedThisPeriod: 100, storedMaterials: 0,
    }));
    const bytes = renderPayApplication({ ...PAY_APP, lines: many });
    const headers = extractText(bytes).filter((t) => t === 'Description of work');
    // A continued table with unlabelled columns is a document that gets sent
    // back, so the header count must match the page count.
    expect(headers.length).toBe(pageCount(bytes));
  });

  it('keeps every page numbered', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      itemNumber: String(i + 1), description: `Line item ${i + 1}`,
      scheduledValue: 1000, previouslyCompleted: 400, completedThisPeriod: 100, storedMaterials: 0,
    }));
    const bytes = renderPayApplication({ ...PAY_APP, lines: many });
    const pages = extractText(bytes).filter((t) => /^Page \d+$/.test(t));
    expect(pages.length).toBe(pageCount(bytes));
    expect(pages).toEqual(pages.map((_, i) => `Page ${i + 1}`));
  });
});

describe('white-label branding reaches the document', () => {
  it('uses the company name and colors it was given', () => {
    const bytes = renderProposal({
      ...PROPOSAL,
      brand: { ...BRAND, companyName: 'Kesler Site Works', primary: '#2563eb', accent: '#22d3ee' },
    });
    expect(extractText(bytes).join('\n')).toContain('Kesler Site Works');
    // 0x25/255 = 0.145, the blue the caller asked for.
    expect(decode(bytes)).toContain('0.145');
  });

  it('escapes a company name containing parentheses', () => {
    // An unescaped ) ends the PDF string early and corrupts every object after
    // it — a file that opens as garbage for a name nobody thought twice about.
    const bytes = renderProposal({
      ...PROPOSAL,
      brand: { ...BRAND, companyName: 'Ridgeline (Ohio) LLC' },
    });
    expect(checkXref(bytes).problems).toEqual([]);
    expect(extractText(bytes).join('\n')).toContain('Ridgeline (Ohio) LLC');
  });
});

describe('nothing is drawn outside the margins', () => {
  /**
   * The bottom margin is 54pt, so page content sits at y >= 54 in PDF
   * coordinates. The footer is deliberately below that line — it is the only
   * thing that may be.
   */
  const BOTTOM_MARGIN = 54;

  const isFooter = (t: string): boolean =>
    /^Page \d+$/.test(t) || t.includes('Ridgeline') || t.includes('Kesler')
    || t.includes('Application') || t.includes('generated');

  it('keeps proposal content above the footer, including the signature block', () => {
    const placed = placedText(renderProposal(PROPOSAL));
    const offending = placed.filter((p) => p.y < BOTTOM_MARGIN && !isFooter(p.text));
    expect(offending).toEqual([]);
  });

  it('keeps the acceptance block whole on one page', () => {
    const placed = placedText(renderProposal(PROPOSAL));
    const heading = placed.find((p) => p.text === 'Acceptance');
    const signature = placed.find((p) => p.text === 'Authorized signature');
    expect(heading).toBeDefined();
    expect(signature).toBeDefined();
    // A signature line on a different page from the words it accepts is not a
    // document anyone signs.
    expect(signature!.page).toBe(heading!.page);
  });

  it('keeps pay application content above the footer', () => {
    const placed = placedText(renderPayApplication(PAY_APP));
    const offending = placed.filter((p) => p.y < BOTTOM_MARGIN && !isFooter(p.text));
    expect(offending).toEqual([]);
  });

  it('keeps every string inside the right margin', () => {
    const RIGHT_EDGE = 612 - 54;
    const placed = placedText(renderProposal(PROPOSAL));
    for (const p of placed) {
      expect(p.x, `"${p.text}" starts past the right margin`).toBeLessThanOrEqual(RIGHT_EDGE);
    }
  });
});

describe('money is formatted the way an accounts department reads it', () => {
  it('shows a deduction in parentheses, not with a stray minus', () => {
    const text = extractText(renderPayApplication(PAY_APP)).join('\n');
    // "$-26,125.00" is the kind of thing that gets a pay application queried.
    expect(text).toContain('($26,125.00)');
    expect(text).not.toMatch(/\$-/);
  });

  it('shows a deduct change order in parentheses', () => {
    const text = extractText(renderPayApplication({ ...PAY_APP, approvedChanges: -12500 })).join('\n');
    expect(text).toContain('($12,500.00)');
  });

  it('leaves positive amounts alone', () => {
    const text = extractText(renderProposal(PROPOSAL)).join('\n');
    expect(text).toContain('$42,500.00');
    expect(text).not.toMatch(/\(\$42,500\.00\)/);
  });
});
