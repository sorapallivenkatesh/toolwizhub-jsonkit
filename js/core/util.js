// util.js — pure helpers shared across tools. No DOM, no libs.

export const typeOf = (v) => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v; // object | string | number | boolean | undefined
};

export const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

export const isContainer = (v) => v !== null && typeof v === "object";

// Stable deep clone (handles plain JSON shapes).
export const clone = (v) =>
  v === undefined ? v : JSON.parse(JSON.stringify(v));

// Deep structural equality, order-insensitive for object keys.
export function deepEqual(a, b) {
  if (a === b) return true;
  const ta = typeOf(a), tb = typeOf(b);
  if (ta !== tb) return false;
  if (ta === "array") {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (ta === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  // numbers: treat NaN equal to NaN for diffing convenience
  if (ta === "number" && Number.isNaN(a) && Number.isNaN(b)) return true;
  return false;
}

// Walk every node depth-first. cb(value, pathArray, parent, keyOrIndex).
export function walk(root, cb) {
  const rec = (val, path, parent, key) => {
    cb(val, path, parent, key);
    if (Array.isArray(val)) {
      val.forEach((v, i) => rec(v, path.concat(i), val, i));
    } else if (isPlainObject(val)) {
      for (const k of Object.keys(val)) rec(val[k], path.concat(k), val, k);
    }
  };
  rec(root, [], null, null);
}

// Render a path array to a readable JS-ish accessor: $.a.b[0].c
export function pathToString(path) {
  let out = "$";
  for (const p of path) {
    if (typeof p === "number") out += `[${p}]`;
    else if (/^[A-Za-z_$][\w$]*$/.test(p)) out += `.${p}`;
    else out += `[${JSON.stringify(p)}]`;
  }
  return out;
}

// RFC 6901 JSON Pointer for a path array.
export function pathToPointer(path) {
  if (!path.length) return "";
  return "/" + path
    .map((p) => String(p).replace(/~/g, "~0").replace(/\//g, "~1"))
    .join("/");
}

// Get value at a path array; returns {found, value}.
export function getAtPath(root, path) {
  let cur = root;
  for (const p of path) {
    if (cur == null || typeof cur !== "object") return { found: false };
    if (!(p in cur)) return { found: false };
    cur = cur[p];
  }
  return { found: true, value: cur };
}

// Set value at a path array (mutates, creating containers as needed).
export function setAtPath(root, path, value) {
  if (!path.length) return value;
  let cur = root;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (cur[k] == null || typeof cur[k] !== "object") {
      cur[k] = typeof path[i + 1] === "number" ? [] : {};
    }
    cur = cur[k];
  }
  cur[path[path.length - 1]] = value;
  return root;
}

export function delAtPath(root, path) {
  if (!path.length) return root;
  const { found, value: parent } = getAtPath(root, path.slice(0, -1));
  if (!found || parent == null || typeof parent !== "object") return root;
  const last = path[path.length - 1];
  if (Array.isArray(parent) && typeof last === "number") parent.splice(last, 1);
  else delete parent[last];
  return root;
}

// Sort object keys recursively (returns new value).
export function sortKeysDeep(v, dir = "asc") {
  if (Array.isArray(v)) return v.map((x) => sortKeysDeep(x, dir));
  if (isPlainObject(v)) {
    const keys = Object.keys(v).sort((a, b) =>
      dir === "desc" ? b.localeCompare(a) : a.localeCompare(b)
    );
    const out = {};
    for (const k of keys) out[k] = sortKeysDeep(v[k], dir);
    return out;
  }
  return v;
}

// Human byte size.
export function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function byteLength(str) {
  return new TextEncoder().encode(str).length;
}

// Case conversions for keys.
const words = (s) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

export const toCamel = (s) => {
  const w = words(s);
  if (!w.length) return s;
  return w[0].toLowerCase() + w.slice(1).map(cap).join("");
};
export const toPascal = (s) => words(s).map(cap).join("") || s;
export const toSnake = (s) => words(s).map((x) => x.toLowerCase()).join("_") || s;
export const toKebab = (s) => words(s).map((x) => x.toLowerCase()).join("-") || s;
export const toConstant = (s) => words(s).map((x) => x.toUpperCase()).join("_") || s;
function cap(w) {
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

// Transform every key in a structure with fn.
export function mapKeysDeep(v, fn) {
  if (Array.isArray(v)) return v.map((x) => mapKeysDeep(x, fn));
  if (isPlainObject(v)) {
    const out = {};
    for (const k of Object.keys(v)) out[fn(k)] = mapKeysDeep(v[k], fn);
    return out;
  }
  return v;
}

// Escape HTML for safe injection into the output panel.
export function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Lightweight JSON syntax highlighter → HTML. Operates on raw (possibly partial)
// JSON text: only string/number/literal tokens are wrapped+escaped; structural
// chars (the gaps) are JSON-safe (no <>&) and pass through untouched. Tolerates
// incomplete input (used live in the editor), so unterminated strings just don't
// match — no crash.
export function highlightJSON(json) {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g;
  return String(json).replace(re, (m, str, colon, lit, num) => {
    if (str !== undefined) {
      const span = `<span class="hl-${colon ? "key" : "str"}">${esc(str)}</span>`;
      return colon ? span + `<span class="hl-punc">${colon}</span>` : span;
    }
    if (lit !== undefined) return `<span class="hl-${lit === "null" ? "null" : "bool"}">${lit}</span>`;
    if (num !== undefined) return `<span class="hl-num">${num}</span>`;
    return m;
  });
}

// Copy text to clipboard with a graceful fallback.
export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch {}
    document.body.removeChild(ta);
    return ok;
  }
}

export function download(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
