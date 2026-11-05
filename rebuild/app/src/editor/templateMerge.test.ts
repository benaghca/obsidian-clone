import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import { mergeTemplate, newNoteTemplate } from "./templateMerge";

/**
 * Merge, and check the changes give the same text as one CodeMirror
 * transaction. (The editor's documents are LF: CodeMirror counts a line
 * break as one unit, so CRLF text is checked as a string only.)
 */
function merge(note: string, template: string, at?: number | { from: number; to: number }) {
  const selection = typeof at === "number" ? { from: at, to: at } : at;
  const r = mergeTemplate(note, template, selection);
  if (!note.includes("\r")) expect(EditorState.create({ doc: note }).update({ changes: r.changes }).state.doc.toString()).toBe(r.text);
  let text = note;
  for (const c of [...r.changes].reverse()) text = text.slice(0, c.from) + c.insert + text.slice(c.to);
  expect(text).toBe(r.text);
  expect(r.cursor).toBeGreaterThanOrEqual(0);
  expect(r.cursor).toBeLessThanOrEqual(r.text.length);
  return r;
}

const TEMPLATE = "---\ntags:\n  - meeting\nstatus: draft\n---\n## Agenda\n";

test("a note with no frontmatter gets the template's block on top and the body at the cursor", () => {
  const note = "First line\nSecond line\n";
  const r = merge(note, TEMPLATE, note.indexOf("\nSecond"));
  expect(r.text).toBe("---\ntags:\n  - meeting\nstatus: draft\n---\nFirst line## Agenda\n\nSecond line\n");
  expect(r.text.slice(0, r.cursor).endsWith("## Agenda\n")).toBe(true);
  expect(r.skipped).toBe(false);
});

test("an empty note at the start: block first, then the body", () => {
  const r = merge("", TEMPLATE, 0);
  expect(r.text).toBe("---\ntags:\n  - meeting\nstatus: draft\n---\n## Agenda\n");
  expect(r.cursor).toBe(r.text.length);
});

test("both sides with frontmatter: the note's keys win, new keys are added at the end", () => {
  const note = "---\nstatus: done\ntitle: Kept\n---\nBody\n";
  const r = merge(note, "---\nstatus: draft\ncreated: 2026-11-04\ntitle: Template\n---\nInserted", note.length);
  expect(r.text).toBe("---\nstatus: done\ntitle: Kept\ncreated: 2026-11-04\n---\nBody\nInserted");
  expect(r.cursor).toBe(r.text.length);
  // One change inside the frontmatter, one for the body.
  expect(r.changes).toHaveLength(2);
  expect(r.changes[0]).toEqual({ from: note.indexOf("---\nBody"), to: note.indexOf("---\nBody"), insert: "created: 2026-11-04\n" });
});

test("keys match in any case, and a template key the note has is never added twice", () => {
  const note = "---\nStatus: done\n---\n";
  const r = merge(note, "---\nstatus: draft\n---\n", note.length);
  expect(r.text).toBe(note);
  expect(r.changes).toEqual([]);
});

test("list values are unioned: the note's items first, then the template's new ones", () => {
  const note = "---\ntags:\n  - project\n  - meeting\naliases: [Old]\nrelated:\n- \"[[A]]\"\n---\nBody\n";
  const template = "---\ntags: [meeting, '#Review', review]\naliases:\n  - New\n  - Old\nrelated:\n  - \"[[B]]\"\n---\n";
  const r = merge(note, template, note.length);
  expect(r.text).toBe(
    "---\ntags:\n  - project\n  - meeting\n  - \"#Review\"\naliases: [Old, New]\nrelated:\n- \"[[A]]\"\n- \"[[B]]\"\n---\nBody\n",
  );
  // Nothing new: the note is left as it is.
  expect(merge(r.text, template, r.text.length).changes).toEqual([]);
});

test("tags match without # and in any case; a plain tags value becomes a list", () => {
  const r = merge("---\ntags: Work\n---\n", "---\ntags: [\"#work\", home]\n---\n", 0);
  expect(r.text).toBe("---\ntags:\n  - Work\n  - home\n---\n");
});

test("a list and a non-list under one name: the note's value wins", () => {
  const note = "---\nstatus: open\nlinks: [a]\n---\n";
  const r = merge(note, "---\nstatus: [x, y]\nlinks: b\n---\n", note.length);
  expect(r.text).toBe(note);
});

test("an empty note list takes the template's items", () => {
  const r = merge("---\ntags: []\n---\n", "---\ntags:\n  - a\n---\n", 0);
  expect(r.text).toBe("---\ntags: [a]\n---\n");
});

test("CRLF notes keep CRLF everywhere, whatever the template's line endings", () => {
  const note = "---\r\ntags:\r\n  - a\r\n---\r\nBody\r\n";
  const r = merge(note, "---\ntags:\n  - b\nstatus: new\n---\nLine 1\nLine 2\n", note.length);
  expect(r.text).toBe("---\r\ntags:\r\n  - a\r\n  - b\r\nstatus: new\r\n---\r\nBody\r\nLine 1\r\nLine 2\r\n");
  const plain = "Just text\r\nmore\r\n";
  const top = merge(plain, "---\r\nkind: x\r\n---\r\nT\r\n", plain.length);
  expect(top.text).toBe("---\r\nkind: x\r\n---\r\nJust text\r\nmore\r\nT\r\n");
  // A CRLF template into an LF note is written with LF.
  expect(merge("---\na: 1\n---\n", "---\r\nb: 2\r\n---\r\nX\r\n", 12).text).toBe("---\na: 1\nb: 2\n---\nX\n");
});

test("BOM: the note's BOM stays first, the template's is dropped", () => {
  const note = "﻿---\ntags: [a]\n---\nBody\n";
  const r = merge(note, "﻿---\ntags: [b]\n---\nT", note.length);
  expect(r.text).toBe("﻿---\ntags: [a, b]\n---\nBody\nT");
  const bare = "﻿Hello\n";
  // A caret before the BOM still puts everything after it.
  const top = merge(bare, "﻿---\nk: v\n---\nT\n", 0);
  expect(top.text).toBe("﻿---\nk: v\n---\nT\nHello\n");
  expect(top.text.indexOf("﻿", 1)).toBe(-1);
});

test("an empty template changes nothing, and leaves a selection alone", () => {
  const note = "---\na: 1\n---\nBody\n";
  for (const template of ["", "﻿", "---\n---\n", "---\n\n---\n"]) {
    const r = merge(note, template, { from: 14, to: 18 });
    expect(r.text).toBe(note);
    expect(r.changes).toEqual([]);
    expect(r.bodyInserted).toBe(false);
  }
  expect(merge("No frontmatter", "---\n---\n", 0).text).toBe("No frontmatter");
});

test("a template without frontmatter is inserted as it is, replacing the selection", () => {
  const note = "Hello world";
  const r = merge(note, "there\nfriend", { from: 6, to: 11 });
  expect(r.text).toBe("Hello there\nfriend");
  expect(r.cursor).toBe(r.text.length);
  // An unclosed `---` is not frontmatter: all of it is body.
  expect(merge("", "---\nnot: closed\n", 0).text).toBe("---\nnot: closed\n");
});

test("a cursor inside the note's frontmatter puts the body after it", () => {
  const note = "---\na: 1\n---\nBody";
  const r = merge(note, "---\nb: 2\n---\nT\n", 5);
  expect(r.text).toBe("---\na: 1\nb: 2\n---\nT\nBody");
  expect(r.text.slice(0, r.cursor)).toBe("---\na: 1\nb: 2\n---\nT\n");
  // A note that ends on its closing fence gets a line break before the body.
  expect(merge("---\na: 1\n---", "T", 13).text).toBe("---\na: 1\n---\nT");
});

test("template properties of unknown type are copied as written; the note's are kept", () => {
  const note = "---\nnested:\n  x: 1\n---\n";
  const r = merge(note, "---\nnested:\n  y: 2\nblock: |\n  line one\n  line two\n---\n", note.length);
  expect(r.text).toBe("---\nnested:\n  x: 1\nblock: |\n  line one\n  line two\n---\n");
});

test("template comments and blank lines come along only into a new block", () => {
  const template = "---\n# kind of note\nkind: x\n\n---\nT";
  expect(merge("", template, 0).text).toBe("---\n# kind of note\nkind: x\n\n---\nT");
  expect(merge("---\na: 1\n---\n", template, 12).text).toBe("---\na: 1\nkind: x\n---\nT");
});

test("a note frontmatter Grove can't edit safely is left alone: only the body goes in", () => {
  for (const note of ["---\na: 1\nA: 2\n---\nBody\n", "---\nnot closed\nBody\n"]) {
    const r = merge(note, TEMPLATE, note.length);
    expect(r.skipped).toBe(true);
    expect(r.text).toBe(note + "## Agenda\n");
  }
  // A template block Grove can't read goes on top of a note without one, as written.
  const odd = "---\nk: 1\nK: 2\n---\nT";
  expect(merge("Body", odd, 4)).toMatchObject({ text: "---\nk: 1\nK: 2\n---\nBodyT", skipped: false });
  expect(merge("---\na: 1\n---\n", odd, 12)).toMatchObject({ text: "---\na: 1\n---\nT", skipped: true });
});

test("variables already filled in: the merged values are the filled ones", () => {
  const r = merge("---\ntags: [daily]\n---\n", "---\ncreated: 2026-11-04\ntags: [log]\n---\n# 2026-11-04\n", 21);
  expect(r.text).toBe("---\ntags: [daily, log]\ncreated: 2026-11-04\n---\n# 2026-11-04\n");
});

test("emoji next to a change never split a surrogate pair", () => {
  const note = "---\ntags: [🌲]\n---\n";
  const r = merge(note, "---\ntags: [🌳]\n---\n", note.length);
  expect(r.text).toBe("---\ntags: [🌲, 🌳]\n---\n");
  for (const c of r.changes) {
    expect(/^[\uDC00-\uDFFF]/.test(c.insert) || /[\uD800-\uDBFF]$/.test(c.insert)).toBe(false);
  }
});

test("frontmatter beyond the line limit is left alone with a notice", () => {
  const note = "---\n" + "# comment\n".repeat(2001) + "---\nBody\n";
  expect(merge(note, TEMPLATE)).toMatchObject({ skipped: true, text: note + "## Agenda\n" });
  // A readable block must also stay untouched if adding keys exceeds the limit.
  const full = "---\n" + "# comment\n".repeat(1998) + "a: 1\n---\nBody\n";
  expect(merge(full, "---\nb: 2\nc: 3\n---\nT")).toMatchObject({ skipped: true, text: full + "T" });
});

test("a refused list union reports skipped and leaves all note properties untouched", () => {
  // editProperty's existing 16 MB limit must not silently turn a union into success.
  const note = "---\ntags: [a]\n---\n" + "x".repeat(16 * 1024 * 1024);
  const r = mergeTemplate(note, "---\ntags: [b]\nnew: 1\n---\nT");
  expect(r.skipped).toBe(true);
  expect(r.text).toBe(note + "T");
});

const created = new Date(2026, 9, 3, 14, 5, 9); // Saturday 3 October 2026, 14:05:09

test("a new note is the template with title, date and time filled in", () => {
  const r = newNoteTemplate("---\ntopic: {{title}}\ncreated: {{date}}\n---\n# {{title}}\n{{time}} {{date:YYYY}}\n", "Untitled", created, "YYYY-MM-DD", "HH:mm");
  expect(r.text).toBe("---\ntopic: Untitled\ncreated: 2026-10-03\n---\n# Untitled\n14:05 2026\n");
  expect(r.cursor).toBe(r.text.length);
  expect(r.bodyInserted).toBe(true);
  expect(r.skipped).toBe(false);
  expect(r.text.split("\n").filter((l) => l === "---")).toHaveLength(2);
});

test("a new note leaves Templater syntax as written and drops a template BOM", () => {
  expect(newNoteTemplate("\uFEFF<% tp.date.now() %> {{title}} {{other}}", "Note", created, "YYYY-MM-DD", "HH:mm").text).toBe("<% tp.date.now() %> Note {{other}}");
});

test("a new note keeps the template's list style and turns CRLF into the empty note's LF", () => {
  const r = newNoteTemplate("---\r\ntags:\r\n  - meeting\r\n---\r\nHi {{title}}\r\n", "N", created, "YYYY-MM-DD", "HH:mm");
  expect(r.text).toBe("---\ntags:\n  - meeting\n---\nHi N\n");
  expect(r.text.includes("\r")).toBe(false);
});

test("an empty or properties-only template creates that note and nothing more", () => {
  expect(newNoteTemplate("", "N", created, "YYYY-MM-DD", "HH:mm")).toMatchObject({ text: "", changes: [], skipped: false, bodyInserted: false });
  expect(newNoteTemplate("---\n---\n", "N", created, "YYYY-MM-DD", "HH:mm")).toMatchObject({ text: "", changes: [] });
  const props = newNoteTemplate("---\nkind: meeting\n---\n", "N", created, "YYYY-MM-DD", "HH:mm");
  expect(props.text).toBe("---\nkind: meeting\n---\n");
  expect(props.bodyInserted).toBe(false);
});

test("a long note is merged without reading its body line by line", () => {
  const body = "line of body text\n".repeat(200_000);
  const note = `---\ntags: [a]\n---\n${body}`;
  const t0 = performance.now();
  const r = mergeTemplate(note, "---\ntags: [b]\nnew: 1\n---\nEnd\n", { from: note.length, to: note.length });
  const ms = performance.now() - t0;
  expect(r.text.startsWith("---\ntags: [a, b]\nnew: 1\n---\n")).toBe(true);
  expect(r.text.endsWith("End\n")).toBe(true);
  expect(ms).toBeLessThan(250);
});
