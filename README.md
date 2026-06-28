# JSONKit

**The complete JSON toolkit — 100% in your browser.** Part of [ToolWizHub](https://toolwizhub.com).

Format, validate, query, transform, compare, convert, generate code/types, analyze,
and redact PII from JSON — all locally. Nothing is ever uploaded.

🔗 **Live:** https://jsonkit.toolwizhub.com

## Features

A workbench with a tool catalog down the left, your JSON in the middle, and the
result on the right. Pick a tool and it runs instantly as you type.

| Group | Tools |
|-------|-------|
| **Format** | Beautify · Minify · Stringify · Unstringify · Sort keys · Clean/prune · Canonicalize (RFC 8785 JCS) |
| **Validate** | Syntax check with exact error line/column, auto-fix (trailing commas, quotes, comments…), duplicate-key & big-number lint |
| **View** | Collapsible tree (copyable paths) · Table view |
| **Query** | JSONPath · JMESPath · JSON Pointer (RFC 6901) · jq filter (subset) · All keys |
| **Transform** | Flatten/Unflatten · Key-case convert · Remove/Keep/Rename keys · Group by · Deep merge · Apply JSON Patch (6902) & Merge Patch (7386) |
| **Compare** | Semantic key-aware diff · Generate RFC 6902 patch |
| **JSON →** | YAML · CSV · XML · TOML · query string · .env · HTML table · Markdown table |
| **→ JSON** | from YAML · CSV · XML · TOML · .env · query string |
| **Generate** | TypeScript · Go · Python (dataclass/pydantic/TypedDict) · Java · C# · Rust · Kotlin · Swift · JSON Schema · Schema→sample · SQL DDL |
| **Analyze** | Statistics (size, depth, node/key counts, type mix) · Detect shape of an array |
| **Privacy** | Detect PII · Redact PII · Strip sensitive keys · Mask all values · Fake data |
| **Specialized** | GeoJSON · JSON-LD · HAR · OpenAPI inspectors |

**I/O:** paste, drag-drop / upload a file, fetch from URL, load a sample, copy &
download output, send output back to input, and a share link (encoded in the URL hash).

> Encode/Decode (JWT, Base64, gzip, hashing) is intentionally out of scope for v1.

## Run locally

No build step — it's vanilla HTML/CSS/ES-modules.

```bash
npm run site      # serves on http://localhost:8093
# or: python3 -m http.server 8093
```

## Architecture

```
index.html          workbench shell (splash · nav · footer · house theme)
css/styles.css      ToolWizHub dark-glass theme + full-width workbench layout
js/
  editor.js         textarea editor with line gutter + error marker
  registry.js       declarative catalog of every tool, grouped for the sidebar
  main.js           orchestrator: routing, I/O, output rendering
  core/
    parse.js        robust parse · error location · auto-fix · dup-key/big-num lint
    util.js         pure helpers (paths, walk, deepEqual, case, clipboard, download)
  tools/            one module per feature group (format, view, query, transform,
                    diff, convert, codegen, analyze, privacy, specialized)
lib/                vendored libraries (loaded as window globals, no CDN at runtime)
                    js-yaml · papaparse · jsonpath-plus · jmespath
```

Conversions that browsers do natively (XML via `DOMParser`/`XMLSerializer`) use
no library. Everything else — diffing, codegen, schema inference, the jq engine,
TOML, PII — is hand-rolled pure JS so the tool stays fully offline and private.

## Privacy

100% client-side. Your JSON never leaves the page. See [privacy.html](privacy.html).

## License

MIT
