import { EditorSelection } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { loadTab, saveTab } from "./savedLayout";
import { parseViewEntry, type Tab, tabTitle, viewEntry, whereFromEvent } from "./tabs";

const blank = (): Tab => ({ id: 1, path: null, back: [], forward: [], mode: "live", pinned: false, backlinks: false, memory: null });
const notes = new Set(["A.md", "Folder/B.md"]);
const isNote = (p: unknown): p is string => typeof p === "string" && notes.has(p);

describe("tabs", () => {
  it("history entries for views round-trip, and titles name what a tab shows", () => {
    expect(parseViewEntry(viewEntry({ type: "graph" }))).toEqual({ type: "graph", file: null });
    expect(parseViewEntry(viewEntry({ type: "localgraph", graphFile: "Folder/B.md" }))).toEqual({ type: "localgraph", file: "Folder/B.md" });
    expect(parseViewEntry("Folder/B.md")).toBeNull();
    expect(tabTitle({ ...blank(), path: "Folder/B.md" })).toBe("B");
    expect(tabTitle({ ...blank(), type: "localgraph", graphFile: "A.md" })).toBe("Graph of A");
    expect(tabTitle(blank())).toBe("New tab");
  });

  it("modifier clicks open in a new tab or to the right", () => {
    expect(whereFromEvent({ ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
    expect(whereFromEvent({ ctrlKey: true, metaKey: false, altKey: false })).toBe("tab");
    expect(whereFromEvent({ ctrlKey: false, metaKey: true, altKey: true })).toBe("right");
  });

  it("a saved tab comes back with its place in the note, without notes that are gone", () => {
    const tab: Tab = {
      ...blank(),
      path: "A.md",
      mode: "source",
      pinned: true,
      back: ["Folder/B.md", "Gone.md", viewEntry({ type: "graph" })],
      memory: { path: "A.md", scrollTop: 120.4, selection: EditorSelection.single(3, 5) },
    };
    const saved = saveTab(tab);
    expect(saved).toEqual({ path: "A.md", mode: "source", pinned: true, back: tab.back, forward: [], scroll: 120, sel: [3, 5] });
    const back = loadTab(saved, blank, isNote)!;
    expect(back.back).toEqual(["Folder/B.md", "\0graph"]);
    expect(back.memory?.scrollTop).toBe(120);
    expect(back.memory?.selection?.main.head).toBe(5);
    expect(loadTab({ ...saved, path: "Gone.md" }, blank, isNote)).toBeNull();
    expect(loadTab(saveTab({ ...blank(), type: "localgraph", graphFile: "Gone.md" }), blank, isNote)).toMatchObject({ type: "localgraph", graphFile: null });
  });
});
