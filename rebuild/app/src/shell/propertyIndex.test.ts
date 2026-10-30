import { Text } from "@codemirror/state";
import { readProperties, splitFrontmatter } from "../editor/frontmatter";
import type { NoteProperties } from "../api";
import { beforeEach, expect, it, vi } from "vitest";

const properties = vi.fn<(paths?: string[]) => Promise<Record<string, NoteProperties>>>();
vi.mock("../api", () => ({ api: { properties: (paths?: string[]) => properties(paths) } }));
vi.mock("../memo", async (original) => ({ ...await original<typeof import("../memo")>(), perWorkspace: <T>(create: (ws: unknown) => T) => create }));
vi.mock("./vaultTags", () => ({ vaultTags: () => ({ read: async () => new Map([["a.md", ["x"]]]) }) }));

const { propertyIndex } = await import("./propertyIndex");

const DISK: Record<string, string> = {
  "a.md": "---\nstatus: draft\nrating: 3\n---",
  "b.md": "---\nstatus: done\n---",
  "c.md": "---\nstatus: draft\ntags: [x]\n---",
};
const files = ["a.md", "b.md", "c.md", "d.md"].map((path) => ({ path, name: path, is_dir: false, mtime_ms: 1, size: 0 }));
const open = new Map<string, Text>();
const ws = {
  vault: { files, includedNotes: () => files.map((f) => ({ path: f.path, name: f.path.replace(/\.md$/, "") })) },
  editors: { isLoaded: (path: string) => open.has(path), doc: (path: string) => open.get(path) },
  on: () => () => {},
};

beforeEach(() => {
  properties.mockReset();
  properties.mockImplementation(async (paths) => Object.fromEntries(Object.entries(DISK).flatMap(([p, text]) => {
    const split = splitFrontmatter(text), props = split && readProperties(split.lines);
    return (!paths || paths.includes(p)) && props ? [[p, { props, lines: split!.lines }]] : [];
  })));
});

it("reads nothing until asked, then the whole vault's parsed properties in one call", async () => {
  const index = propertyIndex(ws as never);
  expect(properties).not.toHaveBeenCalled();
  const names = await index.names();
  expect(properties).toHaveBeenCalledTimes(1);
  expect(properties).toHaveBeenCalledWith(undefined);
  expect(names.map((n) => `${n.key}:${n.count}:${n.type}`).sort()).toEqual(["rating:1:number", "status:3:text", "tags:1:tags"]);
  expect(await index.values("status")).toEqual(["done", "draft"]);
  expect(await index.values("tags")).toEqual(["x"]); // the vault's tags, from the tag reader
  // Nothing changed: nothing is asked again.
  await index.notes();
  expect(properties).toHaveBeenCalledTimes(1);
});

it("reads again only the note that changed (its modified time moved: a save or vault-changed)", async () => {
  const index = propertyIndex(ws as never);
  await index.notes();
  DISK["b.md"] = "---\nstatus: active\nowner: me\n---";
  files[1].mtime_ms = 2;
  properties.mockClear();
  const notes = await index.notes();
  expect(properties).toHaveBeenCalledTimes(1);
  expect(properties).toHaveBeenCalledWith(["b.md"]);
  expect(notes.get("b.md")!.props.map((p) => `${p.key}=${p.value}`)).toEqual(["status=active", "owner=me"]);
  expect(notes.get("a.md")!.props.length).toBe(2);
});

it("takes a note open in an editor from the editor, unsaved edits included", async () => {
  const index = propertyIndex(ws as never);
  await index.notes();
  open.set("c.md", Text.of(["---", "status: typing", "---", "body"]));
  properties.mockClear();
  const notes = await index.notes();
  expect(properties).not.toHaveBeenCalled();
  expect(notes.get("c.md")!.props.map((p) => `${p.key}=${p.value}`)).toEqual(["status=typing"]);
  expect(await index.values("status")).toEqual(["active", "draft", "typing"]);
  open.clear();
});

it("keeps the complete typed API entry and caches omitted/unreadable notes too", async () => {
  const entry: NoteProperties = { props: [{ key: "items", type: "list", value: ["one", "two"], line: 2, count: 4 }], lines: ["# comment", "", "items:", "  - one", "", "  - two"] };
  properties.mockResolvedValueOnce({ "a.md": entry });
  const index = propertyIndex(ws as never);
  const notes = await index.notes();
  expect(notes.get("a.md")).toBe(entry);
  expect(notes.has("d.md")).toBe(false);
  expect((await index.notes()).get("a.md")?.props[0]).toEqual(entry.props[0]);
  expect(properties).toHaveBeenCalledTimes(1);
});

it("open editor properties override a saved response that arrives while the note loads", async () => {
  let release!: (value: Record<string, NoteProperties>) => void;
  properties.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const index = propertyIndex(ws as never), reading = index.notes();
  open.set("a.md", Text.of(["---", "status: unsaved", "---"]));
  release({ "a.md": { props: [{ key: "status", type: "text", value: "saved", line: 0, count: 1 }], lines: ["status: saved"] } });
  expect((await reading).get("a.md")?.props[0].value).toBe("unsaved");
  open.clear();
});
