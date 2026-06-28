// view.js — interactive tree view and tabular view builders.
import { typeOf, isPlainObject, esc, pathToString } from "../core/util.js";

// Build the HTML for a collapsible tree. Returns an HTML string; main.js wires
// click-to-collapse via event delegation.
export function treeHTML(value) {
  return `<div class="tree">${node("$", value, [], true)}</div>`;
}

function node(key, val, path, isRoot) {
  const t = typeOf(val);
  const keyHtml = isRoot ? "" : `<span class="t-key">${esc(key)}</span><span class="t-colon">:</span> `;
  if (t === "array" || t === "object") {
    const entries = t === "array"
      ? val.map((v, i) => [i, v])
      : Object.keys(val).map((k) => [k, val[k]]);
    const open = t === "array" ? "[" : "{";
    const close = t === "array" ? "]" : "}";
    const count = entries.length;
    const p = esc(pathToString(path));
    if (count === 0) {
      return `<div class="t-row" data-path="${p}">${keyHtml}<span class="t-punc">${open}${close}</span></div>`;
    }
    const children = entries
      .map(([k, v]) => node(k, v, path.concat(k), false))
      .join("");
    return `<div class="t-branch" data-path="${p}">
      <div class="t-row t-toggle" role="button" tabindex="0">
        <span class="t-caret">▾</span>${keyHtml}<span class="t-punc">${open}</span><span class="t-count">${count}</span><span class="t-punc t-close-inline">${close}</span>
      </div>
      <div class="t-children">${children}</div>
      <div class="t-row t-closer"><span class="t-punc">${close}</span></div>
    </div>`;
  }
  // leaf
  let cls = "t-val t-" + t;
  let disp;
  if (t === "string") disp = `"${esc(val)}"`;
  else if (t === "null") disp = "null";
  else disp = esc(String(val));
  const p = esc(pathToString(path));
  return `<div class="t-row t-leaf" data-path="${p}">${keyHtml}<span class="${cls}">${disp}</span></div>`;
}

// Table view: best when value is an array of objects (rows). Falls back to a
// flat key/value table for a single object.
export function tableView(value) {
  if (Array.isArray(value) && value.every((r) => isPlainObject(r))) {
    const cols = [];
    const seen = new Set();
    for (const row of value) for (const k of Object.keys(row)) {
      if (!seen.has(k)) { seen.add(k); cols.push(k); }
    }
    const rows = value.map((row) =>
      cols.map((c) => cell(row[c]))
    );
    return { columns: ["#", ...cols], rows: rows.map((r, i) => [String(i), ...r]) };
  }
  if (isPlainObject(value)) {
    return {
      columns: ["key", "value"],
      rows: Object.keys(value).map((k) => [k, cell(value[k])]),
    };
  }
  if (Array.isArray(value)) {
    return { columns: ["#", "value"], rows: value.map((v, i) => [String(i), cell(v)]) };
  }
  return { columns: ["value"], rows: [[cell(value)]] };
}

function cell(v) {
  const t = typeOf(v);
  if (t === "object" || t === "array") return JSON.stringify(v);
  if (t === "null") return "null";
  return String(v);
}
