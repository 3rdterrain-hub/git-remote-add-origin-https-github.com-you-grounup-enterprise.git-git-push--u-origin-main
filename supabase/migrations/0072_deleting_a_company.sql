-- =============================================================================
-- 0072 — A company that cannot be deleted
--
-- `app.protect_last_owner()` refuses to remove the final active owner from a
-- company, which is right: a tenant with nobody able to administer it is a
-- support ticket that cannot be resolved from inside the product.
--
-- It also fires when the company itself is being deleted. `company_memberships`
-- cascades from `companies`, so removing a company deletes its memberships, the
-- guard sees the last owner going, and refuses — which means **no company can
-- be deleted at all**, by anybody, ever. Found while trying to remove a test
-- tenant from a real project.
--
-- That matters beyond tidying up. A customer who asks to be deleted has to be
-- deletable, and a platform that cannot honor that has a compliance problem
-- rather than a housekeeping one.
--
-- The fix is to notice the difference between the two cases. During a cascade
-- the parent row is already gone by the time the child trigger runs, so the
-- guard can ask whether the company still exists: if it does not, the last
-- owner is leaving because the company is, and there is nothing left to
-- protect.
-- =============================================================================

create or replace function app.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_company uuid := coalesce(old.company_id, new.company_id);
  v_remaining int;
begin
  /*
   * The company is being deleted and this membership is going with it.
   *
   * `company_memberships` cascades from `companies`, and PostgreSQL removes the
   * parent before the cascade reaches the children — so an absent company here
   * means the tenant itself is going, not that somebody is removing its last
   * administrator. Guarding it would make a company undeletable, which is a
   * compliance problem rather than a safety feature.
   */
  if tg_op = 'DELETE'
     and not exists (select 1 from companies where id = v_company) then
    return old;
  end if;

  select count(*) into v_remaining
  from company_memberships
  where company_id = v_company
    and is_owner
    and status = 'active'
    and id <> old.id;

  if v_remaining = 0 and (tg_op = 'DELETE' or new.is_owner = false or new.status <> 'active') then
    raise exception 'Company % must retain at least one active owner', v_company
      using errcode = 'restrict_violation';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

comment on function app.protect_last_owner() is
  'Refuses to remove a company''s final active owner, because a tenant nobody can administer is a support ticket that cannot be resolved from inside the product. Does not fire when the company itself is being deleted: the memberships cascade, the parent is already gone by then, and guarding that made every company permanently undeletable.';

-- -----------------------------------------------------------------------------
-- The ledger outlives the tenant
--
-- The second thing standing between a company and deletion. `audit_events`
-- cascaded from `companies` and is append-only — `app.forbid_mutation()`
-- refuses a DELETE at any privilege level — so removing a tenant tried to
-- delete its audit rows and was refused by the very guard that makes the ledger
-- worth having.
--
-- Cascading was the wrong relationship to begin with. An audit ledger records
-- that something happened, and a company closing its account does not unmake
-- the events. Setting the tenant pointer to null keeps the record and drops the
-- reference, which is what "append-only" was always supposed to mean.
--
-- **What this does not do is anonymize.** `actor_email` still names people who
-- worked at a company that no longer exists. A real "delete my account" flow
-- has to export what the customer is owed, remove their business data, and
-- reduce the ledger to something that answers a legal question without holding
-- personal data — and that is a deliberate piece of work rather than a foreign
-- key. Recorded in the backlog rather than implied by this change.
-- -----------------------------------------------------------------------------
do $$
declare v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.audit_events'::regclass
    and contype = 'f'
    and confrelid = 'public.companies'::regclass;

  if v_name is not null then
    execute format('alter table audit_events drop constraint %I', v_name);
  end if;

  alter table audit_events
    add constraint audit_events_company_id_fkey
      foreign key (company_id) references companies(id) on delete set null;
end $$;

comment on column audit_events.company_id is
  'The tenant an event belonged to, or null once that tenant has been deleted. Set null rather than cascaded: the ledger is append-only, so deleting its rows is refused, and a company closing its account does not unmake the events it records.';

select app.assert_security_gates();
