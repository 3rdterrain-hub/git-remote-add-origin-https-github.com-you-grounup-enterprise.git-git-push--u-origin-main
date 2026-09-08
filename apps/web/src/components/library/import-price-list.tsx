/**
 * Bringing in a price list.
 *
 * `import_materials` has existed and been tested since migration 0127, and for
 * a long time the only way to reach it was `npm run materials:import` — a
 * command line tool that opens a Postgres connection and asks for the project's
 * database password. That is not a thing an estimator has, and it is not a thing
 * they should be asked for.
 *
 * This is the door, and it needs no password: the browser already holds a
 * session and the function is `security definer` behind `libraries.write`.
 *
 * The mechanics of reading a file and showing what came back live in
 * `ImportPanel`, which the equipment rate sheet uses too. What is here is what
 * is specific to materials: which columns the function reads, and what its
 * counts are called.
 */
import { ImportPanel, type ImportReport } from '@/components/library/import-panel';
import { importMaterials } from '@/lib/data/library';
import { supabase } from '@/lib/supabase';

/** The columns the database function reads. Anything else in the file is ignored. */
const READS = ['name', 'category', 'unit', 'unit_cost', 'density', 'waste_pct'] as const;

export interface ImportPriceListProps {
  companyId: string | null;
  canWrite: boolean;
  /** Called after an import that changed something, so the table re-reads. */
  onImported: () => void;
}

export function ImportPriceList({ companyId, canWrite, onImported }: ImportPriceListProps) {
  return (
    <ImportPanel
      companyId={companyId}
      canWrite={canWrite}
      onImported={onImported}
      reads={READS}
      required={['name']}
      inputId="price-list-file"
      buttonLabel="Bring in a price list"
      fileLabel="Price list CSV"
      noun="materials"
      permissionNote="Importing a price list needs the library-write permission."
      guidance={
        <>
          A material already in your library by name is left alone rather than repriced,
          so importing the same file twice changes nothing. A unit that would need
          arithmetic to fit — a thousand board feet, say — is refused by name rather
          than converted, because converting it would change the price.
        </>
      }
      draftNote="Saved as drafts — approving a library change is somebody else's permission"
      rejectedHeading={(n) => `${n} not imported`}
      rejectedNote="Restate these in the spreadsheet and import it again. Nothing else has to change."
      reviewHeading={(n) => `${n} imported, and worth a look`}
      reviewNote="These are in your library. Each one prices an estimate the way it stands."
      run={async (company, rows): Promise<ImportReport> => {
        if (!supabase) throw new Error('Not connected.');
        const r = await importMaterials(supabase, company, rows);
        return {
          counts: [
            { label: 'imported', value: r.imported },
            { label: 'already there', value: r.alreadyThere },
            { label: 'categories added', value: r.categoriesAdded },
          ],
          rejected: r.rejected,
          needsReview: r.needsReview,
          approved: r.approved,
          changed: r.imported > 0 || r.categoriesAdded > 0,
        };
      }}
    />
  );
}
