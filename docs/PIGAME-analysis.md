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

## The open discrepancy

Per KMW's proof, the second digit needs only E ≈ 4096 (their bound
E ≥ 4·2^(10·1)); the Wallis walk should then be ~E/2 = 2048 terms.  The
observed accumulator is ≥2.5×10^10 — about **10^7 times larger**.  So either
the flowchart's Phase 1 builds an E far beyond what the proof requires (a
~10^7× overshoot at digit 1, consistent in direction with KMW's remark that
"there is no need to generate such a large E" but far larger than that
remark suggests), or the 11-register counts something else entirely (a
dividend counter in Phase 3, say).  Deciding which requires decoding
Figure 3's Phase-1 arrows against the observed trajectory; the instrumented
simulator (`--rle`, `--state-every`) is the tool for that follow-up.

Either way, the practical conclusion stands: the published program's
per-digit cost is enormous by construction, the KMW simplification remark
understates the gap, and a re-derived flowchart with a tight E is the route
to a PIGAME whose later digits are actually computable.
