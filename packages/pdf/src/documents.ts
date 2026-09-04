/**
 * The documents the platform issues.
 *
 * Each one is a pure function from data to bytes. No network, no DOM, no
 * clock unless one is passed in — so a proposal can be regenerated years later
 * and produce the same file, which is the property that makes a PDF worth
 * keeping as a record at all.
 */

import { LayoutDocument, PAGE_SIZES, type Theme } from './layout.js';

export interface Party {
  name: string;
  addressLines?: string[];
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface Branding {
  companyName: string;
  primary?: string;
  accent?: string;
  addressLines?: string[];
  license?: string;
}

/**
 * Money in accounting format.
 *
 * A negative is shown in parentheses, not as `$-26,125.00`. That is the
 * convention every accounts department and every architect reading a G702
 * expects, and a deduct change order printed with a stray minus after the
 * dollar sign is the kind of thing that gets a pay application queried.
 */
const usd = (v: number): string => {
  const body = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `($${body})` : `$${body}`;
};

const qty = (v: number, dp = 2): string =>
  v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

const isoDate = (v: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return v;
  // Parsed as local rather than UTC: a bare date rendered from UTC midnight
  // shows the previous day west of Greenwich.
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

function themeFrom(b: Branding): Partial<Theme> {
  return { primary: b.primary ?? '#111827', accent: b.accent ?? '#f6c101' };
}

/** The masthead every issued document carries. */
function letterhead(doc: LayoutDocument, brand: Branding, docType: string): number {
  const top = doc.margins.top;
  doc.pdf.rect(0, doc.size.height - 6, doc.size.width, 6,
    [...hexTriplet(brand.accent ?? '#f6c101')] as [number, number, number]);
  doc.absolute(brand.companyName, doc.margins.left, top, {
    font: 'Helvetica-Bold', size: 15, color: brand.primary ?? '#111827',
  });
  let y = top + 20;
  for (const line of brand.addressLines ?? []) {
    doc.absolute(line, doc.margins.left, y, { size: 8, color: doc.theme.muted });
    y += 11;
  }
  if (brand.license) {
    doc.absolute(`License ${brand.license}`, doc.margins.left, y, { size: 8, color: doc.theme.muted });
    y += 11;
  }
  doc.absolute(docType.toUpperCase(), doc.margins.left, top + 2, {
    font: 'Helvetica-Bold', size: 9, color: doc.theme.muted,
    align: 'right', width: doc.contentWidth,
  });
  return Math.max(y - top, 44) + 10;
}

function hexTriplet(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function pageFooter(doc: LayoutDocument, note: string): void {
  const y = doc.size.height - doc.margins.bottom + 16;
  doc.absolute(note, doc.margins.left, y, { size: 7.5, color: doc.theme.muted });
  doc.absolute(`Page ${doc.pageNumber}`, doc.margins.left, y, {
    size: 7.5, color: doc.theme.muted, align: 'right', width: doc.contentWidth,
  });
}

// ---------------------------------------------------------------- proposal

export interface ProposalLine {
  code: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
}

export interface ProposalInput {
  brand: Branding;
  customer: Party;
  number: string;
  title: string;
  projectName: string;
  issuedOn: string;
  validUntil: string;
  lines: ProposalLine[];
  subtotal: number;
  total: number;
  inclusions: string[];
  exclusions: string[];
  clarifications: string[];
  terms: string[];
  preparedBy: string;
  createdAt?: Date;
}

export function renderProposal(input: ProposalInput): Uint8Array {
  const doc = new LayoutDocument({
    title: `${input.number} — ${input.title}`,
    author: input.brand.companyName,
    subject: `Proposal for ${input.projectName}`,
    createdAt: input.createdAt,
    theme: themeFrom(input.brand),
  });

  doc.setFurniture({
    header: (d) => letterhead(d, input.brand, 'Proposal'),
    footer: (d) => pageFooter(d, `${input.brand.companyName} · Proposal ${input.number}`),
  });
  doc.newPage();

  doc.heading(input.title, 1);
  doc.fields([
    ['Proposal number', input.number],
    ['Issued', isoDate(input.issuedOn)],
    ['Project', input.projectName],
    ['Valid until', isoDate(input.validUntil)],
    ['Prepared for', input.customer.name],
    ['Prepared by', input.preparedBy],
  ]);
  doc.gap(6).rule().gap(10);

  doc.heading('Scope and pricing', 2);
  doc.table({
    columns: [
      { header: 'Item', width: 0.1 },
      { header: 'Description', width: 0.4, wrap: true },
      { header: 'Quantity', width: 0.13, align: 'right' },
      { header: 'Unit', width: 0.07 },
      { header: 'Unit price', width: 0.15, align: 'right' },
      { header: 'Amount', width: 0.15, align: 'right' },
    ],
    rows: input.lines.map((l) => [
      l.code, l.description, qty(l.quantity), l.unit, usd(l.unitPrice), usd(l.total),
    ]),
    totals: ['', 'Total', '', '', '', usd(input.total)],
  });
  doc.gap(16);

  const list = (heading: string, items: string[]): void => {
    if (items.length === 0) return;
    doc.heading(heading, 3);
    for (const item of items) {
      doc.text(`-  ${item}`, { size: 9, leading: 13 });
    }
    doc.gap(10);
  };

  list('Included', input.inclusions);
  // Exclusions are not decoration. What a proposal does not cover is the
  // single most common source of dispute, so it is given the same weight as
  // what it does.
  list('Not included', input.exclusions);
  list('Clarifications', input.clarifications);
  list('Terms', input.terms);

  /*
   * The acceptance block is kept whole. A signature line stranded at the top of
   * a page on its own, or running under the footer, is not a document anyone
   * signs — so the whole block moves to the next page rather than splitting.
   *
   * The reserve is the block's measured height, not a round number: 20 gap +
   * 1.5 rule + 14 gap + 25.55 heading + 12.15 line + 26 gap + 5 + 12 tail =
   * 116.2. An under-estimate lets the block start and then overflow the
   * footer; an over-estimate pushes a signature page nobody needed.
   */
  const ACCEPTANCE_BLOCK_HEIGHT = 117;
  doc.ensure(ACCEPTANCE_BLOCK_HEIGHT);
  doc.gap(20).rule().gap(14);
  doc.heading('Acceptance', 2);
  doc.text(
    'Signing below accepts this proposal and the scope, exclusions and terms stated in it.',
    { size: 9, color: doc.theme.muted },
  );
  doc.gap(26);
  const half = doc.contentWidth / 2 - 16;
  doc.pdf.rule(doc.margins.left, doc.size.height - doc.y, half, hexTriplet(doc.theme.rule), 0.75);
  doc.pdf.rule(doc.margins.left + half + 32, doc.size.height - doc.y, half, hexTriplet(doc.theme.rule), 0.75);
  doc.gap(5);
  doc.absolute('Authorized signature', doc.margins.left, doc.y, { size: 7.5, color: doc.theme.muted });
  doc.absolute('Date', doc.margins.left + half + 32, doc.y, { size: 7.5, color: doc.theme.muted });
  doc.gap(12);

  return doc.toBytes();
}

// -------------------------------------------------------- pay application

export interface PayApplicationLine {
  itemNumber: string;
  description: string;
  scheduledValue: number;
  previouslyCompleted: number;
  completedThisPeriod: number;
  storedMaterials: number;
}

export interface PayApplicationInput {
  brand: Branding;
  owner: Party;
  projectName: string;
  projectNumber: string;
  applicationNumber: number;
  periodStart: string;
  periodEnd: string;
  contractSum: number;
  approvedChanges: number;
  retainagePercent: number;
  previousPayments: number;
  lines: PayApplicationLine[];
  createdAt?: Date;
}

export interface PayApplicationTotals {
  contractSumToDate: number;
  completedToDate: number;
  storedMaterials: number;
  totalEarned: number;
  retainage: number;
  earnedLessRetainage: number;
  previousPayments: number;
  currentPaymentDue: number;
  balanceToFinish: number;
}

/**
 * The certificate arithmetic, separated so it can be tested against the values
 * a document actually has to reconcile with. Every figure a payment is made on
 * is derived here rather than passed in, so a document cannot state a total
 * that its own lines do not support.
 */
export function payApplicationTotals(input: PayApplicationInput): PayApplicationTotals {
  const round = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;
  const completedToDate = round(input.lines.reduce(
    (a, l) => a + l.previouslyCompleted + l.completedThisPeriod, 0));
  const storedMaterials = round(input.lines.reduce((a, l) => a + l.storedMaterials, 0));
  const totalEarned = round(completedToDate + storedMaterials);
  const retainage = round(totalEarned * input.retainagePercent);
  const earnedLessRetainage = round(totalEarned - retainage);
  const contractSumToDate = round(input.contractSum + input.approvedChanges);
  return {
    contractSumToDate,
    completedToDate,
    storedMaterials,
    totalEarned,
    retainage,
    earnedLessRetainage,
    previousPayments: round(input.previousPayments),
    currentPaymentDue: round(earnedLessRetainage - input.previousPayments),
    balanceToFinish: round(contractSumToDate - totalEarned),
  };
}

export function renderPayApplication(input: PayApplicationInput): Uint8Array {
  const t = payApplicationTotals(input);
  const doc = new LayoutDocument({
    title: `Application ${input.applicationNumber} — ${input.projectName}`,
    author: input.brand.companyName,
    subject: `Application for payment, ${input.projectNumber}`,
    createdAt: input.createdAt,
    size: PAGE_SIZES.letterLandscape,
    theme: themeFrom(input.brand),
  });

  doc.setFurniture({
    header: (d) => letterhead(d, input.brand, 'Application for payment'),
    footer: (d) => pageFooter(d,
      `${input.projectNumber} · Application ${input.applicationNumber} · Period ending ${isoDate(input.periodEnd)}`),
  });
  doc.newPage();

  doc.heading(input.projectName, 1);
  doc.fields([
    ['Application number', String(input.applicationNumber)],
    ['Period', `${isoDate(input.periodStart)} to ${isoDate(input.periodEnd)}`],
    ['Project number', input.projectNumber],
    ['To', input.owner.name],
    ['From', input.brand.companyName],
    ['Retainage', `${(input.retainagePercent * 100).toFixed(2)}%`],
  ], 3);
  doc.gap(6).rule().gap(12);

  doc.heading('Continuation sheet', 2);
  doc.table({
    fontSize: 8,
    columns: [
      { header: 'Item', width: 0.06 },
      { header: 'Description of work', width: 0.28, wrap: true },
      { header: 'Scheduled value', width: 0.11, align: 'right' },
      { header: 'From previous', width: 0.1, align: 'right' },
      { header: 'This period', width: 0.1, align: 'right' },
      { header: 'Stored', width: 0.09, align: 'right' },
      { header: 'Total completed', width: 0.11, align: 'right' },
      { header: '%', width: 0.06, align: 'right' },
      { header: 'Balance', width: 0.09, align: 'right' },
    ],
    rows: input.lines.map((l) => {
      const completed = l.previouslyCompleted + l.completedThisPeriod + l.storedMaterials;
      // A zero scheduled value would make the percentage meaningless rather
      // than infinite; it is left blank instead of printing a number.
      const pct = l.scheduledValue > 0 ? `${((completed / l.scheduledValue) * 100).toFixed(1)}%` : '—';
      return [
        l.itemNumber, l.description, usd(l.scheduledValue),
        usd(l.previouslyCompleted), usd(l.completedThisPeriod), usd(l.storedMaterials),
        usd(completed), pct, usd(l.scheduledValue - completed),
      ];
    }),
    totals: [
      '', 'Total',
      usd(input.lines.reduce((a, l) => a + l.scheduledValue, 0)),
      usd(input.lines.reduce((a, l) => a + l.previouslyCompleted, 0)),
      usd(input.lines.reduce((a, l) => a + l.completedThisPeriod, 0)),
      usd(t.storedMaterials), usd(t.totalEarned), '',
      usd(t.balanceToFinish),
    ],
  });

  doc.gap(18).ensure(200);
  doc.heading('Certificate for payment', 2);
  const rows: [string, number][] = [
    ['Original contract sum', input.contractSum],
    ['Net change by change orders', input.approvedChanges],
    ['Contract sum to date', t.contractSumToDate],
    ['Total completed and stored to date', t.totalEarned],
    [`Retainage at ${(input.retainagePercent * 100).toFixed(2)}%`, -t.retainage],
    ['Total earned less retainage', t.earnedLessRetainage],
    ['Less previous certificates for payment', -t.previousPayments],
    ['Current payment due', t.currentPaymentDue],
    ['Balance to finish, including retainage', t.balanceToFinish],
  ];
  const labelWidth = doc.contentWidth * 0.6;
  for (const [label, value] of rows) {
    const emphasize = label === 'Current payment due';
    doc.ensure(16);
    doc.absolute(label, doc.margins.left, doc.y, {
      size: emphasize ? 10 : 9,
      font: emphasize ? 'Helvetica-Bold' : 'Helvetica',
      color: emphasize ? doc.theme.primary : doc.theme.text,
    });
    doc.absolute(usd(value), doc.margins.left + labelWidth, doc.y, {
      size: emphasize ? 10 : 9,
      font: emphasize ? 'Helvetica-Bold' : 'Helvetica',
      color: emphasize ? doc.theme.primary : doc.theme.text,
      align: 'right', width: doc.contentWidth - labelWidth,
    });
    doc.gap(emphasize ? 18 : 14);
    if (emphasize) doc.rule({ color: doc.theme.primary, thickness: 0.75 });
  }

  return doc.toBytes();
}

// ------------------------------------------------------------------ report

export interface ReportSection {
  heading: string;
  body?: string;
  table?: {
    columns: { header: string; width: number; align?: 'left' | 'center' | 'right'; wrap?: boolean }[];
    rows: string[][];
    totals?: string[];
  };
}

export interface ReportInput {
  brand: Branding;
  title: string;
  subtitle?: string;
  generatedOn: string;
  generatedBy: string;
  /** Stated on the document so a printed copy still says what it covers. */
  scopeNote: string;
  summary?: { label: string; value: string }[];
  sections: ReportSection[];
  createdAt?: Date;
}

export function renderReport(input: ReportInput): Uint8Array {
  const doc = new LayoutDocument({
    title: input.title,
    author: input.brand.companyName,
    subject: input.subtitle,
    createdAt: input.createdAt,
    theme: themeFrom(input.brand),
  });

  doc.setFurniture({
    header: (d) => letterhead(d, input.brand, 'Report'),
    footer: (d) => pageFooter(d, `${input.title} · generated ${isoDate(input.generatedOn)}`),
  });
  doc.newPage();

  doc.heading(input.title, 1);
  if (input.subtitle) {
    doc.text(input.subtitle, { size: 11, color: doc.theme.muted }).gap(6);
  }
  doc.fields([
    ['Generated', isoDate(input.generatedOn)],
    ['Generated by', input.generatedBy],
  ]);
  // A printed report that does not say what it covers is a report someone will
  // read as covering everything.
  doc.text(input.scopeNote, { size: 8.5, color: doc.theme.muted }).gap(10);
  doc.rule().gap(12);

  if (input.summary?.length) {
    doc.fields(input.summary.map((s) => [s.label, s.value] as const), 4);
    doc.gap(8).rule().gap(12);
  }

  for (const section of input.sections) {
    doc.ensure(60);
    doc.heading(section.heading, 2);
    if (section.body) doc.text(section.body, { size: 9.5 }).gap(6);
    if (section.table) {
      doc.table({
        columns: section.table.columns,
        rows: section.table.rows,
        totals: section.table.totals,
        fontSize: 8.5,
      });
    }
    doc.gap(16);
  }

  return doc.toBytes();
}
