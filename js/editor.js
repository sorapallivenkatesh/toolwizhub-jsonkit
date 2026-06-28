// editor.js — lightweight code editor: a monospace textarea with a synced
// line-number gutter, tab-indent support, and an error-line marker.
// Kept dependency-free for the privacy-first, no-build goal.

export class Editor {
  constructor(root, { placeholder = "", onChange } = {}) {
    this.root = root;
    this.onChange = onChange;
    root.classList.add("editor");
    root.innerHTML = `
      <div class="editor__gutter" aria-hidden="true"></div>
      <textarea class="editor__ta" spellcheck="false" autocomplete="off"
        autocapitalize="off" wrap="off" placeholder="${placeholder}"></textarea>`;
    this.gutter = root.querySelector(".editor__gutter");
    this.ta = root.querySelector(".editor__ta");

    this.ta.addEventListener("input", () => { this.renderGutter(); this.clearMark(); this.onChange?.(); });
    this.ta.addEventListener("scroll", () => { this.gutter.scrollTop = this.ta.scrollTop; });
    this.ta.addEventListener("keydown", (e) => this.onKey(e));
    this.renderGutter();
  }

  onKey(e) {
    if (e.key === "Tab") {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en, value } = this.ta;
      if (s === en) {
        this.ta.value = value.slice(0, s) + "  " + value.slice(en);
        this.ta.selectionStart = this.ta.selectionEnd = s + 2;
      } else {
        // indent / outdent selected block
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

  get value() { return this.ta.value; }
  set value(v) { this.ta.value = v ?? ""; this._lines = -1; this.renderGutter(); this.clearMark(); }

  focus() { this.ta.focus(); }

  // Highlight an error line and scroll to it.
  markError(line) {
    this.clearMark();
    if (!line) return;
    const el = this.gutter.querySelector(`[data-ln="${line}"]`);
    if (el) {
      el.classList.add("gutter-err");
      const lineHeight = this.ta.scrollHeight / (this._lines || 1);
      this.ta.scrollTop = Math.max(0, (line - 4) * lineHeight);
      this.gutter.scrollTop = this.ta.scrollTop;
    }
    this.root.classList.add("editor--err");
  }

  clearMark() {
    this.root.classList.remove("editor--err");
    this.gutter.querySelector(".gutter-err")?.classList.remove("gutter-err");
  }
}
