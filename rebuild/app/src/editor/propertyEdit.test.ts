import { afterEach, expect, it, vi } from "vitest";
import { editProperty, type EditResult, type PropertyEdit } from "./propertyEdit";
import { readProperties, splitFrontmatter } from "./frontmatter";
import { createMockBackend } from "../mock/backend";
const apply = (text: string, edit: PropertyEdit) => {
  const result = editProperty(text, edit);
  return { result, text: result.change ? text.slice(0, result.change.from) + result.change.insert + text.slice(result.change.to) : text };
};
afterEach(() => vi.unstubAllGlobals());
it("changes one property of the current buffer and leaves unsaved text intact, in UTF-16 offsets", () => {
  const text = '\uFEFF---\n# 🌻\nstatus: todo\nother: "unusual"\n---\nunsaved 🌻 body\n';
  const edit: PropertyEdit = { key: "status", expect: "status: todo", to: { type: "text", value: "doing" } };
  const updated = apply(text, edit);
  expect(updated.text).toBe(text.replace("status: todo", "status: doing"));
  expect(updated.result).toMatchObject({ status: "done", before: "status: todo", after: "status: doing", mtime_ms: 0 });
  expect(apply(updated.text, edit).result.status).toBe("unchanged");
  expect(apply(text.replace("status: todo", "status: review"), edit).result).toEqual({ status: "conflict", current: "status: review" });
  const fm = splitFrontmatter(updated.text)!;
  expect(updated.result.status === "done" && updated.result.props).toEqual({ props: readProperties(fm.lines), lines: fm.lines });
});
it("undo restores exact property lines, and a missing empty raw property is restored", () => {
  const text = '---\ntags: ["true", old]\n---\nbody';
  const forward = apply(text, { key: "tags", expect: 'tags: ["true", old]', to: { type: "tags", value: ["new"] } });
  expect(forward.result.status).toBe("done");
  if (forward.result.status !== "done") return;
  const undone = apply(forward.text, { key: "tags", expect: forward.result.after, to: { lines: forward.result.before! } });
  expect(undone.text).toBe(text);
  expect(apply("body", { key: "status", expect: null, to: { lines: "status:" } }).text).toBe("---\nstatus:\n---\nbody");
});
it("refuses unsafe raw restoration and does not silently change a fixed type", () => {
  for (const to of [{ lines: "status: a\nother: b" }, { lines: "status: a # comment" }, { type: "text" as const, value: "x" }]) {
    const key = "lines" in to ? "status" : "tags";
    const text = `---\n${key}: old\n---\nbody`;
    expect(apply(text, { key, expect: `${key}: old`, to }).result).toMatchObject({ status: "refused" });
  }
});
it("caps UTF-8 input and output and refuses invalid edit shapes without throwing", () => {
  expect(editProperty("界".repeat(6_000_000), { key: "x", expect: null, to: null }).status).toBe("refused");
  expect(editProperty("body", { key: "x", expect: null, to: { type: "text", value: "x".repeat(17 * 1024 * 1024) } }).status).toBe("refused");
  for (const edit of [null, {}, { key: "\nx", expect: null, to: null }]) expect(editProperty("body", edit as PropertyEdit).status).toBe("refused");
});
it("the mock uses CAS, dry-run and fresh contents, and returns updated metadata without text", async () => {
  vi.stubGlobal("location", { search: "" });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => {} });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  const { invoke } = createMockBackend(), path = "K2/Note.MD", initial = "\uFEFF---\r\nstatus: todo\r\n---\r\nbody";
  await invoke("create_note", { path, content: initial });
  const edit: PropertyEdit = { key: "status", expect: "status: todo", to: { type: "text", value: "doing" } };
  const dry = await invoke<EditResult>("set_property", { path, edit, dryRun: true });
  expect(dry.status).toBe("done"); expect(dry).not.toHaveProperty("change");
  expect(await invoke("read_note", { path })).toBe(initial);
  await invoke("write_note", { path, content: initial + " fresh" });
  const done = await invoke<EditResult>("set_property", { path, edit });
  expect(done).toMatchObject({ status: "done", before: "status: todo", after: "status: doing" });
  expect(await invoke("read_note", { path })).toBe(initial.replace("todo", "doing") + " fresh");
  expect((await invoke<EditResult>("set_property", { path, edit })).status).toBe("unchanged");
  expect((await invoke<EditResult>("set_property", { path, edit: { ...edit, to: { type: "text", value: "review" } } })).status).toBe("conflict");
  for (const bad of ["../No.md", ".grove/No.md", "Missing.md", "No.txt"]) expect(await invoke("set_property", { path: bad, edit })).toMatchObject({ status: "refused" });
});
