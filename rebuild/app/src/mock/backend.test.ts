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
