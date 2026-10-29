// The parity corpus (fixtures/parity/*.json, see its README): rules that
// TypeScript and Rust both implement, checked against the same cases. This
// runs the TypeScript side; src-tauri/src/index/parity.rs runs the Rust one.

import { describe, expect, test } from "vitest";
import { readProperties, splitFrontmatter } from "./editor/frontmatter";
import { tagsInText, wikilinkTargets } from "./shell/linksTags";

interface Case {
  name: string;
  input: string | string[];
  expected: unknown;
  rust?: "todo";
  ts?: "todo";
  obsidian?: unknown;
  note?: string;
}

interface Corpus {
  about: string;
  typescript: string;
  rust: string;
  cases: Case[];
}

/**
 * Properties as the corpus stores them. `line` and `count` are editor positions.
 * Null: no frontmatter, or a block `readProperties` will not place.
 */
function propertiesOf(input: string): { key: string; type: string; value: unknown }[] | null {
  const fm = splitFrontmatter(input);
  if (!fm) return null;
  const props = readProperties(fm.lines);
  if (!props) return null;
  return props.map(({ key, type, value }) => ({ key, type, value }));
}

/** The TypeScript function each corpus file checks, by file name. A new file needs an entry here (and in parity.rs). */
const RUNNERS: Record<string, (input: string) => unknown> = {
  tags: tagsInText,
  links: wikilinkTargets,
  properties: propertiesOf,
};

const KEYS = new Set(["name", "input", "expected", "rust", "ts", "obsidian", "note"]);
const FILE_KEYS = new Set(["about", "typescript", "rust", "cases"]);

const files = import.meta.glob<Corpus>("../fixtures/parity/*.json", { eager: true, import: "default" });
const corpora = Object.entries(files).map(([path, corpus]) => [path.replace(/^.*\/|\.json$/g, ""), corpus] as const);

test("every corpus file has a runner, and every runner a file", () => {
  expect(corpora.map(([name]) => name).sort()).toEqual(Object.keys(RUNNERS).sort());
});

for (const [file, corpus] of corpora) {
  describe(`parity: ${file}.json`, () => {
    test("is well-formed", () => {
      expect(Object.keys(corpus).filter((k) => !FILE_KEYS.has(k))).toEqual([]);
      for (const key of ["about", "typescript", "rust"] as const) expect(typeof corpus[key], key).toBe("string");
      const names = corpus.cases.map((c) => c.name);
      expect(names.filter((n, i) => names.indexOf(n) !== i), "duplicate names").toEqual([]);
      for (const c of corpus.cases) {
        expect(Object.keys(c).filter((k) => !KEYS.has(k)), c.name).toEqual([]);
        expect(typeof c.input === "string" || (Array.isArray(c.input) && c.input.every((l) => typeof l === "string")), c.name).toBe(true);
        expect("expected" in c, c.name).toBe(true);
        for (const marker of [c.rust, c.ts]) expect(marker === undefined || marker === "todo", c.name).toBe(true);
      }
    });

    const run = RUNNERS[file];
    if (!run) return;
    for (const c of corpus.cases) {
      test(c.name, () => {
        const actual = run(Array.isArray(c.input) ? c.input.join("\n") : c.input);
        if (c.ts === "todo") expect(actual, 'now matches: remove its "ts": "todo"').not.toEqual(c.expected);
        else expect(actual).toEqual(c.expected);
      });
    }
  });
}
