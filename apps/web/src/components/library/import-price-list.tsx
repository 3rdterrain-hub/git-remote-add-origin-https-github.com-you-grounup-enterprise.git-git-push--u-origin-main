/**
 * Bringing in a price list.
 *
 * `import_materials` has existed and been tested since migration 0127, and
 * until now the only way to reach it was `npm run materials:import` — a command
 * line tool that opens a Postgres connection and asks for the project's
 * database password. That is not a thing an estimator has, and it is not a
 * thing they should be asked for. A working feature with no door.
 *
 * The door is here, and it needs no password: the browser already holds a
 * session, the function is `security definer` behind `libraries.write`, and
 * every decision it makes stays in the database where it was tested. This
 * screen reads the file and shows what came back. It decides nothing.
 *
 * What it does insist on is that the report gets read. An import that says
 * "247 imported" and nothing else has hidden the two things worth knowing:
 * what it refused, and what it took that somebody needs to look at. A price
 * list with sixty materials filed as "each" is not a successful import, and the
 * moment to see that is now rather than at bid time.
 */
import { useRef, useState } from 'react';
import { AlertTriangle, Check, FileUp, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { recordsFromCsv } from '@/lib/csv';
import { importMaterials, type MaterialImportReport } from '@/lib/data/library';
import { supabase } from '@/lib/supabase';

/**
 * A file as text.
 *
 * `File.text()` is the shorter call and is not everywhere — older Safari, and
 * the jsdom the component tests run in. `FileReader` is, and a price list is
 * read once when somebody presses a button, so there is nothing to gain by
 * reaching for the newer name.
 */
function textOf(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(file);
  });
}

/** The columns the database function reads. Anything else in the file is ignored. */
const READS = ['name', 'category', 'unit', 'unit_cost', 'density', 'waste_pct'] as const;

export interface ImportPriceListProps {
  companyId: string | null;
  canWrite: boolean;
  /** Called after an import that changed something, so the table re-reads. */
  onImported: () => void;
}

export function ImportPriceList({ companyId, canWrite, onImported }: ImportPriceListProps) {
  const file = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<MaterialImportReport | null>(null);

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
    if (!Object.keys(parsed[0]!).includes('name')) {
      setRows(null); setName(f.name);
      setError(`That file has no "name" column. It has: ${Object.keys(parsed[0]!).join(', ')}.`);
      return;
    }
    setRows(parsed); setName(f.name);
  }

  async function send() {
    if (!supabase || !companyId || !rows) return;
    setBusy(true); setError(null);
    try {
      const result = await importMaterials(supabase, companyId, rows);
      setReport(result);
      setRows(null);
      if (file.current) file.current.value = '';
      if (result.imported > 0 || result.categoriesAdded > 0) onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That price list could not be imported.');
    } finally { setBusy(false); }
  }

  const columns = rows ? Object.keys(rows[0]!) : [];
  const understood = columns.filter((c) => (READS as readonly string[]).includes(c));
  const ignored = columns.filter((c) => !(READS as readonly string[]).includes(c));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input ref={file} type="file" accept=".csv,text/csv" className="sr-only"
          id="price-list-file" aria-label="Price list CSV"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }} />
        <Button variant="outline" size="sm" disabled={!canWrite || !companyId}
          onClick={() => file.current?.click()}>
          <FileUp className="mr-2 size-4" />
          Bring in a price list
        </Button>
        {name ? <span className="text-sm text-charcoal-600">{name}</span> : null}
        {!canWrite ? (
          <span className="text-sm text-charcoal-500">
            Importing a price list needs the library-write permission.
          </span>
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
          <p className="text-xs text-charcoal-500">
            A material already in your library by name is left alone rather than repriced,
            so importing the same file twice changes nothing. A unit that would need
            arithmetic to fit — a thousand board feet, say — is refused by name rather
            than converted, because converting it would change the price.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void send()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Import {rows.length.toLocaleString()} materials
            </Button>
            <Button size="sm" variant="ghost" onClick={clear} disabled={busy}>
              <X className="mr-2 size-4" />Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {report ? <ImportReport report={report} onDone={clear} /> : null}
    </div>
  );
}

function ImportReport({ report, onDone }: {
  report: MaterialImportReport; onDone: () => void;
}) {
  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Check className="size-4 text-success-600" />
        <span className="text-sm text-charcoal-800">
          <strong>{report.imported.toLocaleString()}</strong> imported,
          {' '}{report.alreadyThere.toLocaleString()} already there,
          {' '}{report.categoriesAdded.toLocaleString()} categories added.
        </span>
        {!report.approved ? (
          <Badge variant="warn">
            Saved as drafts — approving a library change is somebody else&apos;s permission
          </Badge>
        ) : null}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onDone}>Done</Button>
      </div>

      {report.rejected.length > 0 ? (
        <section>
          <h4 className="flex items-center gap-2 text-sm font-medium text-charcoal-900">
            <X className="size-4 text-danger-600" />
            {report.rejected.length} not imported
          </h4>
          <p className="mb-2 text-xs text-charcoal-500">
            Restate these in the spreadsheet and import it again. Nothing else has to change.
          </p>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Material</TableHead><TableHead>Why</TableHead></TableRow>
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
            {report.needsReview.length} imported, and worth a look
          </h4>
          <p className="mb-2 text-xs text-charcoal-500">
            These are in your library. Each one prices an estimate the way it stands.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead><TableHead>Unit</TableHead><TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.needsReview.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-charcoal-600">{r.unit}</TableCell>
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
