/**
 * "Critical path: 4" over a schedule of thirty activities.
 *
 * The number was right and it was a search: the four with zero float were
 * somewhere in the table, distinguishable only by reading a float column row by
 * row. A slip on one of them moves the finish date day for day, which is the
 * one thing on this screen worth being able to see at a glance.
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';
import { SchedulePage } from './schedule';
import { SCHEDULE } from '@/data/fleet';

const critical = SCHEDULE.filter((a) => a.isCritical);
const slack = SCHEDULE.filter((a) => !a.isCritical);

describe('the boxes across the top', () => {
  it('has both kinds of activity to tell apart', () => {
    // Guards the two tests below: a fixture that is all critical, or none,
    // would let them pass while filtering nothing.
    expect(critical.length).toBeGreaterThan(0);
    expect(slack.length).toBeGreaterThan(0);
  });

  it('narrows the schedule to the activities with zero float', async () => {
    const user = userEvent.setup();
    renderPage(<SchedulePage />);
    await user.click(screen.getByRole('button',
      { name: 'Show only the activities on the critical path' }));

    expect(screen.getByText(new RegExp(`Showing the ${critical.length}`))).toBeInTheDocument();
    for (const a of critical) expect(screen.getAllByText(a.name).length).toBeGreaterThan(0);
    for (const a of slack) expect(screen.queryByText(a.name)).not.toBeInTheDocument();
  });

  it('puts every activity back', async () => {
    const user = userEvent.setup();
    renderPage(<SchedulePage />);
    await user.click(screen.getByRole('button',
      { name: 'Show only the activities on the critical path' }));
    await user.click(screen.getByRole('button', { name: `Show all ${SCHEDULE.length}` }));

    expect(screen.getAllByText(slack[0]!.name).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Show every activity on the schedule' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('opens resource loading from the two boxes that count resources', async () => {
    const user = userEvent.setup();
    renderPage(<SchedulePage />);
    await user.click(screen.getByRole('button', { name: 'Show the crew loading' }));
    expect(screen.getByRole('tab', { name: 'Resource loading' }))
      .toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('button', { name: 'Show the equipment assignments' }))
      .toHaveAttribute('aria-pressed', 'true');
  });
});
