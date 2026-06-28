// codegen.js — generate types/classes from a JSON sample, infer JSON Schema,
// produce sample data from a schema, and emit SQL DDL.
import { typeOf, isPlainObject, toPascal, toSnake } from "../core/util.js";

/* ---------- shared type model ---------- */
// Build a registry of named object shapes plus a root type reference.
function buildModel(value, rootName = "Root") {
  const structs = new Map(); // name -> {fields: Map(key -> {types:Set, optional, ref}) }

  const merge = (name, obj, count) => {
    let s = structs.get(name);
    if (!s) { s = { fields: new Map(), seen: 0 }; structs.set(name, s); }
    s.seen += 1;
    const keys = new Set(Object.keys(obj));
    for (const k of keys) {
      let f = s.fields.get(k);
      if (!f) { f = { types: new Set(), child: null, count: 0 }; s.fields.set(k, f); }
      f.count++;
      describe(obj[k], k, f);
    }
  };

  const describe = (v, keyHint, field) => {
    const t = typeOf(v);
    if (t === "object") {
      const name = uniqueName(toPascal(singular(keyHint)) || "Obj");
      field.types.add("ref:" + name);
      field.child = name;
      merge(name, v);
    } else if (t === "array") {
      field.types.add("array");
      field.array ||= { types: new Set(), child: null };
      for (const el of v) {
        const et = typeOf(el);
        if (et === "object") {
          const name = uniqueName(toPascal(singular(keyHint)) || "Item");
          field.array.types.add("ref:" + name);
          field.array.child = name;
          merge(name, el);
        } else field.array.types.add(et === "number" && Number.isInteger(el) ? "integer" : et);
      }
    } else {
      field.types.add(t === "number" && Number.isInteger(v) ? "integer" : t);
    }
  };

  const used = new Set();
  function uniqueName(base) {
    base = base || "Type";
    if (structs.has(base) || used.has(base)) return base; // reuse same-named shape
    used.add(base);
    return base;
  }

  // root
  const t = typeOf(value);
  if (t === "object") { merge(rootName, value); return { structs, root: "ref:" + rootName }; }
  if (t === "array") {
    const f = { types: new Set(), child: null, array: { types: new Set() } };
    describe(value, rootName, f);
    return { structs, root: "array", rootField: f };
  }
  return { structs, root: t };
}

function singular(n) {
  if (!n) return n;
  if (/ies$/.test(n)) return n.slice(0, -3) + "y";
  if (/s$/.test(n) && !/ss$/.test(n)) return n.slice(0, -1);
  return n;
}

function fieldTypes(field) { return [...field.types]; }
function isOptional(struct, field) { return field.count < struct.seen; }

/* ---------- TypeScript ---------- */
export function toTypeScript(value) {
  const { structs } = buildModel(value, "Root");
  const map = { string: "string", number: "number", integer: "number", boolean: "boolean", null: "null" };
  const tsType = (types, field) => {
    const parts = new Set();
    for (const t of types) {
      if (t.startsWith("ref:")) parts.add(t.slice(4));
      else if (t === "array") parts.add(arrType(field?.array));
      else parts.add(map[t] ?? "any");
    }
    return [...parts].join(" | ") || "any";
  };
  const arrType = (arr) => {
    if (!arr) return "any[]";
    const inner = [...arr.types].map((t) => t.startsWith("ref:") ? t.slice(4) : (map[t] ?? "any"));
    return (inner.length ? [...new Set(inner)].join(" | ") : "any") + "[]";
  };
  let out = [];
  for (const [name, s] of structs) {
    out.push(`export interface ${name} {`);
    for (const [k, f] of s.fields) {
      const opt = isOptional(s, f) ? "?" : "";
      out.push(`  ${safeKey(k)}${opt}: ${tsType(fieldTypes(f), f)};`);
    }
    out.push("}", "");
  }
  return out.join("\n").trim() + "\n";
}
function safeKey(k) { return /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k); }

/* ---------- Go ---------- */
export function toGo(value) {
  const { structs } = buildModel(value, "Root");
  const map = { string: "string", number: "float64", integer: "int", boolean: "bool", null: "interface{}" };
  const goType = (types, field) => {
    for (const t of types) {
      if (t.startsWith("ref:")) return "*" + t.slice(4);
      if (t === "array") {
        const a = field.array;
        const it = a ? [...a.types][0] : null;
        if (it?.startsWith("ref:")) return "[]" + it.slice(4);
        return "[]" + (map[it] ?? "interface{}");
      }
    }
    return map[[...types][0]] ?? "interface{}";
  };
  let out = [];
  for (const [name, s] of structs) {
    out.push(`type ${name} struct {`);
    for (const [k, f] of s.fields) {
      out.push(`\t${toPascal(k)} ${goType(fieldTypes(f), f)} \`json:"${k}${isOptional(s, f) ? ",omitempty" : ""}"\``);
    }
    out.push("}", "");
  }
  return out.join("\n").trim() + "\n";
}

/* ---------- Python ---------- */
export function toPython(value, flavor = "dataclass") {
  const { structs } = buildModel(value, "Root");
  const map = { string: "str", number: "float", integer: "int", boolean: "bool", null: "None" };
  const pyType = (types, field) => {
    const opt = types.has?.("null");
    let core;
    const arr = [...types].filter((t) => t !== "null");
    const t0 = arr[0];
    if (t0?.startsWith("ref:")) core = t0.slice(4);
    else if (t0 === "array") {
      const a = field.array; const it = a ? [...a.types][0] : null;
      core = "List[" + (it?.startsWith("ref:") ? it.slice(4) : (map[it] ?? "Any")) + "]";
    } else core = map[t0] ?? "Any";
    return opt ? `Optional[${core}]` : core;
  };
  let out = [];
  const ordered = [...structs].reverse(); // dependencies first
  if (flavor === "pydantic") out.push("from __future__ import annotations", "from typing import Any, List, Optional", "from pydantic import BaseModel", "");
  else if (flavor === "typeddict") out.push("from __future__ import annotations", "from typing import Any, List, Optional, TypedDict", "");
  else out.push("from __future__ import annotations", "from dataclasses import dataclass", "from typing import Any, List, Optional", "");
  for (const [name, s] of ordered) {
    if (flavor === "pydantic") out.push(`class ${name}(BaseModel):`);
    else if (flavor === "typeddict") out.push(`class ${name}(TypedDict):`);
    else { out.push("@dataclass"); out.push(`class ${name}:`); }
    if (!s.fields.size) out.push("    pass");
    for (const [k, f] of s.fields) {
      out.push(`    ${toSnake(k)}: ${pyType(f.types, f)}`);
    }
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}

/* ---------- Other languages (concise but real) ---------- */
export function toJava(value) {
  const { structs } = buildModel(value, "Root");
  const map = { string: "String", number: "double", integer: "int", boolean: "boolean", null: "Object" };
  const jt = (types, field) => {
    const t = [...types][0];
    if (t?.startsWith("ref:")) return t.slice(4);
    if (t === "array") { const it = field.array ? [...field.array.types][0] : null; return "List<" + (it?.startsWith("ref:") ? it.slice(4) : boxed(map[it])) + ">"; }
    return map[t] ?? "Object";
  };
  let out = ['import java.util.List;', ''];
  for (const [name, s] of structs) {
    out.push(`public class ${name} {`);
    for (const [k, f] of s.fields) out.push(`    public ${jt(f.types, f)} ${k};`);
    out.push("}", "");
  }
  return out.join("\n").trim() + "\n";
}
function boxed(t) { return ({ int: "Integer", double: "Double", boolean: "Boolean" })[t] ?? (t || "Object"); }

export function toCSharp(value) {
  const { structs } = buildModel(value, "Root");
  const map = { string: "string", number: "double", integer: "int", boolean: "bool", null: "object" };
  const ct = (types, field) => {
    const t = [...types][0];
    if (t?.startsWith("ref:")) return t.slice(4);
    if (t === "array") { const it = field.array ? [...field.array.types][0] : null; return "List<" + (it?.startsWith("ref:") ? it.slice(4) : (map[it] ?? "object")) + ">"; }
    return map[t] ?? "object";
  };
  let out = ["using System.Collections.Generic;", ""];
  for (const [name, s] of structs) {
    out.push(`public class ${name}`, "{");
    for (const [k, f] of s.fields) out.push(`    public ${ct(f.types, f)} ${toPascal(k)} { get; set; }`);
    out.push("}", "");
  }
  return out.join("\n").trim() + "\n";
}

export function toRust(value) {
  const { structs } = buildModel(value, "Root");
  const map = { string: "String", number: "f64", integer: "i64", boolean: "bool", null: "Option<()>" };
  const rt = (types, field) => {
    const t = [...types][0];
    if (t?.startsWith("ref:")) return t.slice(4);
    if (t === "array") { const it = field.array ? [...field.array.types][0] : null; return "Vec<" + (it?.startsWith("ref:") ? it.slice(4) : (map[it] ?? "serde_json::Value")) + ">"; }
    return map[t] ?? "serde_json::Value";
  };
  let out = ["use serde::{Deserialize, Serialize};", ""];
  for (const [name, s] of structs) {
    out.push("#[derive(Serialize, Deserialize, Debug)]");
    out.push(`pub struct ${name} {`);
    for (const [k, f] of s.fields) {
      const rename = /^[a-z][a-z0-9_]*$/.test(k) ? "" : `    #[serde(rename = "${k}")]\n`;
      out.push(`${rename}    pub ${toSnake(k)}: ${rt(f.types, f)},`);
    }
    out.push("}", "");
  }
  return out.join("\n").trim() + "\n";
}

export function toKotlin(value) {
  const { structs } = buildModel(value, "Root");
  const map = { string: "String", number: "Double", integer: "Int", boolean: "Boolean", null: "Any?" };
  const kt = (types, field) => {
    const t = [...types][0];
    if (t?.startsWith("ref:")) return t.slice(4);
    if (t === "array") { const it = field.array ? [...field.array.types][0] : null; return "List<" + (it?.startsWith("ref:") ? it.slice(4) : (map[it] ?? "Any")) + ">"; }
    return map[t] ?? "Any";
  };
  let out = [];
  for (const [name, s] of structs) {
    out.push(`data class ${name}(`);
    const fs = [...s.fields];
    fs.forEach(([k, f], i) => out.push(`    val ${k}: ${kt(f.types, f)}${isOptional(s, f) ? "? = null" : ""}${i < fs.length - 1 ? "," : ""}`));
    out.push(")", "");
  }
  return out.join("\n").trim() + "\n";
}

export function toSwift(value) {
  const { structs } = buildModel(value, "Root");
  const map = { string: "String", number: "Double", integer: "Int", boolean: "Bool", null: "String?" };
  const st = (types, field) => {
    const t = [...types][0];
    if (t?.startsWith("ref:")) return t.slice(4);
    if (t === "array") { const it = field.array ? [...field.array.types][0] : null; return "[" + (it?.startsWith("ref:") ? it.slice(4) : (map[it] ?? "String")) + "]"; }
    return map[t] ?? "String";
  };
  let out = [];
  for (const [name, s] of structs) {
    out.push(`struct ${name}: Codable {`);
    for (const [k, f] of s.fields) out.push(`    let ${k}: ${st(f.types, f)}${isOptional(s, f) ? "?" : ""}`);
    out.push("}", "");
  }
  return out.join("\n").trim() + "\n";
}

/* ---------- JSON Schema (infer) ---------- */
export function inferSchema(value) {
  const schema = { $schema: "https://json-schema.org/draft/2020-12/schema", ...node(value) };
  return schema;
  function node(v) {
    const t = typeOf(v);
    if (t === "object") {
      const props = {}, required = [];
      for (const k of Object.keys(v)) { props[k] = node(v[k]); required.push(k); }
      return { type: "object", properties: props, ...(required.length ? { required } : {}) };
    }
    if (t === "array") {
      if (!v.length) return { type: "array", items: {} };
      // merge item schemas
      const items = v.map(node);
      return { type: "array", items: mergeSchemas(items) };
    }
    if (t === "integer" || (t === "number" && Number.isInteger(v))) return { type: "integer" };
    if (t === "number") return { type: "number" };
    if (t === "null") return { type: "null" };
    return { type: t };
  }
}
function mergeSchemas(list) {
  // naive: if all equal type+props, take first; else anyOf of unique
  const uniq = [];
  const seen = new Set();
  for (const s of list) { const k = JSON.stringify(s); if (!seen.has(k)) { seen.add(k); uniq.push(s); } }
  if (uniq.length === 1) return uniq[0];
  // merge objects by union of properties
  if (uniq.every((s) => s.type === "object")) {
    const props = {}; const counts = {};
    for (const s of uniq) for (const k of Object.keys(s.properties || {})) { props[k] = s.properties[k]; counts[k] = (counts[k] || 0) + 1; }
    const required = Object.keys(counts).filter((k) => counts[k] === uniq.length);
    return { type: "object", properties: props, ...(required.length ? { required } : {}) };
  }
  return { anyOf: uniq };
}

/* ---------- Schema → sample data ---------- */
export function sampleFromSchema(schema) {
  const gen = (s) => {
    if (!s || typeof s !== "object") return null;
    if (s.examples?.length) return s.examples[0];
    if (s.default !== undefined) return s.default;
    if (s.enum) return s.enum[0];
    if (s.anyOf) return gen(s.anyOf[0]);
    if (s.oneOf) return gen(s.oneOf[0]);
    switch (s.type) {
      case "object": {
        const o = {};
        for (const k of Object.keys(s.properties || {})) o[k] = gen(s.properties[k]);
        return o;
      }
      case "array": return [gen(s.items || {})];
      case "integer": return s.minimum ?? 0;
      case "number": return s.minimum ?? 0;
      case "boolean": return true;
      case "null": return null;
      case "string": return s.format === "date-time" ? "2026-01-01T00:00:00Z" : (s.format === "email" ? "user@example.com" : "string");
      default: return null;
    }
  };
  return gen(schema);
}

/* ---------- SQL DDL ---------- */
export function toSQL(value, table = "data") {
  const rows = Array.isArray(value) ? value : [value];
  if (!rows.length || !isPlainObject(rows[0])) throw new Error("SQL needs an array of objects (or one object).");
  const cols = [];
  const seen = new Set();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  const sqlType = (k) => {
    let t = "TEXT";
    for (const r of rows) {
      const v = r[k];
      if (v == null) continue;
      if (typeof v === "boolean") { t = "BOOLEAN"; break; }
      if (typeof v === "number") { t = Number.isInteger(v) ? "INTEGER" : "REAL"; }
      else { t = "TEXT"; break; }
    }
    return t;
  };
  const ddl = `CREATE TABLE ${ident(table)} (\n` +
    cols.map((c) => `  ${ident(toSnake(c))} ${sqlType(c)}`).join(",\n") + "\n);";
  const inserts = rows.map((r) =>
    `INSERT INTO ${ident(table)} (${cols.map((c) => ident(toSnake(c))).join(", ")}) VALUES (` +
    cols.map((c) => sqlVal(r[c])).join(", ") + ");"
  ).join("\n");
  return ddl + "\n\n" + inserts + "\n";
}
function ident(s) { return /^[a-z_][a-z0-9_]*$/i.test(s) ? s : `"${s}"`; }
function sqlVal(v) {
  if (v == null) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "object") return "'" + JSON.stringify(v).replace(/'/g, "''") + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
}
