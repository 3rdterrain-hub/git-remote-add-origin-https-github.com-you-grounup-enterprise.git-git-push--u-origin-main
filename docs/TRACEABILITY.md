# Requirements traceability

The brief mapped to what exists, with an honest status on each item.

**Legend** — ✅ built and tested · ◐ built, partially covered · ○ scaffolded (data model
and architectural place, no screens) · ✗ not built

---

## The specified first task — landing page

| Requirement | Status | Where |
|---|---|---|
| Responsive nav: logo left; Home, Features, About, Pricing, Login right | ✅ | `pages/landing.tsx` |
| Primary CTA "Start Building Estimates" / "Start Free" | ✅ | both present |
| Headline "Estimate Smarter. Build Better. Run Everything From the Ground Up." | ✅ | verbatim, asserted by test |
| Subheadline covering the four capability areas | ✅ | |
| Primary CTA and secondary "See How It Works" | ✅ | |
| Dashboard / product preview area | ✅ | renders **live engine output** |
| Three benefit cards (estimates, plans, run the job) | ✅ | exact titles |
| Built for construction: all eleven sectors | ✅ | asserted individually |
| Security section: tenancy, permissions, audit, governed AI, human approval | ✅ | four cards |
| Pricing CTA routing to the Stripe flow | ✅ | → `/pricing` → Edge Function |
| Footer: Product, Company, Support, Privacy, Terms, Login | ✅ | |
| Supabase structure ready for auth, data, storage, Stripe | ✅ | 12 migrations, 5 functions |
| Expandable to the full architecture without restructuring | ✅ | 69 tables already in place |

---

## The twelve required pages

| # | Page | Status | Notes |
|---|---|---|---|
| 1 | Landing | ✅ | |
| 2 | Sign up / Login | ✅ | Supabase Auth; email/password, reset, verification |
| 3 | Dashboard | ✅ | KPIs, active estimate, AI queue, bids due, project health, earthwork, activity, quick actions |
| 4 | Estimating Workspace | ✅ | Six tabs; per-line expansion exposing the entire derivation |
| 5 | Plans & Specifications | ✅ | Document register with supersession; AI findings with citations and accept/reject |
| 6 | Projects / Operations | ✅ | Status, cost variance, the calibration loop, project detail |
| 7 | CRM / Customers | ✅ | Pipeline by stage, opportunities, customers, win/loss with required reasons |
| 8 | Master Libraries | ✅ | Six tabs across labor, equipment, crews, production, modifiers, pricing |
| 9 | Reports & Analytics | ✅ | All figures derived from the same governed records |
| 10 | Company / Admin Settings | ✅ | Six tabs: company, estimating defaults, users and roles, branding, security, integrations |
| 11 | Pricing / Subscription | ✅ | Monthly/annual toggle, full comparison matrix, FAQ |
| 12 | Checkout / Billing Portal | ✅ | Stripe-hosted; usage, subscription detail, invoice history |

---

## Core features

| Requirement | Status | Evidence |
|---|---|---|
| Production-based estimating | ✅ | `production.ts`, 31 tests |
| Labor, equipment, material, trucking | ✅ | `resources.ts`, `trucking.ts`, 49 tests |
| Crews and assemblies | ✅ | `crews`/`crew_members`/`assemblies`/`assembly_components` + 8 seeded crews |
| Production rates | ✅ | 1,452 seeded; three-tier scope; calibration proposals |
| Markups and pricing profiles | ✅ | parallel and stacked, 26 tests |
| Regional pricing | ✅ | `regional_factors`, regional factor in `calculatePrice` |
| Controlled cost libraries | ✅ | three-tier scope, RLS-enforced |
| AI plan/spec review | ◐ | governance complete and tested; **no model wired to ingestion** |
| Scope extraction, missing-item detection | ◐ | `ai_findings` types, UI and constraints exist; inference not built |
| Estimate → project conversion | ✅ | `app.award_estimate_version()` carries lines to budget |
| Schedules, crews, equipment, production | ◐ | `project_tasks`, `task_dependencies`, `production_actuals` modeled; project screen shows status and cost |
| Job costs and change orders | ✅ | `project_costs`, `change_orders` |
| CRM, customers, workforce, fleet, vendors | ◐ | CRM ✅; vendors ✅; workforce and fleet ○ |
| Dashboards and analytics | ✅ | Reports page derives from governed records |
| Permissions and subscriptions | ✅ | 11 roles, approval tiers, entitlements |

---

## Tech stack

| Required | Delivered |
|---|---|
| React + Tailwind + shadcn/ui | React 19, Tailwind 4, shadcn/ui on Radix |
| Supabase backend | 12 migrations, RLS throughout |
| PostgreSQL via Supabase | 69 tables, tested on PostgreSQL 18 |
| Email/password via Supabase Auth | ✅ |
| Supabase Storage | buckets and policies in the runbook; only paths stored in rows |
| RLS with tenant isolation and RBAC | ✅ 50 tests |
| Edge Functions for protected operations | 5 billing functions + shared helpers |
| Stripe via hosted Checkout and Portal | ✅ |
| Billing data in Supabase, no card data | ✅ ids, status, period, last-four only |

---

## The ten governing rules

| Rule | Status | Enforcement |
|---|---|---|
| RULE-001 Direct cost separation | ✅ | 10 buckets, engine to UI |
| RULE-002 Production-based duration | ✅ | `calculateDuration` |
| RULE-003 Equipment rate hierarchy | ✅ | `resolveEquipmentRate`, source retained |
| RULE-004 Trip-based hauling | ✅ | cycle authoritative; shortcut labeled preliminary |
| RULE-005 Controlling resource | ✅ | `analyzeBottleneck` |
| RULE-006 Modifiers by target | ✅ | explicit factor map + DB trigger |
| RULE-007 Markup transparency | ✅ | basis, sequence, dollar effect shown |
| RULE-008 No silent writeback | ✅ | `ai_findings` + acceptance trigger + gate floor |
| RULE-009 Version integrity | ✅ | immutability trigger + revision function |
| RULE-010 Source confidence | ✅ | provenance constraint + confidence engine |

---

## Master AI specification sections

| Section | Status |
|---|---|
| 2 Document ingestion / register | ✅ `documents`, `document_versions`, `document_sheets` |
| 3 Revision control | ✅ supersession with a required target |
| 7 Triple-check verification | ✅ three checks → verification status |
| 11 Earthwork intelligence | ✅ BCY/LCY/CCY, cut/fill, unsuitable, topsoil |
| 23 Quantity takeoff database | ✅ full chain retained per line |
| 24 Bid quantity reconciliation | ✅ `reconcileBidQuantity` with severity |
| 25 Production rate engine | ✅ theoretical / practical / recommended |
| 26–27 Equipment and crew sizing | ✅ spreads and crew composition |
| 28 Trucking engine | ✅ full cycle and fleet balance |
| 29 Fuel consumption | ✅ hours × burn rate, DEF |
| 31 Waste factor control | ✅ basis required by constraint |
| 36 Bottleneck analysis | ✅ `analyzeBottleneck` |
| 37 Duration engine | ✅ raw, practical, and a range |
| 38–39 Labor and equipment hours | ✅ |
| 44 Approval gates | ✅ four gates, most restrictive wins |
| 45 Confidence engine | ✅ 0–100, sub-90 explained |
| 46 Risk register | ✅ `risks` |
| 47 RFI engine | ✅ `rfis` with the full field set |
| 48 Assumption register | ✅ `estimate_assumptions` |
| 49 Exclusion register | ✅ reason required |
| 50 Scope gap detection | ◐ modeled as finding types; no automated sweep |
| 54 Hallucination audit | ✅ citations required by constraint |
| 57 Report structure | ◐ the data exists; no generated report document |
| 59 Executive decision | ✅ all five outcomes |

---

## Configurability

The brief's principle — *GrounUp adapts to how a construction company operates* —
mapped to what is configurable:

| Configurable | Status |
|---|---|
| Company / division / region structure | ✅ `enterprise_groups`, `companies`, `divisions` |
| Estimating defaults | ✅ shift, calendar, swell, shrink, fuel, rounding, default profile |
| Services, assemblies, tasks | ✅ company scope over the global seed |
| Labor, equipment, production rates | ✅ three-tier with versioned overrides |
| Crews | ✅ |
| Trucking and haul logic | ✅ `trucking_rates`, `disposal_sites` |
| Markups and pricing profiles | ✅ components with basis and sequence |
| Regional pricing | ✅ |
| Roles and permissions | ✅ system roles + company-defined roles |
| Approval levels | ✅ tiers 0–4 |
| Terminology | ✅ `companies.terminology` |
| Branding | ✅ colors and logo path; white label gated to Enterprise |
| Dashboards, forms, fields, statuses | ○ not user-configurable |
| Workflows | ○ approval routing is governed, not user-authored |
| Document and proposal templates | ○ `proposals.template_key` exists; no editor |
| Integrations | ○ registry surface; connectors not built |

**Configurable does not mean uncontrolled.** Every library change is versioned and
audited: who changed it, when, from what, to what, and which estimates use which
version. Protected changes route through `approval_requests` with segregation of
duties.

---

## Not built

Stated so nothing is implied that does not exist:

- Procurement, inventory, fleet and maintenance screens
- Workforce, HR, training and credential screens
- HSE, safety and quality screens
- GIS, survey, drone and machine-control screens
- Scheduling Gantt and resource leveling UI
- Contract and claims management screens
- Data warehouse, semantic layer and BI export
- White-label runtime theming (the data model supports it; the runtime does not apply it)
- Public API and connector runtime
- The AI document ingestion and inference pipeline

Each has its place in the architecture and, where relevant, its entitlement flag and
tables — but no screens and no logic.
