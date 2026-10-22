// Callouts (> [!type] Title), as Obsidian 1.14.4 draws them (observed): a
// box tinted with the type's colour, its icon and title in that colour, the
// body rendered as Reading view renders it. The types and aliases are
// Obsidian's; an unknown type looks like a note, titled after itself.
// "[!type]-" starts folded and "[!type]+" open; the chevron (or the title)
// folds and unfolds without touching the note (and it stays so while the
// note is open, as in Obsidian). A click elsewhere in the box,
// or its "Edit this block" button, puts the caret in it, which shows the
// source (blocks.ts).

import { syntaxTree } from "@codemirror/language";
import { Decoration, type EditorView } from "@codemirror/view";
import { h } from "../shell/dom";
import { icon, type IconName } from "../shell/icons";
import { BlockWidget, decorate, onDestroy, type Painted, paintLines, paintRange, paintWith, release } from "./render";

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

/** The callouts folded or unfolded by a click, by their text: drawn again (scrolled away and back), they stay so. */
const toggled = new WeakMap<EditorView, Set<string>>();

export class CalloutWidget extends BlockWidget {
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
    box.style.setProperty("--callout-color", `var(--color-${kind.color})`);
    const body = calloutBody(this.text);
    let painted: Painted | null = null;
    if (body.trim()) {
      // Its tasks can be ticked: line k of the body is line k + 1 of the callout.
      painted = decorate(body, view, this.chain, (line) => this.tick(view, dom, line + 1));
      paintLines(painted, content);
    }
    const fold = header.fold ? h("div", { class: "callout-fold" }, icon("chevron-down")) : null;
    if (fold) {
      title.append(fold);
      box.classList.add("is-collapsible");
      box.classList.toggle("is-collapsed", (header.fold === "-") !== !!toggled.get(view)?.has(this.text));
    }
    // The title folds and unfolds it (in Reading view too).
    const dom = this.box(view, "cm-callout", box, (_, dom) => view.posAtDOM(dom), (e) => {
      if (!fold || !title.contains(e.target as Node)) return false;
      box.classList.toggle("is-collapsed");
      const set = toggled.get(view) ?? toggled.set(view, new Set()).get(view)!;
      if (!set.delete(this.text)) set.add(this.text);
      return true;
    });
    onDestroy(dom, () => {
      release(titled);
      if (painted) release(painted);
    });
    return dom;
  }
}

// In a callout's body, as in Obsidian's, blocks sit 16 px apart (headings
// 40) and blank lines take no room: rendered text marks the first line of
// each block after the first, and the lines between blocks (styles/blocks.css
// spaces them inside callouts only).
const blockStart = Decoration.line({ class: "cm-block-start" });
const blank = Decoration.line({ class: "cm-blank" });
paintWith((state) => {
  const doc = state.doc;
  const out = [];
  let next = 1; // the first line not yet in a block
  for (let n = syntaxTree(state).topNode.firstChild; n; n = n.nextSibling) {
    const first = doc.lineAt(n.from).number;
    for (; next < first; next++) out.push(blank.range(doc.line(next).from));
    if (n.from > 0) out.push(blockStart.range(doc.line(first).from));
    next = doc.lineAt(n.to).number + 1;
  }
  for (; next <= doc.lines; next++) out.push(blank.range(doc.line(next).from));
  return out;
});
