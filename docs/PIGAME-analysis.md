# What PIGAME is doing during the second-digit computation

Question (D. Thurston): the C simulator shows an "11-counter" growing
linearly for >10^11 steps on the seed 89·2^1 — what is it counting, given
that it is not bounded by E ≈ 4096, the Wallis truncation point the paper's
own accuracy bound (E ≥ 4·2^(10n), n = 1) requires?

Method: not more brute force — instrumentation.  `tools/fractran_sim.c`
gained `--rle` (run-length-encoded log of which fraction fires) and
`--state-every M` (full exponent vector every M steps).  The seed-89·2^1 run
to 10^9 steps was decomposed with these, then read against the flowchart
(Figure 3 of Kaushik–Murphy–Weed, arXiv:2412.16185).

## Findings

1. **The run is a chain of unary accumulate loops.**  From step ~0 to
   ~2.65×10^8 the fired-fraction sequence is exactly the 4-cycle

       f31 (71/29) → f8 (2·11·29/(5·71)) → f18 (23/73) → f1 (5·73/(2·23))

   ~2.5×10^6 times per 10^7 steps, accounting for ~96% of all steps.  Net
   register effect per cycle: **11 += 1**; 2, 5, 23, 71, 73, 29 circulate as
   tokens (each produced by one arrow and consumed by another).  At
   ~2.7×10^8 the machine switches to a second 4-cycle

       f12 (79/(2·61)) → f17 (5·61/79) → f30 (67/31) → f9 (2·7·31/(5·67))

   with net effect **7 += 1** per cycle, and the same shape.

2. **The loop's exit is a branch on the 2-register, not a counter running
   out.**  Node 23 (the state after f18) has two outgoing arrows: f1 needs
   `2·23 | n` (stay in the loop, gain 5) and f2 = 29/(7·23) needs `7·23 | n`
   (leave toward node 29, the next phase).  The 2-register is replenished by
   f8 each cycle, so the loop is self-sustaining; it ends when slow drift
   (the ~4% of steps outside the cycle) leaves 2 empty at the node-23 point
   while 7 is present.

3. **The 11-register is therefore a unary accumulator** — the machine is
   doing repeated addition at ~4 steps per unit, and by the 10^11 cap it had
   accumulated ≥2.5×10^10 units.  Snapshots show it still growing linearly
   (6.7×10^7 at step 3×10^8; rate ~0.22/step) with everything else bounded.

## The decoded flowchart (Figure 3, all 40 arrows)

Each fraction is one arrow: from-node = denominator's distinctive prime,
to-node = numerator's, other factors are register deltas.  The full map:

    Phase 1 (build E):  89 ⇄ 47 (+11 / −5), 47 → 17 (+49), 17 ⇄ 19 (+25 / −11),
                        19 → 89 (−3), 19 → 13 (−2), 13 ⇄ 59 (×243/7 = +3^5, −7)
    Phase 2 (Wallis):   19 → 83 (+0), 83 ⇄ 37 (+3 / −11), 37 → 23,
                        23 ⇄ 73 (−2,+5 / hop), 23 → 29 (−7), 29 ⇄ 71 (+11 / −5),
                        23 → 79 (−25), 79 ⇄ 61 (+5 / −2), 61 → 31 (−3),
                        31 → 67, 67 → 61
    Phase 3 (emit):     23 → 41 (−5), 41 → 43 (+2), 43 ⇄ 53 (hop / −7,+11),
                        41 ⇄ 97 (−11,+7 / −3), 97 → 1,
                        node 1 self-loop: −7, −11, −2^10 (f36-f38),
                        node 1 → 89 (f40: RE-SEED for the next digit)

The f40 re-seed confirms OEIS A399511's self-seeding (a(777) = 2^3·89): the
machine computes each digit starting from 2^(previous digit)·89 — the seed
exponent is the previous DIGIT VALUE, not the digit position.

Empirical loop structure of the digit-1 run (seed 89·2^1): the run is a
CHAIN of unary accumulate 4-cycles — (net 11 += 1) for the first 2.65×10^8
steps (6.6×10^7 iterations), then (net 7 += 1) — with the shared
2-register PUMPING deterministically between 0 and ~8192 with period
~10.5M steps (measured: exp2(t) plot, .scratch/k1-exp2.png).  Loop exits
occur at the drain bottoms via the branch arrows (node 23: f1 needs 2·23,
f2 needs 7·23; node 61: f12 needs 2·61, f13 needs 3·61).  A 10^11-step run
with per-10^9 state snapshots is measuring the full chain of loop sizes
(.scratch/k1-states-1e9.txt).

## The measured loop chain (10^11-step run, seed 89·2^1, 100 snapshots)

Per 10^9-step window the machine is in one of three loops, each draining its
fuel register at exactly 1 unit per ~32,768 steps — one full 2-pump cycle
(height 8192 = 2E for this digit):

    L1  steps 0 - 2.65e8      11 += 1 per 4-step cycle   (6.6e7 iterations)
    L2  steps 2.7e8 - 5e9     7 += 10 per cycle          (drains 3^163,760)
    L3  steps 5e9 - ...       11 += 2.5 per step         (drains 7^1.07e10)

The conversion ratio between consecutive stages measures ~8×10^4 (65,344
sevens per 3-unit; 81,875 = 8192×10 elevens per 7-unit — the pump height
times the digit-shift base 10).  Consequences:

* L3 alone needs ~1.07×10^10 iterations × 32,768 steps ≈ **3.5×10^14
  steps** — the 10^11-step search covered only 0.03% of it.
* If the cascade continues (L4's fuel = L3's accumulator, ~8.8×10^14), the
  next loop costs ~3×10^19 steps — ~9,000 years at 10^8 steps/s in C.
* So the second digit of π via PIGAME costs of order **10^19 FRACTRAN
  steps**, each loop's fuel being ~8×10^4× the previous accumulator.  This
  quantifies why it has never been computed by direct simulation, and shows
  KMW's "smaller E" simplification (a constant-factor fix, E from 4·1024^k
  down to π·10^k) does not change the exponential-in-k character: the
  unary-loop cascade itself multiplies the fuel ~8×10^4 per stage.

Measured relations (all from the 100 snapshots): fuel drains 1 unit per
32,768 steps (= 4 × 8192 = 4 × 2E, one full 2-pump cycle per fuel unit);
the 2-pump height is 2E exactly; the accumulator grows 2E × 10 per fuel
unit.

## The open question

The measured chain gives L1 = 6.6×10^7 iterations, L2 ≈ 3×10^8 (draining
3^163,760), L3 ≈ 1.1×10^10 iterations = 3.5×10^14 steps (draining
7^1.07×10^10) — and if the cascade continues with L4 consuming L3's
~8.8×10^14-unit accumulator, L4 alone costs ~3×10^19 steps.  Which loops
belong to the digit's computation versus interim shuffling, and where the
emission (node 1, the 1/1024 strip, f40 re-seed) branches off, requires a
complete Phase-3 decode of Figure 3 against the trajectory.  The
instrumented simulator is the tool; the measured relations above (fuel
drains 1 unit per 2-pump cycle; accumulator grows 2E×10 per fuel unit)
are the constraints any derivation must reproduce.
