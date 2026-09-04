# The estimating engine

`@grounup/engine` produces every authoritative number in GrounUp. It has no
dependencies, performs no I/O, reads no clock and uses no randomness. The same
inputs produce the same output on every machine, forever — which is what makes an
estimate defensible to an owner months after it was priced.

**230 tests, 99.65% statement coverage.** Every expected value in the test suite
was computed by hand or by an independent script, not captured from the code.

---

## Determinism

IEEE-754 doubles are fast but lossy: `1.005 * 100` is `100.49999999999999`, so
`Math.round` gives `1.00` where an estimator wrote `1.01`. `Math.round` is also
half-*up* rather than half-away-from-zero, so it rounds `-0.5` to `-0`.

Every value a human sees passes through `roundTo`, which re-reads the scaled value
at twelve significant decimals before rounding and rounds away from zero:

```
roundTo(1.005, 2)  === 1.01     Math.round-based would give 1.00
roundTo(2.675, 2)  === 2.68     Math.round-based would give 2.67
roundTo(-0.5, 0)   === -1       Math.round gives -0
```

Scales are fixed: money to 2 places, unit rates and quantities and hours to 4,
dimensionless factors to 6. `sumMoney` rounds once at the end rather than per term,
because rounding each term first turns three $0.111 items into $0.34 instead of $0.33.

---

## The quantity chain

`Measured → Adjusted → Waste/Loss → Gross`

The **adjusted** quantity is what will be *produced*; the **gross** quantity is what
must be *purchased*. Production and duration use adjusted; material buying uses gross.

Waste and loss are added, not compounded — they describe two independent physical
causes, and compounding invents a cross-term nothing in the field produces:

```
1,000 CY, +10% overdig, 5% waste, 2% loss
  → adjusted 1,100 CY
  → gross    1,100 × (1 + 0.05 + 0.02) = 1,177 CY     not 1,100 × 1.05 × 1.02 = 1,178.1
```

Every adjustment requires a stated reason; the engine throws without one. A waste
factor with no recorded basis raises a warning (Section 31), and a factor above 50%
is flagged as almost certainly a data-entry error.

---

## Earthwork volume states

Bank, loose and compacted cubic yards are three physical states of the same soil.
The engine converts through bank as a pivot and never mixes them:

```
BCY → LCY   × (1 + swell)          1,000 BCY at 25% swell = 1,250 LCY
BCY → CCY   × (1 − shrink)         1,000 BCY at 10% shrink =   900 CCY
LCY → CCY   via bank               1,250 LCY → 1,000 BCY → 900 CCY
```

**The most common earthwork error is comparing raw cut to raw fill.** `analyzeCutFill`
converts before it compares:

```
40,000 BCY cut vs 40,000 CCY fill "looks balanced"
  → 40,000 × 0.90 = 36,000 CCY available
  → 4,000 CCY short  → import 4,444 BCY to purchase
```

Unsuitable material always leaves the site regardless of the mass balance, and
topsoil is tracked separately from mass earthwork.

---

## Production (Section 25)

Three numbers, always reported separately:

| | Meaning |
|---|---|
| **Theoretical** | The catalog rate. Never the estimating rate. |
| **Practical** | Theoretical × utilization. What the machine does across a real shift. |
| **Recommended** | Practical × condition modifiers. What this estimate is priced at. |

```
180 CY/hr theoretical
  × 0.83 utilization = 149.4 CY/hr practical
  × 0.85 wet soil    = 127.0 CY/hr recommended
  × 8 hr shift       = 1,016 CY/shift
```

Only `recommendedPerHour` reaches the cost engine, so an unadjusted theoretical
rate can never be what a bid was built on.

### Condition modifiers (RULE-006)

A modifier declares an explicit factor per target. There is no implicit spillover:
a modifier that does not declare `equipment_cost` cannot affect it.

**Production factors compound.** Restricted access (0.75) inside adverse weather
(0.80) gives 0.60, not 0.55 — the weather slows down whatever the restricted crew
was managing to do.

**Cost factors add.** Rock (+35%) and winter (+12%) give +47%, not the +51.2% that
`1.35 × 1.12` would invent.

Fuel follows the equipment multiplier: the same machine, the same hours, harder
conditions burns proportionally more diesel. Subcontract and "other" are never
touched by condition modifiers — a subcontractor's fixed price does not move
because your crew hit rock.

### Controlling resource (RULE-005)

An operation runs at its **slowest** dependent resource, not at its primary
machine's rate:

```
Excavator   200 CY/hr  →  60% utilized, 80 CY/hr of slack
Haul fleet  120 CY/hr  →  CONTROLLING
Compaction  160 CY/hr  →  75% utilized

Operation capacity: 120 CY/hr
```

The engine names what becomes controlling next, and warns when several resources
sit within 5% of each other — because adding capacity to only one of them changes
nothing.

---

## Duration (RULE-002)

```
Duration = quantity ÷ effective production, then adjusted for shift and calendar
```

Calendar allowance **divides** rather than marking up: losing 15% of available days
to weather means the work stretches over `days ÷ 0.85`, not `days × 1.15`. The two
differ by 2.6% at 0.85 and the gap widens.

```
10,000 CY ÷ 100 CY/hr = 100 hr ÷ 8 hr = 12.50 days
                         ÷ 0.85 calendar = 14.71 days
Planning range: 12.50 – 17.65 days
```

---

## Trip-based haul (RULE-004)

Cycle-based hauling is authoritative. A shortcut `$/CY` rate is permitted only as
a placeholder, and the result carries `isPreliminary: true` plus a warning that
survives into the approval gate.

```
cycle = load + haul + dump + return + delay
      = 4.20 + 12.00 + 2.00 + 10.29 + 3.00 = 31.49 min

60 ÷ 31.49 = 1.906 cycles/hr × 14 LCY = 26.68 LCY per truck per hour
loader 200 ÷ 26.68 = 7.50 → 8 trucks
```

The engine then reports what the *actual* fleet delivers, because both failure
modes cost money in opposite directions:

- **Loader starved** — too few trucks idles the excavator, the expensive machine.
- **Trucks queueing** — too many puts trucks on the clock waiting to load.

Trucks are paid for the whole operation, not only for their own cycles: a truck
standing in a queue is still being paid.

---

## Cost buckets (RULE-001)

Ten buckets stay separately visible from the line all the way to the estimate
total: labor wage, labor burden, equipment ownership, equipment mobilization,
fuel, material, trucking, disposal, subcontract, other.

Overtime is priced as a **premium** on straight time rather than as a separate full
rate, so the wage and burden buckets stay comparable across estimates whether or
not overtime was worked. Burden applies to the premium, because payroll tax and
fringe follow gross pay.

### Equipment rate hierarchy (RULE-003)

```
project_quote  >  tenant_approved  >  regional  >  global_seed
```

The winning source, what it overrode, and its effective date are all retained. An
`asOf` date lets a historical estimate re-resolve to the rate that was actually in
force when it was priced, instead of silently repricing itself when reopened.

---

## Markup (RULE-007)

Parallel and stacked are genuinely different numbers, not a presentation choice:

```
$100,000 with 10% overhead + 12% profit + 3% contingency

parallel:  100,000 × (1 + 0.10 + 0.12 + 0.03)      = $125,000
stacked:   100,000 × 1.10 × 1.12 × 1.03            = $126,896
difference                                          =   $1,896
```

Every component reports the basis it was applied to, its sequence, the dollars it
added and the running total after it. Bond and tax are applied in a second pass on
the marked-up total, because "1% of the bid price" genuinely means after overhead,
profit and contingency — in either method.

Regional factor and escalation move the cost basis *before* markup. Escalation
compounds annually, so two years at 4% is 8.16%.

---

## Confidence and approval gates

### Confidence (Section 45)

A 0–100 score starting from how the quantity was obtained, then moved by
verification depth, data provenance, conflicts, assumptions and open questions.

Penalties are deliberately asymmetric. A single unresolved document conflict costs
22 points; a second cross-check earns 5. A conflict means the documents disagree
about what is being built, and no amount of arithmetic resolves that.

Every score below 90 is explained, listing each factor that lowered it.

### Contingency banding (Section 7.2)

| Confidence | Contingency |
|---|---|
| ≤ 69 | 12% — and senior review is mandatory |
| 70–79 | 8% |
| 80–89 | 5% |
| 90–100 | 3% |

At the estimate level, confidence is weighted **by cost**, not by line count. A
60-confidence item worth $2,000 should not drag a $2M estimate into 12% contingency;
one worth $800,000 absolutely should. When the pricing profile carries less
contingency than the confidence band justifies, the engine applies the higher figure
and says so.

### Approval gates (Section 44)

| Gate | When |
|---|---|
| `auto_accept` | Dimensioned, referenced, conflict-free, confidence ≥ 95 |
| `estimator_review` | Confidence 80–94, or the quantity required interpretation |
| `senior_review` | Confidence < 80, a document conflict, a material geotechnical assumption, a major earthwork decision, or > 10% of estimate value |
| `rfi_required` | The supplied documents cannot resolve the question |

Every path is evaluated and **the most restrictive wins**, so a 98-confidence item
sitting on an unresolved conflict still routes to an RFI rather than being
auto-accepted on its score.

**An AI-generated line can never reach `auto_accept`.** RULE-008 forbids silent
writeback, so the floor for anything a model produced is estimator review.

### The Section 59 executive decision

```
document_set_incomplete  →  no lines to price
rfi_resolution_required  →  a line depends on information the documents cannot resolve
senior_review_required   →  a conflict, material assumption or sub-80 confidence
ready_with_assumptions   →  interpretation was required, and the assumptions are stated
ready_for_estimating     →  every line dimensioned, referenced, conflict-free, ≥ 95
```

---

## Worked example: one reference line

800 CY at 100 CY/hr and 100% utilization is exactly 8 hours — exactly one shift —
which makes every figure verifiable by hand. This is the golden test in
`tests/estimate.test.ts`.

```
Quantity      800 CY, explicit dimension, two drawing references
Production    100 CY/hr × 1.00 utilization = 100 CY/hr
Duration      800 ÷ 100 = 8 hr = 1.00 day

Labor        1 operator × 8 hr × $40      = $320.00 wage
              × 35% burden                 = $112.00 burden
Equipment     8 hr × $100                  = $800.00 ownership
Fuel          8 hr × 5 gal = 40 gal × $4   = $160.00

Direct cost                                = $1,392.00
Unit cost     1,392 ÷ 800                  = $1.7400 / CY

Confidence    100 (verified, all three checks, company-actual rate)
Gate          auto_accept
```
