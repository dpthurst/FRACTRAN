#!/usr/bin/env python3
"""Independent verifier for the FRACTRAN example library.

This is deliberately a SECOND, dumb implementation: direct big-integer
arithmetic straight from the definition (n -> n·f_i for the first fraction
that keeps n integral), not the JS engine's exponent maps.  It

  1. checks every example's published claim (PRIMEGAME's step counts,
     PIGAME's digits, the multiplier's products, the compiled machines
     against math.gcd / Fibonacci / factorials / math.isqrt / Collatz ...),
  2. runs each example's showcase input and writes tests/fixtures.json,
     which tests/run_tests.cjs replays through the actual JS engines.

If a source transcription has a typo, the validator fails loudly here —
before anything is published.

Usage: python3 tools/oracle.py [--examples examples.js] [--fixtures tests/fixtures.json]
Exits non-zero on any failure.
"""

import json
import math
import re
import sys
from itertools import product

# ---------------------------------------------------------------- parsing


def parse_program(text):
    """[(num, den)] in lowest terms; raises on junk. Independent of the JS."""
    fracs = []
    for line_no, line in enumerate(text.splitlines(), 1):
        for cut in ("#", "//"):
            if cut in line:
                line = line[: line.index(cut)]
        for tok in re.split(r"[\s,]+", line):
            if not tok:
                continue
            m = re.fullmatch(r"(\d+)/(\d+)", tok)
            if m:
                a, b = int(m.group(1)), int(m.group(2))
                if b == 0:
                    raise ValueError(f"line {line_no}: zero denominator")
                g = math.gcd(a, b)
                fracs.append((a // g, b // g))
                continue
            if re.fullmatch(r"\d+", tok):
                fracs.append((int(tok), 1))
                continue
            raise ValueError(f"line {line_no}: bad token {tok!r}")
    if not fracs:
        raise ValueError("empty program")
    return fracs


def parse_input(text):
    t = text.strip()
    if re.fullmatch(r"\d+", t):
        n = int(t)
        if n < 1:
            raise ValueError("input must be positive")
        return n
    n = 1
    for part in t.split("*"):
        m = re.fullmatch(r"\s*(\d+)(?:\^(\d+))?\s*", part)
        if not m:
            raise ValueError(f"bad input factor {part!r}")
        base, exp = int(m.group(1)), int(m.group(2) or 1)
        if not is_prime(base):
            raise ValueError(f"input base {base} is not prime")
        n *= base ** exp
    return n


def is_prime(p):
    if p < 2:
        return False
    if p < 4:
        return True
    if p % 2 == 0:
        return False
    i = 3
    while i * i <= p:
        if p % i == 0:
            return False
        i += 2
    return True


# ------------------------------------------------------------ simulation


def run(fracs, n, max_steps):
    """Simulate from the definition; return (steps, halted, events).

    Event checks divide n by the event spec's own primes and nothing else --
    no general factoring anywhere, mirroring the arithmetic engine (core.js).
    events: list of (step, kind, value) for pure-power (monomial) states and
    for the halt, computed here independently of the JS event code.
    """
    spec = CUR_EVENT
    m_primes = None
    if spec["kind"] == "monomial":
        m_primes = {int(p): int(e) for p, e in spec["monomial"].items()}
    out_pr = int(spec.get("outputPrime") or 0)
    min_exp = int(spec.get("minExp") or 1)

    def monomial_k(x):
        """k if x is a pure power of the monomial with exponent k, else None."""
        rem = x
        ks = set()
        for p, unit in m_primes.items():
            e = 0
            while rem % p == 0:
                rem //= p
                e += 1
            if e % unit != 0:
                return None
            ks.add(e // unit)
        if rem != 1 or len(ks) != 1:
            return None
        return ks.pop()

    def exp_of_prime(x, p):
        """exponent of p in x, by repeated division (None if absent)."""
        if x % p != 0:
            return None
        e = 0
        while x % p == 0:
            x //= p
            e += 1
        return e

    events = []
    steps = 0
    halted = False
    traj = [n]
    fired_log = []
    while steps < max_steps:
        # event check on the CURRENT n (before stepping)
        if m_primes is not None:
            k = monomial_k(n)
            if k is not None and k >= min_exp:
                events.append((steps, "monomial", k))
        for i, (num, den) in enumerate(fracs):
            if (n * num) % den == 0:
                n = n // den * num
                steps += 1
                traj.append(n)
                fired_log.append(i)
                break
        else:
            halted = True
            value = exp_of_prime(n, out_pr) if out_pr else None
            events.append((steps, "halt", value))
            break
    return dict(steps=steps, halted=halted, final_n=n, events=events,
                traj=traj[:64], fired=fired_log[:64])


def exponent_of(n, p):
    e = 0
    while n % p == 0:
        n //= p
        e += 1
    return e, n


# ------------------------------------------------------------- validation

FAILURES = []


def check(label, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + label + (" " + detail if detail else ""),
          flush=True)
    if not cond:
        FAILURES.append(label)


def validate(ex, fracs, result):
    """Check the example's published claim, independently. ex.id drives it."""
    exid = ex["id"]
    ev = result["events"]
    monos = [(s, k) for (s, kind, k) in ev if kind == "monomial"]
    halt = [(s, k) for (s, kind, k) in ev if kind == "halt"]

    if exid == "doubler":
        # n at step k is 2^k for the whole run
        ok = all(result["traj"][k] == 2 ** k for k in range(len(result["traj"])))
        check("doubler: n = 2^step", ok)
    elif exid == "pingpong":
        ok = all(result["traj"][k] in (9, 6) for k in range(len(result["traj"])))
        check("pingpong: cycle {9, 6}", ok and not result["halted"])
    elif exid == "adder":
        for a, b in product(range(6), range(6)):
            r = run(fracs, 2 ** a * 3 ** b, 1000)
            e, rest = exponent_of(r["final_n"], 3)
            check(f"adder 2^{a}·3^{b} -> 3^{a+b}",
                  r["halted"] and e == a + b and rest == 1,
                  f"got 3^{e} steps={r['steps']}")
    elif exid in ("multiplier", "multiplier_esolangs"):
        for a, b in product([0, 1, 2, 3, 5, 7], repeat=2):
            r = run(fracs, 2 ** a * 3 ** b, 200000)
            e, rest = exponent_of(r["final_n"], 5)
            check(f"multiplier 2^{a}·3^{b} -> 5^{a*b}",
                  r["halted"] and e == a * b and rest == 1,
                  f"got 5^{e} steps={r['steps']}")
    elif exid == "divider":
        for n in range(0, 18):
            for d in range(1, 6):
                q, r = divmod(n, d)
                res = run(fracs, 2 ** n * 3 ** d * 11, 200000)
                eq, restq = exponent_of(res["final_n"], 5)
                er, restr = exponent_of(restq, 7)
                check(f"divider {n}/{d} -> q={q},r={r}",
                      res["halted"] and eq == q and er == r and restr == 1,
                      f"got q={eq},r={er}")
    elif exid == "hamming":
        inputs = list(range(0, 41)) + [1023, 1024, 2047]
        for a in inputs:
            res = run(fracs, 2 ** a, 2000000)
            e, rest = exponent_of(res["final_n"], 13)
            check(f"hamming H({a}) = {a.bit_count() if hasattr(a,'bit_count') else bin(a).count('1')}",
                  res["halted"] and e == bin(a).count("1") and rest == 1,
                  f"got 13^{e}")
    elif exid in ("primegame", "primegame_variant"):
        want_steps = [19, 69, 281, 710] if exid == "primegame" else [19, 69, 280, 707]
        check(f"{exid}: first four event steps {want_steps}",
              [s for (s, _) in monos[:4]] == want_steps,
              f"got {[s for (s, _) in monos[:4]]}")
        check(f"{exid}: first four exponents 2,3,5,7",
              [k for (_, k) in monos[:4]] == [2, 3, 5, 7],
              f"got {[k for (_, k) in monos[:4]]}")
        check(f"{exid}: at least six powers of two within cap", len(monos) >= 6,
              f"got {len(monos)}: {[k for (_, k) in monos[:8]]}")
        check(f"{exid}: every event exponent is prime",
              all(is_prime(k) for (_, k) in monos),
              f"exponents {[k for (_, k) in monos[:8]]}")
    elif exid in ("kilminster", "kilminster9"):
        check("kilminster: first event exponents 2,3,5,7,11",
              [k for (_, k) in monos[:5]] == [2, 3, 5, 7, 11],
              f"got {[k for (_, k) in monos[:6]]}")
        check("kilminster: every event exponent is prime",
              all(is_prime(k) for (_, k) in monos), "")
    elif exid == "pigame":
        # showcase run is from 89: first (and only) power of 2 is 2^3 at step 775
        check("pigame: 2^3 at step 775 from n=89",
              len(monos) >= 1 and monos[0] == (775, 3),
              f"got {monos[:2]}")
    elif exid == "gcd":
        cases = [(48, 18), (18, 48), (7, 13), (12, 12), (1, 1), (97, 89), (270, 192)]
        for a, b in cases:
            r = run(fracs, 11 * 2 ** a * 3 ** b, 100000)
            e, rest = exponent_of(r["final_n"], 5)
            check(f"gcd({a},{b}) = {math.gcd(a,b)}",
                  r["halted"] and e == math.gcd(a, b) and rest == 1,
                  f"got 5^{e} steps={r['steps']}")
    elif exid == "fib":
        def fib(k):
            a, b = 0, 1
            for _ in range(k):
                a, b = b, a + b
            return a
        for k in range(0, 16):
            r = run(fracs, 17 * 2 ** k, 500000)
            e, rest = exponent_of(r["final_n"], 13)
            check(f"fib({k}) = {fib(k)}",
                  r["halted"] and e == fib(k) and rest == 5 ** fib(k + 1),
                  f"got 13^{e} steps={r['steps']}")
    elif exid == "factorial":
        out_p = int(ex["event"]["outputPrime"])
        for k, want in [(0, 1), (1, 1), (2, 2), (3, 6), (5, 120), (6, 720)]:
            r = run(fracs, 17 * 2 ** k, 500000)
            e, rest = exponent_of(r["final_n"], out_p)
            check(f"{k}! = {want}",
                  r["halted"] and e == want and rest == 1,
                  f"got {out_p}^{e} steps={r['steps']}")
    elif exid == "sqrt":
        for v in list(range(0, 41)) + [48, 50, 64, 65, 99, 100]:
            r = run(fracs, 17 * 2 ** v, 200000)
            e, rest = exponent_of(r["final_n"], 13)
            s = math.isqrt(v)
            check(f"isqrt({v}) = {s}",
                  r["halted"] and e == s and rest == 5 ** (2 * s + 1),
                  f"got 13^{e} steps={r['steps']}")
    elif exid == "collatz":
        def steps(n):
            c = 0
            while n != 1:
                n = n // 2 if n % 2 == 0 else 3 * n + 1
                c += 1
            return c
        for v in [1, 2, 3, 6, 7, 16, 27, 97]:
            r = run(fracs, 19 * 2 ** v, 2000000)
            e, rest = exponent_of(r["final_n"], 17)
            check(f"collatz steps({v}) = {steps(v)}",
                  r["halted"] and e == steps(v) and rest == 2,
                  f"got 17^{e} steps={r['steps']}")
    else:
        check(f"{exid}: no validator", False, "unknown example id")


# pigame needs several inputs; handled specially so the showcase stays one run


def validate_all(examples):
    for ex in examples:
        fracs = parse_program(ex["program"])
        n_in = parse_input(ex["input"])
        global CUR_EVENT
        CUR_EVENT = ex["event"]
        max_steps = int(ex["maxSteps"])
        result = run(fracs, n_in, max_steps)
        validate(ex, fracs, result)
        # PIGAME verification scope: the documented d = 0 case (from 89 the
        # first pure power of two is 2^3 at step 775) is asserted by the
        # showcase validator.  NOT verified: Wikipedia's general claim that
        # from 2^d·89 the first pure power of two is 2^pi(d).  A 30
        # million-step search (factor-vector simulation, cross-checked
        # against this dumb simulator for 300k steps) finds NO pure power
        # of two at all for d = 1, so the general claim is left untested
        # rather than asserted.  See the app description.

        # every fixture run doubles as a semantics witness
        FIXTURES[ex["id"]] = dict(
            input=ex["input"], maxSteps=max_steps,
            steps=result["steps"], halted=result["halted"],
            finalN=str(result["final_n"]),
            events=[dict(step=s, kind=k, value=v) for (s, k, v) in result["events"]][:400],
            traj=[str(x) for x in result["traj"]],
            fired=result["fired"],
        )


CUR_EVENT = None
FIXTURES = {}


def main():
    args = sys.argv[1:]
    ex_path = args[args.index("--examples") + 1] if "--examples" in args else "examples.js"
    fx_path = args[args.index("--fixtures") + 1] if "--fixtures" in args else "tests/fixtures.json"
    src = open(ex_path).read()
    prefix = "const FRACTRAN_EXAMPLES = "
    i = src.index(prefix)
    j = src.index(";\n", i)
    examples = json.loads(src[i + len(prefix): j])
    print(f"loaded {len(examples)} examples from {ex_path}", flush=True)
    validate_all(examples)
    with open(fx_path, "w") as fh:
        json.dump(dict(generatedBy="tools/oracle.py", examples=FIXTURES), fh, indent=1)
    print(f"wrote {fx_path}", flush=True)
    if FAILURES:
        print(f"\n{len(FAILURES)} CHECK(S) FAILED", flush=True)
        sys.exit(1)
    print("\nALL CHECKS PASSED", flush=True)


if __name__ == "__main__":
    main()