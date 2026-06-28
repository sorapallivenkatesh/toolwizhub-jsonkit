// diff.js — semantic (key-aware) diff between two JSON values, plus an
// RFC 6902 JSON Patch generator.
import { typeOf, deepEqual, pathToString, isPlainObject } from "../core/util.js";

// Returns a flat list of changes: {type:'add'|'remove'|'change', path, before, after}
export function diff(a, b) {
  const changes = [];
  const rec = (x, y, path) => {
    if (deepEqual(x, y)) return;
    const tx = typeOf(x), ty = typeOf(y);
    if (tx !== ty || (tx !== "object" && tx !== "array")) {
      changes.push({ type: "change", path: path.slice(), before: x, after: y });
      return;
    }
    if (tx === "array") {
      const max = Math.max(x.length, y.length);
      for (let i = 0; i < max; i++) {
        if (i >= x.length) changes.push({ type: "add", path: path.concat(i), after: y[i] });
        else if (i >= y.length) changes.push({ type: "remove", path: path.concat(i), before: x[i] });
        else rec(x[i], y[i], path.concat(i));
      }
      return;
    }
    // object
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const k of keys) {
      const inX = k in x, inY = k in y;
      if (inX && !inY) changes.push({ type: "remove", path: path.concat(k), before: x[k] });
      else if (!inX && inY) changes.push({ type: "add", path: path.concat(k), after: y[k] });
      else rec(x[k], y[k], path.concat(k));
    }
  };
  rec(a, b, []);
  return changes;
}

// Pretty summary lines for the output panel.
export function diffReport(a, b) {
  const changes = diff(a, b);
  const lines = changes.map((c) => {
    const p = pathToString(c.path);
    if (c.type === "add") return { sign: "+", path: p, text: short(c.after) };
    if (c.type === "remove") return { sign: "-", path: p, text: short(c.before) };
    return { sign: "~", path: p, text: `${short(c.before)} → ${short(c.after)}` };
  });
  const counts = {
    add: changes.filter((c) => c.type === "add").length,
    remove: changes.filter((c) => c.type === "remove").length,
    change: changes.filter((c) => c.type === "change").length,
  };
  return { lines, counts, total: changes.length };
}

// Generate an RFC 6902 patch that turns a into b.
export function makePatch(a, b) {
  const changes = diff(a, b);
  return changes.map((c) => {
    const pointer = "/" + c.path.map((k) => String(k).replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
    if (c.type === "add") return { op: "add", path: pointer, value: c.after };
    if (c.type === "remove") return { op: "remove", path: pointer };
    return { op: "replace", path: pointer, value: c.after };
  });
}

function short(v) {
  const s = JSON.stringify(v);
  if (s == null) return "undefined";
  return s.length > 80 ? s.slice(0, 77) + "…" : s;
}
