# Source-baseline reconciliation

**Dated 19 September 2026.** Evidence gathering only. No application code was
changed to produce this, and no requirement was merged, renamed or discarded.

## What was asked

Establish the authoritative GES requirement baseline from the governed Phase
01–32 and Phase 99 packages before recomputing any coverage figure, and report
exactly how the count was derived — including duplicates, superseded records,
master/control registers and requirements incorporated by reference.

## The four counts in play

| Count | Where it comes from | Status |
|---:|---|---|
| **10,055** | The 33 governed phase registries, summed | **Authoritative** |
| 9,787 | A filename pattern used earlier in this session | **Wrong — withdrawn** |
| 9,475 | `governance/requirements/ges-requirements.csv` in this repository | Legacy, incomplete |
| 8,600 | `P99_Incorporated_Unique_Requirements.csv` | Canonical but **incomplete** |

### 10,055 — the authoritative figure

Every requirement registry in the 33 governed packages, read at ID level:
**10,055 rows, 10,055 distinct requirement IDs.** No duplicate ID appears in
any registry or across any two registries. Nothing is superseded and nothing is
merged.

### 9,787 was wrong, and why

An earlier figure in this session came from globbing `*Requirements.csv`. That
pattern does not match `requirements_register.csv`, so **P01, P02, P03 and P05
were silently excluded**, and it did not reach the P21/P22 master registers.
The figure is withdrawn. The stated difference of "+312" that went with it is
also withdrawn; the real difference against the repository is **+580**.

### 9,475 — what the repository was built from

Phase by phase the repository dataset matches the governed registries exactly,
with three total omissions:

| Phase | Governed | Repository | Missing |
|---|---:|---:|---:|
| P21 Master Enterprise Consolidation | 180 | 0 | **180** |
| P22 Final Reconciliation / Enterprise Lock | 220 | 0 | **220** |
| P99 Master Specification | 180 | 0 | **180** |
| | | | **580** |

Every other phase agrees to the row. So the repository baseline is not a
different reading of the spec — it is the spec with three phases absent,
including the two reconciliation phases and the master specification itself.

### 8,600 — the P99 incorporated register, and its gap

`P99_Incorporated_Unique_Requirements.csv` declares itself the de-duplicated
master and is internally consistent: 8,600 rows, 8,600 distinct IDs,
`occurrence_count` of exactly 1 on every row, and `definition_conflict = NO` on
every row. **It reports no duplicates and no conflicts anywhere in the corpus.**

It is nonetheless incomplete. **1,455 governed requirement IDs exist in phase
registries and are absent from it**, while **0 IDs appear in it that are not in
a phase registry** — so P99 invents nothing, it omits.

Its own `canonical_source_file` column shows why: it read **23 files**, and
never opened ten of the thirty-three.

| Not incorporated | Count | Registry | Apparent cause |
|---|---:|---|---|
| P01, P02, P03, P05 | 268 | `requirements_register.csv` | Filename does not match the pattern the other thirty use |
| P04, P08, P09, P10, P12 | 1,007 | `Pnn_Requirements.csv` | Header column is `Requirement ID` with a space, not `Requirement_ID` |
| P99 | 180 | `P99_Requirements.csv` | Self-reference; expected |
| | **1,455** | | |

The two causes are stated as *apparent*: they are inferred from the file
inventory and the header shapes, and they are consistent with every case, but
the generator that produced the incorporated register is not in the corpus, so
this is evidence rather than proof.

## Governance questions this raises

1. **Is P99's incorporated register meant to be exhaustive?** If yes, it has a
   defect and 1,455 requirements are missing from the master. If no, then the
   authoritative baseline is the union of the phase registries (10,055) and the
   incorporated register is a derived convenience.
2. **Should P21 and P22 requirements be in scope for implementation?** They are
   consolidation and reconciliation phases, and their 400 requirements describe
   governance of the build rather than product behavior. They are counted in the
   10,055 and flagged here rather than assumed either way.
3. **Do the P21 and P22 master registers (4,785 rows each) supersede the phase
   registries for phases 01–20?** Both hold exactly the phase 01–20 total. P22
   adds `reconciliation_state`, `finding_severity` and `disposition_rule`, which
   suggests it is the reconciled view. No requirement has been taken from either
   in this pass.

## What has not been done

Coverage has not been recomputed. The legacy 50.9% traced and 20.4% verified
figures are preserved unchanged as the dated historical baseline in
`governance/traceability/`, which is labeled LEGACY / FLATTENED. No governed
traceability has been produced yet, and no requirement has been marked
implemented, tested or verified against a governed acceptance criterion.
