/**
 * Which plan sets can be searched, and which are pictures of drawings.
 *
 * `document_sheets.extracted_text` has carried a GIN trigram index since
 * migration 0005 and a search function since 0036, and nothing wrote it until
 * 0172 — so "Search the drawings" returned nothing for every company, for every
 * term, for the life of the platform. A search that finds nothing looks exactly
 * like a job with no silt fence on it, which is why it went unnoticed.
 *
 * Going forward the text is read at upload. That is not enough on its own:
 * every set already in storage is still unread, and a set with no text layer
 * has no text at all. This says which is which, and reads the ones that can be
 * read.
 */
import { useState } from 'react';
import { FileSearch, ScanLine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { Alert } from '@/components/ui/misc';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { loadTextCoverage, readStoredPlanSet, type TextCoverage } from '@/lib/data/plans';
import { date, integer } from '@/lib/format';

function Row({ c, onRead, busy }: {
  c: TextCoverage; onRead: (c: TextCoverage) => void; busy: boolean;
}) {
  const unread = c.sheetsWithText === 0;
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-charcoal-200
                   py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-charcoal-900">{c.documentName}</p>
        <p className="mt-0.5 text-xs text-charcoal-600">
          {`${integer(c.sheetsWithText)} of ${integer(c.sheets)} sheets readable`}
          {c.lastReadAt ? ` · read ${date(c.lastReadAt)}` : ''}
          {c.lastReadBy ? ` by ${c.lastReadBy}` : ''}
        </p>
        {unread ? (
          <p className="mt-0.5 text-xs text-charcoal-500">
            Nothing in this set can be found by searching — it is a scan, so there is no text
            in the file to index. AI review still reads it, from the drawings themselves.
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {c.sheetsWithoutText === 0
          ? <Badge variant="success">searchable</Badge>
          : unread
            ? <Badge variant="danger">unread</Badge>
            : <Badge variant="warn">{integer(c.sheetsWithoutText)} without text</Badge>}
        {c.sheetsWithoutText > 0 ? (
          <Button type="button" size="sm" variant="outline" disabled={busy}
            onClick={() => onRead(c)}>
            <ScanLine className="mr-1.5 size-3.5" aria-hidden />
            {busy ? 'Reading' : 'Read the text'}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function TextCoveragePanel() {
  const coverageQ = useQuery(loadTextCoverage, []);
  const all = coverageQ.status === 'ready' ? coverageQ.data : [];
  const unreadable = all.filter((c) => c.sheetsWithoutText > 0);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const read = async (c: TextCoverage) => {
    if (!supabase || busy) return;
    setBusy(c.documentVersionId); setError(null); setDone(null);
    try {
      const out = await readStoredPlanSet(supabase, {
        documentId: c.documentId,
        bucket: c.storageBucket,
        storagePath: c.storagePath,
        fileName: c.documentName,
      });
      setDone(out.withText === 0
        ? `${c.documentName} has no text layer on any page — it is a scan. `
          + 'Searching will not find anything in it, and AI review reads it from the images instead.'
        : `${c.documentName}: ${integer(out.withText)} of ${integer(out.pages)} pages read.`);
      coverageQ.refetch();
    } catch (e) {
      setError(messageFor(e));
    } finally { setBusy(null); }
  };

  return (
    <CollapsibleCard
      id="text-coverage"
      title={<span className="flex items-center gap-2">
        <FileSearch className="size-4 text-charcoal-500" aria-hidden />
        What can be searched
      </span>}
      description="A plan set is only findable once its text has been read. Sets uploaded from now on are read as they arrive; anything already in storage is read here."
      summary={all.length === 0 ? 'nothing uploaded'
        : unreadable.length === 0 ? 'every set searchable'
          : `${unreadable.length} set${unreadable.length === 1 ? '' : 's'} not fully readable`}
      defaultOpen={false}
    >
      <div className="space-y-3">
        {coverageQ.status === 'loading' ? <LoadingState label="Checking the sets" /> : null}
        {coverageQ.status === 'error'
          ? <ErrorState message={coverageQ.message} onRetry={coverageQ.refetch} /> : null}

        {error ? <Alert tone="danger" title="That set could not be read">{error}</Alert> : null}
        {done ? <Alert tone="success">{done}</Alert> : null}

        {coverageQ.status === 'ready' && all.length === 0 ? (
          <EmptyState title="No plan set has sheets yet"
            hint="A set gets its sheets from its page count, and its text from the same pass." />
        ) : null}

        {all.length > 0 ? (
          <ul>
            {all.map((c) => (
              <Row key={c.documentVersionId} c={c} onRead={(x) => void read(x)}
                busy={busy === c.documentVersionId} />
            ))}
          </ul>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}
