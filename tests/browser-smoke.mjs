#!/usr/bin/env node
// Real-browser smoke test for the FRACTRAN playground, via headless Firefox
// (playwright; see ~/web-app-testing.md and agent-craft §7(a)).  jsdom cannot
// see layout or CSS cascade outcomes — this can.
//
//   export PATH="$HOME/node/bin:$PATH"
//   python3 -m http.server 8765 --directory . &
//   node tests/browser-smoke.mjs http://127.0.0.1:8765/index.html
//   kill %1
//
// Checks console cleanliness, stepping, the pause control, bars mode, the
// factors toggle, the strip, the chart, and PIGAME's next-event; writes
// screenshots to .scratch/js/shots/.  Skipped (exit 0) when playwright is
// not installed — it is deliberately not a repo dependency:
//     npm i --prefix .scratch/js playwright && npx playwright install firefox

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

let firefox;
try {
  ({ firefox } = await import('playwright'));
} catch {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    ({ firefox } = createRequire(import.meta.url)(
      path.join(here, '..', '.scratch', 'js', 'node_modules', 'playwright')));
  } catch {
    console.log('SKIP: playwright not installed — see the header of this file');
    process.exit(0);
  }
}

const url = process.argv[2] || 'http://127.0.0.1:8765/index.html';
const OUT = new URL('./', import.meta.url).pathname.replace(/tests\/$/, '') + '.scratch/js/shots/';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
let passed = 0, failed = 0;
const check = (label, cond, detail) => {
  if (cond) passed++;
  else { failed++; console.log('FAIL ' + label + (detail ? '  ' + detail : '')); }
};

const browser = await firefox.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(15000);
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('#library button');

// boot state
check('library renders 17 example buttons',
  (await page.locator('#library button').count()) === 17);
check('default example PRIMEGAME loaded',
  (await page.inputValue('#program')).includes('17/91'));
check('event directive visible in the editor (with its min exponent)',
  (await page.inputValue('#program')).includes('# event: pow(2, min=2)'));

await page.screenshot({ path: OUT + '1-primegame.png', fullPage: true });

// step a few times
await page.click('#btnStep');
check('first step fires 15/2', (await page.textContent('#fired')).includes('15/2'),
  await page.textContent('#fired'));
for (let i = 0; i < 2; i++) await page.click('#btnStep');
check('step counter advances', (await page.textContent('#stepCounter')).includes('3'));
check('strip marks the fired chip',
  (await page.locator('#fracstrip .frac.firing').count()) === 1);
check('strip marks the next chip',
  (await page.locator('#fracstrip .frac.next').count()) === 1);

// run at max speed briefly, then pause via the (previously broken) button
await page.selectOption('#speed', 'max');
await page.click('#btnRun');
await page.waitForTimeout(400);
check('pause control live while running',
  (await page.locator('#btnRun[disabled]').count()) === 0);
await page.click('#btnRun');
await page.waitForTimeout(200);
check('pause stops the run',
  (await page.textContent('#btnRun')).includes('run'));

// chart drew something (canvas has backing store) and axis label exists
const canvasInfo = await page.evaluate(() => {
  const cv = document.getElementById('chart');
  return { w: cv.width, h: cv.height, note: document.getElementById('chartNote').textContent };
});
check('chart canvas has a backing store', canvasInfo.w > 100 && canvasInfo.h > 100,
  JSON.stringify(canvasInfo));
check('chart note reports log10 n',
  /log₁₀ n = [\d.]+ now/.test(canvasInfo.note), canvasInfo.note);

await page.screenshot({ path: OUT + '2-after-run.png', fullPage: true });

// register bars: a real bar must have nonzero rendered width
await page.click('#regMode button[data-mode="bars"]');
await page.waitForTimeout(100);
const bar = await page.evaluate(() => {
  const row = document.querySelector('#registers .barrow .fill');
  if (!row) return null;
  const r = row.getBoundingClientRect();
  return { w: r.width, h: r.height, bg: getComputedStyle(row).backgroundColor };
});
check('bars mode: the fill renders as a real box', bar && bar.w > 0 && bar.h > 0,
  JSON.stringify(bar));
check('bars mode: fill is painted (not transparent)', bar && bar.bg !== 'rgba(0, 0, 0, 0)',
  bar && bar.bg);
const barRows = await page.locator('#registers .barrow').count();
check('bars mode: fixed row set (10 for PRIMEGAME)', barRows === 10, String(barRows));
await page.screenshot({ path: OUT + '3-bars.png', fullPage: true });
await page.click('#regMode button[data-mode="chips"]');

// global factors toggle
await page.click('#dispToggle button[data-disp="factors"]');
await page.waitForTimeout(100);
check('factors mode: n box factorized',
  /·|\^/.test(await page.textContent('#nValue')));
check('factors mode: input echo factorized',
  (await page.textContent('#inputEcho')).includes('2'));
const fChip = await page.locator('#fracstrip .frac[data-index="1"]').textContent();
check('factors mode: strip chip factorized (78/85 -> 2·3·13/5·17)',
  fChip.includes('2·3·13/5·17'), fChip);
await page.screenshot({ path: OUT + '4-factors.png', fullPage: true });
await page.click('#dispToggle button[data-disp="number"]');

// next event really parks on the event state (PIGAME, 775 steps at max speed)
await page.click('#library button:has-text("PIGAME")');
await page.fill('#inputN', '89');
await page.selectOption('#speed', 'max');
await page.click('#btnNext');
await page.waitForFunction(
  () => document.getElementById('stepCounter').textContent.replace(/\D/g, '') !== '0',
  null, { timeout: 10000 });
await page.waitForFunction(
  () => !document.getElementById('btnRun').textContent.includes('pause'),
  null, { timeout: 15000 });
const pigameStep = parseInt(
  (await page.textContent('#stepCounter')).replace(/\D/g, ''), 10);
check('PIGAME next event parks at step 775', pigameStep === 775, String(pigameStep));
check('PIGAME event decodes the digit 3',
  (await page.textContent('#events')).includes('= 3'));
await page.screenshot({ path: OUT + '5-pigame-event.png', fullPage: true });

// next event twice: the second press must advance, not stall.
// PRIMEGAME: first event at step 19 (2^2), second at 69 (2^3).
await page.click('#library button:has-text("PRIMEGAME (Conway)")');
await page.selectOption('#speed', 'max');
await page.click('#btnNext');
await page.waitForFunction(() => !document.getElementById('btnRun').textContent.includes('pause'),
  null, { timeout: 15000 });
const evStep1 = (await page.textContent('#stepCounter')).replace(/\D/g, '');
await page.click('#btnNext');
await page.waitForFunction(() => !document.getElementById('btnRun').textContent.includes('pause'),
  null, { timeout: 20000 });
const evStep2 = (await page.textContent('#stepCounter')).replace(/\D/g, '');
check('next event twice advances to the second event', evStep1 === '19' && evStep2 === '69',
  `${evStep1} -> ${evStep2}`);
check('exactly two events recorded', (await page.locator('#events .ev').count()) === 2);

// blank program
await page.click('#btnBlank');
check('blank starts a fresh program',
  (await page.inputValue('#program')).startsWith('3/2'));
check('blank clears the active example',
  (await page.locator('#library button.active').count()) === 0);
await page.click('#btnHelp');
check('syntax help opens', await page.locator('#syntaxHelp.open').count() === 1);
await page.screenshot({ path: OUT + '6-blank-and-syntax.png', fullPage: true });

// named registers: prime and name both visible, nothing ellipsized away
await page.click('#regMode button[data-mode="bars"]');
await page.click('#library button:has-text("GCD")');
await page.waitForTimeout(200);
const regInfo = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#registers .barrow')];
  const trunc = [...document.querySelectorAll('#registers .barrow .nm')]
    .filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent);
  return {
    rows: rows.length,
    primes: rows.map((r) => r.querySelector('.p').textContent.trim()),
    named: rows.filter((r) => r.querySelector('.nm').textContent.trim())
      .map((r) => r.querySelector('.p').textContent.trim() + ' ' + r.querySelector('.nm').textContent.trim()),
    truncated: trunc,
  };
});
check('bars: every row shows its prime', regInfo.primes.every((p) => p.length > 0),
  JSON.stringify(regInfo.primes.slice(0, 5)));
check('bars: named rows show prime + name', regInfo.named[0] === '2 input a', regInfo.named[0]);
check('bars: no register name is truncated', regInfo.truncated.length === 0,
  JSON.stringify(regInfo.truncated));
await page.locator('#registers').screenshot({ path: OUT + '7-registers-named.png' });
await page.click('#regMode button[data-mode="chips"]');
check('chips: prime shown with the name',
  /2\s*input a/.test(await page.textContent('#registers')),
  (await page.textContent('#registers')).slice(0, 60));

check('no console errors across the whole click-through', errors.length === 0,
  errors.join('; '));

console.log(`\n${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed ? 1 : 0);