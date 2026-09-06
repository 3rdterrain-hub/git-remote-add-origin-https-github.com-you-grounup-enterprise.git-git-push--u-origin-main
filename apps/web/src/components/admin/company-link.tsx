/**
 * A company's name, and the way in.
 *
 * Six operator screens named a company and none of them let you open it: churn,
 * payment failures, cancellations, operator activity, upsell proposals and the
 * outbox all printed a name as plain text. Every one of those is a screen
 * somebody is on *because* something is wrong with that company, and the next
 * thing they want is that company — so a name that cannot be clicked makes them
 * go to the companies list and find it by hand.
 *
 * Falls back to plain text when there is no id to link to, rather than
 * rendering a link that goes nowhere: a control that looks live and is not is
 * worse than one that was never offered.
 */
import { Link } from 'react-router-dom';

export function CompanyLink({ id, name, className, children }: {
  id: string | null | undefined;
  name: string | null | undefined;
  className?: string;
  /** Anything to show under the name — a seat count, an email. */
  children?: React.ReactNode;
}) {
  const label = name ?? '—';
  if (!id) {
    return <span className={className}>{label}{children}</span>;
  }
  return (
    <span className={className}>
      <Link to={`/admin/companies/${id}`}
        className="font-medium text-charcoal-900 underline-offset-2 hover:text-yellow-700
                   hover:underline focus-visible:outline focus-visible:outline-2
                   focus-visible:outline-yellow-500">
        {label}
      </Link>
      {children}
    </span>
  );
}
