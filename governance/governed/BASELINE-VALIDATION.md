# Governed baseline — validation

**Dated 19 September 2026.** Built under the GES governance ruling of the same
date. Evidence gathering only: no application code was changed, no requirement
was merged or discarded, and no coverage percentage is published here.

Regenerate with `npm run governed:baseline` and `npm run governed:workbooks`.

## 1. Authoritative unique requirement count

**10,055.**

Not 9,787 — that figure came from a filename pattern earlier in this session and
is withdrawn. Not 9,475, which is the repository's legacy dataset. Not 8,600,
which is P99's incorporated register and is not independently exhaustive.

## 2. Exact derivation

The deduplicated union of the 33 governed **phase** registries, identity taken
as the governed requirement ID with its home phase.

| | |
|---|---:|
| Phase registries read | **33 of 33** |
| Registries with no readable ID column | **0** |
| Source occurrences | 10,055 |
| Distinct requirement IDs | **10,055** |
| Duplicate IDs | **0** |

Header spellings differ across the packages — `Requirement_ID`, `Requirement ID`
and `requirement_id` all appear. They are compared with case and separators
removed, because that difference is exactly what caused P99 to skip ten
registries, and it is the same mistake that produced the withdrawn 9,787.

### Confirmed independently by the control workbooks

The 33 control workbooks hold their requirements on sheets, and those sheets
sum as follows:

| Sheet | Rows |
|---|---:|
| `Requirements` (30 workbooks) | 9,475 |
| `P21 Requirements` | 180 |
| `P22 Requirements` | 220 |
| `P99 Requirements` | 180 |
| **Total** | **10,055** |

This is the whole explanation of the legacy 9,475: a reader that took every
sheet named `Requirements` and never looked at the three carrying a phase
prefix. The two derivations — phase CSV registries and Excel control workbooks —
agree on 10,055 by different routes.

## 3. Requirements by home phase

| | | | | | |
|---|---|---|---|---|---|
| P01 25 | P02 60 | P03 75 | P04 97 | P05 108 | P06 120 |
| P07 160 | P08 180 | P09 210 | P10 240 | P11 260 | P12 280 |
| P13 300 | P14 320 | P15 340 | P16 360 | P17 380 | P18 400 |
| P19 420 | P20 450 | P21 180 | P22 220 | P23 300 | P24 360 |
| P25 400 | P26 450 | P27 480 | P28 500 | P29 520 | P30 540 |
| P31 560 | P32 580 | P99 180 | | | |

## 4. Occurrences removed from counting, and why

Nothing was deduplicated, because there was nothing to deduplicate: no
requirement ID appears twice anywhere in the corpus. Three registers are held
out of the *count* under the ruling's precedence model and joined or recorded
instead:

| Register | Rows | Treatment |
|---|---:|---|
| `P21_Master_Requirements_Register.csv` | 4,785 | Consolidation view of P01–P20. Metadata joined, not counted. |
| `P22_Final_Requirements_Register.csv` | 4,785 | Reconciliation view of P01–P20. Metadata joined, not counted. |
| `P99_Incorporated_Unique_Requirements.csv` | 8,600 | Umbrella layer. Omissions recorded as a defect, not counted. |

Counting any of them would have double-counted 4,785 requirements that already
exist in their home phase registries.

## 5. P21 / P22 reconciliation joins

`reconciliation_state`, `finding_severity` and `disposition_rule` are joined onto
the original requirement IDs. **4,785 requirements carry P21 metadata and 4,785
carry P22 metadata** — the whole of phases 01–20. No requirement was taken from
either register, and no original was replaced.

## 6. P99 register-completeness defect

Recorded per ruling 1 and **not repaired**. `governance/governed/p99-omissions.json`
holds all 1,455 IDs.

| | |
|---|---:|
| Incorporated by P99 | 8,600 |
| Valid phase requirements P99 omits | **1,455** |
| In P99 but in no phase registry | **0** |

P99 invents nothing; it omits. Its own `canonical_source_file` column shows it
read 23 files and never opened ten of the thirty-three. The omissions are
P01–P05 (268, registry named `requirements_register.csv`), P04/P08/P09/P10/P12
(1,007, header reads `Requirement ID` with a space) and P99's own 180, which is
self-reference and expected.

## 7. Acceptance-criteria availability

| | |
|---|---:|
| With a governed acceptance criterion | **9,258** |
| Without | **797** |

The 797 cannot reach VERIFIED on governed evidence, because there is no governed
criterion to satisfy. They are a source-completeness question, not an
implementation gap, and are reported separately rather than counted as failures.

## 8. Governed test-case population

| | |
|---|---:|
| Governed test cases | **10,045** |
| Naming a requirement | 10,045 |
| Naming an ID outside the baseline | **0** |
| Baseline requirements with at least one governed test | **10,045** |
| Baseline requirements with no governed test | **10** |

None of these 10,045 have ever been run against this codebase. This project's
own 5,636 tests were written independently of them.

## 9. Source-artifact provenance

Every requirement carries the artifact it came from and the row it sat on, as
`registry.csv#rowN`. Nothing is recorded without a source location.

## 10. Control-workbook coverage

33 workbooks, **77 distinct sheet types**, read for the first time. Counted per
sheet and never summed into requirements — a quality gate is not a requirement
and an API contract is not a requirement.

Largest control populations: Traceability 9,475 · Tests 7,810 · Master Tests
4,775 · Master Traceability 4,517 · Data Dictionary 3,192 · Entities 2,528 ·
Test Cases 1,547 · Business Rules 917 · Validation Rules 889 · Master APIs 794 ·
Engines 627 · KPIs 566 · Workflows 551 · Quality Gates 186 · Security 132 ·
Security Controls 20 · Threat Model 16 · Release Gates 20.

Full detail in `governance/governed/control-workbooks.json`.

## Classification

Per the ruling, kept apart rather than collapsed. Derived from the governed
sources — the requirement's own domain first, its home phase second — and left
`Unclassified` rather than guessed where neither speaks.

| Classification | Requirements |
|---|---:|
| Product Behavior | 6,086 |
| Governance / Build Control | 1,085 |
| Data / Integration | 1,046 |
| Testing / Validation | 964 |
| Security / Compliance | 766 |
| Unclassified | 108 |

Product-behavior coverage and governance/build-control coverage will be reported
separately, per ruling 2.

## What is deliberately absent

No coverage percentage. No requirement marked traced, implemented, tested or
verified. The legacy 50.9% / 20.4% report is preserved unchanged in
`governance/traceability/`, labeled LEGACY / FLATTENED.
