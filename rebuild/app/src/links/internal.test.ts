import { expect, test } from "vitest";
import { formatLink, linkResolver, linkTargets, relativePath, resolveLink, rewriteLinks, takePathScans } from "./internal";

const notes = [
  { name: "Ideas", path: "Ideas.md" },
  { name: "Plan", path: "Projects/Plan.md" },
  { name: "Plan", path: "Archive/Plan.md" },
  { name: "Deep note", path: "Projects/Sub/Deep note.md" },
];

test("new links follow the link format and the wikilink setting", () => {
  const wiki = (format: "shortest" | "relative" | "absolute") => ({ format, wikilinks: true });
  expect(formatLink("Ideas.md", "Projects/Plan.md", notes, wiki("shortest"))).toBe("[[Ideas]]");
  expect(formatLink("Projects/Plan.md", "Ideas.md", notes, wiki("shortest"))).toBe("[[Projects/Plan]]"); // name is shared
  expect(formatLink("Projects/Sub/Deep note.md", "Projects/Plan.md", notes, wiki("relative"))).toBe("[[Sub/Deep note]]");
  expect(formatLink("Ideas.md", "Projects/Sub/Deep note.md", notes, wiki("relative"))).toBe("[[../../Ideas]]");
  expect(formatLink("Projects/Sub/Deep note.md", "Ideas.md", notes, wiki("absolute"), "deep")).toBe("[[Projects/Sub/Deep note|deep]]");
  expect(formatLink("Projects/Sub/Deep note.md", "Ideas.md", notes, { format: "shortest", wikilinks: false })).toBe("[Deep note](Deep%20note.md)");
  expect(formatLink("Ideas.md", "Projects/Plan.md", notes, { format: "relative", wikilinks: false }, undefined, "#Top")).toBe("[Ideas](../Ideas.md#Top)");
  expect(relativePath("", "a/b.md")).toBe("a/b.md");
  expect(relativePath("a/b", "a/c.md")).toBe("../c.md");
});

test("links resolve by vault path, by path from the note, or by name", () => {
  expect(resolveLink("Ideas", null, notes)).toBe("Ideas.md");
  expect(resolveLink("ideas#Heading", null, notes)).toBe("Ideas.md");
  expect(resolveLink("Projects/Plan", null, notes)).toBe("Projects/Plan.md");
  expect(resolveLink("Plan", "Projects/Sub/Deep note.md", notes)).toBe("Projects/Plan.md"); // shallowest when not beside
  expect(resolveLink("Plan", "Archive/Other.md", notes)).toBe("Archive/Plan.md"); // the one beside the linking note
  expect(resolveLink("../Plan", "Projects/Sub/Deep note.md", notes)).toBe("Projects/Plan.md");
  expect(resolveLink("Sub/Deep%20note.md", "Projects/Plan.md", notes)).toBe("Projects/Sub/Deep note.md");
  expect(resolveLink("../../../x", "a/b.md", notes)).toBeNull();
  expect(resolveLink("Missing", null, notes)).toBeNull();
});

test("the same snapshot resolves case, clashes, partial paths and a later edit", () => {
  const cased = [{ name: "A", path: "A.md" }, { name: "A", path: "a.md" }];
  expect(resolveLink("A", null, cased)).toBe("a.md"); // the later path wins when only case differs
  const partial = [{ name: "Note", path: "Z/Sub/Note.md" }, { name: "Note", path: "A/Sub/Note.md" }];
  expect(resolveLink("Sub/Note", null, partial)).toBe("Z/Sub/Note.md");
  const tied = [{ name: "Plan", path: "B/Plan.md" }, { name: "Plan", path: "A/Plan.md" }];
  expect(resolveLink("Plan", "Other/X.md", tied)).toBe("B/Plan.md"); // same depth: the earlier note
  expect(resolveLink("Plan", "A/X.md", tied)).toBe("A/Plan.md"); // the one beside the linking note
  const beside = [{ name: "Plan", path: "Shallow/Plan.md" }, { name: "Plan", path: "Deep/B/Plan.md" }];
  expect(resolveLink("Plan", "Deep/B/X.md", beside)).toBe("Deep/B/Plan.md"); // beside, though it is deeper
  expect(resolveLink("Upper", null, [{ name: "Upper", path: "Upper.MD" }])).toBe("Upper.MD");
  expect(resolveLink("pic.png", null, [{ name: "pic.png", path: "Assets/pic.png" }])).toBe("Assets/pic.png");
  const growing = [{ name: "A", path: "A.md" }];
  expect(resolveLink("Nested", null, growing)).toBeNull();
  growing.push({ name: "Nested", path: "Folder/Nested.md" });
  expect(resolveLink("Nested", null, growing)).toBe("Folder/Nested.md");
  const resolve = linkResolver(notes);
  expect(resolve("Plan", "Archive/Other.md")).toBe(resolveLink("Plan", "Archive/Other.md", notes));
  expect(resolve("../Plan", "Projects/Sub/Deep note.md")).toBe("Projects/Plan.md");
});

test("partial paths keep today's winner and do not walk the file list", () => {
  const rawFirst = [
    { name: "note", path: "other/folder/note" },
    { name: "Note", path: "x/folder/note.md" },
  ];
  expect(resolveLink("folder/note", null, rawFirst)).toBe("other/folder/note");
  expect(resolveLink("folder/note", null, [rawFirst[1], rawFirst[0]])).toBe("x/folder/note.md");
  expect(resolveLink("Folder/Note", null, [{ name: "Note", path: "Dir/Folder/Note.md" }])).toBe("Dir/Folder/Note.md");
  expect(resolveLink("dir/pic.png", null, [{ name: "pic.png", path: "assets/dir/pic.png" }])).toBe("assets/dir/pic.png");
  expect(resolveLink("no/such", null, rawFirst)).toBeNull();
  expect(resolveLink("/Sub/Note", null, [{ name: "Note", path: "X/Sub/Note.md" }])).toBeNull();
  expect(resolveLink("/Sub/Note", null, [{ name: "Note", path: "Sub/Note.md" }])).toBe("Sub/Note.md");
  const exact = [{ name: "Note", path: "Long/Sub/Note.md" }, { name: "Note", path: "Sub/Note.md" }];
  expect(resolveLink("Sub/Note", null, exact)).toBe("Sub/Note.md");
  expect(resolveLink("dir/.md", null, [{ name: ".md", path: "dir/.md" }])).toBeNull();
  expect(resolveLink(".MD", null, [{ name: ".MD", path: ".MD" }])).toBeNull();
  const growing = [{ name: "A", path: "A.md" }];
  expect(resolveLink("Sub/Note", null, growing)).toBeNull();
  growing.push({ name: "Note", path: "Z/Sub/Note.md" });
  expect(resolveLink("Sub/Note", null, growing)).toBe("Z/Sub/Note.md");

  const notes = Array.from({ length: 400 }, (_, i) => ({ name: `N${i}`, path: `d${i % 20}/N${i}.md` }));
  notes.push({ name: "Note", path: "Z/Sub/Note.md" }, { name: "pic.png", path: "assets/dir/pic.png" });
  const resolve = linkResolver(notes);
  takePathScans();
  expect(resolve("Sub/Note", null)).toBe("Z/Sub/Note.md");
  expect(resolve("dir/pic.png", "d0/N0.md")).toBe("assets/dir/pic.png");
  expect(resolve("no/such", null)).toBeNull();
  expect(resolve("Missing/Path", "d0/N0.md")).toBeNull();
  for (let i = 0; i < 8; i++) expect(resolve("gone/missing", null)).toBeNull();
  expect(takePathScans()).toBe(0);
});

test("renaming a note rewrites the links to it, keeping headings and display text, not code", () => {
  const before = [...notes, { name: "Old", path: "Old.md" }];
  const after = [...notes, { name: "New name", path: "Folder/New name.md" }];
  const text = [
    "See [[Old]] and [[Old#Part|the part]] and ![[old]].",
    "Also [old](Old.md#Part) and [[Ideas]] and [web](https://old.md).",
    "`[[Old]]` stays in code",
    "```",
    "[[Old]]",
    "```",
  ].join("\n");
  const r = rewriteLinks(text, "Ideas.md", "Old.md", "Folder/New name.md", before, after, { format: "shortest", wikilinks: true });
  expect(r.count).toBe(4);
  expect(r.text.split("\n")).toEqual([
    "See [[New name]] and [[New name#Part|the part]] and ![[New name]].",
    "Also [old](New%20name.md#Part) and [[Ideas]] and [web](https://old.md).",
    "`[[Old]]` stays in code",
    "```",
    "[[Old]]",
    "```",
  ]);
  const abs = rewriteLinks("[[Old]]", "Projects/Plan.md", "Old.md", "Folder/New name.md", before, after, { format: "absolute", wikilinks: true });
  expect(abs.text).toBe("[[Folder/New name]]");
});

test("a link's target is known to exist or not without a scan (links to missing notes are drawn faded)", () => {
  const files = [...notes.map((n) => ({ path: n.path, is_dir: false })), { path: "pic.png", is_dir: false }, { path: "Projects", is_dir: true }];
  const exists = linkTargets(files, notes);
  const found = ["Ideas", "ideas", "Ideas.md", "Plan#Goals", "#Heading in this note", "Projects/Plan", "projects/plan.md", "Sub/Deep note", "../Archive/Plan", "pic.png", "Deep%20note.md"];
  expect(found.filter((t) => !exists(t, "Projects/Other.md"))).toEqual([]);
  expect(["Missing", "Projects", "Nowhere/Plan", "pic"].filter((t) => exists(t, "Projects/Other.md"))).toEqual([]);
});

test("escaped Markdown destinations resolve and retain their escaping on rename", () => {
  const old = { name: "a(b)", path: "Projects/a(b).md" };
  const next = { name: "c(d) 100%", path: "Projects/c(d) 100%.md" };
  expect(resolveLink("Projects/a\\(b\\).md#Top", "Linker.md", [old])).toBe(old.path);
  const exists = linkTargets([{ path: old.path, is_dir: false }], [old]);
  expect(exists("Projects/a\\(b\\).md", "Linker.md")).toBe(true);
  const r = rewriteLinks(
    "[x](Projects/a\\(b\\).md#Top) ![alt](Projects/a\\(b\\).md) [pct](Projects/a%28b%29.md) `[](Projects/a\\(b\\).md)`",
    "Linker.md", old.path, next.path, [old], [next], { format: "shortest", wikilinks: false },
  );
  expect(r.count).toBe(3);
  expect(r.text).toBe("[x](c\\(d\\)%20100%25.md#Top) ![alt](c\\(d\\)%20100%25.md) [pct](c%28d%29%20100%25.md) `[](Projects/a\\(b\\).md)`");
});

test("renaming leaves double-backtick spans and short or deeply indented fences byte for byte", () => {
  const before = [...notes, { name: "Old", path: "Old.md" }];
  const after = [...notes, { name: "New name", path: "Folder/New name.md" }];
  const style = { format: "shortest" as const, wikilinks: true };
  const rewrite = (text: string) => rewriteLinks(text, "Ideas.md", "Old.md", "Folder/New name.md", before, after, style);

  const spans = [
    "[[Old]] `` a`[[Old]]b `` ``[[Old]]`` ``x`` `` a`b `` [[Old]]",
    "``[[Old]] ` [[Old]]``",
    "`` [old](Old.md) ` still `` [old](Old.md)",
    "`unclosed [[Old]]",
    "```[[Old]]```",
  ].join("\n");
  const spanned = rewrite(spans);
  expect(spanned.count).toBe(4);
  expect(spanned.text).toBe([
    "[[New name]] `` a`[[Old]]b `` ``[[Old]]`` ``x`` `` a`b `` [[New name]]",
    "``[[Old]] ` [[Old]]``",
    "`` [old](Old.md) ` still `` [old](New%20name.md)",
    "`unclosed [[New name]]",
    "```[[Old]]```",
  ].join("\n"));
  expect(rewrite(spanned.text)).toEqual({ text: spanned.text, count: 0 });

  const crlf = "`` a`b ``\r\n``x``\r\n``[[Old]]``\r\n[[Old]]\r\n";
  const cr = rewrite(crlf);
  expect(cr).toEqual({ text: "`` a`b ``\r\n``x``\r\n``[[Old]]``\r\n[[New name]]\r\n", count: 1 });

  // A shorter line does not close a longer fence. Four spaces, a tab, or trailing
  // text does not close one either. A backtick in the info string is not a fence.
  const fences = [
    "[[Old]]",
    "````",
    "```",
    "[[Old]]",
    "````",
    "```",
    "[[Old]]",
    "    ```",
    "``` trailing",
    "[[Old]]",
    "```",
    "    ```",
    "[[Old]]",
    "\t```",
    "[[Old]]",
    "```info`backtick",
    "[[Old]]",
    "~~~",
    "```",
    "[[Old]]",
    "~~~",
    "[[Old]]",
  ].join("\n");
  const fenced = rewrite(fences);
  expect(fenced.count).toBe(5);
  expect(fenced.text).toBe([
    "[[New name]]",
    "````",
    "```",
    "[[Old]]",
    "````",
    "```",
    "[[Old]]",
    "    ```",
    "``` trailing",
    "[[Old]]",
    "```",
    "    ```",
    "[[New name]]",
    "\t```",
    "[[New name]]",
    "```info`backtick",
    "[[New name]]",
    "~~~",
    "```",
    "[[Old]]",
    "~~~",
    "[[New name]]",
  ].join("\n"));
  expect(rewrite(fenced.text)).toEqual({ text: fenced.text, count: 0 });

  // The indented fence line stays, and it does not protect the link under it.
  // An indented code block is not a fence; links there are still rewritten.
  expect(rewrite("```\n    [[Old]]\n    ```\n[[Old]]\n```\n")).toEqual({
    text: "```\n    [[Old]]\n    ```\n[[Old]]\n```\n",
    count: 0,
  });
  expect(rewrite("    [[Old]]\n    ```\n[[Old]]")).toEqual({
    text: "    [[New name]]\n    ```\n[[New name]]",
    count: 2,
  });
  expect(rewrite("`` a`b ``\n``x``\n````\n```\n[[Keep]]\n````\n    ```\n").count).toBe(0);
  expect(rewrite("`` a`b ``\n``x``\n````\n```\n[[Keep]]\n````\n    ```\n").text).toBe("`` a`b ``\n``x``\n````\n```\n[[Keep]]\n````\n    ```\n");

  // Three spaces still open and close. Trailing spaces on a closer still close.
  expect(rewrite("   ```\n[[Old]]\n   ```\n[[Old]]\n```   \n[[Old]]\n```\n")).toEqual({
    text: "   ```\n[[Old]]\n   ```\n[[New name]]\n```   \n[[Old]]\n```\n",
    count: 1,
  });
});

test("renaming keeps a CRLF fence closed and preserves the carriage return", () => {
  const before = [...notes, { name: "Old", path: "Old.md" }];
  const after = [...notes, { name: "New name", path: "Folder/New name.md" }];
  const rewrite = (text: string) => rewriteLinks(text, "Ideas.md", "Old.md", "Folder/New name.md", before, after, { format: "shortest", wikilinks: true });
  const text = [
    "```js",
    "[[Old]]",
    "```",
    "[[Old]]",
    "````",
    "```",
    "[[Old]]",
    "````",
    "    ```",
    "[[Old]]",
    "\t```",
    "[[Old]]",
    "```a`b",
    "[[Old]]",
    "~~~",
    "[[Old]]",
    "```",
    "~~~",
    "[[Old]]",
  ].join("\r\n") + "\r\n";
  const once = rewrite(text);
  expect(once.count).toBe(5);
  expect(once.text).toBe([
    "```js",
    "[[Old]]",
    "```",
    "[[New name]]",
    "````",
    "```",
    "[[Old]]",
    "````",
    "    ```",
    "[[New name]]",
    "\t```",
    "[[New name]]",
    "```a`b",
    "[[New name]]",
    "~~~",
    "[[Old]]",
    "```",
    "~~~",
    "[[New name]]",
  ].join("\r\n") + "\r\n");
  expect(rewrite(once.text)).toEqual({ text: once.text, count: 0 });
  expect(rewrite("```\r\n[[Old]]")).toEqual({ text: "```\r\n[[Old]]", count: 0 });
});
