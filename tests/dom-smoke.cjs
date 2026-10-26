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

// jsdom has no canvas implementation: a no-op 2d context keeps the chart
// code running (clientWidth is 0, so there is nothing to draw anyway).
const ctx2d = {
  setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
  stroke() {}, arc() {}, fill() {}, fillText() {},
  strokeStyle: "", fillStyle: "", lineWidth: 1, font: "",
};
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
  click($("btnRun"));                       // pause
  await sleep(250);
  const paused = stepNum();
  await sleep(250);
  check("pause stops the run", stepNum() === paused, `${stepNum()} vs ${paused}`);

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

  // ---- back ----
  click($("btnBack"));
  check("back moves to step 11", $("stepCounter").textContent.includes("11"),
    $("stepCounter").textContent);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log("FAIL smoke crashed: " + (e && e.stack || e)); process.exit(1); });