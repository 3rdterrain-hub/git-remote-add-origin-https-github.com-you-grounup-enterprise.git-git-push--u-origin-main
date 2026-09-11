# Project memory

The durable ledger for GrounUp Enterprise. `CLAUDE.md` says how to work here;
this file says what is *true* here — what has been decided, what has been built,
what is known to be wrong, and what was learned the expensive way.

It is written to be read cold, by somebody with no memory of the conversation
that produced any of it. Nothing in it may be a plan. If something is listed as
done, it is done and tested; if it is open, it says so.

---

## 1. What this is

A construction estimating and operations platform for an excavation and site-work
contractor, built to be sold to others. One database, one engine, one gateway,
one web application, multi-tenant by `company_id` on every row.

**Definition of success, in the user's own words:** *a working estimator that
calculates labor, equipment, material, production, trucking, overhead, profit and
final selling price; a complete GrounUp Enterprise platform that is functioning
and ready to be tested; then customer ready.*

The estimator is the heart. Everything else is judged by whether it feeds the
estimate or follows from it.

---

## 2. The shape of the thing

| Layer | Where | What it is |
|---|---|---|
| Schema | `supabase/migrations/*.sql` | 149 migrations. Catalog seeds sit at 0900+, which is why `db push` needs `--include-all`. |
| Engine | `packages/engine/` | The only place a price is computed. Pure TypeScript, no database access. |
| Engine (edge copy) | `supabase/functions/_shared/engine/` | **Generated.** `npm run engine:edge` writes it; `engine:edge:check` fingerprints it. Editing it by hand is a defect the gate catches. |
| Functions | `supabase/functions/` | 14 Edge Functions: pricing, billing, Stripe webhook, AI, email, weather, the API gateway. |
| Web | `apps/web/` | React + Vite + Tailwind + shadcn/ui. No custom CSS. |
| Governance | `governance/`, `tests/governance/` | The rules that fail the build rather than being described in a document. |

### The five categories
Everything is an **Engine**, **Library**, **Entity**, **Workflow** or **AI Agent**,
and says which in its header comment. A governance test enforces it.

---

## 3. Decisions that are settled

These are not open for re-litigation. Each cost something to arrive at.

1. **Cost buckets never merge** (RULE-001). Labor, burden, equipment,
   mobilization, fuel, material, trucking, disposal, subcontract, other. Fuel
   folded into an equipment rate is the classic way a contractor loses the
   ability to see where the money went.
2. **Rate precedence** (RULE-003): `project_quote` > `tenant_approved` >
   `regional` > `global_seed`. **The rate a screen shows must be the rate that
   prices.** A screen showing one and pricing another is the defect, not the
   display.
3. **AI proposes, humans accept** (RULE-008). No AI write reaches an approved
   estimate, a library, a contract, a schedule, billing, permissions or
   safety-critical data without the approval workflow.
4. **An issued version is immutable** (RULE-009).
5. **Engine outputs are never hand-written** (migration 0058). A price somebody
   typed is a price nobody can reproduce. `app.record_engine_result` is the only
   writer, and it is granted to `service_role` alone.
6. **Never invent a number.** No national average, no guessed unit, no silently
   converted rate. Refuse the row and say why. `MBF` is refused because it is a
   multiplier, not a unit; `EA` on crushed stone is loaded as stated and flagged.
7. **An unrecognized jsonb field name is refused, never ignored** (0136, 0139).
   This rule exists because `markupOverride` was once sent where the database
   read `markup_override`: the key matched nothing, `coalesce` kept every old
   value, and the call returned success.
8. **A price of nothing is not a price** (0121). An uncosted material reads
   `not_costed`, never `$0.00`.
9. **Subscription access comes from verified Stripe webhook state only.** A
   browser redirect grants nothing. Secrets live in Supabase server-side
   environment only; the bundle scan in `verify` proves none reached the client.
10. **`adjusted` vs `gross`.** `adjusted` is the quantity to be *produced*;
    `gross` is the quantity to be *purchased*. Waste applies to gross. A quoted
    unit rate is not inflated by waste — this was tested wrongly once.

---

## 4. The defect this build produces

**A working feature with no door.** A tested database function, granted to
`authenticated`, that nothing in the application calls.

Found **eleven times**: lead intake (0065), assemblies, unit cost, resource
suggestions, the equipment-rate importer, `document_sheets`, the parametric
rate, the line-price write-back, Plans & Specs, `line_unit_note`, and services
with no breakdown.

Not one was caught by a test, and every layer was green each time: the migration
was tested, the function was tested, the payload was tested, the component was
tested. **Nothing tested the joint.**

**The countermeasure:** `scripts/build-door-inventory.mjs` enumerates every
`public.*` function and `my_*` view from the migrations, matches each against
its readers in `apps/web/src` and `supabase/functions`, and writes
`governance/DOORS.md`. `npm run doors:check` runs in `verify` and fails when a
door has no reader and no stated reason. A door now arrives with a caller, or
with a written reason it is server-side, **on the commit that adds it**.

The variant one layer in: **a control that takes a value and changes nothing.**
When adding a function, ask who calls it. When adding a field, ask what reads
it. When a screen shows a number, ask whether that is the number that prices.

---

## 5. Traps in this repository

Each of these cost at least an hour.

- **Compiled `.js` beside a source file silently wins.** Vite resolves `.js`
  before `.tsx`. 262 emitted files once shadowed the sources; a deliberate
  syntax error in a `.tsx` did not break the build, which is how it was proved.
  `apps/web`'s own typecheck script was emitting them. Governance test:
  `no-compiled-output-beside-the-source.test.ts`.
- **Typecheck from the repo root.** `apps/web/tsconfig.json` is a solution file
  with `files: []` and checks nothing. The gate uses `tsconfig.app.json`.
- **`npm run docs` before `npm run test`** when a migration is added, or stale
  counts fail the gate after a green test run.
- **Do not edit files while the gate runs.** The docs counts and the test results
  end up describing different trees.
- **`npm run functions:deploy` carries `--import-map`.** Without it all fourteen
  functions fail to bundle and the deploy silently does nothing.
- **A tenant UPDATE with no UPDATE policy affects 0 rows and does not raise.**
  Tests must assert on the row, never on the absence of an error.
- **Migration 0028:** a company-owned library row that is `active` must name an
  approver. Tests that insert one directly will fail on the constraint.
- **`userEvent.type` after a click appends.** The second click is an edit, not a
  replacement — use `click` then `keyboard`.
- **American English.** `tests/governance/spelling.test.ts` carries the list and
  fails the build on any of it. The words cannot be quoted here as examples —
  writing one down in this file is itself a failure, which is how this line came
  to be worded this way.
- **Node** lives at `/Users/tradertree/.grounup-tools/node-v24.20.0-darwin-x64/bin`
  and must be on `PATH` in every shell.

---

## 6. The estimate line

One line item is **one line**: every field visible, no horizontal scroll,
columns aligned down the whole estimate, description widest because it is the
field being typed into.

- One CSS grid template on every row. **No `min-w-[…]` anywhere on the row** —
  one minimum width in one child forces its column wider and pushes every number
  right. That is what "everything gets out of line" meant.
- Editors open **under** the row, never inside a cell.
- Column order: `+ ⠿ № 👁 | SERVICE | 🔧 | QTY | UNIT | COND. | UNIT COST | MARKUP | +MARKUP | TOTAL | ⧉ 🗑`
- **A box shows what was typed, not `0` first.** An empty quantity is empty.
- No permanent explanatory text under a quantity. The calculation echo appears
  only while the field has focus.

---

## 7. Standing instructions from the user

Said once; they should not have to be said again.

- **Nothing is read-only without a reason.** If a person can see it, they can
  edit it there, unless a stated rule forbids it.
- **All cards collapse.**
- **Everything can be shown to the client** — per-item visibility on bids and
  proposals.
- **Categories are user-addable**; most columns get a select rather than free text.
- **Cost codes are optional.** Nothing refuses a line without one. They live in
  the wrench panel, not on the row.
- **Work the toolbar in order**, one nav section at a time, and say before a
  section closes.
- **A finished product, not a plan.** Time, fatigue and complexity are not
  excuses. Never a workaround when the real fix exists. Never leave a dangling
  thread when tying it off takes five minutes.

---

## 8. Verifying and shipping

```bash
npm run test     # every suite
npm run docs     # regenerate counts — needs a green test run first
npm run verify   # typecheck, edge fingerprint, openapi, schema, counts,
                 # traceability, doors, all suites, build, bundle secret scan
```

- `npx supabase db push --include-all`
- `npm run functions:deploy`
- Push only on a green gate.

---

## 9. State of the build

**Green.** The gate passes from a clean tree. The estimator prices labor,
burden, equipment, mobilization, fuel, material, trucking, disposal, subcontract
and parametric lines, applies condition modifiers and markup, and writes its
outputs only through `record_engine_result`.

Recorded here rather than in a plan, because what remains is the honest part:

- **Weather at the job site** is partly built — migration 0105 and the
  `refresh-weather` function cover the forecast; per-project siting and current
  conditions are the next slice.
- **The toolbar** is worked in order. Each section closes with the user told.

---

*Kept current by hand. A statement here that stops being true is worse than no
statement at all — delete it or fix it on the commit that makes it false.*
