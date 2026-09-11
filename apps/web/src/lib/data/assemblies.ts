/**
 * Work sequences, and making one yours.
 *
 * The library ships 54 of them — the order concrete goes in, the order a
 * bathroom rough-in goes in, the order a roof is torn off and put back. They
 * are platform rows: every company reads them and none may write one, which is
 * the right default and the wrong ending. A contractor whose crew strips forms
 * before sawcutting has a sequence that is theirs, and a library that cannot
 * hold it is a library they stop using.
 *
 * So: copy on write. `customizeAssembly` makes the company its own copy, steps
 * and all, and from then on the ordinary add, remove and reorder work on it.
 * The platform's own stays exactly where it is for everybody else — the same
 * three-tier shape every library in this schema already has.
 *
 * Every one of these functions existed in the database and was tested before
 * this file was written. Nothing called them. That is the defect this closes.
 */
import { unwrap, type Query } from './query';
import { supabase } from '@/lib/supabase';

export interface AssemblyTemplate {
  id: string;
  companyId: string | null;
  code: string;
  name: string;
  trade: string | null;
  /** True for the sequences GrounUp ships, which no company may edit. */
  isPlatform: boolean;
  steps: number;
  /** The company's own copy, when they have made one. */
  customizedAs: string | null;
}

export interface AssemblyStep {
  stepId: string;
  step: number;
  taskId: string | null;
  taskName: string | null;
  taskCategory: string | null;
  taskUnit: string | null;
  quantityPerUnit: number;
  isOptional: boolean;
  /** What the library says this step produces per hour, when anybody has said. */
  ratePerHour: number | null;
}

type Row = Record<string, unknown>;

/**
 * Every sequence the caller can see, platform and their own together.
 *
 * A company's copy is matched back to what it came from, so the list shows one
 * row per sequence rather than the same trade twice — "Concrete Template" with
 * a badge saying it is yours, not "Concrete Template" and "Concrete Template".
 */
export const loadAssemblyTemplates: Query<AssemblyTemplate[]> = async (client) => {
  const rows = unwrap(await client
    .from('assemblies')
    .select('id, company_id, code, name, assembly_type, source, status')
    .eq('status', 'active')
    .order('assembly_type')
    .order('name')) as unknown as Row[];

  const all = rows.map((r) => ({
    id: String(r.id),
    companyId: (r.company_id as string | null) ?? null,
    code: String(r.code),
    name: String(r.name),
    trade: (r.assembly_type as string | null) ?? null,
    isPlatform: r.company_id === null,
    source: (r.source as string | null) ?? '',
    steps: 0,
    customizedAs: null as string | null,
  }));

  const counts = unwrap(await client
    .from('my_assembly_steps')
    .select('assembly_id')) as unknown as Row[];
  const byAssembly = new Map<string, number>();
  for (const c of counts) {
    const id = String(c.assembly_id);
    byAssembly.set(id, (byAssembly.get(id) ?? 0) + 1);
  }
  for (const a of all) a.steps = byAssembly.get(a.id) ?? 0;

  /* "Copied from ASM-TT-CONC-STD" is how a copy says where it came from. */
  const mine = all.filter((a) => !a.isPlatform);
  const platform = all.filter((a) => a.isPlatform);
  for (const p of platform) {
    const copy = mine.find((m) => m.source === `Copied from ${p.code}`);
    if (copy) p.customizedAs = copy.id;
  }
  const copiedFrom = new Set(platform.map((p) => p.customizedAs).filter(Boolean));

  return [
    ...platform,
    /* A company assembly that is not a copy of anything is theirs outright. */
    ...mine.filter((m) => !copiedFrom.has(m.id)),
  ].map(({ source: _s, ...rest }) => rest);
};

export const loadAssemblySteps = (assemblyId: string): Query<AssemblyStep[]> =>
  async (client) => {
    const rows = unwrap(await client
      .from('my_assembly_steps')
      .select('step_id, step, task_id, task_name, task_category, task_unit,'
        + ' quantity_per_unit, is_optional, rate_per_hour')
      .eq('assembly_id', assemblyId)
      .order('step')) as unknown as Row[];
    return rows.map((r) => ({
      stepId: String(r.step_id),
      step: Number(r.step ?? 0),
      taskId: (r.task_id as string | null) ?? null,
      taskName: (r.task_name as string | null) ?? null,
      taskCategory: (r.task_category as string | null) ?? null,
      taskUnit: (r.task_unit as string | null) ?? null,
      quantityPerUnit: Number(r.quantity_per_unit ?? 1),
      isOptional: Boolean(r.is_optional),
      ratePerHour: r.rate_per_hour === null ? null : Number(r.rate_per_hour),
    }));
  };

export interface TaskPick { id: string; code: string; name: string; category: string | null }

/** Tasks a step can be, searched rather than listed: the library holds thousands. */
export const searchTasks = (term: string): Query<TaskPick[]> => async (client) => {
  let q = client
    .from('tasks')
    .select('id, code, name, category')
    .eq('status', 'active');
  if (term.trim()) q = q.ilike('name', `%${term.trim()}%`);
  const rows = unwrap(await q.order('name').limit(25)) as unknown as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    category: (r.category as string | null) ?? null,
  }));
};

export async function customizeAssembly(assemblyId: string, companyId: string): Promise<string> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { data, error } = await supabase.rpc('customize_assembly', {
    p_assembly: assemblyId, p_company: companyId,
  });
  if (error) throw new Error(error.message);
  const row = data as { id?: string } | null;
  return String(row?.id ?? '');
}

/**
 * Give a service with no work sequence one to fill.
 *
 * `customizeAssembly` copies a template that exists. This is the other case:
 * 465 services arrived from the product master naming sequences the task
 * library did not contain, so there was nothing to copy and no way to start.
 *
 * The block was never the assembly — everything that prices a line resolves
 * through `services.default_assembly_id`, and a catalog service row is one no
 * tenant may write. So the door takes the company its own copy of the service
 * first and attaches an empty sequence to that, in one transaction, because a
 * company service pointing at nothing is the state it exists to remove.
 *
 * Returns the assembly to fill. Asked twice it returns the same one.
 */
export async function startABreakdown(serviceId: string, companyId: string): Promise<string> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { data, error } = await supabase.rpc('start_a_breakdown', {
    p_service: serviceId, p_company: companyId,
  });
  if (error) throw new Error(error.message);
  const row = data as { id?: string } | null;
  return String(row?.id ?? '');
}

export interface ServiceWithoutABreakdown {
  id: string;
  code: string;
  name: string;
  industry: string | null;
  category: string | null;
  defaultUnit: string;
  /** No sequence at all, as against a sequence with no steps in it. */
  hasNoAssembly: boolean;
  steps: number;
}

/**
 * Services nobody can price yet.
 *
 * A named, CSI-coded service an estimator can build up by hand beats one that
 * is not there — but the gap belongs on a list rather than in a bid, and until
 * now the list had no reader. Empty is the ordinary answer and the screen shows
 * nothing at all for it: a panel reading "0 services need a breakdown" on every
 * healthy library is a panel people learn to skip, and then skip on the day an
 * import puts four hundred rows in it.
 */
export const loadServicesWithoutABreakdown: Query<ServiceWithoutABreakdown[]> =
  async (client) => {
    const rows = unwrap(await client
      .from('my_services_without_a_breakdown')
      .select('id, code, name, industry, category, default_unit, has_no_assembly, steps')
      .order('code')
      .limit(500)) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      code: String(r.code),
      name: String(r.name),
      industry: (r.industry as string | null) ?? null,
      category: (r.category as string | null) ?? null,
      defaultUnit: String(r.default_unit),
      hasNoAssembly: Boolean(r.has_no_assembly),
      steps: Number(r.steps ?? 0),
    }));
  };

export async function addAssemblyStep(
  assemblyId: string, taskId: string, position?: number,
): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('add_assembly_step', {
    p_assembly: assemblyId, p_task: taskId, p_position: position ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function removeAssemblyStep(stepId: string): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('remove_assembly_step', { p_step: stepId });
  if (error) throw new Error(error.message);
}

export async function moveAssemblyStep(stepId: string, to: number): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('move_assembly_step', { p_step: stepId, p_to: to });
  if (error) throw new Error(error.message);
}
