// Obsidian-style Live Preview. Markdown syntax is hidden per element and comes
// back only while the selection touches that element (headings, quotes and
// rules reveal per line). Bullets, checkboxes and tags are always rendered.
// Decorations are built for the visible ranges only, so cost does not grow
// with document length.

import { syntaxTree } from "@codemirror/language";
import { Facet, type Range, type Text } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { isRemoteUrl } from "../links";
import { editorHost } from "./host";

/** Reading view: render everything, as if the selection touched nothing. */
export const readingMode = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) });

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-list-bullet";
    return span;
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
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task-checkbox";
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

class ExternalLinkWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-external-link";
    return span;
  }
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
    const span = document.createElement("span");
    span.className = "cm-link cm-rendered-link cm-remote-embed";
    span.dataset.href = this.url;
    span.title = `Remote image, not loaded: ${this.url}`;
    span.textContent = this.alt || hostOf(this.url);
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const hr = document.createElement("span");
    hr.className = "cm-hr";
    return hr;
  }
}

const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const checkbox = [false, true].map((c) => Decoration.replace({ widget: new CheckboxWidget(c) }));
const externalIcon = Decoration.widget({ widget: new ExternalLinkWidget(), side: 1 });
const rule = Decoration.replace({ widget: new RuleWidget() });
const markCache = new Map<string, Decoration>();
const lineCache = new Map<string, Decoration>();

const cachedMark = (cls: string) => {
  let d = markCache.get(cls);
  if (!d) markCache.set(cls, (d = Decoration.mark({ class: cls })));
  return d;
};
const cachedLine = (cls: string) => {
  let d = lineCache.get(cls);
  if (!d) lineCache.set(cls, (d = Decoration.line({ class: cls })));
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
  InlineCode: "cm-inline-code",
};

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const sel = state.facet(readingMode) ? [] : state.selection.ranges;
  const touches = (from: number, to: number) => sel.some((r) => r.from <= to && r.to >= from);
  const touchesLines = (from: number, to: number) => touches(doc.lineAt(from).from, doc.lineAt(to).to);
  const decos: Range<Decoration>[] = [];

  const hide = (from: number, to: number) => {
    if (to > from) decos.push(hidden.range(from, to));
  };
  const mark = (cls: string, from: number, to: number, href?: string) => {
    if (to <= from) return;
    const deco = href
      ? Decoration.mark({ class: cls, attributes: { "data-href": href } })
      : cachedMark(cls);
    decos.push(deco.range(from, to));
  };
  // Hide a leading marker plus the single space after it ("# ", "> ").
  const hideWithSpace = (node: { from: number; to: number }) =>
    hide(node.from, doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to);

  for (const visible of view.visibleRanges) {
    const lineClass = (cls: string, from: number, to: number) => {
      const start = Math.max(from, visible.from);
      const end = Math.min(to, visible.to);
      for (let pos = start; pos <= end; ) {
        const line = doc.lineAt(pos);
        decos.push(cachedLine(cls).range(line.from));
        pos = line.to + 1;
      }
    };

    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter: (ref) => {
        const name = ref.name;
        const node = ref.node;

        if (name.startsWith("ATXHeading")) {
          lineClass(`cm-h cm-h${name.slice(-1)}`, node.from, node.from);
          return;
        }
        if (name.startsWith("SetextHeading")) {
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

          case "EmphasisMark":
          case "StrikethroughMark":
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

          case "FencedCode": {
            lineClass("cm-codeblock", node.from, node.to);
            lineClass("cm-codeblock-begin", node.from, node.from);
            lineClass("cm-codeblock-end", node.to, node.to);
            return;
          }
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
          case "QuoteMark":
            if (touchesLines(node.from, node.from)) mark("cm-formatting cm-formatting-quote", node.from, node.to);
            else hideWithSpace(node);
            return;

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
    mark("cm-link cm-rendered-link", textFrom, textTo, href);
    hide(textTo, node.to);
    decos.push(externalIcon.range(node.to));
  }

  // Only remote images are rendered (as a link chip, never fetched); local
  // images stay as text until Grove can show vault files.
  function decorateImage(node: SyntaxNode) {
    const url = node.getChild("URL");
    const marks = node.getChildren("LinkMark");
    if (!url || marks.length < 2 || touches(node.from, node.to)) return;
    const href = doc.sliceString(url.from, url.to);
    if (!isRemoteUrl(href)) return;
    const alt = doc.sliceString(marks[0].to, marks[1].from);
    decos.push(Decoration.replace({ widget: new RemoteImageWidget(alt, href) }).range(node.from, node.to));
  }

  function decorateWikiLink(node: SyntaxNode) {
    const target = node.getChild("WikiLinkTarget");
    if (!target) return;
    const alias = node.getChild("WikiLinkAlias");
    const href = doc.sliceString(target.from, target.to).trim();
    if (touches(node.from, node.to)) {
      for (const m of node.getChildren("WikiLinkMark")) mark("cm-formatting cm-formatting-link", m.from, m.to);
      mark("cm-wikilink", target.from, target.to, href);
      if (alias) mark("cm-wikilink", alias.from, alias.to, href);
      return;
    }
    const shown = alias ?? target;
    hide(node.from, shown.from);
    mark("cm-wikilink cm-rendered-link", shown.from, shown.to, href);
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

  return Decoration.set(decos, true);
}

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
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        u.startState.facet(readingMode) !== u.state.facet(readingMode)
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
    if (el.classList.contains("cm-wikilink")) host.openLink(href, modifier ? (event.altKey ? "right" : "tab") : false, view);
    else host.openUrl(href);
    return true;
  },
});

export const livePreview = [livePreviewPlugin, linkClicks];
