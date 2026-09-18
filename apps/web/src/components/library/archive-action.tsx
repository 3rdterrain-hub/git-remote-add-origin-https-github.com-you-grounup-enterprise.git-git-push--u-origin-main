/**
 * Putting a library row away, and getting it back. WORKFLOW.
 *
 * The owner archived a crew, believed it was deleted, and it was still there
 * with both its members — because `retireCrew` had always archived rather than
 * destroyed. The schema was right and the product was wrong: nothing said the
 * row still existed, archived rows vanished from the list, and there was no way
 * back. A delete you cannot undo and a delete you *believe* you cannot undo
 * cost the same in the moment.
 *
 * So this is deliberately unexciting: one control, the same on every library,
 * that says what it does before it does it and offers the way back afterwards.
 *
 * A shipped GrounUp row has no control at all. It belongs to every company on
 * the platform and archiving it for one would hide it from all — the database
 * refuses it, and a button that exists only to be refused is worse than none.
 */
import { useState } from 'react';
import { Archive, ArchiveRestore, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { messageFor } from '@/lib/data/query';
import { setLibraryStatus, hideLibraryRow, type ArchivableKind } from '@/lib/data/library';

export function ArchiveAction({
  kind, id, name, status, editable, canWrite, onChanged, companyId, hidden = false,
}: {
  kind: ArchivableKind;
  id: string;
  name: string;
  status: string;
  /** Company-owned. A shipped row is archived for nobody — it is hidden. */
  editable: boolean;
  canWrite: boolean;
  onChanged: () => void;
  /** Needed to hide a shipped row, which is recorded per company. */
  companyId?: string | null;
  /** Whether this company has already put this shipped row away. */
  hidden?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Two mechanisms, one promise. A row this company owns is archived; a row
   * GrounUp ships is hidden from this company's library and left untouched for
   * everybody else. Both are reversible and neither destroys anything, which is
   * what the button says either way.
   *
   * The distinction matters more than it looks: on a real company's library,
   * 333 of 333 materials and 2,143 of 2,190 production rates are shipped, so a
   * control that only archived would have rendered on almost nothing.
   */
  const archived = editable ? status === 'archived' : hidden;
  const putAway = () => (editable
    ? setLibraryStatus(kind, id, 'archived')
    : hideLibraryRow(companyId!, kind, id, true));
  const bringBack = () => (editable
    ? setLibraryStatus(kind, id, 'active')
    : hideLibraryRow(companyId!, kind, id, false));

  /* A shipped row needs a company to record the decision against. */
  if (!editable && !companyId) return null;

  const run = (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    fn()
      .then(() => { setAsking(false); onChanged(); })
      .catch((e: unknown) => setError(messageFor(e)))
      .finally(() => setBusy(false));
  };

  if (archived) {
    return (
      <span className="flex items-center gap-1">
        <Button size="sm" variant="outline" disabled={!canWrite || busy}
          title={`Bring ${name} back into the library`}
          onClick={() => run(bringBack)}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArchiveRestore className="size-4" />}
          Restore
        </Button>
        {error ? <span className="text-xs text-danger-700">{error}</span> : null}
      </span>
    );
  }

  if (asking) {
    /*
     * Asking first, and saying what will happen. The word "archive" on its own
     * did not stop somebody losing a crew — "kept, not deleted" is the part
     * that was missing.
     */
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-charcoal-600">
          {editable
            ? `Archive ${name}? It is kept, not deleted.`
            : `Hide ${name} from your library? It stays as it is for everybody else.`}
        </span>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(putAway)}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {editable ? 'Archive it' : 'Hide it'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
        {error ? <span className="text-xs text-danger-700">{error}</span> : null}
      </span>
    );
  }

  return (
    <Button size="sm" variant="ghost" disabled={!canWrite || busy}
      aria-label={editable ? `Archive ${name}` : `Hide ${name}`}
      title={editable
        ? 'Archive it. Nothing is deleted — you can bring it back.'
        : 'Hide it from your library. The shipped row is untouched for everybody else, and you can bring it back.'}
      onClick={() => setAsking(true)}>
      <Archive className="size-4" />
    </Button>
  );
}
