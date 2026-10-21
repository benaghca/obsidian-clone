// Code blocks coloured as Obsidian 1.14.4 colours them (observed): a fixed
// set of bundled languages, picked by the fence's language name or one of
// the aliases Obsidian accepts, coloured by token kind with the --code-*
// tokens of theme.css. Each visible block is parsed on its own and its tree
// kept, so typing in it re-parses only what the edit touched (the note's
// own tree, nested, would parse the whole block again on every key); blocks
// out of view cost nothing. Rendered text (render.ts) paints the same marks.

import { cssLanguage } from "@codemirror/lang-css";
import { htmlLanguage } from "@codemirror/lang-html";
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
import { jsonLanguage } from "@codemirror/lang-json";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { StandardSQL } from "@codemirror/lang-sql";
import { type Language, StreamLanguage, type StreamParser, syntaxTree } from "@codemirror/language";
import { python } from "@codemirror/legacy-modes/mode/python";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { xml } from "@codemirror/legacy-modes/mode/xml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { type ChangeSet, type EditorState, type Range, StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { type ChangedRange, type SyntaxNode, type Tree, TreeFragment } from "@lezer/common";
import { highlightTree, tags as t, tagHighlighter } from "@lezer/highlight";

// Python, Rust, Shell, YAML and XML are CodeMirror's legacy modes, as in
// Obsidian's editor: a tenth of the size of their full parsers.
const legacy = (mode: StreamParser<unknown>) => StreamLanguage.define(mode);
const [pythonLanguage, rustLanguage, shellLanguage, yamlLanguage, xmlLanguage] = [python, rust, shell, yaml, xml].map(legacy);

// A fence's language as Obsidian names it on the block (Live Preview's
// label, top right), and what colours it. Names not listed show as written.
const LANGUAGES: Record<string, [label: string | null, Language]> = {
  js: ["JavaScript", javascriptLanguage],
  javascript: ["JavaScript", javascriptLanguage],
  jsx: ["JSX", jsxLanguage],
  ts: ["TypeScript", typescriptLanguage],
  typescript: ["TypeScript", typescriptLanguage],
  tsx: ["TypeScript-JSX", tsxLanguage],
  json: ["JSON", jsonLanguage],
  css: ["CSS", cssLanguage],
  html: ["HTML", htmlLanguage],
  xml: ["XML", xmlLanguage],
  svg: [null, xmlLanguage],
  py: [null, pythonLanguage],
  python: ["Python", pythonLanguage],
  rust: ["Rust", rustLanguage],
  sh: ["Shell", shellLanguage],
  bash: ["Shell", shellLanguage],
  zsh: ["Shell", shellLanguage],
  shell: ["Shell", shellLanguage],
  yml: ["YAML", yamlLanguage],
  yaml: ["YAML", yamlLanguage],
  sql: ["SQL", StandardSQL.language],
  md: [null, markdownLanguage],
  markdown: ["Markdown", markdownLanguage],
};

const entry = (info: string) => LANGUAGES[info.trim().split(/\s/, 1)[0].toLowerCase()];

/** The language that colours a fence with this info string ("js", "Python", "ts title"), or null: plain. */
export const codeLanguage = (info: string): Language | null => entry(info)?.[1] ?? null;

/** The name Live Preview shows on a block: Obsidian's for the languages it knows, else as written. */
export const codeLabel = (info: string) => entry(info)?.[0] ?? info;

// Token kinds and the --code-* colour each one takes (styles/blocks.css),
// as Obsidian's editor colours them; "plain" keeps a token (a definition, a
// "." or null) from taking the colour of the kind it belongs to. Brackets and
// separators get no span at all (fewer elements to draw).
const k = (kind: string) => `cm-code-${kind}`;
const highlighter = tagHighlighter(
  [
    { tag: [t.keyword, t.self, t.modifier, t.monospace], class: k("keyword") },
    { tag: [t.string, t.special(t.string), t.regexp, t.attributeValue, t.character, t.escape], class: k("string") },
    { tag: t.number, class: k("value") },
    { tag: [t.comment, t.meta, t.annotation], class: k("comment") },
    { tag: [t.operator, t.function(t.punctuation)], class: k("operator") },
    { tag: [t.angleBracket, t.processingInstruction], class: k("punctuation") },
    { tag: t.tagName, class: k("tag") },
    { tag: t.heading, class: k("important") },
    { tag: [t.propertyName, t.typeName, t.standard(t.variableName), t.attributeName, t.labelName], class: k("function") },
    { tag: [t.variableName, t.special(t.variableName), t.macroName, t.className, t.constant(t.className), t.link, t.url], class: k("property") },
    {
      tag: [
        t.atom,
        t.null,
        t.definition(t.variableName),
        t.function(t.definition(t.variableName)),
        t.definition(t.className),
        t.definition(t.typeName),
        t.derefOperator,
      ],
      class: k("plain"),
    },
    { tag: t.strong, class: k("strong") },
    { tag: t.emphasis, class: k("em") },
]);

const marks = new Map<string, Decoration>();
const mark = (cls: string) => {
  let d = marks.get(cls);
  if (!d) marks.set(cls, (d = Decoration.mark({ class: cls })));
  return d;
};

type Ranges = readonly { from: number; to: number }[];

/** Each fenced code block in `ranges` (in lists and quotes too), with the part of it in the range. */
export function eachCodeBlock(state: EditorState, ranges: Ranges, fn: (block: SyntaxNode, from: number, to: number) => void) {
  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (n) => {
        if (n.name !== "FencedCode") return n.name === "Document" || n.name.endsWith("List") || n.name === "ListItem" || n.name === "Blockquote";
        fn(n.node, Math.max(from, n.from), Math.min(to, n.to));
        return false;
      },
    });
  }
}

/** A code block's own tree: its code from `from` to `to` in the note, in `lang`. */
interface CodeTree {
  from: number;
  to: number;
  lang: Language;
  tree: Tree;
  /** What an edit left reusable of it (the whole tree until one comes). */
  fragments: readonly TreeFragment[];
  stale: boolean;
}

/** The tree of a fenced block: kept from `trees` if its code is unchanged, else parsed again (reusing what an edit left). */
function codeTree(state: EditorState, block: SyntaxNode, trees: readonly CodeTree[]): CodeTree | null {
  const info = block.getChild("CodeInfo");
  const lang = info && codeLanguage(state.sliceDoc(info.from, info.to));
  // In a quote, each line's code is its own CodeText (between the "> ").
  const code = block.getChildren("CodeText");
  if (!lang || !code.length) return null;
  const from = code[0].from;
  const to = code[code.length - 1].to;
  const old = trees.find((c) => c.from === from && c.lang === lang);
  if (old && !old.stale && old.to === to) return old;
  const ranges = code.map((c) => ({ from: c.from - from, to: c.to - from }));
  const tree = lang.parser.parse(state.sliceDoc(from, to), old?.fragments ?? [], ranges);
  return { from, to, lang, tree, fragments: TreeFragment.addTree(tree), stale: false };
}

/** A kept tree after a change: moved with its text, what the change touched marked for re-parsing (null: the change ran past it). */
function mapTree(c: CodeTree, changes: ChangeSet): CodeTree | null {
  const from = changes.mapPos(c.from, -1);
  const to = changes.mapPos(c.to, 1);
  const touched: ChangedRange[] = [];
  let broken = false;
  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (toA < c.from || fromA > c.to) return;
    if (fromA < c.from || toA > c.to) broken = true;
    touched.push({ fromA: fromA - c.from, toA: toA - c.from, fromB: fromB - from, toB: toB - from });
  });
  if (broken) return null;
  return touched.length ? { ...c, from, to, fragments: TreeFragment.applyChanges(c.fragments, touched), stale: true } : { ...c, from, to };
}

/** The colour marks of the fenced code in `ranges` of `state`; the trees it used are added to `keep`. */
export function codeMarks(state: EditorState, ranges: Ranges, trees: readonly CodeTree[] = [], keep: CodeTree[] = []): Range<Decoration>[] {
  const out: Range<Decoration>[] = [];
  eachCodeBlock(state, ranges, (block, from, to) => {
    const c = codeTree(state, block, keep.length ? [...keep, ...trees] : trees); // a block in two visible ranges is parsed once
    if (!c) return;
    if (!keep.includes(c)) keep.push(c);
    highlightTree(c.tree, highlighter, (a, b, cls) => out.push(mark(cls).range(c.from + a, c.from + b)), from - c.from, to - c.from);
  });
  return out;
}

const rehighlight = StateEffect.define<null>();

/**
 * Highlighting in the editor, all three modes: the visible code, again when
 * the viewport or the tree changes. An edit moves the marks with the text at
 * once and colours the code again just after that frame is drawn, so a key
 * press never waits for a code block's parse (it is one frame behind).
 */
export const codeHighlight = ViewPlugin.fromClass(
  class {
    trees: CodeTree[] = [];
    decorations: DecorationSet;
    queued = false;
    gone = false;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) {
        this.trees = this.trees.flatMap((c) => mapTree(c, u.changes) ?? []);
        this.decorations = this.decorations.map(u.changes);
        if (!this.queued) {
          this.queued = true;
          requestAnimationFrame(() =>
            setTimeout(() => {
              this.queued = false;
              if (!this.gone) u.view.dispatch({ effects: rehighlight.of(null) });
            }),
          );
        }
      } else if (u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state) || u.transactions.some((tr) => tr.effects.some((e) => e.is(rehighlight)))) {
        this.decorations = this.build(u.view);
      }
    }
    destroy() {
      this.gone = true;
    }
    /** Only the blocks in view keep a tree. */
    build(view: EditorView) {
      const keep: CodeTree[] = [];
      const marks = codeMarks(view.state, view.visibleRanges, this.trees, keep);
      this.trees = keep;
      return Decoration.set(marks, true);
    }
  },
  { decorations: (v) => v.decorations },
);
