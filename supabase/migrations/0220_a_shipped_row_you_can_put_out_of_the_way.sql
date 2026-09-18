-- =============================================================================
-- 0220 — A shipped row you can put out of the way
--
-- 0217 refused to archive a shipped row, on the reasoning that it belongs to
-- every company on the platform and hiding it for one would hide it for all.
-- The reasoning holds. The consequence did not survive contact with a real
-- company's library:
--
--     materials             0 theirs,   333 shipped
--     labor rates           0 theirs,    56 shipped
--     condition modifiers   0 theirs,    20 shipped
--     equipment             9 theirs,   700 shipped
--     production rates     47 theirs, 2,143 shipped
--
-- So the archive control rendered on almost nothing, and the owner would have
-- been looking at the same screen that prompted "none of them have delete
-- buttons" in the first place.
--
-- A company cannot change a shipped row and should not be able to. What they
-- can reasonably do is decide it is not part of *their* library — the 2,143
-- production rates for trades they do not work in are noise they have to read
-- past every time. That is a per-company decision about visibility, not a
-- change to the row, so it is recorded per company and beside the row rather
-- than on it.
--
-- One control on screen, two mechanisms underneath: your own row is archived,
-- a shipped row is hidden for you. Both are reversible and neither destroys
-- anything, which is the promise the button makes.
--
-- ENTITY.
-- =============================================================================

create table if not exists library_hidden_rows (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  /* The same vocabulary `app.set_library_status` takes, so one control can
     address either mechanism without translating. */
  kind        text not null check (kind in (
                'service', 'task', 'assembly', 'material', 'labor_rate',
                'equipment', 'crew', 'production_rate', 'trucking_rate',
                'vendor', 'condition_modifier', 'pricing_profile',
                'disposal_site', 'wage_schedule')),
  row_id      uuid not null,
  hidden_by   uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, kind, row_id)
);

create index if not exists library_hidden_rows_company_idx
  on library_hidden_rows(company_id, kind);

comment on table library_hidden_rows is
  'Shipped library rows one company has put out of its own way. No foreign key to the row: it points at fourteen different tables by kind, and a row that is later retired upstream should not drag the hide with it. ENTITY.';

alter table library_hidden_rows enable row level security;
alter table library_hidden_rows force row level security;

create policy library_hidden_rows_select on library_hidden_rows for select to authenticated
  using (app.is_member(company_id));
create policy library_hidden_rows_write on library_hidden_rows for all to authenticated
  using (app.has_permission(company_id, 'libraries.write'))
  with check (app.has_permission(company_id, 'libraries.write'));

grant select, insert, update, delete on library_hidden_rows to authenticated;
revoke all on library_hidden_rows from anon;

select app.attach_standard_triggers('public.library_hidden_rows'::regclass);
select app.guard_suspension('library_hidden_rows');

/**
 * Put a library row out of this company's way, or bring it back.
 *
 * Deliberately the same shape as `app.set_library_status`, and deliberately
 * *not* merged into it: one writes a row's own status and the other writes a
 * fact about this company's view of somebody else's row. Merging them would
 * mean one function whose effect depends on who owns the row, which is the kind
 * of thing that is right until somebody reads it.
 */
create or replace function app.hide_library_row(
  p_company uuid,
  p_kind    text,
  p_row     uuid,
  p_hidden  boolean default true)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'libraries.write');
begin
  if p_hidden then
    insert into library_hidden_rows (company_id, kind, row_id, hidden_by)
    values (v_company, p_kind, p_row, auth.uid())
    on conflict (company_id, kind, row_id) do nothing;
  else
    delete from library_hidden_rows
     where company_id = v_company and kind = p_kind and row_id = p_row;
  end if;
  return p_hidden;
end;
$$;

comment on function app.hide_library_row(uuid, text, uuid, boolean) is
  'Hides a shipped library row from one company''s library, or brings it back. Changes nothing about the row, which belongs to every company. ENTITY.';

/** What this company has put out of the way, for a screen to filter on. */
create or replace view my_hidden_library_rows
with (security_invoker = true) as
select h.id, h.company_id, h.kind, h.row_id, h.created_at
  from library_hidden_rows h;

revoke all on my_hidden_library_rows from public, anon;
grant select on my_hidden_library_rows to authenticated, service_role;

create or replace function public.hide_library_row(
  p_company uuid, p_kind text, p_row uuid, p_hidden boolean default true)
returns boolean language sql security invoker set search_path = public, pg_catalog
as $$ select app.hide_library_row(p_company, p_kind, p_row, p_hidden); $$;

revoke all on function public.hide_library_row(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.hide_library_row(uuid, text, uuid, boolean)
  to authenticated, service_role;
