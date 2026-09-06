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
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Calculator, CheckCircle2, ChevronDown, ChevronRight,
  Eye, EyeOff, Loader2, Lock, Plus, Search, Send, ShieldCheck, Trash2,
} from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { usePermissions } from '@/lib/data/session';
import { priceEstimateVersion, type PricingOutcome } from '@/lib/data/pricing';
import { PricingOutcomeNotice } from '@/components/pricing-outcome';
import {
  loadVersion, loadDrift, searchServices, addLine, setLineQuantity, setEstimateStatus,
  issueProposal, updateLine, updateVersion,
  type VersionDetail, type LibraryService, type LineRow,
} from '@/lib/data/estimates';
import { LineDetail } from '@/components/estimate/line-detail';
import { UnitSelect } from '@/components/ui/unit-select';
import { MarkupPanel } from '@/components/estimate/markup-panel';
import { money, qty, integer, unitRate, date, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

/** A version at or past approval is frozen by RULE-009 and cannot be edited. */
const EDITABLE = ['draft', 'in_review'];

const COST_LABELS: Record<string, string> = {
  labor: 'Labor wage', burden: 'Labor burden', equipment: 'Equipment ownership',
  mobilization: 'Equipment mobilization', fuel: 'Fuel & DEF', material: 'Material',
  trucking: 'Trucking', disposal: 'Disposal', subcontract: 'Subcontract', other: 'Other',
};

export function EstimateVersionPage() {
  const { estimateId: versionId } = useParams();
  const { can } = usePermissions();
  const version = useQuery(loadVersion(versionId ?? ''), [versionId]);

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [outcome, setOutcome] = useState<PricingOutcome | null>(null);
  const [adding, setAdding] = useState(false);
  const [issuing, setIssuing] = useState(false);

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

      {approvalBlocker && editable ? (
        <Alert tone="warn" title="Not ready to approve">{approvalBlocker}</Alert>
      ) : null}

      {!editable ? (
        <Alert tone="info" title={`This version is ${titleCase(v.status)} and frozen`}>
          RULE-009: its content cannot change. A revision copies it forward as the next version
          with a stated reason, so the number this bid went out at stays recoverable.
          {v.librarySnapshotId ? ' The library rows that priced it are held with it.' : null}
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Bid price" value={priced ? money(v.bidPrice) : '—'}
          hint={priced ? 'what the engine computed' : 'not priced'} />
        <StatTile label="Direct cost" value={priced ? money(v.directCost) : '—'}
          hint={`${v.lines.length} line${v.lines.length === 1 ? '' : 's'}`} />
        <StatTile label="Labor hours" value={priced ? integer(v.totalLaborHours) : '—'}
          hint={priced ? `${integer(v.totalEquipmentHours)} equipment hours` : 'not priced'} />
        <StatTile label="Cleared to issue" value={v.blockedFromIssue ? 'No' : 'Yes'}
          tone={v.blockedFromIssue ? 'danger' : 'success'}
          hint={v.blockedFromIssue ? 'the engine has blocked this' : 'the engine has cleared this'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Lines</CardTitle>
              <CardDescription>
                A line takes its unit, cost code and production rate from the library. The
                quantity is the only figure entered here; everything to its right is derived.
              </CardDescription>
            </div>
            {editable && can('estimates.write') ? (
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus className="size-4" /> Add line
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="p-0">
            {v.lines.length === 0 ? (
              <div className="p-6">
                <EmptyState title="Nothing on this estimate yet"
                  hint="Add a service from the master library, or a line of your own." />
              </div>
            ) : (
              <LineTable version={v} editable={editable && can('estimates.write')}
                onChanged={version.refetch} />
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Where the cost is</CardTitle>
              <CardDescription>
                RULE-001: the buckets stay separately visible and are never rolled into one number.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {priced ? <CostBuckets costs={v.costs} total={v.directCost} />
                : <p className="text-sm text-charcoal-500">Nothing has been priced yet.</p>}
            </CardContent>
          </Card>

          {priced ? (
            <Card>
              <CardHeader><CardTitle>From cost to price</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {([['Direct cost', v.directCost], ['Indirect cost', v.indirectCost],
                   ['Markup', v.totalMarkup], ['Total price', v.totalPrice],
                   ['Bid price', v.bidPrice]] as [string, number][]).map(([label, value], i, a) => (
                  <div key={label}
                    className={`flex items-baseline justify-between gap-3 ${i === a.length - 1 ? 'border-t border-charcoal-200 pt-2 font-medium' : ''}`}>
                    <span className="text-charcoal-600">{label}</span>
                    <span className="tabular text-charcoal-900">{money(value)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {priced ? (
            <ClientAndInternal version={v} editable={editable && can('estimates.write')}
              onChanged={version.refetch} />
          ) : null}

          {v.librarySnapshotId ? <DriftCard versionId={v.id} /> : null}
        </div>
      </div>

      <MarkupPanel versionId={v.id} editable={editable && can('estimates.write')} />

      <AddLineDialog open={adding} onOpenChange={setAdding} versionId={v.id}
        onAdded={() => { setAdding(false); version.refetch(); }} />
      <IssueDialog open={issuing} onOpenChange={setIssuing} version={v}
        onIssued={() => { setIssuing(false); version.refetch(); }} />
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
function LineTable({ version, editable, onChanged }: {
  version: VersionDetail; editable: boolean; onChanged: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string[]>([]);

  const commit = async (lineId: string, raw: string, was: number) => {
    const next = Number(raw);
    if (!Number.isFinite(next) || next < 0 || next === was) return;
    setSaving(lineId); setError(null);
    try { await setLineQuantity(supabase!, lineId, next); onChanged(); }
    catch (err) { setError(messageFor(err)); }
    finally { setSaving(null); }
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Line</TableHead>
            <TableHead>Cost code</TableHead>
            <TableHead className="text-right">Quantity</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead className="text-right">Unit cost</TableHead>
            <TableHead className="text-right">Markup</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Confidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {version.lines.map((l) => {
            const expanded = open.includes(l.id);
            return (
              <Fragment key={l.id}>
                <TableRow className={cn(!l.clientVisible && 'bg-charcoal-50/70')}>
                  <TableCell className="align-top">
                    <button
                      onClick={() => setOpen((o) =>
                        o.includes(l.id) ? o.filter((x) => x !== l.id) : [...o, l.id])}
                      aria-label={expanded
                        ? `Hide what ${l.description} is made of`
                        : `Show what ${l.description} is made of`}
                      aria-expanded={expanded}
                      className="rounded p-1 text-charcoal-500 hover:bg-charcoal-100
                                 hover:text-charcoal-900">
                      {expanded ? <ChevronDown className="size-4" />
                                : <ChevronRight className="size-4" />}
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-start gap-1.5">
                      {l.blocksIssue ? (
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger-600"
                          aria-label="This line blocks issue" />
                      ) : null}
                      <div>
                        <p className="font-medium text-charcoal-900">{l.description}</p>
                        <p className="text-xs text-charcoal-400">
                          {l.serviceName ?? 'Entered by hand'}
                          {!l.hasProductionRate && l.serviceId
                            ? ' · no production rate, so it cannot be priced from production'
                            : ''}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-charcoal-600">
                    {l.costCode ?? <span className="text-charcoal-400">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    {editable ? (
                      <div className="flex items-center justify-end gap-1.5">
                        {saving === l.id
                          ? <Loader2 className="size-3.5 animate-spin text-charcoal-400" /> : null}
                        <Input
                          className="h-8 w-28 text-right tabular"
                          type="number" min={0} step="any"
                          defaultValue={l.measuredQuantity}
                          aria-label={`Quantity for ${l.description}`}
                          onBlur={(e) => commit(l.id, e.target.value, l.measuredQuantity)} />
                      </div>
                    ) : <span className="tabular">{qty(l.measuredQuantity)}</span>}
                    {l.adjustedQuantity !== l.measuredQuantity ? (
                      <p className="mt-0.5 text-xs text-charcoal-400">
                        {qty(l.adjustedQuantity)} after waste and loss
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-charcoal-600">{l.unit}</TableCell>
                  <TableCell className="tabular text-right">
                    {l.unitCost ? unitRate(l.unitCost) : <span className="text-charcoal-400">—</span>}
                  </TableCell>
                  <TableCell className="tabular text-right text-xs text-charcoal-600">
                    {l.markupOverride == null
                      ? <span className="text-charcoal-400">profile</span>
                      : `${Math.round(l.markupOverride * 100)}%`}
                  </TableCell>
                  <TableCell className="tabular text-right font-medium">
                    {l.totalDirectCost ? money(l.totalDirectCost)
                      : <span className="text-charcoal-400">not priced</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={l.confidenceBand === 'do_not_price' ? 'danger'
                        : l.confidenceBand === 'high' ? 'success' : 'warn'}>
                        {titleCase(l.confidenceBand)}
                      </Badge>
                      {editable ? (
                        <button onClick={() => toggleVisible(l)}
                          aria-label={l.clientVisible
                            ? `Hide ${l.description} from the proposal`
                            : `Show ${l.description} on the proposal`}
                          className="rounded p-1 text-charcoal-400 hover:bg-charcoal-100
                                     hover:text-charcoal-900">
                          {l.clientVisible ? <Eye className="size-3.5" />
                                           : <EyeOff className="size-3.5" />}
                        </button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>

                {expanded ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={9} className="p-0">
                      <LineDetail line={l} editable={editable} onChanged={onChanged} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={7} className="font-medium">Direct cost</TableCell>
            <TableCell className="tabular text-right font-medium">
              {money(version.directCost)}
            </TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
    </>
  );
}

/** Adding a line from the library, or by hand. */
function AddLineDialog({ open, onOpenChange, versionId, onAdded }: {
  open: boolean; onOpenChange: (v: boolean) => void; versionId: string; onAdded: () => void;
}) {
  const [term, setTerm] = useState('');
  const [chosen, setChosen] = useState<LibraryService | null>(null);
  const [unit, setUnit] = useState<string>('');
  const [quantity, setQuantity] = useState('0');
  const [freeText, setFreeText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const services = useQuery(searchServices(term), [term, open]);
  const results = services.status === 'ready' ? services.data : [];

  const choose = (s: LibraryService) => { setChosen(s); setUnit(s.defaultUnit); };

  const submit = async () => {
    if (!supabase) return;
    setBusy(true); setError(null);
    try {
      await addLine(supabase, {
        versionId,
        serviceId: chosen?.id ?? null,
        description: chosen ? null : freeText,
        quantity: Number(quantity) || 0,
        unit: chosen ? unit : (unit || 'LS'),
      });
      setChosen(null); setTerm(''); setQuantity('0'); setFreeText(''); setUnit('');
      onAdded();
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a line</DialogTitle>
          <DialogDescription>
            A service brings its own unit, cost code and the production rate somebody measured.
            The cost is not set here — the engine computes it when the estimate is priced.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="svc-search">Search the library</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal-400" />
              <Input id="svc-search" className="pl-9" value={term} placeholder="Excavation, paving, storm sewer…"
                onChange={(e) => { setTerm(e.target.value); setChosen(null); }} />
            </div>
          </div>

          {chosen ? (
            <div className="rounded-lg border border-charcoal-200 bg-charcoal-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-charcoal-900">{chosen.name}</p>
                  <p className="text-xs text-charcoal-500">
                    {chosen.code}{chosen.category ? ` · ${chosen.category}` : ''}
                    {chosen.isOwn ? ' · your library' : ' · platform catalog'}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setChosen(null)}>
                  <Trash2 className="size-4" /> Clear
                </Button>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="line-unit">Unit</Label>
                  {/* Narrowed to what the service can actually be bid in: the
                      database refuses the rest, and offering one is a choice
                      somebody makes before being told they cannot. */}
                  <UnitSelect id="line-unit" value={unit} onChange={setUnit}
                    allowed={chosen.supportedUnits} label="Unit for this line" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="line-qty">Quantity</Label>
                  <Input id="line-qty" type="number" min={0} step="any" value={quantity}
                    onChange={(e) => setQuantity(e.target.value)} />
                </div>
              </div>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-charcoal-200">
              {services.status === 'loading' ? (
                <div className="p-4"><LoadingState label="Searching the library" /></div>
              ) : results.length === 0 ? (
                <div className="p-4 text-sm text-charcoal-500">
                  Nothing matched. You can still add a line of your own below.
                </div>
              ) : results.map((s) => (
                <button key={s.id} type="button"
                  className="flex w-full items-center justify-between gap-3 border-b border-charcoal-100 px-3 py-2 text-left last:border-0 hover:bg-charcoal-50"
                  onClick={() => choose(s)}>
                  <span>
                    <span className="block text-sm font-medium text-charcoal-900">{s.name}</span>
                    <span className="block text-xs text-charcoal-500">
                      {s.code}{s.category ? ` · ${s.category}` : ''}
                    </span>
                  </span>
                  <Badge variant={s.isOwn ? 'info' : 'default'}>
                    {s.isOwn ? 'yours' : s.defaultUnit}
                  </Badge>
                </button>
              ))}
            </div>
          )}

          {!chosen ? (
            <div className="grid gap-3 sm:grid-cols-[1fr,7rem,7rem]">
              <div className="space-y-1.5">
                <Label htmlFor="line-desc">Or a line of your own</Label>
                <Input id="line-desc" value={freeText} placeholder="Mobilization"
                  onChange={(e) => setFreeText(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="line-unit-free">Unit</Label>
                <UnitSelect id="line-unit-free" value={unit || 'LS'}
                  onChange={setUnit} label="Unit for this line" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="line-qty-free">Quantity</Label>
                <Input id="line-qty-free" type="number" min={0} step="any" value={quantity}
                  onChange={(e) => setQuantity(e.target.value)} />
              </div>
            </div>
          ) : null}

          {error ? <ErrorState message={error} /> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || (!chosen && freeText.trim().length === 0)}>
            <Plus className="size-4" /> {busy ? 'Adding…' : 'Add line'}
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
    <Card>
      <CardHeader>
        <CardTitle>What the customer sees</CardTitle>
        <CardDescription>
          These switch what the proposal itemizes, not what the estimate costs. Turning off labor
          does not make the job cheaper — it stops the document breaking out what the crew costs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
      </CardContent>
    </Card>
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
