/**
 * The clock, on a phone.
 *
 * Everything about the punch clock was built and the only way in was a tab on a
 * desktop screen. The people who punch a clock are standing at a job trailer
 * holding a phone.
 *
 * Two properties matter more than the layout. The screen offers only the
 * punches the database will accept — a button whose single outcome is an error
 * teaches people to distrust the whole thing. And it lives outside the
 * application shell, so there is nothing to navigate past at 6:41 in the
 * morning.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';
import type { ClockRow } from '@/lib/data/time-clock';

const hoisted = vi.hoisted(() => ({
  mine: null as ClockRow | null,
  punches: [] as Array<{ kind: string; withPosition?: boolean }>,
  refuse: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));

vi.mock('@/lib/data/time-clock', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/time-clock')>(
    '@/lib/data/time-clock');
  return {
    ...actual,
    loadMyClock: async () => hoisted.mine,
    punch: async (kind: string, req: { withPosition?: boolean }) => {
      if (hoisted.refuse) throw new Error(hoisted.refuse);
      hoisted.punches.push({ kind, withPosition: req.withPosition });
    },
  };
});

vi.mock('@/lib/data/estimates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/estimates')>(
    '@/lib/data/estimates');
  return { ...actual, loadMyCompanyId: async () => 'c-1' };
});

vi.mock('@/lib/data/session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/session')>('@/lib/data/session');
  return {
    ...actual,
    loadWhoAmI: async () => ({
      firstName: 'Dale', fullName: 'Dale Rhodes', email: 'd@r.test',
      companyName: 'Ridgeline Excavating',
    }),
  };
});

const { ClockPage } = await import('./clock');

const row = (over: Partial<ClockRow> = {}): ClockRow => ({
  employeeId: 'e1', companyId: 'c-1', employeeName: 'Dale Rhodes', employeeNumber: 'E-1',
  standing: 'Off the clock', state: null, since: null,
  projectId: null, projectName: null,
  workedMinutes: 0, breakMinutes: 0, stillOpen: false,
  ...over,
});

beforeEach(() => {
  hoisted.mine = row();
  hoisted.punches = [];
  hoisted.refuse = null;
});

// ---------------------------------------------------------------------------
describe('what somebody sees standing at a trailer', () => {
  it('greets them by name', async () => {
    renderPage(<ClockPage />);
    expect(await screen.findByRole('heading', { name: /Good (morning|afternoon|evening), Dale/ }))
      .toBeInTheDocument();
  });

  it('says where they stand, in words rather than a color', async () => {
    hoisted.mine = row({ standing: 'On the clock', state: 'in', workedMinutes: 132 });
    renderPage(<ClockPage />);
    expect(await screen.findByText('On the clock')).toBeInTheDocument();
    expect(screen.getByText('2h 12m')).toBeInTheDocument();
  });

  it('names the job when they are on one', async () => {
    hoisted.mine = row({ standing: 'On the clock', state: 'in', projectName: 'North Yard' });
    renderPage(<ClockPage />);
    expect(await screen.findByText('North Yard')).toBeInTheDocument();
  });

  it('shows the break time beside the worked time', async () => {
    hoisted.mine = row({ standing: 'On break', state: 'break_start',
      workedMinutes: 240, breakMinutes: 20 });
    renderPage(<ClockPage />);
    expect(await screen.findByText(/20m on break/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('the buttons it offers', () => {
  it('offers one button to somebody off the clock', async () => {
    renderPage(<ClockPage />);
    expect(await screen.findByRole('button', { name: /Clock in/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clock out/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /break/i })).not.toBeInTheDocument();
  });

  it('offers clock out and start break to somebody on it', async () => {
    hoisted.mine = row({ standing: 'On the clock', state: 'in' });
    renderPage(<ClockPage />);
    expect(await screen.findByRole('button', { name: /Clock out/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start break/ })).toBeInTheDocument();
  });

  it('offers only ending the break to somebody on one', async () => {
    /*
     * The database refuses a clock-out from a break rather than guessing what
     * the break was worth. Offering the button anyway would teach people the
     * screen lies.
     */
    hoisted.mine = row({ standing: 'On break', state: 'break_start' });
    renderPage(<ClockPage />);
    expect(await screen.findByRole('button', { name: /End break/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clock out/ })).not.toBeInTheDocument();
  });

  it('punches when pressed, and attaches where they are', async () => {
    renderPage(<ClockPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Clock in/ }));
    await waitFor(() => expect(hoisted.punches).toEqual([{ kind: 'in', withPosition: true }]));
  });

  it('does not attach a position to a break, which is not a place', async () => {
    hoisted.mine = row({ standing: 'On the clock', state: 'in' });
    renderPage(<ClockPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Start break/ }));
    await waitFor(() =>
      expect(hoisted.punches).toEqual([{ kind: 'break_start', withPosition: false }]));
  });

  it('shows the database refusal word for word', async () => {
    hoisted.mine = row({ standing: 'On the clock', state: 'in' });
    hoisted.refuse = 'On break. End the break before clocking out.';
    renderPage(<ClockPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Clock out/ }));
    expect(await screen.findByRole('alert'))
      .toHaveTextContent('On break. End the break before clocking out.');
  });
});

// ---------------------------------------------------------------------------
describe('somebody the clock cannot place', () => {
  it('says so rather than offering a button that will fail', async () => {
    hoisted.mine = null;
    renderPage(<ClockPage />);
    expect(await screen.findByText(/no employee record here/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clock in/ })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('the screen itself', () => {
  it('carries no navigation to get past', async () => {
    /*
     * The reason it is not under /app. One screen, one job, nothing to scroll
     * through while standing up.
     */
    renderPage(<ClockPage />);
    await screen.findByRole('heading', { name: /Good/ });
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Estimator' })).not.toBeInTheDocument();
  });

  it('offers one way back to the rest of the platform', async () => {
    renderPage(<ClockPage />);
    expect(await screen.findByRole('link', { name: /Open the workspace/ }))
      .toHaveAttribute('href', '/app');
  });

  it('says a punch is a record rather than an edit', async () => {
    renderPage(<ClockPage />);
    expect(await screen.findByText(/the original stays where it is/)).toBeInTheDocument();
  });
});
