import { Text } from "@codemirror/state";
import { beforeEach, expect, it, vi } from "vitest";

const frontmatter = vi.fn<(paths?: string[]) => Promise<Record<string, string>>>();
vi.mock("../api", () => ({ api: { frontmatter: (paths?: string[]) => frontmatter(paths) } }));
vi.mock("../perWorkspace", () => ({ perWorkspace: <T>(create: (ws: unknown) => T) => create }));
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
  frontmatter.mockReset();
  frontmatter.mockImplementation(async (paths) => Object.fromEntries(Object.entries(DISK).filter(([p]) => !paths || paths.includes(p))));
});

it("reads nothing until asked, then the whole vault's frontmatter in one call", async () => {
  const index = propertyIndex(ws as never);
  expect(frontmatter).not.toHaveBeenCalled();
  const names = await index.names();
  expect(frontmatter).toHaveBeenCalledTimes(1);
  expect(frontmatter).toHaveBeenCalledWith(undefined);
  expect(names.map((n) => `${n.key}:${n.count}:${n.type}`).sort()).toEqual(["rating:1:number", "status:3:text", "tags:1:tags"]);
  expect(await index.values("status")).toEqual(["done", "draft"]);
  expect(await index.values("tags")).toEqual(["x"]); // the vault's tags, from the tag reader
  // Nothing changed: nothing is asked again.
  await index.notes();
  expect(frontmatter).toHaveBeenCalledTimes(1);
});

it("reads again only the note that changed (its modified time moved: a save or vault-changed)", async () => {
  const index = propertyIndex(ws as never);
  await index.notes();
  DISK["b.md"] = "---\nstatus: active\nowner: me\n---";
  files[1].mtime_ms = 2;
  frontmatter.mockClear();
  const notes = await index.notes();
  expect(frontmatter).toHaveBeenCalledTimes(1);
  expect(frontmatter).toHaveBeenCalledWith(["b.md"]);
  expect(notes.get("b.md")!.props.map((p) => `${p.key}=${p.value}`)).toEqual(["status=active", "owner=me"]);
  expect(notes.get("a.md")!.props.length).toBe(2);
});

it("takes a note open in an editor from the editor, unsaved edits included", async () => {
  const index = propertyIndex(ws as never);
  await index.notes();
  open.set("c.md", Text.of(["---", "status: typing", "---", "body"]));
  frontmatter.mockClear();
  const notes = await index.notes();
  expect(frontmatter).not.toHaveBeenCalled();
  expect(notes.get("c.md")!.props.map((p) => `${p.key}=${p.value}`)).toEqual(["status=typing"]);
  expect(await index.values("status")).toEqual(["active", "draft", "typing"]);
  open.clear();
});
