import { UserPlus, TrendingUp, Trophy, XCircle, Building2, Mail, Phone } from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, Progress } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CUSTOMERS, OPPORTUNITIES } from '@/data/operations';
import { money, moneyCompact, percent, date, relativeDays, titleCase } from '@/lib/format';

const STAGES = ['identified', 'qualifying', 'estimating', 'proposed', 'negotiating'] as const;

export function CrmPage() {
  const openOpps = OPPORTUNITIES.filter((o) => !['won', 'lost'].includes(o.stage));
  const pipeline = openOpps.reduce((a, o) => a + o.value, 0);
  const weighted = openOpps.reduce((a, o) => a + o.value * o.probability, 0);
  const won = OPPORTUNITIES.filter((o) => o.stage === 'won');
  const lost = OPPORTUNITIES.filter((o) => o.stage === 'lost');

  return (
    <div className="space-y-6">
      <PageHeader
        title="CRM & Customers"
        description="The pipeline that feeds estimating. A lost job must record why it was lost — win/loss analysis is worthless without it, and it is the input to the next bid strategy."
        actions={<Button><UserPlus className="size-4" /> Add customer</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Open pipeline" value={moneyCompact(pipeline)} icon={<TrendingUp className="size-4" />}
          hint={`${openOpps.length} live opportunities`} />
        <StatTile label="Weighted pipeline" value={moneyCompact(weighted)} icon={<TrendingUp className="size-4" />}
          hint="value × probability" />
        <StatTile label="Customers" value={CUSTOMERS.length} icon={<Building2 className="size-4" />}
          hint={`${moneyCompact(CUSTOMERS.reduce((a, c) => a + c.wonValue, 0))} lifetime awarded`} />
        <StatTile label="Win rate" value="62%" tone="success" icon={<Trophy className="size-4" />}
          hint={`${won.length} won, ${lost.length} lost, last 12 months`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pipeline by stage</CardTitle>
          <CardDescription>Value in each stage, and how much of it is weighted by probability.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-5">
            {STAGES.map((stage) => {
              const inStage = openOpps.filter((o) => o.stage === stage);
              const value = inStage.reduce((a, o) => a + o.value, 0);
              return (
                <div key={stage} className="rounded-md border border-charcoal-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">{titleCase(stage)}</p>
                  <p className="tabular mt-1.5 text-xl font-bold text-charcoal-900">{moneyCompact(value)}</p>
                  <p className="text-xs text-charcoal-500">{inStage.length} opportunit{inStage.length === 1 ? 'y' : 'ies'}</p>
                  <Progress value={pipeline ? (value / pipeline) * 100 : 0} className="mt-2" />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="opportunities">
        <TabsList>
          <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="lost">Win / loss</TabsTrigger>
        </TabsList>

        <TabsContent value="opportunities">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Opportunity</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Prob.</TableHead>
                  <TableHead className="text-right">Weighted</TableHead>
                  <TableHead>Bid due</TableHead>
                  <TableHead>Estimate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openOpps.map((o) => {
                  const days = Math.round((new Date(o.bidDueAt).getTime() - Date.now()) / 86_400_000);
                  return (
                    <TableRow key={o.id}>
                      <TableCell className="max-w-72">
                        <p className="truncate font-medium text-charcoal-900">{o.name}</p>
                        <p className="text-xs text-charcoal-400">{o.number} · {o.owner}</p>
                      </TableCell>
                      <TableCell className="text-charcoal-700">{o.customerName}</TableCell>
                      <TableCell><Badge variant={o.stage === 'negotiating' ? 'success' : 'default'}>{titleCase(o.stage)}</Badge></TableCell>
                      <TableCell className="tabular text-right font-medium">{money(o.value)}</TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">{percent(o.probability, 0)}</TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">{moneyCompact(o.value * o.probability)}</TableCell>
                      <TableCell>
                        <Badge variant={days <= 7 ? 'danger' : days <= 14 ? 'warn' : 'default'}>{relativeDays(o.bidDueAt)}</Badge>
                        <p className="mt-0.5 text-xs text-charcoal-400">{date(o.bidDueAt)}</p>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-charcoal-600">{o.estimateNumber ?? '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="customers">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Primary contact</TableHead>
                  <TableHead className="text-right">Open opps</TableHead>
                  <TableHead className="text-right">Awarded to date</TableHead>
                  <TableHead>Customer since</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {CUSTOMERS.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <p className="font-medium text-charcoal-900">{c.name}</p>
                      <p className="text-xs text-charcoal-400">{c.code} · {c.city}, {c.state}</p>
                    </TableCell>
                    <TableCell><Badge variant="outline">{c.type}</Badge></TableCell>
                    <TableCell className="text-sm">
                      <p className="text-charcoal-900">{c.contact}</p>
                      <p className="flex items-center gap-1 text-xs text-charcoal-500"><Mail className="size-3" /> {c.email}</p>
                      <p className="flex items-center gap-1 text-xs text-charcoal-500"><Phone className="size-3" /> {c.phone}</p>
                    </TableCell>
                    <TableCell className="tabular text-right">{c.openOpportunities || '—'}</TableCell>
                    <TableCell className="tabular text-right font-medium">{c.wonValue ? money(c.wonValue) : '—'}</TableCell>
                    <TableCell className="text-charcoal-600">{date(c.since)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="lost" className="space-y-4">
          <Alert tone="neutral" icon={<XCircle className="size-4" />} title="Every loss carries a reason">
            The database refuses to mark an opportunity lost without one. A pipeline that forgets why
            it lost cannot tell you whether you are pricing too high or estimating too conservatively.
          </Alert>
          {lost.map((o) => (
            <Card key={o.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-charcoal-900">{o.name}</p>
                    <p className="text-xs text-charcoal-500">{o.number} · {o.customerName} · bid {date(o.bidDueAt)}</p>
                  </div>
                  <Badge variant="danger">Lost · {money(o.value)}</Badge>
                </div>
                <p className="mt-3 rounded-md bg-charcoal-50 p-3 text-sm text-charcoal-700">{o.lossReason}</p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
