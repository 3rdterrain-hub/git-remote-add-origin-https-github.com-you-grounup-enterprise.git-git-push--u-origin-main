import { useState } from 'react';
import { FileText, Send, Download, Lock, CheckCircle2, Plus } from 'lucide-react';
import { PageHeader, StatTile, Field } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, Separator, Switch } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ESTIMATE, COMPANY } from '@/data/demo';
import { money, moneyCompact, percent, unitRate, date, titleCase } from '@/lib/format';
import { Logo } from '@/components/layout/logo';

/**
 * Proposals are generated from a priced estimate version, never typed.
 * The line detail below is rolled up from the estimate's own lines, so a
 * proposal total can always be traced to the work behind it.
 */
const PROPOSALS = [
  { id: 'pp-1', number: 'PROP-2026-0184', title: 'Maumee Commerce Park — Phase 1 Sitework', customer: 'Maumee Development Partners', estimate: 'EST-2026-0184 v3', status: 'draft', total: ESTIMATE.bidPrice, validityDays: 30, issuedAt: null as string | null, viewedAt: null as string | null },
  { id: 'pp-2', number: 'PROP-2026-0179', title: 'Airport Highway culvert replacement', customer: 'Lucas County Engineer', estimate: 'EST-2026-0179 v2', status: 'issued', total: 1_142_500, validityDays: 30, issuedAt: '2026-08-28', viewedAt: '2026-08-29' },
  { id: 'pp-3', number: 'PROP-2026-0171', title: 'Maumee Commerce Park — Phase 2 utilities', customer: 'Maumee Development Partners', estimate: 'EST-2026-0171 v4', status: 'accepted', total: 1_482_000, validityDays: 30, issuedAt: '2026-08-21', viewedAt: '2026-08-21' },
  { id: 'pp-4', number: 'PROP-2026-0158', title: 'Oregon Road industrial pad', customer: 'Northwood Industrial REIT', estimate: 'EST-2026-0158 v3', status: 'declined', total: 786_400, validityDays: 30, issuedAt: '2026-06-19', viewedAt: '2026-06-20' },
];

/** Line sections rolled up from the estimate by discipline. */
function proposalSections() {
  const byDiscipline = new Map<string, { qty: number; unit: string; price: number; count: number }>();
  const markupFactor = ESTIMATE.price.totalPrice / ESTIMATE.totalDirectCost;
  for (const l of ESTIMATE.lines) {
    const key = l.discipline ?? 'Other';
    const entry = byDiscipline.get(key) ?? { qty: 0, unit: l.quantity.unit, price: 0, count: 0 };
    entry.price += l.totalDirectCost * markupFactor;
    entry.count += 1;
    byDiscipline.set(key, entry);
  }
  return [...byDiscipline.entries()].map(([name, v]) => ({ name, ...v }));
}

const STATUS_TONE: Record<string, 'default' | 'info' | 'success' | 'danger'> = {
  draft: 'default', issued: 'info', accepted: 'success', declined: 'danger', expired: 'default', withdrawn: 'default',
};

export function ProposalsPage() {
  const [selected, setSelected] = useState(PROPOSALS[0]!);
  const [showUnitPrices, setShowUnitPrices] = useState(true);
  const [showLineDetail, setShowLineDetail] = useState(false);
  const sections = proposalSections();
  const issued = PROPOSALS.filter((p) => p.status !== 'draft');
  const accepted = PROPOSALS.filter((p) => p.status === 'accepted');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proposals"
        description="Generated from a priced estimate version, never retyped. Once issued, a proposal's content is frozen — a change means issuing a new one, so the document a customer holds is always reproducible."
        actions={<Button><Plus className="size-4" /> New proposal</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Proposals" value={PROPOSALS.length} icon={<FileText className="size-4" />}
          hint={`${issued.length} issued`} />
        <StatTile label="Issued value" value={moneyCompact(issued.reduce((a, p) => a + p.total, 0))}
          hint="excluding drafts" />
        <StatTile label="Accepted" value={moneyCompact(accepted.reduce((a, p) => a + p.total, 0))} tone="success"
          icon={<CheckCircle2 className="size-4" />} hint={`${accepted.length} of ${issued.length} issued`} />
        <StatTile label="Acceptance rate" value={percent(accepted.length / Math.max(issued.length, 1), 0)}
          tone="success" hint="by count, last 12 months" />
      </div>

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
                {PROPOSALS.map((p) => (
                  <TableRow key={p.id}
                    className={selected.id === p.id ? 'bg-charcoal-50' : 'cursor-pointer'}
                    onClick={() => setSelected(p)}>
                    <TableCell>
                      <button className="text-left">
                        <p className="font-medium text-charcoal-900">{p.number}</p>
                        <p className="max-w-56 truncate text-xs text-charcoal-500">{p.title}</p>
                        <p className="text-xs text-charcoal-400">{p.customer}</p>
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_TONE[p.status] ?? 'default'}>{titleCase(p.status)}</Badge>
                      {p.viewedAt ? <p className="mt-0.5 text-xs text-charcoal-400">viewed {date(p.viewedAt)}</p> : null}
                    </TableCell>
                    <TableCell className="tabular text-right font-medium">{money(p.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* ------------------------------------------------ document preview */}
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>{selected.number}</CardTitle>
              <CardDescription>Preview · from {selected.estimate}</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline"><Download className="size-4" /> PDF</Button>
              <Button size="sm" disabled={selected.status !== 'draft'}>
                <Send className="size-4" /> {selected.status === 'draft' ? 'Issue' : 'Issued'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {selected.status !== 'draft' ? (
              <Alert tone="neutral" icon={<Lock className="size-4" />} title="This proposal is issued and frozen">
                Issued {date(selected.issuedAt)}. Its content cannot change — the database refuses the edit.
                A revision means issuing a new proposal, so the document the customer holds stays reproducible.
              </Alert>
            ) : (
              <div className="flex flex-wrap gap-6 rounded-md border border-charcoal-200 bg-charcoal-50 p-3">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={showUnitPrices} onCheckedChange={setShowUnitPrices} aria-label="Show unit prices" />
                  <span className="text-charcoal-700">Show unit prices</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={showLineDetail} onCheckedChange={setShowLineDetail} aria-label="Show line detail" />
                  <span className="text-charcoal-700">Show full line detail</span>
                </label>
              </div>
            )}

            {/* The rendered document */}
            <div className="rounded-md border border-charcoal-300 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4 border-b border-charcoal-200 pb-4">
                <Logo />
                <div className="text-right text-xs text-charcoal-500">
                  <p className="font-semibold text-charcoal-900">{COMPANY.name}</p>
                  <p>{COMPANY.city}, {COMPANY.state}</p>
                  <p className="mt-1">{selected.number}</p>
                  <p>{date(selected.issuedAt ?? new Date().toISOString())}</p>
                </div>
              </div>

              <div className="grid gap-4 py-4 sm:grid-cols-2">
                <Field label="Prepared for">{selected.customer}</Field>
                <Field label="Project">{selected.title}</Field>
                <Field label="Proposal valid for">{selected.validityDays} days</Field>
                <Field label="Payment terms">Net 30, monthly progress billing</Field>
              </div>

              <Separator />

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Scope</TableHead>
                    {showLineDetail ? <TableHead className="text-right">Lines</TableHead> : null}
                    {showUnitPrices ? <TableHead className="text-right">Unit</TableHead> : null}
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sections.map((s) => (
                    <TableRow key={s.name}>
                      <TableCell className="font-medium text-charcoal-900">{s.name}</TableCell>
                      {showLineDetail ? (
                        <TableCell className="tabular text-right text-charcoal-500">{s.count}</TableCell>
                      ) : null}
                      {showUnitPrices ? (
                        <TableCell className="tabular text-right text-charcoal-500">
                          {unitRate(s.price / Math.max(s.count, 1))}
                        </TableCell>
                      ) : null}
                      <TableCell className="tabular text-right font-medium">{money(s.price)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-charcoal-50">
                    <TableCell colSpan={1 + (showLineDetail ? 1 : 0) + (showUnitPrices ? 1 : 0)}>
                      Total proposal amount
                    </TableCell>
                    <TableCell className="tabular text-right text-base">{money(selected.total)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>

              <Separator className="my-4" />

              <div className="space-y-3 text-xs leading-relaxed text-charcoal-600">
                <div>
                  <p className="mb-1 font-semibold uppercase tracking-wide text-charcoal-900">Assumptions</p>
                  <ul className="list-inside list-disc space-y-0.5">
                    {ESTIMATE.lines.flatMap((l) => l.assumptions).slice(0, 5).map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 font-semibold uppercase tracking-wide text-charcoal-900">Exclusions</p>
                  <ul className="list-inside list-disc space-y-0.5">
                    <li>Dewatering beyond routine sump pumping</li>
                    <li>Rock excavation — none indicated in the geotechnical borings</li>
                    <li>Permit and impact fees — by owner per Division 01</li>
                    <li>Contaminated soil handling or disposal</li>
                    <li>Winter protection and heating</li>
                  </ul>
                </div>
              </div>
            </div>

            {selected.status === 'draft' && ESTIMATE.blockedFromIssue ? (
              <Alert tone="danger" title="The source estimate is blocked from issue">
                {ESTIMATE.executiveDecisionReason} A proposal cannot be issued from an estimate that is not
                cleared to issue.
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
