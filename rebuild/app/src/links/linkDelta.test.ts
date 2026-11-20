import { describe, expect, it } from "vitest";
import type { LinkIndex } from "../api";
import { byCodePoint, type LinkChanges, type LinkEntry, linkReader, patchLinks } from "./linkDelta";

type Field = "outgoing" | "markdown" | "unresolved";
const FIELDS: Field[] = ["outgoing", "markdown", "unresolved"];

/** xorshift32, so a failure names its seed. */
function rng(seed: number) {
  let x = seed || 1;
  return (n: number) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) % n;
  };
}

const encoder = new TextEncoder();
/** UTF-8 byte order: how the backend's BTreeMap sorts paths. */
function byBytes(a: string, b: string): number {
  const x = encoder.encode(a), y = encoder.encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}
const PIECES = ["a", "B", "z", "é", "日", "\u{e000}", "\u{ffff}", "😀", "\u{10400}", " ", "/", "-", "Ä"];
const PATHS = Array.from({ length: 40 }, (_, i) => {
  const r = rng(i + 1);
  let s = "";
  for (let j = 0; j < 1 + r(4); j++) s += PIECES[r(PIECES.length)];
  return `${s}${i % 3 ? "/" : ""}${i}.md`;
});

/** A backend-shaped index: each map sorted by path in byte order, empty lists left out. */
function snapshot(entries: Map<string, Required<LinkEntry>>): LinkIndex {
  const out: LinkIndex = { outgoing: {}, markdown: {}, unresolved: {} };
  const paths = [...entries.keys()].sort(byBytes);
  for (const path of paths) for (const field of FIELDS) {
    const list = entries.get(path)![field];
    if (list.length) out[field]![path] = list;
  }
  return out;
}

function randomEntries(r: (n: number) => number, prev: Map<string, Required<LinkEntry>>): Map<string, Required<LinkEntry>> {
  const next = new Map(prev);
  for (let k = 0; k < 1 + r(6); k++) {
    const path = PATHS[r(PATHS.length)]!;
    if (r(4) === 0) next.delete(path);
    else {
      const list = () => Array.from({ length: r(3) }, () => PATHS[r(PATHS.length)]!);
      const keep = next.get(path);
      next.set(path, {
        outgoing: keep && r(2) ? keep.outgoing : list(),
        markdown: keep && r(2) ? keep.markdown : list(),
        unresolved: keep && r(2) ? keep.unresolved : list().map((p) => p.slice(0, -3)),
      });
    }
  }
  return next;
}

/** What the backend sends: every path whose entry differs, with its whole new entry. */
function delta(prev: Map<string, Required<LinkEntry>>, next: Map<string, Required<LinkEntry>>): Record<string, LinkEntry> {
  const out: Record<string, LinkEntry> = {};
  for (const path of new Set([...prev.keys(), ...next.keys()])) {
    const a = prev.get(path), b = next.get(path);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const entry: LinkEntry = {};
    for (const field of FIELDS) if (b?.[field].length) entry[field] = b[field];
    out[path] = entry;
  }
  return out;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe("byCodePoint", () => {
  it("orders strings as UTF-8 bytes do (the backend's path order)", () => {
    const r = rng(7);
    for (let i = 0; i < 2000; i++) {
      const a = PIECES.slice(0, 1 + r(4)).map(() => PIECES[r(PIECES.length)]).join("");
      const b = PIECES.slice(0, 1 + r(4)).map(() => PIECES[r(PIECES.length)]).join("");
      expect(Math.sign(byCodePoint(a, b)), `${a} vs ${b}`).toBe(Math.sign(byBytes(a, b)));
    }
  });
});

describe("patchLinks", () => {
  it("equals the full reply, key order included, after random changes", () => {
    for (const seed of [1, 2, 3, 42, 1234]) {
      const r = rng(seed);
      let entries = new Map<string, Required<LinkEntry>>();
      let links = snapshot(entries);
      for (let step = 0; step < 200; step++) {
        const next = randomEntries(r, entries);
        const base = deepFreeze(links);
        const patched = patchLinks(base, delta(entries, next));
        const full = snapshot(next);
        expect(JSON.stringify(patched), `seed ${seed} step ${step}`).toBe(JSON.stringify(full));
        for (const field of FIELDS) expect(Object.keys(patched[field]!)).toEqual(Object.keys(full[field]!));
        entries = next;
        links = patched;
      }
    }
  });

  it("shares maps no changed note touches, and always returns a new object", () => {
    const base: LinkIndex = { outgoing: { "a.md": ["b.md"] }, markdown: { "a.md": ["c.png"] }, unresolved: {} };
    const same = patchLinks(base, { "a.md": { outgoing: ["b.md"], markdown: ["c.png"] } });
    expect(same).not.toBe(base);
    expect(same.outgoing).toBe(base.outgoing);
    expect(same.markdown).toBe(base.markdown);
    const next = patchLinks(base, { "a.md": { outgoing: ["b.md"], unresolved: ["x"] } });
    expect(next.outgoing).toBe(base.outgoing);
    expect(next.markdown).toEqual({});
    expect(next.unresolved).toEqual({ "a.md": ["x"] });
    expect(base).toEqual({ outgoing: { "a.md": ["b.md"] }, markdown: { "a.md": ["c.png"] }, unresolved: {} });
  });
});

/** A fake backend: a list of states, each a version; it answers like `link_changes`. */
function backend(id: number) {
  const states: Map<string, Required<LinkEntry>>[] = [new Map()];
  const asked: [number | null, number | null][] = [];
  return {
    states,
    asked,
    id,
    step(r: (n: number) => number) {
      states.push(randomEntries(r, states.at(-1)!));
    },
    ask(askedId: number | null, version: number | null): LinkChanges {
      asked.push([askedId, version]);
      const now = states.length - 1;
      if (askedId !== id || version === null || version > now) return { id, version: now, since: null, full: snapshot(states[now]!), changed: {} };
      return { id, version: now, since: version, full: null, changed: delta(states[version]!, states[now]!) };
    },
  };
}

describe("linkReader", () => {
  it("reads the whole index once, then only changes, and always matches a full read", async () => {
    const r = rng(9);
    const back = backend(5);
    const read = linkReader(async (id, version) => back.ask(id, version));
    for (let i = 0; i < 100; i++) {
      if (r(3)) back.step(r);
      const links = await read();
      expect(JSON.stringify(links)).toBe(JSON.stringify(snapshot(back.states.at(-1)!)));
    }
    expect(back.asked[0]).toEqual([null, null]);
    expect(back.asked.slice(1).every(([id]) => id === 5)).toBe(true);
  });

  it("patches each overlapping call from the base it asked with, and keeps the newest", async () => {
    const r = rng(11);
    const back = backend(1);
    type Waiting = { id: number | null; version: number | null; resolve: (reply: LinkChanges) => void };
    const waiting: Waiting[] = [];
    const read = linkReader((id, version) => new Promise((resolve) => waiting.push({ id, version, resolve })));
    const first = read();
    waiting.shift()!.resolve(back.ask(null, null));
    await first;
    for (let round = 0; round < 60; round++) {
      if (r(3)) back.step(r);
      const count = 1 + r(3);
      const reads = Array.from({ length: count }, () => read());
      const asked = waiting.splice(0);
      // The backend answers in one order, with changes landing between answers...
      const replies: { reply: LinkChanges; state: string }[] = [];
      for (const i of asked.map((_, i) => i).sort(() => r(3) - 1)) {
        replies[i] = { reply: back.ask(asked[i]!.id, asked[i]!.version), state: JSON.stringify(snapshot(back.states.at(-1)!)) };
        if (r(2)) back.step(r);
      }
      // ...and the replies reach the page in another.
      for (const i of asked.map((_, i) => i).sort(() => r(3) - 1)) {
        asked[i]!.resolve(replies[i]!.reply);
        await Promise.resolve();
        await Promise.resolve();
      }
      const got = await Promise.all(reads);
      got.forEach((links, i) => expect(JSON.stringify(links), `round ${round} call ${i}`).toBe(replies[i]!.state));
      // The next read starts from the newest kept base and is current.
      const next = read();
      const ask = waiting.shift()!;
      ask.resolve(back.ask(ask.id, ask.version));
      expect(JSON.stringify(await next)).toBe(JSON.stringify(snapshot(back.states.at(-1)!)));
    }
    // Every call after the first asked with a base.
    expect(back.asked.slice(1).every(([id, version]) => id === 1 && version !== null)).toBe(true);
  });

  it("starts over on another index id, and never keeps an older call's other index", async () => {
    let back = backend(1);
    const r = rng(3);
    back.step(r);
    let answer: (id: number | null, version: number | null) => Promise<LinkChanges> = async (id, version) => back.ask(id, version);
    const read = linkReader((id, version) => answer(id, version));
    await read();
    back.step(r);
    await read();
    // Another vault: a new id, a full reply.
    back = backend(2);
    back.step(r);
    expect(JSON.stringify(await read())).toBe(JSON.stringify(snapshot(back.states.at(-1)!)));
    expect(back.asked[0]![0]).toBe(1);
    back.step(r);
    await read();
    expect(back.asked.at(-1)).toEqual([2, 1]);
    // A reply that is neither full nor relative to what was asked: read in full again.
    let bad = true;
    answer = async (id, version) => {
      if (bad) {
        bad = false;
        return { id: 2, version: 9, since: 7, full: null, changed: {} };
      }
      return back.ask(id, version);
    };
    expect(JSON.stringify(await read())).toBe(JSON.stringify(snapshot(back.states.at(-1)!)));
  });
});
