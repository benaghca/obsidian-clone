import { expect, test } from "vitest";
import { paletteItems } from "./paletteItems";

const cmds = ["Toggle bold", "Toggle right sidebar", "Toggle reading view", "Navigate back", "Backlinks: Show backlinks"].map(
  (name, i) => ({ id: `c${i}`, name }),
);

test("empty query: recently used first, then alphabetical", () => {
  expect(paletteItems("", cmds, ["c3", "c1"]).map((x) => x.cmd.name)).toEqual([
    "Navigate back",
    "Toggle right sidebar",
    "Backlinks: Show backlinks",
    "Toggle bold",
    "Toggle reading view",
  ]);
});

test("a query fuzzy-matches with the tightest match first and marks matched letters", () => {
  const items = paletteItems("togrig", cmds, []);
  expect(items[0].cmd.name).toBe("Toggle right sidebar");
  expect(items[0].indices).toEqual([0, 1, 2, 7, 8, 9]);
  expect(paletteItems("zzz", cmds, [])).toEqual([]);
});

test("ties go to the more recently used command", () => {
  const twins = [
    { id: "a", name: "Same name" },
    { id: "b", name: "Same name" },
  ];
  expect(paletteItems("same", twins, ["b"]).map((x) => x.cmd.id)).toEqual(["b", "a"]);
});

test("matching every command stays far under 2ms per keystroke", () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ id: `x${i}`, name: `Group ${i % 7}: Do the thing number ${i}` }));
  const t0 = performance.now();
  for (const q of ["g", "gr", "gro", "group 3", "thing 12", "zq"]) paletteItems(q, many, []);
  expect((performance.now() - t0) / 6).toBeLessThan(2);
});
