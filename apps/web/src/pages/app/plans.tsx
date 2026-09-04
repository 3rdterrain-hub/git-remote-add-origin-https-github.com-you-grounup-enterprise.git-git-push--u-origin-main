import { useState } from 'react';
import {
  FileUp, FileText, Bot, Check, X, Search, AlertTriangle, Layers, ShieldCheck, Quote,
  Cpu, CircleDollarSign, RefreshCw, CheckCircle2, Loader2, Ban,
} from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AI_FINDINGS, DOCUMENTS, type AiFinding } from '@/data/operations';
import { INGESTION_JOBS, PIPELINE_STAGES, aiUsageSummary, type IngestionJob } from '@/data/ingestion';
import { USER } from '@/data/demo';
import { date, dateTime, integer, titleCase, money, percent, qty, plural } from '@/lib/format';
import { Alert, EmptyState, Progress, Separator } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

export function PlansPage() {
  const [findings, setFindings] = useState<AiFinding[]>(AI_FINDINGS);
  const [query, setQuery] = useState('');

  const canAccept = USER.permissions.includes('ai.accept_findings');
  const pending = findings.filter((f) => f.state === 'proposed');
  const accepted = findings.filter((f) => f.state === 'accepted');
  const activeDocs = DOCUMENTS.filter((d) => !d.superseded);

  /**
   * Accepting a finding is the only path from AI output into business data.
   * The reviewer is recorded because RULE-008 requires an identified human on
   * every acceptance — the database rejects the write otherwise.
   */
  function decide(id: string, state: 'accepted' | 'rejected') {
    setFindings((prev) => prev.map((f) => (f.id === id ? { ...f, state, reviewedBy: USER.name } : f)));
  }

  const visible = findings.filter((f) =>
    !query || `${f.title} ${f.description} ${f.citations.join(' ')}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plans & Specifications"
        description="Upload the document set, let the agents read it, then approve what enters the estimate. Every AI claim cites the sheet or specification section it came from."
        actions={<Button><FileUp className="size-4" /> Upload documents</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Active documents" value={activeDocs.length} icon={<FileText className="size-4" />}
          hint={`${DOCUMENTS.length - activeDocs.length} superseded, retained for audit`} />
        <StatTile label="Sheets indexed" value={integer(activeDocs.reduce((a, d) => a + d.pages, 0))} icon={<Layers className="size-4" />}
          hint="searchable, permission-filtered" />
        <StatTile label="Findings awaiting review" value={pending.length} tone={pending.length ? 'warn' : 'success'}
          icon={<Bot className="size-4" />} hint="nothing enters an estimate unapproved" />
        <StatTile label="Findings accepted" value={accepted.length} tone="success" icon={<ShieldCheck className="size-4" />}
          hint="each recorded against its reviewer" />
      </div>

      <Alert tone="neutral" icon={<ShieldCheck className="size-4" />} title="How AI findings are governed">
        An agent may classify documents, extract quantity candidates, compare revisions and flag
        conflicts. It cannot compute an authoritative price, and it cannot write to an estimate.
        Every finding below is inert until a human with the <code className="font-mono text-[12px]">ai.accept_findings</code>{' '}
        permission accepts it — and the acceptance is attributed to that person permanently.
      </Alert>

      <Tabs defaultValue="findings">
        <TabsList>
          <TabsTrigger value="findings">AI findings ({pending.length} pending)</TabsTrigger>
          <TabsTrigger value="documents">Document register ({DOCUMENTS.length})</TabsTrigger>
          <TabsTrigger value="pipeline">Ingestion pipeline</TabsTrigger>
        </TabsList>

        <TabsContent value="findings" className="space-y-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal-400" />
            <Input className="pl-9" placeholder="Search findings and citations…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          {visible.length === 0 ? (
            <Card><CardContent className="p-0">
              <EmptyState icon={<Search className="size-5" />} title="No findings match that search" />
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {visible.map((f) => (
                <FindingCard key={f.id} finding={f} canAccept={canAccept} onDecide={decide} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader>
              <CardTitle>Document register</CardTitle>
              <CardDescription>
                Section 2 — a complete inventory before takeoff begins. A superseded document stays
                readable for the audit trail but is excluded from pricing.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Discipline</TableHead>
                    <TableHead className="text-right">Ver.</TableHead>
                    <TableHead className="text-right">Pages</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="text-right">Findings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {DOCUMENTS.map((d) => (
                    <TableRow key={d.id} className={cn(d.superseded && 'opacity-55')}>
                      <TableCell className="max-w-72">
                        <p className="truncate font-medium text-charcoal-900">{d.name}</p>
                        {d.superseded ? <Badge variant="default" className="mt-0.5">Superseded</Badge> : null}
                      </TableCell>
                      <TableCell className="text-charcoal-600">{titleCase(d.type)}</TableCell>
                      <TableCell className="text-charcoal-600">{d.discipline}</TableCell>
                      <TableCell className="tabular text-right">{d.version}</TableCell>
                      <TableCell className="tabular text-right">{d.pages}</TableCell>
                      <TableCell className="text-charcoal-600">{date(d.issueDate)}</TableCell>
                      <TableCell>
                        <Badge variant={d.state === 'indexed' ? 'success' : d.state === 'failed' ? 'danger' : 'warn'}>
                          {titleCase(d.state)}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular text-right">{d.findings || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        {/* -------------------------------------------------------- pipeline */}
        <TabsContent value="pipeline" className="space-y-6">
          <PipelinePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------- pipeline ---- */

const STAGE_ORDER = PIPELINE_STAGES.map((s) => s.key) as readonly string[];

function PipelinePanel() {
  const usage = aiUsageSummary();
  const running = INGESTION_JOBS.filter((j) => !['complete', 'failed'].includes(j.stage));
  const failed = INGESTION_JOBS.filter((j) => j.stage === 'failed');

  return (
    <>
      <Alert tone="neutral" icon={<ShieldCheck className="size-4" />}
        title="What the model is and is not allowed to do">
        The analyst prompt forbids the model from computing cost, price, production rate, duration, crew size or
        markup — the deterministic engine owns all of that. Every scope item, quantity and conflict must cite the
        sheet or specification it came from, and a finding that arrives without one is <em>rejected before it is
        stored</em>. The rejection count below is that guard doing its job, not a failure.
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Pipeline runs" value={usage.runs} icon={<RefreshCw className="size-4" />}
          hint={`${running.length} running, ${failed.length} failed`} />
        <StatTile label="Pages analyzed" value={integer(usage.pages)} icon={<Layers className="size-4" />} />
        <StatTile label="Findings proposed" value={usage.findings} icon={<Bot className="size-4" />}
          hint={`${usage.rejected} rejected by the citation guard`} />
        <StatTile label="Tokens" value={`${integer(usage.inputTokens / 1000)}K in`} icon={<Cpu className="size-4" />}
          hint={`${integer(usage.outputTokens / 1000)}K out`} />
        <StatTile label="AI spend" value={money(usage.cost)} icon={<CircleDollarSign className="size-4" />}
          hint="metered per run against the plan allowance" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>The pipeline</CardTitle>
          <CardDescription>
            Each stage is recorded against the document version, so a bad quantity can be traced to the exact
            model, prompt version and page that produced it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {PIPELINE_STAGES.map((s, i) => (
              <li key={s.key} className="rounded-md border border-charcoal-200 p-3">
                <span className="tabular text-xs font-bold text-yellow-600">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="mt-1 text-sm font-semibold text-charcoal-900">{s.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-charcoal-500">{s.detail}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {INGESTION_JOBS.map((j) => <JobCard key={j.id} job={j} />)}
      </div>
    </>
  );
}

function JobCard({ job }: { job: IngestionJob }) {
  const stageIndex = STAGE_ORDER.indexOf(job.stage);
  const isDone = job.stage === 'complete';
  const isFailed = job.stage === 'failed';

  return (
    <Card className={cn(isFailed && 'border-danger-500/30')}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-charcoal-900">{job.documentName}</p>
            <p className="text-xs text-charcoal-500">
              version {job.version} · started {dateTime(job.startedAt)}
              {job.durationMs ? ` · ${qty(job.durationMs / 1000, 0)}s` : ''}
              {job.attempts > 1 ? ` · attempt ${job.attempts}` : ''}
            </p>
          </div>
          <Badge variant={isDone ? 'success' : isFailed ? 'danger' : 'warn'}>
            {isDone ? <CheckCircle2 className="size-3" />
              : isFailed ? <Ban className="size-3" />
              : <Loader2 className="size-3 animate-spin" />}
            {titleCase(job.stage)}
          </Badge>
        </div>

        <div className="mt-3">
          <Progress value={job.progress * 100}
            indicatorClassName={isFailed ? 'bg-danger-500' : isDone ? 'bg-success-600' : 'bg-yellow-500'} />
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-charcoal-500">
            <span>{integer(job.pagesProcessed)} of {integer(job.pagesTotal)} pages · {percent(job.progress, 0)}</span>
            <span className="flex flex-wrap items-center gap-2">
              {STAGE_ORDER.map((s, i) => (
                <span key={s} className={cn(
                  'text-[10px]',
                  isDone || i < stageIndex ? 'text-success-700'
                    : i === stageIndex ? 'font-semibold text-charcoal-900' : 'text-charcoal-300',
                )}>
                  {titleCase(s)}
                </span>
              ))}
            </span>
          </div>
        </div>

        {job.model ? (
          <>
            <Separator className="my-3" />
            <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
              <div><dt className="text-charcoal-500">Model</dt><dd className="font-mono text-charcoal-900">{job.model}</dd></div>
              <div><dt className="text-charcoal-500">Prompt</dt><dd className="font-mono text-charcoal-900">{job.promptVersion}</dd></div>
              <div><dt className="text-charcoal-500">Tokens</dt>
                <dd className="tabular text-charcoal-900">
                  {job.inputTokens !== null ? `${integer(job.inputTokens / 1000)}K / ${integer((job.outputTokens ?? 0) / 1000)}K` : '—'}
                </dd></div>
              <div><dt className="text-charcoal-500">Cost</dt>
                <dd className="tabular text-charcoal-900">{job.costEstimate !== null ? money(job.costEstimate) : '—'}</dd></div>
              <div><dt className="text-charcoal-500">Findings</dt>
                <dd className="tabular text-charcoal-900">
                  {job.findingsCreated} proposed{job.findingsRejected ? `, ${job.findingsRejected} rejected` : ''}
                </dd></div>
            </dl>
          </>
        ) : null}

        {job.errorMessage ? (
          <Alert tone="danger" className="mt-3" icon={<AlertTriangle className="size-4" />}
            title={`Failed after ${plural(job.pagesProcessed, 'page')}`}>
            {job.errorMessage} The {job.findingsCreated} findings produced before the failure were kept — a partial
            run that found something real should not be thrown away because it did not finish.
          </Alert>
        ) : null}

        {job.rejectionReasons?.length ? (
          <div className="mt-3 rounded-md border border-charcoal-200 bg-charcoal-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
              Rejected by the citation guard
            </p>
            <ul className="mt-1.5 space-y-1">
              {job.rejectionReasons.map((r, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-charcoal-600">
                  <X className="mt-0.5 size-3 shrink-0 text-danger-600" />{r}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FindingCard({
  finding, canAccept, onDecide,
}: { finding: AiFinding; canAccept: boolean; onDecide: (id: string, s: 'accepted' | 'rejected') => void }) {
  const decided = finding.state !== 'proposed';
  return (
    <Card data-testid={`finding-${finding.id}`} className={cn(decided && 'bg-charcoal-50')}>
      <CardContent className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="dark" className="font-mono text-[10px]">{finding.agent}</Badge>
              <Badge variant="outline">{titleCase(finding.type)}</Badge>
              {finding.severity ? (
                <Badge variant={finding.severity === 'critical' ? 'danger' : finding.severity === 'high' ? 'danger' : 'warn'}>
                  {titleCase(finding.severity)}
                </Badge>
              ) : null}
              <Badge variant={finding.confidence >= 90 ? 'success' : 'warn'}>Confidence {finding.confidence}</Badge>
              {finding.state === 'accepted' ? <Badge variant="success"><Check className="size-3" /> Accepted</Badge> : null}
              {finding.state === 'rejected' ? <Badge variant="danger"><X className="size-3" /> Rejected</Badge> : null}
            </div>

            <h3 className="mt-2.5 font-semibold text-charcoal-900">{finding.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-charcoal-600">{finding.description}</p>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Quote className="size-3.5 text-charcoal-400" />
              {finding.citations.map((c) => (
                <Badge key={c} variant="info" className="font-mono text-[10px]">{c}</Badge>
              ))}
            </div>

            {finding.reviewedBy ? (
              <p className="mt-2.5 text-xs text-charcoal-500">
                {titleCase(finding.state)} by <span className="font-medium text-charcoal-700">{finding.reviewedBy}</span>
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-col gap-2 lg:w-52">
            <div className="rounded-md border border-charcoal-200 bg-white p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-charcoal-500">Suggested routing</p>
              <p className="mt-0.5 text-sm font-medium text-charcoal-900">{titleCase(finding.gate)}</p>
            </div>
            {!decided ? (
              canAccept ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="success" className="flex-1" onClick={() => onDecide(finding.id, 'accepted')}>
                    <Check className="size-4" /> Accept
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => onDecide(finding.id, 'rejected')}>
                    <X className="size-4" /> Reject
                  </Button>
                </div>
              ) : (
                <Alert tone="warn" icon={<AlertTriangle className="size-4" />}>
                  Your role cannot accept AI findings.
                </Alert>
              )
            ) : null}
          </div>
        </div>

        {finding.type === 'conflict' && !decided ? (
          <>
            <Separator className="my-3" />
            <p className="text-xs text-charcoal-500">
              A conflict drops the affected line to <span className="font-medium text-charcoal-700">do-not-price</span>{' '}
              verification status and routes it to senior review. The engine will not choose between two
              disagreeing documents on your behalf.
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
