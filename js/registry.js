// registry.js — declarative catalog of every tool, grouped for the sidebar.
// Each tool: { id, label, group, desc, needsB?, rawInput?, opts?, run(value,opts,ctx) }
// run() returns an output descriptor consumed by main.js:
//   { kind:'code', text, lang } | { kind:'tree', value } |
//   { kind:'table', columns, rows } | { kind:'html', html } |
//   { kind:'report', sections } | { kind:'note', text }

import * as fmt from "./tools/format.js";
import * as view from "./tools/view.js";
import * as q from "./tools/query.js";
import * as tx from "./tools/transform.js";
import * as df from "./tools/diff.js";
import * as cv from "./tools/convert.js";
import * as cg from "./tools/codegen.js";
import * as an from "./tools/analyze.js";
import * as pv from "./tools/privacy.js";
import * as sp from "./tools/specialized.js";
import { validateSchema } from "./tools/jsonschema.js";

const code = (text, lang = "json") => ({ kind: "code", text, lang });
const json = (value, indent = 2) => code(JSON.stringify(value, null, indent), "json");

export const TOOLS = [
  /* ---------------- Format & Clean ---------------- */
  { id: "beautify", group: "Format", label: "Beautify", desc: "Pretty-print with chosen indent.",
    opts: [{ id: "indent", label: "Indent", type: "select", options: ["2", "4", "tab"], default: "2" }],
    run: (v, o) => code(fmt.beautify(v, o.indent)) },
  { id: "minify", group: "Format", label: "Minify", desc: "Strip all whitespace to one line.",
    run: (v) => code(fmt.minify(v)) },
  { id: "stringify", group: "Format", label: "Stringify", desc: "Escape JSON into a string literal for embedding in code.",
    run: (v) => code(fmt.stringify(v), "text") },
  { id: "unstringify", group: "Format", label: "Unstringify", desc: "Unescape a JSON string literal back to JSON.",
    rawInput: true, run: (_v, _o, c) => code(fmt.unstringify(c.rawText)) },
  { id: "sortkeys", group: "Format", label: "Sort keys", desc: "Recursively sort object keys.",
    opts: [{ id: "dir", label: "Order", type: "select", options: ["asc", "desc"], default: "asc" }],
    run: (v, o) => code(fmt.sortKeys(v, o.dir)) },
  { id: "clean", group: "Format", label: "Clean / prune", desc: "Remove nulls and empty values.",
    opts: [
      { id: "nulls", label: "Drop nulls", type: "checkbox", default: true },
      { id: "emptyArrays", label: "Drop empty arrays", type: "checkbox", default: true },
      { id: "emptyObjects", label: "Drop empty objects", type: "checkbox", default: true },
      { id: "emptyStrings", label: "Drop empty strings", type: "checkbox", default: false },
    ],
    run: (v, o) => json(fmt.clean(v, o)) },
  { id: "canonical", group: "Format", label: "Canonicalize (JCS)", desc: "RFC 8785 canonical form for hashing/signing.",
    run: (v) => code(fmt.canonicalize(v), "text") },

  /* ---------------- Validate ---------------- */
  { id: "validate", group: "Validate", label: "Validate & lint", desc: "Check syntax, locate errors, find duplicate keys & precision risks.",
    rawInput: true, run: (_v, _o, c) => c.validate() },
  { id: "schema-validate", group: "Validate", label: "Validate vs schema", desc: "Validate document A against a JSON Schema pasted in panel B.", needsB: true,
    run: (v, _o, c) => {
      const errs = validateSchema(v, c.valueB);
      if (!errs.length) return { kind: "note", text: "✓ Document is valid against the schema." };
      return { kind: "table", columns: ["path", "problem"], rows: errs.map((e) => [e.path, e.message]), empty: "No errors." };
    } },

  /* ---------------- View ---------------- */
  { id: "tree", group: "View", label: "Tree view", desc: "Collapsible tree with copyable paths.",
    run: (v) => ({ kind: "tree", value: v }) },
  { id: "table", group: "View", label: "Table view", desc: "Tabular view of arrays/objects.",
    run: (v) => { const t = view.tableView(v); return { kind: "table", columns: t.columns, rows: t.rows }; } },

  /* ---------------- Query ---------------- */
  { id: "jsonpath", group: "Query", label: "JSONPath", desc: "Query with JSONPath (e.g. $..author).",
    opts: [{ id: "expr", label: "Expression", type: "text", placeholder: "$.store.book[*].title" }],
    run: (v, o) => json(q.jsonPath(v, o.expr || "")) },
  { id: "jmespath", group: "Query", label: "JMESPath", desc: "Query with JMESPath.",
    opts: [{ id: "expr", label: "Expression", type: "text", placeholder: "people[?age > `30`].name" }],
    run: (v, o) => json(q.jmesPath(v, o.expr || "")) },
  { id: "pointer", group: "Query", label: "JSON Pointer", desc: "RFC 6901 lookup (e.g. /a/0/b).",
    opts: [{ id: "expr", label: "Pointer", type: "text", placeholder: "/items/0/name" }],
    run: (v, o) => json(q.jsonPointer(v, o.expr ?? "")) },
  { id: "jq", group: "Query", label: "jq filter", desc: "jq-style filters (subset): .a.b[] | select(...) | map(...).",
    opts: [{ id: "expr", label: "Filter", type: "text", placeholder: ".items[] | select(.active) | .name" }],
    run: (v, o) => json(q.jq(v, o.expr || "")) },
  { id: "allkeys", group: "Query", label: "All keys", desc: "List every unique key in the document.",
    run: (v) => json(q.allKeys(v)) },

  /* ---------------- Transform ---------------- */
  { id: "flatten", group: "Transform", label: "Flatten", desc: "Nested → dot-notation key/value pairs.",
    opts: [{ id: "delimiter", label: "Delimiter", type: "text", default: "." }],
    run: (v, o) => json(tx.flatten(v, { delimiter: o.delimiter || "." })) },
  { id: "unflatten", group: "Transform", label: "Unflatten", desc: "Dot-notation pairs → nested.",
    opts: [{ id: "delimiter", label: "Delimiter", type: "text", default: "." }],
    run: (v, o) => json(tx.unflatten(v, { delimiter: o.delimiter || "." })) },
  { id: "case", group: "Transform", label: "Convert key case", desc: "Recursively rename keys to a case style.",
    opts: [{ id: "mode", label: "Case", type: "select", options: ["camel", "snake", "pascal", "kebab", "constant"], default: "camel" }],
    run: (v, o) => json(tx.convertKeyCase(v, o.mode)) },
  { id: "remove", group: "Transform", label: "Remove keys", desc: "Delete keys (comma-separated, deep).",
    opts: [{ id: "keys", label: "Keys", type: "text", placeholder: "password, secret" }],
    run: (v, o) => json(tx.removeKeys(v, o.keys || "")) },
  { id: "pick", group: "Transform", label: "Keep only keys", desc: "Keep only the listed keys (deep).",
    opts: [{ id: "keys", label: "Keys", type: "text", placeholder: "id, name" }],
    run: (v, o) => json(tx.pickKeys(v, o.keys || "")) },
  { id: "rename", group: "Transform", label: "Rename keys", desc: "Rename via old:new pairs (deep).",
    opts: [{ id: "spec", label: "Map", type: "text", placeholder: "id:userId, name:fullName" }],
    run: (v, o) => json(tx.renameKeys(v, o.spec || "")) },
  { id: "groupby", group: "Transform", label: "Group by", desc: "Group an array of objects by a key.",
    opts: [{ id: "key", label: "Key", type: "text", placeholder: "category" }],
    run: (v, o) => json(tx.groupBy(v, o.key || "")) },
  { id: "merge", group: "Transform", label: "Deep merge (A+B)", desc: "Deep-merge input B into A.", needsB: true,
    run: (v, _o, c) => json(tx.deepMerge(v, c.valueB)) },
  { id: "applypatch", group: "Transform", label: "Apply JSON Patch", desc: "Apply an RFC 6902 patch (B) to A.", needsB: true,
    run: (v, _o, c) => json(tx.applyPatch(v, c.valueB)) },
  { id: "mergepatch", group: "Transform", label: "Apply Merge Patch", desc: "Apply an RFC 7386 merge patch (B) to A.", needsB: true,
    run: (v, _o, c) => json(tx.mergePatch(v, c.valueB)) },

  /* ---------------- Compare ---------------- */
  { id: "diff", group: "Compare", label: "Diff A vs B", desc: "Semantic, key-aware difference.", needsB: true,
    run: (v, _o, c) => {
      const r = df.diffReport(v, c.valueB);
      return { kind: "diff", report: r };
    } },
  { id: "makepatch", group: "Compare", label: "Generate patch", desc: "RFC 6902 patch that turns A into B.", needsB: true,
    run: (v, _o, c) => json(df.makePatch(v, c.valueB)) },

  /* ---------------- Convert from JSON ---------------- */
  { id: "to-yaml", group: "JSON →", label: "to YAML", desc: "Convert JSON to YAML.", run: (v) => code(cv.toYAML(v), "yaml") },
  { id: "to-csv", group: "JSON →", label: "to CSV", desc: "Array of objects → CSV.",
    opts: [{ id: "delimiter", label: "Delimiter", type: "select", options: [",", ";", "\\t"], default: "," }],
    run: (v, o) => code(cv.toCSV(v, o.delimiter === "\\t" ? "\t" : o.delimiter), "text") },
  { id: "to-xml", group: "JSON →", label: "to XML", desc: "Convert JSON to XML.", run: (v) => code(cv.toXML(v), "xml") },
  { id: "to-toml", group: "JSON →", label: "to TOML", desc: "Convert JSON to TOML.", run: (v) => code(cv.toTOML(v), "toml") },
  { id: "to-qs", group: "JSON →", label: "to query string", desc: "Flat object → URL query string.", run: (v) => code(cv.toQueryString(v), "text") },
  { id: "to-env", group: "JSON →", label: "to .env", desc: "Flat object → .env file.", run: (v) => code(cv.toEnv(v), "text") },
  { id: "to-html", group: "JSON →", label: "to HTML table", desc: "Array of objects → HTML table.", run: (v) => code(cv.toHTMLTable(v), "html") },
  { id: "to-md", group: "JSON →", label: "to Markdown table", desc: "Array of objects → Markdown table.", run: (v) => code(cv.toMarkdownTable(v), "markdown") },

  /* ---------------- Convert to JSON ---------------- */
  { id: "from-yaml", group: "→ JSON", label: "YAML to JSON", desc: "Parse YAML into JSON.", rawInput: true, run: (_v, _o, c) => json(cv.fromYAML(c.rawText)) },
  { id: "from-csv", group: "→ JSON", label: "CSV to JSON", desc: "Parse CSV (with header row) into JSON.", rawInput: true, run: (_v, _o, c) => json(cv.fromCSV(c.rawText)) },
  { id: "from-xml", group: "→ JSON", label: "XML to JSON", desc: "Parse XML into JSON.", rawInput: true, run: (_v, _o, c) => json(cv.fromXML(c.rawText)) },
  { id: "from-toml", group: "→ JSON", label: "TOML to JSON", desc: "Parse TOML into JSON.", rawInput: true, run: (_v, _o, c) => json(cv.fromTOML(c.rawText)) },
  { id: "from-env", group: "→ JSON", label: ".env to JSON", desc: "Parse a .env file into JSON.", rawInput: true, run: (_v, _o, c) => json(cv.fromEnv(c.rawText)) },
  { id: "from-qs", group: "→ JSON", label: "Query string to JSON", desc: "Parse a URL query string into JSON.", rawInput: true, run: (_v, _o, c) => json(cv.fromQueryString(c.rawText)) },

  /* ---------------- Generate code & types ---------------- */
  { id: "gen-ts", group: "Generate", label: "TypeScript", desc: "Infer TypeScript interfaces.", run: (v) => code(cg.toTypeScript(v), "typescript") },
  { id: "gen-go", group: "Generate", label: "Go structs", desc: "Infer Go structs with json tags.", run: (v) => code(cg.toGo(v), "go") },
  { id: "gen-py", group: "Generate", label: "Python", desc: "Infer Python classes.",
    opts: [{ id: "flavor", label: "Flavor", type: "select", options: ["dataclass", "pydantic", "typeddict"], default: "dataclass" }],
    run: (v, o) => code(cg.toPython(v, o.flavor), "python") },
  { id: "gen-java", group: "Generate", label: "Java", desc: "Infer Java classes.", run: (v) => code(cg.toJava(v), "java") },
  { id: "gen-cs", group: "Generate", label: "C#", desc: "Infer C# classes.", run: (v) => code(cg.toCSharp(v), "csharp") },
  { id: "gen-rust", group: "Generate", label: "Rust", desc: "Infer Rust structs (serde).", run: (v) => code(cg.toRust(v), "rust") },
  { id: "gen-kt", group: "Generate", label: "Kotlin", desc: "Infer Kotlin data classes.", run: (v) => code(cg.toKotlin(v), "kotlin") },
  { id: "gen-swift", group: "Generate", label: "Swift", desc: "Infer Swift Codable structs.", run: (v) => code(cg.toSwift(v), "swift") },
  { id: "gen-schema", group: "Generate", label: "JSON Schema", desc: "Infer a JSON Schema (draft 2020-12).", run: (v) => json(cg.inferSchema(v)) },
  { id: "gen-sample", group: "Generate", label: "Schema → sample", desc: "Generate sample data from a JSON Schema.", run: (v) => json(cg.sampleFromSchema(v)) },
  { id: "gen-sql", group: "Generate", label: "SQL DDL", desc: "CREATE TABLE + INSERTs from rows.",
    opts: [{ id: "table", label: "Table name", type: "text", default: "data" }],
    run: (v, o) => code(cg.toSQL(v, o.table || "data"), "sql") },

  /* ---------------- Analyze ---------------- */
  { id: "stats", group: "Analyze", label: "Statistics", desc: "Size, depth, node & key counts, type mix.",
    run: (v, _o, c) => ({ kind: "stats", data: an.analyze(v, c.rawText) }) },
  { id: "shape", group: "Analyze", label: "Detect shape", desc: "Field presence/types across an array of objects.",
    run: (v) => { const rows = an.shapeOf(v); return { kind: "table", columns: ["key", "presence", "optional", "types"], rows: rows.map((r) => [r.key, r.presence, r.optional ? "yes" : "no", r.types]) }; } },

  /* ---------------- Privacy ---------------- */
  { id: "pii-detect", group: "Privacy", label: "Detect PII", desc: "Find emails, phones, cards, tokens, sensitive keys.",
    run: (v) => { const f = pv.detectPII(v); return { kind: "table", columns: ["type", "value", "path"], rows: f.map((x) => [x.type, x.value, x.path]), empty: "No PII detected." }; } },
  { id: "pii-redact", group: "Privacy", label: "Redact PII", desc: "Mask detected PII inside string values.",
    run: (v) => json(pv.redactPII(v)) },
  { id: "strip", group: "Privacy", label: "Strip sensitive keys", desc: "Replace password/token/secret values with [REDACTED].",
    opts: [{ id: "extra", label: "Extra keys", type: "text", placeholder: "email, phone" }],
    run: (v, o) => json(pv.stripSensitive(v, o.extra || "")) },
  { id: "mask", group: "Privacy", label: "Mask all values", desc: "Keep structure, blank out every value.",
    run: (v) => json(pv.maskValues(v)) },
  { id: "fake", group: "Privacy", label: "Fake data", desc: "Replace values with realistic fake data.",
    run: (v) => json(pv.fakeData(v)) },

  /* ---------------- Specialized ---------------- */
  { id: "geojson", group: "Specialized", label: "GeoJSON inspect", desc: "Feature count, geometry types, bbox, properties.",
    run: (v) => ({ kind: "report", sections: geoSections(sp.geojsonInfo(v)) }) },
  { id: "jsonld", group: "Specialized", label: "JSON-LD inspect", desc: "@context, @type usage, validation notes.",
    run: (v) => ({ kind: "report", sections: jsonldSections(sp.jsonldInfo(v)) }) },
  { id: "har", group: "Specialized", label: "HAR inspect", desc: "Requests by method/status/type, slowest calls.",
    run: (v) => ({ kind: "report", sections: harSections(sp.harInfo(v)) }) },
  { id: "openapi", group: "Specialized", label: "OpenAPI inspect", desc: "Endpoints, operations, schemas.",
    run: (v) => ({ kind: "report", sections: openapiSections(sp.openapiInfo(v)) }) },
];

/* report section builders */
function kvSection(title, obj) {
  return { title, items: Object.entries(obj).map(([k, v]) => ({ label: k, value: String(v) })) };
}
function geoSections(i) {
  return [
    { title: "Overview", items: [
      { label: "Root type", value: i.rootType },
      { label: "Features", value: String(i.featureCount) },
      { label: "Bounding box", value: i.bbox ? i.bbox.map((n) => n.toFixed(4)).join(", ") : "—" },
    ] },
    kvSection("Geometry types", i.geometryTypes),
    { title: "Properties", items: [{ label: "keys", value: i.properties.join(", ") || "—" }] },
  ];
}
function jsonldSections(i) {
  return [
    { title: "Overview", items: [
      { label: "Has @context", value: i.hasContext ? "yes" : "no" },
      { label: "Nodes", value: String(i.nodeCount) },
    ] },
    kvSection("@type usage", i.types),
    { title: "Issues", items: (i.issues.length ? i.issues : ["None"]).map((t) => ({ label: "•", value: t })) },
  ];
}
function harSections(i) {
  return [
    { title: "Overview", items: [
      { label: "Requests", value: String(i.requests) },
      { label: "Total time", value: i.totalTime + " ms" },
      { label: "Total content", value: (i.totalBytes / 1024).toFixed(1) + " KB" },
    ] },
    kvSection("By method", i.byMethod),
    kvSection("By status", i.byStatus),
    kvSection("By type", i.byType),
    { title: "Slowest", items: i.slowest.map((s) => ({ label: s.time + " ms", value: `[${s.status}] ${s.url}` })) },
  ];
}
function openapiSections(i) {
  return [
    { title: "Overview", items: [
      { label: "Spec", value: i.version },
      { label: "Title", value: `${i.title} ${i.apiVersion}` },
      { label: "Paths", value: String(i.pathCount) },
      { label: "Operations", value: String(i.operationCount) },
      { label: "Schemas", value: String(i.schemaCount) },
    ] },
    { title: "Endpoints", items: i.operations.map((o) => ({ label: o.method, value: `${o.path} — ${o.summary}` })) },
    { title: "Schemas", items: [{ label: "names", value: i.schemas.join(", ") || "—" }] },
  ];
}

// Group ordering for the sidebar.
export const GROUP_ORDER = [
  "Format", "Validate", "View", "Query", "Transform", "Compare",
  "JSON →", "→ JSON", "Generate", "Analyze", "Privacy", "Specialized",
];

export const GROUP_ICON = {
  Format: "✨", Validate: "✓", View: "🌳", Query: "🔎", Transform: "🔧",
  Compare: "⇄", "JSON →": "📤", "→ JSON": "📥", Generate: "⚙️",
  Analyze: "📊", Privacy: "🔒", Specialized: "🧩",
};
