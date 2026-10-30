import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { baseBlockChange, baseBlockYaml } from "../editor/embeds";
import { baseModel, type Row } from "./model";

function row(path: string, status?: string, tags: string[] = []): Row {
  const name = path.replace(/^.*\//, "").replace(/\.md$/, "");
  return { file: { path, name, is_dir: false, mtime_ms: 1, ctime_ms: 1, size: 1 }, props: status === undefined ? [] : [{ key: "status", type: "text", value: status, line: 0, count: 1 }], tags, hasLink: () => false };
}
const names = (base: ReturnType<typeof baseModel>, rows: Row[]) => base.select(rows).map(r => r.row.file.name);

describe("a ```base block's YAML", () => {
  it("is the text between the fences, for a base block only", () => {
    expect(baseBlockYaml("```base\nviews:\n  - type: table\n```")).toBe("views:\n  - type: table\n");
    expect(baseBlockYaml("~~~~base \nfilters: 'x'\n~~~~~")).toBe("filters: 'x'\n");
    // A shorter or other fence doesn't close it: the block runs to the note's end.
    expect(baseBlockYaml("````base\na: 1\n```")).toBe("a: 1\n```\n");
    expect(baseBlockYaml("```base\na: 1")).toBe("a: 1\n");
    expect(baseBlockYaml("```base\n```")).toBe("");
    for (const other of ["```yaml\na: 1\n```", "```basex\n```", "```\n```", "    ```base\n```"]) expect(baseBlockYaml(other)).toBeNull();
  });
  it("is written back in place, the fences and the rest of the note kept", () => {
    const apply = (text: string, at: number, yaml: string) => {
      const doc = Text.of(text.split("\n")), change = baseBlockChange(doc, at, yaml);
      return change && doc.replace(change.from, change.to, Text.of(change.insert.split("\n"))).toString();
    };
    const note = "Intro\n```base\nviews: []\n```\nAfter";
    expect(apply(note, 6, "views:\n  - name: A\n")).toBe("Intro\n```base\nviews:\n  - name: A\n```\nAfter");
    expect(apply("```base\nold: 1", 0, "new: 2\n")).toBe("```base\nnew: 2");
    expect(apply("```base", 0, "new: 2\n")).toBe("```base\nnew: 2");
    expect(apply("```base\n```", 0, "a: 1\n")).toBe("```base\na: 1\n```");
    expect(apply(note, 0, "a: 1\n")).toBeNull();
  });
  it("removes only the opening fence's indentation and restores it on writes", () => {
    for (const indent of [" ", "  ", "   "]) {
      const source = `${indent}~~~~base\n${indent}views:\n${indent}  - type: table\n${indent}~~~~~`;
      expect(baseBlockYaml(source)).toBe("views:\n  - type: table\n");
      expect(baseBlockYaml(`${indent}~~~base\n x: 1\n${indent}~~~`)).toBe("x: 1\n");
      const doc = Text.of(["Intro", ...source.split("\n"), "After"]);
      const change = baseBlockChange(doc, 6, "views:\n  - name: New\n")!;
      const next = doc.replace(change.from, change.to, Text.of(change.insert.split("\n"))).toString();
      expect(next).toBe(`Intro\n${indent}~~~~base\n${indent}views:\n${indent}  - name: New\n${indent}~~~~~\nAfter`);
    }
  });
  it("keeps mixed fence/content indentation, blank spaces and the closing fence intact", () => {
    const source = "   ```base\n# retained\n  \nviews:\n     - name: Old\n   ```\nAfter";
    const doc = Text.of(source.split("\n"));
    const change = baseBlockChange(doc, 0, "# retained\n\nviews:\n  - name: New")!;
    expect(doc.replace(change.from, change.to, Text.of(change.insert.split("\n"))).toString()).toBe(source.replace("name: Old", "name: New"));
  });
});

describe("`this` in a base", () => {
  const rows = [row("T/A.md", "open", ["#work"]), row("T/B.md", "done"), row("T/C.md", "open")];
  const hosted = (host: Row) => rows.map(r => ({ ...r, host }));
  it("reads the note the base is drawn in", () => {
    const base = baseModel(`filters: 'status == this.status'\n`);
    expect(names(base, hosted(row("Host.md", "done")))).toEqual(["B"]);
    expect(names(base, hosted(row("Host.md", "open")))).toEqual(["A", "C"]);
    expect(names(baseModel(`filters: 'file.name != this.file.name'\n`), hosted(rows[0]))).toEqual(["B", "C"]);
    expect(names(baseModel(`filters: 'this.file.hasTag("work")'\n`), hosted(rows[0]))).toEqual(["A", "B", "C"]);
  });
  it("works out the host's formulas once, from the host", () => {
    const base = baseModel(`formulas:\n  loud: 'status.upper()'\nfilters: 'status.upper() == this.formula.loud'\n`);
    expect(names(base, hosted(row("Host.md", "open")))).toEqual(["A", "C"]);
  });
  it("is null without a host, so a filter on it matches nothing", () => {
    expect(names(baseModel(`filters: 'status == this.status'\n`), rows)).toEqual([]);
    expect(names(baseModel(`filters: 'this == null'\n`), rows)).toEqual(["A", "B", "C"]);
  });
});
