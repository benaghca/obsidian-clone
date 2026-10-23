// File, heading and block completions share CodeMirror's fuzzy matcher.
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { isolateHistory } from "@codemirror/commands";
import { ChangeSet, type ChangeSpec, type Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
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
export const wikilinkCompletion = autocompletion({
  override: [wikilinkSource], icons: false, activateOnTypingDelay: 0, maxRenderedOptions: 50,
  optionClass: completion => `mod-link-${completion.type}`,
  tooltipClass: () => "cm-link-suggest",
});
