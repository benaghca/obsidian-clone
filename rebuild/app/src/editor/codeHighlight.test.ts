import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { codeLabel, codeLanguage, codeMarks } from "./codeHighlight";
import { markdownSyntax } from "./syntax";

/** Each coloured token of `doc` as "text=kind". */
const marked = (doc: string) => {
  const state = EditorState.create({ doc, extensions: markdownSyntax });
  ensureSyntaxTree(state, doc.length, 1000);
  return codeMarks(state, [{ from: 0, to: doc.length }]).map((r) => `${doc.slice(r.from, r.to)}=${r.value.spec.class.replace(/cm-code-/g, "")}`);
};

describe("code block languages", () => {
  it("knows Obsidian's names and aliases, in any case, and nothing else", () => {
    for (const name of ["js", "javascript", "jsx", "ts", "typescript", "tsx", "json", "css", "html", "xml", "svg", "py", "python", "rust", "sh", "bash", "zsh", "shell", "yml", "yaml", "sql", "md", "markdown", "JS", "Python"]) {
      expect(codeLanguage(name), name).not.toBeNull();
    }
    for (const name of ["", "rs", "weirdlang", "c", "text"]) expect(codeLanguage(name), name).toBeNull();
    expect(codeLanguage("ts title")).toBe(codeLanguage("ts"));
  });
  it("labels a block as Obsidian does, else as written", () => {
    expect(["js", "JS", "tsx", "bash", "zsh", "yml", "py", "rs", "weirdlang"].map(codeLabel)).toEqual(["JavaScript", "JavaScript", "TypeScript-JSX", "Shell", "Shell", "YAML", "py", "rs", "weirdlang"]);
  });
});

describe("code highlighting", () => {
  it("colours tokens by kind", () => {
    expect(marked('```js\n// hi\nconst a = obj.f(42, "s"); if (x) return null;\n```')).toEqual([
      "// hi=comment",
      "const=keyword",
      "a=plain",
      "==operator",
      "obj=property",
      ".=plain",
      "f=function",
      "42=value",
      '"s"=string',
      "if=keyword",
      "x=property",
      "return=keyword",
      "null=plain",
    ]);
    expect(marked("```bash\necho $HOME # c\n```")).toEqual(["echo=function", "$HOME=plain", "# c=comment"]);
    expect(marked("```md\n**b**\n```")).toEqual(["**=strong punctuation", "b=strong", "**=strong punctuation"]);
  });
  it("leaves unknown languages, the note's markdown and its inline HTML alone", () => {
    expect(marked('```weirdlang\nconst a = "s"\n```\n**bold** <b>x</b> `code`\n\n```\nlet x = 1\n```')).toEqual([]);
  });
  it("finds code inside lists and quotes", () => {
    expect(marked("- item\n\n  ```py\n  pass\n  ```\n> ```sql\n> SELECT\n> ```")).toEqual(["pass=keyword", "SELECT=keyword"]);
  });
});
