// Obsidian-style Live Preview. Markdown syntax is hidden per element and comes
// back only while the selection touches that element (headings, quotes and
// rules reveal per line, code blocks as a whole). Bullets, checkboxes, tags,
// images and %%comments%% (dimmed, markers shown) always stay as they are.
// Decorations are built for the visible ranges only, so cost does not grow
// with document length. The same decorations, over a whole text, are what
// rendered callouts, tables and embeds show (render.ts).

import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type Range, type SelectionRange, StateEffect, type Text } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type MouseSelectionStyle,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { writeClipboard } from "./clipboard";
import { codeLabel, codeMarks } from "./codeHighlight";
import { isNotePath, isRemoteUrl } from "../links/external";
import { kept } from "../memo";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import { editingEmbed, embedSize, IMAGE_EXT, ImageWidget, NoteEmbedWidget } from "./embeds";
import { type HighlightColor, highlightColor } from "./format";
import { frontmatterField } from "./frontmatter";
import { editorHost } from "./host";
import { markdownURL } from "../links/internal";
import { DrawnWidget, embedChain, paintWith, readingMode, tickLine } from "./render";

/** The vault's files changed: links are drawn again (one to a missing note looks unresolved). */
export const filesChanged = StateEffect.define<null>();

/** An empty span drawn by CSS: a list bullet, a horizontal rule, the external link icon, a highlight's swatch. */
class SpanWidget extends WidgetType {
  constructor(
    readonly cls: string,
    readonly style?: string,
  ) {
    super();
  }
  eq(other: SpanWidget) {
    return other.cls === this.cls && other.style === this.style;
  }
  toDOM() {
    return h("span", { class: this.cls, style: this.style });
  }
}

class CheckboxWidget extends DrawnWidget {
  constructor(readonly checked: boolean) {
    super();
  }
  toDOM(view: EditorView) {
    const box = h("input", { class: "cm-task-checkbox", type: "checkbox" });
    box.checked = this.checked;
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      tickLine(view, view.state.doc.lineAt(view.posAtDOM(box)).number);
    });
    return box;
  }
}

// A markdown image pointing at another machine. Grove never fetches it: the
// image shows as a small link chip that opens the URL in the system browser
// on click, like any other external link.
class RemoteImageWidget extends DrawnWidget {
  constructor(
    readonly alt: string,
    readonly url: string,
  ) {
    super();
  }
  toDOM() {
    const text = this.alt || hostOf(this.url);
    return h("span", { class: "cm-link cm-rendered-link cm-remote-embed", "data-href": this.url, title: `Remote image, not loaded: ${this.url}` }, text);
  }
}

// A code block's language, top right (Live Preview), or its copy button,
// shown on hover (Reading view), as in Obsidian.

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
      writeClipboard(this.code);
    };
    if (this.reading) return h("button", { class: "copy-code-button", "aria-label": "Copy", onmousedown: copy }, icon("copy"));
    return h("span", { class: "code-block-flair", "aria-label": "Copy", onmousedown: copy }, codeLabel(this.lang));
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
/** A decoration made once, by key. */
const once = (key: string, make: () => Decoration) => kept(decoCache, key, make);
const cached = (kind: "mark" | "line", cls: string) => once(`${kind} ${cls}`, () => (kind === "mark" ? Decoration.mark({ class: cls }) : Decoration.line({ class: cls })));
// A coloured highlight's colour reaches CSS as --highlight-color, as a callout's does.
const tint = (color: HighlightColor) => `--highlight-color: var(--color-${color})`;
const swatch = (color: HighlightColor) => once(`swatch ${color}`, () => Decoration.replace({ widget: new SpanWidget("cm-highlight-swatch", tint(color)) }));
const highlight = (color: HighlightColor | null) =>
  color ? once(`highlight ${color}`, () => Decoration.mark({ class: "cm-highlight mod-color", attributes: { style: tint(color) } })) : cached("mark", "cm-highlight");

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
    if (reading) mark("cm-reading-text", visible.from, visible.to);
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
            // Inner text only: a child can't cancel its parent's line-through.
            mark(INLINE_FORMATS[name], node.from + 2, node.to - 2);
            return;
          case "Highlight": {
            // ==🔴coloured==: the emoji is hidden, a swatch of its colour while the markup shows.
            // While the markup shows, it is highlighted too.
            const color = highlightColor(doc.sliceString(node.from + 2, node.from + 4));
            const text = color ? node.from + 4 : node.from + 2;
            if (!touches(node.from, node.to)) {
              hide(node.from + 2, text);
              if (node.to - 2 > text) decos.push(highlight(color).range(text, node.to - 2));
            } else {
              if (color) decos.push(swatch(color).range(node.from + 2, text));
              decos.push(highlight(color).range(node.from, node.to));
            }
            return;
          }

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
            lineClass("cm-list-line", node.from, node.from);
            decorateListMark(node);
            return;

          case "Blockquote":
            lineClass("cm-blockquote", node.from, node.to);
            return;
          case "QuoteMark": {
            // A callout being edited shows all its markers (callouts.ts draws it otherwise).
            let quote = node.parent;
            while (quote && quote.name !== "Blockquote") quote = quote.parent;
            const callout = !!quote && /^\s*>\s?\[!/.test(doc.lineAt(quote.from).text) && touches(quote.from, quote.to);
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
    const href = url ? markdownURL(doc.sliceString(url.from, url.to)) : undefined;
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
    const raw = doc.sliceString(url.from, url.to), href = markdownURL(raw);
    const alt = doc.sliceString(marks[0].to, marks[1].from);
    if (isRemoteUrl(href)) {
      if (!touches(node.from, node.to)) decos.push(Decoration.replace({ widget: new RemoteImageWidget(alt, href) }).range(node.from, node.to));
    } else if (IMAGE_EXT.test(href) && editing !== node.from) {
      const widget = new ImageWidget(resolve(href), raw, url.from - node.from, embedSize(alt), marks[0].to - node.from, alt, node.to - node.from);
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
      const aliasText = alias ? doc.sliceString(alias.from, alias.to) : null;
      // No alias: a resize writes "|width" after the target (an empty "|" alias counts as one).
      const sizeAt = (alias?.from ?? (doc.sliceString(target.to, target.to + 1) === "|" ? target.to + 1 : target.to)) - from;
      const sizeText = aliasText ?? (doc.sliceString(target.to, target.to + 1) === "|" ? "" : null);
      const widget = new ImageWidget(resolve(src), src, target.from - from, embedSize(aliasText ?? ""), sizeAt, sizeText, node.to - from);
      decos.push(Decoration.replace({ widget }).range(from, node.to));
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


// Rendered text (callout bodies, table cells, embedded notes) looks like Reading view.
paintWith((state, view) => decorate(state, [{ from: 0, to: state.doc.length }], { sel: [], reading: true, view }), readingMode.of(true));
paintWith((state) => codeMarks(state, [{ from: 0, to: state.doc.length }]));

/** The mouse button came up: markup is revealed around the selection again. */
const pointerUp = StateEffect.define<null>();

/** Markup comes back around the selection in the focused editor, never in Reading view. */
const revealAround = (view: EditorView) => (view.state.facet(readingMode) || !view.hasFocus ? [] : view.state.selection.ranges);

/** A press at the left edge of newly revealed bold text belongs after its hidden opening marks. */
function strongTextStart(state: EditorState, pos: number, revealed: readonly { from: number; to: number }[]) {
  let node = syntaxTree(state).resolveInner(pos, 1);
  while (node.parent && node.name !== "StrongEmphasis") node = node.parent;
  if (node.name !== "StrongEmphasis" || revealed.some((r) => r.from <= node.to && r.to >= node.from)) return pos;
  const mark = node.getChild("EmphasisMark");
  return mark && mark.from <= pos && pos < mark.to ? mark.to : pos;
}

/**
 * Live Preview's decorations. While the mouse button is down the markup
 * shown stays as it was at the press, as in Obsidian: a click or a drag
 * doesn't reveal `**` or `[[ ]]` under the pointer and move the text away
 * from it. It catches up when the button comes up.
 */
export class LivePreview {
  decorations: DecorationSet;
  /** The ranges markup is revealed around. */
  revealed: readonly SelectionRange[];
  /** Where the last single click put the caret, for a double-click's word (`wordClick`). */
  clicked: number | null = null;
  /** While the button is down: what stops listening for it to come up. */
  private held: AbortController | null = null;
  constructor(readonly view: EditorView) {
    this.revealed = revealAround(view);
    this.decorations = this.build();
  }
  build() {
    const { view } = this;
    return Decoration.set(decorate(view.state, view.visibleRanges, { sel: this.revealed, reading: view.state.facet(readingMode), view }), true);
  }
  update(u: ViewUpdate) {
    const held = this.held !== null;
    if (
      (!held && (u.selectionSet || u.focusChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(pointerUp))))) ||
      u.docChanged ||
      u.viewportChanged ||
      syntaxTree(u.startState) !== syntaxTree(u.state) ||
      u.startState.facet(readingMode) !== u.state.facet(readingMode) ||
      u.startState.field(editingEmbed) !== u.state.field(editingEmbed) ||
      u.transactions.some((tr) => tr.effects.some((e) => e.is(filesChanged)))
    ) {
      this.revealed = held ? this.revealed.map((r) => r.map(u.changes)) : revealAround(u.view);
      this.decorations = this.build();
    }
  }
  press(event: MouseEvent) {
    if (event.button !== 0 || this.held) return;
    const before = this.view.state.selection;
    const held = (this.held = new AbortController());
    const letGo = () => {
      held.abort();
      this.held = null;
      let sel = this.view.state.selection;
      if (!this.view.state.facet(readingMode) && event.detail === 1 && sel.main.empty) {
        const anchor = strongTextStart(this.view.state, sel.main.head, this.revealed);
        if (anchor !== sel.main.head) {
          this.view.dispatch({ selection: { anchor } });
          sel = this.view.state.selection;
        }
      }
      this.clicked = event.detail === 1 && sel !== before && sel.main.empty ? sel.main.head : null;
      this.view.dispatch({ effects: pointerUp.of(null) });
    };
    // The end of a native drag, or the window losing focus, ends the press too.
    for (const type of ["mouseup", "dragend", "blur"]) window.addEventListener(type, letGo, held);
  }
  destroy() {
    this.held?.abort();
  }
}

const livePreviewPlugin = ViewPlugin.fromClass(LivePreview, {
  decorations: (v) => v.decorations,
  eventObservers: {
    mousedown(e) {
      this.press(e);
    },
  },
});

/**
 * A double-click selects the word its first click put the caret in. That
 * click may have revealed markup (a bold word's `**`) and moved the word
 * out from under the pointer; the second click shouldn't select the `**`.
 */
export const wordClick = (view: EditorView, event: MouseEvent): MouseSelectionStyle | null => {
  const at = view.plugin(livePreviewPlugin)?.clicked;
  const { main } = view.state.selection;
  if (event.detail !== 2 || at == null || !main.empty || main.head !== at || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return null;
  let word = view.state.wordAt(at);
  if (!word) return null;
  return {
    update: (u) => void (word = word!.map(u.changes)),
    get: (cur) => {
      if (cur === event) return EditorSelection.create([word!]);
      // Dragging on from there extends by words, as CodeMirror's own double-click does.
      const pos = view.posAtCoords({ x: cur.clientX, y: cur.clientY }, false);
      const there = view.state.wordAt(pos) ?? EditorSelection.cursor(pos);
      const { from, to } = word!;
      return EditorSelection.create([there.from < from ? EditorSelection.range(to, there.from) : EditorSelection.range(from, Math.max(to, there.to))]);
    },
  };
};

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

export const livePreview = [editingEmbed, livePreviewPlugin, EditorView.mouseSelectionStyle.of(wordClick), linkClicks];
