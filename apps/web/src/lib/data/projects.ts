/**
 * Project reads, against the governed schema.
 *
 * Every query here is scoped by row level security rather than by a filter this
 * code remembers to add. That is deliberate and it is the whole reason these
 * are safe to write plainly: a `select` from `projects` returns the caller's
 * company's projects because the policy says so, and a bug in this file cannot
 * widen that.
 *
 * `reporting_project_financials` is read rather than recomputed. It is the same
 * view the public API serves and the same one the governed metrics are defined
 * over, so a figure on a screen and a figure in a report cannot disagree —
 * which they would the moment this file started summing `project_costs` itself.
 */
import { unwrap, type Query } from './query';

export interface ProjectRow {
  id: string;
  number: string;
  name: string;
  status: string;
  contract_type: string | null;
  contract_value: number | null;
  planned_start: string | null;
  planned_finish: string | null;
}

export interface ProjectFinancials {
  project_id: string;
  project_number: string;
  project_name: string;
  status: string;
  contract_value: number | null;
  revised_contract_value: number | null;
  actual_cost: number;
  committed_cost: number;
  labor_cost: number;
  equipment_cost: number;
  material_cost: number;
  subcontract_cost: number;
  billed_to_date: number;
  retainage_held: number;
  gross_profit_to_date: number;
}

export const listProjects: Query<ProjectRow[]> = async (client) =>
  unwrap(
    await client
      .from('projects')
      .select('id, number, name, status, contract_type, contract_value, planned_start, planned_finish')
      .order('number', { ascending: true }),
  );

export const listProjectFinancials: Query<ProjectFinancials[]> = async (client) =>
  unwrap(
    await client
      .from('reporting_project_financials')
      // One literal, not a concatenation: supabase-js parses this string at
      // the type level and cannot see through `+`.
      .select('project_id, project_number, project_name, status, contract_value, revised_contract_value, actual_cost, committed_cost, labor_cost, equipment_cost, material_cost, subcontract_cost, billed_to_date, retainage_held, gross_profit_to_date')
      .order('project_number', { ascending: true }),
  );

/**
 * The governed metrics for the caller's company, with their values.
 *
 * Read from `reporting_metric_values`, which evaluates each definition through
 * `app.evaluate_metric` — so a number here is the number the public API returns
 * for the same key, computed once in one place.
 */
export interface MetricValue {
  key: string;
  name: string;
  description: string;
  domain: string;
  unit: string;
  value: number | null;
  target_value: number | null;
  higher_is_better: boolean | null;
}

export const listMetrics: Query<MetricValue[]> = async (client) =>
  unwrap(
    await client
      .from('reporting_metric_values')
      .select('key, name, description, domain, unit, value, target_value, higher_is_better')
      .order('domain', { ascending: true })
      .order('name', { ascending: true }),
  );
