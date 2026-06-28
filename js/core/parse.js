// parse.js — robust JSON parsing with precise error location, auto-fix,
// JSON5/JSONC tolerance, duplicate-key detection and big-number warnings.

// Convert a character index in `text` to {line, col} (1-based).
export function indexToLineCol(text, index) {
  let line = 1, col = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") { line++; col = 1; } else col++;
  }
  return { line, col };
}

// Pull a line/col out of a native SyntaxError message (varies by engine).
function locFromNativeError(err, text) {
  const m = String(err.message).match(/position (\d+)/i);
  if (m) {
    const idx = Number(m[1]);
    return { index: idx, ...indexToLineCol(text, idx) };
  }
  const lc = String(err.message).match(/line (\d+) column (\d+)/i);
  if (lc) return { line: Number(lc[1]), col: Number(lc[2]) };
  return null;
}

// A small reviver-free scan to find duplicate keys & big numbers, since
// JSON.parse silently drops dup keys and loses int precision.
function lintTokens(text) {
  const dupKeys = [];
  const bigNums = [];
  // crude but effective: walk with a tiny tokenizer tracking object scopes.
  const stack = []; // each: Set of keys seen
  let i = 0;
  const n = text.length;
  const skipWs = () => { while (i < n && /\s/.test(text[i])) i++; };
  const readString = () => {
    // assumes text[i] === '"'
    let s = "";
    i++;
    while (i < n) {
      const c = text[i++];
      if (c === "\\") { s += JSON.parse('"\\' + text[i] + '"').length ? c + text[i] : c + text[i]; i++; continue; }
      if (c === '"') break;
      s += c;
    }
    // normalize escapes for the key comparison
    try { return JSON.parse('"' + s.replace(/"/g, '\\"') + '"'); } catch { return s; }
  };
  try {
    while (i < n) {
      skipWs();
      const c = text[i];
      if (c === undefined) break;
      if (c === "{") { stack.push({ keys: new Set(), expectKey: true }); i++; continue; }
      if (c === "}") { stack.pop(); i++; continue; }
      if (c === "[") { stack.push(null); i++; continue; }
      if (c === "]") { stack.pop(); i++; continue; }
      if (c === ",") { const t = stack[stack.length - 1]; if (t) t.expectKey = true; i++; continue; }
      if (c === ":") { i++; continue; }
      if (c === '"') {
        const start = i;
        const str = readString();
        const top = stack[stack.length - 1];
        if (top && top.expectKey) {
          if (top.keys.has(str)) dupKeys.push({ key: str, ...indexToLineCol(text, start) });
          top.keys.add(str);
          top.expectKey = false;
        }
        continue;
      }
      // number?
      if (/[-0-9]/.test(c)) {
        const start = i;
        while (i < n && /[-+0-9.eE]/.test(text[i])) i++;
        const raw = text.slice(start, i);
        if (/^-?\d+$/.test(raw)) {
          const num = Number(raw);
          if (!Number.isSafeInteger(num)) bigNums.push({ raw, ...indexToLineCol(text, start) });
        }
        const top = stack[stack.length - 1];
        if (top) top.expectKey = false;
        continue;
      }
      i++;
    }
  } catch { /* linting is best-effort */ }
  return { dupKeys, bigNums };
}

// Attempt to repair the most common hand-written JSON mistakes.
// Returns {fixed, changes:[]}.
export function autoFix(text) {
  const changes = [];
  let s = text;

  // strip BOM
  if (s.charCodeAt(0) === 0xfeff) { s = s.slice(1); changes.push("Removed BOM"); }

  // strip // and /* */ comments (JSONC) — skip inside strings
  const noComments = stripComments(s);
  if (noComments !== s) { s = noComments; changes.push("Removed comments"); }

  // single → double quotes (only when it looks like a quoted token)
  const sq = s.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (m, inner) =>
    '"' + inner.replace(/"/g, '\\"') + '"');
  if (sq !== s) { s = sq; changes.push("Converted single quotes to double quotes"); }

  // unquoted object keys: {key: ...} → {"key": ...}
  const uq = s.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
  if (uq !== s) { s = uq; changes.push("Quoted unquoted keys"); }

  // trailing commas before } or ]
  const tc = s.replace(/,(\s*[}\]])/g, "$1");
  if (tc !== s) { s = tc; changes.push("Removed trailing commas"); }

  // Python/JS literals
  const lit = s
    .replace(/\bNone\b/g, "null")
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNaN\b/g, "null")
    .replace(/\b-?Infinity\b/g, "null");
  if (lit !== s) { s = lit; changes.push("Normalized None/True/False/NaN/Infinity"); }

  return { fixed: s, changes };
}

function stripComments(s) {
  let out = "";
  let inStr = false, strCh = "", i = 0;
  while (i < s.length) {
    const c = s[i], nx = s[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") { out += nx ?? ""; i += 2; continue; }
      if (c === strCh) inStr = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; strCh = c; out += c; i++; continue; }
    if (c === "/" && nx === "/") { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (c === "/" && nx === "*") { i += 2; while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

// Main entry. Returns:
//   { ok:true, value, lint:{dupKeys,bigNums} }
//   { ok:false, error:{message,line,col,index}, fix:{fixed,changes,value?} }
export function parse(text, { allowFix = true } = {}) {
  if (text == null || text.trim() === "") {
    return { ok: false, error: { message: "Input is empty." }, empty: true };
  }
  try {
    const value = JSON.parse(text);
    return { ok: true, value, lint: lintTokens(text) };
  } catch (err) {
    const loc = locFromNativeError(err, text) || {};
    const result = {
      ok: false,
      error: { message: cleanMsg(err.message), ...loc },
    };
    if (allowFix) {
      const fix = autoFix(text);
      try {
        fix.value = JSON.parse(fix.fixed);
        fix.valid = true;
      } catch { fix.valid = false; }
      if (fix.changes.length) result.fix = fix;
    }
    return result;
  }
}

function cleanMsg(m) {
  return String(m).replace(/^JSON\.parse:\s*/, "").replace(/in JSON at .*/, "").trim();
}
