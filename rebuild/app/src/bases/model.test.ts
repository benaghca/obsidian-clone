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
    // Cinder writes `board` for this layout. The file keeps that word; the view draws as kanban.
    const board = baseModel('views:\n  - type: board\n    name: Board\n');
    expect(board.type).toBe("kanban");
    expect(board.name).toBe("Board");
    expect(board.view.type).toBe("board");
    expect(board.notices.size).toBe(0);
    // K8: List is a layout of its own. Markers and the separator are read only for that layout.
    const list = baseModel('views:\n  - type: list\n    name: List\n    markers: numbers\n    separator: " | "\n');
    expect(list.type).toBe("list");
    expect(list.name).toBe("List");
    expect(list.listMarkers).toBe("numbers");
    expect(list.listSeparator).toBe(" | ");
    expect(list.notices.size).toBe(0);
    const fallback = baseModel('views:\n  - type: list\n    markers: spiral\n    indentProperties: true\n');
    expect(fallback.listMarkers).toBe("bullets");
    expect([...fallback.notices]).toEqual(["Unsupported list markers: spiral", "Indent properties isn't supported yet"]);
    const ignored = baseModel('views:\n  - type: table\n    markers: numbers\n    indentProperties: true\n');
    expect(ignored.notices.size).toBe(0);
    expect(ignored.listMarkers).toBe("bullets");
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
it("reads a moved property's preserved key spelling consistently with CAS",()=>{
 const model=baseModel('views:\n  - groupBy:\n      property: status\n');
 const row:Row={file:{path:'A.md',name:'A.md',is_dir:false,size:0,mtime_ms:0,ctime_ms:0},props:[{key:'Status',type:'text',value:'doing',line:0,count:1}],tags:[],hasLink:()=>false};
 expect(model.context(row).get('status')).toBe('doing');expect(model.select([row])[0].context.get('note.STATUS')).toBe('doing');
});

// Review 3: `select` runs in steps (`selectWork`), its sort a stable merge sort in steps.
it("selects in steps, in the order the one-task sort gave", async () => {
  const { compareNames, noteName } = await import("../paths");
  let x = 7;
  const r = (n: number) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % n; };
  const statuses = ["open", "Open", "done", "later", "", "b10", "b9"];
  const rows: Row[] = Array.from({ length: 3000 }, (_, i) => {
    const props: Row["props"] = [];
    if (r(5)) props.push({ key: "priority", type: "number", value: String(r(9) - 4), line: 0, count: 1 });
    const status = statuses[r(statuses.length)]!;
    if (status) props.push({ key: "status", type: "text", value: status, line: 0, count: 1 });
    const name = `n${r(400)}`;
    return { file: { path: `S/${i % 7}/${name}.md`, name, is_dir: false, mtime_ms: 1, ctime_ms: 1, size: 1 }, props, tags: [], hasLink: () => false };
  });
  const model = baseModel(`filters: '!(priority == 0)'\nviews:\n  - sort:\n      - property: priority\n        direction: DESC\n      - property: status\n`);
  const work = model.selectWork(rows, true);
  let pauses = 0, step = work.next();
  for (; !step.done; step = work.next()) pauses++;
  expect(pauses).toBeGreaterThan(3000 / 256 + 30);
  // The one-task select, as it was: the filter, then a native sort of the same keys.
  const value = (row: Row, key: string) => { const v = row.props.find((p) => p.key === key)?.value; return v === undefined ? undefined : String(v); };
  const oracle = rows.filter((row) => Number(value(row, "priority") ?? NaN) !== 0).sort((a, b) => {
    const pa = value(a, "priority"), pb = value(b, "priority");
    if ((pa === undefined) !== (pb === undefined)) return pa === undefined ? 1 : -1;
    if (pa !== undefined && pb !== undefined && Number(pa) !== Number(pb)) return (Number(pa) - Number(pb)) * -1;
    const sa = value(a, "status"), sb = value(b, "status");
    if ((sa === undefined) !== (sb === undefined)) return sa === undefined ? 1 : -1;
    const diff = sa !== undefined && sb !== undefined ? compareNames(sa, sb) : 0;
    if (diff) return diff;
    return compareNames(noteName(a.file.path), noteName(b.file.path)) || compareNames(a.file.path, b.file.path);
  });
  expect(step.value.map((e) => e.row.file.path)).toEqual(oracle.map((row) => row.file.path));
  expect(model.select(rows, true).map((e) => e.row.file.path)).toEqual(oracle.map((row) => row.file.path));
});

// Review 4: a sort column that mixes kinds compares some pairs as numbers and others as text,
// which can go round in a cycle; there the rows keep the order `Array.prototype.sort` gave,
// on first paint (`select`) and in a refresh in steps (`selectWork`), and so does the limit.
it("keeps the native order for a sort column that mixes numbers and text", async () => {
  const { compareNames, noteName } = await import("../paths");
  const { parseDate } = await import("./dates");
  const typed = (path: string, value: string, type: "number" | "text"): Row => ({ file: { path, name: noteName(path), is_dir: false, mtime_ms: 1, ctime_ms: 1, size: 1 }, props: [{ key: "v", type, value, line: 0, count: 1 }], tags: [], hasLink: () => false });
  const cycle = [typed("M/a.md", "-2", "number"), typed("M/b.md", "-3", "text"), typed("M/c.md", "-10", "number")];
  const limited = baseModel("views:\n  - sort:\n      - property: v\n    limit: 2\n");
  const paths = (found: { row: Row }[]) => found.map((e) => e.row.file.path);
  expect(paths(limited.select(cycle))).toEqual(["M/a.md", "M/b.md"]);
  const drained = (work: Generator<void, { row: Row }[]>) => { let step = work.next(); while (!step.done) step = work.next(); return step.value; };
  expect(paths(drained(limited.selectWork(cycle, true)).slice(0, 2))).toEqual(["M/a.md", "M/b.md"]);
  // The one-task select, as it was: a native sort of the same keys, against random mixes of
  // numbers, numeric text, words, dates that parse and ones that don't, NaN and empties.
  let x = 11;
  const r = (n: number) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % n; };
  const kinds = [() => [String(r(30) - 15), "number"], () => [String(r(30) - 15), "text"], () => [["b", "B", "a10", "a9", "é"][r(5)], "text"], () => [`2024-0${1 + r(9)}-1${r(9)}`, "text"], () => [`2024-13-0${r(9)}`, "text"], () => ["oops", "number"], () => ["", "text"]] as const;
  const key = (row: Row) => {
    const p = row.props[0];
    const value = p.type === "number" && p.value !== "" ? Number(p.value) : p.value;
    const missing = value === "";
    const dateLike = typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value);
    return { missing, value, dateLike, time: dateLike ? parseDate(value as string)?.time : undefined, text: String(value) };
  };
  for (let round = 0; round < 60; round++) {
    const mix = [kinds[r(kinds.length)], kinds[r(kinds.length)], kinds[r(kinds.length)]];
    const rows = Array.from({ length: 40 + r(40) }, (_, i) => { const [value, type] = mix[r(3)](); return typed(`M/${r(5)}/n${i}.md`, value, type as "number" | "text"); });
    const keyed = rows.map((row) => ({ row, k: key(row), name: noteName(row.file.path) }));
    keyed.sort((a, b) => {
      if (a.k.missing !== b.k.missing) return a.k.missing ? 1 : -1;
      const p = a.k.value, q = b.k.value;
      const diff = typeof p === "number" && typeof q === "number" ? p - q : a.k.dateLike && b.k.dateLike ? (a.k.time !== undefined && b.k.time !== undefined ? a.k.time - b.k.time : p < q ? -1 : p > q ? 1 : 0) : compareNames(a.k.text, b.k.text);
      if (diff) return diff;
      return compareNames(a.name, b.name) || compareNames(a.row.file.path, b.row.file.path);
    });
    const model = baseModel(`views:\n  - sort:\n      - property: v\n    limit: ${10 + r(20)}\n`);
    const want = keyed.map((k) => k.row.file.path);
    expect(paths(model.select(rows, true)), `round ${round}`).toEqual(want);
    expect(paths(drained(model.selectWork(rows, true))), `round ${round}`).toEqual(want);
    expect(paths(model.select(rows)), `round ${round}`).toEqual(want.slice(0, model.view.limit as number));
  }
});
