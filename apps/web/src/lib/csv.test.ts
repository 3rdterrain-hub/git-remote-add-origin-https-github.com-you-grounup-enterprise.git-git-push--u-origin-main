import { describe, expect, it } from 'vitest';
import { toCsv, csvFilename, recordsFromCsv, type CsvColumn } from './csv';

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

/**
 * Reading a file somebody exported from somewhere else.
 *
 * The failures worth testing are the quiet ones: a comma inside a material
 * name that shifts every column right, and a byte order mark that makes the
 * first header unmatchable while looking identical on screen.
 */
describe('reading a CSV', () => {
  it('keeps a comma that is inside a field', () => {
    const rows = recordsFromCsv('name,unit\n"Pipe, ductile iron 8 inch",LF\n');
    expect(rows).toEqual([{ name: 'Pipe, ductile iron 8 inch', unit: 'LF' }]);
  });

  it('keeps a quote that is inside a field', () => {
    const rows = recordsFromCsv('name,unit\n"Pipe, 8"" ductile",LF\n');
    expect(rows[0]!.name).toBe('Pipe, 8" ductile');
  });

  it('keeps a newline that is inside a field', () => {
    const rows = recordsFromCsv('name,spec\n"Rebar","#4\ngrade 60"\n');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.spec).toBe('#4\ngrade 60');
  });

  it('reads a header however it was capitalized', () => {
    const rows = recordsFromCsv('Name,Unit Cost\nTopsoil,18.50\n');
    expect(rows[0]).toEqual({ name: 'Topsoil', 'unit cost': '18.50' });
  });

  it('does not make the byte order mark part of the first header', () => {
    const rows = recordsFromCsv('﻿name,unit\nTopsoil,CY\n');
    expect(Object.keys(rows[0]!)).toEqual(['name', 'unit']);
  });

  it('survives a round trip through toCsv, apostrophe and all', () => {
    const written = toCsv([{ name: '=Topsoil, screened', unit: 'CY' }], [
      { header: 'name', value: (r) => r.name },
      { header: 'unit', value: (r) => r.unit },
    ]);
    expect(recordsFromCsv(written)).toEqual([{ name: '=Topsoil, screened', unit: 'CY' }]);
  });

  it('reads CRLF the way a spreadsheet writes it', () => {
    const rows = recordsFromCsv('name,unit\r\nTopsoil,CY\r\n');
    expect(rows).toEqual([{ name: 'Topsoil', unit: 'CY' }]);
  });

  it('ignores a blank line rather than importing an empty material', () => {
    const rows = recordsFromCsv('name,unit\nTopsoil,CY\n\n\nGravel,TON\n');
    expect(rows).toHaveLength(2);
  });

  it('gives nothing back for a file with only a header', () => {
    expect(recordsFromCsv('name,unit\n')).toEqual([]);
  });

  it('fills a short row rather than dropping the columns off the end', () => {
    const rows = recordsFromCsv('name,unit,unit_cost\nTopsoil,CY\n');
    expect(rows[0]).toEqual({ name: 'Topsoil', unit: 'CY', unit_cost: '' });
  });
});
