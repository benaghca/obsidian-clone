import { expect, test } from "vitest";
import type { Group, Tab } from "../tabs";
import { dropTarget, type Measured } from "./tabDrag";

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
const tab = (id: number) => ({ id }) as Tab;
const [a, b, c] = [tab(1), tab(2), tab(3)];
const left = { tabs: [a, b] } as unknown as Group;
const right = { tabs: [c] } as unknown as Group;
// Two panes side by side, 300 wide and 400 high, with 40px tab bars.
const panes: Measured[] = [
  { group: left, pane: rect(0, 0, 300, 400), strip: rect(0, 0, 300, 40), tabs: [{ tab: a, left: 0, right: 100 }, { tab: b, left: 100, right: 200 }] },
  { group: right, pane: rect(300, 0, 300, 400), strip: rect(300, 0, 300, 40), tabs: [{ tab: c, left: 300, right: 400 }] },
];
const drop = (x: number, y: number) => dropTarget(x, y, a, left, panes);

test("the outer third of a pane's left, right or bottom splits it, lighting that third of the group", () => {
  expect(drop(310, 200)).toMatchObject({ kind: "pane", group: right, edge: "left", box: { x: 300, y: 0, w: 100, h: 400 } });
  expect(drop(590, 200)).toMatchObject({ kind: "pane", edge: "right", box: { x: 500, w: 100 } });
  expect(drop(450, 390)).toMatchObject({ kind: "pane", edge: "bottom", box: { x: 300, y: 400 - 400 / 3, w: 300 } });
  // No top zone, as in Obsidian: just under the tab bar is the middle.
  expect(drop(450, 50)).toMatchObject({ kind: "tab", group: right, index: 1 });
});

test("the middle of a pane moves the tab into that group, after its last tab", () => {
  expect(drop(450, 200)).toMatchObject({ kind: "tab", group: right, index: 1, box: { x: 395, y: 6, w: 10, h: 34 } });
  // Its own pane's middle: to the end of its tabs, unless it is already last.
  expect(drop(150, 200)).toMatchObject({ kind: "tab", group: left, index: 2 });
  expect(dropTarget(150, 200, b, left, panes)).toBeNull();
});

test("on a tab bar: a marker between tabs; a place that changes nothing shows nothing", () => {
  expect(drop(320, 20)).toMatchObject({ kind: "tab", group: right, index: 0, box: { x: 295 } });
  expect(drop(60, 20)).toBeNull();
  expect(drop(260, 20)).toMatchObject({ kind: "tab", group: left, index: 2 });
});
