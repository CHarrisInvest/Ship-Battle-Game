/**
 * A SPREADSHEET, WRITTEN AND READ BY HAND.
 *
 * An .xlsx file is a zip of XML, and both halves of that are small enough to do here rather than
 * take a dependency for. The repository has four runtime packages and two dev ones, and a workbook
 * that a person opens twice a month is not a reason to add a seventh.
 *
 * What this knows is the thin middle of the format: a sheet is a grid of strings and numbers with a
 * bold first row. No formulas, no merged cells, no charts. Anything Numbers adds beyond that is
 * simply not read back, which is the deliberate trade: the tables stay the source, the workbook is a
 * way of editing them.
 *
 * `writeWorkbook` takes sheets of cells and returns a Buffer. `readWorkbook` takes a Buffer and
 * returns sheets of strings, which is what the TSVs want anyway.
 */

import { deflateRawSync, inflateRawSync } from "node:zlib";

/* ---- zip -------------------------------------------------------------------------------------- */

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// A fixed timestamp, so writing the same tables twice produces the same bytes and git has nothing to
// say about a file nobody changed. 1 Jan 1980 is the earliest a DOS date can hold.
const DOS_TIME = 0;
const DOS_DATE = (1 << 9) | (1 << 5) | 1;

function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    const body = deflateRawSync(raw, { level: 9 });
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += local.length + name.length + body.length;
  }

  const dirBytes = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirBytes, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

// Read the central directory rather than walking local headers: a local header may say nothing about
// its own size and point at a descriptor after the data, which Numbers does use.
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file: no end-of-directory record");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("zip directory is damaged");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const at = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    const localExtra = buf.readUInt16LE(at + 28);
    const localName = buf.readUInt16LE(at + 26);
    const start = at + 30 + localName + localExtra;
    const body = buf.subarray(start, start + size);
    out.set(name, method === 0 ? body : inflateRawSync(body));

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/* ---- xml -------------------------------------------------------------------------------------- */

const CONTROL = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]", "g");

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // control characters are not legal in XML at all, and a stray one in a pasted blurb would make
    // the whole workbook unopenable rather than one cell wrong
    .replace(CONTROL, "");

const unesc = (s) =>
  String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

function colName(i) {
  let s = "";
  for (let n = i + 1; n > 0; ) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = (n - r - 1) / 26;
  }
  return s;
}

function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/i)?.[0] || "A";
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/* ---- writing ---------------------------------------------------------------------------------- */

// A cell is a number if it reads as one whole and plainly. "1650-1865" is an era and "1-2" is a
// range of decks, and neither is arithmetic, so the test is deliberately strict.
const NUMERIC = /^-?(\d+\.?\d*|\.\d+)$/;

function sheetXml(rows, { freeze = true, widths = [] } = {}) {
  const body = rows
    .map((cells, r) => {
      const out = cells
        .map((v, c) => {
          if (v === "" || v == null) return "";
          const ref = `${colName(c)}${r + 1}`;
          const style = r === 0 ? ' s="1"' : "";
          if (typeof v === "number" || (typeof v === "string" && NUMERIC.test(v))) {
            return `<c r="${ref}"${style}><v>${Number(v)}</v></c>`;
          }
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        })
        .join("");
      return out ? `<row r="${r + 1}">${out}</row>` : "";
    })
    .join("");

  const cols = widths.length
    ? `<cols>${widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(2)}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";
  const pane = freeze
    ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Helvetica Neue"/></font><font><b/><sz val="11"/><name val="Helvetica Neue"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/**
 * sheets: [{ name, rows: [[cell, ...], ...], widths?: [number], freeze?: boolean }]
 */
export function writeWorkbook(sheets) {
  const files = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/styles.xml", data: STYLES },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: sheetXml(s.rows, { freeze: s.freeze !== false, widths: s.widths || [] }),
    })),
  ];
  return zip(files);
}

/* ---- reading ---------------------------------------------------------------------------------- */

// Numbers writes a number back as a float, so a price of 260 can return as 259.99999999999997 and a
// drive of 0.7 as 0.7000000000000001. Twelve significant figures is far past anything the tables
// hold and short of where the noise lives.
function tidy(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const s = String(Number(n.toPrecision(12)));
  return s === "-0" ? "0" : s;
}

function sharedStrings(parts) {
  const xml = parts.get("xl/sharedStrings.xml");
  if (!xml) return [];
  return [...xml.toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    // one <si> may be many runs; a shared string is their text end to end
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1])).join(""),
  );
}

/**
 * Returns a Map of sheet name to rows of strings. Trailing empty cells and trailing empty rows are
 * dropped, because a spreadsheet is full of them and a table is not.
 */
export function readWorkbook(buf) {
  const parts = unzip(buf);
  const wb = parts.get("xl/workbook.xml")?.toString("utf8");
  if (!wb) throw new Error("this is not a spreadsheet: no xl/workbook.xml inside it");
  const rels = parts.get("xl/_rels/workbook.xml.rels")?.toString("utf8") || "";

  const target = new Map();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const id = m[1].match(/Id="([^"]+)"/)?.[1];
    const to = m[1].match(/Target="([^"]+)"/)?.[1];
    if (id && to) target.set(id, to.replace(/^\/?(xl\/)?/, "xl/"));
  }

  const strings = sharedStrings(parts);
  const sheets = new Map();

  for (const m of wb.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const name = unesc(m[1].match(/name="([^"]*)"/)?.[1] || "");
    const rid = m[1].match(/r:id="([^"]+)"/)?.[1];
    const path = target.get(rid);
    const xml = path && parts.get(path);
    if (!xml) continue;

    const rows = [];
    for (const r of xml.toString("utf8").matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const at = Number(r[1].match(/\br="(\d+)"/)?.[1] || rows.length + 1) - 1;
      const cells = [];
      let next = 0;
      for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = c[1].match(/\br="([A-Z]+\d+)"/i)?.[1];
        const col = ref ? colIndex(ref) : next;
        next = col + 1;
        const type = c[1].match(/\bt="([^"]+)"/)?.[1] || "n";
        const inner = c[2] || "";
        let value = "";
        if (type === "inlineStr") {
          value = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1])).join("");
        } else {
          // a formula's cached result lives in <v> just as a literal does, so both land here
          const raw = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1];
          if (raw == null) value = "";
          else if (type === "s") value = strings[Number(raw)] ?? "";
          else if (type === "str") value = unesc(raw);
          else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
          else if (type === "e") value = unesc(raw);
          else value = tidy(unesc(raw));
        }
        cells[col] = value;
      }
      rows[at] = Array.from(cells, (v) => (v == null ? "" : v));
    }

    const grid = Array.from(rows, (r) => r || []);
    while (grid.length && grid[grid.length - 1].every((v) => !String(v).trim())) grid.pop();
    sheets.set(name, grid.map((r) => {
      const out = [...r];
      while (out.length && !String(out[out.length - 1]).trim()) out.pop();
      return out;
    }));
  }

  return sheets;
}
