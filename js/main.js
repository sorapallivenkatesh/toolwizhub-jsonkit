// main.js — JSONKit workbench orchestrator.
import { Editor } from "./editor.js";
import { parse } from "./core/parse.js";
import { treeHTML } from "./tools/view.js";
import { TOOLS, GROUP_ORDER, GROUP_ICON } from "./registry.js";
import { copy, download, esc, bytes, highlightJSON } from "./core/util.js";

const SAMPLE = {
  store: {
    name: "Corner Books",
    open: true,
    book: [
      { title: "Dune", author: "Frank Herbert", price: 9.99, tags: ["sci-fi", "classic"], year: 1965 },
      { title: "The Hobbit", author: "J.R.R. Tolkien", price: 7.5, tags: ["fantasy"], year: 1937 },
      { title: "Sapiens", author: "Yuval Noah Harari", price: 14.0, tags: ["history"], year: 2011 },
    ],
  },
  customer: { id: "c-1001", email: "reader@example.com", phone: "+1-555-0142", vip: true, notes: null },
  meta: { generated: "2026-06-28T10:00:00Z", version: 3, empty: {} },
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let edA, edB, current = null, lastOutput = null, wrap = false;

function init() {
  // splash
  dismissSplash();
  $("#year") && ($("#year").textContent = new Date().getFullYear());

  edA = new Editor($("#editor-a"), { placeholder: "Paste JSON here, upload a file, or load from a URL…", onChange: scheduleAuto });
  edB = new Editor($("#editor-b"), { placeholder: "Second JSON (for diff / merge / patch)…", onChange: scheduleAuto });

  buildSidebar();
  wireIO();
  wireOutput();
  wireLayout();
  registerSW();

  // restore from share hash, else sample
  if (!restoreFromHash()) {
    edA.value = JSON.stringify(SAMPLE, null, 2);
  }
  // pick the initial tool: share hash > ?t= deep link > default
  let initialId = "beautify";
  if (current) initialId = current.id;
  else {
    const t = new URLSearchParams(location.search).get("t");
    if (t && TOOLS.some((x) => x.id === t)) initialId = t;
  }
  selectTool(initialId);
}

/* ---------------- sidebar ---------------- */
function buildSidebar() {
  const nav = $("#tool-nav");
  const byGroup = {};
  for (const t of TOOLS) (byGroup[t.group] ||= []).push(t);
  let html = "";
  for (const g of GROUP_ORDER) {
    const tools = byGroup[g];
    if (!tools) continue;
    html += `<div class="grp"><div class="grp__h"><span class="grp__ic">${GROUP_ICON[g] || ""}</span>${esc(g)}</div>`;
    for (const t of tools) {
      // real anchors (crawlable deep links) that behave as SPA buttons
      html += `<a class="tool" href="?t=${t.id}" data-id="${t.id}" title="${esc(t.desc)}">${esc(t.label)}</a>`;
    }
    html += `</div>`;
  }
  nav.innerHTML = html;
  nav.addEventListener("click", (e) => {
    const b = e.target.closest(".tool");
    if (b) { e.preventDefault(); selectTool(b.dataset.id); }
  });

  // search filter
  $("#tool-search").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    for (const btn of $$(".tool", nav)) {
      const t = TOOLS.find((x) => x.id === btn.dataset.id);
      const hit = !q || t.label.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q) || t.group.toLowerCase().includes(q);
      btn.style.display = hit ? "" : "none";
    }
    for (const grp of $$(".grp", nav)) {
      const any = $$(".tool", grp).some((b) => b.style.display !== "none");
      grp.style.display = any ? "" : "none";
    }
  });
}

function selectTool(id) {
  const tool = TOOLS.find((t) => t.id === id) || TOOLS[0];
  current = tool;
  $$(".tool").forEach((b) => b.classList.toggle("tool--on", b.dataset.id === tool.id));
  $("#tool-title").textContent = tool.label;
  $("#tool-desc").textContent = tool.desc;
  $("#panel-b").hidden = !tool.needsB;
  buildOptions(tool);
  updateRoute(tool);
  runTool();
}

// Reflect the active tool in the URL (?t=id) and page title for deep-linking/SEO.
function updateRoute(tool) {
  if (location.hash.startsWith("#s=")) return; // don't clobber a share link
  try { history.replaceState(null, "", `${location.pathname}?t=${tool.id}`); } catch {}
  document.title = `${tool.label} — JSONKit | the JSON toolkit · ToolWizHub`;
  const md = document.querySelector('meta[name="description"]');
  if (md) md.setAttribute("content", `${tool.desc} Free and 100% in your browser — nothing uploaded. Part of JSONKit, the complete JSON toolkit by ToolWizHub.`);
}

function buildOptions(tool) {
  const wrap = $("#tool-opts");
  if (!tool.opts?.length) { wrap.innerHTML = ""; wrap.hidden = true; return; }
  wrap.hidden = false;
  wrap.innerHTML = tool.opts.map((o) => {
    if (o.type === "select") {
      return `<label class="opt"><span>${esc(o.label)}</span><select data-opt="${o.id}">${o.options.map((v) => `<option ${v === o.default ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`;
    }
    if (o.type === "checkbox") {
      return `<label class="opt opt--cb"><input type="checkbox" data-opt="${o.id}" ${o.default ? "checked" : ""}><span>${esc(o.label)}</span></label>`;
    }
    if (o.type === "number") {
      return `<label class="opt"><span>${esc(o.label)}</span><input type="number" data-opt="${o.id}" value="${o.default ?? ""}"></label>`;
    }
    return `<label class="opt opt--text"><span>${esc(o.label)}</span><input type="text" data-opt="${o.id}" value="${esc(o.default ?? "")}" placeholder="${esc(o.placeholder || "")}"></label>`;
  }).join("");
  wrap.addEventListener("input", scheduleAuto);
}

function gatherOpts(tool) {
  const o = {};
  for (const def of tool.opts || []) {
    const el = $(`[data-opt="${def.id}"]`);
    if (!el) { o[def.id] = def.default; continue; }
    o[def.id] = el.type === "checkbox" ? el.checked : el.value;
  }
  return o;
}

/* ---------------- run ---------------- */
let autoTimer = null;
function scheduleAuto() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(runTool, 180);
}

function runTool() {
  if (!current) return;
  const tool = current;
  const rawText = edA.value;
  const out = $("#output");
  edA.clearMark();
  try {
    let value = null;
    if (!tool.rawInput) {
      const r = parse(rawText);
      if (r.empty) { renderNote("Paste some JSON to begin, or click “Sample”."); return; }
      if (!r.ok) { renderParseError(r, "input A"); return; }
      value = r.value;
    }
    const ctx = {
      rawText,
      validate: () => doValidate(rawText),
    };
    if (tool.needsB) {
      const rb = parse(edB.value);
      if (rb.empty) { renderNote("This tool needs a second JSON document in panel B."); return; }
      if (!rb.ok) { renderParseError(rb, "input B"); return; }
      ctx.valueB = rb.value;
    }
    const result = tool.run(value, gatherOpts(tool), ctx);
    render(result);
    saveHistory(rawText);
  } catch (err) {
    out.innerHTML = `<div class="out-err"><div class="out-err__t">⚠ ${esc(err.message || String(err))}</div></div>`;
    lastOutput = null;
  }
}

function doValidate(rawText) {
  const r = parse(rawText);
  return { kind: "validate", result: r };
}

/* ---------------- rendering ---------------- */
function render(result) {
  const out = $("#output");
  lastOutput = null;
  switch (result.kind) {
    case "code": return renderCode(result.text, result.lang);
    case "tree": return renderTree(result.value);
    case "table": return renderTable(result.columns, result.rows, result.empty);
    case "report": return renderReport(result.sections);
    case "stats": return renderStats(result.data);
    case "diff": return renderDiff(result.report);
    case "validate": return renderValidate(result.result);
    case "note": return renderNote(result.text);
    default: return renderNote("Nothing to show.");
  }
}

function setToolbar(on) {
  $("#out-copy").disabled = !on;
  $("#out-download").disabled = !on;
  $("#out-toinput").disabled = !on;
}

function renderCode(text, lang) {
  lastOutput = { text, lang };
  setToolbar(true);
  const body = lang === "json" ? highlightJSON(text) : esc(text);
  $("#output").innerHTML = `<pre class="out-code ${wrap ? "wrap" : ""}"><code>${body}</code></pre>`;
  $("#out-lang").textContent = lang;
  $("#out-size").textContent = bytes(new TextEncoder().encode(text).length);
}

function renderNote(text) {
  setToolbar(false);
  $("#out-lang").textContent = ""; $("#out-size").textContent = "";
  $("#output").innerHTML = `<div class="out-note">${esc(text)}</div>`;
}

function renderTree(value) {
  setToolbar(true);
  lastOutput = { text: JSON.stringify(value, null, 2), lang: "json" };
  $("#out-lang").textContent = "tree"; $("#out-size").textContent = "";
  const out = $("#output");
  out.innerHTML = `<div class="out-tree-tools"><button id="tree-expand" class="mini">Expand all</button><button id="tree-collapse" class="mini">Collapse all</button><span class="mini-hint">click a row to copy its path</span></div>` + treeHTML(value);
  out.querySelectorAll(".t-toggle").forEach((el) => el.addEventListener("click", () => el.closest(".t-branch").classList.toggle("collapsed")));
  out.addEventListener("click", (e) => {
    const row = e.target.closest(".t-row");
    if (!row || row.classList.contains("t-toggle")) return;
    const p = row.dataset.path || row.closest("[data-path]")?.dataset.path;
    if (p) { copy(p); toast(`Copied path: ${p}`); }
  });
  $("#tree-expand").onclick = () => out.querySelectorAll(".t-branch").forEach((b) => b.classList.remove("collapsed"));
  $("#tree-collapse").onclick = () => out.querySelectorAll(".t-branch").forEach((b) => b.classList.add("collapsed"));
}

function renderTable(columns, rows, emptyMsg) {
  setToolbar(true);
  const tsv = [columns.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n");
  lastOutput = { text: tsv, lang: "tsv" };
  $("#out-lang").textContent = "table"; $("#out-size").textContent = `${rows.length} rows`;
  if (!rows.length) { renderNote(emptyMsg || "No rows."); return; }
  const head = columns.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
  $("#output").innerHTML = `<div class="out-tablewrap"><table class="out-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderReport(sections) {
  setToolbar(false);
  $("#out-lang").textContent = "report"; $("#out-size").textContent = "";
  lastOutput = { text: sections.map((s) => `## ${s.title}\n` + s.items.map((i) => `${i.label}: ${i.value}`).join("\n")).join("\n\n"), lang: "text" };
  setToolbar(true);
  $("#output").innerHTML = sections.map((s) => `
    <section class="rep">
      <h3 class="rep__h">${esc(s.title)}</h3>
      <div class="rep__body">${s.items.map((i) => `<div class="rep__row"><span class="rep__k">${esc(i.label)}</span><span class="rep__v">${esc(i.value)}</span></div>`).join("")}</div>
    </section>`).join("");
}

function renderStats(d) {
  setToolbar(false);
  $("#out-lang").textContent = "stats"; $("#out-size").textContent = "";
  const tc = Object.entries(d.typeCounts).map(([k, v]) => `<span class="chip">${esc(k)}: ${v}</span>`).join("");
  const kpis = [
    ["nodes", d.nodes], ["leaves", d.leaves], ["max depth", d.maxDepth],
    ["unique keys", d.uniqueKeys],
  ].map(([l, v]) => `<div class="kpi"><div class="kpi__n">${v}</div><div class="kpi__l">${l}</div></div>`).join("");
  const savings = d.input ? ` (${Math.max(0, Math.round((1 - d.minified / d.input) * 100))}% smaller than input)` : "";
  const largest = d.largest.map((x) => `<div class="rep__row"><span class="rep__k">${esc(x.path)}</span><span class="rep__v">${bytes(x.bytes)} · ${x.type}</span></div>`).join("");
  const topKeys = d.topKeys.map(([k, n]) => `<span class="chip">${esc(k)} ×${n}</span>`).join("");
  $("#output").innerHTML = `
    <div class="kpis">${kpis}</div>
    <section class="rep"><h3 class="rep__h">Size</h3><div class="rep__body">
      <div class="rep__row"><span class="rep__k">minified</span><span class="rep__v">${bytes(d.minified)}${savings}</span></div>
      <div class="rep__row"><span class="rep__k">pretty (2-space)</span><span class="rep__v">${bytes(d.pretty)}</span></div>
      ${d.input != null ? `<div class="rep__row"><span class="rep__k">your input</span><span class="rep__v">${bytes(d.input)}</span></div>` : ""}
    </div></section>
    <section class="rep"><h3 class="rep__h">Type distribution</h3><div class="chips">${tc}</div></section>
    <section class="rep"><h3 class="rep__h">Most common keys</h3><div class="chips">${topKeys}</div></section>
    <section class="rep"><h3 class="rep__h">Deepest path <span class="muted">(depth ${d.deepest.depth})</span></h3><div class="rep__body"><div class="rep__row"><span class="rep__k mono">${esc(d.deepest.path)}</span></div></div></section>
    <section class="rep"><h3 class="rep__h">Largest values</h3><div class="rep__body">${largest}</div></section>`;
}

function renderDiff(r) {
  setToolbar(true);
  lastOutput = { text: r.lines.map((l) => `${l.sign} ${l.path}  ${l.text}`).join("\n") || "(identical)", lang: "diff" };
  $("#out-lang").textContent = "diff"; $("#out-size").textContent = `${r.total} changes`;
  if (!r.total) { renderNote("✓ The two documents are structurally identical."); setToolbar(true); return; }
  const head = `<div class="diff-sum"><span class="d-add">+${r.counts.add} added</span><span class="d-rem">−${r.counts.remove} removed</span><span class="d-chg">~${r.counts.change} changed</span></div>`;
  const body = r.lines.map((l) => {
    const cls = l.sign === "+" ? "d-add" : l.sign === "-" ? "d-rem" : "d-chg";
    return `<div class="diff-line ${cls}"><span class="diff-sign">${l.sign}</span><span class="diff-path">${esc(l.path)}</span><span class="diff-val">${esc(l.text)}</span></div>`;
  }).join("");
  $("#output").innerHTML = head + `<div class="diff-body">${body}</div>`;
}

function renderValidate(r) {
  $("#out-lang").textContent = "validate"; $("#out-size").textContent = "";
  if (r.empty) { renderNote("Paste some JSON to validate."); return; }
  const out = $("#output");
  if (r.ok) {
    setToolbar(false);
    const warns = [];
    if (r.lint?.dupKeys?.length) warns.push(`<div class="v-warn">⚠ ${r.lint.dupKeys.length} duplicate key(s): ${r.lint.dupKeys.slice(0, 6).map((d) => `<code>${esc(d.key)}</code> (line ${d.line})`).join(", ")}</div>`);
    if (r.lint?.bigNums?.length) warns.push(`<div class="v-warn">⚠ ${r.lint.bigNums.length} number(s) exceed safe integer precision: ${r.lint.bigNums.slice(0, 4).map((b) => `<code>${esc(b.raw)}</code> (line ${b.line})`).join(", ")}</div>`);
    out.innerHTML = `<div class="v-ok">✓ Valid JSON</div>${warns.join("")}`;
  } else {
    edA.markError(r.error.line);
    setToolbar(false);
    let fixBtn = "";
    if (r.fix?.valid) {
      fixBtn = `<button id="apply-fix" class="btn btn--primary">Auto-fix & re-validate</button>`;
    }
    const changes = r.fix?.changes?.length ? `<ul class="v-changes">${r.fix.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : "";
    out.innerHTML = `
      <div class="v-bad">✕ ${esc(r.error.message)}${r.error.line ? ` <span class="muted">(line ${r.error.line}${r.error.col ? ", col " + r.error.col : ""})</span>` : ""}</div>
      ${r.fix ? `<div class="v-fix"><div class="v-fix__h">Suggested fixes:</div>${changes}${fixBtn}</div>` : ""}`;
    if (r.fix?.valid) $("#apply-fix").onclick = () => { edA.value = JSON.stringify(r.fix.value, null, 2); runTool(); toast("Applied auto-fix"); };
  }
}

/* ---------------- output toolbar ---------------- */
function wireOutput() {
  $("#out-copy").onclick = async () => { if (lastOutput) { await copy(lastOutput.text); toast("Copied output"); } };
  $("#out-download").onclick = () => {
    if (!lastOutput) return;
    const ext = ({ json: "json", yaml: "yaml", xml: "xml", csv: "csv", typescript: "ts", go: "go", python: "py", sql: "sql", markdown: "md", html: "html", text: "txt", tsv: "tsv" })[lastOutput.lang] || "txt";
    download(`jsonkit-output.${ext}`, lastOutput.text, "text/plain");
  };
  $("#out-toinput").onclick = () => { if (lastOutput) { edA.value = lastOutput.text; runTool(); toast("Output → input"); } };
  $("#out-wrap").onclick = () => { wrap = !wrap; $("#out-wrap").classList.toggle("on", wrap); $(".out-code")?.classList.toggle("wrap", wrap); };
}

/* ---------------- I/O ---------------- */
function wireIO() {
  $("#io-sample").onclick = () => { edA.value = JSON.stringify(SAMPLE, null, 2); runTool(); };
  $("#io-clear").onclick = () => { edA.value = ""; edB.value = ""; runTool(); };
  $("#io-upload").onclick = () => $("#file").click();
  $("#file").onchange = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { edA.value = String(r.result); runTool(); toast(`Loaded ${f.name}`); };
    r.readAsText(f);
    e.target.value = "";
  };
  $("#io-url").onclick = async () => {
    const url = prompt("Fetch JSON from URL:\n(must allow cross-origin requests)");
    if (!url) return;
    toast("Fetching…");
    try {
      const res = await fetch(url);
      const text = await res.text();
      edA.value = text; runTool(); toast("Loaded from URL");
    } catch (err) { toast("Fetch failed: " + err.message); }
  };
  $("#io-share").onclick = async () => {
    try {
      const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ t: current?.id, a: edA.value, b: edB.value }))));
      const url = location.origin + location.pathname + "#s=" + payload;
      await copy(url);
      toast(url.length > 8000 ? "Link copied (large — may be truncated by some apps)" : "Share link copied");
    } catch { toast("Could not build link"); }
  };
  // drag & drop onto input A
  const dz = $("#editor-a");
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault(); dz.classList.remove("drag");
    const f = e.dataTransfer.files?.[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { edA.value = String(r.result); runTool(); }; r.readAsText(f);
  });
  // keyboard: ctrl/cmd+enter run, cmd+k focus search
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); runTool(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#tool-search").focus(); }
  });
}

function restoreFromHash() {
  const m = location.hash.match(/#s=(.+)$/);
  if (!m) return false;
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    edA.value = data.a || "";
    edB.value = data.b || "";
    if (data.t) current = TOOLS.find((t) => t.id === data.t) || null;
    return true;
  } catch { return false; }
}

/* ---------------- error rendering ---------------- */
function renderParseError(r, where) {
  setToolbar(false);
  $("#out-lang").textContent = ""; $("#out-size").textContent = "";
  if (where === "input A") edA.markError(r.error.line);
  let fixBtn = r.fix?.valid ? `<button id="apply-fix2" class="btn btn--primary">Auto-fix ${esc(where)}</button>` : "";
  $("#output").innerHTML = `<div class="out-err">
    <div class="out-err__t">✕ Invalid JSON in ${esc(where)}</div>
    <div class="out-err__m">${esc(r.error.message)}${r.error.line ? ` (line ${r.error.line}${r.error.col ? ", col " + r.error.col : ""})` : ""}</div>
    ${r.fix?.changes?.length ? `<div class="out-err__fix">Detected: ${r.fix.changes.map((c) => esc(c)).join(", ")}</div>` : ""}
    ${fixBtn}
    <div class="out-err__hint">Tip: use the <b>Validate</b> tool to inspect and repair.</div>
  </div>`;
  if (r.fix?.valid) {
    const ed = where === "input A" ? edA : edB;
    $("#apply-fix2").onclick = () => { ed.value = JSON.stringify(r.fix.value, null, 2); runTool(); toast("Applied auto-fix"); };
  }
}

/* ---------------- history & splash & toast ---------------- */
function saveHistory(text) {
  if (!text || text.length > 200000) return;
  try {
    const key = "jsonkit:history";
    const hist = JSON.parse(localStorage.getItem(key) || "[]");
    if (hist[0] !== text) { hist.unshift(text); localStorage.setItem(key, JSON.stringify(hist.slice(0, 10))); }
  } catch {}
}

function dismissSplash() {
  const sp = $("#splash");
  if (!sp) return;
  try { sessionStorage.setItem("jsonkit:splashed", "1"); } catch {}
  let gone = false;
  const hide = () => {
    if (gone) return; gone = true;
    sp.classList.add("hide");
    setTimeout(() => sp.remove(), 650);
  };
  sp.addEventListener("click", hide);
  setTimeout(hide, 1700); // let the loading bar finish first
}

let toastTimer;
function toast(msg) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

/* ---------------- resizable layout ---------------- */
function wireLayout() {
  const app = document.querySelector(".app");
  const work = document.querySelector(".work");
  const side = document.querySelector(".side");
  const colIn = document.querySelector(".col--in");

  // restore saved sizes
  try {
    const sw = localStorage.getItem("jsonkit:sideW");
    if (sw) side.style.flexBasis = sw;
    const sp = localStorage.getItem("jsonkit:split");
    if (sp) colIn.style.flexBasis = sp;
  } catch {}

  dragHandle($("#rz-side"), (x) => {
    const r = app.getBoundingClientRect();
    const padL = parseFloat(getComputedStyle(app).paddingLeft) || 0;
    let w = Math.max(190, Math.min(x - r.left - padL, 460));
    side.style.flexBasis = w + "px";
    try { localStorage.setItem("jsonkit:sideW", w + "px"); } catch {}
  });
  dragHandle($("#rz-work"), (x) => {
    const r = work.getBoundingClientRect();
    let w = Math.max(180, Math.min(x - r.left, r.width - 180));
    const pct = (w / r.width * 100).toFixed(2) + "%";
    colIn.style.flexBasis = pct;
    try { localStorage.setItem("jsonkit:split", pct); } catch {}
  });
}

function dragHandle(handle, onMove) {
  if (!handle) return;
  let active = false;
  const move = (e) => { if (!active) return; onMove(e.touches ? e.touches[0].clientX : e.clientX); e.preventDefault(); };
  const up = () => {
    active = false; handle.classList.remove("dragging");
    document.body.style.cursor = ""; document.body.style.userSelect = "";
    window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
    window.removeEventListener("touchmove", move); window.removeEventListener("touchend", up);
  };
  const down = (e) => {
    active = true; handle.classList.add("dragging");
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", move, { passive: false }); window.addEventListener("touchend", up);
    e.preventDefault();
  };
  handle.addEventListener("mousedown", down);
  handle.addEventListener("touchstart", down, { passive: false });
}

/* ---------------- PWA ---------------- */
function registerSW() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
}

document.addEventListener("DOMContentLoaded", init);
