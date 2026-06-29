// editor.js — lightweight code editor: a monospace textarea with a synced
// line-number gutter, a JSON syntax-highlight overlay, tab-indent support, and an
// error-line marker. Dependency-free for the privacy-first, no-build goal.
import { highlightJSON, esc } from "./core/util.js";

const HL_LIMIT = 100000; // skip live highlighting above this size (perf)

export class Editor {
  constructor(root, { placeholder = "", onChange } = {}) {
    this.root = root;
    this.onChange = onChange;
    root.classList.add("editor");
    root.innerHTML = `
      <div class="editor__gutter" aria-hidden="true"></div>
      <div class="editor__main">
        <pre class="editor__hl" aria-hidden="true"><code></code></pre>
        <textarea class="editor__ta" spellcheck="false" autocomplete="off"
          autocapitalize="off" wrap="off" placeholder="${placeholder}"></textarea>
      </div>`;
    this.gutter = root.querySelector(".editor__gutter");
    this.hl = root.querySelector(".editor__hl code");
    this.ta = root.querySelector(".editor__ta");

    this.ta.addEventListener("input", () => { this.renderGutter(); this.renderHighlight(); this.clearMark(); this.onChange?.(); });
    this.ta.addEventListener("scroll", () => this.syncScroll());
    this.ta.addEventListener("keydown", (e) => this.onKey(e));
    this.renderGutter();
    this.renderHighlight();
  }

  onKey(e) {
    if (e.key === "Tab") {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en, value } = this.ta;
      if (s === en) {
        this.ta.value = value.slice(0, s) + "  " + value.slice(en);
        this.ta.selectionStart = this.ta.selectionEnd = s + 2;
      } else {
        const startLine = value.lastIndexOf("\n", s - 1) + 1;
        const block = value.slice(startLine, en);
        if (e.shiftKey) {
          const dedented = block.replace(/^ {1,2}/gm, "");
          this.ta.value = value.slice(0, startLine) + dedented + value.slice(en);
        } else {
          const indented = block.replace(/^/gm, "  ");
          this.ta.value = value.slice(0, startLine) + indented + value.slice(en);
        }
      }
      this.renderGutter();
      this.renderHighlight();
      this.onChange?.();
    }
  }

  renderGutter() {
    const lines = this.ta.value.split("\n").length || 1;
    if (this._lines === lines) return;
    this._lines = lines;
    let html = "";
    for (let i = 1; i <= lines; i++) html += `<span data-ln="${i}">${i}</span>`;
    this.gutter.innerHTML = html;
    this.gutter.scrollTop = this.ta.scrollTop;
  }

  renderHighlight() {
    const v = this.ta.value;
    if (v.length > HL_LIMIT) {
      // too big to highlight live — show plain text, make textarea text visible
      this.root.classList.add("editor--plain");
      this.hl.textContent = "";
      return;
    }
    this.root.classList.remove("editor--plain");
    // trailing newline needs a placeholder so heights match exactly
    this.hl.innerHTML = highlightJSON(v) + (v.endsWith("\n") ? "\n " : "");
    this.syncScroll();
  }

  syncScroll() {
    const { scrollTop, scrollLeft } = this.ta;
    this.gutter.scrollTop = scrollTop;
    const pre = this.hl.parentElement;
    pre.scrollTop = scrollTop;
    pre.scrollLeft = scrollLeft;
  }

  get value() { return this.ta.value; }
  set value(v) { this.ta.value = v ?? ""; this._lines = -1; this.renderGutter(); this.renderHighlight(); this.clearMark(); }

  focus() { this.ta.focus(); }

  markError(line) {
    this.clearMark();
    if (!line) return;
    const el = this.gutter.querySelector(`[data-ln="${line}"]`);
    if (el) {
      el.classList.add("gutter-err");
      const lineHeight = this.ta.scrollHeight / (this._lines || 1);
      this.ta.scrollTop = Math.max(0, (line - 4) * lineHeight);
      this.syncScroll();
    }
    this.root.classList.add("editor--err");
  }

  clearMark() {
    this.root.classList.remove("editor--err");
    this.gutter.querySelector(".gutter-err")?.classList.remove("gutter-err");
  }
}
