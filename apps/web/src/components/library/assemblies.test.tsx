/**
 * The order the work happens in, and making it yours.
 *
 * Fifty-four sequences shipped with no screen at all: `customize_assembly`,
 * `add_assembly_step`, `remove_assembly_step` and `my_assembly_steps` existed,
 * were tested, and nothing called them. This is the door.
 *
 * What the screen has to make unmistakable is whose sequence you are looking
 * at, because that decides whether you may change it. A platform sequence is
 * the same one every company reads, and offering edit controls on it would be
 * offering something the database refuses.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderPage } from '@/test/render';
import type { AssemblyTemplate, AssemblyStep, TaskPick } from '@/lib/data/assemblies';

const hoisted = vi.hoisted(() => ({
  templates: [] as AssemblyTemplate[],
  steps: [] as AssemblyStep[],
  tasks: [] as TaskPick[],
  customized: [] as string[],
  added: [] as Array<{ assembly: string; task: string }>,
  removed: [] as string[],
  moved: [] as Array<{ step: string; to: number }>,
  failWith: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));

vi.mock('@/lib/data/assemblies', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/assemblies')>(
    '@/lib/data/assemblies');
  return {
    ...actual,
    loadAssemblyTemplates: async () => hoisted.templates,
    loadAssemblySteps: () => async () => hoisted.steps,
    searchTasks: () => async () => hoisted.tasks,
    customizeAssembly: async (id: string) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.customized.push(id);
      return 'copy-1';
    },
    addAssemblyStep: async (assembly: string, task: string) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.added.push({ assembly, task });
    },
    removeAssemblyStep: async (step: string) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.removed.push(step);
    },
    moveAssemblyStep: async (step: string, to: number) => { hoisted.moved.push({ step, to }); },
  };
});

const { AssemblyLibrary } = await import('./assemblies');

const template = (over: Partial<AssemblyTemplate> = {}): AssemblyTemplate => ({
  id: 'a-1', companyId: null, code: 'ASM-TT-CONC-STD', name: 'Concrete Template',
  trade: 'Concrete', isPlatform: true, steps: 10, customizedAs: null, ...over,
});

const step = (over: Partial<AssemblyStep> = {}): AssemblyStep => ({
  stepId: 's-1', step: 1, taskId: 't-1', taskName: 'Layout / verify elevations',
  taskCategory: 'Support', taskUnit: 'LS', quantityPerUnit: 1,
  isOptional: false, ratePerHour: null, ...over,
});

const show = (canEdit = true) =>
  renderPage(<AssemblyLibrary companyId="c-1" canEdit={canEdit} />);

beforeEach(() => {
  hoisted.templates = [template()];
  hoisted.steps = [step(), step({ stepId: 's-2', step: 2, taskName: 'Set forms / edges' })];
  hoisted.tasks = [];
  hoisted.customized = []; hoisted.added = []; hoisted.removed = []; hoisted.moved = [];
  hoisted.failWith = null;
});

// ---------------------------------------------------------------------------
describe('whose sequence it is', () => {
  it('says a shipped one ships with GrounUp', async () => {
    show();
    expect(await screen.findByText('ships with GrounUp')).toBeInTheDocument();
  });

  it('offers to copy it rather than to edit it', async () => {
    show();
    expect(await screen.findByRole('button', { name: /Make it ours/ })).toBeInTheDocument();
  });

  it('offers no step controls on a shipped one', async () => {
    /*
     * The database refuses a write to a platform row. Drawing the buttons
     * anyway would be offering something that cannot happen.
     */
    show();
    await userEvent.click(await screen.findByRole('button', { name: /Concrete Template/ }));
    await screen.findByText('Layout / verify elevations');
    expect(screen.queryByRole('button', { name: /Remove Layout/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a step/ })).not.toBeInTheDocument();
  });

  it('says why, before the refusal rather than after', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: /Concrete Template/ }));
    expect(await screen.findByText(/Make your own copy to change it/)).toBeInTheDocument();
  });

  it('marks a company sequence as yours', async () => {
    hoisted.templates = [template({ id: 'a-2', companyId: 'c-1', isPlatform: false })];
    show();
    expect(await screen.findByText('yours')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('making it yours', () => {
  it('copies it', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: /Make it ours/ }));
    await waitFor(() => expect(hoisted.customized).toEqual(['a-1']));
  });

  it('offers no copying to somebody who cannot write the library', async () => {
    show(false);
    await screen.findByText('Concrete Template');
    expect(screen.queryByRole('button', { name: /Make it ours/ })).not.toBeInTheDocument();
  });

  it('stops offering it once a copy exists, and points at the copy', async () => {
    hoisted.templates = [template({ customizedAs: 'copy-1' })];
    show();
    expect(await screen.findByText('you have a copy')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Make it ours/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open your copy/ })).toBeInTheDocument();
  });

  it('shows a refusal rather than a generic failure', async () => {
    hoisted.failWith = 'Making your own copy needs the libraries.write permission.';
    show();
    await userEvent.click(await screen.findByRole('button', { name: /Make it ours/ }));
    expect(await screen.findByText(/needs the libraries.write permission/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('changing your own sequence', () => {
  beforeEach(() => {
    hoisted.templates = [template({ id: 'a-2', companyId: 'c-1', isPlatform: false })];
  });

  it('reads the steps in order', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: /Concrete Template/ }));
    expect(await screen.findByText('Layout / verify elevations')).toBeInTheDocument();
    expect(screen.getByText('Set forms / edges')).toBeInTheDocument();
  });

  it('removes a step', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: /Concrete Template/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Remove Layout/ }));
    await waitFor(() => expect(hoisted.removed).toEqual(['s-1']));
  });

  it('moves one down', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: /Concrete Template/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Move Layout.*down/ }));
    await waitFor(() => expect(hoisted.moved).toEqual([{ step: 's-1', to: 2 }]));
  });

  it('will not move the first up or the last down', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: /Concrete Template/ }));
    expect(await screen.findByRole('button', { name: /Move Layout.*up/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Move Set forms.*down/ })).toBeDisabled();
  });

  it('adds a step by searching for it', async () => {
    hoisted.tasks = [{ id: 't-9', code: 'TSK-CURE', name: 'Cure and protect', category: 'Finish' }];
    show();
    await userEvent.click(await screen.findByRole('button', { name: /Concrete Template/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Add a step/ }));
    await userEvent.type(screen.getByLabelText('Find a step to add'), 'cure');
    await userEvent.click(await screen.findByRole('option', { name: /Cure and protect/ }));
    await waitFor(() => expect(hoisted.added).toEqual([{ assembly: 'a-2', task: 't-9' }]));
  });
});

// ---------------------------------------------------------------------------
describe('a step with no measured rate', () => {
  it('shows a dash rather than a zero', async () => {
    /*
     * Most steps have none — nobody has measured "flashing and details". A zero
     * would read as instantaneous.
     */
    hoisted.templates = [template({ id: 'a-2', companyId: 'c-1', isPlatform: false })];
    show();
    await userEvent.click(await screen.findByRole('button', { name: /Concrete Template/ }));
    await screen.findByText('Layout / verify elevations');
    expect(screen.queryByText('0.00 LS/hr')).not.toBeInTheDocument();
  });

  it('shows the rate when there is one', async () => {
    hoisted.templates = [template({ id: 'a-2', companyId: 'c-1', isPlatform: false })];
    hoisted.steps = [step({ taskName: 'Excavate to line and grade', ratePerHour: 80, taskUnit: 'CY' })];
    show();
    await userEvent.click(await screen.findByRole('button', { name: /Concrete Template/ }));
    expect(await screen.findByText(/80\.00 CY\/hr/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('finding one among fifty-four', () => {
  it('filters by name', async () => {
    hoisted.templates = [template(), template({ id: 'a-3', name: 'Roofing Template', trade: 'Roofing' })];
    show();
    await userEvent.type(await screen.findByLabelText('Find a work sequence'), 'roof');
    expect(screen.getByText('Roofing Template')).toBeInTheDocument();
    expect(screen.queryByText('Concrete Template')).not.toBeInTheDocument();
  });

  it('filters by trade, which is how somebody looks for one', async () => {
    hoisted.templates = [template(), template({ id: 'a-3', name: 'Irrigation Template', trade: 'Landscaping' })];
    show();
    await userEvent.type(await screen.findByLabelText('Find a work sequence'), 'landscap');
    expect(screen.getByText('Irrigation Template')).toBeInTheDocument();
  });

  it('says how many of how many are showing', async () => {
    hoisted.templates = [template(), template({ id: 'a-3', name: 'Roofing Template' })];
    show();
    expect(await screen.findByText('2 of 2')).toBeInTheDocument();
  });
});
