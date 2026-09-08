/**
 * Turning rows into a file somebody can open.
 *
 * Deliberately small and deliberately strict about two things that make CSV
 * files go wrong in the real world:
 *
 * **Quoting.** A company called "Ridgeline Excavating, Inc." breaks a naive
 * export at exactly the customer whose name has a comma in it, which is always
 * the one somebody notices. Every field is quoted and every embedded quote is
 * doubled, which is what RFC 4180 says and what every spreadsheet expects.
 *
 * **Formulas.** A field beginning with `=`, `+`, `-` or `@` is executed by
 * Excel when the file is opened. A customer name is not a formula, and one that
 * looks like a formula is either an accident or somebody trying something; both
 * are handled by prefixing an apostrophe, which spreadsheets read as "this is
 * text" and which survives being pasted somewhere else.
 */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

function cell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  // Excel executes a leading =, +, - or @. A company name is not a formula.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => cell(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(c.value(r))).join(','));
  /*
   * CRLF, and a byte order mark. Both are concessions to Excel rather than
   * preferences: without the mark it reads UTF-8 as the local code page and a
   * company with an accent in its name arrives mangled.
   */
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}

/** Hand the file to the browser. */
export function downloadCsv(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Released on the next tick: revoking synchronously cancels the download in
  // some browsers before it has started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A stable, sortable filename: what it is, and the day it was taken. */
export function csvFilename(what: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return `grounup-${what.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${day}.csv`;
}

/**
 * Reading a file somebody exported from somewhere else.
 *
 * The mirror of `toCsv`, and strict about the same things for the same reason.
 * A material named `Pipe, ductile iron 8"` is not exotic, and a reader that
 * splits on commas files half of it as the category and the other half as the
 * unit — quietly, on one row out of three hundred.
 *
 * Two concessions to what actually arrives: the byte order mark Excel writes,
 * stripped rather than made part of the first header; and the leading
 * apostrophe a spreadsheet-safe export adds to a field that looks like a
 * formula, removed so a value survives a round trip through this pair.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  // A wholly blank line is a blank line, not a row of empty materials.
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/**
 * A CSV as records keyed by its header, lowercased and trimmed.
 *
 * Lowercased because `Unit Cost`, `unit_cost` and `UNIT COST` are the same
 * column to everybody except a string comparison, and the header is whatever
 * the last system exported rather than something the person chose.
 */
export function recordsFromCsv(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0]!.map((h) => h.trim().toLowerCase().replace(/^'/, ''));
  return rows.slice(1).map((r) => Object.fromEntries(
    header.map((h, i) => [h, (r[i] ?? '').replace(/^'/, '')])));
}
