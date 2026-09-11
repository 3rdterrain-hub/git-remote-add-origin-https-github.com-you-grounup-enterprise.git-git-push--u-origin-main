/**
 * Entity — searching what the drawings say.
 *
 * `document_sheets.extracted_text` has carried a trigram index and a comment
 * saying it is "used for permission-filtered search across the plan set" since
 * migration 0036. That migration also wrote `app.search_document_text` to
 * fulfill it, noting in its own header that "nothing queried it" — and then
 * nothing queried the fix, for eleven migrations, because it had no `public.`
 * wrapper and so no browser could see it.
 *
 * The global search bar is not this. It matches a sheet on its number and its
 * title, which is how you jump to a record you already know exists. This
 * answers the other question — *which sheet mentions the cathodic protection* —
 * and it needs snippets and page numbers, because the answer is something you
 * read rather than click through.
 *
 * Two decisions worth stating:
 *
 *   * **It searches on submit, not on every keystroke.** A trigram scan across
 *     every sheet of every plan set is not a keystroke-cost operation, and a
 *     dropdown firing one per letter is how a search feature becomes the
 *     slowest thing on a page.
 *   * **Nothing is shown until something is asked.** The function refuses a
 *     blank term, and the panel says what to type rather than listing the whole
 *     plan set.
 */
import { useState } from 'react';
import { Loader2, ScanSearch } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { EmptyState } from '@/components/data-state';
import { messageFor } from '@/lib/data/query';
import { searchSheetText, type SheetTextHit } from '@/lib/data/plans';
import { plural } from '@/lib/format';

export function SearchTheDrawings() {
  const [term, setTerm] = useState('');
  const [asked, setAsked] = useState('');
  const [hits, setHits] = useState<SheetTextHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const q = term.trim();
    if (q.length < 2) return;
    setBusy(true); setError(null);
    try {
      setHits(await searchSheetText(q));
      setAsked(q);
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScanSearch className="size-4 text-charcoal-500" />
          Search inside the drawings
        </CardTitle>
        <CardDescription>
          The search box at the top of the screen matches a sheet by its number and its title.
          This reads what the sheets actually say. A drawing whose title block says C-210 and
          whose body says &ldquo;cathodic protection&rdquo; is findable by both.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <form className="flex flex-wrap gap-2"
          onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <Input className="min-w-0 flex-1" value={term}
            aria-label="Search the text of every sheet"
            placeholder="cathodic protection, 12 inch RCP, dewatering…"
            onChange={(e) => setTerm(e.target.value)} />
          {/* Named apart from the global search bar, which is also "Search". */}
          <Button type="submit" aria-label="Search the drawings"
            disabled={busy || term.trim().length < 2}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
            Search
          </Button>
        </form>

        {error ? <Alert tone="danger">{error}</Alert> : null}

        {hits === null ? (
          <p className="text-xs leading-relaxed text-charcoal-500">
            Type at least two characters. Only sheets whose text has been extracted are searched,
            and a superseded document is left out — it is kept for the audit trail rather than for
            reference.
          </p>
        ) : hits.length === 0 ? (
          <EmptyState title={`Nothing in the drawings says “${asked}”`}
            hint="A sheet becomes searchable once its text has been extracted. A plan set still in the ingestion pipeline has none yet." />
        ) : (
          <>
            <p className="text-xs text-charcoal-500">
              {plural(hits.length, 'sheet')} mention &ldquo;{asked}&rdquo;.
            </p>
            <ul className="divide-y divide-charcoal-200 rounded-md border border-charcoal-200">
              {hits.map((hit) => (
                <li key={`${hit.documentId}-${hit.pageNumber}`} className="space-y-1 p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Badge variant="info">{hit.sheetNumber ?? `p. ${hit.pageNumber}`}</Badge>
                    <span className="text-sm font-medium text-charcoal-900">
                      {hit.documentName}
                    </span>
                    <span className="text-xs text-charcoal-500">
                      rev {hit.versionNumber} · page {hit.pageNumber}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-charcoal-700">{hit.snippet}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
