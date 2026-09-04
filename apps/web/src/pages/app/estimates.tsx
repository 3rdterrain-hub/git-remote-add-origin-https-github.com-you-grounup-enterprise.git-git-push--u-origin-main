import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calculator, Search, Filter, ArrowUpDown, AlertTriangle } from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/misc';
import { ConfidencePill } from '@/components/estimating';
import { ESTIMATES } from '@/data/operations';
import { money, moneyCompact, dateTime, titleCase } from '@/lib/format';

const STATUS_TONE: Record<string, 'default' | 'success' | 'warn' | 'danger' | 'info'> = {
  draft: 'default', in_review: 'warn', approved: 'info', issued: 'info',
  awarded: 'success', lost: 'danger', archived: 'default',
};

export function EstimatesPage() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<'updated' | 'value' | 'confidence'>('updated');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ESTIMATES
      .filter((e) => (status === 'all' ? true : e.status === status))
      .filter((e) => !q || `${e.number} ${e.name} ${e.customer} ${e.estimator}`.toLowerCase().includes(q))
      .sort((a, b) =>
        sort === 'value' ? b.value - a.value
        : sort === 'confidence' ? b.confidence - a.confidence
        : b.updatedAt.localeCompare(a.updatedAt));
  }, [query, status, sort]);

  const totalValue = ESTIMATES.filter((e) => ['draft', 'in_review', 'issued'].includes(e.status)).reduce((a, e) => a + e.value, 0);
  const blocked = ESTIMATES.filter((e) => e.blocked).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estimating"
        description="Every estimate is versioned. An issued version is immutable — a change creates a new version with a stated reason, so the number a bid went out at is always recoverable."
        actions={<Button><Calculator className="size-4" /> New Estimate</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Estimates" value={ESTIMATES.length} hint="all statuses" />
        <StatTile label="Live value" value={moneyCompact(totalValue)} hint="draft, in review and issued" />
        <StatTile label="Blocked from issue" value={blocked} tone={blocked ? 'danger' : 'success'}
          hint="unresolved conflicts or open RFIs" />
        <StatTile label="Win rate" value="62%" tone="success" hint="last 12 months, by value" />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-charcoal-200 p-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal-400" />
              <Input className="pl-9" placeholder="Search by number, project, customer or estimator…"
                value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full sm:w-44"><Filter className="size-4 text-charcoal-400" /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {['draft', 'in_review', 'issued', 'awarded', 'lost'].map((s) => (
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
            <EmptyState icon={<Search className="size-5" />} title="No estimates match those filters"
              description="Try a different status or clear the search."
              action={<Button variant="outline" onClick={() => { setQuery(''); setStatus('all'); }}>Clear filters</Button>} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Estimate</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Conf.</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead>Estimator</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Link to={`/app/estimates/${e.id}`} className="font-medium text-charcoal-900 hover:text-yellow-700">
                        {e.number}
                      </Link>
                      <p className="max-w-72 truncate text-xs text-charcoal-500">{e.name}</p>
                      <p className="text-xs text-charcoal-400">version {e.version}</p>
                    </TableCell>
                    <TableCell className="text-charcoal-700">{e.customer}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_TONE[e.status] ?? 'default'}>{titleCase(e.status)}</Badge>
                    </TableCell>
                    <TableCell className="tabular text-right font-medium">
                      {e.value ? money(e.value) : <span className="text-charcoal-400">not priced</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {e.confidence ? <ConfidencePill score={e.confidence} /> : <span className="text-charcoal-400">—</span>}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 text-xs text-charcoal-600">
                        {e.blocked ? <AlertTriangle className="size-3.5 shrink-0 text-danger-600" /> : null}
                        {titleCase(e.decision)}
                      </span>
                    </TableCell>
                    <TableCell className="text-charcoal-700">{e.estimator}</TableCell>
                    <TableCell className="text-right text-xs text-charcoal-500">{dateTime(e.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
