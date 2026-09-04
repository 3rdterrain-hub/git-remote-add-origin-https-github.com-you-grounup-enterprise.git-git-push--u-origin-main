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

**9,475 requirements. 4,826 traced (50.9%). 4,649 untraced. 1,804 verified of 5,548
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

P20 verifies at zero for a reason worth stating plainly: this build added a
CI workflow, a deployment workflow, the Supabase project configuration and a
build-output secret scan, and **none of it has ever run**. A workflow file is
not a pipeline. Counting committed YAML as deployment evidence would be the
largest instance of the exact defect these fourteen phases were spent finding.

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

Of 268 cataloged artifacts, 144 answer for at least one requirement.

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
  confirmed a specific test asserts it. **1,804 requirements are verified** of
  5,548 judged, across P05, P10, P11, P12, P14, P15, P18, P19, P24, P25, P26 and P30, each recorded in its own
  `verification/*-ledger.csv`. P28 was judged and verified at zero. Every phase
  that has not been judged reports `none`, and a test asserts it.

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

`tests/governance/traceability.test.ts` — 21 tests, run by `npm run verify`:

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
