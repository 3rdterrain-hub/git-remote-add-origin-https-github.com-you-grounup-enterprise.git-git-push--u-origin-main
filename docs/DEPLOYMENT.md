# Deployment runbook

Takes a fresh Supabase project and a fresh Stripe account to a running GrounUp
installation.

---

## 0. Prerequisites

- Node 20.19 or newer
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- A Stripe account
- A host for the static frontend (Vercel, Netlify, Cloudflare Pages, S3+CloudFront)

---

## 1. Database

```bash
supabase link --project-ref your-project-ref
```

```bash
supabase db push
```

This applies all 12 migrations. Two gates run during the migration and will abort
the deployment if they fail:

- **RLS coverage** — every table in `public` must have row level security enabled
  and forced.
- **Anonymous privilege** — the `anon` role must not be able to read anything except
  `plans` and `plan_prices`.

Verify:

```sql
select * from rls_coverage where not rls_enabled or not rls_forced;
```

An empty result is correct.

### Load the seed library

```bash
psql "$DATABASE_URL" -f supabase/seed/0001_global_library.sql
```

```bash
psql "$DATABASE_URL" -f supabase/seed/0002_plan_catalog.sql
```

Confirm the 4,671 global-scope catalog records loaded:

```sql
select
  (select count(*) from services where company_id is null) as services,
  (select count(*) from tasks where company_id is null) as tasks,
  (select count(*) from production_rates where company_id is null) as rates,
  (select count(*) from plans) as plans;
```

Expect `188 | 2783 | 1452 | 5`.

### Attach the auth trigger

Supabase owns `auth.users`, so this cannot live in a migration:

```sql
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();
```

---

## 2. Storage buckets

Create four private buckets. Nothing in GrounUp should be a public bucket — plan
sets and cost data are commercially sensitive.

```bash
supabase storage create project-documents --private
supabase storage create proposals --private
supabase storage create company-assets --private
supabase storage create reports --private
```

Apply a storage policy per bucket so a member can only reach their own company's
objects. Objects are stored under `<company_id>/…`, so the first path segment is
the tenant key:

```sql
create policy "members read their company documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'project-documents'
  and (storage.foldername(name))[1]::uuid in (select app.current_company_ids())
);

create policy "members write their company documents"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-documents'
  and (storage.foldername(name))[1]::uuid in (select app.current_company_ids())
  and app.has_permission((storage.foldername(name))[1]::uuid, 'documents.write')
);
```

Repeat for the other three buckets, substituting the appropriate permission
(`proposals` and `reports` use `estimates.write` and `reports.read`;
`company-assets` uses `company.manage`).

> These policies are created through the dashboard or CLI rather than a migration,
> so they are **not** covered by the migration test suite. Verify them manually
> after deployment.

---

## 3. Stripe

### Create the products and prices

One product per plan, with a monthly and an annual price each. Then copy
`supabase/seed/0003_plan_prices.example.sql` to `0003_plan_prices.sql`, replace
every `price_REPLACE_…` with your real price id, and load it:

```bash
psql "$DATABASE_URL" -f supabase/seed/0003_plan_prices.sql
```

Prices are never hard-coded in the frontend. The app reads `plan_prices`, so
changing a price is a data change rather than a release.

### Set the function secrets

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set APP_URL=https://app.yourdomain.com
supabase secrets set ALLOWED_ORIGINS=https://app.yourdomain.com
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by
the platform.

> Never prefix any of these with `VITE_`. That would publish them to every visitor.

### Deploy the functions

```bash
supabase functions deploy create-checkout-session
supabase functions deploy create-billing-portal-session
supabase functions deploy change-subscription
supabase functions deploy cancel-subscription
supabase functions deploy get-effective-entitlements
```

The webhook must be deployed **without** JWT verification, because Stripe does not
send a Supabase token. Its signature check is what authenticates the caller:

```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

### Register the webhook endpoint

Point Stripe at:

```
https://your-project.supabase.co/functions/v1/stripe-webhook
```

Subscribe to exactly these events:

```
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
customer.subscription.paused
customer.subscription.resumed
customer.subscription.trial_will_end
invoice.paid
invoice.payment_failed
invoice.finalized
```

Then set the signing secret:

```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

### Verify the webhook locally before going live

```bash
stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook
```

```bash
stripe trigger customer.subscription.created
```

Confirm the event landed and was applied exactly once:

```sql
select id, type, processing_state, processed_at from stripe_events
order by received_at desc limit 5;
```

Then replay the same event from the Stripe dashboard and confirm the second
delivery returns `{"received":true,"duplicate":true}` and changes nothing.

---

## 4. Frontend

```bash
cp .env.example apps/web/.env.local
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Only those two — anything else
prefixed `VITE_` ships to every visitor.

```bash
npm run build
```

Deploy `apps/web/dist`. The app is a single-page application, so the host must
rewrite unknown paths to `/index.html`.

**Vercel** — `vercel.json`:
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

**Netlify** — `_redirects`:
```
/*  /index.html  200
```

---

## 5. Post-deployment verification

Work through these in order. Each one confirms a control that the test suite proves
in isolation but that depends on correct deployment.

1. **Sign up** a user and confirm `user_profiles` gained a row (the auth trigger).
2. **Provision a company**:
   ```sql
   select app.provision_company('Test Excavating', 'test-excavating', 'starter');
   ```
   Confirm a membership, a default pricing profile with three markup components,
   and a trial entitlement were created.
3. **Confirm tenant isolation** — create a second company under a second user and
   verify neither can see the other's estimates.
4. **Confirm the anonymous boundary** — signed out, `select` from `estimates` must
   fail with *permission denied*, while `plans` must return the four public plans.
5. **Run a checkout** in Stripe test mode and confirm entitlement activates only
   after the webhook is processed — not on the success redirect.
6. **Replay** the webhook and confirm nothing changes.
7. **Confirm the audit ledger is sealed**:
   ```sql
   update audit_events set reason = 'x' where id = (select min(id) from audit_events);
   ```
   Must raise `append-only`.

---

## 6. Operations

### Monitor

```sql
-- Webhooks that failed and need attention
select id, type, processing_error, attempts
from stripe_events where processing_state = 'failed'
order by received_at desc;

-- Entitlements about to lapse
select company_id, plan_id, valid_until from entitlements
where is_active and valid_until < now() + interval '7 days';

-- Estimates blocked from issue
select e.number, v.executive_decision, v.weighted_confidence
from estimate_versions v join estimates e on e.id = v.estimate_id
where v.blocked_from_issue and v.status in ('draft','in_review');
```

### Recover a failed webhook

Failed events remain in `stripe_events` with their full payload. Replay from the
Stripe dashboard; the claim row already exists, so re-processing is safe and the
handler is idempotent.

### Reconcile billing after an outage

If webhooks were lost, entitlement is still governed by the last verified state
until `valid_until`. Replay the missed events from Stripe rather than editing
`entitlements` by hand — a manual grant is possible but requires `granted_by` and
`grant_reason`, and it will show in the audit ledger as exactly that.

### Rotate the Stripe key

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_new
supabase functions deploy stripe-webhook --no-verify-jwt
```

Redeploy each billing function so it picks up the new secret. Rotating the webhook
signing secret requires updating the endpoint in Stripe first, then the secret, in
that order — the reverse rejects live traffic in between.

---

## Rollback

Migrations are forward-only by design; the audit ledger and estimate immutability
both assume history is never rewritten. To roll back a release, redeploy the
previous frontend build. The database schema is additive between releases, so an
older frontend runs against a newer schema.

---

## Automation

Two GitHub Actions workflows sit beside this runbook. The runbook remains the
authority on what a first deployment requires; the workflows are what keeps
every subsequent one identical.

### `verify.yml` — every commit

Runs `npm run verify`: typecheck, the OpenAPI drift check, the verification and
traceability ledger drift checks, every test suite, and a production build.
Then `npm run bundle:check` against what the build emitted.

It needs **no secrets at all**. The database tests run the production
migrations unmodified against PostgreSQL compiled to WebAssembly, and the
connector and billing suites are pure functions over recorded payloads. A
pipeline that needs credentials to run its tests cannot run on a fork's pull
request, and this one can.

### `deploy.yml` — dispatched by a person

Never runs on a push. A person dispatches it, names the environment, and it
runs behind a GitHub Environment so that environment's approval rules apply
before anything reaches a real database. It re-runs the full verification
first — a deployment that skips the gate to save eight minutes is how a broken
migration reaches production — then links the project, lists pending
migrations before applying them so the log records the diff, applies them,
deploys each function, and builds the browser bundle with that environment's
public URL and anon key.

## Where each secret lives

The split is the platform's central security property, and `npm run
bundle:check` fails the build if it is ever broken.

| Secret | Lives in | Reaches the browser |
|---|---|---|
| `STRIPE_SECRET_KEY` | Supabase Edge Function secrets | **Never** |
| `STRIPE_WEBHOOK_SECRET` | Supabase Edge Function secrets | **Never** |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge Function secrets | **Never** |
| `ANTHROPIC_API_KEY` | Supabase Edge Function secrets | **Never** |
| `SUPABASE_ACCESS_TOKEN` | GitHub Environment secret | **Never** |
| `SUPABASE_DB_PASSWORD` | GitHub Environment secret | **Never** |
| `SUPABASE_PROJECT_REF` | GitHub Environment secret | Never (not sensitive, but not needed there) |
| `VITE_SUPABASE_URL` | GitHub Environment secret | Yes, by design |
| `VITE_SUPABASE_ANON_KEY` | GitHub Environment secret | Yes, by design — row level security is what makes that safe |

Set the Supabase secrets with `supabase secrets set` against the project, and
the GitHub ones under Settings → Environments. Nothing in this repository
contains any of them, and nothing should: the workflows reference them by name.

`bundle:check` enforces the split two independent ways — by name, refusing a
`VITE_` variable that carries a server secret's name, since Vite embeds every
`VITE_` variable by design; and by shape, searching the emitted files for the
literal forms of the credentials themselves, including all three base64
alignments a `service_role` JWT payload can take. A key smuggled under an
innocent variable name is still a key.

## What is not automated

Stated so nobody assumes otherwise:

- **No environment exists yet.** These workflows describe how to deploy; they
  have not deployed anything.
- **No rollback automation.** The Rollback section above is manual, and
  migrations are forward-only — a mistake is corrected by a new migration.
- **No smoke test after deploy.** The workflow verifies before deploying and
  does not probe the deployed system afterwards.
- **No infrastructure as code.** Buckets, policies and Stripe products are
  created by hand from this runbook.
