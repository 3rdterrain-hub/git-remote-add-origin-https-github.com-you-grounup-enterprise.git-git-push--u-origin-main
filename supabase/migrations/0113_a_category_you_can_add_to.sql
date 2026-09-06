-- =============================================================================
-- 0113 — A category you can add to
--
-- Nine columns across the master libraries group things: a service's industry,
-- category and subcategory; a task's category; a material's category; a
-- condition modifier's category; a labor group; a crew's discipline; an
-- equipment class. Every one of them is free text.
--
-- That has two consequences and both are already happening. A company adding a
-- service has to know what the catalog calls a category and type it exactly —
-- "Site Work", "Sitework" and "Site work" are three categories to the database
-- and one to a person, and any report that groups by category quietly splits.
-- And a person who wants a category the catalog does not have has no way to
-- create one that anything else will recognize.
--
-- So categories become records. `library_categories` holds them, the shipped
-- ones belong to the platform and are readable by everyone, and a company adds
-- its own on top — the same three-tier shape every other library in this
-- schema already has.
--
-- Two design points worth stating.
--
--   * **The columns stay text.** Turning nine columns into foreign keys would
--     rewrite the catalog, the seed, the snapshot capture and every screen that
--     reads a category — a great deal of risk for a referential integrity this
--     achieves another way. A trigger refuses a value that is not in the list,
--     which is the property that actually matters: you cannot invent a category
--     by typing one, and the list is the only way in.
--
--   * **One list of which columns are categorized**, in
--     `app.categorized_columns()`. The backfill reads it, the guard reads it,
--     and a screen can read it. A tenth categorized column is a row in that
--     function rather than a change in four places — which is what stopped
--     `capture_library_snapshot` from silently omitting a library in 0098, and
--     the same reasoning applies here.
--
-- Existing values are adopted rather than rejected: the migration reads every
-- distinct value already in those columns and files it — platform rows under
-- the platform, a company's own under that company — before any guard is
-- attached. A database with data in it comes through this migration with the
-- categories it already had, and nothing to retype.
-- =============================================================================

create table library_categories (
  id                uuid primary key default gen_random_uuid(),
  /** Null is the platform's own, readable by every tenant and writable by none. */
  company_id        uuid references companies(id) on delete cascade,

  /** Which list this belongs to. `app.categorized_columns()` defines the set. */
  kind              text not null check (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  name              text not null check (length(trim(name)) between 1 and 120),
  description       text,
  /** Where it sits in a picker. Ties break by name, so the order is total. */
  sort_order        int not null default 100,

  status            app.record_status not null default 'active',
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

/*
 * One name per kind per scope, case- and space-insensitively, because "Site
 * Work" and "site work " are the same category to everyone except a database
 * that was not told so.
 */
create unique index library_categories_company_name_idx
  on library_categories (company_id, kind, lower(trim(name)))
  where company_id is not null;
create unique index library_categories_platform_name_idx
  on library_categories (kind, lower(trim(name)))
  where company_id is null;
create index library_categories_kind_idx on library_categories (kind, sort_order, name);

comment on table library_categories is
  'The categories the master libraries group by: service industry, category and subcategory, task, material, condition modifier, labor group, crew discipline and equipment class. LIBRARY. Platform rows ship with the catalog and are readable by every tenant; a company adds its own on top, and a trigger refuses any value that is not in this list.';

-- -----------------------------------------------------------------------------
-- Which columns are categorized
-- -----------------------------------------------------------------------------

/**
 * The list, in one place.
 *
 * A tenth categorized column is a row here. The backfill below reads it, the
 * guard trigger is attached from it, and a screen asks it which kind a column
 * uses — so a picker cannot offer the wrong list and a guard cannot be
 * forgotten.
 */
create or replace function app.categorized_columns()
returns table (kind text, table_name text, column_name text, label text)
language sql
immutable
set search_path = pg_catalog
as $$
  select * from (values
    ('industry',            'services',            'industry',        'Industry'),
    ('service_category',    'services',            'category',        'Service category'),
    ('service_subcategory', 'services',            'subcategory',     'Service subcategory'),
    ('task_category',       'tasks',               'category',        'Task category'),
    ('material_category',   'materials',           'category',        'Material category'),
    ('modifier_category',   'condition_modifiers', 'category',        'Condition modifier category'),
    ('labor_group',         'labor_rates',         'labor_group',     'Labor group'),
    ('crew_discipline',     'crews',               'discipline',      'Crew discipline'),
    ('equipment_class',     'equipment',           'equipment_class', 'Equipment class')
  ) as t(kind, table_name, column_name, label);
$$;

comment on function app.categorized_columns() is
  'Which library columns are governed by library_categories, and under which kind. LIBRARY support: the backfill, the guard and the pickers all read this one list so none of them can disagree.';

-- -----------------------------------------------------------------------------
-- Adopt what is already there
-- -----------------------------------------------------------------------------

/*
 * Everything already written into those columns becomes a category, filed under
 * whoever owns the row it came from. Run before any guard is attached, so a
 * database with data in it arrives on the other side with the categories it
 * already had and nothing to retype.
 */
do $$
declare r record;
begin
  for r in select * from app.categorized_columns() loop
    execute format($f$
      insert into library_categories (company_id, kind, name, sort_order)
      select x.company_id, %L, trim(x.%I), 100
        from %I x
       where x.%I is not null and length(trim(x.%I)) > 0
       group by x.company_id, trim(x.%I)
      on conflict do nothing
    $f$, r.kind, r.column_name, r.table_name, r.column_name, r.column_name, r.column_name);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- The guard
-- -----------------------------------------------------------------------------

/**
 * Refuse a category that is not in the list.
 *
 * Generic over the column, which arrives in TG_ARGV, so nine tables share one
 * implementation and a tenth is a row in `app.categorized_columns()`.
 *
 * A row may use its own company's category or the platform's, which is the
 * same three-tier read every library in this schema has. Clearing a category is
 * always allowed — null means ungrouped, and refusing that would make a
 * category impossible to remove once set.
 */
create or replace function app.enforce_library_category()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_kind   text := tg_argv[0];
  v_column text := tg_argv[1];
  v_value  text;
  v_owner  uuid;
begin
  v_value := nullif(trim(coalesce(to_jsonb(new) ->> v_column, '')), '');
  if v_value is null then
    return new;
  end if;

  v_owner := (to_jsonb(new) ->> 'company_id')::uuid;

  if exists (
    select 1 from library_categories c
     where c.kind = v_kind
       and c.status = 'active'
       and lower(trim(c.name)) = lower(v_value)
       and (c.company_id is null or c.company_id is not distinct from v_owner))
  then
    return new;
  end if;

  raise exception '% is not one of your % options', v_value, replace(v_kind, '_', ' ')
    using errcode = 'foreign_key_violation',
          hint = 'Add it first — app.add_library_category files a new one against your company.';
end;
$$;

comment on function app.enforce_library_category() is
  'Refuses a library category that is not in library_categories. WORKFLOW guard: this is what makes the picker the only way in, rather than a suggestion a typed value can bypass.';

do $$
declare r record;
begin
  for r in select * from app.categorized_columns() loop
    execute format(
      'create trigger %I before insert or update on %I
         for each row execute function app.enforce_library_category(%L, %L)',
      r.table_name || '_' || r.column_name || '_category',
      r.table_name, r.kind, r.column_name);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Adding one
-- -----------------------------------------------------------------------------

/**
 * File a new category against your company.
 *
 * Returns the existing one when the name is already taken — by the company or
 * by the platform — rather than refusing. Somebody typing a category that
 * already exists means to use it, and an error there would be a puzzle rather
 * than a guard.
 */
create or replace function app.add_library_category(
  p_kind text,
  p_name text,
  p_description text default null,
  p_company uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_name    text := nullif(trim(coalesce(p_name, '')), '');
  v_id      uuid;
begin
  if not exists (select 1 from app.categorized_columns() c where c.kind = p_kind) then
    raise exception '% is not a category list this platform keeps', p_kind
      using errcode = 'check_violation';
  end if;
  if v_name is null then
    raise exception 'A category needs a name' using errcode = 'check_violation';
  end if;

  if p_company is not null then
    v_company := p_company;
  else
    select company_id into v_company from company_memberships
     where user_id = auth.uid() and status = 'active' limit 2;
    if (select count(*) from company_memberships
         where user_id = auth.uid() and status = 'active') > 1 then
      raise exception 'You belong to more than one company; say which this category is for'
        using errcode = 'check_violation';
    end if;
  end if;
  if v_company is null then
    raise exception 'Open a company before adding a category'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.has_permission(v_company, 'libraries.write') then
    raise exception 'You do not have permission to change the libraries'
      using errcode = 'insufficient_privilege';
  end if;

  -- Already there, under either scope: hand back what exists.
  select c.id into v_id
  from library_categories c
  where c.kind = p_kind
    and lower(trim(c.name)) = lower(v_name)
    and (c.company_id is null or c.company_id = v_company)
    and c.status = 'active'
  order by (c.company_id is not null) desc
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into library_categories (company_id, kind, name, description, created_by)
  values (v_company, p_kind, v_name,
          nullif(trim(coalesce(p_description, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

/**
 * Put a category away.
 *
 * Retired rather than deleted, and only a company's own: the platform list is
 * the shared vocabulary and a tenant does not get to remove a word from it.
 * Rows already carrying the name keep it — this stops it being offered and
 * stops new rows taking it.
 */
create or replace function app.retire_library_category(p_category uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from library_categories where id = p_category;
  if not found then
    raise exception 'No such category' using errcode = 'no_data_found';
  end if;
  if v_company is null then
    raise exception 'The shipped categories belong to the platform and cannot be retired'
      using errcode = 'insufficient_privilege',
            hint = 'Add your own instead; yours are offered alongside them.';
  end if;
  if not app.has_permission(v_company, 'libraries.write') then
    raise exception 'You do not have permission to change the libraries'
      using errcode = 'insufficient_privilege';
  end if;
  update library_categories set status = 'archived' where id = p_category;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reading the list
-- -----------------------------------------------------------------------------

/*
 * Row level security, written by hand rather than through `app.apply_tenant_rls`
 * because a platform row has a null `company_id` and the standard policy reads
 * `app.is_member(company_id)`, which is null — and therefore false — for exactly
 * the rows every tenant is supposed to see.
 */
alter table library_categories enable row level security;
alter table library_categories force row level security;

create policy library_categories_read on library_categories
  for select to authenticated
  using (company_id is null or app.is_member(company_id));

create policy library_categories_write on library_categories
  for insert to authenticated
  with check (company_id is not null
              and app.is_member(company_id)
              and app.has_permission(company_id, 'libraries.write'));

create policy library_categories_update on library_categories
  for update to authenticated
  using (company_id is not null and app.is_member(company_id)
         and app.has_permission(company_id, 'libraries.write'))
  with check (company_id is not null and app.is_member(company_id));

create policy library_categories_delete on library_categories
  for delete to authenticated
  using (company_id is not null and app.is_member(company_id)
         and app.has_permission(company_id, 'libraries.write'));

revoke all on library_categories from public, anon;
grant select, insert, update, delete on library_categories to authenticated;
select app.attach_standard_triggers('public.library_categories'::regclass);
-- A suspended company writes nothing, categories included.
select app.guard_suspension('library_categories');

/**
 * Every category a picker may offer, platform and own together.
 *
 * `security_invoker`, so the policies above decide what a person sees. The
 * `is_own` column is what a screen needs to know whether it may retire one.
 */
create or replace view my_library_categories
with (security_invoker = true) as
select c.id,
       c.company_id,
       c.kind,
       c.name,
       c.description,
       c.sort_order,
       c.company_id is not null as is_own,
       c.status
from library_categories c
where c.status = 'active';

revoke all on my_library_categories from public, anon;
grant select on my_library_categories to authenticated;

/** Which column each category list governs, so a screen picks the right one. */
create or replace view library_category_columns as
select kind, table_name, column_name, label from app.categorized_columns();

revoke all on library_category_columns from public, anon;
grant select on library_category_columns to authenticated;

-- -----------------------------------------------------------------------------
-- The doors a browser uses
-- -----------------------------------------------------------------------------

create or replace function public.add_library_category(
  p_kind text, p_name text, p_description text default null, p_company uuid default null)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin
  return app.add_library_category(p_kind, p_name, p_description, p_company);
end; $$;

create or replace function public.retire_library_category(p_category uuid)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.retire_library_category(p_category); end; $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.add_library_category(text, text, text, uuid)',
    'public.retire_library_category(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();
