-- =============================================================================
-- 0210 — A directory somebody consented to
--
-- `network_vendors` and `network_ratings` have existed since migration 0023 —
-- the only deliberately cross-tenant tables in this schema — with no writer and
-- no reader of any kind. `network.tsx` has been rendering five invented vendors
-- from `@/data/survey` on a live route, which is O-025.
--
-- The schema around them is already careful, and none of it is relaxed here:
--
--   * **`network_vendors_consent`.** A listing cannot be published without
--     `consent_recorded_by` and `consent_recorded_at`. Publishing another
--     company's legal name, contact details and insurance status into a
--     directory every tenant can read, without their agreement on file, is the
--     one thing a vendor directory must never do.
--   * **`network_ratings_immutable`.** A rating is a statement of record. It is
--     not editable after the fact, and 0024 deliberately left the update policy
--     off so the intent is visible rather than trigger-only.
--   * **One rating per company per project**, `nulls not distinct`, so a company
--     that worked with a sub off-contract still gets exactly one say.
--
-- Two judgments this migration adds, because the schema could not make them:
--
--   * **Consent is its own act, not a checkbox.** `record_network_consent` takes
--     how it was obtained and stores it, and publishing refuses until it exists.
--     A form field beside "publish" would be initialled without being read.
--   * **A company may not rate its own listing.** RLS checks that the rater is
--     rating *as itself*; nothing stopped a company from posting a listing for a
--     sub and then giving it five stars. That is marking your own homework in a
--     directory other contractors make hiring decisions from.
--
-- WORKFLOW.
-- =============================================================================

/*
 * Where the consent note lives.
 *
 * The schema records *that* consent was given — who and when — and had nowhere
 * to say *how*. "Signed form, 3 March" and "somebody said it was fine" are not
 * the same claim, and the difference is the whole value of the record if the
 * vendor later says they never agreed. It sits on the listing rather than in
 * the audit trail so the company that made the claim can read it back.
 */
alter table network_vendors
  add column if not exists consent_note text;

comment on column network_vendors.consent_note is
  'How the vendor agreed to be listed, in the words of whoever recorded it. Stored beside consent_recorded_by and consent_recorded_at because "that consent exists" and "here is what it was" are different facts, and only the second one is worth anything in an argument.';

/**
 * Put a subcontractor in this company's own list.
 *
 * Unpublished. It is private to the company that made it until somebody records
 * the vendor's consent and publishes it — which is two more deliberate acts.
 */
create or replace function app.list_network_vendor(
  p_company uuid,
  p_legal_name text,
  p_display_name text default null,
  p_trades text[] default '{}',
  p_service_regions text[] default '{}',
  p_city text default null,
  p_state_province text default null,
  p_website text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_insurance_expires_on date default null,
  p_bonding_capacity numeric default null,
  p_is_dbe boolean default false,
  p_is_mbe boolean default false,
  p_is_wbe boolean default false,
  p_certifications text[] default '{}',
  p_vendor uuid default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'libraries.write');
  v_legal   text := nullif(trim(coalesce(p_legal_name, '')), '');
  v_id      uuid;
begin
  if v_legal is null then
    raise exception 'A listing needs the vendor''s legal name'
      using errcode = 'check_violation',
            hint = 'Other contractors look a sub up to check they are who they say they are.';
  end if;
  if p_vendor is not null
     and not exists (select 1 from vendors where id = p_vendor and company_id = v_company) then
    raise exception 'No such vendor in your library' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from network_vendors
              where owner_company_id = v_company and legal_name = v_legal) then
    raise exception 'You already list %', v_legal using errcode = 'unique_violation';
  end if;

  insert into network_vendors (
    owner_company_id, vendor_id, legal_name, display_name, trades, service_regions,
    city, state_province, website, contact_email, contact_phone,
    insurance_expires_on, bonding_capacity, is_dbe, is_mbe, is_wbe, certifications,
    is_published)
  values (v_company, p_vendor, v_legal,
          coalesce(nullif(trim(coalesce(p_display_name, '')), ''), v_legal),
          coalesce(p_trades, '{}'), coalesce(p_service_regions, '{}'),
          nullif(trim(coalesce(p_city, '')), ''),
          nullif(trim(coalesce(p_state_province, '')), ''),
          nullif(trim(coalesce(p_website, '')), ''),
          nullif(trim(coalesce(p_contact_email, '')), ''),
          nullif(trim(coalesce(p_contact_phone, '')), ''),
          p_insurance_expires_on, p_bonding_capacity,
          coalesce(p_is_dbe, false), coalesce(p_is_mbe, false), coalesce(p_is_wbe, false),
          coalesce(p_certifications, '{}'), false)
  returning id into v_id;
  return v_id;
end;
$$;

/** Correct a listing. Publishing and consent are their own acts, below. */
create or replace function app.update_network_vendor(
  p_listing uuid,
  p_display_name text default null,
  p_trades text[] default null,
  p_service_regions text[] default null,
  p_city text default null,
  p_state_province text default null,
  p_website text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_insurance_expires_on date default null,
  p_bonding_capacity numeric default null,
  p_is_dbe boolean default null,
  p_is_mbe boolean default null,
  p_is_wbe boolean default null,
  p_certifications text[] default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_l network_vendors%rowtype;
begin
  select * into v_l from network_vendors where id = p_listing;
  if v_l.id is null then
    raise exception 'No such listing' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_l.owner_company_id, 'libraries.write');

  update network_vendors
     set display_name         = coalesce(nullif(trim(coalesce(p_display_name, '')), ''), display_name),
         trades               = coalesce(p_trades, trades),
         service_regions      = coalesce(p_service_regions, service_regions),
         city                 = coalesce(nullif(trim(coalesce(p_city, '')), ''), city),
         state_province       = coalesce(nullif(trim(coalesce(p_state_province, '')), ''), state_province),
         website              = coalesce(nullif(trim(coalesce(p_website, '')), ''), website),
         contact_email        = coalesce(nullif(trim(coalesce(p_contact_email, '')), ''), contact_email),
         contact_phone        = coalesce(nullif(trim(coalesce(p_contact_phone, '')), ''), contact_phone),
         insurance_expires_on = coalesce(p_insurance_expires_on, insurance_expires_on),
         bonding_capacity     = coalesce(p_bonding_capacity, bonding_capacity),
         is_dbe               = coalesce(p_is_dbe, is_dbe),
         is_mbe               = coalesce(p_is_mbe, is_mbe),
         is_wbe               = coalesce(p_is_wbe, is_wbe),
         certifications       = coalesce(p_certifications, certifications),
         updated_at           = now()
   where id = p_listing;
end;
$$;

/**
 * Record that the vendor agreed to be listed.
 *
 * Its own act, with its own note about how the agreement was obtained, because
 * a checkbox beside "publish" gets initialled without being read. What is stored
 * is who at this company recorded it and when — a person putting their name to
 * the claim, which is what makes it worth anything if the vendor later says they
 * never agreed.
 */
create or replace function app.record_network_consent(
  p_listing uuid,
  p_how text)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_l   network_vendors%rowtype;
  v_how text := nullif(trim(coalesce(p_how, '')), '');
begin
  select * into v_l from network_vendors where id = p_listing;
  if v_l.id is null then
    raise exception 'No such listing' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_l.owner_company_id, 'libraries.write');
  if v_how is null or length(v_how) < 8 then
    raise exception 'Say how the vendor agreed to be listed'
      using errcode = 'check_violation',
            hint = 'Signed form 3 March, email from their office, agreed on the phone with their estimator. If they later say they never agreed, this sentence is the answer.';
  end if;

  update network_vendors
     set consent_recorded_by = auth.uid(),
         consent_recorded_at = now(),
         consent_note        = v_how,
         updated_at          = now()
   where id = p_listing;
end;
$$;

/** Put the listing in front of every other company, or take it back down. */
create or replace function app.publish_network_vendor(
  p_listing uuid,
  p_published boolean default true)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_l network_vendors%rowtype;
begin
  select * into v_l from network_vendors where id = p_listing;
  if v_l.id is null then
    raise exception 'No such listing' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_l.owner_company_id, 'libraries.write');

  if p_published and v_l.consent_recorded_at is null then
    raise exception 'Publishing "%" needs their consent on record first', v_l.legal_name
      using errcode = 'check_violation',
            hint = 'Their legal name, contact details and insurance status become readable by every company on the platform. Record how they agreed, then publish.';
  end if;

  update network_vendors
     set is_published = p_published,
         published_at = case when p_published then coalesce(published_at, now()) end,
         updated_at   = now()
   where id = p_listing;
end;
$$;

-- -----------------------------------------------------------------------------
-- What one contractor says about another
-- -----------------------------------------------------------------------------

/**
 * Rate a subcontractor you worked with.
 *
 * Four scores out of five and an optional note. `overall` is generated from the
 * four, so it cannot disagree with them, and the whole row is immutable once
 * written — 0023 decided that and it is right: a rating somebody can quietly
 * revise after a dispute is not a record of anything.
 *
 * **A company may not rate its own listing.** Row level security checks that a
 * rater is rating as itself and stops there; nothing prevented a company from
 * listing a sub and then giving it five stars. In a directory other contractors
 * make hiring decisions from, that is marking your own homework, and it is
 * refused here because there is nowhere else it could be.
 */
create or replace function app.rate_network_vendor(
  p_listing uuid,
  p_company uuid,
  p_quality int,
  p_schedule int,
  p_safety int,
  p_communication int,
  p_would_hire_again boolean,
  p_project uuid default null,
  p_comment text default null,
  p_contract_value numeric default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'crm.write');
  v_l       network_vendors%rowtype;
  v_id      uuid;
begin
  select * into v_l from network_vendors where id = p_listing;
  if v_l.id is null then
    raise exception 'No such listing' using errcode = 'no_data_found';
  end if;
  if not v_l.is_published then
    raise exception 'That listing is not published, so there is nothing for anybody to read'
      using errcode = 'check_violation';
  end if;
  if v_l.owner_company_id = v_company then
    raise exception 'You cannot rate a listing you own'
      using errcode = 'insufficient_privilege',
            hint = 'Other contractors hire from these ratings. A company scoring its own listing is marking its own homework.';
  end if;
  if p_project is not null
     and not exists (select 1 from projects where id = p_project and company_id = v_company) then
    raise exception 'That project is not yours' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from network_ratings
              where network_vendor_id = p_listing and rating_company_id = v_company
                and project_id is not distinct from p_project) then
    raise exception 'You have already rated % for that job', v_l.display_name
      using errcode = 'unique_violation',
            hint = 'A rating is a statement of record and is not editable. One per job is the whole point.';
  end if;

  insert into network_ratings (
    network_vendor_id, rating_company_id, project_id, quality, schedule, safety,
    communication, would_hire_again, comment, contract_value, rated_by)
  values (p_listing, v_company, p_project, p_quality, p_schedule, p_safety,
          p_communication, p_would_hire_again,
          nullif(trim(coalesce(p_comment, '')), ''), p_contract_value, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- What a screen reads
-- -----------------------------------------------------------------------------

create or replace view my_network_vendors
with (security_invoker = true) as
select v.id, v.owner_company_id, v.vendor_id, v.legal_name, v.display_name,
       v.trades, v.service_regions, v.city, v.state_province, v.website,
       v.contact_email, v.contact_phone, v.insurance_expires_on, v.bonding_capacity,
       v.is_dbe, v.is_mbe, v.is_wbe, v.certifications,
       v.is_published, v.published_at, v.consent_recorded_at, v.consent_note,
       app.is_member(v.owner_company_id)                    as is_mine,
       (v.consent_recorded_at is not null)                  as consent_on_record,
       (select count(*) from network_ratings r
         where r.network_vendor_id = v.id)                  as rating_count,
       /*
        * Rounded to one place and null where nobody has rated. An average of
        * one rating presented as a score is a number with more authority than
        * it has earned, so the count travels with it everywhere it is shown.
        */
       (select round(avg(r.overall), 1) from network_ratings r
         where r.network_vendor_id = v.id)                  as average_overall,
       (select round(avg(r.safety), 1) from network_ratings r
         where r.network_vendor_id = v.id)                  as average_safety,
       (select count(*) filter (where r.would_hire_again) from network_ratings r
         where r.network_vendor_id = v.id)                  as would_hire_again_count,
       /*
        * Compliance is the reason a contractor looks a sub up at all, so the
        * lapse is computed rather than left as two dates to compare.
        */
       case when v.insurance_expires_on is null then null
            else (v.insurance_expires_on - current_date) end as days_until_insurance_lapses,
       (v.insurance_expires_on is not null
        and v.insurance_expires_on < current_date)          as insurance_lapsed
  from network_vendors v;

revoke all on my_network_vendors from public, anon;
grant select on my_network_vendors to authenticated, service_role;

create or replace view my_network_ratings
with (security_invoker = true) as
select r.id, r.network_vendor_id, r.rating_company_id, r.project_id,
       r.quality, r.schedule, r.safety, r.communication, r.would_hire_again,
       r.overall, r.comment, r.contract_value, r.created_at,
       v.display_name                                       as vendor_name,
       app.is_member(r.rating_company_id)                   as is_mine,
       /*
        * Who said it is deliberately not exposed to other companies. A rating
        * carries weight because it is on the record, not because the reader
        * knows which contractor left it — and naming them turns a directory
        * into a place people settle scores.
        */
       case when app.is_member(r.rating_company_id) then p.number end as project_number
  from network_ratings r
  join network_vendors v on v.id = r.network_vendor_id
  left join projects p on p.id = r.project_id;

revoke all on my_network_ratings from public, anon;
grant select on my_network_ratings to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The doors
-- -----------------------------------------------------------------------------

create or replace function public.list_network_vendor(
  p_company uuid, p_legal_name text, p_display_name text default null,
  p_trades text[] default '{}', p_service_regions text[] default '{}',
  p_city text default null, p_state_province text default null,
  p_website text default null, p_contact_email text default null,
  p_contact_phone text default null, p_insurance_expires_on date default null,
  p_bonding_capacity numeric default null, p_is_dbe boolean default false,
  p_is_mbe boolean default false, p_is_wbe boolean default false,
  p_certifications text[] default '{}', p_vendor uuid default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.list_network_vendor(p_company, p_legal_name, p_display_name, p_trades,
       p_service_regions, p_city, p_state_province, p_website, p_contact_email,
       p_contact_phone, p_insurance_expires_on, p_bonding_capacity, p_is_dbe,
       p_is_mbe, p_is_wbe, p_certifications, p_vendor); $$;

create or replace function public.update_network_vendor(
  p_listing uuid, p_display_name text default null, p_trades text[] default null,
  p_service_regions text[] default null, p_city text default null,
  p_state_province text default null, p_website text default null,
  p_contact_email text default null, p_contact_phone text default null,
  p_insurance_expires_on date default null, p_bonding_capacity numeric default null,
  p_is_dbe boolean default null, p_is_mbe boolean default null,
  p_is_wbe boolean default null, p_certifications text[] default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_network_vendor(p_listing, p_display_name, p_trades,
       p_service_regions, p_city, p_state_province, p_website, p_contact_email,
       p_contact_phone, p_insurance_expires_on, p_bonding_capacity, p_is_dbe,
       p_is_mbe, p_is_wbe, p_certifications); $$;

create or replace function public.record_network_consent(p_listing uuid, p_how text)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.record_network_consent(p_listing, p_how); $$;

create or replace function public.publish_network_vendor(
  p_listing uuid, p_published boolean default true)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.publish_network_vendor(p_listing, p_published); $$;

create or replace function public.rate_network_vendor(
  p_listing uuid, p_company uuid, p_quality int, p_schedule int, p_safety int,
  p_communication int, p_would_hire_again boolean, p_project uuid default null,
  p_comment text default null, p_contract_value numeric default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.rate_network_vendor(p_listing, p_company, p_quality, p_schedule,
       p_safety, p_communication, p_would_hire_again, p_project, p_comment,
       p_contract_value); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.list_network_vendor(uuid, text, text, text[], text[], text, text, text, text, text, date, numeric, boolean, boolean, boolean, text[], uuid)',
    'public.update_network_vendor(uuid, text, text[], text[], text, text, text, text, text, date, numeric, boolean, boolean, boolean, text[])',
    'public.record_network_consent(uuid, text)',
    'public.publish_network_vendor(uuid, boolean)',
    'public.rate_network_vendor(uuid, uuid, int, int, int, int, boolean, uuid, text, numeric)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

select app.assert_security_gates();
