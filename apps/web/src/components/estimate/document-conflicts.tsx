/**
 * Where the documents disagree.
 *
 * `document_conflicts` has existed since migration 0006 and the confidence
 * engine has read it since 0033: every unresolved conflict on a line takes
 * twenty-two points off that line's confidence, and a low enough line routes
 * the estimate to senior review. Nothing in the platform could record one — so
 * every bid ever priced here was priced as though the plans, the specifications,
 * the geotechnical report and the addenda all agreed.
 *
 * Both sides or nothing. What document A is and what it says, what document B
 * is and what it says. A conflict stated from one side is an opinion, and
 * nobody but its author can settle it — which is why the database refuses one.
 */
import { useState } from 'react';
import { GitCompareArrows, HelpCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  loadDocumentConflicts, raiseConflict, resolveConflict, askAboutConflict,
  SEVERITIES, type DocumentConflict, type Severity,
} from '@/lib/data/conflicts';
import { date } from '@/lib/format';

const NO_LINE = '__none__';

const toneFor = (severity: string): 'danger' | 'warn' | 'default' =>
  (severity === 'critical' || severity === 'high' ? 'danger'
    : severity === 'moderate' ? 'warn' : 'default');

function Conflict({ c, editable, onChanged }: {
  c: DocumentConflict; editable: boolean; onChanged: () => void;
}) {
  const [resolution, setResolution] = useState('');
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const act = async (run: () => Promise<unknown>) => {
    if (!supabase || busy) return;
    setBusy(true);
    setError('');
    try {
      await run();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border border-charcoal-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-charcoal-900">{c.title}</p>
          <p className="mt-0.5 text-xs text-charcoal-600">
            {c.lineDescription ?? 'On the estimate as a whole'}
            {c.discipline ? ` · ${c.discipline}` : ''}
            {' · raised '}{date(c.createdAt)}
            {c.detectedBy === 'ai_agent' ? ' by the model' : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Badge variant={toneFor(c.severity)}>{c.severity}</Badge>
          {c.quantityImpact ? <Badge variant="default">quantity</Badge> : null}
          {c.costImpact ? <Badge variant="default">cost</Badge> : null}
          {c.scheduleImpact ? <Badge variant="default">schedule</Badge> : null}
          {c.rfiCount > 0
            ? <Badge variant="default">{c.rfiCount} RFI{c.rfiCount === 1 ? '' : 's'}</Badge>
            : null}
        </div>
      </div>

      {c.description ? (
        <p className="mt-2 text-sm text-charcoal-700">{c.description}</p>
      ) : null}

      {/* Both sides, side by side, in the words each document used. */}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {([[c.sourceA, c.sourceASays], [c.sourceB, c.sourceBSays]] as [string, string][])
          .map(([source, says]) => (
            <div key={source} className="rounded border border-charcoal-200 bg-charcoal-50/60 p-2">
              <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">
                {source}
              </p>
              <p className="mt-0.5 text-sm text-charcoal-800">{says}</p>
            </div>
          ))}
      </div>

      {c.resolvedAt ? (
        <p className="mt-2 rounded bg-green-50 p-2 text-sm text-green-900">
          Settled {date(c.resolvedAt)}: {c.resolution}
        </p>
      ) : editable ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-64 flex-1 space-y-1.5">
              <Label htmlFor={`res-${c.id}`}>How it was settled</Label>
              <Input id={`res-${c.id}`} value={resolution} placeholder="The addendum governs; 18 inch RCP."
                onChange={(e) => setResolution(e.target.value)} />
            </div>
            <Button type="button" size="sm" disabled={busy || !resolution.trim()}
              onClick={() => void act(() => resolveConflict(supabase!, c.id, resolution))}>
              Settle it
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy}
              onClick={() => setAsking((a) => !a)}>
              <HelpCircle className="mr-1.5 size-3.5" aria-hidden /> Ask the owner
            </Button>
          </div>
          {asking ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-64 flex-1 space-y-1.5">
                <Label htmlFor={`q-${c.id}`}>The question</Label>
                <Input id={`q-${c.id}`} value={question}
                  placeholder={`Which governs: ${c.sourceA} or ${c.sourceB}?`}
                  onChange={(e) => setQuestion(e.target.value)} />
              </div>
              <Button type="button" size="sm" disabled={busy}
                onClick={() => void act(async () => {
                  await askAboutConflict(supabase!, c.id, question);
                  setAsking(false);
                  setQuestion('');
                })}>
                Raise an RFI
              </Button>
            </div>
          ) : null}
          <p className="text-xs text-charcoal-500">
            A resolution is required, because a conflict closed with no answer is one
            somebody finds again on the next revision and settles differently.
          </p>
        </div>
      ) : null}

      {error ? <Alert tone="danger" title="That could not be saved">{error}</Alert> : null}
    </li>
  );
}

export function DocumentConflicts({ versionId, lines, editable }: {
  versionId: string;
  lines: Array<{ id: string; description: string }>;
  editable: boolean;
}) {
  const conflictsQ = useQuery(loadDocumentConflicts, []);
  const all = conflictsQ.status === 'ready'
    ? conflictsQ.data.filter((c) => c.estimateVersionId === versionId) : [];
  const open = all.filter((c) => !c.resolvedAt);
  const settled = all.filter((c) => c.resolvedAt);

  /*
   * Controlled rather than `defaultOpen`, because `defaultOpen` is read once at
   * mount — and at mount the query has not answered, so a card told to open
   * itself when there are conflicts would mount shut and stay shut for the one
   * estimate that needed it open. Null means nobody has touched it yet.
   */
  const [openedByHand, setOpenedByHand] = useState<boolean | null>(null);
  const showing = openedByHand ?? (conflictsQ.status === 'ready' && open.length > 0);

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourceA, setSourceA] = useState('');
  const [sourceASays, setSourceASays] = useState('');
  const [sourceB, setSourceB] = useState('');
  const [sourceBSays, setSourceBSays] = useState('');
  const [lineId, setLineId] = useState(NO_LINE);
  const [severity, setSeverity] = useState<Severity>('moderate');
  const [impacts, setImpacts] = useState({ quantity: true, cost: false, schedule: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const complete = Boolean(title.trim() && sourceA.trim() && sourceASays.trim()
    && sourceB.trim() && sourceBSays.trim());

  const save = async () => {
    if (!supabase || saving) return;
    setSaving(true);
    setError('');
    try {
      await raiseConflict(supabase, {
        title, description, sourceA, sourceASays, sourceB, sourceBSays,
        estimateVersionId: versionId,
        lineItemId: lineId === NO_LINE ? null : lineId,
        severity,
        quantityImpact: impacts.quantity,
        costImpact: impacts.cost,
        scheduleImpact: impacts.schedule,
      });
      setAdding(false);
      setTitle(''); setDescription('');
      setSourceA(''); setSourceASays(''); setSourceB(''); setSourceBSays('');
      setLineId(NO_LINE); setSeverity('moderate');
      conflictsQ.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be recorded.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <CollapsibleCard
      id="document-conflicts"
      title={<span className="flex items-center gap-2">
        <GitCompareArrows className="size-4 text-charcoal-500" aria-hidden />
        Where the documents disagree
      </span>}
      description="Two documents saying different things about the same work. Each unresolved conflict on a line takes twenty-two points off that line's confidence, so an estimate built on documents that argue prices as one that knows it."
      summary={open.length === 0
        ? (settled.length > 0 ? `${settled.length} settled` : 'none raised')
        : `${open.length} open`}
      open={showing}
      onOpenChange={setOpenedByHand}
    >
      <div className="space-y-4">
        {conflictsQ.status === 'loading' ? <LoadingState label="Reading the conflicts" /> : null}
        {conflictsQ.status === 'error'
          ? <ErrorState message={conflictsQ.message} onRetry={conflictsQ.refetch} /> : null}

        {conflictsQ.status === 'ready' && all.length === 0 && !adding ? (
          <EmptyState
            title="Nothing on this estimate is in conflict"
            hint="Record one when a detail contradicts a specification, an addendum changes a quantity, or the geotechnical report disagrees with the plan." />
        ) : null}

        {open.length > 0 ? (
          <ul className="space-y-2">
            {open.map((c) => (
              <Conflict key={c.id} c={c} editable={editable}
                onChanged={conflictsQ.refetch} />
            ))}
          </ul>
        ) : null}

        {settled.length > 0 ? (
          <section>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-charcoal-500">
              Settled
            </h4>
            <ul className="space-y-2">
              {settled.map((c) => (
                <Conflict key={c.id} c={c} editable={false} onChanged={conflictsQ.refetch} />
              ))}
            </ul>
          </section>
        ) : null}

        {editable && !adding ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
            Record a conflict
          </Button>
        ) : null}

        {editable && adding ? (
          <section className="space-y-3 rounded-lg border border-charcoal-200 bg-charcoal-50/50 p-3">
            <div className="space-y-1.5">
              <Label htmlFor="conflict-title">What is in conflict</Label>
              <Input id="conflict-title" value={title}
                placeholder="Storm line size at the north basin"
                onChange={(e) => setTitle(e.target.value)} />
            </div>

            {/* Both sides, in their own words. The database refuses a half-stated one. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="source-a">First document</Label>
                <Input id="source-a" value={sourceA} placeholder="C4.0 Storm Plan, rev 2"
                  onChange={(e) => setSourceA(e.target.value)} />
                <Input aria-label="What the first document says" value={sourceASays}
                  placeholder="18 inch RCP"
                  onChange={(e) => setSourceASays(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="source-b">Second document</Label>
                <Input id="source-b" value={sourceB} placeholder="Specification 33 41 00"
                  onChange={(e) => setSourceB(e.target.value)} />
                <Input aria-label="What the second document says" value={sourceBSays}
                  placeholder="24 inch RCP minimum"
                  onChange={(e) => setSourceBSays(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="conflict-description">Anything the next reader needs</Label>
              <Textarea id="conflict-description" rows={2} value={description}
                onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="conflict-line">The line it lands on</Label>
                <Select value={lineId} onValueChange={setLineId}>
                  <SelectTrigger id="conflict-line">
                    <SelectValue placeholder="The estimate as a whole" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_LINE}>The estimate as a whole</SelectItem>
                    {lines.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.description}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="conflict-severity">Severity</Label>
                <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
                  <SelectTrigger id="conflict-severity"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <fieldset className="flex flex-wrap gap-4">
              <legend className="mb-1 text-sm text-charcoal-700">What it changes</legend>
              {(['quantity', 'cost', 'schedule'] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm text-charcoal-700">
                  <input type="checkbox" checked={impacts[k]}
                    onChange={(e) => setImpacts((s) => ({ ...s, [k]: e.target.checked }))} />
                  {k}
                </label>
              ))}
            </fieldset>

            <p className="text-xs text-charcoal-500">
              Naming the line is what makes this price. A conflict on the estimate as a
              whole is recorded and read, but only one on a line moves that line's
              confidence.
            </p>

            {error ? <Alert tone="danger" title="That could not be recorded">{error}</Alert> : null}

            <div className="flex gap-2">
              <Button type="button" onClick={() => void save()} disabled={saving || !complete}>
                {saving ? 'Recording' : 'Record it'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </section>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}
