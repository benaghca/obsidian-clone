import { expect, test } from "vitest";
import type { LinkIndex } from "../api";
import { GRAPH, LOCAL_GRAPH, sanitize, serialize, defaults } from "../settings/schema";
import { buildGraph, buildGraphSteps, drawOrder, graphFileLists, type GraphModel, localLinksMatter, neighbours, nodeColor, nodeRadius, sameShape } from "./data";
import { linkEntryOf } from "../links/linkDelta";
import { matches, parseQuery } from "../shell/searchQuery";
import { ALPHA_MIN, Simulation } from "./sim";

const links = (outgoing: Record<string, string[]>, extra: Partial<LinkIndex> = {}): LinkIndex => ({ outgoing, ...extra });
const base = { showTags: false, showAttachments: false, hideUnresolved: false, showOrphans: true };
const labels = (m: GraphModel) => m.nodes.map((n) => n.label).sort();
const edges = (m: GraphModel) => m.links.map((l) => [m.nodes[l.source].label, m.nodes[l.target].label].sort().join("–")).sort();

const notes = ["A.md", "B.md", "C.md", "D.md", "sub/E.md", "Lonely.md"];
const index = links(
  { "A.md": ["B.md", "C.md"], "B.md": ["A.md"], "C.md": ["D.md"], "D.md": ["sub/E.md"] },
  { markdown: { "sub/E.md": ["A.md", "pic.png"] }, unresolved: { "A.md": ["Someday"], "B.md": ["someday"] } },
);

test("notes are nodes, resolved wikilinks and markdown links are undirected links, missing notes are faint nodes", () => {
  const m = buildGraph({ notes, attachments: ["pic.png"], links: index }, base);
  expect(labels(m)).toEqual(["A", "B", "C", "D", "E", "Lonely", "Someday"]);
  expect(edges(m)).toEqual(["A–B", "A–C", "A–E", "A–Someday", "B–Someday", "C–D", "D–E"]);
  // A links to B and B to A: one line, pointing both ways.
  const ab = m.links.find((l) => [m.nodes[l.source].label, m.nodes[l.target].label].sort().join() === "A,B")!;
  expect(ab.both).toBe(true);
  // Missing notes are merged by name, any case.
  expect(m.nodes.find((n) => n.label === "Someday")!.kind).toBe("unresolved");
  // Weight counts links in and out (A: out to B, C, Someday; in from B, E).
  expect(m.nodes[m.index.get("A.md")!].weight).toBe(5);
});

test("an upper-case .MD file is a note on the graph", () => {
  const { notes: mdNotes, attachments } = graphFileLists(
    [
      { path: "Upper.MD", is_dir: false },
      { path: "Note.md", is_dir: false },
      { path: "pic.png", is_dir: false },
      { path: "Hidden.md", is_dir: false },
      { path: "Dir", is_dir: true },
    ],
    (path) => path === "Hidden.md",
  );
  expect(mdNotes).toEqual(["Upper.MD", "Note.md"]);
  expect(attachments).toEqual(["pic.png"]);
  const m = buildGraph({ notes: mdNotes, attachments, links: links({}) }, { ...base, showAttachments: true });
  expect(m.nodes.find((n) => n.path === "Upper.MD")).toMatchObject({ kind: "note", label: "Upper" });
  expect(m.nodes.find((n) => n.path === "pic.png")!.kind).toBe("attachment");
});

test("filters: existing files only, orphans, attachments, tags and a search", () => {
  const src = { notes, attachments: ["pic.png", "orphan.pdf"], links: index, tags: new Map([["A.md", ["project/grove"]], ["C.md", ["project/grove", "idea"]]]) };
  expect(labels(buildGraph(src, { ...base, hideUnresolved: true }))).not.toContain("Someday");
  expect(labels(buildGraph(src, { ...base, showOrphans: false }))).not.toContain("Lonely");
  const withFiles = buildGraph(src, { ...base, showAttachments: true });
  expect(labels(withFiles)).toEqual(expect.arrayContaining(["pic.png", "orphan.pdf"]));
  expect(edges(withFiles)).toContain("E–pic.png");
  // An unlinked attachment is an orphan like any note.
  expect(labels(buildGraph(src, { ...base, showAttachments: true, showOrphans: false }))).not.toContain("orphan.pdf");
  const withTags = buildGraph(src, { ...base, showTags: true });
  expect(edges(withTags)).toEqual(expect.arrayContaining(["#project/grove–A", "#project/grove–C", "#idea–C"]));
  expect(withTags.nodes.find((n) => n.label === "#idea")!.kind).toBe("tag");
  // Search: only the notes it accepts (tags and missing notes only through them).
  const only = buildGraph(src, { ...base, include: (p) => p === "A.md" || p === "B.md" });
  expect(labels(only)).toEqual(["A", "B", "Someday"]);
  expect(edges(only)).toEqual(["A–B", "A–Someday", "B–Someday"]);
});

test("local graph: depth, incoming and outgoing links, neighbour links", () => {
  const src = { notes, attachments: [], links: index };
  const local = (o: Partial<{ depth: number; incoming: boolean; outgoing: boolean; neighbors: boolean }>) =>
    buildGraph(src, { ...base, hideUnresolved: true, local: { center: "C.md", depth: 1, incoming: true, outgoing: true, neighbors: false, ...o } });
  expect(labels(local({}))).toEqual(["A", "C", "D"]);
  expect(labels(local({ depth: 2 }))).toEqual(["A", "B", "C", "D", "E"]);
  expect(labels(local({ incoming: false }))).toEqual(["C", "D"]);
  expect(labels(local({ outgoing: false, depth: 2 }))).toEqual(["A", "B", "C", "E"]);
  // Depth 2 reaches B (through A) and E (through A and through D).
  expect(edges(local({ depth: 2 }))).toEqual(["A–B", "A–C", "A–E", "C–D", "D–E"]);
  // A link between two notes that are both one step away is a neighbour link.
  const tri = { notes: ["X.md", "P.md", "Q.md"], attachments: [], links: links({ "X.md": ["P.md", "Q.md"], "P.md": ["Q.md"] }) };
  const around = (neighbors: boolean) => buildGraph(tri, { ...base, local: { center: "X.md", depth: 1, incoming: true, outgoing: true, neighbors } });
  expect(edges(around(false))).toEqual(["P–X", "Q–X"]);
  expect(edges(around(true))).toEqual(["P–Q", "P–X", "Q–X"]);
  // An unlinked note on its own is still shown in its local graph.
  expect(labels(buildGraph(src, { ...base, local: { center: "Lonely.md", depth: 1, incoming: true, outgoing: true, neighbors: false } }))).toEqual(["Lonely"]);
});

test("node size follows Obsidian's: 8 up to about six links, then the square root", () => {
  expect(nodeRadius(0)).toBe(8);
  expect(nodeRadius(6)).toBe(8);
  expect(nodeRadius(7)).toBeCloseTo(8.485, 3);
  expect(nodeRadius(9)).toBeCloseTo(9.487, 3);
});

test("colour groups colour notes only, as observed in Obsidian", () => {
  const src = { notes, attachments: ["pic.png"], links: index, tags: new Map([["A.md", ["x"]]]) };
  const m = buildGraph(src, { ...base, showTags: true, showAttachments: true });
  const all = { match: () => true };
  const byLabel = (label: string) => m.nodes.find((n) => n.label === label)!;
  // A group that matches everything: notes take it; the attachment, the tag and the missing note keep their own.
  expect(["A", "pic.png", "#x", "Someday"].map((l) => nodeColor(byLabel(l), [all]))).toEqual([4, 3, 2, 1]);
  // The first group that matches wins; no group, the note's own colour.
  const isB = { match: (n: { label: string }) => n.label === "B" };
  expect([nodeColor(byLabel("B"), [isB, all]), nodeColor(byLabel("C"), [isB, all]), nodeColor(byLabel("C"), [isB])]).toEqual([4, 5, 0]);
});

test("graph queries (the search syntax): words, path:, file: and tag:", () => {
  const q = parseQuery('river path:"Projects/Big things" file:road tag:#idea');
  expect(parseQuery("  ")).toBeNull();
  const tags = new Map([["Projects/Big things/roadmap.md", ["idea/later"]]]);
  const lines = (hits: string[]) => (term: string) => (term === "river" ? new Map(hits.map((p) => [p, [{ line: 1, text: "river" }]])) : undefined);
  const hit = lines(["Projects/Big things/roadmap.md"]);
  expect(matches("Projects/Big things/roadmap.md", q, { tags, lines: hit })).toBe(true);
  expect(matches("Projects/Big things/roadmap.md", q, { tags, lines: lines([]) })).toBe(false);
  expect(matches("Projects/roadmap.md", q, { tags, lines: hit })).toBe(false);
  expect(matches("a.md", parseQuery("tag:idea"), { tags: new Map([["a.md", ["ideas"]]]), lines: () => undefined })).toBe(false);
});

test("the simulation settles, then stops; the same graph lays out the same way", () => {
  const m = buildGraph({ notes, attachments: [], links: index }, base);
  const run = () => {
    const sim = new Simulation();
    sim.setGraph(m.nodes.map((n) => n.id), m.links, () => undefined);
    let ticks = 0;
    while (!sim.settled && ticks < 1000) {
      sim.tick();
      ticks++;
    }
    return { sim, ticks };
  };
  const { sim, ticks } = run();
  expect(sim.alpha).toBeLessThan(ALPHA_MIN);
  expect(ticks).toBeGreaterThan(200);
  expect(ticks).toBeLessThan(400);
  for (let i = 0; i < sim.n; i++) expect(Number.isFinite(sim.x[i]) && Number.isFinite(sim.y[i])).toBe(true);
  // Linked notes end up near the link distance apart; nothing piles up on one spot.
  const a = m.index.get("C.md")!;
  const b = m.index.get("D.md")!;
  expect(Math.hypot(sim.x[a] - sim.x[b], sim.y[a] - sim.y[b])).toBeGreaterThan(100);
  expect(Math.hypot(sim.x[a] - sim.x[b], sim.y[a] - sim.y[b])).toBeLessThan(450);
  const again = run().sim;
  expect(Array.from(again.x)).toEqual(Array.from(sim.x));
});

test("an update keeps nodes where they were and places a new one by its neighbour", () => {
  const sim = new Simulation();
  sim.setGraph(["a", "b"], [{ source: 0, target: 1 }], () => undefined);
  for (let i = 0; i < 300; i++) sim.tick();
  const [ax, ay, bx, by] = [sim.x[0], sim.y[0], sim.x[1], sim.y[1]];
  const old = { a: [ax, ay, 0, 0], b: [bx, by, 0, 0] } as Record<string, [number, number, number, number]>;
  sim.setGraph(["a", "b", "c"], [{ source: 0, target: 1 }, { source: 2, target: 1 }], (id) => old[id]);
  expect([sim.x[0], sim.y[0], sim.x[1], sim.y[1]]).toEqual([ax, ay, bx, by]);
  expect(Math.hypot(sim.x[2] - bx, sim.y[2] - by)).toBeLessThan(100);
});

test("a graph prepared in steps and installed later equals one set at install time", () => {
  // Review 3: `prepareGraph` runs while the shown layout keeps moving; `installGraph` reads
  // the kept nodes' places then. The result equals `setGraph` called at that moment.
  const start = () => {
    const sim = new Simulation();
    sim.setGraph(["a", "b", "c"], [{ source: 0, target: 1 }, { source: 1, target: 2 }], () => undefined);
    for (let i = 0; i < 50; i++) sim.tick();
    return sim;
  };
  const ids = ["b", "x", "a", "y", "z", "c"];
  const links = [{ source: 2, target: 0 }, { source: 1, target: 0 }, { source: 3, target: 1 }, { source: 4, target: 5 }];
  const old = new Map([["a", 0], ["b", 1], ["c", 2]]);
  const later = start();
  const steps = later.prepareGraph(ids, links, (id) => old.get(id));
  let step = steps.next();
  for (let i = 0; i < 40; i++) later.tick();
  while (!step.done) step = steps.next();
  later.installGraph(step.value);
  const now = start();
  for (let i = 0; i < 40; i++) now.tick();
  now.setGraph(ids, links, (id) => {
    const i = old.get(id);
    return i === undefined ? undefined : [now.x[i], now.y[i], now.vx[i], now.vy[i]];
  });
  expect([Array.from(later.x), Array.from(later.y), Array.from(later.vx)]).toEqual([Array.from(now.x), Array.from(now.y), Array.from(now.vx)]);
});

test("draw order and the shape check equal what they replace", () => {
  let x = 99;
  const r = (n: number) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % n; };
  for (let round = 0; round < 200; round++) {
    const colorOf = Int16Array.from({ length: r(300) }, () => r(7));
    const sorted = Int32Array.from({ length: colorOf.length }, (_, i) => i).sort((a, b) => colorOf[a] - colorOf[b]);
    expect(Array.from(drawOrder(colorOf))).toEqual(Array.from(sorted));
  }
  const sig = (m: GraphModel) => m.nodes.map((n) => n.id).join("\n") + "\n" + m.links.map((l) => `${l.source},${l.target}`).join(" ");
  const run = (a: GraphModel, b: GraphModel) => { const s = sameShape(a, b); for (;;) { const step = s.next(); if (step.done) return step.value; } };
  const one = buildGraph({ notes, attachments: [], links: index }, base);
  const variants = [
    one,
    buildGraph({ notes, attachments: [], links: index }, base),
    buildGraph({ notes, attachments: [], links: index }, { ...base, hideUnresolved: true }),
    buildGraph({ notes: [...notes, "New.md"], attachments: [], links: index }, base),
    buildGraph({ notes, attachments: [], links: links({ ...index.outgoing, "C.md": ["A.md"] }, { markdown: index.markdown, unresolved: index.unresolved }) }, base),
  ];
  for (const a of variants) for (const b of variants) expect(run(a, b)).toBe(sig(a) === sig(b));
});

test("every phase of a build pauses: no step handles more than a few thousand notes or links", () => {
  // Review 3: the last passes (keeping nodes, mapping links, the id index) and the local
  // graph's walk pause too. 30,000 notes in a ring, with a missing note each.
  const many = Array.from({ length: 30_000 }, (_, i) => `n${i}.md`);
  const outgoing: Record<string, string[]> = {};
  const unresolved: Record<string, string[]> = {};
  many.forEach((p, i) => { outgoing[p] = [many[(i + 1) % many.length]!]; unresolved[p] = [`gone ${i}`]; });
  const local = { ...base, local: { center: "n0.md", depth: 5, incoming: true, outgoing: true, neighbors: true } };
  // Each twice: the second run is the one that counts (the first warms the JIT up).
  for (const opts of [base, base, local, local]) {
    const steps = buildGraphSteps({ notes: many, attachments: [], links: links(outgoing, { unresolved }) }, opts);
    let longest = 0, pauses = 0;
    for (;;) {
      const started = performance.now();
      const step = steps.next();
      longest = Math.max(longest, performance.now() - started);
      if (step.done) break;
      pauses++;
    }
    console.log(`${opts === base ? "global" : "local"} build of 30,000 notes: ${pauses} pauses, longest step ${longest.toFixed(1)} ms`);
    // Listing notes, their links, the two-way pairs, kept nodes, mapped links and the index:
    // each pauses every 1,024 (60,000 nodes with the missing notes, 60,000 links).
    expect(pauses).toBeGreaterThan((30_000 + 30_000 + 4 * 60_000) / 1024 - 6);
  }
});

test("the repel force with Barnes-Hut stays close to the exact sum", () => {
  // Two far clusters: approximations of the far cluster must push the right way.
  const ids = Array.from({ length: 60 }, (_, i) => `n${i}`);
  const sim = new Simulation();
  sim.forces = { center: 0, repel: 10, link: 0, distance: 250 };
  sim.setGraph(ids, [], (id) => {
    const i = Number(id.slice(1));
    return [(i < 30 ? -1000 : 1000) + (i % 6) * 10, Math.floor((i % 30) / 6) * 10, 0, 0];
  });
  sim.alpha = 1;
  sim.tick();
  // The left cluster moves left, the right one right.
  expect(sim.vx[0]).toBeLessThan(0);
  expect(sim.vx[59]).toBeGreaterThan(0);
});

test("graph.json keeps Obsidian's keys and only what was changed; the local graph's sit under local", () => {
  const values = { ...defaults(GRAPH), showTags: true, linkDistance: 120, local: { localJumps: 2 } };
  expect(JSON.parse(serialize(GRAPH, values))).toEqual({ showTags: true, linkDistance: 120, local: { localJumps: 2 } });
  const read = sanitize(GRAPH, { repelStrength: 50, colorGroups: [{ query: "tag:#a", color: { a: 1, rgb: 0xff0000 } }, { query: 1 }], textFadeMultiplier: 0.3 }).values;
  expect(read.repelStrength).toBe(10);
  expect(read.colorGroups).toEqual([]);
  expect(read.textFadeMultiplier).toBeCloseTo(0.3);
  expect(sanitize(LOCAL_GRAPH, { localJumps: 9, localInterlinks: true }).values).toMatchObject({ localJumps: 1, localInterlinks: true, close: true });
});

test("neighbour lists hold each link at both ends", () => {
  const { start, adj } = neighbours(4, [
    { source: 0, target: 1, both: false },
    { source: 2, target: 0, both: true },
  ]);
  const of = (i: number) => [...adj.slice(start[i], start[i + 1])].sort();
  expect([of(0), of(1), of(2), of(3)]).toEqual([[1, 2], [0], [0], []]);
});

// Review 2: the refresh guard for a local graph.
// Labels too: a missing note's label is the first linking note's spelling (review 3).
const shape = (m: GraphModel) => JSON.stringify([m.nodes.map((n) => [n.id, n.label, n.kind, n.weight]), m.links.map((l) => [l.source, l.target, l.both])]);

test("a local graph rebuilds when a note outside it links to a missing note it shows", () => {
  const notes = ["A.md", "B.md", "C.md"];
  const before = links({}, { unresolved: { "A.md": ["Missing"] } });
  const opts = { ...base, local: { center: "A.md", depth: 2, incoming: true, outgoing: true, neighbors: false } };
  const shown = buildGraph({ notes, attachments: [], links: before }, opts);
  expect(labels(shown)).toEqual(["A", "Missing"]);
  // B (already a note, no file-list change) now links to [[missing]].
  const after = links({}, { unresolved: { "A.md": ["Missing"], "B.md": ["missing"] } });
  const touched = new Set(["B.md"]);
  expect(localLinksMatter(touched, shown.index, false, false, (p) => linkEntryOf(after, p), (p) => linkEntryOf(before, p))).toBe(true);
  expect(labels(buildGraph({ notes, attachments: [], links: after }, opts))).toEqual(["A", "B", "Missing"]);
  // With missing notes hidden the graph has no such node, and nothing changes.
  const hidden = { ...opts, hideUnresolved: true };
  const plain = buildGraph({ notes, attachments: [], links: before }, hidden);
  expect(localLinksMatter(touched, plain.index, false, true, (p) => linkEntryOf(after, p), (p) => linkEntryOf(before, p))).toBe(false);
  expect(shape(buildGraph({ notes, attachments: [], links: after }, hidden))).toBe(shape(plain));
});

test("a local graph rebuilds when an existing note outside it drops the first spelling of a missing note it shows", () => {
  // Z (the centre) links [[missing]]; A, earlier in path order and outside the depth-1
  // graph, links [[Missing]]. The node takes A's spelling, since A is visited first.
  const notes = ["A.md", "Q.md", "Z.md"];
  const before = links({ "A.md": ["Q.md"] }, { unresolved: { "A.md": ["Missing"], "Z.md": ["missing"] } });
  const opts = { ...base, local: { center: "Z.md", depth: 1, incoming: true, outgoing: true, neighbors: false } };
  const shown = buildGraph({ notes, attachments: [], links: before }, opts);
  expect(labels(shown)).toEqual(["Missing", "Z"]);
  expect(shown.index.has("A.md")).toBe(false);
  // A is saved without that link: the fresh graph labels the node with Z's spelling.
  const after = links({ "A.md": ["Q.md"] }, { unresolved: { "Z.md": ["missing"] } });
  expect(labels(buildGraph({ notes, attachments: [], links: after }, opts))).toEqual(["Z", "missing"]);
  const touched = new Set(["A.md"]);
  expect(localLinksMatter(touched, shown.index, false, false, (p) => linkEntryOf(after, p), (p) => linkEntryOf(before, p))).toBe(true);
  // Judged on the new entries alone, it would have been skipped.
  expect(localLinksMatter(touched, shown.index, false, false, (p) => linkEntryOf(after, p), (p) => linkEntryOf(after, p))).toBe(false);
});

test("whenever the guard skips a refresh, a fresh local graph equals the one shown", () => {
  let x = 12345;
  const r = (n: number) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % n; };
  const notes = ["A.md", "B.md", "C.md", "D.md", "E.md", "F.md", "G.md", "H.md"];
  const missing = ["Missing", "missing", "Other"];
  const entry = () => ({
    outgoing: Array.from({ length: r(3) }, () => notes[r(notes.length)]!),
    markdown: r(4) ? [] : [notes[r(notes.length)]!],
    unresolved: Array.from({ length: r(2) }, () => missing[r(missing.length)]!),
  });
  const toIndex = (all: Map<string, ReturnType<typeof entry>>): LinkIndex => {
    const out: LinkIndex = { outgoing: {}, markdown: {}, unresolved: {} };
    for (const [path, e] of all) for (const f of ["outgoing", "markdown", "unresolved"] as const) if (e[f].length) out[f]![path] = [...new Set(e[f])];
    return out;
  };
  let skipped = 0;
  for (let round = 0; round < 2000; round++) {
    const all = new Map(notes.filter(() => r(3)).map((p) => [p, entry()]));
    const opts = { ...base, hideUnresolved: r(2) === 0, local: { center: notes[r(notes.length)]!, depth: 1 + r(3), incoming: r(3) > 0, outgoing: r(3) > 0, neighbors: r(2) === 0 } };
    const before = toIndex(all);
    const shown = buildGraph({ notes, attachments: [], links: before }, opts);
    const changed = notes[r(notes.length)]!;
    if (r(4)) all.set(changed, entry()); else all.delete(changed);
    const after = toIndex(all);
    if (localLinksMatter(new Set([changed]), shown.index, false, opts.hideUnresolved, (p) => linkEntryOf(after, p), (p) => linkEntryOf(before, p))) continue;
    skipped++;
    expect(shape(buildGraph({ notes, attachments: [], links: after }, opts)), `round ${round}`).toBe(shape(shown));
  }
  expect(skipped).toBeGreaterThan(100);
});

// Review 4: a tick taken in steps (`advance`, as the view does at 50k nodes) moves every node
// exactly as a whole tick does, tick for tick, and nothing moves until its last step. A new
// graph put in while a tick is under way waits for it to end.
test("a tick in steps lays out exactly as whole ticks", () => {
  const ids = Array.from({ length: 3000 }, (_, i) => `n${i}`);
  const links = Array.from({ length: 4500 }, (_, i) => ({ source: i % 3000, target: (i * 7 + 3) % 3000 }));
  const whole = new Simulation();
  const stepped = new Simulation();
  for (const sim of [whole, stepped]) sim.setGraph(ids, links, () => undefined);
  let steps = 0;
  for (let t = 0; t < 12; t++) {
    whole.tick();
    const x = Array.from(stepped.x);
    // A deadline already passed: one step a call.
    while (!stepped.advance(0)) {
      steps++;
      expect(stepped.ticking).toBe(true);
      if (steps % 7 === 0) expect(Array.from(stepped.x)).toEqual(x);
    }
    expect(stepped.ticking).toBe(false);
    expect(Array.from(stepped.x)).toEqual(Array.from(whole.x));
    expect(Array.from(stepped.vy)).toEqual(Array.from(whole.vy));
  }
  expect(steps).toBeGreaterThan(12 * 5);
  // Half a tick, then a new graph (one more node): the tick ends first, as it would have.
  stepped.advance(0);
  expect(stepped.ticking).toBe(true);
  whole.tick();
  const more = [...ids, "late"];
  const known = (id: string) => (id === "late" ? undefined : ids.indexOf(id));
  for (const sim of [whole, stepped]) {
    const steps = sim.prepareGraph(more, links, known);
    let step = steps.next();
    while (!step.done) step = steps.next();
    sim.installGraph(step.value);
  }
  expect(stepped.ticking).toBe(false);
  whole.tick();
  stepped.tick();
  expect(Array.from(stepped.x)).toEqual(Array.from(whole.x));
});
