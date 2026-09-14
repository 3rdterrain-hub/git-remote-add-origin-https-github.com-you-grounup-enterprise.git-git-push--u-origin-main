/**
 * The words the estimator chose for the customer.
 *
 * The estimate line carries a box labeled "Description for client…". It writes
 * `estimate_line_items.notes` — and every customer-facing path renders
 * `description`, the internal wording. So an estimator carefully rewording a
 * line for the client has never once changed anything a client saw.
 *
 * That is the second defect this build produces, in its quietest form: a
 * control that takes a value and changes nothing. It does not fail, it does not
 * warn, and the value is right there in the database being read by nobody.
 *
 * One `coalesce`. The client's wording where there is one, the line's own where
 * there is not.
 *
 * ---
 *
 * Written after a wrong turn worth recording. This migration started out
 * copying the client-visible lines onto `proposal_line_items` at issue, on the
 * belief that reading `estimate_line_items` live let an issued proposal change
 * underneath the customer. **It does not.** Migration 0111 froze every child of
 * an approved version — including against a direct PostgREST write, which is
 * the exact route it was written to close. `app.refuse_when_version_frozen`
 * covers the lines, so what the customer opens cannot move.
 *
 * `proposal_line_items` therefore stays empty, and stays that way honestly: it
 * is the right home for proposal alternates and options (`is_alternate`,
 * `is_optional`) whenever those are built, and `app.proposal_base_total` and
 * the integrity check in 0045 are waiting for it. Filling it now would be a
 * second copy of the lines with nothing to gain and a rounding decision to get
 * wrong.
 *
 * ---
 *
 * And the reason nobody had noticed: **no proposal could show a line at all.**
 * `proposals.show_line_detail` is `not null default false`, `issue_proposal`
 * has never set it, and `enforce_proposal_immutability` permits only status and
 * the acceptance fields to change afterwards. So the flag was false on every
 * proposal ever issued, permanently, and the block of `open_proposal_by_token`
 * that renders lines has never executed for anybody.
 *
 * A lump sum with the detail withheld is a real choice, and it is the one thing
 * this platform could do. The other one is now available: the estimator says
 * what the customer sees at the moment of issuing, which is the only moment the
 * decision can be made.
 *
 * WORKFLOW.
 */

/*
 * The four-argument form goes, rather than sitting beside the new one.
 *
 * Adding parameters to a Postgres function creates an overload; it does not
 * replace anything. Two `issue_proposal`s would mean a four-argument call
 * silently resolving to the old body — the one that cannot set the flags — and
 * that is a worse failure than a missing function, because it looks like it
 * worked. The public wrapper is replaced below in the same transaction.
 */
drop function if exists public.issue_proposal(uuid, text, text, integer);
drop function if exists app.issue_proposal(uuid, text, text, integer);

/**
 * Issue a proposal, and say what the customer sees of it.
 *
 * Rebuilt from the 0097 definition — the only one there has ever been — with
 * the two presentation flags added. Defaults match the column defaults, so
 * nothing that already calls this changes behavior.
 */
create or replace function app.issue_proposal(
  p_version uuid,
  p_title text default null,
  p_cover_letter text default null,
  p_validity_days int default 30,
  p_show_line_detail boolean default false,
  p_show_unit_prices boolean default true)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_v estimate_versions%rowtype;
  v_e estimates%rowtype;
  v_number text;
  v_id uuid;
begin
  select * into v_v from estimate_versions where id = p_version;
  if not found then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_v.company_id, 'estimates.issue') then
    raise exception 'You do not have permission to issue a proposal'
      using errcode = 'insufficient_privilege';
  end if;
  if v_v.status not in ('approved', 'issued') then
    raise exception 'An estimate is approved before a proposal goes out'
      using errcode = 'check_violation';
  end if;
  if v_v.total_price <= 0 then
    raise exception 'That version has no price on it' using errcode = 'check_violation';
  end if;
  perform app.assert_issuable(p_version);

  select * into v_e from estimates where id = v_v.estimate_id;

  select 'P-' || to_char(now(), 'YYYY') || '-' || lpad((count(*) + 1)::text, 4, '0')
    into v_number
    from proposals p
   where p.company_id = v_v.company_id
     and date_trunc('year', p.created_at) = date_trunc('year', now());

  insert into proposals (company_id, estimate_version_id, customer_id, number, title,
                         cover_letter, validity_days, total_price, status,
                         show_line_detail, show_unit_prices, issued_at, created_by)
  values (v_v.company_id, p_version, v_e.customer_id, v_number,
          coalesce(nullif(trim(coalesce(p_title, '')), ''), v_e.name),
          nullif(trim(coalesce(p_cover_letter, '')), ''),
          greatest(coalesce(p_validity_days, 30), 1),
          -- Frozen. A proposal is what the customer was sent.
          v_v.total_price, 'issued',
          coalesce(p_show_line_detail, false), coalesce(p_show_unit_prices, true),
          now(), auth.uid())
  returning id into v_id;

  if v_v.status <> 'issued' then
    perform app.set_estimate_status(p_version, 'issued',
      'Proposal ' || v_number || ' issued');
  end if;

  return v_id;
end;
$$;

comment on function app.issue_proposal(uuid, text, text, integer, boolean, boolean) is
  'Issues a proposal and records what the customer is shown of it. The two presentation flags were unreachable before 0174: false by default, never set, and frozen on issue. WORKFLOW.';

create or replace function app.open_proposal_by_token(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_l     proposal_share_links%rowtype;
  v_p     proposals%rowtype;
  v_co    companies%rowtype;
  v_lines jsonb := '[]'::jsonb;
begin
  v_l := app.share_link_for_token(p_token);
  select * into v_p  from proposals where id = v_l.proposal_id;
  select * into v_co from companies where id = v_l.company_id;

  if v_p.show_line_detail then
    select coalesce(jsonb_agg(jsonb_build_object(
             /*
              * What the estimator wrote for the customer, falling back to the
              * line's own words. `notes` is where the "Description for client"
              * box has always written; this is the first thing that reads it.
              */
             'description', coalesce(nullif(btrim(coalesce(l.notes, '')), ''),
                                     l.description),
             'quantity',    l.adjusted_quantity,
             'unit',        l.unit,
             'unitPrice',   case when v_p.show_unit_prices then l.unit_price else null end,
             'total',       l.total_price)
           order by l.sort_order), '[]'::jsonb)
      into v_lines
      from estimate_line_items l
     where l.estimate_version_id = v_p.estimate_version_id
       and l.client_visible;
  end if;

  update proposal_share_links
     set opened_at = coalesce(opened_at, now()),
         opened_count = opened_count + 1
   where id = v_l.id;

  return jsonb_build_object(
    'proposalId',     v_p.id,
    'number',         v_p.number,
    'title',          v_p.title,
    'coverLetter',    v_p.cover_letter,
    'commercialTerms',v_p.commercial_terms,
    'paymentTerms',   v_p.payment_terms,
    'totalPrice',     v_p.total_price,
    'issuedAt',       v_p.issued_at,
    'validityDays',   v_p.validity_days,
    'showLineDetail', v_p.show_line_detail,
    'showUnitPrices', v_p.show_unit_prices,
    'lines',          v_lines,
    'company',        jsonb_build_object(
                        'name',  v_co.name,
                        'city',  v_co.city,
                        'state', v_co.state_province,
                        'logoPath',     v_co.logo_path,
                        'primaryColor', v_co.primary_color,
                        'accentColor',  v_co.accent_color),
    'recipientName',  v_l.recipient_name,
    'expiresAt',      v_l.expires_at);
end;
$$;

comment on function app.open_proposal_by_token(text) is
  'The proposal a valid link entitles its holder to read, in the estimator''s own words for the customer and the sending company''s colors. The single place tenant data reaches an anonymous caller. WORKFLOW.';


create or replace function public.issue_proposal(
  p_version uuid, p_title text default null, p_cover_letter text default null,
  p_validity_days int default 30,
  p_show_line_detail boolean default false, p_show_unit_prices boolean default true)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin
  return app.issue_proposal(p_version, p_title, p_cover_letter, p_validity_days,
                            p_show_line_detail, p_show_unit_prices);
end; $$;

do $$
declare f text := 'public.issue_proposal(uuid, text, text, integer, boolean, boolean)';
begin
  execute format('revoke all on function %s from public, anon', f);
  execute format('grant execute on function %s to authenticated', f);
end $$;
