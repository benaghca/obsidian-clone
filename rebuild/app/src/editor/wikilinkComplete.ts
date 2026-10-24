// File, heading and block completions share CodeMirror's fuzzy matcher.
import { autocompletion, currentCompletions, selectedCompletionIndex, setSelectedCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { isolateHistory } from "@codemirror/commands";
import { ChangeSet, type ChangeSpec, type EditorState, type Text } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { parentDir } from "../paths";
import { frontmatterField } from "./frontmatter";
import { editorHost } from "./host";
import { headingLabel, headingTarget } from "./headings";
import { headingsFromTree, plainText } from "./outline";

function insertLink(view: EditorView, from: number, to: number, link: string, blockId: ChangeSpec = []) {
  const closed = view.state.sliceDoc(to, to + 2) === "]]";
  const changes = ChangeSet.of([blockId, { from, to: closed ? to + 2 : to, insert: link }], view.state.doc.length);
  view.dispatch({ changes, selection: { anchor: changes.mapPos(from, -1) + link.length },
    userEvent: "input.complete", annotations: isolateHistory.of("full") });
}
function applyLink(view: EditorView, completion: Completion, from: number, to: number) {
  const host = view.state.facet(editorHost);
  const path = (completion as Completion & { path: string }).path;
  insertLink(view, from - 2, to, host ? host.formatLink(path, view) : `[[${completion.label}]]`);
}

interface Block { from: number; to: number; label: string; id?: string; separate: boolean }
/** Syntax-tree blocks, preserving Markdown positions for a minimal ID insertion. */
export function linkBlocks(tree: Tree, doc: Text, start = 0): Block[] {
  const blocks: Block[] = [], source = doc.toString();
  function add(node: SyntaxNode) {
    if (node.from < start) return;
    const nested = node.name === "ListItem" ? node.getChild("BulletList") ?? node.getChild("OrderedList") : null;
    const to = nested ? node.from + source.slice(node.from, nested.from).trimEnd().length : node.to;
    const raw = source.slice(node.from, to);
    if (!raw.trim() || /^\^[a-zA-Z0-9-]+\s*$/.test(raw)) return;
    const inline = /(?:^|[ \t]+)\^([a-zA-Z0-9-]+)[ \t]*$/.exec(raw);
    const separate = !/^(Paragraph|ListItem|ATXHeading[1-6])$/.test(node.name);
    const after = /^\s*\n\s*\^([a-zA-Z0-9-]+)[ \t]*(?:\n|$)/.exec(source.slice(to));
    let label = inline ? raw.slice(0, inline.index) : raw;
    if (node.name === "FencedCode") label = label.replace(/^[^\n]*\n/, "").replace(/\n[ \t]*(`{3,}|~{3,})[ \t]*$/, "");
    else label = label.replace(/^[ \t]*>[ \t]?/gm, "").replace(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, "").split("\n").map(plainText).join("\n");
    blocks.push({ from: node.from, to, label: label.trim(), id: inline?.[1] ?? after?.[1], separate });
  }
  function list(node: SyntaxNode) {
    for (let item = node.firstChild; item; item = item.nextSibling) if (item.name === "ListItem") {
      add(item);
      for (let child = item.firstChild; child; child = child.nextSibling) if (child.name === "BulletList" || child.name === "OrderedList") list(child);
    }
  }
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === "BulletList" || node.name === "OrderedList") list(node); else add(node);
  }
  return blocks;
}

async function subpathSource(ctx: CompletionContext, from: number, target: string, blocks: boolean, queryFrom: number): Promise<CompletionResult | null> {
  const host = ctx.state.facet(editorHost)!;
  const view = ctx.view;
  if (!view || !host.linkDocument) return null;
  const [path, section] = target.split("#");
  target = path;
  const document = await host.linkDocument(target, view);
  if (!document || ctx.aborted) return null;
  const { state } = document, doc = state.doc;
  let tree: Tree | null = null;
  while (!ctx.aborted && !(tree = ensureSyntaxTree(state, doc.length, 4))) await new Promise(resolve => setTimeout(resolve, 0));
  if (!tree || ctx.aborted) return null;
  const start = state.field(frontmatterField, false)?.end ?? 0;
  const headings = headingsFromTree(tree, doc).filter(h => h.from >= start);
  const sectionIndex = section ? headings.findIndex(h => headingTarget(headingLabel(doc.lineAt(h.from).text)).toLowerCase() === headingTarget(section).toLowerCase()) : -1;
  if (section && sectionIndex < 0) return null;
  const begin = headings[sectionIndex], end = begin ? headings.slice(sectionIndex + 1).find(h => h.level <= begin.level)?.from ?? doc.length : doc.length;
  const options: Completion[] = [];
  if (blocks) for (const block of linkBlocks(tree, doc, start)) {
    if (begin && (block.from < begin.from || block.from >= end)) continue;
    if (document.current && block.from <= ctx.pos && block.to >= ctx.pos) continue;
    options.push({ label: block.id ? `${block.label} ${block.id}` : block.label, displayLabel: block.label, detail: block.id, type: "block", apply(view, _option, _from, to) {
      let change: ChangeSpec = [], id = block.id;
      if (!id) {
        do { id = crypto.randomUUID().replaceAll("-", "").slice(0, 6); } while (doc.toString().includes(`^${id}`));
        change = { from: block.to, insert: `${block.separate ? "\n\n" : " "}^${id}` };
        if (document.current ? !view.state.doc.eq(doc) : !host.insertBlockId?.(document, change, view)) return;
      }
      insertLink(view, from, to, host.formatLink(target ? document.path! : "", view, undefined, `#^${id}`), document.current ? change : []);
    } });
  }
  else for (const heading of headings) {
    const raw = headingLabel(doc.lineAt(heading.from).text);
    options.push({ label: raw, detail: `H${heading.level}`, type: "heading", apply(view, _option, _from, to) {
      insertLink(view, from, to, host.formatLink(target ? document.path! : "", view, undefined, `#${headingTarget(raw)}`));
    } });
  }
  options.forEach((option, i) => option.sortText = String(i).padStart(8, "0"));
  return { from: queryFrom, options, validFor: document.current ? undefined : /^[^[\]|#^\n]*$/ };
}
function wikilinkSource(ctx: CompletionContext): CompletionResult | Promise<CompletionResult | null> | null {
  const before = ctx.matchBefore(/\[\[[^[\]|\n]*$/);
  if (!before || ctx.state.readOnly) return null;
  const host = ctx.state.facet(editorHost);
  if (!host) return null;
  for (let node: SyntaxNode | null = syntaxTree(ctx.state).resolveInner(before.from, 1); node; node = node.parent)
    if (["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock"].includes(node.name)) return null;
  const subpath = /^(.*?)(#\^?|\^)([^#^]*)$/.exec(before.text.slice(2));
  if (subpath) return subpathSource(ctx, before.from, subpath[1], subpath[2].includes("^"), before.from + 2 + subpath[1].length + subpath[2].length);
  if (/[#^]/.test(before.text)) return null;
  const options: Completion[] = host.linkCandidates().map((note, index) => ({
    label: note.name, detail: !note.name.includes("/") && parentDir(note.path) ? `${parentDir(note.path)}/` : undefined,
    sortText: String(index).padStart(8, "0"), apply: applyLink, type: "note", path: note.path,
  }));
  return { from: before.from + 2, options, validFor: /^[^[\]|#^\n]*$/ };
}
/** Frontmatter aliases. A separate source so note names stay synchronous. */
function aliasSource(ctx: CompletionContext): Promise<CompletionResult | null> | null {
  const before = ctx.matchBefore(/\[\[[^[\]|\n]*$/);
  if (!before || ctx.state.readOnly || /[#^]/.test(before.text)) return null;
  const host = ctx.state.facet(editorHost);
  if (!host?.linkAliases) return null;
  return host.linkAliases().then((aliases) => {
    if (ctx.aborted || !aliases.length) return null;
    const options: Completion[] = aliases.map((item, index) => ({
      label: item.alias,
      detail: item.name,
      type: "alias",
      sortText: `1${String(index).padStart(8, "0")}`,
      apply(view, _option, from, to) {
        insertLink(view, from - 2, to, host.formatLink(item.path, view, item.alias));
      },
    }));
    return { from: before.from + 2, options, validFor: /^[^[\]|#^\n]*$/ };
  }).catch(() => null);
}
const SVG_NS = "http://www.w3.org/2000/svg";

/** Corner arrow at the right of an alias row. */
function aliasArrow(): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("class", "svg-icon alias-arrow");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M2.5 10V4.2H8M6.2 2.4 8.4 4.2 6.2 6");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

function linkFooter(): HTMLElement {
  const footer = document.createElement("div");
  footer.className = "cm-link-suggest-footer";
  const parts: [string, string][] = [["#", "to link heading"], ["^", "to link blocks"], ["|", "to change display text"]];
  parts.forEach(([key, rest], i) => {
    if (i) footer.append(document.createTextNode("   "));
    footer.append(document.createTextNode("Type "));
    const mark = document.createElement("b");
    mark.textContent = key;
    footer.append(mark, document.createTextNode(`  ${rest}`));
  });
  return footer;
}

/** The open `[[` query, or null when the caret is not inside one. */
function bracketQuery(state: EditorState): string | null {
  const head = state.selection.main.head;
  const before = state.sliceDoc(Math.max(0, head - 500), head);
  const at = before.lastIndexOf("[[");
  if (at < 0) return null;
  const query = before.slice(at + 2);
  return /[\]|\n]/.test(query) ? null : query;
}

/** `[[#` headings of this note. `[[#^` is a block list and keeps the first row picked. */
function currentNoteHeadings(state: EditorState): boolean {
  const query = bracketQuery(state);
  return !!query && query.startsWith("#") && !query.startsWith("#^");
}

/** Anchor the popup 7px left of `[[`, add the footer, and leave `[[#` with nothing picked. */
const linkSuggestLayout = ViewPlugin.fromClass(class {
  private primed = "";
  update(update: ViewUpdate) {
    const view = update.view;
    const query = bracketQuery(update.state);
    const options = query ? currentCompletions(update.state) : [];
    const signature = options.map((option) => `${option.type ?? ""}:${option.label}`).join("\n");
    if (!query || !options.length) this.primed = "";
    else if (!currentNoteHeadings(update.state) && selectedCompletionIndex(update.state) == null && this.primed !== signature) {
      this.primed = signature;
      queueMicrotask(() => {
        const same = bracketQuery(view.state) === query && currentCompletions(view.state).map((option) => `${option.type ?? ""}:${option.label}`).join("\n") === signature;
        if (same && selectedCompletionIndex(view.state) == null) view.dispatch({ effects: setSelectedCompletion(0) });
      });
    }
    view.requestMeasure({
      read() {
        const tip = view.dom.querySelector(".cm-tooltip.cm-link-suggest") as HTMLElement | null;
        const open = bracketQuery(view.state);
        if (!tip || open == null) return null;
        const head = view.state.selection.main.head;
        const pos = head - open.length - 2;
        const coords = view.coordsAtPos(pos);
        if (!coords) return null;
        const rect = tip.getBoundingClientRect();
        const shift = new DOMMatrix(getComputedStyle(tip).transform).m41;
        return { tip, dx: coords.left - 7 - (rect.left - shift), subpath: /[#^]/.test(open) };
      },
      write(data) {
        if (!data) return;
        data.tip.style.transform = `translateX(${data.dx}px)`;
        data.tip.classList.toggle("cm-link-subpath", data.subpath);
        const footer = data.tip.querySelector(".cm-link-suggest-footer");
        if (data.subpath) footer?.remove();
        else if (!footer) data.tip.append(linkFooter());
      },
    });
  }
});

export const wikilinkCompletion = [
  autocompletion({
    override: [wikilinkSource, aliasSource], icons: false, activateOnTypingDelay: 0, selectOnOpen: false, maxRenderedOptions: 50,
    optionClass: completion => `mod-link-${completion.type}`,
    tooltipClass: () => "cm-link-suggest",
    addToOptions: [{ render: (completion) => completion.type === "alias" ? aliasArrow() : null, position: 90 }],
  }),
  linkSuggestLayout,
];
