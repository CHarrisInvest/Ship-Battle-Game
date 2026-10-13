/**
 * THE DETERMINISM TEST — `npm run determinism`
 *
 * The server will replay a captain's voyage from its seed and her inputs and bank what its own
 * replay says, so a round has to come out the same, to the last bit, in Node and in every browser
 * she might sail it in. This sails the recorded rounds in `tools/rounds.js` in Node, then in
 * Chromium, WebKit (Safari's engine) and Firefox through `playwright-core`, and fails unless every
 * engine's fingerprints match Node's. When a round parts company it says at which ten seconds.
 *
 * It fails as well if a browser will not start, because a test that skips the engine most likely to
 * differ has told nobody anything. Name engines to run only those: `npm run determinism webkit`.
 * The browsers come from `npx playwright-core install chromium-headless-shell webkit firefox`.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit, firefox } from "playwright-core";
import { playAll, dump } from "./rounds.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINES = { chromium, webkit, firefox };
const asked = process.argv.slice(2);
for (const name of asked) if (!ENGINES[name]) { console.log(`no engine called ${name}; there are ${Object.keys(ENGINES).join(", ")}`); process.exit(1); }

const failures = [];
const fail = (what) => { failures.push(what); console.log("  FAIL  " + what); };
const ok = (what) => console.log("  ok    " + what);

/** Every way `theirs` differs from Node's run, as lines; none means the same. */
function differences(mine, theirs) {
  const out = [];
  if (mine.vectors !== theirs.vectors) out.push("the exact maths give different bits");
  mine.rounds.forEach((m, i) => {
    const t = theirs.rounds[i];
    if (!t) { out.push(`${m.name}: not sailed`); return; }
    if (m.final === t.final && m.ticks === t.ticks) return;
    const at = m.checkpoints.findIndex((c, k) => c !== t.checkpoints[k]);
    const when = at < 0 ? `in the last ten seconds (ended at tick ${t.ticks}, Node at ${m.ticks})` : `by ${(at + 1) * 10} s`;
    out.push(`${m.name}: parts company with Node ${when}`);
  });
  return out;
}

// The page the rounds run in, and the engine's own files served as they are, as plain ES modules.
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (path === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><title>determinism</title>"); return; }
  if (!/^\/(src|tools)\/[\w/.-]+\.js$/.test(path) || path.includes("..")) { res.writeHead(404); res.end(); return; }
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

let t0 = Date.now();
const mine = playAll();
console.log(`node ${process.version}: ${mine.rounds.length} rounds in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// The comparison has to be able to fail, or a pass means nothing: a copy with one fingerprint
// changed must come out different.
const tampered = structuredClone(mine);
tampered.rounds[0].final = "00000000";
if (!differences(mine, tampered).length) fail("the comparison cannot see a changed fingerprint");
// and a world written out has to keep the sign of a zero, which JSON drops: an engine whose heading
// came out -0 where Node's came out 0 has parted company, even if nothing shows it for a while.
if (dump({ heading: -0 }) === dump({ heading: 0 })) fail("a world written out cannot tell -0 from 0");

for (const [name, type] of Object.entries(ENGINES)) {
  if (asked.length && !asked.includes(name)) continue;
  let browser;
  try {
    browser = await type.launch({ headless: true });
  } catch (e) {
    fail(`${name} would not start: ${e.message.split("\n")[0]}`);
    continue;
  }
  try {
    const page = await browser.newPage();
    await page.goto(origin + "/");
    t0 = Date.now();
    const theirs = await page.evaluate(async () => (await import("/tools/rounds.js")).playAll());
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const diff = differences(mine, theirs);
    if (diff.length) for (const d of diff) fail(`${name} ${browser.version()}: ${d}`);
    else ok(`${name} ${browser.version()}: all ${mine.rounds.length} rounds and the maths match Node, to the bit (${secs} s)`);
  } catch (e) {
    fail(`${name}: ${e.message.split("\n")[0]}`);
  } finally {
    await browser.close();
  }
}
server.close();

if (failures.length) {
  console.log(`\n${failures.length} FAILURE${failures.length === 1 ? "" : "S"}`);
  process.exit(1);
}
console.log("\nEvery engine sails the same round.\n");
