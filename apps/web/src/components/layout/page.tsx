import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Standard page header: title, one line of context, and the page's actions. */
export function PageHeader({
  title, description, actions, breadcrumb, className,
}: {
  title: string; description?: ReactNode; actions?: ReactNode; breadcrumb?: ReactNode; className?: string;
}) {
  return (
    <div className={cn('mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0 space-y-1">
        {breadcrumb ? <div className="text-xs font-medium text-charcoal-500">{breadcrumb}</div> : null}
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">{title}</h1>
        {description ? <div className="max-w-3xl text-sm text-charcoal-500">{description}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * KPI tile. `hint` explains what the number means, so nothing is a mystery metric.
 *
 * A tile that counts something the screen below can show is a question with an
 * answer already on the page, and until now there was no way to ask it: every
 * tile in this application was a `div`. "Blocked from issue: 3" told an
 * estimator there were three and left them to find which.
 *
 * So a tile with an `onClick` renders as a real button — focusable, reachable
 * from the keyboard, and announced as pressed while its filter is the one in
 * force. A tile with nothing to show stays a `div` rather than becoming a
 * button that does nothing, because a control that does not respond is worse
 * than a number that never offered.
 */
export function StatTile({
  label, value, hint, tone = 'neutral', icon, onClick, active = false, actionLabel,
}: {
  label: string; value: ReactNode; hint?: ReactNode;
  tone?: 'neutral' | 'success' | 'warn' | 'danger' | 'accent'; icon?: ReactNode;
  /** What this tile shows when clicked. Omit and it stays a plain tile. */
  onClick?: () => void;
  /** Whether what this tile shows is what the screen is showing now. */
  active?: boolean;
  /** Overrides the button's accessible name where the label alone is not enough. */
  actionLabel?: string;
}) {
  const accents = {
    neutral: 'text-charcoal-900',
    success: 'text-success-700',
    warn: 'text-warn-700',
    danger: 'text-danger-700',
    accent: 'text-charcoal-900',
  } as const;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">{label}</p>
        {icon ? <span className="text-charcoal-300">{icon}</span> : null}
      </div>
      <p className={cn('tabular mt-2 text-2xl font-bold tracking-tight', accents[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-charcoal-500">{hint}</p> : null}
    </>
  );

  const shell = 'rounded-[--radius-card] border bg-white p-4 text-left shadow-sm';

  if (!onClick) {
    return <div className={cn(shell, 'border-charcoal-200')}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={actionLabel}
      className={cn(
        shell,
        'w-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-2',
        active
          ? 'border-yellow-500 ring-1 ring-yellow-500'
          : 'border-charcoal-200 hover:border-charcoal-400 hover:bg-charcoal-50',
      )}
    >
      {body}
    </button>
  );
}

/** A labeled value in a definition-style row. */
export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-0.5', className)}>
      <dt className="text-xs font-medium uppercase tracking-wide text-charcoal-500">{label}</dt>
      <dd className="text-sm font-medium text-charcoal-900">{children}</dd>
    </div>
  );
}
