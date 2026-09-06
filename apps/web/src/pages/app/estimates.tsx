/**
 * Estimating, read from the governed schema.
 *
 * This screen listed six invented bids until migration 0097 gave estimating a
 * write path. Everything below is the caller's own tenant, through row level
 * security, and every number is the engine's — the estimate row carries no
 * money at all, because the price belongs to the version the engine priced.
 *
 * The two figures that used to be here and are not any more are worth naming.
 * "Win rate 62%" was a constant in a fixture; the platform has awarded and lost
 * estimates and can count them, so it does. "Live value" now says which
 * statuses it covers, because a total whose membership you cannot see is a
 * number nobody can check.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calculator, Search, Filter, ArrowUpDown, AlertTriangle, Plus, CalendarClock, UserPlus,
  LayoutTemplate,
} from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoadingState, ErrorState, EmptyState, DemonstrationNotice } from '@/components/data-state';
import { ConfidencePill } from '@/components/estimating';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { usePermissions } from '@/lib/data/session';
import {
  loadEstimates, createEstimate, loadCustomers, createCustomer, loadMyCompanyId,
  setEstimateExpiry, demonstrationEstimates, type EstimateRow, type CustomerOption,
} from '@/lib/data/estimates';
import { TemplatePicker, ApplyWarnings, TemplateShelf } from '@/components/estimate/templates';
import { createEstimateFromTemplate, type ApplyResult } from '@/lib/data/templates';
import { money, moneyCompact, date, dateTime, titleCase } from '@/lib/format';

const STATUS_TONE: Record<string, 'default' | 'success' | 'warn' | 'danger' | 'info'> = {
  draft: 'default', in_review: 'warn', approved: 'info', issued: 'info',
  awarded: 'success', lost: 'danger', archived: 'default',
};

/** The statuses that represent money still in play, named where they are used. */
const LIVE_STATUSES = ['draft', 'in_review', 'approved', 'issued'];

export function EstimatesPage() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<'updated' | 'value' | 'confidence'>('updated');
  const [creating, setCreating] = useState(false);

  const estimates = useQuery(loadEstimates, []);
  const { can } = usePermissions();
  const demo = estimates.status === 'demonstration';
  const all: EstimateRow[] | null =
    estimates.status === 'ready' ? estimates.data : demo ? demonstrationEstimates() : null;

  const rows = useMemo(() => {
    if (!all) return [];
    const q = query.trim().toLowerCase();
    return all
      .filter((e) => status === 'all' ? true
        : status === 'expired' ? e.expired
        /*
         * The three sets the tiles above count. They are filters rather than
         * statuses because that is what they are — "blocked" is the engine's
         * verdict on an estimate of any status, and "live" is four statuses at
         * once. Naming them here is what lets a tile and the dropdown agree
         * about what they mean.
         */
        : status === 'live' ? LIVE_STATUSES.includes(e.status)
        : status === 'blocked' ? e.blockedFromIssue && e.status !== 'archived'
        : status === 'decided' ? e.status === 'awarded' || e.status === 'lost'
        : e.status === status)
      .filter((e) => !q || `${e.number} ${e.name} ${e.customerName ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) =>
        sort === 'value' ? b.bidPrice - a.bidPrice
        : sort === 'confidence' ? (b.confidence ?? 0) - (a.confidence ?? 0)
        : b.updatedAt.localeCompare(a.updatedAt));
  }, [all, query, status, sort]);

  const liveValue = (all ?? [])
    .filter((e) => LIVE_STATUSES.includes(e.status))
    .reduce((a, e) => a + e.bidPrice, 0);
  const blocked = (all ?? []).filter((e) => e.blockedFromIssue && e.status !== 'archived').length;
  const LIVE = new Set(LIVE_STATUSES);
  const expired = (all ?? []).filter((e) => e.expired && LIVE.has(e.status)).length;
  const expiringSoon = (all ?? []).filter((e) =>
    !e.expired && e.expiresAt != null && LIVE.has(e.status)
    && new Date(e.expiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000).length;

  /*
   * Win rate is counted, not asserted. Decided means awarded or lost — an
   * estimate still out with a customer has not been won or lost yet, and
   * counting it either way would make the figure move for the wrong reason.
   */
  const decided = (all ?? []).filter((e) => e.status === 'awarded' || e.status === 'lost');
  const wonValue = decided.filter((e) => e.status === 'awarded').reduce((a, e) => a + e.bidPrice, 0);
  const decidedValue = decided.reduce((a, e) => a + e.bidPrice, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estimator"
        description="Every estimate is versioned. An approved version is immutable — a change creates a new version with a stated reason, so the number a bid went out at is always recoverable."
        actions={
          <Button onClick={() => setCreating(true)} disabled={demo || !can('estimates.write')}>
            <Calculator className="size-4" /> New estimate
          </Button>
        }
      />

      {demo ? <DemonstrationNotice what="this page" /> : null}
      {estimates.status === 'error'
        ? <ErrorState message={estimates.message} onRetry={estimates.refetch} /> : null}
      {estimates.status === 'loading' ? <LoadingState label="Loading estimates" /> : null}

      {all ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/*
            * Each tile shows what it counts. A tile counting nothing is left
            * inert rather than made into a button that would filter the list
            * down to an empty table.
            */}
          <StatTile label="Estimates" value={all.length} hint="all statuses"
            active={status === 'all'} actionLabel="Show every estimate"
            onClick={all.length ? () => setStatus('all') : undefined} />
          <StatTile label="Live value" value={moneyCompact(liveValue)}
            hint="draft, in review, approved and issued"
            active={status === 'live'} actionLabel="Show the estimates still in play"
            onClick={liveValue > 0 ? () => setStatus('live') : undefined} />
          <StatTile label="Blocked from issue" value={blocked} tone={blocked ? 'danger' : 'success'}
            hint="the engine has not cleared these to bid"
            active={status === 'blocked'} actionLabel="Show the estimates the engine has blocked"
            onClick={blocked ? () => setStatus('blocked') : undefined} />
          <StatTile label="Expired" value={expired} tone={expired ? 'danger' : undefined}
            icon={<CalendarClock className="size-4" />}
            hint={expiringSoon > 0
              ? `${expiringSoon} more within a week`
              : 'prices that have stopped being good'}
            active={status === 'expired'} actionLabel="Show the estimates whose price has expired"
            onClick={expired ? () => setStatus('expired') : undefined} />
          <StatTile
            label="Win rate"
            value={decidedValue > 0 ? `${Math.round((wonValue / decidedValue) * 100)}%` : '—'}
            tone={decidedValue > 0 && wonValue / decidedValue >= 0.5 ? 'success' : undefined}
            hint={decidedValue > 0
              ? `by value, across ${decided.length} decided ${decided.length === 1 ? 'bid' : 'bids'}`
              : 'nothing awarded or lost yet'}
            active={status === 'decided'} actionLabel="Show the bids that were won or lost"
            onClick={decided.length ? () => setStatus('decided') : undefined} />
        </div>
      ) : null}

      {all && all.length === 0 ? (
        <EmptyState
          title="No estimates yet"
          hint="Create one and add lines from the master library. The engine prices it; nobody types a cost."
        />
      ) : null}

      {all && all.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-col gap-3 border-b border-charcoal-200 p-4 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal-400" />
                <Input className="pl-9" placeholder="Search by number, project or customer…"
                  value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full sm:w-44"><Filter className="size-4 text-charcoal-400" /><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="live">Still in play</SelectItem>
                  <SelectItem value="blocked">Blocked from issue</SelectItem>
                  <SelectItem value="decided">Won or lost</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  {['draft', 'in_review', 'approved', 'issued', 'awarded', 'lost'].map((s) => (
                    <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                <SelectTrigger className="w-full sm:w-48"><ArrowUpDown className="size-4 text-charcoal-400" /><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="updated">Recently updated</SelectItem>
                  <SelectItem value="value">Highest value</SelectItem>
                  <SelectItem value="confidence">Highest confidence</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {rows.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No estimates match those filters"
                  hint={<Button variant="outline" size="sm"
                    onClick={() => { setQuery(''); setStatus('all'); }}>Clear filters</Button>} />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Estimate</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Conf.</TableHead>
                    <TableHead>Bid due</TableHead>
                    <TableHead>Valid until</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <Link to={`/app/estimates/${e.currentVersionId ?? e.id}`}
                          className="font-medium text-charcoal-900 hover:text-yellow-700">
                          {e.number}
                        </Link>
                        <p className="max-w-72 truncate text-xs text-charcoal-500">{e.name}</p>
                        {e.versionNumber ? (
                          <p className="text-xs text-charcoal-400">version {e.versionNumber}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-charcoal-700">
                        {e.customerName ?? <span className="text-charcoal-400">—</span>}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5">
                          <Badge variant={STATUS_TONE[e.status] ?? 'default'}>{titleCase(e.status)}</Badge>
                          {e.blockedFromIssue && e.status !== 'archived' ? (
                            <AlertTriangle className="size-3.5 shrink-0 text-danger-600"
                              aria-label="Not cleared to issue" />
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="tabular text-right font-medium">
                        {e.pricedAt ? money(e.bidPrice)
                          : <span className="text-charcoal-400">not priced</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {e.confidence ? <ConfidencePill score={e.confidence} />
                          : <span className="text-charcoal-400">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-charcoal-600">
                        {e.bidDueAt ? dateTime(e.bidDueAt) : <span className="text-charcoal-400">—</span>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {e.expiresAt ? (
                          <span className={e.expired ? 'font-medium text-danger-700' : 'text-charcoal-600'}>
                            {date(e.expiresAt)}{e.expired ? ' · expired' : ''}
                          </span>
                        ) : <span className="text-charcoal-400">does not expire</span>}
                      </TableCell>
                      <TableCell className="text-right text-xs text-charcoal-500">
                        {date(e.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!demo ? <TemplateShelf canEdit={can('estimates.write')} /> : null}

      <NewEstimateDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => { setCreating(false); estimates.refetch(); }}
      />
    </div>
  );
}

/**
 * Creating one.
 *
 * The number is left to the database when it is not given, and generated per
 * company: an estimator quoting their fourth job this year expects E-2026-0004,
 * not whatever the platform happens to be up to. Three rows have to agree — the
 * estimate, its first version and the pointer between them — which is why this
 * calls a function rather than inserting.
 */
function NewEstimateDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [customerId, setCustomerId] = useState<string>('');
  const [newClient, setNewClient] = useState('');
  const [bidDueAt, setBidDueAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [description, setDescription] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customers = useQuery(loadCustomers, [open]);
  const clients: CustomerOption[] = customers.status === 'ready' ? customers.data : [];

  const submit = async () => {
    if (!supabase || name.trim().length < 2) return;
    setBusy(true); setError(null);
    try {
      let client = customerId || null;
      /*
       * Adding the client here rather than sending people to the CRM first.
       * An estimator with a customer on the phone should not have to leave the
       * estimate to record who it is for.
       */
      if (!client && newClient.trim().length > 1) {
        const companyId = await loadMyCompanyId(supabase);
        if (!companyId) {
          throw new Error(
            'You belong to more than one company, so this client cannot be filed automatically. '
            + 'Add it in the CRM first.');
        }
        client = await createCustomer(supabase, { companyId, name: newClient });
      }
      /*
       * Starting from a template is one call rather than two, so a template
       * that cannot be applied does not leave an empty estimate behind with a
       * number burned on it. The expiry and the scope note are set after, since
       * that path takes neither.
       */
      let id: string;
      if (templateId) {
        const result = await createEstimateFromTemplate(supabase, {
          templateId,
          name: name.trim(),
          customerId: client,
          number: number.trim() || null,
          bidDueAt: bidDueAt ? new Date(bidDueAt).toISOString() : null,
        });
        id = result.estimateId;
        setApplied(result.warnings.length > 0 ? result : null);
        if (expiresAt) {
          await setEstimateExpiry(supabase, id, new Date(expiresAt).toISOString());
        }
        if (result.warnings.length > 0) {
          setBusy(false);
          return;
        }
      } else {
        id = await createEstimate(supabase, {
          name: name.trim(),
          customerId: client,
          number: number.trim() || null,
          bidDueAt: bidDueAt ? new Date(bidDueAt).toISOString() : null,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          description: description.trim() || null,
        });
      }
      setName(''); setNumber(''); setBidDueAt(''); setExpiresAt('');
      setCustomerId(''); setNewClient(''); setDescription(''); setTemplateId(null);
      onCreated(id);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New estimate</DialogTitle>
          <DialogDescription>
            Starts at version 1 on your company's default pricing profile. Add lines from the
            master library next; the engine prices them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border border-charcoal-200 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-sm font-medium text-charcoal-900">
                <LayoutTemplate className="size-4 text-charcoal-400" /> Start from a template
              </p>
              {templateId ? (
                <Button variant="ghost" size="sm" onClick={() => setTemplateId(null)}>
                  Start empty instead
                </Button>
              ) : null}
            </div>
            <TemplatePicker value={templateId} onChange={(id) => setTemplateId(id)}
              refreshKey={open} />
          </div>

          <ApplyWarnings result={applied} />

          <div className="space-y-1.5">
            <Label htmlFor="est-name">Project name</Label>
            <Input id="est-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Maumee Commerce Park — mass grading" autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="est-client">Client</Label>
            {clients.length > 0 ? (
              <Select value={customerId || 'none'}
                onValueChange={(v) => { setCustomerId(v === 'none' ? '' : v); setNewClient(''); }}>
                <SelectTrigger id="est-client"><SelectValue placeholder="Choose a client" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No client yet</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}{c.city ? ` · ${c.city}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {!customerId ? (
              <div className="relative">
                <UserPlus className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal-400" />
                <Input className="pl-9" value={newClient} placeholder="Or type a new client's name"
                  onChange={(e) => setNewClient(e.target.value)} />
              </div>
            ) : null}
          </div>

          {!templateId ? (
            <div className="space-y-1.5">
              <Label htmlFor="est-desc">Scope note</Label>
              <Input id="est-desc" value={description} placeholder="What this bid covers"
                onChange={(e) => setDescription(e.target.value)} />
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="est-number">Number</Label>
              <Input id="est-number" value={number} onChange={(e) => setNumber(e.target.value)}
                placeholder="Generated" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="est-due">Bid due</Label>
              <Input id="est-due" type="datetime-local" value={bidDueAt}
                onChange={(e) => setBidDueAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="est-expires">Valid until</Label>
              <Input id="est-expires" type="date" value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-charcoal-500">
            An estimate with no expiry does not expire. Setting one refuses approval and issue
            once it passes, so a price computed against last quarter's rates cannot go out as a
            current bid.
          </p>

          {error ? <ErrorState message={error} /> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || name.trim().length < 2}>
            <Plus className="size-4" />
            {busy ? 'Creating…' : templateId ? 'Create from template' : 'Create estimate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
