-- =============================================================================
-- 0236 — Restoring what 0235 overwrote
--
-- 0235 set out to carry the exclusions to the customer's copy and did real
-- damage on the way. `open_proposal_by_token` had been replaced twice since it
-- was written — 0173 added the company's mark and colors, 0174 made the line
-- read with the words the estimator wrote for the customer rather than the
-- internal description — and 0235 was built from the 0166 original, which has
-- neither. Replacing a function from an old copy of it silently reverts every
-- later migration that touched it.
--
-- Three things went with it, and the suite named all three:
--
--   * `app.share_link_for_token` was written as `app.proposal_link_for_token`,
--     a name that has never existed. Invented from a partial reading rather
--     than copied from the function being replaced.
--   * The lines came from `proposal_lines`. They come from
--     `estimate_line_items`, filtered by `client_visible` — so a line the
--     estimator kept back was about to be shown to the customer.
--   * `if v_p.show_line_detail` was flattened into CASE expressions, so a
--     proposal sent as a lump sum would have arrived itemized.
--
-- The lesson is the one the estimate line already taught: do not rebuild a
-- thing from a recollection of it. This is 0174's body, copied whole, with two
-- fields added and nothing else touched.
--
-- WORKFLOW.
-- =============================================================================

create or replace function app.open_proposal_by_token(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_l     proposal_share_links%rowtype;
  v_p     proposals%rowtype;
  v_co    companies%rowtype;
  v_lines jsonb := '[]'::jsonb;
  v_excl  jsonb := '[]'::jsonb;
  v_assum jsonb := '[]'::jsonb;
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

  /*
   * What the bid does not cover, and what it was priced on.
   *
   * Not behind `show_line_detail`. That setting decides whether a customer sees
   * the work broken out; it has nothing to do with whether they are told the
   * price excludes rock. A lump sum with hidden exclusions is the worst of both.
   */
  select coalesce(jsonb_agg(jsonb_build_object(
           'exclusion', e.exclusion, 'reason', e.reason)
         order by e.sort_order, e.created_at), '[]'::jsonb)
    into v_excl
    from estimate_exclusions e
   where e.estimate_version_id = v_p.estimate_version_id;

  /* Only what was marked as shown to the customer; the working stays inside. */
  select coalesce(jsonb_agg(jsonb_build_object(
           'assumption', a.assumption, 'reason', a.reason)
         order by a.created_at), '[]'::jsonb)
    into v_assum
    from estimate_assumptions a
   where a.estimate_version_id = v_p.estimate_version_id
     and a.is_disclosed_to_customer;

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
    'exclusions',     v_excl,
    'assumptions',    v_assum,
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
  'The proposal a valid link entitles its holder to read, in the words the estimator chose for the customer, in the sending company''s colors, honoring the line-detail and unit-price settings, and carrying what the bid excludes and the assumptions marked as shown to them. The single place tenant data reaches an anonymous caller. WORKFLOW.';

select app.assert_security_gates();
