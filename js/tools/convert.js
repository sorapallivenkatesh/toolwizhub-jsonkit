// convert.js — format conversion hub. js-yaml & papaparse are window globals.
import { isPlainObject, typeOf, esc } from "../core/util.js";

/* ---------- YAML ---------- */
export function toYAML(value) {
  if (!window.jsyaml) throw new Error("YAML library not loaded.");
  return window.jsyaml.dump(value, { indent: 2, lineWidth: 120, noRefs: true });
}
export function fromYAML(text) {
  if (!window.jsyaml) throw new Error("YAML library not loaded.");
  return window.jsyaml.load(text);
}

/* ---------- CSV / TSV ---------- */
export function toCSV(value, delimiter = ",") {
  if (!window.Papa) throw new Error("CSV library not loaded.");
  const rows = arrayOfObjects(value);
  return window.Papa.unparse(rows, { delimiter });
}
export function fromCSV(text, delimiter) {
  if (!window.Papa) throw new Error("CSV library not loaded.");
  const res = window.Papa.parse(text.trim(), {
    header: true, skipEmptyLines: true, dynamicTyping: true,
    delimiter: delimiter || undefined,
  });
  if (res.errors?.length) {
    const e = res.errors[0];
    throw new Error(`CSV parse error (row ${e.row}): ${e.message}`);
  }
  return res.data;
}

function arrayOfObjects(value) {
  if (Array.isArray(value)) {
    return value.map((r) => (isPlainObject(r) ? flat1(r) : { value: r }));
  }
  if (isPlainObject(value)) return [flat1(value)];
  return [{ value }];
}
// Flatten one level so nested objects become JSON strings in a cell.
function flat1(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    out[k] = v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  }
  return out;
}

/* ---------- XML (native DOMParser / serializer) ---------- */
export function toXML(value, root = "root") {
  const build = (v, name) => {
    const t = typeOf(v);
    if (t === "array") return v.map((el) => build(el, singular(name))).join("");
    if (t === "object") {
      const inner = Object.keys(v).map((k) => build(v[k], k)).join("");
      return `<${name}>${inner}</${name}>`;
    }
    if (t === "null") return `<${name}/>`;
    return `<${name}>${esc(String(v))}</${name}>`;
  };
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` + build(value, root);
  return prettyXML(xml);
}
function singular(n) { return n.endsWith("s") ? n.slice(0, -1) : "item"; }

export function fromXML(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("Invalid XML: " + err.textContent.split("\n")[0]);
  return elementToObj(doc.documentElement);
}
function elementToObj(el) {
  const obj = {};
  for (const attr of el.attributes) obj["@" + attr.name] = attr.value;
  const children = [...el.children];
  if (!children.length) {
    const text = el.textContent.trim();
    if (!Object.keys(obj).length) return coerce(text);
    if (text) obj["#text"] = coerce(text);
    return obj;
  }
  for (const child of children) {
    const val = elementToObj(child);
    if (child.tagName in obj) {
      if (!Array.isArray(obj[child.tagName])) obj[child.tagName] = [obj[child.tagName]];
      obj[child.tagName].push(val);
    } else obj[child.tagName] = val;
  }
  return obj;
}
function coerce(s) {
  if (s === "") return "";
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}
function prettyXML(xml) {
  let formatted = "", indent = 0;
  xml.replace(/></g, ">\n<").split("\n").forEach((node) => {
    if (/^<\/\w/.test(node)) indent--;
    formatted += "  ".repeat(Math.max(0, indent)) + node + "\n";
    if (/^<\w[^>]*[^/]>$/.test(node) && !node.startsWith("<?")) indent++;
  });
  return formatted.trim();
}

/* ---------- TOML (emit + simple parse) ---------- */
export function toTOML(value) {
  if (!isPlainObject(value)) throw new Error("TOML output requires a top-level object.");
  const lines = [];
  const scalars = [], tables = [];
  for (const k of Object.keys(value)) {
    const v = value[k];
    if (isPlainObject(v) || (Array.isArray(v) && v.every(isPlainObject) && v.length)) tables.push([k, v]);
    else scalars.push([k, v]);
  }
  for (const [k, v] of scalars) lines.push(`${tomlKey(k)} = ${tomlVal(v)}`);
  for (const [k, v] of tables) {
    if (Array.isArray(v)) {
      for (const item of v) { lines.push(`\n[[${k}]]`); lines.push(...tomlTable(item)); }
    } else {
      lines.push(`\n[${k}]`); lines.push(...tomlTable(v));
    }
  }
  return lines.join("\n").trim() + "\n";
}
function tomlTable(obj) {
  const out = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (isPlainObject(v)) continue; // nested tables simplified
    out.push(`${tomlKey(k)} = ${tomlVal(v)}`);
  }
  return out;
}
function tomlKey(k) { return /^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k); }
function tomlVal(v) {
  const t = typeOf(v);
  if (t === "string") return JSON.stringify(v);
  if (t === "number" || t === "boolean") return String(v);
  if (t === "null") return '""';
  if (t === "array") return "[" + v.map(tomlVal).join(", ") + "]";
  return JSON.stringify(JSON.stringify(v));
}
export function fromTOML(text) {
  const root = {};
  let cur = root;
  for (let raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^\[\[(.+)\]\]$/))) {
      const arr = (root[m[1].trim()] ||= []); cur = {}; arr.push(cur);
    } else if ((m = line.match(/^\[(.+)\]$/))) {
      cur = (root[m[1].trim()] ||= {});
    } else if ((m = line.match(/^([^=]+)=(.*)$/))) {
      cur[m[1].trim()] = parseTomlVal(m[2].trim());
    }
  }
  return root;
}
function parseTomlVal(s) {
  if (/^".*"$/.test(s) || /^'.*'$/.test(s)) return s.slice(1, -1);
  if (s === "true") return true; if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  if (/^\[.*\]$/.test(s)) { try { return JSON.parse(s.replace(/'/g, '"')); } catch { return s; } }
  return s;
}

/* ---------- query string ---------- */
export function toQueryString(value) {
  if (!isPlainObject(value)) throw new Error("Query string output requires an object.");
  const p = new URLSearchParams();
  for (const k of Object.keys(value)) {
    const v = value[k];
    p.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return p.toString();
}
export function fromQueryString(text) {
  const p = new URLSearchParams(text.replace(/^\?/, ""));
  const out = {};
  for (const [k, v] of p) out[k] = coerce(v);
  return out;
}

/* ---------- .env ---------- */
export function fromEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#")) {
      let v = m[2].replace(/^["']|["']$/g, "");
      out[m[1]] = coerce(v);
    }
  }
  return out;
}
export function toEnv(value) {
  if (!isPlainObject(value)) throw new Error(".env output requires a flat object.");
  return Object.keys(value).map((k) => {
    const v = value[k];
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return `${k.toUpperCase()}=${/\s/.test(s) ? JSON.stringify(s) : s}`;
  }).join("\n");
}

/* ---------- HTML & Markdown tables ---------- */
export function toHTMLTable(value) {
  const rows = arrayOfObjects(value);
  const cols = colsOf(rows);
  const head = cols.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = rows.map((r) =>
    "<tr>" + cols.map((c) => `<td>${esc(r[c] ?? "")}</td>`).join("") + "</tr>"
  ).join("\n");
  return `<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
}
export function toMarkdownTable(value) {
  const rows = arrayOfObjects(value);
  const cols = colsOf(rows);
  const head = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${cols.map((c) => String(r[c] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`).join("\n");
  return [head, sep, body].join("\n");
}
function colsOf(rows) {
  const cols = [], seen = new Set();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  return cols;
}
