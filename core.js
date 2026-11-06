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
//     as the definition reads, and does NOTHING but divide: test n % den,
//     then replace n by n/den·num.  No factorization lives in this engine;
//     event checks are done by repeated division by the event spec's own
//     primes.  (Factorization for display is the UI's business, not the
//     engine's.)
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

  // Factor a BigInt by trial division.  Used for parsing (fraction
  // numerators/denominators), the factor engine's initial state, and the
  // UI's register display — never by the arithmetic engine.  The prime bound
  // exists to fail loudly instead of looping forever on a number with a
  // large prime factor; demo inputs are far below it.
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
  //
  // Event specifications are ALSO program text, as a comment directive (one
  // per program, last wins):
  //
  //   # event: pow(2)                  n is a pure power of 2 (k >= 1)
  //   # event: pow(2*5, min=2)         n = 2^k·5^k for some k >= 2
  //   # event: halt(5)                 at halt, report the exponent of 5
  //   # event: halt()                  just the halt
  //   # event: none                    no interesting events
  //
  // anything after "--" on the directive line is a free-text label shown in
  // the events panel ("# event: pow(2) -- 2^p — p is prime").

  function parseEventDirective(text) {
    // returns { event, error } — event null when no directive present
    let found = null;
    const lines = String(text).split("\n");
    for (let ln = 0; ln < lines.length; ln++) {
      let line = lines[ln];
      const hash = line.indexOf("#");
      const slash2 = line.indexOf("//");
      let cut = -1;
      if (hash >= 0 && (slash2 < 0 || hash < slash2)) cut = hash;
      else if (slash2 >= 0) cut = slash2;
      if (cut < 0) continue;
      const comment = line.slice(cut);
      const m = comment.match(/^#\s*event:\s*(.+)$/i) || comment.match(/^\/\/\s*event:\s*(.+)$/i);
      if (!m) continue;
      let body = m[1].trim();
      let label = "";
      const dash = body.indexOf("--");
      if (dash >= 0) { label = body.slice(dash + 2).trim(); body = body.slice(0, dash).trim(); }

      if (/^none$/i.test(body)) {
        found = { event: null, label };
        continue;
      }
      let mm = body.match(/^halt\s*\(\s*(\d*)\s*\)$/i);
      if (mm) {
        found = { event: mm[1] ? { kind: "halt", outputPrime: mm[1] } : { kind: "halt" }, label };
        continue;
      }
      mm = body.match(/^pow\s*\(\s*([^)]*?)\s*(?:,\s*min\s*=\s*(\d+)\s*)?\)$/i);
      if (mm && mm[1]) {
        const monomial = {};
        let bad = false;
        for (const part of mm[1].split("*")) {
          const pp = part.trim().match(/^(\d+)(?:\^(\d+))?$/);
          if (!pp) { bad = true; break; }
          const base = pp[1], unit = pp[2] ? parseInt(pp[2], 10) : 1;
          if (!isPrime(BigInt(base)) || unit < 1) { bad = true; break; }
          monomial[base] = unit;
        }
        if (!bad) {
          found = { event: { kind: "monomial", monomial, minExp: mm[2] ? parseInt(mm[2], 10) : 1 }, label };
          continue;
        }
      }
      return { event: null, error: { line: ln + 1, token: comment.trim(), message: "bad event directive (try: # event: pow(2), pow(2*5, min=2), halt(5), none)" } };
    }
    return { event: found ? found.event : null, label: found ? found.label : "", error: null };
  }

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
    const ev = parseEventDirective(text);
    if (ev.error) errors.push(ev.error);
    if (ev.event && ev.label) ev.event.label = ev.label;
    return { fractions, errors, event: ev.error ? null : ev.event, eventLabel: ev.label };
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

  // A state: { n: BigInt, step: number, fired: number|null, halted: boolean }.
  // Nothing but n: the engine never factors.
  function newArithState(n) {
    return { kind: "arith", n, step: 0, fired: null, halted: false };
  }

  function arithStep(prog, st) {
    if (st.halted) return st;
    for (let i = 0; i < prog.fractions.length; i++) {
      const f = prog.fractions[i];
      if (st.n % f.den !== 0n) continue;
      return { kind: "arith", n: st.n / f.den * f.num, step: st.step + 1, fired: i, halted: false };
    }
    return { kind: "arith", n: st.n, step: st.step, fired: null, halted: true };
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
  //     outputPrime in the final n (null if the prime is absent or none is
  //     named).
  //
  // Two equivalent evaluators, one per engine.  evalEventN uses NOTHING but
  // division (repeated division by the spec's own primes) — the arithmetic
  // engine never factors.  evalEventFact reads the factor engine's map.

  function evalEventN(spec, n) {
    if (spec.kind === "halt") {
      if (typeof n !== "bigint") throw new Error("evalEventN needs a BigInt n");
      if (!spec.outputPrime) return { fire: true, value: null };
      const p = BigInt(spec.outputPrime);
      if (n % p !== 0n) return { fire: true, value: null };
      let e = 0, m = n;
      while (m % p === 0n) { m /= p; e++; }
      return { fire: true, value: e };
    }
    if (spec.kind === "monomial") {
      let rem = n;
      const ks = [];
      for (const pStr in spec.monomial) {
        const p = BigInt(pStr);
        const unit = spec.monomial[pStr];
        let e = 0;
        while (rem % p === 0n) { rem /= p; e++; }
        if (e % unit !== 0) return { fire: false };
        ks.push(e / unit);
      }
      if (rem !== 1n) return { fire: false };          // some other prime survives
      if (ks.length === 0) return { fire: false };
      const k = ks[0];
      if (ks.some((x) => x !== k)) return { fire: false };
      if (k < (spec.minExp || 1)) return { fire: false };
      return { fire: true, value: k };
    }
    throw new Error("unknown event kind: " + spec.kind);
  }

  function evalEventFact(spec, fact) {
    if (spec.kind === "halt") {
      let value = null;
      if (spec.outputPrime) {
        const e = fact.get(BigInt(spec.outputPrime));
        value = e === undefined ? null : e;   // absent prime -> null (as the oracle)
      }
      return { fire: true, value };
    }
    if (spec.kind === "monomial") {
      let k = null;
      for (const pStr in spec.monomial) {
        const p = BigInt(pStr);
        const unit = spec.monomial[pStr];
        const e = fact.get(p) || 0;
        if (e % unit !== 0) return { fire: false };
        const kk = e / unit;
        if (k === null) k = kk; else if (k !== kk) return { fire: false };
      }
      // every prime present in n must be part of the monomial
      for (const p of fact.keys()) {
        if (!(String(p) in spec.monomial)) return { fire: false };
      }
      if (k === null || k < (spec.minExp || 1)) return { fire: false };
      return { fire: true, value: k };
    }
    throw new Error("unknown event kind: " + spec.kind);
  }

  // Which fraction would fire from this state (index), or null if the
  // program would halt.  Cheap: one divisibility scan, no state change.
  function nextFiredIndex(prog, st) {
    if (!st || st.halted) return null;
    for (let i = 0; i < prog.fractions.length; i++) {
      const f = prog.fractions[i];
      if (st.kind === "arith") {
        if (st.n % f.den === 0n) return i;
      } else {
        let ok = true;
        for (const [p, e] of f.denF) if ((st.fact.get(p) || 0) < e) { ok = false; break; }
        if (ok) return i;
      }
    }
    return null;
  }

  // ---------------- chart geometry ----------------
  //
  // Map the run's (step, log10 n) samples onto a w×h canvas.  Pure: no DOM,
  // no canvas, so it can be unit-tested (the browser cannot be reached from
  // the build environment).  Guarantees, whatever the input:
  //   * every coordinate is finite and inside [pad, w-pad] × [pad, h-pad];
  //   * an empty series yields no columns rather than NaN bounds.
  // Per pixel column it reports the smallest and largest value in that
  // column, so the chart can show a band (the true range of n) instead of a
  // maximum only — a maximum-only line over PRIMEGAME's oscillation runs
  // along the top and makes the dips look like they leave the plot.
  // ---------------- chart series (uniform time buckets) ----------------
  //
  // A series is a grid of fixed-width time buckets, each holding the true
  // [lo, hi] of the value over its steps.  When the run outgrows the grid the
  // bucket width doubles and adjacent buckets merge, so resolution stays
  // UNIFORM in time.  (Merging "the whole array whenever it is full" halves
  // the earliest data again and again — one measured run had its first entry
  // covering 91% of 400k steps, which is what destroys an early sawtooth.)
  function makeSeries(maxBuckets) {
    return { w: 1, buckets: [], maxBuckets: Math.max(16, maxBuckets | 0 || 6000) };
  }

  function seriesAdd(series, step, value) {
    if (!Number.isFinite(step) || !Number.isFinite(value)) return series;
    const b = series.buckets;
    const i = Math.floor(step / series.w);
    if (!Number.isFinite(i) || i < 0 || i > 1e8) return series;
    while (b.length < i) b.push(null);           // gaps, if any
    const cur = b[i];
    if (!cur) b[i] = { s0: i * series.w, s1: (i + 1) * series.w - 1, lo: value, hi: value };
    else {
      if (value < cur.lo) cur.lo = value;
      if (value > cur.hi) cur.hi = value;
    }
    if (b.length >= series.maxBuckets) {
      series.w *= 2;                             // uniform: every bucket doubles
      const nc = [];
      for (let k = 0; k + 1 < b.length; k += 2) {
        const a = b[k], c = b[k + 1];
        nc.push({ s0: k * series.w, s1: (k + 2) * series.w - 1,
                  lo: Math.min(a.lo, c.lo), hi: Math.max(a.hi, c.hi) });
      }
      if (b.length % 2) {
        const a = b[b.length - 1];
        nc.push({ s0: (b.length - 1) * series.w, s1: b.length * series.w - 1,
                  lo: a.lo, hi: a.hi });
      }
      series.buckets = nc;
    }
    return series;
  }

  // A point may be a single sample { step, log10 } or a SPAN
  // { s0, s1, lo, hi } covering a range of steps with the true extremes of
  // log10 n over that range.  Spans are what decimation produces: merging two
  // neighbours halves the horizontal resolution but keeps the vertical extent,
  // so a sawtooth stays visible (as a band) however far the run has gone.
  // (Older points may carry log10Min instead of lo.)
  const pS0 = (p) => (p.s0 !== undefined ? p.s0 : p.step);
  const pS1 = (p) => (p.s1 !== undefined ? p.s1 : p.step);
  const pLo = (p) => (p.lo !== undefined ? p.lo
    : (Number.isFinite(p.log10Min) ? p.log10Min : p.log10));
  const pHi = (p) => (p.hi !== undefined ? p.hi : p.log10);

  function chartGeometry(points, w, h, pad) {
    const width = Math.max(2, Math.floor(w));
    const height = Math.max(2, Math.floor(h));
    // padding must leave a usable box even on a tiny canvas
    pad = Math.max(0, Math.min(pad === undefined ? 4 : pad,
      Math.floor((width - 1) / 2), Math.floor((height - 1) / 2)));
    const innerW = Math.max(1, width - 2 * pad);
    const innerH = Math.max(1, height - 2 * pad);
    const geo = {
      width, height, pad, cols: [], maxStep: 1, lo: 0, hi: 1,
      xOf: (s) => pad + (s / Math.max(1, geo.maxStep)) * innerW,
      yOf: (v) => pad + (1 - (v - geo.lo) / Math.max(1e-9, geo.hi - geo.lo)) * innerH,
    };
    if (!points || !points.length) return geo;

    let lo = Infinity, hi = -Infinity, maxStep = 1;
    let finite = false;
    for (const p of points) {
      const s1 = pS1(p), hV = pHi(p), lV = pLo(p);
      if (!Number.isFinite(s1) || !Number.isFinite(hV) || !Number.isFinite(lV)) continue;
      finite = true;
      if (lV < lo) lo = lV;
      if (hV > hi) hi = hV;
      if (s1 > maxStep) maxStep = s1;
    }
    if (!finite) return geo;
    if (hi - lo < 1) hi = lo + 1;          // a flat series still gets a scale
    geo.lo = lo; geo.hi = hi; geo.maxStep = maxStep;

    const buckets = new Array(width);
    for (const p of points) {
      const s0 = pS0(p), s1 = pS1(p), lV = pLo(p), hV = pHi(p);
      if (!Number.isFinite(s0) || !Number.isFinite(s1)
          || !Number.isFinite(hV) || !Number.isFinite(lV)) continue;
      // a span paints every column it covers, so coarse (old) data keeps its
      // full vertical extent instead of leaving isolated dots
      const c0 = Math.min(width - 1, Math.max(0, Math.floor(geo.xOf(s0))));
      const c1 = Math.min(width - 1, Math.max(0, Math.floor(geo.xOf(s1))));
      for (let c = c0; c <= c1; c++) {
        const b = buckets[c];
        if (!b) buckets[c] = { vMin: lV, vMax: hV };
        else {
          if (hV > b.vMax) b.vMax = hV;
          if (lV < b.vMin) b.vMin = lV;
        }
      }
    }
    for (let c = 0; c < width; c++) {
      const b = buckets[c];
      if (!b) continue;
      geo.cols.push({
        x: c + 0.5,
        yMin: geo.yOf(b.vMin),
        yMax: geo.yOf(b.vMax),
        vMin: b.vMin,
        vMax: b.vMax,
      });
    }
    return geo;
  }

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
  // log10 of n from its factorization, using precomputed log10 of each
  // prime:  log10 n = Σ e_p · log10 p.  The registers engine holds exactly
  // this map, so the chart never has to rebuild the integer n.
  const PRIME_LOG10 = new Map();
  function log10OfPrime(p) {
    const key = String(p);
    let v = PRIME_LOG10.get(key);
    if (v === undefined) { v = Math.log10(Number(p)); PRIME_LOG10.set(key, v); }
    return v;
  }

  function log10OfFact(fact) {
    let s = 0;
    for (const [p, e] of fact) s += Number(e) * log10OfPrime(p);
    return s;
  }

  // log10 of a BigInt, accurate to double precision: scale by the bit length,
  // then take log10 of the top 53 bits.  The bit length comes from the hex
  // digits (4× shorter than binary) and the leading digit's bit count.
  // (bit_length * log10(2) alone is off by up to 0.3.)
  function log10Approx(n) {
    if (n <= 0n) return 0;
    const hex = n.toString(16);
    if (hex.length <= 13) return Math.log10(Number(n));
    const lead = parseInt(hex[0], 16);                 // 1..15
    const bits = (hex.length - 1) * 4 + (32 - Math.clz32(lead));
    if (bits <= 53) return Math.log10(Number(n));
    const top = Number(n >> BigInt(bits - 53));        // the leading 53 bits
    return Math.log10(top) + (bits - 53) * Math.log10(2);
  }

  return {
    gcdBig, isPrime, factorBig,
    parseProgram, parseInput,
    newArithState, arithStep, newFactState, factStep, factToN,
    evalEventN, evalEventFact, nextFiredIndex, chartGeometry, makeSeries, seriesAdd,
    factToString, nToStringTruncated, log10Approx, log10OfFact,
  };

})();

if (typeof module !== "undefined" && module.exports) module.exports = FractranCore;