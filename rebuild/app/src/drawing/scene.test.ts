import { describe, expect, it } from "vitest";
import {
  addElement, deleteElement, emptyDrawing, findElement, isDrawingText, liveElements, newElementRecord,
  parseScene, serializeScene, stringifyScene, updateElement,
  type FreedrawElement, type ImageElement, type JsonObject, type LinearElement, type Scene, type TextElement,
} from "./scene";

const fixtures = import.meta.glob<string>("../../fixtures/drawings/*.excalidraw", { eager: true, query: "?raw", import: "default" });
const bad = import.meta.glob<string>("../../fixtures/drawings/bad/*.excalidraw", { eager: true, query: "?raw", import: "default" });
const fixture = (name: string) => fixtures[`../../fixtures/drawings/${name}.excalidraw`];
// Fixed stamps, so edits are reproducible.
const stamp = { now: () => 1_800_000_000_000, random: () => 0.5 };

function open(text: string): Scene {
  const result = parseScene(text);
  if (!result.ok) throw new Error(result.error);
  return result.scene;
}
const rawOf = (scene: Scene, id: string) => (scene.data.elements as JsonObject[]).find(e => e?.id === id)!;

describe("round trip", () => {
  it("has the fixtures", () => {
    expect(Object.keys(fixtures).length).toBeGreaterThanOrEqual(9);
    expect(Object.keys(fixtures).filter(f => f.includes("/cinder-")).length).toBeGreaterThanOrEqual(4);
  });

  for (const [path, text] of Object.entries(fixtures)) {
    const name = path.split("/").pop()!;
    it(`${name}: a save without an edit writes the same bytes`, () => {
      const scene = open(text);
      expect(scene.dirty).toBe(false);
      expect(serializeScene(scene)).toBe(text);
      // A patch that changes nothing is not an edit.
      for (const el of scene.elements) updateElement(scene, el.id, { x: rawOf(scene, el.id).x, type: el.type === "line" ? rawOf(scene, el.id).type : el.type }, stamp);
      expect(scene.dirty).toBe(false);
      expect(serializeScene(scene)).toBe(text);
    });
    if (name === "non-canonical.excalidraw") continue;
    it(`${name}: re-serializing reproduces the file byte for byte`, () => {
      expect(stringifyScene(open(text))).toBe(text);
    });
  }

  it("re-serializes a hand-edited file to the same data", () => {
    const text = fixture("non-canonical");
    const scene = open(text);
    expect(stringifyScene(scene)).not.toBe(text);
    expect(JSON.parse(stringifyScene(scene))).toEqual(JSON.parse(text));
    expect(scene.style.indent).toBe("  ");
  });
});

describe("edits", () => {
  it("changes only the edited element, keeping its unknown keys and their order", () => {
    const text = fixture("excalidraw-web");
    const scene = open(text);
    const before = structuredClone(scene.data) as { elements: JsonObject[]; appState: JsonObject; files: JsonObject };
    const keys = Object.keys(rawOf(scene, "Kq3mVb1nT9xYz0aL2cDeF"));
    const el = updateElement(scene, "Kq3mVb1nT9xYz0aL2cDeF", { x: 0, backgroundColor: "#ffc9c9" }, stamp)!;
    expect(el.x).toBe(0);
    expect(el.version).toBe(15);
    expect(el.versionNonce).toBe(2 ** 30);
    expect(el.updated).toBe(1_800_000_000_000);
    const out = serializeScene(scene);
    const after = JSON.parse(out);
    expect(Object.keys(after.elements[0])).toEqual(keys);
    expect(after.elements[0].customData).toEqual(before.elements[0].customData);
    expect(after.elements[0].index).toBe("a0");
    expect(after.elements.slice(1)).toEqual(before.elements.slice(1));
    expect(after.appState).toEqual(before.appState);
    expect(after.files).toEqual(before.files);
    // Line by line, only the five changed values differ.
    const a = text.split("\n"), b = out.split("\n");
    expect(b.length).toBe(a.length);
    const diff = a.map((line, i) => [line, b[i]]).filter(([x, y]) => x !== y).map(([, y]) => y.trim().split(":")[0]);
    expect(diff).toEqual(['"x"', '"backgroundColor"', '"version"', '"versionNonce"', '"updated"']);
  });

  it("keeps unknown element types and unknown keys through an edit", () => {
    const scene = open(fixture("excalidraw-web"));
    const emb = findElement(scene, "emb-1")!;
    expect(emb.known).toBe(false);
    expect(emb.type).toBe("embeddable");
    expect(liveElements(scene).map(e => e.id)).not.toContain("emb-1");
    updateElement(scene, "txt-inside", { text: "changed", originalText: "changed" }, stamp);
    const out = JSON.parse(serializeScene(scene));
    const kept = out.elements.find((e: JsonObject) => e.id === "emb-1");
    expect(kept.futureField).toEqual({ anything: [true, null, "x"] });
    expect(kept.validated).toBe(true);
    expect(out.elements.find((e: JsonObject) => e.id === "txt-inside").baseline).toBe(18);
    expect(out.elements.find((e: JsonObject) => e.id === "arr-1").startBinding.fixedPoint).toBeNull();
    // An unknown type can be edited too, and stays what it was.
    updateElement(scene, "emb-1", { x: 1 }, stamp);
    expect(rawOf(scene, "emb-1").type).toBe("embeddable");
    expect(rawOf(scene, "emb-1").futureField).toEqual({ anything: [true, null, "x"] });
  });

  it("keeps a deleted element, and deleting marks rather than removes", () => {
    const scene = open(fixture("excalidraw-web"));
    expect(findElement(scene, "gone-1")!.isDeleted).toBe(true);
    expect(liveElements(scene).map(e => e.id)).not.toContain("gone-1");
    const count = (scene.data.elements as unknown[]).length;
    const keys = Object.keys(rawOf(scene, "frm-main"));
    deleteElement(scene, "frm-main", stamp);
    const out = JSON.parse(serializeScene(scene));
    expect(out.elements.length).toBe(count);
    const gone = out.elements.find((e: JsonObject) => e.id === "frm-main");
    expect(Object.keys(gone)).toEqual(keys);
    expect(gone.isDeleted).toBe(true);
    expect(gone.version).toBe(3);
    expect(gone.name).toBe("Main frame");
    expect(out.elements.find((e: JsonObject) => e.id === "gone-1").isDeleted).toBe(true);
    expect(liveElements(scene).map(e => e.id)).not.toContain("frm-main");
  });

  it("does not bump a patch that changes nothing", () => {
    const scene = open(fixture("cinder-shapes"));
    const el = scene.elements[0];
    const same = updateElement(scene, el.id, { roundness: { type: 3 }, groupIds: [] }, stamp)!;
    expect(same.version).toBe(el.version);
    expect(scene.dirty).toBe(false);
    expect(updateElement(scene, "no-such-id", { x: 1 })).toBeUndefined();
  });

  it("adds a missing key where a fresh element has it, and removes one set to undefined", () => {
    const scene = open(fixture("legacy"));
    updateElement(scene, "old-rect", { roundness: { type: 3 }, locked: true, strokeSharpness: undefined }, stamp);
    expect(Object.keys(rawOf(scene, "old-rect"))).toEqual([
      "id", "type", "x", "y", "width", "height", "angle", "strokeColor", "backgroundColor", "fillStyle", "strokeWidth",
      "strokeStyle", "roughness", "opacity", "groupIds", "roundness", "seed", "version", "versionNonce", "isDeleted", "boundElementIds", "updated", "locked",
    ]);
    expect(findElement(scene, "old-rect")!.roundness).toEqual({ type: 3 });
  });

  it("keeps records it can't read, in place, through an edit", () => {
    const scene = open(fixture("legacy"));
    updateElement(scene, "old-text", { text: "new" }, stamp);
    const out = JSON.parse(serializeScene(scene));
    expect(out.elements[4]).toBeNull();
    expect(out.elements[5]).toEqual({ type: "rectangle", x: 1, note: "no id, kept as is" });
    expect(out.elements[6]).toBe(42);
    expect(out.elements[3].baseline).toBe(18);
    expect(out.elements[2].type).toBe("draw");
  });

  it("keeps the file's own layout after an edit", () => {
    for (const name of ["tabs-crlf-bom", "minified", "excalidraw-web", "cinder-image"]) {
      const text = fixture(name);
      const scene = open(text);
      updateElement(scene, scene.elements[0].id, { y: 99 }, stamp);
      const out = serializeScene(scene);
      expect(out).not.toBe(text);
      expect(out.startsWith("\ufeff")).toBe(text.startsWith("\ufeff"));
      expect(out.endsWith("\n")).toBe(text.endsWith("\n"));
      expect(out.includes("\r\n")).toBe(text.includes("\r\n"));
      expect(out.split(/\r?\n/).length).toBe(text.split(/\r?\n/).length);
      expect(out.replace(/[^\t]/g, "").length).toBe(text.replace(/[^\t]/g, "").length);
    }
  });

  it("adds a complete new element", () => {
    const scene = open(fixture("cinder-empty"));
    const el = addElement(scene, "arrow", { x: 5, points: [[0, 0], [10, 10]] }, stamp) as LinearElement;
    expect(el.id).toHaveLength(20);
    expect(el.known).toBe(true);
    expect(el.points).toEqual([[0, 0], [10, 10]]);
    expect(el.endArrowhead).toBe("arrow");
    const out = JSON.parse(serializeScene(scene));
    expect(out.elements[0]).toEqual(newElementRecord("arrow", { x: 5, points: [[0, 0], [10, 10]] }, stamp));
    expect(Object.keys(out)).toEqual(["type", "version", "source", "elements", "appState", "files"]);
  });
});

describe("defaults and validation", () => {
  const minimal = (elements: unknown[]) => open(JSON.stringify({ type: "excalidraw", version: 2, elements }));

  it("fills in defaults per element type without writing them", () => {
    const types = ["rectangle", "diamond", "ellipse", "line", "arrow", "freedraw", "text", "image", "frame"];
    const text = JSON.stringify({ type: "excalidraw", version: 2, elements: types.map(type => ({ id: type, type })) });
    const scene = open(text);
    for (const el of scene.elements) {
      expect(el).toMatchObject({ x: 0, y: 0, width: 0, height: 0, angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, version: 1, isDeleted: false, locked: false, groupIds: [], frameId: null, roundness: null, boundElements: [], link: null, known: true });
    }
    expect(findElement(scene, "line")).toMatchObject({ points: [[0, 0]], startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: null });
    expect(findElement(scene, "arrow")).toMatchObject({ endArrowhead: "arrow", elbowed: false });
    expect(findElement(scene, "freedraw")).toMatchObject({ points: [[0, 0]], pressures: [], simulatePressure: true });
    expect(findElement(scene, "text")).toMatchObject({ text: "", originalText: "", fontSize: 20, fontFamily: 1, lineHeight: 1.25, textAlign: "left", verticalAlign: "top", containerId: null, autoResize: true });
    expect(findElement(scene, "image")).toMatchObject({ fileId: null, status: "saved", scale: [1, 1], crop: null });
    expect(findElement(scene, "frame")).toMatchObject({ name: null });
    expect(serializeScene(scene)).toBe(text);
  });

  it("reads old files the way Excalidraw upgrades them", () => {
    const scene = open(fixture("legacy"));
    expect(scene.elements.map(e => e.id)).toEqual(["old-rect", "old-arrow", "old-draw", "old-text"]);
    expect(findElement(scene, "old-rect")!.roundness).toEqual({ type: 3 });
    expect(findElement(scene, "old-rect")!.boundElements).toEqual([{ id: "old-arrow", type: "arrow" }]);
    expect(findElement(scene, "old-arrow")!.roundness).toEqual({ type: 2 });
    expect((findElement(scene, "old-arrow") as LinearElement).endArrowhead).toBe("arrow");
    expect((findElement(scene, "old-arrow") as LinearElement).startBinding).toEqual({ elementId: "old-rect", focus: 0, gap: 1 });
    expect(findElement(scene, "old-draw")).toMatchObject({ type: "line", known: true, roundness: null });
    expect((findElement(scene, "old-text") as TextElement).originalText).toBe("old text");
  });

  it("replaces bad values with defaults in the view only", () => {
    const scene = minimal([
      { id: "a", type: "rectangle", x: "12", opacity: 500, fillStyle: "plaid", strokeStyle: 3, strokeColor: "", groupIds: [1, 2], boundElements: [{ id: "b" }, null, { type: "arrow" }] },
      { id: "b", type: "freedraw", points: [[0, 0], [1], "x", [2, 3], [NaN, 1]], pressures: [0.5, "no"] },
      { id: "c", type: "text", text: 42, textAlign: "justify", fontSize: null },
      { id: "d", type: "image", scale: [2], crop: { x: 1 } },
      { id: "e", type: "arrow", points: [], startBinding: { focus: 1 }, endBinding: { elementId: "a", gap: "far" }, endArrowhead: null },
    ]);
    expect(findElement(scene, "a")).toMatchObject({ x: 0, opacity: 100, fillStyle: "solid", strokeStyle: "solid", strokeColor: "#1e1e1e", groupIds: [], boundElements: [{ id: "b", type: "arrow" }] });
    expect(findElement(scene, "b") as FreedrawElement).toMatchObject({ points: [[0, 0], [2, 3]], pressures: [], simulatePressure: true });
    expect(findElement(scene, "c") as TextElement).toMatchObject({ text: "42", textAlign: "left", fontSize: 20 });
    expect(findElement(scene, "d") as ImageElement).toMatchObject({ scale: [1, 1], crop: { x: 1 } });
    expect(findElement(scene, "e") as LinearElement).toMatchObject({ points: [[0, 0]], startBinding: null, endBinding: { elementId: "a", focus: 0, gap: 0 }, endArrowhead: null });
    expect(rawOf(scene, "a").opacity).toBe(500);
  });

  it("reads files and appState", () => {
    const scene = open(fixture("excalidraw-web"));
    expect(scene.appState).toEqual({ viewBackgroundColor: "#fffce8", gridSize: 20 });
    expect([...scene.files.keys()]).toEqual(["6a1f0c9e2b7d4e8f", "unused-file"]);
    expect(scene.files.get("6a1f0c9e2b7d4e8f")).toMatchObject({ mimeType: "image/png", created: 1760001243000 });
    expect((findElement(scene, "img-1") as ImageElement).scale).toEqual([-1, 1]);
    expect(open(fixture("tabs-crlf-bom")).appState).toEqual({ viewBackgroundColor: "#ffffff", gridSize: null });
  });

  it("opens Cinder's files with every element known", () => {
    for (const name of ["cinder-shapes", "cinder-bindings", "cinder-image"]) {
      const scene = open(fixture(name));
      expect(scene.elements.length).toBeGreaterThan(0);
      expect(scene.elements.every(e => e.known)).toBe(true);
    }
    const bindings = open(fixture("cinder-bindings"));
    const texts = bindings.elements.filter((e): e is TextElement => e.type === "text");
    expect(texts.map(t => !!t.containerId && !!findElement(bindings, t.containerId))).toEqual([true, true]);
    const arrow = bindings.elements.find((e): e is LinearElement => e.type === "arrow")!;
    expect(findElement(bindings, arrow.startBinding!.elementId)!.type).toBe("rectangle");
    expect(arrow.startArrowhead).toBe("dot");
  });
});

describe("refusing files", () => {
  it("refuses every bad fixture", () => {
    expect(Object.keys(bad).length).toBeGreaterThanOrEqual(6);
    for (const [path, text] of Object.entries(bad)) {
      const result = parseScene(text);
      expect(result.ok, path).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/drawing|JSON/);
      expect(isDrawingText(text)).toBe(false);
    }
  });

  it("refuses other non-drawings", () => {
    for (const text of ["null", "1", '"text"', "true", "{}", '{"type":"excalidraw","elements":"x"}', '{"elements":null}', "{,}", "\ufeff[]"]) {
      expect(parseScene(text).ok, text).toBe(false);
    }
    expect(parseScene('{"type":"excalidraw/clipboard","elements":[]}').ok).toBe(false);
  });

  it("opens a drawing with no elements key, and a bare elements list", () => {
    expect(parseScene('{"type":"excalidraw","version":2}').ok).toBe(true);
    expect(parseScene('{"elements":[]}').ok).toBe(true);
  });

  it("opens a blank file as an empty drawing and leaves it blank until edited", () => {
    for (const text of ["", "  \n", "\ufeff"]) {
      const scene = open(text);
      expect(scene.elements).toEqual([]);
      expect(serializeScene(scene)).toBe(text);
      addElement(scene, "rectangle", { width: 10 }, stamp);
      const out = serializeScene(scene);
      expect(JSON.parse(out.replace(/^\ufeff/, "")).elements).toHaveLength(1);
      expect(out.startsWith("\ufeff")).toBe(text.startsWith("\ufeff"));
    }
    expect(stringifyScene(open(emptyDrawing()))).toBe(emptyDrawing());
  });
});

describe("speed", () => {
  function bigDrawing(count: number) {
    let n = 0;
    const random = () => (n = (n * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const s = { now: () => 1_760_000_000_000, random };
    const elements: JsonObject[] = [];
    for (let i = 0; i < count; i++) {
      const at = { x: (i % 100) * 150, y: Math.floor(i / 100) * 120, width: 120, height: 80 };
      switch (i % 5) {
        case 0: elements.push(newElementRecord("rectangle", { ...at, roundness: { type: 3 }, boundElements: [{ type: "text", id: `t${i}` }] }, s)); break;
        case 1: elements.push(newElementRecord("text", { ...at, text: `Label ${i}\nline two`, originalText: `Label ${i} line two`, containerId: `r${i}` }, s)); break;
        case 2: elements.push(newElementRecord("arrow", { ...at, points: [[0, 0], [60, 20], [120, 80]], startBinding: { elementId: "a", focus: 0.1, gap: 4 } }, s)); break;
        case 3: elements.push(newElementRecord("freedraw", { ...at, points: Array.from({ length: 40 }, (_, k) => [k * 3, Math.sin(k) * 20]), pressures: Array.from({ length: 40 }, () => 0.5), simulatePressure: false }, s)); break;
        default: elements.push(newElementRecord("ellipse", { ...at, fillStyle: "hachure", backgroundColor: "#a5d8ff", customData: { tag: i } }, s));
      }
    }
    return JSON.stringify({ type: "excalidraw", version: 2, source: "grove", elements, appState: { gridSize: null, viewBackgroundColor: "#ffffff" }, files: {} }, null, 2) + "\n";
  }

  // Fields a renderer reads from every element on its first draw.
  const FIELDS = ["x", "y", "width", "height", "angle", "strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness", "opacity", "seed", "isDeleted", "groupIds", "roundness", "boundElements", "points", "endArrowhead", "text", "fontSize", "textAlign", "containerId"] as const;

  it("parses a 5,000-element drawing in under 20 ms", () => {
    const text = bigDrawing(5000);
    const median = (f: () => unknown) => {
      for (let i = 0; i < 3; i++) f();
      const samples: number[] = [];
      for (let i = 0; i < 9; i++) {
        const start = performance.now();
        f();
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      return samples[samples.length >> 1];
    };
    const scene = open(text);
    const json = median(() => JSON.parse(text));
    const parse = median(() => parseScene(text));
    const draw = median(() => { const s = open(text); for (const el of s.elements) for (const f of FIELDS) void (el as unknown as Record<string, unknown>)[f]; });
    console.log(`5,000 elements (${(text.length / 1e6).toFixed(1)} MB): parseScene median ${parse.toFixed(1)} ms, JSON.parse alone ${json.toFixed(1)} ms, parse + every field read ${draw.toFixed(1)} ms`);
    expect(scene.elements).toHaveLength(5000);
    expect(stringifyScene(scene)).toBe(text);
    expect(parse).toBeLessThan(20);
    // The model adds little to JSON.parse, which is the floor for any parser here.
    expect(parse).toBeLessThan(json * 1.25 + 2);
    expect(draw).toBeLessThan(50);
  });
});
