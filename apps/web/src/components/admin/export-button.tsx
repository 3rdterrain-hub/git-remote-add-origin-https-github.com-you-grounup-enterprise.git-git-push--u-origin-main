import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toCsv, downloadCsv, csvFilename, type CsvColumn } from '@/lib/csv';
import { recordExport } from '@/lib/data/admin';
import { supabase } from '@/lib/supabase';

/**
 * Take a table out as a file.
 *
 * The export is recorded before the file is assembled, and the download happens
 * whether or not the recording succeeded — refusing to export because an audit
 * row failed would be choosing the ledger over the person doing their job, and
 * the failure is logged where somebody can see it.
 *
 * What it deliberately does not do is fetch anything. It exports the rows the
 * screen already has, which are the rows the reader was already permitted to
 * see; a button that widened a query to "everything" would be a quiet
 * escalation dressed as a convenience.
 */
export function ExportButton<T>({ what, rows, columns, disabled }: {
  what: string;
  rows: T[];
  columns: CsvColumn<T>[];
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      if (supabase) {
        await recordExport(supabase, what, rows.length).catch((err) => {
          console.error('[export] could not record the export', err);
        });
      }
      downloadCsv(csvFilename(what), toCsv(rows, columns));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" disabled={disabled || busy || rows.length === 0}
      onClick={run} title={`Export ${rows.length} rows. Recorded in the ledger.`}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
      Export
    </Button>
  );
}
