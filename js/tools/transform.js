// transform.js — flatten/unflatten, key case conversion, key remove/rename,
// merge, group-by, JSON Patch (RFC 6902) apply, JSON Merge Patch (RFC 7386).
import {
  isPlainObject, mapKeysDeep, toCamel, toSnake, toPascal, toKebab, toConstant,
  clone,
} from "../core/util.js";

// Flatten nested structure to dot/bracket key → value pairs.
export function flatten(value, { delimiter = ".", arrays = true } = {}) {
  const out = {};
  const rec = (v, prefix) => {
    if (Array.isArray(v)) {
      if (!v.length) { if (prefix) out[prefix] = []; return; }
      v.forEach((el, i) => {
        const key = arrays ? `${prefix}${prefix ? delimiter : ""}${i}` : `${prefix}[${i}]`;
        rec(el, key);
      });
    } else if (isPlainObject(v)) {
      const keys = Object.keys(v);
      if (!keys.length) { if (prefix) out[prefix] = {}; return; }
      for (const k of keys) rec(v[k], prefix ? `${prefix}${delimiter}${k}` : k);
    } else {
      out[prefix] = v;
    }
  };
  rec(value, "");
  return out;
}

// Reverse of flatten (dot-delimited; numeric segments rebuild arrays).
export function unflatten(flat, { delimiter = "." } = {}) {
  const out = {};
  for (const key of Object.keys(flat)) {
    const parts = key.split(delimiter);
    let cur = out;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const isLast = i === parts.length - 1;
      const nextIsIdx = !isLast && /^\d+$/.test(parts[i + 1]);
      if (isLast) {
        cur[p] = flat[key];
      } else {
        if (cur[p] == null) cur[p] = nextIsIdx ? [] : {};
        cur = cur[p];
      }
    }
  }
  return normalizeArrays(out);
}

function normalizeArrays(v) {
  if (Array.isArray(v)) return v.map(normalizeArrays);
  if (isPlainObject(v)) {
    const keys = Object.keys(v);
    const allIdx = keys.length && keys.every((k) => /^\d+$/.test(k));
    if (allIdx) {
      const arr = [];
      for (const k of keys.sort((a, b) => a - b)) arr[Number(k)] = normalizeArrays(v[k]);
      return arr;
    }
    const out = {};
    for (const k of keys) out[k] = normalizeArrays(v[k]);
    return out;
  }
  return v;
}

const CASE_FNS = { camel: toCamel, snake: toSnake, pascal: toPascal, kebab: toKebab, constant: toConstant };
export function convertKeyCase(value, mode = "camel") {
  const fn = CASE_FNS[mode];
  if (!fn) throw new Error("Unknown case: " + mode);
  return mapKeysDeep(value, fn);
}

// Remove keys (comma-separated, deep).
export function removeKeys(value, keysCsv) {
  const set = new Set(keysCsv.split(",").map((s) => s.trim()).filter(Boolean));
  const rec = (v) => {
    if (Array.isArray(v)) return v.map(rec);
    if (isPlainObject(v)) {
      const out = {};
      for (const k of Object.keys(v)) if (!set.has(k)) out[k] = rec(v[k]);
      return out;
    }
    return v;
  };
  return rec(value);
}

// Keep only keys (deep).
export function pickKeys(value, keysCsv) {
  const set = new Set(keysCsv.split(",").map((s) => s.trim()).filter(Boolean));
  const rec = (v) => {
    if (Array.isArray(v)) return v.map(rec);
    if (isPlainObject(v)) {
      const out = {};
      for (const k of Object.keys(v)) if (set.has(k)) out[k] = rec(v[k]);
      return out;
    }
    return v;
  };
  return rec(value);
}

// Rename keys via "old:new, old2:new2" map (deep).
export function renameKeys(value, spec) {
  const map = {};
  for (const pair of spec.split(",")) {
    const [a, b] = pair.split(":").map((s) => s.trim());
    if (a && b) map[a] = b;
  }
  return mapKeysDeep(value, (k) => map[k] ?? k);
}

// Deep merge b into a (b wins on conflict).
export function deepMerge(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return b.slice();
  if (isPlainObject(a) && isPlainObject(b)) {
    const out = { ...a };
    for (const k of Object.keys(b)) out[k] = k in a ? deepMerge(a[k], b[k]) : b[k];
    return out;
  }
  return b;
}

// Group an array of objects by a key. Returns { groupValue: [items] }.
export function groupBy(value, key) {
  if (!Array.isArray(value)) throw new Error("group-by needs an array of objects");
  const out = {};
  for (const item of value) {
    const g = isPlainObject(item) ? item[key] : undefined;
    const gk = g === undefined ? "undefined" : String(g);
    (out[gk] ||= []).push(item);
  }
  return out;
}

// Apply RFC 6902 JSON Patch.
export function applyPatch(doc, patch) {
  if (!Array.isArray(patch)) throw new Error("Patch must be a JSON array of operations.");
  let target = clone(doc);
  for (const op of patch) {
    const path = parsePtr(op.path);
    switch (op.op) {
      case "add": ptrAdd(target, path, op.value); break;
      case "remove": ptrRemove(target, path); break;
      case "replace": ptrRemove(target, path); ptrAdd(target, path, op.value); break;
      case "move": { const v = ptrGet(target, parsePtr(op.from)); ptrRemove(target, parsePtr(op.from)); ptrAdd(target, path, v); break; }
      case "copy": { const v = ptrGet(target, parsePtr(op.from)); ptrAdd(target, path, clone(v)); break; }
      case "test": { const v = ptrGet(target, path); if (JSON.stringify(v) !== JSON.stringify(op.value)) throw new Error(`test failed at ${op.path}`); break; }
      default: throw new Error("Unknown op: " + op.op);
    }
  }
  return target;
}

// RFC 7386 JSON Merge Patch.
export function mergePatch(doc, patch) {
  const rec = (target, p) => {
    if (!isPlainObject(p)) return clone(p);
    const out = isPlainObject(target) ? { ...target } : {};
    for (const k of Object.keys(p)) {
      if (p[k] === null) delete out[k];
      else out[k] = rec(out[k], p[k]);
    }
    return out;
  };
  return rec(clone(doc), patch);
}

function parsePtr(p) {
  if (p === "") return [];
  return p.split("/").slice(1).map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
}
function ptrGet(root, path) {
  let cur = root;
  for (const k of path) cur = cur[k];
  return cur;
}
function ptrAdd(root, path, value) {
  if (!path.length) return;
  const parent = ptrGet(root, path.slice(0, -1));
  const last = path[path.length - 1];
  if (Array.isArray(parent)) {
    if (last === "-") parent.push(value);
    else parent.splice(Number(last), 0, value);
  } else parent[last] = value;
}
function ptrRemove(root, path) {
  const parent = ptrGet(root, path.slice(0, -1));
  const last = path[path.length - 1];
  if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else delete parent[last];
}
