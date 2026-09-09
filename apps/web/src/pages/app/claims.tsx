import { useState } from 'react';
import { Gavel, Clock, TriangleAlert, FileText, MessageSquareWarning, CheckCircle2, Plus } from 'lucide-react';
import { PageHeader, StatTile, Field } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, Separator } from '@/components/ui/misc';
import { CLAIMS, type Claim } from '@/data/survey';
import { money, date, titleCase, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Today, fixed to the demo dataset's clock so the deadline maths is stable. */
const TODAY = new Date('2026-09-02T12:00:00');

function daysUntil(iso: string): number {
  const then = new Date(`${iso}T12:00:00`);
  return Math.round((then.getTime() - TODAY.getTime()) / 86_400_000);
}

/**
 * The state of the contractual notice clock.
 *
 * A claim is lost on the notice provision far more often than on the merits.
 * The contract's notice period is stored against the contract, the deadline is
 * derived in the database from the event date, and this reads that derivation
 * rather than recomputing it — the same rule that governs everything else here.
 */
function noticeState(c: Claim): { tone: 'success' | 'warn' | 'danger'; label: string; detail: string } {
  if (c.noticeGivenOn) {
    const margin = Math.round(
      (new Date(`${c.noticeDueOn}T12:00:00`).getTime() - new Date(`${c.noticeGivenOn}T12:00:00`).getTime()) / 86_400_000,
    );
    return {
      tone: 'success',
      label: 'Notice given',
      detail: margin >= 0
        ? `Served ${date(c.noticeGivenOn)}, ${plural(margin, 'day')} inside the period`
        : `Served ${date(c.noticeGivenOn)}, ${plural(-margin, 'day')} late`,
    };
  }
  const left = daysUntil(c.noticeDueOn);
  if (left < 0) return { tone: 'danger', label: 'Notice missed', detail: `Was due ${date(c.noticeDueOn)}` };
  if (left <= 3) return { tone: 'danger', label: `${plural(left, 'day')} to give notice`, detail: `Due ${date(c.noticeDueOn)}` };
  return { tone: 'warn', label: `${plural(left, 'day')} to give notice`, detail: `Due ${date(c.noticeDueOn)}` };
}

const STATUS_VARIANT = {
  potential: 'warn', submitted: 'info', under_review: 'info',
  negotiating: 'info', settled: 'success', denied: 'danger', withdrawn: 'default',
} as const;

/**
 * What each of the four boxes above the list narrows it to.
 *
 * Every one of them counted claims that are already on the page and left the
 * reader to find which — "notice at risk: 2" over eleven cards is a number and
 * a search.
 */
type ClaimFilter = 'all' | 'open' | 'awarded' | 'at-risk';

const FILTER_SAYS: Record<ClaimFilter, string> = {
  all: 'every claim',
  open: 'the claims that are still open',
  awarded: 'the claims that have been awarded something',
  'at-risk': 'the claims whose notice period closes within three days',
};

export function ClaimsPage() {
  const [filter, setFilter] = useState<ClaimFilter>('all');
  const open = CLAIMS.filter((c) => !['settled', 'denied', 'withdrawn'].includes(c.status));
  const atRisk = CLAIMS.filter((c) => !c.noticeGivenOn && daysUntil(c.noticeDueOn) <= 3);
  const claimed = open.reduce((a, c) => a + c.costClaimed, 0);
  const recovered = CLAIMS.reduce((a, c) => a + (c.costAwarded ?? 0), 0);
  const daysAwarded = CLAIMS.reduce((a, c) => a + (c.timeAwardedDays ?? 0), 0);
  const shown = filter === 'open' ? open
    : filter === 'awarded' ? CLAIMS.filter((c) => c.costAwarded !== null)
      : filter === 'at-risk' ? atRisk
        : CLAIMS;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Claims & Change Management"
        description="Notice periods are the reason claims are won or lost. The deadline is derived from the contract clause the moment the event is logged, not remembered by whoever was on site."
        actions={<Button><Plus className="size-4" /> Log an event</Button>}
      />

      {atRisk.length ? (
        <Alert tone="danger" icon={<TriangleAlert className="size-4" />}
          title={`${plural(atRisk.length, 'claim')} within the notice window`}>
          {atRisk.map((c) => c.number).join(', ')} — notice has not been served and the contractual period closes
          within three days. After that the entitlement is gone regardless of the merits.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Open claims" value={open.length} icon={<Gavel className="size-4" />}
          hint={`${money(claimed)} claimed`}
          onClick={() => setFilter((f) => (f === 'open' ? 'all' : 'open'))}
          active={filter === 'open'}
          actionLabel="List the claims that are still open" />
        <StatTile label="Recovered to date" value={money(recovered)} tone="success"
          hint={`across ${plural(CLAIMS.filter((c) => c.costAwarded !== null).length, 'settled claim')}`}
          onClick={() => setFilter((f) => (f === 'awarded' ? 'all' : 'awarded'))}
          active={filter === 'awarded'}
          actionLabel="List the claims that have been awarded" />
        <StatTile label="Time awarded" value={plural(daysAwarded, 'day')}
          icon={<Clock className="size-4" />} hint="excusable, compensable delay"
          detail={
            <div className="space-y-2">
              <p>
                Days of extension granted across every claim, added together. Excusable and
                compensable: the delay was not the contractor's fault and the contract pays for it,
                which is a different thing from an extension of time granted with no money attached.
              </p>
              <p>
                It is days awarded, not days claimed — what was asked for is on each claim, and the
                gap between the two is what the negotiation cost.
              </p>
            </div>
          } />
        <StatTile label="Notice at risk" value={atRisk.length}
          tone={atRisk.length ? 'danger' : 'success'} hint="unserved, inside three days"
          onClick={() => setFilter((f) => (f === 'at-risk' ? 'all' : 'at-risk'))}
          active={filter === 'at-risk'}
          actionLabel="List the claims whose notice period is closing" />
      </div>

      {filter !== 'all' ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-charcoal-600">
          <span>Showing {FILTER_SAYS[filter]}.</span>
          <Button variant="outline" size="sm" onClick={() => setFilter('all')}>
            Show all {CLAIMS.length}
          </Button>
        </div>
      ) : null}

      <div className="space-y-4">
        {shown.length === 0 ? (
          <Card><CardContent className="p-6 text-sm text-charcoal-600">
            None of the {CLAIMS.length} claims on this page match.
          </CardContent></Card>
        ) : null}
        {shown.map((c) => {
          const notice = noticeState(c);
          const claimLeft = daysUntil(c.claimDueOn);
          const resolved = c.costAwarded !== null;
          return (
            <Card key={c.id}>
              <CardHeader className="gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-charcoal-500">{c.number}</span>
                      <Badge variant={STATUS_VARIANT[c.status as keyof typeof STATUS_VARIANT] ?? 'default'}>
                        {titleCase(c.status)}
                      </Badge>
                      <Badge variant="outline">{titleCase(c.type)}</Badge>
                    </div>
                    <CardTitle className="mt-1.5">{c.title}</CardTitle>
                    <CardDescription className="mt-1 max-w-3xl">{c.description}</CardDescription>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
                      {resolved ? 'Awarded' : 'Claimed'}
                    </p>
                    <p className={cn('tabular text-xl font-bold', resolved ? 'text-success-700' : 'text-charcoal-900')}>
                      {money(resolved ? c.costAwarded! : c.costClaimed)}
                    </p>
                    {(resolved ? c.timeAwardedDays : c.timeClaimedDays) ? (
                      <p className="text-xs text-charcoal-500">
                        + {plural(resolved ? c.timeAwardedDays! : c.timeClaimedDays, 'day')}
                      </p>
                    ) : null}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Event occurred">{date(c.eventDate)}</Field>
                  <Field label="Notice">
                    <span className={cn(
                      'font-medium',
                      notice.tone === 'danger' && 'text-danger-700',
                      notice.tone === 'warn' && 'text-warn-700',
                      notice.tone === 'success' && 'text-success-700',
                    )}>{notice.label}</span>
                    <span className="mt-0.5 block text-xs font-normal text-charcoal-500">{notice.detail}</span>
                  </Field>
                  <Field label="Full claim due">
                    {date(c.claimDueOn)}
                    <span className="mt-0.5 block text-xs font-normal text-charcoal-500">
                      {resolved ? 'closed' : claimLeft >= 0 ? `${plural(claimLeft, 'day')} remaining` : `${plural(-claimLeft, 'day')} overdue`}
                    </span>
                  </Field>
                  <Field label="Supporting record">
                    <span className="flex flex-wrap gap-1">
                      <Badge variant="outline"><FileText className="size-3" /> {c.supporting.dailyReports} daily</Badge>
                      <Badge variant="outline"><MessageSquareWarning className="size-3" /> {c.supporting.rfis} RFI</Badge>
                      <Badge variant="outline">{c.supporting.documents} docs</Badge>
                    </span>
                  </Field>
                </dl>

                {c.resolution ? (
                  <>
                    <Separator />
                    <p className="flex gap-2 text-sm text-success-700">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                      <span>{c.resolution}</span>
                    </p>
                  </>
                ) : null}

                {c.supporting.dailyReports === 0 && !resolved ? (
                  <Alert tone="warn" icon={<TriangleAlert className="size-4" />}>
                    No daily reports are linked yet. Contemporaneous records are the evidence a claim stands on —
                    attach them while the crew still remembers the day.
                  </Alert>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Alert tone="neutral" icon={<Gavel className="size-4" />} title="How the deadlines are set">
        Each contract stores its notice period and claim period as clauses. When an event is logged, the database
        derives the notice and claim deadlines from the event date and those clauses — so the date on this page
        comes from the contract, not from someone's memory of it. Changing a claim's event date re-derives both.
      </Alert>
    </div>
  );
}
