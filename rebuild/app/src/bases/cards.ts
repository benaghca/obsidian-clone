import "../styles/bases-cards.css";
import { api } from "../api";
import { asType, fits, type PropertyType } from "../editor/frontmatter";

export const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;
import { noteName, parentDir } from "../paths";
import { formatDate } from "../settings/dateFormat";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import { tagsInText } from "../shell/linksTags";
import { propertyIndex } from "../shell/propertyIndex";
import { vaultTags } from "../shell/vaultTags";
import { whereFromEvent, type Group } from "../tabs";
import type { Workspace } from "../workspace";
import type { Value } from "./expression";
import { baseModel, baseNoteFiles, noteKey, type Row } from "./model";
import { writeView } from "./write";
import { mapping } from "./yaml";

export type BaseModel = ReturnType<typeof baseModel>;
export type SelectedEntry = ReturnType<BaseModel["select"]>[number];

export interface CardLayoutInput {
  count: number;
  width: number;
  height: number;
  scrollTop: number;
  cardSize: number;
  propCount: number;
  coverHeight: number;
  gap?: number;
  padding?: number;
  overscanRows?: number;
}

export interface CardLayoutResult {
  cols: number;
  cardHeight: number;
  rowPitch: number;
  totalRows: number;
  virtual: boolean;
  firstRow: number;
  endRow: number;
  firstIndex: number;
  endIndex: number;
  topSpace: number;
  bottomSpace: number;
  visibleStartRow: number;
  visibleEndRow: number;
}

/** Pure grid layout and virtualization calculation for card views. */
export function cardLayout(input: CardLayoutInput): CardLayoutResult {
  const gap = input.gap ?? 16;
  const padding = input.padding ?? 16;
  const overscanRows = input.overscanRows ?? 2;
  const cardSize = Math.max(80, input.cardSize || 220);
  const effWidth = input.width > 0 ? input.width : 880;
  const effHeight = input.height > 0 ? input.height : 600;
  const scrollTop = Math.max(0, input.scrollTop || 0);
  const innerWidth = Math.max(cardSize, effWidth - padding * 2);
  const cols = Math.max(1, Math.floor((innerWidth + gap) / (cardSize + gap)));
  const coverHeight = Math.max(0, input.coverHeight || 0);
  const propCount = Math.max(0, input.propCount || 0);
  // 2px border + coverHeight + 22px body vertical padding + 20px title + (8px title gap + 22px per property row)
  const cardHeight = 2 + coverHeight + 22 + 20 + (propCount > 0 ? 8 + propCount * 22 : 0);
  const rowPitch = cardHeight + gap;
  const count = Math.max(0, input.count || 0);
  const totalRows = count > 0 ? Math.ceil(count / cols) : 0;
  const virtual = count > 200;
  const visibleRows = Math.max(1, Math.ceil(effHeight / rowPitch));
  const rawStartRow = Math.max(0, Math.floor((scrollTop - padding) / rowPitch));
  const visibleStartRow = Math.min(totalRows, rawStartRow);
  const visibleEndRow = Math.min(totalRows, Math.max(visibleStartRow + 1, Math.ceil((scrollTop + effHeight - padding) / rowPitch)));
  const firstRow = virtual
    ? Math.min(Math.max(0, totalRows - visibleRows), Math.max(0, rawStartRow - overscanRows))
    : 0;
  const endRow = virtual
    ? Math.min(totalRows, firstRow + visibleRows + overscanRows * 2)
    : totalRows;
  const firstIndex = firstRow * cols;
  const endIndex = Math.min(count, endRow * cols);
  const topSpace = virtual ? firstRow * rowPitch : 0;
  const bottomSpace = virtual ? Math.max(0, (totalRows - endRow) * rowPitch) : 0;
  return {
    cols,
    cardHeight,
    rowPitch,
    totalRows,
    virtual,
    firstRow,
    endRow,
    firstIndex,
    endIndex,
    topSpace,
    bottomSpace,
    visibleStartRow,
    visibleEndRow,
  };
}

/** Clean a frontmatter/formula image property value and resolve it to a vault image path. */
export function resolveCoverPath(ws: Workspace, rawValue: Value, fromPath: string): string | null {
  let raw = "";
  if (typeof rawValue === "string") raw = rawValue.trim();
  else if (Array.isArray(rawValue) && rawValue.length > 0) raw = String(rawValue[0] ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("![[") && raw.endsWith("]]")) raw = raw.slice(3, -2).trim();
  else if (raw.startsWith("[[") && raw.endsWith("]]")) raw = raw.slice(2, -2).trim();
  else {
    const mdMatch = /^!?\[[^\]]*\]\(([^)]+)\)$/.exec(raw);
    if (mdMatch) raw = mdMatch[1].trim();
  }
  const pipeIdx = raw.indexOf("|");
  if (pipeIdx !== -1) raw = raw.slice(0, pipeIdx).trim();
  const hashIdx = raw.indexOf("#");
  if (hashIdx !== -1) raw = raw.slice(0, hashIdx).trim();
  if (!raw) return null;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Keep raw string if percent-decoding fails
  }
  const resolved = ws.resolve(raw, fromPath);
  if (resolved && IMAGE_EXT.test(resolved)) return resolved;
  const lower = raw.toLowerCase();
  const match = ws.vault.files.find(
    (f) => !f.is_dir && IMAGE_EXT.test(f.path) && (f.path.toLowerCase() === lower || f.name.toLowerCase() === lower),
  );
  return match ? match.path : null;
}

interface CoverHandle {
  path: string;
  held: ReturnType<Workspace["embeds"]["image"]>;
  unwatch: () => void;
}

export function createCardGrid(ws: Workspace, group: Group, scroller: HTMLElement) {
  const el = h("div", { class: "bases-cards", role: "list", "aria-label": "Results" });
  const covers = new WeakMap<HTMLElement, CoverHandle>();
  const activeCovers = new Set<HTMLElement>();
  let currentModel: BaseModel | null = null;
  let currentSelected: SelectedEntry[] = [];
  let currentTypes = new Map<string, PropertyType>();
  let lastFirstIndex = -1;
  let lastEndIndex = -1;
  let lastCols = -1;
  let lastLayout: CardLayoutResult | null = null;
  let gone = false;

  function releaseCover(card: HTMLElement) {
    const handle = covers.get(card);
    if (!handle) return;
    covers.delete(card);
    activeCovers.delete(card);
    handle.unwatch();
    handle.held.release();
  }

  function releaseAllCovers() {
    for (const card of [...activeCovers]) releaseCover(card);
    activeCovers.clear();
  }

  function propType(key: string, value: Value): PropertyType {
    if (key === "file.mtime" || key === "file.ctime") return "datetime";
    if (key === "file.tags") return "tags";
    if (key === "file.size" || typeof value === "number") return "number";
    return currentTypes.get(noteKey(key)) ?? (Array.isArray(value) ? "list" : typeof value === "boolean" ? "checkbox" : "text");
  }

  function renderCardValue(key: string, entry: SelectedEntry, model: BaseModel): HTMLElement {
    let value = entry.context.get(key);
    const p = entry.row.props.find((prop) => prop.key === noteKey(key));
    const want = propertyIndex(ws).host.typeOf(noteKey(key));
    if (p && want && fits(p, want)) value = asType(p, want);
    const kind = propType(key, value);
    const box = h("div", {
      class: "bases-card-value",
      "data-property": key,
      "data-value": value === null ? "" : Array.isArray(value) ? value.join(", ") : String(value),
      "data-type": kind,
    });
    if (value === null || value === "") return box;
    if (kind === "date" || kind === "datetime") {
      const text = /Z$/.test(String(value)) ? formatDate(new Date(String(value)), "YYYY-MM-DDTHH:mm:ss") : String(value);
      box.textContent = text;
    } else if (typeof value === "boolean") {
      const checkbox = h("input", { type: "checkbox", "aria-label": model.label(key) });
      checkbox.checked = value;
      checkbox.disabled = true;
      box.append(checkbox);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item === null || item === "") continue;
        box.append(h("span", { class: "property-pill is-tag" }, String(item)));
      }
    } else {
      box.textContent = String(value);
    }
    return box;
  }

  function loadCoverForCard(card: HTMLElement) {
    if (gone || covers.has(card)) return;
    const coverBox = card.querySelector<HTMLElement>(".bases-card-cover");
    const coverPath = coverBox?.dataset.coverPath;
    if (!coverBox || !coverPath) return;
    const fit = coverBox.dataset.imageFit === "contain" ? "contain" : "cover";
    const applyImage = (held: ReturnType<Workspace["embeds"]["image"]>) => {
      void held.url.then(
        (url) => {
          if (gone || covers.get(card)?.held !== held) return;
          let img = coverBox.querySelector<HTMLImageElement>("img.bases-card-image");
          if (!img) {
            img = h("img", { class: "bases-card-image", alt: "" });
            img.decoding = "async";
            coverBox.replaceChildren(img);
          }
          img.style.objectFit = fit;
          img.src = url;
        },
        () => {},
      );
    };
    const held = ws.embeds.image(coverPath);
    const unwatch = ws.embeds.watch(coverPath, () => {
      const current = covers.get(card);
      if (!current || gone) return;
      current.held.release();
      const nextHeld = ws.embeds.image(coverPath);
      current.held = nextHeld;
      applyImage(nextHeld);
    });
    covers.set(card, { path: coverPath, held, unwatch });
    activeCovers.add(card);
    applyImage(held);
  }

  function syncVisibleCovers() {
    if (gone || !currentModel || !currentModel.image || !lastLayout) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const hasViewport = scrollerRect.height > 0 && scrollerRect.width > 0;
    const cards = el.querySelectorAll<HTMLElement>(".bases-card");
    for (const card of cards) {
      if (covers.has(card)) continue;
      const idx = Number(card.dataset.index ?? "-1");
      if (idx < 0) continue;
      const row = Math.floor(idx / lastLayout.cols);
      const inRowRange = row >= lastLayout.visibleStartRow && row < lastLayout.visibleEndRow;
      if (!inRowRange) continue;
      if (hasViewport) {
        const rect = card.getBoundingClientRect();
        if (rect.height > 0 && (rect.bottom <= scrollerRect.top || rect.top >= scrollerRect.bottom)) continue;
      }
      loadCoverForCard(card);
    }
  }

  function buildCard(entry: SelectedEntry, index: number, model: BaseModel, propKeys: string[], coverHeight: number): HTMLElement {
    const filePath = entry.row.file.path;
    const openCard = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest("input,button,a")) return;
      e.preventDefault();
      void ws.open(filePath, { where: e.button === 1 ? "tab" : whereFromEvent(e), group });
    };
    const card = h("div", {
      class: "bases-card",
      role: "listitem",
      tabindex: "0",
      "data-path": filePath,
      "data-index": String(index),
      onclick: openCard,
      onauxclick: (e: MouseEvent) => {
        if (e.button === 1) openCard(e);
      },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void ws.open(filePath, { where: e.ctrlKey || e.metaKey ? "tab" : false, group });
        }
      },
    });
    if (model.image) {
      const cover = h("div", { class: "bases-card-cover", style: `height:${coverHeight}px` });
      const rawCover = entry.context.get(model.image);
      const resolved = resolveCoverPath(ws, rawCover, filePath);
      if (resolved) {
        cover.dataset.coverPath = resolved;
        cover.dataset.imageFit = model.imageFit;
      }
      card.append(cover);
    }
    const body = h("div", { class: "bases-card-body" }, h("div", { class: "bases-card-title" }, noteName(filePath)));
    for (const key of propKeys) {
      body.append(
        h(
          "div",
          { class: "bases-card-prop", "data-property": key },
          h("span", { class: "bases-card-key" }, model.label(key)),
          renderCardValue(key, entry, model),
        ),
      );
    }
    card.append(body);
    return card;
  }

  function paint(force = false) {
    if (gone || !currentModel) return;
    const model = currentModel;
    const selected = currentSelected;
    const propKeys = model.columns.filter((k) => noteKey(k) !== "file.name");
    const coverHeight = model.image ? Math.round(model.cardSize * model.imageAspectRatio) : 0;
    el.style.setProperty("--bases-card-size", `${model.cardSize}px`);
    el.style.setProperty("--bases-card-cover-height", `${coverHeight}px`);
    el.setAttribute("aria-rowcount", String(selected.length));

    const layout = cardLayout({
      count: selected.length,
      width: scroller.clientWidth,
      height: scroller.clientHeight,
      scrollTop: scroller.scrollTop,
      cardSize: model.cardSize,
      propCount: propKeys.length,
      coverHeight,
    });
    lastLayout = layout;

    const rangeChanged =
      force ||
      layout.firstIndex !== lastFirstIndex ||
      layout.endIndex !== lastEndIndex ||
      layout.cols !== lastCols;

    if (rangeChanged) {
      lastFirstIndex = layout.firstIndex;
      lastEndIndex = layout.endIndex;
      lastCols = layout.cols;
      releaseAllCovers();
      el.style.paddingTop = `${16 + layout.topSpace}px`;
      el.style.paddingBottom = `${16 + layout.bottomSpace}px`;
      const fragment = document.createDocumentFragment();
      for (let i = layout.firstIndex; i < layout.endIndex; i++) {
        fragment.append(buildCard(selected[i], i, model, propKeys, coverHeight));
      }
      el.replaceChildren(fragment);
    }
    syncVisibleCovers();
  }

  return {
    el,
    render(model: BaseModel, selected: SelectedEntry[], types: Map<string, PropertyType>, force = true) {
      currentModel = model;
      currentSelected = selected;
      currentTypes = types;
      paint(force);
    },
    onScroll() {
      paint(false);
    },
    onResize() {
      paint(true);
    },
    clear() {
      releaseAllCovers();
      el.replaceChildren();
      lastFirstIndex = -1;
      lastEndIndex = -1;
      lastCols = -1;
    },
    dispose() {
      gone = true;
      releaseAllCovers();
      el.remove();
    },
  };
}

/**
 * Attach a `CardGrid` to an existing `.bases-view` container created by `createBaseView`
 * so `type: "cards"` views render the card grid inside `.bases-scroll` while sharing the
 * toolbar, menus, and lifecycle of the host `.bases-view`.
 */
export function attachCardsToBaseView(el: HTMLElement, ws: Workspace, path: string, group: Group) {
  const toolbar = el.querySelector<HTMLElement>(":scope > .bases-toolbar");
  const scroller = el.querySelector<HTMLElement>(":scope > .bases-scroll");
  const table = scroller?.querySelector<HTMLElement>(":scope > .bases-table");
  if (!toolbar || !scroller || !table) {
    return { el, dispose() {} };
  }

  const cardGrid = createCardGrid(ws, group, scroller);
  cardGrid.el.hidden = true;
  scroller.append(cardGrid.el);

  const index = propertyIndex(ws);
  let model: BaseModel | null = null;
  let selected: SelectedEntry[] = [];
  let types = new Map<string, PropertyType>();
  let viewIndex = 0;
  let gone = false;
  let timer = 0;
  let frame = 0;
  let running = false;
  let dirty = false;

  function detectViewIndex(base: BaseModel): number {
    const label = toolbar?.querySelector<HTMLElement>(".bases-view-name span")?.textContent?.trim();
    if (label) {
      const idx = base.views.findIndex((v) => {
        const name = typeof mapping(v).name === "string" ? String(mapping(v).name) : "View";
        return name === label;
      });
      if (idx !== -1) return idx;
    }
    return viewIndex;
  }

  function syncToolbarIcon() {
    if (!model || !toolbar) return;
    const viewBtn = toolbar.querySelector<HTMLElement>(".bases-view-name");
    const firstSvg = viewBtn?.querySelector("svg");
    if (viewBtn && firstSvg) {
      firstSvg.replaceWith(icon(model.type === "cards" ? "grid-2x2" : "table"));
    }
  }

  async function update() {
    dirty = true;
    if (running) return;
    running = true;
    try {
      while (dirty && !gone) {
        dirty = false;
        const source = await api.readNote(path);
        const probe = baseModel(source, viewIndex);
        viewIndex = detectViewIndex(probe);
        model = viewIndex === probe.viewIndex ? probe : baseModel(source, viewIndex);

        if (model.type !== "cards") {
          cardGrid.el.hidden = true;
          cardGrid.clear();
          table!.hidden = false;
          el.setAttribute("aria-label", "Base table");
          syncToolbarIcon();
          continue;
        }

        const properties = await index.notes();
        const needsTags = /file\.(?:tags|hasTag)/.test(source);
        const tags = needsTags ? await vaultTags(ws).read() : new Map<string, string[]>();
        if (gone || dirty) continue;

        types = new Map();
        for (const { props } of properties.values()) {
          for (const p of props) if (!types.has(p.key)) types.set(p.key, index.host.typeOf(p.key) ?? p.type);
        }
        const linkCache = new Map<string, string | null>();
        const rows: Row[] = baseNoteFiles(ws.vault.files, (p) => ws.vault.isExcluded(p)).map((file) => {
          const props = properties.get(file.path)?.props ?? [];
          let allTags =
            tags.get(file.path) ??
            props.filter((p) => p.type === "tags").flatMap((p) => (Array.isArray(p.value) ? p.value : [String(p.value)]));
          if (needsTags && ws.editors.isLoaded(file.path)) {
            allTags = tagsInText(ws.editors.doc(file.path)!.toString());
          }
          return {
            file,
            props,
            tags: allTags,
            hasLink: (link) => {
              const cacheKey = `${parentDir(file.path)}\0${link}`;
              if (!linkCache.has(cacheKey)) linkCache.set(cacheKey, ws.resolve(link.replace(/^\[\[|\]\]$/g, ""), file.path));
              const target = linkCache.get(cacheKey);
              const links = ws.vault.links;
              return !!target && [...(links.outgoing[file.path] ?? []), ...(links.markdown?.[file.path] ?? [])].includes(target);
            },
          };
        });
        const matches = model.select(rows, true);
        model.total = matches.length;
        selected = typeof model.view.limit === "number" ? matches.slice(0, model.view.limit) : matches;
        model.results = selected.length;

        table!.hidden = true;
        cardGrid.el.hidden = false;
        el.setAttribute("aria-label", "Base cards");
        syncToolbarIcon();
        cardGrid.render(model, selected, types, true);
      }
    } catch {
      if (!gone) {
        cardGrid.el.hidden = true;
        cardGrid.clear();
      }
    } finally {
      running = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = window.setTimeout(() => void update(), 16);
  }

  const onScroll = () => {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      if (model?.type === "cards") cardGrid.onScroll();
    });
  };
  scroller.addEventListener("scroll", onScroll, { passive: true });

  const resize = new ResizeObserver(() => {
    if (model?.type === "cards") cardGrid.onResize();
  });
  resize.observe(scroller);

  // Re-sync whenever the host table updates its tbody or toolbar view name changes.
  const hostObserver = new MutationObserver(() => {
    if (!gone) schedule();
  });
  const tbody = table.querySelector("tbody");
  if (tbody) hostObserver.observe(tbody, { childList: true });
  hostObserver.observe(toolbar, { childList: true, subtree: true, characterData: true });

  const unwatch = ws.vault.onModified((changed) => {
    if (changed === path) schedule();
  });
  const off = ws.on((change) => {
    if (["files", "doc", "links"].includes(change)) schedule();
  });
  void update();

  return {
    el,
    async setViewOption(key: "type" | "cardSize" | "image" | "imageFit" | "imageAspectRatio", value: unknown) {
      const current = await api.readNote(path);
      const next = writeView(current, key as never, value as never, viewIndex);
      if (next !== current) {
        await api.writeNote(path, next);
        ws.vault.written(path);
      }
      await update();
    },
    dispose() {
      if (gone) return;
      gone = true;
      scroller.removeEventListener("scroll", onScroll);
      resize.disconnect();
      hostObserver.disconnect();
      unwatch();
      off();
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      cardGrid.dispose();
    },
  };
}

const enabledWorkspaces = new WeakSet<Workspace>();
const mountedViews = new WeakMap<HTMLElement, ReturnType<typeof attachCardsToBaseView>>();

/**
 * Enable card view rendering on all `.bases-view` panes in the given Workspace.
 */
export function enableBaseCards(ws: Workspace) {
  if (enabledWorkspaces.has(ws)) return;
  enabledWorkspaces.add(ws);

  const activeEls = new Set<HTMLElement>();

  function syncPanes() {
    for (const el of [...activeEls]) {
      if (!el.isConnected) {
        activeEls.delete(el);
        mountedViews.get(el)?.dispose();
        mountedViews.delete(el);
      }
    }
    for (const group of ws.groups()) {
      const tab = group.active;
      if (tab.type !== "base" || !tab.viewFile) continue;
      const leaf = ws.editors.viewOf(group).dom.closest<HTMLElement>(".workspace-leaf");
      const baseEl = leaf?.querySelector<HTMLElement>(":scope > .bases-view");
      if (!baseEl || mountedViews.has(baseEl)) continue;
      const instance = attachCardsToBaseView(baseEl, ws, tab.viewFile, group);
      mountedViews.set(baseEl, instance);
      activeEls.add(baseEl);
    }
  }

  ws.on((event) => {
    if (event === "tabs" || event === "layout" || event === "show") syncPanes();
  });
  const observer = new MutationObserver(() => syncPanes());
  observer.observe(document.body, { childList: true, subtree: true });
  syncPanes();
}

if (typeof window !== "undefined") {
  const w = window as unknown as { ws?: Workspace; __groveWorkspace?: Workspace };
  const target = w.ws ?? w.__groveWorkspace;
  if (target) enableBaseCards(target);
}
