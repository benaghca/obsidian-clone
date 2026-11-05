import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { expect, test } from "vitest";
import { editingEmbed } from "./embeds";
import { LivePreview } from "./livePreview";
import { readingMode } from "./render";
import { markdownSyntax } from "./syntax";
import { frameHeight, frameOrigins, isWebPage, playerUrl, resizedWebAlt, type WebEmbedMode, webEmbedMode, WebEmbedWidget, webEmbedSize } from "./webEmbed";
import { mockFrameOrigin } from "../mock/backend";
import { importMessage, planImport } from "../settings/foreign";
import { APP } from "../settings/schema";

test("a web page is an http(s) address with a host, no user name, and a path that isn't an image", () => {
  for (const url of ["https://example.com", "http://example.com/page?q=1#top", "https://sub.example.co.uk/a/b.html", "http://127.0.0.1:8123/page", "https://example.com/pic.png.html"]) {
    expect(isWebPage(url), url).toBe(true);
  }
  for (const url of [
    "https://example.com/pic.png",
    "https://example.com/a/PIC.JPEG?w=200",
    "https://example.com/logo.svg#x",
    "ftp://example.com",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://",
    "https:///path",
    "https://user:pw@example.com",
    "https://example.com/a b",
    "Note.md",
  ]) {
    expect(isWebPage(url), url).toBe(false);
  }
});

test("the size is the alt text after its last |, as Cinder writes it", () => {
  expect(webEmbedSize("")).toEqual({ caption: "", width: null, height: null });
  expect(webEmbedSize("|600x400")).toEqual({ caption: "", width: 600, height: 400 });
  expect(webEmbedSize("600x400")).toEqual({ caption: "", width: 600, height: 400 });
  expect(webEmbedSize("x380")).toEqual({ caption: "", width: null, height: 380 });
  expect(webEmbedSize("|x380")).toEqual({ caption: "", width: null, height: 380 });
  expect(webEmbedSize("700")).toEqual({ caption: "", width: 700, height: null });
  expect(webEmbedSize("My page|640 x 360")).toEqual({ caption: "My page", width: 640, height: 360 });
  expect(webEmbedSize("a|b|300x200")).toEqual({ caption: "a|b", width: 300, height: 200 });
  expect(webEmbedSize("My page")).toEqual({ caption: "My page", width: null, height: null });
  expect(webEmbedSize("caption|")).toEqual({ caption: "caption|", width: null, height: null });
  // The frame's height is kept between 120 and 2400, 480 by default.
  expect(frameHeight(webEmbedSize(""))).toBe(480);
  expect(frameHeight(webEmbedSize("x20"))).toBe(120);
  expect(frameHeight(webEmbedSize("x99999"))).toBe(2400);
});

test("a resize writes |WxH, keeps the caption, and a reset drops the size", () => {
  expect(resizedWebAlt("", 600, 400)).toBe("|600x400");
  expect(resizedWebAlt("|600x400", 640, 360)).toBe("|640x360");
  expect(resizedWebAlt("caption", null, 400)).toBe("caption|x400");
  expect(resizedWebAlt("caption|200", 300, 250)).toBe("caption|300x250");
  expect(resizedWebAlt("caption|300x250", null, null)).toBe("caption");
  expect(resizedWebAlt("|300x250", null, null)).toBe("");
  // What it writes reads back as the same size.
  expect(webEmbedSize(resizedWebAlt("caption", 512, 288))).toEqual({ caption: "caption", width: 512, height: 288 });
});

test("YouTube and Vimeo pages become their players; other pages load as they are", () => {
  const yt = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
  expect(playerUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(yt);
  expect(playerUrl("https://youtube.com/watch?v=dQw4w9WgXcQ&list=x")).toBe(yt);
  expect(playerUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(yt);
  expect(playerUrl("http://youtu.be/dQw4w9WgXcQ")).toBe(yt);
  expect(playerUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe(yt);
  expect(playerUrl("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe(yt);
  expect(playerUrl("https://youtu.be/dQw4w9WgXcQ?t=90")).toBe(`${yt}?start=90`);
  expect(playerUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s")).toBe(`${yt}?start=90`);
  expect(playerUrl("https://vimeo.com/76979871")).toBe("https://player.vimeo.com/video/76979871");
  expect(playerUrl("https://vimeo.com/76979871/abc123")).toBe("https://player.vimeo.com/video/76979871?h=abc123");
  for (const url of [
    "https://www.youtube.com/",
    "https://www.youtube.com/watch?v=",
    "https://www.youtube.com/watch?v=a<b>c&d",
    "https://www.youtube.com/@channel",
    "https://vimeo.com/channels/staffpicks",
    "https://vimeo.com/76979871/not-a-hash!",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "http://127.0.0.1:8123/page",
  ]) {
    expect(playerUrl(url), url).toBe(url);
  }
});

test("the origins registered: the page's own, plus its www twin and https for a domain", () => {
  expect(frameOrigins("http://127.0.0.1:8123/page?x=1")).toEqual(["http://127.0.0.1:8123"]);
  expect(frameOrigins("http://localhost:3000/")).toEqual(["http://localhost:3000"]);
  expect(frameOrigins("https://example.com:8443/a")).toEqual(["https://example.com:8443"]);
  expect(frameOrigins("https://Example.COM/a")).toEqual(["https://example.com", "https://www.example.com"]);
  expect(frameOrigins("https://www.example.com:443/a")).toEqual(["https://www.example.com", "https://example.com"]);
  expect(frameOrigins("http://example.com/a")).toEqual(["http://example.com", "http://www.example.com", "https://example.com", "https://www.example.com"]);
  expect(frameOrigins(playerUrl("https://youtu.be/dQw4w9WgXcQ"))).toEqual(["https://www.youtube-nocookie.com", "https://youtube-nocookie.com"]);
  // Every one is in the form allow_frame_origin takes.
  for (const src of ["http://example.com/a", "https://www.example.com:443/a", "http://127.0.0.1:8123/page"]) {
    for (const origin of frameOrigins(src)) expect(mockFrameOrigin(origin)).toBe(origin);
  }
});

test("the mock's allow_frame_origin refuses what the Rust command refuses", () => {
  expect(mockFrameOrigin("HTTPS://Example.com:443")).toBe("https://example.com");
  expect(mockFrameOrigin("http://127.0.0.1:8123")).toBe("http://127.0.0.1:8123");
  for (const bad of ["", "example.com", "https://example.com/", "https://example.com/a", "https://example.com?q", "https://example.com#f", "https://u@example.com", "file:///x", "javascript:alert(1)", "data:text/html,x", " https://example.com", "https://exa mple.com"]) {
    expect(() => mockFrameOrigin(bad), bad).toThrow();
  }
});

// What Live Preview draws for a note, in each mode, with the caret at `caret`.
function draw(doc: string, mode: WebEmbedMode | null, caret = 0, reading = false) {
  const extensions = [markdownSyntax, editingEmbed, readingMode.of(reading), mode ? webEmbedMode.of(mode) : []];
  const view = {
    state: EditorState.create({ doc, selection: { anchor: caret }, extensions }),
    hasFocus: true,
    get visibleRanges() {
      return [{ from: 0, to: this.state.doc.length }];
    },
    plugin: () => lp,
    dispatch(spec: TransactionSpec) {
      const tr = this.state.update(spec);
      const startState = this.state;
      this.state = tr.state;
      const u = { view, state: tr.state, startState, transactions: [tr], changes: tr.changes, docChanged: tr.docChanged, selectionSet: !!tr.selection, focusChanged: false, viewportChanged: false };
      lp.update(u as unknown as ViewUpdate);
    },
  };
  const lp = new LivePreview(view as unknown as EditorView);
  const widgets = () => {
    const out: { from: number; to: number; widget: unknown }[] = [];
    lp.decorations.between(0, view.state.doc.length, (from, to, d) => void (d.spec.widget && out.push({ from, to, widget: d.spec.widget })));
    return out;
  };
  return { view, lp, widgets };
}
const pages = (w: { widget: unknown }[]) => w.filter((x) => x.widget instanceof WebEmbedWidget).map((x) => x.widget as WebEmbedWidget);

test("![](page) alone on a line is a web embed; inline, an image, or with the setting off, it is not", () => {
  const note = "Intro\n![|640x360](http://127.0.0.1:8123/page)\n";
  const [page] = pages(draw(note, "always").widgets());
  expect(page).toBeInstanceOf(WebEmbedWidget);
  expect(page.url).toBe("http://127.0.0.1:8123/page");
  expect(page.mode).toBe("always");
  // Where its alt text and address are, from the embed's start.
  expect(note.slice(6 + page.altAt, 6 + page.altAt + page.alt.length)).toBe("|640x360");
  expect(note.slice(6 + page.urlAt, 6 + page.urlAt + page.urlLength)).toBe("http://127.0.0.1:8123/page");
  expect(pages(draw(note, "click").widgets())[0].mode).toBe("click");
  // Indented or followed by spaces is still alone on its line.
  expect(pages(draw("  ![](https://example.com)  ", "always").widgets())).toHaveLength(1);
  // Off, inline, an image address, or a view without the setting (a canvas card): no frame.
  expect(pages(draw(note, "off").widgets())).toHaveLength(0);
  expect(pages(draw(note, null).widgets())).toHaveLength(0);
  expect(pages(draw("See ![](https://example.com) here", "always").widgets())).toHaveLength(0);
  expect(pages(draw("![a](https://example.com/pic.png)", "always").widgets())).toHaveLength(0);
  expect(pages(draw("![a](https://example.com) ![b](https://example.org)", "always").widgets())).toHaveLength(0);
  // Like an image, it stays drawn while the caret is on its line.
  expect(pages(draw(note, "always", 8).widgets())).toHaveLength(1);
  // Reading view draws it too.
  expect(pages(draw(note, "always", 0, true).widgets())[0].reading).toBe(true);
});

test("the setting changing redraws the embeds", () => {
  const { view, widgets } = draw("![](https://example.com)", "always");
  expect(pages(widgets())).toHaveLength(1);
  const off = EditorState.create({ doc: view.state.doc, extensions: [markdownSyntax, editingEmbed, webEmbedMode.of("off")] });
  const before = view.state;
  view.state = off;
  // A real reconfigure is a transaction; here the plugin is told the facet changed.
  const lp = view.plugin();
  lp.update({ view, state: off, startState: before, transactions: [], changes: off.changes([]), docChanged: false, selectionSet: false, focusChanged: false, viewportChanged: false } as unknown as ViewUpdate);
  expect(pages(widgets())).toHaveLength(0);
});

test("Settings: always by default; Cinder's auto, click and off import as always, click and off", () => {
  expect(APP.webEmbeds.default).toBe("always");
  expect(APP.webEmbeds.valid("click")).toBe(true);
  expect(APP.webEmbeds.valid("auto")).toBe(false);
  const none = { cinder: null, daily: null, templates: null, app: null };
  const cinder = (webEmbeds: unknown) => planImport({ ...none, cinder: JSON.stringify({ attachFolder: "", templatesFolder: "", webEmbeds }) });
  // Cinder's default is Grove's: nothing to import or report.
  expect(cinder("auto").values["app.json"]).toEqual({});
  expect(cinder("auto").notImported).toEqual([]);
  expect(cinder("click").values["app.json"]).toEqual({ webEmbeds: "click" });
  expect(cinder("click").imported).toEqual([{ label: "Embedded web pages", value: "click to load" }]);
  expect(importMessage(cinder("off"))).toContain("• Embedded web pages: off (links only)");
  expect(cinder("sometimes").notImported).toEqual(['Embedded web pages ("sometimes" isn\'t a value Grove takes)']);
});
