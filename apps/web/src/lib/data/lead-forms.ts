/**
 * The public lead form, from inside the application.
 *
 * Migration 0065 built the intake: a form has its own opaque key, a stranger
 * calls one function, a lead lands unqualified, rate limited per form and per
 * address. What it never had was a way for a contractor to *make* one, or to
 * see what a form had brought in. It was a working feature with no door.
 *
 * `embedSnippet` is the door, and it is the whole product here. It has to be
 * pasteable into a page builder by somebody who runs an excavating company, and
 * it must carry nothing but a form key and the anon key — both public by
 * design, neither granting any read. The anon key can call exactly one function
 * in the schema, `submit_lead`, and select from nothing; `check-bundle.mjs`
 * already says why it is safe to publish. The test beside this file holds the
 * snippet to that: no service key, no company id, no session, one endpoint.
 */
import { unwrap, type Query } from './query';
import { supabase, supabaseUrl, supabaseAnonKey } from '@/lib/supabase';

export interface LeadIntakeForm {
  id: string;
  companyId: string;
  name: string;
  publicKey: string;
  isActive: boolean;
  sourceLabel: string;
  maxPerHourPerForm: number;
  maxPerHourPerAddress: number;
  redirectUrl: string | null;
  createdAt: string;
  /** Counted from the leads themselves, which is where the truth is. */
  leadsTaken: number;
  lastLeadAt: string | null;
}

export interface LeadSource {
  id: string;
  name: string;
  description: string | null;
  isPlatform: boolean;
  leadsFromHere: number;
}

export const loadLeadIntakeForms: Query<LeadIntakeForm[]> = async (client) => {
  const rows = unwrap(await client
    .from('lead_intake_forms')
    .select('id, company_id, name, public_key, is_active, source_label,'
      + ' max_per_hour_per_form, max_per_hour_per_address, redirect_url, created_at,'
      + ' leads(count)')
    .order('created_at', { ascending: true })) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const counted = r.leads as Array<{ count: number }> | null;
    return {
      id: String(r.id),
      companyId: String(r.company_id),
      name: String(r.name),
      publicKey: String(r.public_key),
      isActive: Boolean(r.is_active),
      sourceLabel: String(r.source_label ?? 'Website'),
      maxPerHourPerForm: Number(r.max_per_hour_per_form ?? 60),
      maxPerHourPerAddress: Number(r.max_per_hour_per_address ?? 5),
      redirectUrl: (r.redirect_url as string | null) ?? null,
      createdAt: String(r.created_at),
      leadsTaken: Number(counted?.[0]?.count ?? 0),
      lastLeadAt: null,
    };
  });
};

export const loadLeadSources: Query<LeadSource[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_lead_sources')
    .select('id, name, description, is_platform, leads_from_here')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    description: (r.description as string | null) ?? null,
    isPlatform: Boolean(r.is_platform),
    leadsFromHere: Number(r.leads_from_here ?? 0),
  }));
};

export async function createLeadIntakeForm(
  companyId: string, name: string, sourceLabel: string,
): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.from('lead_intake_forms').insert({
    company_id: companyId, name, source_label: sourceLabel,
  });
  if (error) throw new Error(error.message);
}

/** Off rather than deleted: the leads it already brought in still point at it. */
export async function setLeadFormActive(formId: string, isActive: boolean): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.from('lead_intake_forms')
    .update({ is_active: isActive }).eq('id', formId);
  if (error) throw new Error(error.message);
}

/** File a new source against the company, through the same guard every library uses. */
export async function addLeadSource(companyId: string, name: string): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('add_library_category', {
    p_kind: 'lead_source', p_name: name, p_company: companyId,
  });
  if (error) throw new Error(error.message);
}

/** Where a submission is posted: the one function a stranger may call. */
export const intakeUrl = (): string =>
  (supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/submit_lead` : '');

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The snippet a contractor pastes into their own website.
 *
 * Everything about its shape is decided by who has to use it: somebody who runs
 * an excavating company and edits their site through a page builder. One block,
 * plain HTML and one small script, no build step, no dependency, nothing to
 * configure after pasting.
 *
 * The hidden `trap` field is the honeypot migration 0065 reads. A robot that
 * fills it is answered exactly like a success and nothing is written — told
 * "rejected" it adapts, told "thank you" it moves on.
 */
export function embedSnippet(
  form: Pick<LeadIntakeForm, 'publicKey'>,
  url = intakeUrl(),
  anonKey = supabaseAnonKey ?? '',
): string {
  return `<!-- GrounUp lead form. Paste anywhere on your site. -->
<form id="grounup-lead-form">
  <label>Your name<br>
    <input type="text" name="contact_name">
  </label>
  <label>Company or household name *<br>
    <input type="text" name="company_name" required minlength="2">
  </label>
  <label>Email<br>
    <input type="email" name="email">
  </label>
  <label>Phone<br>
    <input type="tel" name="phone">
  </label>
  <label>City<br>
    <input type="text" name="city">
  </label>
  <label>What do you need?<br>
    <textarea name="description" rows="4"></textarea>
  </label>

  <!-- Hidden from people, filled in by robots. Leave it exactly as it is. -->
  <div style="position:absolute;left:-5000px" aria-hidden="true">
    <input type="text" name="trap" tabindex="-1" autocomplete="off">
  </div>

  <button type="submit">Send</button>
  <p id="grounup-lead-done" style="display:none"></p>
</form>

<script>
(function () {
  var form = document.getElementById('grounup-lead-form');
  var done = document.getElementById('grounup-lead-done');
  var value = function (name) { return (form.elements[name] || {}).value || null; };

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    fetch(${JSON.stringify(url)}, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ${JSON.stringify(anonKey)}
      },
      body: JSON.stringify({
        p_key: ${JSON.stringify(escapeHtml(form.publicKey))},
        p_company_name: value('company_name'),
        p_contact_name: value('contact_name'),
        p_email: value('email'),
        p_phone: value('phone'),
        p_description: value('description'),
        p_city: value('city'),
        p_trap: value('trap')
      })
    })
      .then(function (r) { if (!r.ok) throw new Error('rejected'); })
      .then(function () {
        form.style.display = 'none';
        done.textContent = 'Thank you — we have your request and will be in touch.';
        done.style.display = 'block';
      })
      .catch(function () {
        done.textContent = 'Sorry, something went wrong. Please call us instead.';
        done.style.display = 'block';
      });
  });
})();
</script>`;
}
