import { beforeEach, expect, test, vi } from "vitest";
import { updateNoteText } from "../fileOps";
import type { Workspace } from "../workspace";
import { rewriteLinks } from "./internal";
import { updateLinks } from "./update";

vi.mock("../fileOps", () => ({ updateNoteText: vi.fn().mockResolvedValue(undefined), isMoving: () => false, movesSettled: async () => {} }));
/** A workspace with only what a test sets, plus no moves, no saves and no loaded notes. */
const fake = (w: { vault: object; editors: object }) =>
  ({ onMove: () => () => {}, ...w, vault: { onModified: () => () => {}, ...w.vault }, editors: { doc: () => undefined, ...w.editors } }) as unknown as Workspace;
const style = { format: "shortest", wikilinks: true } as const;
beforeEach(() => vi.clearAllMocks());

test("rewrites from a pre-rename source list", async () => {
  const before = [{ path: "Old.md", name: "Old" }, { path: "Source.md", name: "Source" }];
  const ws = fake({
    vault: { notes: [{ path: "New.md", name: "New" }, before[1]], links: { outgoing: {} } },
    editors: { text: vi.fn().mockResolvedValue("[[Old]] and [label](Old.md#Heading)") },
  });
  const ask = vi.fn().mockResolvedValue(true);
  expect(await updateLinks(ws, "Old.md", "New.md", before, ["Source.md"], style, ask)).toBe(2);
  expect(ask).toHaveBeenCalledWith(2, 1);
  expect(updateNoteText).toHaveBeenCalledWith(ws, "Source.md", "[[New]] and [label](New.md#Heading)");
});

test("maps sources inside a moved folder forward exactly once and uses live editor text", async () => {
  const before = [{ path: "Old/Target.md", name: "Target" }, { path: "Old/Source.md", name: "Source" }];
  const ws = fake({
    vault: { notes: before.map(n => ({ ...n, path: n.path.replace("Old/", "New/") })), links: { outgoing: {} } },
    editors: { text: vi.fn().mockResolvedValue("unsaved [[Old/Target]]") },
  });
  expect(await updateLinks(ws, "Old", "New", before, ["Old/Source.md"], style, null)).toBe(1);
  expect(ws.editors.text).toHaveBeenCalledWith("New/Source.md");
  expect(updateNoteText).toHaveBeenCalledWith(ws, "New/Source.md", "unsaved [[Target]]");
});

test("declining the rename-link confirmation leaves source text untouched", async () => {
  const before = [{ path: "Old.md", name: "Old" }, { path: "Source.md", name: "Source" }];
  const ws = fake({ vault: { notes: [{ path: "New.md", name: "New" }, before[1]] }, editors: { text: async () => "[[Old]]" } });
  expect(await updateLinks(ws, "Old.md", "New.md", before, ["Source.md"], style, async () => false)).toBe(0);
  expect(updateNoteText).not.toHaveBeenCalled();
});

test("a 50-note folder move rewrites every linking note", async () => {
  const moved = Array.from({ length: 50 }, (_, i) => ({ path: `Old/Note${i}.md`, name: `Note${i}` }));
  const linkers = Array.from({ length: 50 }, (_, i) => ({ path: `Link${i}.md`, name: `Link${i}` }));
  const before = [...moved, ...linkers];
  const after = before.map((n) => n.path.startsWith("Old/") ? { ...n, path: `New/${n.path.slice(4)}` } : n);
  const ws = fake({
    vault: { notes: after },
    editors: {
      text: vi.fn(async (path: string) => {
        const i = /^Link(\d+)\.md$/.exec(path)?.[1];
        return i === undefined ? "" : `[[Old/Note${i}]]`;
      }),
    },
  });
  expect(await updateLinks(ws, "Old", "New", before, linkers.map((n) => n.path), style, null)).toBe(50);
  expect(updateNoteText).toHaveBeenCalledTimes(50);
  expect(updateNoteText).toHaveBeenCalledWith(ws, "Link0.md", "[[Note0]]");
  expect(updateNoteText).toHaveBeenCalledWith(ws, "Link49.md", "[[Note49]]");
});

test("renaming a drawing rewrites its embeds, keeps their size, and leaves a same-named note's links", async () => {
  const before = [
    { path: "Sketch.md", name: "Sketch" },
    { path: "Source.md", name: "Source" },
    { path: "Sketch.excalidraw", name: "Sketch.excalidraw" },
  ];
  const ws = fake({
    vault: { notes: before.slice(0, 2) },
    editors: { text: vi.fn().mockResolvedValue("![[Sketch.excalidraw]]\n![[Sketch.excalidraw|400]] [[Sketch]] ![[Sketch]]\n![drawn](Sketch.excalidraw)") },
  });
  expect(await updateLinks(ws, "Sketch.excalidraw", "Plan 2.excalidraw", before, ["Source.md"], style, null)).toBe(3);
  expect(updateNoteText).toHaveBeenCalledWith(ws, "Source.md", "![[Plan 2.excalidraw]]\n![[Plan 2.excalidraw|400]] [[Sketch]] ![[Sketch]]\n![drawn](Plan%202.excalidraw)");
});

test("a drawing moved into a folder with a same-named drawing is linked by its path", async () => {
  const before = [
    { path: "Source.md", name: "Source" },
    { path: "Sketch.excalidraw", name: "Sketch.excalidraw" },
    { path: "Other/Sketch.excalidraw", name: "Sketch.excalidraw" },
  ];
  const ws = fake({
    vault: { notes: before.slice(0, 1) },
    editors: { text: vi.fn().mockResolvedValue("![[Sketch.excalidraw]] and ![[Other/Sketch.excalidraw|200]]") },
  });
  // Shortest: the bare name now matches two drawings, so the moved one is written as its path.
  expect(await updateLinks(ws, "Sketch.excalidraw", "Archive/Sketch.excalidraw", before, ["Source.md"], style, null)).toBe(1);
  expect(updateNoteText).toHaveBeenCalledWith(ws, "Source.md", "![[Archive/Sketch.excalidraw]] and ![[Other/Sketch.excalidraw|200]]");
});

test("a folder move rewrites links to its notes and embeds of its drawings together", async () => {
  const before = [
    { path: "Old/Note.md", name: "Note" },
    { path: "Old/Map.excalidraw", name: "Map.excalidraw" },
    { path: "Index.md", name: "Index" },
  ];
  const ws = fake({
    vault: { notes: [{ path: "New/Note.md", name: "Note" }, before[2]] },
    editors: { text: vi.fn().mockResolvedValue("[[Old/Note]] ![[Old/Map.excalidraw]]") },
  });
  const ask = vi.fn().mockResolvedValue(true);
  expect(await updateLinks(ws, "Old", "New", before, ["Index.md"], { format: "absolute", wikilinks: true }, ask)).toBe(2);
  expect(ask).toHaveBeenCalledWith(2, 1);
  expect(updateNoteText).toHaveBeenCalledWith(ws, "Index.md", "[[New/Note]] ![[New/Map.excalidraw]]");
});

test("renaming a note leaves embeds of a drawing with the same stem alone", async () => {
  const before = [{ path: "Sketch.md", name: "Sketch" }, { path: "Source.md", name: "Source" }, { path: "Sketch.excalidraw", name: "Sketch.excalidraw" }];
  const ws = fake({
    vault: { notes: [{ path: "Renamed.md", name: "Renamed" }, before[1]] },
    editors: { text: vi.fn().mockResolvedValue("[[Sketch]] ![[Sketch.excalidraw|300]]") },
  });
  expect(await updateLinks(ws, "Sketch.md", "Renamed.md", before, ["Source.md"], style, null)).toBe(1);
  expect(updateNoteText).toHaveBeenCalledWith(ws, "Source.md", "[[Renamed]] ![[Sketch.excalidraw|300]]");
});

// A small vault for the one-pass folder move: names that clash across folders,
// headings and aliases, relative and partial paths, Markdown links with
// spaces and escaped parentheses, embeds of images and drawings, code spans,
// fences and CRLF. 64 notes move with "Moved".
function moveVault() {
  const files: { path: string; name: string }[] = [];
  const add = (path: string) => files.push({ path, name: path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "") });
  for (let i = 0; i < 64; i++) add(`Moved/${["", "Sub/", "Sub/Deep/", "Other (x)/"][i % 4]}Note ${i}.md`);
  for (const p of ["Moved/Plan.md", "Plan.md", "Elsewhere/Plan.md", "Moved/Sub/Deep/Plan.md", "Index.md", "Elsewhere/Hub.md", "Elsewhere/Deeper/Leaf.md"]) add(p);
  for (const p of ["Moved/photo.png", "photo.png", "Moved/Sub/Map.excalidraw", "Moved/Sub/README", "Elsewhere/doc.pdf"]) add(p);
  const pick = (i: number) => files[i % 64];
  const linkLines = (i: number) => {
    const a = pick(i), b = pick(i * 7 + 3), c = pick(i * 13 + 5);
    const stem = (p: string) => p.replace(/\.md$/, "");
    return [
      `See [[${a.name}]] and [[${stem(b.path)}#Part|shown]] and ![[${c.name}]].`,
      `[x](${encodeURI(b.path)}) [y](${b.path.replace(/ /g, "%20").replace(/[()]/g, "\\$&")}#Top) [z](<not a link>)`,
      `Partial [[Sub/${pick(i * 4 + 1).name}]], [[Deep/${pick(i * 4 + 2).name}]] and [[Plan]] [[Moved/Plan]] [[Sub/Deep/Plan|p]].`,
      `Files: ![[photo.png|300]] ![[Moved/photo.png]] ![m](Moved/Sub/Map.excalidraw) ![[Map.excalidraw]] [[Moved/Sub/README]] [[doc.pdf]]`,
      `Code \`[[${a.name}]]\` and \`\`[[Plan]]\`\` stay; [[Missing ${i}]] stays; [web](https://x.test/${a.name}) stays.`,
      "```md", `[[${a.name}]]`, "```",
      `Relative [[../${a.name}]] and [r](../Sub/${encodeURI(pick(i * 4 + 1).path.split("/").pop()!)}) and [[./${pick(i).name}]]`,
    ];
  };
  const texts = new Map<string, string>();
  files.forEach((f, i) => {
    if (!f.path.endsWith(".md")) return;
    const text = [`# ${f.name}`, ...linkLines(i), ...linkLines(i + 11)].join("\n");
    texts.set(f.path, i % 9 === 4 ? text.replace(/\n/g, "\r\n") : text);
  });
  return { files, texts };
}

/** Today's loop before the one-pass rewrite: every moved pair rewrites the text again. */
function perPairMove(text: string, src: string, now: string, from: string, to: string, before: { path: string; name: string }[], notesAfter: { path: string; name: string }[], linkStyle: { format: "shortest" | "relative" | "absolute"; wikilinks: boolean }) {
  const swap = (p: string) => (p === from || p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
  const notesBefore = before.filter((n) => n.path.endsWith(".md"));
  const filesAfter = before.map((n) => (swap(n.path) === n.path ? n : { name: swap(n.path).split("/").pop()!.replace(/\.md$/, ""), path: swap(n.path) }));
  let count = 0;
  for (const n of before) {
    if (swap(n.path) === n.path) continue;
    const note = n.path.endsWith(".md");
    const r = note ? rewriteLinks(text, src, n.path, swap(n.path), notesBefore, notesAfter, linkStyle, now) : rewriteLinks(text, src, n.path, swap(n.path), before, filesAfter, linkStyle, now);
    text = r.text;
    count += r.count;
  }
  return { text, count };
}

/** A move on `moveVault` through `updateLinks`: the links changed and each written note. */
async function moveOnce(from: string, to: string, linkStyle: { format: "shortest" | "relative" | "absolute"; wikilinks: boolean }) {
  const { files, texts } = moveVault();
  const swap = (p: string) => (p === from || p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
  const after = files.filter((f) => f.path.endsWith(".md")).map((f) => ({ path: swap(f.path), name: swap(f.path).split("/").pop()!.replace(/\.md$/, "") }));
  const old = new Map([...texts.keys()].map((s) => [swap(s), s]));
  vi.mocked(updateNoteText).mockClear();
  const ws = fake({ vault: { notes: after }, editors: { text: async (p: string) => texts.get(old.get(p)!)! } });
  const links = await updateLinks(ws, from, to, files, [...texts.keys()], linkStyle, null);
  const written = new Map(vi.mocked(updateNoteText).mock.calls.map(([, path, text]) => [path, text]));
  return { files, texts, swap, after, links, written };
}

test("a 64-note folder move in one pass writes exactly what one pass per moved file wrote", async () => {
  const linkStyle = { format: "shortest", wikilinks: true } as const;
  const { files, texts, swap, after, links, written } = await moveOnce("Moved", "Renamed", linkStyle);
  let expected = 0;
  for (const [src, text] of texts) {
    const r = perPairMove(text, src, swap(src), "Moved", "Renamed", files, after, linkStyle);
    expected += r.count;
    expect(written.get(swap(src)), src).toBe(r.count ? r.text : undefined);
  }
  expect(links).toBe(expected);
  expect(links).toBeGreaterThan(500);
});

// Hashes of what the per-pair code wrote (rebuild/integration 9f78826) for
// each move and link format. The Wikilinks setting does not change a
// rewrite (a link keeps its own syntax), so both settings must match.
const BEFORE_P1 = `
Moved|Renamed|shortest|1972|9867615c58f7f1580e4e875248db4e2271eac411f2961d61e2afe14573fe1f04
Moved|Renamed|relative|1972|f4f534723de5e888cb1985e121c516c51f83cccfaa31e2364f068872971ff34c
Moved|Renamed|absolute|1972|67c33dc1e6881b5f569bade1e4e94e5dbf8f7ca5707f18687c01ad44ab1e2f30
Moved|Elsewhere/Moved|shortest|1972|2f64b8b944cc8eaee00149acea0730a14682d59ccb75abbb537c6eff786aacf1
Moved|Elsewhere/Moved|relative|1972|5c1e02bc69d69a14d3433e6271c5ef6394dd6c2bfa369401812025e612085bf3
Moved|Elsewhere/Moved|absolute|1972|8960affbfd605c43498fa4f893159ffb278706f27e1fec2933c2d728bf779903
Moved/Sub|Sub|shortest|1321|fbd220b5439f9f50fd45504e36ce7d5b82be2aa2df8391b5121006f2af56fa1e
Moved/Sub|Sub|relative|1321|34379a65456fa6560e5d6bf654565467138087574e23278bfd56a9078255ed00
Moved/Sub|Sub|absolute|1321|80ecda9b9cc4e70da42e1c8bdf7adfcada75097b050c192d1f77850c0396b686
Moved/Plan.md|Elsewhere/Deeper/Plan.md|shortest|142|fa661ef68c5028b9df4a92673f2d132ca4bdf1ca762d5f4d9cbd592a663644cc
Moved/Plan.md|Elsewhere/Deeper/Plan.md|relative|142|112a6ea85689143bcd9ab96b81308efc6afe0a53fabc9ea67f3b62334eb2a1fc
Moved/Plan.md|Elsewhere/Deeper/Plan.md|absolute|142|fa661ef68c5028b9df4a92673f2d132ca4bdf1ca762d5f4d9cbd592a663644cc
Moved/photo.png|Elsewhere/photo 2.png|shortest|142|3aa5b869d4de61334cd78212470cea913b727021047c24fa5f219a61ce9eed89
Moved/photo.png|Elsewhere/photo 2.png|relative|142|bd65f4cb5116961712309e1a63f49c1ac5a59ad3625816c72f0198b3a35cf96c
Moved/photo.png|Elsewhere/photo 2.png|absolute|142|d2fe418201d293e199a630fdcef1e04325b2879bae43140f79f44e8351ff98b1`.trim().split("\n").map((line) => line.split("|"));

test("folder, subfolder, note and image moves write what the per-pair code wrote, in every link format", async () => {
  for (const [from, to, format, count, hash] of BEFORE_P1) for (const wikilinks of [true, false]) {
    const { links, written } = await moveOnce(from, to, { format: format as "shortest", wikilinks });
    const calls = [...written].map(([path, text]) => `${path}\0${text}`).sort();
    expect(links, `${from} → ${to}, ${format}`).toBe(Number(count));
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${links}\0${calls.join("\0")}`));
    expect([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""), `${from} → ${to}, ${format}, wikilinks ${wikilinks}`).toBe(hash);
  }
});

test("a long move lets other tasks run while it rewrites and writes", async () => {
  // Every read settles at once (a loaded note, or the browser mock), and each note takes 5 ms.
  let clock = 0;
  const now = vi.spyOn(performance, "now").mockImplementation(() => (clock += 5));
  let ticks = 0;
  const tick = () => { ticks++; if (ticks < 1000) setTimeout(tick, 0); };
  setTimeout(tick, 0);
  try {
    const { written } = await moveOnce("Moved", "Renamed", { format: "shortest", wikilinks: true });
    expect(written.size).toBeGreaterThan(60);
    expect(ticks).toBeGreaterThan(20);
  } finally {
    now.mockRestore();
    ticks = 1000;
  }
});

test("an embed that a note and an image both answer is rewritten as one pass per move rewrote it", async () => {
  const image = { path: "Move/Img/photo.png", name: "photo.png" };
  const note = { path: "Move/Note/photo.png.md", name: "photo.png" };
  const source = { path: "Move/Img/Source.md", name: "Source" };
  // What the per-pair code (9f78826) wrote. The pair first in the file list
  // goes first; with shortest links, the note's rewrite ("photo.png") still
  // names the image for the image's pair, which moves it again.
  for (const [files, format, expected, count] of [
    [[source, image, note], "absolute", "![[New/Img/photo.png|300]]", 1],
    [[source, note, image], "absolute", "![[New/Note/photo.png|300]]", 1],
    [[source, image, note], "shortest", "![[New/Img/photo.png|300]]", 1],
    [[source, note, image], "shortest", "![[New/Img/photo.png|300]]", 2],
  ] as const) {
    vi.mocked(updateNoteText).mockClear();
    const after = [source, note].map((n) => ({ ...n, path: n.path.replace("Move/", "New/") }));
    const ws = fake({ vault: { notes: after }, editors: { text: async () => "![[photo.png|300]]" } });
    expect(await updateLinks(ws, "Move", "New", [...files], [source.path], { format, wikilinks: true }, null), `${format} ${files[1].path}`).toBe(count);
    expect(updateNoteText, `${format} ${files[1].path}`).toHaveBeenCalledWith(ws, "New/Img/Source.md", expected);
  }
});
