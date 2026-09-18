/**
 * The hosted lead form.
 *
 * Migration 0065 built every rule a public submission needs — an opaque key, a
 * honeypot, rate limits, and one answer for a key that never existed and one
 * switched off. `embedSnippet` then gave a contractor HTML to paste into their
 * own website. This page is the other half: an address for the contractor who
 * has no site to paste into.
 *
 * The tests that matter are about what it must not do. It is the only screen in
 * this platform a stranger can open, so every fact it could leak is a fact
 * about somebody's business.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const hoisted = vi.hoisted(() => ({
  sent: [] as Array<Record<string, unknown>>,
  reject: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/lead-forms', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/lead-forms')>('@/lib/data/lead-forms');
  return {
    ...actual,
    submitLead: async (key: string, entry: Record<string, unknown>) => {
      if (hoisted.reject) throw new Error(hoisted.reject);
      hoisted.sent.push({ key, ...entry });
    },
  };
});

const { LeadFormPage } = await import('./lead-form');

const show = (key = 'abc123def456') => render(
  <MemoryRouter initialEntries={[`/lead/${key}`]}>
    <Routes><Route path="/lead/:key" element={<LeadFormPage />} /></Routes>
  </MemoryRouter>,
);

const fill = async (name: string, email = 'dana@example.test') => {
  await userEvent.type(screen.getByLabelText(/your name, or your company/i), name);
  if (email) await userEvent.type(screen.getByLabelText(/^email$/i), email);
};

beforeEach(() => { hoisted.sent = []; hoisted.reject = null; });

describe('what a stranger is told', () => {
  it('names no company, because it cannot and must not', async () => {
    /*
     * `anon` may call one function and select from no table, so this page has
     * no way to know whose form it is. That is the design: a page greeting a
     * visitor by company name would turn guessed keys into a directory of every
     * company on the platform.
     */
    show();
    expect(screen.getByRole('heading', { name: /request a quote/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Ridgeline|Maumee Commerce|GrounUp Enterprise/);
  });

  it('answers a dead key exactly as the database phrased it, and stays put', async () => {
    hoisted.reject = 'That form is not available';
    show('akeynobodyissued');
    await fill('Somebody');
    await userEvent.click(screen.getByRole('button', { name: /send it/i }));
    await waitFor(() => expect(screen.getByText('That form is not available')).toBeTruthy());
    /* No false success, and the form is still there to try again. */
    expect(screen.queryByText(/thank you/i)).toBeNull();
    expect(screen.getByRole('heading', { name: /request a quote/i })).toBeTruthy();
  });
});

describe('what it insists on', () => {
  it('will not send without a name', async () => {
    show();
    expect(screen.getByRole('button', { name: /send it/i })).toBeDisabled();
  });

  it('will not send without a way to reply, and says so before the click', async () => {
    show();
    await userEvent.type(screen.getByLabelText(/your name, or your company/i), 'Maumee Partners');
    expect(screen.getByRole('button', { name: /send it/i })).toBeDisabled();
    expect(screen.getByText(/leave an email address or a phone number/i)).toBeTruthy();
  });

  it('takes a phone number instead of an email', async () => {
    show();
    await userEvent.type(screen.getByLabelText(/your name, or your company/i), 'Maumee Partners');
    await userEvent.type(screen.getByLabelText(/^phone$/i), '(419) 555-0134');
    expect(screen.getByRole('button', { name: /send it/i })).toBeEnabled();
  });

  it('refuses a one-letter name, matching what the database will do', async () => {
    show();
    await userEvent.type(screen.getByLabelText(/your name, or your company/i), 'M');
    await userEvent.type(screen.getByLabelText(/^email$/i), 'x@y.test');
    expect(screen.getByRole('button', { name: /send it/i })).toBeDisabled();
  });
});

describe('the honeypot', () => {
  it('is present, off screen, and out of the tab order', async () => {
    const { container } = show();
    const trap = container.querySelector('input[name="trap"]') as HTMLInputElement;
    expect(trap).toBeTruthy();
    expect(trap.tabIndex).toBe(-1);
    expect(trap.closest('[aria-hidden="true"]')).toBeTruthy();
  });

  it('is sent through untouched, because judging it is the database’s job', async () => {
    show();
    await fill('Maumee Partners');
    await userEvent.click(screen.getByRole('button', { name: /send it/i }));
    await waitFor(() => expect(hoisted.sent).toHaveLength(1));
    expect(hoisted.sent[0]!).toHaveProperty('trap');
  });
});

describe('a lead that goes through', () => {
  it('sends what was typed, with the key from the address', async () => {
    show('formkey987654');
    await fill('Maumee Development Partners');
    await userEvent.type(screen.getByLabelText(/what do you need/i), 'Three acres to strip.');
    await userEvent.click(screen.getByRole('button', { name: /send it/i }));

    await waitFor(() => expect(hoisted.sent).toHaveLength(1));
    expect(hoisted.sent[0]).toMatchObject({
      key: 'formkey987654',
      companyName: 'Maumee Development Partners',
      email: 'dana@example.test',
      description: 'Three acres to strip.',
    });
  });

  it('thanks them without confirming anything about what was stored', async () => {
    show();
    await fill('Maumee Partners');
    await userEvent.click(screen.getByRole('button', { name: /send it/i }));
    await waitFor(() => expect(screen.getByText(/that came through/i)).toBeTruthy());
    /* Nothing read back: no lead number, no company, no "we already have you". */
    expect(document.body.textContent).not.toMatch(/lead #|LEAD-|already/i);
  });

  it('sends blank optional fields as nothing rather than as empty strings', async () => {
    show();
    await fill('Maumee Partners');
    await userEvent.click(screen.getByRole('button', { name: /send it/i }));
    await waitFor(() => expect(hoisted.sent).toHaveLength(1));
    expect(hoisted.sent[0]!.phone).toBeNull();
    expect(hoisted.sent[0]!.city).toBeNull();
    expect(hoisted.sent[0]!.description).toBeNull();
  });
});
