/**
 * Adding to the library.
 *
 * The database already permitted this — a company may write its own library
 * rows under `libraries.write`, and the catalog GrounUp ships is protected from
 * every tenant. What did not exist was any way to do it, so a company outside
 * heavy civil opened the library, found no electrical or mechanical services,
 * and had no way to add one.
 *
 * What these tests hold is the honesty of the form rather than its plumbing:
 * a person must know before they type that they are creating a company row,
 * not editing the catalog.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServiceForm, TaskForm } from './editor';

const onSubmit = vi.fn();
const onCancel = vi.fn();

beforeEach(() => { onSubmit.mockClear(); onCancel.mockClear(); });

describe('adding a service', () => {
  const form = (over = {}) => render(
    <ServiceForm title="New service" busy={false} error={null}
      onSubmit={onSubmit} onCancel={onCancel} {...over} />);

  it('says the catalog is not what is being edited', () => {
    /*
     * A member reads three tiers and may write one. Discovering that when a
     * change silently does nothing is the worst way to learn it.
     */
    form();
    expect(screen.getByText(/read-only for every company/)).toBeInTheDocument();
  });

  it('will not save without a code and a name', async () => {
    form();
    expect(screen.getByRole('button', { name: /Save service/ })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Code'), 'SVC-EL-0001');
    expect(screen.getByRole('button', { name: /Save service/ })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Name'), 'Branch circuit rough-in');
    expect(screen.getByRole('button', { name: /Save service/ })).toBeEnabled();
  });

  it('passes what was typed', async () => {
    form();
    await userEvent.type(screen.getByLabelText('Code'), 'SVC-EL-0001');
    await userEvent.type(screen.getByLabelText('Name'), 'Branch circuit rough-in');
    await userEvent.type(screen.getByLabelText('Trade or category'), 'Electrical');
    await userEvent.click(screen.getByRole('button', { name: /Save service/ }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      code: 'SVC-EL-0001', name: 'Branch circuit rough-in', category: 'Electrical',
    }));
  });

  it('keeps the default unit among the supported units', async () => {
    /*
     * A service whose default unit is not one it supports cannot be priced, and
     * the database refuses it. The form makes that impossible rather than
     * letting somebody find out from a constraint error.
     */
    form();
    const ls = screen.getByRole('button', { name: 'LS', pressed: true });
    expect(ls).toBeDisabled();
  });

  it('adds and removes other units', async () => {
    form();
    await userEvent.click(screen.getByRole('button', { name: 'LF' }));
    await userEvent.type(screen.getByLabelText('Code'), 'C');
    await userEvent.type(screen.getByLabelText('Name'), 'N');
    await userEvent.click(screen.getByRole('button', { name: /Save service/ }));
    expect(onSubmit.mock.calls[0]![0].supportedUnits).toContain('LF');
  });

  it('shows a refusal rather than pretending it saved', () => {
    form({ error: 'duplicate key value violates unique constraint "services_company_code_idx"' });
    expect(screen.getByText(/duplicate key value/)).toBeInTheDocument();
  });

  it('opens with existing values when editing', () => {
    form({ initial: { code: 'SVC-9', name: 'Existing', defaultUnit: 'LF' }, title: 'Edit service' });
    expect(screen.getByLabelText('Code')).toHaveValue('SVC-9');
    expect(screen.getByLabelText('Name')).toHaveValue('Existing');
  });
});

describe('adding a task', () => {
  const form = (over = {}) => render(
    <TaskForm busy={false} error={null} onSubmit={onSubmit} onCancel={onCancel} {...over} />);

  it('explains that what a task requires decides what the engine insists on', () => {
    form();
    expect(screen.getByText(/decides what the estimating engine insists on/)).toBeInTheDocument();
    expect(screen.getByText(/cannot work out a duration/)).toBeInTheDocument();
  });

  it('defaults to needing production, crew and equipment', async () => {
    // The common case for construction work, and the one the engine can
    // actually price.
    form();
    await userEvent.type(screen.getByLabelText('Code'), 'TSK-1');
    await userEvent.type(screen.getByLabelText('Name'), 'Pull branch circuit');
    await userEvent.click(screen.getByRole('button', { name: /Save task/ }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      productionRequired: true, crewRequired: true, equipmentRequired: true,
      materialRequired: false, safetyReviewRequired: false,
    }));
  });

  it('lets a requirement be turned off', async () => {
    form();
    await userEvent.click(screen.getByLabelText('Needs equipment'));
    await userEvent.type(screen.getByLabelText('Code'), 'TSK-2');
    await userEvent.type(screen.getByLabelText('Name'), 'Hand dig');
    await userEvent.click(screen.getByRole('button', { name: /Save task/ }));
    expect(onSubmit.mock.calls[0]![0].equipmentRequired).toBe(false);
  });

  it('will not save without a code and a name', () => {
    form();
    expect(screen.getByRole('button', { name: /Save task/ })).toBeDisabled();
  });
});
