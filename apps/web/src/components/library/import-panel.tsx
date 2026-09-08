/**
 * Bringing a file in.
 *
 * Two libraries take a spreadsheet — a price list for materials, a rate sheet
 * for equipment — and the shape of the job is identical both times: read the
 * file, say what was found in it before anything is written, hand the rows to a
 * database function, and show what came back. Only three things differ: which
 * columns the function reads, which function it is, and what the counts are
 * called.
 *
 * So it is one panel. The alternative was a second copy of this eighty lines
 * later, which is how the two quietly stop agreeing about what a refused row
 * looks like.
 *
 * What the panel is responsible for is that the report gets read. An import
 * that says "247 imported" and nothing else has hidden the two things worth
 * knowing — what it refused, and what it took that somebody has to look at. A
 * price list with sixty materials filed as "each" is not a successful import,
 * and the moment to see that is now rather than at bid time.
 *
 * It decides nothing else. Every judgment stays in the database function where
 * it was tested, because an importer whose rules live in a screen is an
 * importer whose rules are skipped by anybody who calls the database another
 * way.
 */
import { useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, FileUp, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { recordsFromCsv } from '@/lib/csv';

/** What a row that did not make it says about itself. */
export interface ImportRejection { name: string; reason: string }
/** What a row that did make it says somebody should look at. */
export interface ImportReviewItem { name: string; unit?: string; why: string }

/**
 * A report in the shape a screen can render, whatever function produced it.
 *
 * `counts` is ordered: the first is the headline and the rest read after it, so
 * "247 imported, 12 already there, 8 categories added" and "40 priced, 3
 * machines added" come out of the same renderer.
 */
export interface ImportReport {
  counts: readonly { label: string; value: number }[];
  rejected: readonly ImportRejection[];
  needsReview: readonly ImportReviewItem[];
  /** False when the caller cannot approve, so the rows landed as drafts. */
  approved: boolean;
  /** True when something actually changed, so the table behind is re-read. */
  changed: boolean;
}

/**
 * A file as text.
 *
 * `File.text()` is the shorter call and is not everywhere — older Safari, and
 * the jsdom the component tests run in. `FileReader` is, and a file is read once
 * when somebody presses a button, so there is nothing to gain by reaching for
 * the newer name.
 */
function textOf(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(file);
  });
}

export interface ImportPanelProps {
  companyId: string | null;
  canWrite: boolean;
  /** Called after an import that changed something, so the table re-reads. */
  onImported: () => void;
  /** The columns the database function reads. Anything else is ignored. */
  reads: readonly string[];
  /** One of these must be present or the file is refused; the first is named. */
  required: readonly string[];
  /** The button that opens the file picker. */
  buttonLabel: string;
  /** The accessible name of the hidden file input. */
  fileLabel: string;
  /** What is being imported, for "Import 247 <noun>". */
  noun: string;
  /** Said beside the disabled button when the permission is missing. */
  permissionNote: string;
  /** What the import will and will not do, read before anything is written. */
  guidance: ReactNode;
  /** Hand the rows to the database. Everything it decides, it decides there. */
  run: (companyId: string, rows: Record<string, string>[]) => Promise<ImportReport>;
  /** Said when the caller could not approve, so the rows are drafts. */
  draftNote: string;
  /** Heading over the rows that did not make it. */
  rejectedHeading: (n: number) => string;
  /** What to do about them. */
  rejectedNote: ReactNode;
  /** Heading over the rows that did, and need a look. */
  reviewHeading: (n: number) => string;
  reviewNote: ReactNode;
  /** Test seam: the id of the file input. */
  inputId?: string;
}

export function ImportPanel({
  companyId, canWrite, onImported, reads, required, buttonLabel, fileLabel, noun,
  permissionNote, guidance, run, draftNote, rejectedHeading, rejectedNote,
  reviewHeading, reviewNote, inputId = 'import-file',
}: ImportPanelProps) {
  const file = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  function clear() {
    setRows(null); setName(''); setError(null); setReport(null);
    if (file.current) file.current.value = '';
  }

  async function read(f: File) {
    setError(null); setReport(null);
    let text: string;
    try {
      text = await textOf(f);
    } catch (err) {
      setRows(null); setName(f.name);
      setError(err instanceof Error ? err.message : 'That file could not be read.');
      return;
    }
    const parsed = recordsFromCsv(text);
    if (parsed.length === 0) {
      setRows(null); setName(f.name);
      setError('That file has no rows under its header.');
      return;
    }
    const columns = Object.keys(parsed[0]!);
    if (!required.some((c) => columns.includes(c))) {
      setRows(null); setName(f.name);
      setError(`That file has no "${required[0]}" column. It has: ${columns.join(', ')}.`);
      return;
    }
    setRows(parsed); setName(f.name);
  }

  async function send() {
    if (!companyId || !rows) return;
    setBusy(true); setError(null);
    try {
      const result = await run(companyId, rows);
      setReport(result);
      setRows(null);
      if (file.current) file.current.value = '';
      if (result.changed) onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be imported.');
    } finally { setBusy(false); }
  }

  const columns = rows ? Object.keys(rows[0]!) : [];
  const understood = columns.filter((c) => reads.includes(c));
  const ignored = columns.filter((c) => !reads.includes(c));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input ref={file} type="file" accept=".csv,text/csv" className="sr-only"
          id={inputId} aria-label={fileLabel}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }} />
        <Button variant="outline" size="sm" disabled={!canWrite || !companyId}
          onClick={() => file.current?.click()}>
          <FileUp className="mr-2 size-4" />
          {buttonLabel}
        </Button>
        {name ? <span className="text-sm text-charcoal-600">{name}</span> : null}
        {!canWrite ? (
          <span className="text-sm text-charcoal-500">{permissionNote}</span>
        ) : null}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {rows ? (
        <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50 p-3">
          <p className="text-sm text-charcoal-700">
            <strong>{rows.length.toLocaleString()}</strong> rows.
            {' '}Reading <span className="font-mono text-xs">{understood.join(', ')}</span>
            {ignored.length > 0 ? (
              <> — ignoring <span className="font-mono text-xs">{ignored.join(', ')}</span>.</>
            ) : '.'}
          </p>
          <p className="text-xs text-charcoal-500">{guidance}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void send()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Import {rows.length.toLocaleString()} {noun}
            </Button>
            <Button size="sm" variant="ghost" onClick={clear} disabled={busy}>
              <X className="mr-2 size-4" />Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {report ? (
        <Report report={report} onDone={clear} draftNote={draftNote}
          rejectedHeading={rejectedHeading} rejectedNote={rejectedNote}
          reviewHeading={reviewHeading} reviewNote={reviewNote} />
      ) : null}
    </div>
  );
}

function Report({
  report, onDone, draftNote, rejectedHeading, rejectedNote, reviewHeading, reviewNote,
}: {
  report: ImportReport; onDone: () => void; draftNote: string;
  rejectedHeading: (n: number) => string; rejectedNote: ReactNode;
  reviewHeading: (n: number) => string; reviewNote: ReactNode;
}) {
  const [head, ...rest] = report.counts;
  // Only shown when something in the list actually carries one.
  const showUnit = report.needsReview.some((r) => r.unit !== undefined);

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Check className="size-4 text-success-600" />
        <span className="text-sm text-charcoal-800">
          <strong>{head ? head.value.toLocaleString() : '0'}</strong>
          {head ? ` ${head.label}` : ''}
          {rest.map((c) => `, ${c.value.toLocaleString()} ${c.label}`).join('')}.
        </span>
        {!report.approved ? <Badge variant="warn">{draftNote}</Badge> : null}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onDone}>Done</Button>
      </div>

      {report.rejected.length > 0 ? (
        <section>
          <h4 className="flex items-center gap-2 text-sm font-medium text-charcoal-900">
            <X className="size-4 text-danger-600" />
            {rejectedHeading(report.rejected.length)}
          </h4>
          <p className="mb-2 text-xs text-charcoal-500">{rejectedNote}</p>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Row</TableHead><TableHead>Why</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {report.rejected.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-charcoal-600">{r.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      {report.needsReview.length > 0 ? (
        <section>
          <h4 className="flex items-center gap-2 text-sm font-medium text-charcoal-900">
            <AlertTriangle className="size-4 text-warn-600" />
            {reviewHeading(report.needsReview.length)}
          </h4>
          <p className="mb-2 text-xs text-charcoal-500">{reviewNote}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Row</TableHead>
                {showUnit ? <TableHead>Unit</TableHead> : null}
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.needsReview.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  {showUnit ? <TableCell className="text-charcoal-600">{r.unit ?? '—'}</TableCell> : null}
                  <TableCell className="text-charcoal-600">{r.why}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}
    </div>
  );
}
