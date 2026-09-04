import { useMemo, useState } from 'react';
import {
  Network, ShieldCheck, ShieldAlert, Star, Search, Award, MapPin, Building2, EyeOff,
} from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Alert, Separator } from '@/components/ui/misc';
import { NETWORK_VENDORS, vendorScore, type NetworkVendor } from '@/data/survey';
import { moneyWhole, date, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

const TODAY = new Date('2026-09-02T12:00:00');
const INSURANCE_WARN_DAYS = 45;

function insuranceState(v: NetworkVendor) {
  if (!v.insuranceExpiresOn) return { tone: 'danger' as const, label: 'No certificate on file' };
  const days = Math.round((new Date(`${v.insuranceExpiresOn}T12:00:00`).getTime() - TODAY.getTime()) / 86_400_000);
  if (days < 0) return { tone: 'danger' as const, label: `Expired ${date(v.insuranceExpiresOn)}` };
  if (days <= INSURANCE_WARN_DAYS) return { tone: 'warn' as const, label: `Expires in ${plural(days, 'day')}` };
  return { tone: 'success' as const, label: `Covered to ${date(v.insuranceExpiresOn)}` };
}

function Stars({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn('size-3.5', i <= Math.round(value) ? 'fill-yellow-500 text-yellow-500' : 'text-charcoal-300')}
        />
      ))}
      <span className="tabular ml-1 text-xs font-semibold text-charcoal-700">{value.toFixed(1)}</span>
    </span>
  );
}

export function NetworkPage() {
  const [query, setQuery] = useState('');
  const [trade, setTrade] = useState<string | null>(null);

  const trades = useMemo(
    () => [...new Set(NETWORK_VENDORS.flatMap((v) => v.trades))].sort((a, b) => a.localeCompare(b)),
    [],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return NETWORK_VENDORS
      .filter((v) => {
        // Unpublished vendors are your private record — they are visible to you
        // because you own them, and to nobody else.
        if (trade && !v.trades.includes(trade)) return false;
        if (!q) return true;
        return (
          v.displayName.toLowerCase().includes(q) ||
          v.legalName.toLowerCase().includes(q) ||
          v.trades.some((t) => t.toLowerCase().includes(q)) ||
          v.regions.some((r) => r.toLowerCase().includes(q)) ||
          `${v.city} ${v.state}`.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (vendorScore(b) ?? 0) - (vendorScore(a) ?? 0));
  }, [query, trade]);

  const published = NETWORK_VENDORS.filter((v) => v.isPublished);
  const rated = NETWORK_VENDORS.filter((v) => v.ratings.length > 0);
  const lapsing = NETWORK_VENDORS.filter((v) => insuranceState(v).tone !== 'success');
  const diverse = NETWORK_VENDORS.filter((v) => v.isDbe || v.isMbe || v.isWbe);

  return (
    <div className="space-y-6">
      <PageHeader
        title="GrounUp Network"
        description="Subcontractors and suppliers, with the performance history behind them. Ratings come from companies that actually held a contract with the vendor — one rating per company per project, so nobody can inflate or bury a record."
        actions={<Button variant="outline"><Building2 className="size-4" /> Publish a vendor</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Vendors in network" value={published.length} icon={<Network className="size-4" />}
          hint={`${NETWORK_VENDORS.length - published.length} of yours kept private`} />
        <StatTile label="With performance history" value={rated.length}
          icon={<Star className="size-4" />}
          hint={`${NETWORK_VENDORS.reduce((a, v) => a + v.ratings.length, 0)} ratings from real contracts`} />
        <StatTile label="Insurance attention" value={lapsing.length}
          tone={lapsing.length ? 'warn' : 'success'} icon={<ShieldAlert className="size-4" />}
          hint={`expiring inside ${INSURANCE_WARN_DAYS} days`} />
        <StatTile label="DBE / MBE / WBE" value={diverse.length} icon={<Award className="size-4" />}
          hint="certified, for participation goals" />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search trade, name, city or region…"
              className="pl-9"
              aria-label="Search the vendor network"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant={trade === null ? 'default' : 'outline'} onClick={() => setTrade(null)}>
              All trades
            </Button>
            {trades.map((t) => (
              <Button key={t} size="sm" variant={trade === t ? 'default' : 'outline'}
                onClick={() => setTrade(trade === t ? null : t)}>
                {t}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {results.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-charcoal-500">
          No vendor matches that search.
        </CardContent></Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {results.map((v) => {
          const ins = insuranceState(v);
          const score = vendorScore(v);
          const wouldHire = v.ratings.filter((r) => r.wouldHireAgain).length;
          return (
            <Card key={v.id}>
              <CardHeader className="gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {v.displayName}
                      {!v.isPublished ? (
                        <Badge variant="outline" title="Visible only to your company">
                          <EyeOff className="size-3" /> Private
                        </Badge>
                      ) : null}
                    </CardTitle>
                    <CardDescription className="mt-0.5 flex items-center gap-1.5">
                      <MapPin className="size-3" /> {v.city}, {v.state} · {v.regions.join(' · ')}
                    </CardDescription>
                  </div>
                  {score !== null ? <Stars value={score} /> : (
                    <Badge variant="outline">No history yet</Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {v.trades.map((t) => <Badge key={t} variant="default">{t}</Badge>)}
                  {v.isDbe ? <Badge variant="info">DBE</Badge> : null}
                  {v.isMbe ? <Badge variant="info">MBE</Badge> : null}
                  {v.isWbe ? <Badge variant="info">WBE</Badge> : null}
                </div>
              </CardHeader>

              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                  <span className={cn(
                    'flex items-center gap-1.5',
                    ins.tone === 'success' && 'text-success-700',
                    ins.tone === 'warn' && 'text-warn-700',
                    ins.tone === 'danger' && 'text-danger-700',
                  )}>
                    {ins.tone === 'success' ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}
                    {ins.label}
                  </span>
                  {v.bondingCapacity ? (
                    <span className="text-charcoal-600">Bonding to {moneyWhole(v.bondingCapacity)}</span>
                  ) : (
                    <span className="text-charcoal-400">Not bonded</span>
                  )}
                </div>

                {v.certifications.length ? (
                  <p className="text-xs text-charcoal-500">{v.certifications.join(' · ')}</p>
                ) : null}

                {v.ratings.length ? (
                  <>
                    <Separator />
                    <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
                      {plural(v.ratings.length, 'rating')} · {wouldHire} would hire again
                    </p>
                    <ul className="space-y-2.5">
                      {v.ratings.map((r, i) => (
                        <li key={i} className="text-sm">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-medium text-charcoal-800">{r.company}</span>
                            <span className="text-xs text-charcoal-500">
                              {r.contractValue ? `${moneyWhole(r.contractValue)} contract` : 'contract value withheld'}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-charcoal-600">
                            <span>Quality {r.quality}/5</span>
                            <span>Schedule {r.schedule}/5</span>
                            <span>Safety {r.safety}/5</span>
                            <span>Communication {r.communication}/5</span>
                          </div>
                          {r.comment ? (
                            <p className="mt-1 border-l-2 border-charcoal-200 pl-2.5 text-[13px] italic text-charcoal-600">
                              {r.comment}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-sm text-charcoal-500">
                    No company has rated this vendor yet. A rating can only be left by a company that held a
                    contract with them.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Alert tone="neutral" icon={<Network className="size-4" />} title="What the network can and cannot see">
        Publishing a vendor shares the directory record — name, trades, service area, certifications and the
        ratings left against them. It shares nothing else: your contracts with that vendor, your rates, your bids
        and your project data stay inside your company. A rating is written by one company about one vendor on one
        project, and each company may leave exactly one, which is what keeps the history worth reading.
      </Alert>
    </div>
  );
}
