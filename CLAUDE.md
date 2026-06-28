# CLAUDE.md — ToolWizHub JSONKit

Project-specific guidance for Claude Code. These instructions override defaults.

## Git & commits

- **Commit WITHOUT the `Co-Authored-By: Claude` trailer.** Attributed to the user alone.
- Personal git identity (`sorapallivenkatesh` / `sorapalli.venkatesh@gmail.com`).
- Remote: `https://github.com/sorapallivenkatesh/toolwizhub-jsonkit` · `main`.
- **Get explicit approval before every commit and push.** Show message + files, then wait.

## What this is

**JSONKit** — the complete JSON toolkit. A workbench (tool catalog · input · output)
that formats, validates, queries, transforms, compares, converts, generates
code/types, analyzes, and redacts PII from JSON. **100% local** — nothing is uploaded.

Static web tool (no backend), so files live at the project root (`index.html`,
`css/`, `js/`, `lib/`). Deploys to `jsonkit.toolwizhub.com` (Cloudflare Pages,
output dir = repo root). Encode/Decode (JWT/Base64/gzip/hash) is out of scope for v1.

## Architecture (keep these boundaries)

- `js/core/parse.js` & `js/core/util.js` are **PURE** (no DOM, no libs) — node-testable.
- `js/tools/*.js` — one module per feature group; each exports pure functions.
  Browser-global libs are only touched in `convert.js` (jsyaml/Papa) and
  `query.js` (JSONPath/jmespath). XML uses native `DOMParser` (no lib).
- `js/registry.js` — the single source of truth: a declarative array of tool
  descriptors `{id,label,group,desc,needsB?,rawInput?,opts?,run()}`. **Add new
  tools here**; main.js and the sidebar pick them up automatically.
- `js/main.js` — orchestrator: tool routing, option inputs, the two editors,
  I/O (paste/upload/URL/sample/share), and rendering each output `kind`
  (code/tree/table/report/stats/diff/validate).
- `js/editor.js` — dependency-free textarea + line gutter + error marker.

`run()` returns an output descriptor; never touches the DOM itself. `rawInput:true`
tools receive the raw text (for YAML/CSV/etc → JSON, and Validate). `needsB:true`
tools read a second parsed document from panel B (diff/merge/patch).

## Vendored libs (no build step)

`lib/` holds `js-yaml.min.js`, `papaparse.min.js`, `jsonpath-plus.min.js`,
`jmespath.min.js`. Loaded as classic `<script>` (window globals) before the ES-module
app. No CDN calls at runtime (privacy). Only external request is Google Fonts.

## Routing, PWA & editor

- **Deep links:** each tool is reachable at `?t=<id>` (history.replaceState); `selectTool`
  updates `<title>`/meta per tool for SEO/shareability. Share links still use `#s=<base64>`.
  Sidebar tools are real `<a href="?t=id">` anchors (crawlable) intercepted as SPA clicks.
- **PWA:** `manifest.webmanifest` + `sw.js` (precache app shell, stale-while-revalidate for
  the rest; never caches cross-origin so "From URL" stays live). Registered in `main.js`.
  Icons `assets/icon-{180,192,512}.png` generated from logo-icon via `sips`.
- **Editor highlighting:** `editor.js` overlays a colored `<pre>` (via `highlightJSON` in
  util.js) behind a transparent-text textarea, scroll-synced; skips >100 KB for perf.
- **Schema validation:** `tools/jsonschema.js` (pure JS draft-2020-12 subset) powers the
  "Validate vs schema" tool (doc in A, schema in B).
- **Resizable layout:** `.app`/`.work` are flex; `#rz-side` / `#rz-work` drag handles persist
  widths to localStorage (`jsonkit:sideW` / `jsonkit:split`).

## Testing

Pure modules are node-testable directly (ESM): `node --check` for syntax; import and
call for behavior. Lib-dependent modules: load the UMD into a `vm` context with
`this`/`window` = the context. Visual: headless Chrome screenshot
(`--headless=new --screenshot`), drive specific tools via a `#s=<base64>` share hash.

## Running

```
npm run site    # http://localhost:8093  (netlens 8090, tablens 8091, spendlens 8092)
```

Vanilla JS, no framework, no build. ToolWizHub **house theme** (dark glass +
gradient mesh, cyan→indigo→fuchsia `--c1/--c2/--c3`, Inter/Space Grotesk/JetBrains
Mono). Dark-only. **Full-width** workbench layout (sidebar + two columns), not a
narrow centered column.

## House UI standard — splash & app bar (do NOT regress these)

Match **dns-health / dialcheck**, NOT the older spendlens pattern. This has had to
be fixed more than once — keep it.

- **Splash:** `splash__glow` + `splash__sparkles` (6 spans) + `splash__logo` using
  **`assets/logo-full.webp`** at ~200px (the full ToolWizHub logo, NOT logo-icon) +
  `splash__tagline` (uppercase, ~7px letter-spacing, "JSON Toolkit") + gradient
  `splash__bar`. Glow-pulse + logo float-in + sparkle + bar-fill animations, `.hide`
  fade-out, CSS `splash-failsafe` reveal, click-to-skip. Recoloured to the cyan/indigo/
  fuchsia palette.
- **App bar:** the **brand glass pill** — `<a class="brand">` with `brand__mark`
  (logo-icon.webp, 38px) + `brand__text` (`<strong>ToolWizHub</strong>` + tiny
  uppercase `<span>JSON TOOLKIT</span>`). Never a plain logo + "JSONKit" text.

Assets in `assets/`: `logo-full.webp`, `logo-icon.webp`, `favicon.webp`,
`logo-horizontal.webp` — shared brand marks, copy from any sibling. Footer is the
minimal `app-footer` (netlens pattern), not the big marketing footer.
