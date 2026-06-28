// format.js — beautify, minify, stringify/unstringify, sort, clean, canonicalize.
import { sortKeysDeep, isPlainObject } from "../core/util.js";

export function beautify(value, indent = 2) {
  const ind = indent === "tab" ? "\t" : Number(indent);
  return JSON.stringify(value, null, ind);
}

export function minify(value) {
  return JSON.stringify(value);
}

// Wrap a JSON value as an escaped JSON string literal (for embedding in code).
export function stringify(value, indent = 0) {
  const json = indent ? JSON.stringify(value, null, Number(indent)) : JSON.stringify(value);
  return JSON.stringify(json);
}

// Reverse of stringify: a string literal containing JSON → the JSON value text.
export function unstringify(rawText) {
  const trimmed = rawText.trim();
  // If the whole input is a JSON string, unwrap once.
  const inner = JSON.parse(trimmed);
  if (typeof inner !== "string") {
    throw new Error("Input is not a JSON string literal. Wrap the JSON in quotes first.");
  }
  // inner may itself be JSON — pretty-print it if so.
  try { return JSON.stringify(JSON.parse(inner), null, 2); }
  catch { return inner; }
}

export function sortKeys(value, dir = "asc", indent = 2) {
  return beautify(sortKeysDeep(value, dir), indent);
}

// Remove nulls, empty strings/arrays/objects per options.
export function clean(value, opts = {}) {
  const { nulls = true, emptyStrings = false, emptyArrays = true, emptyObjects = true } = opts;
  const rec = (v) => {
    if (Array.isArray(v)) {
      const arr = v.map(rec).filter((x) => !isDrop(x));
      return arr;
    }
    if (isPlainObject(v)) {
      const out = {};
      for (const k of Object.keys(v)) {
        const cleaned = rec(v[k]);
        if (!isDrop(cleaned)) out[k] = cleaned;
      }
      return out;
    }
    return v;
  };
  const isDrop = (v) => {
    if (nulls && v === null) return true;
    if (emptyStrings && v === "") return true;
    if (emptyArrays && Array.isArray(v) && v.length === 0) return true;
    if (emptyObjects && isPlainObject(v) && Object.keys(v).length === 0) return true;
    return false;
  };
  return rec(value);
}

// RFC 8785 JSON Canonicalization Scheme: sorted keys, minimal numbers, no ws.
export function canonicalize(value) {
  const ser = (v) => {
    if (v === null) return "null";
    const t = typeof v;
    if (t === "number") {
      if (!Number.isFinite(v)) throw new Error("Cannot canonicalize non-finite number");
      return canonNumber(v);
    }
    if (t === "boolean") return v ? "true" : "false";
    if (t === "string") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(ser).join(",") + "]";
    const keys = Object.keys(v).sort(codeUnitCompare);
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + ser(v[k])).join(",") + "}";
  };
  return ser(value);
}

function canonNumber(n) {
  if (Number.isInteger(n)) return String(n);
  return String(n); // V8 already emits shortest round-trippable form
}
function codeUnitCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
