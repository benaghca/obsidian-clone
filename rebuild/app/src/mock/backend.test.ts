import { expect, test, vi } from "vitest";
import type { Backlink, LinkIndex, NoteProperties } from "../api";
import { createMockBackend } from "./backend";

test("splits linked mentions from the link index and resolves targeted reads after a folder move", async () => {
  const store = () => ({ getItem: () => null, setItem: () => {} });
  vi.stubGlobal("location", { search: "" });
  vi.stubGlobal("sessionStorage", store());
  vi.stubGlobal("localStorage", store());
  try {
    const { invoke } = createMockBackend();
    for (const [path, content] of [
      ["S2/Target.md", "target"], ["S2/Source.md", "[[Target]] [[Target]] [label](Target.md)"], ["S2/Other.md", "[[Source]]"],
    ]) await invoke("create_note", { path, content });
    const index = await invoke<LinkIndex>("link_index");
    expect(index).not.toHaveProperty("backlinks");
    expect(index.outgoing["S2/Source.md"]).toEqual(["S2/Target.md"]);
    const paths = ["S2/Target.md", "S2/Target.md", "missing.md"];
    const before = await invoke<Record<string, Backlink[]>>("backlinks", { paths });
    expect(Object.keys(before)).toEqual(["S2/Target.md"]);
    expect(before["S2/Target.md"]).toHaveLength(3);
    expect(await invoke("backlinks", { paths: [] })).toEqual({});
    await invoke("rename_path", { from: "S2", to: "S2-moved" });
    const after = await invoke<Record<string, Backlink[]>>("backlinks", { paths: ["S2/Target.md", "S2-moved/Target.md"] });
    expect(Object.keys(after)).toEqual(["S2-moved/Target.md"]);
    expect(after["S2-moved/Target.md"].map(b => b.from)).toEqual(Array(3).fill("S2-moved/Source.md"));
    expect(before["S2/Target.md"][0].from).toBe("S2/Source.md");
  } finally { vi.unstubAllGlobals(); }
});


test("link_sources finds resolved links and each rename spelling, with no folder cap", async () => {
  const store = () => ({ getItem: () => null, setItem: () => {} });
  vi.stubGlobal("location", { search: "" });
  vi.stubGlobal("sessionStorage", store());
  vi.stubGlobal("localStorage", store());
  try {
    const { invoke } = createMockBackend();
    const notes: [string, string][] = [
      ["ZzTarget.md", "x"],
      ["ZzSource.md", "[[ZzTarget]]"],
      ["ZzCode.md", "```\n[[ZzTarget]]\n```"],
      ["Qx My Note.md", "the note"],
      ["ZzBare.md", "see [[Qx My Note]] later"],
      ["ZzEncoded.md", "token Qx%20My%20Note token"],
      ["ZzApart.md", "qx my favorite note"],
      ["QxA(b).md", "parens"],
      ["ZzPercent.md", "token QxA%28b%29 token"],
      ["ZzEscaped.md", "token QxA\\(b\\) token"],
      ["Qx File (1).md", "numbered"],
      ["ZzBareParen.md", "prefix Qx File (1) suffix"],
      ["ZzSpace.md", "prefix Qx%20File%20(1) suffix"],
      ["ZzFull.md", "prefix Qx%20File%20%281%29 suffix"],
      ["ZzSlash.md", "prefix Qx%20File%20\\(1\\) suffix"],
      ["pic.png", "not a note"],
      ["ZzEmbed.md", "![[pic.png]]"],
      ["Qxuniquefoo.MD", "x"],
      ["ZzOther.md", "see QXUNIQUEFOO in the text"],
    ];
    for (const [path, content] of notes) await invoke("create_note", { path, content });
    const sources = (paths: string[]) => invoke<string[]>("link_sources", { paths });
    expect(await sources([])).toEqual([]);
    expect(await sources(["ZzTarget.md", "ZzTarget.md"])).toEqual(["ZzCode.md", "ZzSource.md"]);
    expect(await sources(["Qx My Note.md"])).toEqual(["ZzBare.md", "ZzEncoded.md"]);
    expect(await sources(["QxA(b).md"])).toEqual(["ZzEscaped.md", "ZzPercent.md"]);
    expect(await sources(["Qx File (1).md"])).toEqual(["ZzBareParen.md", "ZzFull.md", "ZzSlash.md", "ZzSpace.md"]);
    expect(await sources(["pic.png"])).toEqual(["ZzEmbed.md"]);
    expect(await sources(["Qxuniquefoo.MD"])).toEqual(["ZzOther.md"]);
    for (let i = 0; i < 50; i++) {
      await invoke("create_note", { path: `Old/S5Cap${i}.md`, content: "body" });
      await invoke("create_note", { path: `S5Link${i}.md`, content: `[[Old/S5Cap${i}]]` });
    }
    const found = await sources(Array.from({ length: 50 }, (_, i) => `Old/S5Cap${i}.md`));
    expect(found).toEqual(Array.from({ length: 50 }, (_, i) => `S5Link${i}.md`).sort());
  } finally { vi.unstubAllGlobals(); }
});

test("properties use the TS reference with BOM, CRLF, uppercase notes and source-only omissions", async () => {
  const store = () => ({ getItem: () => null, setItem: () => {} });
  vi.stubGlobal("location", { search: "" }); vi.stubGlobal("sessionStorage", store()); vi.stubGlobal("localStorage", store());
  try {
    const { invoke } = createMockBackend();
    for (const [path, content] of [["Props.MD", "\ufeff---\r\n# comment\r\nstatus: fresh\r\nitems:\r\n  - one\r\n---"], ["Empty.md", "---\n---"], ["Source.md", "---\na: 1\nA: 2\n---"], ["Not.png", "---\na: 1\n---"]]) await invoke("create_note", { path, content });
    const paths = ["Props.MD", "Empty.md", "Source.md", "Not.png", "Missing.md"];
    const found = await invoke<Record<string, NoteProperties>>("properties", { paths });
    expect(Object.keys(found)).toEqual(["Props.MD", "Empty.md"]);
    expect(found["Props.MD"]).toEqual({ props: [{ key: "status", type: "text", value: "fresh", line: 1, count: 1 }, { key: "items", type: "list", value: ["one"], line: 2, count: 2 }], lines: ["# comment", "status: fresh", "items:", "  - one"] });
    expect(found["Empty.md"].props).toEqual([]);
    expect(await invoke("properties", { paths: [] })).toEqual({});
  } finally { vi.unstubAllGlobals(); }
});

test("search commands share the reference, cache only unchanged saved content, and page only matching notes", async () => {
  const store = () => ({ getItem: () => null, setItem: () => {} });
  vi.stubGlobal("location", { search: "" }); vi.stubGlobal("sessionStorage", store()); vi.stubGlobal("localStorage", store());
  try {
    const { invoke } = createMockBackend();
    await invoke("create_note", { path: "C1B/Upper.MD", content: "\ufeff---\r\nstatus: draft\r\n---\r\nc1bword c1bword\r\nlast\r" });
    await invoke("create_note", { path: "C1B/c1bword.png", content: "c1bword" });
    const query = "path:C1B c1bword";
    expect(await invoke("search_notes", { query, matchCase: false })).toEqual([{ path: "C1B/Upper.MD", count: 2 }]);
    const args = { query, matchCase: false, paths: ["C1B", "missing.md", "C1B/c1bword.png", "C1B/Upper.MD", "C1B/Upper.MD"], limit: 1 };
    expect(await invoke("search_lines", args)).toEqual({ "C1B/Upper.MD": [{ line: 4, text: "c1bword c1bword" }] });
    expect(await invoke("search_lines", { ...args, query: "path:C1B" })).toEqual({});
    expect(await invoke("search_lines", { ...args, limit: 0 })).toEqual({});
    expect(await invoke("search_lines", { ...args, query: "content:last" })).toEqual({ "C1B/Upper.MD": [{ line: 5, text: "last\r" }] });
    expect(await invoke("search_match", { queries: [query, "", "file:c1bword.png"] })).toEqual([["C1B/Upper.MD", "C1B/c1bword.png"], [], ["C1B/c1bword.png"]]);
    await invoke("write_note", { path: "C1B/Upper.MD", content: "c1bnew\n#c1btag\n" });
    expect(await invoke("search_notes", { query, matchCase: false })).toEqual([]);
    expect(await invoke("search_notes", { query: "tag:c1btag", matchCase: false })).toEqual([{ path: "C1B/Upper.MD", count: 1 }]);
    expect(await invoke("tags", { paths: ["C1B/Upper.MD"] })).toEqual({ "C1B/Upper.MD": ["c1btag"] });
    await invoke("rename_path", { from: "C1B/Upper.MD", to: "C1B/Renamed.md" });
    expect(await invoke("search_notes", { query: "content:c1bnew", matchCase: false })).toEqual([{ path: "C1B/Renamed.md", count: 1 }]);
    await invoke("delete_path", { path: "C1B" });
    expect(await invoke("search_match", { queries: ["path:C1B"] })).toEqual([[]]);
  } finally { vi.unstubAllGlobals(); }
});

test("merged search commands treat nameless .md files as attachments and keep named .MD notes", async () => {
  const store = () => ({ getItem: () => null, setItem: () => {} });
  vi.stubGlobal("location", { search: "" }); vi.stubGlobal("sessionStorage", store()); vi.stubGlobal("localStorage", store());
  try {
    const { invoke } = createMockBackend();
    const paths = ["C1B-INT/.md", "C1B-INT/.MD", "C1B-INT/Upper.MD"];
    for (const path of paths) await invoke("create_note", { path, content: "---\nstatus: c1bintprobe\n---\nc1bintprobe #c1binttag\n" });
    const notes = (query: string) => invoke("search_notes", { query, matchCase: false });
    expect(await notes("content:c1bintprobe")).toEqual([{ path: "C1B-INT/Upper.MD", count: 2 }]);
    expect(await notes("path:C1B-INT file:md")).toEqual([{ path: "C1B-INT/Upper.MD", count: 0 }]);
    expect(await invoke("search_lines", { query: "path:C1B-INT file:md", matchCase: false, paths, limit: 5 })).toEqual({});
    expect(await invoke("search_lines", { query: "content:c1bintprobe", matchCase: false, paths, limit: 5 })).toEqual({
      "C1B-INT/Upper.MD": [{ line: 2, text: "status: c1bintprobe" }, { line: 4, text: "c1bintprobe #c1binttag" }],
    });
    expect(await invoke("tags", { paths })).toEqual({ "C1B-INT/Upper.MD": ["c1binttag"] });
    expect(Object.keys(await invoke<Record<string, NoteProperties>>("properties", { paths }))).toEqual(["C1B-INT/Upper.MD"]);
    expect(await invoke("search_match", { queries: ["content:c1bintprobe", "path:C1B-INT file:md"] })).toEqual([
      ["C1B-INT/Upper.MD"], ["C1B-INT/.MD", "C1B-INT/.md", "C1B-INT/Upper.MD"],
    ]);
  } finally { vi.unstubAllGlobals(); }
});
