# Requirements traceability

Every requirement, where it lives, what verifies it, and whether it is done.
Required by `governance/EXECUTION_PROTOCOL.md` §3.

**This file is hand-maintained and covers requirements stated in conversation.**
It is not the same thing as `governance/traceability/`, which is generated from
the 32-phase GES specification by `npm run traceability` and checked by the gate.
The two are complementary: that one traces the written specification, this one
traces what was asked for out loud and would otherwise be remembered by nobody.

Status vocabulary: `pending`, `in progress`, `implemented`, `tested`, `blocked`,
`superseded`, `not applicable`.

---

## Standing requirements

| ID | Requirement | Source | Priority | Component | Implemented in | Verified by | Status |
|---|---|---|---|---|---|---|---|
| R-001 | Everything is an Engine, Library, Entity, Workflow or AI Agent, and says which in its header | CLAUDE.md | high | all | header comments | `tests/governance/registry.test.ts` | tested |
| R-002 | American English throughout | CLAUDE.md | medium | all | — | `tests/governance/spelling.test.ts` | tested |
| R-003 | RULE-001: cost buckets never merge | CLAUDE.md | high | engine | `packages/engine/src/estimate.ts` | engine suite | tested |
| R-004 | RULE-003: the rate a screen shows is the rate that prices | CLAUDE.md | high | engine, library | rate precedence resolution | db suite | tested |
| R-005 | RULE-008: AI proposes, humans accept | CLAUDE.md | high | AI agents | `ai_findings` acceptance trigger | db suite | tested |
| R-006 | RULE-009: an issued version is immutable | CLAUDE.md | high | estimating | frozen triggers, 0111 | `tests/db/...frozen...` | tested |
| R-007 | Engine outputs may not be written by hand | CLAUDE.md, migration 0058 | high | estimating | `app.record_engine_result` + guard | db suite | tested |
| R-008 | An unrecognized jsonb field name is refused, never ignored | CLAUDE.md, 0136/0139 | high | estimating | `update_estimate_line`, `record_site_weather` | db suites | tested |
| R-009 | Never invent a number | CLAUDE.md | high | all | refusals with stated reasons | import suites | tested |
| R-010 | One estimate line is one line, all fields visible, no `min-w-[…]` | CLAUDE.md | high | estimate workspace | `estimate-version.tsx` grid | `estimate-version.test.tsx` | tested |
| R-011 | Nothing is read-only without a reason | CLAUDE.md | medium | all screens | — | per-screen tests | in progress |
| R-012 | All cards collapse | CLAUDE.md | medium | all screens | `CollapsibleCard` | `card.test.tsx` | in progress |
| R-013 | Everything can be shown to the client — per-item visibility | CLAUDE.md | medium | proposals | `client_visible` | db suite | tested |
| R-014 | Categories are user-addable; most columns get a select | CLAUDE.md | medium | libraries | `add_library_category` | `categories.test.ts` | tested |
| R-015 | Cost codes are optional, and live in the wrench panel | CLAUDE.md | medium | estimate line | 0137, `line-detail.tsx` | `a-cost-code-you-can-choose.test.ts` | tested |
| R-016 | Work the toolbar in order, saying before a section closes | CLAUDE.md | medium | process | — | — | in progress |
| R-017 | A number on a tile answers the question it raises | CLAUDE.md | medium | all screens | `StatTile` | `every-stat-tile-does-something.test.ts` | tested |
| R-018 | A numeric box selects its contents on focus; zero renders empty | CLAUDE.md | medium | inputs | `select-on-focus.ts`, `input.tsx` | `input.test.tsx` | tested |
| R-019 | A headline count is counted, never remembered | CLAUDE.md | medium | libraries | `loadLibraryCounts` | web suite | tested |
| R-020 | Every door has a reader, or a written reason it does not | this session | high | schema + app | `scripts/build-door-inventory.mjs` | `every-door-has-a-reader.test.ts` | tested |
| R-021 | The zero-drop execution protocol governs every session | user, 2026-09-11 | high | process | `governance/EXECUTION_PROTOCOL.md`, `CLAUDE.md` | read at session start | implemented |
| R-022 | The three memory files are maintained every session | user, 2026-09-11 | high | process | `PROJECT_MEMORY.md`, this file, `DECISION_LOG.md` | — | implemented |

---

## Security requirements

| ID | Requirement | Source | Component | Implemented in | Verified by | Status |
|---|---|---|---|---|---|---|
| S-001 | No Stripe secret, service-role key or AI provider secret in frontend code | user | web bundle | server-side only | `scripts/check-bundle.mjs` in `verify` | tested |
| S-002 | No raw card numbers, CVCs or payment credentials stored | user | billing | brand + last four only | `billing-a-page-can-read.test.ts` | tested |
| S-003 | One company cannot query another's records | user | all | row level security | every db suite's isolation tests | tested |
| S-004 | AI may not alter approved estimates, libraries, contracts, schedules, billing, permissions or safety data without the approval workflow | user | all | RULE-008 + gates | db suites | tested |
| S-005 | AI arithmetic is never the authoritative estimating calculation | user | engine | `record_engine_result` only | `tests/db/...engine...` | tested |
| S-006 | No table without `company_id` ownership and permission rules | user | schema | `apply_tenant_rls` | `registry.test.ts` | tested |
| S-007 | Subscription access comes only from verified Stripe webhook state | user | billing | `stripe-webhook` + entitlements | `billing-a-page-can-read.test.ts` | tested |
| S-008 | Tailwind and shadcn/ui only; no custom CSS | user | web | — | — | implemented |
| S-009 | Subscription prices come from a governed plan catalog, never hard-coded | user | billing, marketing | `plan_prices`, `loadPlanPrices` | `plans.test.tsx` | tested |
| S-010 | Every tenant table carries the suspension guard | migration 0082 | schema | `app.guard_suspension` | `suspension.test.ts` | tested |
| S-011 | Visibility is decided under the caller's RLS before any explanatory refusal | this session | takeoff | `apply_takeoff_to_line` | `six-functions-nobody-could-call.test.ts` | tested |

---

## This session's requirements

| ID | Requirement | Source | Priority | Component | Implemented in | Verified by | Status |
|---|---|---|---|---|---|---|---|
| C-001 | Close the four open doors found by the inventory | user | high | CRM, billing, libraries | lead inbox, billing cards, uncosted materials | web + db suites | tested |
| C-002 | Make `project-detail` live | user | high | projects | migration 0142, `lib/data/project.ts`, `project-detail.tsx` | `a-project-you-can-open.test.ts`, `project-detail.test.tsx` | tested |
| C-003 | Add site weather to the project | user | high | projects | migration 0143, `site-weather.tsx`, `refresh-weather` | `weather-at-the-job-site.test.ts`, `site-weather.test.tsx` | tested |
| C-004 | Keep the Starter entitlement; do not modify entitlements to make the gate pass | user | high | billing | — | `awarding-acceptance.test.ts` scenario A | superseded by C-010 for the data fix; the prohibition on modifying entitlements *to pass a gate* stands |
| C-005 | Record the Starter path as PASS — the block is correct behavior | user | high | billing | `awarding-acceptance.test.ts` | 6 tests | tested |
| C-006 | Run award-to-project on a controlled tenant with an entitled plan | user | high | projects | `awarding-acceptance.test.ts` scenario B | 10 tests | tested |
| C-007 | Verify project creation, data transfer, tenant isolation, server-side entitlement recheck, and audit | user | high | projects | `awarding-acceptance.test.ts` | 19 tests | tested |
| C-008 | Both scenarios are required acceptance tests | user | high | db suite | `awarding-acceptance.test.ts` | in `npm run test` | tested |
| C-009 | Work through the six unreachable `app.*` functions | user | high | schema + app | migration 0147, three new screens | `six-functions-nobody-could-call.test.ts` + 3 web suites | tested |
| C-010 | Move the entitlement from `starter` to `grounup` | user | high | billing | `set_company_plan` via admin console | live verification + `audit_events` | implemented |
| C-011 | Add site fields to the new-estimate dialog | user | high | estimating | migration 0148, `estimates.tsx` | `estimates.test.tsx` | tested |
| C-012 | Make the site editable after creation | user | high | estimating | `set_estimate_site`, `where-the-work-is.tsx` | `where-the-work-is.test.tsx`, `where-the-work-is.test.ts` | tested |
| C-013 | Only the project name is mandatory on a new estimate | user question, 2026-09-11 | medium | estimating | `create_estimate` + button guard | `estimates.test.tsx` | tested |
| C-014 | A condition should be selectable by clicking the `1.0x` | user, with an example of conditions | high | estimating | migration 0149, `condition-cell.tsx` | `a-condition-you-can-click.test.ts`, `condition-cell.test.tsx` | tested |
| C-015 | One name for one thing — no duplicate categories | user: "no duplicates please" | high | library catalog | seed `0012_one_name_for_one_thing.sql` | `one-name-for-one-thing.test.ts` | tested |
| C-016 | Be able to rename, remove and open into any category, everywhere | user: "everything should be clickable and changeable with options" | high | libraries | migration 0150, `category-manager.tsx` | `a-category-you-can-manage.test.ts`, `category-manager.test.tsx` | tested |
| C-017 | Removing a category moves its items to a category you pick | user: "move them to a category you pick" | high | libraries | `delete_library_category`, `RemoveBox` | 8 db tests + 3 web tests | tested |
| C-018 | Resource pickers in place of free-text names in the wrench panel | user: "now do the wrench panel resource pickers" | high | estimating | `ResourceName` on all five tabs | `resource-picker.test.tsx` | tested |
| C-019 | Hauling gets the same typed search as every other tab | follows from C-018 | high | estimating | `searchTruckingRates`, `PickKind` gains `trucking` | 2 web tests | tested |
| C-020 | A repointed row moves its library link with its name | defect found building C-018 | high | estimating + schema | migration 0151 | `a-resource-you-can-repoint.test.ts` | tested |
| C-021 | A price entered in the library is used as a preset when building, never re-entered | user, 2026-09-12 | high | estimating + libraries | `line_resource_suggestions` → `save_line_resource`; `ResourcePicker`/`ResourceName` carry rate, unit and cycle | `a-resource-you-can-repoint.test.ts`, `resource-picker.test.tsx` | tested |
| C-022 | Add the material prices to the library | user: "add the material prices to the library" | high | library catalog | seed `0013_material_prices.sql` from `07_F_P_MATERIAL_LIBRARY` | `the-prices-that-were-in-the-file.test.ts` | tested |
| C-023 | A price and the unit it is quoted in arrive together | follows from C-022; 0009 refused to guess a unit | high | library catalog | seed 0013 corrects 133 units with their prices | 2 tests in the same file | tested |
| C-024 | Build the hauling door | user: "build the hauling door" | high | libraries | migration 0156, `haul-profiles.tsx`, `createTruckingRate` brought up to 0067 | `a-haul-rate-you-can-create.test.ts`, `haul-profiles.test.tsx` | tested |
| C-025 | Wire the project-detail buttons | user: "now wire the project detail buttons" | high | projects | migration 0157, `project-actions.tsx` | `three-buttons-on-a-project.test.ts`, `project-actions.test.tsx` | tested |

---

## Known open items

| ID | Item | Why it is open | Next action |
|---|---|---|---|
| O-001 | `E-2026-0001` and `E-2026-0002` are test estimates with a typed rate | A rate-priced line is an allowance and cannot clear the confidence gate (D-008) | Build the lines up, or delete them |
| O-002 | The shipped catalog's assemblies reference tasks carrying no crew, equipment or material | Catalog depth, not code — a library line prices at $0 until built up | Compose the task resources, or price lines by hand |
| O-004 | R-011, R-012, R-016 are partially applied | Standing instructions applied per screen as screens are worked | Continue the toolbar in order |
