// Plain DOM/SVG board. Detached, read-only editor contexts reuse Reading's
// renderer and local embeds; no canvas text ever enters a saving editor.
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { api } from "../api";
import { IMAGE_EXT, embedPart, embedSection } from "../editor/embeds";
import { editorHost } from "../editor/host";
import { readingMode, release, render } from "../editor/render";
import { isExternalUrl, isNotePath } from "../links/external";
import { resolveLink } from "../links/internal";
import { h } from "../shell/dom";
import type { Group, Tab } from "../tabs";
import { whereFromEvent } from "../tabs";
import type { Workspace } from "../workspace";
import { canvasNavigation } from "./navigation";
import { edgeCurve, readCanvas } from "./model";

const NS = "http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
const presets = ["red", "orange", "yellow", "green", "cyan", "purple"];
function color(value?: string) {
  return value && /^[1-6]$/.test(value) ? `var(--color-${presets[Number(value) - 1]})` : value && /^#[0-9a-f]{6}$/i.test(value) ? value : "var(--background-modifier-border-focus)";
}
export function createCanvasView(ws: Workspace, path: string, group: Group, tab: Tab) {
  const host = ws.editors.viewOf(group).state.facet(editorHost)!;
  const world = h("div", { class: "canvas-world" });
  const el = h("div", { class: "view-content canvas-view is-reading-mode", "aria-label": "Canvas (read only)", tabindex: "0" }, world);
  let gone = false, generation = 0;
  let cleanups: (() => void)[] = [];
  const clear = () => { cleanups.splice(0).reverse().forEach(fn => fn()); world.replaceChildren(); };
  const navigation = canvasNavigation(el, world, tab, path);
  async function load() {
    const mine = ++generation;
    let text: string;
    try { text = await api.readNote(path); } catch { text = ""; }
    if (gone || mine !== generation) return;
    clear();
    const { nodes, edges } = readCanvas(text);
    const bounds = nodes.length ? { left: Math.min(...nodes.map(n => n.x)), top: Math.min(...nodes.map(n => n.y)), right: Math.max(...nodes.map(n => n.x + n.width)), bottom: Math.max(...nodes.map(n => n.y + n.height)) } : { left: 0, top: 0, right: 0, bottom: 0 };
    const drawing = svg("svg", { class: "canvas-edges", overflow: "visible" });
    world.append(drawing);
    const byId = new Map(nodes.map(n => [n.id, n]));
    edges.forEach((edge, i) => {
      const curve = edgeCurve(byId.get(edge.fromNode)!, byId.get(edge.toNode)!, edge);
      const line = svg("path", { d: curve.path, fill: "none", stroke: color(edge.color), "stroke-width": "2" });
      for (const [end, enabled] of [["start", edge.fromEnd === "arrow"], ["end", edge.toEnd !== "none"]] as const) {
        if (!enabled) continue;
        const id = `canvas-arrow-${group.id}-${mine}-${i}-${end}`;
        const marker = svg("marker", { id, viewBox: "0 0 10 10", refX: "10", refY: "5", markerWidth: "10", markerHeight: "10", markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" });
        marker.append(svg("path", { d: "M0,0 L10,5 L0,10 Z", fill: color(edge.color), stroke: color(edge.color), "stroke-width": "2" }));
        drawing.append(marker);
        line.setAttribute(`marker-${end}`, `url(#${id})`);
      }
      drawing.append(line);
      if (typeof edge.label === "string" && edge.label) {
        const label = h("div", { class: "canvas-edge-label" }, edge.label);
        label.style.left = `${curve.x}px`; label.style.top = `${curve.y}px`;
        world.append(label);
      }
    });
    for (const node of nodes) {
      const card = h("div", { class: `canvas-node canvas-node-${node.type}`, "data-node-id": node.id });
      Object.assign(card.style, { left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px` });
      if (node.color) card.classList.add("is-colored");
      card.style.setProperty("--canvas-color", color(node.color));
      world.append(card);
      if (node.type === "file" && node.file) cleanups.push(ws.embeds.watch(node.file, () => void load()));
      if (node.type === "group") {
        card.append(h("div", { class: "canvas-group-label" }, node.label ?? ""));
        continue;
      }
      if (node.type === "file" || node.type === "link") {
        const label = h("div", { class: "canvas-file-label" }, node.type === "link" ? node.url ?? "" : `${node.file ?? ""}${node.subpath ? ` › ${node.subpath.replace(/^#/, "")}` : ""}`);
        card.append(label);
      }
      const content = h("div", { class: "canvas-node-content markdown-rendered" });
      card.append(content);
      if (node.type === "link") {
        const url = node.url ?? "";
        const link = h("a", { class: "cm-link cm-rendered-link", role: "link", tabindex: "0" }, url);
        const open = () => { if (isExternalUrl(url)) void api.openExternal(url).catch(console.warn); };
        link.addEventListener("click", e => { if (e.isTrusted) open(); });
        link.addEventListener("keydown", e => { if (e.isTrusted && e.key === "Enter") open(); });
        content.append(link);
        continue;
      }
      if (node.type === "file" && IMAGE_EXT.test(node.file ?? "")) {
        const img = h("img", { alt: node.file ?? "" });
        content.append(img);
        const held = ws.embeds.image(node.file!);
        cleanups.push(() => held.release());
        void held.url.then(url => { if (!gone && mine === generation) img.src = url; }, () => { if (!gone && mine === generation) content.textContent = `File not found: ${node.file}`; });
        continue;
      }
      if (node.type === "file" && !/\.md$/i.test(node.file ?? "")) {
        content.textContent = node.file ? `Unsupported file: ${node.file}` : "File not found";
        continue;
      }
      const origin = node.type === "file" ? node.file! : path;
      const resolve = (href: string) => resolveLink(href, origin, ws.vault.files.filter(f => !f.is_dir));
      const context = new EditorView({ state: EditorState.create({ extensions: [EditorState.readOnly.of(true), readingMode.of(true), editorHost.of({
        ...host, contextMenu: undefined, linkExists: href => !!resolve(href),
        openLink: (href, where) => {
          const hash = href.indexOf("#"), name = hash < 0 ? href : href.slice(0, hash);
          void ws.openLink(`${name ? resolve(name) ?? name : origin}${hash < 0 ? "" : href.slice(hash)}`, where, group);
        },
        embeds: { ...ws.embeds, pathOf: () => origin, resolve: href => resolve(href), toggleTask: () => {} },
      })] }) });
      cleanups.push(() => context.destroy());
      content.addEventListener("click", event => {
        const link = (event.target as Element).closest<HTMLElement>("[data-href]");
        if (!event.isTrusted || !link) return;
        event.preventDefault();
        const href = link.dataset.href!;
        if (isNotePath(href) || href.startsWith("#")) {
          const hash = href.indexOf("#"), name = hash < 0 ? href : href.slice(0, hash);
          void ws.openLink(`${name ? resolve(name) ?? name : origin}${hash < 0 ? "" : href.slice(hash)}`, whereFromEvent(event), group);
        } else if (isExternalUrl(href)) void api.openExternal(href).catch(console.warn);
      });
      const paint = (source: string) => {
        if (gone || mine !== generation) return;
        const body = embedPart(source, "")?.text ?? source;
        const painted = render(content, body, context, [origin], () => {});
        content.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => input.disabled = true);
        cleanups.push(() => release(painted));
        const section = node.subpath && embedSection(body, node.subpath.replace(/^#/, ""));
        if (section) requestAnimationFrame(() => {
          if (gone || mine !== generation) return;
          const target = content.querySelector<HTMLElement>(`[data-line="${section.line + 1}"]`);
          if (target) { content.style.paddingBottom = `${node.height}px`; content.scrollTop = target.offsetTop - content.offsetTop - 16; }
        });
      };
      if (node.type === "text") paint(node.text ?? "");
      else void ws.embeds.read(origin).then(paint, () => { if (!gone && mine === generation) content.textContent = `File not found: ${origin}`; });
    }
    navigation.loaded(bounds);
  }
  const unwatch = ws.vault.onModified(changed => { if (changed === path) void load(); });
  void load();
  return { el, dispose() { gone = true; navigation.dispose(); unwatch(); clear(); el.remove(); } };
}
