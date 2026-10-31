import { describe, expect, it } from "vitest";
import { readYaml } from "./yaml";
import { expression, type Context } from "./expression";
import { baseModel, baseNoteFiles, type Row } from "./model";
const ctx: Context = { get: k => ({ priority: 3, due: "2000-01-01", tags: ["work"], status: "open", "file.folder": "BaseTest/Sub" })[k] ?? null, hasTag: t => t === "work", hasLink: t => t === "Task A" };
describe("Bases YAML", () => {
  it("reads nested list mappings, comments and quoted expression punctuation", () => {
    expect(readYaml(`filters:\n  and:\n    - 'status != "#done"' # comment\nviews:\n  - type: table\n    name: "A: B"\n    sort:\n      - property: priority\n        direction: DESC\nextra:\n  yes: true\n  number: -2.5\n  quote: 'it''s fine'\n`)).toEqual({filters:{and:['status != "#done"']}, views:[{type:"table",name:"A: B",sort:[{property:"priority",direction:"DESC"}]}],extra:{yes:true,number:-2.5,quote:"it's fine"}});
  });
  it("rejects invalid, duplicate and unsupported YAML without pretending it is empty", () => {
    for (const s of ['views:\n  - type: [broken','views: yes\nviews: no','x: "unterminated','x:\n\tbad: true','x: a\n  y: b','- table','x: &anchor']) expect(() => readYaml(s)).toThrow();
    expect(readYaml("")).toEqual({});
  });
});
describe("Bases expressions", () => {
  it("evaluates boolean precedence, comparisons, functions and list/text contains", () => {
    for (const source of ['priority >= 3 && (status == "open" || false)', '!false && -2 < priority', 'tags.contains("work")', 'contains(status, "pen")', 'file.inFolder("BaseTest")', 'file.hasTag("work") && file.hasLink("Task A")', 'due < today()']) expect(expression(source)(ctx)).toBe(true);
    expect(expression('if(due < today(), "late", "")')(ctx)).toBe("late");
    expect(expression('missing < today()')(ctx)).toBe(false);
    expect(expression('true || false && false')(ctx)).toBe(true);
  });
  it("rejects unsupported calls even in skipped branches and trailing syntax", () => {
    for (const s of ['true || unknown()', 'priority.constructor()', 'file.unknown', 'if(true, 1)', 'status == "a" garbage']) expect(() => expression(s)).toThrow();
  });
});
function row(name: string, n?: number): Row {
  return {file:{path:`BaseTest/${name}.md`,name,is_dir:false,mtime_ms:1,ctime_ms:1,size:1},props:n === undefined ? [] : [{key:"priority",type:"number",value:String(n),line:0,count:1}],tags:[],hasLink:()=>false};
}
describe("Bases tables", () => {
  const rows = [row("A",3),row("B",2),row("C"),row("D",3)];
  it("combines global/view filters, sorts numerically with empty last, then limits", () => {
    const base = baseModel(`filters: 'file.inFolder("BaseTest")'\nviews:\n  - type: table\n    filters:\n      not:\n        - 'priority == 2'\n        - 'file.name == "X"'\n    order:\n      - priority\n    sort:\n      - property: priority\n        direction: DESC\n      - property: file.name\n        direction: DESC\n    limit: 2\n`);
    expect(base.select(rows).map(r=>r.row.file.name)).toEqual(["D","A"]);
    for(const direction of ["ASC","DESC"]) expect(baseModel(`views:\n  - sort:\n      - property: priority\n        direction: ${direction}`).select(rows).at(-1)?.row.file.name).toBe("C");
  });
  it("never lets a filter that fails on a row match it, in any tree", () => {
    const names = (source: string) => baseModel(source).select(rows).map(r => r.row.file.name);
    expect(names(`filters: 'file.inFolder(note.where)'`)).toEqual([]);
    expect(names(`filters: '-file.name < 0'`)).toEqual([]);
    expect(names(`views:\n  - filters:\n      not:\n        - '-file.name < 0'\n`)).toEqual([]);
    // "or" stops at its first match, like || inside one expression: only B gets past the failing leaf.
    expect(names(`filters:\n  or:\n    - 'priority == 2'\n    - '-file.name < 0'\n`)).toEqual(["B"]);
    expect(names(`filters:\n  or:\n    - '-file.name < 0'\n    - 'priority == 2'\n`)).toEqual([]);
    expect(names(`filters:\n  and:\n    - 'priority == 9'\n    - '-file.name < 0'\n`)).toEqual([]);
    // Filters that don't fail keep working, including on rows with missing values.
    expect(names(`filters: 'priority > 2'`)).toEqual(["A", "D"]);
    expect(names(`filters: '!(priority > 2)'`)).toEqual(["B", "C"]);
    expect(names(`filters: 'note.missing.lower() == "a"'`)).toEqual([]);
  });
  it("sorts empties last both ways, ISO dates by time, date-like text by code unit, other text by locale", () => {
    const text = (name: string, v: string): Row => ({ ...row(name), props: [{ key: "p", type: "text", value: v, line: 0, count: 1 }] });
    const mixed = [text("a", "2024-01-05T10:00"), text("b", ""), text("c", "2024-01-05"), text("d", "2024-13-40"), text("e", "2024-01-05 notes"), text("f", "Banana"), text("g", "apple"), row("h")];
    const order = (direction: string) => baseModel(`views:\n  - sort:\n      - property: p\n        direction: ${direction}\n`).select(mixed).map(r => r.row.file.name).join("");
    expect(order("ASC")).toBe("ceadgfbh");
    expect(order("DESC")).toBe("fgdaecbh");
  });
  it("handles or trees, canonical display names, formulas and unsupported expressions", () => {
    const base = baseModel(`filters:\n  or:\n    - 'priority == 2'\n    - 'file.name == "A"'\nformulas:\n  unsupported: 'bad()'\n  self: 'formula.self'\nproperties:\n  note.priority:\n    displayName: Rank\nviews:\n  - order:\n      - formula.unsupported\n`);
    const selected = base.select(rows);
    expect(selected.map(r=>r.row.file.name)).toEqual(["A","B"]);
    expect(base.label("priority")).toBe("Rank");
    expect(selected[0].context.get("note.priority")).toBe(3);
    expect(selected[0].context.get("formula.unsupported")).toBe(null);
    expect(selected[0].context.get("formula.self")).toBe(null);
    expect(base.notices.size).toBe(2);
    expect(baseModel("").columns).toEqual(["file.name"]);
    expect(baseModel("").notices.size).toBe(0);
    expect(() => baseModel('views: table')).toThrow();
    const unsupported = 'views:\n  - type: map\n    name: Map\n  - type: table\n    name: Table\n';
    const map = baseModel(unsupported);
    expect(map.type).toBe("table");
    expect(map.name).toBe("Map");
    expect([...map.notices]).toEqual(["This layout isn't supported yet"]);
    const sibling = baseModel(unsupported, 1);
    expect(sibling.name).toBe("Table");
    expect(sibling.notices.size).toBe(0);
    const places = baseModel('views:\n  - type: map\n    name: Places\n');
    expect(places.type).toBe("table");
    expect(places.name).toBe("Places");
    expect([...places.notices]).toEqual(["This layout isn't supported yet"]);
    expect(baseModel('views:\n  - type: table\n').notices.size).toBe(0);
    expect(baseModel('views:\n  - type: cards\n').notices.size).toBe(0);
    // K4: Kanban is a layout of its own.
    const kanban = baseModel('views:\n  - type: kanban\n    name: Board\n');
    expect(kanban.type).toBe("kanban");
    expect(kanban.notices.size).toBe(0);
  });
  it("parses cards view type and card layout options with defaults", async () => {
    (globalThis as Record<string, unknown>).window ??= {};
    (globalThis as Record<string, unknown>).document ??= { body: {}, addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, append() {}, addEventListener() {}, classList: { add() {}, toggle() {} } }) };
    (globalThis as Record<string, unknown>).MutationObserver ??= class { observe() {} disconnect() {} };
    const { cardLayout } = await import("./cards");
    const def = baseModel("views:\n  - type: cards\n    name: Cards\n");
    expect(def.type).toBe("cards");
    expect(def.name).toBe("Cards");
    expect(def.cardSize).toBe(220);
    expect(def.image).toBeNull();
    expect(def.imageFit).toBe("cover");
    expect(def.imageAspectRatio).toBe(0.5);

    const custom = baseModel(
      "views:\n  - type: cards\n    cardSize: 280\n    image: note.cover\n    imageFit: contain\n    imageAspectRatio: 0.75\n",
    );
    expect(custom.type).toBe("cards");
    expect(custom.cardSize).toBe(280);
    expect(custom.image).toBe("note.cover");
    expect(custom.imageFit).toBe("contain");
    expect(custom.imageAspectRatio).toBe(0.75);

    expect(baseModel("views:\n  - type: cards\n    cardSize: small\n").cardSize).toBe(160);
    expect(baseModel("views:\n  - type: cards\n    cardSize: large\n").cardSize).toBe(320);

    const smallGrid = cardLayout({
      count: 12,
      width: 960,
      height: 500,
      scrollTop: 0,
      cardSize: 220,
      propCount: 3,
      coverHeight: 110,
    });
    expect(smallGrid.virtual).toBe(false);
    expect(smallGrid.cols).toBe(4);
    expect(smallGrid.firstIndex).toBe(0);
    expect(smallGrid.endIndex).toBe(12);
    expect(smallGrid.topSpace).toBe(0);
    expect(smallGrid.bottomSpace).toBe(0);

    const largeGrid = cardLayout({
      count: 1000,
      width: 960,
      height: 500,
      scrollTop: 4000,
      cardSize: 220,
      propCount: 3,
      coverHeight: 110,
    });
    expect(largeGrid.virtual).toBe(true);
    expect(largeGrid.cols).toBe(4);
    expect(largeGrid.firstIndex).toBeGreaterThan(0);
    expect(largeGrid.endIndex - largeGrid.firstIndex).toBeLessThanOrEqual(30);
    expect(largeGrid.topSpace + (largeGrid.endRow - largeGrid.firstRow) * largeGrid.rowPitch + largeGrid.bottomSpace).toBe(
      largeGrid.totalRows * largeGrid.rowPitch,
    );
  });
});

it("lists an upper-case .MD file as a Base row", () => {
  const file = (path: string, is_dir = false) => ({ path, name: path.slice(path.lastIndexOf("/") + 1), is_dir, mtime_ms: 1, ctime_ms: 1, size: 1 });
  const notes = baseNoteFiles([file("Upper.MD"), file("Note.md"), file("pic.png"), file("Hidden.md"), file("Dir", true)], (path) => path === "Hidden.md");
  expect(notes.map((f) => f.path)).toEqual(["Upper.MD", "Note.md"]);
  const rows: Row[] = notes.map((f) => ({ file: f, props: [], tags: [], hasLink: () => false }));
  const selected = baseModel("").select(rows);
  expect(selected.map((r) => r.context.get("file.name"))).toEqual(["Note", "Upper"]);
  expect(selected.find((r) => r.row.file.path === "Upper.MD")!.context.get("file.name")).toBe("Upper");
});

it("keeps custom note names literal alongside native file labels",()=>{
 const base=baseModel("");expect(base.label("constructor")).toBe("constructor");expect(base.label("__proto__")).toBe("__proto__");expect(base.label("file.ctime")).toBe("created time");
});
