/**
 * Starting from one you have built before.
 *
 * The properties worth a test are the ones an estimator gets wrong when the
 * screen is quiet about them.
 *
 * A template that carries quantities has to say so before it is applied, not
 * after — 4,200 cubic yards arriving from the last pond is the kind of number
 * that goes out in a bid. And a template that lost a machine on the way in has
 * to say that too: the database keeps the line and clears the reference, and a
 * screen that swallowed the report would leave the line silently short.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TemplateRow, TemplateLine, ApplyResult } from '@/lib/data/templates';

const hoisted = vi.hoisted(() => ({
  configured: true,
  templates: [] as TemplateRow[],
  lines: [] as TemplateLine[],
  saved: [] as Array<Record<string, unknown>>,
  appliedWith: [] as Array<{ version: string; template: string }>,
  applyResult: { linesAdded: 0, carriesQuantities: false, warnings: [] } as ApplyResult,
  archived: [] as string[],
  fail: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/templates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/templates')>(
    '@/lib/data/templates');
  return {
    ...actual,
    loadTemplates: async () => hoisted.templates,
    loadTemplateLines: () => async () => hoisted.lines,
    saveTemplate: async (_c: unknown, input: Record<string, unknown>) => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      hoisted.saved.push(input);
      return 'tpl-new';
    },
    applyTemplate: async (_c: unknown, version: string, template: string) => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      hoisted.appliedWith.push({ version, template });
      return hoisted.applyResult;
    },
    archiveTemplate: async (_c: unknown, id: string) => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      hoisted.archived.push(id);
    },
  };
});

const {
  TemplatePicker, SaveTemplateDialog, ApplyTemplateDialog, ApplyWarnings, TemplateShelf,
  templateSummary,
} = await import('./templates');

const template = (over: Partial<TemplateRow> = {}): TemplateRow => ({
  id: 'tpl-1',
  name: 'Detention pond with access road',
  description: 'Excavate, line and the road in',
  trade: 'Earthwork',
  lineCount: 4,
  carriesQuantities: false,
  status: 'active',
  timesUsed: 3,
  lastUsedAt: '2026-08-01T00:00:00Z',
  createdAt: '2026-06-01T00:00:00Z',
  linesWithResources: 4,
  markupCount: 2,
  sourceEstimateNumber: 'E-2026-0007',
  sourceEstimateName: 'Kesler pond',
  ...over,
});

const line = (over: Partial<TemplateLine> = {}): TemplateLine => ({
  position: 1, description: 'Excavate basin', unit: 'CY',
  measuredQuantity: 4200, resourceCount: 3, modifierCount: 0, ...over,
});

beforeEach(() => {
  hoisted.configured = true;
  hoisted.templates = [template()];
  hoisted.lines = [line()];
  hoisted.saved = [];
  hoisted.appliedWith = [];
  hoisted.archived = [];
  hoisted.applyResult = { linesAdded: 4, carriesQuantities: false, warnings: [] };
  hoisted.fail = null;
});

describe('the one-line summary of a template', () => {
  it('says how many lines carry a crew, because that is what makes it worth having', () => {
    expect(templateSummary(template())).toContain('4 with a crew or machine');
  });

  it('says whether quantities come with it, either way', () => {
    expect(templateSummary(template())).toContain('no quantities');
    expect(templateSummary(template({ carriesQuantities: true }))).toContain('quantities included');
  });
});

describe('choosing a template', () => {
  it('lists what there is', async () => {
    render(<TemplatePicker value={null} onChange={() => {}} />);
    expect(await screen.findByText('Detention pond with access road')).toBeInTheDocument();
  });

  it('offers a way to start when there is nothing saved yet', async () => {
    hoisted.templates = [];
    render(<TemplatePicker value={null} onChange={() => {}} />);
    expect(await screen.findByText('No templates yet')).toBeInTheDocument();
  });

  it('hands back the template it was given, not only its id', async () => {
    const seen: Array<TemplateRow | null> = [];
    render(<TemplatePicker value={null} onChange={(_id, t) => seen.push(t)} />);
    await userEvent.click(await screen.findByText('Detention pond with access road'));
    expect(seen[0]?.name).toBe('Detention pond with access road');
  });

  it('shows the lines it would add', async () => {
    render(<TemplatePicker value="tpl-1" onChange={() => {}} />);
    expect(await screen.findByText('Excavate basin')).toBeInTheDocument();
  });

  it('hides a quantity the template does not carry, rather than showing a zero', async () => {
    render(<TemplatePicker value="tpl-1" onChange={() => {}} />);
    await screen.findByText('Excavate basin');
    expect(screen.getByText('CY')).toBeInTheDocument();
    expect(screen.queryByText(/4,200/)).not.toBeInTheDocument();
    expect(screen.getByText(/Quantities arrive at zero/)).toBeInTheDocument();
  });

  it('warns in advance when the template does carry last job’s quantities', async () => {
    hoisted.templates = [template({ carriesQuantities: true })];
    render(<TemplatePicker value="tpl-1" onChange={() => {}} />);
    expect(await screen.findByText(/Check them against this job/)).toBeInTheDocument();
    expect(screen.getByText(/4,200/)).toBeInTheDocument();
  });
});

describe('saving one', () => {
  it('leaves the quantities behind unless the estimator says otherwise', async () => {
    render(<SaveTemplateDialog versionId="v1" lineCount={4} open
      onOpenChange={() => {}} onSaved={() => {}} />);
    await userEvent.type(screen.getByLabelText('Template name'), 'Pond');
    await userEvent.click(screen.getByRole('button', { name: /save template/i }));
    await waitFor(() => expect(hoisted.saved).toHaveLength(1));
    expect(hoisted.saved[0]!.includeQuantities).toBe(false);
  });

  it('carries them when the estimator asks', async () => {
    render(<SaveTemplateDialog versionId="v1" lineCount={4} open
      onOpenChange={() => {}} onSaved={() => {}} />);
    await userEvent.type(screen.getByLabelText('Template name'), 'Pond');
    await userEvent.click(screen.getByRole('switch', { name: /carry the quantities/i }));
    await userEvent.click(screen.getByRole('button', { name: /save template/i }));
    await waitFor(() => expect(hoisted.saved).toHaveLength(1));
    expect(hoisted.saved[0]!.includeQuantities).toBe(true);
  });

  it('will not save without a name', async () => {
    render(<SaveTemplateDialog versionId="v1" lineCount={4} open
      onOpenChange={() => {}} onSaved={() => {}} />);
    expect(screen.getByRole('button', { name: /save template/i })).toBeDisabled();
  });

  it('says no price is captured, so nobody expects one', () => {
    render(<SaveTemplateDialog versionId="v1" lineCount={4} open
      onOpenChange={() => {}} onSaved={() => {}} />);
    expect(screen.getByText(/No price is captured/)).toBeInTheDocument();
  });

  it('shows what went wrong rather than closing on a failure', async () => {
    hoisted.fail = 'You already have a template called Pond';
    render(<SaveTemplateDialog versionId="v1" lineCount={4} open
      onOpenChange={() => {}} onSaved={() => {}} />);
    await userEvent.type(screen.getByLabelText('Template name'), 'Pond');
    await userEvent.click(screen.getByRole('button', { name: /save template/i }));
    expect(await screen.findByText(/already have a template called Pond/)).toBeInTheDocument();
  });
});

describe('applying one', () => {
  it('applies the chosen template to the version it was given', async () => {
    render(<ApplyTemplateDialog versionId="v9" open
      onOpenChange={() => {}} onApplied={() => {}} />);
    await userEvent.click(await screen.findByText('Detention pond with access road'));
    await userEvent.click(screen.getByRole('button', { name: /add these lines/i }));
    await waitFor(() => expect(hoisted.appliedWith).toHaveLength(1));
    expect(hoisted.appliedWith[0]).toEqual({ version: 'v9', template: 'tpl-1' });
  });

  it('will not apply until one is chosen', async () => {
    render(<ApplyTemplateDialog versionId="v9" open
      onOpenChange={() => {}} onApplied={() => {}} />);
    await screen.findByText('Detention pond with access road');
    expect(screen.getByRole('button', { name: /add these lines/i })).toBeDisabled();
  });

  it('hands the result back, warnings and all', async () => {
    hoisted.applyResult = {
      linesAdded: 4, carriesQuantities: false,
      warnings: ['equipment on "Excavate basin" is no longer in your library'],
    };
    const seen: ApplyResult[] = [];
    render(<ApplyTemplateDialog versionId="v9" open
      onOpenChange={() => {}} onApplied={(r) => seen.push(r)} />);
    await userEvent.click(await screen.findByText('Detention pond with access road'));
    await userEvent.click(screen.getByRole('button', { name: /add these lines/i }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]!.warnings).toHaveLength(1);
  });
});

describe('what a template could not bring', () => {
  it('says nothing at all when nothing was lost', () => {
    const { container } = render(<ApplyWarnings result={
      { linesAdded: 4, carriesQuantities: false, warnings: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names each one, and says the lines were kept', () => {
    render(<ApplyWarnings result={{
      linesAdded: 4, carriesQuantities: false,
      warnings: ['material on "Line the basin" is no longer in your library'],
    }} />);
    expect(screen.getByText(/material on "Line the basin"/)).toBeInTheDocument();
    expect(screen.getByText(/lines were kept/)).toBeInTheDocument();
  });
});

describe('the shelf of templates a company keeps', () => {
  it('says nothing at all when there are none', async () => {
    hoisted.templates = [];
    const { container } = render(<TemplateShelf canEdit />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('says how often each has been used, and when', async () => {
    render(<TemplateShelf canEdit />);
    expect(await screen.findByText(/used 3×/)).toBeInTheDocument();
  });

  it('says so plainly when one has never been used', async () => {
    hoisted.templates = [template({ timesUsed: 0, lastUsedAt: null })];
    render(<TemplateShelf canEdit />);
    expect(await screen.findByText('not used yet')).toBeInTheDocument();
  });

  it('archives rather than deletes, so an estimate can still be explained', async () => {
    render(<TemplateShelf canEdit />);
    await userEvent.click(await screen.findByRole('button', { name: /archive/i }));
    await waitFor(() => expect(hoisted.archived).toEqual(['tpl-1']));
  });

  it('offers no archive to somebody who may not write estimates', async () => {
    render(<TemplateShelf canEdit={false} />);
    await screen.findByText('Detention pond with access road');
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument();
  });

  it('flags the ones carrying quantities on the shelf, not only in the picker', async () => {
    hoisted.templates = [template({ carriesQuantities: true })];
    render(<TemplateShelf canEdit />);
    expect(await screen.findByText('Quantities')).toBeInTheDocument();
  });
});
