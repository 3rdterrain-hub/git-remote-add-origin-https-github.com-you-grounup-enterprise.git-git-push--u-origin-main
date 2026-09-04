# Governance

The architectural rule for GrounUp, and the machinery that keeps it.

> Everything in GrounUp must belong to exactly one of five things:
> **Engine** (performs calculations or business logic), **Library** (stores
> reusable knowledge), **Entity** (stores business records), **Workflow**
> (defines processes), **AI Agent** (assists users and automates work within
> governance). Nothing exists outside these five.

## Why this is code and not a document

A rule written only in a specification is a rule the build cannot keep. Six
months from now someone adds a table at 6pm on a Friday, and no document stops
them.

So the rule is enforced. `tests/governance/registry.test.ts` reads the live
database and the real source tree and fails when anything is unclassified,
doubly classified, or violates the invariants its category promises. It runs in
`npm run verify`. Adding a table without classifying it breaks the build.

Writing the enforcement immediately found four things wrong with the code it
was written to protect:

1. **`resolveEquipmentRate` read the clock.** Its own doc comment promised that
   `asOf` lets a historical estimate re-resolve to the rate in force when it was
   priced — but `asOf` was optional and fell back to today, so reopening a
   two-year-old estimate silently repriced it against the current rate sheet
   with no indication. `asOf` is now required. This was a real defect in the
   engine, and it is precisely the class of thing the ENGINE invariants exist
   to catch.
2. **`change_order_items` was classified as a Workflow.** It is a detail row of
   a change order with no state of its own. Reclassified as an Entity.
3. **`task_dependencies` cannot carry a platform seed** even though `tasks` can,
   because its `company_id` is `NOT NULL`. Recorded as `LIM-001` rather than
   quietly reclassified — see `registry.json`.
4. **One of the enforcement tests was itself wrong**, searching for the word
   "autonomous" as a forbidden string when the constraint that forbids it
   necessarily contains it. Rewritten to assert the allowed set.

## Files

| File | What it is |
|---|---|
| `categories.json` | The five categories and their 17 enforceable invariants, each with the reason it exists and what enforces it. |
| `registry.json` | Every table, engine and agent, classified. 137 tables, 28 engines, 1 agent. Also records each library's scope model and known limitations. |
| `requirements/ges-requirements.csv` | 9,475 requirements ingested from the GES v1.0 phase packages, normalized across the twelve different column schemas they use. |
| `requirements/phase-coverage.csv` | What of each GES phase actually exists in this repository. |
| `requirements/summary.json` | Counts, and what was deliberately excluded. |

## The library scope model

Not every library has the same scope, and pretending otherwise would make the
invariant a lie. Five shapes, each declared per table and checked against the
schema:

| Scope | Count | Meaning |
|---|---:|---|
| `three_tier` | 12 | Platform seed, enterprise group, company override. The canonical library shape. |
| `child_of_library` | 4 | Detail rows of a three-tier parent; scope is inherited, never restated. |
| `global_or_company` | 3 | A platform row, or a company's override of it. No group tier. |
| `company_only` | 4 | No platform seed exists or could sensibly exist — a disposal site is a real local facility. |
| `platform_only` | 3 | Identical for every tenant. |

The twelve three-tier libraries are what an estimate is priced from. Losing the
tier on any one of them means a company can no longer override a seeded rate,
so the test names all twelve explicitly.

## On the GES requirements register

The register is real and worth keeping: 9,475 requirements, every one with a
statement, 8,678 with acceptance criteria, across 2,087 distinct sentence
shapes. That is a serious backlog, not filler.

It is also worth reading with a measured eye. About 29% of the statements are
mechanically composed from a fixed aspect list — 2,238 of them are a
per-module "permissions" requirement, and 438 an "auditability" one. Those name
a topic rather than a behavior, and they are not testable as written. The
remaining 71% carry real content.

The register's own test cases are not tests. Every one reads "Execute positive,
negative, retry, and audit scenario" with status `Planned`. They are one
mechanically generated row per requirement. This repository's 817 tests are
separate work and are the ones that actually run.

So the register is used here as **the backlog**, not as a description of what
exists. `phase-coverage.csv` records the difference.
