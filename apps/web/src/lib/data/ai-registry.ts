/**
 * The AI registry and the connectors, read from the governed schema.
 *
 * Library: what models exist and what each is allowed to do, and Entity: the
 * connectors one company has configured.
 *
 * Settings rendered all three from `@/data/field` and `@/data/safety` — a
 * fixture of models with invented prices and connectors that were never
 * configured. That was tolerable while the whole screen was a demonstration.
 * It stopped being tolerable the moment the same screen began reading the real
 * company record, because a page that mixes the two teaches a reader to trust
 * the invented half exactly as much as the real one.
 *
 * All three tables have been governed since 0013, 0014 and 0021, and none of
 * them needed a new function: `ai_models` is a catalog every signed-in person
 * may read when it is enabled, `ai_prompts` lets a tenant read the shipped
 * prompts plus its own, and `connectors` is tenant-scoped behind
 * `company.manage`.
 */
import { unwrap, type Query } from './query';

export interface AiModel {
  id: string;
  provider: string;
  displayName: string;
  capabilities: string[];
  contextTokens: number | null;
  /** Dollars per million tokens. Null where the provider does not publish one. */
  inputCostPerMtok: number | null;
  outputCostPerMtok: number | null;
  isDefault: boolean;
  notes: string | null;
}

/**
 * The models this platform may use.
 *
 * `ai_models_select` already restricts this to enabled models, so a disabled
 * one is absent rather than filtered here — a second filter in the browser
 * would be a second opinion about the same rule.
 */
export const loadAiModels: Query<AiModel[]> = async (client) => {
  const rows = unwrap(await client
    .from('ai_models')
    .select('id, provider, display_name, capabilities, context_tokens, ' +
            'input_cost_per_mtok, output_cost_per_mtok, is_default, notes')
    .order('provider')
    .order('display_name')) as unknown as Array<Record<string, unknown>>;
  return rows.map((m) => ({
    id: String(m.id),
    provider: String(m.provider),
    displayName: String(m.display_name),
    capabilities: (m.capabilities as string[] | null) ?? [],
    contextTokens: m.context_tokens == null ? null : Number(m.context_tokens),
    inputCostPerMtok: m.input_cost_per_mtok == null ? null : Number(m.input_cost_per_mtok),
    outputCostPerMtok: m.output_cost_per_mtok == null ? null : Number(m.output_cost_per_mtok),
    isDefault: Boolean(m.is_default),
    notes: (m.notes as string | null) ?? null,
  }));
};

export interface AiPrompt {
  id: string;
  agentId: string;
  version: string;
  state: 'draft' | 'evaluating' | 'active' | 'retired';
  /** Null on a GrounUp-shipped prompt; set on a company's own variant. */
  companyId: string | null;
  evalPassRate: number | null;
  evalSampleSize: number | null;
  evalNotes: string | null;
  activatedAt: string | null;
}

/**
 * Every prompt version, shipped and company-authored.
 *
 * The evaluation figures are carried because they are the reason the table has
 * a state machine: migration 0013 refuses to mark a prompt active without
 * recording who promoted it and what it scored, so a prompt cannot be promoted
 * on an opinion. A screen that hid the score would hide the rule.
 */
export const loadAiPrompts: Query<AiPrompt[]> = async (client) => {
  const rows = unwrap(await client
    .from('ai_prompts')
    .select('id, agent_id, version, state, company_id, eval_pass_rate, ' +
            'eval_sample_size, eval_notes, activated_at')
    .order('agent_id')
    .order('version')) as unknown as Array<Record<string, unknown>>;
  return rows.map((p) => ({
    id: String(p.id),
    agentId: String(p.agent_id),
    version: String(p.version),
    state: String(p.state) as AiPrompt['state'],
    companyId: (p.company_id as string | null) ?? null,
    evalPassRate: p.eval_pass_rate == null ? null : Number(p.eval_pass_rate),
    evalSampleSize: p.eval_sample_size == null ? null : Number(p.eval_sample_size),
    evalNotes: (p.eval_notes as string | null) ?? null,
    activatedAt: (p.activated_at as string | null) ?? null,
  }));
};

export interface Connector {
  id: string;
  connectorType: string;
  provider: string;
  name: string;
  isEnabled: boolean;
  status: 'not_connected' | 'connected' | 'degraded' | 'failed' | 'disabled';
  scheduleCron: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
}

/**
 * The connectors this company has configured.
 *
 * No credential is read, and none is readable: migration 0021 stores only a
 * handle into the platform secret store on the row, so a database read can
 * never yield a usable credential. That is why this can be a plain select.
 */
export const loadConnectors: Query<Connector[]> = async (client) => {
  const rows = unwrap(await client
    .from('connectors')
    .select('id, connector_type, provider, name, is_enabled, status, ' +
            'schedule_cron, last_run_at, last_success_at, consecutive_failures')
    .order('connector_type')
    .order('name')) as unknown as Array<Record<string, unknown>>;
  return rows.map((c) => ({
    id: String(c.id),
    connectorType: String(c.connector_type),
    provider: String(c.provider),
    name: String(c.name),
    isEnabled: Boolean(c.is_enabled),
    status: String(c.status) as Connector['status'],
    scheduleCron: (c.schedule_cron as string | null) ?? null,
    lastRunAt: (c.last_run_at as string | null) ?? null,
    lastSuccessAt: (c.last_success_at as string | null) ?? null,
    consecutiveFailures: Number(c.consecutive_failures ?? 0),
  }));
};
