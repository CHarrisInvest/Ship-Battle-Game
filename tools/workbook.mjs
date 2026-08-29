/**
 * THE WORKBOOK — `npm run workbook` and `npm run workbook:read`
 *
 * One spreadsheet with the whole catalogue in it: a sheet of hulls, a sheet of masts, a sheet of
 * sails, a sheet of guns, and a sheet explaining what every column means. It opens in Apple Numbers,
 * in Excel, and in anything else that reads .xlsx.
 *
 *   npm run workbook        writes data/ships.xlsx from the four tables
 *   npm run workbook:read   writes the four tables back from data/ships.xlsx
 *
 * THE TSVs REMAIN THE SOURCE. The workbook is a way of editing them, not a second copy of the
 * catalogue: `npm run import` still reads the tables and nothing reads the spreadsheet. So the loop
 * is write, edit in Numbers, read back, import, bench:
 *
 *   npm run workbook  ->  edit and export to .xlsx  ->  npm run workbook:read
 *                     ->  npm run import  ->  npm run catalogue
 *
 * Reading back keeps the comment block at the head of each table, because that is where the columns
 * are documented and a spreadsheet has nowhere to put it. It also keeps a figure written the way it
 * was written: a height of 0.60 comes back 0.60 rather than 0.6, so a round trip that changed
 * nothing changes nothing.
 *
 * What it does not keep is anything else Numbers can do. Formulas come back as their last computed
 * value, and colours, comments, extra sheets and charts are simply not read. Work in formulas if
 * they help; what lands in the table is the number they worked out.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve as resolvePath } from "node:path";
import { writeWorkbook, readWorkbook } from "./xlsx.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultBook = join(root, "data", "ships.xlsx");

const TABLES = [
  { file: "hulls.tsv", sheet: "Hulls", what: "classes" },
  { file: "masts.tsv", sheet: "Masts", what: "masts" },
  { file: "sails.tsv", sheet: "Sails", what: "sails" },
  { file: "guns.tsv", sheet: "Guns", what: "guns" },
];

/* ---- the tables ------------------------------------------------------------------------------- */

/**
 * A table is its comment block, its header, and its rows. The comments come back out unchanged when
 * the table is rewritten, so the documentation at the head of each file survives a trip through a
 * spreadsheet that has nowhere to keep it.
 */
function readTable(file) {
  const lines = readFileSync(join(root, "data", file), "utf8")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""));

  const notes = [];
  const tail = [];
  let header = null;
  const rows = [];
  for (const line of lines) {
    if (line.startsWith("#")) {
      (header ? tail : notes).push(line);
      continue;
    }
    if (!line.trim()) continue;
    const cells = line.split("\t").map((c) => c.trim());
    if (!header) header = cells;
    else rows.push(cells);
  }
  if (!header) throw new Error(`data/${file} has no header row`);
  return { file, notes, tail, header, rows };
}

// A cell cannot hold a tab or a newline, because the table is tab separated and one row to a line.
// A blurb pasted out of somewhere else can carry both, so they become spaces rather than a file that
// no longer parses.
const flat = (v) => String(v ?? "").replace(/[\t\r\n]+/g, " ").trim();

function writeTable(table) {
  const body = [
    ...table.notes,
    table.header.join("\t"),
    ...table.rows.map((r) => table.header.map((_, i) => flat(r[i])).join("\t")),
    ...table.tail,
    "",
  ].join("\n");
  writeFileSync(join(root, "data", table.file), body);
}

/* ---- writing the workbook --------------------------------------------------------------------- */

// Wide enough to read, narrow enough that a blurb does not push everything else off the screen.
// A captain scrolling a column of prose can widen it; a captain hunting for `canvas` cannot narrow
// forty of them.
function widths(header, rows) {
  return header.map((h, i) => {
    const longest = rows.reduce((n, r) => Math.max(n, String(r[i] ?? "").length), h.length);
    return Math.max(6, Math.min(46, longest + 2));
  });
}

// The comment block of each table, laid out as a sheet. It is the only documentation a person
// editing in Numbers can see, so it is worth carrying across in full rather than summarising.
function readmeSheet(tables) {
  const rows = [
    ["Sternchase: the ship catalogue"],
    [],
    ["Four sheets, and each one is a table the game is built from. Edit them here, then run the two"],
    ["commands below to put the changes back into the game."],
    [],
    ["  1. File > Export To > Excel, saved over data/ships.xlsx"],
    ["  2. npm run workbook:read     puts the sheets back into data/*.tsv"],
    ["  3. npm run import            writes the tables into the game's catalogue"],
    ["  4. npm run catalogue         checks the fleet and prints it side by side"],
    [],
    ["Step 4 is the one that matters. A hull that cannot be rigged, a mast no sail fits, a berth the"],
    ["renderer cannot draw: none of those break anything loudly at runtime, and the bench catches all"],
    ["of them. Run it after every change."],
    [],
    ["A few things to know before editing:"],
    [],
    ["  Each row's id is its key. Adding a row adds a ship or a part; deleting a row removes it."],
    ["  An id is a short camelCase word, unique in its sheet, and it must be a plain word: letters"],
    ["  and digits, no spaces or punctuation."],
    [],
    ["  Changing an id is the same as deleting one ship and adding another. Any saved captain who"],
    ["  owned the old one loses her, so rename in the name column and leave the id alone."],
    [],
    ["  A ship's tier is measured, never declared. Nothing here sets how strong a class is directly:"],
    ["  it comes out of her figures, so a class you make faster and better armed climbs the ladder"],
    ["  by herself and starts meeting harder opponents."],
    [],
    ["  A blank is a missing figure, not a sensible default. Left empty, a hull's speed, hand, canvas"],
    ["  and tons each fall back to 1, which is right for no class above a boat, and every other"],
    ["  column but a blurb has to be filled."],
    [],
    ["  The Columns sheet is the legend: every column of every sheet, what it means, and whether the"],
    ["  fight reads it, the drawing reads it, or nothing reads it yet."],
    [],
    ["  Formulas are fine. What comes back into the table is the value a formula worked out, not the"],
    ["  formula, so a column of prices scaled by a factor lands as prices."],
    [],
    ["  Anything else Numbers can do is not read back: colours, comments, extra sheets, extra rows"],
    ["  below the table. Add a column and nothing will read it."],
    [],
  ];
  for (const t of tables) {
    rows.push([]);
    rows.push([`${t.sheet}, from data/${t.file}`]);
    rows.push([]);
    for (const line of t.notes) rows.push([line.replace(/^#\s?/, "")]);
  }
  return { name: "Read me", rows, freeze: false, widths: [104] };
}

/**
 * THE LEGEND, and it is parsed rather than written.
 *
 * Every column is already documented at the head of its own table, in the shape `# name  what it
 * is`, with anything indented under it belonging to the entry above. Writing the same definitions
 * out again here would give the catalogue two legends to disagree with each other, so this reads the
 * one that exists. A column with nothing said about it is reported when the workbook is written,
 * which is the only way a new column gets documented before it is used.
 */
function definitions(notes) {
  const out = new Map();
  let open = null;
  for (const line of notes) {
    const entry = line.match(/^#\s(\w+(?:,\s*\w+)*)\s{2,}(\S.*)$/);
    if (entry) {
      open = entry[1].split(/,\s*/);
      for (const name of open) out.set(name, (out.get(name) ? out.get(name) + " " : "") + entry[2].trim());
      continue;
    }
    const more = line.match(/^#\s{6,}(\S.*)$/);
    if (more && open) {
      for (const name of open) out.set(name, out.get(name) + " " + more[1].trim());
      continue;
    }
    open = null;
  }
  return out;
}

/**
 * Which of the three things a column is: a figure the game plays with, a figure the hull is drawn
 * from, or one recorded and not yet read by anything.
 *
 * The drawn ones are found by asking `hullform.js` what it actually reads, rather than by keeping a
 * list here that would go stale the first time somebody drew a hull from her deadrise. Everything
 * from `era` rightward is reference, which is the split `import.mjs` writes on.
 */
function reading(header) {
  let art = null;
  try {
    art = readFileSync(join(root, "src", "hullform.js"), "utf8");
  } catch {
    art = "";
  }
  const first = header.indexOf("era");
  return (column, i) => {
    if (first < 0 || i < first) return "The fight";
    if (new RegExp(`\\bref\\.${column}\\b`).test(art)) return "Her drawing";
    return "Recorded only";
  };
}

function columnSheet(tables) {
  const rows = [["Sheet", "Column", "Read by", "What it is"]];
  const missing = [];
  const disagree = [];
  for (const t of tables) {
    const said = definitions(t.notes);
    const how = t.sheet === "Hulls" ? reading(t.header) : () => "The fight";
    t.header.forEach((column, i) => {
      const text = said.get(column) || "";
      if (!text) missing.push(`${t.sheet}.${column}`);
      const read = how(column, i);
      // The table marks a reference column `(drawn)` by hand and `hullform.js` is asked the same
      // question above. The mark is dropped here, where the sheet has a column saying it better, but
      // the two are compared first: a mark that has gone out of step with the art is worth hearing
      // about, in either direction.
      const marked = /^\(drawn\)/.test(text);
      if (marked !== (read === "Her drawing") && text) disagree.push(`${t.sheet}.${column}`);
      rows.push([t.sheet, column, read, text.replace(/^\(drawn\)\s*/, "")]);
    });
  }
  return {
    sheet: { name: "Columns", rows, widths: [9, 13, 15, 100] },
    missing,
    disagree,
  };
}

function write(to) {
  const tables = TABLES.map((t) => ({ ...t, ...readTable(t.file) }));
  const legend = columnSheet(tables);
  const sheets = [
    readmeSheet(tables),
    legend.sheet,
    ...tables.map((t) => ({
      name: t.sheet,
      rows: [t.header, ...t.rows],
      widths: widths(t.header, t.rows),
    })),
  ];
  writeFileSync(to, writeWorkbook(sheets));
  console.log(`Wrote ${to.replace(root + "/", "")}:`);
  for (const t of tables) console.log(`  ${t.sheet.padEnd(6)} ${String(t.rows.length).padStart(3)} ${t.what}`);
  if (legend.missing.length) {
    console.log(`  ${legend.missing.length} column${legend.missing.length === 1 ? " has" : "s have"} no line in the legend: ${legend.missing.join(", ")}.`);
    console.log("  Document it at the head of its table and it lands on the Columns sheet.");
  }
  if (legend.disagree.length) {
    console.log(`  marked (drawn) but not what hullform.js reads, or the other way about: ${legend.disagree.join(", ")}.`);
  }
  console.log("Open it in Numbers. When you are done: export to .xlsx over the same file, then");
  console.log("`npm run workbook:read && npm run import && npm run catalogue`.");
}

/* ---- reading it back -------------------------------------------------------------------------- */

const NUMERIC = /^-?(\d+\.?\d*|\.\d+)$/;
const ID = /^[A-Za-z][A-Za-z0-9]*$/;

// A number the spreadsheet handed back is the same number the table already held if they are equal
// as numbers, and in that case the table's own spelling of it wins: 0.60 stays 0.60 and 1.0 stays
// 1.0, so a round trip with no edits in it produces no diff.
const same = (was, now) =>
  was != null && was !== now && NUMERIC.test(was) && NUMERIC.test(now) && Number(was) === Number(now);

/**
 * The sheet a table came from, by name.
 *
 * Numbers holds tables inside sheets and exports one Excel sheet per table, so a sheet whose table
 * has been renamed comes back as "Hulls-Table 1" rather than "Hulls". Matching the front of the name
 * costs nothing and saves a captain renaming things back to make an export land.
 */
function findSheet(sheets, want) {
  if (sheets.has(want)) return sheets.get(want);
  const key = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const [name, grid] of sheets) {
    if (key(name) === key(want) || key(name).startsWith(key(want) + " ")) return grid;
  }
  return null;
}

function sheetToTable(table, grid, problems) {
  const where = `the ${table.sheet} sheet`;
  if (!grid || !grid.length) {
    problems.push(`${where} is empty`);
    return null;
  }

  const head = grid[0].map((c) => String(c).trim());
  const missing = table.header.filter((h) => !head.includes(h));
  if (missing.length) {
    problems.push(`${where} has no ${missing.join(", ")} column${missing.length > 1 ? "s" : ""}`);
    return null;
  }
  const extra = head.filter((h) => h && !table.header.includes(h));
  if (extra.length) {
    console.log(`  note: ${where} has a ${extra.join(", ")} column that nothing reads. Left out.`);
  }

  const idCol = head.indexOf("id");
  const was = new Map(table.rows.map((r) => [r[table.header.indexOf("id")], r]));

  const rows = [];
  const seen = new Set();
  grid.slice(1).forEach((cells, i) => {
    const line = i + 2;
    if (cells.every((c) => !String(c ?? "").trim())) return; // a blank row is a deleted one
    const id = flat(cells[idCol]);
    if (!id) {
      problems.push(`${where} row ${line} has figures in it but no id`);
      return;
    }
    if (!ID.test(id)) {
      problems.push(`${where} row ${line}: "${id}" is not a usable id. Letters and digits, starting with a letter, no spaces.`);
      return;
    }
    if (seen.has(id)) {
      problems.push(`${where} row ${line}: two rows share the id "${id}"`);
      return;
    }
    seen.add(id);

    const old = was.get(id);
    rows.push(
      table.header.map((h) => {
        const now = flat(cells[head.indexOf(h)]);
        const before = old ? old[table.header.indexOf(h)] : null;
        return same(before, now) ? before : now;
      }),
    );
  });

  return { ...table, rows };
}

async function read(from) {
  if (!existsSync(from)) {
    console.error(`No workbook at ${from}.`);
    console.error("Run `npm run workbook` to write one, or pass the path to yours:");
    console.error("  npm run workbook:read -- ~/Downloads/ships.xlsx");
    process.exit(1);
  }

  const sheets = readWorkbook(readFileSync(from));
  const problems = [];
  const tables = [];
  for (const t of TABLES) {
    const table = readTable(t.file);
    const grid = findSheet(sheets, t.sheet);
    if (!grid) {
      problems.push(`the workbook has no ${t.sheet} sheet. Its sheets are: ${[...sheets.keys()].join(", ")}`);
      continue;
    }
    const next = sheetToTable({ ...t, ...table }, grid, problems);
    if (next) tables.push(next);
  }

  if (problems.length) {
    console.error(`${problems.length} problem${problems.length === 1 ? "" : "s"} with the workbook, and nothing was written:`);
    for (const p of problems) console.error("  " + p);
    process.exit(1);
  }

  for (const t of tables) writeTable(t);

  console.log(`Read ${from.replace(root + "/", "")}:`);
  for (const t of tables) {
    const before = readTable(t.file); // what was just written, so the count is the count on disk
    console.log(`  data/${t.file.padEnd(10)} ${String(before.rows.length).padStart(3)} ${t.what}`);
  }

  await starterCheck(tables);

  console.log("Now run `npm run import && npm run catalogue`.");
}

/**
 * The first ship is hand-written in `shipyard.js` and names a hull, a mast, a sail and three guns by
 * id. Delete one of those rows and every new captain starts with a ship that cannot be built, which
 * is a fault nothing else reports until somebody plays. So it is checked here, where the row was
 * deleted, rather than left to be discovered.
 */
async function starterCheck(tables) {
  let STARTER;
  try {
    ({ STARTER } = await import("../src/shipyard.js"));
  } catch {
    return;
  }
  const ids = new Map(tables.map((t) => [t.sheet, new Set(t.rows.map((r) => r[t.header.indexOf("id")]))]));
  const wanted = [
    ["Hulls", STARTER.hull],
    ...Object.values(STARTER.rig).flatMap((r) => [["Masts", r.mast], ...(r.sails || []).map((s) => ["Sails", s])]),
    ...Object.values(STARTER.guns).flat().map((g) => ["Guns", g]),
  ];
  const gone = wanted.filter(([sheet, id]) => id && ids.get(sheet) && !ids.get(sheet).has(id));
  if (!gone.length) return;
  console.log("");
  console.log("CAREFUL: the first ship every captain starts with is built from rows that are now gone:");
  for (const [sheet, id] of gone) console.log(`  ${sheet}: ${id}`);
  console.log("Point STARTER in src/shipyard.js at what replaced them, or a new captain gets nothing.");
}

/* ---- the command ------------------------------------------------------------------------------ */

const args = process.argv.slice(2);
const wantsRead = args.includes("--read");
const path = args.find((a) => !a.startsWith("--"));
const file = path ? resolvePath(process.cwd(), path) : defaultBook;

if (wantsRead) await read(file);
else write(file);
