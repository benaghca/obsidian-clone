import { expect, test, vi } from "vitest";
import type { Backlink, LinkIndex } from "../api";
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
