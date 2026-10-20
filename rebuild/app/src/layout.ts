// The workspace layout: a tree like Obsidian's. Leaves are tab groups (each
// with its own tabs and active tab), inner nodes are splits that lay their
// children side by side or one above the other, and splits nest. One group
// is the active pane. Sizes are fractions of the parent split, so a window
// resize scales every pane.
//
// This module knows nothing about the DOM or the editor; the tab type is a
// parameter. It is tested on its own (layout.test.ts).

/**
 * Obsidian's naming: a "vertical" split has a vertical divider, so its
 * children sit side by side (Split right); a "horizontal" split stacks them
 * (Split down).
 */
export type Direction = "vertical" | "horizontal";

/** Where a new group goes next to an existing one. */
export type Edge = "left" | "right" | "top" | "bottom";

export interface TabGroup<T> {
  readonly kind: "group";
  readonly id: number;
  tabs: T[];
  active: T;
  parent: Split<T> | null;
}

export interface Split<T> {
  readonly kind: "split";
  readonly id: number;
  direction: Direction;
  children: LayoutNode<T>[];
  /** Fractions of this split's length, one per child, summing to 1. */
  sizes: number[];
  /**
   * Whether the user has dragged a divider here. Until then the children
   * share the space equally, and a new pane makes them all narrower alike,
   * as in Obsidian; afterwards a new pane takes half of the pane it splits.
   */
  resized: boolean;
  parent: Split<T> | null;
}

export type LayoutNode<T> = TabGroup<T> | Split<T>;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EPS = 1e-6;

export const edgeDirection = (edge: Edge): Direction => (edge === "left" || edge === "right" ? "vertical" : "horizontal");
const edgeIsAfter = (edge: Edge) => edge === "right" || edge === "bottom";

/** The serialized form, as saved per vault. Tabs are whatever `saveTab` returns. */
export type LayoutJSON<S> =
  | { type: "group"; tabs: S[]; active: number }
  | { type: "split"; direction: Direction; sizes: number[]; resized?: boolean; children: LayoutJSON<S>[] };

export class Layout<T> {
  root!: LayoutNode<T>;
  activeGroup!: TabGroup<T>;
  private nextId = 1;

  /** One group holding `firstTab`; without it, an empty layout for fromJSON to fill. */
  constructor(firstTab?: T) {
    if (firstTab !== undefined) this.root = this.activeGroup = this.makeGroup([firstTab], firstTab);
  }

  private makeGroup(tabs: T[], active: T): TabGroup<T> {
    return { kind: "group", id: this.nextId++, tabs, active, parent: null };
  }

  private makeSplit(direction: Direction, children: LayoutNode<T>[], sizes: number[], resized = false): Split<T> {
    const split: Split<T> = { kind: "split", id: this.nextId++, direction, children, sizes, resized, parent: null };
    for (const c of children) c.parent = split;
    return split;
  }

  /** Every tab group, in reading order (depth first, left to right, top to bottom). */
  groups(): TabGroup<T>[] {
    const out: TabGroup<T>[] = [];
    const walk = (n: LayoutNode<T>) => (n.kind === "group" ? out.push(n) : n.children.forEach(walk));
    walk(this.root);
    return out;
  }

  groupOf(tab: T): TabGroup<T> | undefined {
    return this.groups().find((g) => g.tabs.includes(tab));
  }

  tabs(): T[] {
    return this.groups().flatMap((g) => g.tabs);
  }

  // ----- splitting -----

  /**
   * Put a new group holding `tabs` on one edge of `target`. Next to a
   * sibling in a split of the same direction it joins that split; otherwise
   * `target` is replaced by a new split of the two.
   */
  split(target: TabGroup<T>, edge: Edge, tabs: T[], active: T = tabs[0]): TabGroup<T> {
    const group = this.makeGroup(tabs, active);
    const direction = edgeDirection(edge);
    const after = edgeIsAfter(edge);
    const parent = target.parent;
    if (parent && parent.direction === direction) {
      const i = parent.children.indexOf(target);
      const at = after ? i + 1 : i;
      parent.children.splice(at, 0, group);
      group.parent = parent;
      if (parent.resized) {
        const half = parent.sizes[i] / 2;
        parent.sizes.splice(i, 1, half);
        parent.sizes.splice(at, 0, half);
      } else parent.sizes = equal(parent.children.length);
      return group;
    }
    const pair = after ? [target, group] : [group, target];
    this.replace(target, this.makeSplit(direction, pair, [0.5, 0.5]), parent);
    return group;
  }

  /** Put `node` where `old` is (same parent, same size). Pass `parent` if `old` was already re-parented. */
  private replace(old: LayoutNode<T>, node: LayoutNode<T>, parent = old.parent) {
    node.parent = parent;
    if (!parent) this.root = node;
    else parent.children[parent.children.indexOf(old)] = node;
  }

  // ----- removing -----

  /**
   * Take a group out of the layout. Its space goes to the sibling beside it
   * (the one before it, or after it when it was first), and a split left
   * with one child is replaced by that child. Returns the group nearest to
   * where it was, to activate instead; null if it was the only group (which
   * is left in place).
   */
  removeGroup(group: TabGroup<T>): TabGroup<T> | null {
    const parent = group.parent;
    if (!parent) return null;
    const i = parent.children.indexOf(group);
    const before = i > 0;
    const neighbour = parent.children[before ? i - 1 : i + 1];
    const freed = parent.sizes[i];
    parent.children.splice(i, 1);
    parent.sizes.splice(i, 1);
    if (parent.resized) parent.sizes[before ? i - 1 : i] += freed;
    else parent.sizes = equal(parent.children.length);
    group.parent = null;
    this.flatten(parent);
    // The group nearest to where it was, on the side that took the space.
    const next = nearestGroup(neighbour, before ? "end" : "start");
    if (this.activeGroup === group) this.activeGroup = next;
    return next;
  }

  /** A split with one child is replaced by that child; a child split in the same direction merges into its parent. */
  private flatten(split: Split<T>) {
    if (split.children.length === 1) {
      const only = split.children[0];
      this.replace(split, only);
      if (only.kind === "split" && only.parent) this.mergeInto(only.parent, only);
      return;
    }
    for (const child of [...split.children]) {
      if (child.kind === "split" && child.direction === split.direction) this.mergeInto(split, child);
    }
  }

  private mergeInto(parent: Split<T>, child: Split<T>) {
    if (child.direction !== parent.direction) return;
    const i = parent.children.indexOf(child);
    const share = parent.sizes[i];
    parent.children.splice(i, 1, ...child.children);
    parent.sizes.splice(i, 1, ...child.sizes.map((s) => s * share));
    for (const c of child.children) c.parent = parent;
    parent.resized ||= child.resized;
  }

  // ----- tabs -----

  /** Insert a tab into a group (at `index`, default after the active tab). */
  addTab(group: TabGroup<T>, tab: T, index = group.tabs.indexOf(group.active) + 1) {
    group.tabs.splice(Math.max(0, Math.min(index, group.tabs.length)), 0, tab);
  }

  /**
   * Take a tab out of its group. The active tab passes to the nearest tab
   * to its right, else its left. Returns the group, and whether it is now
   * empty (the caller decides whether to collapse it or refill it).
   */
  removeTab(tab: T): { group: TabGroup<T>; empty: boolean } | null {
    const group = this.groupOf(tab);
    if (!group) return null;
    const i = group.tabs.indexOf(tab);
    group.tabs.splice(i, 1);
    if (group.active === tab && group.tabs.length) group.active = group.tabs[Math.min(i, group.tabs.length - 1)];
    return { group, empty: group.tabs.length === 0 };
  }

  /**
   * Move a tab into another group at `index` (or within its own group, to
   * reorder). A group left empty is removed. Returns false when nothing
   * changed.
   */
  moveTab(tab: T, to: TabGroup<T>, index: number): boolean {
    const from = this.groupOf(tab);
    if (!from) return false;
    if (from === to) {
      const i = from.tabs.indexOf(tab);
      const at = Math.max(0, Math.min(index > i ? index - 1 : index, from.tabs.length - 1));
      if (at === i) return false;
      from.tabs.splice(i, 1);
      from.tabs.splice(at, 0, tab);
      return true;
    }
    const removed = this.removeTab(tab)!;
    this.addTab(to, tab, index);
    to.active = tab;
    if (removed.empty) this.removeGroup(from);
    this.activeGroup = to;
    return true;
  }

  /**
   * Move a tab into a new group on one edge of `target`. Dragging a group's
   * only tab onto its own edge would leave the layout as it was, so that
   * does nothing (returns null).
   */
  moveTabToEdge(tab: T, target: TabGroup<T>, edge: Edge): TabGroup<T> | null {
    const from = this.groupOf(tab);
    if (!from || (from === target && from.tabs.length === 1)) return null;
    // Split first, so a source group that collapses can't take the target with it.
    const group = this.split(target, edge, [], tab);
    const removed = this.removeTab(tab)!;
    group.tabs.push(tab);
    group.active = tab;
    if (removed.empty) this.removeGroup(removed.group);
    this.activeGroup = group;
    return group;
  }

  // ----- sizes -----

  /**
   * The smallest a node can be along an axis, in px, when no pane may be
   * smaller than `minPane`: panes side by side add up, panes across take
   * the largest.
   */
  minSize(node: LayoutNode<T>, direction: Direction, minPane: number): number {
    if (node.kind === "group") return minPane;
    const mins = node.children.map((c) => this.minSize(c, direction, minPane));
    return node.direction === direction ? mins.reduce((a, b) => a + b, 0) : Math.max(...mins);
  }

  /**
   * Drag the divider after child `index` of `split` by `delta` px, given the
   * split's length in px. The two children beside the divider trade space;
   * neither goes below its minimum. Returns the sizes actually applied.
   */
  resize(split: Split<T>, index: number, delta: number, total: number, minPane: number): number[] {
    const a = split.children[index];
    const b = split.children[index + 1];
    if (!a || !b || total <= 0) return split.sizes;
    const pair = (split.sizes[index] + split.sizes[index + 1]) * total;
    const minA = this.minSize(a, split.direction, minPane);
    const minB = this.minSize(b, split.direction, minPane);
    let aPx = split.sizes[index] * total + delta;
    aPx = Math.min(Math.max(aPx, minA), pair - minB);
    if (pair < minA + minB) aPx = (pair * minA) / (minA + minB); // too small for both: share by minimum
    split.sizes[index] = aPx / total;
    split.sizes[index + 1] = (pair - aPx) / total;
    split.resized = true;
    return split.sizes;
  }

  // ----- geometry -----

  /** Each group's rectangle in a unit square (the whole workspace is 0..1 on both axes). */
  rects(): Map<TabGroup<T>, Rect> {
    const out = new Map<TabGroup<T>, Rect>();
    const walk = (n: LayoutNode<T>, r: Rect) => {
      if (n.kind === "group") return void out.set(n, r);
      let at = 0;
      n.children.forEach((c, i) => {
        const size = n.sizes[i];
        walk(c, n.direction === "vertical" ? { x: r.x + at * r.w, y: r.y, w: size * r.w, h: r.h } : { x: r.x, y: r.y + at * r.h, w: r.w, h: size * r.h });
        at += size;
      });
    };
    walk(this.root, { x: 0, y: 0, w: 1, h: 1 });
    return out;
  }

  /**
   * The group beside `group` in a direction: of the groups that touch its
   * edge on that side and overlap it across, the one with the most overlap
   * (ties: the one nearer its centre).
   */
  neighbour(group: TabGroup<T>, edge: Edge): TabGroup<T> | null {
    const rects = this.rects();
    const me = rects.get(group);
    if (!me) return null;
    const horizontal = edge === "left" || edge === "right";
    let best: TabGroup<T> | null = null;
    let bestScore = -Infinity;
    for (const [g, r] of rects) {
      if (g === group) continue;
      const touches =
        edge === "right" ? Math.abs(r.x - (me.x + me.w)) < EPS
        : edge === "left" ? Math.abs(r.x + r.w - me.x) < EPS
        : edge === "bottom" ? Math.abs(r.y - (me.y + me.h)) < EPS
        : Math.abs(r.y + r.h - me.y) < EPS;
      if (!touches) continue;
      const overlap = horizontal
        ? Math.min(r.y + r.h, me.y + me.h) - Math.max(r.y, me.y)
        : Math.min(r.x + r.w, me.x + me.w) - Math.max(r.x, me.x);
      if (overlap <= EPS) continue;
      const centre = horizontal ? Math.abs(r.y + r.h / 2 - (me.y + me.h / 2)) : Math.abs(r.x + r.w / 2 - (me.x + me.w / 2));
      const score = overlap - centre * 1e-3;
      if (score > bestScore) {
        bestScore = score;
        best = g;
      }
    }
    return best;
  }

  // ----- saving -----

  toJSON<S>(saveTab: (tab: T) => S): LayoutJSON<S> {
    const walk = (n: LayoutNode<T>): LayoutJSON<S> =>
      n.kind === "group"
        ? { type: "group", tabs: n.tabs.map(saveTab), active: n.tabs.indexOf(n.active) }
        : { type: "split", direction: n.direction, sizes: [...n.sizes], resized: n.resized, children: n.children.map(walk) };
    return walk(this.root);
  }

  /**
   * Rebuild a saved layout. `loadTab` returns null for a tab that can't be
   * restored (its note is gone); groups left without tabs are dropped and
   * the tree is tidied as if they had been closed. Returns null when nothing
   * is left, or the data doesn't parse.
   */
  static fromJSON<T, S>(json: unknown, loadTab: (saved: S) => T | null, activeIndex = 0): Layout<T> | null {
    const layout = new Layout<T>();
    const build = (j: any, l: Layout<T>): LayoutNode<T> | null => {
      if (!j || typeof j !== "object") return null;
      if (j.type === "group" && Array.isArray(j.tabs)) {
        const saved: (T | null)[] = j.tabs.map((s: S) => loadTab(s));
        const tabs = saved.filter((t): t is T => t !== null);
        if (!tabs.length) return null;
        const wanted = typeof j.active === "number" ? saved[j.active] : null;
        return l.makeGroup(tabs, wanted ?? tabs[Math.min(Math.max(0, j.active | 0), tabs.length - 1)]);
      }
      if (j.type === "split" && (j.direction === "vertical" || j.direction === "horizontal") && Array.isArray(j.children)) {
        const kids: LayoutNode<T>[] = [];
        const sizes: number[] = [];
        j.children.forEach((c: unknown, i: number) => {
          const node = build(c, l);
          if (!node) return;
          kids.push(node);
          const s = Array.isArray(j.sizes) ? Number(j.sizes[i]) : NaN;
          sizes.push(Number.isFinite(s) && s > 0 ? s : 1 / j.children.length);
        });
        if (!kids.length) return null;
        if (kids.length === 1) return kids[0];
        const sum = sizes.reduce((a, b) => a + b, 0);
        return l.makeSplit(j.direction, kids, sizes.map((s) => s / sum), !!j.resized);
      }
      return null;
    };
    try {
      const root = build(json, layout);
      if (!root) return null;
      root.parent = null;
      layout.root = root;
      if (root.kind === "split") layout.tidy(root);
      const all = layout.groups();
      layout.activeGroup = all[Math.min(Math.max(0, activeIndex | 0), all.length - 1)] ?? all[0];
      return layout;
    } catch {
      return null;
    }
  }

  /** Merge nested same-direction splits after a restore. */
  private tidy(split: Split<T>) {
    for (const c of [...split.children]) if (c.kind === "split") this.tidy(c);
    this.flatten(split);
  }
}

const equal = (n: number) => Array.from({ length: n }, () => 1 / n);

/** The first (or last) group inside a node. */
function nearestGroup<T>(node: LayoutNode<T>, side: "start" | "end"): TabGroup<T> {
  while (node.kind === "split") node = side === "start" ? node.children[0] : node.children[node.children.length - 1];
  return node;
}
