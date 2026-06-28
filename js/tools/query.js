// query.js — JSONPath, JMESPath, JSON Pointer, and a pragmatic jq subset.
// jsonpath-plus and jmespath are loaded as window globals (vendored).

export function jsonPath(value, expr) {
  const JP = window.JSONPath?.JSONPath || window.JSONPath;
  if (!JP) throw new Error("JSONPath library not loaded.");
  if (!expr.trim()) throw new Error("Enter a JSONPath expression, e.g. $..name");
  return JP({ path: expr, json: value, wrap: true });
}

export function jmesPath(value, expr) {
  if (!window.jmespath) throw new Error("JMESPath library not loaded.");
  if (!expr.trim()) throw new Error("Enter a JMESPath expression, e.g. people[?age > `30`].name");
  return window.jmespath.search(value, expr);
}

// RFC 6901 JSON Pointer.
export function jsonPointer(value, pointer) {
  if (pointer === "" ) return value;
  if (!pointer.startsWith("/")) throw new Error('Pointer must start with "/" (or be empty for the whole doc).');
  const tokens = pointer.split("/").slice(1).map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur = value;
  for (const tk of tokens) {
    if (Array.isArray(cur)) {
      const idx = tk === "-" ? cur.length : Number(tk);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) throw new Error(`No array index "${tk}".`);
      cur = cur[idx];
    } else if (cur && typeof cur === "object") {
      if (!(tk in cur)) throw new Error(`No key "${tk}".`);
      cur = cur[tk];
    } else throw new Error(`Cannot descend into ${typeof cur} at "${tk}".`);
  }
  return cur;
}

/* ---------------- jq subset ----------------
   Supported: .  .foo  .foo.bar  .["k"]  .[0]  .[]  .foo[]
   | (pipe)   , (collect)   select(<cond>)   map(<filter>)
   keys  keys_unsorted  values  length  type  first  last  unique  add
   not  empty   has("k")
   comparisons in select: .x == y, .x != y, .x < y, > <= >=, and/or
   literals: numbers, "strings", true/false/null
   Returns an array of output values (jq is a stream).
------------------------------------------------ */
export function jq(value, program) {
  if (!program.trim()) throw new Error('Enter a jq filter, e.g. .items[] | select(.active) | .name');
  const ast = parsePipe(tokenize(program));
  const out = [];
  evalNode(ast, [value], out);
  return out;
}

function tokenize(s) {
  const re = /\s*(==|!=|<=|>=|\|\||&&|[|,.\[\]()<>]|"(?:[^"\\]|\\.)*"|-?\d+\.?\d*|[A-Za-z_][\w]*|\?)\s*/y;
  const toks = [];
  let i = 0;
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) {
      if (/^\s+$/.test(s.slice(i))) break;
      throw new Error("Unexpected token near: " + s.slice(i, i + 12));
    }
    if (m[1] !== undefined) toks.push(m[1]);
    i = re.lastIndex;
    if (i === m.index && !m[1]) break;
  }
  return toks;
}

function parsePipe(toks) {
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];

  function parsePipeline() {
    let left = parseComma();
    while (peek() === "|") { next(); left = { t: "pipe", left, right: parseComma() }; }
    return left;
  }
  function parseComma() {
    let parts = [parseCompare()];
    while (peek() === ",") { next(); parts.push(parseCompare()); }
    return parts.length === 1 ? parts[0] : { t: "comma", parts };
  }
  function parseCompare() {
    let left = parseOr();
    return left;
  }
  function parseOr() {
    let left = parseAnd();
    while (peek() === "||") { next(); left = { t: "or", left, right: parseAnd() }; }
    return left;
  }
  function parseAnd() {
    let left = parseCmp();
    while (peek() === "&&") { next(); left = { t: "and", left, right: parseCmp() }; }
    return left;
  }
  function parseCmp() {
    let left = parsePostfix();
    const op = peek();
    if (["==", "!=", "<", ">", "<=", ">="].includes(op)) {
      next();
      const right = parsePostfix();
      return { t: "cmp", op, left, right };
    }
    return left;
  }
  function parsePostfix() {
    let node = parsePrimary();
    while (peek() === "[" || peek() === "." ) {
      // handled inside parsePrimary chains; break to avoid loops
      break;
    }
    return node;
  }
  function parsePrimary() {
    const tk = peek();
    if (tk === ".") return parsePath();
    if (tk === "(") { next(); const e = parsePipeline(); expect(")"); return e; }
    if (/^-?\d/.test(tk)) { next(); return { t: "lit", v: Number(tk) }; }
    if (tk && tk[0] === '"') { next(); return { t: "lit", v: JSON.parse(tk) }; }
    if (tk === "true" || tk === "false" || tk === "null") { next(); return { t: "lit", v: JSON.parse(tk) }; }
    // function / identifier
    if (/^[A-Za-z_]/.test(tk || "")) {
      next();
      if (peek() === "(") {
        next();
        const arg = parsePipeline();
        expect(")");
        return { t: "call", name: tk, arg };
      }
      return { t: "call", name: tk };
    }
    throw new Error("Unexpected token: " + tk);
  }
  function parsePath() {
    next(); // consume leading '.'
    const steps = [];
    const isIdent = (tk) => tk && /^[A-Za-z_]/.test(tk);
    const maybeOpt = () => { if (peek() === "?") { next(); steps[steps.length - 1].opt = true; } };
    // optional first field directly after the leading dot: .foo
    if (isIdent(peek())) { steps.push({ k: "field", name: next() }); maybeOpt(); }
    // then any chain of [..] indexers and .field segments
    for (;;) {
      const tk = peek();
      if (tk === "[") {
        next();
        if (peek() === "]") { next(); steps.push({ k: "iterate" }); }
        else {
          const idx = next();
          expect("]");
          if (idx[0] === '"') steps.push({ k: "field", name: JSON.parse(idx) });
          else steps.push({ k: "index", i: Number(idx) });
        }
        maybeOpt();
      } else if (tk === ".") {
        next();
        const nm = next();
        if (!isIdent(nm)) throw new Error("Expected a field name after '.'");
        steps.push({ k: "field", name: nm });
        maybeOpt();
      } else break;
    }
    return { t: "path", steps };
  }
  function expect(tk) { if (next() !== tk) throw new Error(`Expected "${tk}"`); }

  const ast = parsePipeline();
  if (pos < toks.length) throw new Error("Trailing tokens: " + toks.slice(pos).join(" "));
  return ast;
}

function evalNode(node, inputs, out) {
  switch (node.t) {
    case "pipe": {
      const mid = [];
      evalNode(node.left, inputs, mid);
      evalNode(node.right, mid, out);
      return;
    }
    case "comma":
      for (const p of node.parts) evalNode(p, inputs, out);
      return;
    case "lit":
      for (let i = 0; i < inputs.length; i++) out.push(node.v);
      return;
    case "path":
      for (const inp of inputs) applyPath(node.steps, inp, out);
      return;
    case "cmp":
      for (const inp of inputs) {
        const l = single(node.left, inp), r = single(node.right, inp);
        out.push(compare(node.op, l, r));
      }
      return;
    case "and":
      for (const inp of inputs) out.push(truthy(single(node.left, inp)) && truthy(single(node.right, inp)));
      return;
    case "or":
      for (const inp of inputs) out.push(truthy(single(node.left, inp)) || truthy(single(node.right, inp)));
      return;
    case "call":
      for (const inp of inputs) applyCall(node, inp, out);
      return;
  }
  throw new Error("Cannot evaluate node " + node.t);
}

function single(node, input) {
  const tmp = [];
  evalNode(node, [input], tmp);
  return tmp[0];
}

function applyPath(steps, value, out) {
  let cur = [value];
  for (const st of steps) {
    const nextVals = [];
    for (const v of cur) {
      if (st.k === "field") {
        if (v == null) { if (st.opt) continue; nextVals.push(null); continue; }
        if (typeof v !== "object" || Array.isArray(v)) { if (st.opt) continue; throw new Error(`Cannot index ${typeof v} with "${st.name}"`); }
        nextVals.push(v[st.name] ?? null);
      } else if (st.k === "index") {
        if (!Array.isArray(v)) { if (st.opt) continue; throw new Error("Cannot index non-array"); }
        const i = st.i < 0 ? v.length + st.i : st.i;
        nextVals.push(v[i] ?? null);
      } else if (st.k === "iterate") {
        if (Array.isArray(v)) nextVals.push(...v);
        else if (v && typeof v === "object") nextVals.push(...Object.values(v));
        else if (!st.opt) throw new Error("Cannot iterate " + typeof v);
      }
    }
    cur = nextVals;
  }
  out.push(...cur);
}

function applyCall(node, input, out) {
  const name = node.name;
  switch (name) {
    case "keys": return void out.push(keysOf(input).sort());
    case "keys_unsorted": return void out.push(keysOf(input));
    case "values": return void out.push(Array.isArray(input) ? input.slice() : Object.values(input ?? {}));
    case "length":
      if (input == null) return void out.push(0);
      if (typeof input === "string" || Array.isArray(input)) return void out.push(input.length);
      if (typeof input === "object") return void out.push(Object.keys(input).length);
      if (typeof input === "number") return void out.push(Math.abs(input));
      return void out.push(1);
    case "type": return void out.push(input === null ? "null" : Array.isArray(input) ? "array" : typeof input);
    case "first": return void out.push(Array.isArray(input) ? input[0] ?? null : null);
    case "last": return void out.push(Array.isArray(input) ? input[input.length - 1] ?? null : null);
    case "add": return void out.push(Array.isArray(input) ? input.reduce((a, b) => addVals(a, b)) : null);
    case "unique": return void out.push([...new Map(input.map((x) => [JSON.stringify(x), x])).values()]);
    case "not": return void out.push(!truthy(input));
    case "empty": return; // emits nothing
    case "has": { const k = node.arg ? single(node.arg, input) : undefined; return void out.push(input != null && Object.prototype.hasOwnProperty.call(input, k)); }
    case "select": {
      const keep = single(node.arg, input);
      if (truthy(keep)) out.push(input);
      return;
    }
    case "map": {
      if (!Array.isArray(input)) throw new Error("map requires an array");
      const res = [];
      for (const el of input) evalNode(node.arg, [el], res);
      out.push(res);
      return;
    }
  }
  throw new Error("Unknown jq function: " + name);
}

function keysOf(v) {
  if (Array.isArray(v)) return v.map((_, i) => i);
  if (v && typeof v === "object") return Object.keys(v);
  throw new Error("keys requires object or array");
}
function addVals(a, b) {
  if (typeof a === "number") return a + b;
  if (typeof a === "string") return a + b;
  if (Array.isArray(a)) return a.concat(b);
  if (a && typeof a === "object") return { ...a, ...b };
  return b;
}
function truthy(v) { return v !== false && v != null; }
function compare(op, l, r) {
  switch (op) {
    case "==": return JSON.stringify(l) === JSON.stringify(r);
    case "!=": return JSON.stringify(l) !== JSON.stringify(r);
    case "<": return l < r; case ">": return l > r;
    case "<=": return l <= r; case ">=": return l >= r;
  }
}

// Extract helpers (used by query UI shortcuts).
export function allKeys(value) {
  const set = new Set();
  const rec = (v) => {
    if (Array.isArray(v)) v.forEach(rec);
    else if (v && typeof v === "object") for (const k of Object.keys(v)) { set.add(k); rec(v[k]); }
  };
  rec(value);
  return [...set].sort();
}

export function valuesForKey(value, key) {
  const res = [];
  const rec = (v) => {
    if (Array.isArray(v)) v.forEach(rec);
    else if (v && typeof v === "object") for (const k of Object.keys(v)) { if (k === key) res.push(v[k]); rec(v[k]); }
  };
  rec(value);
  return res;
}
