/**
 * Five figures over three tabs, and none of them went to one.
 *
 * The one that matters most has no tab at all: ordered and not yet invoiced is
 * the difference between two of the others, and it is the number that makes a
 * budget overrun visible while there is still time to act on it.
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';
import { ProcurementPage } from './procurement';

describe('the boxes across the top', () => {
  it('opens the purchase orders from the commitment total', async () => {
    const user = userEvent.setup();
    renderPage(<ProcurementPage />);
    await user.click(screen.getByRole('button',
      { name: 'List the purchase orders behind the commitment' }));
    expect(screen.getByRole('tab', { name: /Purchase orders/ }))
      .toHaveAttribute('data-state', 'active');
  });

  it('opens the stock list from the inventory value', async () => {
    const user = userEvent.setup();
    renderPage(<ProcurementPage />);
    await user.click(screen.getByRole('button', { name: 'List what is in stock' }));
    expect(screen.getByRole('tab', { name: /Inventory/ })).toHaveAttribute('data-state', 'active');
  });

  it('says what "not yet invoiced" is the difference between', async () => {
    const user = userEvent.setup();
    renderPage(<ProcurementPage />);
    await user.click(screen.getByRole('button', { name: 'What is behind Not yet invoiced' }));
    expect(screen.getByText(/no longer choose not to spend/)).toBeInTheDocument();
    expect(screen.getByText(/looks fine on spend and is already gone on/)).toBeInTheDocument();
  });
});
