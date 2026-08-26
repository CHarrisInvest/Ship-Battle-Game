/**
 * THE IMPORTER — `npm run import`
 *
 * Reads `data/hulls.tsv`, `data/masts.tsv` and `data/sails.tsv` and writes them into
 * `src/shipyard.js`, between the markers that fence off the generated blocks.
 *
 * Why generate into the source rather than have the game read a table at runtime: `shipyard.js`
 * imports nothing and holds no state, and that is worth keeping. A parser in the bundle to read a
 * file that never changes at runtime would be machinery for nothing. So the tables are the thing a
 * person edits, the source is the thing the game reads, and this closes the gap between them.
 *
 * It writes; it does not check. `npm run catalogue` is what says whether the result is a fleet that
 * can be rigged, and it is the next thing to run.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src", "shipyard.js");

/* ---- reading ---------------------------------------------------------------------------------- */

// Tab separated, `#` comments, blank lines ignored. A spreadsheet exports this and a person can read
// it, which is the whole reason it is not JSON.
function readTable(file) {
  const lines = readFileSync(join(root, "data", file), "utf8")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim() && !l.startsWith("#"));
  if (!lines.length) throw new Error(`${file} has no rows`);
  const head = lines[0].split("\t").map((h) => h.trim());
  return lines.slice(1).map((line, i) => {
    const cells = line.split("\t");
    if (cells.length !== head.length) {
      throw new Error(`${file} row ${i + 1} has ${cells.length} columns, header has ${head.length}. A stray tab in a blurb?`);
    }
    return Object.fromEntries(head.map((h, c) => [h, cells[c].trim()]));
  });
}

const str = (v) => JSON.stringify(v);
const need = (row, col, file) => {
  if (!row[col]) throw new Error(`${file}: "${row.id || "?"}" has no ${col}`);
  return row[col];
};
const number = (row, col, file) => {
  const v = Number(need(row, col, file));
  if (!Number.isFinite(v)) throw new Error(`${file}: "${row.id}" has ${col} of "${row[col]}", which is not a number`);
  return v;
};
// blank means "you work it out", so it comes through as undefined and the builder's default applies
const maybe = (row, col) => (row[col] === "" || row[col] == null ? null : Number(row[col]));
const yesNo = (v) => /^(y|yes|true|1)$/i.test(v);

/* ---- writing ---------------------------------------------------------------------------------- */

function hullRows() {
  const file = "hulls.tsv";
  const seen = new Set();
  return readTable(file).map((r) => {
    const id = need(r, "id", file);
    if (seen.has(id)) throw new Error(`${file}: two classes share the id "${id}"`);
    seen.add(id);
    const masts = need(r, "masts", file).split(/\s+/).filter(Boolean);
    const optional = [
      ["speed", maybe(r, "speed")],
      ["hand", maybe(r, "hand")],
      ["canvas", maybe(r, "canvas")],
      ["tons", maybe(r, "tons")],
    ]
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    return [
      "  {",
      `    id: ${str(id)}, name: ${str(need(r, "name", file))}, price: ${number(r, "price", file)},`,
      `    blurb: ${str(need(r, "blurb", file))},`,
      `    hull: ${number(r, "hull", file)}, crew: ${number(r, "crew", file)}${optional ? ", " + optional : ""},`,
      `    guns: [${number(r, "broadside", file)}, ${number(r, "bow", file)}, ${number(r, "swivel", file)}],` +
        ` masts: [${masts.map(str).join(", ")}]` +
        (yesNo(r.bowsprit) ? "," : ", bowsprit: false,"),
      "  },",
    ].join("\n");
  });
}

function mastRows() {
  const file = "masts.tsv";
  const seen = new Set();
  return readTable(file).map((r) => {
    const id = need(r, "id", file);
    if (seen.has(id)) throw new Error(`${file}: two masts share the id "${id}"`);
    seen.add(id);
    const berths = need(r, "berths", file)
      .split(/\s+/)
      .filter(Boolean)
      .map((b) => `{ kind: ${str(b.toUpperCase())} }`);
    return [
      `  ${id}: {`,
      `    id: ${str(id)},`,
      `    part: "mast",`,
      `    name: ${str(need(r, "name", file))},`,
      `    price: ${number(r, "price", file)},`,
      `    blurb: ${str(need(r, "blurb", file))},`,
      `    size: ${str(need(r, "size", file))},`,
      ...(yesNo(r.spar) ? ['    spar: true,'] : []),
      `    height: ${number(r, "height", file)},`,
      `    berths: [${berths.join(", ")}],`,
      "  },",
    ].join("\n");
  });
}

function sailRows() {
  const file = "sails.tsv";
  const seen = new Set();
  return readTable(file).map((r) => {
    const id = need(r, "id", file);
    if (seen.has(id)) throw new Error(`${file}: two sails share the id "${id}"`);
    seen.add(id);
    return [
      `  ${id}: {`,
      `    id: ${str(id)},`,
      `    part: "sail",`,
      `    kind: ${str(need(r, "kind", file).toUpperCase())},`,
      `    name: ${str(need(r, "name", file))},`,
      `    price: ${number(r, "price", file)},`,
      `    blurb: ${str(need(r, "blurb", file))},`,
      `    drive: ${number(r, "drive", file)},`,
      `    hand: ${number(r, "hand", file)},`,
      "  },",
    ].join("\n");
  });
}

function gunRows() {
  const file = "guns.tsv";
  const seen = new Set();
  return readTable(file).map((r) => {
    const id = need(r, "id", file);
    if (seen.has(id)) throw new Error(`${file}: two guns share the id "${id}"`);
    seen.add(id);
    return [
      `  ${id}: {`,
      `    id: ${str(id)},`,
      `    part: "gun",`,
      `    name: ${str(need(r, "name", file))},`,
      `    price: ${number(r, "price", file)},`,
      `    blurb: ${str(need(r, "blurb", file))},`,
      `    mount: ${str(need(r, "mount", file))},`,
      `    damage: ${number(r, "damage", file)},`,
      `    reload: ${number(r, "reload", file)},`,
      `    weight: ${number(r, "weight", file)},`,
      "  },",
    ].join("\n");
  });
}

// Replace what sits between a pair of markers, leaving the markers and everything around them alone.
function splice(text, tag, body) {
  const open = `/* generated:${tag} -- edit data/${tag}.tsv and run \`npm run import\` */`;
  const close = `/* end:${tag} */`;
  const a = text.indexOf(open);
  const b = text.indexOf(close);
  if (a < 0 || b < 0) throw new Error(`src/shipyard.js has no ${tag} markers to write between`);
  return text.slice(0, a + open.length) + "\n" + body + "\n" + text.slice(b);
}

const hulls = hullRows();
const masts = mastRows();
const sails = sailRows();
const guns = gunRows();

let out = readFileSync(src, "utf8");
out = splice(out, "hulls", `const FLEET = [\n${hulls.join("\n")}\n];`);
out = splice(out, "masts", `export const MASTS = {\n${masts.join("\n")}\n};`);
out = splice(out, "sails", `export const SAILS = {\n${sails.join("\n")}\n};`);
out = splice(out, "guns", `export const GUNS = {\n${guns.join("\n")}\n};`);
writeFileSync(src, out);

console.log(`Wrote ${hulls.length} classes, ${masts.length} masts, ${sails.length} sails and ${guns.length} guns into src/shipyard.js.`);
console.log("Now run `npm run catalogue` to check the fleet is riggable and see where it lands.");
