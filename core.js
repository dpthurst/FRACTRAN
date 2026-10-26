// core.js — the FRACTRAN engine shared by the web app and the node tests.
//
// A FRACTRAN program (J. H. Conway, "FRACTRAN: a simple universal programming
// language for arithmetic", 1987) is a finite ordered list of positive
// fractions f_1, ..., f_k together with a positive integer n.  One step:
//
//     find the smallest i with n·f_i an integer, and replace n by n·f_i;
//     if there is no such i, the program halts.
//
// Two interchangeable engines are provided:
//
//   ArithmeticEngine — works directly on the integer n as a BigInt, exactly
//     as the definition reads: test divisibility, multiply by the fraction.
//     A prime-factorization cache is kept alongside n (updated incrementally
//     from the fraction's factorization, never by refactoring n) so that
//     register views and "interesting event" tests stay cheap.
//
//   FactorEngine — the state IS the factorization (a map prime -> exponent),
//     i.e. the counter-machine view: each exponent is a register.  n is
//     reconstructed only when someone asks to see it.
//
// Both engines are pure: a step takes a state and returns a new state.

"use strict";

const FractranCore = (() => {

  // ---------------- bigint helpers ----------------

  function gcdBig(a, b) {
    while (b !== 0n) { const t = a % b; a = b; b = t; }
    return a < 0n ? -a : a;
  }

  function isPrime(p) {          // trial division; program primes are small
    if (p < 2n) return false;
    if (p === 2n) return true;
    if (p % 2n === 0n) return false;
    for (let d = 3n; d * d <= p; d += 2n) if (p % d === 0n) return false;
    return true;
  }

  // Factor a BigInt by trial division.  Only used on inputs and on fraction
  // numerators/denominators, which are small; refuse to churn on something
  // with a large prime factor.
  function factorBig(n, maxPrime = 1000000) {
    if (n <= 0n) throw new Error("cannot factor " + n);
    const f = new Map();
    for (let p = 2n; p <= BigInt(maxPrime); p += (p === 2n ? 1n : 2n)) {
      if (p * p > n) break;
      if (n % p === 0n) {
        let e = 0;
        while (n % p === 0n) { n /= p; e++; }
        f.set(p, e);
      }
    }
    if (n > 1n) {
      if (n > BigInt(maxPrime)) {
        throw new Error("input has a prime factor above " + maxPrime
                        + " (or is itself such a prime); too large to factor");
      }
      f.set(n, (f.get(n) || 0) + 1);
    }
    return f;
  }

  // ---------------- program parsing ----------------
  //
  // Accepted program text: fractions "a/b" or integers "a", separated by
  // commas and/or newlines.  "#" or "//" start a comment running to the end
  // of the line.  Fractions are reduced to lowest terms.

  function parseProgram(text) {
    const fractions = [];
    const errors = [];
    const lines = String(text).split("\n");
    for (let ln = 0; ln < lines.length; ln++) {
      let line = lines[ln];
      const hash = line.indexOf("#");
      if (hash >= 0) line = line.slice(0, hash);
      const slash2 = line.indexOf("//");
      if (slash2 >= 0) line = line.slice(0, slash2);
      for (const tok of line.split(/[\s,]+/)) {
        if (!tok) continue;
        const m = tok.match(/^(\d+)\/(\d+)$/) || (tok.match(/^\d+$/) && [null, tok, null]);
        if (!m) { errors.push({ line: ln + 1, token: tok, message: "not a fraction" }); continue; }
        let num = BigInt(m[1]);
        const den = m[2] === null || m[2] === undefined ? 1n : BigInt(m[2]);
        if (den === 0n) { errors.push({ line: ln + 1, token: tok, message: "zero denominator" }); continue; }
        const g = gcdBig(num, den);
        num /= g;
        const d2 = den / g;
        fractions.push({
          num, den: d2,
          numF: factorBig(num), denF: d2 === 1n ? new Map() : factorBig(d2),
          raw: tok, line: ln + 1,
        });
      }
    }
    return { fractions, errors };
  }

  // Accepted input text: a decimal integer, or a product of prime powers
  // such as "2^3 * 5" (spaces around "*" optional).  Every base must be prime.
  function parseInput(text) {
    const t = String(text).trim();
    if (/^\d+$/.test(t)) {
      const n = BigInt(t);
      if (n < 1n) throw new Error("input must be a positive integer");
      return n;
    }
    let n = 1n;
    for (const raw of t.split("*")) {
      const part = raw.trim();
      const m = part.match(/^(\d+)(?:\^(\d+))?$/);
      if (!m) throw new Error("bad input factor: " + JSON.stringify(part));
      const base = BigInt(m[1]);
      const exp = m[2] ? parseInt(m[2], 10) : 1;
      if (!isPrime(base)) throw new Error("input base " + base + " is not prime");
      n *= base ** BigInt(exp);
    }
    return n;
  }

  // ---------------- engine 1: direct arithmetic on n ----------------

  // A state: { n: BigInt, fact: Map, step: number, fired: number|null,
  //            halted: boolean }.  fact is the factorization of n, kept in
  // step with n by incremental updates (never by refactoring n).
  function newArithState(n) {
    return { kind: "arith", n, fact: factorBig(n), step: 0, fired: null, halted: false };
  }

  function arithStep(prog, st) {
    if (st.halted) return st;
    for (let i = 0; i < prog.fractions.length; i++) {
      const f = prog.fractions[i];
      if (st.n % f.den !== 0n) continue;
      const n2 = st.n / f.den * f.num;
      const fact = new Map(st.fact);
      for (const [p, e] of f.denF) {
        const e2 = (fact.get(p) || 0) - e;
        if (e2 > 0) fact.set(p, e2); else fact.delete(p);
      }
      for (const [p, e] of f.numF) {
        const e2 = (fact.get(p) || 0) + e;
        if (e2 > 0) fact.set(p, e2); else fact.delete(p);
      }
      return { kind: "arith", n: n2, fact, step: st.step + 1, fired: i, halted: false };
    }
    return { kind: "arith", n: st.n, fact: st.fact, step: st.step, fired: null, halted: true };
  }

  // ---------------- engine 2: the factorization (counter machine) ------

  function newFactState(n) {
    return { kind: "fact", fact: factorBig(n), step: 0, fired: null, halted: false };
  }

  function factStep(prog, st) {
    if (st.halted) return st;
    for (let i = 0; i < prog.fractions.length; i++) {
      const f = prog.fractions[i];
      let ok = true;
      for (const [p, e] of f.denF) if ((st.fact.get(p) || 0) < e) { ok = false; break; }
      if (!ok) continue;
      const fact = new Map(st.fact);
      for (const [p, e] of f.denF) {
        const e2 = fact.get(p) - e;
        if (e2 > 0) fact.set(p, e2); else fact.delete(p);
      }
      for (const [p, e] of f.numF) {
        const e2 = (fact.get(p) || 0) + e;
        if (e2 > 0) fact.set(p, e2); else fact.delete(p);
      }
      return { kind: "fact", fact, n: null, step: st.step + 1, fired: i, halted: false };
    }
    return { kind: "fact", fact: st.fact, n: null, step: st.step, fired: null, halted: true };
  }

  function factToN(fact) {
    let n = 1n;
    for (const [p, e] of fact) n *= p ** BigInt(e);
    return n;
  }

  // ---------------- interesting events ----------------
  //
  // An event spec says when a state of the run is worth recording:
  //   { kind: "monomial", monomial: {"2":1, "5":1}, minExp: 2, label: "..." }
  //     fires when n is a pure power of the monomial, e.g. 2^k·5^k with
  //     k >= minExp; the event value is k.
  //   { kind: "halt", label: "...", outputPrime: "5" }
  //     fires when the program halts; the event value is the exponent of
  //     outputPrime in the final n (or null if no prime is named).

  function evalEvent(spec, st) {
    if (spec.kind === "halt") {
      if (!st.halted) return { fire: false };
      const value = spec.outputPrime ? (st.fact.get(BigInt(spec.outputPrime)) || 0) : null;
      return { fire: true, value };
    }
    if (spec.kind === "monomial") {
      if (st.halted) return { fire: false };
      let k = null;
      for (const pStr in spec.monomial) {
        const p = BigInt(pStr);
        const unit = spec.monomial[pStr];
        const e = st.fact.get(p) || 0;
        if (e % unit !== 0) return { fire: false };
        const kk = e / unit;
        if (k === null) k = kk; else if (k !== kk) return { fire: false };
      }
      // every prime present in n must be part of the monomial
      for (const p of st.fact.keys()) {
        if (!(String(p) in spec.monomial)) return { fire: false };
      }
      if (k === null || k < (spec.minExp || 1)) return { fire: false };
      return { fire: true, value: k };
    }
    throw new Error("unknown event kind: " + spec.kind);
  }

  // ---------------- display helpers ----------------

  function factToString(fact, legend) {
    const parts = [];
    for (const [p, e] of fact) {
      const name = legend && legend[String(p)];
      parts.push(name ? `${name}=${e}` : (e === 1 ? `${p}` : `${p}^${e}`));
    }
    return parts.length ? parts.join(" · ") : "1";
  }

  // { head, tail, digits } with the middle elided for very long numbers.
  function nToStringTruncated(n, maxLen = 340) {
    const s = n.toString();
    if (s.length <= maxLen) return { head: s, tail: "", digits: s.length };
    const h = Math.ceil(maxLen * 0.65);
    const t = Math.floor(maxLen * 0.2);
    return { head: s.slice(0, h), tail: s.slice(s.length - t), digits: s.length };
  }

  // log10 of a BigInt, good to about half a digit (via the bit length).
  // Cheap enough to sample per step for the chart.
  function log10Approx(n) {
    if (n <= 0n) return 0;
    return n.toString(2).length * Math.log10(2);
  }

  return {
    gcdBig, isPrime, factorBig,
    parseProgram, parseInput,
    newArithState, arithStep, newFactState, factStep, factToN,
    evalEvent, factToString, nToStringTruncated, log10Approx,
  };

})();

if (typeof module !== "undefined" && module.exports) module.exports = FractranCore;