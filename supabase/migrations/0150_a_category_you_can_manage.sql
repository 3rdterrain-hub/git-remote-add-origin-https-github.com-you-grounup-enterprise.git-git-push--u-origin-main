-- =============================================================================
-- 0150 — A category you can manage
--
-- Migration 0113 made categories records and gave a person exactly one thing to
-- do with them: add. You could put a category on the list. You could not rename
-- it, you could not take it off, and you could not see how many rows were filed
-- under it — so there was no way to tell a category that organizes three
-- hundred materials from one somebody typed once by mistake.
--
-- The catalog this build ships with is what that costs. `COMPACTION` beside
-- `Compactors`. `CONCRETE` beside `Concrete`. `Misc` beside `Other`. Forty-two
-- material categories where the source file had twenty-five. Seed 0012
-- consolidated the shipped lists, but a company that makes the same mess next
-- Tuesday still had no screen to clean it up with — the tidying had to be done
-- by someone who could write a migration.
--
-- Four functions, written once over `app.categorized_columns()` so that a tenth
-- categorized column keeps getting all of this for free, which is the same
-- reason 0113 wrote the backfill and the guard that way. That list gains a
-- column here — what names a row in the table a category files things in — so
-- the drill-in stays generic instead of becoming a second map in the browser.
--
-- A kind is not assumed to govern one table. `lead_source` governs two, because
-- a form's label and the lead's source are the same fact written twice (0124),
-- so every function below loops over the columns of a kind. Resolving a kind to
-- one table would have renamed half a list and reported success.
--
--   * `library_category_counts` — what is filed under each name, counted from
--     the rows, split into what the catalog contributes and what this company
--     owns. The second number is the one that matters on a screen: it is how
--     many rows a rename would move.
--
--   * `rename_library_category` — renames the category *and* the rows filed
--     under it, in one transaction. A rename that left the rows behind would
--     produce a second category with the old name, which is the disease this
--     is treating.
--
--   * `library_category_members` — the rows behind a count, so "Compaction (5)"
--     is a question a person can open rather than a figure that sends them
--     hunting through the library for the five.
--
--   * `delete_library_category` — will not strand a row. It takes the category
--     to move them to, re-files them, and only then removes the name. The
--     destination is a required argument rather than an optional one, and that
--     is the whole design: removing a category is a tidying decision, losing
--     which category three hundred materials were in is not, and the two must
--     not be the same keystroke. It is also the merge tool — moving everything
--     from `COMPACTION` into `Compactors` and dropping the empty name is the
--     operation that turns two categories back into one.
--
-- A company manages its own list only. The shipped categories are the shared
-- vocabulary every tenant reads and no tenant edits; a company that wants
-- different words adds its own, which are offered alongside.
--
-- Library: the category lists behind every picker in the master libraries.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What each row is called
-- -----------------------------------------------------------------------------

/*
 * A screen that lists categories has to be able to open one — "Compaction (5)"
 * is a question, and the answer is the five rows. Showing them needs the column
 * that names a row, and that differs by table: a material has `name`, a labor
 * rate has `classification`, a lead has `company_name`.
 *
 * That belongs on the same list as everything else about a categorized column.
 * The alternative is a second map of table to label column written in
 * TypeScript, which would be one more place to forget when a tenth column is
 * added — the exact failure `app.categorized_columns()` was created to stop.
 *
 * The return type changes, so the function is dropped rather than replaced, and
 * the view over it goes and comes back with it.
 */
drop view if exists library_category_columns;
drop function if exists app.categorized_columns();

create function app.categorized_columns()
returns table (kind text, table_name text, column_name text, label text, label_column text)
language sql
immutable
set search_path = pg_catalog
as $$
  select * from (values
    ('industry',            'services',            'industry',        'Industry',                    'name'),
    ('service_category',    'services',            'category',        'Service category',            'name'),
    ('service_subcategory', 'services',            'subcategory',     'Service subcategory',         'name'),
    ('task_category',       'tasks',               'category',        'Task category',               'name'),
    ('material_category',   'materials',           'category',        'Material category',           'name'),
    ('modifier_category',   'condition_modifiers', 'category',        'Condition modifier category', 'name'),
    ('labor_group',         'labor_rates',         'labor_group',     'Labor group',                 'classification'),
    ('crew_discipline',     'crews',               'discipline',      'Crew discipline',             'name'),
    ('equipment_class',     'equipment',           'equipment_class', 'Equipment class',             'name'),
    ('lead_source',         'leads',               'source',          'Lead source',                 'company_name'),
    ('lead_source',         'lead_intake_forms',   'source_label',    'Lead source',                 'name')
  ) as t(kind, table_name, column_name, label, label_column);
$$;

comment on function app.categorized_columns() is
  'Which columns are governed by library_categories, under which kind, and what names a row in the table they belong to. LIBRARY support: the backfill, the guard, the pickers and the category manager all read this one list so none of them can disagree. Two columns share the lead_source kind, because a form''s label and the lead''s source are the same fact written twice.';

create or replace view library_category_columns as
select kind, table_name, column_name, label, label_column from app.categorized_columns();

revoke all on library_category_columns from public, anon;
grant select on library_category_columns to authenticated;

-- -----------------------------------------------------------------------------
-- Whose list is this
-- -----------------------------------------------------------------------------

/**
 * The company these three functions act on.
 *
 * Same resolution as `add_library_category` and `set_material_cost`: stated, or
 * inferred when the person belongs to exactly one company. Somebody in two
 * companies is asked which, because guessing there would rename the wrong
 * company's categories and the mistake would not announce itself.
 */
create or replace function app.category_company(p_company uuid)
returns uuid
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
declare v_mine uuid[];
begin
  if p_company is not null then
    return p_company;
  end if;
  select array_agg(c) into v_mine from app.current_company_ids() c;
  if coalesce(array_length(v_mine, 1), 0) = 1 then
    return v_mine[1];
  end if;
  if coalesce(array_length(v_mine, 1), 0) = 0 then
    raise exception 'Open a company before changing its categories'
      using errcode = 'insufficient_privilege';
  end if;
  raise exception 'You belong to more than one company; say whose categories these are'
    using errcode = 'check_violation';
end;
$$;

comment on function app.category_company(uuid) is
  'Which company a category change applies to: stated, or inferred when the person belongs to exactly one. LIBRARY support for the category management functions.';

/**
 * Refuse a kind the platform does not keep, and say so by name.
 *
 * A kind is deliberately not resolved to *one* table here. `lead_source`
 * governs two — `leads.source` and `lead_intake_forms.source_label`, because a
 * form's label and the lead's source are the same fact written twice (0124) —
 * so every function below loops over the columns of a kind rather than picking
 * one. Picking one would rename half a list and report success, which is worse
 * than refusing.
 */
create or replace function app.assert_category_kind(p_kind text)
returns void
language plpgsql
stable
set search_path = public, pg_catalog
as $$
begin
  if not exists (select 1 from app.categorized_columns() c where c.kind = p_kind) then
    raise exception '% is not a category list this platform keeps', p_kind
      using errcode = 'check_violation',
            hint = 'The kinds are in the library_category_columns view.';
  end if;
end;
$$;

comment on function app.assert_category_kind(text) is
  'Refuses a category kind the platform does not keep. LIBRARY support: the one check all three management functions share.';

-- -----------------------------------------------------------------------------
-- What is filed under each
-- -----------------------------------------------------------------------------

/**
 * How many rows carry each category of one kind.
 *
 * Counted from the rows rather than stored, because a stored count is wrong
 * from the first import that forgot to update it. `mine` is the number a rename
 * would move and a removal would re-file; `in_use` includes the catalog's own
 * rows, which are filed under the catalog's categories and are nobody's to move.
 *
 * Row level security decides what is counted, which makes the count agree with
 * the list the same person is looking at.
 */
create or replace function app.library_category_counts(p_kind text, p_company uuid default null)
returns table (name text, in_use bigint, mine bigint)
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_union   text := '';
  r         record;
begin
  perform app.assert_category_kind(p_kind);
  v_company := app.category_company(p_company);

  /*
   * One branch per column the kind governs, summed together: a lead source is
   * carried by leads and by intake forms, and a screen asking "what is filed
   * under Referral" means both.
   */
  for r in select * from app.categorized_columns() c where c.kind = p_kind loop
    v_union := v_union || case when v_union = '' then '' else ' union all ' end
      || format(
        'select trim(t.%1$I)::text as name,
                coalesce(t.company_id = $1, false)::int::bigint as is_mine
           from %2$I t
          where t.%1$I is not null and length(trim(t.%1$I)) > 0',
        r.column_name, r.table_name);
  end loop;

  return query execute
    'select u.name, count(*)::bigint as in_use, sum(u.is_mine)::bigint as mine
       from (' || v_union || ') u group by u.name order by u.name'
  using v_company;
end;
$$;

comment on function app.library_category_counts(text, uuid) is
  'What is filed under each category of one kind, counted from the rows under the caller''s own row level security: in_use across everything visible, mine for the rows a rename would move. LIBRARY.';

-- -----------------------------------------------------------------------------
-- Renaming one
-- -----------------------------------------------------------------------------

/**
 * Rename a category, and everything filed under it, together.
 *
 * The rows move with the name. A rename that changed only the list would leave
 * every row pointing at a name no longer on it, which the 0113 guard would then
 * refuse to write — so the next edit to any of those rows would fail with a
 * message about a category the person never touched.
 *
 * Returns how many rows moved. A collision is refused rather than merged, and
 * the message says which door merges: `delete_library_category` with the other
 * name as the destination.
 */
create or replace function app.rename_library_category(
  p_kind text, p_from text, p_to text, p_company uuid default null)
returns bigint
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_from    text := nullif(trim(coalesce(p_from, '')), '');
  v_to      text := nullif(trim(coalesce(p_to, '')), '');
  v_moved   bigint := 0;
  v_n       bigint;
  r         record;
begin
  perform app.assert_category_kind(p_kind);
  v_company := app.category_company(p_company);

  if v_from is null or v_to is null then
    raise exception 'A category needs a name' using errcode = 'check_violation';
  end if;
  if not app.has_permission(v_company, 'libraries.write') then
    raise exception 'You do not have permission to change the library'
      using errcode = 'insufficient_privilege';
  end if;

  /*
   * Only a category this company owns. The shipped list is the shared
   * vocabulary — one tenant renaming a word in it would rename it for everyone,
   * which is why 0113 would not let it be retired either.
   */
  if not exists (select 1 from library_categories c
                  where c.kind = p_kind and c.company_id = v_company
                    and lower(trim(c.name)) = lower(v_from)) then
    raise exception 'There is no category of your own called %', v_from
      using errcode = 'no_data_found',
            hint = 'A category the platform ships is read by every company and renamed by none. Add your own instead.';
  end if;

  if lower(v_from) <> lower(v_to)
     and exists (select 1 from library_categories c
                  where c.kind = p_kind
                    and lower(trim(c.name)) = lower(v_to)
                    and (c.company_id = v_company or c.company_id is null)) then
    raise exception 'There is already a category called %', v_to
      using errcode = 'unique_violation',
            hint = 'To combine them, remove this one and move its items into that one.';
  end if;

  /*
   * The list first, then the rows: the guard checks the value arriving on a
   * row against the list, so the new name has to be on it before any row can
   * carry it.
   */
  update library_categories set name = v_to, updated_at = now()
   where kind = p_kind and company_id = v_company
     and lower(trim(name)) = lower(v_from);

  for r in select * from app.categorized_columns() c where c.kind = p_kind loop
    execute format(
      'update %1$I set %2$I = $1 where lower(trim(%2$I)) = lower($2) and company_id = $3',
      r.table_name, r.column_name)
    using v_to, v_from, v_company;
    get diagnostics v_n = row_count;
    v_moved := v_moved + v_n;
  end loop;

  return v_moved;
end;
$$;

comment on function app.rename_library_category(text, text, text, uuid) is
  'Renames one of this company''s categories and every row filed under it, in one transaction. Refuses a shipped category, which every company reads. LIBRARY.';

-- -----------------------------------------------------------------------------
-- Removing one
-- -----------------------------------------------------------------------------

/**
 * Remove a category, moving what was in it somewhere stated.
 *
 * `p_move_to` is required. Where the category is empty the argument costs
 * nothing; where it is not, it is the difference between tidying a list and
 * losing how three hundred materials were grouped. The destination may be one
 * of this company's categories or one the platform ships, because filing your
 * rows under a shipped category is allowed — creating one is not.
 *
 * This is also how two categories become one: move everything out, and the name
 * left empty goes with it. Returns how many rows were re-filed.
 */
create or replace function app.delete_library_category(
  p_kind text, p_name text, p_move_to text, p_company uuid default null)
returns bigint
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_name    text := nullif(trim(coalesce(p_name, '')), '');
  v_to      text := nullif(trim(coalesce(p_move_to, '')), '');
  v_moved   bigint := 0;
  v_n       bigint;
  r         record;
begin
  perform app.assert_category_kind(p_kind);
  v_company := app.category_company(p_company);

  if v_name is null then
    raise exception 'Say which category to remove' using errcode = 'check_violation';
  end if;
  if v_to is null then
    raise exception 'Say which category to move the items into'
      using errcode = 'check_violation',
            hint = 'Removing a category and losing how its items were grouped are different decisions.';
  end if;
  if lower(v_name) = lower(v_to) then
    raise exception 'Move them somewhere other than the category being removed'
      using errcode = 'check_violation';
  end if;
  if not app.has_permission(v_company, 'libraries.write') then
    raise exception 'You do not have permission to change the library'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from library_categories c
                  where c.kind = p_kind and c.company_id = v_company
                    and lower(trim(c.name)) = lower(v_name)) then
    raise exception 'There is no category of your own called %', v_name
      using errcode = 'no_data_found',
            hint = 'A category the platform ships is read by every company and removed by none.';
  end if;

  /*
   * The destination is checked here rather than left to the guard, because the
   * guard would fail the UPDATE with a message about a trigger on a table the
   * person never named, halfway through an operation they would then have to
   * guess the state of.
   */
  if not exists (select 1 from library_categories c
                  where c.kind = p_kind and c.status = 'active'
                    and lower(trim(c.name)) = lower(v_to)
                    and (c.company_id = v_company or c.company_id is null)) then
    raise exception 'There is no category called % to move them into', v_to
      using errcode = 'no_data_found';
  end if;

  -- Take the destination's own spelling, so the move cannot create a third
  -- casing of a name that already exists.
  select c.name into v_to from library_categories c
   where c.kind = p_kind and c.status = 'active'
     and lower(trim(c.name)) = lower(v_to)
     and (c.company_id = v_company or c.company_id is null)
   order by (c.company_id is not null) desc
   limit 1;

  for r in select * from app.categorized_columns() c where c.kind = p_kind loop
    execute format(
      'update %1$I set %2$I = $1 where lower(trim(%2$I)) = lower($2) and company_id = $3',
      r.table_name, r.column_name)
    using v_to, v_name, v_company;
    get diagnostics v_n = row_count;
    v_moved := v_moved + v_n;
  end loop;

  delete from library_categories
   where kind = p_kind and company_id = v_company
     and lower(trim(name)) = lower(v_name);

  return v_moved;
end;
$$;

comment on function app.delete_library_category(text, text, text, uuid) is
  'Removes one of this company''s categories after moving everything filed under it into a stated one. The destination is required: removing a category and losing how its items were grouped must not be the same keystroke. Also the merge tool. LIBRARY.';

-- -----------------------------------------------------------------------------
-- Opening one
-- -----------------------------------------------------------------------------

/**
 * What is actually filed under one category.
 *
 * The count on a list raises a question and this answers it. Every table the
 * kind governs, named by whatever column names a row there, under the caller's
 * own row level security — so the drill-in shows exactly the rows the person
 * could have found in the library itself.
 */
create or replace function app.library_category_members(
  p_kind text, p_name text, p_company uuid default null, p_limit int default 200)
returns table (source_table text, id uuid, label text, is_mine boolean)
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_union   text := '';
  r         record;
begin
  perform app.assert_category_kind(p_kind);
  v_company := app.category_company(p_company);

  for r in select * from app.categorized_columns() c where c.kind = p_kind loop
    v_union := v_union || case when v_union = '' then '' else ' union all ' end
      || format(
        'select %3$L::text as source_table,
                t.id,
                t.%4$I::text as label,
                coalesce(t.company_id = $1, false) as is_mine
           from %2$I t
          where lower(trim(t.%1$I)) = lower(trim($2))',
        r.column_name, r.table_name, r.table_name, r.label_column);
  end loop;

  return query execute
    'select u.source_table, u.id, u.label, u.is_mine from (' || v_union || ') u
      order by u.is_mine desc, u.label limit $3'
  using v_company, p_name, greatest(coalesce(p_limit, 200), 1);
end;
$$;

comment on function app.library_category_members(text, text, uuid, int) is
  'The rows filed under one category, across every table its kind governs, under the caller''s own row level security. LIBRARY: what makes a count on a screen something you can open.';

-- -----------------------------------------------------------------------------
-- The doors a browser uses
-- -----------------------------------------------------------------------------

create or replace function public.library_category_counts(p_kind text, p_company uuid default null)
returns table (name text, in_use bigint, mine bigint)
language sql stable security invoker set search_path = public, pg_catalog
as $$ select * from app.library_category_counts(p_kind, p_company); $$;

create or replace function public.rename_library_category(
  p_kind text, p_from text, p_to text, p_company uuid default null)
returns bigint language sql security invoker set search_path = public, pg_catalog
as $$ select app.rename_library_category(p_kind, p_from, p_to, p_company); $$;

create or replace function public.library_category_members(
  p_kind text, p_name text, p_company uuid default null, p_limit int default 200)
returns table (source_table text, id uuid, label text, is_mine boolean)
language sql stable security invoker set search_path = public, pg_catalog
as $$ select * from app.library_category_members(p_kind, p_name, p_company, p_limit); $$;

create or replace function public.delete_library_category(
  p_kind text, p_name text, p_move_to text, p_company uuid default null)
returns bigint language sql security invoker set search_path = public, pg_catalog
as $$ select app.delete_library_category(p_kind, p_name, p_move_to, p_company); $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'app.category_company(uuid)',
    'app.assert_category_kind(text)',
    'app.library_category_counts(text, uuid)',
    'app.library_category_members(text, text, uuid, int)',
    'app.rename_library_category(text, text, text, uuid)',
    'app.delete_library_category(text, text, text, uuid)',
    'public.library_category_counts(text, uuid)',
    'public.library_category_members(text, text, uuid, int)',
    'public.rename_library_category(text, text, text, uuid)',
    'public.delete_library_category(text, text, text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();
