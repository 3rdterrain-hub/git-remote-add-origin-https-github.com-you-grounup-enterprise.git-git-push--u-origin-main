/**
 * The GrounUp Network. LIBRARY.
 *
 * Subcontractors and suppliers, with the performance history behind them. The
 * only screen in this application that reads rows another company wrote, which
 * is why the rules it works under are said on it rather than assumed:
 *
 *   * A listing is **private until consent is recorded and somebody publishes**.
 *   * A rating is **never attributed** to the company that left it.
 *   * An average is **never shown without its count**.
 *
 * Until migration 0210 this page rendered five invented vendors from a fixture
 * on a live route — the tables had existed since 0023 with no writer and no
 * reader at all. Everything here now comes through `my_network_vendors` and
 * `my_network_ratings`, both `security_invoker`, so the rows that arrive are the
 * rows row level security allows; the fixture survives only as the sample an
 * unconnected environment shows, and the shell says when that is what it is.
 */
import { useMemo, useState } from 'react';
import {
  Network, ShieldCheck, ShieldAlert, Star, Search, Award, MapPin, EyeOff, Handshake,
} from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Alert, Separator } from '@/components/ui/misc';
import { LoadingState, ErrorState, DemonstrationNotice } from '@/components/data-state';
import { ListAVendor } from '@/components/network/list-a-vendor';
import { ListingActions } from '@/components/network/listing-actions';
import { RateAVendor } from '@/components/network/rate-a-vendor';
import { useQuery } from '@/lib/data/query';
import { useCompanyId, usePermissions } from '@/lib/data/session';
import {
  loadNetworkVendors, loadNetworkRatings, demonstrationNetwork,
  type NetworkVendor, type NetworkRating,
} from '@/lib/data/network';
import { moneyWhole, date, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

const INSURANCE_WARN_DAYS = 45;

/*
 * Dated by the database against `current_date`, not by the browser.
 *
 * The figure that decides whether a certificate has lapsed is the one the view
 * computes, because a clock skewed on one laptop should not change whether a
 * sub reads as covered — and the page it used to be computed on carried a
 * hard-coded today that would have gone stale the moment it shipped.
 */
function insuranceState(v: NetworkVendor) {
  if (v.daysUntilInsuranceLapses === null) {
    return { tone: 'danger' as const, label: 'No certificate on file' };
  }
  if (v.insuranceLapsed) {
    return { tone: 'danger' as const, label: `Expired ${date(v.insuranceExpiresOn!)}` };
  }
  if (v.daysUntilInsuranceLapses <= INSURANCE_WARN_DAYS) {
    return { tone: 'warn' as const, label: `Expires in ${plural(v.daysUntilInsuranceLapses, 'day')}` };
  }
  return { tone: 'success' as const, label: `Covered to ${date(v.insuranceExpiresOn!)}` };
}

function Stars({ value, count }: { value: number; count: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${value} out of 5 from ${count} ratings`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn('size-3.5', i <= Math.round(value) ? 'fill-yellow-500 text-yellow-500' : 'text-charcoal-300')}
        />
      ))}
      <span className="tabular ml-1 text-xs font-semibold text-charcoal-700">{value.toFixed(1)}</span>
      {/* The count travels with the average everywhere. One rating shown as a
          score is a number with more authority than it has earned. */}
      <span className="ml-1 text-xs text-charcoal-500">({count})</span>
    </span>
  );
}

/** What each of the four boxes above the vendor list narrows it to. */
type Lens = 'all' | 'published' | 'rated' | 'insurance' | 'diverse';

const LENS_SAYS: Record<Lens, string> = {
  all: 'every vendor',
  published: 'the vendors published to the network',
  rated: 'the vendors with performance history',
  insurance: 'the vendors whose insurance needs attention',
  diverse: 'the DBE, MBE and WBE certified vendors',
};

export function NetworkPage() {
  const [nonce, setNonce] = useState(0);
  const again = () => setNonce((n) => n + 1);
  const vendorsQ = useQuery(loadNetworkVendors, [nonce]);
  const ratingsQ = useQuery(loadNetworkRatings, [nonce]);
  const { companyId } = useCompanyId();
  const { can } = usePermissions();

  const [query, setQuery] = useState('');
  const [trade, setTrade] = useState<string | null>(null);
  /*
   * Each box counted vendors that are already in the list below and left the
   * reader to find them among fifty cards. It is a lens on the same list, and
   * it composes with the search and the trade buttons rather than replacing
   * them.
   */
  const [lens, setLens] = useState<Lens>('all');

  const demonstration = vendorsQ.status === 'demonstration';
  const sample = useMemo(() => demonstrationNetwork(), []);
  const vendors: NetworkVendor[] = vendorsQ.status === 'ready' ? vendorsQ.data
    : demonstration ? sample.vendors : [];
  const ratings: NetworkRating[] = ratingsQ.status === 'ready' ? ratingsQ.data
    : demonstration ? sample.ratings : [];

  const byVendor = useMemo(() => {
    const m = new Map<string, NetworkRating[]>();
    for (const r of ratings) {
      const list = m.get(r.vendorId);
      if (list) list.push(r); else m.set(r.vendorId, [r]);
    }
    return m;
  }, [ratings]);

  const trades = useMemo(
    () => [...new Set(vendors.flatMap((v) => v.trades))].sort((a, b) => a.localeCompare(b)),
    [vendors],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vendors
      .filter((v) => {
        // Unpublished vendors are your private record — they are visible to you
        // because you own them, and to nobody else.
        if (lens === 'published' && !v.isPublished) return false;
        if (lens === 'rated' && v.ratingCount === 0) return false;
        if (lens === 'insurance' && insuranceState(v).tone === 'success') return false;
        if (lens === 'diverse' && !(v.isDbe || v.isMbe || v.isWbe)) return false;
        if (trade && !v.trades.includes(trade)) return false;
        if (!q) return true;
        return (
          v.displayName.toLowerCase().includes(q) ||
          v.legalName.toLowerCase().includes(q) ||
          v.trades.some((t) => t.toLowerCase().includes(q)) ||
          v.regions.some((r) => r.toLowerCase().includes(q)) ||
          `${v.city ?? ''} ${v.state ?? ''}`.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.averageOverall ?? 0) - (a.averageOverall ?? 0));
  }, [vendors, query, trade, lens]);

  const published = vendors.filter((v) => v.isPublished);
  const rated = vendors.filter((v) => v.ratingCount > 0);
  const lapsing = vendors.filter((v) => insuranceState(v).tone !== 'success');
  const diverse = vendors.filter((v) => v.isDbe || v.isMbe || v.isWbe);
  const awaitingConsent = vendors.filter((v) => v.isMine && !v.consentOnRecord);
  const canWriteLibrary = can('libraries.write');
  const canRate = can('crm.write');

  if (vendorsQ.status === 'loading') return <LoadingState label="Reading the network" />;
  if (vendorsQ.status === 'error') {
    return <ErrorState message={vendorsQ.message} onRetry={vendorsQ.refetch} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="GrounUp Network"
        description="Subcontractors and suppliers, with the performance history behind them. Ratings come from companies that actually held a contract with the vendor — one rating per company per project, so nobody can inflate or bury a record, and no rating is ever attributed to the company that left it."
        actions={(
          <ListAVendor companyId={companyId} canWrite={canWriteLibrary && !demonstration}
            onListed={again} />
        )}
      />

      {demonstration ? <DemonstrationNotice /> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Vendors in network" value={published.length} icon={<Network className="size-4" />}
          hint={`${vendors.length - published.length} of yours kept private`}
          onClick={() => setLens((l) => (l === 'published' ? 'all' : 'published'))}
          active={lens === 'published'}
          actionLabel="List the vendors published to the network" />
        <StatTile label="With performance history" value={rated.length}
          icon={<Star className="size-4" />}
          hint={`${plural(vendors.reduce((a, v) => a + v.ratingCount, 0), 'rating')} from real contracts`}
          onClick={() => setLens((l) => (l === 'rated' ? 'all' : 'rated'))}
          active={lens === 'rated'}
          actionLabel="List the vendors somebody has rated" />
        <StatTile label="Insurance attention" value={lapsing.length}
          tone={lapsing.length ? 'warn' : 'success'} icon={<ShieldAlert className="size-4" />}
          hint={`expiring inside ${INSURANCE_WARN_DAYS} days`}
          onClick={() => setLens((l) => (l === 'insurance' ? 'all' : 'insurance'))}
          active={lens === 'insurance'}
          actionLabel="List the vendors whose insurance needs attention" />
        <StatTile label="DBE / MBE / WBE" value={diverse.length} icon={<Award className="size-4" />}
          hint="certified, for participation goals"
          onClick={() => setLens((l) => (l === 'diverse' ? 'all' : 'diverse'))}
          active={lens === 'diverse'}
          actionLabel="List the certified DBE, MBE and WBE vendors" />
      </div>

      {/*
        * The one thing a person came here to do and cannot finish. A listing
        * with no consent on file is not publishable, and saying so once at the
        * top beats finding out on each card.
        */}
      {awaitingConsent.length ? (
        <Alert tone="info" icon={<Handshake className="size-4" />}
          title={`${plural(awaitingConsent.length, 'listing')} waiting on consent`}>
          {awaitingConsent.map((v) => v.displayName).join(', ')} — private until you record how the
          vendor agreed to be listed. Publishing another company's legal name, contact details and
          insurance status without their agreement on file is the one thing a directory must not do.
        </Alert>
      ) : null}

      {lens !== 'all' ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-charcoal-600">
          <span>Showing {LENS_SAYS[lens]}.</span>
          <Button variant="outline" size="sm" onClick={() => setLens('all')}>
            Show all {vendors.length}
          </Button>
        </div>
      ) : null}

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
          {vendors.length === 0
            ? 'Nothing is listed on the network yet. Add a vendor you work with — it stays private until you publish it.'
            : 'No vendor matches that search.'}
        </CardContent></Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {results.map((v) => {
          const ins = insuranceState(v);
          const theirs = byVendor.get(v.id) ?? [];
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
                      {v.isMine ? <Badge variant="outline">Your listing</Badge> : null}
                    </CardTitle>
                    <CardDescription className="mt-0.5 flex items-center gap-1.5">
                      <MapPin className="size-3" />
                      {[v.city, v.state].filter(Boolean).join(', ') || 'Location not given'}
                      {v.regions.length ? ` · ${v.regions.join(' · ')}` : ''}
                    </CardDescription>
                  </div>
                  {v.averageOverall !== null ? (
                    <Stars value={v.averageOverall} count={v.ratingCount} />
                  ) : (
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

                {theirs.length ? (
                  <>
                    <Separator />
                    <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
                      {plural(v.ratingCount, 'rating')} · {v.wouldHireAgainCount} would hire again
                    </p>
                    <ul className="space-y-2.5">
                      {theirs.map((r) => (
                        <li key={r.id} className="text-sm">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            {/*
                              * Who left it is deliberately not shown. The view
                              * returns the rater's identity to the rater's own
                              * company and to nobody else, so this is what the
                              * data says rather than a decision taken here.
                              */}
                            <span className="font-medium text-charcoal-800">
                              {r.isMine
                                ? `Your company${r.projectNumber ? ` · ${r.projectNumber}` : ''}`
                                : 'A contractor on the network'}
                            </span>
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

                {demonstration ? null : (
                  <>
                    <RateAVendor vendor={v} companyId={companyId} canWrite={canRate}
                      onRated={again} />
                    <ListingActions vendor={v} canWrite={canWriteLibrary} onChanged={again} />
                  </>
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
        project, each company may leave exactly one, and it is shown to everybody else without their name on it —
        which together is what keeps the history worth reading.
      </Alert>
    </div>
  );
}
