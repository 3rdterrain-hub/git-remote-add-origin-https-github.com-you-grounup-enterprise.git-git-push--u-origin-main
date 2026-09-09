/**
 * One estimate version, live.
 *
 * The workspace next to this file renders the sample estimate — a fixture rich
 * enough to show what the engine produces, and the right thing to show when no
 * workspace is configured. This is the same screen for a real one.
 *
 * Two properties are load-bearing and neither is presentation:
 *
 *   * **No number on this page was typed by anybody.** Since migration 0058 the
 *     engine-owned columns refuse a hand-written value, and the only function
 *     permitted to write them is granted to the service role. The single field
 *     an estimator edits here is the measured quantity, which is an input; the
 *     adjusted and gross quantities that follow from it by waste, loss and
 *     swell are the engine's and are shown, not entered.
 *
 *   * **The buttons say what the database will actually allow.** Approving is
 *     refused for an unpriced version, for the person who built it below chief
 *     authority, and for anything the engine has not cleared to issue. Those
 *     rules live in `app.set_estimate_status` and are enforced there; the
 *     screen states them in advance so nobody discovers one by being refused.
 */
import { Fragment, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Calculator, CheckCircle2,
  Eye, EyeOff, LayoutTemplate, Loader2, Lock, Plus, Search, Send, ShieldCheck,
  BookmarkPlus, GitBranch, GripVertical, Trash2, Wrench, X,
} from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { usePermissions } from '@/lib/data/session';
import { priceEstimateVersion, type PricingOutcome } from '@/lib/data/pricing';
import { PricingOutcomeNotice } from '@/components/pricing-outcome';
import {
  loadVersion, loadDrift, searchServices, setLineQuantity, setEstimateStatus, loadMyCompanyId,
  issueProposal, updateLine, updateVersion, reviseVersion, moveLine, addLines, deleteLine,
  type VersionDetail, type LibraryService, type LineRow,
} from '@/lib/data/estimates';
import { LineDetail } from '@/components/estimate/line-detail';
import { NewLineRow } from '@/components/estimate/new-line-row';
import { LineDescription } from '@/components/estimate/line-description';
import { ClientDescription } from '@/components/estimate/client-description';
import { UnitCostCell, UnitCostEditor } from '@/components/estimate/unit-cost-cell';
import { MarkupCell } from '@/components/estimate/markup-cell';
import { UnitSelect } from '@/components/ui/unit-select';
import { QuantityInput } from '@/components/estimate/quantity-input';
import { PlanTakeoffPanel } from '@/components/estimate/plan-takeoff';
import { CategorySelect } from '@/components/ui/category-select';
import { MarkupPanel } from '@/components/estimate/markup-panel';
import {
  ApplyTemplateDialog, ApplyWarnings, SaveTemplateDialog,
} from '@/components/estimate/templates';
import type { ApplyResult } from '@/lib/data/templates';
import { money, qty, integer, date, titleCase, unitRate } from '@/lib/format';
import { cn } from '@/lib/utils';

/** A version at or past approval is frozen by RULE-009 and cannot be edited. */
const EDITABLE = ['draft', 'in_review'];

const COST_LABELS: Record<string, string> = {
  labor: 'Labor wage', burden: 'Labor burden', equipment: 'Equipment ownership',
  mobilization: 'Equipment mobilization', fuel: 'Fuel & DEF', material: 'Material',
  trucking: 'Trucking', disposal: 'Disposal', subcontract: 'Subcontract', other: 'Other',
};

/**
 * One line, on one line.
 *
 * A grid rather than a table, and the same template on every row, so the
 * columns line up down the whole estimate without a table's insistence on
 * being as wide as the sum of its content. The description takes what is left
 * — it is the field somebody is typing into, and it was the one being squeezed.
 *
 * No minimum width anywhere. A table sizes itself to its content and then makes
 * the screen scroll; this compresses the description and keeps every field on
 * screen, which is what "show all the fields entirely" asks for.
 */
/*
 * The column template, measured against the real screen rather than guessed.
 *
 * Two tracks were too narrow for what was put in them, and a track that is too
 * narrow does not scroll or clip — it overflows and paints over its neighbor.
 *
 *   * Quantity was `4rem` holding a `w-24` input: 96px of box in 64px of track,
 *     overflowing 16px each side, so the input touched the unit picker with no
 *     gap at all.
 *   * The last track was `4rem` holding a confidence badge, which is 91px on
 *     its own before the delete button beside it. The badge spilled 53px to its
 *     left, straight over the total — "not priced" rendered as "not", and on a
 *     priced line it would have covered the last digits of the money.
 *
 * Both are sized to their contents now, and the width comes out of the service
 * column, which is the `1fr` and is 590px wide at this window either way.
 */
const LINE_GRID =
  'grid grid-cols-[9rem_minmax(18rem,1fr)_2rem_5.5rem_5rem_3.5rem_7rem_4.5rem_6rem_8rem_7.5rem] '
  + 'items-center gap-x-3 px-3 py-2';

/** One column name. */
function Col({ children, right, center }: {
  children: React.ReactNode; right?: boolean; center?: boolean;
}) {
  return (
    <span className={cn(
      'text-[11px] font-semibold uppercase tracking-wide text-charcoal-500',
      right && 'text-right', center && 'text-center')}>
      {children}
    </span>
  );
}

/** The same template, as a header, so each column is named once at the top. */
function LineHeader() {
  return (
    <div data-line-header className={cn(LINE_GRID, 'border-b border-charcoal-200 pb-1.5')}>
      <span />
      <Col>Service</Col>
      <span />
      <Col center>Qty</Col>
      <Col center>Unit</Col>
      <Col center>Cond.</Col>
      <Col right>Unit cost</Col>
      <Col center>Markup</Col>
      <Col right>+Markup</Col>
      <Col right>Total</Col>
      <span />
    </div>
  );
}

export function EstimateVersionPage() {
  const { estimateId: versionId } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const version = useQuery(loadVersion(versionId ?? ''), [versionId]);
  const company = useQuery(loadMyCompanyId, []);
  const companyId = company.status === 'ready' ? company.data : null;

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [outcome, setOutcome] = useState<PricingOutcome | null>(null);
  /** The browse-and-tick panel. */
  const [browsing, setBrowsing] = useState(false);
  /*
   * Browsing the library from a row rather than from the toolbar. Held as the
   * line it was opened from, because "add eight things" and "add eight things
   * *here*" are different requests and the second one is the reason an
   * estimator was scrolling in the first place.
   */
  const [browsingAfter, setBrowsingAfter] =
    useState<{ id: string; description: string } | null>(null);
  /*
   * Where a blank row is open: a line id to sit under, '' for the end of the
   * table, null for none. Distinguishing '' from null is what lets the button
   * at the top and the plus on a row use the same row component.
   */
  const [blankAfter, setBlankAfter] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [revising, setRevising] = useState(false);
  const [onlyBlocking, setOnlyBlocking] = useState(false);
  /*
   * Which explanation a figure at the top has been asked for. Every number on
   * those four tiles is already explained further down the page, and until now
   * a reader had to know that. Clicking one opens the section that accounts for
   * it and takes them there.
   */
  const [showing, setShowing] = useState<'buckets' | 'ladder' | 'hours' | null>(null);
  const explain = (which: 'buckets' | 'ladder' | 'hours') => {
    setShowing(which);
    requestAnimationFrame(() => {
      document.getElementById(`explain-${which}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const v: VersionDetail | null = version.status === 'ready' ? version.data : null;

  const run = async (label: string, fn: () => Promise<void>, ok: string) => {
    setBusy(label); setNotice(null);
    try { await fn(); setNotice({ tone: 'ok', text: ok }); version.refetch(); }
    catch (err) { setNotice({ tone: 'bad', text: messageFor(err) }); }
    finally { setBusy(null); }
  };

  const price = async () => {
    if (!versionId) return;
    setBusy('price'); setNotice(null); setOutcome(null);
    try {
      const result = await priceEstimateVersion(versionId);
      setOutcome(result);
      if (result.status === 'priced') version.refetch();
    } finally { setBusy(null); }
  };

  if (version.status === 'demonstration') return null;
  if (version.status === 'loading') return <LoadingState label="Loading estimate" />;
  if (version.status === 'error') {
    return <ErrorState message={version.message} onRetry={version.refetch} />;
  }
  if (!v) {
    return (
      <EmptyState title="That estimate is not here"
        hint={<Link to="/app/estimates" className="text-yellow-700 underline">Back to estimating</Link>} />
    );
  }

  const editable = EDITABLE.includes(v.status);
  const priced = v.calculatedAt != null;
  const unpricedLines = v.lines.filter((l) => l.totalDirectCost === 0 && l.measuredQuantity > 0);
  const blockingLines = v.lines.filter((l) => l.blocksIssue);

  /*
   * Why approval is unavailable, in the order the database checks it. Stating
   * the first blocker rather than all of them keeps the message actionable.
   */
  const approvalBlocker =
    !can('estimates.approve') ? 'You do not have permission to approve an estimate.'
    : v.expired
      ? `This estimate expired on ${date(v.expiresAt!)}. Move the expiry out, or price it again against today's rates.`
    : v.lines.length === 0 ? 'There is nothing on this estimate to approve.'
    : unpricedLines.length > 0
      ? `${unpricedLines.length} line${unpricedLines.length === 1 ? '' : 's'} have a quantity and no price. Price it first.`
    : blockingLines.length > 0
      ? `${blockingLines.length} line${blockingLines.length === 1 ? ' is' : 's are'} not confident enough to bid.`
    : v.blockedFromIssue ? 'The pricing engine has not cleared this estimate.'
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${v.estimateNumber} — ${v.estimateName}`}
        description={
          `Version ${v.versionNumber}${v.customerName ? ` for ${v.customerName}` : ''}, `
          + `created ${date(v.createdAt)}`
          + (v.expiresAt ? `, ${v.expired ? 'expired' : 'valid until'} ${date(v.expiresAt)}` : '')
          + '. '
          + (priced
            ? `Priced by engine ${v.engineVersion} on ${new Date(v.calculatedAt!).toLocaleString()}.`
            : 'Not priced yet — every cost below is zero because nothing has computed one.')
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/app/estimates"><ArrowLeft className="size-4" /> All estimates</Link>
            </Button>
            {editable ? (
              <Button onClick={price} disabled={busy != null || !can('estimates.write') || v.lines.length === 0}>
                {busy === 'price' ? <Loader2 className="size-4 animate-spin" /> : <Calculator className="size-4" />}
                {busy === 'price' ? 'Pricing' : 'Price with engine'}
              </Button>
            ) : null}
            {v.status === 'draft' && can('estimates.write') ? (
              <Button variant="outline"
                onClick={() => run('review', () => setEstimateStatus(supabase!, v.id, 'in_review'), 'Sent for review.')}
                disabled={busy != null || v.lines.length === 0}>
                Send for review
              </Button>
            ) : null}
            {editable ? (
              <Button
                onClick={() => run('approve',
                  () => setEstimateStatus(supabase!, v.id, 'approved'), 'Approved, and the library it was priced from is frozen.')}
                disabled={busy != null || approvalBlocker != null}
                title={approvalBlocker ?? 'Approve this version'}>
                {busy === 'approve' ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                Approve
              </Button>
            ) : null}
            {v.status === 'approved' && can('estimates.issue') ? (
              <Button onClick={() => setIssuing(true)} disabled={busy != null}>
                <Send className="size-4" /> Issue proposal
              </Button>
            ) : null}
            {!editable && can('estimates.write') ? (
              <Button variant="outline" onClick={() => setRevising(true)} disabled={busy != null}>
                <GitBranch className="size-4" /> Create revision
              </Button>
            ) : null}
            {/*
              * Saving a template reads the version; it never edits one, so it
              * is offered on a frozen version too — the templates worth having
              * come from bids that were awarded.
              */}
            {can('estimates.write') && v.lines.length > 0 ? (
              <Button variant="outline" onClick={() => setSavingTemplate(true)}
                disabled={busy != null}>
                <BookmarkPlus className="size-4" /> Save as template
              </Button>
            ) : null}
          </div>
        }
      />

      {notice ? (
        <Alert tone={notice.tone === 'ok' ? 'success' : 'danger'}
          title={notice.tone === 'ok' ? 'Done' : 'That did not happen'}>
          {notice.text}
        </Alert>
      ) : null}

      {outcome ? <PricingOutcomeNotice outcome={outcome} /> : null}

      <ApplyWarnings result={applied} />

      {approvalBlocker && editable ? (
        <Alert tone="warn" title="Not ready to approve">{approvalBlocker}</Alert>
      ) : null}

      {!editable ? (
        <Alert tone="info" title={`This version is ${titleCase(v.status)} and frozen`}>
          RULE-009: its content cannot change. Create revision copies it forward as the next
          version — every line, and the crew, equipment, material, haul, modifiers and markups
          on each — with a stated reason, so the number this bid went out at stays recoverable.
          {v.librarySnapshotId ? ' The library rows that priced it are held with it.' : null}
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Bid price" value={priced ? money(v.bidPrice) : '—'}
          hint={priced ? 'how cost became price' : 'not priced'}
          active={showing === 'ladder'}
          actionLabel="Show how the cost became this price"
          onClick={priced ? () => explain('ladder') : undefined} />
        <StatTile label="Direct cost" value={priced ? money(v.directCost) : '—'}
          hint={priced
            ? `${v.lines.length} line${v.lines.length === 1 ? '' : 's'} · what it is made of`
            : `${v.lines.length} line${v.lines.length === 1 ? '' : 's'}`}
          active={showing === 'buckets'}
          actionLabel="Show what the direct cost is made of"
          onClick={priced ? () => explain('buckets') : undefined} />
        <StatTile label="Labor hours" value={priced ? integer(v.totalLaborHours) : '—'}
          hint={priced ? `${integer(v.totalEquipmentHours)} equipment hours · by line` : 'not priced'}
          active={showing === 'hours'}
          actionLabel="Show the hours line by line"
          onClick={priced ? () => explain('hours') : undefined} />
        {/*
          * The only one of these four with an answer further down the page:
          * blocked means specific lines are blocking, and this shows which.
          */}
        <StatTile label="Cleared to issue" value={v.blockedFromIssue ? 'No' : 'Yes'}
          tone={v.blockedFromIssue ? 'danger' : 'success'}
          hint={v.blockedFromIssue
            ? `${blockingLines.length} line${blockingLines.length === 1 ? '' : 's'} blocking`
            : 'the engine has cleared this'}
          active={onlyBlocking}
          actionLabel="Show only the lines that are blocking this bid"
          onClick={blockingLines.length
            ? () => setOnlyBlocking((n) => !n)
            : undefined} />
      </div>

      {/*
        * The lines get the whole width, and the three explainers sit under them.
        *
        * They used to share a row: `lg:grid-cols-3` with the lines on
        * `col-span-2`, so a third of every screen went to three cards that are
        * read once and then collapsed, and the line item — the thing being
        * worked on all day — was squeezed into two thirds. Which is what made
        * the last fields on a line fall off the edge.
        *
        * A line item is the widest thing in this product. It gets the width.
        */}
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Lines</CardTitle>
              <CardDescription>
                A line takes its unit, cost code and production rate from the library. The
                quantity is the only figure entered here; everything to its right is derived.
              </CardDescription>
            </div>
            {editable && can('estimates.write') ? (
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setApplyingTemplate(true)}>
                  <LayoutTemplate className="size-4" /> From template
                </Button>
                {/*
                  * Two ways in, because they are two jobs. Browsing the library
                  * and ticking eight things needs room; typing a line as you
                  * think of it should never leave the table.
                  */}
                <Button size="sm" variant="outline" onClick={() => setBrowsing(true)}>
                  <Search className="size-4" /> From library
                </Button>
                <Button size="sm" variant="outline" onClick={() => setBlankAfter('')}>
                  <Plus className="size-4" /> Add line
                </Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="p-0">
            {v.lines.length === 0 ? (
              <div className="p-6">
                <EmptyState title="Nothing on this estimate yet"
                  hint={editable && can('estimates.write') ? (
                    <span className="flex items-center justify-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setBrowsing(true)}>
                        <Search className="size-4" /> From library
                      </Button>
                      <Button size="sm" onClick={() => setBlankAfter('')}>
                        <Plus className="size-4" /> Add a line
                      </Button>
                    </span>
                  ) : 'Add a service from the master library, or a line of your own.'} />
              </div>
            ) : (
              <LineTable version={v} editable={editable && can('estimates.write')}
                onlyBlocking={onlyBlocking}
                versionId={v.id}
                blankAfter={blankAfter}
                onAddAfter={setBlankAfter}
                onBrowseAfter={(id, description) => setBrowsingAfter({ id, description })}
                onBlankDone={() => { setBlankAfter(''); version.refetch(); }}
                onBlankCancel={() => setBlankAfter(null)}
                onChanged={version.refetch} />
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          {/*
            * Named for what it answers. "Where the cost is" described the card's
            * purpose to whoever wrote it; "What the cost is made of" says what a
            * reader will find inside, which is the ten buckets RULE-001 keeps
            * apart — labor and its burden, equipment and its mobilization, fuel,
            * material, trucking, disposal, subcontract and everything else.
            */}
          <CollapsibleCard
            id="explain-buckets"
            title="What the cost is made of"
            description="Labor, burden, equipment, mobilization, fuel, material, trucking, disposal and subcontract, kept apart. RULE-001: they are never rolled into one number, because a single figure hides which one moved."
            summary={priced ? money(v.directCost) : 'not priced'}
            open={showing === 'buckets' ? true : undefined}
            onOpenChange={(o) => setShowing(o ? 'buckets' : null)}
          >
            {priced ? <CostBuckets costs={v.costs} total={v.directCost} />
              : <p className="text-sm text-charcoal-500">Nothing has been priced yet.</p>}
          </CollapsibleCard>

          {priced ? (
            <CollapsibleCard
              id="explain-ladder"
              title="From cost to price"
              description="Every step between what the work costs and what the customer is asked for. Nothing here was typed — the engine wrote each figure and this is the order it wrote them in."
              summary={money(v.bidPrice)}
              open={showing === 'ladder' ? true : undefined}
              onOpenChange={(o) => setShowing(o ? 'ladder' : null)}
            >
              <div className="space-y-2 text-sm">
                {([['Direct cost', v.directCost], ['Indirect cost', v.indirectCost],
                   ['Markup', v.totalMarkup], ['Total price', v.totalPrice],
                   ['Bid price', v.bidPrice]] as [string, number][]).map(([label, value], i, a) => (
                  <div key={label}
                    className={`flex items-baseline justify-between gap-3 ${i === a.length - 1 ? 'border-t border-charcoal-200 pt-2 font-medium' : ''}`}>
                    <span className="text-charcoal-600">{label}</span>
                    <span className="tabular text-charcoal-900">{money(value)}</span>
                  </div>
                ))}
              </div>
            </CollapsibleCard>
          ) : null}

          {/*
            * Labor hours had no explanation anywhere on the page: a total with
            * nothing behind it. These are the lines it is the sum of.
            */}
          {priced ? (
            <CollapsibleCard
              id="explain-hours"
              title="Where the hours are"
              description="Labor and equipment hours per line, as the engine computed them from each line's quantity and production rate."
              summary={`${integer(v.totalLaborHours)} labor · ${integer(v.totalEquipmentHours)} equipment`}
              open={showing === 'hours' ? true : undefined}
              onOpenChange={(o) => setShowing(o ? 'hours' : null)}
              defaultOpen={false}
            >
              <div className="space-y-1.5 text-sm">
                {v.lines.filter((l) => l.laborHours > 0 || l.equipmentHours > 0).length === 0 ? (
                  <p className="text-charcoal-500">
                    No line has hours yet. Hours come from a quantity and a production rate, or
                    from a crew and machines that drive them.
                  </p>
                ) : v.lines
                  .filter((l) => l.laborHours > 0 || l.equipmentHours > 0)
                  .map((l) => (
                    <div key={l.id} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-charcoal-600">{l.description}</span>
                      <span className="tabular shrink-0 text-charcoal-900">
                        {integer(l.laborHours)} lab
                        <span className="text-charcoal-400"> · </span>
                        {integer(l.equipmentHours)} eq
                      </span>
                    </div>
                  ))}
              </div>
            </CollapsibleCard>
          ) : null}

          {priced ? (
            <ClientAndInternal version={v} editable={editable && can('estimates.write')}
              onChanged={version.refetch} />
          ) : null}

          <AssumptionsCard version={v} editable={editable && can('estimates.write')}
            onChanged={version.refetch} />

          {v.librarySnapshotId ? <DriftCard versionId={v.id} /> : null}
        </div>
      </div>

      <PlanTakeoffPanel versionId={v.id} estimateId={v.estimateId} companyId={companyId}
        editable={editable && can('estimates.write')} onChanged={version.refetch} />

      <MarkupPanel versionId={v.id} editable={editable && can('estimates.write')}
        directCost={v.directCost} indirectCost={v.indirectCost} storedPrice={v.totalPrice} />

      <AddLinesDialog open={browsing} onOpenChange={setBrowsing} versionId={v.id}
        onAdded={(n) => {
          setBrowsing(false);
          setNotice({ tone: 'ok', text: `Added ${n} line${n === 1 ? '' : 's'} from the library.` });
          version.refetch();
        }} />
      <AddLinesDialog
        open={browsingAfter !== null}
        onOpenChange={(next) => { if (!next) setBrowsingAfter(null); }}
        versionId={v.id}
        afterLineId={browsingAfter?.id ?? null}
        afterDescription={browsingAfter?.description ?? null}
        onAdded={(n) => {
          setBrowsingAfter(null);
          setNotice({ tone: 'ok', text: `Added ${n} line${n === 1 ? '' : 's'} from the library.` });
          version.refetch();
        }} />
      <IssueDialog open={issuing} onOpenChange={setIssuing} version={v}
        onIssued={() => { setIssuing(false); version.refetch(); }} />
      <ReviseDialog open={revising} onOpenChange={setRevising} version={v}
        onRevised={(id) => { setRevising(false); navigate(`/app/estimates/${id}`); }} />
      <SaveTemplateDialog open={savingTemplate} onOpenChange={setSavingTemplate}
        versionId={v.id} lineCount={v.lines.length}
        onSaved={() => {
          setSavingTemplate(false);
          setNotice({ tone: 'ok', text: 'Saved. New estimates can start from it.' });
        }} />
      <ApplyTemplateDialog open={applyingTemplate} onOpenChange={setApplyingTemplate}
        versionId={v.id}
        onApplied={(result) => {
          setApplyingTemplate(false);
          setApplied(result);
          setNotice({
            tone: 'ok',
            text: `Added ${result.linesAdded} line${result.linesAdded === 1 ? '' : 's'}`
              + (result.carriesQuantities
                ? ' with the quantities the template was saved with. Check them against this job.'
                : '. Enter the quantities for this job, then price.'),
          });
          version.refetch();
        }} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function CostBuckets({ costs, total }: { costs: Record<string, number>; total: number }) {
  const rows = Object.entries(costs).filter(([, v]) => v !== 0);
  const max = Math.max(...rows.map(([, v]) => v), 1);
  if (rows.length === 0) return <p className="text-sm text-charcoal-500">No cost in any bucket.</p>;
  return (
    <div className="space-y-2">
      {rows.map(([key, value]) => (
        <div key={key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-charcoal-600">{COST_LABELS[key] ?? titleCase(key)}</span>
            <span className="tabular font-medium text-charcoal-900">
              {money(value)}{' '}
              <span className="text-xs text-charcoal-400">
                {total > 0 ? `${Math.round((value / total) * 100)}%` : ''}
              </span>
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-charcoal-100">
            <div className="h-full rounded-full bg-charcoal-700"
              style={{ width: `${(value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The line table.
 *
 * A quantity is committed on blur rather than on every keystroke, and only when
 * it actually changed — an estimator tabbing across a row should not write five
 * rows to the database, and a version's `updated_at` should mean somebody
 * changed something.
 */
function LineTable({
  version, editable, onlyBlocking = false, versionId, blankAfter = null,
  onAddAfter, onBrowseAfter, onBlankDone, onBlankCancel, onChanged,
}: {
  version: VersionDetail; editable: boolean; onlyBlocking?: boolean;
  versionId?: string;
  /** Where a blank row is open: a line id, '' for the end, null for none. */
  blankAfter?: string | null;
  /** The plus on a row: open a blank row directly beneath this one. */
  onAddAfter?: (lineId: string) => void;
  /** The magnifier on a row: browse the library and insert beneath this one. */
  onBrowseAfter?: (lineId: string, description: string) => void;
  onBlankDone?: () => void;
  onBlankCancel?: () => void;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string[]>([]);
  /** The line being dragged, and the one it is currently hovering after. */
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  /**
   * Which number on which line is being typed, at most one at a time.
   *
   * It lives here rather than in the cell because the editor is a row, and a
   * cell cannot render a sibling row. One at a time is also the honest model: a
   * rate and a markup opening together would be two panels between a line and
   * the next one, and nobody is editing both at once.
   */
  const [editing, setEditing] =
    useState<{ line: string; what: 'rate' | 'markup' } | null>(null);
  /** The line whose delete is asking a second time. */
  const [confirming, setConfirming] = useState<string | null>(null);

  const commit = async (lineId: string, next: number, expression: string | null) => {
    setSaving(lineId); setError(null);
    try { await setLineQuantity(supabase!, lineId, next, expression); onChanged(); }
    catch (err) { setError(messageFor(err)); }
    finally { setSaving(null); }
  };

  /* The unit, changed where it is read rather than behind the wrench. */
  const commitUnit = async (lineId: string, unit: string) => {
    setSaving(lineId); setError(null);
    try { await updateLine(supabase!, lineId, { unit }); onChanged(); }
    catch (err) { setError(messageFor(err)); }
    finally { setSaving(null); }
  };

  const shown = version.lines.filter((l) => !onlyBlocking || l.blocksIssue);
  const hiddenByFilter = version.lines.length - shown.length;

  /*
   * Dropping on a row puts the dragged line after it; dropping on the header
   * strip above the first row puts it first. The database renumbers, so the
   * order that comes back is the order that was asked for rather than an
   * arithmetic that ran out of room between two neighbors.
   */
  const drop = async (afterLineId: string | null) => {
    if (!supabase || !dragging || dragging === afterLineId) {
      setDragging(null); setOver(null); return;
    }
    const moved = dragging;
    setDragging(null); setOver(null); setSaving(moved); setError(null);
    try { await moveLine(supabase, moved, afterLineId); onChanged(); }
    catch (err) { setError(messageFor(err)); }
    finally { setSaving(null); }
  };

  const remove = async (line: LineRow) => {
    if (!supabase) return;
    setSaving(line.id); setError(null);
    try { await deleteLine(supabase, line.id); onChanged(); }
    catch (err) { setError(messageFor(err)); }
    finally { setSaving(null); setConfirming(null); }
  };

  const toggleVisible = async (line: LineRow) => {
    if (!supabase) return;
    setError(null);
    try {
      await updateLine(supabase, line.id, { client_visible: !line.clientVisible });
      onChanged();
    } catch (err) { setError(messageFor(err)); }
  };

  return (
    <>
      {error ? <div className="px-4 pt-4"><ErrorState message={error} /></div> : null}
      {hiddenByFilter > 0 ? (
        <p className="border-b border-charcoal-200 bg-warn-50 px-4 py-2 text-xs text-warn-800">
          {`Showing the ${shown.length} line${shown.length === 1 ? '' : 's'} the engine is `
            + `blocking. ${hiddenByFilter} other`
            + `${hiddenByFilter === 1 ? ' is' : 's are'} hidden — click Cleared to issue `
            + 'again to see them.'}
        </p>
      ) : null}
      {/*
        * Every line is a card, not a row.
        *
        * A table puts ten facts on one horizontal line and asks the screen to
        * be wide enough. It never is: shaving the columns from ten to eight
        * bought one screen size and lost the cost code, and the next screen
        * narrower is back where it started. So the row wraps instead. The
        * description takes the width it needs, the numbers sit under it in a
        * band that reflows, and the whole line is visible at any width without
        * a horizontal scrollbar anywhere.
        *
        * What is given up is column scanning — reading every quantity down a
        * single line. That is worth less here than it looks: an estimator reads
        * a bid line by line, and the totals that are genuinely scanned live in
        * the summary and the cost breakdown above.
        */}
      <div className="divide-y divide-charcoal-100 px-1 pb-2">
          <LineHeader />
          {/*
            * Dropping here puts a line first. Without it the top of the list is
            * the one position a drag cannot reach, since every drop target is
            * "after this row".
            */}
          {editable && dragging ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setOver('__top__'); }}
              onDrop={(e) => { e.preventDefault(); void drop(null); }}
              className={cn('rounded border border-dashed py-1 text-center text-xs',
                over === '__top__'
                  ? 'border-yellow-500 bg-yellow-50 text-yellow-800'
                  : 'border-charcoal-200 text-charcoal-400')}>
              Drop here to put it first
            </div>
          ) : null}
          {shown.map((l, i) => {
            const expanded = open.includes(l.id);
            return (
              <Fragment key={l.id}>
                <div
                  data-line={l.id}
                  className={cn(
                    /*
                      * Flat rows on one hairline, not a stack of cards. Cards
                      * put a border and a gap between every line, which is a
                      * pixel of drift per row against the header and reads as
                      * eleven separate objects rather than one list.
                      */
                    'bg-white',
                    !l.clientVisible && 'bg-charcoal-50/60',
                    over === l.id && 'ring-1 ring-inset ring-yellow-500',
                    dragging === l.id && 'opacity-50',
                  )}
                  onDragOver={editable ? (e) => { e.preventDefault(); setOver(l.id); } : undefined}
                  onDrop={editable ? (e) => { e.preventDefault(); void drop(l.id); } : undefined}
                >
                 <div className={LINE_GRID}>
                  {/*
                    * Only the grip lives at the start of the row. A drag handle
                    * has to be where the row begins to be findable; everything
                    * else the row can do is one cluster at the other end, so an
                    * estimator's eye travels once rather than across the table
                    * and back.
                    */}
                  {/*
                    * Add first, then the handle. The plus is the control an
                    * estimator reaches for most while building a bid, so it
                    * gets the position the eye lands on when it enters a row.
                    */}
                  {/*
                    * Number and eye at the front, with the plus and the grip.
                    *
                    * The eye was at the far end beside the trash, which put a
                    * thing you read — is this on the customer's copy — next to a
                    * thing you press once and regret. It belongs with the line's
                    * identity, where it is visible without hunting for it.
                    */}
                  <div className="flex shrink-0 items-center gap-0.5">
                    {editable && onAddAfter ? (
                          <button onClick={() => onAddAfter(l.id)}
                            aria-label={`Add a line under ${l.description}`}
                            title="Add a line under this one"
                            className="rounded p-1 text-charcoal-400 hover:bg-charcoal-100
                                       hover:text-charcoal-900">
                            <Plus className="size-4" />
                          </button>
                        ) : null}
                        {/*
                          * The library, at the same place and at the same cost.
                          * These are two jobs and putting them behind one menu
                          * would charge the fast one a click it does not owe:
                          * typing a line as you think of it happens thirty
                          * times in a bid, and browsing a trade for eight
                          * things happens twice.
                          */}
                        {onBrowseAfter ? (
                          <button onClick={() => onBrowseAfter(l.id, l.description)}
                            aria-label={`Add from the library under ${l.description}`}
                            title="Add from the library under this one"
                            className="rounded p-1 text-charcoal-400 hover:bg-charcoal-100
                                       hover:text-charcoal-900">
                            <Search className="size-4" />
                          </button>
                        ) : null}
                        {editable ? (
                          <span
                            draggable
                            onDragStart={() => setDragging(l.id)}
                            onDragEnd={() => { setDragging(null); setOver(null); }}
                            role="button"
                            tabIndex={0}
                            aria-label={`Drag to reorder ${l.description}`}
                            title="Drag to reorder"
                            className="inline-flex cursor-grab rounded p-0.5 text-charcoal-300 hover:text-charcoal-600 active:cursor-grabbing"
                          >
                            <GripVertical className="size-4" />
                          </span>
                        ) : null}
                    <span className="tabular w-6 shrink-0 text-right text-xs text-charcoal-400">
                      {l.lineNumber ?? i + 1}
                    </span>
                    <button onClick={editable ? () => toggleVisible(l) : undefined}
                      disabled={!editable}
                      aria-label={l.clientVisible
                        ? `Hide ${l.description} from the proposal`
                        : `Show ${l.description} on the proposal`}
                      title={l.clientVisible
                        ? 'On the customer proposal. Click to keep it priced but off the document.'
                        : 'Priced, and off the customer proposal. Click to show it.'}
                      className={cn('rounded p-1 disabled:opacity-100',
                        l.clientVisible
                          ? 'text-charcoal-400 hover:bg-charcoal-100 hover:text-charcoal-900'
                          : 'text-warn-600 hover:bg-warn-50')}>
                      {l.clientVisible ? <Eye className="size-4" />
                                       : <EyeOff className="size-4" />}
                    </button>
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5">
                      {l.blocksIssue ? (
                        <AlertTriangle className="size-3.5 shrink-0 text-danger-600"
                          aria-label="This line blocks issue" />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <LineDescription
                          lineId={l.id}
                          description={l.description}
                          serviceName={l.serviceName}
                          serviceId={l.serviceId}
                          editable={editable}
                          onChanged={onChanged} />
                        {/*
                          * Under the title: which library item this is, then
                          * what the customer reads. Two different audiences on
                          * one line — the estimator's words and the client's.
                          */}
                        <div className="flex min-w-0 items-baseline gap-2">
                          <span className={cn('shrink-0 text-xs',
                            l.serviceId ? 'text-charcoal-500' : 'text-charcoal-400')}>
                            {l.serviceName ?? 'Typed'}
                          </span>
                          <ClientDescription
                            lineId={l.id}
                            description={l.description}
                            value={l.notes}
                            editable={editable}
                            onChanged={onChanged} />
                        </div>
                      </div>
                  </div>
                  {/*
                    * The wrench sits at the end of what the line is, where
                    * somebody stops reading it and starts asking what it is
                    * built from.
                    */}
                  <div className="shrink-0">
                    <button
                      onClick={() => setOpen((o) =>
                        o.includes(l.id) ? o.filter((x) => x !== l.id) : [...o, l.id])}
                      aria-label={expanded
                        ? `Hide the crew, equipment, material and haul on ${l.description}`
                        : `Crew, equipment, material and haul on ${l.description}`}
                      title="Crew, equipment, material and haul"
                      aria-expanded={expanded}
                      className={cn(
                        'rounded p-1 hover:bg-charcoal-100 hover:text-charcoal-900',
                        expanded ? 'bg-charcoal-100 text-charcoal-900' : 'text-charcoal-400',
                      )}>
                      <Wrench className="size-4" />
                    </button>
                  </div>
                  <div className="min-w-0">
                    {editable ? (
                      <div className="flex items-center justify-center gap-1.5">
                        {saving === l.id
                          ? <Loader2 className="size-3.5 animate-spin text-charcoal-400" /> : null}
                        {/*
                          * The cell takes the arithmetic, not just its answer.
                          * `120 * 4 * 0.667` is what the estimator has in their
                          * head, and keeping it is what lets a reviewer ask
                          * what the number is of.
                          */}
                        <QuantityInput
                          quantity={l.measuredQuantity}
                          expression={l.quantityExpression}
                          unit={l.unit}
                          label={`Quantity for ${l.description}`}
                          onCommit={(n, expr) => commit(l.id, n, expr)} />
                      </div>
                    ) : (
                      <span className="tabular">
                        {qty(l.measuredQuantity)}
                        {l.quantityExpression ? (
                          <span className="block text-xs font-normal text-charcoal-400">
                            {l.quantityExpression}
                          </span>
                        ) : null}
                      </span>
                    )}
                    {/*
                      * Nothing under the quantity.
                      *
                      * A note lived here — the quantity net of waste and loss —
                      * and it was asked for gone: "no text under quantity in
                      * estimator". It is not lost. Waste is a property of the
                      * line rather than of the number typed into it, so it is
                      * read and set in the wrench panel with the rest of what
                      * the line is made of, and the gross quantity the engine
                      * actually prices is on the line's own detail.
                      *
                      * The cell holds one control and nothing else, which is
                      * also what keeps every row the same height: this note
                      * wrapped to four lines in a column five characters wide
                      * and took its row from 63px to 99px.
                      */}
                  </div>
                  {/*
                    * The unit, in its own column. A company that bids topsoil by
                    * the load rather than the cubic yard is not making a
                    * mistake, and migration 0117 stopped refusing it — the
                    * picker is what keeps that reachable.
                    */}
                  <div className="min-w-0">
                    {editable ? (
                      <UnitSelect
                        value={l.unit}
                        label={`Unit for ${l.description}`}
                        className="h-8 w-full"
                        onChange={(u) => commitUnit(l.id, u)} />
                    ) : (
                      <span className="block text-center text-sm text-charcoal-600">{l.unit}</span>
                    )}
                  </div>
                  {/*
                    * The condition factor, on the line. 1.0x is normal ground;
                    * anything else is a decision somebody made about this line
                    * and it should be visible without opening the panel.
                    */}
                  <div className="tabular min-w-0 text-center text-sm text-charcoal-500">
                    {l.productionModifier === 1
                      ? <span className="text-charcoal-400">1.0x</span>
                      : <span className="font-medium text-charcoal-900">{l.productionModifier}x</span>}
                  </div>
                  <div className="min-w-0 text-right">
                    <UnitCostCell
                      description={l.description}
                      unit={l.unit}
                      unitCost={l.unitCost}
                      typedRate={l.parametricCostPerUnit}
                      basis={l.parametricBasis}
                      hasResources={l.totalDirectCost > 0 && l.parametricCostPerUnit === null}
                      editable={editable}
                      open={editing?.line === l.id && editing.what === 'rate'}
                      onOpen={(next) => setEditing(next ? { line: l.id, what: 'rate' } : null)} />
                  </div>
                  <div className="min-w-0 text-center">
                    <MarkupCell
                      lineId={l.id}
                      description={l.description}
                      markupOverride={l.markupOverride}
                      editable={editable}
                      onChanged={onChanged} />
                  </div>
                  {/*
                    * The money the markup adds, in its own column, so the
                    * decision is a figure rather than an inference from two
                    * others.
                    */}
                  <div className="tabular min-w-0 text-right text-sm text-charcoal-600">
                    {l.markupAmount
                      ? `+${money(l.markupAmount)}`
                      : <span className="text-charcoal-300">—</span>}
                  </div>
                  {/*
                    * What the line sells for, with the rate a customer reads on
                    * a unit-price bid underneath it.
                    */}
                  <div className="min-w-0 text-right">
                    <span className="tabular text-base font-semibold text-charcoal-900">
                      {l.totalPrice ? money(l.totalPrice)
                        : l.totalDirectCost ? money(l.totalDirectCost)
                        : <span className="text-sm font-normal text-charcoal-400">not priced</span>}
                    </span>
                    {l.unitPrice ? (
                      <span className="tabular block text-[11px] text-charcoal-400">
                        eff. {unitRate(l.unitPrice)}/{l.unit}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-end gap-1">
                      <Badge variant={l.confidenceBand === 'do_not_price' ? 'danger'
                        : l.confidenceBand === 'high' ? 'success' : 'warn'}>
                        {titleCase(l.confidenceBand)}
                      </Badge>
                      {/* What is left at the end: disclosure, and removal. */}
                      {/*
                        * What the eye does, in words. An icon that toggles
                        * something invisible is an icon nobody trusts: the line
                        * is priced either way, and what changes is whether the
                        * customer's copy itemizes it.
                        */}
                      {!l.clientVisible ? (
                        <Badge variant="default" className="whitespace-nowrap">
                          not on proposal
                        </Badge>
                      ) : null}
                      {editable ? (
                        confirming === l.id ? (
                          <span className="flex items-center gap-1">
                            <button onClick={() => remove(l)} disabled={saving === l.id}
                              aria-label={`Confirm removing ${l.description}`}
                              className="rounded bg-danger-600 px-1.5 py-1 text-xs font-medium text-white hover:bg-danger-700">
                              {saving === l.id ? 'Removing' : 'Remove'}
                            </button>
                            <button onClick={() => setConfirming(null)}
                              aria-label="Keep this line"
                              className="rounded p-1 text-charcoal-400 hover:bg-charcoal-100">
                              <X className="size-3.5" />
                            </button>
                          </span>
                        ) : (
                          <button onClick={() => setConfirming(l.id)}
                            aria-label={`Remove ${l.description}`}
                            title="Remove this line"
                            className="rounded p-1 text-charcoal-400 hover:bg-danger-50
                                       hover:text-danger-700">
                            <Trash2 className="size-3.5" />
                          </button>
                        )
                      ) : null}
                    </div>
                 </div>

                {/*
                  * The rate and the markup open inside the card, under the
                  * numbers band, so the field being typed keeps its place on
                  * the line it belongs to.
                  */}
                {editing?.line === l.id && editing.what === 'rate' ? (
                  <UnitCostEditor
                    lineId={l.id}
                    description={l.description}
                    typedRate={l.parametricCostPerUnit}
                    basis={l.parametricBasis}
                    hasResources={l.totalDirectCost > 0 && l.parametricCostPerUnit === null}
                    onClose={() => setEditing(null)}
                    onChanged={onChanged} />
                ) : null}

                {expanded ? (
                  <div className="border-t border-charcoal-100">
                    <LineDetail line={l} editable={editable} onChanged={onChanged} />
                  </div>
                ) : null}
                </div>

                {blankAfter === l.id && versionId ? (
                  <NewLineRow versionId={versionId} afterLineId={l.id}
                    onDone={() => onBlankDone?.()} onCancel={() => onBlankCancel?.()} />
                ) : null}
              </Fragment>
            );
          })}

          {blankAfter === '' && versionId ? (
            <NewLineRow versionId={versionId} afterLineId={null}
              onDone={() => onBlankDone?.()} onCancel={() => onBlankCancel?.()} />
          ) : null}
      </div>
      {/* The total, on the same band the cards use, so it lines up with them. */}
      <div className="flex items-center gap-x-6 border-t border-charcoal-200 px-5 py-3">
        <span className="font-medium text-charcoal-900">
          Direct cost
          {hiddenByFilter > 0 ? (
            <span className="ml-1.5 font-normal text-charcoal-500">
              — the whole estimate, not the {shown.length} shown
            </span>
          ) : null}
        </span>
        <span className="tabular ml-auto font-medium text-charcoal-900">
          {money(version.directCost)}
        </span>
      </div>
    </>
  );
}

/**
 * Shopping the library: browse, tick several, add them together.
 *
 * This is the bulk path, and it is deliberately not the same control as the
 * blank row in the table. An estimator adding a line as they think of it is
 * typing; an estimator pulling eight things out of a trade is browsing, and
 * browsing needs room to see what has been ticked. One gesture forced to serve
 * both would be worse at each.
 *
 * The whole selection goes in one call, so eight lines are added completely or
 * not at all — five lines and an error is the worst outcome available, because
 * it looks like a complete addition.
 */
function AddLinesDialog({
  open, onOpenChange, versionId, afterLineId = null, afterDescription = null, onAdded,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; versionId: string;
  afterLineId?: string | null;
  afterDescription?: string | null;
  onAdded: (count: number) => void;
}) {
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState('');
  /** Ticked services, kept as a map so the order of ticking is the order added. */
  const [picked, setPicked] = useState<LibraryService[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const services = useQuery(searchServices(term, category || null), [term, category, open]);
  const results = services.status === 'ready' ? services.data : [];
  const isPicked = (id: string) => picked.some((p) => p.id === id);

  /* Results by category, in the order the categories first appear. */
  const grouped = (() => {
    const byCategory = new Map<string, LibraryService[]>();
    for (const s of results) {
      const key = s.category ?? 'Uncategorized';
      byCategory.set(key, [...(byCategory.get(key) ?? []), s]);
    }
    return [...byCategory.entries()];
  })();

  const toggle = (s: LibraryService) => {
    setPicked((p) => isPicked(s.id) ? p.filter((x) => x.id !== s.id) : [...p, s]);
  };

  const reset = () => { setPicked([]); setTerm(''); setCategory(''); setError(null); };

  const submit = async () => {
    if (!supabase || picked.length === 0) return;
    setBusy(true); setError(null);
    try {
      await addLines(supabase, {
        versionId,
        afterLineId,
        /*
         * Quantities are left at zero on purpose. Somebody ticking eight
         * services is choosing scope, not measuring — and a quantity invented
         * here is one nobody entered that would still price.
         */
        lines: picked.map((p) => ({ serviceId: p.id, unit: p.defaultUnit })),
      });
      const n = picked.length;
      reset();
      onAdded(n);
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      {/*
        * Wide, and tall. This is a window onto 860 services in 82 categories —
        * a dialog sized for a form makes an estimator scroll a six-row porthole
        * through a catalog.
        */}
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Add from the library</DialogTitle>
          <DialogDescription>
            {afterDescription ? `They go directly under "${afterDescription}". ` : ''}
            Tick everything this bid needs and add it in one go. Each line brings its unit, cost
            code and production rate; quantities start at zero, because nobody has measured them
            yet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
            <div className="space-y-1.5">
              <Label htmlFor="lib-search">Search the library</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal-400" />
                <Input id="lib-search" className="pl-9" value={term}
                  placeholder="Excavation, paving, storm sewer…"
                  onChange={(e) => setTerm(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lib-cat">Category</Label>
              <CategorySelect id="lib-cat" kind="service_category"
                label="category to search within" canAdd={false}
                value={category} onChange={setCategory} />
            </div>
          </div>

          <div className="max-h-[26rem] overflow-y-auto rounded-lg border border-charcoal-200">
            {services.status === 'loading' ? (
              <div className="p-4"><LoadingState label="Searching the library" /></div>
            ) : results.length === 0 ? (
              <p className="p-3 text-sm text-charcoal-500">
                Nothing matched. Narrow the category, or add a line of your own from the table.
              </p>
            ) : grouped.map(([category, rows]) => (
              <Fragment key={category}>
                {/*
                  * Grouped the way the library is organized. A flat list of
                  * fifty services from six trades makes an estimator read every
                  * row to find the two that belong to the work in front of them.
                  */}
                <p className="sticky top-0 z-10 border-b border-charcoal-200 bg-charcoal-50 px-3 py-1.5
                              text-[11px] font-semibold uppercase tracking-[0.12em] text-charcoal-600">
                  {category}
                  <span className="ml-1.5 font-normal normal-case tracking-normal text-charcoal-400">
                    {rows.length}
                  </span>
                </p>
                {rows.map((s) => (
                  <label key={s.id}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-3 border-b border-charcoal-100 px-3 py-2 last:border-0',
                      isPicked(s.id) ? 'bg-yellow-50' : 'hover:bg-charcoal-50',
                    )}>
                    <input type="checkbox" checked={isPicked(s.id)} onChange={() => toggle(s)}
                      aria-label={`Add ${s.name}`}
                      className="size-4 shrink-0 accent-yellow-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-charcoal-900">{s.name}</span>
                      <span className="block text-xs text-charcoal-500">{s.code}</span>
                    </span>
                    <Badge variant={s.isOwn ? 'info' : 'default'}>
                      {s.isOwn ? 'yours' : s.defaultUnit}
                    </Badge>
                  </label>
                ))}
              </Fragment>
            ))}
          </div>

          {picked.length > 0 ? (
            <p className="text-xs text-charcoal-600">
              {picked.length} ticked. They keep the order you ticked them in, and a search that
              changes does not lose the ones already chosen.
            </p>
          ) : null}

          {error ? <ErrorState message={error} /> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || picked.length === 0}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {busy ? 'Adding…'
              : picked.length === 0 ? 'Add lines'
              : `Add ${picked.length} line${picked.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Issuing the proposal that goes to the customer. */
function IssueDialog({ open, onOpenChange, version, onIssued }: {
  open: boolean; onOpenChange: (v: boolean) => void; version: VersionDetail; onIssued: () => void;
}) {
  const [title, setTitle] = useState('');
  const [cover, setCover] = useState('');
  const [validity, setValidity] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!supabase) return;
    setBusy(true); setError(null);
    try {
      await issueProposal(supabase, {
        versionId: version.id, title, coverLetter: cover,
        validityDays: Number(validity) || 30,
      });
      onIssued();
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue proposal</DialogTitle>
          <DialogDescription>
            The price is copied onto the proposal rather than read through a join. If this
            estimate is later revised, the document the customer was sent still says
            {' '}{money(version.bidPrice)}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="prop-title">Title</Label>
            <Input id="prop-title" value={title} placeholder={version.estimateName}
              onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prop-cover">Cover letter</Label>
            <Input id="prop-cover" value={cover} placeholder="Thank you for the opportunity."
              onChange={(e) => setCover(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prop-validity">Valid for (days)</Label>
            <Input id="prop-validity" type="number" min={1} value={validity}
              onChange={(e) => setValidity(e.target.value)} className="w-32" />
          </div>
          {error ? <ErrorState message={error} /> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            <Send className="size-4" /> {busy ? 'Issuing…' : `Issue at ${money(version.bidPrice)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What has moved in the library since this version was priced.
 *
 * The question somebody asks before re-issuing an old bid. `app.snapshot_drift`
 * has answered it since migration 0026 and had no caller, because nothing took
 * a snapshot to ask about.
 */
function DriftCard({ versionId }: { versionId: string }) {
  const drift = useQuery(loadDrift(versionId), [versionId]);
  const rows = drift.status === 'ready' ? drift.data : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="size-4 text-charcoal-500" /> Priced from a frozen library
        </CardTitle>
        <CardDescription>
          The rows this version was priced from are held with it, so the number stays
          reproducible when the catalog moves.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {drift.status === 'loading' ? <LoadingState label="Checking the library" /> : null}
        {drift.status === 'error' ? <ErrorState message={drift.message} /> : null}
        {drift.status === 'ready' && rows.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-charcoal-600">
            <CheckCircle2 className="size-4 text-success-600" />
            Nothing it was priced with has changed.
          </p>
        ) : null}
        {rows.length > 0 ? (
          <ul className="space-y-1.5 text-sm">
            {rows.slice(0, 12).map((d) => (
              <li key={`${d.kind}:${d.sourceId}`} className="flex items-center justify-between gap-3">
                <span className="text-charcoal-600">{titleCase(d.kind.replace(/_/g, ' '))}</span>
                <Badge variant={d.status === 'deleted' ? 'danger' : 'warn'}>{titleCase(d.status)}</Badge>
              </li>
            ))}
            {rows.length > 12 ? (
              <li className="text-xs text-charcoal-500">and {rows.length - 12} more</li>
            ) : null}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}


/**
 * What the customer is shown, beside what the company knows.
 *
 * Two columns because they are genuinely two numbers. The client total is the
 * lines the customer sees; the internal total is every line, including the ones
 * left off the document, and it is the figure a company decides by.
 *
 * The switches control disclosure of the build-up, not the price. Turning off
 * labor does not make the estimate cheaper — it stops the proposal itemizing
 * what the crew costs, which is a presentation choice and not an arithmetic
 * one. Saying so here matters, because a switch that looked like it changed
 * the number would be the most expensive misunderstanding on the screen.
 */
function ClientAndInternal({ version: v, editable, onChanged }: {
  version: VersionDetail; editable: boolean; onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const set = async (fields: Record<string, unknown>) => {
    if (!supabase) return;
    setError(null);
    try { await updateVersion(supabase, v.id, fields); onChanged(); }
    catch (err) { setError(messageFor(err)); }
  };

  const hidden = v.lines.filter((l) => !l.clientVisible);
  const hiddenCost = hidden.reduce((a, l) => a + l.totalDirectCost, 0);
  /*
   * Scaled by the one ratio the engine produced, so the client figure and the
   * internal figure differ by exactly the hidden lines and not by a rounding
   * of two separate calculations.
   */
  const factor = v.directCost > 0 ? v.totalPrice / v.directCost : 0;
  const clientTotal = v.totalPrice - hiddenCost * factor;

  const SWITCHES: Array<[keyof VersionDetail['show'], string, string]> = [
    ['labor', 'Labor', 'show_labor'],
    ['equipment', 'Equipment', 'show_equipment'],
    ['hauling', 'Hauling', 'show_hauling'],
    ['materials', 'Materials', 'show_materials'],
    ['subcontract', 'Subs', 'show_subcontract'],
  ];

  return (
    <CollapsibleCard
      title="What the customer sees"
      description="These switch what the proposal itemizes, not what the estimate costs. Turning off labor does not make the job cheaper — it stops the document breaking out what the crew costs."
      summary={`${hidden.length} line${hidden.length === 1 ? '' : 's'} hidden from the proposal`}
      defaultOpen={false}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {SWITCHES.map(([key, label, column]) => (
            <button key={key} type="button" disabled={!editable}
              aria-pressed={v.show[key]}
              onClick={() => set({ [column]: !v.show[key] })}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
                v.show[key]
                  ? 'border-charcoal-300 bg-white text-charcoal-800'
                  : 'border-charcoal-200 bg-charcoal-100 text-charcoal-400',
                editable ? 'hover:border-charcoal-400' : 'cursor-default',
              )}>
              {v.show[key] ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
              {label}
            </button>
          ))}
        </div>

        {error ? <ErrorState message={error} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-[--radius-card] border border-yellow-400 bg-yellow-50/40 p-3">
            <p className="text-sm font-semibold text-charcoal-900">Client estimate</p>
            <p className="text-xs text-charcoal-500">
              {hidden.length > 0
                ? `${hidden.length} line${hidden.length === 1 ? '' : 's'} left off the document.`
                : 'Every line appears on the document.'}
            </p>
            <dl className="mt-2 space-y-1 text-sm">
              <Line label="Subtotal" value={money(clientTotal)} />
              <Line label="Client total" value={money(clientTotal)} strong />
            </dl>
          </div>

          <div className="rounded-[--radius-card] border border-charcoal-200 p-3">
            <p className="text-sm font-semibold text-charcoal-900">Internal reference</p>
            <p className="text-xs text-charcoal-500">
              Every line, including the ones the customer does not see.
            </p>
            <dl className="mt-2 space-y-1 text-sm">
              <Line label="Direct cost" value={money(v.directCost)} />
              <Line label="Indirect cost" value={money(v.indirectCost)} />
              <Line label="Markup" value={money(v.totalMarkup)} />
              <Line label="Internal total" value={money(v.totalPrice)} strong />
            </dl>
          </div>
        </div>

        {hidden.length > 0 ? (
          <p className="text-xs text-charcoal-500">
            The two differ by {money(hiddenCost * factor)} — the lines marked hidden. They are
            still priced, still in the internal total, and still what the company is deciding on.
          </p>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3',
      strong && 'border-t border-charcoal-200 pt-1 font-medium')}>
      <dt className="text-charcoal-600">{label}</dt>
      <dd className="tabular text-charcoal-900">{value}</dd>
    </div>
  );
}

/**
 * Copying a frozen version forward.
 *
 * The reason is not ceremony. A version history where every entry says
 * "revision" explains nothing six months later, when somebody is asking why
 * the price moved; the database refuses one shorter than five characters and
 * this says so before the refusal rather than after it.
 */
function ReviseDialog({ open, onOpenChange, version, onRevised }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  version: VersionDetail;
  onRevised: (newVersionId: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!supabase || reason.trim().length < 5) return;
    setBusy(true); setError(null);
    try {
      const id = await reviseVersion(supabase, version.id, reason);
      setReason('');
      onRevised(id);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create revision</DialogTitle>
          <DialogDescription>
            Version {version.versionNumber} stays exactly as it is. Version {version.versionNumber + 1}
            {' '}starts as a copy of it — every line, with the crew, equipment, material, haul,
            modifiers and markups on each — unpriced, so the engine prices it against today's
            rates.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rev-reason">Why this revision exists</Label>
            <Input id="rev-reason" value={reason} autoFocus
              placeholder="Owner moved the pond outlet"
              onChange={(e) => setReason(e.target.value)} />
            <p className="text-xs text-charcoal-500">
              This is what the history will say. A reason under five characters is refused.
            </p>
          </div>
          {error ? <ErrorState message={error} /> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || reason.trim().length < 5}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <GitBranch className="size-4" />}
            {busy ? 'Copying…' : 'Create revision'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The estimator's own assumptions for this bid.
 *
 * Every field here changes what the job costs, and every one of them arrived in
 * migration 0006 with a default and no way to set it. So until now a company
 * bidding at $4.10 diesel priced its fuel at zero, and a coastal job in sand
 * swelled like inland clay, because 0.25 was the number the column happened to
 * default to.
 *
 * Held on the version rather than the company on purpose: these are facts about
 * *this* job. Changing them re-prices this estimate and nothing else.
 */
function AssumptionsCard({ version: v, editable, onChanged }: {
  version: VersionDetail; editable: boolean; onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const a = v.assumptions;

  const commit = async (column: string, raw: string, current: number) => {
    if (!supabase) return;
    const next = Number(raw);
    if (!Number.isFinite(next) || next === current) return;
    setError(null);
    try { await updateVersion(supabase, v.id, { [column]: next }); onChanged(); }
    catch (err) { setError(messageFor(err)); }
  };

  /* label, column, current value, step, and what it does to the price. */
  const FIELDS: Array<[string, string, number, string, string]> = [
    ['Shift hours', 'shift_hours', a.shiftHours, '0.5',
     'The working day a production rate is spread over.'],
    ['Calendar efficiency', 'calendar_efficiency', a.calendarEfficiency, '0.01',
     'The share of the shift that is production. 0.8 means eight hours in ten.'],
    ['Diesel, $/gal', 'fuel_price_per_gallon', a.fuelPricePerGallon, '0.01',
     'Zero prices the fuel at nothing, which is what it did before this field existed.'],
    ['DEF, $/gal', 'def_price_per_gallon', a.defPricePerGallon, '0.01',
     'Priced alongside diesel on the machines that burn it.'],
    ['Swell', 'swell_percent', a.swellPercent, '0.01',
     'Bank to loose. Sand does not swell like clay.'],
    ['Shrink', 'shrink_percent', a.shrinkPercent, '0.01',
     'Loose to compacted, for fill.'],
    ['Bid rounding', 'bid_rounding_increment', a.bidRoundingIncrement, '100',
     'Rounds the bid price up to this increment. Zero leaves it exact.'],
  ];

  return (
    <CollapsibleCard
      title="This bid's assumptions"
      description="The engine reads these off this version. They are facts about this job, not the company — changing one re-prices this estimate and nothing else."
      summary={`${a.shiftHours} hr shift · diesel ${money(a.fuelPricePerGallon)} · swell ${Math.round(a.swellPercent * 100)}%`}
      defaultOpen={false}
    >
      <div className="space-y-3">
        {FIELDS.map(([label, column, value, step, hint]) => (
          <div key={column} className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor={`asm-${column}`} className="text-charcoal-800">{label}</Label>
              <p className="text-xs text-charcoal-500">{hint}</p>
            </div>
            <Input id={`asm-${column}`} type="number" step={step} min="0"
              defaultValue={value} disabled={!editable}
              className="tabular w-28 shrink-0 text-right"
              onBlur={(e) => commit(column, e.target.value, value)}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          </div>
        ))}
        {error ? <ErrorState message={error} /> : null}
        {editable ? (
          <p className="text-xs text-charcoal-500">
            Price the estimate again after changing one; nothing recalculates on its own,
            because the engine is the only thing permitted to write a cost.
          </p>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}
