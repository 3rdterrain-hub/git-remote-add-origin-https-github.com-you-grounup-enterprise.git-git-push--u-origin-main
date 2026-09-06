/**
 * The boxes across the top of every screen.
 *
 * Every one of them was a `div`. "Blocked from issue: 3" told an estimator
 * there were three and left them to find which, with the answer already on the
 * same page — and on screens with nothing to filter, the number had no account
 * of itself anywhere at all.
 *
 * The rule these tests hold: a tile responds, or it does not pretend to. A
 * tile with something to show is a real button with a pressed or expanded
 * state; a tile with nothing is a plain box, because a control that does
 * nothing when clicked is worse than a number that never offered.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatTile } from './page';

describe('a tile with nothing behind it', () => {
  it('is not a control', () => {
    render(<StatTile label="Estimates" value={12} hint="all statuses" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });
});

describe('a tile that shows something elsewhere on the page', () => {
  it('is a button that says what it will show', async () => {
    const onClick = vi.fn();
    render(<StatTile label="Blocked" value={3} onClick={onClick}
      actionLabel="Show the estimates the engine has blocked" />);
    await userEvent.click(screen.getByRole('button',
      { name: /show the estimates the engine has blocked/i }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('says whether it is what the screen is showing now', () => {
    const { rerender } = render(
      <StatTile label="Blocked" value={3} onClick={() => {}} actionLabel="Show blocked" />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
    rerender(
      <StatTile label="Blocked" value={3} onClick={() => {}} active actionLabel="Show blocked" />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('a tile whose answer is nowhere else', () => {
  it('keeps the account of itself shut until it is asked for', () => {
    render(<StatTile label="Win rate" value="62%"
      detail={<p>Counted over decided bids only.</p>} />);
    expect(screen.queryByText(/Counted over decided bids/)).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens it under the number it belongs to', async () => {
    render(<StatTile label="Win rate" value="62%"
      detail={<p>Counted over decided bids only.</p>} />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/Counted over decided bids/)).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('shuts again', async () => {
    render(<StatTile label="Win rate" value="62%" detail={<p>Decided bids only.</p>} />);
    const tile = screen.getByRole('button');
    await userEvent.click(tile);
    await userEvent.click(tile);
    expect(screen.queryByText(/Decided bids only/)).not.toBeInTheDocument();
  });

  it('names itself for somebody who cannot see the box', () => {
    render(<StatTile label="Win rate" value="62%" detail={<p>Decided bids only.</p>} />);
    expect(screen.getByRole('button', { name: /what is behind win rate/i })).toBeInTheDocument();
  });
});
