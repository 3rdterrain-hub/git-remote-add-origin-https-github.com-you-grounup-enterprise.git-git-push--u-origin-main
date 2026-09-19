-- =============================================================================
-- 0235 — The customer reads what the bid excludes
--
-- 0232 put the exclusions and assumptions onto the proposal, and the same day
-- they reached exactly one of the two documents that exist. The contractor
-- downloading from the Proposals screen got a bid stating what it did not
-- cover; the customer opening the signed link — the only person whose copy
-- matters — got the version without them, because `open_proposal_by_token` was
-- written before those rows existed and hands back a fixed set of fields.
--
-- That is the wrong way round in the way that costs money. An exclusion
-- protects a contractor only if the person who accepted the bid received it. A
-- customer who signs a document with no rock clause has accepted a bid with no
-- rock clause, whatever the contractor's own copy said.
--
-- So the token payload carries them, on the same terms as everything else it
-- carries:
--
--   * **Only what was marked as shown to the customer.** 0006's
--     `is_disclosed_to_customer` decides, per assumption, and the estimator's
--     internal working stays internal. Exclusions are all disclosed by nature —
--     an exclusion nobody is told about excludes nothing.
--   * **Each with its reason.** The bare noun invites "you should have allowed
--     for it"; the reason is the half that ends the argument, and it is the
--     half the customer has to have seen.
--
-- This is still the one place tenant data reaches an anonymous caller, and it
-- widens by two lists that are, by definition, the parts of the estimate
-- written to be read by the person holding the link.
--
-- WORKFLOW.
-- =============================================================================

create or replace function app.open_proposal_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_l   proposal_share_links%rowtype;
  v_p   proposals%rowtype;
  v_co  companies%rowtype;
  v_lines jsonb;
  v_excl  jsonb;
  v_assum jsonb;
begin
  select * into v_l from app.proposal_link_for_token(p_token);

  select * into v_p  from proposals where id = v_l.proposal_id;
  select * into v_co from companies where id = v_l.company_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'description', pl.description,
           'quantity',    case when v_p.show_line_detail then pl.quantity end,
           'unit',        case when v_p.show_line_detail then pl.unit end,
           'unitPrice',   case when v_p.show_unit_prices then pl.unit_price end,
           'total',       pl.total_price)
           order by pl.sort_order), '[]'::jsonb)
    into v_lines
    from proposal_lines pl
   where pl.proposal_id = v_p.id;

  /*
   * From the estimate version the proposal cites, which is the version the
   * price came from — so the exclusions the customer reads are the ones that
   * were true of the number in front of them.
   */
  select coalesce(jsonb_agg(jsonb_build_object(
           'exclusion', e.exclusion, 'reason', e.reason)
           order by e.sort_order, e.created_at), '[]'::jsonb)
    into v_excl
    from estimate_exclusions e
   where e.estimate_version_id = v_p.estimate_version_id;

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
                        'state', v_co.state_province),
    'recipientName',  v_l.recipient_name,
    'expiresAt',      v_l.expires_at);
end;
$$;

comment on function app.open_proposal_by_token(text) is
  'The proposal a valid link entitles its holder to read, honoring the proposal''s own line-detail and unit-price settings, and carrying what the bid excludes and the assumptions marked as shown to the customer. The single place tenant data reaches an anonymous caller. WORKFLOW.';

select app.assert_security_gates();
