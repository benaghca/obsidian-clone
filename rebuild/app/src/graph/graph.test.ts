import { expect, test } from "vitest";
import type { LinkIndex } from "../api";
import { GRAPH, LOCAL_GRAPH, sanitize, serialize, defaults } from "../settings/schema";
import { buildGraph, type GraphModel, nodeRadius } from "./data";
import { isEmptyQuery, matchesQuery, parseGraphQuery } from "./query";
import { ALPHA_MIN, Simulation } from "./sim";

const links = (outgoing: Record<string, string[]>, extra: Partial<LinkIndex> = {}): LinkIndex => ({ outgoing, backlinks: {}, ...extra });
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

test("graph queries: words, path:, file: and tag:", () => {
  const q = parseGraphQuery('river path:"Projects/Big things" file:road tag:#idea');
  expect(q).toEqual({ text: "river", paths: ["projects/big things"], files: ["road"], tags: ["idea"] });
  expect(isEmptyQuery(parseGraphQuery("  "))).toBe(true);
  const tags = new Map([["Projects/Big things/roadmap.md", ["idea/later"]]]);
  const hits = new Set(["Projects/Big things/roadmap.md"]);
  expect(matchesQuery("Projects/Big things/roadmap.md", q, { tags, textHits: hits })).toBe(true);
  expect(matchesQuery("Projects/Big things/roadmap.md", q, { tags, textHits: new Set() })).toBe(false);
  expect(matchesQuery("Projects/roadmap.md", q, { tags, textHits: hits })).toBe(false);
  expect(matchesQuery("a.md", parseGraphQuery("tag:idea"), { tags: new Map([["a.md", ["ideas"]]]) })).toBe(false);
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
