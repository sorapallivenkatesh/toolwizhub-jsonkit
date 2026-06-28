// analyze.js — structural stats, shape/schema-of-array detection,
// type distribution, deepest paths & largest values.
import { typeOf, walk, pathToString, byteLength } from "../core/util.js";

export function analyze(value, rawText) {
  let nodes = 0, leaves = 0, maxDepth = 0;
  const typeCounts = {};
  const keyCounts = {};
  let deepest = { depth: 0, path: "$" };
  const sizes = []; // {path, bytes}

  walk(value, (v, path) => {
    nodes++;
    const t = typeOf(v);
    typeCounts[t] = (typeCounts[t] || 0) + 1;
    if (typeof path[path.length - 1] === "string") {
      const k = path[path.length - 1];
      keyCounts[k] = (keyCounts[k] || 0) + 1;
    }
    const depth = path.length;
    if (depth > maxDepth) { maxDepth = depth; deepest = { depth, path: pathToString(path) }; }
    if (t !== "object" && t !== "array") leaves++;
    if (t === "string" || t === "object" || t === "array") {
      const b = byteLength(typeof v === "string" ? v : JSON.stringify(v));
      sizes.push({ path: pathToString(path), bytes: b, type: t });
    }
  });

  sizes.sort((a, b) => b.bytes - a.bytes);
  const topKeys = Object.entries(keyCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);

  return {
    nodes, leaves, maxDepth,
    typeCounts,
    uniqueKeys: Object.keys(keyCounts).length,
    topKeys,
    deepest,
    largest: sizes.slice(0, 10),
    minified: byteLength(JSON.stringify(value)),
    pretty: byteLength(JSON.stringify(value, null, 2)),
    input: rawText != null ? byteLength(rawText) : null,
  };
}

// Detect the shape of an array of objects: which keys are always/sometimes
// present and their value types.
export function shapeOf(value) {
  if (!Array.isArray(value)) throw new Error("Shape detection needs an array of objects.");
  const objs = value.filter((x) => x && typeof x === "object" && !Array.isArray(x));
  if (!objs.length) throw new Error("No objects found in the array.");
  const fields = {};
  for (const o of objs) {
    for (const k of Object.keys(o)) {
      const f = (fields[k] ||= { count: 0, types: {} });
      f.count++;
      const t = typeOf(o[k]);
      f.types[t] = (f.types[t] || 0) + 1;
    }
  }
  const total = objs.length;
  return Object.entries(fields).map(([k, f]) => ({
    key: k,
    presence: `${f.count}/${total}`,
    optional: f.count < total,
    types: Object.keys(f.types).join(" | "),
  })).sort((a, b) => a.key.localeCompare(b.key));
}
