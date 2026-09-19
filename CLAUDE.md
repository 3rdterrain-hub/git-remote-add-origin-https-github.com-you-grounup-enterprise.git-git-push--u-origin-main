# GrounUp Enterprise — how to work in this repository

**This file is read at the start of every session. Edit it.** If something has to
be said twice, it belongs here instead. Anything below is a standing instruction,
not a suggestion, and it outranks any habit or default.

---

## The standard

Every step double- and triple-checked for accuracy, executed fully, tested, and
documented. Never offer something for later when the permanent solve is within
reach. Never leave a dangling thread when tying it off takes five more minutes.
Never present a workaround when the real fix exists. Search *before* building.
When something is asked for, the answer is a finished product — not a plan to
build one. Time, fatigue and complexity are not excuses.

**`governance/EXECUTION_PROTOCOL.md` is the full statement of this, given
verbatim on 11 September 2026 and standing from that point. Read it at the start
of every session, along with this file.** It defines what "done" means, the three
memory files that must be maintained, the research required before building, the
testing that is mandatory, the three reviews before delivering, and the shape of
the final response. Where it and a habit disagree, it wins.

### The three memory files, maintained every session

- `PROJECT_MEMORY.md` — the project's current state, at the repository root.
- `REQUIREMENTS_TRACEABILITY.md` — every requirement, with its id, source,
  implementation, covering test and status.
- `DECISION_LOG.md` — every material decision, with its reason, alternatives,
  authority and what it superseded.

They are deliverables, not notes. Update them *during* the session that changes
what they describe. Read all three before starting new work, and continue from
the last verified state rather than rebuilding what is done.

---

## Before building: search

Most of the wrong turns in this repository came from building to a *recollection*
of what was asked rather than to what was actually said.

- **Read the actual words before designing to them.** The conversation transcript
  is at `~/.claude/projects/-Users-tradertree-Documents-GROUNUP-ENTERPRISE-THE-BUILD/*.jsonl`.
  Grep it for the user's own phrasing. A summary of a requirement is not the
  requirement.
- **Search for the machinery before writing it.** Twice a duplicate was built
  next to something that already worked — a second lead-intake beside migration
  0065, a second `set_material_cost` beside 0121's. Grep the migrations, the data
  layer and the components first.
- **A screenshot beats a description.** Ask for one, or read the ones on the
  Desktop. Layout arguments in prose have gone wrong three times and right in one
  pass every time a picture was involved.

---

## The defect this codebase keeps producing

**A working feature with no door.** A tested database function that nothing in
the UI calls. Found at least six times: lead intake, assemblies, unit cost,
resource suggestions, the equipment-rate importer, and `document_sheets` — which
had a table, RLS, a tenant guard and two indexes, and no writer anywhere, so
on-screen takeoff could not be started at all.

**A control that takes a value and changes nothing.** The same shape, one layer
in. `markupOverride` was sent where the database reads `markup_override`, so the
key matched nothing, every column kept its value through `coalesce`, and the call
returned success. `markup_override` was then read by no part of the engine, so
even a value that landed priced nothing. Labor hours were charged on a *rounded
schedule figure*, so a line's labor could not be reproduced from its own hours.

**A button that takes a click and changes nothing.** The most visible member of
the family, and the one that had no guard until the owner found six of them by
using the product. `<Button><UserPlus /> Add customer</Button>` — no `onClick`,
no handler, nothing behind it. `tests/governance/every-button-does-something.test.ts`
now fails the build on any `<Button>` with no `onClick`, `type`, `asChild`,
`disabled` or prop spread. **A control that cannot act yet is `disabled` with
the reason in its `title`** — that is honest; an enabled button that does
nothing is not.

**A reader that asks for a column that is not there.** One layer down again.
`loadResourceAssignments` selected `assets(code, name)`; the column is
`asset_number`. PostgREST refuses the *whole* request when one column in it is
unknown, so that reader returned nothing from the day it was written, and the
screen showed an empty list — which is exactly what it shows when there is
genuinely nothing to list. `loadMachineFiles` had the same mistake against the
same table. Both were found by putting the first real row into the table and
noticing it did not appear. `tests/governance/a-select-names-columns-that-exist.test.ts`
now fails the build on one.

When adding a function, ask who calls it. When adding a field, ask what reads it.
When a screen shows a number, ask whether that is the number that prices.
**When a list is empty, ask whether it is empty or broken** — the two look
identical, so open the door, put one real row through it, and watch it arrive.

---

## Rules that are enforced, not described

- **Everything is an Engine, Library, Entity, Workflow or AI Agent.** Say which in
  the header comment.
- **American English.** A governance test fails the build otherwise.
- **RULE-001** cost buckets stay separate — labor, burden, equipment, mobilization,
  fuel, material, trucking, disposal, subcontract, other. Never fold fuel into an
  equipment rate.
- **RULE-003** rate precedence: `project_quote` > `tenant_approved` > `regional` >
  `global_seed`. The rate a screen *shows* must be the rate that prices.
- **RULE-008** AI proposes, humans accept.
- **RULE-009** an issued version is immutable.
- **Engine outputs may not be written by hand** (migration 0058). A price somebody
  typed is a price nobody can reproduce.
- **A jsonb field name that is not recognized must be refused, never ignored.**
  Migrations 0136 and 0139.
- **Never invent a number.** No national-average price, no guessed unit, no
  converted rate. Refuse the row and say why. `MBF` is refused because it is a
  multiplier; `EA` on crushed stone is loaded as stated and flagged for a person.

---

## The estimate line

**One line item is one line.** Every field on it, all visible, no horizontal
scroll, columns aligned down the whole estimate. The description is widest
because it is the field being typed into.

- A CSS grid with the same column template on every row. **No `min-w-[…]`
  anywhere on the row** — one minimum width in one child forces its column wider
  and pushes every number right. That is what "everything gets out of line" meant.
- Editors open *under* the row, never inside a cell.
- The lines get the full width of the page. Explainer cards go beneath them.
- Column order: `+ ⠿ № 👁 | SERVICE | 🔧 | QTY | UNIT | COND. | UNIT COST | MARKUP | +MARKUP | TOTAL | ⧉ 🗑`

---

## Screen rules that are now enforced by a test

- **A number on a tile answers the question it raises.** Every `StatTile` carries
  `onClick` (filter the list, open the tab, go to the section that accounts for
  it) or `detail` (say what the figure is made of, where nothing else does), and
  a clickable one carries an `actionLabel`. Enforced by
  `tests/governance/every-stat-tile-does-something.test.ts`.
- **A numeric box selects what it holds when you enter it**, so the first
  keystroke replaces the value rather than landing beside it. Free in the shared
  `Input` for `type="number"` and decimal or numeric keypads; opt in with
  `selectOnFocus` elsewhere. A value of zero renders as an empty box with a
  placeholder — "I want to see the typed value not 0 first".
- **A headline count is counted, not remembered.** Four library figures were seed
  constants and disagreed with the tabs beneath them for every company that had
  added a row. A count that has not arrived is an em dash.

## Things the user has said once and should not have to say again

### Everything is clickable, and everything is changeable — said four times

This is the one that keeps coming back, so it is written as a rule rather than a
preference. Applied to **every** screen, not only the one being worked on:

- **A reference is a link.** An asset number, a project number, a customer, an
  estimate, a sheet, a cost code, a crew, a vendor, a service, a material —
  wherever one is shown, clicking it opens that record. "In schedule under asset
  be able to select EX-4412, under project click PRJ-2026-011."
- **A value is editable where it is shown.** If a person can see it, they can
  change it there, unless a stated rule forbids it — and then the rule is said
  on screen. A read-only number with no reason beside it is a defect, not a
  design. The condition factor reading `1.0x` as plain text is the example:
  clicking it should offer the conditions.
- **A choice is a select, not free text.** Categories, units, classes, statuses,
  bases. And the list is **user-addable** — `add_library_category` exists for
  exactly that.
- **One name for one thing.** No duplicate categories, ever. A near-duplicate
  that differs only by a suffix or by case is a duplicate.
  `tests/db/one-name-for-one-thing.test.ts` fails the build on one.

- **Nothing is read-only without a reason.** If a person can see it, they can edit
  it there, unless a stated rule forbids it.
- **All cards collapse.**
- **Everything can be shown to the client** — per-item visibility on bids and
  proposals.
- **Categories are user-addable**; most columns get a select rather than free text.
- **Cost codes are optional.** Nothing refuses a line without one. They live in the
  wrench panel, not on the row.
- **Work the toolbar in order**, one nav section at a time, and say before a
  section closes.

---

## Verifying and shipping

```bash
npm run gate        # the whole thing, in the only order that works
```

`npm run gate` is `docs:tree` → `test` → `docs:runs` → `verify`, and the order is
not a preference. `npm run counts` refuses to record from a red run, and a run
goes red when the *tree* documents are stale — so running `docs` in one piece
before the tests can never heal itself: counts refuses, the chain stops, the
door inventory and traceability never regenerate, and the next gate fails the
same way. It cost four gate runs on 18 September 2026 before the cause was
named. `docs:tree` regenerates what is derived from the tree (schema counts,
doors, traceability), `docs:runs` regenerates what is derived from a test run
(test counts, then verification, which reads them).

The pieces, if one is needed on its own:

```bash
npm run test        # every suite
npm run docs        # docs:tree then docs:runs
npm run verify      # typecheck, edge fingerprint, openapi, counts,
                    # traceability, all suites, build, bundle secret scan
```

- Node lives at `/Users/tradertree/.grounup-tools/node-v24.20.0-darwin-x64/bin`
  and must be on `PATH` in every shell.
- **Typecheck with `npm run typecheck`, never `npx tsc -p apps/web/tsconfig.json`.**
  The gate uses `tsconfig.app.json`, which is stricter: a PostgREST embedded
  relation typed as `GenericStringError[]` passes the first and fails the second,
  and finding that out costs a whole gate run.
- **Do not edit files while the gate is running** — the docs counts and the test
  results end up describing different trees.
- Push only on a green gate, unless told otherwise.
- `npx supabase db push --include-all` — the `--include-all` is required, because
  catalog migrations sit at 0900+ and every ordinary migration written afterwards
  sorts "before" them.
- `npm run functions:deploy` for Edge Functions. It carries `--import-map`, which
  is not optional: without it all fourteen functions fail to bundle and the deploy
  silently does nothing.

## Credentials

Never ask for or handle the database password, the Stripe secret key, service-role
keys, or the user's login. The user runs anything that needs them.
