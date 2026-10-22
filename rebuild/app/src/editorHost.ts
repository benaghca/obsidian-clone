// What the editors ask of the app (editor/host.ts), one per workspace:
// following links, the vault's notes and properties, the editor menu, and
// what ![[embeds]] read (editor/embeds.ts). For embeds: a link target
// resolved like any link (images by their name with its extension), a
// note's text (its editor's, when it is open), and an image's bytes as a
// blob: URL. Nothing is read until an embed is drawn. Notes' text is kept by
// path until the file changes; an image's URL is revoked as soon as no embed
// shows it, or when the file changes.

import { api, type FileEntry } from "./api";
import { toggledTask } from "./editor/embeds";
import type { EditorHost, EmbedHost } from "./editor/host";
import { type NoteLike, resolveLink } from "./links/internal";
import type { Workspace } from "./workspace";

const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml" };
const mime = (path: string) => {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MIME[ext] ?? `image/${ext}`;
};
const MAX_NOTES = 100;

export function createEditorHost(ws: Workspace): EditorHost & { embeds: EmbedHost } {
  return {
    openLink: (target, where, view) => void ws.openLink(target, where, view ? ws.editors.groupOfView(view) : undefined),
    openUrl: (url) => void api.openExternal(url).catch((err) => console.error(`Could not open ${url}`, err)),
    notes: () => ws.vault.includedNotes(),
    formatLink: (target, view, display) => ws.linkTo(target, ws.editors.pathOf(view), display),
    contextMenu: (view, at, pos, keyboard) => {
      const group = ws.editors.groupOfView(view);
      if (group) ws.focusGroup(group);
      ws.editorMenu?.(view, at, pos, keyboard);
    },
    properties: () => ws.propertyHost,
    linkExists: (target, view) => ws.vault.linkExists(target, ws.editors.pathOf(view)),
    embeds: createEmbedHost(ws),
  };
}

function createEmbedHost(ws: Workspace): EmbedHost {
  const notes = new Map<string, Promise<string>>();
  const images = new Map<string, { url: Promise<string>; holders: number }>();
  const watchers = new Map<string, Set<() => void>>();
  let files: { list: FileEntry[]; out: NoteLike[] } | null = null;

  const modified = (path: string) => {
    notes.delete(path);
    images.delete(path); // its holders load it again, and let go of the old URL
    for (const fn of [...(watchers.get(path) ?? [])]) fn();
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
      let text = notes.get(path);
      if (!text) {
        if (notes.size >= MAX_NOTES) notes.delete(notes.keys().next().value!);
        notes.set(path, (text = api.readNote(path)));
        text.catch(() => notes.delete(path));
      }
      return text;
    },
    image(path) {
      let entry = images.get(path);
      if (!entry) {
        const url = api.readFileBytes(path).then((bytes) => URL.createObjectURL(new Blob([bytes], { type: mime(path) })));
        images.set(path, (entry = { url, holders: 0 }));
      }
      const held = entry;
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
      let set = watchers.get(path);
      if (!set) watchers.set(path, (set = new Set()));
      set.add(fn);
      return () => {
        set.delete(fn);
        if (!set.size) watchers.delete(path);
      };
    },
  };
}
