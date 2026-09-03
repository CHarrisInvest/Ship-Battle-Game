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
const ref = join(root, "src", "shipref.js");

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

/**
 * THE FLEET THAT SAILS, which is not the whole table.
 *
 * `active` says whether a class is in the game. A class laid up keeps her row, with her figures as
 * they stood, and comes back when the column is flipped: the table is the fleet's whole history and
 * the game is the part of it currently at sea. Anything that is not a plain yes is laid up, so a
 * blank column reads as "no" rather than as "you decide".
 *
 * Two rows may therefore share an id, one sailing and one laid up, which is what happens when a class
 * is rebuilt: the new figures go in a new row and the old ones are kept beside them rather than
 * overwritten. Only the sailing half of the table is ever written out, so nothing downstream sees a
 * duplicate id, and `npm run workbook:read` refuses two rows that both sail.
 *
 * A table with no `active` column at all sails entire, which is how the mast, sail and gun tables
 * work and what the hull table did before the column existed.
 */
const atSea = (r) => r.active === undefined || /^(y|yes|true|1)$/i.test(r.active);
const fleet = (file) => readTable(file).filter(atSea);

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

/**
 * The reference columns: what a ship WAS, rather than what she is in a fight.
 *
 * Her dimensions, the shape of her, what she was built of, when and where she sailed and what for.
 * None of it is read by the game and all of it is wanted later, by whoever models the hulls: a class
 * drawn from her real length, beam, sheer and stern is a class that looks like herself.
 *
 * It goes to a module of its own rather than into `shipyard.js`, which is the catalogue the fight
 * reads and has no business carrying a tumblehome score. Anything not named here is a gameplay
 * column and the hull writer below knows what to do with it.
 */
const REFERENCE = [
  "era", "region", "role", "lod", "lbp", "beam", "draft", "depth", "freeboard", "lb", "bd",
  "burthen", "disp", "bowFine", "tumblehome", "deadrise", "sheer", "castle", "stern", "mastHeight",
  "decks", "wale", "topside", "roomSpace", "species", "timber", "crewMin", "cruise", "topSpeed",
  "manoeuvre", "histGuns", "battery",
];

/**
 * HER ESTABLISHMENT HAS TO ADD UP, because nothing downstream can tell that it does not.
 *
 * `battery` is where her guns actually stood: gun decks lowest first, then her upper works after a
 * plus. `hullform.js` draws her ports off it and never counts them again, so a figure short here is
 * a class that quietly sails with fewer ports than guns, which is exactly the fault the column was
 * added to end. The sum against `histGuns` is the check that catches it, and the even split is what
 * lets half of every deck go down each side.
 */
function checkBattery(r) {
  const where = `hulls.tsv: "${r.id}"`;
  const guns = number(r, "histGuns", "hulls.tsv");
  if (number(r, "broadside", "hulls.tsv") * 2 !== guns) {
    throw new Error(`${where} bears ${r.broadside} a side against ${guns} guns carried. Half her histGuns IS her broadside for every class in the fleet, which is what makes her ports and her guns the same count.`);
  }
  const [decks, works] = need(r, "battery", "hulls.tsv").split("+");
  const term = (t, what) => {
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${where} has "${t}" in her battery, which is not a count of guns`);
    if (n % 2) throw new Error(`${where} puts ${n} guns on ${what}, and a deck is pierced both sides, so it takes an even number`);
    return n;
  };
  const tiers = decks.split("/").map((t, i) => term(t, `gun deck ${i + 1}`));
  const above = works ? works.split("/").map((t, i) => term(t, i ? "her forecastle" : "her quarterdeck")) : [];
  if (tiers.some((n) => n === 0)) throw new Error(`${where} has a gun deck with no guns on it`);
  if (tiers.length > 3) throw new Error(`${where} has ${tiers.length} gun decks and nothing has ever drawn more than three`);
  if (above.length > 2) throw new Error(`${where} splits her upper works ${above.length} ways: write one figure for a battery running her whole length, or two for her quarterdeck and her forecastle`);
  const castle = number(r, "castle", "hulls.tsv");
  if (above.some((n) => n > 0) && castle < 2) throw new Error(`${where} carries guns on her upper works with a castle score of ${castle}, which is an open boat with no quarterdeck to stand them on`);
  if (above.length > 1 && above[1] > 0 && castle < 3) throw new Error(`${where} carries ${above[1]} guns on a forecastle she has not got: that wants a castle score of 3`);
  const sum = [...tiers, ...above].reduce((a, b) => a + b, 0);
  if (sum !== guns) throw new Error(`${where} musters ${sum} guns across her battery and carried ${guns}`);
}

function referenceRows() {
  return fleet("hulls.tsv").map((r) => {
    checkBattery(r);
    const fields = REFERENCE.filter((k) => r[k] !== undefined && r[k] !== "").map((k) => {
      const n = Number(r[k]);
      return `    ${k}: ${r[k] !== "" && Number.isFinite(n) ? n : str(r[k])},`;
    });
    return [`  ${need(r, "id", "hulls.tsv")}: {`, ...fields, "  },"].join("\n");
  });
}

function hullRows() {
  const file = "hulls.tsv";
  const seen = new Set();
  return fleet(file).map((r) => {
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
      // a blurb is optional: a class with none reads as her name and her figures, which is enough
      // to buy her by, and an invented line is worse than no line
      ...(r.blurb ? [`    blurb: ${str(r.blurb)},`] : []),
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
  return fleet(file).map((r) => {
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
  return fleet(file).map((r) => {
    const id = need(r, "id", file);
    if (seen.has(id)) throw new Error(`${file}: two sails share the id "${id}"`);
    seen.add(id);
    // `level` is a studdingsail's business and blank on everything else: which square sail up the
    // mast it booms out from, so it is only written where the table says something
    const level = maybe(r, "level");
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
      ...(level != null ? [`    level: ${level},`] : []),
      "  },",
    ].join("\n");
  });
}

function gunRows() {
  const file = "guns.tsv";
  const seen = new Set();
  return fleet(file).map((r) => {
    const id = need(r, "id", file);
    if (seen.has(id)) throw new Error(`${file}: two guns share the id "${id}"`);
    seen.add(id);
    // `group` is a swivel's business and blank on everything else, so it is only written where the
    // table actually says something
    const group = maybe(r, "group");
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
      ...(group != null ? [`    group: ${group},`] : []),
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
const reference = referenceRows();

// The reference table is a whole file rather than a block, because nothing hand-written belongs in
// it. `shipyard.js` must not import it: the catalogue reads what a ship IS, and this is what she was.
writeFileSync(ref, [
  "/**",
  " * WHAT EACH CLASS WAS: her dimensions, her shape, her timber, and where and when she sailed.",
  " *",
  " * GENERATED from data/hulls.tsv by `npm run import`. Edit the table, not this file.",
  " *",
  " * None of this is read by the game and all of it is wanted later. A hull drawn from her real",
  " * length, beam, sheer and stern is a hull that looks like herself, and a figure not recorded now",
  " * cannot be recovered when somebody comes to draw her. It is kept out of `shipyard.js` on purpose:",
  " * that file is the catalogue a fight reads, and a fight has no use for a tumblehome score.",
  " *",
  " * Lengths are feet, weights are tons, and the 1 to 5 spectra are the reference's own judgement",
  " * scores, 1 for least and 5 for most.",
  " */",
  "export const HULL_REF = {",
  reference.join("\n"),
  "};",
  "",
  "export const hullRef = (id) => HULL_REF[id] || null;",
  "",
].join("\n"));

let out = readFileSync(src, "utf8");
out = splice(out, "hulls", `const FLEET = [\n${hulls.join("\n")}\n];`);
out = splice(out, "masts", `export const MASTS = {\n${masts.join("\n")}\n};`);
out = splice(out, "sails", `export const SAILS = {\n${sails.join("\n")}\n};`);
out = splice(out, "guns", `export const GUNS = {\n${guns.join("\n")}\n};`);
writeFileSync(src, out);

console.log(`Wrote ${hulls.length} classes, ${masts.length} masts, ${sails.length} sails and ${guns.length} guns into src/shipyard.js,`);
console.log(`and what those ${reference.length} classes were into src/shipref.js.`);
console.log("Now run `npm run catalogue` to check the fleet is riggable and see where it lands.");
