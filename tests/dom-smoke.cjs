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

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log("FAIL smoke crashed: " + (e && e.stack || e)); process.exit(1); });