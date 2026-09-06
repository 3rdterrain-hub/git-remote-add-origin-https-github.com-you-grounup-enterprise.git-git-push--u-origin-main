-- =============================================================================
-- 0112 — Starting from one you have built before
--
-- Two things live in this migration because they are the same thing.
--
-- **A copy that copies everything.** `app.revise_estimate_version` has existed
-- since migration 0011 and is described everywhere in this schema as the
-- sanctioned way to change an issued estimate — six other migrations point
-- callers at it by name. It copied the lines and dropped the crew, the
-- machines, the materials, the haul, the condition modifiers and their
-- justifications, and every markup on the bid. Everything a line costs money
-- for lived in `estimate_line_resources`, and a revision left the new version
-- holding descriptions and quantities with nothing under them.
--
-- Nobody wrote that on purpose. It happened because the copy named its columns
-- by hand in 2026 and the tables kept growing — migration 0107 alone added
-- twenty columns to the resource table, none of which an explicit list could
-- know about. So the fix is not a longer list. It is a copy that asks the
-- database what the columns are:
--
--   * `app.copyable_columns()` returns every column of a table except the ones
--     a copy must decide for itself — its own identity, its parent, its
--     timestamps, its author.
--   * `app.engine_output_columns()` reads the guard triggers from 0058 and
--     returns the columns the estimating engine owns, so nothing here holds a
--     second opinion about which numbers a person may not write.
--   * `app.copy_version_contents()` uses both, and copies lines, resources,
--     modifiers, indirects, exclusions, assumptions and markups.
--
-- A column added tomorrow is copied tomorrow, without anybody remembering.
--
-- **Templates.** Which is the same operation pointed at a different target: an
-- estimator who bids the same kind of job every week should not rebuild the
-- structure every week. A template is a captured version — its lines, the crew
-- and equipment on each line, the modifiers, the markups — stored as a payload
-- built from the very same column list the copy uses. The template cannot fall
-- behind the schema for the same reason the copy cannot.
--
-- Three decisions worth stating, because each one is a place a template could
-- quietly lie:
--
--   * **Quantities are not carried by default.** A template is the shape of a
--     job, not last job's takeoff. Carrying 4,200 cubic yards into a new bid
--     because that is what the last one held is the kind of number that gets
--     sent. It is an explicit opt-in, and the template records which it is.
--
--   * **No prices are carried at all.** The payload strips the engine's output
--     columns, so applying a template gives you an unpriced estimate that the
--     engine then prices against today's rates. A template that carried last
--     year's costs would look priced and be wrong.
--
--   * **A reference that no longer exists is dropped and reported.** A template
--     saved when the library held a material that has since been retired must
--     not fail, and must not silently attach a line to nothing. The reference
--     is cleared, the line is kept, and the caller is told which ones and why.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What a copy may carry
-- -----------------------------------------------------------------------------

/**
 * Every column of a table except the ones a copy must decide for itself.
 *
 * Identity, tenant, timestamps and authorship are always the copy's own; the
 * caller names anything else it is going to supply. Read from the catalog, so
 * a column added later is carried without anybody editing a list.
 */
create or replace function app.copyable_columns(
  p_table   regclass,
  p_exclude text[] default '{}')
returns text[]
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(a.attname::text order by a.attnum), '{}'::text[])
  from pg_attribute a
  where a.attrelid = p_table
    and a.attnum > 0
    and not a.attisdropped
    and a.attname <> all (
      array['id', 'company_id', 'created_at', 'updated_at', 'created_by']
      || coalesce(p_exclude, '{}'::text[]));
$$;

comment on function app.copyable_columns(regclass, text[]) is
  'The columns a copy of a row should carry, read from the catalog rather than named by hand. ENGINE support: this is what stops a copy falling behind the schema the way the 0011 revision did.';

/**
 * The columns the estimating engine owns on a table.
 *
 * Read out of the 0058 guard triggers themselves rather than restated here.
 * There is one definition of which numbers a person may not write, it lives in
 * the trigger, and this is a reading of it.
 */
create or replace function app.engine_output_columns(p_table regclass)
returns text[]
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(r.m[1] order by r.ord), '{}'::text[])
  from pg_trigger t
  cross join lateral regexp_matches(pg_get_triggerdef(t.oid), '''([a-z_]+)''', 'g')
             with ordinality as r(m, ord)
  where t.tgrelid = p_table
    and not t.tgisinternal
    and pg_get_triggerdef(t.oid) like '%guard_engine_outputs%';
$$;

comment on function app.engine_output_columns(regclass) is
  'The columns migration 0058 reserves for the estimating engine, read from the guard trigger. ENGINE support: a template that stripped a stale list would carry prices it should not.';

-- -----------------------------------------------------------------------------
-- One faithful copy
-- -----------------------------------------------------------------------------

/**
 * What a new estimate version must decide for itself.
 *
 * One list, read by the revision, by a template capture and by a template
 * application, because three copies of it would disagree within a year — which
 * is how `library_snapshot_id` came to be carried forward in the first draft of
 * this migration and pointed a fresh version at another version's snapshot.
 *
 * Each entry is a fact about the version it came from that would be a lie about
 * the new one: where it sits in the sequence, whether it was issued, who
 * approved it, which frozen library priced it, and a discount somebody signed
 * off on a price that no longer exists.
 */
create or replace function app.version_facts_not_carried_forward()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array[
    'estimate_id', 'version_number', 'status', 'revision_reason',
    'issued_at', 'issued_by', 'approved_at', 'approved_by',
    'library_snapshot_id', 'executive_decision_reason',
    'contingency_source', 'contingency_override_reason', 'contingency_approved_by',
    'discount_percent', 'discount_amount', 'discount_reason', 'discount_approved_by'];
$$;

comment on function app.version_facts_not_carried_forward() is
  'The estimate-version columns a copy must decide for itself rather than inherit. ENGINE support: one list, so a revision and a template cannot disagree about it.';

/**
 * Copy everything hanging off one estimate version onto another.
 *
 * `security invoker`, so row level security decides what the caller may read
 * and write; a copy cannot reach into another company's estimate because the
 * policies would refuse both halves. The company check below is a clearer
 * error for the case RLS would otherwise report as a missing row.
 *
 * Costs are not carried. The 0058 insert guard resets every engine-owned
 * column to its schema default, so the copied version arrives unpriced — which
 * is what it is, until the engine has run on it.
 */
create or replace function app.copy_version_contents(p_from uuid, p_to uuid)
returns int
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_from_company uuid;
  v_to_company   uuid;
  v_cols  text[];
  v_names text;
  v_srcs  text;
  v_map   jsonb;
  v_lines int := 0;
begin
  select company_id into v_from_company from estimate_versions where id = p_from;
  select company_id into v_to_company   from estimate_versions where id = p_to;
  if v_from_company is null or v_to_company is null then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;
  if v_from_company <> v_to_company then
    raise exception 'An estimate cannot be copied into another company''s estimate'
      using errcode = 'insufficient_privilege';
  end if;

  /*
   * New identities are minted up front so a child line can point at the copy
   * of its parent rather than the original. Both are inserted by one statement,
   * and PostgreSQL checks a foreign key at the end of the statement, so the
   * self-reference resolves without deferring anything.
   */
  select coalesce(jsonb_object_agg(s.id::text, gen_random_uuid()), '{}'::jsonb)
    into v_map
  from estimate_line_items s
  where s.estimate_version_id = p_from;

  if v_map = '{}'::jsonb then
    return 0;
  end if;

  v_cols := app.copyable_columns(
    'public.estimate_line_items'::regclass,
    array['estimate_version_id', 'parent_line_id', 'origin',
          'ai_agent_id', 'ai_accepted_by', 'ai_accepted_at']);
  select string_agg(quote_ident(c), ', '), string_agg('s.' || quote_ident(c), ', ')
    into v_names, v_srcs
  from unnest(v_cols) as c;

  execute format($f$
    insert into estimate_line_items (
      id, company_id, estimate_version_id, parent_line_id, origin, created_by, %s)
    select ($4 ->> s.id::text)::uuid, $2, $3,
           ($4 ->> s.parent_line_id::text)::uuid, 'copied', auth.uid(), %s
    from estimate_line_items s
    where s.estimate_version_id = $1
  $f$, v_names, v_srcs)
  using p_from, v_to_company, p_to, v_map;

  get diagnostics v_lines = row_count;

  -- The crew, machines, materials and haul. This is the half a revision lost.
  v_cols := app.copyable_columns(
    'public.estimate_line_resources'::regclass, array['line_item_id']);
  select string_agg(quote_ident(c), ', '), string_agg('r.' || quote_ident(c), ', ')
    into v_names, v_srcs
  from unnest(v_cols) as c;

  execute format($f$
    insert into estimate_line_resources (company_id, line_item_id, %s)
    select $2, ($3 ->> r.line_item_id::text)::uuid, %s
    from estimate_line_resources r
    join estimate_line_items s on s.id = r.line_item_id
    where s.estimate_version_id = $1
  $f$, v_names, v_srcs)
  using p_from, v_to_company, v_map;

  -- Condition modifiers, carrying the justification somebody wrote for them.
  v_cols := app.copyable_columns(
    'public.estimate_line_modifiers'::regclass, array['line_item_id', 'applied_by']);
  select string_agg(quote_ident(c), ', '), string_agg('m.' || quote_ident(c), ', ')
    into v_names, v_srcs
  from unnest(v_cols) as c;

  execute format($f$
    insert into estimate_line_modifiers (company_id, line_item_id, applied_by, %s)
    select $2, ($3 ->> m.line_item_id::text)::uuid, auth.uid(), %s
    from estimate_line_modifiers m
    join estimate_line_items s on s.id = m.line_item_id
    where s.estimate_version_id = $1
  $f$, v_names, v_srcs)
  using p_from, v_to_company, v_map;

  -- Version-level attachments. `computed_amount` is left behind on the
  -- indirects for the same reason the line costs are: the engine writes it.
  v_cols := app.copyable_columns(
    'public.estimate_indirects'::regclass,
    array['estimate_version_id', 'computed_amount']);
  select string_agg(quote_ident(c), ', '), string_agg('i.' || quote_ident(c), ', ')
    into v_names, v_srcs
  from unnest(v_cols) as c;
  execute format($f$
    insert into estimate_indirects (company_id, estimate_version_id, %s)
    select $2, $3, %s from estimate_indirects i where i.estimate_version_id = $1
  $f$, v_names, v_srcs) using p_from, v_to_company, p_to;

  v_cols := app.copyable_columns(
    'public.estimate_exclusions'::regclass, array['estimate_version_id']);
  select string_agg(quote_ident(c), ', '), string_agg('e.' || quote_ident(c), ', ')
    into v_names, v_srcs
  from unnest(v_cols) as c;
  execute format($f$
    insert into estimate_exclusions (company_id, estimate_version_id, %s)
    select $2, $3, %s from estimate_exclusions e where e.estimate_version_id = $1
  $f$, v_names, v_srcs) using p_from, v_to_company, p_to;

  v_cols := app.copyable_columns(
    'public.estimate_assumptions'::regclass,
    array['estimate_version_id', 'line_item_id']);
  select string_agg(quote_ident(c), ', '), string_agg('a.' || quote_ident(c), ', ')
    into v_names, v_srcs
  from unnest(v_cols) as c;
  execute format($f$
    insert into estimate_assumptions (
      company_id, estimate_version_id, line_item_id, created_by, %s)
    select $2, $3, ($4 ->> a.line_item_id::text)::uuid, auth.uid(), %s
    from estimate_assumptions a where a.estimate_version_id = $1
  $f$, v_names, v_srcs) using p_from, v_to_company, p_to, v_map;

  v_cols := app.copyable_columns(
    'public.estimate_version_markups'::regclass, array['estimate_version_id']);
  select string_agg(quote_ident(c), ', '), string_agg('k.' || quote_ident(c), ', ')
    into v_names, v_srcs
  from unnest(v_cols) as c;
  execute format($f$
    insert into estimate_version_markups (company_id, estimate_version_id, %s)
    select $2, $3, %s from estimate_version_markups k where k.estimate_version_id = $1
  $f$, v_names, v_srcs) using p_from, v_to_company, p_to;

  return v_lines;
end;
$$;

comment on function app.copy_version_contents(uuid, uuid) is
  'Copies every line, resource, modifier, indirect, exclusion, assumption and markup from one estimate version to another. WORKFLOW. The column lists are read from the catalog so the copy cannot fall behind the schema.';

/**
 * Creates the next version of an estimate by copying the current one.
 *
 * Same signature and same rules as migration 0011 established. What changed is
 * that it now copies the resources, the modifiers, the assumptions and the
 * markups as well as the lines — which is what "copying the current one" has
 * claimed to mean since the day it was written.
 */
create or replace function app.revise_estimate_version(
  p_version_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_src   estimate_versions%rowtype;
  v_new   uuid;
  v_next  int;
  v_cols  text[];
  v_names text;
  v_srcs  text;
begin
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'A revision must state why it exists' using errcode = 'check_violation';
  end if;

  select * into v_src from estimate_versions where id = p_version_id;
  if not found then
    raise exception 'Estimate version % not found or not visible', p_version_id
      using errcode = 'no_data_found';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
  from estimate_versions where estimate_id = v_src.estimate_id;

  -- The version row carries its estimating assumptions forward and nothing
  -- else; `app.version_facts_not_carried_forward()` says what it leaves behind.
  v_cols := app.copyable_columns(
    'public.estimate_versions'::regclass,
    app.version_facts_not_carried_forward()
    || app.engine_output_columns('public.estimate_versions'::regclass));
  select string_agg(quote_ident(c), ', '), string_agg('v.' || quote_ident(c), ', ')
    into v_names, v_srcs
  from unnest(v_cols) as c;

  execute format($f$
    insert into estimate_versions (
      company_id, estimate_id, version_number, status, revision_reason, created_by, %s)
    select $2, $3, $4, 'draft', $5, auth.uid(), %s
    from estimate_versions v where v.id = $1
    returning id
  $f$, v_names, v_srcs)
  into v_new
  using p_version_id, v_src.company_id, v_src.estimate_id, v_next, p_reason;

  perform app.copy_version_contents(p_version_id, v_new);

  update estimates set current_version_id = v_new, updated_at = now()
  where id = v_src.estimate_id;

  return v_new;
end;
$$;

grant execute on function app.copy_version_contents(uuid, uuid) to authenticated;
grant execute on function app.revise_estimate_version(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- The template itself
-- -----------------------------------------------------------------------------

create table estimate_templates (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,

  name              text not null check (length(trim(name)) between 2 and 200),
  description       text,
  /** Free text on purpose: a company's own word for the kind of job it is. */
  trade             text,

  /** What it was captured from, kept so a template can be traced to a real bid. */
  source_version_id uuid references estimate_versions(id) on delete set null,

  /*
   * The captured version: its estimating assumptions, its lines, and on each
   * line the crew, equipment, material, haul and modifiers. Built from
   * `app.copyable_columns`, so it holds what a copy would hold and nothing the
   * engine owns.
   */
  payload           jsonb not null,
  /** Read out of the payload at capture, so a list screen need not open it. */
  line_count        int not null default 0 check (line_count >= 0),
  /*
   * Whether the quantities came with it. Stated rather than inferred, because
   * "this template has quantities in it" is the single fact an estimator most
   * needs to know before applying one.
   */
  carries_quantities boolean not null default false,

  status            text not null default 'active'
                      check (status in ('active', 'archived')),
  times_used        int not null default 0 check (times_used >= 0),
  last_used_at      timestamptz,

  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index estimate_templates_name_idx
  on estimate_templates (company_id, lower(trim(name)))
  where status = 'active';
create index estimate_templates_company_idx on estimate_templates (company_id, status, name);

comment on table estimate_templates is
  'A saved estimate structure a company starts new bids from: its lines, and on each line the crew, equipment, material, haul and condition modifiers. ENTITY. Held as a captured payload rather than a parallel set of tables, so it carries whatever an estimate line carries today and cannot fall behind it.';
comment on column estimate_templates.payload is
  'The captured version. Engine-owned columns are stripped at capture, so applying a template gives an unpriced estimate the engine prices against today''s rates.';
comment on column estimate_templates.carries_quantities is
  'Whether the template carries the quantities it was captured with. Off by default: a template is the shape of a job, not the last one''s takeoff.';

select app.apply_tenant_rls('estimate_templates', null, 'estimates.write');
select app.attach_standard_triggers('public.estimate_templates'::regclass);
select app.guard_suspension('estimate_templates');

-- -----------------------------------------------------------------------------
-- Capturing one
-- -----------------------------------------------------------------------------

/**
 * Build the payload for a version.
 *
 * Every key list here comes from `app.copyable_columns` minus what the engine
 * owns, so the payload is exactly the set of facts a copy would carry — no
 * more, and no less.
 */
create or replace function app.capture_version_payload(
  p_version uuid,
  p_include_quantities boolean default false)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_ver_drop  text[];
  v_line_drop text[];
  v_res_drop  text[];
  v_mod_drop  text[];
  v_out       jsonb;
begin
  v_ver_drop := array['id', 'company_id', 'created_at', 'updated_at', 'created_by']
                || app.version_facts_not_carried_forward()
                || app.engine_output_columns('public.estimate_versions'::regclass);

  v_line_drop := array['company_id', 'estimate_version_id', 'created_at', 'updated_at',
                       'created_by', 'origin', 'ai_agent_id', 'ai_accepted_by',
                       'ai_accepted_at']
                 || app.engine_output_columns('public.estimate_line_items'::regclass);

  v_res_drop := array['id', 'company_id', 'line_item_id', 'created_at', 'updated_at']
                || app.engine_output_columns('public.estimate_line_resources'::regclass);

  v_mod_drop := array['id', 'company_id', 'line_item_id', 'created_at', 'applied_by'];

  select jsonb_build_object(
    'format', 1,
    'captured_at', to_jsonb(now()),
    'version', to_jsonb(v) - v_ver_drop,
    'lines', coalesce((
      select jsonb_agg(
        (to_jsonb(s) - v_line_drop)
        || jsonb_build_object(
             'measured_quantity',
               case when p_include_quantities then s.measured_quantity else 0 end,
             'resources', coalesce((
               select jsonb_agg(to_jsonb(r) - v_res_drop order by r.sort_order, r.id)
               from estimate_line_resources r where r.line_item_id = s.id), '[]'::jsonb),
             'modifiers', coalesce((
               select jsonb_agg(to_jsonb(m) - v_mod_drop)
               from estimate_line_modifiers m where m.line_item_id = s.id), '[]'::jsonb))
        order by s.sort_order, s.id)
      from estimate_line_items s where s.estimate_version_id = p_version), '[]'::jsonb),
    'indirects', coalesce((
      select jsonb_agg(to_jsonb(i) - array['id', 'company_id', 'estimate_version_id',
                                           'created_at', 'updated_at', 'computed_amount']
                       order by i.sort_order)
      from estimate_indirects i where i.estimate_version_id = p_version), '[]'::jsonb),
    'exclusions', coalesce((
      select jsonb_agg(to_jsonb(e) - array['id', 'company_id', 'estimate_version_id',
                                           'created_at', 'updated_at']
                       order by e.sort_order)
      from estimate_exclusions e where e.estimate_version_id = p_version), '[]'::jsonb),
    'markups', coalesce((
      select jsonb_agg(to_jsonb(k) - array['id', 'company_id', 'estimate_version_id',
                                           'created_at', 'updated_at']
                       order by k.sequence)
      from estimate_version_markups k where k.estimate_version_id = p_version), '[]'::jsonb))
    into v_out
  from estimate_versions v where v.id = p_version;

  if v_out is null then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;
  return v_out;
end;
$$;

comment on function app.capture_version_payload(uuid, boolean) is
  'The facts of an estimate version, without anything the estimating engine owns. ENGINE support for estimate templates.';

/**
 * Save a version as a template.
 *
 * Any version, at any status. An estimator most often wants a template made
 * from a bid that was awarded, and refusing to read an issued version would
 * mean the best templates were the ones you could not save. Reading is not
 * editing; 0111's freeze is untouched.
 */
create or replace function app.save_estimate_template(
  p_version uuid,
  p_name text,
  p_description text default null,
  p_trade text default null,
  p_include_quantities boolean default false)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_payload jsonb;
  v_id      uuid;
begin
  select company_id into v_company from estimate_versions where id = p_version;
  if v_company is null then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to save a template'
      using errcode = 'insufficient_privilege';
  end if;
  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'A template needs a name' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from estimate_line_items where estimate_version_id = p_version) then
    raise exception 'There is nothing on this estimate to save as a template'
      using errcode = 'check_violation',
            hint = 'Add the lines you want the template to start people with.';
  end if;
  if exists (
    select 1 from estimate_templates t
    where t.company_id = v_company and t.status = 'active'
      and lower(trim(t.name)) = lower(trim(p_name))) then
    raise exception 'You already have a template called %', trim(p_name)
      using errcode = 'unique_violation',
            hint = 'Rename this one, or archive the one that holds the name.';
  end if;

  v_payload := app.capture_version_payload(p_version, coalesce(p_include_quantities, false));

  insert into estimate_templates (
    company_id, name, description, trade, source_version_id, payload,
    line_count, carries_quantities, created_by)
  values (
    v_company, trim(p_name), nullif(trim(coalesce(p_description, '')), ''),
    nullif(trim(coalesce(p_trade, '')), ''), p_version, v_payload,
    jsonb_array_length(v_payload -> 'lines'), coalesce(p_include_quantities, false),
    auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Applying one
-- -----------------------------------------------------------------------------

/**
 * Is this reference still something this company can use?
 *
 * A template saved a year ago may name a material the company has since
 * retired, or a production rate that was superseded. Returns the reference
 * when it still resolves and null when it does not, so the caller can keep the
 * line and say what it lost.
 */
create or replace function app.reference_still_resolves(
  p_table regclass, p_id uuid, p_company uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
declare v_ok boolean;
begin
  if p_id is null then
    return true;
  end if;
  execute format(
    'select exists (select 1 from %s x where x.id = $1 and (x.company_id = $2 or x.company_id is null))',
    p_table)
  into v_ok using p_id, p_company;
  return coalesce(v_ok, false);
end;
$$;

/**
 * Insert a row built from a jsonb object, naming only the columns it carries.
 *
 * `jsonb_populate_record` alone would not do: it fills every absent column with
 * null, and a not-null column holding a default — `created_at`, or any engine
 * output the payload deliberately left out — would be written as null rather
 * than defaulted. Naming only the keys present lets the schema supply the rest,
 * which is the whole point of a default.
 *
 * `security invoker`, so the row still has to pass the table's write policy.
 */
create or replace function app.insert_from_jsonb(p_table regclass, p_row jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare v_cols text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into v_cols
  from pg_attribute a
  where a.attrelid = p_table
    and a.attnum > 0
    and not a.attisdropped
    and p_row ? a.attname;

  if v_cols is null then
    raise exception 'There is nothing here to insert into %', p_table
      using errcode = 'check_violation';
  end if;

  execute format(
    'insert into %1$s (%2$s) select %2$s from jsonb_populate_record(null::%1$s, $1)',
    p_table, v_cols)
  using p_row;
end;
$$;

comment on function app.insert_from_jsonb(regclass, jsonb) is
  'Inserts a row from a jsonb object, naming only the columns it carries so the schema''s defaults fill the rest. ENGINE support for applying an estimate template.';

/**
 * Add a template's lines to an open estimate version.
 *
 * Appended rather than replacing: an estimator who has already started, or who
 * wants two templates on one bid, is doing something ordinary. Sort order
 * continues from what is already there, markups upsert on their code so a
 * second bond is not applied twice, and the estimating assumptions are taken
 * only onto a version nobody has started — a second template must not move the
 * shift hours of a half-built bid.
 *
 * Returns what happened, including the references that no longer resolved. A
 * template that quietly dropped a crew would be worse than one that failed.
 */
create or replace function app.apply_estimate_template(
  p_version uuid,
  p_template uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company  uuid;
  v_status   app.estimate_status;
  v_t        estimate_templates%rowtype;
  v_line     jsonb;
  v_res      jsonb;
  v_mod      jsonb;
  v_over     jsonb;
  v_new_line uuid;
  v_map      jsonb := '{}'::jsonb;
  v_sort     int;
  v_added    int := 0;
  v_fresh    boolean;
  v_markups  int := 0;
  v_settings boolean := false;
  v_cols     text[];
  v_sets     text;
  v_warn     text[] := '{}';
  v_col      text;
  v_ref      uuid;
begin
  select v.company_id, v.status into v_company, v_status
  from estimate_versions v where v.id = p_version;
  if v_company is null then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation',
            hint = 'app.revise_estimate_version copies it forward with a reason.';
  end if;

  select * into v_t from estimate_templates where id = p_template;
  if not found then
    raise exception 'No such template' using errcode = 'no_data_found';
  end if;
  if v_t.company_id <> v_company then
    raise exception 'That template belongs to another company'
      using errcode = 'insufficient_privilege';
  end if;
  if v_t.status <> 'active' then
    raise exception 'That template is archived' using errcode = 'check_violation';
  end if;

  select coalesce(max(sort_order), 0), count(*) = 0 into v_sort, v_fresh
  from estimate_line_items where estimate_version_id = p_version;

  for v_line in select * from jsonb_array_elements(v_t.payload -> 'lines') loop
    v_sort := v_sort + 10;
    v_over := jsonb_build_object(
      'id', gen_random_uuid(),
      'company_id', v_company,
      'estimate_version_id', p_version,
      'parent_line_id', null,
      'sort_order', v_sort,
      'origin', 'copied',
      'created_by', auth.uid());

    -- Library references that no longer resolve are cleared, not guessed at.
    foreach v_col in array array['service_id', 'assembly_id', 'cost_code_id',
                                 'production_rate_id', 'crew_id'] loop
      v_ref := nullif(v_line ->> v_col, '')::uuid;
      if v_ref is not null and not app.reference_still_resolves(
           case v_col
             when 'service_id' then 'public.services'::regclass
             when 'assembly_id' then 'public.assemblies'::regclass
             when 'cost_code_id' then 'public.cost_codes'::regclass
             when 'production_rate_id' then 'public.production_rates'::regclass
             else 'public.crews'::regclass
           end, v_ref, v_company) then
        v_over := v_over || jsonb_build_object(v_col, null);
        v_warn := v_warn || format('%s on "%s" is no longer in your library',
                                   replace(v_col, '_id', ''), v_line ->> 'description');
      end if;
    end loop;

    v_new_line := (v_over ->> 'id')::uuid;
    perform app.insert_from_jsonb(
      'public.estimate_line_items'::regclass,
      (v_line - 'resources' - 'modifiers') || v_over);
    v_map := v_map || jsonb_build_object(v_line ->> 'id', v_new_line);
    v_added := v_added + 1;

    for v_res in select * from jsonb_array_elements(coalesce(v_line -> 'resources', '[]'::jsonb)) loop
      v_over := jsonb_build_object(
        'id', gen_random_uuid(), 'company_id', v_company, 'line_item_id', v_new_line);
      foreach v_col in array array['labor_rate_id', 'equipment_id', 'material_id',
                                   'trucking_rate_id', 'disposal_site_id', 'vendor_id'] loop
        v_ref := nullif(v_res ->> v_col, '')::uuid;
        if v_ref is not null and not app.reference_still_resolves(
             case v_col
               when 'labor_rate_id' then 'public.labor_rates'::regclass
               when 'equipment_id' then 'public.equipment'::regclass
               when 'material_id' then 'public.materials'::regclass
               when 'trucking_rate_id' then 'public.trucking_rates'::regclass
               when 'disposal_site_id' then 'public.disposal_sites'::regclass
               else 'public.vendors'::regclass
             end, v_ref, v_company) then
          v_over := v_over || jsonb_build_object(v_col, null);
          v_warn := v_warn || format('%s on "%s" is no longer in your library',
                                     replace(v_col, '_id', ''), v_line ->> 'description');
        end if;
      end loop;
      perform app.insert_from_jsonb(
        'public.estimate_line_resources'::regclass, v_res || v_over);
    end loop;

    /*
     * A condition modifier cannot be cleared the way a rate can — the row is
     * the modifier — so one that has left the library is dropped, and said so.
     */
    for v_mod in select * from jsonb_array_elements(coalesce(v_line -> 'modifiers', '[]'::jsonb)) loop
      v_ref := nullif(v_mod ->> 'condition_modifier_id', '')::uuid;
      if v_ref is not null and app.reference_still_resolves(
           'public.condition_modifiers'::regclass, v_ref, v_company) then
        insert into estimate_line_modifiers (
          company_id, line_item_id, condition_modifier_id, justification,
          applied_factors, applied_by)
        values (v_company, v_new_line, v_ref, v_mod ->> 'justification',
                coalesce(v_mod -> 'applied_factors', '{}'::jsonb), auth.uid())
        on conflict (line_item_id, condition_modifier_id) do nothing;
      elsif v_ref is not null then
        v_warn := v_warn || format('a condition modifier on "%s" is no longer in your library',
                                   v_line ->> 'description');
      end if;
    end loop;
  end loop;

  -- Re-parent the copies at each other rather than at the template's own keys.
  update estimate_line_items c
  set parent_line_id = (v_map ->> (l.value ->> 'parent_line_id'))::uuid
  from jsonb_array_elements(v_t.payload -> 'lines') l
  where l.value ->> 'parent_line_id' is not null
    and c.id = (v_map ->> (l.value ->> 'id'))::uuid
    and v_map ? (l.value ->> 'parent_line_id');

  /*
   * The markups the template was saved with. Upserted on the code rather than
   * appended: a second BOND row would be applied twice, and that is a mistake
   * that only shows up on the invoice.
   */
  for v_mod in select * from jsonb_array_elements(coalesce(v_t.payload -> 'markups', '[]'::jsonb)) loop
    insert into estimate_version_markups (
      company_id, estimate_version_id, code, label, percent, basis, sequence,
      disclosed, enabled)
    values (
      v_company, p_version, v_mod ->> 'code', v_mod ->> 'label',
      (v_mod ->> 'percent')::numeric,
      coalesce(v_mod ->> 'basis', 'profile_default'),
      coalesce((v_mod ->> 'sequence')::int, 10),
      coalesce((v_mod ->> 'disclosed')::boolean, false),
      coalesce((v_mod ->> 'enabled')::boolean, true))
    on conflict (estimate_version_id, code) do update
      set label = excluded.label, percent = excluded.percent, basis = excluded.basis,
          sequence = excluded.sequence, disclosed = excluded.disclosed,
          enabled = excluded.enabled;
    v_markups := v_markups + 1;
  end loop;

  -- General conditions and exclusions are appended, the way the lines are.
  for v_mod in select * from jsonb_array_elements(coalesce(v_t.payload -> 'indirects', '[]'::jsonb)) loop
    perform app.insert_from_jsonb(
      'public.estimate_indirects'::regclass,
      v_mod || jsonb_build_object(
        'id', gen_random_uuid(), 'company_id', v_company,
        'estimate_version_id', p_version));
  end loop;

  for v_mod in select * from jsonb_array_elements(coalesce(v_t.payload -> 'exclusions', '[]'::jsonb)) loop
    perform app.insert_from_jsonb(
      'public.estimate_exclusions'::regclass,
      v_mod || jsonb_build_object(
        'id', gen_random_uuid(), 'company_id', v_company,
        'estimate_version_id', p_version));
  end loop;

  /*
   * The estimating assumptions — shift length, swell, fuel price, what the
   * customer is shown — only onto a version nobody has started. Changing the
   * shift hours of a half-built bid because a second template was added would
   * move every line on it, quietly, and the estimator asked for lines.
   */
  if v_fresh and v_t.payload ? 'version' then
    v_cols := app.copyable_columns(
      'public.estimate_versions'::regclass,
      app.version_facts_not_carried_forward()
      || app.engine_output_columns('public.estimate_versions'::regclass));
    select string_agg(format('%1$I = coalesce(($1 ->> %1$L)::text::%2$s, %1$I)',
                             a.attname, format_type(a.atttypid, a.atttypmod)), ', ')
      into v_sets
    from pg_attribute a
    where a.attrelid = 'public.estimate_versions'::regclass
      and a.attname = any (v_cols)
      and (v_t.payload -> 'version') ? a.attname::text;

    if v_sets is not null then
      execute format('update estimate_versions set %s where id = $2', v_sets)
      using v_t.payload -> 'version', p_version;
      v_settings := true;
    end if;
  end if;

  update estimate_templates
  set times_used = times_used + 1, last_used_at = now()
  where id = p_template;

  return jsonb_build_object(
    'template', p_template,
    'lines_added', v_added,
    'markups_applied', v_markups,
    'settings_applied', v_settings,
    'carries_quantities', v_t.carries_quantities,
    'warnings', to_jsonb(v_warn));
end;
$$;

/**
 * Start a new estimate from a template.
 *
 * The two calls an estimator would otherwise make in sequence, made together,
 * so a template that fails to apply does not leave an empty estimate behind
 * with a number burned on it.
 */
create or replace function app.create_estimate_from_template(
  p_template uuid,
  p_name text,
  p_customer_id uuid default null,
  p_number text default null,
  p_bid_due_at timestamptz default null,
  p_company uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_estimate uuid;
  v_version  uuid;
  v_result   jsonb;
begin
  v_estimate := app.create_estimate(p_name, p_customer_id, p_number, p_bid_due_at, p_company);
  select current_version_id into v_version from estimates where id = v_estimate;
  v_result := app.apply_estimate_template(v_version, p_template);
  return v_result || jsonb_build_object('estimate', v_estimate, 'version', v_version);
end;
$$;

/**
 * Put a template away, or bring it back.
 *
 * Archived rather than deleted, because an estimate built from a template is
 * easier to explain when the template it came from still exists.
 */
create or replace function app.archive_estimate_template(
  p_template uuid, p_archived boolean default true)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from estimate_templates where id = p_template;
  if v_company is null then
    raise exception 'No such template' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this template'
      using errcode = 'insufficient_privilege';
  end if;
  update estimate_templates
  set status = case when p_archived then 'archived' else 'active' end
  where id = p_template;
end;
$$;

-- -----------------------------------------------------------------------------
-- The assumptions a template carries, which nothing could set
-- -----------------------------------------------------------------------------

/**
 * Change this version's estimating assumptions.
 *
 * `app.update_estimate_version` arrived in migration 0108 accepting the five
 * disclosure switches, the shift length and the pricing profile. The other six
 * inputs the engine reads off the version — calendar efficiency, the fuel and
 * DEF prices, swell, shrink and the bid rounding increment — had no write path
 * at all: they were columns with defaults, and a company bidding at $4.10
 * diesel had no way to say so.
 *
 * The templates in this migration are what made that visible. A template
 * captures those six and applies them to a new estimate, so a value nobody
 * could enter was being carried forward. Adding the door is the fix; leaving
 * the template to be the only way to set them would have been the workaround.
 *
 * The bounds here are the column constraints, restated as errors a person can
 * act on rather than as a constraint name.
 */
create or replace function app.update_estimate_version(p_version uuid, p_fields jsonb)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_company uuid; v_status app.estimate_status;
begin
  select company_id, status into v_company, v_status
  from estimate_versions where id = p_version;

  if v_company is null then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation',
            hint = 'app.revise_estimate_version copies it forward with a reason.';
  end if;

  if p_fields ? 'calendar_efficiency'
     and ((p_fields->>'calendar_efficiency')::numeric <= 0
          or (p_fields->>'calendar_efficiency')::numeric > 1) then
    raise exception 'Calendar efficiency is a share of the working day, between just above 0 and 1'
      using errcode = 'check_violation';
  end if;
  if p_fields ? 'shrink_percent' and (p_fields->>'shrink_percent')::numeric >= 1 then
    raise exception 'Shrink of 100%% would leave no compacted volume at all'
      using errcode = 'check_violation';
  end if;

  update estimate_versions v
     set show_labor       = coalesce((p_fields->>'show_labor')::boolean, v.show_labor),
         show_equipment   = coalesce((p_fields->>'show_equipment')::boolean, v.show_equipment),
         show_materials   = coalesce((p_fields->>'show_materials')::boolean, v.show_materials),
         show_hauling     = coalesce((p_fields->>'show_hauling')::boolean, v.show_hauling),
         show_subcontract = coalesce((p_fields->>'show_subcontract')::boolean,
                                     v.show_subcontract),
         shift_hours      = coalesce((p_fields->>'shift_hours')::numeric, v.shift_hours),
         calendar_efficiency = coalesce((p_fields->>'calendar_efficiency')::numeric,
                                        v.calendar_efficiency),
         fuel_price_per_gallon = coalesce((p_fields->>'fuel_price_per_gallon')::numeric,
                                          v.fuel_price_per_gallon),
         def_price_per_gallon  = coalesce((p_fields->>'def_price_per_gallon')::numeric,
                                          v.def_price_per_gallon),
         swell_percent    = coalesce((p_fields->>'swell_percent')::numeric, v.swell_percent),
         shrink_percent   = coalesce((p_fields->>'shrink_percent')::numeric, v.shrink_percent),
         bid_rounding_increment = coalesce((p_fields->>'bid_rounding_increment')::numeric,
                                           v.bid_rounding_increment),
         pricing_profile_id = coalesce((p_fields->>'pricing_profile_id')::uuid,
                                       v.pricing_profile_id),
         updated_at       = now()
   where v.id = p_version;
end;
$$;

do $$
begin
  execute 'revoke all on function app.update_estimate_version(uuid, jsonb) from public, anon';
  execute 'grant execute on function app.update_estimate_version(uuid, jsonb) to authenticated';
end $$;

-- -----------------------------------------------------------------------------
-- What a screen reads
-- -----------------------------------------------------------------------------

/**
 * The templates this company can start from, without the payload.
 *
 * `security_invoker`, so row level security decides which rows a person sees.
 */
create or replace view my_estimate_templates
with (security_invoker = true) as
select t.id,
       t.company_id,
       t.name,
       t.description,
       t.trade,
       t.line_count,
       t.carries_quantities,
       t.status,
       t.times_used,
       t.last_used_at,
       t.created_at,
       e.number as source_estimate_number,
       e.name   as source_estimate_name,
       (select count(*) from jsonb_array_elements(t.payload -> 'markups')) as markup_count,
       (select count(*)
          from jsonb_array_elements(t.payload -> 'lines') l
          where jsonb_array_length(coalesce(l.value -> 'resources', '[]'::jsonb)) > 0)
         as lines_with_resources
from estimate_templates t
left join estimate_versions v on v.id = t.source_version_id
left join estimates e on e.id = v.estimate_id;

revoke all on my_estimate_templates from public, anon;
grant select on my_estimate_templates to authenticated;

/**
 * A template's lines, for the screen that shows what applying one would add.
 */
create or replace view estimate_template_lines
with (security_invoker = true) as
select t.id as template_id,
       t.company_id,
       (l.ordinality)::int                       as position,
       l.value ->> 'description'                 as description,
       l.value ->> 'unit'                        as unit,
       (l.value ->> 'measured_quantity')::numeric as measured_quantity,
       nullif(l.value ->> 'service_id', '')::uuid as service_id,
       jsonb_array_length(coalesce(l.value -> 'resources', '[]'::jsonb)) as resource_count,
       jsonb_array_length(coalesce(l.value -> 'modifiers', '[]'::jsonb)) as modifier_count
from estimate_templates t
cross join lateral jsonb_array_elements(t.payload -> 'lines') with ordinality as l(value, ordinality);

revoke all on estimate_template_lines from public, anon;
grant select on estimate_template_lines to authenticated;

-- -----------------------------------------------------------------------------
-- The doors a browser uses
-- -----------------------------------------------------------------------------

create or replace function public.save_estimate_template(
  p_version uuid, p_name text, p_description text default null,
  p_trade text default null, p_include_quantities boolean default false)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin
  return app.save_estimate_template(p_version, p_name, p_description, p_trade, p_include_quantities);
end; $$;

create or replace function public.apply_estimate_template(p_version uuid, p_template uuid)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.apply_estimate_template(p_version, p_template); end; $$;

create or replace function public.create_estimate_from_template(
  p_template uuid, p_name text, p_customer_id uuid default null,
  p_number text default null, p_bid_due_at timestamptz default null,
  p_company uuid default null)
returns jsonb language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin
  return app.create_estimate_from_template(
    p_template, p_name, p_customer_id, p_number, p_bid_due_at, p_company);
end; $$;

create or replace function public.archive_estimate_template(
  p_template uuid, p_archived boolean default true)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.archive_estimate_template(p_template, p_archived); end; $$;

/**
 * Create the next version of an estimate.
 *
 * `app.revise_estimate_version` has existed since migration 0011, and seven
 * refusals across this schema name it — "This version is issued; make a new
 * version to change it", with the hint pointing straight at it. None of those
 * could be acted on. The function lives in the `app` schema, PostgREST exposes
 * only `public`, and no wrapper was ever written: the platform told estimators
 * to do a thing it gave them no way to do.
 *
 * The reason is required and checked in the function, not here, so a revision
 * made by any caller carries the same explanation.
 */
create or replace function public.revise_estimate_version(
  p_version_id uuid, p_reason text)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.revise_estimate_version(p_version_id, p_reason); end; $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.save_estimate_template(uuid, text, text, text, boolean)',
    'public.apply_estimate_template(uuid, uuid)',
    'public.create_estimate_from_template(uuid, text, uuid, text, timestamptz, uuid)',
    'public.archive_estimate_template(uuid, boolean)',
    'public.revise_estimate_version(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();
