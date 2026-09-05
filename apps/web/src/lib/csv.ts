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
