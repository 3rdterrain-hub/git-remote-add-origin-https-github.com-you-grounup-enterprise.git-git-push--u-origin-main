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
import { addCategory } from './categories';
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

/**
 * File a new source against the company.
 *
 * Through `addCategory`, not a second call to the same function: a lead source
 * is a library category like any other, and it is now renamed, counted and
 * removed by the same three doors as the rest (migration 0150). A private copy
 * here would be a place for the two to drift.
 */
export async function addLeadSource(companyId: string, name: string): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  await addCategory(supabase, { kind: 'lead_source', name, companyId });
}

export type LeadQuestionKind =
  'text' | 'long_text' | 'email' | 'phone' | 'number' | 'date' | 'select' | 'multi_select';

/** What each kind is called on screen, and what it gives the person answering. */
export const QUESTION_KINDS: ReadonlyArray<{ value: LeadQuestionKind; label: string }> = [
  { value: 'text', label: 'A short answer' },
  { value: 'long_text', label: 'A few sentences' },
  { value: 'select', label: 'Pick one' },
  { value: 'multi_select', label: 'Pick any number' },
  { value: 'number', label: 'A number' },
  { value: 'date', label: 'A date' },
  { value: 'email', label: 'An email address' },
  { value: 'phone', label: 'A phone number' },
];

export interface LeadFormQuestion {
  id: string;
  formId: string;
  label: string;
  helpText: string | null;
  kind: LeadQuestionKind;
  isRequired: boolean;
  sortOrder: number;
  isActive: boolean;
  choices: string[];
  /** How many leads have answered it. A question with answers is retired, never deleted. */
  answeredCount: number;
}

/** The questions one form asks, for the company that owns it. */
export const leadFormQuestions = (formId: string): Query<LeadFormQuestion[]> => async (client) => {
  const rows = unwrap(await client
    .from('my_lead_form_questions')
    .select('id, form_id, label, help_text, kind, is_required, sort_order, is_active, choices, answered_count')
    .eq('form_id', formId)
    .order('sort_order', { ascending: true })) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    formId: String(r.form_id),
    label: String(r.label),
    helpText: (r.help_text as string | null) ?? null,
    kind: String(r.kind) as LeadQuestionKind,
    isRequired: Boolean(r.is_required),
    sortOrder: Number(r.sort_order ?? 0),
    isActive: Boolean(r.is_active),
    choices: (r.choices as string[] | null) ?? [],
    answeredCount: Number(r.answered_count ?? 0),
  }));
};

/**
 * The same questions, as a stranger sees them.
 *
 * A separate reader on purpose. `my_lead_form_questions` is a view behind RLS
 * and returns nothing at all to somebody with no session; this calls the one
 * definer function `anon` may execute, which is addressed by the form's public
 * key and answers an unknown key exactly like a switched-off form.
 */
export async function loadPublicQuestions(publicKey: string): Promise<LeadFormQuestion[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('lead_form_questions', { p_key: publicKey });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    formId: '',
    label: String(r.label),
    helpText: (r.help_text as string | null) ?? null,
    kind: String(r.kind) as LeadQuestionKind,
    isRequired: Boolean(r.is_required),
    sortOrder: Number(r.sort_order ?? 0),
    isActive: true,
    choices: (r.choices as string[] | null) ?? [],
    answeredCount: 0,
  }));
}

/** What a lead answered, for the CRM screen. */
export interface LeadAnswer {
  id: string;
  leadId: string;
  label: string;
  answer: string;
  sortOrder: number;
}

export const leadAnswers: Query<LeadAnswer[]> = async (client) => {
  const rows = unwrap(await client
    .from('my_lead_answers')
    .select('id, lead_id, label, answer, sort_order')
    .order('sort_order', { ascending: true })) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    leadId: String(r.lead_id),
    label: String(r.label),
    answer: String(r.answer),
    sortOrder: Number(r.sort_order ?? 0),
  }));
};

export interface LeadFormChoice {
  id: string;
  questionId: string;
  label: string;
  sortOrder: number;
}

/** The options on one question, with their ids, so each can be changed in place. */
export const leadFormChoices = (questionId: string): Query<LeadFormChoice[]> => async (client) => {
  const rows = unwrap(await client
    .from('lead_form_choices')
    .select('id, question_id, label, sort_order')
    .eq('question_id', questionId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    questionId: String(r.question_id),
    label: String(r.label),
    sortOrder: Number(r.sort_order ?? 0),
  }));
};

/**
 * Change a form that is already live.
 *
 * Null means "leave it", which is why clearing the redirect takes its own flag
 * rather than being expressed by passing nothing — the two would be
 * indistinguishable, and a call that silently did nothing would report success.
 */
export async function setLeadForm(formId: string, change: {
  name?: string;
  sourceLabel?: string;
  maxPerHourPerForm?: number;
  maxPerHourPerAddress?: number;
  redirectUrl?: string;
  clearRedirect?: boolean;
}): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('set_lead_form', {
    p_form: formId,
    p_name: change.name ?? null,
    p_source: change.sourceLabel ?? null,
    p_max_per_form: change.maxPerHourPerForm ?? null,
    p_max_per_address: change.maxPerHourPerAddress ?? null,
    p_redirect: change.redirectUrl ?? null,
    p_clear_redirect: change.clearRedirect ?? false,
  });
  if (error) throw new Error(error.message);
}

export async function addLeadFormQuestion(formId: string, question: {
  label: string;
  kind: LeadQuestionKind;
  isRequired: boolean;
  helpText?: string | null;
  choices?: string[] | null;
}): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('add_lead_form_question', {
    p_form: formId,
    p_label: question.label,
    p_kind: question.kind,
    p_required: question.isRequired,
    p_help: question.helpText ?? null,
    p_choices: question.choices && question.choices.length > 0 ? question.choices : null,
  });
  if (error) throw new Error(error.message);
}

export async function setLeadFormQuestion(questionId: string, change: {
  label?: string;
  isRequired?: boolean;
  helpText?: string;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('set_lead_form_question', {
    p_question: questionId,
    p_label: change.label ?? null,
    p_required: change.isRequired ?? null,
    p_help: change.helpText ?? null,
    p_sort: change.sortOrder ?? null,
    p_active: change.isActive ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function addLeadFormChoice(questionId: string, label: string): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('add_lead_form_choice', {
    p_question: questionId, p_label: label,
  });
  if (error) throw new Error(error.message);
}

export async function setLeadFormChoice(
  choiceId: string, change: { label?: string; isActive?: boolean },
): Promise<void> {
  if (!supabase) throw new Error('No workspace is configured.');
  const { error } = await supabase.rpc('set_lead_form_choice', {
    p_choice: choiceId, p_label: change.label ?? null, p_active: change.isActive ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Where a submission is posted: the one function a stranger may call. */
export const intakeUrl = (): string =>
  (supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/submit_lead` : '');

/**
 * Send a lead, as a stranger.
 *
 * The only write in this platform an unauthenticated visitor may perform, and
 * it deliberately tells the sender nothing back: `submit_lead` returns a bare
 * boolean, `anon` may select from no table, and a key that never existed
 * answers exactly like one that was switched off. A form that confirmed what it
 * stored would be a form that could be used to read what other people stored.
 *
 * `trap` is the honeypot migration 0065 reads — hidden from people, filled in
 * by robots, and answered like a success so a robot moves on instead of
 * adapting. It is passed straight through rather than checked here, because a
 * check in the browser is a suggestion.
 */
export async function submitLead(publicKey: string, entry: {
  companyName: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  description?: string | null;
  city?: string | null;
  state?: string | null;
  trap?: string | null;
  /**
   * The company's own questions, keyed by question id. Sent whole rather than
   * filtered here: a key this form does not ask is refused by the database, and
   * a browser that quietly dropped it would hide the mistake from both ends.
   */
  answers?: Record<string, string | string[]> | null;
}): Promise<void> {
  if (!supabase) throw new Error('This form is not connected to a workspace.');
  const { error } = await supabase.rpc('submit_lead', {
    p_key: publicKey,
    p_company_name: entry.companyName,
    p_contact_name: entry.contactName ?? null,
    p_email: entry.email ?? null,
    p_phone: entry.phone ?? null,
    p_description: entry.description ?? null,
    p_city: entry.city ?? null,
    p_state: entry.state ?? null,
    p_trap: entry.trap ?? null,
    p_answers: entry.answers && Object.keys(entry.answers).length > 0 ? entry.answers : null,
  });
  if (error) throw new Error(error.message);
}

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
function questionField(q: LeadFormQuestion): string {
  const id = escapeHtml(q.id);
  const label = escapeHtml(q.label) + (q.isRequired ? ' *' : '');
  const help = q.helpText
    ? `\n    <small>${escapeHtml(q.helpText)}</small><br>` : '';
  const required = q.isRequired ? ' required' : '';
  const options = q.choices
    .map((c) => `\n      <option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
    .join('');

  if (q.kind === 'select') {
    return `  <label>${label}<br>${help}
    <select data-q="${id}"${required}>
      <option value=""></option>${options}
    </select>
  </label>`;
  }
  if (q.kind === 'multi_select') {
    return `  <label>${label}<br>${help}
    <select data-q="${id}" multiple size="${Math.min(6, Math.max(3, q.choices.length))}"${required}>${options}
    </select>
  </label>`;
  }
  if (q.kind === 'long_text') {
    return `  <label>${label}<br>${help}
    <textarea data-q="${id}" rows="3"${required}></textarea>
  </label>`;
  }
  const type = q.kind === 'email' ? 'email'
    : q.kind === 'phone' ? 'tel'
    : q.kind === 'number' ? 'number'
    : q.kind === 'date' ? 'date' : 'text';
  return `  <label>${label}<br>${help}
    <input type="${type}" data-q="${id}"${required}>
  </label>`;
}

export function embedSnippet(
  form: Pick<LeadIntakeForm, 'publicKey'>,
  url = intakeUrl(),
  anonKey = supabaseAnonKey ?? '',
  questions: readonly LeadFormQuestion[] = [],
): string {
  const asked = questions.filter((q) => q.isActive);
  const extra = asked.length === 0 ? '' : `\n\n${asked.map(questionField).join('\n')}`;
  /*
   * Collected by `data-q` rather than by name, because a question id is a uuid
   * and a form element named with one is legal but unreadable. A multi-select
   * sends an array; everything else sends what was typed.
   */
  const collect = asked.length === 0 ? '  var answers = null;' : `  var answers = (function () {
    var out = {};
    Array.prototype.forEach.call(form.querySelectorAll('[data-q]'), function (el) {
      if (el.multiple) {
        var picked = Array.prototype.filter.call(el.options, function (o) { return o.selected; })
          .map(function (o) { return o.value; });
        if (picked.length) out[el.getAttribute('data-q')] = picked;
      } else if (el.value) {
        out[el.getAttribute('data-q')] = el.value;
      }
    });
    return out;
  })();`;

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
  </label>${extra}

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

${collect}

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
        p_trap: value('trap'),
        p_answers: answers
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
