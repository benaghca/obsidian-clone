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
    expect(() => baseModel('views: table')).toThrow();
    expect(() => baseModel('views:\n  - type: cards')).toThrow();
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
