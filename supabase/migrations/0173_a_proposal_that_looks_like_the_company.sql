/**
 * A proposal that looks like the company sending it.
 *
 * `companies.logo_path`, `companies.primary_color` and `companies.accent_color`
 * have existed since migration 0002 — with a hex check constraint on both
 * colors and a comment saying the logo is "stored as storage object paths,
 * never as blobs". Across the whole repository those three columns are
 * mentioned in exactly one file: the migration that created them. Nothing
 * writes them and nothing reads them, so every proposal this platform has ever
 * sent went out in the platform's colors with no mark of the company sending
 * it.
 *
 * Two things were missing and neither is the column. There was nowhere to put
 * the file, and there was no way for the customer to see it.
 *
 * **The bucket is public, deliberately.** `project-documents` is private
 * because a plan set is a customer's competitive position before it is a
 * drawing. A logo is the opposite: it is the mark a company puts on the side of
 * its trucks. It has to render in a proposal opened from an emailed link by
 * somebody with no account and no session, and a signed URL that expires is a
 * letterhead that disappears from a document the customer keeps. Writing is
 * still gated on `company.manage` — public to read is not public to replace.
 *
 * ENTITY.
 */

-- -----------------------------------------------------------------------------
-- Somewhere to put the file
-- -----------------------------------------------------------------------------

/*
 * Guarded on the storage schema existing, the way 0119 is: the test harness has
 * no `storage`, and everything else in this migration still has to apply.
 */
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'storage' and table_name = 'buckets') then
    /*
     * Five megabytes and image types only. A letterhead is a logo, not a
     * scanned brochure, and an unbounded public bucket is a file host.
     */
    execute $b$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('company-branding', 'company-branding', true, 5242880,
              array['image/png','image/jpeg','image/webp','image/svg+xml'])
      on conflict (id) do update
        set public = true,
            file_size_limit = 5242880,
            allowed_mime_types = array['image/png','image/jpeg','image/webp','image/svg+xml']
    $b$;

    /*
     * The first path segment is the company id, exactly as in 0119, so a policy
     * can tell whose file an object is from its name alone.
     */
    execute $p$
      drop policy if exists company_branding_write on storage.objects;
      create policy company_branding_write on storage.objects
        for insert to authenticated
        with check (bucket_id = 'company-branding'
                    and app.is_member(nullif(split_part(name, '/', 1), '')::uuid)
                    and app.has_permission(
                          nullif(split_part(name, '/', 1), '')::uuid, 'company.manage'));
    $p$;
    execute $p$
      drop policy if exists company_branding_update on storage.objects;
      create policy company_branding_update on storage.objects
        for update to authenticated
        using (bucket_id = 'company-branding'
               and app.is_member(nullif(split_part(name, '/', 1), '')::uuid)
               and app.has_permission(
                     nullif(split_part(name, '/', 1), '')::uuid, 'company.manage'));
    $p$;
    execute $p$
      drop policy if exists company_branding_delete on storage.objects;
      create policy company_branding_delete on storage.objects
        for delete to authenticated
        using (bucket_id = 'company-branding'
               and app.is_member(nullif(split_part(name, '/', 1), '')::uuid)
               and app.has_permission(
                     nullif(split_part(name, '/', 1), '')::uuid, 'company.manage'));
    $p$;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Letting the customer see it
-- -----------------------------------------------------------------------------

/**
 * The proposal a valid link entitles its holder to read.
 *
 * Rebuilt from the 0166 definition — the only one there has ever been — with
 * the company's branding added to the block that already carried its name and
 * city. Everything else is unchanged, including the two settings that decide
 * how much of the estimate the customer sees.
 *
 * This is still the single place tenant data reaches an anonymous caller, so
 * what is added here is added deliberately: a name, a mark and two colors. Not
 * the logo bytes, and not a signed URL — the path, which the page turns into
 * the bucket's public URL. A company that has set no logo sends null and the
 * proposal falls back to its name set in type, which is what it did before.
 */
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
             'description', l.description,
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
  'The proposal a valid link entitles its holder to read, in the sending company''s own colors and mark, honoring the proposal''s own line-detail and unit-price settings. The single place tenant data reaches an anonymous caller. WORKFLOW.';

/*
 * No `my_company_branding` view.
 *
 * One was written here and then removed before this migration was applied: the
 * three columns are already on the row `loadCompanyProfile` reads, and the
 * signing page gets them inside `open_proposal_by_token` because an anonymous
 * caller cannot select from a view at all. A second way to ask the same
 * question is how two screens come to show different colors.
 */
