/**
 * A card with a one-line summary you can read while it is shut.
 *
 * Collapsing itself is no longer this component's job — every `Card` in the
 * application does that, from `components/ui/card.tsx`, because an affordance a
 * screen has to opt into is one half the screens will not have. What is left
 * here is the part that is genuinely particular: a section that says *what it
 * would tell you* before you open it.
 *
 * "Markup and adjustments" is a heading. "Markup and adjustments — 14.5% over
 * cost, two adjustments" is a heading somebody can act on without opening
 * anything, and it is the difference between a collapsed section and a section
 * nobody ever leaves collapsed.
 */
import { type ReactNode } from 'react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle, useCardOpen,
} from '@/components/ui/card';

/** The summary line, drawn only while the card is shut. */
function WhileShut({ children }: { children: ReactNode }) {
  const open = useCardOpen();
  if (open || !children) return null;
  return <span className="text-sm font-normal text-charcoal-500">{children}</span>;
}

/** Header controls, which are for the section rather than for opening it. */
function WhileOpen({ children }: { children: ReactNode }) {
  const open = useCardOpen();
  if (!open || !children) return null;
  return <div className="shrink-0">{children}</div>;
}

export function CollapsibleCard({
  id, title, description, summary, actions, defaultOpen = true, open, onOpenChange,
  children, className,
}: {
  /** Anchors the card so something elsewhere on the page can jump to it. */
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Shown beside the title while shut, so it need not be opened to be read. */
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
  onOpenChange?: (next: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card
      id={id}
      className={className}
      defaultCollapsed={!defaultOpen}
      open={open}
      onOpenChange={onOpenChange}
    >
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <CardTitle>
            <span className="flex flex-wrap items-center gap-2">
              {title}
              <WhileShut>{summary}</WhileShut>
            </span>
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        <WhileOpen>{actions}</WhileOpen>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
