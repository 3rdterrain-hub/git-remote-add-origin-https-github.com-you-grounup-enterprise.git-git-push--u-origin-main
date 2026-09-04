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

/** KPI tile. `hint` explains what the number means, so nothing is a mystery metric. */
export function StatTile({
  label, value, hint, tone = 'neutral', icon,
}: {
  label: string; value: ReactNode; hint?: ReactNode;
  tone?: 'neutral' | 'success' | 'warn' | 'danger' | 'accent'; icon?: ReactNode;
}) {
  const accents = {
    neutral: 'text-charcoal-900',
    success: 'text-success-700',
    warn: 'text-warn-700',
    danger: 'text-danger-700',
    accent: 'text-charcoal-900',
  } as const;
  return (
    <div className="rounded-[--radius-card] border border-charcoal-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">{label}</p>
        {icon ? <span className="text-charcoal-300">{icon}</span> : null}
      </div>
      <p className={cn('tabular mt-2 text-2xl font-bold tracking-tight', accents[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-charcoal-500">{hint}</p> : null}
    </div>
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
