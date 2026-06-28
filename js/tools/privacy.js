// privacy.js — local-only PII detection/redaction, sensitive-key stripping,
// value masking (keep structure), and fake-data replacement.
import { isPlainObject, walk, pathToString, clone } from "../core/util.js";

const PII = [
  { name: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { name: "phone", re: /\b(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?){2,4}\d{2,4}\b/g },
  { name: "credit card", re: /\b(?:\d[ -]?){13,16}\b/g },
  { name: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: "ipv4", re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  { name: "aws key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "jwt", re: /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g },
  { name: "uuid", re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
];

const SENSITIVE_KEYS = [
  "password", "passwd", "pwd", "secret", "token", "apikey", "api_key",
  "access_token", "refresh_token", "authorization", "auth", "private_key",
  "client_secret", "ssn", "credit_card", "card_number", "cvv", "pin",
];

// Scan for PII; returns findings [{type, value, path}].
export function detectPII(value) {
  const findings = [];
  walk(value, (v, path) => {
    if (typeof v !== "string") return;
    for (const { name, re } of PII) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(v))) {
        // reduce false positives for "phone"/"credit card" on short numbers
        if ((name === "phone" || name === "credit card") && m[0].replace(/\D/g, "").length < (name === "phone" ? 7 : 13)) continue;
        findings.push({ type: name, value: m[0], path: pathToString(path) });
      }
    }
  });
  // also flag sensitive keys
  walk(value, (v, path) => {
    const k = path[path.length - 1];
    if (typeof k === "string" && SENSITIVE_KEYS.includes(k.toLowerCase())) {
      findings.push({ type: "sensitive key", value: String(k), path: pathToString(path) });
    }
  });
  return findings;
}

// Redact PII inside string values (mask matched substrings).
export function redactPII(value) {
  const rec = (v) => {
    if (typeof v === "string") {
      let s = v;
      for (const { re } of PII) {
        re.lastIndex = 0;
        s = s.replace(re, (m) => "•".repeat(Math.min(m.length, 12)));
      }
      return s;
    }
    if (Array.isArray(v)) return v.map(rec);
    if (isPlainObject(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = rec(v[k]); return o; }
    return v;
  };
  return rec(value);
}

// Strip sensitive keys entirely (deep). Extra keys via CSV.
export function stripSensitive(value, extraCsv = "") {
  const extra = extraCsv.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const blocked = new Set([...SENSITIVE_KEYS, ...extra]);
  const rec = (v) => {
    if (Array.isArray(v)) return v.map(rec);
    if (isPlainObject(v)) {
      const o = {};
      for (const k of Object.keys(v)) {
        if (blocked.has(k.toLowerCase())) o[k] = "[REDACTED]";
        else o[k] = rec(v[k]);
      }
      return o;
    }
    return v;
  };
  return rec(value);
}

// Mask all values but keep the structure & types (for sharing safe samples).
export function maskValues(value) {
  const rec = (v) => {
    if (Array.isArray(v)) return v.map(rec);
    if (isPlainObject(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = rec(v[k]); return o; }
    if (typeof v === "string") return "x".repeat(Math.max(1, Math.min(v.length, 8)));
    if (typeof v === "number") return Number.isInteger(v) ? 0 : 0.0;
    if (typeof v === "boolean") return false;
    return v;
  };
  return rec(value);
}

// Replace leaf values with realistic fake data, keyed by field name heuristics.
export function fakeData(value) {
  let counter = 0;
  const fakeFor = (key) => {
    const k = String(key).toLowerCase();
    if (/email/.test(k)) return `user${++counter}@example.com`;
    if (/(^name$|firstname|fullname|first_name)/.test(k)) return pick(NAMES);
    if (/lastname|last_name|surname/.test(k)) return pick(SURNAMES);
    if (/phone|mobile|tel/.test(k)) return "+1-555-0" + String(100 + (counter++ % 900));
    if (/city/.test(k)) return pick(CITIES);
    if (/country/.test(k)) return pick(COUNTRIES);
    if (/(^id$|_id$|uuid)/.test(k)) return crypto.randomUUID ? crypto.randomUUID() : "id-" + ++counter;
    if (/url|website|link/.test(k)) return "https://example.com/" + ++counter;
    if (/(price|amount|total|cost)/.test(k)) return Math.round(Math.random() * 10000) / 100;
    if (/age/.test(k)) return 18 + Math.floor(Math.random() * 60);
    if (/date|time|created|updated/.test(k)) return "2026-0" + (1 + (counter++ % 9)) + "-15";
    return null;
  };
  const rec = (v, key) => {
    if (Array.isArray(v)) return v.map((x) => rec(x, key));
    if (isPlainObject(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = rec(v[k], k); return o; }
    if (typeof v === "string") return fakeFor(key) ?? pick(WORDS);
    if (typeof v === "number") return fakeFor(key) ?? Math.floor(Math.random() * 1000);
    return v;
  };
  return rec(clone(value), "");
}
const NAMES = ["Alex", "Sam", "Jordan", "Taylor", "Morgan", "Riley", "Casey"];
const SURNAMES = ["Smith", "Johnson", "Lee", "Patel", "Garcia", "Kim", "Brown"];
const CITIES = ["Austin", "Berlin", "Mumbai", "Tokyo", "Toronto", "Lisbon"];
const COUNTRIES = ["USA", "Germany", "India", "Japan", "Canada", "Portugal"];
const WORDS = ["lorem", "ipsum", "dolor", "sit", "amet", "consectetur"];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
