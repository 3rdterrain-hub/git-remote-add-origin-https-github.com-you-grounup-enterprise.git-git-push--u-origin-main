# Master Traceability Matrix

The bridge between the GES requirements spine and this codebase.

The GES is the **requirements**. This repository is the **implementation**. This
directory is the mapping between them, and it is generated — `npm run
traceability` rebuilds it, and `npm run verify` fails if the committed matrix
has drifted from the code.

## What it answers

| Question | Where |
|---|---|
| Which requirements does this engine answer for? | `artifact-coverage.csv` |
| What implements this requirement, and what tests it? | `traceability-matrix.csv` |
| What exists in the codebase at all? | `artifacts.csv` — derived, never hand-listed |
| How was each mapping decided? | `mapping-rules.json` — 43 rules, each with its reasoning |
| Where do we stand? | `summary.json` |

## Where we stand

**9,475 requirements. 4,826 traced (50.9%). 4,649 untraced. 1,914 verified of 7,855
judged.**

Fifteen phases have been verified requirement by requirement — see
[`verification/`](verification/README.md):

| Phase | Requirements | Verified |
|---|---:|---:|
| P05 Estimating & Cost Intelligence | 108 | 56 (52%) |
| P24 Core Platform Implementation | 360 | 332 (92%) |
| P25 Master Library & Rate Management | 400 | 315 (79%) |
| P26 Estimating Execution Engine | 450 | 339 (75%) |
| P28 Enterprise Security | 500 | 0 |
| P20 Integration, Deployment & Readiness | 450 | 0 |
| P27 AI Platform & Agent Governance | 480 | 0 |
| P18 Scheduling & Resource Management | 400 | 98 (25%) |
| P30 Commercialization & Billing | 540 | 174 (32%) |
| P19 Contract, Change & Claims Management | 420 | 135 (32%) |
| P10 Financial Management | 240 | 16 (7%) |
| P14 Safety, Health, Environment & Quality | 320 | 54 (17%) |
| P15 Document & Information Management | 340 | 133 (39%) |
| P11 Procurement & Supply Chain | 260 | 80 (31%) |
| P12 Fleet & Equipment Management | 280 | 72 (26%) |
| P29 Business Intelligence & Analytics | 520 | 0 |
| P09 Workforce & Human Resources | 210 | 0 |
| P08 CRM, Sales & Customer Management | 180 | 6 (3%) |
| P07 Project Operations | 160 | 18 (11%) |
| P16 Survey, GIS & Geospatial | 360 | 0 |
| P17 Machine Control & Field Automation | 380 | 0 |
| P03 Data Architecture | 75 | 41 (55%) |
| P01 Enterprise Governance & Tenancy | 25 | 9 (36%) |
| P23 Platform Engineering & Implementation Controls | 300 | 0 |
| P04 Master Library Registry | 97 | 36 (37%) |

P20 verifies at zero for a reason worth stating plainly: this build added a
CI workflow, a deployment workflow, the Supabase project configuration and a
build-output secret scan, and **none of it has ever run**. A workflow file is
not a pipeline. Counting committed YAML as deployment evidence would be the
largest instance of the exact defect these phases were spent finding.

P29 verifies at zero for a different reason, and the zero is the least
interesting thing in its verdict. Five defects were found and fixed inside it:
a read permission gating a write to a column holding SQL text, a metric
definition that could move under the numbers it had already produced, TRIR and
DART defined against a view that could not produce them with DART's numerator
adding restricted *days* into a rate that counts *cases*, a public API route
published as "Evaluate a governed metric" that returned the SQL text of the
definition, and a version history that contradicted its own delete policy. Two
findings stay open and are stated at full size: the analytics the platform
computes reach almost nobody — 22 of 23 screens read demonstration fixtures —
and a company cannot be deleted at all, which is the concrete mechanism behind
the retention gap P15 and P28 both recorded.

P09 verifies at zero and found the two worst defects in the build. **The
credential gate failed open**: expiry was a stored column maintained by a
trigger that only fired when somebody wrote the row, so a CDL that lapsed two
hundred days earlier still read `valid` and the control that exists to refuse an
unqualified operator accepted the assignment. **And labor never reached the
job**: `project_costs` carried a `labor` cost type, an `hours` column and a
`timecard` source, the financial view summed them, and nothing had ever written
a labor row — so `actual_cost` omitted the largest cost category on a
construction job and every reported margin was too high. Both are fixed, with
26 tests behind them.

P08 verifies at 6 of 180 and found four more of the same kind, all on the
document that reaches the customer. A proposal could be **issued from a draft
estimate**, at **a total price of zero while the estimate it cited bid
$1.2m**, with **line detail that need not add up to it** — and then the
immutability control froze the header while every line item stayed editable,
because the content lives in a table that trigger never touched. All four are
reproduced in tests and closed by migration 0045: the price is now the engine's
bid price rather than a typed number, nothing leaves draft from an unapproved
estimate, the detail must tie, and the freeze reaches the content.

P07 verifies at 18 of 160 and finished the job cost chain three phases had been
opening one link at a time. **Committed cost was read by the report and written
by nothing**, so a project manager could not see a dollar of what the company
had already promised a vendor. **Approved vendor invoices never became cost**,
so materials and subcontracts were zero alongside the labor P09 fixed. And the
control refusing to over-invoice a purchase order **guarded a column no invoice
ever moved** — the third phase running where the defect was a guard pointed at
something nothing feeds. Migration 0046 closed all three: an issued order
commits, an approved invoice consumes the commitment and becomes cost, and the
two never double-count.

P16 verifies at zero and found the most dangerous defect in the build. A surface
was a cell size, a row count and a column count with **no origin anywhere** —
not in the table and not in the engine — so "sharing a grid" meant sharing a
*shape*. Two 10x10 grids at 25 feet, one over the north end of a site and one
five hundred feet south, passed every check and produced a confident earthwork
quantity that was entirely fictitious. The platform had already written the
argument against itself: the guard that existed says a volume across mismatched
datums "is wrong by the offset and looks entirely plausible." Migration 0047
anchors a surface to the ground and refuses a comparison that cannot prove the
two cover it.

P17 verifies at zero, and there the zero is close to the truth: one domain of
twenty-nine is built. What the phase found was five defects on the one artifact
that does exist — the file a machine is sent. It could be **published with no
digest**, so nobody could show the file on the grader was the file approved. The
**surface it was cut from could be edited afterwards**. A **draft** file could
be sent to a machine, and so could a **superseded** one. And a supersession
chain **could close a loop** — the defect the document layer fixed in 0036,
never applied to the artifact where "which one is current" is a person on a
machine asking what to build.

P03 verifies at 41 of 75 — the highest of any phase, and it should be: the
schema is the part of this platform built most carefully, and P03 is the phase
that asks about the schema. It still found that **the column every query filters
on was unindexed on 53 of 136 tables.** Row level security predicates on
`company_id` on every read by every user, so on those tables the cost of reading
one company's data grew with the number of companies on the platform — the one
property a multi-tenant system must not have. Not a correctness defect, which is
why nothing caught it. Migration 0049 creates the indexes from the rule rather
than one at a time, and a schema-invariant suite now holds four properties the
schema had and nothing checked: no money in a floating-point column, every
timestamp with its time zone, nothing materialized, and the tenant key indexed.

P01 verifies at 9 of 25 — the phase that judges the governance apparatus itself,
turned on this build's own machinery. It found that **the audit ledger asked
four questions it could not answer**: `correlation_id`, `ip_address`,
`user_agent` and `actor_email` were written by nothing, so every audit row in
the platform had them null — and a change made through the public API was
recorded as an **anonymous insert**, because the gateway authenticates with a
named key and runs as the service role where `auth.uid()` is null. Migration
0050 reads the request context PostgREST was already publishing and the gateway
now labels itself. Three findings stay open and are the honest shape of the
phase: **reads are audited nowhere** and neither are exports, **append-only is
not tamper-evident** and the platform is careful never to claim it is, and **one
approver of sufficient rank is not two people** — there is authority and no
separation of duties.

P23 verifies at zero and is the phase that asks whether an implementation can
point back at what it implements. Until this build it could not: **every mapping
in this register was derived** — a rule matched a topic word and concluded a
file was relevant — and no source file anywhere stated what it implements. That
is precisely the direction that over-claims, which is why every phase judged has
come in far below its traced percentage. A file may now declare `@implements
EDM-000002` in its own header; the generator records it in a column deliberately
never merged into `artifacts`, and a declaration naming a requirement the
register does not have fails the build — which caught eleven of mine on the
first run. Eleven requirements carry one today, which is a beginning and not a
condition met. P23 also records something about the specification rather than
the platform: its acceptance criterion requires "Phase 22 execution controls",
and **P21 and P22 are absent from the register entirely**.

P04 verifies at 36 of 97 and found the purest instance of the pattern this build
has hit in every phase. **The calibration loop is modeled three times over and
was never closed**: `production_actuals` records what a crew installed against
the hours it took and points at the very rate that estimated it,
`production_rates` carries a sample size, a confidence score and a source type
meaning "from company actuals", library rows carry an `origin` value
`calibration`, and the notification catalog carries a `calibration` category —
while `production_actuals` was referenced by no statement anywhere outside its
own definition. Learning what work actually takes is the thing an estimating
platform is for. Migration 0051 publishes the variance, weighted by hours and
with the evidence behind it, and deliberately does **not** move the rate: a
library rate is an approved record, and rewriting one automatically from field
data would be the automation overreach the governance rules exist to prevent.

P28 verifies at zero with its **five load-bearing conditions met** — allow/deny,
tenant isolation, least privilege, audit evidence and security tests — and three
absent: detection and response, secret lifecycle, and security monitoring. It
also carries the one finding where the interface claims a security property the
code does not have.

The other eight moved by building, and each moved the same way: verification
named a small number of specific absences, and closing those absences carried
hundreds of requirements at once.

- **P24** verified at **zero** despite 21 of 25 domains being built and four of
  five conditions met. The whole phase was gated on observability, which did
  not exist. Building it moved 332 requirements.
- **P25** verified at **zero** despite 23 of 32 domains being built, because
  four of its eight conditions existed on `services` and nowhere else.
  Migration 0028 carried the shape to the other eleven libraries and added row
  history, taking it to 315.
- **P26** verified at **zero** despite 33 of 49 domains being built, until
  library snapshots, scenario pricing and a general override record closed the
  three conditions blocking every domain at once. It now stands at 339.
- **P05** verified at 45 until an assembly expansion engine, a material cost
  derivation and a portable estimate format closed three of its gaps. It now
  stands at 56.
- **P18** verified at **zero** on the highest-traced phase in the register: it
  stored schedule float and criticality and computed neither. A critical path
  engine, a work calendar and baselines took it to 98.
- **P15** verified at **zero** on three failing conditions, and writing the
  tests to close them found a fourth nobody had seen: a cross-tenant hole in
  the evidence layer. It now stands at 133.
- **P14** verified at **zero** because a safety system that records everything
  and prevents nothing fails two of its six conditions. A credential blocking
  control and the notification table's first producers took it to 54.
- **P19** verified at **zero** on three tables the matrix counted as tested and
  that had no tests at all. Writing them found four defects; closing those took
  it to 135.
- **P30** verified at **zero** because commercial terms were resolved against a
  catalog that had since moved. Plan versioning, limit enforcement and three
  truth fixes took it to 174.

Tracing had claimed 78 of P05's 108 and 310 of P26's 450 before any of that
existed. **Derived tracing over-claims** — treat the 50.9% as an upper bound,
not a coverage figure.

Of 278 cataloged artifacts, 144 answer for at least one requirement.

| Best covered | | Least covered | |
|---|---:|---|---:|
| P18 Scheduling | 83% | P31 Production infrastructure | 17% |
| P25 Master libraries | 81% | P06 AI construction intelligence | 20% |
| P11 Procurement | 75% | P32 Go-live certification | 21% |
| P15 Documents | 72% | P20 Deployment & readiness | 25% |
| P05 Estimating | 72% | P17 Machine control | 27% |
| P07 Project management | 71% | P16 Reality capture | 34% |

The largest untraced modules are `Observability` (53), `Data Architecture` (49),
`Feature Flags` (29), `Security Engineering` (25), `Infrastructure as Code` (22)
and `Environment Strategy` (22). That is an accurate picture: this is a working
platform without production operations around it.

## Tracing is not verification

This distinction is the whole integrity of the matrix, and it is enforced.

- **`traced_tested`** — an artifact exists that implements this topic, and that
  artifact is covered by a named test suite which runs in `npm run verify`.
- **`untraced`** — nothing here claims to implement it. The honest default.
- **Verified** — someone read this requirement's acceptance criteria and
  confirmed a specific test asserts it. **1,914 requirements are verified** of
  7,855 judged, across P01, P03, P04, P05, P07, P08, P10, P11, P12, P14, P15, P18, P19, P24, P25, P26 and
  P30, each recorded in its own `verification/*-ledger.csv`. P09, P16, P17, P20, P23, P27,
  P28 and P29 were judged and verified at zero. Every phase that has not been judged reports `none`, and a test asserts it.

Every mapping is marked `derived`, because rules are applied mechanically. A
derived mapping says an implementing artifact exists. It does not say anyone
read that requirement.

## How the rules were disciplined

The first generated run claimed **99.1% coverage**. It was matching patterns
against the free text of every requirement, where words like "permissions",
"audit" and "project" appear almost everywhere. Matching the module topic
instead brought it to 56.5%.

Auditing the result found the matrix still over-claiming:

- **"Automatic Grade Control" and "GPS/GNSS Positioning" traced to
  `machine_control_files`.** Storing a design file is not guiding a machine.
- **"Construction Knowledge Retrieval" traced to the plan analyst.** There is no
  retrieval layer.
- **"Onboarding", "Training and LMS", "Certified Payroll" traced to
  `employees`.** An employee table is not an onboarding workflow.
- **"AI Crew Recommendation" traced to the resource engine.** A crew engine is
  not an AI that recommends crews.

Two mechanisms fixed it, both recorded in `mapping-rules.json`:

1. **Per-rule `exclude`** — a rule states the boundary of what it implements.
   TR-010 covers machine control *files* and explicitly excludes positioning,
   localization and grade control.
2. **A `global_exclude`** for capability classes that do not exist anywhere here
   — digital twins, copilots, marketplaces, portals, self-service, onboarding,
   recommendation engines.

That took coverage to **50.9%**, and every step down was a correction.

## What keeps it honest

`tests/governance/traceability.test.ts` — 25 tests, run by `npm run verify`:

- Every referenced artifact exists in the catalog, and every cited test file
  exists on disk.
- No status can be read as verification — the only two the generator may emit
  are `traced_tested` and `untraced` — and a verdict appears only on a phase
  with a ledger behind it.
- Every number this README states is recomputed from `summary.json`, so the
  prose cannot drift away from the generator that produced it.
- No rule may match an implausible share of the corpus — this is the check that
  would have caught the 99.1% run.
- P31 and P32 must stay below 30% traced, because neither is built. A matrix
  showing them well covered would be lying.
- Every total is recounted from the matrix rather than trusted.

These were confirmed to have teeth: deliberately widening one rule to match
`the|a|and|of|for|platform` pushed coverage to 86.7%, and **three independent
tests failed**.

## The honest next step

P05, P10, P11, P12, P14, P15, P18, P19, P24, P25, P26 and P30 have been judged
and built against. P28 is the one phase judged that did not move, and its three absences are named rather than
estimated: **detection and response**, **secret lifecycle**, and **security
monitoring**. The third is closest to hand — the metrics engine, the structured
logger and the audit ledger already produce the signals, and nothing consumes
them. Defining the security metrics and the alerting on top of what already
emits would move the largest block of P28 for the least new machinery.

P18 is the clearest illustration of why derived tracing is an upper bound: it
traced at 83%, the highest of any unjudged phase, while the platform stored
float and criticality and computed neither. It now verifies at 25% on a real
critical path engine, with the twelve partial domains each naming what is
missing.

P11 is the first phase judged where the implementation was already close:
three of its four conditions held on the first reading, and its 25 existing
tests made it the best-covered area examined. The single missing control was
that the commitment a contractor makes most often — a purchase order — had no
signing limit, while change orders and contracts did.

P10 is the one phase where the honest answer is mostly "not built", and where
the register itself is the problem: **797 requirements across five phases carry
no acceptance criteria at all**, so verification as defined here cannot run on
8.4% of the corpus. P10 was judged against its requirement statements instead,
which are specific enough to serve, and the verdict says so rather than
implying a criterion existed. It verifies at 7% because there is no general
ledger — no chart of accounts, no journal entry, no trial balance — and six of
its sixteen subjects have nothing to judge. Saying that plainly is worth more
than a partial verdict implying something is there.

P30 produced the finding with the sharpest edge. Three separate places sold
capabilities the code does not have — the pricing page's Enterprise headline,
its comparison table, and the seeded plan description all advertised single
sign-on, which has never existed — and every plan limit was stored and enforced
nowhere. The claims are gone, the limits are enforced, and both are now held in
place by tests rather than by care.

Beyond P28, the largest untraced modules are not features but production
operations: `Observability` requirements beyond the library now built, `Data
Architecture`, `Feature Flags`, `Infrastructure as Code` and `Environment
Strategy`. That is the accurate shape of this platform — the product is built
and tested; the operations around it are not.
