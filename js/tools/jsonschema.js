// jsonschema.js — validate a JSON document against a JSON Schema.
// Pure JS, dependency-free. Covers the common draft 2020-12 / draft-07 keywords:
// type, enum, const, required, properties, patternProperties, additionalProperties,
// items, prefixItems, contains, min/maxItems, uniqueItems, min/max(+exclusive),
// multipleOf, min/maxLength, pattern, format (common), min/maxProperties,
// allOf/anyOf/oneOf/not, and local $ref (#/...). Returns a list of errors.

import { typeOf, deepEqual } from "../core/util.js";

const FORMATS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  "date-time": /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/,
  uri: /^[a-z][a-z0-9+.-]*:\/?\/?[^\s]*$/i,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  ipv4: /^(\d{1,3}\.){3}\d{1,3}$/,
  hostname: /^[a-z0-9.-]+$/i,
};

export function validateSchema(data, schema) {
  if (typeOf(schema) !== "object" && typeof schema !== "boolean")
    throw new Error("Schema (panel B) must be a JSON object or boolean.");
  const errors = [];
  const root = schema;
  check(data, schema, "", errors, root);
  return errors;
}

function resolveRef(ref, root) {
  if (!ref.startsWith("#")) return null; // only local refs supported
  const path = ref.slice(1).split("/").filter(Boolean).map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur = root;
  for (const p of path) {
    if (cur == null || typeof cur !== "object") return null;
    cur = cur[p];
  }
  return cur;
}

function err(errors, path, message) {
  errors.push({ path: path || "(root)", message });
}

function check(data, schema, path, errors, root) {
  if (schema === true || schema === undefined) return;
  if (schema === false) { err(errors, path, "no value is allowed here"); return; }

  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, root);
    if (resolved === null) err(errors, path, `cannot resolve $ref "${schema.$ref}"`);
    else check(data, resolved, path, errors, root);
    return;
  }

  const t = typeOf(data);
  const jsonType = t === "number" && Number.isInteger(data) ? "integer" : t;

  // type
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = types.some((ty) =>
      ty === jsonType || (ty === "number" && t === "number") || (ty === "integer" && t === "number" && Number.isInteger(data))
    );
    if (!ok) err(errors, path, `expected type ${types.join(" or ")}, got ${jsonType}`);
  }

  // const / enum
  if ("const" in schema && !deepEqual(data, schema.const))
    err(errors, path, `must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => deepEqual(data, e)))
    err(errors, path, `must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);

  // combinators
  if (schema.allOf) schema.allOf.forEach((s) => check(data, s, path, errors, root));
  if (schema.anyOf && !schema.anyOf.some((s) => valid(data, s, root)))
    err(errors, path, "does not match any schema in anyOf");
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((s) => valid(data, s, root)).length;
    if (matches !== 1) err(errors, path, `must match exactly one schema in oneOf (matched ${matches})`);
  }
  if (schema.not && valid(data, schema.not, root)) err(errors, path, "must not match the 'not' schema");

  // by type
  if (t === "string") checkString(data, schema, path, errors);
  else if (t === "number") checkNumber(data, schema, path, errors);
  else if (t === "array") checkArray(data, schema, path, errors, root);
  else if (t === "object") checkObject(data, schema, path, errors, root);
}

function valid(data, schema, root) {
  const e = [];
  check(data, schema, "", e, root);
  return e.length === 0;
}

function checkString(s, schema, path, errors) {
  if (schema.minLength != null && s.length < schema.minLength) err(errors, path, `shorter than minLength ${schema.minLength}`);
  if (schema.maxLength != null && s.length > schema.maxLength) err(errors, path, `longer than maxLength ${schema.maxLength}`);
  if (schema.pattern && !new RegExp(schema.pattern).test(s)) err(errors, path, `does not match pattern /${schema.pattern}/`);
  if (schema.format && FORMATS[schema.format] && !FORMATS[schema.format].test(s)) err(errors, path, `not a valid ${schema.format}`);
}

function checkNumber(n, schema, path, errors) {
  if (schema.minimum != null && n < schema.minimum) err(errors, path, `less than minimum ${schema.minimum}`);
  if (schema.maximum != null && n > schema.maximum) err(errors, path, `greater than maximum ${schema.maximum}`);
  if (schema.exclusiveMinimum != null && n <= schema.exclusiveMinimum) err(errors, path, `must be > ${schema.exclusiveMinimum}`);
  if (schema.exclusiveMaximum != null && n >= schema.exclusiveMaximum) err(errors, path, `must be < ${schema.exclusiveMaximum}`);
  if (schema.multipleOf != null && !Number.isInteger(n / schema.multipleOf)) err(errors, path, `not a multiple of ${schema.multipleOf}`);
}

function checkArray(arr, schema, path, errors, root) {
  if (schema.minItems != null && arr.length < schema.minItems) err(errors, path, `fewer than minItems ${schema.minItems}`);
  if (schema.maxItems != null && arr.length > schema.maxItems) err(errors, path, `more than maxItems ${schema.maxItems}`);
  if (schema.uniqueItems) {
    const seen = new Set();
    for (const x of arr) { const k = JSON.stringify(x); if (seen.has(k)) { err(errors, path, "items must be unique"); break; } seen.add(k); }
  }
  // prefixItems (tuple) then items, or items applies to all
  const prefix = schema.prefixItems || (Array.isArray(schema.items) ? schema.items : null);
  if (prefix) {
    prefix.forEach((s, i) => { if (i < arr.length) check(arr[i], s, `${path}[${i}]`, errors, root); });
    const rest = schema.items && !Array.isArray(schema.items) ? schema.items : schema.additionalItems;
    if (rest != null) for (let i = prefix.length; i < arr.length; i++) check(arr[i], rest, `${path}[${i}]`, errors, root);
  } else if (schema.items != null) {
    arr.forEach((x, i) => check(x, schema.items, `${path}[${i}]`, errors, root));
  }
  if (schema.contains && !arr.some((x) => valid(x, schema.contains, root)))
    err(errors, path, "no item matches 'contains' schema");
}

function checkObject(obj, schema, path, errors, root) {
  const keys = Object.keys(obj);
  if (schema.required) for (const r of schema.required) if (!(r in obj)) err(errors, path, `missing required property "${r}"`);
  if (schema.minProperties != null && keys.length < schema.minProperties) err(errors, path, `fewer than minProperties ${schema.minProperties}`);
  if (schema.maxProperties != null && keys.length > schema.maxProperties) err(errors, path, `more than maxProperties ${schema.maxProperties}`);

  const props = schema.properties || {};
  const patternProps = schema.patternProperties || {};
  for (const k of keys) {
    const childPath = `${path}.${k}`;
    let matched = false;
    if (k in props) { check(obj[k], props[k], childPath, errors, root); matched = true; }
    for (const pat of Object.keys(patternProps)) {
      if (new RegExp(pat).test(k)) { check(obj[k], patternProps[pat], childPath, errors, root); matched = true; }
    }
    if (!matched && schema.additionalProperties != null) {
      if (schema.additionalProperties === false) err(errors, childPath, `additional property "${k}" is not allowed`);
      else if (typeof schema.additionalProperties === "object") check(obj[k], schema.additionalProperties, childPath, errors, root);
    }
  }
  // dependentRequired
  if (schema.dependentRequired) {
    for (const k of Object.keys(schema.dependentRequired)) {
      if (k in obj) for (const dep of schema.dependentRequired[k]) if (!(dep in obj)) err(errors, path, `property "${dep}" is required when "${k}" is present`);
    }
  }
}
