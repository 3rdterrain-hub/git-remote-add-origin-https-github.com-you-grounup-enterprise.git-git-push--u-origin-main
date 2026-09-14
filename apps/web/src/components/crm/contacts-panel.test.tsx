/**
 * Somebody to call.
 *
 * `contacts` has existed since migration 0005 with a customer-or-vendor
 * constraint and a partial unique index for one primary per customer, and has
 * never held a row — while the plan blurb sells "customers, contacts and the
 * lead intake form".
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ContactRow, ContactEdit } from '@/lib/data/crm-pipeline';
import { ContactsPanel } from './contacts-panel';

const hoisted = vi.hoisted(() => ({
  rows: [] as ContactRow[],
  saved: [] as ContactEdit[],
  retired: [] as string[],
  failWith: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/crm-pipeline', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/crm-pipeline')>(
    '@/lib/data/crm-pipeline');
  return {
    ...actual,
    loadContacts: async () => hoisted.rows,
    saveContact: async (_c: unknown, edit: ContactEdit) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.saved.push(edit);
      return 'c-new';
    },
    retireContact: async (_c: unknown, id: string) => { hoisted.retired.push(id); },
  };
});

const person = (over: Partial<ContactRow> = {}): ContactRow => ({
  id: 'c-1', companyId: 'co-1', customerId: 'cu-1', vendorId: null,
  firstName: 'Dana', lastName: 'Whitfield', fullName: 'Dana Whitfield',
  title: 'Project Manager', email: 'dana@kingsway.test', phone: '419-555-0134',
  mobile: null, role: null, notes: null, isPrimary: true,
  customerName: 'Kingsway Development', vendorName: null,
  ...over,
});

beforeEach(() => {
  hoisted.rows = [];
  hoisted.saved = [];
  hoisted.retired = [];
  hoisted.failWith = null;
});

describe('contacts on a customer', () => {
  it('says plainly when there is nobody to ring', async () => {
    render(<ContactsPanel customerId="cu-1" editable />);
    expect(await screen.findByText('Nobody is recorded here yet')).toBeInTheDocument();
    expect(screen.getByText(/a company you cannot ring/)).toBeInTheDocument();
  });

  it('names them, and makes the phone and email usable', async () => {
    hoisted.rows = [person()];
    render(<ContactsPanel customerId="cu-1" editable />);
    expect(await screen.findByText('Dana Whitfield')).toBeInTheDocument();
    expect(screen.getByText('Project Manager')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /dana@kingsway.test/ }))
      .toHaveAttribute('href', 'mailto:dana@kingsway.test');
    expect(screen.getByRole('link', { name: /419-555-0134/ }))
      .toHaveAttribute('href', 'tel:419-555-0134');
  });

  it('leaves another customer\'s people alone', async () => {
    hoisted.rows = [person({ customerId: 'cu-other' })];
    render(<ContactsPanel customerId="cu-1" editable />);
    expect(await screen.findByText('Nobody is recorded here yet')).toBeInTheDocument();
  });

  it('makes the first person the one to call, without asking', async () => {
    const user = userEvent.setup();
    render(<ContactsPanel customerId="cu-1" editable />);
    await user.click(await screen.findByRole('button', { name: /Add a contact/ }));
    await user.type(screen.getByLabelText('First name'), 'Dana');
    await user.type(screen.getByLabelText('Last name'), 'Whitfield');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(hoisted.saved).toHaveLength(1));
    expect(hoisted.saved[0]).toMatchObject({
      customerId: 'cu-1', firstName: 'Dana', lastName: 'Whitfield', isPrimary: true,
    });
  });

  it('needs both names before it will send anything', async () => {
    const user = userEvent.setup();
    render(<ContactsPanel customerId="cu-1" editable />);
    await user.click(await screen.findByRole('button', { name: /Add a contact/ }));
    await user.type(screen.getByLabelText('First name'), 'Dana');
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('promotes somebody else to the person to call', async () => {
    hoisted.rows = [person(), person({
      id: 'c-2', firstName: 'Marcus', lastName: 'Ruiz', fullName: 'Marcus Ruiz',
      isPrimary: false, title: 'Owner', email: null, phone: null,
    })];
    const user = userEvent.setup();
    render(<ContactsPanel customerId="cu-1" editable />);
    await screen.findByText('Marcus Ruiz');
    /* Only the non-primary one is offered the star. */
    const buttons = screen.getAllByTitle('Make this the person to call');
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]!);
    await waitFor(() => expect(hoisted.saved).toEqual([{ id: 'c-2', isPrimary: true }]));
  });

  it('retires rather than deletes', async () => {
    hoisted.rows = [person()];
    const user = userEvent.setup();
    render(<ContactsPanel customerId="cu-1" editable />);
    await user.click(await screen.findByRole('button', { name: 'Retire Dana Whitfield' }));
    await waitFor(() => expect(hoisted.retired).toEqual(['c-1']));
  });

  it('offers nothing to change to somebody who may only read', async () => {
    hoisted.rows = [person()];
    render(<ContactsPanel customerId="cu-1" editable={false} />);
    expect(await screen.findByText('Dana Whitfield')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a contact/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retire/ })).not.toBeInTheDocument();
  });

  it('says what the database refused', async () => {
    hoisted.failWith = 'A contact needs a first and last name';
    const user = userEvent.setup();
    render(<ContactsPanel customerId="cu-1" editable />);
    await user.click(await screen.findByRole('button', { name: /Add a contact/ }));
    await user.type(screen.getByLabelText('First name'), 'Dana');
    await user.type(screen.getByLabelText('Last name'), 'W');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('A contact needs a first and last name'))
      .toBeInTheDocument();
  });
});
