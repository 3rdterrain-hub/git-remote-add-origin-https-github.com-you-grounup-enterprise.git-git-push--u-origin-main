/**
 * Customers and the pipeline, on real data.
 *
 * The fixture this replaces became actively misleading the moment an estimate
 * could name a client: somebody adds Maumee Development on an estimate, opens
 * the CRM, and finds five invented companies that are not theirs and not the
 * one they just added.
 *
 * Two figures are counted rather than asserted. Lifetime value comes from
 * awarded estimates, not a stored total on the customer — a stored total is
 * wrong from the first award nobody remembered to add to it. Win rate is
 * counted over decided bids, and reads "—" when nothing has been decided,
 * because the old screen's 62% was a constant.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, Mail, Phone, Search, TrendingUp, Trophy, UserPlus,
} from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { usePermissions, useCompanyId } from '@/lib/data/session';
import { loadCrmCustomers, loadOpportunities, type CustomerRow } from '@/lib/data/crm';
import { loadLeads } from '@/lib/data/leads';
import { createCustomer, loadMyCompanyId } from '@/lib/data/estimates';
import { money, moneyCompact, date, titleCase, plural } from '@/lib/format';
import { LeadFormsSection } from '@/components/crm/lead-forms';
import { LeadInboxSection } from '@/components/crm/lead-inbox';

const STAGE_TONE: Record<string, 'default' | 'info' | 'warn' | 'success' | 'danger'> = {
  identified: 'default', qualifying: 'default', estimating: 'info',
  proposed: 'info', negotiating: 'warn', won: 'success', lost: 'danger',
  abandoned: 'default',
};

export function CrmLivePage() {
  const customersQ = useQuery(loadCrmCustomers, []);
  const opportunitiesQ = useQuery(loadOpportunities, []);
  const leadsQ = useQuery(loadLeads, []);
  const { can } = usePermissions();
  const { companyId } = useCompanyId();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  const customers = customersQ.status === 'ready' ? customersQ.data : [];
  const opportunities = opportunitiesQ.status === 'ready' ? opportunitiesQ.data : [];
  const leads = leadsQ.status === 'ready' ? leadsQ.data : [];
  /*
   * The count on the tab, and the reason the tab exists. `leads` was written by
   * the public intake from migration 0065 and read by nothing for four
   * migrations: a lead nobody has spoken to is the one piece of this screen
   * that costs money by sitting still, so it is counted where it can be seen
   * without opening anything.
   */
  const waitingOnUs = leads.filter((l) => l.stage === 'new').length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      `${c.name} ${c.code} ${c.city ?? ''} ${c.email ?? ''}`.toLowerCase().includes(q));
  }, [customers, query]);

  const openOpps = opportunities.filter((o) => !['won', 'lost', 'abandoned'].includes(o.stage));
  const pipeline = openOpps.reduce((a, o) => a + o.estimatedValue, 0);
  const weighted = openOpps.reduce((a, o) => a + o.estimatedValue * (o.probability ?? 0), 0);
  const won = opportunities.filter((o) => o.stage === 'won');
  const lost = opportunities.filter((o) => o.stage === 'lost');
  const decided = won.length + lost.length;

  /*
   * What customers have actually been worth, from awarded estimates. The
   * fixture carried a `wonValue` per customer that nothing computed.
   */
  const lifetime = customers.reduce((a, c) => a + c.awardedValue, 0);
  const outWithCustomers = customers.reduce((a, c) => a + c.openValue, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Who you bid for, and what they have been worth. A lost job records why it was lost — win/loss analysis is worthless without it, and it is the input to the next bid."
        actions={
          <Button onClick={() => setAdding(true)} disabled={!can('crm.write')}>
            <UserPlus className="size-4" /> Add customer
          </Button>
        }
      />

      {customersQ.status === 'error'
        ? <ErrorState message={customersQ.message} onRetry={customersQ.refetch} /> : null}
      {customersQ.status === 'loading' ? <LoadingState label="Loading customers" /> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/*
          * Four figures that used to sit unexplained. Two of them — pipeline and
          * win rate — are the kind a person quotes in a meeting, so what they
          * count and what they leave out belongs one click away rather than in
          * somebody's memory.
          */}
        <StatTile label="Customers" value={customers.length}
          icon={<Building2 className="size-4" />}
          hint={`${moneyCompact(lifetime)} awarded to date`}
          detail={
            customers.length === 0 ? <p>No customers yet.</p> : (
              <ul className="space-y-1">
                {[...customers]
                  .sort((a, b) => b.awardedValue - a.awardedValue)
                  .slice(0, 6)
                  .map((c) => (
                    <li key={c.id} className="flex items-baseline justify-between gap-3">
                      <span className="truncate">{c.name}</span>
                      <span className="tabular shrink-0">{moneyCompact(c.awardedValue)}</span>
                    </li>
                  ))}
                {customers.length > 6 ? (
                  <li className="text-charcoal-400">and {customers.length - 6} more</li>
                ) : null}
                <li className="pt-1 text-charcoal-500">
                  Awarded to date is every estimate that reached awarded, at the price it was
                  awarded at.
                </li>
              </ul>
            )
          } />
        <StatTile label="Out with customers" value={moneyCompact(outWithCustomers)}
          icon={<TrendingUp className="size-4" />}
          hint={`${plural(customers.reduce((a, c) => a + c.openCount, 0), 'live estimate')}`}
          detail={
            <p>
              Every estimate at draft, in review, approved or issued, at the engine's bid price.
              An estimate that was awarded or lost has stopped being out, and an archived one was
              never out — neither is counted here.
            </p>
          } />
        <StatTile label="Open pipeline" value={moneyCompact(pipeline)}
          hint={openOpps.length
            ? `${moneyCompact(weighted)} weighted by probability`
            : 'no opportunities logged'}
          detail={
            openOpps.length === 0 ? (
              <p>
                No opportunities are open. This counts opportunities, which are logged before
                there is an estimate — it is what you expect to bid, not what you have bid.
              </p>
            ) : (
              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-charcoal-600">At full value</span>
                  <span className="tabular">{money(pipeline)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-charcoal-600">Weighted by probability</span>
                  <span className="tabular">{money(weighted)}</span>
                </div>
                <p className="pt-1 text-charcoal-500">
                  Weighted multiplies each opportunity by the probability recorded on it. Neither
                  figure is a forecast — they are what has been logged.
                </p>
              </div>
            )
          } />
        <StatTile label="Win rate"
          value={decided > 0 ? `${Math.round((won.length / decided) * 100)}%` : '—'}
          tone={decided > 0 && won.length / decided >= 0.5 ? 'success' : undefined}
          icon={<Trophy className="size-4" />}
          hint={decided > 0
            ? `${won.length} won, ${lost.length} lost`
            : 'nothing decided yet'}
          detail={
            <div className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-charcoal-600">Won</span>
                <span className="tabular">{won.length}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-charcoal-600">Lost</span>
                <span className="tabular">{lost.length}</span>
              </div>
              <p className="pt-1 text-charcoal-500">
                Counted over opportunities that were decided. One still open is neither won nor
                lost, and counting it either way would move this figure without anything having
                happened.
              </p>
            </div>
          } />
      </div>

      <Tabs defaultValue="customers">
        <TabsList>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="leads">
            Leads
            {waitingOnUs > 0 ? (
              <Badge variant="info" className="ml-2">{waitingOnUs}</Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="forms">Website form</TabsTrigger>
        </TabsList>

        {/*
          * What the form on the website brought in. The tab beside this one
          * could already say a form had taken fourteen leads; there was nowhere
          * to see one of the fourteen.
          */}
        <TabsContent value="leads">
          {leadsQ.status === 'error'
            ? <ErrorState message={leadsQ.message} onRetry={leadsQ.refetch} />
            : leadsQ.status === 'loading'
              ? <LoadingState label="Reading your leads" />
              : <LeadInboxSection leads={leads} canEdit={can('crm.write')}
                  onChanged={leadsQ.refetch} />}
        </TabsContent>

        {/*
          * The public intake. It lives on this screen rather than in settings
          * because the person who wants a form on the website is the person
          * reading the pipeline, and "what came in" and "what is bringing it
          * in" are the same question.
          */}
        <TabsContent value="forms">
          {companyId
            ? <LeadFormsSection companyId={companyId} canEdit={can('crm.write')} />
            : <LoadingState label="Finding your company" />}
        </TabsContent>

        <TabsContent value="customers">
          <Card>
            <CardContent className="p-0">
              <div className="border-b border-charcoal-200 p-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal-400" />
                  <Input className="pl-9" placeholder="Search by name, code, city or email…"
                    value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
              </div>

              {customersQ.status === 'ready' && customers.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No customers yet"
                    hint="Add one here, or name a client when you create an estimate." />
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="Nothing matches that search" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead className="text-right">Awarded</TableHead>
                      <TableHead className="text-right">Out with them</TableHead>
                      <TableHead>Terms</TableHead>
                      <TableHead className="text-right">Last activity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((c) => <CustomerRowView key={c.id} customer={c} />)}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pipeline">
          <Card>
            <CardHeader>
              <CardTitle>Opportunities</CardTitle>
              <CardDescription>
                Work you are chasing that is not yet an estimate. A lost one carries why, because
                the schema refuses to record a loss without a reason.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {opportunitiesQ.status === 'loading'
                ? <div className="p-6"><LoadingState label="Loading the pipeline" /></div> : null}
              {opportunitiesQ.status === 'error'
                ? <div className="p-6"><ErrorState message={opportunitiesQ.message} /></div> : null}
              {opportunitiesQ.status === 'ready' && opportunities.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="Nothing in the pipeline"
                    hint={<>An opportunity is work you are chasing before it becomes an estimate.
                      {' '}<Link to="/app/estimates" className="text-yellow-700 underline">
                        Go straight to an estimate
                      </Link> if it is already real.</>} />
                </div>
              ) : null}
              {opportunities.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Opportunity</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">Weighted</TableHead>
                      <TableHead>Bid due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {opportunities.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell>
                          <p className="font-medium text-charcoal-900">{o.number}</p>
                          <p className="max-w-72 truncate text-xs text-charcoal-500">{o.name}</p>
                          {o.lossReason ? (
                            <p className="text-xs text-danger-600">
                              lost: {o.lossReason}
                              {o.winningCompetitor ? ` (${o.winningCompetitor})` : ''}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-charcoal-700">
                          {o.customerName ?? <span className="text-charcoal-400">—</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STAGE_TONE[o.stage] ?? 'default'}>
                            {titleCase(o.stage)}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {money(o.estimatedValue)}
                        </TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">
                          {o.probability == null
                            ? <span className="text-charcoal-400">no probability</span>
                            : money(o.estimatedValue * o.probability)}
                        </TableCell>
                        <TableCell className="text-xs text-charcoal-600">
                          {o.bidDueAt ? date(o.bidDueAt) : <span className="text-charcoal-400">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AddCustomerDialog open={adding} onOpenChange={setAdding}
        onAdded={() => { setAdding(false); customersQ.refetch(); }} />
    </div>
  );
}

function CustomerRowView({ customer: c }: { customer: CustomerRow }) {
  return (
    <TableRow>
      <TableCell>
        <p className="font-medium text-charcoal-900">{c.name}</p>
        <p className="text-xs text-charcoal-500">
          {c.code} · {titleCase(c.customerType.replace(/_/g, ' '))}
          {c.city ? ` · ${c.city}${c.state ? `, ${c.state}` : ''}` : ''}
        </p>
      </TableCell>
      <TableCell className="text-xs text-charcoal-700">
        {c.email ? (
          <a href={`mailto:${c.email}`} className="flex items-center gap-1.5 hover:text-yellow-700">
            <Mail className="size-3" /> {c.email}
          </a>
        ) : null}
        {c.phone ? (
          <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 hover:text-yellow-700">
            <Phone className="size-3" /> {c.phone}
          </a>
        ) : null}
        {!c.email && !c.phone ? <span className="text-charcoal-400">no contact on file</span> : null}
      </TableCell>
      <TableCell className="tabular text-right">
        {c.awardedCount > 0 ? (
          <>
            <span className="font-medium">{money(c.awardedValue)}</span>
            <span className="block text-xs text-charcoal-500">
              {plural(c.awardedCount, 'job')}
            </span>
          </>
        ) : <span className="text-charcoal-400">nothing yet</span>}
      </TableCell>
      <TableCell className="tabular text-right">
        {c.openCount > 0 ? (
          <>
            {money(c.openValue)}
            <span className="block text-xs text-charcoal-500">
              {plural(c.openCount, 'estimate')}
            </span>
          </>
        ) : <span className="text-charcoal-400">—</span>}
      </TableCell>
      <TableCell className="text-xs text-charcoal-600">{c.paymentTerms ?? '—'}</TableCell>
      <TableCell className="text-right text-xs text-charcoal-500">
        {c.lastActivityAt ? date(c.lastActivityAt) : '—'}
      </TableCell>
    </TableRow>
  );
}

function AddCustomerDialog({ open, onOpenChange, onAdded }: {
  open: boolean; onOpenChange: (v: boolean) => void; onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!supabase || name.trim().length < 2) return;
    setBusy(true); setError(null);
    try {
      const companyId = await loadMyCompanyId(supabase);
      if (!companyId) {
        throw new Error('You belong to more than one company, so this cannot be filed automatically.');
      }
      await createCustomer(supabase, { companyId, name, code: code || null });
      setName(''); setCode('');
      onAdded();
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a customer</DialogTitle>
          <DialogDescription>
            The rest — contact, terms, address — can be filled in afterwards. A name is enough to
            put an estimate against them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cust-name">Name</Label>
            <Input id="cust-name" value={name} placeholder="Maumee Development Partners"
              onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cust-code">Code</Label>
            <Input id="cust-code" value={code} placeholder="Generated if left blank"
              onChange={(e) => setCode(e.target.value)} />
            <p className="text-xs text-charcoal-500">
              Generated when left blank, because being made to invent an identifier is how a
              company ends up with CUST1, CUST-1 and Cust_1 for the same client.
            </p>
          </div>
          {error ? <ErrorState message={error} /> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || name.trim().length < 2}>
            <UserPlus className="size-4" /> {busy ? 'Adding…' : 'Add customer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
