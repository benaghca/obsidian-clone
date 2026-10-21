import { expect, test } from "vitest";
import { formatLink, linkTargets, relativePath, resolveLink, rewriteLinks } from "./internal";

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
