/**
 * Claims and entitlement, live.
 *
 * This page read `CLAIMS` from `@/data/survey`. The `claims` table has existed
 * since migration 0023, fully governed, and nothing had ever read it.
 *
 * What the page is for is one number: **notice at risk**. A claim whose
 * contractual notice period lapses is usually worth nothing however good the
 * argument, and the database says the same thing — `claims_notice` refuses any
 * status past `potential` without the date notice was given. The page exists to
 * make that visible before the date passes rather than after.
 *
 * The deadline itself is not a field somebody filled in. Migration 0032 derives
 * `notice_due_on` from the contract's own notice clause, always — an earlier
 * version computed it only when the column was null, which meant supplying a
 * date bypassed the contract silently. Its reasoning is why this page is shaped
 * around one number: "most construction claims are lost on the notice clause
 * rather than on their merits, so a deadline that disagrees with the contract is
 * the most dangerous field in this table."
 *
 * And a resolved claim is frozen. `claims_award_frozen` refuses an edit to the
 * award, the resolution, the amounts or the status once a claim is settled or
 * denied, because reopening a settled claim is a new claim.
 *
 * Two other constraints are shown rather than restated. `claims_notice_order`
 * refuses notice dated before the event it is about. `claims_resolved` requires
 * a settled or denied claim to carry the date *and* the resolution — "denied"
 * with no reason recorded is an outcome nobody can learn from.
 *
 * The supporting record is the other half. A claim is argued from
 * contemporaneous documents, and until migration 0157 this afternoon a company
 * could not create a daily report at all — so a claim had nothing to point at.
 * The counts here are what those arrays hold.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Gavel, Clock, AlertTriangle, FileText, MessageSquareWarning, Paperclip, ShieldCheck,
} from 'lucide-react';
import { PageHeader, StatTile, Field } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, EmptyState } from '@/components/ui/misc';
import { LoadingState, ErrorState, DemonstrationNotice } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import { loadClaims, type ClaimRow } from '@/lib/data/claims';
import { money, date, titleCase, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warn' | 'danger' | 'info' | 'outline'> = {
  potential: 'outline', notice_given: 'info', submitted: 'info', negotiating: 'warn',
  settled: 'success', denied: 'danger', withdrawn: 'outline', litigation: 'danger',
};

const OPEN = ['potential', 'notice_given', 'submitted', 'negotiating', 'litigation'];

type Filter = 'all' | 'open' | 'awarded' | 'at-risk';

const FILTER_SAYS: Record<Exclude<Filter, 'all'>, string> = {
  open: 'the claims that are still open',
  awarded: 'the claims that have been awarded something',
  'at-risk': 'the claims whose notice has not been served',
};

/** What the two notice dates say together, in one line. */
function noticeState(c: ClaimRow): { label: string; detail: string; tone: string } {
  if (c.noticeGivenOn) {
    /*
     * The margin, not just the fact. Notice served on the last possible day and
     * notice served the next morning are both "served" on a badge, and very
     * different facts when somebody disputes whether it was timely.
     */
    const margin = Math.round(
      (new Date(c.noticeGivenOn).getTime() - new Date(c.eventDate).getTime()) / 86_400_000);
    return {
      label: `Served ${date(c.noticeGivenOn)}`,
      detail: `Entitlement preserved — ${plural(margin, 'day')} after the event.`,
      tone: 'success',
    };
  }
  if (c.noticeDueOn === null) {
    return {
      label: 'No notice period recorded',
      detail: 'The contract may still impose one.',
      tone: 'warn',
    };
  }
  const days = c.daysToNotice ?? 0;
  if (days < 0) {
    return {
      label: `Lapsed ${plural(-days, 'day')} ago`,
      detail: 'The contractual period has closed.',
      tone: 'danger',
    };
  }
  return {
    label: `Due in ${plural(days, 'day')}`,
    detail: `By ${date(c.noticeDueOn)}, or the entitlement is gone regardless of the merits.`,
    tone: days <= 3 ? 'danger' : 'warn',
  };
}

export function ClaimsPage() {
  const claimsQ = useQuery(loadClaims, []);
  const claims = claimsQ.status === 'ready' ? claimsQ.data : [];
  const [filter, setFilter] = useState<Filter>('all');

  const open = claims.filter((c) => OPEN.includes(c.status));
  const claimed = open.reduce((a, c) => a + c.costClaimed, 0);
  const recovered = claims.reduce((a, c) => a + (c.costAwarded ?? 0), 0);
  const daysAwarded = claims.reduce((a, c) => a + (c.timeAwardedDays ?? 0), 0);
  /* Unserved notice on a claim that is still live. A settled claim whose date
     has passed is not at risk of anything, and flagging it buries the ones that
     are. */
  const atRisk = claims.filter((c) => c.noticeAtRisk);
  const closing = atRisk.filter((c) => (c.daysToNotice ?? 99) <= 3);

  const shown = filter === 'open' ? open
    : filter === 'awarded' ? claims.filter((c) => c.costAwarded !== null)
      : filter === 'at-risk' ? atRisk
        : claims;

  if (claimsQ.status === 'demonstration') {
    return (
      <div className="space-y-6">
        <PageHeader title="Claims &amp; Entitlement"
          description="A claim is argued from what was recorded at the time, not from what anyone remembers afterwards." />
        <DemonstrationNotice />
      </div>
    );
  }
  if (claimsQ.status === 'loading') return <LoadingState label="Reading the claims" />;
  if (claimsQ.status === 'error') {
    return <ErrorState message={claimsQ.message} onRetry={claimsQ.refetch} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Claims &amp; Entitlement"
        description="A claim is argued from what was recorded at the time, not from what anyone remembers afterwards. Notice is what preserves it, and the deadline is derived from the contract's own clause rather than typed — most construction claims are lost on the notice clause rather than on their merits."
      />

      {closing.length ? (
        <Alert tone="danger" icon={<AlertTriangle className="size-4" />}
          title={`${plural(closing.length, 'claim')} within the notice window`}>
          {closing.map((c) => c.number).join(', ')} — notice has not been served and the
          contractual period closes within three days. After that the entitlement is gone
          regardless of the merits.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Open claims" value={open.length} icon={<Gavel className="size-4" />}
          hint={`${money(claimed)} claimed`}
          onClick={() => setFilter((f) => (f === 'open' ? 'all' : 'open'))}
          active={filter === 'open'}
          actionLabel="List the claims that are still open" />
        <StatTile label="Recovered to date" value={money(recovered)} tone="success"
          icon={<ShieldCheck className="size-4" />}
          hint={`across ${plural(claims.filter((c) => c.costAwarded !== null).length, 'awarded claim')}`}
          onClick={() => setFilter((f) => (f === 'awarded' ? 'all' : 'awarded'))}
          active={filter === 'awarded'}
          actionLabel="List the claims that have been awarded" />
        <StatTile label="Time awarded" value={plural(daysAwarded, 'day')}
          icon={<Clock className="size-4" />} hint="extension granted"
          detail={
            <div className="space-y-2">
              <p>
                Days of extension granted across every claim, added together. It is days awarded,
                not days claimed — what was asked for is on each claim, and the gap between the two
                is what the negotiation cost.
              </p>
            </div>
          } />
        <StatTile label="Notice at risk" value={atRisk.length}
          tone={atRisk.length ? 'danger' : 'success'} hint="unserved on a live claim"
          onClick={() => setFilter((f) => (f === 'at-risk' ? 'all' : 'at-risk'))}
          active={filter === 'at-risk'}
          actionLabel="List the claims whose notice has not been served" />
      </div>

      {filter !== 'all' ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-charcoal-600">
          <span>Showing {FILTER_SAYS[filter]}.</span>
          <Button variant="outline" size="sm" onClick={() => setFilter('all')}>
            Show all {claims.length}
          </Button>
        </div>
      ) : null}

      <div className="space-y-4">
        {claims.length === 0 ? (
          <EmptyState title="No claims on any project"
            description="A claim records an event, the notice given for it, and what is being asked for in money and time. It is argued from the daily reports and RFIs recorded when it happened." />
        ) : null}
        {claims.length > 0 && shown.length === 0 ? (
          <Card><CardContent className="p-6 text-sm text-charcoal-600">
            None of the {claims.length} claims match.
          </CardContent></Card>
        ) : null}

        {shown.map((c) => {
          const notice = noticeState(c);
          const resolved = c.costAwarded !== null;
          return (
            <Card key={c.id}>
              <CardHeader className="gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-charcoal-500">
                        {c.number}
                      </span>
                      <Badge variant={STATUS_VARIANT[c.status] ?? 'default'}>
                        {titleCase(c.status)}
                      </Badge>
                      <Badge variant="outline">{titleCase(c.claimType)}</Badge>
                      {c.projectNumber ? (
                        <Link to={`/app/projects/${c.projectId}`}
                          className="font-mono text-xs text-charcoal-500 hover:underline">
                          {c.projectNumber}
                        </Link>
                      ) : null}
                      {c.contractNumber ? (
                        <span className="font-mono text-xs text-charcoal-400">
                          {c.contractNumber}
                        </span>
                      ) : null}
                    </div>
                    <CardTitle className="mt-1.5">{c.title}</CardTitle>
                    <CardDescription className="mt-1 max-w-3xl">{c.description}</CardDescription>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
                      {resolved ? 'Awarded' : 'Claimed'}
                    </p>
                    <p className={cn('tabular text-xl font-bold',
                      resolved ? 'text-success-700' : 'text-charcoal-900')}>
                      {money(resolved ? c.costAwarded! : c.costClaimed)}
                    </p>
                    {(resolved ? c.timeAwardedDays : c.timeClaimedDays) ? (
                      <p className="text-xs text-charcoal-500">
                        + {plural(resolved ? c.timeAwardedDays! : c.timeClaimedDays, 'day')}
                      </p>
                    ) : null}
                    {resolved && c.costClaimed > (c.costAwarded ?? 0) ? (
                      /* What the negotiation cost, which is the number nobody
                         writes down and everybody wants at the next one. */
                      <p className="text-xs text-charcoal-400">
                        of {money(c.costClaimed)} claimed
                      </p>
                    ) : null}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Event occurred">{date(c.eventDate)}</Field>
                  <Field label="Notice">
                    <span className={cn('font-medium',
                      notice.tone === 'danger' && 'text-danger-700',
                      notice.tone === 'warn' && 'text-warn-700',
                      notice.tone === 'success' && 'text-success-700')}>
                      {notice.label}
                    </span>
                    <span className="mt-0.5 block text-xs font-normal text-charcoal-500">
                      {notice.detail}
                    </span>
                  </Field>
                  <Field label="Full claim">
                    {c.claimSubmittedOn
                      ? `Submitted ${date(c.claimSubmittedOn)}`
                      : c.claimDueOn ? `Due ${date(c.claimDueOn)}` : 'No date recorded'}
                  </Field>
                  <Field label="Supporting record">
                    <span className="flex flex-wrap gap-1">
                      <Badge variant="outline">
                        <FileText className="size-3" /> {c.supportingReports} daily
                      </Badge>
                      <Badge variant="outline">
                        <MessageSquareWarning className="size-3" /> {c.supportingRfis} RFI
                      </Badge>
                      <Badge variant="outline">
                        <Paperclip className="size-3" /> {c.supportingDocuments} doc
                      </Badge>
                    </span>
                    {c.supportingReports + c.supportingRfis + c.supportingDocuments === 0 ? (
                      <span className="mt-1 block text-xs font-normal text-warn-700">
                        Nothing contemporaneous is attached. A claim is argued from what was
                        recorded at the time.
                      </span>
                    ) : null}
                  </Field>
                </dl>

                {/*
                  * A settled or denied claim carries its resolution because the
                  * schema requires one — an outcome with no stated reason is
                  * something nobody can learn from at the next negotiation.
                  */}
                {c.resolution ? (
                  <p className="rounded-md bg-charcoal-50 p-3 text-sm text-charcoal-700">
                    <span className="font-medium">
                      {titleCase(c.status)} {c.resolvedOn ? date(c.resolvedOn) : ''}
                    </span>{' '}
                    — {c.resolution}
                    {/*
                      * Said where somebody would otherwise try. The award, the
                      * resolution, the amounts and the status are all frozen
                      * once a claim is settled or denied: reopening a settled
                      * claim is a new claim, not an edit to this one.
                      */}
                    <span className="mt-1 block text-xs text-charcoal-500">
                      Settled and denied claims are frozen — reopening one is a new claim.
                    </span>
                  </p>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
