// Cinder .base files (ui/bases.js and ui/test/bases.test.js) opened by Grove.
// Each fixture is bytes Cinder reads or writes. Opening parses them and picks
// the layout view.ts draws. A no-op save writes those same values back and
// must leave the file byte for byte, including quotes, comments and CRLF.
import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { baseBlockChange, baseBlockYaml } from "../editor/embeds";
import type { Property } from "../editor/frontmatter";
import { parseManual, writeViewSetting } from "./groups";
import { baseModel, layoutOf, viewGlyph, type Row } from "./model";
import { writeFilters, writeTop, writeView } from "./write";
import { mapping, readYaml, type Yaml } from "./yaml";

const loaded = import.meta.glob("../../fixtures/cinder-bases/*", { eager: true, query: "?raw", import: "default" });
const read = (name: string) => {
  const key = Object.keys(loaded).find(path => path.endsWith(`/${name}`));
  if (!key) throw Error(`missing fixture ${name}`);
  return loaded[key] as string;
};
const fixtureNames = () => Object.keys(loaded).map(path => path.slice(path.lastIndexOf("/") + 1));

/** Write every key Grove's editors own, using a copy of the parsed value. */
function rewriteSame(source: string): string {
  const root = readYaml(source);
  let out = source;
  if (Object.hasOwn(root, "filters")) out = writeFilters(out, root.filters);
  if (Object.hasOwn(root, "properties")) out = writeTop(out, "properties", root.properties);
  const views = Array.isArray(root.views) ? root.views : [];
  for (let i = 0; i < views.length; i++) {
    const item = views[i];
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    for (const key of ["type", "name", "order", "sort", "limit", "filters", "groupBy"] as const) {
      if (!Object.hasOwn(item, key)) continue;
      const value = JSON.parse(JSON.stringify(item[key])) as Yaml;
      if (key === "groupBy") out = writeViewSetting(out, "groupBy", value, i);
      else if (key === "filters") out = writeFilters(out, value, i);
      else out = writeView(out, key, value, i);
    }
  }
  return out;
}

const drawn: Record<string, ("table" | "cards" | "list" | "kanban")[]> = {
  "reading-list.base": ["table", "cards", "kanban"],
  "list.base": ["list"],
  "board-columns.base": ["kanban"],
  "builtins.base": ["table"],
  "filter-string.base": ["table"],
  "flow.base": ["cards"],
  "views-empty.base": ["table"],
  "empty.base": ["table"],
  "crlf.base": ["table"],
  "gap-filter-bool.base": ["cards"],
  "gap-filter-list.base": ["list"],
  "gap-expressions.base": ["table"],
};

function note(path: string, props: Property[] = [], tags: string[] = []): Row {
  return { file: { path, name: path.slice(path.lastIndexOf("/") + 1), is_dir: false, mtime_ms: 1, ctime_ms: 1, size: 4 }, props, tags, hasLink: () => false };
}

describe("Cinder .base corpus", () => {
  it("has a fixture for every file in the corpus directory", () => {
    const names = fixtureNames().filter(name => name !== "block.md");
    expect(new Set(names)).toEqual(new Set([...Object.keys(drawn), "gap-string-groupby.base", "gap-block-scalar.base"]));
  });

  it("parses each file, draws its view type, and keeps every byte on open and on a no-op save", () => {
    for (const [name, types] of Object.entries(drawn)) {
      const source = read(name);
      for (let i = 0; i < types.length; i++) {
        const model = baseModel(source, i);
        expect(model.type, name).toBe(types[i]);
        const raw = mapping(model.views[i]).type;
        if (typeof raw === "string") {
          expect(layoutOf(raw), name).toBe(types[i]);
          expect(viewGlyph(raw), name).toBe(viewGlyph(types[i]));
        } else expect(model.type, name).toBe("table");
      }
      expect(rewriteSame(source), name).toBe(source);
    }
  });

  it("runs the documented reading list, including file.basename", () => {
    const source = read("reading-list.base");
    const table = baseModel(source, 0);
    const cards = baseModel(source, 1);
    const board = baseModel(source, 2);
    expect(table.notices.size).toBe(0);
    expect(cards.notices.size).toBe(0);
    expect(board.notices.size).toBe(0);
    expect(table.columns).toEqual(["file.name", "author", "formula.ppd"]);
    expect(table.view.limit).toBe(10);
    expect(cards.name).toBe("All books");
    expect(cards.image).toBe("cover");
    expect(board.groupBy).toEqual({ property: "status", direction: "ASC" });
    expect(board.view.type).toBe("board");
    const row = note("Books/Dune.md", [
      { key: "status", type: "text", value: "done", line: 0, count: 1 },
      { key: "pages", type: "number", value: "700", line: 1, count: 1 },
      { key: "author", type: "text", value: "Herbert", line: 2, count: 1 },
    ], ["book"]);
    expect(table.select([row])).toEqual([]);
    const selected = cards.select([row]);
    expect(selected.map(entry => entry.row.file.path)).toEqual(["Books/Dune.md"]);
    expect(selected[0].context.get("file.basename")).toBe("Dune");
    expect(selected[0].context.get("file.name")).toBe("Dune");
    expect(selected[0].context.get("formula.ppd")).toBe(100);
    expect(selected[0].context.get("formula.label")).toBe("✓ Dune");
    expect(cards.label("author")).toBe("Author");
    expect(cards.label("formula.ppd")).toBe("Pages/day");
  });

  it("reads a list, a string filter, display names and the file.* column ids", () => {
    const list = baseModel(read("list.base"));
    expect(list.type).toBe("list");
    expect(list.listMarkers).toBe("bullets");
    expect(list.notices.size).toBe(0);
    const named = baseModel(read("builtins.base"));
    expect(named.label("file.name")).toBe("Title");
    expect(named.label("file.basename")).toBe("Base name");
    expect(named.label("status")).toBe("Status");
    const row = note("Books/Dune.md", [], ["book"]);
    const ctx = named.select([row])[0].context;
    expect(ctx.get("file.basename")).toBe("Dune");
    expect(ctx.get("file.path")).toBe("Books/Dune.md");
    expect(ctx.get("file.folder")).toBe("Books");
    expect(ctx.get("file.ext")).toBe("md");
    expect(ctx.get("file.links")).toBeNull();
    expect(ctx.get("file.backlinks")).toBeNull();
    expect(baseModel(read("filter-string.base")).notices.size).toBe(0);
    expect(baseModel("").name).toBe("View");
    expect(baseModel(read("views-empty.base")).name).toBe("View");
  });

  it("keeps a board's columns key on disk and does not turn it into group order", () => {
    const model = baseModel(read("board-columns.base"));
    expect(model.type).toBe("kanban");
    expect(model.notices.size).toBe(0);
    expect(model.view.columns).toEqual(["todo", "reading", "done"]);
    expect(parseManual(model.view.groupBy)).toBeNull();
  });

  it("draws a ```base block and writes the same yaml back into the note", () => {
    const noteText = read("block.md");
    const start = noteText.indexOf("```base\n");
    const end = noteText.indexOf("\n```\n", start);
    const yaml = baseBlockYaml(noteText.slice(start, end + 4));
    expect(yaml).toContain("type: board");
    const model = baseModel(yaml!);
    expect(model.type).toBe("kanban");
    expect(model.notices.size).toBe(0);
    expect(rewriteSame(yaml!)).toBe(yaml);
    const doc = Text.of(noteText.split("\n"));
    const change = baseBlockChange(doc, start, yaml!);
    expect(change).not.toBeNull();
    expect(doc.sliceString(change!.from, change!.to)).toBe(change!.insert);
  });

  it("records the shapes Cinder reads and Grove does not take", () => {
    expect(() => baseModel(read("gap-string-groupby.base"))).toThrow(/groupBy requires a property/);
    expect(rewriteSame(read("gap-string-groupby.base"))).toBe(read("gap-string-groupby.base"));
    expect(() => baseModel(read("gap-block-scalar.base"))).toThrow(/Unsupported YAML/);
    for (const name of ["gap-filter-bool.base", "gap-filter-list.base"]) {
      const model = baseModel(read(name));
      expect([...model.notices], name).toEqual(["Unsupported filter tree"]);
    }
    const formulas = baseModel(read("gap-expressions.base"));
    expect([...formulas.notices].sort()).toEqual([
      'Unsupported expression: status == "done" ? 1 : 2',
      'Unsupported expression: tags.contains("scifi") and tags.length == 2',
    ]);
    const row = note("Books/Dune.md");
    expect(formulas.select([row])[0].context.get("formula.base")).toBe("Dune");
  });
});
