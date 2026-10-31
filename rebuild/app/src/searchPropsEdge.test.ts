import { Text } from "@codemirror/state";
import { expect, test } from "vitest";
import { readProperties, splitFrontmatter } from "./editor/frontmatter";
import { headingPos } from "./editor/headings";
import { resolveLink } from "./links/internal";
import { isNoteFile } from "./paths";
import { tagsInText } from "./shell/linksTags";
import { searchVault, type NoteMatch } from "./shell/searchVault";

const files = {
  ".md": "only-in-dot\n#hidden\n",
  ".MD": "only-in-dot-upper\n",
  "dir/.md": "nested dot\n",
  "Real.md": "only-in-real\n",
  "Literal.md": "cost is $5.00 (usd) plus a+b and c++ and the mark .*\n",
  "Plain.md": "aaa aaab abc usd\n",
  "Quoted.md": "say \"hello\" there\n",
  "Emoji.md": "family \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466} and \u{1F600}\n",
  "Brackets.md": "see [draft] in the prose\n",
  "Notes/CASE.MD": "---\ntags: [café, a/b_c-d]\n---\n#タグ #end\u{1F642}more #123-ok\n",
  "Props.MD": "\uFEFF---\r\nempty:\r\nitems:\r\n  - one\r\n  - two\r\nnested:\r\n  child: x\r\ndue: 2026-10-31\r\ncount: \"42\"\r\nrank: 7\r\n---\r\nbody\r\n",
  "Dup.md": "---\nstatus: onlyprop\nStatus: other\n---\nstatus: onlyprop\n",
};

function notePaths(query: string): string[] {
  const found = searchVault(files, query);
  return Object.entries(found ?? {})
    .filter((entry): entry is [string, NoteMatch] => "count" in entry[1])
    .map(([path]) => path);
}

test("regex characters, quotes, emoji and empty queries are literal text", () => {
  expect(notePaths("$5.00")).toEqual(["Literal.md"]);
  expect(notePaths("a+b")).toEqual(["Literal.md"]);
  expect(notePaths(".*")).toEqual(["Literal.md"]);
  expect(notePaths("c++")).toEqual(["Literal.md"]);
  expect(notePaths(".")).toEqual(["Literal.md"]);
  expect(notePaths("(usd)")).toEqual(["Literal.md", "Plain.md"]);
  expect(notePaths("\"hello\"")).toEqual(["Quoted.md"]);
  expect(notePaths("\"\"")).toEqual([]);
  expect(notePaths("\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}")).toEqual(["Emoji.md"]);
  expect(notePaths("\u{1F600}")).toEqual(["Emoji.md"]);
  expect(notePaths("\"[draft]\"")).toEqual(["Brackets.md"]);
  expect(notePaths("[draft]")).toEqual([]);
  for (const query of ["", "   \t  ", "OR", "OR OR", "()", "\"\""]) expect(searchVault(files, query)).toBeNull();

  const needle = "n".repeat(20_000);
  const longFiles = { "Long.md": `prefix ${needle} suffix\n`, "Other.md": "nope\n" };
  expect(Object.keys(searchVault(longFiles, needle) ?? {})).toEqual(["Long.md"]);
  expect(searchVault(longFiles, `${needle}x`)).toEqual({});
});

test("a file named .md is not a note and its bytes are not a note match", () => {
  expect(isNoteFile(".md")).toBe(false);
  expect(isNoteFile(".MD")).toBe(false);
  expect(isNoteFile("dir/.md")).toBe(false);
  expect(isNoteFile("Notes/CASE.MD")).toBe(true);
  expect(notePaths("only-in-dot")).toEqual([]);
  expect(notePaths("only-in-dot-upper")).toEqual([]);
  expect(notePaths("only-in-real")).toEqual(["Real.md"]);
  const named = searchVault(files, "file:.md");
  expect(named?.[".md"]).toEqual({});
  expect(named?.[".MD"]).toEqual({});
  expect(named?.["dir/.md"]).toEqual({});
  // file: matches a basename, so every real note named *.md matches. The file
  // whose whole name is ".md" is the attachment above, not one of these notes.
  const namedNotes = notePaths("file:.md");
  expect(namedNotes).toContain("Real.md");
  expect(namedNotes).not.toContain(".md");
  expect(namedNotes).not.toContain(".MD");
  expect(namedNotes).not.toContain("dir/.md");
  const notes = [{ name: "Real", path: "Real.md" }];
  expect(resolveLink(".md", "Real.md", notes)).toBeNull();
  expect(resolveLink(".MD", "Real.md", notes)).toBeNull();
});

test("properties read duplicate keys, empties, lists, nested yaml, dates and string numbers", () => {
  const clean = splitFrontmatter(files["Props.MD"]);
  const props = clean && readProperties(clean.lines);
  expect(props?.map((p) => [p.key, p.type, p.value])).toEqual([
    ["empty", "text", ""],
    ["items", "list", ["one", "two"]],
    ["nested", "unknown", "child: x"],
    ["due", "date", "2026-10-31"],
    ["count", "text", "42"],
    ["rank", "number", "7"],
  ]);
  const dup = splitFrontmatter(files["Dup.md"]);
  expect(dup && readProperties(dup.lines)).toBeNull();
  expect(notePaths("[status:onlyprop]")).toEqual([]);
  expect(notePaths("[due:2026-10-31]")).toEqual(["Props.MD"]);
  expect(notePaths("[count:42]")).toEqual(["Props.MD"]);
  expect(notePaths("[rank:7]")).toEqual(["Props.MD"]);
  expect(notePaths("[empty]")).toEqual(["Props.MD"]);
  // The editor refuses a leading BOM before it will look for ---. Search still reads it.
  expect(files["Props.MD"].charCodeAt(0)).toBe(0xfeff);
  const doc = Text.of(files["Props.MD"].split("\n"));
  expect(doc.line(1).text.startsWith("---")).toBe(false);
});

test("an uppercase .MD file keeps tags with unusual characters", () => {
  expect(tagsInText(files["Notes/CASE.MD"])).toEqual(["café", "a/b_c-d", "タグ", "end", "123-ok"]);
  expect(notePaths("tag:café")).toEqual(["Notes/CASE.MD"]);
  expect(notePaths("tag:end")).toEqual(["Notes/CASE.MD"]);
  expect(notePaths("tag:more")).toEqual([]);
  expect(notePaths("tag:a/b_c-d")).toEqual(["Notes/CASE.MD"]);
});

test("missing headings and blocks still name the note; the caret has nowhere to land", () => {
  const notes = [
    { name: "Target", path: "Target.MD" },
    { name: "Source", path: "Source.md" },
  ];
  const doc = Text.of(["# Real", "", "paragraph ^known", ""]);
  expect(resolveLink("Target#Missing Heading", "Source.md", notes)).toBe("Target.MD");
  expect(resolveLink("Target#^nope", "Source.md", notes)).toBe("Target.MD");
  expect(resolveLink("Target|shown", "Source.md", notes)).toBeNull();
  expect(headingPos(doc, "Missing Heading")).toBeNull();
  expect(headingPos(doc, "^nope")).toBeNull();
  expect(headingPos(doc, "Real")).toBe(0);
  expect(headingPos(doc, "^known")).toBe(doc.line(3).from);
  expect(resolveLink("Ghost#Gone", "Source.md", notes)).toBeNull();
});
