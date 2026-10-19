/**
 * THE SHIP LAB'S TOOL — `npm run shiplab`
 *
 * Three ways to look at the fleet without opening the game, all drawn by the menu's own three.js ship
 * (`createMenuShip`) in a headless Chromium against the dev server, so a picture here is the model
 * the game ships and never a replica of it:
 *
 *   npm run shiplab -- --sheet          every class at three bearings, in one picture
 *   npm run shiplab -- --diff main      the same sheet drawn from another commit and from this
 *                                       checkout, and only the classes that came out different, each
 *                                       before and after; the classes are named and the share of
 *                                       each picture that moved is printed
 *   npm run shiplab -- --artifact       the Ship Lab page (`shiplab/`) folded into one self-contained
 *                                       file, to publish as an Artifact a phone can open
 *
 * Options: `--bearings 300,30,200`, `--fit full|found|plain|bare` (default full), `--speed 0` (the
 * engine's units; her flags stream astern above zero), `--only corvette,firstRate`, and `--out DIR`
 * (default `shiplab-out/`, which git ignores). Flags are drawn at one fixed moment of their wave, so
 * two runs of the same tree come out the same and a diff shows only what changed.
 *
 * `--diff REF` checks REF out into a temporary worktree beside this one, borrows this checkout's
 * node_modules, and serves it on a second port. Any commit with `createMenuShip` can be compared,
 * including ones from before the lab existed, because the sheet is drawn by the code in this file
 * rather than by the lab page.
 *
 * Needs `playwright-core` (a dev dependency) and a Chromium: point SMOKE_CHROME at an executable, or
 * `npx playwright install chromium`.
 */

import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const OUT = resolve(root, opt("out", "shiplab-out"));
const BEARINGS = opt("bearings", "300,30,200").split(",").map(Number).filter(Number.isFinite);
const FIT = opt("fit", "full");
const SPEED = Number(opt("speed", "0")) || 0;
const ONLY = opt("only", "") ? opt("only", "").split(",") : null;
const CELL = { w: 420, h: 260 };

const mode = flag("artifact") ? "artifact" : flag("diff") ? "diff" : flag("sheet") ? "sheet" : null;
if (!mode) {
  console.log("npm run shiplab -- --sheet | --diff <commit> | --artifact   (see tools/shiplab.mjs)");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

/* ---- the single file ---------------------------------------------------------------------------- */

if (mode === "artifact") {
  const { build } = await import("vite");
  const git = (...a) => { try { return execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim(); } catch { return ""; } };
  const sha = git("rev-parse", "--short", "HEAD") || "an unknown commit";
  const branch = git("rev-parse", "--abbrev-ref", "HEAD") || "an unknown branch";
  const dirty = git("status", "--porcelain") ? ", with changes not yet committed" : "";
  const stamp = `Built from ${branch} at ${sha}${dirty}, ${new Date().toISOString().slice(0, 10)}.`;
  const tmp = mkdtempSync(join(tmpdir(), "shiplab-build-"));
  await build({
    configFile: false, root, logLevel: "warn",
    define: { __SHIPLAB_STAMP__: JSON.stringify(stamp), "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir: tmp, emptyOutDir: true, minify: true, copyPublicDir: false,
      lib: { entry: join(root, "shiplab", "main.js"), formats: ["es"], fileName: () => "lab.js" },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  // an inline script ends at the first "</script" in it, wherever that is
  const code = readFileSync(join(tmp, "lab.js"), "utf8").replace(/<\/script/gi, "<\\/script");
  rmSync(tmp, { recursive: true, force: true });

  // The page's own head and body without the document around them: the Artifact wraps the file in a
  // document of its own and brings the charset and viewport with it.
  const page = readFileSync(join(root, "shiplab", "index.html"), "utf8");
  const head = page.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<meta charset[^>]*>\s*/i, "")
    .replace(/<meta name="viewport"[^>]*>\s*/i, "");
  const body = page.match(/<body>([\s\S]*?)<\/body>/)[1]
    .replace(/<script type="module" src="\.\/main\.js"><\/script>/, () => `<script type="module">\n${code}\n</script>`);
  if (!body.includes(code)) throw new Error("shiplab/index.html no longer loads ./main.js the way this tool expects");
  const file = join(OUT, "ship-lab.html");
  writeFileSync(file, `${head.trim()}\n${body.trim()}\n`);
  console.log(`wrote ${file} (${Math.round((head.length + body.length) / 1024)} KB): ${stamp}`);
  process.exit(0);
}

/* ---- serving a tree and drawing its fleet --------------------------------------------------------- */

const { chromium } = await import("playwright-core");

function serve(dir, port) {
  const p = spawn("npx", ["vite", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
    cwd: dir, stdio: "ignore", detached: true, env: { ...process.env, BASE_PATH: "/" },
  });
  const site = `http://127.0.0.1:${port}/`;
  const up = async () => { try { return (await fetch(site + "src/render3d/menuship.js")).ok; } catch { return false; } };
  return {
    site,
    ready: async () => {
      for (let i = 0; i < 120 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
      if (!(await up())) throw new Error(`nothing answered at ${site}`);
    },
    stop: () => { try { process.kill(-p.pid); } catch { p.kill(); } },
  };
}

// Drawn in the page: every class, at every bearing, one picture each, as data URLs.
async function drawFleet(page, site) {
  // a blank page on the server's own address, so the game's modules import from it
  const blank = site + "__shiplab__";
  await page.route(blank, (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>sheet</title>" }));
  await page.goto(blank);
  return page.evaluate(async ({ BEARINGS, FIT, SPEED, ONLY, CELL }) => {
    const { createMenuShip } = await import("/src/render3d/menuship.js");
    const Y = await import("/src/shipyard.js");
    const quality = { plain: 0.35, found: 0.7, full: 1 }[FIT];
    const canvas = document.createElement("canvas");
    const ship = createMenuShip(canvas, { shadow: false });
    if (ship.kind !== "3d") throw new Error("no WebGL in this browser");
    ship.resize(CELL.w, CELL.h, 1);
    const out = [];
    for (const hull of Y.HULL_LIST) {
      if (ONLY && !ONLY.includes(hull.id)) continue;
      const lo = quality == null ? Y.emptyLoadout(hull.id) : Y.fitOut(hull.id, quality);
      const spec = Y.rigSpec(lo);
      const cells = BEARINGS.map((deg) => {
        ship.draw(spec, deg, { speed: SPEED, time: 0.6 });
        return canvas.toDataURL("image/png");
      });
      out.push({ id: hull.id, name: hull.name, cells });
    }
    ship.dispose();
    return out;
  }, { BEARINGS, FIT, SPEED, ONLY, CELL });
}

// Laid out in the page as well, since the browser is the one thing here that can draw a PNG.
async function compose(page, rows, title) {
  return page.evaluate(async ({ rows, title, CELL }) => {
    const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
    const cols = Math.max(...rows.map((r) => r.cells.length));
    const head = 34;
    const c = document.createElement("canvas");
    c.width = cols * CELL.w;
    c.height = head + rows.length * CELL.h;
    const x = c.getContext("2d");
    x.fillStyle = "#0b3331"; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = "#eef4f2"; x.font = "16px sans-serif"; x.fillText(title, 10, 22);
    for (const [r, row] of rows.entries()) {
      for (const [i, src] of row.cells.entries()) {
        const px = i * CELL.w, py = head + r * CELL.h;
        x.fillStyle = row.tints?.[i] || "#0d3535"; x.fillRect(px, py, CELL.w, CELL.h);
        if (src) x.drawImage(await load(src), px, py);
        x.strokeStyle = "#1c4a48"; x.strokeRect(px + 0.5, py + 0.5, CELL.w - 1, CELL.h - 1);
        x.fillStyle = "#e8c877"; x.font = "14px sans-serif";
        x.fillText(row.labels[i], px + 8, py + 18);
      }
    }
    return c.toDataURL("image/png");
  }, { rows, title, CELL });
}

// The share of a picture's pixels that differ between two drawings of it.
async function difference(page, a, b) {
  return page.evaluate(async ({ a, b }) => {
    const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const c = document.createElement("canvas");
    c.width = ia.width; c.height = ia.height;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(ia, 0, 0);
    const pa = x.getImageData(0, 0, c.width, c.height).data;
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(ib, 0, 0);
    const pb = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < pa.length; i += 4) {
      if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) + Math.abs(pa[i + 3] - pb[i + 3]) > 24) n++;
    }
    return n / (pa.length / 4);
  }, { a, b });
}

const png = (url) => Buffer.from(url.split(",")[1], "base64");
const GPU = process.platform === "darwin" ? ["--enable-gpu", "--use-angle=metal"] : ["--enable-unsafe-swiftshader"];
const browser = await chromium.launch({
  executablePath: process.env.SMOKE_CHROME || undefined,
  headless: true, args: ["--no-sandbox", ...GPU],
});
const here = serve(root, Number(process.env.SHIPLAB_PORT || 4196));
const cleanup = [() => here.stop()];
try {
  await here.ready();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page:", e.message));
  const what = `fit ${FIT}, speed ${SPEED}, bearings ${BEARINGS.join(", ")}`;
  const now = await drawFleet(page, here.site);

  if (mode === "sheet") {
    const rows = now.map((s) => ({ cells: s.cells, labels: BEARINGS.map((d) => `${s.name}  ${d}°`) }));
    const file = join(OUT, "sheet.png");
    writeFileSync(file, png(await compose(page, rows, `The fleet, ${what}`)));
    console.log(`wrote ${file}: ${now.length} classes`);
  } else {
    const ref = opt("diff", "");
    if (!ref) throw new Error("--diff needs a commit to compare against, such as main");
    const wt = mkdtempSync(join(tmpdir(), "shiplab-ref-"));
    execFileSync("git", ["worktree", "add", "--detach", "--quiet", wt, ref], { cwd: root, stdio: "inherit" });
    cleanup.push(() => execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: root, stdio: "ignore" }));
    symlinkSync(join(root, "node_modules"), join(wt, "node_modules"), "dir");
    const there = serve(wt, Number(process.env.SHIPLAB_REF_PORT || 4197));
    cleanup.push(() => there.stop());
    await there.ready();
    const before = await drawFleet(await browser.newPage(), there.site);

    const was = new Map(before.map((s) => [s.id, s]));
    const rows = [];
    const lines = [];
    for (const s of now) {
      const b = was.get(s.id);
      if (!b) { lines.push(`  new      ${s.name}`); rows.push({ cells: s.cells.flatMap((c) => [null, c]), labels: BEARINGS.flatMap((d) => [`${s.name} not in ${ref}`, `${s.name} now ${d}°`]) }); continue; }
      const moved = [];
      for (let i = 0; i < BEARINGS.length; i++) moved.push(await difference(page, b.cells[i], s.cells[i]));
      const most = Math.max(...moved);
      if (most === 0) { lines.push(`  same     ${s.name}`); continue; }
      lines.push(`  changed  ${s.name}  ${moved.map((m, i) => `${BEARINGS[i]}°: ${(m * 100).toFixed(2)}%`).join("  ")}`);
      rows.push({
        cells: s.cells.flatMap((c, i) => [b.cells[i], c]),
        labels: BEARINGS.flatMap((d) => [`${s.name}  ${d}°  ${ref}`, `${s.name}  ${d}°  now`]),
        tints: BEARINGS.flatMap(() => ["#0d3535", "#123f3b"]),
      });
    }
    for (const b of before) if (!now.some((s) => s.id === b.id)) lines.push(`  gone     ${b.name}`);
    console.log(`against ${ref}, ${what}:\n${lines.join("\n")}`);
    const file = join(OUT, "diff.png");
    if (rows.length) {
      writeFileSync(file, png(await compose(page, rows, `Changed since ${ref}, ${what}: before, then now`)));
      console.log(`wrote ${file}: ${rows.length} of ${now.length} classes differ`);
    } else {
      rmSync(file, { force: true });
      console.log(`no class differs from ${ref}`);
    }
  }
} finally {
  await browser.close();
  for (const f of cleanup.reverse()) { try { f(); } catch { /* already gone */ } }
}
