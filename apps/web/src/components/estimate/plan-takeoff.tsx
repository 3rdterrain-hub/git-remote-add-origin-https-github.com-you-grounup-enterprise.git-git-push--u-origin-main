/**
 * Hand it the plans, get quantities back.
 *
 * The loop, in the place an estimator is already working: upload the plan set,
 * ask the model to read it, and accept or set aside each thing it found.
 *
 * The middle step is the one nobody skips. Every finding arrives `proposed` and
 * becomes an estimate line only when a person says so — RULE-008 — and the
 * screen is built to make that decision possible rather than fast. What the
 * model cited is shown beside what it claims, because a quantity you cannot
 * trace to a sheet is a quantity you should not bid; how it got the number is
 * shown too, since a dimensioned run and a scaled one are different claims
 * wearing the same figure.
 *
 * The model's confidence is labeled as the model's. It never becomes the line's
 * — that is the engine's to compute — and a screen that blurred the two would
 * make every AI line look verified.
 */
import { useRef, useState } from 'react';
import {
  Check, FileUp, Loader2, ScanSearch, Sparkles, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  loadPlanDocuments, loadFindings, uploadPlanSet, analyzeDocument,
  acceptFinding, rejectFinding, type Finding,
} from '@/lib/data/plans';
import { qty, date } from '@/lib/format';
import { cn } from '@/lib/utils';

/** What each method claims, in the words an estimator would use. */
const METHOD_LABEL: Record<string, string> = {
  dimensioned: 'Dimensioned on the sheet',
  scaled: 'Scaled off the drawing',
  calculated: 'Calculated from dimensions',
  derived: 'Derived from other quantities',
  schedule_quantity: 'From a drawing schedule',
  owner_quantity: 'Owner or engineer quantity',
  estimator_allowance: 'An allowance, not a measurement',
};

const METHOD_TONE: Record<string, 'success' | 'info' | 'warn'> = {
  dimensioned: 'success',
  schedule_quantity: 'success',
  owner_quantity: 'info',
  calculated: 'info',
  derived: 'info',
  scaled: 'warn',
  estimator_allowance: 'warn',
};

export function PlanTakeoffPanel({ versionId, estimateId, companyId, editable, onChanged }: {
  versionId: string;
  estimateId: string;
  companyId: string | null;
  editable: boolean;
  onChanged: () => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const documents = useQuery(loadPlanDocuments, [refresh]);
  const findings = useQuery(
    chosen ? loadFindings(chosen) : async () => [], [chosen, refresh]);

  const docs = documents.status === 'ready' ? documents.data : [];
  const list = findings.status === 'ready' ? findings.data : [];
  const proposed = list.filter((f) => f.state === 'proposed');

  const upload = async (f: File) => {
    if (!supabase || !companyId) {
      setError('Open a company before uploading a plan set.');
      return;
    }
    setBusy('upload'); setError(null); setNotice(null);
    try {
      const versionRowId = await uploadPlanSet(supabase, {
        companyId, file: f, estimateId,
      });
      setRefresh((n) => n + 1);
      setChosen(versionRowId);
      setNotice({ tone: 'ok', text: `${f.name} is filed. Read it when you are ready.` });
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(null);
      if (file.current) file.current.value = '';
    }
  };

  const analyze = async (documentVersionId: string) => {
    if (!companyId) return;
    setBusy(documentVersionId); setError(null); setNotice(null);
    const outcome = await analyzeDocument(companyId, documentVersionId);
    setBusy(null);
    setRefresh((n) => n + 1);
    setChosen(documentVersionId);
    setNotice({
      tone: outcome.status === 'read' ? 'ok' : outcome.status === 'refused' ? 'warn' : 'bad',
      text: outcome.status === 'read'
        ? `${outcome.findings} to review`
          + (outcome.rejected > 0
            ? `, and ${outcome.rejected} the platform threw out for citing nothing.`
            : '. Nothing is on the estimate until you put it there.')
        : outcome.message,
    });
  };

  const accept = async (f: Finding) => {
    if (!supabase) return;
    setBusy(f.id); setError(null);
    try {
      await acceptFinding(supabase, f.id, versionId);
      setRefresh((n) => n + 1);
      onChanged();
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(null); }
  };

  const reject = async (f: Finding) => {
    if (!supabase || reason.trim().length < 4) return;
    setBusy(f.id); setError(null);
    try {
      await rejectFinding(supabase, f.id, reason);
      setRejecting(null); setReason('');
      setRefresh((n) => n + 1);
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(null); }
  };

  return (
    <CollapsibleCard
      title={<span className="flex items-center gap-2">
        <Sparkles className="size-4 text-charcoal-500" /> Quantities from the plans
      </span>}
      description="Upload the bid set and AI reads it for scope, quantities and conflicts between sheets. Nothing it finds reaches this estimate until you accept it, and it never computes a cost — every price here is the engine's."
      summary={docs.length === 0
        ? 'nothing uploaded'
        : `${docs.length} document${docs.length === 1 ? '' : 's'}`
          + (docs.reduce((a, d) => a + d.awaitingReview, 0) > 0
            ? ` · ${docs.reduce((a, d) => a + d.awaitingReview, 0)} to review` : '')}
      defaultOpen={false}
    >
      <div className="space-y-4">
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <input ref={file} type="file" className="hidden"
              accept="application/pdf,image/png,image/jpeg"
              aria-label="Plan set to upload"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
            <Button size="sm" variant="outline" disabled={busy != null}
              onClick={() => file.current?.click()}>
              {busy === 'upload' ? <Loader2 className="size-4 animate-spin" />
                : <FileUp className="size-4" />}
              Upload a plan set
            </Button>
            <span className="text-xs text-charcoal-500">
              PDF or an image of a sheet. It is stored against this company only.
            </span>
          </div>
        ) : null}

        {error ? <ErrorState message={error} /> : null}
        {notice ? (
          <Alert tone={notice.tone === 'ok' ? 'success' : notice.tone === 'warn' ? 'warn' : 'danger'}
            title={notice.tone === 'ok' ? 'Read' : notice.tone === 'warn' ? 'Not available' : 'That did not happen'}>
            {notice.text}
          </Alert>
        ) : null}

        {documents.status === 'loading' ? <LoadingState label="Reading your documents" /> : null}
        {documents.status === 'error'
          ? <ErrorState message={documents.message} onRetry={documents.refetch} /> : null}

        {documents.status === 'ready' && docs.length === 0 ? (
          <EmptyState title="No plans uploaded yet"
            hint="Upload the bid set and AI will read it for scope, quantities and anything the sheets disagree about." />
        ) : null}

        {docs.length > 0 ? (
          <div className="divide-y divide-charcoal-100 rounded-lg border border-charcoal-200">
            {docs.map((d) => (
              <div key={d.id}
                className={cn('flex flex-wrap items-center justify-between gap-3 p-3',
                  chosen === d.currentVersionId && 'bg-yellow-50')}>
                <button type="button" className="min-w-0 flex-1 text-left"
                  onClick={() => setChosen(
                    chosen === d.currentVersionId ? null : d.currentVersionId)}>
                  <p className="truncate text-sm font-medium text-charcoal-900">{d.name}</p>
                  <p className="truncate text-xs text-charcoal-500">
                    {d.fileName} · uploaded {date(d.createdAt)}
                    {d.findingCount > 0
                      ? ` · ${d.findingCount} found, ${d.awaitingReview} to review`
                      : ' · not read yet'}
                  </p>
                </button>
                {editable ? (
                  <Button size="sm" variant="outline" disabled={busy != null}
                    onClick={() => analyze(d.currentVersionId)}>
                    {busy === d.currentVersionId ? <Loader2 className="size-4 animate-spin" />
                      : <ScanSearch className="size-4" />}
                    {d.findingCount > 0 ? 'Read again' : 'Read it'}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {chosen && findings.status === 'ready' ? (
          list.length === 0 ? (
            <p className="text-sm text-charcoal-500">
              Nothing has been found in this document yet.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-charcoal-500">
                {proposed.length} waiting on you, {list.length - proposed.length} already decided.
                Accepting one puts a line on this estimate at zero cost; the engine prices it.
              </p>

              {list.map((f) => (
                <div key={f.id}
                  className={cn('rounded-lg border p-3',
                    f.state === 'proposed' ? 'border-charcoal-200' : 'border-charcoal-100 bg-charcoal-50/60')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-charcoal-900">
                        {f.title}
                        {f.quantity != null ? (
                          <span className="tabular text-charcoal-700">
                            {qty(f.quantity)} {f.unit}
                          </span>
                        ) : null}
                        {f.method ? (
                          <Badge variant={METHOD_TONE[f.method] ?? 'default'}>
                            {METHOD_LABEL[f.method] ?? f.method}
                          </Badge>
                        ) : null}
                        {f.state !== 'proposed' ? (
                          <Badge variant={f.state === 'accepted' ? 'success' : 'default'}>
                            {f.state}
                          </Badge>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-xs text-charcoal-600">{f.description}</p>

                      {/*
                        * What it cited, beside what it claims. A quantity you
                        * cannot trace to a sheet is one you should not bid, and
                        * the platform refuses to store a factual finding
                        * without this — so it is always here to show.
                        */}
                      {f.citations.length > 0 || f.sheetReferences.length > 0 ? (
                        <p className="mt-1 text-xs text-charcoal-500">
                          {f.sheetReferences.length > 0
                            ? `Sheets ${f.sheetReferences.join(', ')}` : ''}
                          {f.specificationReferences.length > 0
                            ? ` · Spec ${f.specificationReferences.join(', ')}` : ''}
                          {f.citations[0]?.quote ? ` — "${f.citations[0].quote}"` : ''}
                        </p>
                      ) : null}

                      <p className="mt-1 text-xs text-charcoal-400">
                        {f.model ?? 'the model'} scored itself {Math.round(f.confidence)}%. That is
                        the model's own view and never becomes the line's confidence — the engine
                        computes that from the rate and its sources.
                      </p>

                      {f.reviewNote ? (
                        <p className="mt-1 text-xs text-charcoal-500">Note: {f.reviewNote}</p>
                      ) : null}
                    </div>

                    {editable && f.state === 'proposed' ? (
                      <div className="flex shrink-0 items-center gap-1.5">
                        {f.findingType === 'quantity_candidate' && f.quantity != null ? (
                          <Button size="sm" disabled={busy != null} onClick={() => accept(f)}>
                            {busy === f.id ? <Loader2 className="size-4 animate-spin" />
                              : <Check className="size-4" />}
                            Add as a line
                          </Button>
                        ) : null}
                        <Button size="sm" variant="outline" disabled={busy != null}
                          onClick={() => { setRejecting(rejecting === f.id ? null : f.id); setReason(''); }}>
                          <X className="size-4" /> Set aside
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {rejecting === f.id ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Input value={reason} className="h-8 flex-1"
                        aria-label={`Why ${f.title} was not used`}
                        placeholder="Already in the sitework allowance"
                        onChange={(e) => setReason(e.target.value)} />
                      <Button size="sm" variant="outline"
                        disabled={busy != null || reason.trim().length < 4}
                        onClick={() => reject(f)}>
                        Set aside
                      </Button>
                      <span className="text-xs text-charcoal-500">
                        The next person reading these plans deserves to know what was ruled out.
                      </span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )
        ) : null}
      </div>
    </CollapsibleCard>
  );
}
