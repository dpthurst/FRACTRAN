// app.js — UI for the FRACTRAN playground. The engines live in core.js.
//
// Conventions kept here on purpose:
//   * render() is the ONE redraw entry point: any state change calls it,
//     and it alone touches the DOM and the chart (one redraw path, no
//     sibling-update bugs).
//   * Engine states are immutable snapshots; Back is just history.pop().

"use strict";

(() => {
  const C = FractranCore;        // top-level const from core.js (classic script)
  const EXAMPLES = FRACTRAN_EXAMPLES;

  const HISTORY_CAP = 100000;     // states kept for "back"
  const STEP_GUARD = 5000000;     // hard stop, so a stray input cannot hang the tab
  const LOG_KEEP = 200;           // trace rows kept
  const LOG_TICK = 40;            // max trace rows appended per scheduler tick

  const $ = (id) => document.getElementById(id);

  // ---------------- run state ----------------

  let prog = null;         // C.parseProgram() result for the editor text
  let example = null;      // current example metadata (null = custom program)
  let st = null;           // current engine state
  let engine = "arith";    // "arith" (direct BigInt n) | "fact" (factorization)
  let history = [];        // snapshots for Back
  let chart = [];          // {step, log10} per step (sampled if huge)
  let events = [];         // interesting events fired so far
  let trace = [];          // recent steps for the trace table
  // Display-only factorization for the arithmetic engine (the engine itself
  // never factors).  Maintained incrementally from the fractions that fired
  // since the last render; rebuilt on reset, undone on Back.
  let displayFact = null;
  let displayFactSkipped = false;
  let firedQueue = [];     // fraction indices fired since the last render
  const VIEW_QUEUE_CAP = 200000;
  let regMode = "chips";   // "chips" (only nonzero) | "bars" (fixed set, never vanishes)
  let fracStripKey = "";   // cache key: rebuild chips only when the program changes
  let fracChips = [];
  let running = false;
  let timer = null;
  let stopAtNextEvent = false;
  let haltedAt = null;     // {step} when the run halted

  // ---------------- engine plumbing ----------------

  function stepFn() { return engine === "arith" ? C.arithStep : C.factStep; }
  function newState(n) { return engine === "arith" ? C.newArithState(n) : C.newFactState(n); }

  function nOf(state) { return state.kind === "arith" ? state.n : C.factToN(state.fact); }

  // The factorization the UI shows: the factor engine has it by nature; the
  // arithmetic engine gets a display cache (never part of engine state).
  function viewFact() {
    return engine === "fact" ? (st ? st.fact : null) : displayFact;
  }

  function tryFactor(n) {
    try { return C.factorBig(n); } catch (e) { return null; }
  }

  // ---------------- event specification ----------------

  function eventSpec() { return example ? example.event : null; }

  // ---------------- parsing / (re)start ----------------

  function reparse() {
    prog = C.parseProgram($("program").value);
    const errs = prog.errors;
    $("program-errors").textContent = errs.length
      ? errs.map((e) => `line ${e.line}: ${e.token} — ${e.message}`).join("\n")
      : "";
    $("progMeta").textContent = `${prog.fractions.length} fractions`;
    return errs.length === 0;
  }

  function reset() {
    if (timer) { clearTimeout(timer); timer = null; }
    running = false; stopAtNextEvent = false; haltedAt = null;
    if (!reparse()) { st = null; render(); return; }
    let n;
    try {
      n = C.parseInput($("inputN").value);
      $("inputN").style.borderColor = "";
    } catch (e) {
      $("inputN").style.borderColor = "var(--bad)";
      $("program-errors").textContent = "input: " + e.message;
      st = null; render(); return;
    }
    st = newState(n);
    history = []; chart = []; events = []; trace = [];
    displayFact = engine === "arith" ? tryFactor(n) : null;
    displayFactSkipped = false;
    firedQueue = [];
    saveLocal();
    render();
  }

  // ---------------- stepping ----------------

  function recordEvent(step, ev, spec) {
    events.push({
      step,
      kind: spec.kind,
      value: ev.value,
      label: spec.label || spec.kind,
    });
  }

  // Event check for the current state, per engine.  Callers only consult
  // monomial specs pre-step and halt specs at a halt (the run-loop points).
  function evalEventHere(spec) {
    return engine === "arith" ? C.evalEventN(spec, st.n) : C.evalEventFact(spec, st.fact);
  }

  function applyFiredToDisplayFact(i, undo) {
    if (!displayFact) return;
    const f = prog.fractions[i];
    const sub = undo ? f.numF : f.denF;
    const add = undo ? f.denF : f.numF;
    for (const [p, e] of sub) {
      const e2 = (displayFact.get(p) || 0) - e;
      if (e2 > 0) displayFact.set(p, e2); else displayFact.delete(p);
    }
    for (const [p, e] of add) {
      const e2 = (displayFact.get(p) || 0) + e;
      if (e2 > 0) displayFact.set(p, e2); else displayFact.delete(p);
    }
  }

  function snapshot() {
    return {
      n: nOf(st), fact: st.kind === "fact" ? st.fact : null,
      step: st.step, fired: st.fired,
      chartLen: chart.length, eventsLen: events.length, traceLen: trace.length,
    };
  }

  function stepOnce() {
    if (!st || st.halted) return false;
    const spec = eventSpec();
    if (spec && spec.kind === "monomial") {
      const ev = evalEventHere(spec);
      if (ev.fire) recordEvent(st.step, ev, spec);
    }
    if (chart.length === 0 || chart[chart.length - 1].step !== st.step) {
      chart.push({ step: st.step, log10: C.log10Approx(nOf(st)) });
    }
    if (history.length < HISTORY_CAP) history.push(snapshot());
    st = stepFn()(prog, st);
    if (chart.length === 0 || chart[chart.length - 1].step !== st.step) {
      chart.push({ step: st.step, log10: C.log10Approx(nOf(st)) });
      if (chart.length > 4000) {           // decimate: keep the envelope shape
        const nc = [];
        for (let i = 0; i + 1 < chart.length; i += 2) {
          nc.push({ step: chart[i].step,
                    log10: Math.max(chart[i].log10, chart[i + 1].log10) });
        }
        chart = nc;
      }
    }
    if (engine === "arith" && st.fired !== null && st.fired !== undefined) {
      if (firedQueue.length >= VIEW_QUEUE_CAP) {
        displayFact = null; displayFactSkipped = true; firedQueue = [];
      } else firedQueue.push(st.fired);
    }
    if (st.halted) {
      // The halt was discovered on a transition that changed nothing: the
      // pre-halt snapshot is the same state as the halted one. Drop it so
      // "back" from a halt goes to the previous real state, not to an
      // identical-looking un-halted copy.
      if (history.length && history[history.length - 1].step === st.step) history.pop();
      if (spec && spec.kind === "monomial") {
        const ev = evalEventHere(spec);
        if (ev.fire) recordEvent(st.step, ev, spec);
      }
      if (spec) {
        events.push({
          step: st.step, kind: "halt",
          value: spec.outputPrime ? evalEventHere(spec).value : null,
          label: spec.label || "halt",
        });
      }
      haltedAt = st.step;
    }
    return true;
  }

  // ---------------- the run loop ----------------

  const SPEEDS = {
    "10":   { delay: 100, perTick: 1 },
    "100":  { delay: 10,  perTick: 1 },
    "1000": { delay: 10,  perTick: 100 },
    "max":  { delay: 0,   perTick: Infinity },   // time-budgeted below
  };

  function tick() {
    timer = null;
    const speed = SPEEDS[$("speed").value] || SPEEDS["max"];
    const t0 = performance.now();
    let appended = 0;
    const logEvery = Math.max(1, Math.ceil((speed.perTick === Infinity ? 20000 : speed.perTick) / LOG_TICK));

    while (true) {
      if (!st || st.halted || st.step >= STEP_GUARD) break;
      const firedBefore = events.length;
      stepOnce();
      appended++;
      if (appended % logEvery === 0) pushTrace();
      if (events.length > firedBefore && stopAtNextEvent) break;
      if (speed.perTick !== Infinity) {
        if (appended >= speed.perTick) break;
      } else if (performance.now() - t0 > 12) {
        break;                                   // keep the UI at ~60 fps
      }
    }
    pushTrace();
    render();

    const stopped = !st || st.halted || st.step >= STEP_GUARD
      || (stopAtNextEvent && events.length > 0 && appended > 0 && events.length > (eventsAtLoopStart || 0));
    if (!stopped && running) {
      timer = setTimeout(tick, speed.delay);
    } else {
      running = false;
      stopAtNextEvent = false;
      render();
    }
  }
  let eventsAtLoopStart = 0;

  function startRun(untilEvent) {
    if (!st || st.halted) return;
    eventsAtLoopStart = events.length;
    stopAtNextEvent = !!untilEvent;
    running = true;
    if (!timer) tick();
  }

  function stopRun() {
    running = false; stopAtNextEvent = false;
    if (timer) { clearTimeout(timer); timer = null; }
    render();
  }

  // ---------------- trace ring ----------------

  function pushTrace() {
    if (!st) return;
    const f = st.fired;
    trace.push({
      step: st.step,
      fired: f === null || f === undefined ? (st.halted ? "—" : "") : prog.fractions[f].raw,
      n: C.factToString(viewFact() || new Map(), null),
    });
    if (trace.length > LOG_KEEP) trace.splice(0, trace.length - LOG_KEEP);
  }

  // ---------------- rendering ----------------

  function render() {
    drainFiredQueue();
    renderLibrary();
    renderFracStrip();
    renderState();
    renderEvents();
    renderTrace();
    drawChart();
    renderButtons();
  }

  // The program window's graphical companion: one chip per fraction, in
  // order.  The amber chip is the fraction that produced the current state;
  // the outlined chip is the one that will fire next.  Built once per program
  // (chips are cheap but this runs on every frame at max speed), then only
  // the two highlighted classes change.
  function renderFracStrip() {
    const strip = $("fracstrip");
    if (!prog || !prog.fractions.length) { strip.innerHTML = ""; fracStripKey = ""; fracChips = []; return; }
    const key = prog.fractions.map((f) => f.raw).join(",");
    if (key !== fracStripKey) {
      fracStripKey = key;
      strip.innerHTML = "";            // rebuild: chips must not accumulate
      fracChips = prog.fractions.map((f, i) => {
        const el = document.createElement("span");
        el.className = "frac";
        el.dataset.index = String(i);
        const ix = document.createElement("span");
        ix.className = "ix";
        ix.textContent = String(i + 1);
        el.appendChild(ix);
        el.appendChild(document.createTextNode(f.raw));
        el.title = `fraction ${i + 1} of ${prog.fractions.length}: ${f.raw}`
          + (f.line ? ` (editor line ${f.line})` : "");
        strip.appendChild(el);
        return el;
      });
    }
    const fired = st && !st.halted && st.fired !== null && st.fired !== undefined ? st.fired : -1;
    const next = st && !st.halted ? C.nextFiredIndex(prog, st) : null;
    fracChips.forEach((el, i) => {
      el.classList.toggle("firing", i === fired);
      el.classList.toggle("next", i === next && i !== fired);
    });
    if (fired >= 0 && fracChips[fired] && fracChips[fired].scrollIntoView) {
      try { fracChips[fired].scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) { /* jsdom */ }
    }
  }

  // Apply the fractions that fired since the last render to the display
  // factorization (arithmetic engine only — the engine itself never factors).
  function drainFiredQueue() {
    if (engine !== "arith" || !firedQueue.length) return;
    if (displayFact) for (const i of firedQueue) applyFiredToDisplayFact(i, false);
    firedQueue = [];
  }

  function renderLibrary() {
    const nav = $("library");
    if (nav.dataset.built === "1") { markActive(); return; }
    nav.dataset.built = "1";
    const groups = new Map();
    for (const ex of EXAMPLES) {
      if (!groups.has(ex.group)) groups.set(ex.group, []);
      groups.get(ex.group).push(ex);
    }
    for (const [g, exs] of groups) {
      const div = document.createElement("div");
      div.className = "group";
      const h = document.createElement("h3");
      h.textContent = g;
      div.appendChild(h);
      for (const ex of exs) {
        const b = document.createElement("button");
        b.dataset.id = ex.id;
        const nm = document.createElement("span");
        nm.textContent = ex.name;
        const ds = document.createElement("span");
        ds.className = "desc";
        ds.textContent = ex.input;
        b.appendChild(nm); b.appendChild(ds);
        b.addEventListener("click", () => loadExample(ex));
        div.appendChild(b);
      }
      nav.appendChild(div);
    }
    markActive();
  }

  function markActive() {
    for (const b of $("library").querySelectorAll("button")) {
      b.classList.toggle("active", !!example && b.dataset.id === example.id);
    }
  }

  function renderState() {
    const badge = $("haltBadge");
    if (!st) {
      badge.classList.add("hidden");
      $("nValue").textContent = "";
      $("registers").textContent = "";
      $("fired").textContent = "";
      $("stepCounter").textContent = "step –";
      return;
    }
    if (st.halted) {
      badge.textContent = "halted after " + st.step + (st.step === 1 ? " step" : " steps");
      badge.classList.remove("hidden"); badge.classList.remove("running");
    } else if (running) {
      badge.textContent = "running"; badge.classList.remove("hidden"); badge.classList.add("running");
    } else {
      badge.classList.add("hidden");
    }
    $("stepCounter").textContent = "step " + st.step.toLocaleString("en");

    if (st.fired !== null && st.fired !== undefined) {
      const f = prog.fractions[st.fired];
      $("fired").textContent = `fired [${st.fired + 1}]  ${f.raw}`;
    } else if (st.halted) {
      $("fired").innerHTML = '<span class="mute">no fraction divides n — halt</span>';
    } else {
      $("fired").textContent = "";
    }

    const big = nOf(st);
    const t = C.nToStringTruncated(big);
    let html = `<span class="copy" id="copyN" title="copy the full value">copy ${t.digits.toLocaleString("en")} digits</span>`;
    if (t.tail) {
      html += `${t.head}<span class="elide"> … [${t.digits.toLocaleString("en")} digits] … </span>${t.tail}`;
    } else {
      html += t.head;
    }
    $("nValue").innerHTML = html;
    $("nValue").title = big.toString().slice(0, 2000);
    const copyEl = $("copyN");
    if (copyEl) copyEl.addEventListener("click", copyN);

    renderRegisters();
  }

  // The registers a program can ever touch: primes in its fractions, the
  // example's named registers, and anything currently nonzero.  Fixed for a
  // given program — this is what makes the "bars" view stable while
  // PRIMEGAME's exponents come and go.
  function registerPrimeSet() {
    const set = new Set();
    for (const f of (prog ? prog.fractions : [])) {
      for (const p of f.numF.keys()) set.add(p);
      for (const p of f.denF.keys()) set.add(p);
    }
    if (example && example.registers) for (const k in example.registers) set.add(BigInt(k));
    const fact = viewFact();
    if (fact) for (const p of fact.keys()) set.add(p);
    return [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  function renderRegisters() {
    const box = $("registers");
    const legend = example ? example.registers || {} : {};
    const fact = viewFact();
    $("regNote").textContent = example && Object.keys(legend).length
      ? "(named = the example's register map)" : "(exponents of the primes in n)";
    for (const b of $("regMode").querySelectorAll("button")) {
      b.classList.toggle("on", b.dataset.mode === regMode);
    }
    if (!fact) {
      box.innerHTML = '<span class="reg">register view skipped — n grew too large to factor for display'
        + ' (the arithmetic engine itself never factors; the registers engine keeps it exactly)</span>';
      return;
    }
    if (regMode === "bars") { renderRegisterBars(box, fact, legend); return; }

    const entries = [...fact.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    if (!entries.length) { box.innerHTML = '<span class="reg">n = 1 (all registers zero)</span>'; return; }
    const named = entries.filter(([p]) => legend[String(p)]);
    const other = entries.filter(([p]) => !legend[String(p)]);
    let html = "";
    for (const [p, e] of named) {
      html += `<span class="reg named"><b>${escapeHtml(legend[String(p)])}</b> = ${e}</span>`;
    }
    for (const [p, e] of other.slice(0, 40)) {
      html += `<span class="reg"><b>${p}</b>^${e}</span>`;
    }
    if (other.length > 40) html += `<span class="reg">… ${other.length - 40} more primes</span>`;
    box.innerHTML = html;
  }

  // Graphical registers: a row per register in the program's fixed prime set,
  // a bar for its value, and the value itself.  A zero register is a visible
  // empty row, not a disappearance.  Rows the last fired fraction touched are
  // underlined/brighter.
  function renderRegisterBars(box, fact, legend) {
    const primes = registerPrimeSet();
    if (!primes.length) { box.innerHTML = '<span class="reg">no registers — the program has no prime factors</span>'; return; }
    let maxExp = 1;
    for (const p of primes) { const e = fact.get(p) || 0; if (e > maxExp) maxExp = e; }
    const fired = st && st.fired !== null && st.fired !== undefined && !st.halted
      ? prog.fractions[st.fired] : null;
    const touched = new Set();
    if (fired) {
      for (const p of fired.numF.keys()) touched.add(String(p));
      for (const p of fired.denF.keys()) touched.add(String(p));
    }
    let html = "";
    for (const p of primes) {
      const e = fact.get(p) || 0;
      const name = legend[String(p)];
      const label = name ? escapeHtml(name) : `${p}`;
      const pct = Math.max(e > 0 ? 2 : 0, Math.round((e / maxExp) * 100));
      html += `<div class="barrow${name ? " named" : ""}${touched.has(String(p)) ? " touched" : ""}"`
        + ` data-prime="${p}" title="register ${p}${name ? " (" + escapeHtml(name) + ")" : ""} = ${e}">`
        + `<span class="lbl">${label}</span>`
        + `<span class="track"><span class="fill" style="width:${pct}%"></span></span>`
        + `<span class="val${e === 0 ? " zero" : ""}">${e}</span></div>`;
    }
    html += `<div class="barscale">${primes.length} registers · bar full = ${maxExp}`
      + ` · underlined = touched by the last fired fraction</div>`;
    box.innerHTML = html;
  }

  function renderEvents() {
    const box = $("events");
    if (!events.length) {
      box.innerHTML = '<span class="none">none yet — events are marked per example '
        + '(pure powers of two, halts with a decoded output, …)</span>';
      return;
    }
    const rows = events.slice(-60).reverse().map((e) => {
      const val = e.value === null || e.value === undefined ? "" : ` = <b>${e.value}</b>`;
      return `<div class="ev">step ${e.step.toLocaleString("en")}${val} <span class="lbl">— ${escapeHtml(e.label)}</span></div>`;
    });
    box.innerHTML = rows.join("");
  }

  function renderTrace() {
    const tbl = $("log");
    $("logNote").textContent = `(last ${Math.min(trace.length, LOG_KEEP)} states${history.length >= HISTORY_CAP ? " — history capped, 'back' limited" : ""})`;
    let html = "<tr><th>step</th><th>fired</th><th>n (factorized)</th></tr>";
    const rows = trace.slice(-40).reverse();
    for (const r of rows) {
      html += `<tr><td>${r.step.toLocaleString("en")}</td>`
        + `<td class="fired">${escapeHtml(r.fired)}</td>`
        + `<td>${escapeHtml(r.n)}</td></tr>`;
    }
    tbl.innerHTML = html;
  }

  // -------- chart: one entry point, called only from render() --------

  function drawChart() {
    const cv = $("chart");
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * dpr || cv.height !== h * dpr) {
      cv.width = w * dpr; cv.height = h * dpr;
    }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!chart.length || w < 2 || h < 2) {
      ctx.fillStyle = "#8a93a3";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText("press run — log₁₀ n over steps; the band spans the values in each pixel column",
                   10, 20);
      $("chartNote").textContent = "";
      return;
    }

    // Pure, tested geometry (core.js): every coordinate comes back finite and
    // inside the plot box, whatever the data.
    const geo = C.chartGeometry(chart, w, h, 6);
    const clampY = (y) => Math.max(geo.pad, Math.min(h - geo.pad, y));

    // y-axis guides carrying the actual values — the vertical position alone
    // must not be mistaken for "zero" or for values below the plot
    ctx.strokeStyle = "#2c3440";
    ctx.fillStyle = "#8a93a3";
    ctx.font = "10px ui-monospace, monospace";
    ctx.lineWidth = 1;
    const mid = (geo.hi + geo.lo) / 2;
    for (const v of [geo.hi, mid, geo.lo]) {
      const y = Math.round(clampY(geo.yOf(v))) + 0.5;
      ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(w - 4, y); ctx.stroke();
      ctx.fillText(v.toFixed(1), 2, Math.min(h - 2, Math.max(9, y + 3)));
    }

    // the band: the full range of n within each pixel column
    ctx.strokeStyle = "rgba(111,195,255,0.35)";
    ctx.beginPath();
    for (const c of geo.cols) {
      ctx.moveTo(c.x, clampY(c.yMin));
      ctx.lineTo(c.x, clampY(c.yMax));
    }
    ctx.stroke();

    // the upper envelope
    ctx.strokeStyle = "#6fc3ff";
    ctx.beginPath();
    let started = false;
    for (const c of geo.cols) {
      const y = clampY(c.yMax);
      if (!started) { ctx.moveTo(c.x, y); started = true; } else ctx.lineTo(c.x, y);
    }
    ctx.stroke();

    // event markers: nearest column, dot on that column's envelope
    ctx.fillStyle = "#ffb347";
    for (const e of events) {
      if (!geo.cols.length) continue;
      const xe = geo.xOf(e.step);
      let best = geo.cols[0];
      for (const c of geo.cols) if (Math.abs(c.x - xe) < Math.abs(best.x - xe)) best = c;
      const x = Math.max(geo.pad, Math.min(w - geo.pad, best.x));
      ctx.beginPath(); ctx.arc(x, clampY(best.yMax), 3, 0, Math.PI * 2); ctx.fill();
    }

    const cur = chart[chart.length - 1].log10;
    $("chartNote").textContent = `log₁₀ n = ${cur.toFixed(1)} now · `
      + `axis ${geo.lo.toFixed(1)} … ${geo.hi.toFixed(1)} · `
      + `steps 0 … ${geo.maxStep.toLocaleString("en")}`
      + (st && st.step >= STEP_GUARD ? " — step guard reached" : "");
  }

  function renderButtons() {
    // Step/Next/Back are unavailable mid-run, but Run must stay live: it is
    // the pause control, and a disabled pause button leaves a forever-running
    // program (PRIMEGAME) with no way to stop.
    const canRun = !!st && !st.halted && prog && prog.errors.length === 0;
    $("btnRun").disabled = !canRun;
    $("btnStep").disabled = !canRun || running;
    $("btnNext").disabled = !canRun || running || !eventSpec();
    $("btnBack").disabled = running || !history.length;
    $("btnRun").textContent = running ? "❚❚ pause" : "▶ run";
    $("btnRun").classList.toggle("primary", canRun);
  }

  // ---------------- actions ----------------

  function doStep() { stopRun(); stepOnce(); pushTrace(); render(); }

  function doBack() {
    stopRun();
    if (!history.length) return;
    const undoneFired = st ? st.fired : null;
    const h = history.pop();
    chart.length = Math.min(h.chartLen, chart.length);
    events.length = h.eventsLen;
    trace.length = h.traceLen;
    haltedAt = null;
    if (engine === "arith") {
      st = { kind: "arith", n: h.n, step: h.step, fired: h.fired, halted: false };
      if (displayFact && undoneFired !== null && undoneFired !== undefined) {
        applyFiredToDisplayFact(undoneFired, true);   // exact inverse: one step
      }
    } else {
      st = { kind: "fact", fact: h.fact, n: null, step: h.step, fired: h.fired, halted: false };
    }
    render();
  }

  function copyN() {
    if (!st) return;
    const s = nOf(st).toString();
    const done = () => { $("copyN").textContent = "copied ✓"; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(done, () => fallbackCopy(s, done));
    } else fallbackCopy(s, done);
  }
  function fallbackCopy(s, done) {
    const ta = document.createElement("textarea");
    ta.value = s; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { /* not fatal */ }
    document.body.removeChild(ta);
  }

  function loadExample(ex) {
    example = ex;
    $("program").value = ex.program;
    $("inputN").value = ex.input;
    location.hash = "example=" + ex.id;
    saveLocal();
    reset();
  }

  function saveLocal() {
    try {
      localStorage.setItem("fractran.current", JSON.stringify({
        id: example ? example.id : null,
        program: $("program").value,
        input: $("inputN").value,
      }));
    } catch (e) { /* private mode etc. */ }
  }

  function restoreLocal() {
    try {
      const raw = localStorage.getItem("fractran.current");
      if (!raw) return false;
      const cur = JSON.parse(raw);
      if (cur && typeof cur.program === "string") {
        example = cur.id ? EXAMPLES.find((e) => e.id === cur.id) || null : null;
        $("program").value = cur.program;
        $("inputN").value = cur.input || "1";
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---------------- wiring ----------------

  $("btnStep").addEventListener("click", doStep);
  $("btnRun").addEventListener("click", () => (running ? stopRun() : startRun(false)));
  $("btnNext").addEventListener("click", () => startRun(true));
  $("btnBack").addEventListener("click", doBack);
  $("btnReset").addEventListener("click", reset);
  $("btnApply").addEventListener("click", () => { example = null; markActive(); reset(); });
  $("speed").addEventListener("change", () => { if (running) { stopRun(); startRun(stopAtNextEvent); } });

  for (const b of $("engineToggle").querySelectorAll("button")) {
    b.addEventListener("click", () => {
      engine = b.dataset.engine;
      for (const x of $("engineToggle").querySelectorAll("button")) {
        x.classList.toggle("on", x === b);
      }
      reset();               // engines use different state kinds: restart cleanly
    });
  }

  // register display style: chips (only nonzero) or bars (fixed set)
  for (const b of $("regMode").querySelectorAll("button")) {
    b.addEventListener("click", () => {
      regMode = b.dataset.mode;
      try { localStorage.setItem("fractran.regMode", regMode); } catch (e) { /* private mode */ }
      render();
    });
  }

  document.addEventListener("keydown", (ev) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
    if (ev.code === "Space") { ev.preventDefault(); running ? stopRun() : startRun(false); }
    if (ev.code === "ArrowRight" && !running) doStep();
    if (ev.code === "ArrowLeft" && !running) doBack();
  });

  window.addEventListener("resize", () => render());

  // ---------------- boot ----------------

  try {
    const saved = localStorage.getItem("fractran.regMode");
    if (saved === "bars" || saved === "chips") regMode = saved;
  } catch (e) { /* private mode */ }

  const m = location.hash.match(/^#example=([a-z0-9_-]+)$/);
  const byHash = m && EXAMPLES.find((e) => e.id === m[1]);
  if (byHash) {
    loadExample(byHash);
  } else if (restoreLocal()) {
    reset();
  } else {
    loadExample(EXAMPLES.find((e) => e.id === "primegame"));
  }
  render();

})();