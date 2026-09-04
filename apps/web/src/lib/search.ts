/**
 * Enterprise search.
 *
 * Against a configured Supabase project this calls `app.search`, which is
 * SECURITY INVOKER — every branch of its union reads an RLS-protected table as
 * the caller, so results are permission-filtered by construction. A search index
 * maintained outside the permission model is the classic way a platform leaks
 * one tenant's records to another through autocomplete.
 *
 * Without a project it searches the in-memory demo dataset with the same shape.
 */
import { supabase } from './supabase';
import { ESTIMATES, PROJECTS, CUSTOMERS, DOCUMENTS } from '@/data/operations';
import { ASSETS, EMPLOYEES } from '@/data/fleet';
import { PURCHASE_ORDERS } from '@/data/finance';

export interface SearchHit {
  kind: 'estimate' | 'project' | 'customer' | 'document' | 'service' | 'sheet' | 'asset' | 'employee' | 'purchase_order';
  id: string;
  title: string;
  subtitle: string;
  path: string;
}

/** Simple substring rank: exact prefix beats a mid-string match. */
function rank(haystack: string, needle: string): number {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  const i = h.indexOf(n);
  if (i < 0) return -1;
  return i === 0 ? 2 : 1;
}

function searchDemo(query: string, limit: number): SearchHit[] {
  const q = query.trim();
  if (q.length < 2) return [];

  const hits: (SearchHit & { r: number })[] = [];
  const add = (r: number, hit: SearchHit) => { if (r >= 0) hits.push({ ...hit, r }); };

  for (const e of ESTIMATES) {
    add(rank(`${e.number} ${e.name} ${e.customer}`, q),
      { kind: 'estimate', id: e.id, title: `${e.number} — ${e.name}`, subtitle: e.customer, path: `/app/estimates/${e.id}` });
  }
  for (const p of PROJECTS) {
    add(rank(`${p.number} ${p.name} ${p.customer}`, q),
      { kind: 'project', id: p.id, title: `${p.number} — ${p.name}`, subtitle: p.customer, path: `/app/projects/${p.id}` });
  }
  for (const c of CUSTOMERS) {
    add(rank(`${c.name} ${c.contact} ${c.city}`, q),
      { kind: 'customer', id: c.id, title: c.name, subtitle: `${c.city}, ${c.state}`, path: '/app/crm' });
  }
  for (const d of DOCUMENTS.filter((x) => !x.superseded)) {
    add(rank(`${d.name} ${d.discipline}`, q),
      { kind: 'document', id: d.id, title: d.name, subtitle: `${d.discipline} · ${d.pages} pages`, path: '/app/plans' });
  }
  for (const a of ASSETS) {
    add(rank(`${a.assetNumber} ${a.name} ${a.make} ${a.model}`, q),
      { kind: 'asset', id: a.id, title: `${a.assetNumber} — ${a.name}`, subtitle: `${a.make} ${a.model}`, path: '/app/fleet' });
  }
  for (const e of EMPLOYEES) {
    add(rank(`${e.name} ${e.classification}`, q),
      { kind: 'employee', id: e.id, title: e.name, subtitle: e.classification, path: '/app/workforce' });
  }
  for (const p of PURCHASE_ORDERS) {
    add(rank(`${p.number} ${p.title} ${p.vendor}`, q),
      { kind: 'purchase_order', id: p.id, title: `${p.number} — ${p.title}`, subtitle: p.vendor, path: '/app/procurement' });
  }

  return hits.sort((a, b) => b.r - a.r || a.title.localeCompare(b.title)).slice(0, limit);
}

export async function search(query: string, limit = 12): Promise<SearchHit[]> {
  if (query.trim().length < 2) return [];

  if (supabase) {
    const { data, error } = await supabase.rpc('search', { p_query: query, p_limit: limit });
    if (!error && Array.isArray(data)) {
      // The RPC's row shape is not statically known here, so each field is
      // coerced rather than trusted — a malformed row becomes a harmless entry
      // instead of a runtime crash in the dropdown.
      return data
        .map((r: Record<string, unknown>): SearchHit => ({
          kind: String(r.kind ?? 'document') as SearchHit['kind'],
          id: String(r.id ?? ''),
          title: String(r.title ?? ''),
          subtitle: String(r.subtitle ?? ''),
          path: String(r.path ?? '/app'),
        }))
        .filter((h) => h.id !== '' && h.title !== '');
    }
    // Fall through to the demo dataset if the RPC is unavailable, rather than
    // showing the user an empty result that looks like "nothing matched".
  }

  return searchDemo(query, limit);
}

export const KIND_LABEL: Record<SearchHit['kind'], string> = {
  estimate: 'Estimate', project: 'Project', customer: 'Customer',
  document: 'Document', service: 'Service', sheet: 'Sheet',
  asset: 'Asset', employee: 'Employee', purchase_order: 'Purchase order',
};
