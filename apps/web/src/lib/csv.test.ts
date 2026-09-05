import { describe, expect, it } from 'vitest';
import { toCsv, csvFilename, type CsvColumn } from './csv';

/**
 * The two things that make a real CSV export go wrong: a customer whose name
 * has a comma in it, and a field a spreadsheet decides is a formula.
 */
describe('turning rows into a file', () => {
  interface Row { name: string; amount: number; note: string | null }
  const columns: CsvColumn<Row>[] = [
    { header: 'Company', value: (r) => r.name },
    { header: 'Amount', value: (r) => r.amount },
    { header: 'Note', value: (r) => r.note },
  ];

  it('survives the customer whose name has a comma in it', () => {
    // Always the one somebody notices, and always after the file was sent.
    const csv = toCsv([{ name: 'Ridgeline Excavating, Inc.', amount: 199, note: null }],
      columns);
    expect(csv).toContain('"Ridgeline Excavating, Inc.","199",""');
  });

  it('doubles an embedded quote rather than ending the field', () => {
    const csv = toCsv([{ name: 'The "Big" Dig', amount: 1, note: null }], columns);
    expect(csv).toContain('"The ""Big"" Dig"');
  });

  it('stops a spreadsheet executing a field that looks like a formula', () => {
    /*
     * Excel runs a leading =, +, - or @ when the file is opened. A company name
     * is not a formula, and one that looks like one is either an accident or
     * somebody trying something.
     */
    for (const dangerous of ['=1+1', '+SUM(A1)', '-2', '@import']) {
      const csv = toCsv([{ name: dangerous, amount: 0, note: null }], columns);
      expect(csv, dangerous).toContain(`"'${dangerous}"`);
    }
  });

  it('writes a header row from the column names', () => {
    const csv = toCsv<Row>([], columns);
    expect(csv.split('\r\n')[0]).toBe('﻿"Company","Amount","Note"');
  });

  it('leads with a byte order mark, so an accent survives Excel', () => {
    // Without it Excel reads UTF-8 as the local code page and a company with an
    // accent in its name arrives mangled.
    const csv = toCsv([{ name: 'Grüner Bau', amount: 1, note: null }], columns);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Grüner Bau');
  });

  it('writes an empty field rather than the word null', () => {
    const csv = toCsv([{ name: 'A', amount: 0, note: null }], columns);
    expect(csv).not.toContain('null');
  });

  it('names the file by what it is and the day it was taken', () => {
    const name = csvFilename('Revenue by company');
    expect(name).toMatch(/^grounup-revenue-by-company-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
