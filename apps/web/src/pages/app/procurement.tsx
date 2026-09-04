import {
  ShoppingCart, Package, Scale, CheckCircle2, Plus, TrendingDown, Boxes,
} from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, Progress } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RFQS, PURCHASE_ORDERS, INVENTORY } from '@/data/finance';
import { money, moneyCompact, percent, qty, integer, date, titleCase, plural, relativeDays } from '@/lib/format';
import { cn } from '@/lib/utils';

export function ProcurementPage() {
  const openPos = PURCHASE_ORDERS.filter((p) => !['closed', 'canceled'].includes(p.status));
  const committed = openPos.reduce((a, p) => a + p.committed, 0);
  const invoiced = PURCHASE_ORDERS.reduce((a, p) => a + p.invoiced, 0);
  // Committed but not yet invoiced: cost the company already owes.
  const openCommitment = openPos.reduce((a, p) => a + (p.committed - p.invoiced), 0);

  const belowReorder = INVENTORY.filter((i) => i.onHand - i.reserved < i.reorderPoint);
  const inventoryValue = INVENTORY.reduce((a, i) => a + i.onHand * i.unitCost, 0);
  const activeRfqs = RFQS.filter((r) => !['awarded', 'canceled'].includes(r.status));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Procurement & Inventory"
        description="Quotes, commitments and stock. A purchase order commits cost before an invoice arrives, which is what makes a budget overrun visible while there is still time to act on it."
        actions={
          <>
            <Button variant="outline"><Scale className="size-4" /> New RFQ</Button>
            <Button><Plus className="size-4" /> Purchase order</Button>
          </>
        }
      />

      {belowReorder.length ? (
        <Alert tone="warn" icon={<TrendingDown className="size-4" />}
          title={`${plural(belowReorder.length, 'item')} below reorder point`}>
          {belowReorder.map((i) => `${i.name} (${qty(i.onHand - i.reserved, 0)} ${i.unit} available, reorder at ${qty(i.reorderPoint, 0)})`).join('; ')}.
          Available is on-hand less what other crews have already reserved.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Open commitments" value={moneyCompact(committed)} icon={<ShoppingCart className="size-4" />}
          hint={`${plural(openPos.length, 'purchase order')}`} />
        <StatTile label="Not yet invoiced" value={moneyCompact(openCommitment)} tone="warn"
          hint="cost already owed against open POs" />
        <StatTile label="Invoiced to date" value={moneyCompact(invoiced)} hint="across all purchase orders" />
        <StatTile label="Active RFQs" value={activeRfqs.length} icon={<Scale className="size-4" />}
          hint={`${RFQS.filter((r) => r.status === 'leveling').length} in leveling`} />
        <StatTile label="Inventory value" value={moneyCompact(inventoryValue)} icon={<Boxes className="size-4" />}
          hint={`${belowReorder.length} below reorder`} />
      </div>

      <Tabs defaultValue="rfqs">
        <TabsList>
          <TabsTrigger value="rfqs">RFQs &amp; leveling ({RFQS.length})</TabsTrigger>
          <TabsTrigger value="pos">Purchase orders ({openPos.length} open)</TabsTrigger>
          <TabsTrigger value="inventory">Inventory ({INVENTORY.length})</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------------ RFQs */}
        <TabsContent value="rfqs" className="space-y-4">
          {RFQS.map((r) => {
            const quoted = r.responses.filter((x) => x.quoted !== null);
            const lowRaw = quoted.length ? Math.min(...quoted.map((x) => x.quoted!)) : null;
            const lowLeveled = quoted.length ? Math.min(...quoted.map((x) => x.quoted! + x.levelingAdjustment)) : null;
            // The interesting case: leveling changes who is actually cheapest.
            const levelingFlipped = lowRaw !== null && lowLeveled !== null &&
              quoted.find((x) => x.quoted === lowRaw)!.quoted! + quoted.find((x) => x.quoted === lowRaw)!.levelingAdjustment !== lowLeveled;

            return (
              <Card key={r.id}>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle>{r.number} — {r.title}</CardTitle>
                    <CardDescription>
                      {r.trade} · due {date(r.dueAt)} ({relativeDays(r.dueAt)})
                    </CardDescription>
                  </div>
                  <Badge variant={r.status === 'awarded' ? 'success' : r.status === 'leveling' ? 'warn' : 'default'}>
                    {titleCase(r.status)}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3">
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
                        const leveled = x.quoted !== null ? x.quoted + x.levelingAdjustment : null;
                        const isLow = leveled !== null && leveled === lowLeveled;
                        return (
                          <TableRow key={x.vendor} className={cn(isLow && 'bg-success-50/50')}>
                            <TableCell className="font-medium text-charcoal-900">
                              {x.vendor}
                              {isLow ? <Badge variant="success" className="ml-2">Low</Badge> : null}
                            </TableCell>
                            <TableCell className="tabular text-right">
                              {x.quoted !== null ? money(x.quoted) : <span className="text-charcoal-400">—</span>}
                            </TableCell>
                            <TableCell className={cn('tabular text-right', x.levelingAdjustment ? 'text-warn-700' : 'text-charcoal-400')}>
                              {x.levelingAdjustment ? `+${money(x.levelingAdjustment)}` : '—'}
                            </TableCell>
                            <TableCell className="tabular text-right font-medium">
                              {leveled !== null ? money(leveled) : '—'}
                            </TableCell>
                            <TableCell className="tabular text-right text-charcoal-600">
                              {x.leadTimeDays !== null ? `${x.leadTimeDays}d` : '—'}
                            </TableCell>
                            <TableCell>
                              <Badge variant={
                                x.status === 'awarded' ? 'success'
                                : x.status === 'declined' ? 'default' : 'outline'
                              }>{titleCase(x.status)}</Badge>
                            </TableCell>
                            <TableCell className="text-xs leading-relaxed text-charcoal-500">{x.note ?? ''}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                  {levelingFlipped ? (
                    <Alert tone="info" icon={<Scale className="size-4" />} title="Leveling changed the low bidder">
                      The apparent low quote excluded scope the others included. Adding it back is what makes the
                      comparison honest — and the adjustment stays visible rather than being folded into the number.
                    </Alert>
                  ) : null}

                  {r.awardReason ? (
                    <Alert tone="success" icon={<CheckCircle2 className="size-4" />}
                      title={`Awarded to ${r.awardedVendor}`}>
                      {r.awardReason} An award reason is required by the database — awarding to anyone other than
                      the low bidder is defensible only if the reason was recorded at the time.
                    </Alert>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* -------------------------------------------------- purchase orders */}
        <TabsContent value="pos">
          <Card>
            <CardHeader>
              <CardTitle>Purchase orders</CardTitle>
              <CardDescription>
                Committed cost is the number that tells a project manager they are over budget while there is
                still time to do something about it — not when the invoice arrives.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
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
                  {PURCHASE_ORDERS.map((p) => {
                    const pct = p.committed ? p.invoiced / p.committed : 0;
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <p className="font-mono text-xs font-medium text-charcoal-900">{p.number}</p>
                          <p className="max-w-48 truncate text-xs text-charcoal-500">{p.title}</p>
                        </TableCell>
                        <TableCell className="text-charcoal-700">{p.vendor}</TableCell>
                        <TableCell className="font-mono text-xs text-charcoal-600">{p.project}</TableCell>
                        <TableCell><Badge variant="outline">{titleCase(p.type)}</Badge></TableCell>
                        <TableCell className="tabular text-right font-medium">{money(p.committed)}</TableCell>
                        <TableCell>
                          <Progress value={pct * 100} indicatorClassName={pct >= 0.99 ? 'bg-success-600' : 'bg-charcoal-700'} />
                          <p className="tabular mt-1 text-xs text-charcoal-500">{money(p.invoiced)} ({percent(pct, 0)})</p>
                        </TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">{money(p.committed - p.invoiced)}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-charcoal-600">{date(p.neededBy)}</TableCell>
                        <TableCell>
                          <Badge variant={
                            p.status === 'closed' ? 'success'
                            : p.status === 'partially_received' ? 'warn' : 'info'
                          }>{titleCase(p.status)}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-charcoal-50">
                    <TableCell colSpan={4}>Totals</TableCell>
                    <TableCell className="tabular text-right">
                      {money(PURCHASE_ORDERS.reduce((a, p) => a + p.committed, 0))}
                    </TableCell>
                    <TableCell className="tabular">{money(invoiced)}</TableCell>
                    <TableCell className="tabular text-right">
                      {money(PURCHASE_ORDERS.reduce((a, p) => a + p.committed - p.invoiced, 0))}
                    </TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------- inventory */}
        <TabsContent value="inventory">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Package className="size-4" /> Stock on hand</CardTitle>
              <CardDescription>
                Available is on-hand less reserved. Reserving more than exists is refused by the database —
                that is how two crews end up both planning on the same pipe.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead className="text-right">Reserved</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead className="text-right">Reorder at</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {INVENTORY.map((i) => {
                    const available = i.onHand - i.reserved;
                    const low = available < i.reorderPoint;
                    return (
                      <TableRow key={i.id} className={cn(low && 'bg-warn-50/40')}>
                        <TableCell>
                          <p className="font-medium text-charcoal-900">{i.name}</p>
                          <p className="font-mono text-xs text-charcoal-400">{i.sku}</p>
                        </TableCell>
                        <TableCell className="text-charcoal-600">{i.category}</TableCell>
                        <TableCell className="text-charcoal-600">{i.location}</TableCell>
                        <TableCell className="tabular text-right">{integer(i.onHand)} {i.unit}</TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">
                          {i.reserved ? integer(i.reserved) : '—'}
                        </TableCell>
                        <TableCell className={cn('tabular text-right font-medium', low ? 'text-warn-700' : 'text-charcoal-900')}>
                          {integer(available)}
                        </TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">{integer(i.reorderPoint)}</TableCell>
                        <TableCell className="tabular text-right">{money(i.onHand * i.unitCost)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-charcoal-50">
                    <TableCell colSpan={7}>Total inventory value</TableCell>
                    <TableCell className="tabular text-right">{money(inventoryValue)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
