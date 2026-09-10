/**
 * Plans & Specs, on the company's own documents.
 *
 * Everything behind this screen was built and none of it had a door here.
 * `documents`, `document_versions` and `document_sheets` since migration 0005;
 * `ai_findings` with its citation constraint and its acceptance trigger since
 * 0008; `ingestion_jobs` since 0019; `my_documents`, `my_ai_findings`,
 * `accept_finding_as_line` and `reject_finding` since 0119; and an
 * `ai-analyze-document` Edge Function to drive it. The data layer that reads
 * all of it has existed since the takeoff panel was written.
 *
 * This page rendered `AI_FINDINGS`, `DOCUMENTS` and `INGESTION_JOBS` out of
 * `src/data`. So the one screen in the application named for the subsystem was
 * the one place it could not be reached: the whole of it was available from
 * inside an estimate line's takeoff panel and nowhere else, and every signed-in
 * customer saw the same five sample findings about somebody else's parking lot.
 *
 * Two rules are the point of the screen and are visible on it rather than
 * implied:
 *
 *   * **RULE-008 — AI proposes, humans accept.** Nothing here reaches an
 *     estimate until a person with `ai.accept_findings` puts it there, and the
 *     acceptance is recorded against that person. The database enforces it too:
 *     a finding cannot be born accepted.
 *   * **A factual claim cites the sheet it came from.** The citation is shown
 *     on the finding, not hidden behind a hover, because a quantity whose
 *     source nobody can check is a quantity nobody should price.
 */
import { useMemo, useState } from 'react';
import {
  FileText, FileUp, Bot, Layers, ShieldCheck, Search, Loader2, Check, X, Cpu,
  RefreshCw, CircleDollarSign, AlertTriangle,
} from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, EmptyState, Progress, Separator } from '@/components/ui/misc';
import { LoadingState, ErrorState, DemonstrationNotice } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  loadPlanDocuments, loadAllFindings, loadIngestionJobs,
  uploadPlanSet, countPdfPages, analyzeDocument, acceptFinding, rejectFinding,
  type Finding, type IngestionJob, type PlanDocument,
} from '@/lib/data/plans';
import { loadEstimates } from '@/lib/data/estimates';
import { usePermissions, useCompanyId } from '@/lib/data/session';
import { date, dateTime, integer, titleCase, money, percent, qty, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The pipeline, in the order `ingestion_jobs.stage` runs it. */
const STAGES = [
  ['queued', 'Queued', 'Accepted and waiting for a worker.'],
  ['virus_scan', 'Virus scan', 'Nothing is opened before it is scanned.'],
  ['splitting', 'Splitting', 'One row per sheet, so a finding can name one.'],
  ['ocr', 'OCR', 'Scanned sheets become text that can be searched and cited.'],
  ['classifying', 'Classifying', 'Which discipline each sheet belongs to.'],
  ['extracting', 'Extracting', 'Scope, quantities and conflicts, each with its citation.'],
  ['indexing', 'Indexing', 'Searchable, and filtered by what the reader may see.'],
] as const;

const STAGE_ORDER = STAGES.map((s) => s[0]) as readonly string[];

const SEVERITY: Record<string, 'default' | 'warn' | 'danger'> = {
  low: 'default', moderate: 'warn', high: 'danger', critical: 'danger',
};

export function PlansPage() {
  const { companyId } = useCompanyId();
  const docsQ = useQuery(loadPlanDocuments, []);
  const findingsQ = useQuery(loadAllFindings, []);
  const jobsQ = useQuery(loadIngestionJobs, []);
  const estimatesQ = useQuery(loadEstimates, []);

  const { can } = usePermissions();
  const canAccept = can('ai.accept_findings');
  const canUpload = can('documents.write');

  const [tab, setTab] = useState('findings');
  const [state, setState] = useState<'all' | 'proposed' | 'accepted'>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const documents = docsQ.status === 'ready' ? docsQ.data : [];
  const findings = findingsQ.status === 'ready' ? findingsQ.data : [];
  const jobs = jobsQ.status === 'ready' ? jobsQ.data : [];
  const estimates = estimatesQ.status === 'ready' ? estimatesQ.data : [];
  const demo = docsQ.status === 'demonstration';

  const pending = findings.filter((f) => f.state === 'proposed');
  const accepted = findings.filter((f) => f.state === 'accepted');
  const sheets = documents.reduce((a, d) => a + (d.pageCount ?? 0), 0);

  const visible = useMemo(() => findings
    .filter((f) => state === 'all' || f.state === state)
    .filter((f) => !query
      || `${f.title} ${f.description} ${f.sheetReferences.join(' ')} ${f.specificationReferences.join(' ')} ${f.documentName ?? ''}`
        .toLowerCase().includes(query.toLowerCase())),
  [findings, state, query]);

  const refresh = () => { findingsQ.refetch(); docsQ.refetch(); jobsQ.refetch(); };

  const showFindings = (next: 'proposed' | 'accepted') => {
    setTab('findings');
    setState((current) => (current === next ? 'all' : next));
  };

  async function onUpload(file: File) {
    if (!supabase || !companyId) return;
    setBusy('upload'); setError(null); setNotice(null);
    try {
      const pages = await countPdfPages(file);
      await uploadPlanSet(supabase, { companyId, file, documentType: 'plan_set' });
      setNotice(pages
        ? `${file.name} is filed, ${plural(pages, 'sheet')} of it. Read it to get findings.`
        : `${file.name} is filed. Read it to get findings.`);
      refresh();
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(null); }
  }

  async function onAnalyze(d: PlanDocument) {
    if (!companyId) return;
    setBusy(d.id); setError(null); setNotice(null);
    const outcome = await analyzeDocument(companyId, d.currentVersionId);
    if (outcome.status === 'read') {
      setNotice(outcome.rejected > 0
        ? `${outcome.message} ${plural(outcome.rejected, 'claim')} arrived without a citation and ${outcome.rejected === 1 ? 'was' : 'were'} refused before being stored.`
        : outcome.message);
      refresh();
    } else {
      setError(outcome.message);
    }
    setBusy(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plans & Specs"
        description="Upload the document set, let the agents read it, then approve what enters the estimate. Every AI claim cites the sheet or specification section it came from."
        actions={
          <UploadButton disabled={!canUpload || !companyId || busy === 'upload'}
            busy={busy === 'upload'} onFile={onUpload} />
        }
      />

      {demo ? <DemonstrationNotice what="this page" /> : null}
      {docsQ.status === 'loading' ? <LoadingState label="Reading your documents" /> : null}
      {docsQ.status === 'error'
        ? <ErrorState message={docsQ.message} onRetry={docsQ.refetch} /> : null}
      {error ? <Alert tone="danger" icon={<AlertTriangle className="size-4" />}>{error}</Alert> : null}
      {notice ? <Alert tone="success" icon={<Check className="size-4" />}>{notice}</Alert> : null}

      {!canUpload ? (
        <Alert tone="neutral" icon={<ShieldCheck className="size-4" />}
          title="You can read the document set but not add to it">
          Uploading a plan set needs <code className="font-mono text-[12px]">documents.write</code>.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Active documents" value={documents.length} icon={<FileText className="size-4" />}
          hint={documents.length
            ? `${documents.filter((d) => d.processingState === 'indexed').length} indexed`
            : 'nothing uploaded yet'}
          onClick={() => setTab('documents')} active={tab === 'documents'}
          actionLabel="Open the document register" />
        <StatTile label="Sheets indexed" value={integer(sheets)} icon={<Layers className="size-4" />}
          hint="searchable, permission-filtered"
          detail={
            <div className="space-y-2">
              <p>
                Every page of the {plural(documents.length, 'document')} above, split into a row
                each so a finding can name the sheet it came from rather than the file.
              </p>
              <p>
                A plan set with no sheet count was uploaded before the page count was recorded and
                cannot be taken off until it is counted. What a person can find is also filtered by
                what they may see, so this is the sheet count, not their sheet count.
              </p>
            </div>
          } />
        <StatTile label="Findings awaiting review" value={pending.length}
          tone={pending.length ? 'warn' : 'success'} icon={<Bot className="size-4" />}
          hint="nothing enters an estimate unapproved"
          onClick={() => showFindings('proposed')}
          active={tab === 'findings' && state === 'proposed'}
          actionLabel="List the findings waiting for a reviewer" />
        <StatTile label="Findings accepted" value={accepted.length} tone="success"
          icon={<ShieldCheck className="size-4" />} hint="each recorded against its reviewer"
          onClick={() => showFindings('accepted')}
          active={tab === 'findings' && state === 'accepted'}
          actionLabel="List the findings that have been accepted" />
      </div>

      <Alert tone="neutral" icon={<ShieldCheck className="size-4" />} title="How AI findings are governed">
        An agent may classify documents, extract quantity candidates, compare revisions and flag
        conflicts. It cannot compute an authoritative price, and it cannot write to an estimate.
        Every finding below is inert until a human with the <code className="font-mono text-[12px]">ai.accept_findings</code>{' '}
        permission accepts it — and the acceptance is attributed to that person permanently.
      </Alert>

      <Tabs value={tab} onValueChange={(v) => { setTab(v); if (v !== 'findings') setState('all'); }}>
        <TabsList>
          <TabsTrigger value="findings">AI findings ({pending.length} pending)</TabsTrigger>
          <TabsTrigger value="documents">Document register ({documents.length})</TabsTrigger>
          <TabsTrigger value="pipeline">Ingestion pipeline</TabsTrigger>
        </TabsList>

        {/* -------------------------------------------------------- findings */}
        <TabsContent value="findings" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal-400" />
              <Input className="pl-9" placeholder="Search findings, sheets and citations…"
                value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {state !== 'all' ? (
              <div className="flex items-center gap-2 text-sm text-charcoal-600">
                <span>
                  Showing the {state === 'proposed' ? 'findings waiting for a reviewer' : 'accepted findings'}.
                </span>
                <Button variant="outline" size="sm" onClick={() => setState('all')}>
                  Show all {findings.length}
                </Button>
              </div>
            ) : null}
          </div>

          {findingsQ.status === 'loading' ? <LoadingState label="Reading the findings" /> : null}
          {findingsQ.status === 'error'
            ? <ErrorState message={findingsQ.message} onRetry={findingsQ.refetch} /> : null}

          {findingsQ.status === 'ready' && visible.length === 0 ? (
            <Card><CardContent className="p-6">
              <EmptyState icon={<Bot className="size-5" />}
                title={findings.length === 0
                  ? 'Nothing has been read yet'
                  : state === 'proposed' ? 'Nothing is waiting for a reviewer'
                    : state === 'accepted' ? 'Nothing has been accepted yet'
                      : 'No findings match that search'}
                description={findings.length === 0
                  ? 'Upload a plan set and read it. What the model finds appears here, each claim citing the sheet it came from, and none of it reaches an estimate until you accept it.'
                  : undefined} />
            </CardContent></Card>
          ) : null}

          <div className="space-y-3">
            {visible.map((f) => (
              <FindingCard key={f.id} finding={f} canAccept={canAccept} estimates={estimates}
                busy={busy === f.id}
                onDecide={async (decision, versionId, note) => {
                  if (!supabase) return;
                  setBusy(f.id); setError(null); setNotice(null);
                  try {
                    if (decision === 'accept') {
                      await acceptFinding(supabase, f.id, versionId!, note);
                      setNotice(`"${f.title}" is on the estimate as a line, recorded against you.`);
                    } else {
                      await rejectFinding(supabase, f.id, note ?? '');
                      setNotice(`"${f.title}" is set aside, with your reason on the record.`);
                    }
                    refresh();
                  } catch (err) { setError(messageFor(err)); }
                  finally { setBusy(null); }
                }} />
            ))}
          </div>
        </TabsContent>

        {/* ------------------------------------------------------- documents */}
        <TabsContent value="documents">
          <Card>
            <CardHeader>
              <CardTitle>Document register</CardTitle>
              <CardDescription>
                A complete inventory before takeoff begins. A superseded document stays readable for
                the audit trail; the current version is what a takeoff measures and what the agents
                read.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {documents.length === 0 && docsQ.status === 'ready' ? (
                <div className="p-6">
                  <EmptyState icon={<FileUp className="size-5" />} title="No documents yet"
                    description="Upload a plan set to start. The page count is taken as it uploads, which is what turns a file into something a takeoff can be measured on." />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Sheets</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead>Uploaded</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead className="text-right">Findings</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="max-w-72">
                          <p className="truncate font-medium text-charcoal-900">{d.name}</p>
                          <p className="truncate text-xs text-charcoal-500">{d.fileName}</p>
                        </TableCell>
                        <TableCell className="text-charcoal-600">
                          {titleCase(d.documentType.replace(/_/g, ' '))}
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {d.pageCount ?? <span className="text-charcoal-400">not counted</span>}
                        </TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">
                          {d.byteSize == null ? '—' : `${(d.byteSize / 1_048_576).toFixed(1)} MB`}
                        </TableCell>
                        <TableCell className="text-charcoal-600">{date(d.createdAt)}</TableCell>
                        <TableCell>
                          <Badge variant={d.processingState === 'indexed' ? 'success'
                            : d.processingState === 'failed' ? 'danger' : 'warn'}>
                            {titleCase(d.processingState.replace(/_/g, ' '))}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {d.findingCount || <span className="text-charcoal-400">—</span>}
                          {d.awaitingReview > 0 ? (
                            <span className="block text-xs text-warn-700">
                              {d.awaitingReview} waiting
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" disabled={!canUpload || busy === d.id}
                            onClick={() => void onAnalyze(d)}>
                            {busy === d.id ? <Loader2 className="size-4 animate-spin" />
                              : <Bot className="size-4" />}
                            {d.findingCount > 0 ? 'Read again' : 'Read it'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------------------------------------------------------- pipeline */}
        <TabsContent value="pipeline" className="space-y-6">
          <PipelinePanel jobs={jobs} state={jobsQ.status} documents={documents} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* -------------------------------------------------------------- upload ---- */

function UploadButton({ disabled, busy, onFile }: {
  disabled: boolean; busy: boolean; onFile: (file: File) => void;
}) {
  return (
    <label className={cn(
      'inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-yellow-500 px-4 text-sm font-medium text-charcoal-900',
      'hover:bg-yellow-400 focus-within:ring-2 focus-within:ring-yellow-500 focus-within:ring-offset-2',
      disabled && 'pointer-events-none opacity-50',
    )}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
      {busy ? 'Uploading…' : 'Upload documents'}
      <input type="file" accept="application/pdf" className="sr-only" disabled={disabled}
        aria-label="Upload a plan set"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }} />
    </label>
  );
}

/* ------------------------------------------------------------- finding ---- */

function FindingCard({ finding, canAccept, estimates, busy, onDecide }: {
  finding: Finding;
  canAccept: boolean;
  estimates: Array<{ id: string; number: string; name: string; currentVersionId: string | null }>;
  busy: boolean;
  onDecide: (decision: 'accept' | 'reject', versionId: string | null, note: string | null) => void;
}) {
  const open = estimates.filter((e) => e.currentVersionId);
  const [versionId, setVersionId] = useState(open[0]?.currentVersionId ?? '');
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const decided = finding.state !== 'proposed';
  const cited = finding.sheetReferences.length + finding.specificationReferences.length
    + finding.citations.length;

  return (
    <Card className={cn(decided && 'opacity-90')}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{titleCase(finding.findingType.replace(/_/g, ' '))}</Badge>
              {finding.severity ? (
                <Badge variant={SEVERITY[finding.severity] ?? 'default'}>
                  {titleCase(finding.severity)}
                </Badge>
              ) : null}
              <Badge variant={finding.state === 'accepted' ? 'success'
                : finding.state === 'rejected' ? 'danger' : 'warn'}>
                {titleCase(finding.state)}
              </Badge>
              {finding.documentName ? (
                <span className="text-xs text-charcoal-500">{finding.documentName}</span>
              ) : null}
            </div>
            <CardTitle className="mt-1.5">{finding.title}</CardTitle>
            <CardDescription className="mt-1 max-w-3xl">{finding.description}</CardDescription>
          </div>
          {finding.quantity != null ? (
            <div className="shrink-0 text-right">
              <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
                Candidate quantity
              </p>
              <p className="tabular text-xl font-bold text-charcoal-900">
                {qty(finding.quantity)} {finding.unit}
              </p>
              {finding.method ? (
                <p className="text-xs text-charcoal-500">{titleCase(finding.method.replace(/_/g, ' '))}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/*
          * The evidence, on the card rather than behind it. The database refuses
          * to store a quantity, conflict or scope claim without one — this is
          * that constraint made visible, because a quantity whose source nobody
          * can check is a quantity nobody should price.
          */}
        <div className="rounded-md border border-charcoal-200 bg-charcoal-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
            Cited from
          </p>
          {cited === 0 ? (
            <p className="mt-1 text-sm text-charcoal-500">
              Nothing cited. This type of finding is not required to cite, and it is not a quantity.
            </p>
          ) : (
            <div className="mt-1 space-y-1.5">
              {finding.sheetReferences.length ? (
                <p className="text-sm text-charcoal-700">
                  Sheets: <span className="font-mono text-xs">{finding.sheetReferences.join(', ')}</span>
                </p>
              ) : null}
              {finding.specificationReferences.length ? (
                <p className="text-sm text-charcoal-700">
                  Specifications: <span className="font-mono text-xs">{finding.specificationReferences.join(', ')}</span>
                </p>
              ) : null}
              {finding.citations.map((c, i) => (
                <p key={i} className="text-xs italic leading-relaxed text-charcoal-600">
                  {c.sheet ? <span className="font-mono not-italic">{c.sheet}</span> : null}
                  {c.section ? <span className="font-mono not-italic"> {c.section}</span> : null}
                  {c.quote ? <> — “{c.quote}”</> : null}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-charcoal-500">
          <span>Model confidence {percent(finding.confidence / 100, 0)}</span>
          {finding.model ? <span className="font-mono">{finding.model}</span> : null}
          <span>{dateTime(finding.createdAt)}</span>
          {/*
            * The model's score, named as the model's. A line's confidence is the
            * engine's to compute from what the line is actually made of, and
            * carrying this across would let a model's optimism reach a bid.
            */}
        </div>

        {decided ? (
          finding.reviewNote ? (
            <p className="text-sm italic text-charcoal-600">“{finding.reviewNote}”</p>
          ) : null
        ) : !canAccept ? (
          <p className="text-sm text-charcoal-500">
            Accepting a finding needs <code className="font-mono text-[12px]">ai.accept_findings</code>.
            Somebody with that permission has to decide this one.
          </p>
        ) : rejecting ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1 space-y-1">
              <Label htmlFor={`note-${finding.id}`}>Why is this being set aside?</Label>
              <Input id={`note-${finding.id}`} value={note} disabled={busy}
                placeholder="The sheet it cites is superseded by Addendum 2."
                onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button size="sm" variant="outline" disabled={busy || note.trim().length < 3}
              onClick={() => onDecide('reject', null, note)}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
              Set aside
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-64 space-y-1">
              <Label htmlFor={`est-${finding.id}`}>Onto which estimate?</Label>
              <select id={`est-${finding.id}`} value={versionId} disabled={busy || open.length === 0}
                onChange={(e) => setVersionId(e.target.value)}
                className="h-9 w-full rounded-md border border-charcoal-300 bg-white px-2 text-sm">
                {open.length === 0 ? <option value="">No estimate to add it to</option> : null}
                {open.map((e) => (
                  <option key={e.id} value={e.currentVersionId!}>{e.number} — {e.name}</option>
                ))}
              </select>
            </div>
            <Button size="sm" disabled={busy || !versionId}
              onClick={() => onDecide('accept', versionId, null)}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Accept onto the estimate
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRejecting(true)}>
              Set aside
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------- pipeline ---- */

function PipelinePanel({ jobs, state, documents }: {
  jobs: IngestionJob[]; state: string; documents: PlanDocument[];
}) {
  const running = jobs.filter((j) => !['complete', 'failed'].includes(j.stage));
  const failed = jobs.filter((j) => j.stage === 'failed');
  const pages = jobs.reduce((a, j) => a + j.pagesProcessed, 0);
  const findings = jobs.reduce((a, j) => a + j.findingsCreated, 0);
  const inputTokens = jobs.reduce((a, j) => a + (j.inputTokens ?? 0), 0);
  const outputTokens = jobs.reduce((a, j) => a + (j.outputTokens ?? 0), 0);
  const cost = jobs.reduce((a, j) => a + (j.costEstimate ?? 0), 0);
  const named = (id: string) => documents.find((d) => d.currentVersionId === id)?.name ?? 'a document';

  return (
    <>
      <Alert tone="neutral" icon={<ShieldCheck className="size-4" />}
        title="What the model is and is not allowed to do">
        The analyst prompt forbids the model from computing cost, price, production rate, duration,
        crew size or markup — the deterministic engine owns all of that. Every scope item, quantity
        and conflict must cite the sheet or specification it came from, and a finding that arrives
        without one is <em>rejected before it is stored</em>. A rejection count is that guard doing
        its job, not a failure.
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Pipeline runs" value={jobs.length} icon={<RefreshCw className="size-4" />}
          hint={`${running.length} running, ${failed.length} failed`}
          detail={
            <p>
              One run is one document version through the stages below. A failed run stays on the
              list with the stage it reached and the message that failed it — the table refuses to
              record a failure without one, precisely so nobody has to re-run it blind.
            </p>
          } />
        <StatTile label="Pages analyzed" value={integer(pages)} icon={<Layers className="size-4" />}
          detail={
            <p>
              Pages the model actually read, summed over every run — so a sheet read twice, once per
              revision, counts twice. It is the unit the spend beside this is metered in.
            </p>
          } />
        <StatTile label="Findings proposed" value={integer(findings)} icon={<Bot className="size-4" />}
          hint="none of them in an estimate yet"
          detail={
            <p>
              What the model offered, not what entered an estimate. Nothing here is in a bid until a
              person with the acceptance permission takes it (RULE-008), and a claim that arrived
              without a citation never reached a reviewer at all.
            </p>
          } />
        <StatTile label="Tokens" value={`${integer(inputTokens / 1000)}K in`} icon={<Cpu className="size-4" />}
          hint={`${integer(outputTokens / 1000)}K out`}
          detail={
            <p>
              {integer(inputTokens)} tokens of plans and specifications went to the model
              and {integer(outputTokens)} came back. Input dominates because a drawing set is large
              and a finding is a sentence, which is why the spend tracks pages rather than findings.
            </p>
          } />
        <StatTile label="AI spend" value={money(cost)} icon={<CircleDollarSign className="size-4" />}
          hint="metered per run against the plan allowance"
          detail={
            <p>
              Charged per run and counted against the plan&apos;s allowance, so a document set
              re-read after a revision costs again. It buys the reading, not the answer: the price on
              an estimate is the engine&apos;s arithmetic and no part of this figure is in it.
            </p>
          } />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>The pipeline</CardTitle>
          <CardDescription>
            Each stage is recorded against the document version, so a bad quantity can be traced to
            the exact model, prompt version and page that produced it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
            {STAGES.map(([key, label, detail], i) => (
              <li key={key} className="rounded-md border border-charcoal-200 p-3">
                <span className="tabular text-xs font-bold text-yellow-600">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="mt-1 text-sm font-semibold text-charcoal-900">{label}</p>
                <p className="mt-1 text-xs leading-relaxed text-charcoal-500">{detail}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {state === 'loading' ? <LoadingState label="Reading the pipeline" /> : null}
      {jobs.length === 0 && state === 'ready' ? (
        <Card><CardContent className="p-6">
          <EmptyState icon={<RefreshCw className="size-5" />} title="Nothing has been through the pipeline"
            description="A run appears here the first time a document is read." />
        </CardContent></Card>
      ) : null}

      <div className="space-y-3">
        {jobs.map((j) => {
          const stageIndex = STAGE_ORDER.indexOf(j.stage);
          const done = j.stage === 'complete';
          return (
            <Card key={j.id}>
              <CardHeader className="gap-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{named(j.documentVersionId)}</CardTitle>
                    <CardDescription>
                      {j.startedAt ? dateTime(j.startedAt) : dateTime(j.createdAt)}
                      {j.durationMs ? ` · ${(j.durationMs / 1000).toFixed(1)}s` : ''}
                      {j.model ? ` · ${j.model}` : ''}
                      {j.promptVersion ? ` · prompt ${j.promptVersion}` : ''}
                    </CardDescription>
                  </div>
                  <Badge variant={done ? 'success' : j.stage === 'failed' ? 'danger' : 'warn'}>
                    {titleCase(j.stage.replace(/_/g, ' '))}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <Progress value={done ? 100 : Math.round(j.progress * 100)}
                  indicatorClassName={j.stage === 'failed' ? 'bg-danger-500' : undefined} />
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-charcoal-600">
                  <span>
                    {integer(j.pagesProcessed)}
                    {j.pagesTotal ? ` of ${integer(j.pagesTotal)}` : ''} pages
                  </span>
                  <span>{plural(j.findingsCreated, 'finding')}</span>
                  {j.attempts > 1 ? <span>{j.attempts} attempts</span> : null}
                  {j.costEstimate != null ? <span>{money(j.costEstimate)}</span> : null}
                  {stageIndex >= 0 ? (
                    <span className="text-charcoal-400">
                      stage {stageIndex + 1} of {STAGES.length}
                    </span>
                  ) : null}
                </div>
                {j.errorMessage ? (
                  <>
                    <Separator />
                    <p className="text-sm text-danger-700">{j.errorMessage}</p>
                  </>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
