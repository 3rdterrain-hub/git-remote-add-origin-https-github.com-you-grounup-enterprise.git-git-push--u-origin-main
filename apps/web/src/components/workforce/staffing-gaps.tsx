/**
 * The certificate that lapses while somebody is still on the job.
 *
 * The assignment control answers "may I put this person on this work today".
 * Nobody had ever asked it the other question: is everybody I already assigned
 * still qualified tomorrow. A ticket that expires three weeks into a six week
 * assignment passes on the day it is made and lapses in the middle of the work.
 *
 * Two kinds, kept apart, because they are different problems. Somebody on site
 * unqualified **today** is a call to make this morning. A ticket that runs out
 * on the twelfth is a renewal to book. Listing them together would bury the
 * first in the second.
 */
import { useState } from 'react';
import { AlertTriangle, CalendarClock, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import { loadStaffingGaps, type StaffingGap } from '@/lib/data/staffing';
import { date, titleCase } from '@/lib/format';

function Row({ g }: { g: StaffingGap }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-charcoal-200
                   py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-charcoal-900">
          {g.employeeName}
          <span className="ml-2 font-normal text-charcoal-500">{g.credentialName}</span>
        </p>
        <p className="mt-0.5 text-xs text-charcoal-600">
          {titleCase(g.workType.replace(/_/g, ' '))} on{' '}
          <Link to={`/app/projects/${g.projectId}`}
            className="underline-offset-2 hover:underline">{g.projectNumber}</Link>
          {' · '}{date(g.startsOn)} to {date(g.endsOn)}
        </p>
        <p className="mt-0.5 text-xs text-charcoal-500">{g.reason}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {g.isMandatory ? <Badge variant="danger">mandatory</Badge>
                       : <Badge variant="default">recommended</Badge>}
        {g.uncoveredFrom ? (
          <span className="tabular text-xs text-charcoal-600">
            uncovered from {date(g.uncoveredFrom)}
          </span>
        ) : null}
      </div>
    </li>
  );
}

export function StaffingGaps() {
  const gaps = useQuery(loadStaffingGaps, []);
  const all = gaps.status === 'ready' ? gaps.data : [];
  const now = all.filter((g) => g.alreadyLapsed);
  const soon = all.filter((g) => !g.alreadyLapsed);

  /*
   * Controlled rather than `defaultOpen`, which is read once at mount — before
   * the query has answered. A card told to open itself when somebody is on site
   * uncovered would mount shut and stay shut on precisely the day it mattered.
   */
  const [openedByHand, setOpenedByHand] = useState<boolean | null>(null);
  const showing = openedByHand ?? (gaps.status === 'ready' && now.length > 0);

  return (
    <CollapsibleCard
      title={<span className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-charcoal-500" /> Who is covered for the work
      </span>}
      description="Assignments whose mandatory credentials do not last as long as the work does. The assignment check asks whether somebody may start; this asks whether they can finish."
      summary={all.length === 0 ? 'everyone covered'
        : `${now.length} on site uncovered · ${soon.length} lapsing mid-job`}
      open={showing}
      onOpenChange={setOpenedByHand}
    >
      <div className="space-y-4">
        {gaps.status === 'loading' ? <LoadingState label="Checking the next ninety days" /> : null}
        {gaps.status === 'error'
          ? <ErrorState message={gaps.message} onRetry={gaps.refetch} /> : null}

        {gaps.status === 'ready' && all.length === 0 ? (
          <EmptyState title="Everyone is covered for the whole of their work"
            hint="Checked across the next ninety days of assignments." />
        ) : null}

        {now.length > 0 ? (
          <section>
            <h3 className="flex items-center gap-1.5 text-sm font-medium text-danger-700">
              <AlertTriangle className="size-4" />
              On site now without cover ({now.length})
            </h3>
            <ul className="mt-1">{now.map((g) => <Row key={`${g.assignmentId}-${g.credentialName}`} g={g} />)}</ul>
          </section>
        ) : null}

        {soon.length > 0 ? (
          <section>
            <h3 className="flex items-center gap-1.5 text-sm font-medium text-warn-700">
              <CalendarClock className="size-4" />
              Runs out before the work does ({soon.length})
            </h3>
            <ul className="mt-1">{soon.map((g) => <Row key={`${g.assignmentId}-${g.credentialName}`} g={g} />)}</ul>
          </section>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}
