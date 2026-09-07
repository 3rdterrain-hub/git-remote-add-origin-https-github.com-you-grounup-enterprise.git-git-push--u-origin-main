/**
 * Every card in the system collapses.
 *
 * Done in the base component rather than at 199 call sites, because an
 * affordance a screen has to opt into is an affordance half the screens will
 * not have — and a person cannot learn "cards collapse" from a system where
 * most of them do not.
 *
 * The properties held here are the ones that make it safe to apply everywhere:
 * a card with no title does not sprout a control nobody can use; the heading
 * level does not change depending on whether a card happens to be collapsible;
 * the description stays readable while the card is shut; and a browser that
 * refuses storage gets a working card rather than a blank screen.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
} from './card';

const sample = (props: React.ComponentProps<typeof Card> = {}) => (
  <Card {...props}>
    <CardHeader>
      <CardTitle>Where the cost is</CardTitle>
      <CardDescription>Labor, equipment, materials and haul.</CardDescription>
    </CardHeader>
    <CardContent><p>Four cost buckets</p></CardContent>
    <CardFooter><button type="button">Recalculate</button></CardFooter>
  </Card>
);

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* nothing to clear */ }
});

// ---------------------------------------------------------------------------
describe('the title is the control', () => {
  it('makes the whole title a button', async () => {
    render(sample());
    expect(await screen.findByRole('button', { name: /Where the cost is/ })).toBeInTheDocument();
  });

  it('stays a level three heading, collapsible or not', () => {
    render(sample());
    expect(screen.getByRole('heading', { level: 3, name: /Where the cost is/ }))
      .toBeInTheDocument();
  });

  it('says whether it is open, for anybody not looking at it', async () => {
    render(sample());
    const title = screen.getByRole('button', { name: /Where the cost is/ });
    expect(title).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(title);
    expect(title).toHaveAttribute('aria-expanded', 'false');
  });

  it('points at the part that actually disappears', () => {
    render(sample());
    const controls = screen.getByRole('button', { name: /Where the cost is/ })
      .getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls!)).toBeTruthy();
  });

  it('opens on a keyboard, because it is a real button', async () => {
    render(sample());
    const title = screen.getByRole('button', { name: /Where the cost is/ });
    title.focus();
    await userEvent.keyboard('{Enter}');
    expect(title).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{ }');
    expect(title).toHaveAttribute('aria-expanded', 'true');
  });
});

// ---------------------------------------------------------------------------
describe('what goes away and what stays', () => {
  it('puts the content away', async () => {
    render(sample());
    expect(screen.getByText('Four cost buckets')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Where the cost is/ }));
    expect(screen.queryByText('Four cost buckets')).not.toBeInTheDocument();
  });

  it('puts the footer away with it', async () => {
    render(sample());
    await userEvent.click(screen.getByRole('button', { name: /Where the cost is/ }));
    expect(screen.queryByRole('button', { name: 'Recalculate' })).not.toBeInTheDocument();
  });

  it('leaves the description on screen', async () => {
    /*
     * A section you have to open to find out whether it needs opening is a
     * section you open every time.
     */
    render(sample());
    await userEvent.click(screen.getByRole('button', { name: /Where the cost is/ }));
    expect(screen.getByText('Labor, equipment, materials and haul.')).toBeInTheDocument();
  });

  it('brings it all back', async () => {
    render(sample());
    const title = screen.getByRole('button', { name: /Where the cost is/ });
    await userEvent.click(title);
    await userEvent.click(title);
    expect(screen.getByText('Four cost buckets')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recalculate' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('cards that should not collapse', () => {
  it('leaves a card with no title exactly as it was', () => {
    /*
     * There would be nothing to click and nothing to read once it was shut.
     * A bare table in a card is the common case.
     */
    render(<Card><CardContent><p>A bare table</p></CardContent></Card>);
    expect(screen.getByText('A bare table')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('obeys collapsible={false} on a card that has a title', () => {
    render(sample({ collapsible: false }));
    expect(screen.queryByRole('button', { name: /Where the cost is/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Where the cost is' })).toBeInTheDocument();
    expect(screen.getByText('Four cost buckets')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('starting shut', () => {
  it('starts shut when told to', () => {
    render(sample({ defaultCollapsed: true }));
    expect(screen.queryByText('Four cost buckets')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Where the cost is/ }))
      .toHaveAttribute('aria-expanded', 'false');
  });

  it('can be driven from elsewhere on the page', async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(sample({ open: false, onOpenChange }));
    expect(screen.queryByText('Four cost buckets')).not.toBeInTheDocument();
    rerender(sample({ open: true, onOpenChange }));
    expect(screen.getByText('Four cost buckets')).toBeInTheDocument();
  });

  it('reports a toggle to whoever is driving it', async () => {
    const onOpenChange = vi.fn();
    render(sample({ open: true, onOpenChange }));
    await userEvent.click(screen.getByRole('button', { name: /Where the cost is/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// ---------------------------------------------------------------------------
describe('being remembered', () => {
  it('remembers a card that was shut', async () => {
    const { unmount } = render(sample());
    await userEvent.click(screen.getByRole('button', { name: /Where the cost is/ }));
    unmount();

    render(sample());
    expect(screen.queryByText('Four cost buckets')).not.toBeInTheDocument();
  });

  it('remembers a card that was opened again', async () => {
    const { unmount } = render(sample({ defaultCollapsed: true }));
    await userEvent.click(screen.getByRole('button', { name: /Where the cost is/ }));
    unmount();

    render(sample({ defaultCollapsed: true }));
    expect(screen.getByText('Four cost buckets')).toBeInTheDocument();
  });

  it('remembers two cards apart', async () => {
    render(
      <>
        <Card>
          <CardHeader><CardTitle>Markup and adjustments</CardTitle></CardHeader>
          <CardContent><p>Overhead and profit</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>This bid&apos;s assumptions</CardTitle></CardHeader>
          <CardContent><p>Twelve assumptions</p></CardContent>
        </Card>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Markup and adjustments/ }));
    expect(screen.queryByText('Overhead and profit')).not.toBeInTheDocument();
    expect(screen.getByText('Twelve assumptions')).toBeInTheDocument();
  });

  it('keeps two same-titled cards apart when given a key', async () => {
    const two = (
      <>
        <Card collapseKey="left-notes">
          <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
          <CardContent><p>Left notes</p></CardContent>
        </Card>
        <Card collapseKey="right-notes">
          <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
          <CardContent><p>Right notes</p></CardContent>
        </Card>
      </>
    );
    const { unmount } = render(two);
    await userEvent.click(screen.getAllByRole('button', { name: /Notes/ })[0]!);
    unmount();

    render(two);
    expect(screen.queryByText('Left notes')).not.toBeInTheDocument();
    expect(screen.getByText('Right notes')).toBeInTheDocument();
  });

  it('does not remember a card somebody else is driving', async () => {
    /*
     * A controlled card answers to the page, not to what a browser remembered
     * three days ago — otherwise a figure that opens the section explaining it
     * would open a section the reader had shut, or fail to.
     */
    render(sample({ open: true, onOpenChange: () => {} }));
    await userEvent.click(screen.getByRole('button', { name: /Where the cost is/ }));
    const stored = Object.keys(window.localStorage)
      .filter((k) => k.startsWith('grounup.card.'));
    expect(stored).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('a browser that refuses to remember anything', () => {
  const realStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');

  afterEach(() => {
    if (realStorage) Object.defineProperty(window, 'localStorage', realStorage);
  });

  const blockStorage = () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('The operation is insecure.'); },
    });
  };

  it('still renders the card', () => {
    /*
     * A private window, cleared site data, or a browser set to block storage:
     * all three throw on access rather than returning nothing. An unguarded
     * read here would have been a blank screen on every card in the system.
     */
    blockStorage();
    render(sample());
    expect(screen.getByText('Four cost buckets')).toBeInTheDocument();
  });

  it('still collapses and reopens', async () => {
    blockStorage();
    render(sample());
    const title = screen.getByRole('button', { name: /Where the cost is/ });
    await userEvent.click(title);
    expect(screen.queryByText('Four cost buckets')).not.toBeInTheDocument();
    await userEvent.click(title);
    expect(screen.getByText('Four cost buckets')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('a title that is more than words', () => {
  it('remembers a title carrying an icon by its text', async () => {
    const withIcon = (
      <Card>
        <CardHeader>
          <CardTitle><svg aria-hidden /> Your clock</CardTitle>
        </CardHeader>
        <CardContent><p>On the clock</p></CardContent>
      </Card>
    );
    const { unmount } = render(withIcon);
    await userEvent.click(screen.getByRole('button', { name: /Your clock/ }));
    unmount();

    render(withIcon);
    expect(screen.queryByText('On the clock')).not.toBeInTheDocument();
  });
});
