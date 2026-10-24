// What the editors ask of the app (editor/host.ts), one per workspace:
// following links, the vault's notes and properties, the editor menu, and
// what ![[embeds]] read (editor/embeds.ts). For embeds: a link target
// resolved like any link (images by their name with its extension), a
// note's text (its editor's, when it is open), and an image's bytes as a
// blob: URL. Nothing is read until an embed is drawn. Notes' text is kept by
// path until the file changes; an image's URL is revoked as soon as no embed
// shows it, or when the file changes.

import { api, type FileEntry } from "./api";
import { isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { attachmentPaths, embedFor } from "./editor/attachments";
import { editorHost, type EditorHost, type EmbedHost } from "./editor/host";
import { toggledTask } from "./editor/render";
import { type NoteLike, resolveLink } from "./links/internal";
import { listeners } from "./listeners";
import { kept } from "./memo";
import { createNote } from "./fileOps";
import { noteName, trimSlashes } from "./paths";
import { fillTemplate, formatDate } from "./settings/dateFormat";
import { settings } from "./settings/store";
import type { Workspace } from "./workspace";
import { recentNotes } from "./shell/switcherItems";

const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml" };
const mime = (path: string) => {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MIME[ext] ?? `image/${ext}`;
};
const MAX_NOTES = 100;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Open the daily note for `date`, creating it from the daily-notes template when it is missing. */
export async function openDailyNote(ws: Workspace, date: Date): Promise<void> {
  const daily = settings.get("daily-notes.json");
  const folder = trimSlashes(daily.folder);
  const path = `${folder ? `${folder}/` : ""}${formatDate(date, daily.format || "YYYY-MM-DD")}.md`;
  const existing = ws.vault.notes.find((n) => n.path.toLowerCase() === path.toLowerCase());
  if (existing) {
    await ws.open(existing.path);
    return;
  }
  const templates = settings.get("templates.json");
  const template = daily.template.trim() ? ws.resolve(daily.template.trim(), null) : null;
  const raw = template ? await ws.editors.text(template).catch(() => "") : "";
  const text = fillTemplate(raw, noteName(path), date, templates.dateFormat || "YYYY-MM-DD", templates.timeFormat || "HH:mm");
  const entry = await createNote(ws, path, text);
  await ws.open(entry.path);
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
    linkCandidates: () => {
      const candidates = new Map(ws.vault.files.filter(f => !f.is_dir && !ws.vault.isExcluded(f.path))
        .map(f => [f.path.toLowerCase(), { name: noteName(f.path), path: f.path }]));
      for (const targets of Object.values(ws.vault.links.unresolved ?? {})) for (const target of targets) {
        const path = /\.md$/i.test(target) ? target : `${target}.md`;
        if (!ws.vault.isExcluded(path) && !ws.vault.linkExists(target, null) && !candidates.has(path.toLowerCase()))
          candidates.set(path.toLowerCase(), { name: target, path });
      }
      const recent = recentNotes(candidates, ws.recent.map(path => path.toLowerCase()));
      return [...recent, ...candidates.values()];
    },
    formatLink: (target, view, display, subpath) => ws.linkTo(target, ws.editors.pathOf(view), display, subpath),
    async linkDocument(target, view) {
      const current = ws.editors.pathOf(view);
      if (!target) return current ? { path: current, state: view.state, current: true } : null;
      const path = ws.resolve(target, view.state.facet(editorHost)?.embeds?.pathOf(view) ?? current);
      if (!path || !/\.md$/i.test(path)) return null;
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

const ATTACHMENT_MAX = 20 * 1024 * 1024;

/** Write each file, refresh the file list, then insert the embeds as one paste. */
async function saveAttachments(ws: Workspace, view: EditorView, files: File[], at?: number | null, keepNames = false): Promise<boolean> {
  if (view.state.readOnly) return true;
  const from = ws.editors.pathOf(view);
  if (!from || !files.length) return true;
  const sel = view.state.selection.main;
  const insertAt = at ?? sel.from;
  const replaceTo = at == null ? sel.to : insertAt;
  const incoming: { name: string; type: string; bytes: Uint8Array }[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > ATTACHMENT_MAX) {
      console.warn("Grove skipped an attachment over 20 MB", file.name);
      continue;
    }
    incoming.push({ name: file.name, type: file.type, bytes });
  }
  if (!incoming.length) return true;
  const paths = attachmentPaths(from, settings.get("app.json").attachmentFolderPath, incoming, ws.vault.files.map((f) => f.path), new Date(), !keepNames);
  const saved: string[] = [];
  for (let i = 0; i < incoming.length; i++) {
    try {
      await api.writeFileBytes(paths[i], incoming[i].bytes);
      saved.push(paths[i]);
    } catch (err) {
      console.warn("Grove could not save an attachment", paths[i], err);
    }
  }
  if (!saved.length) return true;
  await ws.vault.refreshFiles();
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
  const images = new Map<string, { url: Promise<string>; holders: number }>();
  const watchers = new Map<string, ReturnType<typeof listeners>>();
  let files: { list: FileEntry[]; out: NoteLike[] } | null = null;

  const modified = (path: string) => {
    notes.delete(path);
    images.delete(path); // its holders load it again, and let go of the old URL
    watchers.get(path)?.emit();
  };
  ws.vault.onModified(modified);

  return {
    resolve(target, view) {
      if (files?.list !== ws.vault.files) files = { list: ws.vault.files, out: ws.vault.files.filter((f) => !f.is_dir) };
      return resolveLink(target, ws.editors.pathOf(view), files.out);
    },
    pathOf: (view) => ws.editors.pathOf(view),
    read(path) {
      if (ws.editors.isLoaded(path)) return ws.editors.text(path);
      return kept(notes, path, () => {
        if (notes.size >= MAX_NOTES) notes.delete(notes.keys().next().value!);
        const text = api.readNote(path);
        text.catch(() => notes.delete(path));
        return text;
      });
    },
    image(path) {
      const held = kept(images, path, () => ({ url: api.readFileBytes(path).then((bytes) => URL.createObjectURL(new Blob([bytes], { type: mime(path) }))), holders: 0 }));
      held.holders++;
      let released = false;
      return {
        url: held.url,
        release() {
          if (released) return;
          released = true;
          if (--held.holders > 0) return;
          if (images.get(path) === held) images.delete(path);
          held.url.then(URL.revokeObjectURL, () => {});
        },
      };
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
      return kept(watchers, path, () => listeners()).on(fn);
    },
  };
}
