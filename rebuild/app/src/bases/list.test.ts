import { expect, it } from "vitest";
import { LIST_HEADER, LIST_ROW, listLayout } from "./list";
import { baseModel, viewGlyph } from "./model";
import { writeView } from "./write";

it("places only the rows and headings that meet the window", () => {
  const few = listLayout({ counts: [3], grouped: false, scrollTop: 0, height: 600 });
  expect(few.total).toBe(3 * LIST_ROW);
  expect(few.units.map(u => u.index)).toEqual([0, 1, 2]);
  expect(few.units.every(u => u.kind === "row" && u.top === u.index * LIST_ROW)).toBe(true);

  const at = listLayout({ counts: [10_000], grouped: false, scrollTop: 5000 * LIST_ROW, height: 280, overscan: 8 });
  expect(at.total).toBe(10_000 * LIST_ROW);
  expect(at.units.length).toBeGreaterThan(0);
  expect(at.units.length).toBeLessThan(40);
  expect(at.units[0].index).toBeGreaterThanOrEqual(4980);
  expect(at.units[0].index).toBeLessThanOrEqual(5000);
  expect(at.units.at(-1)!.index).toBeLessThan(5040);
  expect(at.units.every(u => u.kind === "row")).toBe(true);
  // The number on a scrolled row is its place in the whole list, so the window starts near row 4992.
  expect(at.units[0].index).toBe(4992);

  const shut = listLayout({ counts: [3, 5], collapsed: [true, false], grouped: true, scrollTop: 0, height: 600 });
  expect(shut.total).toBe(LIST_HEADER + LIST_HEADER + 5 * LIST_ROW);
  expect(shut.units.some(u => u.group === 0 && u.kind === "row")).toBe(false);
  expect(shut.units.some(u => u.group === 0 && u.kind === "heading" && u.top === 0)).toBe(true);
  expect(shut.units.filter(u => u.group === 1 && u.kind === "row").map(u => u.index)).toEqual([0, 1, 2, 3, 4]);

  expect(listLayout({ counts: [], grouped: false, scrollTop: 0, height: 600 })).toEqual({ total: 0, units: [] });
  // A zero height (the scroller has not been laid out yet) still fills a first screen.
  const fallback = listLayout({ counts: [3], grouped: false, scrollTop: 0, height: 0 });
  expect(fallback.units.map(u => u.index)).toEqual([0, 1, 2]);
});

it("keeps a grouped window on the fixed heading and row pitch", () => {
  const counts = [0, 3, 100, 1, 40];
  const collapsed = [false, true, false, false, true];
  const total = LIST_HEADER * counts.length + (100 + 1) * LIST_ROW;
  const over = 8 * LIST_ROW;
  for (let scroll = 0; scroll < total; scroll += 53) {
    const laid = listLayout({ counts, collapsed, grouped: true, scrollTop: scroll, height: 400, overscan: 8 });
    expect(laid.total).toBe(total);
    const top = Math.max(0, scroll - over), bottom = scroll + 400 + over;
    let previous = -1;
    for (const unit of laid.units) {
      const height = unit.kind === "heading" ? LIST_HEADER : LIST_ROW;
      expect(unit.top).toBeGreaterThan(previous);
      expect(unit.top).toBeLessThan(bottom);
      expect(unit.top + height).toBeGreaterThan(top);
      previous = unit.top;
      if (unit.kind === "heading") expect(unit.index).toBe(-1);
      if (collapsed[unit.group]) expect(unit.kind).toBe("heading");
    }
    expect(laid.units.length).toBeGreaterThan(0);
  }
});

it("reads list markers and the inline separator, and writes markers back", () => {
  expect(viewGlyph("list")).toBe("list");
  expect(viewGlyph("cards")).toBe("grid-2x2");
  expect(viewGlyph("kanban")).toBe("square-kanban");
  expect(viewGlyph("table")).toBe("table");
  expect(viewGlyph("map")).toBe("table");

  const list = (yaml: string) => baseModel(`views:\n  - type: list\n    name: List\n${yaml}`);
  expect(list("").listMarkers).toBe("bullets");
  expect(list("").listSeparator).toBe(", ");
  expect(list("").notices.size).toBe(0);
  for (const [raw, markers] of [["numbers", "numbers"], ["number", "numbers"], ["numbered", "numbers"], ["ordered", "numbers"], ["none", "none"], ["unmarked", "none"], ["bullets", "bullets"], ["bullet", "bullets"], ["unordered", "bullets"]] as const) {
    expect(list(`    markers: ${raw}\n`).listMarkers).toBe(markers);
  }
  expect(list("    marker: numbered\n").listMarkers).toBe("numbers");
  expect(list("    listMarkers: ordered\n").listMarkers).toBe("numbers");
  const odd = list("    markers: rainbow\n");
  expect(odd.listMarkers).toBe("bullets");
  expect([...odd.notices]).toEqual(["Unsupported list markers: rainbow"]);
  expect(list('    separator: " | "\n').listSeparator).toBe(" | ");
  expect(list('    separator: ""\n').listSeparator).toBe("");
  expect(list('    propertySeparator: " · "\n').listSeparator).toBe(" · ");

  const indent = list("    indentProperties: true\n");
  expect([...indent.notices]).toEqual(["Indent properties isn't supported yet"]);
  expect([...list('    nestedProperties: "true"\n').notices]).toEqual(["Indent properties isn't supported yet"]);

  const table = baseModel('views:\n  - type: table\n    name: Table\n    markers: rainbow\n    indentProperties: true\n    separator: " | "\n');
  expect(table.type).toBe("table");
  expect(table.notices.size).toBe(0);
  expect(table.listMarkers).toBe("bullets");
  expect(table.listSeparator).toBe(", ");

  const source = "views:\n  - type: list\n    name: Bullets\n";
  const numbered = writeView(source, "markers", "numbers");
  expect(numbered).toBe(`${source}    markers: numbers\n`);
  expect(baseModel(numbered).listMarkers).toBe("numbers");
  expect(writeView(numbered, "markers", "none")).toBe(numbered.replace("markers: numbers", "markers: none"));
  expect(baseModel(writeView(numbered, "markers", "none")).listMarkers).toBe("none");
});
