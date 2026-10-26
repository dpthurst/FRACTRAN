// tests/run_tests.cjs — replay the oracle's fixtures through the actual JS
// engines and demand byte-for-byte agreement.
//
// tools/oracle.py (an independent Python implementation, written straight
// from the FRACTRAN definition) validates every example's published claim
// and records one showcase run per example in tests/fixtures.json.  This
// script runs that same input through BOTH core.js engines — the direct
// BigInt "arithmetic" engine and the counter-machine "factorization"
// engine — and compares final state, step count, event list, trajectory
// head and fired-fraction log against the oracle.
//
// Usage:  node tests/run_tests.cjs
//     (env: EXAMPLES_PATH, FIXTURES_PATH to test other data — used by the
//      deliberate-corruption control described in the README)
//
// Exits non-zero on any mismatch.

"use strict";

const fs = require("fs");
const path = require("path");
const C = require(path.join(__dirname, "..", "core.js"));

const examplesPath = process.env.EXAMPLES_PATH
  || path.join(__dirname, "..", "examples.js");
const fixturesPath = process.env.FIXTURES_PATH
  || path.join(__dirname, "fixtures.json");
const rp = (p) => (path.isAbsolute(p) ? p : path.join(process.cwd(), p));

const EXAMPLES = require(rp(examplesPath));
const fixtures = JSON.parse(fs.readFileSync(rp(fixturesPath), "utf8")).examples;

let passed = 0;
let failed = 0;

function check(label, cond, detail) {
  if (cond) { passed++; }
  else {
    failed++;
    console.log("FAIL " + label + (detail ? "  " + detail : ""));
  }
}

const nOf = (s) => (s.kind === "arith" ? s.n : C.factToN(s.fact));

// Replay exactly the oracle's loop: event check on the current state at the
// top of each iteration (for monomial specs), then one step; a halt always
// appends a halt event whose value is the outputPrime exponent (or null).
function replay(prog, spec, n0, maxSteps, engine) {
  const mk = engine === "arith" ? C.newArithState : C.newFactState;
  const stepFn = engine === "arith" ? C.arithStep : C.factStep;
  let st = mk(n0);
  const events = [];
  const traj = [nOf(st)];
  const fired = [];
  while (st.step < maxSteps) {
    if (spec.kind === "monomial") {
      const ev = C.evalEvent(spec, st);
      if (ev.fire) events.push({ step: st.step, kind: "monomial", value: ev.value });
    }
    if (!st.halted) {
      st = stepFn(prog, st);
      if (!st.halted) {
        traj.push(nOf(st));
        fired.push(st.fired);
        continue;
      }
    }
    events.push({
      step: st.step, kind: "halt",
      value: spec.outputPrime
        ? (st.fact.has(BigInt(spec.outputPrime))
           ? st.fact.get(BigInt(spec.outputPrime)) : null)
        : null,
    });
    break;
  }
  return { st, events, traj: traj.slice(0, 64), fired: fired.slice(0, 64) };
}

function eventsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    const sameVal = x.value === y.value
      || (x.value === undefined && y.value === null)
      || (x.value === null && y.value === undefined);
    if (x.step !== y.step || x.kind !== y.kind || !sameVal) return false;
  }
  return true;
}

// ---------------- per-example replay tests ----------------

for (const ex of EXAMPLES) {
  const fx = fixtures[ex.id];
  if (!fx) { check(`${ex.id}: fixture exists`, false, "missing from fixtures.json"); continue; }

  const prog = C.parseProgram(ex.program);
  check(`${ex.id}: program parses cleanly`, prog.errors.length === 0,
    prog.errors.map((e) => `line ${e.line}: ${e.message}`).join("; "));

  let n0;
  try { n0 = C.parseInput(fx.input); check(`${ex.id}: input parses`, true); }
  catch (e) { check(`${ex.id}: input parses`, false, e.message); continue; }

  for (const engine of ["arith", "fact"]) {
    const tag = `${ex.id}[${engine}]`;
    try {
      const r = replay(prog, ex.event, n0, fx.maxSteps, engine);
      check(`${tag}: steps`, r.st.step === fx.steps, `got ${r.st.step}, want ${fx.steps}`);
      check(`${tag}: halted`, r.st.halted === fx.halted, `got ${r.st.halted}`);
      check(`${tag}: final n`, nOf(r.st).toString() === fx.finalN,
        `got ${nOf(r.st).toString().slice(0, 60)}`);
      check(`${tag}: events`, eventsEqual(r.events, fx.events),
        `got ${r.events.length} events, want ${fx.events.length}`);
      check(`${tag}: trajectory head`,
        r.traj.length === fx.traj.length
        && r.traj.every((x, i) => x.toString() === fx.traj[i]),
        `got ${r.traj.length} states`);
      check(`${tag}: fired log`,
        r.fired.length === fx.fired.length && r.fired.every((x, i) => x === fx.fired[i]),
        `got ${r.fired.length} entries`);
    } catch (e) {
      check(`${tag}: replay ran`, false, e.message);
    }
  }

  // the two engines must agree with each other, not just with the oracle
  try {
    const ra = replay(prog, ex.event, n0, fx.maxSteps, "arith");
    const rf = replay(prog, ex.event, n0, fx.maxSteps, "fact");
    check(`${ex.id}: engines agree`, nOf(ra.st).toString() === nOf(rf.st).toString()
      && ra.st.step === rf.st.step && ra.st.halted === rf.st.halted);
  } catch (e) {
    check(`${ex.id}: engines agree`, false, e.message);
  }
}

// ---------------- parsing edge cases (must be rejected) ----------------

function throws(fn) { try { fn(); return false; } catch (e) { return true; } }

check("parse: flags non-fraction token", C.parseProgram("3/2 garbage/ 7").errors.length === 1);
check("parse: flags zero denominator", C.parseProgram("3/0").errors.length === 1);
check("input: rejects 0", throws(() => C.parseInput("0")));
check("input: rejects non-prime base", throws(() => C.parseInput("4^2")));
check("input: rejects junk", throws(() => C.parseInput("2^3 * hello")));
check("parse: accepts integers as fractions", C.parseProgram("2 3/2").fractions.length === 2);
check("parse: strips # and // comments",
  C.parseProgram("3/2 # one\n2/3 // two").fractions.length === 2);
check("parse: reduces 22/6 to 11/3", (() => {
  const f = C.parseProgram("22/6").fractions[0];
  return f.num === 11n && f.den === 3n;
})());

// ---------------- summary ----------------

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);