-- =============================================================================
-- 0229 — A form that asks what you need to know
--
-- 0065 built the intake and this session put a door on it, and the owner asked
-- the first question anybody asks of a form: is it editable, does it have
-- dropdowns. Both answers were no.
--
-- Seven fields were written into the page and into the pasted snippet — name,
-- company, email, phone, city, state, "what do you need?" — and there was no
-- way to add an eighth, rename one, make one required, or offer a choice
-- instead of a blank box. An excavating company's first question is almost
-- always "what kind of work", and the answer to that is a list, not a sentence.
--
-- Worse, and the older defect: `lead_intake_forms` has carried `redirect_url`,
-- `max_per_hour_per_form` and `max_per_hour_per_address` since 0065 and nothing
-- has ever written one. A published form could be switched off and nothing
-- else. Three columns with no writer is the same shape as a function with no
-- caller, one layer down.
--
-- So: questions a company writes, choices a company adds, both editable after
-- the form is live, and a form whose own settings can be changed.
--
-- Four refusals, and they are the whole design:
--
--   * **A question the form does not ask is refused, never ignored.** Answers
--     arrive as jsonb keyed by question id. An unrecognized key is the mistake
--     0136 and 0139 settled — a key that matches nothing looks exactly like a
--     key that matched, and the sender is told "thank you" either way.
--   * **An answer that is not one of the choices is refused.** A select whose
--     value is free text is a text box wearing a costume, and it is how a
--     library ends up with four spellings of "grading".
--   * **A required question with no answer is refused**, in the database. A
--     `required` attribute in the browser is a suggestion; the snippet runs on
--     somebody else's website and can be edited by anybody who can view source.
--   * **The question is frozen onto the answer.** `lead_answers.label` stores
--     the question as it was asked. Rename "What kind of work?" to "Scope" next
--     spring and last month's leads still read correctly — an answer whose
--     question has changed underneath it is a record that quietly became false.
--
-- ENTITY.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What a form asks
-- -----------------------------------------------------------------------------
create table if not exists lead_form_questions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  form_id     uuid not null references lead_intake_forms(id) on delete cascade,
  label       text not null check (length(btrim(label)) between 1 and 200),
  help_text   text check (help_text is null or length(help_text) <= 500),
  /*
   * Deliberately short. Every kind here is something a person filling in a form
   * on a phone can answer and something a company can read back without
   * interpretation. A file upload is absent on purpose: it would make an
   * unauthenticated stranger a writer to storage.
   */
  kind        text not null default 'text'
                check (kind in ('text', 'long_text', 'email', 'phone',
                                'number', 'date', 'select', 'multi_select')),
  is_required boolean not null default false,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists lead_form_questions_form_idx
  on lead_form_questions(form_id, sort_order);

-- One name for one thing, per form. A second "What kind of work?" differing
-- only by case is a duplicate, and two of them produce two columns of the same
-- answer that nobody can reconcile later.
create unique index if not exists lead_form_questions_one_name_idx
  on lead_form_questions(form_id, lower(btrim(label))) where is_active;

comment on table lead_form_questions is
  'A question one lead form asks, beyond the six a form always asks. ENTITY. Kept beside the form rather than on it so a question can be renamed, reordered, required or retired without touching the form''s public key or the leads it has already taken.';

alter table lead_form_questions enable row level security;
alter table lead_form_questions force row level security;

create policy lead_form_questions_select on lead_form_questions for select to authenticated
  using (app.has_permission(company_id, 'crm.read'));
create policy lead_form_questions_write on lead_form_questions for all to authenticated
  using (app.has_permission(company_id, 'crm.write'))
  with check (app.has_permission(company_id, 'crm.write'));

grant select, insert, update, delete on lead_form_questions to authenticated;
-- A visitor never selects from this table. The definer reader below hands them
-- the questions and nothing else, exactly as `submit_lead` reads the form.
revoke all on lead_form_questions from anon;

select app.attach_standard_triggers('public.lead_form_questions'::regclass);
select app.guard_suspension('lead_form_questions');

-- -----------------------------------------------------------------------------
-- What a question offers
-- -----------------------------------------------------------------------------
create table if not exists lead_form_choices (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  question_id uuid not null references lead_form_questions(id) on delete cascade,
  label       text not null check (length(btrim(label)) between 1 and 160),
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists lead_form_choices_question_idx
  on lead_form_choices(question_id, sort_order);
create unique index if not exists lead_form_choices_one_name_idx
  on lead_form_choices(question_id, lower(btrim(label))) where is_active;

comment on table lead_form_choices is
  'One option on a lead form question that offers choices. ENTITY. The list is the company''s own and is added to from the screen, which is the standing rule for every list in this platform.';

alter table lead_form_choices enable row level security;
alter table lead_form_choices force row level security;

create policy lead_form_choices_select on lead_form_choices for select to authenticated
  using (app.has_permission(company_id, 'crm.read'));
create policy lead_form_choices_write on lead_form_choices for all to authenticated
  using (app.has_permission(company_id, 'crm.write'))
  with check (app.has_permission(company_id, 'crm.write'));

grant select, insert, update, delete on lead_form_choices to authenticated;
revoke all on lead_form_choices from anon;

select app.attach_standard_triggers('public.lead_form_choices'::regclass);
select app.guard_suspension('lead_form_choices');

-- -----------------------------------------------------------------------------
-- What came back
-- -----------------------------------------------------------------------------
create table if not exists lead_answers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  lead_id     uuid not null references leads(id) on delete cascade,
  /* Null when the question is later deleted. The answer survives it, because
     the label below says what was asked. */
  question_id uuid references lead_form_questions(id) on delete set null,
  label       text not null,
  answer      text not null check (length(answer) <= 4000),
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists lead_answers_lead_idx on lead_answers(lead_id, sort_order);

comment on table lead_answers is
  'What a stranger answered to a company''s own question on a lead form. ENTITY.';

comment on column lead_answers.label is
  'The question as it was asked, copied at the moment of answering. Renaming the question later does not rewrite what this person was actually asked, which is the difference between a record and a guess.';

alter table lead_answers enable row level security;
alter table lead_answers force row level security;

create policy lead_answers_select on lead_answers for select to authenticated
  using (app.has_permission(company_id, 'crm.read'));
create policy lead_answers_write on lead_answers for all to authenticated
  using (app.has_permission(company_id, 'crm.write'))
  with check (app.has_permission(company_id, 'crm.write'));

grant select, insert, update, delete on lead_answers to authenticated;
revoke all on lead_answers from anon;

select app.attach_standard_triggers('public.lead_answers'::regclass);
select app.guard_suspension('lead_answers');

-- -----------------------------------------------------------------------------
-- Doors
-- -----------------------------------------------------------------------------
/** The form a caller may change, or a refusal. */
create or replace function app.lead_form_for_write(p_form uuid)
returns lead_intake_forms
language plpgsql stable security invoker set search_path = public, pg_catalog
as $$
declare
  v_form lead_intake_forms%rowtype;
begin
  select * into v_form from lead_intake_forms where id = p_form;
  if not found then
    raise exception 'No such form' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_form.company_id, 'crm.write');
  return v_form;
end;
$$;

/**
 * Change a published form.
 *
 * Every argument defaults to null and null means "leave it", which is the
 * `coalesce` shape that hid a bug once already: a key that matches nothing
 * reads exactly like a value that was left alone, and the call returns success
 * either way. So the redirect gets its own explicit flag rather than being
 * cleared by passing null, and the function returns what it wrote instead of a
 * bare boolean — a caller can compare what it sent with what came back.
 */
create or replace function app.set_lead_form(
  p_form             uuid,
  p_name             text default null,
  p_source           text default null,
  p_max_per_form     int  default null,
  p_max_per_address  int  default null,
  p_redirect         text default null,
  p_clear_redirect   boolean default false)
returns lead_intake_forms
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_form lead_intake_forms%rowtype := app.lead_form_for_write(p_form);
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_src  text := nullif(btrim(coalesce(p_source, '')), '');
  v_url  text := nullif(btrim(coalesce(p_redirect, '')), '');
begin
  if p_name is not null and v_name is null then
    raise exception 'A form needs a name you will recognize'
      using errcode = 'check_violation',
            hint = 'The page it sits on: "Contact page", "Estimate request".';
  end if;

  /*
   * A source that is not on the company's own list is refused rather than
   * quietly creating a fourth spelling of "website" — the same rule the sources
   * table on this screen already states in words.
   */
  if v_src is not null
     and not exists (select 1 from my_lead_sources s
                      where lower(btrim(s.name)) = lower(v_src)) then
    raise exception 'There is no lead source called %', v_src
      using errcode = 'check_violation',
            hint = 'Add it to your sources first, then file the form under it.';
  end if;

  -- Only http and https reach a browser, and a redirect somewhere else is a
  -- link the company cannot see the far end of.
  if v_url is not null and v_url !~* '^https?://[^[:space:]]+$' then
    raise exception 'A redirect is a web address beginning http:// or https://'
      using errcode = 'check_violation';
  end if;

  update lead_intake_forms f
     set name = coalesce(v_name, f.name),
         source_label = coalesce(v_src, f.source_label),
         max_per_hour_per_form = coalesce(p_max_per_form, f.max_per_hour_per_form),
         max_per_hour_per_address = coalesce(p_max_per_address, f.max_per_hour_per_address),
         redirect_url = case when p_clear_redirect then null
                             else coalesce(v_url, f.redirect_url) end,
         updated_at = now()
   where f.id = v_form.id
  returning * into v_form;

  return v_form;
end;
$$;

comment on function app.set_lead_form(uuid, text, text, int, int, text, boolean) is
  'Changes a published lead form: its name, the source its leads are filed under, its two rate ceilings and where a sender is sent afterwards. Those last three have been columns since 0065 with nothing that wrote them. ENTITY.';

/** Ask something of your own. */
create or replace function app.add_lead_form_question(
  p_form     uuid,
  p_label    text,
  p_kind     text default 'text',
  p_required boolean default false,
  p_help     text default null,
  p_choices  text[] default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_form  lead_intake_forms%rowtype := app.lead_form_for_write(p_form);
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_next  int;
  v_id    uuid;
  v_choice text;
  v_n     int := 0;
begin
  if v_label is null then
    raise exception 'A question needs to be asked in words'
      using errcode = 'check_violation',
            hint = 'What you want to know: "What kind of work?", "When do you need it started?".';
  end if;

  if p_kind in ('select', 'multi_select')
     and coalesce(array_length(p_choices, 1), 0) = 0 then
    raise exception 'A choice with nothing to choose from is a blank box'
      using errcode = 'check_violation',
            hint = 'Give it the options, or ask it as a text question instead.';
  end if;

  if p_kind not in ('select', 'multi_select') and p_choices is not null then
    raise exception 'Only a choice question has options; % does not', p_kind
      using errcode = 'check_violation';
  end if;

  select coalesce(max(q.sort_order), 0) + 10 into v_next
    from lead_form_questions q where q.form_id = v_form.id;

  insert into lead_form_questions (
    company_id, form_id, label, kind, is_required, help_text, sort_order)
  values (
    v_form.company_id, v_form.id, v_label, p_kind, coalesce(p_required, false),
    nullif(btrim(coalesce(p_help, '')), ''), coalesce(v_next, 10))
  returning id into v_id;

  foreach v_choice in array coalesce(p_choices, array[]::text[]) loop
    if nullif(btrim(v_choice), '') is not null then
      v_n := v_n + 10;
      insert into lead_form_choices (company_id, question_id, label, sort_order)
      values (v_form.company_id, v_id, btrim(v_choice), v_n)
      on conflict do nothing;
    end if;
  end loop;

  return v_id;
end;
$$;

comment on function app.add_lead_form_question(uuid, text, text, boolean, text, text[]) is
  'Adds a question to a lead form, with its options when it offers a choice. ENTITY.';

/** Change one, in place, where it is shown. */
create or replace function app.set_lead_form_question(
  p_question uuid,
  p_label    text default null,
  p_required boolean default null,
  p_help     text default null,
  p_sort     int default null,
  p_active   boolean default null)
returns lead_form_questions
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_q     lead_form_questions%rowtype;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  select * into v_q from lead_form_questions where id = p_question;
  if not found then
    raise exception 'No such question' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_q.company_id, 'crm.write');

  if p_label is not null and v_label is null then
    raise exception 'A question needs to be asked in words'
      using errcode = 'check_violation';
  end if;

  update lead_form_questions q
     set label = coalesce(v_label, q.label),
         is_required = coalesce(p_required, q.is_required),
         help_text = case when p_help is null then q.help_text
                          else nullif(btrim(p_help), '') end,
         sort_order = coalesce(p_sort, q.sort_order),
         is_active = coalesce(p_active, q.is_active),
         updated_at = now()
   where q.id = p_question
  returning * into v_q;

  return v_q;
end;
$$;

comment on function app.set_lead_form_question(uuid, text, boolean, text, int, boolean) is
  'Renames a question, requires it, moves it or retires it. Retired rather than deleted: the leads it already produced still point at it. ENTITY.';

/** One more option on a choice, because the list is the company's own. */
create or replace function app.add_lead_form_choice(p_question uuid, p_label text)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_q     lead_form_questions%rowtype;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_next  int;
  v_id    uuid;
begin
  select * into v_q from lead_form_questions where id = p_question;
  if not found then
    raise exception 'No such question' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_q.company_id, 'crm.write');

  if v_label is null then
    raise exception 'An option needs a name' using errcode = 'check_violation';
  end if;
  if v_q.kind not in ('select', 'multi_select') then
    raise exception 'That question is not a choice, so it has nothing to offer'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from lead_form_choices c
              where c.question_id = p_question and c.is_active
                and lower(btrim(c.label)) = lower(v_label)) then
    raise exception 'That question already offers %', v_label
      using errcode = 'unique_violation';
  end if;

  select coalesce(max(c.sort_order), 0) + 10 into v_next
    from lead_form_choices c where c.question_id = p_question;

  insert into lead_form_choices (company_id, question_id, label, sort_order)
  values (v_q.company_id, p_question, v_label, coalesce(v_next, 10))
  returning id into v_id;

  return v_id;
end;
$$;

/** Take one away, or put it back. */
create or replace function app.set_lead_form_choice(
  p_choice uuid, p_label text default null, p_active boolean default null)
returns lead_form_choices
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_c     lead_form_choices%rowtype;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  select * into v_c from lead_form_choices where id = p_choice;
  if not found then
    raise exception 'No such option' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_c.company_id, 'crm.write');

  update lead_form_choices c
     set label = coalesce(v_label, c.label),
         is_active = coalesce(p_active, c.is_active),
         updated_at = now()
   where c.id = p_choice
  returning * into v_c;

  return v_c;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reachable from a browser
--
-- The form has to know what it is asking before anybody can answer it, and the
-- page asking is on somebody else's website. So one more definer wrapper in
-- `public`, on the same terms as `submit_lead`: `anon` keeps no USAGE on `app`
-- and selects from no table, and this hands back a form's own questions and
-- nothing else — no company, no name, no count, nothing that says who owns it.
-- An unknown or switched-off key returns no rows rather than an error, which is
-- the same answer a form with no questions gives.
-- -----------------------------------------------------------------------------
create or replace function public.lead_form_questions(p_key text)
returns table (
  id uuid, label text, help_text text, kind text,
  is_required boolean, sort_order int, choices text[])
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select q.id, q.label, q.help_text, q.kind, q.is_required, q.sort_order,
         coalesce(
           (select array_agg(c.label order by c.sort_order, c.label)
              from lead_form_choices c
             where c.question_id = q.id and c.is_active),
           array[]::text[])
    from lead_form_questions q
    join lead_intake_forms f on f.id = q.form_id
   where f.public_key = p_key and f.is_active and q.is_active
   order by q.sort_order, q.label;
$$;

revoke all on function public.lead_form_questions(text) from public;
grant execute on function public.lead_form_questions(text) to anon, authenticated;

comment on function public.lead_form_questions(text) is
  'The questions one lead form asks, for a page on somebody else''s website to render. Returns nothing at all for a key that never existed, a key that was replaced and a form that was switched off, so it cannot be used to discover which companies are here.';

-- -----------------------------------------------------------------------------
-- Answering them
--
-- `submit_lead` gains a tenth argument. The nine-argument versions are dropped
-- rather than left beside it: two functions differing only by a trailing
-- defaulted argument are ambiguous to every named call, which is what 0223 had
-- to undo for `set_material`. Dropping is safe for snippets already pasted into
-- a website — they send eight arguments by name, and the new function accepts
-- exactly those.
-- -----------------------------------------------------------------------------
drop function if exists public.submit_lead(text, text, text, text, text, text, text, text, text);
drop function if exists app.submit_lead(text, text, text, text, text, text, text, text, text);

create or replace function app.submit_lead(
  p_key         text,
  p_company_name text,
  p_contact_name text default null,
  p_email       text default null,
  p_phone       text default null,
  p_description text default null,
  p_city        text default null,
  p_state       text default null,
  -- A field a person never fills in and a robot always does.
  p_trap        text default null,
  -- What the company's own questions were answered with, keyed by question id.
  p_answers     jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_form lead_intake_forms%rowtype;
  v_ip   inet;
  v_ua   text;
  v_from_form int;
  v_from_ip   int;
  v_lead uuid;
  v_unknown text[];
  v_missing text[];
  v_q    record;
  v_raw  jsonb;
  v_vals text[];
  v_one  text;
  v_ok   text[];
  v_bad  text[];
begin
  /*
   * A robot filling the hidden field is answered exactly like a success. Told
   * "rejected", it adapts; told "thank you", it moves on.
   */
  if p_trap is not null and length(trim(p_trap)) > 0 then
    return true;
  end if;

  if p_company_name is null or length(trim(p_company_name)) < 2 then
    raise exception 'Tell us who you are' using errcode = 'check_violation';
  end if;

  -- Something to reply to, or there is no lead — only a note.
  if coalesce(nullif(trim(p_email), ''), nullif(trim(p_phone), '')) is null then
    raise exception 'Leave an email address or a phone number so we can reply'
      using errcode = 'check_violation';
  end if;

  select * into v_form from lead_intake_forms
  where public_key = p_key and is_active;
  if not found then
    -- Deliberately the same answer for a key that never existed, a key that was
    -- replaced, and a form that was switched off.
    raise exception 'That form is not available' using errcode = 'no_data_found';
  end if;

  if p_answers is not null and jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers arrive as an object keyed by question'
      using errcode = 'check_violation';
  end if;

  /*
   * A key that names no question of this form is refused, never ignored. An
   * ignored key looks exactly like an accepted one from the sending end — the
   * mistake 0136 and 0139 settled for jsonb field names, and the reason a form
   * that silently drops an answer is worse than one that refuses it.
   */
  select array_agg(k) into v_unknown
    from jsonb_object_keys(coalesce(p_answers, '{}'::jsonb)) k
   where k !~ '^[0-9a-fA-F-]{36}$'
      or not exists (select 1 from lead_form_questions q
                      where q.id = k::uuid and q.form_id = v_form.id and q.is_active);
  if v_unknown is not null then
    raise exception 'This form does not ask %', array_to_string(v_unknown, ', ')
      using errcode = 'check_violation',
            hint = 'An answer to a question that is not asked would be stored where nobody looks.';
  end if;

  /*
   * A required question is checked before anything is written, and in the
   * database rather than in the browser: the snippet runs on a page anybody can
   * view the source of, so `required` out there is a courtesy, not a rule.
   */
  select array_agg(q.label order by q.sort_order, q.label) into v_missing
    from lead_form_questions q
   where q.form_id = v_form.id and q.is_active and q.is_required
     and not coalesce(
           case jsonb_typeof(coalesce(p_answers, '{}'::jsonb) -> q.id::text)
             when 'array' then exists (
               select 1 from jsonb_array_elements_text(
                              coalesce(p_answers, '{}'::jsonb) -> q.id::text) e
                where nullif(btrim(e), '') is not null)
             when 'string' then nullif(btrim(
               (coalesce(p_answers, '{}'::jsonb) -> q.id::text) #>> '{}'), '') is not null
             when 'number' then true
             else false
           end, false);
  if v_missing is not null then
    raise exception 'Answer % before sending', array_to_string(v_missing, ', ')
      using errcode = 'check_violation';
  end if;

  select ip_address, user_agent into v_ip, v_ua from app.request_context();

  select count(*) into v_from_form from leads
  where intake_form_id = v_form.id and submitted_at > now() - interval '1 hour';
  if v_from_form >= v_form.max_per_hour_per_form then
    raise exception 'This form has taken too many submissions in the last hour'
      using errcode = 'too_many_connections';
  end if;

  if v_ip is not null then
    select count(*) into v_from_ip from leads
    where intake_form_id = v_form.id and submitted_ip = v_ip
      and submitted_at > now() - interval '1 hour';
    if v_from_ip >= v_form.max_per_hour_per_address then
      raise exception 'Too many submissions from this address. Try again later'
        using errcode = 'too_many_connections';
    end if;
  end if;

  /*
   * Everything a stranger typed is a claim. The lead lands unqualified, with no
   * assignee, no value and no score — a person decides those after speaking to
   * them, and prefilling any of it would put a stranger's guess into a
   * company's pipeline as though it were the company's own judgment.
   */
  insert into leads (
    company_id, source, company_name, contact_name, email, phone,
    project_description, city, state_province, stage,
    intake_form_id, submitted_ip, submitted_user_agent, submitted_at)
  values (
    v_form.company_id, v_form.source_label,
    left(trim(p_company_name), 200),
    left(nullif(trim(p_contact_name), ''), 200),
    left(nullif(trim(p_email), ''), 320),
    left(nullif(trim(p_phone), ''), 50),
    left(nullif(trim(p_description), ''), 4000),
    left(nullif(trim(p_city), ''), 120),
    left(nullif(trim(p_state), ''), 120),
    'new',
    v_form.id, v_ip, left(v_ua, 500), now())
  returning id into v_lead;

  for v_q in
    select q.id, q.label, q.kind, q.is_required, q.sort_order
      from lead_form_questions q
     where q.form_id = v_form.id and q.is_active
     order by q.sort_order, q.label
  loop
    v_raw := coalesce(p_answers, '{}'::jsonb) -> v_q.id::text;

    -- One answer or several, from a string or from an array, so a multi-select
    -- and a select are answered in the shape each naturally has.
    if v_raw is null or jsonb_typeof(v_raw) = 'null' then
      v_vals := array[]::text[];
    elsif jsonb_typeof(v_raw) = 'array' then
      select coalesce(array_agg(btrim(e)) filter (where nullif(btrim(e), '') is not null),
                      array[]::text[])
        into v_vals from jsonb_array_elements_text(v_raw) e;
    else
      v_vals := case when nullif(btrim(v_raw #>> '{}'), '') is null
                     then array[]::text[] else array[btrim(v_raw #>> '{}')] end;
    end if;

    if cardinality(v_vals) = 0 then
      continue;
    end if;

    if v_q.kind not in ('select', 'multi_select') then
      insert into lead_answers (company_id, lead_id, question_id, label, answer, sort_order)
      values (v_form.company_id, v_lead, v_q.id, v_q.label,
              left(array_to_string(v_vals, ', '), 4000), v_q.sort_order);
      continue;
    end if;

    if v_q.kind = 'select' and cardinality(v_vals) > 1 then
      raise exception '% takes one answer, not %', v_q.label, cardinality(v_vals)
        using errcode = 'check_violation';
    end if;

    /*
     * An answer that is not one of the offered choices is refused, and the
     * company's own spelling is what gets stored. A select whose value is free
     * text is a text box wearing a costume, and the snippet runs on a page
     * anybody can edit — so this is checked here rather than in the browser,
     * where a check is only a suggestion.
     */
    v_ok := array[]::text[];
    v_bad := array[]::text[];
    foreach v_one in array v_vals loop
      declare v_canon text;
      begin
        select c.label into v_canon from lead_form_choices c
         where c.question_id = v_q.id and c.is_active
           and lower(btrim(c.label)) = lower(v_one)
         limit 1;
        if v_canon is null then
          v_bad := v_bad || v_one;
        else
          v_ok := v_ok || v_canon;
        end if;
      end;
    end loop;

    if cardinality(v_bad) > 0 then
      raise exception '% is not one of the choices for %',
        array_to_string(v_bad, ', '), v_q.label
        using errcode = 'check_violation';
    end if;

    insert into lead_answers (company_id, lead_id, question_id, label, answer, sort_order)
    values (v_form.company_id, v_lead, v_q.id, v_q.label,
            left(array_to_string(v_ok, ', '), 4000), v_q.sort_order);
  end loop;

  return true;
end;
$$;

revoke all on function app.submit_lead(text, text, text, text, text, text, text, text, text, jsonb) from public;
grant execute on function app.submit_lead(text, text, text, text, text, text, text, text, text, jsonb)
  to anon, authenticated;

comment on function app.submit_lead(text, text, text, text, text, text, text, text, text, jsonb) is
  'The only function anon may execute that writes. Accepts a lead for the company a form belongs to, rate limited per form and per address, with an unknown key and a disabled form answering identically so the platform is not an oracle for which companies exist. A question the form does not ask is refused rather than ignored, and a choice that is not offered is refused rather than stored.';

create or replace function public.submit_lead(
  p_key text, p_company_name text, p_contact_name text default null,
  p_email text default null, p_phone text default null, p_description text default null,
  p_city text default null, p_state text default null, p_trap text default null,
  p_answers jsonb default null)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  return app.submit_lead(p_key, p_company_name, p_contact_name, p_email, p_phone,
                         p_description, p_city, p_state, p_trap, p_answers);
end;
$$;

revoke all on function public.submit_lead(text, text, text, text, text, text, text, text, text, jsonb) from public;
grant execute on function public.submit_lead(text, text, text, text, text, text, text, text, text, jsonb)
  to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Readers, so none of this is a write with nowhere to land
-- -----------------------------------------------------------------------------
create or replace view my_lead_form_questions
with (security_invoker = true) as
select q.id, q.company_id, q.form_id, q.label, q.help_text, q.kind,
       q.is_required, q.sort_order, q.is_active, q.created_at,
       coalesce(
         (select array_agg(c.label order by c.sort_order, c.label)
            from lead_form_choices c
           where c.question_id = q.id and c.is_active),
         array[]::text[]) as choices,
       coalesce((select count(*) from lead_answers a where a.question_id = q.id), 0)
         as answered_count
  from lead_form_questions q;

revoke all on my_lead_form_questions from public, anon;
grant select on my_lead_form_questions to authenticated, service_role;

create or replace view my_lead_answers
with (security_invoker = true) as
select a.id, a.company_id, a.lead_id, a.question_id, a.label, a.answer,
       a.sort_order, a.created_at
  from lead_answers a;

revoke all on my_lead_answers from public, anon;
grant select on my_lead_answers to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Public wrappers for the screen
-- -----------------------------------------------------------------------------
create or replace function public.set_lead_form(
  p_form uuid, p_name text default null, p_source text default null,
  p_max_per_form int default null, p_max_per_address int default null,
  p_redirect text default null, p_clear_redirect boolean default false)
returns lead_intake_forms language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_lead_form(p_form, p_name, p_source, p_max_per_form,
                               p_max_per_address, p_redirect, p_clear_redirect); $$;

create or replace function public.add_lead_form_question(
  p_form uuid, p_label text, p_kind text default 'text',
  p_required boolean default false, p_help text default null,
  p_choices text[] default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.add_lead_form_question(p_form, p_label, p_kind, p_required, p_help, p_choices); $$;

create or replace function public.set_lead_form_question(
  p_question uuid, p_label text default null, p_required boolean default null,
  p_help text default null, p_sort int default null, p_active boolean default null)
returns lead_form_questions language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_lead_form_question(p_question, p_label, p_required, p_help, p_sort, p_active); $$;

create or replace function public.add_lead_form_choice(p_question uuid, p_label text)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.add_lead_form_choice(p_question, p_label); $$;

create or replace function public.set_lead_form_choice(
  p_choice uuid, p_label text default null, p_active boolean default null)
returns lead_form_choices language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_lead_form_choice(p_choice, p_label, p_active); $$;

revoke all on function public.set_lead_form(uuid, text, text, int, int, text, boolean) from public, anon;
revoke all on function public.add_lead_form_question(uuid, text, text, boolean, text, text[]) from public, anon;
revoke all on function public.set_lead_form_question(uuid, text, boolean, text, int, boolean) from public, anon;
revoke all on function public.add_lead_form_choice(uuid, text) from public, anon;
revoke all on function public.set_lead_form_choice(uuid, text, boolean) from public, anon;

grant execute on function public.set_lead_form(uuid, text, text, int, int, text, boolean) to authenticated;
grant execute on function public.add_lead_form_question(uuid, text, text, boolean, text, text[]) to authenticated;
grant execute on function public.set_lead_form_question(uuid, text, boolean, text, int, boolean) to authenticated;
grant execute on function public.add_lead_form_choice(uuid, text) to authenticated;
grant execute on function public.set_lead_form_choice(uuid, text, boolean) to authenticated;

select app.assert_security_gates();
