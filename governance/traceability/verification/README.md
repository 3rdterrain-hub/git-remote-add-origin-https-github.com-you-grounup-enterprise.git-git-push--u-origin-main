# Verification

Tracing says an artifact exists. **Verification says somebody read the
requirement's acceptance criteria and confirmed a named test asserts it.**

Sixteen phases have been verified: **P05 Estimating & Cost Intelligence**,
**P10 Financial Management**, **P11 Procurement & Supply Chain**,
**P12 Fleet & Equipment Management**,
**P20 Integration, Deployment & Production Readiness**,
**P27 AI Platform & Agent Governance**,
**P14 Safety, Health, Environment & Quality**,
**P15 Document & Information Management**,
**P18 Scheduling & Resource Management**, **P19 Contract, Change & Claims
Management**, **P24 Core Platform Implementation**, **P25 Master Library & Rate
Management**, **P26 Estimating Execution Engine**, **P28 Enterprise Security**,
**P29 Business Intelligence & Analytics** and
**P30 Commercialization & Billing**.

## P05 — 56 of 108 verified (52%)

Verification first returned 45 of 108. Three gaps it named were then built —
an assembly expansion engine, a material cost derivation, and a portable
estimate format with a round-trip test — taking it to 56. Every one of those
eleven moved by building something, not by relaxing a judgment.

| | |
|---|---:|
| Estimate Core | 6/6 |
| Quantity Intelligence, Production, Labor Cost, Equipment Cost, Material Cost, Hauling & Disposal, Assemblies, Markup & Margin, Regional Pricing, Risk & Confidence | 5/6 each |
| Integration, Reporting | 0/6 — neither versions its configuration |
| Takeoff, AI Estimating Advisor, Configuration Studio, White Label & OEM, Field & Mobile | 0/6 — not built |

### What was built to close the gaps

| Module | Built | Tests |
|---|---|---:|
| Assemblies | `assemblies.ts` — expands a recipe into flat quantified lines, multiplies quantities down nested assemblies, refuses A > B > A cycles by name and caps nesting at eight levels | 21 |
| Material Cost | `materials.ts` — derives cost through waste, order multiples, supplier minimums, freight (percent, per unit, per load, lump sum) and tax, and reports what is bought but never installed | 26 |
| Estimate Core | `portable.ts` — versioned export and import; a round trip reproduces the priced result and every derivation to the cent | 20 |

Building these also found a defect in the money kernel: `12,150 x 7.25%` is
exactly `880.875`, but the float product is `880.8749999999999`, which rounded
to `880.87` — a cent short of the arithmetic anyone checking the estimate by
hand would do. `money()` now rounds through a guard digit. All 347 existing
engine tests still passed, so the correction moved nothing that was already
right.

## Method

Every P05 requirement is `{module} {aspect}` and carries the same acceptance
criterion:

> Demonstrate *{module} {aspect}* with **tenant-specific configuration, role
> controls, version history, and traceable output**.

So a requirement is verified only when **both halves** hold:

1. The module actually has that aspect, and
2. The module satisfies **all four** acceptance conditions.

Partial is not verified. That strictness is what takes Material Cost and
Assemblies to 0/6 — both have the aspects, but neither has an engine that
derives a figure, so neither can show its work. Integration and Reporting reach
0/6 because connectors and metric definitions are not versioned.

18 modules × 6 aspects = 108, each with a verdict citing a named test or a
stated gap. Nothing is inferred from a mapping rule.

## The acceptance suites written for this

The criterion demanded evidence that did not exist, so it was written:

| Suite | Tests | What it asserts |
|---|---:|---|
| `packages/engine/tests/estimating-acceptance.test.ts` | 43 | **Traceable output**: every engine producing an authoritative figure returns a derivation carrying arithmetic, not a label. **Validation**: bad input is refused rather than priced. |
| `tests/db/estimating-acceptance.test.ts` | 83 | **Tenant configuration** and **role controls**, looped over all twelve three-tier libraries. **Version history** and **auditability** against real PostgreSQL. |

Both loop over every library rather than a chosen few. A guarantee that holds
for eleven libraries and not the twelfth is not a guarantee, and the twelfth is
the one that will price a job wrong.

## Three defects this verification found

Writing the evidence found real problems in the engine it was written to check:

1. **A production rate of zero produced a duration of zero.** `calculateDuration`
   validated five inputs but not `productionPerHour`, and `safeDivide` turned
   100 / 0 into 0 — so the derivation literally read `100 / 0 per hr = 0
   productive hr`. A line with a missing production rate would cost nothing,
   take no time, and nothing would flag it. An existing test asserted this
   behavior on the reasoning that it avoided dividing by zero; avoiding the
   division is right, returning 0 is not. Now refused, and that test replaced.
2. **A 25-hour shift was accepted.** Now capped at 24.
3. **The confidence explanation was a bare label at high scores** — "Score 100:
   verified" said nothing about how 100 was reached. A reviewer looking at 92
   needs to see why it is not 100. It now carries the arithmetic at every score.

## What this calibrates

For P05, derived tracing claimed **78** requirements covered. Verification
confirms **45**.

**Derived tracing over-claims by roughly 42% on the one phase where it has been
checked.** That is the single most useful number in this directory: it says how
much to discount the 50.9% platform-wide traced figure until the same work is
done elsewhere. A test asserts verification stays below 75% of tracing, so
nobody can quietly close the gap by loosening a rule instead of building
something.

## Kept honest by

`tests/governance/verification.test.ts` — 64 tests in `npm run verify`:

- One verdict for all 108, covering all 18 modules across all 6 aspects.
- Every verified verdict cites evidence and names a suite that exists on disk.
- No verdict claims verified while any acceptance condition is unmet.
- **Nothing is verified in a module that is not built.**
- **No `import/export` aspect is verified anywhere**, because none is tested. If
  one starts passing it is because someone built and tested an import or export.
- The ledger and the traceability matrix agree on every P05 verdict, and every
  other phase reports `none`.

## P26 — 339 of 450 verified (75%)

P26 judges by domain against **ten** conditions, all required: *inputs, library
snapshot/version, formulas/rules, units, output values, rounding, scenario
behavior, overrides, audit lineage and mapped tests* must all be reproducible.

**Verification first reported 0 of 450.** 33 of its 49 domains were fully built,
and the phase still verified at zero because three of the ten conditions were
missing platform-wide. All three were then built, and the phase moved to 339.

That sequence is the argument for doing verification at all. Tracing had put
P26 at 310 of 450 "covered". Verification said zero, named three specific
absences, and building those three moved 339 requirements at once.

### The three conditions, and what closed them

| Condition | What was missing | What was built | Tests |
|---|---|---|---:|
| **library snapshot/version** | Nothing pinned an estimate to the library rows that priced it. Editing a rate changed what an **already issued** estimate said it cost. | `snapshot.ts` + migration 0026. Rows are **copied, not referenced** — `source_id` is deliberately not a foreign key, so a snapshot survives deletion of the row. Resolution never falls back to the live library. A version cannot be issued without a snapshot that belongs to it. | 44 |
| **scenario behavior** | An estimate could not be priced under named low, base and high cases and compared. | `scenarios.ts`. Eleven named drivers, each adjustment carrying a required rationale. The base scenario is asserted to reproduce the unadjusted estimate **to the cent**. `analyzeSensitivity` varies one driver at a time and ranks them. | 26 |
| **overrides** | Contingency, equipment rate and vendor quote each had a path; there was no general override record. | `overrides.ts` + migration 0027. The engine figure is retained beside the override, a reason is required, and **the requester cannot approve their own** — enforced by CHECK in the database as well as the engine. Append-only. | 38 |

Three decisions in that work are load-bearing:

- **A snapshot copies rather than references.** A referenced row can be deleted,
  and a deleted rate would leave an old estimate unreproducible at exactly the
  moment somebody needs to defend it. A test deletes the labor rate and shows
  the estimate still reproduces.
- **The base scenario must equal the estimate.** If the base drifts, every other
  scenario is measured against a number that is already wrong. Asserted, not
  assumed.
- **An override is a record, not an edit.** Pretending overrides do not happen
  does not stop them — it pushes them into a spreadsheet, or into a library rate
  quietly edited to make one line come out right.

### What remains unverified

111 requirements across 12 domains, every one a capability that genuinely does
not exist: Estimate Templates, Service Selection, Quantity Takeoff Intake, Crew
Size Recommendation, Equipment and Truck Selection, Disposal Cost derivation,
Subcontract Cost derivation, Mobilization, Demobilization, Service Catalog
Writeback and AI Estimate Assist.

With all ten conditions met, the verdict now turns entirely on whether the
domain exists — and a test asserts exactly that, so a partial domain cannot
verify.

## P25 — 315 of 400 verified (79%)

P25 judges by domain against **eight** conditions, all required: *identifiers,
tenant scope, effective dates, source/provenance, approval state, version
behavior, dependency integrity and mapped tests*.

**Verification first reported 0 of 400.** 23 of its 32 domains were built, and
the phase verified at zero because four of the eight conditions existed on
`services` and nowhere else. Migration 0028 carried the shape to the other
eleven libraries and added the history none of them had.

| Condition | Before | After |
|---|---|---|
| identifiers | 12/12 | 12/12 |
| tenant scope | 12/12 | 12/12 |
| dependency integrity | met | met |
| mapped tests | met | met |
| **approval state** | `approved_by`/`approved_at` on **1/12** | **12/12**, a live company row must name its approver |
| **effective dates** | `effective_date` on **3/12** | **12/12**, with an expiry-after-start check |
| **source/provenance** | on **3/12** | **12/12**, `origin` a closed set |
| **version behavior** | absent | `library_row_versions` on all twelve |

### Three decisions in the build

- **`valid_to` is derived, not stored.** The first design closed each version by
  updating the previous row — and the immutability trigger refused it, which is
  the design telling you it is wrong. A history that gets updated is
  append-only only by convention. `valid_to` is now a window function over the
  next version, so nothing ever writes to a row after it is created.
- **A delete is recorded as a version carrying the row as it last stood**, so the
  history says what was removed rather than merely stopping. `library_row_as_of`
  returns null for that instant rather than the state held before removal.
- **The approval rule is scoped, not flat.** A platform catalog row is published
  by GrounUp and has no company approver; a live *company* row must name one.
  `app.provision_company` records the founding user as approver of the default
  pricing profile it creates, which is accurate rather than a way around the
  constraint.

### Why not build the history on the audit ledger

`audit_events` already records prior and new state for every library change, so
a separate table needs justifying. Its read policy is
`company_id is not null and has_permission(...)`. Platform library rows have no
company, so **their audit entries are readable by nobody** — and those are
exactly the seeded rates an estimate is priced from. `library_row_versions`
carries its own policy: a platform row's history is readable by every tenant, a
company row's only by that company.

### Where library snapshots fit, and where they do not

Migration 0026 made an **estimate** reproducible by copying the rows that priced
it. That answers "what priced this estimate". `library_row_as_of` answers "what
did this rate say in March". They are complements, and P25 was asking for the
second — so the snapshot work was deliberately not counted toward
`version behavior`.

### What this did not close

`LIM-P25-001`: migration 0028 stamps `source` on rows present when it runs, but
the seed is applied after the migrations, so a seeded row's `source` comes from
the seed itself and only `services` currently emits one. Every platform row is
correctly marked `origin='catalog'`. Closing it means extending the seed
generator and regenerating 4,905 lines — recorded rather than done, because it
is a generator change with no bearing on the governance capability.

85 requirements remain unverified across seven domains that genuinely do not
exist: a **Subcontract Resource** and **Rate Library**, **AI Proposed
Writeback**, **Import & Bulk Edit**, a separate **Material Price Library** and
**Vendor Price Sources**, and consistent **Search & Classification**.

## P24 — 332 of 360 verified (92%)

P24 judges by domain against **five** conditions, all required:
*tenant/security boundaries, API/data behavior, audit/observability evidence,
failure handling and mapped tests*.

**Verification first reported 0 of 360.** 21 of its 25 domains were built and
four of the five conditions were met. One capability gated the entire phase:
the criterion asks for audit **and** observability evidence, and only the audit
half existed.

Building observability moved 332 requirements at once.

| Condition | Status |
|---|---|
| tenant/security boundaries | met — RLS forced on 131 tables, gates asserted at every migration, default-deny grants as a second control, hashed and scoped API keys |
| API/data behavior | met — nine versioned endpoints behind a pure authorization function, one error shape, OpenAPI generated from the route table with drift failing the build |
| failure handling | met — the gateway never throws to a caller, a failed connector run is a row, engines refuse rather than produce NaN money |
| mapped tests | met — 1,903 tests, migrations run unmodified against real PostgreSQL 18 |
| **audit/observability evidence** | **met** — audit was already the strongest evidence in the platform; observability now exists beside it |

### What was built

`supabase/functions/_shared/observability/`, 49 tests:

| Module | |
|---|---|
| `redaction.ts` | Two independent defenses. An explicit **field-name** list — a deny list rather than a pattern, because "anything ending in `_key`" would redact `role_key` and `idempotency_key` and make the logs useless. And **value-shape** patterns that catch a credential wherever it appears, which is the only thing that finds a token pasted into a `notes` field. |
| `logger.ts` | Correlation carried from the request through every line, tenancy on every record, level thresholds, child loggers, and timing that records a duration whether the operation succeeded **or failed**. |
| `metrics.ts` | Counters, durations and gauges with bounded labels. An identifier used as a label is **refused** — it turns one metric into a million time series. |
| `health.ts` | Liveness and readiness kept separate, and every check raced against a deadline. |

The API gateway now emits correlation, structured logs and metrics on every
path and returns the correlation id to the caller, and `supabase/functions/health`
serves readiness and liveness.

### Four decisions worth stating

- **Redaction is two defenses, not one.** A name list never catches a
  credential in a field nobody thought of; a shape pattern never catches an
  opaque session cookie. Both are needed, and the tests attack each
  independently — including a token inside a stack trace, which is how a URL
  with a key in the query string reaches a log.
- **A hanging health check is worse than a failing one.** The balancer waits,
  the queue backs up, and nothing is ever reported. Every check races a
  deadline and a check that misses it fails with that stated as the reason.
- **Degraded serves.** Only `unhealthy` returns 503. Taking a node out of
  rotation because one non-critical dependency is slow removes capacity exactly
  when it is needed.
- **Neither logging nor measurement can break what it observes.** A failing
  sink is swallowed. Losing a line is bad; failing the request that produced it
  is worse.

### What remains

28 requirements across two domains that genuinely do not exist: **Domain
Events** (no bus or outbox, so nothing can subscribe to "an estimate was issued"
without polling) and **Feature Flags** (entitlements gate what a *plan* may use,
which is a commercial control rather than a release one — a half-built
capability cannot be shipped dark).

## P28 — 0 of 500 verified

P28 judges by domain against **eight** conditions, all required: *allow/deny
behavior, tenant isolation, least privilege, audit evidence, threat/failure
handling, key/secret lifecycle, monitoring and mapped security tests*.

**Five of the eight are met, and they are the load-bearing five.** Three are
not, and 30 of the 59 domains do not exist.

| Condition | Status |
|---|---|
| allow/deny behavior | **met** — deny is the default in two independent places, and an unknown key is answered identically to a malformed one so the endpoint cannot become a key-existence oracle |
| tenant isolation | **met** — the strongest area in the platform; gates asserted at every migration and again by test |
| least privilege | **met** — scoped keys, permissioned roles, SECURITY INVOKER where tenant data is read, anon holds nothing |
| audit evidence | **met** — append-only ledger, library history, a request log that keeps the failures |
| mapped security tests | **met** — 51 RLS, 65 gateway, 49 redaction, plus governance invariants |
| **threat/failure handling** | **partial** |
| **key/secret lifecycle** | **partial** |
| **monitoring** | **partial** |

### The three gaps, stated precisely

**Threat handling, not failure handling.** Failure handling is strong and
tested — the gateway never throws to a caller, a failed connector run is a row,
prompt injection is treated as untrusted input by contract. What does not exist
is threat *detection*: no detection of any kind, no anomaly baseline, no
alerting, no incident response, and no written threat model. Individual controls
name the threat they answer in a comment, which is not a model anyone can
review.

**Holding a secret well is not managing it.** Secrets live in server-side
environment variables and never reach the browser; connector credentials are
handles into a secret store rather than values; API keys are stored only as a
SHA-256 hash, scoped, expirable and revocable. That is the holding, and it is
sound. The lifecycle is absent: nothing rotates, no expiry policy is enforced,
there is no certificate inventory and no record of when a secret last changed.
The first being true must not hide the second being false.

**The signals are produced and nobody is listening.** Structured logging,
correlation and metrics now exist — built last for P24. No *security* metric is
defined, nothing counts failed authorizations or privilege changes, nothing
establishes a baseline, nothing alerts.

### The finding that matters most

`apps/web/src/pages/app/settings.tsx` renders a **"Require multi-factor
authentication"** toggle, and no code reads or enforces it. The same screen
displays "Retention: Indefinite" as though it were a policy.

An absent control is a gap somebody can plan around. **A control the interface
says is on, that nothing implements, is a false assurance** — an administrator
who enables it believes their organization is protected. This is the only place
in the platform where the interface claims a security property the code does not
have, and a test pins it so it cannot be quietly forgotten. Either the toggle is
implemented or it is removed; leaving it is the one option that should not
stand.

### What is genuinely absent

30 domains, and they group cleanly. **Identity**: MFA, SSO federation, SCIM,
attribute-based access. **Data**: classification, retention and deletion, key
and certificate management. **Detection and response**: threat modeling, threat
and anomaly detection, alerting, incident response, forensic evidence.
**Assurance**: access reviews, compliance evidence, policy attestation, security
exceptions, a security administration surface. **Infrastructure**: network,
runtime, container, backup and disaster-recovery security, vulnerability and
dependency management, SAST/DAST — most of which belongs to P31, separately
unverified.

## P18 — 98 of 400 verified (25%)

The phase with the highest derived tracing of any unjudged phase — 83% — and
the one where derived tracing was furthest from the truth.

### The finding

`schedule_activities` carried `total_float_days` and `is_critical`.
`schedule_dependencies` carried all four relationship types with lag. **Nothing
anywhere traversed the graph.** A check constraint required that
`is_critical = (total_float_days <= 0)`, which enforced that two numbers a
caller typed agreed with each other, and the schedule screen displayed those
typed numbers in the same style it displays derived ones.

This is the same defect class as the P28 security toggles: the interface
asserting a property the code does not have. It is worse here, because a float
figure gets acted on — an activity showing four days of float is one a
superintendent will let slip four days. The hand-authored demo dates also ran a
thirty-day activity straight through Memorial Day, which no amount of care in
typing would have caught.

### What was built

| Built | What it does | Tests |
|---|---|---:|
| `calendar.ts` (ENG-027) | Working-day arithmetic on integer epoch days through `Date.UTC`, so no local timezone is ever consulted. Working weeks, holidays, exception working days. Refuses "five working days after Sunday" rather than guessing which answer was meant. | 29 |
| `schedule.ts` (ENG-028) | Forward and backward pass over all four dependency types with lag and leads; total and free float; the critical path as a connected chain rather than a bag of zero-float activities; four date constraints; negative float against a contract date; cycles refused by name. Pure — a test asserts shuffled input gives identical dates. | 47 |
| `0029_scheduling_governance.sql` | `work_calendars` and exceptions (LIBRARY); `schedule_calculations` append-only with its data date and engine version; `schedule_baselines` and baseline activities, append-only, current derived not flagged; `reporting_schedule_variance`. **Float cannot be written without naming the calculation that produced it** — a constraint, not a convention. | 32 |
| Schedule screen | Dates, float and criticality now come from the engine. | 13 |

### The finding that is still open

`app.has_entitlement` and `app.can_use` are correct, tested and granted to the
right roles. Across the whole platform they are called from **exactly one
place**: the AI document analyst checks `ai_plan_review` before running. No
screen, no table policy and no other function consults a feature key, so a
company on Starter can open the procurement, fleet and scheduling screens its
plan does not include.

It is left open deliberately. Unlike the limits, it is not a bounded fix: it
needs a decision about what happens to work a company already created under a
feature it no longer holds. Hiding it makes a downgrade look like data loss; the
defensible answer is read-only, and that means a per-feature mapping from key to
tables and a downgrade path through RLS rather than a screen check the API would
not honor anyway. A feature gate applied to some screens and not others is worse
than none, because it teaches a user the gate is not real.

### Three decisions worth stating

- **Finish-to-start steps a calendar day, then snaps.** Stepping a *working* day
  off the predecessor's finish overshoots whenever the two activities keep
  different calendars: a predecessor finishing Saturday on a six-day week snaps
  to Monday, and adding a working day on top starts the successor Tuesday for no
  reason. The test for this was written before the code was right.
- **A baselined activity id carries no foreign key.** A baseline has to survive
  the deletion of the activity it recorded, or work dropped from the schedule
  disappears from the variance report instead of showing as removed. Existence
  and tenancy are checked by an insert trigger instead — the same shape as the
  override entity guard.
- **No `is_current` on baselines.** An append-only table cannot maintain a
  current flag, because maintaining it requires the update the table forbids.
  The current baseline is the most recent one, derived on read. The library row
  history taught this exact lesson.

### What remains

Seven of 29 domains are built, twelve partial, ten absent — and with every
platform condition now met, each is judged on its own merits rather than blocked.
The partials are specific: no WBS rollup, no shift patterns, no resource
histogram, no delivery tied to the activity that needs it, no earned value, no
field constraints with owners and need-by dates. The absences are whole
practices — resource leveling, look-ahead, Last Planner, pull planning, schedule
risk, acceleration modeling, portfolio capacity.

One partial is worth naming on its own: **`percent_complete` is a stored column
that can disagree with installed divided by budgeted.** That is the same shape
of defect as the float finding, one table over.

## P30 — 174 of 540 verified (32%)

The phase where the platform's own commercial promises live, and the one that
produced four findings rather than one.

### The four findings

**Terms were resolved against a table that had since moved.** `deriveState` set
`entitlement.features = plan.features`, read live at webhook time. Editing a
plan re-termed every existing subscriber on their next Stripe event, and nothing
could answer what a customer had actually been sold. This is the library
snapshot problem exactly, one domain over.

**The pricing page sold capabilities that do not exist.** Enterprise advertised
"SSO, advanced security and data residency options" in its headline, the
comparison table carried an "SSO and advanced security" row marked included, and
the seeded plan description said the same. There is no SAML, no OIDC and no
region selection anywhere in the codebase — the settings screen lists single
sign-on under "Not yet available". It is the settings-toggle defect on the page
where somebody decides to pay.

**Every plan limit was decorative.** `plans` carried max_seats,
max_active_estimates, max_active_projects, storage_gb and ai_credits_per_month;
`entitlements` copied all five; the pricing page sold them. Nothing anywhere
refused the 26th estimate or the 4th user.

**Tables added after migration 0011 arrived unaudited.** That migration attached
audit by looping over the tables existing at the time, and nothing ran the loop
again — so `stripe_events`, the idempotency ledger the whole billing story rests
on, could have its payload edited after processing with no trace, and so could
`api_requests` and `ai_messages`, both cited as evidence in security
verification.

### What was built

| Built | What it does | Tests |
|---|---|---:|
| `0030_plan_versioning.sql` | `plan_versions`, published by trigger when a commercial term changes and silent on marketing copy, append-only, current version derived. Pinned onto the subscription and the entitlement; a trigger refuses an entitlement granting more than its version publishes. Freezes the Stripe record, `api_requests` and `ai_messages`; attaches audit to the calendar tables. | 24 |
| `0031_plan_limit_enforcement.sql` | Enforces active estimates, active projects and seats. NULL is unlimited, and so is having no entitlement — a billing gap must not become a data outage. Archived work stops counting, so nobody is pushed to delete their history to keep working. `reporting_plan_usage` shows usage against allowance. | 11 |
| `resolvePlanVersion` | Grandfathering: a customer keeps the version they bought while they stay on the plan; changing plan takes today's terms; a subscription predating versioning says so rather than passing the fallback off as a pin. | 11 |
| `plans.check.test.ts` | Reads the seeded catalog and holds the pricing page to it — every entitlement-backed claim matched against what the plan grants, and no selling of SSO, MFA or data residency. | 10 |

### The finding that is still open

`app.has_entitlement` and `app.can_use` are correct, tested and granted to the
right roles. Across the whole platform they are called from **exactly one
place**: the AI document analyst checks `ai_plan_review` before running. No
screen, no table policy and no other function consults a feature key, so a
company on Starter can open the procurement, fleet and scheduling screens its
plan does not include.

It is left open deliberately. Unlike the limits, it is not a bounded fix: it
needs a decision about what happens to work a company already created under a
feature it no longer holds. Hiding it makes a downgrade look like data loss; the
defensible answer is read-only, and that means a per-feature mapping from key to
tables and a downgrade path through RLS rather than a screen check the API would
not honor anyway. A feature gate applied to some screens and not others is worse
than none, because it teaches a user the gate is not real.

### Three decisions worth stating

- **A version is published by trigger, not by discipline.** A rule that depends
  on somebody remembering to publish is not a rule. Editing a tagline publishes
  nothing, because a version per typo makes the history unreadable and protects
  no one.
- **Storage and AI credits are deliberately left unenforced.** Both need a
  measured quantity nothing yet meters. A limit checked against a number nobody
  computes would be the same defect one layer down, and the verdict says so
  rather than counting them as built.
- **Removing a false claim is not building the capability.** SSO is gone from
  the pricing page and is still absent from the platform; the verdict records the
  claim as resolved and the capability as missing, and a test asserts no domain
  called SSO ever appears in the built list.

### What remains

20 of 63 domains built, 18 partial, 25 absent. The partials are specific:
no tiered pricing, no billing account distinct from the owner, no dunning
process of GrounUp's own, no seat reclamation, no contract record behind a
manual grant. The absences are whole commercial functions — credits, tax,
proration, refunds, disputes, revenue operations, customer communications —
and the platform sends no email at all, which is why several of them cannot
start.

## P19 — 135 of 420 verified (32%)

The phase that produced the finding this whole exercise exists to catch:
**three tables counted as tested that had no tests at all.**

### What the tests found once they existed

**Nothing protected a commercial record after it was agreed.** RULE-009 makes an
issued estimate immutable and the platform enforces it properly. An issued
estimate is an offer. Nothing protected the obligations that follow it — an
executed contract's value, dates, retainage, liquidated damages and notice
clauses were all editable; an approved change order's price and schedule impact
were editable; a settled claim's award and reasoning were editable.

**A claim deadline could be typed instead of derived.**
`derive_claim_deadlines` computed only when the column was null, so supplying
`notice_due_on` bypassed the contract clause with no record. The schema's own
comment says most construction claims are lost on the notice clause rather than
on their merits — and that was the one field a caller could set freely. This is
the fourth appearance of one pattern: a value the interface presents as derived
that a caller can simply type.

**A claim's supporting evidence had no integrity at all.** Three `uuid[]`
columns, never validated — a claim could cite a daily report that does not
exist, was deleted, or belongs to another company, while the schema calls them
"the contemporaneous records a claim actually rests on".

**Permission answered who may touch a record and nothing answered how much they
may commit.** A user with write access could execute a $900,000 amendment. The
four approval gates that exist are estimating-specific and govern quantity
confidence, not commercial authority.

### What was built

| Built | What it does | Tests |
|---|---|---:|
| `0032_commercial_integrity.sql` | Freezes what the parties agreed on all three records while leaving administration free. Derives deadlines always, refuses a supplied value that disagrees and names the override mechanism. Validates every cited record exists and belongs to the same company. | 30 |
| `0033_commercial_authority.sql` | `commercial_authority_limits`: per-company signing thresholds by record type, enforced on the crossing into a committing state, naming the tier held and the tier needed. Absolute value, so a large credit is treated like a large charge. A company with no limits is unrestricted. | 9 |

### Two decisions worth stating

- **A draft of any size is fine.** Authority is checked when a record crosses
  into a committing state, not on every edit. Proposing a $900,000 change order
  is how the conversation starts; executing one is the commitment.
- **A company with no signing limits is unrestricted.** The platform does not
  invent a policy nobody set. That is the same reasoning as a plan limit of
  NULL meaning unlimited, and as a company with no entitlement not being locked
  out of its own data.

The deadline fix needed a second pass: the first version treated a stale stored
deadline as a caller asserting a different one, which meant a claim's event date
could never be corrected. A test caught it.

### What remains

9 of 29 domains built, 12 partial, 8 absent. The partials are specific: a
subcontract is modeled as a purchase commitment rather than a contract with
terms; no force account ticket; no cost to complete; no fragnet or windows
analysis. The absences are whole administrative functions — backcharges,
allowances, insurance and bonds, lien waivers, disputes, closeout — several of
which need documents and correspondence the platform does not yet send.

## P10 — 16 of 240 verified (7%)

The phase where the honest answer is mostly "not built", and where the
requirements spine is itself the first finding.

### The register carries no acceptance criteria for this phase

**797 of the register's 9,475 requirements — all of P04, P06, P07, P08 and
P10 — have an empty acceptance criteria column.** Verification here means
somebody read a requirement's criteria and confirmed a named test asserts it.
For 8.4% of the corpus that method cannot run as written.

P10's requirement statements are specific and well formed — better than the
templated statements elsewhere in the register — so each was judged against its
own statement, and the verdict says exactly that rather than implying a
criterion existed. Writing the missing criteria and then judging against them
would be marking my own homework, which is the one thing this whole system
exists to prevent. The other four phases are recorded for whoever owns the
spine.

### It factors cleanly

240 requirements are **16 subjects × 15 aspects**, every aspect appearing once
per subject, matched with nothing left over. A requirement is verified only
where the aspect holds *and* the subject exists. **3 of 15 aspects hold; 6 of
16 subjects exist.**

Aspects that hold: tenant-scoped records; role-based and attribute-based access
control; and — since migration 0034 — period controls and posting-date
governance. The twelve that do not are named individually, including the two
that fail everywhere for the same reason: **nothing in this platform can
export**, so "exportable reports" and "an audit event for every export" both
fail, which is the absence P28 already recorded.

### There is no general ledger

No chart of accounts, no journal entry, no fiscal calendar beyond the periods
just added, no trial balance, no posting, no consolidation. A search of the
entire schema and source tree returns nothing. What exists is construction
operational finance: schedule of values, AIA pay applications with certified
immutability, AP invoices with three-way match, job cost, committed cost and
retainage — all real, all tested.

That is left open rather than built. A general ledger is a subsystem, not a
gap, and it may not belong here at all: the platform integrates with accounting
systems through its API and payroll export rather than replacing them. **A
half-ledger would be worse than none, because it would invite people to report
from it.** That is a product decision, and the verdict records it as one.

### What was built

`0034_financial_periods.sql` closes the cutoff question for the finance that
does exist. Job cost carried a `cost_date` and payables an `invoice_date`, and
nothing could close a period — a cost dated last March could be posted today,
changing a figure already reported to an owner, a bank or a bonding company.
That is the same family as the schedule float and the claim deadline, but
retroactive, which is worse: the report was right when it was produced and is
wrong now, and nothing said which.

Periods cannot overlap, enforced by an exclusion constraint so the answer never
depends on which row was read first. Closing refuses to run over a pay
application still in draft, records who closed it and when, and reopening needs
an attributed reason. A posting into a closed period is refused — and so is
moving one *out* of a closed period, because the period total would change
after it was reported either way. A company that has defined no periods is left
alone rather than having a close invented for it. 20 tests.

## P14 — 54 of 320 verified (17%)

The safety schema is genuinely good at recording and could not prevent
anything. Two of its six conditions failed for that reason alone.

### The field that was already there

`credentials.required_for` has carried the comment *"Work this credential is a
prerequisite for, e.g. CDL for a truck driver"* since the workforce migration,
and **nothing anywhere read it**. `refresh_credential_status` kept the status
honest against the calendar — valid, expiring, expired, revoked — and nothing
consumed the result. An employee whose CDL expired last month could be assigned
to drive, and the platform recorded the expiry and the assignment side by side
without ever connecting them.

Everything the schema does enforce is after the fact and enforced well: an
incident cannot be closed without a root cause and a corrective action, a
recordable one cannot exist without an OSHA case number, a punch item cannot be
closed without a named verifier and a note. A safety system that cannot stop an
uncredentialed person being assigned to the work is a filing cabinet.

### The notification table had no producer at all

`notifications` exists with twelve categories including `safety`, severities,
deep links, per-user or company-wide addressing, and a companion preferences
table. **Across the entire platform nothing inserts into it.** The only writers
were tests. A recordable injury notified nobody; a CDL lapsing notified nobody.

### What was built

`0035_safety_controls.sql`, with 22 tests:

- `work_credential_requirements` states the requirement **from the work's
  side**. A rule written on the credential can only ever catch a lapse, never
  an absence — the person who never held a CDL has no credential row to check.
- `app.credential_gaps` returns each unmet requirement with its reason: not
  held, expired with the date, revoked, not yet issued. A screen can show it
  before somebody hits the wall.
- A trigger refuses an employee assignment where a **mandatory** requirement is
  unmet, naming the person and what is missing.
- Two notification producers: a recordable incident, and a credential entering
  expiring or expired.

### Four decisions worth stating

- **Recommended requirements do not block.** A control that blocks on
  everything gets switched off. A company that marked a credential recommended
  has already made that call.
- **An expiring credential is not a gap.** It is still valid. Warning about it
  is the notification's job, and conflating the two would block work that is
  legitimately allowed.
- **Notifications fire on the transition, not on every touch.**
  `refresh_credential_status` recomputes on every write, and a notice each time
  is how people learn to ignore notices.
- **A company with no requirement configured is left alone.** The same rule as
  an unconfigured plan limit, an undefined accounting period and an absent
  signing limit: the platform does not invent a policy nobody set.

### What remains

3 of 18 domains built, 7 partial, 8 absent. The absences are whole practices —
JHA and pre-task planning, permits to work, industrial hygiene, emergency
management, subcontractor prequalification, public and traffic safety. The
partials are specific: no training delivery behind the credentials, no 300 log
generation behind the recordability, no CAPA register with owners and due
dates, no TRIR or leading indicator behind the analytics view. Notification
delivery stops at in-app, because the platform sends no email at all.

## P15 — 133 of 340 verified (39%)

The evidence layer everything else cites, and the phase where writing the tests
found a defect that reading the schema had not.

### Four findings

**The current version was a number somebody typed.** `documents.current_version`
was a stored integer with no trigger behind it — uploading version 3 did not
advance it, and setting it to 7 when two versions existed was accepted. The
fifth appearance in this build of one pattern, after the security toggles,
schedule float, plan terms and claim deadlines. Worse than most, because a
drawing revision is what a crew builds from.

**The text of every document was indexed and unsearchable.**
`document_sheets.extracted_text` carries a GIN trigram index and a column
comment reading *"used for permission-filtered search across the plan set"*.
Nothing queried it. **The column stated its own purpose and nothing fulfilled
it** — a drawing whose title block reads C-210 and whose body specifies
cathodic protection was findable by the first and not the second.

**Supersession could close a loop.** Nothing stopped a document superseding
itself, or two superseding each other. Any walk of the revision chain would
never terminate.

**A version could be attached across a tenant boundary.** `document_versions`
and `document_sheets` had no tenant-parent guard: a user of company B could
attach a version to company A's document — row level security passed because
the row carried B's own company_id, the foreign key passed because the document
existed. A could not see the row and **would still have felt it**, because the
current-version trigger counts every version a document has. Found by the tests
written for this migration, and the first half of the migration is what made it
reachable.

### What was built

`0036_document_integrity.sql` and `tests/db/documents.test.ts`, 23 tests where
there were none: the current version counted from the versions that exist and
refused when written directly; self-supersession refused by constraint and
longer loops by a trigger that names the path; `app.search_document_text`
returning document, version, page, sheet number, a snippet windowed around the
match and a rank, SECURITY INVOKER so "permission-filtered" is finally true;
and `app.enforce_tenant_parent` on both child tables.

### What remains

7 of 18 domains built, 2 partial, 9 absent. Several absences share one cause:
**the platform sends nothing to anybody**, so transmittals, distribution,
acknowledgment and external collaboration cannot start. Records retention and
legal hold is the same absence P28 recorded. Markup, BIM coordination and
closeout turnover are genuinely unbuilt capabilities. The two partials are
specific: no specification section hierarchy behind the spec document type, and
no OCR engine — extracted text arrives from the ingestion pipeline rather than
being produced here, so a scanned drawing with no text layer yields nothing.

## P11 — 80 of 260 verified (31%)

**The first phase judged where the implementation was already close.** Three of
its four conditions held on the first reading, and with 25 existing tests
covering purchase orders, quote leveling, three-way match, deliveries and the
inventory ledger, it is the best-covered area this build has examined. The
verdict says so rather than manufacturing a deficit.

### The one missing control

Migration 0033 gave the platform per-company signing limits and covered change
orders, contracts and claim settlements. It did not cover **purchase orders** —
the commitment a construction company makes most often. A purchase order
carries `committed_amount`, the cost the company is on the hook for before any
invoice arrives, and anyone holding `procurement.write` could issue one of any
size.

What makes this sharp is how good the rest of the control set is. An invoice
cannot exceed its commitment. A payment cannot exceed its invoice. A three-way
match refuses a mismatch outside a stated tolerance, with freight and rounding
absorbed inside it. An award cannot be recorded without naming the vendor *and*
the reason. A delivery that is not accepted must say why. An inventory
adjustment must be explained, because an unexplained one is indistinguishable
from shrinkage. **Every one of those is strong, and every one is downstream of
the commitment.** Nothing governed the commitment.

`0037_purchase_order_authority.sql` extends the existing mechanism, enforced on
the crossing into issued and every state beyond it — a commitment does not stop
being one because material arrived. A draft of any size stays free, because
working a purchase order up is not committing to it. 7 tests.

### The finding left open

**Nothing precedes the purchase order.** There is no requisition: no request to
buy, no approval of that request, no conversion into an order. Buying begins at
the quote request or the order itself, which means the signing limit added here
is the only gate and it sits at the end of the process rather than the start.

Left open deliberately. A requisition is a workflow with its own approval
routing, and the platform has no configurable routing to build it on — the same
absence P30 recorded for financial approvals. A fixed one-step requisition
would satisfy the word and not the need.

## P12 — 72 of 280 verified (26%)

Two of five conditions failed, and both were the same kind of absence: a thing
the schema was shaped for that nothing performed.

### Fleet cost never reached the job

A fuel transaction carries a project, an asset, gallons, a price per gallon and
a generated total. `project_costs` carries a `cost_type` of `fuel`, a `source`
of `fuel_card` or `telematics`, an `equipment_id`, a quantity with a unit, and
a `reference` for where a row came from. **Both sides were shaped for exactly
this posting and nothing wrote it.** Equipment is the second-largest cost
category on a heavy civil job, and a machine could burn four hundred dollars of
diesel on one while the job's cost stayed silent.

Now posted, and kept in sync rather than posted once — a corrected gallon count
corrects the job, a deleted transaction removes it. Fuel with no project posts
nothing, because the platform does not guess which job to charge. And the
posting is a job cost like any other, so the financial period cutoff refuses one
dated into a closed period: **the fleet record cannot route around the
accounting control.**

### No fleet exception reached anybody

Nothing told a person a machine had gone down or a service had come due. The
notification table did not carry a fleet category at all — a down machine would
have had to arrive as a 'system' notice. A down machine is the event most likely
to move a schedule, and the platform knew and told nobody.

Two producers now: a machine entering `down`, at critical severity with its
location and the schedule consequence stated; and a service coming due, fired on
the meter reading that **crosses** its interval, driven by the meter rather than
a clock because that is how heavy equipment is serviced.

### One thing deliberately not built

**Maintenance cost is not posted to a job**, and a test asserts it is not.
Maintenance is an ownership cost recovered through the equipment rate, not a
direct charge to whichever job the machine was on when it broke. Posting it
would double-count against the rate the estimating engine already applies, and
would put the cost of a worn undercarriage on the last project to use the
machine. That distinction is the reason equipment rates exist, and the verdict
records it as a decision rather than leaving it looking like a gap.

### What remains

6 of 24 domains built, 7 partial, 11 absent. Two absences are worth naming
because they are ordinary and complete: **tires and undercarriage** — a
significant cost category on tracked equipment with no representation at all —
and **documents and media**, where documents are versioned and searchable
platform-wide and nothing links one to a machine, so a manual, a purchase
invoice and an inspection photograph have nowhere to live.

## P20 — 0 of 450 verified

The phase where the honest answer required refusing to count the work this
build just did.

### What was built

The owner has GitHub and Supabase, which made four things buildable that were
not before:

| Built | What it is |
|---|---|
| `.github/workflows/verify.yml` | Runs `npm run verify` — the whole gate, not a subset — on every branch and pull request, then checks the emitted bundle. Needs **no secrets at all**, because the database tests run the migrations against PostgreSQL in WebAssembly; a pipeline that needs credentials cannot run on a fork's pull request. |
| `.github/workflows/deploy.yml` | Never fires on a push. Dispatched by a person, behind a GitHub Environment so its approval rules apply, re-runs the full verification, lists pending migrations before applying them, deploys each function, builds with the environment's public keys. |
| `supabase/config.toml` | The project and local stack, carrying no secret, stating which two functions run without JWT verification and why. |
| `scripts/check-bundle.mjs` | Enforces the secret boundary against what the build actually emitted. |

Plus 19 tests holding the pipeline's shape, so it cannot be quietly narrowed to
a passing subset.

### Why it still verifies at zero

**No pipeline has run. No environment exists. Nothing has been deployed.**

The criterion asks for "controlled integration/deployment/test/operations
evidence". Test evidence is strong and integration evidence is real. Deployment
evidence does not exist, because nothing has been deployed, and operations
evidence does not exist, because nothing is running — the observability library
produces logs, metrics and health checks that no deployment consumes.

Marking this phase verified on the strength of committed YAML would be **the
largest available instance of the defect these fourteen phases were spent
finding**: an artifact that describes a capability counted as the capability. A
workflow that has never executed is a settings toggle that switches nothing.

It cannot be resolved from here either. Running the pipeline needs a push;
deploying needs an access token, a project reference and a database password.
Those are the owner's to hold and to use. What was buildable without them is
built; what remains needs somebody with the credentials to press the button
once.

### The bug found while enforcing the secret boundary

The Stripe key, the webhook signing secret, the service-role key and the AI
provider key have always lived only in Edge Function secrets — the browser code
never reached for them — and **nothing checked**. One `VITE_`-prefixed variable
would have published a credential into every bundle, because Vite inlines every
`VITE_` variable by design.

`bundle:check` now scans two independent ways: by name, and by shape —
`sk_live_`, `sk_test_`, `rk_`, `whsec_`, `sk-ant-`, and a service-role JWT.

The first version of the JWT check **passed a real token**. Base64 encodes
three bytes at a time, so `service_role` has three possible encodings depending
on its offset in the payload, and the hard-coded pattern matched one of them.
Found by planting a realistic token and watching the check succeed when it
should have failed. All three alignments are now computed rather than written
down, and a test asserts they are computed.

The anon key is deliberately not checked: it is public by design, and row level
security is what makes that safe.

## P27 — 0 of 480 verified

**The strongest single piece of governance in the platform, and it still
reaches zero.** Both facts belong in the verdict.

### What holds, structurally

The owner's two AI constraints were that AI must not alter approved records
without the approval workflow, and that AI arithmetic must never be
authoritative where the deterministic engine exists. Both hold, and neither
rests on convention:

- `ai_agents_never_autonomous` is a check constraint. **An agent with write
  authority cannot be configured**, no matter what anybody sets.
- A factual finding cannot exist without a citation or a sheet reference —
  enforced in the database, and rejected by `validateFindings` before it ever
  reaches the database.
- The system prompt forbids the model computing what the engine owns, forbids
  resolving a conflict by picking a side, and forbids inventing dimensions. The
  validator enforces all three in code, **because a prompt is a request and a
  validator is a control.**
- Findings are inert until a person accepts them, and acceptance records which
  business row was created: document → finding → accepted by → estimate line.

### Why it is zero anyway

Two of eight conditions fail.

**Tool permissions.** The agent has no tool surface — it is handed a document,
reads it, returns findings. There is nothing to route and nothing to
permission. The verdict records this as *nothing to verify*, not as *something
ungoverned*; the risk the condition exists to catch is absent along with the
capability.

**Evaluation results.** Nothing measures whether the agent is any good. The 28
tests validate the contract — schema, citations, confidence bounds, the
prompt's prohibitions — and **a contract test cannot tell you whether a
citation supports the claim attached to it.**

That one was left open rather than approximated. A real evaluation needs
drawings and expert labels: somebody who knows the trade saying what a correct
reading of a sheet is. Manufacturing a golden set from the model's own output
would measure nothing except agreement with itself, and building the harness
without the labels would be the same defect these fifteen phases have been
spent naming.

### A verdict of this build's own, found wrong and corrected

P30 recorded AI credits as unenforceable because "nothing yet meters" them.
**That was wrong.** Every analyst run has always written a `usage_events` row
with metric `ai.request`, and `app.current_usage` has always aggregated it over
the paid period. Both halves existed; nothing joined them, so the allowance
published on every plan version bounded nothing.

Migration 0039 joins them: `app.usage_allowance`, `app.ai_request_allowed`, a
402 from the analyst naming when the allowance resets, and a reporting view
showing usage before somebody hits the wall. 9 tests.

The P30 verdict is corrected in place with the correction **recorded rather
than the original quietly rewritten**, and a test asserts the correction is
there. A verdict that overstates an obstacle protects the gap it describes, and
this one is worse than a defect in the code — it was a defect in the checking.

Storage remains unenforced, and there the original reasoning still holds:
nothing measures stored bytes.

## P29 — 0 of 520 verified

The zero is the least interesting thing in this verdict. **Five defects were
found and fixed inside this phase, three of them by tests written for it, on
their first run.**

### What the phase found

**A read permission gated a write to a column holding SQL text.** Anyone
holding `reports.read` — nearly every role — could insert, edit or delete a
metric definition, and `expression` is SQL. Nothing executed it at the time, so
the exposure was latent. "Safe because nothing reads it yet" is the same
sentence as the secret boundary before it was enforced, and it holds exactly as
long as nobody writes an evaluator. This phase then wrote one.

**A definition could move under the numbers it had produced.** The fifth
appearance of this pattern, after library rates, plan terms, claim deadlines and
document revisions. Metric definitions are now versioned append-only, published
only when the calculation changes — a rename publishes nothing, because a rename
does not change what a past number meant.

**TRIR and DART were defined against a view that could not produce them.** Both
divide incidents by hours worked. Incidents lived in one view, hours in another,
and no view carried both — while the safety view's own comment claimed the rates
"are defined in metric_definitions rather than hard-coded here", as though
defining them were the same as producing them. **And DART's numerator added
restricted *days* into a rate that counts *cases*:** a single restricted-duty
case lasting sixty days contributed sixty. These are the two numbers a general
contractor is prequalified on and an insurer rates. The first defect made them
unproducible; the second would have made them wrong in the direction that costs
a contractor work.

`reporting_safety_rates` now joins recordables to approved hours at one grain,
with a full outer join rather than an inner one — a month with hours and no
incidents is a TRIR of zero and the best month a company can have, and
inner-joining it away would report a company's rate as though its safe months
never happened.

**The public API promised to evaluate a metric and returned the SQL text of its
definition.** `GET /metrics/{metricKey}` is published as "Evaluate a governed
metric", generated straight into the OpenAPI specification third parties read.
A consumer asking for gross margin received a sentence of SQL. It now returns
the value, through `app.evaluate_metric` — which executes only definitions the
platform authored, refuses where a company has overridden the metric rather than
answering under a name the company redefined, and requires a company in its
signature because the gateway runs as the service role with row level security
bypassed.

That evaluator was deliberately **not** built first. Executing a stored
expression while a `reports.read` holder could supply one would have turned an
inert column into arbitrary SQL. Narrowing the permission, recording each
metric's source view, and proving by test that every platform expression
executes against it — in that order — is what made evaluation safe to build.

**A version history contradicted its own delete policy.** Deleting a metric
failed with "metric_definition_versions is append-only" — an error naming a
table the caller never mentioned, for an operation a policy said they could
perform. A metric somebody reported a number under is now retired, not deleted,
and the policy that promised otherwise is withdrawn rather than left to fail at
the bottom of a cascade.

### Why it is zero anyway

Four of nine conditions fail, and two of them are one finding.

**Query and report behavior.** One of nine governed analytics views is served
anywhere. The Reports and Analytics screen computes from static fixtures, reads
no reporting view, and its Export button carries no handler at all. That is not
specific to the screen: **22 of 23 application screens read demonstration
fixtures, and only Billing queries live data.** A semantic layer nothing
consumes cannot demonstrate report behavior, cannot be reconciled against
anything, and cannot have its data quality observed — which is why
**reconciliation** and **data quality** fail with it.

Making the Export button emit the fixtures it currently displays would be worse
than leaving it inert, because a working control over demonstration data reads
as a finished feature. The permanent fix is 22 screens' worth of live queries,
and it is recorded at full size rather than shaved down to something closable
today.

**Transformation version.** Metric definitions are versioned; the reporting
views are the actual transformations and carry no version. A number cannot be
tied to the view revision that produced it.

### And one more, found by execution rather than by reading

**A company cannot be deleted.** The owner-retention guard refuses the cascade
into `company_memberships` and cannot be satisfied — removing the memberships
first raises the same error. Behind it sit eight append-only tables that cascade
from `companies` into a DELETE they forbid, so that layer is never even reached.
Tenant data is not merely undeleted; it is undeletable, and nothing says so.
That is the concrete mechanism behind the retention and erasure gaps P15 and P28
both recorded, and the fix is an erasure policy with legal weight rather than a
missing trigger — so it is named precisely instead of guessed at.

## The honest next step

Fifteen phases are verified. The vertical from core platform through master
library to estimating engine holds — **P24 at 92%, P25 at 79%, P26 at 75%,
P05 at 52%** — scheduling stands on a real engine at **25%**, commercialization
at **32%** and contracts at **32%**. P28 security is at **0%**, with its five
load-bearing conditions met and three absent.

Across twelve of the thirteen the same pattern held: **tracing over-claimed
before the work was done.** P11 is the exception, and a useful one — it says
the method finds implementations that are already sound as readily as ones that
are not. P26 at 310 traced against 0 verified, P25 at 324 against 0,
P24 at 187 against 0, P28 at 185 against 0, P18 at 332 against 0, P30 at 308
against 0, P19 at 289 against 0. In each case verification named a small number
of specific absences, and building those moved hundreds of requirements at once.

P19 is the sharpest case: contracts, change orders and claims were counted as
`traced_tested` and had **no tests whatsoever**. Every one of its four defects
was found by writing the suite that should already have existed.

A second pattern has now appeared nine times, and it is the more useful one:
**the interface asserting a property the code does not have.** A settings toggle
that switches nothing, a float figure nobody computes, a plan limit nothing
enforces, a pricing page selling single sign-on, a claim deadline that says it
comes from the contract and does not, a credential status nothing reads, a
notification table with no producer, a document revision nobody counted, an
extracted-text index whose own comment named the search that never queried it. Each was found by reading the screen or
the schema against the code rather than by any test, and each is now held by
one.

What remains is now mostly named capabilities that genuinely do not exist —
domain events, feature flags, takeoff, templates, selection engines, subcontract
libraries, import paths, earned value, look-ahead — rather than structural gaps.
Each is ordinary building work with a clear boundary.

For P28 the three named absences are **detection and response**, **secret
lifecycle** and **security monitoring**. The first two are substantial
programs rather than single capabilities; the third is closest to hand, since
the signals already exist and want consumers.
