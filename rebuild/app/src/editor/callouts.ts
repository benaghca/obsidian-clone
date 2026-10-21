// Callouts (> [!type] Title), as Obsidian 1.14.4 draws them (observed): a
// box tinted with the type's colour, its icon and title in that colour, the
// body rendered as Reading view renders it. The types and aliases are
// Obsidian's; an unknown type looks like a note, titled after itself.
// "[!type]-" starts folded and "[!type]+" open; the chevron (or the title)
// folds and unfolds without touching the note. A click elsewhere in the box,
// or its "Edit this block" button, puts the caret in it, which shows the
// source (blocks.ts).

import { type EditorView, WidgetType } from "@codemirror/view";
import { h } from "../shell/dom";
import { icon, type IconName } from "../shell/icons";
import { isLinkEvent } from "./embeds";
import { readingMode } from "./livePreview";
import { destroyed, onDestroy, type Painted, paintLines, paintRange, release, decorate } from "./render";

export interface CalloutHeader {
  /** As written, lower-cased ("tldr"). */
  type: string;
  title: string;
  fold: "" | "+" | "-";
}

/** The first line of a blockquote, read as a callout's header (null: a plain quote). */
export function calloutHeader(line: string): CalloutHeader | null {
  const m = /^\s*>\s?\[!([^\]\s]+)\]([+-]?)[ \t]*(.*)$/.exec(line);
  return m ? { type: m[1].toLowerCase(), title: m[3].trim(), fold: m[2] as CalloutHeader["fold"] } : null;
}

// Each type's icon and colour token, and its aliases.
const KINDS: [IconName, string, string[]][] = [
  ["pencil", "blue", ["note"]],
  ["clipboard-list", "cyan", ["abstract", "summary", "tldr"]],
  ["info", "blue", ["info"]],
  ["circle-check", "blue", ["todo"]],
  ["flame", "cyan", ["tip", "hint", "important"]],
  ["check", "green", ["success", "check", "done"]],
  ["circle-help", "orange", ["question", "help", "faq"]],
  ["triangle-alert", "orange", ["warning", "caution", "attention"]],
  ["x", "red", ["failure", "fail", "missing"]],
  ["zap", "red", ["danger", "error"]],
  ["bug", "red", ["bug"]],
  ["list", "purple", ["example"]],
  ["quote", "gray", ["quote", "cite"]],
];

/** A type's icon and colour; an unknown type gets the note's. */
export function calloutKind(type: string): { icon: IconName; color: string } {
  const [kindIcon, color] = KINDS.find((k) => k[2].includes(type)) ?? KINDS[0];
  return { icon: kindIcon, color };
}

/** The callout's body: its lines after the header, without their "> ". */
export const calloutBody = (text: string) =>
  text
    .split("\n")
    .slice(1)
    .map((l) => l.replace(/^\s*> ?/, ""))
    .join("\n");

export class CalloutWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly chain: readonly string[],
  ) {
    super();
  }
  eq(o: CalloutWidget) {
    return o.text === this.text && o.chain.join("\0") === this.chain.join("\0");
  }
  toDOM(view: EditorView) {
    const header = calloutHeader(this.text.split("\n", 1)[0])!;
    const kind = calloutKind(header.type);
    // The title is markdown too: painted from the header line, after "[!type] ".
    const titleText = header.title || header.type[0].toUpperCase() + header.type.slice(1);
    const titled: Painted = decorate(titleText, view, this.chain);
    const inner = h("div", { class: "callout-title-inner" });
    paintRange(titled, inner, 0, titleText.length);
    const title = h("div", { class: "callout-title" }, h("div", { class: "callout-icon" }, icon(kind.icon)), inner);
    const content = h("div", { class: "callout-content" });
    const box = h("div", { class: "callout", "data-callout": header.type, "data-callout-fold": header.fold }, title, content);
    box.style.setProperty("--callout-color", `var(--callout-${kind.color})`);
    const body = calloutBody(this.text);
    let painted: Painted | null = null;
    if (body.trim()) {
      painted = decorate(body, view, this.chain);
      paintLines(painted, content);
    }
    const fold = header.fold ? h("div", { class: "callout-fold" }, icon("chevron-down")) : null;
    if (fold) {
      title.append(fold);
      box.classList.add("is-collapsible");
      box.classList.toggle("is-collapsed", header.fold === "-");
    }
    const edit = h("div", { class: "embed-action edit-block-button", "aria-label": "Edit this block", title: "Edit this block" }, icon("code-xml"));
    const dom = h("div", { class: "cm-callout" }, box, h("div", { class: "embed-actions" }, edit));
    dom.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || isLinkEvent(e)) return;
      if (fold && title.contains(e.target as Node)) box.classList.toggle("is-collapsed");
      else if (!view.state.facet(readingMode)) editAt(view, view.posAtDOM(dom));
      else return;
      e.preventDefault();
    });
    onDestroy(dom, () => {
      release(titled);
      if (painted) release(painted);
    });
    return dom;
  }
  destroy(dom: HTMLElement) {
    destroyed(dom);
  }
  ignoreEvent(e: Event) {
    return !isLinkEvent(e);
  }
}

/** Put the caret at `pos` in the editor (inside a block widget's source, which then shows). */
export function editAt(view: EditorView, pos: number) {
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  view.focus();
}
