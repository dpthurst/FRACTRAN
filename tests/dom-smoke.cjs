// tests/dom-smoke.cjs — drive the real page under jsdom: load index.html,
// evaluate core.js + examples.js + app.js in order (as a browser would),
// then click through the UI and assert on the DOM.
//
// Not a browser test: jsdom has no layout and no real canvas (stubbed here).
// The first real test of the page is the author opening it.  This catches
// wiring errors — ids that do not resolve, handlers that throw, state that
// does not reach the DOM.
//
// Needs jsdom (deliberately not a repo dependency — see agent-craft §6):
//     npm i --prefix .scratch/js jsdom
// Skips loudly when it is missing.

"use strict";

const fs = require("fs");
const path = require("path");

let JSDOM;
try {
  ({ JSDOM } = require("jsdom"));
} catch (e) {
  try {
    ({ JSDOM } = require(path.join(__dirname, "..", ".scratch", "js", "node_modules", "jsdom")));
  } catch (e2) {
    console.log("SKIP: jsdom not installed — run: npm i --prefix .scratch/js jsdom");
    process.exit(0);
  }
}

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8")
  // the page's own scripts are evaluated by hand, in order, below
  .replace(/<script[^>]*src="[^"]*"><\/script>/g, "");

const dom = new JSDOM(html, {
  url: "http://localhost/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
});
const { window } = dom;

// jsdom has no canvas implementation: a recording no-op 2d context keeps the
// chart code running and lets the test inspect every coordinate the page
// would draw.  jsdom also reports a 0×0 canvas, which would make drawChart
// take its "too small" early return — give it a realistic layout so the
// chart path is actually exercised.
const drawn = [];
const mkCtx = () => ({
  setTransform() {}, clearRect() {}, beginPath() {},
  moveTo(x, y) { drawn.push(["move", x, y]); },
  lineTo(x, y) { drawn.push(["line", x, y]); },
  stroke() {}, arc(x, y, r) { drawn.push(["arc", x, y, r]); },
  fill() {}, fillText(t, x, y) { drawn.push(["text", t, x, y]); },
  strokeStyle: "", fillStyle: "", lineWidth: 1, font: "",
});
const ctx2d = mkCtx();
Object.defineProperty(window.HTMLCanvasElement.prototype, "clientWidth", { get: () => 800 });
Object.defineProperty(window.HTMLCanvasElement.prototype, "clientHeight", { get: () => 180 });
window.HTMLCanvasElement.prototype.getContext = () => ctx2d;

// One concatenated evaluation: in a browser, separate <script> tags share
// the global lexical scope; separate eval() calls would not, so the page's
// three scripts are joined exactly as the browser would order them.
window.eval(
  fs.readFileSync(path.join(root, "core.js"), "utf8") + "\n" +
  fs.readFileSync(path.join(root, "examples.js"), "utf8") + "\n" +
  fs.readFileSync(path.join(root, "app.js"), "utf8"));

const $ = (id) => window.document.getElementById(id);
const stepNum = () => parseInt($("stepCounter").textContent.replace(/\D/g, ""), 10) || 0;
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) passed++;
  else { failed++; console.log("FAIL " + label + (detail ? "  " + detail : "")); }
}

(async () => {
  // ---- boot: default example loads, library renders ----
  check("library built: 17 example buttons",
    window.document.querySelectorAll("#library button").length === 17,
    String(window.document.querySelectorAll("#library button").length));
  check("default example is PRIMEGAME", $("program").value.includes("17/91"));
  check("input is 2", $("inputN").value === "2");
  check("step counter at 0", $("stepCounter").textContent.includes("step 0"));

  // ---- one step of PRIMEGAME from 2: first applicable fraction is 15/2 ----
  click($("btnStep"));
  check("after step: n = 15", $("nValue").textContent.includes("15"),
    $("nValue").textContent.slice(0, 40));
  check("fired fraction shown", $("fired").textContent.includes("15/2"));

  // ---- run at 10 steps/s, then pause ----
  $("speed").value = "10";
  click($("btnRun"));
  await sleep(400);
  const duringRun = stepNum();
  check("run advanced the step counter", duringRun >= 3 && duringRun <= 15, String(duringRun));
  // The pause control must be a *live* button: jsdom dispatches clicks to
  // disabled buttons, a browser does not — asserting only on the click
  // outcome let a disabled pause button pass. Assert the enabled state.
  check("pause control is enabled while running", $("btnRun").disabled === false,
    "btnRun.disabled = " + $("btnRun").disabled);
  check("pause control is labelled pause", $("btnRun").textContent.includes("pause"),
    $("btnRun").textContent);
  click($("btnRun"));                       // pause
  await sleep(250);
  const paused = stepNum();
  await sleep(250);
  check("pause stops the run", stepNum() === paused, `${stepNum()} vs ${paused}`);
  check("pause re-labels the control run", $("btnRun").textContent.includes("run"),
    $("btnRun").textContent);

  // ---- a program that never halts (PRIMEGAME) can be paused at full speed ----
  const primegameBtn = [...window.document.querySelectorAll("#library button")]
    .find((b) => b.dataset.id === "primegame");
  click(primegameBtn);
  $("speed").value = "max";
  click($("btnRun"));
  await sleep(300);
  check("max-speed run advances", stepNum() > 100, String(stepNum()));
  check("pause control live at max speed", $("btnRun").disabled === false);
  click($("btnRun"));
  await sleep(200);
  const pmPaused = stepNum();
  await sleep(300);
  check("PRIMEGAME paused by the button", stepNum() === pmPaused, `${stepNum()} vs ${pmPaused}`);
  $("speed").value = "10";

  // ---- engine toggle to registers: reset, step, register chips ----
  click(window.document.querySelector('#engineToggle button[data-engine="fact"]'));
  check("engine switch resets to step 0", stepNum() === 0, String(stepNum()));
  click($("btnStep"));
  check("registers panel shows prime chips", $("registers").textContent.includes("5^1"),
    $("registers").textContent.slice(0, 60));

  // ---- load the adder from the library, run it to its halt ----
  const adderBtn = [...window.document.querySelectorAll("#library button")]
    .find((b) => b.dataset.id === "adder");
  check("adder button exists in the library", !!adderBtn);
  click(adderBtn);
  check("adder program + input loaded",
    $("program").value.includes("3/2") && $("inputN").value === "2^12 * 3^5");
  for (let i = 0; i < 25 && !$("btnStep").disabled; i++) click($("btnStep"));
  check("adder halts after 12 steps (one per two in 2^12)", 
    $("haltBadge").textContent.includes("halted after 12"), $("haltBadge").textContent);
  check("halt event decoded the output (3^17)", $("events").textContent.includes("17"),
    $("events").textContent.slice(0, 80));

  // ---- chart: drawn, labelled, and inside its box ----
  check("chart note reports log₁₀ n and the axis range",
    /log₁₀ n = [\d.]+ now/.test($("chartNote").textContent)
    && /axis [\d.]+ … [\d.]+/.test($("chartNote").textContent),
    $("chartNote").textContent);
  {
    const bad = drawn.filter((d) => d.length >= 3
      && d.slice(1, 3).some((v) => typeof v === "number" && (!Number.isFinite(v) || v < 0 || v > 800))
      || (d.length >= 3 && typeof d[2] === "number" && d[0] !== "text" && d[2] > 180));
    check("chart: every drawn coordinate is finite and inside the canvas",
      drawn.length > 0 && bad.length === 0,
      `${drawn.length} ops, ${bad.length} outside: ${JSON.stringify(bad.slice(0, 3))}`);
  }

  // ---- back ----
  click($("btnBack"));
  check("back moves to step 11", $("stepCounter").textContent.includes("11"),
    $("stepCounter").textContent);

  // ---- fraction strip: fires highlighted, next outlined ----
  {
    click([...window.document.querySelectorAll("#library button")].find((b) => b.dataset.id === "primegame"));
    const chips = [...window.document.querySelectorAll("#fracstrip .frac")];
    check("fraction strip renders one chip per fraction (14 for PRIMEGAME)",
      chips.length === 14, String(chips.length));
    check("strip shows the fraction values",
      chips[0] && chips[0].textContent.includes("17/91"), chips[0] && chips[0].textContent);
    // PRIMEGAME at n = 2 -> the next fraction to fire is 15/2 (12th, index 11)
    const nextChips = [...window.document.querySelectorAll("#fracstrip .frac.next")];
    check("strip marks the next fraction to fire",
      nextChips.length === 1 && nextChips[0].dataset.index === "11",
      nextChips.map((c) => c.dataset.index).join(","));
    // after one step the fired fraction is 15/2 and the next one differs
    click($("btnStep"));
    const firing = [...window.document.querySelectorAll("#fracstrip .frac.firing")];
    check("strip moves the highlight to the fraction that fired",
      firing.length === 1 && firing[0].dataset.index === "11",
      firing.map((c) => c.dataset.index).join(","));
    check("strip still has exactly one 'next' marker",
      window.document.querySelectorAll("#fracstrip .frac.next").length === 1);
  }

  // ---- register bars: a fixed register set that does not pop in and out ----
  {
    click([...window.document.querySelectorAll("#library button")].find((b) => b.dataset.id === "primegame"));
    click(window.document.querySelector('#regMode button[data-mode="bars"]'));
    const rowsAt = () => [...window.document.querySelectorAll("#registers .barrow")]
      .map((r) => r.dataset.prime);
    const first = rowsAt();
    check("bars view renders a row per register", first.length >= 10, String(first.length));
    check("bars view shows zero registers as rows, not disappearances",
      window.document.querySelectorAll("#registers .barrow .val.zero").length > 0,
      String(window.document.querySelectorAll("#registers .barrow .val.zero").length));

    // step PRIMEGAME and require the row set never changes
    let stable = true;
    const setBefore = first.slice().sort().join(",");
    for (let i = 0; i < 40; i++) {
      click($("btnStep"));
      const now = rowsAt().slice().sort().join(",");
      if (now !== setBefore) { stable = false; break; }
    }
    check("bars view: register rows are constant across 40 steps", stable,
      `${first.length} rows`);

    // and the values do change (so the bars are live, not a static snapshot)
    check("bars view: bars track the run",
      [...window.document.querySelectorAll("#registers .barrow .val")]
        .some((v) => v.textContent !== "0"));

    click(window.document.querySelector('#regMode button[data-mode="chips"]'));
    check("chips view comes back", window.document.querySelectorAll("#registers .barrow").length === 0);
  }

  // ---- event dots stay pinned to their own values as the run continues ----
  {
    click([...window.document.querySelectorAll("#library button")].find((b) => b.dataset.id === "primegame"));
    $("speed").value = "max";
    const runTo = async (target) => {
      click($("btnRun"));
      for (;;) {
        await sleep(15);
        if (stepNum() >= target || !$("btnRun").disabled === false) break;
        if (stepNum() >= target) break;
      }
      click($("btnRun"));                    // pause (also renders)
      await sleep(30);
    };
    await runTo(600);
    drawn.length = 0;
    click(window.document.querySelector('#regMode button[data-mode="bars"]'));   // one render
    const arcs1 = drawn.filter((d) => d[0] === "arc").map((d) => [d[1], d[2]]);
    check("several event dots drawn by step 600", arcs1.length >= 3, String(arcs1.length));

    // The dots must sit at their OWN values under the current axis.  The axis
    // rescales as the run grows, so absolute y drifts — but it must always
    // equal pad + (1 - (log10(event) - lo)/(hi - lo)) * (h - 2*pad), with the
    // lo/hi the chart itself reports.  (The pre-fix code put dots on the
    // pixel column's running maximum, which this check fails.)
    const parseNote = () => {
      const m = $("chartNote").textContent.match(/axis ([\d.]+) … ([\d.]+)/);
      return m ? { lo: parseFloat(m[1]), hi: parseFloat(m[2]) } : null;
    };
    const axis = parseNote();
    check("chart note reports the axis range", !!axis, $("chartNote").textContent);
    // events panel is newest-first: reverse to draw order
    const evs = [...$("events").querySelectorAll(".ev")]
      .map((el) => {
        const m = el.textContent.match(/step ([\d,]+) = (\d+)/);
        return m ? { step: parseInt(m[1].replace(/,/g, ""), 10), k: parseInt(m[2], 10) } : null;
      }).filter(Boolean).reverse();
    const h = 180, pad = 6, hPlot = h - 14;   // 14px reserved for the x-axis label
    let pinned = arcs1.length > 0 && evs.length >= arcs1.length;
    const clampY = (y) => Math.max(pad, Math.min(h - pad, y));
    for (let i = 0; i < arcs1.length; i++) {
      const v = evs[i].k * Math.log10(2);            // PRIMEGAME events are 2^k
      const expected = clampY(pad + (1 - (v - axis.lo) / (axis.hi - axis.lo)) * (hPlot - 2 * pad));
      if (Math.abs(arcs1[i][1] - expected) > 0.75) { pinned = false; break; }
    }
    check("event dots sit at their own values under the current axis", pinned,
      JSON.stringify({ arcs: arcs1.slice(0, 4), evs: evs.slice(0, 4), axis }));

    await runTo(2500);
    drawn.length = 0;
    click(window.document.querySelector('#regMode button[data-mode="bars"]'));   // one render
    const arcs2 = drawn.filter((d) => d[0] === "arc").map((d) => [d[1], d[2]]);
    check("more events have fired by step 2500", arcs2.length > arcs1.length,
      `${arcs1.length} -> ${arcs2.length}`);
    // same pinning check after the axis has rescaled
    const axis2 = parseNote();
    const evs2 = [...$("events").querySelectorAll(".ev")]
      .map((el) => {
        const m = el.textContent.match(/step ([\d,]+) = (\d+)/);
        return m ? { step: parseInt(m[1].replace(/,/g, ""), 10), k: parseInt(m[2], 10) } : null;
      }).filter(Boolean).reverse();
    let pinned2 = arcs2.length > 0 && evs2.length >= arcs2.length;
    for (let i = 0; i < arcs2.length; i++) {
      const v = evs2[i].k * Math.log10(2);
      const expected = clampY(pad + (1 - (v - axis2.lo) / (axis2.hi - axis2.lo)) * (hPlot - 2 * pad));
      if (Math.abs(arcs2[i][1] - expected) > 0.75) { pinned2 = false; break; }
    }
    check("event dots stay on their values after the axis rescales", pinned2,
      JSON.stringify({ axis2, arcs2: arcs2.slice(0, 4), evs2: evs2.slice(0, 4) }));
    // and the earliest events only slide left smoothly as the axis stretches
    let xSane = true;
    for (let i = 0; i < Math.min(arcs1.length, arcs2.length); i++) {
      if (arcs2[i][0] > arcs1[i][0] + 0.5) xSane = false;
    }
    check("event dots slide left smoothly (axis stretch), never jump right", xSane);
    click(window.document.querySelector('#regMode button[data-mode="chips"]'));
  }

  // ---- regression: speed change during a "next event" run must keep the
  // stop-at-event contract (stopRun used to clear the flag before the
  // restart read it, turning the run into a plain run) ----
  {
    click([...window.document.querySelectorAll("#library button")].find((b) => b.dataset.id === "primegame"));
    $("speed").value = "10";
    click($("btnNext"));
    await sleep(60);                        // running toward the first event
    const midRun = $("btnRun").textContent;
    check("next event is running when the speed changes", midRun.includes("pause"), midRun);
    $("speed").value = "max";
    $("speed").dispatchEvent(new window.Event("change"));
    await sleep(400);
    check("after a speed change the run still stops at the event",
      $("btnRun").textContent.includes("run") && !$("btnRun").textContent.includes("pause"),
      $("btnRun").textContent);
    check("and it stopped near the event, not at max-speed distance",
      stepNum() < 5000, String(stepNum()));
    check("exactly one event recorded", window.document.querySelectorAll("#events .ev").length === 1,
      String(window.document.querySelectorAll("#events .ev").length));
  }

  // ---- regression: the halt badge must vanish on reset (an id-specificity
  // clash kept display:inline-block above .hidden, so the banner stuck) ----
  {
    const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
    check("style.css: #haltBadge.hidden outranks the badge's own display",
      /#haltBadge\.hidden\s*{[^}]*display:\s*none/.test(css));
    click([...window.document.querySelectorAll("#library button")].find((b) => b.dataset.id === "adder"));
    for (let i = 0; i < 25 && !$("btnStep").disabled; i++) click($("btnStep"));
    check("adder halted (badge shown)", $("haltBadge").classList.contains("hidden") === false);
    click($("btnReset"));
    check("reset hides the halt badge", $("haltBadge").classList.contains("hidden"),
      $("haltBadge").className);
  }

  // ---- x-axis label ----
  {
    click([...window.document.querySelectorAll("#library button")].find((b) => b.dataset.id === "primegame"));
    click($("btnStep"));
    drawn.length = 0;
    click(window.document.querySelector('#regMode button[data-mode="bars"]'));   // one render
    const texts = drawn.filter((d) => d[0] === "text").map((d) => d[1]);
    check("chart draws an x-axis label for the step count",
      texts.some((t) => /^steps 0 … /.test(t)), JSON.stringify(texts));
    click(window.document.querySelector('#regMode button[data-mode="chips"]'));
  }

  // ---- global numbers/factors display toggle ----
  {
    click([...window.document.querySelectorAll("#library button")].find((b) => b.dataset.id === "adder"));
    $("speed").value = "10";
    click($("btnStep"));                     // n = 2^11 · 3^6
    click(window.document.querySelector('#dispToggle button[data-disp="factors"]'));
    check("n shows its factorization",
      /\^|·/.test($("nValue").textContent) && $("nValue").textContent.includes("2^11"),
      $("nValue").textContent.slice(0, 60));
    check("the parsed input shows its factorization",
      $("inputEcho").textContent.replace(/\s/g, "") === "input=2^12·3^5",
      $("inputEcho").textContent);
    check("toggle state is reflected on the buttons",
      window.document.querySelector('#dispToggle button[data-disp="factors"]').classList.contains("on"));
    click(window.document.querySelector('#dispToggle button[data-disp="number"]'));
    check("n shows plain digits again",
      /\d/.test($("nValue").textContent) && !/·/.test($("nValue").textContent),
      $("nValue").textContent.slice(0, 40));
    check("input echo shows the decimal again",
      $("inputEcho").textContent.includes("995328"), $("inputEcho").textContent);
    // a composite fraction actually changes: PRIMEGAME's 78/85 -> 2·3·13/5·17
    click([...window.document.querySelectorAll("#library button")].find((b) => b.dataset.id === "primegame"));
    click(window.document.querySelector('#dispToggle button[data-disp="factors"]'));
    const chip = [...window.document.querySelectorAll("#fracstrip .frac")]
      .find((c) => c.dataset.index === "1");
    check("fraction strip chips show factorized fractions",
      chip && chip.textContent.includes("2·3·13/5·17"),
      chip && chip.textContent);
    click(window.document.querySelector('#dispToggle button[data-disp="number"]'));
    const chipRaw = [...window.document.querySelectorAll("#fracstrip .frac")]
      .find((c) => c.dataset.index === "1");
    check("fraction strip chips show raw fractions again",
      chipRaw && chipRaw.textContent.includes("78/85"),
      chipRaw && chipRaw.textContent);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log("FAIL smoke crashed: " + (e && e.stack || e)); process.exit(1); });