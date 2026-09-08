/**
 * A rate sheet from your dealer.
 *
 * The platform ships 458 machines with a published hourly rate on each, and
 * that rate is deliberately the weakest thing in RULE-003's hierarchy: it is a
 * national figure for owning and operating a machine, and it is nobody's actual
 * cost. The rate that should win is the one on the sheet a dealer sent you.
 *
 * Until now there was no way to get that in. Equipment rates were seed-only —
 * they arrived when the catalog was built and could be added to afterwards only
 * one row at a time. A company with a four-hundred-line rental sheet had four
 * hundred afternoons of typing ahead of them, which in practice means the sheet
 * stays in the inbox and every estimate keeps pricing at the national number.
 *
 * The file reading and the report live in `ImportPanel`, shared with the
 * materials price list. What is here is what a rate sheet specifically has to
 * say for itself.
 */
import { ImportPanel, type ImportReport } from '@/components/library/import-panel';
import { importEquipmentRates } from '@/lib/data/library';
import { supabase } from '@/lib/supabase';

/** The columns the database function reads. Anything else in the file is ignored. */
const READS = [
  'equipment', 'name', 'code', 'equipment_class', 'hourly_rate',
  'daily_rate', 'weekly_rate', 'monthly_rate', 'region', 'reference', 'effective_date',
] as const;

export interface ImportRateSheetProps {
  companyId: string | null;
  canWrite: boolean;
  onImported: () => void;
}

export function ImportRateSheet({ companyId, canWrite, onImported }: ImportRateSheetProps) {
  return (
    <ImportPanel
      companyId={companyId}
      canWrite={canWrite}
      onImported={onImported}
      reads={READS}
      required={['equipment', 'name', 'code']}
      inputId="rate-sheet-file"
      buttonLabel="Bring in a rate sheet"
      fileLabel="Rate sheet CSV"
      noun="rates"
      permissionNote="Importing a rate sheet needs the library-write permission."
      guidance={
        <>
          Your rate beats the published one on every estimate priced from now on, and
          changes nothing already issued. A line with no hourly rate is refused rather
          than divided out of the daily one — a rental day is a calendar day rather than
          eight hours of work, and dividing it would put an assumption nobody stated
          under every estimate that used the machine. Loading the same sheet twice
          replaces the rates rather than adding a second set.
        </>
      }
      draftNote="Held pending — approving a library change is somebody else's permission"
      rejectedHeading={(n) => `${n} not imported`}
      rejectedNote="Restate these in the spreadsheet and import it again. Nothing else has to change."
      reviewHeading={(n) => `${n} imported, and worth a look`}
      reviewNote={
        <>
          These are priced and usable. A rate sheet says what a machine costs and not
          what it burns or who runs it, so anything new needs those two before a line
          using it is complete.
        </>
      }
      run={async (company, rows): Promise<ImportReport> => {
        if (!supabase) throw new Error('Not connected.');
        const r = await importEquipmentRates(supabase, company, rows);
        return {
          counts: [
            { label: 'priced', value: r.priced },
            { label: 'machines added', value: r.machinesCreated },
          ],
          rejected: r.rejected,
          needsReview: r.needsReview,
          approved: r.approved,
          changed: r.priced > 0 || r.machinesCreated > 0,
        };
      }}
    />
  );
}
