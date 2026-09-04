-- =============================================================================
-- GrounUp Enterprise — 0020 Policies for the ingestion pipeline
-- =============================================================================

select app.apply_tenant_rls('ingestion_jobs', null, 'documents.write');
select app.apply_tenant_rls('document_extractions', null, 'documents.write');
select app.apply_tenant_rls('knowledge_articles', null, 'documents.write');

do $$
declare
  t text;
  v_new constant text[] := array['ingestion_jobs', 'document_extractions', 'knowledge_articles'];
begin
  foreach t in array v_new loop
    perform app.attach_standard_triggers(format('public.%I', t)::regclass);
  end loop;
end $$;

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;
grant select on plans to anon;
grant select on plan_prices to anon;

select app.assert_security_gates();
