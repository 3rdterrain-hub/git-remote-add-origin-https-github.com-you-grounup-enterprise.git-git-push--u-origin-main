/**
 * What came back from a pricing run.
 *
 * Four outcomes, and three of them are not errors. An estimate that cannot be
 * priced because a machine has no rate in force is telling the estimator
 * something specific and fixable; collapsing that into "pricing failed" would
 * leave them guessing at a bid they are about to send.
 *
 * Shared by the demonstration workspace and the live one, because the wording
 * is the point: two screens phrasing the same four outcomes differently is two
 * chances for one of them to be less careful than the other.
 */
import { AlertTriangle, Ban, CheckCircle2 } from 'lucide-react';
import { Alert } from '@/components/ui/misc';
import type { PricingOutcome } from '@/lib/data/pricing';
import { money, percent, integer, titleCase } from '@/lib/format';

export function PricingOutcomeNotice({ outcome }: { outcome: PricingOutcome }) {
  if (outcome.status === 'priced') {
    const r = outcome.result;
    return (
      <Alert tone="success" icon={<CheckCircle2 className="size-4" />}
        title={`Priced at ${money(r.bidPrice)} by engine ${r.engineVersion}`}>
        {integer(r.lineCount)} lines · direct {money(r.directCost)} · margin{' '}
        {percent(r.grossMarginPercent)} · confidence {r.weightedConfidence.toFixed(1)}{' '}
        ({titleCase(r.confidenceBand)}).
        {r.blockedFromIssue
          ? ` Still blocked from issue: ${r.executiveDecisionReason}`
          : ' Ready to issue.'}
        {r.warnings.length ? ` ${r.warnings.length} warning(s) recorded on the version.` : ''}
      </Alert>
    );
  }

  if (outcome.status === 'incomplete') {
    return (
      <Alert tone="warn" icon={<AlertTriangle className="size-4" />}
        title="The engine needs more before it can price this">
        <ul className="mt-1 space-y-1">
          {outcome.problems.map((p, i) => (
            <li key={`${p.field}-${p.lineId ?? 'version'}-${i}`} className="flex gap-2">
              <span className="font-mono text-[11px] text-charcoal-500">{p.field}</span>
              <span>{p.detail}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-charcoal-500">
          Nothing was written. A price computed around a missing rate is a confident
          number with nothing behind it, which is the one thing this refuses to produce.
        </p>
      </Alert>
    );
  }

  if (outcome.status === 'frozen') {
    return (
      <Alert tone="info" icon={<Ban className="size-4" />} title="This version's price is frozen">
        {outcome.message}
      </Alert>
    );
  }

  return (
    <Alert tone="danger" icon={<AlertTriangle className="size-4" />} title="Pricing did not run">
      {outcome.message}
    </Alert>
  );
}
