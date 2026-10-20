import { describe, expect, it } from "vitest";
import { Layout, type LayoutNode } from "./layout";

/** "V(a,b | H(c | d))": V/H splits, groups as their tab names, * on the active tab. */
function show(node: LayoutNode<string>): string {
  if (node.kind === "group") return node.tabs.map((t) => (t === node.active && node.tabs.length > 1 ? `${t}*` : t)).join(",");
  return `${node.direction === "vertical" ? "V" : "H"}(${node.children.map(show).join(" | ")})`;
}
const sizes = (l: Layout<string>) => (l.root.kind === "split" ? l.root.sizes.map((s) => +s.toFixed(3)) : [1]);

describe("Layout", () => {
  it("splits right and down, nesting, with the new group active", () => {
    const l = new Layout("a");
    const b = l.split(l.activeGroup, "right", ["b"]);
    expect(show(l.root)).toBe("V(a | b)");
    expect(sizes(l)).toEqual([0.5, 0.5]);
    const c = l.split(b, "bottom", ["c"]);
    expect(show(l.root)).toBe("V(a | H(b | c))");
    expect(c.parent!.parent).toBe(l.root);
    // Splitting right inside the column goes beside it in the root row only if
    // the column itself is split; here it nests a new row inside the column.
    l.split(c, "right", ["d"]);
    expect(show(l.root)).toBe("V(a | H(b | V(c | d)))");
  });

  it("shares space equally until resized, then halves the pane it splits", () => {
    const l = new Layout("a");
    const a = l.activeGroup;
    l.split(a, "right", ["b"]);
    l.split(a, "right", ["c"]);
    expect(show(l.root)).toBe("V(a | c | b)");
    expect(sizes(l)).toEqual([0.333, 0.333, 0.333]);
    const root = l.root as any;
    l.resize(root, 0, -100, 900, 100); // a: 300 -> 200
    expect(sizes(l)).toEqual([0.222, 0.444, 0.333]);
    l.split(a, "right", ["d"]);
    expect(show(l.root)).toBe("V(a | d | c | b)");
    expect(sizes(l)).toEqual([0.111, 0.111, 0.444, 0.333]);
  });

  it("collapses a group: its space goes to the sibling before it, and one-child splits flatten", () => {
    const l = new Layout("a");
    const a = l.activeGroup;
    const b = l.split(a, "right", ["b"]);
    const c = l.split(b, "bottom", ["c"]);
    expect(l.removeGroup(c)).toBe(b);
    expect(show(l.root)).toBe("V(a | b)");
    expect(b.parent).toBe(l.root);
    l.resize(l.root as any, 0, 100, 1000, 100); // a 600, b 400
    const d = l.split(b, "right", ["d"]); // b 200, d 200
    expect(sizes(l)).toEqual([0.6, 0.2, 0.2]);
    l.removeGroup(b); // first sibling before b is a
    expect(sizes(l)).toEqual([0.8, 0.2]);
    l.removeGroup(a); // first: space goes to the one after
    expect(show(l.root)).toBe("d");
    expect(d.parent).toBeNull();
    expect(l.removeGroup(d)).toBeNull(); // never removes the last group
  });

  it("merges a split into its parent when flattening leaves the same direction", () => {
    const l = new Layout("a");
    const a = l.activeGroup;
    const b = l.split(a, "right", ["b"]);
    const c = l.split(b, "bottom", ["c"]);
    l.split(c, "right", ["d"]); // V(a | H(b | V(c | d)))
    l.removeGroup(b); // H(V(c|d)) flattens into the root row
    expect(show(l.root)).toBe("V(a | c | d)");
    expect(sizes(l).reduce((x, y) => x + y)).toBeCloseTo(1);
  });

  it("returns the nearest group to activate after a collapse", () => {
    const l = new Layout("a");
    const a = l.activeGroup;
    const b = l.split(a, "right", ["b"]);
    const c = l.split(b, "bottom", ["c"]);
    l.activeGroup = a;
    // Removing a: the space goes to the column after it; its first group is nearest.
    expect(l.removeGroup(a)).toBe(b);
    expect(l.activeGroup).toBe(b);
    expect(show(l.root)).toBe("H(b | c)");
    void c;
  });

  it("moves tabs within a group, into another group, and onto an edge", () => {
    const l = new Layout("a");
    const g = l.activeGroup;
    l.addTab(g, "b");
    l.addTab(g, "c", 2);
    expect(show(l.root)).toBe("a*,b,c");
    expect(l.moveTab("a", g, 3)).toBe(true); // to the end
    expect(g.tabs).toEqual(["b", "c", "a"]);
    expect(l.moveTab("a", g, 3)).toBe(false); // already there
    const h = l.split(g, "right", ["x"]);
    l.moveTab("c", h, 0);
    expect(show(l.root)).toBe("V(b,a* | c*,x)");
    expect(l.activeGroup).toBe(h);
    // Moving a group's last tab away collapses it.
    l.moveTab("x", g, 0);
    l.moveTab("c", g, 0);
    expect(show(l.root)).toBe("c*,x,b,a");
    // Onto an edge: a new group there, with the tab active in it.
    const n = l.moveTabToEdge("b", l.activeGroup, "bottom")!;
    expect(show(l.root)).toBe("H(c*,x,a | b)");
    expect(l.activeGroup).toBe(n);
    // A group's only tab onto its own edge does nothing.
    expect(l.moveTabToEdge("b", n, "left")).toBeNull();
    // A group's only tab onto another group's edge moves the group.
    l.moveTabToEdge("b", l.groups()[0], "left");
    expect(show(l.root)).toBe("V(b | c*,x,a)");
  });

  it("passes the active tab to the right neighbour, else the left", () => {
    const l = new Layout("a");
    const g = l.activeGroup;
    l.addTab(g, "b");
    l.addTab(g, "c");
    g.active = "b";
    l.removeTab("b");
    expect(g.active).toBe("c");
    l.removeTab("c");
    expect(g.active).toBe("a");
    expect(l.removeTab("a")).toEqual({ group: g, empty: true });
  });

  it("resizes within the minimum of each side, counting nested panes", () => {
    const l = new Layout("a");
    const a = l.activeGroup;
    const b = l.split(a, "right", ["b"]);
    l.split(b, "right", ["c"]); // V(a | b | c), 300px each of 900
    const root = l.root as any;
    l.resize(root, 0, -1000, 900, 100);
    expect(sizes(l).map((s) => Math.round(s * 900))).toEqual([100, 500, 300]);
    l.resize(root, 0, 1000, 900, 100);
    expect(sizes(l).map((s) => Math.round(s * 900))).toEqual([500, 100, 300]);
    // A nested row needs room for both of its panes.
    const l2 = new Layout("a");
    const b2 = l2.split(l2.activeGroup, "bottom", ["b"]);
    l2.split(b2, "right", ["c"]); // H(a | V(b | c))
    expect(l2.minSize(l2.root, "vertical", 150)).toBe(300);
    expect(l2.minSize(l2.root, "horizontal", 150)).toBe(300);
  });

  it("finds neighbours by position", () => {
    const l = new Layout("a");
    const a = l.activeGroup;
    const b = l.split(a, "right", ["b"]);
    const c = l.split(b, "bottom", ["c"]);
    expect(l.neighbour(a, "right")).toBe(b); // b overlaps a's upper half, c the lower: tie broken by... both overlap 0.5
    expect(l.neighbour(c, "left")).toBe(a);
    expect(l.neighbour(b, "bottom")).toBe(c);
    expect(l.neighbour(c, "top")).toBe(b);
    expect(l.neighbour(a, "left")).toBeNull();
    expect(l.neighbour(b, "right")).toBeNull();
  });

  it("saves and restores, dropping tabs that are gone and tidying the tree", () => {
    const l = new Layout("a");
    const a = l.activeGroup;
    l.addTab(a, "gone");
    a.active = "gone";
    const b = l.split(a, "right", ["b"]);
    const c = l.split(b, "bottom", ["gone2"]);
    l.addTab(c, "gone3");
    l.resize(l.root as any, 0, 100, 1000, 100);
    l.activeGroup = b;
    const json = JSON.parse(JSON.stringify(l.toJSON((t) => ({ name: t }))));
    const back = Layout.fromJSON<string, { name: string }>(json, (s) => (s.name.startsWith("gone") ? null : s.name), 1)!;
    expect(show(back.root)).toBe("V(a | b)");
    expect(sizes(back)).toEqual([0.6, 0.4]);
    expect(back.groups()[0].active).toBe("a"); // its saved active tab was dropped
    expect(back.activeGroup.tabs).toEqual(["b"]);
    expect(Layout.fromJSON(json, () => null)).toBeNull();
    expect(Layout.fromJSON({ nonsense: true }, (s) => s)).toBeNull();
    expect(Layout.fromJSON(null, (s) => s)).toBeNull();
  });

  it("gives every group a unique id, also after a restore", () => {
    const l = new Layout("a");
    l.split(l.activeGroup, "right", ["b"]);
    const back = Layout.fromJSON(l.toJSON((t) => t), (s: string) => s)!;
    const g = back.split(back.groups()[0], "bottom", ["c"]);
    const ids = back.groups().map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(g.id);
  });
});
