/**
 * Procurement and inventory, live.
 *
 * This page read `RFQS`, `PURCHASE_ORDERS` and `INVENTORY` from
 * `@/data/finance`. Seven governed tables sat behind it — `rfqs`,
 * `rfq_responses`, `purchase_orders`, `purchase_order_items`, `deliveries`,
 * `inventory_items`, `inventory_transactions` — and not one had a reader
 * anywhere in the application.
 *
 * Three numbers on this page are the database's rather than the browser's, and
 * the difference matters:
 *
 *   * **The leveled amount is a generated column.** The fixture page computed
 *     quoted plus adjustment itself, which is how a page and a database come to
 *     hold different opinions about which bid was low.
 *   * **Available stock is generated** from on hand less reserved, and the
 *     reorder test is against *available*: stock already spoken for will not be
 *     there for the next job, so counting it hides a shortage until somebody
 *     walks to the yard for it.
 *   * **The low bid is taken only across bids that arrived.** A vendor who was
 *     invited and never answered carries a leveled amount of zero, and calling
 *     that the low bid awards the package to silence.
 *
 * What the page shows about governance, it shows because the schema guarantees
 * it: an awarded RFQ names the vendor *and* the reason, and a delivery that was
 * not accepted carries a discrepancy note.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShoppingCart, Package, Scale, Plus, TrendingDown, Boxes, AlertTriangle,
} from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, Progress, EmptyState } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { LoadingState, ErrorState, DemonstrationNotice } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import { loadRfqs, loadPurchaseOrders, loadInventory } from '@/lib/data/procurement';
import {
  money, moneyCompact, percent, qty, date, titleCase, plural, relativeDays,
} from '@/lib/format';
import { cn } from '@/lib/utils';

const OPEN_PO = ['draft', 'issued', 'partially_received', 'received'];

export function ProcurementPage() {
  const [tab, setTab] = useState('rfqs');
  const rfqsQ = useQuery(loadRfqs, []);
  const posQ = useQuery(loadPurchaseOrders, []);
  const invQ = useQuery(loadInventory, []);

  const rfqs = rfqsQ.status === 'ready' ? rfqsQ.data : [];
  const pos = posQ.status === 'ready' ? posQ.data : [];
  const inventory = invQ.status === 'ready' ? invQ.data : [];

  const openPos = pos.filter((p) => OPEN_PO.includes(p.status));
  const committed = openPos.reduce((a, p) => a + p.committedAmount, 0);
  const invoiced = pos.reduce((a, p) => a + p.invoicedAmount, 0);
  // Committed but not yet invoiced: cost the company already owes.
  const openCommitment = openPos.reduce((a, p) => a + (p.committedAmount - p.invoicedAmount), 0);

  const belowReorder = inventory.filter((i) => i.belowReorderPoint);
  const inventoryValue = inventory.reduce((a, i) => a + i.onHand * i.unitCost, 0);
  const activeRfqs = rfqs.filter((r) => !['awarded', 'canceled'].includes(r.status));
  const rejected = pos.filter((p) => p.rejectedDeliveries > 0);

  if (rfqsQ.status === 'demonstration') {
    return (
      <div className="space-y-6">
        <PageHeader title="Procurement &amp; Inventory"
          description="Quotes, commitments and stock. A purchase order commits cost before an invoice arrives, which is what makes a budget overrun visible while there is still time to act on it." />
        <DemonstrationNotice />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Procurement &amp; Inventory"
        description="Quotes, commitments and stock. A purchase order commits cost before an invoice arrives, which is what makes a budget overrun visible while there is still time to act on it."
        actions={
          <>
            <Button variant="outline" disabled><Scale className="size-4" /> New RFQ</Button>
            <Button disabled><Plus className="size-4" /> Purchase order</Button>
          </>
        }
      />

      {belowReorder.length ? (
        <Alert tone="warn" icon={<TrendingDown className="size-4" />}
          title={`${plural(belowReorder.length, 'item')} below reorder point`}>
          {belowReorder.map((i) =>
            `${i.name} (${qty(i.available, 0)} ${i.unit} available, reorder at ${qty(i.reorderPoint ?? 0, 0)})`)
            .join('; ')}.
          Available is on-hand less what other crews have already reserved.
        </Alert>
      ) : null}

      {rejected.length ? (
        <Alert tone="danger" icon={<AlertTriangle className="size-4" />}
          title={`${plural(rejected.length, 'purchase order')} with a rejected delivery`}>
          {rejected.map((p) => `${p.number} (${plural(p.rejectedDeliveries, 'ticket')})`).join('; ')}.
          A delivery that was not accepted carries the reason it was refused, which is what a
          back-charge is argued from.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Open commitments" value={moneyCompact(committed)}
          icon={<ShoppingCart className="size-4" />}
          hint={`${plural(openPos.length, 'open order')}`}
          onClick={() => setTab('pos')} active={tab === 'pos'}
          actionLabel="Show the open purchase orders" />
        {/*
          * Carried over from the page this replaces. The explanation is the
          * whole value of the tile: the figure is meaningless until somebody
          * says what the two numbers are the difference between.
          */}
        <StatTile label="Not yet invoiced" value={moneyCompact(openCommitment)} tone="warn"
          icon={<ShoppingCart className="size-4" />}
          hint="cost already owed against open POs"
          detail={
            <div className="space-y-2">
              <p>
                Ordered and not yet billed: {moneyCompact(committed)} committed
                less {moneyCompact(invoiced)} invoiced. The company can no longer choose not to
                spend it, and no invoice has arrived to make it visible in the accounts.
              </p>
              <p>
                This is the number that turns a budget overrun into something you can act on while
                there is still time — a project looks fine on spend and is already gone on
                commitment.
              </p>
              <p>
                The invoiced half is derived from the approved vendor invoices, not typed:
                migration 0046 refuses a total that disagrees with them.
              </p>
            </div>
          } />
        <StatTile label="Invoiced to date" value={moneyCompact(invoiced)}
          hint="across all purchase orders"
          icon={<ShoppingCart className="size-4" />}
          onClick={() => setTab('pos')} active={tab === 'pos'}
          actionLabel="Show every purchase order" />
        <StatTile label="Active RFQs" value={activeRfqs.length} icon={<Scale className="size-4" />}
          hint={`${rfqs.length - activeRfqs.length} settled`}
          onClick={() => setTab('rfqs')} active={tab === 'rfqs'}
          actionLabel="Show the quote packages" />
        <StatTile label="Inventory value" value={moneyCompact(inventoryValue)}
          icon={<Boxes className="size-4" />}
          hint={`${plural(inventory.length, 'item')} on hand`}
          onClick={() => setTab('inventory')} active={tab === 'inventory'}
          actionLabel="Show the stock on hand" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="rfqs">RFQs &amp; leveling ({rfqs.length})</TabsTrigger>
          <TabsTrigger value="pos">Purchase orders ({openPos.length} open)</TabsTrigger>
          <TabsTrigger value="inventory">Inventory ({inventory.length})</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------------ rfqs */}
        <TabsContent value="rfqs" className="space-y-4">
          {rfqsQ.status === 'loading' ? <LoadingState label="Reading the quote packages" /> : null}
          {rfqsQ.status === 'error'
            ? <ErrorState message={rfqsQ.message} onRetry={rfqsQ.refetch} /> : null}
          {rfqsQ.status === 'ready' && rfqs.length === 0 ? (
            <EmptyState title="No quote packages yet"
              description="An RFQ is a scope sent to several vendors, and the leveling board is where their answers are made comparable." />
          ) : null}

          {rfqs.map((r) => (
            <Card key={r.id}>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle>{r.number} — {r.title}</CardTitle>
                  <CardDescription>
                    {[r.trade, r.projectNumber].filter(Boolean).join(' · ')}
                    {r.dueAt ? ` · due ${date(r.dueAt)} (${relativeDays(r.dueAt)})` : ''}
                    {' · '}
                    {r.responded} of {plural(r.invited, 'invitation')} answered
                  </CardDescription>
                </div>
                <Badge variant={r.status === 'awarded' ? 'success'
                  : r.status === 'leveling' ? 'warn' : 'default'}>
                  {titleCase(r.status)}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3 p-0">
                {r.responses.length === 0 ? (
                  <p className="px-6 pb-4 text-sm text-charcoal-500">
                    Nobody has been invited to this package yet.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendor</TableHead>
                        <TableHead className="text-right">Quoted</TableHead>
                        <TableHead className="text-right">Leveling</TableHead>
                        <TableHead className="text-right">Leveled</TableHead>
                        <TableHead className="text-right">Lead time</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="min-w-64">Note</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.responses.map((x) => {
                        const answered = x.quotedAmount !== null;
                        /* Low among the bids that arrived. A vendor who never
                           answered levels to zero, and that is not a low bid. */
                        const isLow = answered && r.lowLeveled !== null
                          && x.leveledAmount === r.lowLeveled;
                        return (
                          <TableRow key={x.id} className={cn(isLow && 'bg-success-50/50')}>
                            <TableCell className="font-medium text-charcoal-900">
                              {x.vendorName}
                              {isLow ? <Badge variant="success" className="ml-2">Low</Badge> : null}
                            </TableCell>
                            <TableCell className="tabular text-right">
                              {answered ? money(x.quotedAmount!)
                                : <span className="text-xs text-charcoal-400">no bid</span>}
                            </TableCell>
                            <TableCell className="tabular text-right text-charcoal-600">
                              {x.levelingAdjustment !== 0 ? money(x.levelingAdjustment) : '—'}
                            </TableCell>
                            <TableCell className="tabular text-right font-medium">
                              {answered ? money(x.leveledAmount) : '—'}
                            </TableCell>
                            <TableCell className="tabular text-right text-charcoal-600">
                              {x.leadTimeDays === null ? '—' : `${x.leadTimeDays} d`}
                            </TableCell>
                            <TableCell>
                              <Badge variant={x.status === 'awarded' ? 'success'
                                : x.status === 'declined' ? 'danger' : 'outline'}>
                                {titleCase(x.status)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-charcoal-600">
                              {x.notes ?? '—'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}

                {/*
                  * An award names the vendor and the reason, because the schema
                  * requires both — a choice of subcontractor with no stated
                  * reason is a record of an outcome rather than of a decision.
                  */}
                {r.status === 'awarded' ? (
                  <p className="px-6 pb-4 text-sm text-charcoal-700">
                    Awarded to <span className="font-medium">{r.awardedVendorName}</span>
                    {r.awardReason ? <> — {r.awardReason}</> : null}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* -------------------------------------------------- purchase orders */}
        <TabsContent value="pos">
          <Card>
            <CardHeader>
              <CardTitle>Purchase orders</CardTitle>
              <CardDescription>
                Committed cost is the number that tells a project manager they are over budget while
                there is still time to do something about it — not when the invoice arrives. The
                invoiced total is derived from the approved vendor invoices rather than typed:
                migration 0046 refuses a hand-set figure that disagrees with them, so the gap
                between the two columns is real exposure and not somebody&apos;s arithmetic.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {posQ.status === 'loading' ? <LoadingState label="Reading the purchase orders" /> : null}
              {posQ.status === 'error'
                ? <ErrorState message={posQ.message} onRetry={posQ.refetch} /> : null}
              {posQ.status === 'ready' && pos.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No purchase orders yet"
                    description="A purchase order commits cost against a project before any invoice arrives." />
                </div>
              ) : null}

              {pos.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Committed</TableHead>
                      <TableHead className="min-w-32">Invoiced</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                      <TableHead>Needed by</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pos.map((p) => {
                      const pct = p.committedAmount ? p.invoicedAmount / p.committedAmount : 0;
                      return (
                        <TableRow key={p.id}>
                          <TableCell>
                            <p className="font-mono text-xs font-medium text-charcoal-900">{p.number}</p>
                            <p className="max-w-48 truncate text-xs text-charcoal-500">{p.title}</p>
                          </TableCell>
                          <TableCell className="text-charcoal-700">{p.vendorName ?? '—'}</TableCell>
                          <TableCell className="font-mono text-xs text-charcoal-600">
                            {p.projectId && p.projectNumber ? (
                              <Link to={`/app/projects/${p.projectId}`} className="hover:underline">
                                {p.projectNumber}
                              </Link>
                            ) : (p.projectNumber ?? '—')}
                          </TableCell>
                          <TableCell><Badge variant="outline">{titleCase(p.poType)}</Badge></TableCell>
                          <TableCell className="tabular text-right font-medium">
                            {money(p.committedAmount)}
                          </TableCell>
                          <TableCell>
                            <Progress value={pct * 100}
                              indicatorClassName={pct >= 0.99 ? 'bg-success-600' : 'bg-charcoal-700'} />
                            <p className="tabular mt-1 text-xs text-charcoal-500">
                              {money(p.invoicedAmount)} ({percent(pct, 0)})
                            </p>
                          </TableCell>
                          <TableCell className="tabular text-right text-charcoal-600">
                            {money(p.committedAmount - p.invoicedAmount)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-charcoal-600">
                            {p.neededBy ? date(p.neededBy) : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant={
                              p.status === 'closed' ? 'success'
                                : p.status === 'partially_received' ? 'warn' : 'info'
                            }>{titleCase(p.status)}</Badge>
                            {p.rejectedDeliveries > 0 ? (
                              <p className="mt-1 text-[11px] text-danger-700">
                                {plural(p.rejectedDeliveries, 'rejected ticket')}
                              </p>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="hover:bg-charcoal-50">
                      <TableCell colSpan={4}>Totals</TableCell>
                      <TableCell className="tabular text-right">
                        {money(pos.reduce((a, p) => a + p.committedAmount, 0))}
                      </TableCell>
                      <TableCell className="tabular">{money(invoiced)}</TableCell>
                      <TableCell className="tabular text-right">
                        {money(pos.reduce((a, p) => a + p.committedAmount - p.invoicedAmount, 0))}
                      </TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  </TableFooter>
                </Table>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------- inventory */}
        <TabsContent value="inventory">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="size-4" /> Stock on hand
              </CardTitle>
              <CardDescription>
                Available is on hand less what is already reserved, and the database generates it
                from the two so the three can never disagree. The reorder test is against
                available, because stock somebody else has spoken for will not be there for the
                next job.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {invQ.status === 'loading' ? <LoadingState label="Reading the yard" /> : null}
              {invQ.status === 'error'
                ? <ErrorState message={invQ.message} onRetry={invQ.refetch} /> : null}
              {invQ.status === 'ready' && inventory.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="Nothing in stock"
                    description="An inventory item is a material held at a location, with what is on hand and what is reserved against it." />
                </div>
              ) : null}

              {inventory.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead className="text-right">Reserved</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="text-right">Reorder at</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventory.map((i) => (
                      <TableRow key={i.id} className={cn(i.belowReorderPoint && 'bg-warn-50/50')}>
                        <TableCell>
                          <p className="font-medium text-charcoal-900">{i.name}</p>
                          <p className="font-mono text-xs text-charcoal-500">
                            {i.sku}{i.category ? ` · ${i.category}` : ''}
                          </p>
                        </TableCell>
                        <TableCell className="text-charcoal-600">{i.location}</TableCell>
                        <TableCell className="tabular text-right">{qty(i.onHand, 0)} {i.unit}</TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">
                          {qty(i.reserved, 0)}
                        </TableCell>
                        <TableCell className={cn('tabular text-right font-medium',
                          i.belowReorderPoint && 'text-warn-700')}>
                          {qty(i.available, 0)}
                        </TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">
                          {i.reorderPoint === null ? '—' : qty(i.reorderPoint, 0)}
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {money(i.onHand * i.unitCost)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="hover:bg-charcoal-50">
                      <TableCell colSpan={6}>Value on hand</TableCell>
                      <TableCell className="tabular text-right">{money(inventoryValue)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
