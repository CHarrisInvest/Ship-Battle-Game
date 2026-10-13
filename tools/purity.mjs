/**
 * THE PURITY CHECK — `npm run purity`
 *
 * The engine under `src/sim/` has to run unchanged in a browser and in plain Node, and give the same
 * round twice from the same seed and the same inputs. Nothing enforces that but this. It fails if a
 * file there:
 *
 *   imports anything but another file under `src/sim/` or one of the catalogue modules that are
 *   already pure (`shipyard.js`, `shipref.js` and `hullform.js`). That shuts out React, the
 *   renderer, the menus, the hold, analytics, ads and consent in one rule, and anything from npm;
 *
 *   mentions the page or the clock or an unseeded random number: `window`, `document`,
 *   `localStorage`, `sessionStorage`, `navigator`, `globalThis`, a canvas, `requestAnimationFrame`,
 *   `Math.random`, `Date.now`, `new Date` or `performance`.
 *
 * The three catalogue modules are held to the same two rules, since the engine is only as pure as
 * what it imports. Comments are skipped, so a file can say in words what it must never call.
 * The smoke test runs this first, and so does the deploy, before the build.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SIM = join(root, "src", "sim");
const PURE = ["shipyard.js", "shipref.js", "hullform.js"].map((f) => join(root, "src", f));

const FORBIDDEN = [
  [/\bwindow\b/, "window"],
  [/\bdocument\b/, "document"],
  [/\blocalStorage\b/, "localStorage"],
  [/\bsessionStorage\b/, "sessionStorage"],
  [/\bnavigator\b/, "navigator"],
  [/\bglobalThis\b/, "globalThis"],
  [/\brequestAnimationFrame\b/, "requestAnimationFrame"],
  [/\bgetContext\b|\bCanvasRenderingContext2D\b|\bHTMLCanvasElement\b/, "a canvas"],
  [/\bMath\s*\.\s*random\b/, "Math.random"],
  [/\bDate\s*\.\s*now\b/, "Date.now"],
  [/\bnew\s+Date\b/, "new Date"],
  [/\bperformance\b/, "performance"],
];

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(m?js|jsx)$/.test(f) ? [p] : [];
});

/**
 * The source with its comments blanked out and everything else left where it was, so line numbers
 * still point at the right place. Strings and template literals are walked over rather than into,
 * so a `//` inside one does not start a comment.
 */
function code(src) {
  let out = "", i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") { out += " "; i++; }
    } else if (c === "/" && n === "*") {
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; }
      out += "  "; i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      out += c; i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") { out += src[i++]; }
        out += src[i++];
      }
      out += c; i++;
    } else { out += c; i++; }
  }
  return out;
}

const failures = [];
const at = (file, text, index) => `${relative(root, file)}:${text.slice(0, index).split("\n").length}`;

function check(file) {
  const text = code(readFileSync(file, "utf8"));
  for (const [re, name] of FORBIDDEN) {
    const m = re.exec(text);
    if (m) failures.push(`${at(file, text, m.index)} mentions ${name}`);
  }
  const imports = /\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*["']([^"']+)["']/g;
  for (const m of text.matchAll(imports)) {
    const spec = m[1] || m[2] || m[3];
    const target = spec.startsWith(".") ? resolve(dirname(file), spec) : null;
    const ok = target && (target.startsWith(SIM + "/") || PURE.includes(target));
    if (!ok) failures.push(`${at(file, text, m.index)} imports ${spec}`);
  }
}

const files = walk(SIM);
for (const f of files) check(f);
for (const f of PURE) check(f);

if (failures.length) {
  console.log("The engine is not pure:");
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log(`purity: ${files.length} engine files and ${PURE.length} catalogue modules are clean`);
