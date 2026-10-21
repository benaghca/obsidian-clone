// Code blocks coloured as Obsidian 1.14.4 colours them (observed): a fixed
// set of bundled languages, picked by the fence's language name or one of
// the aliases Obsidian accepts, parsed inside the note's own syntax tree
// (lang-markdown's nested parsing, so an edit re-parses only its block) and
// coloured by token kind with the --code-* tokens of theme.css. Only fenced
// code is coloured, never the note's markdown or its inline HTML, and only
// the visible part of it; rendered text (render.ts) paints the same marks.

import { css } from "@codemirror/lang-css";
import { htmlLanguage } from "@codemirror/lang-html";
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
import { jsonLanguage } from "@codemirror/lang-json";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { StandardSQL } from "@codemirror/lang-sql";
import { defineLanguageFacet, Language, languageDataProp, StreamLanguage, type StreamParser, syntaxTree } from "@codemirror/language";
import { python } from "@codemirror/legacy-modes/mode/python";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { xml } from "@codemirror/legacy-modes/mode/xml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { highlightTree, tags as t, tagHighlighter } from "@lezer/highlight";
import type { MarkdownParser } from "@lezer/markdown";

// Python, Rust, Shell, YAML and XML are CodeMirror's legacy modes, as in
// Obsidian's editor: a tenth of the size of their full parsers.
const legacy = (mode: StreamParser<unknown>) => StreamLanguage.define(mode);
const [pythonLanguage, rustLanguage, shellLanguage, yamlLanguage, xmlLanguage] = [python, rust, shell, yaml, xml].map(legacy);
// A markdown block is markdown again, as a language of its own: highlighting
// skips the note's markdown by its language data, and must not skip this.
const mdData = defineLanguageFacet();
const mdLanguage = new Language(mdData, (markdownLanguage.parser as MarkdownParser).configure({ props: [languageDataProp.add({ Document: mdData })] }));

// A fence's language as Obsidian names it on the block (Live Preview's
// label, top right), and what colours it. Names not listed show as written.
const LANGUAGES: Record<string, [label: string | null, Language | null]> = {
  js: ["JavaScript", javascriptLanguage],
  javascript: ["JavaScript", javascriptLanguage],
  jsx: ["JSX", jsxLanguage],
  ts: ["TypeScript", typescriptLanguage],
  typescript: ["TypeScript", typescriptLanguage],
  tsx: ["TypeScript-JSX", tsxLanguage],
  json: ["JSON", jsonLanguage],
  css: ["CSS", css().language],
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
  md: [null, mdLanguage],
  markdown: ["Markdown", mdLanguage],
};

const entry = (info: string) => LANGUAGES[info.trim().split(/\s/, 1)[0].toLowerCase()];

/** The language that colours a fence with this info string ("js", "Python", "ts title"), or null: plain. */
export const codeLanguage = (info: string): Language | null => entry(info)?.[1] ?? null;

/** The name Live Preview shows on a block: Obsidian's for the languages it knows, else as written. */
export const codeLabel = (info: string) => entry(info)?.[0] ?? info;

// Token kinds and the --code-* colour each one takes (styles/blocks.css),
// as Obsidian's editor colours them; "plain" keeps a token (a definition, a
// bracket) from taking the colour of the kind it belongs to.
const k = (kind: string) => `cm-code-${kind}`;
const highlighter = tagHighlighter(
  [
    { tag: [t.keyword, t.self, t.modifier, t.monospace], class: k("keyword") },
    { tag: [t.string, t.special(t.string), t.regexp, t.attributeValue, t.character, t.escape], class: k("string") },
    { tag: t.number, class: k("value") },
    { tag: [t.comment, t.meta, t.annotation], class: k("comment") },
    { tag: [t.operator, t.function(t.punctuation)], class: k("operator") },
    { tag: [t.punctuation, t.bracket, t.processingInstruction], class: k("punctuation") },
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
        t.paren,
        t.brace,
        t.squareBracket,
        t.separator,
      ],
      class: k("plain"),
    },
    { tag: t.strong, class: k("strong") },
    { tag: t.emphasis, class: k("em") },
  ],
  // The note's own markdown is Live Preview's or Source mode's to draw.
  { scope: (type) => type.prop(languageDataProp) !== markdownLanguage.data },
);

const marks = new Map<string, Decoration>();
const mark = (cls: string) => {
  let d = marks.get(cls);
  if (!d) marks.set(cls, (d = Decoration.mark({ class: cls })));
  return d;
};

/** The colour marks of the fenced code in `ranges` of `state`. */
export function codeMarks(state: EditorState, ranges: readonly { from: number; to: number }[]): Range<Decoration>[] {
  const tree = syntaxTree(state);
  const out: Range<Decoration>[] = [];
  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter: (n) => {
        if (n.name !== "FencedCode") return n.name === "Document" || n.name.endsWith("List") || n.name === "ListItem" || n.name === "Blockquote";
        highlightTree(tree, highlighter, (f, t, cls) => out.push(mark(cls).range(f, t)), Math.max(from, n.from), Math.min(to, n.to));
        return false;
      },
    });
  }
  return out;
}

/** Highlighting in the editor, all three modes: the visible code, again when the text, the tree or the viewport changes. */
export const codeHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = Decoration.set(codeMarks(view.state, view.visibleRanges), true);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = Decoration.set(codeMarks(u.state, u.view.visibleRanges), true);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
