/**
 * A card that can be put away.
 *
 * The estimate workspace grew: lines, cost buckets, cost-to-price, markup and
 * adjustments, what the customer sees, this bid's assumptions, library drift.
 * All of them matter and not all of them matter at once — an estimator entering
 * quantities is not deciding bond rates, and a screen that shows everything
 * with equal weight makes the reader do the sorting.
 *
 * Two decisions worth stating. The header is a real button with `aria-expanded`,
 * so this is one control rather than a heading with a chevron beside it. And a
 * card can carry a `summary` shown while it is shut — a section you have to
 * open to find out whether it needs opening is a section you open every time.
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function CollapsibleCard({
  id, title, description, summary, actions, defaultOpen = true, open: controlled,
  onOpenChange, children, className,
}: {
  /** Anchors the card so something elsewhere on the page can jump to it. */
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Shown on the header while shut, so it need not be opened to be read. */
  summary?: ReactNode;
  /** Controls that belong to the section rather than to opening it. */
  actions?: ReactNode;
  defaultOpen?: boolean;
  /*
   * Optionally controlled, so a figure at the top of the page can open the
   * section that explains it. Uncontrolled by default: most cards only ever
   * answer to their own header.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = controlled ?? uncontrolled;
  const setOpen = (next: boolean) => {
    if (controlled === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  };

  return (
    <Card id={id} className={className}>
      <div className="flex items-start justify-between gap-3 px-6 py-4">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          <span className="mt-0.5 shrink-0 text-charcoal-400">
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2 font-semibold text-charcoal-900">
              {title}
              {!open && summary ? (
                <span className="text-sm font-normal text-charcoal-500">{summary}</span>
              ) : null}
            </span>
            {open && description ? (
              <span className="mt-1 block text-sm text-charcoal-500">{description}</span>
            ) : null}
          </span>
        </button>
        {actions && open ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <CardContent className={cn('pt-0', !open && 'hidden')}>{children}</CardContent>
    </Card>
  );
}
