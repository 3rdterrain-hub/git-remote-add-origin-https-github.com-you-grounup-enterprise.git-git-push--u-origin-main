/**
 * The three things a project manager does, from the project page.
 *
 * These buttons existed and did nothing. What the tests hold down is not that
 * they now open a dialog — it is what each dialog declines to ask for, because
 * that is where the judgment is. A change order does not ask for a cost: the
 * cost comes from pricing the change, and a number typed into a dialog is one
 * nobody can reproduce.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hoisted = vi.hoisted(() => ({
  daily: [] as Array<Record<string, unknown>>,
  change: [] as Array<Record<string, unknown>>,
  rfi: [] as Array<Record<string, unknown>>,
  fail: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));

vi.mock('@/lib/data/project', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/project')>('@/lib/data/project');
  return {
    ...actual,
    createDailyReport: async (_c: unknown, i: Record<string, unknown>) => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      hoisted.daily.push(i); return 'd-1';
    },
    createChangeOrder: async (_c: unknown, i: Record<string, unknown>) => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      hoisted.change.push(i); return 'c-1';
    },
    createRfi: async (_c: unknown, i: Record<string, unknown>) => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      hoisted.rfi.push(i); return 'r-1';
    },
  };
});

const { ProjectActions } = await import('./project-actions');

const show = (over: Partial<Parameters<typeof ProjectActions>[0]> = {}) => {
  const onCreated = vi.fn();
  render(<ProjectActions projectId="p-1" canWrite canRaiseRfi onCreated={onCreated} {...over} />);
  return { onCreated };
};

beforeEach(() => {
  hoisted.daily = []; hoisted.change = []; hoisted.rfi = []; hoisted.fail = null;
});

describe('a day on site', () => {
  it('defaults to today and will not offer tomorrow', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: /Daily report/i }));
    const field = await screen.findByLabelText(/Which day/i) as HTMLInputElement;
    const d = new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(field.value).toBe(iso);
    // The future is refused by the function; the control should not offer it.
    expect(field.max).toBe(iso);
  });

  it('says submitting is what freezes it', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: /Daily report/i }));
    expect(await screen.findByText(/submitting is what freezes the date/i)).toBeTruthy();
  });

  it('starts the report and opens the tab it landed on', async () => {
    const user = userEvent.setup();
    const { onCreated } = show();
    await user.click(screen.getByRole('button', { name: /Daily report/i }));
    await user.type(await screen.findByLabelText(/What was done/i), 'Stripped topsoil');
    await user.click(screen.getByRole('button', { name: /Start the report/i }));

    await waitFor(() => expect(hoisted.daily).toHaveLength(1));
    expect(hoisted.daily[0]).toMatchObject({ projectId: 'p-1', workPerformed: 'Stripped topsoil' });
    expect(onCreated).toHaveBeenCalledWith('daily');
  });
});

describe('a change to the contract', () => {
  it('does not ask for a cost', async () => {
    /*
     * The judgment in this dialog. A change order is priced by pricing the
     * change; a number typed here would be one nobody can reproduce, and the
     * function leaves cost_impact and price_impact at zero for the same reason.
     */
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: /Change order/i }));
    await screen.findByLabelText(/Title/i);
    expect(screen.queryByLabelText(/cost/i)).toBeNull();
    expect(screen.queryByLabelText(/amount/i)).toBeNull();
    expect(screen.queryByLabelText(/price/i)).toBeNull();
  });

  it('will not raise one that does not say why', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: /Change order/i }));
    await user.type(await screen.findByLabelText(/Title/i), 'Rock excavation');
    expect(screen.getByRole('button', { name: /Raise the change order/i }).hasAttribute('disabled'))
      .toBe(true);

    await user.type(screen.getByLabelText(/Why the work changed/i), 'Ledge at 9 ft');
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Raise the change order/i }).hasAttribute('disabled'),
    ).toBe(false));
  });

  it('sends the title, the reason and where it came from', async () => {
    const user = userEvent.setup();
    const { onCreated } = show();
    await user.click(screen.getByRole('button', { name: /Change order/i }));
    await user.type(await screen.findByLabelText(/Title/i), 'Rock excavation');
    await user.type(screen.getByLabelText(/Why the work changed/i), 'Ledge at 9 ft');
    await user.selectOptions(screen.getByLabelText(/Where it came from/i),
      'differing_site_condition');
    await user.click(screen.getByRole('button', { name: /Raise the change order/i }));

    await waitFor(() => expect(hoisted.change).toHaveLength(1));
    expect(hoisted.change[0]).toMatchObject({
      projectId: 'p-1', title: 'Rock excavation', reason: 'Ledge at 9 ft',
      origin: 'differing_site_condition',
    });
    expect(onCreated).toHaveBeenCalledWith('change');
  });
});

describe('a question somebody has to answer', () => {
  it('says it opens in draft, and why that is separate', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: /New RFI/i }));
    expect(await screen.findByText(/opens in draft/i)).toBeTruthy();
    expect(screen.getByText(/starts a clock/i)).toBeTruthy();
  });

  it('will not raise one with no question in it', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: /New RFI/i }));
    await user.type(await screen.findByLabelText(/^Title$/i), 'Invert conflict');
    expect(screen.getByRole('button', { name: /Raise the RFI/i }).hasAttribute('disabled'))
      .toBe(true);
  });

  it('sends the question and the priority', async () => {
    const user = userEvent.setup();
    const { onCreated } = show();
    await user.click(screen.getByRole('button', { name: /New RFI/i }));
    await user.type(await screen.findByLabelText(/^Title$/i), 'Invert conflict at B4');
    await user.type(screen.getByLabelText(/The question/i), 'Which invert governs?');
    await user.selectOptions(screen.getByLabelText(/Priority/i), 'high');
    await user.click(screen.getByRole('button', { name: /Raise the RFI/i }));

    await waitFor(() => expect(hoisted.rfi).toHaveLength(1));
    expect(hoisted.rfi[0]).toMatchObject({
      projectId: 'p-1', title: 'Invert conflict at B4',
      question: 'Which invert governs?', priority: 'high',
    });
    expect(onCreated).toHaveBeenCalledWith('rfi');
  });
});

describe('what the permissions decide', () => {
  it('offers no daily report or change order without projects.write', async () => {
    show({ canWrite: false });
    expect(screen.getByRole('button', { name: /Daily report/i }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Change order/i }).hasAttribute('disabled')).toBe(true);
  });

  it('offers no RFI without estimates.write, which is a different permission', async () => {
    // 0010 put rfis behind estimates.write; a superintendent runs the job and
    // does not raise RFIs, and the buttons have to agree with that.
    show({ canRaiseRfi: false });
    expect(screen.getByRole('button', { name: /New RFI/i }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Daily report/i }).hasAttribute('disabled')).toBe(false);
  });
});

describe('when the database refuses', () => {
  it('shows what it said rather than closing as though it worked', async () => {
    const user = userEvent.setup();
    hoisted.fail = 'There is already a daily report for Friday, 12 September 2026';
    const { onCreated } = show();
    await user.click(screen.getByRole('button', { name: /Daily report/i }));
    await user.click(await screen.findByRole('button', { name: /Start the report/i }));
    expect(await screen.findByText(/already a daily report/i)).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
