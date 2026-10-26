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
  let running = false;
  let timer = null;
  let stopAtNextEvent = false;
  let haltedAt = null;     // {step} when the run halted

  // ---------------- engine plumbing ----------------

  function stepFn() { return engine === "arith" ? C.arithStep : C.factStep; }
  function newState(n) { return engine === "arith" ? C.newArithState(n) : C.newFactState(n); }

  function nOf(state) { return state.kind === "arith" ? state.n : C.factToN(state.fact); }

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

  function snapshot() {
    return {
      n: nOf(st), fact: st.fact, step: st.step, fired: st.fired,
      chartLen: chart.length, eventsLen: events.length, traceLen: trace.length,
    };
  }

  function stepOnce() {
    if (!st || st.halted) return false;
    const spec = eventSpec();
    if (spec) {
      const ev = C.evalEvent(spec, st);
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
    if (st.halted) {
      if (spec) {
        const ev = C.evalEvent(spec, st);
        if (ev.fire) recordEvent(st.step, ev, spec);
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
      n: C.factToString(st.fact, null),
    });
    if (trace.length > LOG_KEEP) trace.splice(0, trace.length - LOG_KEEP);
  }

  // ---------------- rendering ----------------

  function render() {
    renderLibrary();
    renderState();
    renderEvents();
    renderTrace();
    drawChart();
    renderButtons();
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

  function renderRegisters() {
    const box = $("registers");
    const legend = example ? example.registers || {} : {};
    const entries = [...st.fact.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    $("regNote").textContent = example && Object.keys(legend).length
      ? "(named = the example's register map)" : "(exponents of the primes in n)";
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

    if (!chart.length) {
      ctx.fillStyle = "#8a93a3";
      ctx.font = "12px " + "system-ui";
      ctx.fillText("press run — log₁₀ n over steps, orange dots mark events", 10, 20);
      $("chartNote").textContent = "";
      return;
    }

    const maxStep = Math.max(chart[chart.length - 1].step, 1);
    let lo = Infinity, hi = -Infinity;
    for (const pt of chart) { if (pt.log10 < lo) lo = pt.log10; if (pt.log10 > hi) hi = pt.log10; }
    if (hi - lo < 1) { hi = lo + 1; }
    const X = (s) => (s / maxStep) * (w - 8) + 4;
    const Y = (v) => h - 8 - ((v - lo) / (hi - lo)) * (h - 20);

    // bucket per pixel column, take the max within a bucket
    const cols = Math.max(2, Math.floor(w));
    const bucket = new Array(cols).fill(-Infinity);
    for (const pt of chart) {
      const c = Math.min(cols - 1, Math.max(0, Math.floor(X(pt.step))));
      if (pt.log10 > bucket[c]) bucket[c] = pt.log10;
    }
    ctx.strokeStyle = "#6fc3ff";
    ctx.lineWidth = 1;
    ctx.beginPath();
    let started = false;
    for (let c = 0; c < cols; c++) {
      if (bucket[c] === -Infinity) continue;
      const x = c + 0.5, y = Y(bucket[c]);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // event markers
    const specStep = (e) => e.step;
    ctx.fillStyle = "#ffb347";
    for (const e of events) {
      const x = X(specStep(e)), v = chart[Math.min(chart.length - 1,
        binaryFind(chart, e.step))].log10;
      ctx.beginPath();
      ctx.arc(x, Y(v), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    $("chartNote").textContent = `steps 0 … ${maxStep.toLocaleString("en")}`
      + (st && st.step >= STEP_GUARD ? " — step guard reached" : "");
  }

  function binaryFind(arr, step) {   // last index with arr[i].step <= step
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid].step <= step) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  function renderButtons() {
    const canStep = !!st && !st.halted && prog && prog.errors.length === 0;
    $("btnStep").disabled = !canStep || running;
    $("btnRun").disabled = !canStep || running;
    $("btnNext").disabled = !canStep || running || !eventSpec();
    $("btnBack").disabled = running || !history.length;
    $("btnRun").textContent = running ? "❚❚ pause" : "▶ run";
  }

  // ---------------- actions ----------------

  function doStep() { stopRun(); stepOnce(); pushTrace(); render(); }

  function doBack() {
    stopRun();
    if (!history.length) return;
    const h = history.pop();
    chart.length = Math.min(h.chartLen, chart.length);
    events.length = h.eventsLen;
    trace.length = h.traceLen;
    haltedAt = null;
    st = engine === "arith"
      ? { kind: "arith", n: h.n, fact: h.fact, step: h.step, fired: h.fired, halted: false }
      : { kind: "fact", fact: h.fact, n: null, step: h.step, fired: h.fired, halted: false };
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

  document.addEventListener("keydown", (ev) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
    if (ev.code === "Space") { ev.preventDefault(); running ? stopRun() : startRun(false); }
    if (ev.code === "ArrowRight" && !running) doStep();
    if (ev.code === "ArrowLeft" && !running) doBack();
  });

  window.addEventListener("resize", () => render());

  // ---------------- boot ----------------

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