// Differential fuzz input for K7. Fixed seed. Default run is short enough for npm test
// and cargo test. K7_FUZZ_CASES adds random cases; K7_FUZZ_HUGE_BYTES grows the huge note.
// `node --experimental-strip-types scripts/fuzz-property-edit.mjs [--json]`
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]s$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // Fall through and report the original specifier.
      }
    }
    return nextResolve(specifier, context);
  },
});
const { editProperty } = await import("../src/editor/propertyEdit.ts");

const SEED = 0x6b37;
const count = Number(process.env.K7_FUZZ_CASES || 48);
const hugeBytes = Number(process.env.K7_FUZZ_HUGE_BYTES || 1048576);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, xs) => xs[Math.floor(rng() * xs.length)];

function doc(lines, { bom = false, crlf = false, body }) {
  const e = crlf ? "\r\n" : "\n";
  return `${bom ? "\uFEFF" : ""}---${e}${lines.join(e)}${e}---${e}${body}`;
}

function typed(type, value) {
  return { type, value };
}

const forced = [
  {
    name: "plain",
    input: doc(["status: todo", "keep: same"], { body: "K7BODY-plain\n" }),
    edit: { key: "status", expect: "status: todo", to: typed("text", "doing") },
    keep: true,
  },
  {
    name: "bom",
    input: doc(["status: todo", "keep: same"], { bom: true, body: "K7BODY-bom\n" }),
    edit: { key: "status", expect: "status: todo", to: typed("text", "doing") },
    keep: true,
  },
  {
    name: "crlf",
    input: doc(["status: todo", "keep: same"], { crlf: true, body: "K7BODY-crlf\n" }),
    edit: { key: "status", expect: "status: todo", to: typed("text", "doing") },
    keep: true,
  },
  {
    name: "bom-crlf",
    input: doc(["title: hello", "keep: same"], { bom: true, crlf: true, body: "K7BODY-bom-crlf" }),
    edit: { key: "title", expect: "title: hello", to: typed("text", "héllo 🌟") },
    keep: true,
  },
  {
    name: "single-quotes",
    input: doc(["title: 'it''s'", "keep: same"], { body: "K7BODY-single\n" }),
    edit: { key: "title", expect: "title: 'it''s'", to: typed("text", "it's fine") },
    keep: true,
  },
  {
    name: "double-quotes",
    input: doc(['title: "say \\"hi\\""', "keep: same"], { body: "K7BODY-double\n" }),
    edit: { key: "title", expect: 'title: "say \\"hi\\""', to: typed("text", "say \"bye\"") },
    keep: true,
  },
  {
    name: "quoted-key",
    input: doc(['"weird key": todo', "keep: same"], { body: "K7BODY-qkey\n" }),
    edit: { key: "weird key", expect: '"weird key": todo', to: typed("text", "doing") },
    keep: true,
  },
  {
    name: "flow-list",
    input: doc(["tags: [a, b]", "keep: same"], { body: "K7BODY-flow\n" }),
    edit: { key: "tags", expect: "tags: [a, b]", to: typed("tags", ["a", "b, c"]) },
    keep: true,
  },
  {
    name: "block-list",
    input: doc(["tags:", "  - a", "  - b", "keep: same"], { body: "K7BODY-block\n" }),
    edit: { key: "tags", expect: "tags:\n  - a\n  - b", to: typed("tags", ["a", "c"]) },
    keep: true,
  },
  {
    name: "comment-between",
    input: doc(["status: todo", "# leave this", "", "keep: same"], { body: "K7BODY-comment\n" }),
    edit: { key: "status", expect: "status: todo", to: typed("text", "doing") },
    keep: true,
  },
  {
    name: "comment-in-value",
    input: doc(["status: todo # later", "keep: same"], { body: "K7BODY-hash\n" }),
    edit: { key: "status", expect: "status: todo # later", to: typed("text", "doing") },
    keep: true,
  },
  {
    name: "duplicate-keys",
    input: doc(["status: todo", "status: doing", "keep: same"], { body: "K7BODY-dup\n" }),
    edit: { key: "status", expect: "status: todo", to: typed("text", "later") },
    keep: true,
  },
  {
    name: "number",
    input: doc(["priority: 1", "keep: same"], { body: "K7BODY-num\n" }),
    edit: { key: "priority", expect: "priority: 1", to: typed("number", "3") },
    keep: true,
  },
  {
    name: "number-refused",
    input: doc(["priority: 1", "keep: same"], { body: "K7BODY-num-no\n" }),
    edit: { key: "priority", expect: "priority: 1", to: typed("number", "doing") },
    keep: true,
  },
  {
    name: "checkbox",
    input: doc(["done: false", "keep: same"], { body: "K7BODY-check\n" }),
    edit: { key: "done", expect: "done: false", to: typed("checkbox", true) },
    keep: true,
  },
  {
    name: "date",
    input: doc(["due: 2026-11-03", "keep: same"], { body: "K7BODY-date\n" }),
    edit: { key: "due", expect: "due: 2026-11-03", to: typed("date", "2026-12-01") },
    keep: true,
  },
  {
    name: "empty-scalar",
    input: doc(["status:", "keep: same"], { body: "K7BODY-empty\n" }),
    edit: { key: "status", expect: "status:", to: typed("text", "todo") },
    keep: true,
  },
  {
    name: "missing-key",
    input: doc(["keep: same"], { body: "K7BODY-missing\n" }),
    edit: { key: "status", expect: null, to: typed("text", "todo") },
    keep: true,
  },
  {
    name: "no-frontmatter",
    input: "K7BODY-nofm\n",
    edit: { key: "status", expect: null, to: typed("text", "todo") },
    keep: false,
  },
  {
    name: "no-final-newline",
    input: doc(["status: todo", "keep: same"], { body: "K7BODY-nonewline" }),
    edit: { key: "status", expect: "status: todo", to: typed("text", "doing") },
    keep: true,
  },
  {
    name: "conflict",
    input: doc(["status: todo", "keep: same"], { body: "K7BODY-conflict\n" }),
    edit: { key: "status", expect: "status: doing", to: typed("text", "later") },
    keep: true,
  },
  {
    name: "unchanged",
    input: doc(["status: todo", "keep: same"], { body: "K7BODY-same\n" }),
    edit: { key: "status", expect: "status: todo", to: typed("text", "todo") },
    keep: true,
  },
  {
    name: "remove",
    input: doc(["status: todo", "keep: same"], { body: "K7BODY-remove\n" }),
    edit: { key: "status", expect: "status: todo", to: null },
    keep: true,
  },
  {
    name: "list-to-empty",
    input: doc(["tags: [a]", "keep: same"], { body: "K7BODY-empty-list\n" }),
    edit: { key: "tags", expect: "tags: [a]", to: typed("list", []) },
    keep: true,
  },
  {
    name: "raw-lines",
    input: doc(["status: todo", "keep: same"], { body: "K7BODY-lines\n" }),
    edit: { key: "status", expect: "status: todo", to: { lines: "status: 'doing'" } },
    keep: true,
  },
  {
    name: "huge",
    input: doc(["status: todo", "keep: same"], { body: `K7BODY-huge\n${"x".repeat(hugeBytes)}` }),
    edit: { key: "status", expect: "status: todo", to: typed("text", "doing") },
    keep: true,
  },
];

function randomCase(rng, i) {
  const crlf = rng() < 0.45;
  const bom = rng() < 0.3;
  const marker = `K7BODY-r${i}`;
  const kind = pick(rng, ["text", "flow", "block", "number", "check", "date", "between", "dup", "hash", "conflict", "remove", "same", "missing"]);
  const keep = true;
  const lines = [];
  if (kind === "between") lines.push("status: todo", "# leave this", "keep: same");
  else if (kind === "dup") lines.push("status: one", "Status: two", "keep: same");
  else if (kind === "hash") lines.push("status: todo # no", "keep: same");
  else if (kind === "flow") lines.push("tags: [a, b]", "keep: same");
  else if (kind === "block") lines.push("tags:", "  - a", "  - b", "keep: same");
  else if (kind === "number") lines.push("priority: 2", "keep: same");
  else if (kind === "check") lines.push("done: false", "keep: same");
  else if (kind === "date") lines.push("due: 2026-01-02", "keep: same");
  else if (kind === "missing") lines.push("keep: same");
  else lines.push(`status: ${pick(rng, ["todo", "doing", "later"])}`, "keep: same");
  const input = doc(lines, { bom, crlf, body: `${marker}\n` });
  let edit;
  if (kind === "flow" || kind === "block") edit = { key: "tags", expect: kind === "flow" ? "tags: [a, b]" : "tags:\n  - a\n  - b", to: typed("tags", ["c", "d"]) };
  else if (kind === "number") edit = { key: "priority", expect: "priority: 2", to: typed("number", "9") };
  else if (kind === "check") edit = { key: "done", expect: "done: false", to: typed("checkbox", true) };
  else if (kind === "date") edit = { key: "due", expect: "due: 2026-01-02", to: typed("date", "2026-02-02") };
  else if (kind === "missing") edit = { key: "status", expect: null, to: typed("text", "todo") };
  else if (kind === "dup") edit = { key: "status", expect: "status: one", to: typed("text", "later") };
  else if (kind === "hash") edit = { key: "status", expect: "status: todo # no", to: typed("text", "doing") };
  else if (kind === "conflict") edit = { key: "status", expect: "status: nope", to: typed("text", "later") };
  else if (kind === "remove") edit = { key: "status", expect: lines[0], to: null };
  else if (kind === "same") edit = { key: "status", expect: lines[0], to: typed("text", lines[0].slice("status: ".length)) };
  else if (kind === "between") edit = { key: "status", expect: "status: todo", to: typed("text", "doing") };
  else edit = { key: "status", expect: lines[0], to: typed("text", pick(rng, ["board", "it's fine", 'say "hi"', "a: b", "a # b", "[x]", "true", "2026-02-02", "héllo 🌟", "line\nbreak"])) };
  const expected = ["dup", "hash"].includes(kind) ? "refused" : kind === "same" ? "unchanged"
    : kind === "conflict" ? (lines[0] === "status: later" ? "unchanged" : "conflict") : "done";
  return { name: `rand-${i}-${kind}`, input, edit, keep, expected };
}

// Expected outcomes keep differential agreement from accepting two matching refusals.
const expected = { "comment-in-value": "refused", "duplicate-keys": "refused",
  "number-refused": "refused", conflict: "conflict", unchanged: "unchanged" };
for (const entry of forced) entry.expected = expected[entry.name] ?? "done";
forced.find(entry => entry.name === "huge").expected = new TextEncoder().encode(forced.find(entry => entry.name === "huge").input).length > 16 * 1024 * 1024 ? "refused" : "done";
forced.push({ name: "huge-frontmatter", input: doc(["status: todo", ...Array(2001).fill("# retained"), "keep: same"], { body: "K7BODY-lines\n" }),
  edit: { key: "status", expect: "status: todo", to: typed("text", "doing") }, keep: true, expected: "refused" });

const rng = mulberry32(SEED);
const extra = Math.max(0, count - forced.length);
const cases = [...forced, ...Array.from({ length: extra }, (_, i) => randomCase(rng, i))];

const report = cases.map(entry => {
  const result = editProperty(entry.input, entry.edit);
  if (result.status !== entry.expected || result.status === "done" && !result.change || result.status !== "done" && result.change) {
    throw new Error(`K7_FUZZ_FAIL ${entry.name} expected ${entry.expected}, got ${result.status} (change=${!!result.change})`);
  }
  const text = result.status === "done" && result.change
    ? entry.input.slice(0, result.change.from) + result.change.insert + entry.input.slice(result.change.to)
    : entry.input;
  if (result.status === "done" && result.before !== null) {
    const eol = entry.input.includes("\r\n") ? "\r\n" : "\n";
    const before = result.before.replaceAll("\n", eol), at = entry.input.indexOf(before);
    if (at < 0) throw new Error(`K7_FUZZ_FAIL ${entry.name} missing source span`);
    const after = result.after === null ? "" : result.after.replaceAll("\n", eol);
    const end = at + before.length + (result.after === null ? eol.length : 0);
    if (text !== entry.input.slice(0, at) + after + entry.input.slice(end)) {
      throw new Error(`K7_FUZZ_FAIL ${entry.name} changed bytes outside property`);
    }
  }
  const marker = entry.input.match(/K7BODY-\S+/)?.[0];
  if (!marker || text.split(marker).length !== 2 || !text.endsWith(entry.input.slice(entry.input.indexOf(marker)))) {
    console.error(`K7_FUZZ_FAIL ${entry.name} lost body marker`);
    process.exit(1);
  }
  if (text.startsWith("\uFEFF") !== entry.input.startsWith("\uFEFF")) {
    console.error(`K7_FUZZ_FAIL ${entry.name} BOM changed`);
    process.exit(1);
  }
  if (entry.keep && entry.input.includes("keep: same") && !text.includes(entry.input.match(/keep: same(?:\r?\n|$)/)[0])) {
    console.error(`K7_FUZZ_FAIL ${entry.name} rewrote a sibling property`);
    process.exit(1);
  }
  if (result.status !== "done" && text !== entry.input) {
    console.error(`K7_FUZZ_FAIL ${entry.name} changed text without a done edit`);
    process.exit(1);
  }
  return {
    name: entry.name,
    input: entry.input,
    edit: entry.edit,
    status: result.status,
    before: result.before ?? null,
    after: result.after ?? null,
    current: result.current ?? null,
    reason: result.reason ?? null,
    text,
  };
});

const counts = report.reduce((n, c) => {
  n[c.status] = (n[c.status] || 0) + 1;
  return n;
}, {});
console.error(`K7_FUZZ cases=${report.length} seed=${SEED} huge=${hugeBytes} ${JSON.stringify(counts)}`);
if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify({ seed: SEED, cases: report }));
}
