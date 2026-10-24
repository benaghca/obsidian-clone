import { EditorSelection } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { loadTab, saveTab } from "./savedLayout";
import { behindLink, linkedWith, linkTabs, parseViewEntry, pushBack, stepHistory, type Tab, tabFollowsMove, tabForgets, tabTitle, unlinkTab, viewEntry, whereFromEvent } from "./tabs";

const blank = (): Tab => ({ id: 1, path: null, back: [], forward: [], mode: "live", pinned: false, backlinks: false, memory: null });
const notes = new Set(["A.md", "Folder/B.md"]);
const isNote = (p: unknown): p is string => typeof p === "string" && notes.has(p);

describe("tabs", () => {
  it("history entries for views round-trip, and titles name what a tab shows", () => {
    expect(parseViewEntry(viewEntry({ type: "graph" }))).toEqual({ type: "graph", file: null });
    expect(parseViewEntry(viewEntry({ type: "localgraph", viewFile: "Folder/B.md" }))).toEqual({ type: "localgraph", file: "Folder/B.md" });
    expect(parseViewEntry("Folder/B.md")).toBeNull();
    expect(tabTitle({ ...blank(), path: "Folder/B.md" })).toBe("B");
    expect(tabTitle({ ...blank(), type: "localgraph", viewFile: "A.md" })).toBe("Graph of A");
    expect(tabTitle(blank())).toBe("New tab");
    expect(parseViewEntry(viewEntry({ type: "image", viewFile: "pics/a.png" }))).toEqual({ type: "image", file: "pics/a.png" });
    expect(tabTitle({ ...blank(), type: "image", viewFile: "pics/a.png" })).toBe("a");
    expect(tabTitle({ ...blank(), type: "backlinks", viewFile: "Folder/B.md" })).toBe("Backlinks for B");
    expect(loadTab(saveTab({ ...blank(), type: "backlinks", viewFile: "A.md" }), blank, isNote)).toMatchObject({ type: "backlinks", path: null, viewFile: "A.md" });
    expect(loadTab(saveTab({ ...blank(), type: "backlinks", viewFile: "Gone.md" }), blank, isNote)).toMatchObject({ type: "backlinks", viewFile: null });
  });

  it("history keeps what a tab showed, and follows files that move or go", () => {
    const tab: Tab = { ...blank(), type: "localgraph", viewFile: "A.md", back: ["Folder/B.md"], forward: ["A.md"] };
    pushBack(tab);
    expect([tab.back, tab.forward]).toEqual([["Folder/B.md", "\0localgraph\0A.md"], []]);
    tabFollowsMove(tab, (p) => p.replace("Folder/", "Moved/").replace(/^A\.md$/, "C.md"));
    expect([tab.viewFile, tab.back]).toEqual(["C.md", ["Moved/B.md", "\0localgraph\0C.md"]]);
    // A view's history entry isn't a file path: only the view itself lets go of the file.
    tabForgets(tab, (p) => p === "C.md" || p.startsWith("Moved/"));
    expect([tab.viewFile, tab.back]).toEqual([null, ["\0localgraph\0C.md"]]);
    const empty = blank();
    pushBack(empty);
    expect(empty.back).toEqual([]);
  });

  it("Back returns the caret that was left, and a deleted file takes its caret with it", () => {
    const tab = { ...blank(), path: "A.md" };
    pushBack(tab, { anchor: 4, head: 7 });
    tab.path = "Folder/B.md";
    expect(stepHistory(tab, -1, { anchor: 1, head: 1 })).toEqual({ entry: "A.md", place: { anchor: 4, head: 7 } });
    expect(tab.forward).toEqual(["Folder/B.md"]);
    expect(stepHistory(tab, 1, { anchor: 8, head: 8 })?.place).toEqual({ anchor: 1, head: 1 });

    const gone = { ...blank(), path: "A.md" };
    pushBack(gone, { anchor: 2, head: 2 });
    gone.path = "Folder/B.md";
    pushBack(gone, { anchor: 4, head: 4 });
    gone.path = "A.md";
    pushBack(gone, { anchor: 6, head: 6 });
    tabForgets(gone, (p) => p === "A.md");
    expect(gone.back).toEqual(["Folder/B.md"]);
    expect(gone.path).toBeNull();
    expect(stepHistory(gone, -1)?.place).toEqual({ anchor: 4, head: 4 });
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
    expect(loadTab(saveTab({ ...blank(), type: "localgraph", viewFile: "Gone.md" }), blank, isNote)).toMatchObject({ type: "localgraph", viewFile: null });
    expect(loadTab(saveTab({ ...blank(), type: "canvas", viewFile: "Board.canvas" }), blank, isNote)).toMatchObject({ type: "canvas", path: null, viewFile: "Board.canvas" });
  });

  it("links tabs (Link with tab...): linked tabs follow the note one opens, views stay, a lone link goes", () => {
    const [a, b, c, d] = [1, 2, 3, 4].map((id) => ({ ...blank(), id, path: `${id}.md` }));
    const all = [a, b, c, d];
    linkTabs(a, b, all);
    linkTabs(c, b, all);
    expect(linkedWith(b, all)).toEqual([a, c]);
    a.path = "New.md";
    c.type = "graph";
    expect(behindLink(a, all)).toEqual([b]);
    expect(behindLink(d, all)).toEqual([]);
    unlinkTab(c, all);
    unlinkTab(a, all);
    expect(all.map((t) => t.link)).toEqual([undefined, undefined, undefined, undefined]);
  });
});
