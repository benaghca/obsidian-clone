// What the editors ask of the app (editor/host.ts), one per workspace:
// following links, the vault's notes and properties, the editor menu, and
// what ![[embeds]] read (editor/embeds.ts). For embeds: a link target
// resolved like any link (images by their name with its extension), a
// note's text (its editor's, when it is open), and an image's bytes as a
// blob: URL. Nothing is read until an embed is drawn. Notes' text is kept by
// path until the file changes; an image's URL is revoked as soon as no embed
// shows it, or when the file changes. A create, remove, or rename of an audio,
// video, or PDF path drops that holder once per disk batch. A PDF blob is registered with the
// navigation guard before that URL is handed out, and only when this window can
// show the viewer; otherwise the read fails and no iframe is attached.

import { api, type FileEntry } from "./api";
import { mediaKind } from "./media";
import { isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { embedFor } from "./editor/attachments";
import { writeAttachments } from "./editor/saveAttachments";
import { editorHost, type BaseEmbed, type EditorHost, type EmbedHost } from "./editor/host";
import { baseEmbeds } from "./viewLoad";
import { toggledTask } from "./editor/render";
import { resolveLink } from "./links/internal";
import { listeners } from "./listeners";
import { kept } from "./memo";
import { createNote } from "./fileOps";
import { mediaMime } from "./media";
import { fileName, isNoteFile, noteName } from "./paths";
import { dailyNotePath, existingDailyNote, fillTemplate } from "./settings/dateFormat";
import { settings } from "./settings/store";
import type { Workspace } from "./workspace";
import { propertyIndex } from "./shell/propertyIndex";
import { recentNotes } from "./shell/switcherItems";
import type { OpenWhere } from "./tabs";

const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml" };
const mime = (path: string) => {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MIME[ext] ?? `image/${ext}`;
};
const MAX_NOTES = 100;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Daily notes being created, by path, so a second open of the same day while
// the first is still writing (startup and a click, two clicks) opens that note.
const creatingDaily = new Map<string, Promise<FileEntry>>();

/**
 * Open the daily note for `date`, creating it from the daily-notes template
 * when it is missing. A date format with folders (`YYYY/MM/YYYY-MM-DD`) puts
 * the note in them; the backend creates the folders with the note.
 */
export async function openDailyNote(ws: Workspace, date: Date, where: OpenWhere = false): Promise<void> {
  const daily = settings.get("daily-notes.json");
  const path = dailyNotePath(date, daily);
  const key = path.toLowerCase();
  // A migrated note may be "2026-10-03" where this format writes "2026-10-3".
  // Open that note. Create only when the day has none, and then write the short form.
  const existing = existingDailyNote(ws.vault.notes.map((n) => n.path), date, daily);
  if (existing) {
    await ws.open(existing, { where });
    return;
  }
  let creating = creatingDaily.get(key);
  if (!creating) {
    creating = (async () => {
      const templates = settings.get("templates.json");
      const template = daily.template.trim() ? ws.resolve(daily.template.trim(), null) : null;
      const raw = template ? await ws.editors.text(template).catch(() => "") : "";
      const text = fillTemplate(raw, noteName(path), date, templates.dateFormat || "YYYY-MM-DD", templates.timeFormat || "HH:mm");
      return createNote(ws, path, text);
    })().finally(() => creatingDaily.delete(key));
    creatingDaily.set(key, creating);
  }
  await ws.open((await creating).path, { where });
}

/** The property date, at the current time of day so a template's {{time}} is not midnight. */
function dailyDate(iso: string): Date | null {
  const match = ISO_DATE.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const now = new Date();
  const date = new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds());
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function createEditorHost(ws: Workspace): EditorHost & { embeds: EmbedHost } {
  return {
    openLink: (target, where, view) => void ws.openLink(target, where, view ? ws.editors.groupOfView(view) : undefined),
    openUrl: (url) => void api.openExternal(url).catch((err) => console.error(`Could not open ${url}`, err)),
    allowFrameOrigin: (origin) => api.allowFrameOrigin(origin),
    linkCandidates: () => {
      const candidates = new Map(ws.vault.files.filter(f => !f.is_dir && !ws.vault.isExcluded(f.path))
        .map(f => [f.path.toLowerCase(), { name: noteName(f.path), path: f.path }]));
      for (const targets of Object.values(ws.vault.links.unresolved ?? {})) for (const target of targets) {
        if (fileName(target).toLowerCase() === ".md") continue;
        const path = /\.md$/i.test(target) ? target : `${target}.md`;
        if (!ws.vault.isExcluded(path) && !ws.vault.linkExists(target, null) && !candidates.has(path.toLowerCase()))
          candidates.set(path.toLowerCase(), { name: target, path });
      }
      const recent = recentNotes(candidates, ws.recent.map(path => path.toLowerCase()));
      return [...recent, ...candidates.values()];
    },
    async linkAliases() {
      const found = await propertyIndex(ws).notes();
      const out: { path: string; name: string; alias: string }[] = [];
      for (const [path, note] of found) {
        for (const prop of note.props) {
          if (prop.type !== "aliases" && prop.key !== "aliases") continue;
          const values = Array.isArray(prop.value) ? prop.value : typeof prop.value === "string" ? [prop.value] : [];
          for (const alias of values) {
            const text = alias.trim();
            if (text && !/[\n|\]]/.test(text)) out.push({ path, name: noteName(path), alias: text });
          }
        }
      }
      return out;
    },
    formatLink: (target, view, display, subpath) => ws.linkTo(target, ws.editors.pathOf(view), display, subpath),
    async linkDocument(target, view) {
      const current = ws.editors.pathOf(view);
      if (!target) return current ? { path: current, state: view.state, current: true } : null;
      const path = ws.resolve(target, view.state.facet(editorHost)?.embeds?.pathOf(view) ?? current);
      if (!path || !isNoteFile(path)) return null;
      if (path === current) return { path, state: view.state, current: true };
      const state = await ws.editors.load(path);
      return state ? { path, state, current: false } : null;
    },
    insertBlockId(target, changes, view) {
      const doc = target.current ? view.state.doc : target.path ? ws.editors.doc(target.path) : null;
      if (!doc?.eq(target.state.doc)) return false;
      const spec = { changes, userEvent: "input.complete", annotations: isolateHistory.of("full") };
      if (target.current) view.dispatch(spec); else ws.editors.change(target.path!, spec);
      return true;
    },
    contextMenu: (view, at, pos, keyboard, image) => {
      const group = ws.editors.groupOfView(view);
      if (group) ws.focusGroup(group);
      ws.editorMenu?.(view, at, pos, keyboard, image);
    },
    properties: () => ws.propertyHost,
    openDaily: (iso) => {
      const date = dailyDate(iso);
      if (date) void openDailyNote(ws, date);
    },
    linkExists: (target, view) => ws.vault.linkExists(target, ws.editors.pathOf(view)),
    embeds: createEmbedHost(ws),
    saveAttachments: (view, files, at, keepNames) => saveAttachments(ws, view, files, at, keepNames),
  };
}

/** Write each file, refresh the file list, then insert the embeds as one paste. */
async function saveAttachments(ws: Workspace, view: EditorView, files: File[], at?: number | null, keepNames = false): Promise<boolean> {
  if (view.state.readOnly) return true;
  const from = ws.editors.pathOf(view);
  if (!from || !files.length) return true;
  const sel = view.state.selection.main;
  const insertAt = at ?? sel.from;
  const replaceTo = at == null ? sel.to : insertAt;
  const saved = await writeAttachments(ws, from, files, !keepNames);
  if (!saved.length || view.state.readOnly || ws.editors.pathOf(view) !== from) return true;
  const notes = ws.vault.files.filter((f) => !f.is_dir);
  const text = saved.map((path) => embedFor(path, from, notes, ws.linkStyle())).join(view.state.lineBreak);
  const doc = view.state.doc.length;
  const fromPos = Math.min(insertAt, doc);
  const toPos = Math.min(Math.max(replaceTo, fromPos), doc);
  view.dispatch({
    changes: { from: fromPos, to: toPos, insert: text },
    selection: { anchor: fromPos + text.length },
    userEvent: "input.paste",
    scrollIntoView: true,
    annotations: isolateHistory.of("full"),
  });
  return true;
}

function createEmbedHost(ws: Workspace): EmbedHost {
  const notes = new Map<string, Promise<string>>();
  const images = new Map<string, { url: Promise<string>; holders: number; pdf: boolean }>();
  const watchers = new Map<string, ReturnType<typeof listeners>>();

  const modified = (path: string) => {
    notes.delete(path);
    images.delete(path); // its holders load it again, and let go of the old URL
    watchers.get(path)?.emit();
  };
  // The list install emits "files" and then, one microtask later, the batch's
  // modify and media-path signals. A signature change and that signal would
  // each start a read. Remember the signature here. The signal reloads the
  // path; a folder event that never names the file is reloaded one microtask
  // after the signal, and only when the signal did not cover it.
  // A modify-only batch reloads without installing a new list, so the saved
  // signature stays old. The next list install may only be that version
  // catching up. Skip that second reload unless this batch removes, renames,
  // or creates a watched ancestor: a sibling note changes the folder stamp
  // without replacing the file, and a swapped folder can keep the old stamp.
  // Record the skip only while a watcher is active.
  const changedByList = new Set<string>();
  const signaled = new Set<string>();
  const loadedAhead = new Set<string>();
  const structural = new Set<string>();
  let scheduled = false;
  const reconcile = () => {
    scheduled = false;
    for (const path of changedByList) {
      if (signaled.has(path) || !watchers.has(path)) continue;
      modified(path);
    }
    changedByList.clear();
    signaled.clear();
  };
  const scheduleReconcile = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => queueMicrotask(reconcile));
  };
  const invalidate = (path: string) => {
    if (mediaKind(path) && watchers.has(path)) {
      if (scheduled) signaled.add(path);
      else loadedAhead.add(path);
    }
    modified(path);
  };
  ws.vault.onModified(invalidate);
  ws.vault.onMediaPath(invalidate);
  ws.vault.onStructure((paths) => {
    structural.clear();
    for (const watched of watchers.keys()) {
      if (!mediaKind(watched)) continue;
      for (const eventPath of paths) {
        if (eventPath && (watched === eventPath || watched.startsWith(`${eventPath}/`))) {
          structural.add(watched);
          break;
        }
      }
    }
  });
  // A folder remove or rename changes the list without naming the file. Compare the
  // paths a player or PDF is actually watching, once per file-list install.
  const seenMedia = new Map<string, string>();
  const mediaSig = (path: string) => {
    const entry = ws.vault.entry(path);
    return entry && !entry.is_dir ? `${entry.mtime_ms}:${entry.size}` : "";
  };
  ws.on((change) => {
    if (change !== "files") return;
    for (const path of [...watchers.keys()]) {
      if (!mediaKind(path)) continue;
      const next = mediaSig(path);
      const prev = seenMedia.get(path);
      seenMedia.set(path, next);
      if (prev === undefined || prev === next) {
        loadedAhead.delete(path);
        continue;
      }
      // The holder already read this version. A remove, rename, or create of
      // the file or an ancestor is a different file, not that catch-up.
      const ahead = loadedAhead.delete(path);
      if (ahead && next !== "" && !structural.has(path)) continue;
      changedByList.add(path);
      scheduleReconcile();
    }
    structural.clear();
  });

  const holdBlob = (path: string, type: string) => {
    const pdf = type === "application/pdf";
    const held = kept(images, path, () => ({
      pdf,
      holders: 0,
      url: api.readFileBytes(path).then(async (bytes) => {
        const url = URL.createObjectURL(new Blob([bytes], { type }));
        if (!pdf) return url;
        // The iframe navigates only after this returns, so the guard already lists the blob.
        try {
          await api.allowPdfBlob(url);
        } catch (err) {
          URL.revokeObjectURL(url);
          throw err;
        }
        return url;
      }),
    }));
    held.holders++;
    let released = false;
    return {
      url: held.url,
      release() {
        if (released) return;
        released = true;
        if (--held.holders > 0) return;
        if (images.get(path) === held) images.delete(path);
        held.url.then(async (url) => {
          if (held.pdf) {
            try {
              await api.releasePdfBlob(url);
            } catch {
              // The blob is still revoked below.
            }
          }
          URL.revokeObjectURL(url);
        }, () => {});
      },
    };
  };

  return {
    resolve: (target, view) => resolveLink(target, ws.editors.pathOf(view), ws.vault.fileRefs()),
    pathOf: (view) => ws.editors.pathOf(view),
    read(path) {
      if (ws.editors.isLoaded(path)) return ws.editors.text(path);
      return kept(notes, path, () => {
        if (notes.size >= MAX_NOTES) notes.delete(notes.keys().next().value!);
        const text = api.readNote(path);
        text.catch(() => { if (notes.get(path) === text) notes.delete(path); });
        return text;
      });
    },
    image(path) {
      return holdBlob(path, mime(path));
    },
    media(path) {
      return holdBlob(path, mediaMime(path));
    },
    async toggleTask(path, line) {
      // Through the note's editor state (loaded from disk if it isn't open), so it is saved like any edit.
      if (!(await ws.editors.load(path))) return;
      const doc = ws.editors.doc(path)!;
      const tick = toggledTask(doc.toString(), line);
      if (!tick) return;
      ws.editors.change(path, { changes: { from: tick.at, to: tick.at + 1, insert: tick.insert }, userEvent: "input.toggle" });
      modified(path); // its embeds show it now, not when it is saved
    },
    watch(path, fn) {
      if (mediaKind(path) && !seenMedia.has(path)) seenMedia.set(path, mediaSig(path));
      const bucket = kept(watchers, path, () => listeners());
      const stop = bucket.on(fn);
      let live = true;
      return () => {
        if (!live) return;
        live = false;
        stop();
        if (bucket.size > 0) return;
        watchers.delete(path);
        seenMedia.delete(path);
        loadedAhead.delete(path);
      };
    },
    base: (parent, embed, view) => {
      const live = baseEmbeds.get();
      if (live) return live.mountBaseEmbed(ws, parent, embed, view);
      // The note was shown before the chunk arrived. Keep the reserved box
      // and fill it when the module is ready; nothing is swapped for a spinner.
      let current = embed;
      let handle: { update(next: BaseEmbed): void; destroy(): void } | null = null;
      let dead = false;
      void baseEmbeds.load().then((mod) => {
        if (dead) return;
        handle = mod.mountBaseEmbed(ws, parent, current, view);
      });
      return {
        update(next) {
          current = next;
          handle?.update(next);
        },
        destroy() {
          dead = true;
          handle?.destroy();
        },
      };
    },
  };
}
