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

> **After each update, force-reload the live page** (Ctrl/Cmd+Shift+R), or
> wait ten minutes: GitHub Pages serves every file with
> `cache-control: max-age=600`, so a normal reload can keep running the old
> scripts. The build id in the footer tells you which version you are on;
> `python3 tools/stamp.py` writes it (and versioned asset URLs) before each
> commit.

- **Library (left):** seventeen examples in three groups — toys, published
  classics, and programs compiled from register machines. Each carries its
  source and its "interesting event" (pure powers of two for PRIMEGAME,
  decoded outputs for the machines, …).
- **Program + input (middle):** edit the fractions; input is a decimal
  integer or a product of prime powers such as `2^12 * 3^5`. `#` and `//`
  start comments, and an **event specification is a comment too**:

```
# event: pow(2)                n is a pure power of two (k >= 1)
# event: pow(2*5, min=2)       n = 2^k·5^k for some k >= 2
# event: halt(5)               at halt, report the exponent of 5
# event: none                  no highlighted events
```

  anything after `--` is a label shown in the events panel. The spec drives
  the orange chart dots and the **⏭ next event** button, which stops the run
  *on* the event state. Every example's spec is written this way — look at
  PRIMEGAME's last line. "apply" re-parses program, input and event.

  Under the editor, the **fraction strip** shows the program as chips — in
  the current display mode, so `78/85` reads `2·3·13/5·17` in factors mode —
  with the amber chip marking the fraction that just fired and the outlined
  chip the one that will fire next.
- **Controls:** step / run / back / next-event / reset, at 10 → max steps
  per second (space = run/pause, ←/→ = back/step).  **blank** (top-right of
  the program pane) starts you on a minimal editable program with no example
  selected; **syntax** beside it shows the fraction, input and event
  directives.  ⏭ next event means the *next* one — pressed while already
  sitting on an event, it runs on to the following event rather than doing
  nothing.
- **State (right):** the fraction that fired, `n` itself (copy button for the
  full value), the register view, and the decoded events.
  Registers have two displays, toggled above the panel: **chips** (only the
  nonzero registers, compact) and **bars** — a *fixed* set of rows for every
  register the program can touch (primes in its fractions, plus the example's
  named registers), each with a bar and its value. In bars mode a register
  that drops to zero becomes an empty row rather than disappearing, so a run
  like PRIMEGAME does not flicker; rows the last fired fraction touched are
  underlined.
- **Numbers / factors (top):** a global display toggle — every *value* on the
  page switches between its decimal form and its prime factorization: the
  fraction strip, the current `n`, and the parsed input.  (The editor keeps
  the program as written; the summarized strip is what changes.)
- **Chart:** log₁₀ n over steps. The shaded band spans every value in each
  pixel column (PRIMEGAME's oscillation is the point), the bright line is the
  upper envelope, orange dots mark events, and the left edge carries the
  actual axis values plus a live "log₁₀ n = … now" readout — the vertical
  position alone never has to be guessed at. Event dots are pinned to the
  value the event had when it fired (recorded at event time), so as the run
  continues they keep their own height and only slide left smoothly with the
  stretching step axis; the axis spans the event values too, so no dot is
  ever clamped onto an edge. Geometry is computed by a pure, unit-tested
  function (`core.js` `chartGeometry`) that keeps every coordinate finite and
  inside the box for any canvas size and any data. The log itself is
  computed per engine: in registers mode it is a dot product over the
  factorization with precomputed log₁₀ of each prime (no integer is ever
  rebuilt — rebuilding a 50,000-digit n would cost ~0.8 ms *per step*),
  and in arithmetic mode from `n` directly via its leading bits.
- **Engine toggle (top):** two equivalent implementations, switchable live:
  - *arithmetic* — works directly on the big integer `n` and does **nothing
    but divide**: test `n % den`, then `n → n/den·num`. No factorization
    anywhere in the engine; event checks divide by the event's own primes.
    (The register panel is a display-layer view maintained by the UI.)
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
  initial digit of π) at step 775, exactly as documented. Our simulation
  also reproduces the OEIS **A399511** trajectory (Hasler's PIGAME
  successor function, from 1) for **all 1001 published values** — an
  independent published reference for the transcription and both engines.
  Later digits are a different animal: the mechanism (Kaushik–Murphy–
  Weed, arXiv:2412.16185, who give the first full proof) is **Wallis's
  product** for π/2, truncated at an even $E \ge 4\cdot 2^{10n}$ (the
  bound their Mähler irrationality-measure argument forces, which they
  themselves note is far larger than necessary), so the per-digit cost
  grows like $1024^n$.  Empirically: the seed convention is $89\cdot 2^k$
  for digit $k$, the OEIS record shows the *second* digit taking more than
  $10^6$ steps with 150,000-digit intermediates, and our C-simulator
  searches exhausted $10^{11}$ steps for each of $89\cdot 2^1$ and
  $89\cdot 2^2$ without reaching a power of two.  No published step count
  exists beyond the first digit — the app says so rather than implying
  otherwise.
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
4. **`tests/dom-smoke.cjs`** — loads the actual page into jsdom, evaluates
   the very scripts a browser would, and clicks through the UI: the library
   renders all 17 examples, stepping updates the displayed `n` (2 → 15 in
   PRIMEGAME), run/pause respects the speed setting, the engine toggle
   resets, loading the adder and stepping to its halt shows the decoded
   output, and Back undoes a step. Needs jsdom, deliberately not a repo
   dependency: `npm i --prefix .scratch/js jsdom` (skipped loudly when
   absent).

```
python3 tools/oracle.py
node tests/run_tests.cjs        # ~/node/bin/node on this VM
node tests/dom-smoke.cjs
```

**Negative controls.** Each layer must be able to fail, and both are
verified to: corrupting a *program* (one fraction of the adder swapped)
makes `tools/oracle.py` exit non-zero naming the broken claim — semantic
checking is the oracle's job; tampering with a *fixture* (a changed
expected `n`, an off-by-one step count) makes `node tests/run_tests.cjs`
exit non-zero pinpointing the tampered values across both engines. The
check that cannot fail is not a check.

The layering earned its keep during development: the oracle's first
"interesting event" checker mishandled monomials like `{"2":1,"5":1}` when a
prime was *absent* from `n` (it read $5^2$ as a power of ten), briefly
"disproving" Kilminster's ten-fraction program. The JS engine disagreed,
the esolangs wiki's recorded J session disagreed with the "disproof", and
the bug was fixed in the oracle before anything shipped — with both
Kilminster programs then verifying clean and entering the library.

Known unverified part: real-device behaviour (touch, other GPUs, other
browsers).  Rendering, layout and interaction **are** browser-verified:
headless Firefox (playwright) loads the page, clicks through
step/run/pause/bars/factors/next-event, and takes the screenshots in
`.scratch/js/shots/` — see `tests/browser-smoke.mjs` (skipped when
playwright is not installed).  jsdom covers wiring; Firefox covers
rendering.  If something still looks off on your machine, a screenshot
would settle it.

## Rebuilding the generated pieces

- `examples.js` is generated: edit `tools/build_examples.py` (metadata,
  sources, event specs; compiled programs come from `compile_minsky.py`)
  and run `python3 tools/build_examples.py`.
- After changing any program, re-run the oracle and tests (they will tell
  you if a claim broke):

```
python3 tools/build_examples.py && python3 tools/oracle.py && node tests/run_tests.cjs
```

## A fast C simulator for long searches

`tools/fractran_sim.c` is a factor-vector simulator in C (~10⁸ steps/s on
this VM, vs ~10⁶/s for the Python oracle — used for the PIGAME
digit searches, where the published bound was 10⁶ steps).  It is *not*
used by the app or the test suite; it exists for long unattended runs, and
it is verified before it is trusted: its trajectory under PIGAME from 1
matches OEIS A399511's b-file for all 1000 published states, and the Python
oracle remains the semantics owner.

```
gcc -O2 -o .scratch/fractran_sim tools/fractran_sim.c
.scratch/fractran_sim --program .scratch/pigame.frac --seed "89" \
    --steps 775 --dump-states        # states; "power 775 2 3" at the digit
```

## File map

```
index.html            the app (open this)
core.js               engines: parsing, pure-division arithmetic + factorization, events
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
verified by simulation before being published; both Kilminster listings and
the PIGAME transcription needed the checker bug fixed first (see above), and
all verify clean as shipped.
