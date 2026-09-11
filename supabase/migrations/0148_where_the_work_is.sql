-- =============================================================================
-- 0148 — Where the work is
--
-- `estimates.site_address`, `site_city` and `site_state` have existed since
-- migration 0006. `app.award_estimate_version` reads all three and copies them
-- onto the project it creates, which is how a job knows where it is — and it is
-- what the site forecast in 0143 needs, because a forecast at the yard is a
-- different claim from one at the site.
--
-- Nothing has ever written them. Not at creation, not afterwards. Every
-- estimate in every deployment has carried three nulls, so every project
-- awarded from one has too, and the weather panel has been reporting from the
-- yard with no way for anybody to change that.
--
-- Found by awarding a real estimate and reading the project: `site_city` was
-- null, and the estimate it came from had never been asked.
--
-- Two functions, because an address arrives at two different moments. The bid
-- invitation usually carries one, so creation takes it; and it often does not,
-- or it changes, so there is a setter — the same shape and the same reasoning
-- as the expiry in 0102.
--
-- The creation signature is replaced rather than overloaded, which is the rule
-- 0102 set when it did the same thing: two functions that both create an
-- estimate is how one of them ends up missing a rule.
--
-- Entity: Estimate.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Setting it afterwards
--
-- Separate from creation because the answer often arrives later, and changes:
-- a bid invitation that names a county and a parcel becomes a street address
-- once somebody drives out to look at it.
-- -----------------------------------------------------------------------------
create or replace function app.set_estimate_site(
  p_estimate uuid,
  p_site_address text,
  p_site_city text,
  p_site_state text)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_e estimates%rowtype;
begin
  select * into v_e from estimates where id = p_estimate;
  if not found then
    raise exception 'No such estimate' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_e.company_id, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  /*
   * The same statuses `set_estimate_expiry` refuses. Where the work is is part
   * of what was bid: changing it under an issued price would move the job
   * without moving the number, and the project awarded from it copies this.
   */
  if v_e.status in ('issued', 'awarded', 'lost', 'archived') then
    raise exception 'This estimate is %; where the work is was part of what went out', v_e.status
      using errcode = 'check_violation',
            hint = 'Revise the estimate, or set the site on the project itself.';
  end if;

  update estimates
     set site_address = nullif(trim(coalesce(p_site_address, '')), ''),
         site_city    = nullif(trim(coalesce(p_site_city, '')), ''),
         -- Two letters, upper case, because a forecast is looked up by them and
         -- "oh" and "OH" are not the same string to anything downstream.
         site_state   = nullif(upper(trim(coalesce(p_site_state, ''))), ''),
         updated_at   = now()
   where id = p_estimate;
end;
$$;

comment on function app.set_estimate_site(uuid, text, text, text) is
  'Sets where the work is. Read by app.award_estimate_version, which copies it onto the project — which is what lets the site forecast be the site''s rather than the yard''s. Refused once the estimate has gone out, because where the work is was part of what was bid.';

revoke all on function app.set_estimate_site(uuid, text, text, text) from public, anon;
grant execute on function app.set_estimate_site(uuid, text, text, text) to authenticated;

create or replace function public.set_estimate_site(
  p_estimate uuid, p_site_address text, p_site_city text, p_site_state text)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.set_estimate_site(p_estimate, p_site_address, p_site_city, p_site_state); end; $$;

revoke all on function public.set_estimate_site(uuid, text, text, text) from public, anon;
grant execute on function public.set_estimate_site(uuid, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- And creation takes it, because the bid invitation usually carries one
-- -----------------------------------------------------------------------------
drop function if exists app.create_estimate(text, uuid, text, timestamptz, uuid, timestamptz, text);
drop function if exists public.create_estimate(text, uuid, text, timestamptz, uuid, timestamptz, text);

create or replace function app.create_estimate(
  p_name text,
  p_customer_id uuid default null,
  p_number text default null,
  p_bid_due_at timestamptz default null,
  p_company uuid default null,
  p_expires_at timestamptz default null,
  p_description text default null,
  p_site_address text default null,
  p_site_city text default null,
  p_site_state text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_estimate uuid;
  v_version uuid;
  v_number text;
  v_profile uuid;
begin
  /*
   * A person can belong to more than one company and the application has no
   * switcher yet, so the sole membership is the answer when there is exactly
   * one. Two memberships and no argument is a question, not a default: guessing
   * would file a bid under the wrong company.
   */
  if p_company is not null then
    v_company := p_company;
  else
    select company_id into v_company from company_memberships
     where user_id = auth.uid() and status = 'active' limit 2;
    if (select count(*) from company_memberships
         where user_id = auth.uid() and status = 'active') > 1 then
      raise exception 'You belong to more than one company; say which this estimate is for'
        using errcode = 'check_violation';
    end if;
  end if;
  if v_company is null then
    raise exception 'Open a company before creating an estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to create an estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'An estimate needs a name' using errcode = 'check_violation';
  end if;
  if p_customer_id is not null
     and not exists (select 1 from customers c
                      where c.id = p_customer_id and c.company_id = v_company) then
    raise exception 'That customer is not one of yours' using errcode = 'no_data_found';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'An expiry in the past would expire it immediately'
      using errcode = 'check_violation';
  end if;

  v_number := nullif(trim(coalesce(p_number, '')), '');
  if v_number is null then
    select 'E-' || to_char(now(), 'YYYY') || '-' ||
           lpad((count(*) + 1)::text, 4, '0')
      into v_number
      from estimates e
     where e.company_id = v_company
       and date_trunc('year', e.created_at) = date_trunc('year', now());
  end if;
  if exists (select 1 from estimates e
              where e.company_id = v_company and e.number = v_number) then
    v_number := v_number || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
  end if;

  select default_pricing_profile_id into v_profile from companies where id = v_company;

  insert into estimates (company_id, number, name, description, customer_id, status,
                         bid_due_at, expires_at, estimator_id, created_by,
                         site_address, site_city, site_state)
  values (v_company, v_number, trim(p_name),
          nullif(trim(coalesce(p_description, '')), ''), p_customer_id, 'draft',
          p_bid_due_at, p_expires_at, auth.uid(), auth.uid(),
          nullif(trim(coalesce(p_site_address, '')), ''),
          nullif(trim(coalesce(p_site_city, '')), ''),
          nullif(upper(trim(coalesce(p_site_state, ''))), ''))
  returning id into v_estimate;

  /*
   * Version one, carrying the company's own pricing profile. An estimate with
   * no version is an estimate nothing can be added to, so the two are made
   * together or not at all.
   */
  insert into estimate_versions (company_id, estimate_id, version_number, status,
                                 pricing_profile_id, created_by)
  values (v_company, v_estimate, 1, 'draft', v_profile, auth.uid())
  returning id into v_version;

  update estimates set current_version_id = v_version where id = v_estimate;

  return v_estimate;
end;
$$;

revoke all on function app.create_estimate(text, uuid, text, timestamptz, uuid, timestamptz, text, text, text, text)
  from public, anon;
grant execute on function app.create_estimate(text, uuid, text, timestamptz, uuid, timestamptz, text, text, text, text)
  to authenticated;

create or replace function public.create_estimate(
  p_name text,
  p_customer_id uuid default null,
  p_number text default null,
  p_bid_due_at timestamptz default null,
  p_company uuid default null,
  p_expires_at timestamptz default null,
  p_description text default null,
  p_site_address text default null,
  p_site_city text default null,
  p_site_state text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
begin
  return app.create_estimate(p_name, p_customer_id, p_number, p_bid_due_at, p_company,
                             p_expires_at, p_description,
                             p_site_address, p_site_city, p_site_state);
end;
$$;

comment on function public.create_estimate(text, uuid, text, timestamptz, uuid, timestamptz, text, text, text, text) is
  'Creates an estimate and its first version. Takes where the work is, which award_estimate_version copies onto the project — three columns that existed since 0006 and were written by nothing until 0148.';

revoke all on function public.create_estimate(text, uuid, text, timestamptz, uuid, timestamptz, text, text, text, text)
  from public, anon;
grant execute on function public.create_estimate(text, uuid, text, timestamptz, uuid, timestamptz, text, text, text, text)
  to authenticated;

select app.assert_security_gates();
