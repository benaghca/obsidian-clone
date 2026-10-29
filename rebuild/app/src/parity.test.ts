// The parity corpus (fixtures/parity/*.json, see its README): rules that
// TypeScript and Rust both implement, checked against the same cases. This
// runs the TypeScript side; src-tauri/src/index/parity.rs runs the Rust one.

import { describe, expect, test } from "vitest";
import { readProperties, splitFrontmatter } from "./editor/frontmatter";
import { tagsInText, wikilinkTargets } from "./shell/linksTags";
import { parseQuery } from "./shell/searchQuery";
import { searchVault } from "./shell/searchVault";

interface Case {
  name: string;
  input: string | string[];
  expected: unknown;
  rust?: "todo";
  ts?: "todo";
  obsidian?: unknown;
  note?: string;
  /** Search only. Names a vault in the file's `vaults`. */
  vault?: string;
  /** Both query and search. Default false when omitted. */
  matchCase?: boolean;
}

interface Corpus {
  about: string;
  typescript: string;
  rust: string;
  cases: Case[];
  /** Search only: name → path → text, or lines joined with `\n`. */
  vaults?: Record<string, Record<string, string | string[]>>;
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

/** Join a vault's line arrays. A string is kept as written, so `\r\n` survives. */
function vaultFiles(corpus: Corpus, name: string): Record<string, string> {
  const spec = corpus.vaults?.[name];
  if (!spec) throw new Error(`unknown vault ${name}`);
  const files: Record<string, string> = {};
  for (const [path, text] of Object.entries(spec)) files[path] = Array.isArray(text) ? text.join("\n") : text;
  return files;
}

/** The TypeScript function each corpus file checks, by file name. A new file needs an entry here (and in parity.rs). */
const RUNNERS: Record<string, (input: string, c: Case, corpus: Corpus) => unknown> = {
  tags: (input) => tagsInText(input),
  links: (input) => wikilinkTargets(input),
  properties: (input) => propertiesOf(input),
  query: (input, c) => parseQuery(input, c.matchCase === true),
  search: (input, c, corpus) => searchVault(vaultFiles(corpus, c.vault!), input, c.matchCase === true),
};

const KEYS = new Set(["name", "input", "expected", "rust", "ts", "obsidian", "note", "vault", "matchCase"]);
const FILE_KEYS = new Set(["about", "typescript", "rust", "cases", "vaults"]);

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
      if (corpus.vaults !== undefined) {
        expect(corpus.vaults !== null && typeof corpus.vaults === "object" && !Array.isArray(corpus.vaults), "vaults").toBe(true);
        for (const [name, spec] of Object.entries(corpus.vaults)) {
          expect(spec !== null && typeof spec === "object" && !Array.isArray(spec), name).toBe(true);
          for (const [path, text] of Object.entries(spec)) {
            const ok = typeof text === "string" || (Array.isArray(text) && text.every((line) => typeof line === "string"));
            expect(ok, `${name} ${path}`).toBe(true);
          }
        }
      }
      const names = corpus.cases.map((c) => c.name);
      expect(names.filter((n, i) => names.indexOf(n) !== i), "duplicate names").toEqual([]);
      for (const c of corpus.cases) {
        expect(Object.keys(c).filter((k) => !KEYS.has(k)), c.name).toEqual([]);
        expect(typeof c.input === "string" || (Array.isArray(c.input) && c.input.every((l) => typeof l === "string")), c.name).toBe(true);
        expect("expected" in c, c.name).toBe(true);
        for (const marker of [c.rust, c.ts]) expect(marker === undefined || marker === "todo", c.name).toBe(true);
        if ("matchCase" in c) expect(typeof c.matchCase, c.name).toBe("boolean");
        if (file === "search" || "vault" in c) expect(typeof c.vault === "string" && !!corpus.vaults?.[c.vault], `${c.name} vault`).toBe(true);
      }
    });

    const run = RUNNERS[file];
    if (!run) return;
    for (const c of corpus.cases) {
      test(c.name, () => {
        const actual = run(Array.isArray(c.input) ? c.input.join("\n") : c.input, c, corpus);
        if (c.ts === "todo") expect(actual, 'now matches: remove its "ts": "todo"').not.toEqual(c.expected);
        else expect(actual).toEqual(c.expected);
      });
    }
  });
}
