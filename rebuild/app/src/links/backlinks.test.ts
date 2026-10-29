import { beforeEach, expect, test, vi } from "vitest";
import { api, type Backlink } from "../api";
import type { Workspace } from "../workspace";
import { noteBacklinks } from "./backlinks";

vi.mock("../api", () => ({ api: { backlinks: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
const workspace = () => ({ vault: { files: [], links: { outgoing: {} } } }) as unknown as Workspace;

test("shares one targeted read for the status bar and pane until the file/link snapshot changes", async () => {
  const ws = workspace();
  vi.mocked(api.backlinks).mockResolvedValue({ "A.md": [{ from: "Source.md", line: 1, text: "[[A]]" }] });
  const read = noteBacklinks(ws), first = read("A.md");
  expect(read("A.md")).toBe(first);
  expect(await first).toHaveLength(1);
  expect(api.backlinks).toHaveBeenCalledExactlyOnceWith(["A.md"]);
  expect(await read("B.md")).toEqual([]);
  ws.vault.links = { outgoing: {} };
  await read("A.md");
  ws.vault.files = [];
  await read("A.md");
  expect(api.backlinks).toHaveBeenCalledTimes(4);
});

test("an old failed reply cannot evict a newer cached read", async () => {
  let reject!: (reason: unknown) => void;
  const old = new Promise<Record<string, Backlink[]>>((_resolve, no) => { reject = no; });
  vi.mocked(api.backlinks).mockReturnValueOnce(old).mockResolvedValue({});
  const ws = workspace(), read = noteBacklinks(ws);
  const first = read("A.md").catch(() => null);
  ws.vault.links = { outgoing: {} };
  const latest = read("A.md");
  await latest;
  reject(new Error("stale")); await first;
  expect(read("A.md")).toBe(latest);
  expect(api.backlinks).toHaveBeenCalledTimes(2);
});
