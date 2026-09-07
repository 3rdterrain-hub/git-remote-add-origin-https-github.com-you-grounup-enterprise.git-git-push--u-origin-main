/**
 * A card, and the ability to put it away.
 *
 * Every card in this application is collapsible, and it is done here rather
 * than at 199 call sites for the reason that always applies to a rule of this
 * shape: an affordance a screen has to remember to opt into is an affordance
 * half the screens will not have, and a person cannot learn "cards collapse"
 * from a system where most of them do not.
 *
 * Four decisions worth stating.
 *
 * **The title is the control.** Not a chevron beside a heading — the whole
 * title is a real `button` carrying `aria-expanded` and `aria-controls`, so it
 * is one target for a mouse, one stop for a keyboard, and one announcement for
 * a screen reader. No card header in this application contains a button or a
 * link, which is what makes this safe; a header that grows one should pass
 * `collapsible={false}` or keep the control out of the title.
 *
 * **A card with no title does not collapse.** There would be nothing to click
 * and nothing to read once it was shut. Those cards — a bare table, a single
 * figure — render exactly as they did before.
 *
 * **The description stays visible when the card is shut.** A section you have
 * to open to find out whether it needs opening is a section you open every
 * time, so the one line that says what is inside stays on screen.
 *
 * **It is remembered, per person, per screen.** In `localStorage`, which is the
 * right home for it: a collapsed section is a reading preference, it belongs to
 * one browser, and nothing downstream depends on it. Every read and write is
 * guarded, because a private window, cleared site data or a browser set to
 * block storage all throw rather than returning nothing — and a card that
 * cannot remember must still open.
 */
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CardCollapse {
  /** Whether this card offers collapsing at all. */
  enabled: boolean;
  open: boolean;
  toggle: () => void;
  /** Points `aria-controls` at the part that actually disappears. */
  contentId: string;
  /** A title reports its text so the card can remember this one specifically. */
  reportKey: (text: string) => void;
}

const CardContext = React.createContext<CardCollapse | null>(null);

const STORE_PREFIX = 'grounup.card.';

/** Read a remembered state. Returns null when there is none, or none can be read. */
function remembered(key: string): boolean | null {
  try {
    const saved = window.localStorage.getItem(STORE_PREFIX + key);
    return saved === 'shut' ? false : saved === 'open' ? true : null;
  } catch {
    return null;
  }
}

function remember(key: string, open: boolean): void {
  try {
    window.localStorage.setItem(STORE_PREFIX + key, open ? 'open' : 'shut');
  } catch {
    /* A card that cannot be remembered still opens and shuts. */
  }
}

/** The readable text inside a title, for the key it is remembered under. */
function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement(node)) {
    return textOf((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Off for a card whose header carries its own controls. */
  collapsible?: boolean;
  /** Starts shut, unless this person has said otherwise before. */
  defaultCollapsed?: boolean;
  /**
   * What this card is remembered as. Derived from the title and the screen when
   * absent, which is right for almost every card; pass one when two cards on a
   * screen share a title and should be remembered apart.
   */
  collapseKey?: string;
  /** Controlled, for a card another control on the page opens. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({
    className, collapsible = true, defaultCollapsed = false, collapseKey,
    open: controlled, onOpenChange, children, ...props
  }, ref) => {
    const contentId = React.useId();
    const [uncontrolled, setUncontrolled] = React.useState(!defaultCollapsed);
    const keyRef = React.useRef<string | null>(collapseKey ?? null);
    const settled = React.useRef(false);

    const open = controlled ?? uncontrolled;

    /*
     * The title reports its text during layout, before the browser paints, so a
     * card remembered shut is never seen open first. Reporting more than once —
     * a title that re-renders — must not undo what the person has since done,
     * hence the latch.
     */
    const reportKey = React.useCallback((text: string) => {
      if (settled.current || controlled !== undefined) return;
      const key = collapseKey ?? `${window.location.pathname}::${text}`;
      keyRef.current = key;
      settled.current = true;
      const saved = remembered(key);
      if (saved !== null) setUncontrolled(saved);
    }, [collapseKey, controlled]);

    const toggle = React.useCallback(() => {
      const next = !(controlled ?? uncontrolled);
      if (controlled === undefined) setUncontrolled(next);
      if (keyRef.current) remember(keyRef.current, next);
      onOpenChange?.(next);
    }, [controlled, uncontrolled, onOpenChange]);

    const value = React.useMemo<CardCollapse>(
      () => ({ enabled: collapsible, open, toggle, contentId, reportKey }),
      [collapsible, open, toggle, contentId, reportKey],
    );

    return (
      <CardContext.Provider value={value}>
        <div
          ref={ref}
          data-collapsed={collapsible && !open ? '' : undefined}
          className={cn('rounded-[--radius-card] border border-charcoal-200 bg-white shadow-sm', className)}
          {...props}
        >
          {children}
        </div>
      </CardContext.Provider>
    );
  },
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1 p-5', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

/**
 * The heading, and — in a collapsible card — the control that shuts it.
 *
 * Stays an `h3` either way, so the document outline does not change depending
 * on whether a card happens to be collapsible.
 */
const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, children, ...props }, ref) => {
    const card = React.useContext(CardContext);
    const text = textOf(children);
    const report = card?.reportKey;

    React.useLayoutEffect(() => {
      if (report && text) report(text);
    }, [report, text]);

    const heading = cn('text-base font-semibold tracking-tight text-charcoal-900', className);

    if (!card?.enabled) {
      return <h3 ref={ref} className={heading} {...props}>{children}</h3>;
    }

    return (
      <h3 ref={ref} className={heading} {...props}>
        <button
          type="button"
          onClick={card.toggle}
          aria-expanded={card.open}
          aria-controls={card.contentId}
          className="group flex w-full items-center gap-2 text-left"
        >
          <span className="min-w-0 flex-1">{children}</span>
          <ChevronDown
            aria-hidden
            className={cn(
              'size-4 shrink-0 text-charcoal-400 transition-transform group-hover:text-charcoal-600',
              !card.open && '-rotate-90',
            )}
          />
        </button>
      </h3>
    );
  },
);
CardTitle.displayName = 'CardTitle';

/** Stays on screen while the card is shut: it is what says whether to open it. */
const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm text-charcoal-500', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, id, ...props }, ref) => {
    const card = React.useContext(CardContext);
    if (card?.enabled && !card.open) return null;
    return (
      <div
        ref={ref}
        id={id ?? (card?.enabled ? card.contentId : undefined)}
        className={cn('p-5 pt-0', className)}
        {...props}
      />
    );
  },
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const card = React.useContext(CardContext);
    if (card?.enabled && !card.open) return null;
    return (
      <div
        ref={ref}
        className={cn('flex items-center gap-3 border-t border-charcoal-200 p-5', className)}
        {...props}
      />
    );
  },
);
CardFooter.displayName = 'CardFooter';

/**
 * Whether the surrounding card is open.
 *
 * For the one thing the components cannot do on their own: showing a short
 * summary *while the card is shut*. Returns true outside a card and true for a
 * card that does not collapse, so a caller never has to special-case either.
 */
export function useCardOpen(): boolean {
  const card = React.useContext(CardContext);
  return card ? !card.enabled || card.open : true;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
