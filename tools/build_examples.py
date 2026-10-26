#!/usr/bin/env python3
"""Build examples.js — the example library embedded in the web app.

The hand-written metadata (descriptions, sources, register legends, event
specs, demo inputs) lives here; the five compiled programs are pulled from
compile_minsky.py.  The output examples.js is generated: edit THIS file and
re-run, never edit examples.js by hand.

Every published program below was transcribed from a named source and is
re-verified computationally by tools/oracle.py before being trusted.
"""

import json
import sys

sys.path.insert(0, "tools")
from compile_minsky import MACHINES


def program_of(machine_name):
    c, _roles = MACHINES[machine_name]()
    return c.text().rstrip("\n")


def legend_of(machine_name):
    c, roles = MACHINES[machine_name]()
    return c.legend(roles)


EXAMPLES = [

    # ------------------------------------------------------------- toys ----
    dict(
        id="doubler",
        name="Doubler",
        group="Toys",
        program="2   # the fraction 2/1: n -> 2n, always applicable",
        input="1",
        event=dict(kind="monomial", monomial={"2": 1}, minExp=1, label="2^k"),
        registers={"2": "n"},
        maxSteps=40,
        description=(
            "The smallest FRACTRAN program that does something: the single "
            "fraction 2/1 divides every n, so n doubles forever — 1, 2, 4, "
            "8, … Step k lands exactly on 2^k. A first taste of the rule: "
            "at each step, multiply n by the FIRST fraction that keeps it "
            "an integer."
        ),
        source="trivial warm-up",
    ),
    dict(
        id="pingpong",
        name="Ping-pong (never halts)",
        group="Toys",
        program="3/2   # if n has a 2: swap one 2 for a 3\n2/3   # if n has a 3: swap one 3 for a 2",
        input="9",
        event=dict(kind="monomial", monomial={"3": 1}, minExp=2, label="3^b (ping)"),
        registers={"2": "twos", "3": "threes"},
        maxSteps=30,
        description=(
            "From 9 = 3^2 the program can only fire 2/3, giving 6 = 2·3^1; "
            "then only 3/2 fits, giving 9 back. The run cycles 9 → 6 → 9 → "
            "… forever — FRACTRAN programs need not halt, and 'first "
            "applicable fraction' is all the control flow there is."
        ),
        source="trivial warm-up",
    ),
    dict(
        id="adder",
        name="Addition: 2^a 3^b → 3^(a+b)",
        group="Toys",
        program="3/2   # move one unit from register a to register b",
        input="2^12 * 3^5",
        event=dict(kind="halt", outputPrime="3", label="halts at 3^(a+b)"),
        registers={"2": "a", "3": "b (ends at a+b)"},
        maxSteps=100,
        description=(
            "The one-fraction adder: while a two divides n, replace it with "
            "a three. Starting from 2^a·3^b the run ends at 3^(a+b) — "
            "subtraction by absence: when no fraction fits, the program "
            "halts. Register a flows into register b."
        ),
        source="the 'simplest FRACTRAN program' of Wikipedia's FRACTRAN article (Addition)",
    ),

    # ------------------------------------------------- published classics --
    dict(
        id="multiplier",
        name="Multiplication: 2^a 3^b → 5^(a·b)",
        group="Published classics",
        program=(
            "455/33   # state B: b>0: b--, out++, copy++, secondary flag on\n"
            "11/13    # state B: re-arm primary flag\n"
            "1/11     # state B: b=0: drop flag, return to state A\n"
            "3/7      # state A: restore one unit of b from the copy\n"
            "11/2     # state A: a>0: a--, enter state B\n"
            "1/3      # state A: drain leftover b, stay in A"
        ),
        input="2^12 * 3^5",
        event=dict(kind="halt", outputPrime="5", label="halts at 5^(a·b)"),
        registers={"2": "a", "3": "b", "5": "a·b (output)",
                   "7": "copy of b", "11": "state B flag", "13": "state B secondary flag"},
        maxSteps=100000,
        description=(
            "Conway's multiplier: state B copies b into the output and into "
            "a holding register, state A restores b and decrements a. Each "
            "state is a prime exponent (11/13 are the B flags); a fraction "
            "can only fire while its state prime divides n, which is how an "
            "ordered list of fractions encodes jumps."
        ),
        source="Wikipedia, FRACTRAN, 'Multiplication' (a multiplier of the kind in Conway 1987); verified computationally",
    ),
    dict(
        id="divider",
        name="Division: 2^n 3^d 11 → 5^q 7^r",
        group="Published classics",
        program=(
            "91/66    # state A: n>0,d>0: pair off one n and one d into q\n"
            "11/13    # state A: re-arm primary flag\n"
            "1/33     # state A: d exhausted n-wise, move to state X\n"
            "85/11    # state A: quotient unit done, enter state B\n"
            "57/119   # state B: restore d from the working copy\n"
            "17/19    # state B: re-arm\n"
            "11/17    # state B: d restored, back to state A\n"
            "1/3      # state X: drain leftover d (the remainder path)"
        ),
        input="2^47 * 3^5 * 11",
        event=dict(kind="halt", outputPrime="5", label="halts at 5^q · 7^r"),
        registers={"2": "n (dividend)", "3": "d (divisor)", "5": "q (quotient)",
                   "7": "r (remainder)", "11": "state flag", "13": "state flag",
                   "17": "state flag", "19": "state flag"},
        maxSteps=100000,
        description=(
            "Quotient and remainder by repeated pairing: each (n,d) pair "
            "becomes one unit of q; what survives in d becomes r, with "
            "n = q·d + r and 0 ≤ r < d. Input carries the seed state prime "
            "11 alongside the two registers."
        ),
        source="Wikipedia, FRACTRAN, 'Subtraction and division'; verified computationally",
    ),
    dict(
        id="hamming",
        name="Hamming weight: 2^a → 13^H(a)",
        group="Published classics",
        program=(
            "33/20    # state A: a>1: peel two 2s into a half-counter\n"
            "5/11     # state A: re-arm\n"
            "13/10    # state A: a=1: one last 1-bits worth, flag B on\n"
            "1/5      # state A: a=0: move on\n"
            "2/3      # state B: rebuild a from halves\n"
            "10/7     # state B: a walk finished a bit: count it\n"
            "7/2      # state B: re-enter the walk"
        ),
        input="2^27",
        event=dict(kind="halt", outputPrime="13", label="halts at 13^H(a)"),
        registers={"2": "a", "3": "halves", "5": "state A flag", "11": "state A flag",
                   "13": "H(a) (output)", "7": "bit walker"},
        maxSteps=20000,
        description=(
            "Counts the 1s in the binary expansion of a: repeatedly halve "
            "the register, and each odd rest contributes one to the output "
            "register (prime 13). 27 = 11011₂ has four 1s, so the run ends "
            "at 13^4 = 28561. Try other inputs: 2^1023, 2^1024…"
        ),
        source="John Baez, 'Puzzle #4', The n-Category Café (2006), as listed on Wikipedia's FRACTRAN page; verified computationally",
    ),
    dict(
        id="primegame",
        name="PRIMEGAME (Conway)",
        group="Published classics",
        program=(
            "17/91   78/85   19/51   23/38   29/33   77/29   95/23\n"
            "77/19   1/17    11/13   13/11   15/2    1/7     55/1"
        ),
        input="2",
        event=dict(kind="monomial", monomial={"2": 1}, minExp=2, label="2^p — p is prime"),
        registers={"2": "output: n = 2^p exactly when p is prime"},
        maxSteps=400000,
        description=(
            "Conway's famous 14-fraction prime generator. Starting from 2, "
            "the trajectory wanders through junk values — but the only "
            "times n is a pure power of two, the exponent is prime: 2^2, "
            "2^3, 2^5, 2^7, 2^11 … Watch the event panel and the orange "
            "dots on the chart. Under the hood it is a division-based "
            "primality test (Guy 1983 gives the walkthrough); reaching 2, "
            "3, 5, 7 takes 19, 69, 281, 710 steps."
        ),
        source="J. H. Conway, 'FRACTRAN: a simple universal programming language for arithmetic' (1987); transcribed from Wikipedia's FRACTRAN article; verified computationally",
    ),
    dict(
        id="primegame_variant",
        name="PRIMEGAME, faster variant",
        group="Published classics",
        program=(
            "17/91   78/85   19/51   23/38   29/33   77/29   95/23\n"
            "77/19   1/17    11/13   13/11   15/14   15/2    55/1"
        ),
        input="2",
        event=dict(kind="monomial", monomial={"2": 1}, minExp=2, label="2^p — p is prime"),
        registers={"2": "output: n = 2^p exactly when p is prime"},
        maxSteps=400000,
        description=(
            "A variant differing by two fractions (15/14 replaces 1/7 and "
            "15/2 moves next to it). It reaches the same primes a little "
            "faster: 2, 3, 5, 7 after 19, 69, 280, 707 steps. A nice "
            "exercise: diff the two programs and the two step counts."
        ),
        source="R. K. Guy (1983) / Conway & Guy, 'The Book of Numbers' (1996), p. 147, via Wikipedia; verified computationally",
    ),
    dict(
        id="kilminster",
        name="Kilminster's 10-fraction primes",
        group="Published classics",
        program=(
            "7/3      99/98    13/49    39/35    36/91\n"
            "10/143   49/13    7/11     1/2      91/1"
        ),
        input="10",
        event=dict(kind="monomial", monomial={"2": 1, "5": 1}, minExp=2, label="10^p — p is prime"),
        registers={"2": "output 10^p (two-part)", "5": "output 10^p (two-part)"},
        maxSteps=20000,
        description=(
            "Devin Kilminster's ten-instruction prime generator (1999): "
            "starting from 10, the successive powers of ten that appear "
            "have prime exponents — 10^2, 10^3, 10^5, 10^7, 10^11 …, here "
            "at steps 16, 67, 256, 617, 1659, 2830, 5098. Wikipedia's "
            "article carries an editor's note asking someone to check this "
            "listing against Havil's book for typos; it verifies clean. "
            "(Our first verification pass 'failed' it — that was a bug in "
            "our own event checker, fixed before shipping; see README.)"
        ),
        source="Devin Kilminster (1999), as given in Havil, 'Nonplussed!' (2007), p. 176, via Wikipedia; verified computationally",
    ),
    dict(
        id="kilminster9",
        name="Kilminster's 9-fraction primes (faster)",
        group="Published classics",
        program=(
            "3/11     847/45   143/6    7/3      10/91\n"
            "3/7      36/325   1/2      36/5"
        ),
        input="10",
        event=dict(kind="monomial", monomial={"2": 1, "5": 1}, minExp=2, label="10^p — p is prime"),
        registers={"2": "output 10^p (two-part)", "5": "output 10^p (two-part)"},
        maxSteps=20000,
        description=(
            "Kilminster's later shortening of the ten-fraction program "
            "above, to nine fractions — and measurably faster: 10^2, "
            "10^3, 10^5, 10^7, 10^11 … arrive at steps 10, 46, 196, 500, "
            "1428 (the ten-fraction version needs 16, 67, 256, 617, "
            "1659). Both programs make a nice race: run them side by "
            "side with the 'next event' button."
        ),
        source="Devin Kilminster, nine-fraction version via the esolangs wiki (FRACTRAN), where it is shown working in a J session; re-verified computationally here",
    ),
    dict(
        id="multiplier_esolangs",
        name="Multiplier (esolangs variant): 2^x 3^y → 5^(xy)",
        group="Published classics",
        program=(
            "13/21    # state A: pair one y with one copy-unit\n"
            "385/13   # state A: emit to output and the copy register\n"
            "1/7      # state A: copy drained: one y consumed\n"
            "3/11     # state A: re-arm\n"
            "7/2      # state B: x>0: x--, start copying y\n"
            "1/3      # state B: y=0 path"
        ),
        input="2^12 * 3^5",
        event=dict(kind="halt", outputPrime="5", label="halts at 5^(x·y)"),
        registers={"2": "x", "3": "y", "5": "x·y (output)", "7": "copy of y",
                   "11": "state flag", "13": "state flag"},
        maxSteps=100000,
        description=(
            "A second, independently published multiplier (the esolangs "
            "wiki's Fractran page), structurally different from Conway's "
            "six-fraction version above: state A rebuilds y from a copy "
            "while emitting to the output, state B counts x down. Same "
            "contract — input 2^x·3^y, output 5^(x·y) — so the two "
            "programs make a nice A/B comparison of styles."
        ),
        source="esolangs wiki, FRACTRAN page ('essentially multiplying x by y'); verified computationally",
    ),
    dict(
        id="pigame",
        name="PIGAME (Conway): digits of π",
        group="Published classics",
        program=(
            "365/46   29/161   79/575   679/451   3159/413  83/407\n"
            "473/371  638/355  434/335  89/235    17/209    79/122\n"
            "31/183   41/115   517/89   111/83    305/79    23/73\n"
            "73/71    61/67    37/61    19/59     89/57     41/53\n"
            "833/47   53/43    86/41    13/38     23/37     67/31\n"
            "71/29    83/19    475/17   59/13     41/291    1/7\n"
            "1/11     1/1024   1/97     89/1"
        ),
        input="89",
        event=dict(kind="monomial", monomial={"2": 1}, minExp=1, label="2^d — the next digit of π"),
        registers={"2": "output: first power of 2 is 2^(digit of π)", "89": "seed"},
        maxSteps=5000,
        description=(
            "Conway's 40-fraction π machine. Play from 89 and the FIRST "
            "power of two in the trajectory is 8 = 2^3 — the initial digit "
            "of π — after 775 steps (the value Wikipedia documents, and "
            "what we verify). For later digits the documented input is "
            "2^d·89 with first power of two 2^π(d); we could not confirm "
            "any pure power of two within 30 million steps for d = 1, so "
            "treat the general claim as unverified here and enjoy the d = 0 "
            "case, which checks out exactly. The transcription itself was "
            "re-checked character by character against the source."
        ),
        source="J. H. Conway, 'FRACTRAN: a simple universal programming language for arithmetic' (1987), Theorem 2; transcribed from Wikipedia (which corrects the input to 2^n·89); verified computationally",
    ),

    # ------------------------------------------------- compiled machines ---
    dict(
        id="gcd",
        name="GCD by lockstep subtraction",
        group="Compiled from register machines",
        machine="gcd",
        input="11 * 2^48 * 3^18",
        event=dict(kind="halt", outputPrime="5", label="halts with 5^gcd(a,b)"),
        maxSteps=100000,
        description=(
            "Euclid by repeated subtraction, compiled from a register "
            "machine by tools/compile_minsky.py: drain a and b in lockstep "
            "counting the min; when one hits zero, restore it from the "
            "count and continue; when both hit zero, the count is the gcd. "
            "Every fraction below is one machine instruction (the comments "
            "name it); the final n is a pure register product."
        ),
        source="generated by tools/compile_minsky.py (this repository); verified as plain FRACTRAN by tools/oracle.py against math.gcd",
    ),
    dict(
        id="fib",
        name="Fibonacci numbers F_k",
        group="Compiled from register machines",
        machine="fib",
        input="17 * 2^10",
        event=dict(kind="halt", outputPrime="13", label="halts with 13^F_k"),
        maxSteps=10000,
        description=(
            "F_k by k-fold application of (a,b) ← (b, a+b), compiled from a "
            "register machine. Register b starts at 1 (the machine sets it "
            "itself); with input 17·2^k the run halts with the exponent of "
            "13 equal to F_k and 5^F_(k+1) left over. F_0 = 0, F_1 = 1."
        ),
        source="generated by tools/compile_minsky.py; verified by tools/oracle.py against direct Fibonacci arithmetic",
    ),
    dict(
        id="factorial",
        name="Factorial k!",
        group="Compiled from register machines",
        machine="fact",
        input="17 * 2^6",
        event=dict(kind="halt", outputPrime="13", label="halts with 13^(k!)"),
        maxSteps=200000,
        description=(
            "k! as a consuming multiply: burn the accumulator down unit by "
            "unit, adding k to the result for each unit, then move the "
            "result back and decrement k. Compiled from a register machine; "
            "6! = 720 takes about 33,000 FRACTRAN steps — watch the chart "
            "climb as the product register grows."
        ),
        source="generated by tools/compile_minsky.py; verified by tools/oracle.py against direct factorial arithmetic",
    ),
    dict(
        id="sqrt",
        name="Integer square root",
        group="Compiled from register machines",
        machine="sqrt",
        input="17 * 2^50",
        event=dict(kind="halt", outputPrime="13", label="halts with 13^⌊√n⌋"),
        maxSteps=50000,
        description=(
            "floor(sqrt n) by the odd-number method: subtract 1, 3, 5, … "
            "from n until you cannot; the number of subtractions is the "
            "root. Compiled from a register machine (the lockstep compare "
            "restores whichever of r/o survives). Input 17·2^n; output "
            "exponent of 13; the last odd tried is left over."
        ),
        source="generated by tools/compile_minsky.py; verified by tools/oracle.py against math.isqrt",
    ),
    dict(
        id="collatz",
        name="Collatz step counter",
        group="Compiled from register machines",
        machine="collatz",
        input="19 * 2^27",
        event=dict(kind="halt", outputPrime="17", label="halts with 17^(steps to 1)"),
        maxSteps=1000000,
        description=(
            "The number of Collatz steps from n down to 1 (n = 27 needs "
            "111 steps — and about half a million FRACTRAN steps, since "
            "everything here is unary arithmetic on prime exponents: "
            "parity by draining by twos, 3n+1 by copying and tripling). "
            "A demonstration that FRACTRAN is a real computer, not a toy."
        ),
        source="generated by tools/compile_minsky.py; verified by tools/oracle.py against direct Collatz iteration",
    ),
]


def build():
    out = []
    for ex in EXAMPLES:
        e = dict(ex)
        if "machine" in e:
            name = e.pop("machine")
            e["program"] = program_of(name)
            e["registers"] = legend_of(name)
        out.append(e)
    return out


if __name__ == "__main__":
    data = build()
    js = (
        "// GENERATED by tools/build_examples.py — edit that file, not this one.\n"
        "// Each example carries its source; every program is verified by\n"
        "// tools/oracle.py before being trusted (see tests/).\n"
        "const FRACTRAN_EXAMPLES = "
        + json.dumps(data, indent=2, ensure_ascii=True)
        + ";\n\n"
        + "if (typeof module !== \"undefined\" && module.exports) module.exports = FRACTRAN_EXAMPLES;\n"
    )
    with open("examples.js", "w") as fh:
        fh.write(js)
    print(f"wrote examples.js with {len(data)} examples")
    for e in data:
        nf = len(e["program"].replace("#", "").split()) // 1
        print(f"  {e['id']:18s} input={e['input']}")
