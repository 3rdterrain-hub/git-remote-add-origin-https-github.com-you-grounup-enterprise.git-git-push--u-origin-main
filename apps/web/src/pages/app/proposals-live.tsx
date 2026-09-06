/**
 * Proposals, read from the governed schema.
 *
 * A proposal is what a customer was actually sent, which is why its price is a
 * column on the row rather than a join to the estimate: revise the estimate and
 * the document still says what it said. The screen reads that column and does
 * not recompute it — recomputing it would be the bug the column exists to
 * prevent.
 *
 * The action here that had no home before is recording the answer. Migration
 * 0006 gave `proposals` an `accepted_at`, an `accepted_by_name` and a
 * `declined_at`, and 0013 listed all three as still-changeable on an issued
 * proposal; nothing ever wrote one, so a bid the customer signed left its
 * estimate at 'issued' forever and no company using this platform had a record
 * of which jobs they won.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, FileText, Lock, ThumbsDown, ThumbsUp } from 'lucide-react';
import { PageHeader, StatTile, Field } from '@/components/layout/page';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, Separator } from '@/components/ui/misc';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { Logo } from '@/components/layout/logo';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { usePermissions } from '@/lib/data/session';
import {
  loadProposals, loadVersion, recordProposalOutcome,
  type ProposalRow, type VersionDetail,
} from '@/lib/data/estimates';
import { money, moneyCompact, unitRate, qty, date, titleCase } from '@/lib/format';

const STATUS_TONE: Record<string, 'default' | 'info' | 'success' | 'danger'> = {
  draft: 'default', issued: 'info', accepted: 'success',
  declined: 'danger', expired: 'default', withdrawn: 'default',
};

export function ProposalsLivePage() {
  const proposals = useQuery(loadProposals, []);
  const { can } = usePermissions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [answering, setAnswering] = useState<'accepted' | 'declined' | null>(null);

  const rows = proposals.status === 'ready' ? proposals.data : [];
  const selected = rows.find((p) => p.id === selectedId) ?? rows[0] ?? null;

  const issued = rows.filter((p) => p.status !== 'draft');
  const accepted = rows.filter((p) => p.status === 'accepted');
  /*
   * Counted over proposals that have been answered, not over everything issued.
   * A proposal still sitting with a customer is not a proposal they declined,
   * and counting it as one makes the rate move every time somebody sends a bid.
   */
  const answered = rows.filter((p) => p.status === 'accepted' || p.status === 'declined');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proposals"
        description="Generated from a priced estimate version, never retyped. Once issued, a proposal's content is frozen — the price it carries is the price the customer was sent, and revising the estimate does not change it."
      />

      {proposals.status === 'error'
        ? <ErrorState message={proposals.message} onRetry={proposals.refetch} /> : null}
      {proposals.status === 'loading' ? <LoadingState label="Loading proposals" /> : null}

      {proposals.status === 'ready' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Proposals" value={rows.length} icon={<FileText className="size-4" />}
            hint={`${issued.length} issued`} />
          <StatTile label="Issued value"
            value={moneyCompact(issued.reduce((a, p) => a + p.totalPrice, 0))}
            hint="excluding drafts" />
          <StatTile label="Accepted"
            value={moneyCompact(accepted.reduce((a, p) => a + p.totalPrice, 0))} tone="success"
            icon={<CheckCircle2 className="size-4" />}
            hint={`${accepted.length} of ${issued.length} issued`} />
          <StatTile label="Acceptance rate"
            value={answered.length > 0
              ? `${Math.round((accepted.length / answered.length) * 100)}%` : '—'}
            tone={answered.length > 0 ? 'success' : undefined}
            hint={answered.length > 0
              ? `by count, across ${answered.length} answered`
              : 'nothing answered yet'} />
        </div>
      ) : null}

      {proposals.status === 'ready' && rows.length === 0 ? (
        <EmptyState
          title="No proposals yet"
          hint={<>A proposal is issued from an approved estimate. <Link to="/app/estimates"
            className="text-yellow-700 underline">Go to the estimator</Link>.</>}
        />
      ) : null}

      {selected ? (
        <div className="grid gap-6 xl:grid-cols-[1fr_1.5fr]">
          <Card>
            <CardHeader><CardTitle>All proposals</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Proposal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => (
                    <TableRow key={p.id}
                      className={selected.id === p.id ? 'bg-charcoal-50' : 'cursor-pointer'}
                      onClick={() => setSelectedId(p.id)}>
                      <TableCell>
                        <button className="text-left" type="button">
                          <p className="font-medium text-charcoal-900">{p.number}</p>
                          <p className="max-w-56 truncate text-xs text-charcoal-500">{p.title}</p>
                          <p className="text-xs text-charcoal-400">
                            {p.customerName ?? 'No customer on the estimate'}
                          </p>
                        </button>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_TONE[p.status] ?? 'default'}>{titleCase(p.status)}</Badge>
                        {p.acceptedByName ? (
                          <p className="mt-0.5 text-xs text-charcoal-400">by {p.acceptedByName}</p>
                        ) : p.viewedAt ? (
                          <p className="mt-0.5 text-xs text-charcoal-400">viewed {date(p.viewedAt)}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="tabular text-right font-medium">{money(p.totalPrice)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <ProposalDocument
            proposal={selected}
            canAnswer={can('estimates.issue')}
            onAnswer={setAnswering}
          />
        </div>
      ) : null}

      {selected ? (
        <AnswerDialog
          proposal={selected}
          outcome={answering}
          onClose={() => setAnswering(null)}
          onRecorded={() => { setAnswering(null); proposals.refetch(); }}
        />
      ) : null}
    </div>
  );
}

/**
 * The document, rolled up from the estimate's own lines by cost code.
 *
 * Grouping by cost code rather than by an invented "discipline" is what makes
 * the total traceable: every section here is a code a company already reports
 * against, and the sections sum to the frozen price rather than to a fresh
 * recomputation of it.
 */
function ProposalDocument({ proposal, canAnswer, onAnswer }: {
  proposal: ProposalRow;
  canAnswer: boolean;
  onAnswer: (o: 'accepted' | 'declined') => void;
}) {
  const version = useQuery(loadVersion(proposal.estimateVersionId), [proposal.estimateVersionId]);
  const v: VersionDetail | null = version.status === 'ready' ? version.data : null;

  const sections = useMemo(() => {
    if (!v) return [];
    /*
     * The estimate's lines carry direct cost; the proposal carries the price.
     * The sections are scaled by the one ratio the engine produced, so they add
     * to the frozen total exactly instead of to a number close to it.
     */
    const factor = v.directCost > 0 ? proposal.totalPrice / v.directCost : 0;
    const by = new Map<string, { amount: number; lines: number; quantity: number; unit: string }>();
    for (const l of v.lines) {
      const key = l.costCode ?? l.serviceName ?? 'Other work';
      const e = by.get(key) ?? { amount: 0, lines: 0, quantity: 0, unit: l.unit };
      e.amount += l.totalDirectCost * factor;
      e.lines += 1;
      e.quantity += l.measuredQuantity;
      by.set(key, e);
    }
    return [...by.entries()].map(([name, s]) => ({ name, ...s }))
      .sort((a, b) => b.amount - a.amount);
  }, [v, proposal.totalPrice]);

  const frozen = proposal.status !== 'draft';

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>{proposal.number}</CardTitle>
          <CardDescription>
            From {proposal.estimateNumber} version {proposal.estimateVersion}
          </CardDescription>
        </div>
        {proposal.status === 'issued' && canAnswer ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => onAnswer('declined')}>
              <ThumbsDown className="size-4" /> Declined
            </Button>
            <Button size="sm" onClick={() => onAnswer('accepted')}>
              <ThumbsUp className="size-4" /> Accepted
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {proposal.status === 'accepted' ? (
          <Alert tone="success" icon={<CheckCircle2 className="size-4" />} title="Accepted">
            Signed by {proposal.acceptedByName}
            {proposal.acceptedAt ? ` on ${date(proposal.acceptedAt)}` : ''}. The estimate behind it
            is awarded, so the work can become a project without anything being re-entered.
          </Alert>
        ) : proposal.status === 'declined' ? (
          <Alert tone="danger" title="Declined">
            {proposal.declinedAt ? `Declined ${date(proposal.declinedAt)}. ` : ''}
            The estimate behind it is marked lost.
          </Alert>
        ) : frozen ? (
          <Alert tone="neutral" icon={<Lock className="size-4" />}
            title="This proposal is issued and frozen">
            Issued {proposal.issuedAt ? date(proposal.issuedAt) : 'recently'}. Its content cannot
            change — the database refuses the edit. A revision means issuing a new proposal, so the
            document the customer holds stays reproducible.
          </Alert>
        ) : null}

        <div className="rounded-md border border-charcoal-300 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4 border-b border-charcoal-200 pb-4">
            <Logo />
            <div className="text-right text-xs text-charcoal-500">
              <p className="mt-1 font-semibold text-charcoal-900">{proposal.number}</p>
              <p>{proposal.issuedAt ? date(proposal.issuedAt) : 'Draft'}</p>
            </div>
          </div>

          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <Field label="Prepared for">{proposal.customerName ?? '—'}</Field>
            <Field label="Project">{proposal.title}</Field>
            <Field label="Proposal valid for">{proposal.validityDays} days</Field>
            <Field label="Payment terms">{proposal.paymentTerms ?? 'As agreed'}</Field>
          </div>

          {proposal.coverLetter ? (
            <p className="pb-4 text-sm leading-relaxed text-charcoal-700">{proposal.coverLetter}</p>
          ) : null}

          <Separator />

          {version.status === 'loading' ? (
            <div className="py-6"><LoadingState label="Loading the estimate behind it" /></div>
          ) : version.status === 'error' ? (
            <div className="py-6"><ErrorState message={version.message} /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scope</TableHead>
                  {proposal.showLineDetail ? <TableHead className="text-right">Quantity</TableHead> : null}
                  {proposal.showUnitPrices ? <TableHead className="text-right">Unit</TableHead> : null}
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sections.map((s) => (
                  <TableRow key={s.name}>
                    <TableCell className="font-medium text-charcoal-900">{s.name}</TableCell>
                    {proposal.showLineDetail ? (
                      <TableCell className="tabular text-right text-charcoal-500">
                        {qty(s.quantity)} {s.unit}
                      </TableCell>
                    ) : null}
                    {proposal.showUnitPrices ? (
                      <TableCell className="tabular text-right text-charcoal-500">
                        {s.quantity > 0 ? unitRate(s.amount / s.quantity) : '—'}
                      </TableCell>
                    ) : null}
                    <TableCell className="tabular text-right font-medium">{money(s.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-charcoal-50">
                  <TableCell colSpan={1 + (proposal.showLineDetail ? 1 : 0)
                    + (proposal.showUnitPrices ? 1 : 0)}>
                    Total proposal amount
                  </TableCell>
                  {/* The frozen figure, not a sum of the sections above it. */}
                  <TableCell className="tabular text-right text-base">
                    {money(proposal.totalPrice)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AnswerDialog({ proposal, outcome, onClose, onRecorded }: {
  proposal: ProposalRow;
  outcome: 'accepted' | 'declined' | null;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!supabase || !outcome) return;
    setBusy(true); setError(null);
    try {
      await recordProposalOutcome(supabase, {
        proposalId: proposal.id, outcome, byName: name, reason,
      });
      setName(''); setReason('');
      onRecorded();
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  };

  const accepting = outcome === 'accepted';

  return (
    <Dialog open={outcome != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{accepting ? 'Record the acceptance' : 'Record the decline'}</DialogTitle>
          <DialogDescription>
            {accepting
              ? `${proposal.number} was accepted at ${money(proposal.totalPrice)}. The estimate behind it becomes awarded in the same step, so nothing has to be marked twice.`
              : `${proposal.number} was declined. The estimate behind it is marked lost.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {accepting ? (
            <div className="space-y-1.5">
              <Label htmlFor="accept-name">Accepted by</Label>
              <Input id="accept-name" value={name} placeholder="The name on the customer's acceptance"
                onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="answer-reason">Note</Label>
            <Input id="answer-reason" value={reason}
              placeholder={accepting ? 'Signed contract received' : 'Went to a lower bidder'}
              onChange={(e) => setReason(e.target.value)} />
          </div>
          {error ? <ErrorState message={error} /> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || (accepting && name.trim().length === 0)}>
            {busy ? 'Recording…' : accepting ? 'Record acceptance' : 'Record decline'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
