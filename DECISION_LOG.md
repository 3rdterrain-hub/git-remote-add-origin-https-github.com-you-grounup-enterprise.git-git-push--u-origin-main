# Decision log

Material decisions, with the reason, what else was considered, who authorized it,
and what it replaced. Required by `governance/EXECUTION_PROTOCOL.md` §3.

A decision belongs here when reversing it would cost real work, when it
contradicts something previously agreed, or when somebody a year from now would
otherwise ask "why is it like this". Ordinary implementation choices do not.

Newest first.

---

## D-017 · 2026-09-12 · Catalog prices are shipped as `estimated`, with the unit they are quoted in

**Decision.** The 173 material prices in the company price library
(`07_F_P_MATERIAL_LIBRARY`) ship on the platform catalog as `cost_state =
'estimated'`, and each one carries the unit its own source row states — 133 unit
corrections, applied in the same statement as the price.

**Reason.** Seed 0009 shipped the catalog uncosted and said why: a price list
belongs to the company that negotiated it, and a national average is worse than
nothing. That reasoning was right and its premise was wrong — a second sheet in
the same workbook had a price on every row. Nothing here is invented, averaged
or converted.

`estimated` rather than `quoted` because a quote is a number a supplier stands
behind on a date (0121), and `quoted` would overstate what this is. A company
that wants its own number clicks the cost and 0133 copies the material into
their library, which is the point of the three-tier shape.

**The unit is not separable from the price.** 0009 refused to turn `EA` into
`TON` on a guess — "a per-ton price on a per-each material" makes every estimate
built on it wrong by a factor nobody spots. The guess was what it refused; the
price library states the unit beside the price, so the two move together or not
at all.

**What was deliberately not loaded.** Density except where the source states
lb/CF (×27, the definition of a cubic yard): the sheet states most densities as
lb per unit *sold*, which is a different fact, and loading one into the other
would be the same mistake in another column. 12 of 173 qualify. The 160 catalog
materials with no row in the price library stay `not_costed`.

**Affects.** Migrations 0152 (`CF` as a unit) and 0153 (`CF`, `SET` synonyms),
seed 0013, the material library, every estimate that uses one.

**Status.** Active. 14 tests. 155 catalog materials remain uncosted, down from 328.

---

## D-016 · 2026-09-12 · A library link is cleared by sending it, not by omitting it

**Decision.** In `save_line_resource`, the six library links — `labor_rate_id`,
`equipment_id`, `material_id`, `trucking_rate_id`, `disposal_site_id`,
`vendor_id` — are applied on update by *key presence* rather than through
`coalesce`. Sending `material_id: null` removes the link. Every other field
keeps `coalesce`.

**Reason.** `coalesce(new, old)` cannot express "set this to nothing": null
means "I did not send this", which is right for a number somebody left alone and
wrong for a link somebody is removing. A row renamed by hand is no longer the
library row it came from, and `capture_library_snapshot` reads that link to
record what priced the version — so a stale link is not untidiness, it is an
audit trail that names the wrong material as the thing that priced the bid.

**Alternative rejected.** A separate `unlink_line_resource` function. It would
have made renaming a row two calls that must both succeed, and the second one
failing would leave exactly the state this is meant to prevent.

**What it superseded.** Migration 0139 listed all six as accepted fields and the
UPDATE branch mentioned none of them — so sending one returned success and
changed nothing. That is the same shape as the `markupOverride` defect 0139 was
written to stop: the guard asks whether a key is *known*, not whether it is
*applied*.

**Affects.** Migration 0151, `ResourceName`, every wrench-panel tab.

**Status.** Active. 9 db tests, 11 web tests.

---

## D-015 · 2026-09-11 · What names a row lives on the categorized-columns list

**Decision.** `app.categorized_columns()` gains a fifth column, `label_column`:
the column that names a row in the table a category files things in — `name` for
a material, `classification` for a labor rate, `company_name` for a lead.

**Reason.** Opening a category has to show the rows behind the count, and naming
a row differs by table. The alternative was a table-to-label map written in
TypeScript, which is a second list to forget when a tenth categorized column is
added — the exact failure `categorized_columns` exists to prevent. The return
type changes, so the function is dropped and recreated and the view over it goes
and comes back with it.

**Affects.** `library_category_columns`, `app.library_category_members`, the
category manager.

**Status.** Active. Eleven rows, nine kinds.

---

## D-014 · 2026-09-11 · Removing a category names where its items go

**Decision.** `delete_library_category(kind, name, move_to)` takes the
destination as a required argument. There is no form of the call that removes a
category and leaves its rows behind.

**Reason.** Removing a category is a tidying decision; losing how three hundred
materials were grouped is not, and the two must not be the same keystroke. A
removal that stranded rows would also break them: the 0113 guard refuses a
category that is not on the list, so the next edit to any of those rows would
fail with a message about a category the person never touched. Where the
category is empty the argument costs nothing.

The same call is the merge tool — moving everything out of `Compaction` into
`Compactors` and dropping the emptied name is how two categories become one,
which is what the shipped catalog needed and had no screen for.

**Authorized by.** The user, asked what should happen to the items in a category
being deleted: "move them to a category you pick."

**Affects.** Migration 0150, the category manager, every category list.

**Status.** Active. 28 db tests, 15 web tests.

---

## D-013 · 2026-09-11 · The execution protocol is a repository document

**Decision.** The zero-drop protocol is stored verbatim at
`governance/EXECUTION_PROTOCOL.md`, and `CLAUDE.md` points at it as a standing
instruction rather than containing it.

**Reason.** `CLAUDE.md` is read at the start of every session and earns its
weight by being short and high-signal. Three hundred lines pasted into it would
dilute the rules already there — the five categories, RULE-001 and RULE-003, the
estimate line — which are the ones most often broken. A pointer keeps both: the
protocol is authoritative and loaded, and the file that has to be skimmed stays
skimmable.

**Alternatives.** Paste it whole into `CLAUDE.md` (dilutes it); keep it only in
the conversation (lost on the next session); store it outside the repository
(invisible to anyone else working here).

**Authorized by.** The user, 11 September 2026: "you know the task. save this in
your setting."

**Affects.** `CLAUDE.md`, `governance/EXECUTION_PROTOCOL.md`, and every session
that reads them.

**Status.** Active.

---

## D-012 · 2026-09-11 · The entitlement moved from `starter` to `grounup`

**Decision.** `3RD Terrain`'s entitlement was moved to the `grounup` plan through
`public.set_company_plan`, via the admin console, with the reason "Trial was
provisioned onto starter, which migration 0901 retired; moving to the plan
actually sold."

**Reason.** The workspace was on `starter`, which migration 0901 retired
(`is_active = false`), with `entitlement_source = trial` expiring 19 September.
That is why `my_plan.plan_name` was null and why project management was refused.
Every current provisioning path defaults to `grounup`; the workspace predated
that change.

**Alternatives.** Leave it and let the trial lapse to `free` (also excludes
projects); write the entitlement row directly (refused by policy, and the wrong
path); start a Stripe subscription (a commercial decision, not a data fix).

**Authorized by.** The user, explicitly: "fix the starter entitlement to
grounup." This supersedes the earlier instruction in the same session to "keep
the Starter entitlement exactly as configured", which was scoped to not
modifying entitlements *in order to make the gate pass* — a different thing.

**Affects.** `entitlements` for one company. Reversible from the same screen.

**Status.** Active. Recorded in `audit_events` with the actor and reason.

---

## D-011 · 2026-09-11 · Site is asked for at creation *and* settable afterwards

**Decision.** Migration 0148 gives `estimates.site_address/city/state` two
writers: `create_estimate` takes them, and `set_estimate_site` changes them
until the estimate goes out.

**Reason.** An address arrives at two different moments. A bid invitation
usually carries one; often it does not, or it changes once somebody drives out
to look. One writer would have left the other case with no door — which is the
state the whole platform was in.

**Alternatives.** Creation only (an estimate created before the address was
known could never be told); setter only (the common case would need two steps).

**Authorized by.** The user: "add site fields to the new estimate dialog", then
"finish the editable site".

**Affects.** `create_estimate` signature (replaced, not overloaded, per D-004's
rule), `set_estimate_site`, the new-estimate dialog, the estimate version page,
`award_estimate_version`'s output, and the site forecast.

**Status.** Active.

---

## D-010 · 2026-09-11 · The unreachable-grant list is pinned, not tolerated

**Decision.** `scripts/build-door-inventory.mjs` carries `UNREACHABLE_GRANTS` as
a pinned set. A new `app.*` function granted to `authenticated` and called by
nothing fails the build; a name that leaves the set has been wired or revoked.
The set is currently empty.

**Reason.** Six such functions existed. Reporting them without pinning would let
a seventh arrive unnoticed; failing the build on all six immediately would have
blocked unrelated work. Pinning made the queue visible and finite, and migration
0147 emptied it.

**Alternatives.** Fail immediately on all six (blocks everything); report
without failing (grows quietly); exempt them (writes the defect down as a rule).

**Authorized by.** Standing instruction — the defect this codebase keeps
producing.

**Affects.** The door inventory, `verify`, and the governance suite.

**Status.** Active, set empty.

---

## D-009 · 2026-09-11 · Confidence checks are attestations, not derivations

**Decision.** `check_primary_source`, `check_cross_source` and
`check_reconciliation` are set by a person in the wrench panel, never derived.

**Reason.** The platform cannot observe whether somebody checked a dimension
against the governing drawing. A derived value would be a guess wearing the
authority of a measurement, and it feeds the gate that decides whether a bid can
be issued.

**Alternatives.** Infer from the quantity's provenance (unknowable); default
them true (makes the gate meaningless); leave them unwritable (the state that
made every hand-entered estimate permanently unbiddable).

**Authorized by.** Migration 0144's own reasoning, confirmed by the user electing
to tick them on a test estimate.

**Affects.** `update_estimate_line`, the wrench panel, the confidence score, the
approval gate.

**Status.** Active.

---

## D-008 · 2026-09-11 · A rate-priced line is locked to `estimator_allowance`

**Decision.** The measurement-basis select is disabled when
`parametric_cost_per_unit` is set, with the reason and the remedy stated.

**Reason.** Migration 0066 constrains it in the database —
`eli_parametric_is_an_allowance` — so a conceptual line cannot be relabeled into
the approval gate the label decides. Offering the choice would be a control that
takes a value and changes nothing.

**Alternatives.** Leave the select enabled and let the write fail (the defect);
hide the field entirely (the reason disappears with it).

**Affects.** `apps/web/src/components/estimate/how-sure.tsx`.

**Status.** Active.

---

## D-007 · 2026-09-11 · CPI is earned value over actual cost

**Decision.** `reporting_project_earned_value` computes the cost performance
index from each task's own budget weighted by that task's own progress. The
fixture's `(budget × percent complete) / actual cost` was not restored.

**Reason.** The live percent complete in `reporting_wip` is cost-to-cost —
actual cost over budget — so the old formula reduces to actual cost over actual
cost and prints 1.00 on every project forever while looking like a measurement.

**Alternatives.** Keep the old formula (prints a constant); omit CPI (loses the
figure a project manager asks for first).

**Affects.** `reporting_project_earned_value`, the project detail page.

**Status.** Active. Asserted by a test that it is not 1 by construction.

---

## D-006 · 2026-09-11 · Null, never zero, where a denominator is missing

**Decision.** Percent complete, CPI, hours performance and earned value are null
when no task carries a budget. Weather efficiency is null when no forecast has
been fetched.

**Reason.** A project nobody has broken down has not earned nothing — it has
earned an amount nobody can compute. Rendering that as 0% puts an unstarted job
and an unplanned job in the same place. Migration 0057 set this rule for work in
progress; it is applied consistently.

**Affects.** `reporting_project_earned_value`, `workable_days_at`, the project
page, the site weather card.

**Status.** Active.

---

## D-005 · 2026-09-11 · Sheet-text search is its own screen, not the global bar

**Decision.** `search_document_text` is wired to a "Search the drawings" tab on
Plans & Specs rather than folded into the global search dropdown.

**Reason.** The global bar matches a sheet by number and title and exists to jump
to a record. *Which sheet mentions the cathodic protection* is a question you
read an answer to — it needs snippets and page numbers. Folding them together
would also produce duplicate hits for a sheet matching both ways.

**Alternatives.** Union it into `app.search` (duplicates, and the wrong shape).

**Affects.** `apps/web/src/components/plans/search-the-drawings.tsx`,
`lib/data/plans.ts`.

**Status.** Active.

---

## D-004 · 2026-09-11 · A restated function is rebased on its latest definition

**Decision.** When restating a function in full, find the newest definition with
`grep -l "function app.<name>"` across the migrations and rebase on that.

**Reason.** Migration 0144 was rebased on 0136 when 0137 was the latest, silently
dropping `cost_code_id`. Seven tests caught it — after 0144 had been pushed, and
a migration that has run cannot be edited into having run differently. 0146
restates it.

**Affects.** Every future migration that restates an existing function.

**Status.** Active. The lesson is written into 0146's header.

---

## D-003 · 2026-09-11 · Visibility is decided before anything is explained

**Decision.** In `apply_takeoff_to_line`, the existence and tenancy checks run
under the caller's own row level security *before* `app.assert_line_open`.

**Reason.** `assert_line_open` is `security definer` and can see another
company's line. Using it as the existence check answered a stranger's probe with
"that estimate is issued" — confirming the row exists and naming its state.

**Alternatives.** Use the helper as the existence check (the disclosure);
duplicate its message inline (two definitions).

**Affects.** `app.apply_takeoff_to_line`. Asserted by a test on the ordering.

**Status.** Active.

---

## D-002 · 2026-09-11 · Every door is inventoried and checked by the gate

**Decision.** `scripts/build-door-inventory.mjs` enumerates every `public.*`
function and `my_*` view, matches each against its readers, writes
`governance/DOORS.md`, and `doors:check` runs in `verify`.

**Reason.** The most expensive defect this build produces is a complete, tested,
governed feature no screen reaches — found at least thirteen times. Every layer
passes on its own; nothing tested the joint.

**Affects.** `verify`, the governance suite, every future migration.

**Status.** Active. 161 doors, 0 with no reader.

---

## D-001 · 2026-09-11 · Both award scenarios are required acceptance tests

**Decision.** `tests/db/awarding-acceptance.test.ts` holds the Starter refusal
and the entitled success as equally required.

**Reason.** The Starter block is correct behavior, not a limitation to work
around. A build where either changes has moved something it should not have.

**Authorized by.** The user: "Treat both the blocked Starter scenario and the
successful entitled-plan scenario as required acceptance tests."

**Affects.** The db suite.

**Status.** Active. 19 tests.
