// Obsidian-style Live Preview. Markdown syntax is hidden per element and comes
// back only while the selection touches that element (headings, quotes and
// rules reveal per line, code blocks as a whole). Bullets, checkboxes, tags,
// images and %%comments%% (dimmed, markers shown) always stay as they are.
// Decorations are built for the visible ranges only, so cost does not grow
// with document length. The same decorations, over a whole text, are what
// rendered callouts, tables and embeds show (render.ts).

import { syntaxTree } from "@codemirror/language";
import { type EditorState, Facet, type Range, StateEffect, type Text } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { writeClipboard } from "./clipboard";
import { isNotePath, isRemoteUrl } from "../links/external";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import { editingEmbed, embedSize, IMAGE_EXT, ImageWidget, NoteEmbedWidget } from "./embeds";
import { frontmatterField } from "./frontmatter";
import { editorHost } from "./host";
import { embedChain, paintWith } from "./render";

/** Reading view: render everything, as if the selection touched nothing. */
export const readingMode = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) });

/** The vault's files changed: links are drawn again (one to a missing note looks unresolved). */
export const filesChanged = StateEffect.define<null>();

/** An empty span drawn by CSS: a list bullet, a horizontal rule, the external link icon. */
class SpanWidget extends WidgetType {
  constructor(readonly cls: string) {
    super();
  }
  eq(other: SpanWidget) {
    return other.cls === this.cls;
  }
  toDOM() {
    return h("span", { class: this.cls });
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const box = h("input", { class: "cm-task-checkbox", type: "checkbox" });
    box.checked = this.checked;
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      toggleTask(view, view.posAtDOM(box));
    });
    return box;
  }
}

function toggleTask(view: EditorView, pos: number) {
  const line = view.state.doc.lineAt(pos);
  const m = /\[([ xX])\]/.exec(line.text.slice(pos - line.from));
  if (!m) return;
  const at = pos + m.index + 1;
  view.dispatch({ changes: { from: at, to: at + 1, insert: m[1] === " " ? "x" : " " }, userEvent: "input.toggle" });
}

// A markdown image pointing at another machine. Grove never fetches it: the
// image shows as a small link chip that opens the URL in the system browser
// on click, like any other external link.
class RemoteImageWidget extends WidgetType {
  constructor(
    readonly alt: string,
    readonly url: string,
  ) {
    super();
  }
  eq(other: RemoteImageWidget) {
    return other.alt === this.alt && other.url === this.url;
  }
  toDOM() {
    const text = this.alt || hostOf(this.url);
    return h("span", { class: "cm-link cm-rendered-link cm-remote-embed", "data-href": this.url, title: `Remote image, not loaded: ${this.url}` }, text);
  }
  ignoreEvent() {
    return false;
  }
}

// A code block's language, top right (Live Preview), or its copy button,
// shown on hover (Reading view), as in Obsidian.
const LANGUAGES: Record<string, string> = {
  js: "JavaScript", javascript: "JavaScript", ts: "TypeScript", typescript: "TypeScript", py: "Python", python: "Python",
  rs: "Rust", rust: "Rust", sh: "Shell", bash: "Bash", json: "JSON", css: "CSS", html: "HTML", md: "Markdown", sql: "SQL",
};

class CodeFlairWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly code: string,
    readonly reading: boolean,
  ) {
    super();
  }
  eq(o: CodeFlairWidget) {
    return o.lang === this.lang && o.code === this.code && o.reading === this.reading;
  }
  toDOM() {
    const copy = (e: Event) => {
      e.preventDefault();
      void writeClipboard(this.code);
    };
    if (this.reading) return h("button", { class: "copy-code-button", "aria-label": "Copy", title: "Copy", onmousedown: copy }, icon("copy"));
    return h("span", { class: "code-block-flair", "aria-label": "Copy", title: "Copy", onmousedown: copy }, LANGUAGES[this.lang.toLowerCase()] ?? this.lang);
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new SpanWidget("cm-list-bullet") });
const checkbox = [false, true].map((c) => Decoration.replace({ widget: new CheckboxWidget(c) }));
const externalIcon = Decoration.widget({ widget: new SpanWidget("cm-external-link"), side: 1 });
const rule = Decoration.replace({ widget: new SpanWidget("cm-hr") });
const decoCache = new Map<string, Decoration>();

/** A mark or line decoration with a class, made once. */
const cached = (kind: "mark" | "line", cls: string) => {
  let d = decoCache.get(`${kind} ${cls}`);
  if (!d) decoCache.set(`${kind} ${cls}`, (d = kind === "mark" ? Decoration.mark({ class: cls }) : Decoration.line({ class: cls })));
  return d;
};

/**
 * The text a checked task strikes through: from after "[x] " to the end of
 * the task's own line. A line typed right below a task belongs to the same
 * Task node (markdown's lazy continuation), but Obsidian renders it as plain
 * text, so it must not inherit the strikethrough.
 */
export function checkedTaskText(doc: Text, task: { to: number }, marker: { to: number }) {
  return { from: marker.to + 1, to: Math.min(task.to, doc.lineAt(marker.to).to) };
}

const INLINE_FORMATS: Record<string, string> = {
  Emphasis: "cm-em",
  StrongEmphasis: "cm-strong",
  Strikethrough: "cm-strikethrough",
  Highlight: "cm-highlight",
  InlineCode: "cm-inline-code",
};

/** What a decoration pass needs from its editor. */
interface Look {
  /** The selection markup comes back around (none in Reading view or an unfocused pane). */
  sel: readonly { from: number; to: number }[];
  reading: boolean;
  /** The editor whose links and files decide what a link or embed points at. */
  view: EditorView;
}

/**
 * The Live Preview decorations of `ranges` of `state`. Markup comes back
 * around the selection only in the focused editor, as in Obsidian: a pane
 * you're not typing in (or a note just opened elsewhere) keeps its headings'
 * # hidden, even with its caret on that line.
 */
function decorate(state: EditorState, ranges: readonly { from: number; to: number }[], { sel, reading, view }: Look): Range<Decoration>[] {
  const doc = state.doc;
  const touches = (from: number, to: number) => sel.some((r) => r.from <= to && r.to >= from);
  const touchesLines = (from: number, to: number) => touches(doc.lineAt(from).from, doc.lineAt(to).to);
  const decos: Range<Decoration>[] = [];
  // Links to missing notes are faded, as in Obsidian: wikilinks in both
  // views, markdown links to notes only in Reading view. One set lookup per
  // link drawn (links/internal.ts linkTargets).
  const host = view.state.facet(editorHost);
  const missing = (href: string) => !!host?.linkExists && !host.linkExists(href, view);
  const resolve = (target: string) => host?.embeds?.resolve(target, view) ?? null;
  const editing = state.field(editingEmbed, false);

  const hide = (from: number, to: number) => {
    if (to > from) decos.push(hidden.range(from, to));
  };
  const mark = (cls: string, from: number, to: number, href?: string) => {
    if (to <= from) return;
    const deco = href
      ? Decoration.mark({ class: cls, attributes: { "data-href": href } })
      : cached("mark", cls);
    decos.push(deco.range(from, to));
  };
  // Hide a leading marker plus the single space after it ("# ", "> ").
  const hideWithSpace = (node: { from: number; to: number }) =>
    hide(node.from, doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to);

  // The frontmatter is the Properties block's (properties.ts), never markdown.
  const bodyFrom = (state.field(frontmatterField, false)?.end ?? -1) + 1;
  for (const { from, to } of ranges) {
    if (to < bodyFrom) continue;
    const visible = { from: Math.max(from, bodyFrom), to };
    const lineClass = (cls: string, from: number, to: number) => {
      const start = Math.max(from, visible.from);
      const end = Math.min(to, visible.to);
      for (let pos = start; pos <= end; ) {
        const line = doc.lineAt(pos);
        decos.push(cached("line", cls).range(line.from));
        pos = line.to + 1;
      }
    };

    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter: (ref) => {
        const name = ref.name;
        const node = ref.node;

        if (name.startsWith("ATXHeading") || name.startsWith("SetextHeading")) {
          lineClass(`cm-h cm-h${name.slice(-1)}`, node.from, node.from);
          return;
        }

        switch (name) {
          case "HeaderMark": {
            const parent = node.parent!;
            if (!parent.name.startsWith("ATXHeading")) return;
            if (touchesLines(parent.from, parent.to)) mark("cm-formatting cm-formatting-header", node.from, node.to);
            else if (node.from === parent.from) hideWithSpace(node);
            else hide(node.from, node.to);
            return;
          }

          case "Emphasis":
          case "StrongEmphasis":
          case "InlineCode":
            mark(INLINE_FORMATS[name], node.from, node.to);
            return;
          case "Strikethrough":
          case "Highlight":
            // Inner text only: a child can't cancel its parent's line-through.
            mark(INLINE_FORMATS[name], node.from + 2, node.to - 2);
            return;

          case "Comment":
            if (reading) hide(node.from, node.to);
            else mark("cm-comment", node.from, node.to);
            return false;
          case "CommentBlock":
            mark("cm-comment", node.from, node.to);
            return false;

          case "EmphasisMark":
          case "StrikethroughMark":
          case "HighlightMark":
          case "CodeMark": {
            const parent = node.parent!;
            if (!(parent.name in INLINE_FORMATS)) {
              mark("cm-formatting cm-formatting-code-fence", node.from, node.to);
              return;
            }
            if (touches(parent.from, parent.to)) mark("cm-formatting", node.from, node.to);
            else hide(node.from, node.to);
            return;
          }

          case "FencedCode":
            lineClass("cm-codeblock", node.from, node.to);
            lineClass("cm-codeblock-begin", node.from, node.from);
            lineClass("cm-codeblock-end", node.to, node.to);
            decorateCodeBlock(node);
            return;
          case "CodeInfo":
            mark("cm-formatting cm-formatting-code-fence", node.from, node.to);
            return;

          case "Link":
            decorateLink(node);
            return false;
          case "Image":
            decorateImage(node);
            return false;
          case "URL":
            mark("cm-link cm-url", node.from, node.to, doc.sliceString(node.from, node.to));
            return;

          case "WikiLink":
            decorateWikiLink(node);
            return false;

          case "Tag":
            mark("cm-tag", node.from, node.to);
            return false;

          case "ListMark":
            decorateListMark(node);
            return;

          case "Blockquote":
            lineClass("cm-blockquote", node.from, node.to);
            return;
          case "QuoteMark": {
            // A callout being edited shows all its markers (callouts.ts draws it otherwise).
            const quote = node.parent!;
            const callout = quote.name === "Blockquote" && /^\s*>\s?\[!/.test(doc.lineAt(quote.from).text) && touches(quote.from, quote.to);
            if (callout || touchesLines(node.from, node.from)) mark("cm-formatting cm-formatting-quote", node.from, node.to);
            else hideWithSpace(node);
            return;
          }

          case "HorizontalRule":
            if (touchesLines(node.from, node.to)) mark("cm-formatting", node.from, node.to);
            else decos.push(rule.range(node.from, node.to));
            return;
        }
      },
    });
  }

  function decorateLink(node: SyntaxNode) {
    const marks = node.getChildren("LinkMark");
    const url = node.getChild("URL");
    if (marks.length < 2) return;
    const textFrom = marks[0].to;
    const textTo = marks[1].from;
    const href = url ? doc.sliceString(url.from, url.to) : undefined;
    if (!url || touches(node.from, node.to)) {
      for (const m of marks) mark("cm-formatting cm-formatting-link", m.from, m.to);
      mark("cm-link", textFrom, textTo, href);
      if (url) mark("cm-formatting cm-url", url.from, url.to);
      return;
    }
    hide(node.from, textFrom);
    const unresolved = !!href && reading && isNotePath(href) && missing(href);
    mark(`cm-link cm-rendered-link${unresolved ? " is-unresolved" : ""}`, textFrom, textTo, href);
    hide(textTo, node.to);
    // Only links that leave the vault get the external-link arrow (Obsidian's links to notes and headings have none).
    if (href && /^[a-z][a-z0-9+.-]*:/i.test(href.trim())) decos.push(externalIcon.range(node.to));
  }

  // A remote image is a link chip (never fetched); an image in the vault is
  // drawn, and stays drawn while the caret passes it, as in Obsidian.
  function decorateImage(node: SyntaxNode) {
    const url = node.getChild("URL");
    const marks = node.getChildren("LinkMark");
    if (!url || marks.length < 2) return;
    const href = doc.sliceString(url.from, url.to);
    const alt = doc.sliceString(marks[0].to, marks[1].from);
    if (isRemoteUrl(href)) {
      if (!touches(node.from, node.to)) decos.push(Decoration.replace({ widget: new RemoteImageWidget(alt, href) }).range(node.from, node.to));
    } else if (IMAGE_EXT.test(href) && editing !== node.from) {
      const widget = new ImageWidget(resolve(href), href, url.from - node.from, embedSize(alt));
      decos.push(Decoration.replace({ widget }).range(node.from, node.to));
    }
  }

  // ![[embeds]]: an image like the one above; a note's text below the line
  // while the caret is on it (its source showing), in place of it otherwise.
  function decorateEmbed(node: SyntaxNode, target: SyntaxNode, alias: SyntaxNode | null): boolean {
    const from = node.from - 1;
    const src = doc.sliceString(target.from, target.to).trim();
    if (IMAGE_EXT.test(src)) {
      if (editing === from) return false;
      const size = embedSize(alias ? doc.sliceString(alias.from, alias.to) : "");
      decos.push(Decoration.replace({ widget: new ImageWidget(resolve(src), src, target.from - from, size) }).range(from, node.to));
      return true;
    }
    if (/\.[a-z0-9]+$/i.test(src.split("#")[0]) && !/\.md$/i.test(src.split("#")[0])) return false; // other files stay links
    const widget = new NoteEmbedWidget(src, resolve(src.split("#")[0]), state.facet(embedChain));
    if (!touchesLines(from, node.to)) {
      decos.push(Decoration.replace({ widget }).range(from, node.to));
      return true;
    }
    decos.push(Decoration.widget({ widget, side: 1 }).range(doc.lineAt(node.to).to));
    return false;
  }

  function decorateWikiLink(node: SyntaxNode) {
    const target = node.getChild("WikiLinkTarget");
    if (!target) return;
    const alias = node.getChild("WikiLinkAlias");
    if (doc.sliceString(node.from - 1, node.from) === "!" && decorateEmbed(node, target, alias)) return;
    const href = doc.sliceString(target.from, target.to).trim();
    const cls = missing(href) ? "cm-wikilink is-unresolved" : "cm-wikilink";
    if (touches(node.from, node.to)) {
      for (const m of node.getChildren("WikiLinkMark")) mark("cm-formatting cm-formatting-link", m.from, m.to);
      mark(cls, target.from, target.to, href);
      if (alias) mark(cls, alias.from, alias.to, href);
      return;
    }
    const shown = alias ?? target;
    hide(node.from, shown.from);
    mark(`${cls} cm-rendered-link`, shown.from, shown.to, href);
    hide(shown.to, node.to);
  }

  function decorateListMark(node: SyntaxNode) {
    const item = node.parent;
    const list = item?.parent;
    if (!item || !list) return;
    const bulleted = list.name === "BulletList";
    const task = item.getChild("Task");
    const taskMarker = task?.getChild("TaskMarker");
    if (task && taskMarker) {
      const checked = /x/i.test(doc.sliceString(taskMarker.from, taskMarker.to));
      if (bulleted) decos.push(checkbox[+checked].range(node.from, taskMarker.to));
      else {
        mark("cm-list-number", node.from, node.to);
        decos.push(checkbox[+checked].range(taskMarker.from, taskMarker.to));
      }
      if (checked) {
        const done = checkedTaskText(doc, task, taskMarker);
        mark("cm-task-done", done.from, done.to);
      }
      return;
    }
    if (bulleted) decos.push(bullet.range(node.from, node.to));
    else mark("cm-list-number", node.from, node.to);
  }

  // Fences show while the selection is in the block; otherwise they hide,
  // and the opening line carries the language (or, reading, a copy button).
  function decorateCodeBlock(node: SyntaxNode) {
    if (touchesLines(node.from, node.to)) return;
    const first = doc.lineAt(node.from);
    const last = doc.lineAt(node.to);
    const info = node.getChild("CodeInfo");
    const text = node.getChild("CodeText");
    const lang = info ? doc.sliceString(info.from, info.to) : "";
    hide(first.from, first.to);
    if (last.number > first.number && /^\s*(```|~~~)/.test(last.text)) hide(last.from, last.to);
    if (lang || reading) {
      const widget = new CodeFlairWidget(lang, text ? doc.sliceString(text.from, text.to) : "", reading);
      decos.push(Decoration.widget({ widget, side: 1 }).range(first.to));
    }
  }

  return decos;
}

function build(view: EditorView): DecorationSet {
  const reading = view.state.facet(readingMode);
  const sel = reading || !view.hasFocus ? [] : view.state.selection.ranges;
  return Decoration.set(decorate(view.state, view.visibleRanges, { sel, reading, view }), true);
}

// Rendered text (callout bodies, table cells, embedded notes) looks like Reading view.
paintWith((state, view) => decorate(state, [{ from: 0, to: state.doc.length }], { sel: [], reading: true, view }), readingMode.of(true));

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        u.focusChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        u.startState.facet(readingMode) !== u.state.facet(readingMode) ||
        u.startState.field(editingEmbed) !== u.state.field(editingEmbed) ||
        u.transactions.some((tr) => tr.effects.some((e) => e.is(filesChanged)))
      ) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// A plain click on a rendered link follows it; Ctrl/Cmd-click always does,
// in a new tab for wikilinks (Ctrl/Cmd+Alt-click: in a new pane to the
// right, as in Obsidian). Clicking revealed (raw) link text just edits.
// The press only claims the link (so the caret stays put); the link is
// followed on the click that completes it, and only for a real user click,
// so a drag that starts on a link, or a scripted click, opens nothing.
let pressed: HTMLElement | null = null;

const followable = (event: MouseEvent) => {
  if (event.button !== 0) return null;
  const el = (event.target as HTMLElement).closest<HTMLElement>("[data-href]");
  if (!el) return null;
  const modifier = event.ctrlKey || event.metaKey;
  return modifier || el.classList.contains("cm-rendered-link") ? el : null;
};

const linkClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    pressed = followable(event);
    if (!pressed || !view.state.facet(editorHost)) return false;
    event.preventDefault();
    return true;
  },
  click(event, view) {
    const el = followable(event);
    const wasPressed = pressed;
    pressed = null;
    if (!el || el !== wasPressed || !event.isTrusted) return false;
    const host = view.state.facet(editorHost);
    if (!host) return false;
    event.preventDefault();
    const modifier = event.ctrlKey || event.metaKey;
    const href = el.dataset.href!;
    // [[wikilinks]], and [markdown](links) to notes ("Use [[Wikilinks]]" off), open in the app.
    if (el.classList.contains("cm-wikilink") || isNotePath(href)) host.openLink(href, modifier ? (event.altKey ? "right" : "tab") : false, view);
    else host.openUrl(href);
    return true;
  },
});

export const livePreview = [editingEmbed, livePreviewPlugin, linkClicks];
