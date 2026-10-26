# FRACTRAN playground

A self-contained web app for demonstrating **FRACTRAN**, John Conway's
programming language of fractions (1987). A program is an ordered list of
positive fractions and a positive integer `n`; one step multiplies `n` by the
**first** fraction that keeps the product an integer, and the program halts
when no fraction fits. That single rule is Turing-complete. No build step,
no dependencies, no network: open `index.html` in a browser (directly from
disk — everything is local), or serve the folder:

```
python3 -m http.server 8000     # then http://localhost:8000
```

## Using it

- **Library (left):** seventeen examples in three groups — toys, published
  classics, and programs compiled from register machines. Each carries its
  source and its "interesting event" (pure powers of two for PRIMEGAME,
  decoded outputs for the machines, …).
- **Program + input (middle):** edit the fractions; input is a decimal
  integer or a product of prime powers such as `2^12 * 3^5`. `#` and `//`
  start comments. "apply" re-parses and restarts.
- **Controls:** step / run / back / next-event / reset, at 10 → max steps
  per second (space = run/pause, ←/→ = back/step).
- **State (right):** the fraction that fired, `n` itself (full value, copy
  button for very large ones), the register view (prime exponents, named
  where the example defines a register map), and the decoded events.
- **Chart:** log₁₀ n over steps, with orange dots at events — PRIMEGAME's
  sawtooth is the picture of the article.
- **Engine toggle (top):** two equivalent implementations, switchable live:
  - *arithmetic* — works directly on the big integer `n` (BigInt), exactly
    as the definition reads, with a factorization cache updated
    incrementally alongside;
  - *registers* — stores `n` as its prime factorization, the counter-machine
    view where each exponent is a register.

## The example library

Toys: the doubler (`2/1`), a never-halting ping-pong, the one-fraction adder
`3/2`.

Published classics (each with its source named in the app and verified
computationally — see below):

- Conway's **PRIMEGAME** and its faster variant — powers of two appear only
  at prime exponents; we reproduce the published step counts 19, 69, 281,
  710 (variant: 19, 69, 280, 707) for 2, 3, 5, 7.
- Conway's **PIGAME** — from 89 the first power of two is $2^3$ (the
  initial digit of π) at step 775, exactly as documented. The general
  "digit $d$ from $2^d\cdot 89$" claim we could **not** verify: a
  30-million-step search finds no pure power of two at all for $d = 1$
  (two independent simulators agree), so the app documents that limit
  rather than asserting the claim.
- Conway's multiplier and the quotient/remainder program (Wikipedia's
  "Creating simple programs"), John Baez's Hamming-weight program, and the
  esolangs wiki's second multiplier — all checked on grids of inputs.
- **Kilminster's prime generators, ten and nine fractions.** The
  ten-instruction version (Havil's *Nonplussed!* 2007, p. 176, quoted on
  Wikipedia with an editor's note asking for exactly this check) verifies
  clean: powers of ten at exponents 2, 3, 5, 7, 11, 13, 17 arrive at steps
  16, 67, 256, 617, 1659, 2830, 5098. His later nine-fraction shortening
  (esolangs wiki) does the same faster: 10, 46, 196, 500, 1428 … Both are
  published and both are verified.

Compiled from register machines (`tools/compile_minsky.py`): GCD by lockstep
subtraction, Fibonacci, factorial, integer square root, and a Collatz step
counter (27 needs 111 steps — about half a million FRACTRAN steps of unary
arithmetic). The generated programs carry one comment per machine
instruction, and are verified as plain FRACTRAN, not trusted at the
machine level.

## How the programs are verified

Three independent layers, all reproducible from the repo:

1. **`tools/oracle.py`** — a deliberately dumb Python implementation of the
   definition (direct big-integer arithmetic, no exponent maps). It checks
   every example's *published claim*: PRIMEGAME's step counts, PIGAME's
   digits, multiplier/divider/Hamming grids against direct arithmetic, the
   compiled machines against `math.gcd`, Fibonacci, factorials,
   `math.isqrt` and Collatz iteration. It exits non-zero on any failure.
2. **`tests/fixtures.json`** — written by the oracle: one showcase run per
   example (input, max steps, final `n`, event list, trajectory head,
   fired-fraction log).
3. **`tests/run_tests.cjs`** — replays every fixture through BOTH real JS
   engines and demands exact agreement (and that the engines agree with
   each other). Run:

```
python3 tools/oracle.py
node tests/run_tests.cjs        # ~/node/bin/node on this VM
```

**Negative control.** The test harness must be able to fail:
`EXAMPLES_PATH=<corrupted copy> node tests/run_tests.cjs` (and the same
flag on the oracle) — e.g. with one fraction of the adder swapped — is
verified to be caught, loud and specific. The check that cannot fail is
not a check.

The layering earned its keep during development: the oracle's first
"interesting event" checker mishandled monomials like `{"2":1,"5":1}` when a
prime was *absent* from `n` (it read $5^2$ as a power of ten), briefly
"disproving" Kilminster's ten-fraction program. The JS engine disagreed,
the esolangs wiki's recorded J session disagreed with the "disproof", and
the bug was fixed in the oracle before anything shipped — with both
Kilminster programs then verifying clean and entering the library.

Known unverified part: the *interactive UI* (buttons, chart, layout). The
logic under it is fully tested headlessly; the clicking was not — the
build environment has no browser. If something looks off in the UI, the
engines in `core.js` are the tested ground truth.

## Rebuilding the generated pieces

- `examples.js` is generated: edit `tools/build_examples.py` (metadata,
  sources, event specs; compiled programs come from `compile_minsky.py`)
  and run `python3 tools/build_examples.py`.
- After changing any program, re-run the oracle and tests (they will tell
  you if a claim broke):

```
python3 tools/build_examples.py && python3 tools/oracle.py && node tests/run_tests.cjs
```

## File map

```
index.html            the app (open this)
core.js               engines: parsing, arithmetic + factorization, events
app.js                UI: library, controls, registers, events, chart, trace
style.css             styling
examples.js           GENERATED example library (edit tools/build_examples.py)
tools/build_examples.py   metadata + generator for examples.js
tools/compile_minsky.py   register-machine → FRACTRAN compiler (state primes)
tools/oracle.py           independent Python verifier; writes the fixtures
tests/run_tests.cjs       replays fixtures through both JS engines
tests/fixtures.json       GENERATED expected runs (oracle output)
README.md                 this file
```

## Source note

Programs were transcribed from: Wikipedia's FRACTRAN article (raw wikitext),
the esolangs wiki's Fractran page, and MathWorld — each named per example in
`tools/build_examples.py` and in the app. Every transcription was then
verified by simulation; the one that failed (Havil's ten-fraction
Kilminster listing) is documented above instead of published.
