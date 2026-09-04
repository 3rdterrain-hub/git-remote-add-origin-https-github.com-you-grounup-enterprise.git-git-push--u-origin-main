# Data model

69 tables across 12 ordered migrations. Every business table carries `company_id`
and is isolated by row level security.

---

## Migration order

| File | Contents |
|---|---|
| `0001_foundation` | Extensions, the `app` helper schema, 15 shared enums, shared trigger functions |
| `0002_tenancy_identity` | Enterprise groups, companies, divisions, user profiles, roles, memberships, invitations |
| `0003_access_control` | RLS helper functions, the audit ledger, approval requests |
| `0004_master_libraries` | Cost codes, services, tasks, labor, equipment, crews, assemblies, materials, production rates, modifiers, pricing profiles, regional factors, vendors, disposal, trucking |
| `0005_crm_documents` | Customers, contacts, leads, opportunities, activities, documents, versions, sheets |
| `0006_estimating` | Estimates, versions, line items, resources, modifiers, indirects, assumptions, exclusions, conflicts, RFIs, bid reconciliation, proposals |
| `0007_projects` | Projects, tasks, dependencies, job cost, daily reports, production actuals, change orders, the award function |
| `0008_ai_governance` | AI agents, conversations, messages, findings, calibrations, risks |
| `0009_billing` | Plans, plan prices, subscriptions, items, entitlements, usage, Stripe events, invoices |
| `0010_rls` | Policy generators and every policy |
| `0011_triggers_provisioning` | Trigger attachment, system roles, provisioning, revision, the RLS coverage gate |
| `0012_grants` | Table privileges and the anonymous privilege gate |

---

## The tenancy spine

```
enterprise_groups          optional holding entity
      │
      ▼
  companies                THE TENANT BOUNDARY — company_id on every business table
      │
      ├── divisions        division / office / region / business unit
      │
      └── company_memberships ──▶ roles      the only source of tenant access
                │
                ▼
          auth.users / user_profiles
```

A user is global; their access to data is granted per company through
`company_memberships`. A membership carries one role and optionally a
`project_scope` array that narrows the member to specific projects.

`companies` also holds the configurability surface: estimating defaults (shift
hours, calendar efficiency, swell and shrink, fuel price, bid rounding), branding
colors, and a `terminology` JSONB map so a company can rename what GrounUp calls
things.

---

## Three-tier library scope

Library tables carry a nullable `company_id` **and** a nullable
`enterprise_group_id`, with a constraint that at most one is set:

| Scope | `company_id` | `enterprise_group_id` | Who can read | Who can write |
|---|---|---|---|---|
| GrounUp global seed | null | null | every tenant | nobody |
| Corporate standard | null | set | the group's companies | group administrators |
| Company override | set | null | that company | that company |

This is what lets a holding company publish a standard library while a subsidiary
keeps local rates, without either editing the other. It also keeps the shipped
benchmark stable, so "your production rate versus the GrounUp benchmark" stays a
meaningful question — which copying 4,671 records per tenant would destroy
immediately.

Library tables: `cost_codes`, `services`, `tasks`, `labor_rates`, `equipment`,
`crews`, `assemblies`, `materials`, `production_rates`, `condition_modifiers`,
`pricing_profiles`, `regional_factors`.

---

## Estimating

```
estimates ──▶ estimate_versions ──▶ estimate_line_items
                     │                      ├── estimate_line_resources
                     │                      └── estimate_line_modifiers
                     ├── estimate_indirects
                     ├── estimate_assumptions
                     ├── estimate_exclusions
                     ├── document_conflicts
                     ├── bid_reconciliations
                     ├── rfis
                     └── proposals
```

`estimate_versions` is the immutable unit of record. It stores every engine output
as its own column — the ten cost buckets separately, hours, fuel, duration,
weighted confidence, the applied contingency and its source, and the Section 59
executive decision — plus `engine_version` and `calculated_at`, so a reopened
estimate can be re-verified against the engine that priced it.

`estimate_line_items` holds the full quantity chain (measured, adjusted, gross,
waste, loss, the adjustment array as JSONB), the production analysis, the ten cost
buckets, the confidence and verification state, the approval gate with its reasons,
and the provenance of the line — including which AI agent proposed it and which
human accepted it.

### Constraints worth knowing

- `eli_waste_basis` — a waste factor above zero requires a stated basis (Section 31).
- `eli_ai_acceptance` — an AI-suggested line cannot sit at `auto_accept` without an
  identified human accepter.
- `estimate_line_modifiers.justification` must be at least 10 characters. A modifier
  changes the price; "n/a" is not an explanation.
- `estimate_versions_contingency_override` — an override requires both a reason and
  an approver.
- `opportunities_lost_reason` — a lost job must record why.
- `production_rates_provenance` — a rate cannot claim `company_actual` with a sample
  size of zero.
- `materials_waste_basis` — same rule at the catalog level.

---

## Projects and the learning loop

```
estimate_versions ──award──▶ projects ──▶ project_tasks ──▶ project_costs
                                  │              │
                                  │              └── source_line_item_id
                                  │                  (traces the budget back to
                                  │                   the estimate line that
                                  │                   priced it)
                                  ├── daily_reports
                                  ├── production_actuals ──▶ production_calibrations
                                  └── change_orders                    │
                                                          proposes a revised
                                                          catalog rate for
                                                          human approval
```

`app.award_estimate_version()` converts an approved or issued version into a
project, carrying every priced line across as a budgeted activity keyed back to its
source. It runs `SECURITY INVOKER`, so a user who cannot read the estimate cannot
award it either, and it refuses a version that still has lines blocking issue.

`production_actuals.actual_per_hour` is a generated column, so the achieved rate can
never disagree with the quantity and hours it came from. Rows carry the conditions
they were measured under — material, access, weather, haul distance — so calibration
compares like with like.

---

## AI governance

```
documents ──▶ document_versions ──▶ document_sheets
                                          │
                                          ▼
                                    ai_findings          the ONLY channel from AI
                                          │              output into business data
                                    human acceptance
                                          │
                                          ▼
                            applied_entity_table / applied_entity_id
```

A finding is inert until accepted. On acceptance the application writes the
corresponding business row and stamps `applied_entity_id`, which preserves the
provenance chain end to end.

`ai_agents` is a registry with a check constraint making a higher-than-draft
authority literally unconfigurable.

---

## Billing

```
plans ──▶ plan_prices                    the governed catalog Edge Functions validate against
  │
  └──▶ subscriptions ──▶ subscription_items
              │
              └──▶ entitlements          effective access per company
                        │
                  app.has_entitlement()  ── combined with ── app.has_permission()
                                                    │
                                              app.can_use()

stripe_events            every webhook, keyed by Stripe's event id (the idempotency barrier)
usage_events             metered usage; immutable once reported to Stripe
billing_invoices         display mirror; Stripe remains the system of record
```

`entitlements` is a table rather than a view so entitlement survives a Stripe
outage: if the API is unreachable, the last verified state still governs access,
and `valid_until` bounds how long that grace lasts.

A partial unique index enforces one live subscription per company, which keeps
entitlement resolution unambiguous.

---

## Generated columns

Values that must never drift from their inputs are computed by PostgreSQL:

| Table | Column | Definition |
|---|---|---|
| `labor_rates` | `burdened_cost_per_hour` | `base_wage_per_hour × (1 + burden_percent)` |
| `production_rates` | `daily_rate` | `rate_per_hour × utilization_factor × shift_hours` |
| `production_actuals` | `actual_per_hour` | `quantity_installed ÷ crew_hours` |
| `services` | `search_text` | name, category and subcategory, indexed with trigram |

A burdened rate that can be edited independently of its base wage will eventually
disagree with it, and nobody will know which is right.

---

## Enums

Fifteen enums in the `app` schema keep governed vocabularies closed rather than
free text: `record_status`, `approval_state`, `confidence_band`, `approval_gate`,
`verification_status`, `measurement_method`, `production_source`, `rate_source`,
`markup_method`, `estimate_status`, `unit_code`, `volume_state`, `modifier_target`,
`subscription_status`, `audit_action`.

`unit_code` and `volume_state` in particular mean a CY can never be stored where a
BCY was meant.

---

## The seed library

`supabase/seed/0001_global_library.sql` is generated by `tools/generate-seed.mjs`
from the governed GrounUp v2.0 catalog. Regenerate with `npm run seed:generate`;
never edit it by hand.

| Records | Count |
|---|---|
| Services (13 industries) | 188 |
| Tasks | 2,783 |
| Assemblies | 188 |
| Production rates | 1,452 |
| Labor classifications | 12 |
| Equipment items | 17 |
| Condition modifiers | 20 |
| Pricing profiles | 3 |
| Discipline crews | 8 |
| **Total catalog records** | **4,671** |

Plus 17 equipment rate sheets (one `global_seed` rate per machine) and the crew
member rows that compose the eight crews.

Two notes on faithfulness to the source:

- The source catalog writes production rates as `"CY/HR"`. The denominator is always
  the hour, so only the numerator is stored as `rate_unit`.
- The source condition modifier library records one factor plus a slash-separated
  target list (`"0.88 / Labor+Production"`), which is ambiguous about whether labor
  gets 12% slower or 12% cheaper. Each modifier is expanded into an **explicit factor
  per target** so it can only mean what it is written to mean. The five Section 7.1
  cost modifiers, absent from the source library, are added with their surcharges.

---

## Migrations 0023–0025 — survey, claims, the platform surface

| Migration | What it adds |
|---|---|
| `0023_survey_claims_api` | Surveys, surfaces, surface comparisons, machine control files and assignments, contracts, claims, the vendor network, API keys and the request log, metric definitions |
| `0024_survey_rls` | RLS, policies and grants for all of the above |
| `0025_semantic_layer` | Four reporting views and 16 seeded global metric definitions |

A few decisions in these are worth stating.

**`app.enforce_surface_datum_match()` refuses a comparison across surfaces on
different vertical datums, units or grids.** A volume computed between two
datums is wrong by the offset between them and looks entirely plausible, which
is the worst kind of wrong. The database will not produce the number at all.

**`app.derive_claim_deadlines()` computes the notice and claim deadlines from the
event date and the contract's own clauses.** Claims are lost on the notice
provision far more often than on the merits, so the deadline is derived from the
contract the moment an event is logged rather than remembered by whoever was on
site. Changing the event date re-derives both.

**`network_ratings` is unique on `(vendor, rating company, project)` with `NULLS
NOT DISTINCT`.** Without that clause PostgreSQL treats two NULL project ids as
different values, and a company could leave unlimited ratings for the same
vendor simply by never attaching a project. One rating per company per project
is what makes the history worth reading.

**`api_keys` stores a SHA-256 hash and a display prefix, never the key.** A key
is shown once at creation. A revoked key is retained rather than deleted, so the
request log still resolves to the key that made each call — answering "what did
that integration read last March" needs the key record to outlive its
revocation.

**`metric_definitions` follows the three-tier library scope.** A row with a null
`company_id` is a platform definition; a company may insert its own row with the
same key to override it. Two partial unique indexes enforce one global
definition per key and one override per company per key.

**Every `reporting_%` view sets `security_invoker = true`**, and migration 0025
ends with a `DO` block that raises if any does not. A view runs as its owner by
default, which bypasses RLS on every table beneath it — the property is asserted
at migration time rather than left to review.
