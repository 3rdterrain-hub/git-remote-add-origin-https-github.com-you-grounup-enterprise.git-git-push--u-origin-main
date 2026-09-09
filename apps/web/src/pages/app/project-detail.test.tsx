/**
 * Change orders, counted twice and filtered never.
 *
 * "Approved changes $184k" and "Pending changes $61k" sat directly above the
 * list of every change order on the project, and neither of them touched it.
 * Which two of the nine are still waiting on a decision was a question the
 * screen already knew the answer to.
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';
import { ProjectDetailPage } from './project-detail';
import { PROJECTS } from '@/data/operations';
import { CHANGE_ORDERS } from '@/data/field';

const project = PROJECTS[0]!;
const orders = CHANGE_ORDERS.filter((c) => c.projectId === project.id);
const approved = orders.filter((c) => ['approved', 'executed'].includes(c.status));
const pending = orders.filter((c) => ['potential', 'submitted'].includes(c.status));

describe('the change order boxes', () => {
  it('has both kinds to tell apart', () => {
    // Guards the tests below: all-approved or all-pending fixtures would let
    // them pass while the filter did nothing.
    expect(approved.length).toBeGreaterThan(0);
    expect(pending.length).toBeGreaterThan(0);
  });

  it('narrows the list to the changes still awaiting a decision', async () => {
    const user = userEvent.setup();
    renderPage(<ProjectDetailPage />);
    await user.click(screen.getByRole('tab', { name: /Change orders/ }));
    await user.click(screen.getByRole('button',
      { name: 'List the change orders awaiting a decision' }));

    expect(screen.getByText(/Showing the pending change orders/)).toBeInTheDocument();
    for (const c of pending) expect(screen.getByText(new RegExp(c.number))).toBeInTheDocument();
    for (const c of approved) {
      expect(screen.queryByText(new RegExp(`${c.number} — `))).not.toBeInTheDocument();
    }
  });

  it('reaches the approved ones straight from the contract value', async () => {
    // The contract value tile says "+$184k in approved changes" and is the
    // only place on the page that explains why the contract is not the bid.
    const user = userEvent.setup();
    renderPage(<ProjectDetailPage />);
    await user.click(screen.getByRole('button',
      { name: 'Show the approved changes that moved the contract value' }));

    expect(screen.getByRole('tab', { name: /Change orders/ }))
      .toHaveAttribute('data-state', 'active');
    expect(screen.getByText(/Showing the approved and executed change orders/))
      .toBeInTheDocument();
  });

  it('puts them all back', async () => {
    const user = userEvent.setup();
    renderPage(<ProjectDetailPage />);
    await user.click(screen.getByRole('tab', { name: /Change orders/ }));
    await user.click(screen.getByRole('button',
      { name: 'List the approved and executed change orders' }));
    await user.click(screen.getByRole('button', { name: `Show all ${orders.length}` }));

    expect(screen.queryByText(/Showing the approved and executed/)).not.toBeInTheDocument();
    for (const c of pending) expect(screen.getByText(new RegExp(c.number))).toBeInTheDocument();
  });

  it('says what actual cost leaves out, which is what makes it misleading alone', async () => {
    const user = userEvent.setup();
    renderPage(<ProjectDetailPage />);
    await user.click(screen.getByRole('button', { name: 'What is behind Actual cost' }));
    expect(screen.getByText(/spend, not commitment/)).toBeInTheDocument();
  });
});
