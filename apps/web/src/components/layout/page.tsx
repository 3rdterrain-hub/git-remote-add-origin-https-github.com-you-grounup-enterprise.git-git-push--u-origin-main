import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
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
 * Send a tile to the part of the page that accounts for its number.
 *
 * Most tiles sit above a section that already contains the answer. "Blocked
 * from issue: 3" and, four hundred pixels below, the three of them. The tile
 * knew and the reader had to go looking.
 *
 * `show(id)` scrolls that section into view and marks the tile pressed while it
 * is the one being answered; `showing` is what a tile passes to `active`. The
 * section needs an `id` and nothing else, so this costs a section one attribute
 * and a tile two props.
 *
 * Written once here rather than a hundred times in the screens, because a
 * hundred copies of a scroll call is a hundred chances to disagree about what
 * "smooth" and "start" mean.
 */
export function useAnswerBelow() {
  const [showing, setShowing] = useState<string | null>(null);

  const show = (id: string) => {
    setShowing((current) => (current === id ? null : id));
    /*
     * Guarded: `scrollIntoView` is not implemented in jsdom, and a tile that
     * throws when it is clicked is worse than one that does not scroll.
     */
    const el = typeof document === 'undefined' ? null : document.getElementById(id);
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  return { showing, show };
}

/**
 * KPI tile. `hint` explains what the number means, so nothing is a mystery metric.
 *
 * Every tile in this application was a `div`. "Blocked from issue: 3" told an
 * estimator there were three and left them to find which — with the answer
 * already on the same page.
 *
 * A tile can now do one of two things when it is clicked, and which one depends
 * on whether the answer is somewhere else or nowhere yet:
 *
 *   * `onClick` — the answer is elsewhere on the page. Filter the list, or open
 *     the section that accounts for the number, and mark the tile pressed while
 *     that is what the screen is showing.
 *   * `detail` — the answer is nowhere else. It opens underneath the tile: what
 *     the figure is made of, how it was counted, what it excludes.
 *
 * A tile with neither stays a `div`, because a control that does not respond is
 * worse than a number that never offered.
 */
export function StatTile({
  label, value, hint, tone = 'neutral', icon, onClick, active = false, actionLabel, detail,
}: {
  label: string; value: ReactNode; hint?: ReactNode;
  tone?: 'neutral' | 'success' | 'warn' | 'danger' | 'accent'; icon?: ReactNode;
  /** What this tile shows when clicked. Omit and it stays a plain tile. */
  onClick?: () => void;
  /** Whether what this tile shows is what the screen is showing now. */
  active?: boolean;
  /** Overrides the button's accessible name where the label alone is not enough. */
  actionLabel?: string;
  /**
   * What is behind the number, revealed under the tile. Use where the figure
   * has no list to filter and no section that accounts for it — which is most
   * tiles on most screens.
   */
  detail?: ReactNode;
}) {
  const [showing, setShowing] = useState(false);
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
  const interactive =
    'w-full transition-colors focus-visible:outline-none focus-visible:ring-2 '
    + 'focus-visible:ring-yellow-500 focus-visible:ring-offset-2';

  if (!onClick && !detail) {
    return <div className={cn(shell, 'border-charcoal-200')}>{body}</div>;
  }

  /*
   * `detail` opens in place, so the tile is its own disclosure and the answer
   * arrives without the reader losing the number it belongs to.
   */
  if (detail && !onClick) {
    return (
      <div className={cn(shell, showing ? 'border-yellow-500 ring-1 ring-yellow-500' : 'border-charcoal-200')}>
        <button
          type="button"
          onClick={() => setShowing((v) => !v)}
          aria-expanded={showing}
          aria-label={actionLabel ?? `What is behind ${label}`}
          className={cn(interactive, 'text-left')}
        >
          {body}
          <span className="mt-1 flex items-center gap-1 text-xs font-medium text-charcoal-500">
            {showing ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            {showing ? 'Hide' : "What's behind this"}
          </span>
        </button>
        {showing ? (
          <div className="mt-3 border-t border-charcoal-200 pt-3 text-xs text-charcoal-600">
            {detail}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={actionLabel}
      className={cn(
        shell,
        interactive,
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
