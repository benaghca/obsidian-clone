// The open vault as the app knows it: its folder and name, the file list,
// the notes, and the backend's link index. It follows our own saves (the
// link index is read again a moment later) and changes on disk (the
// backend's vault-changed), and answers the questions the file list settles:
// which notes aren't excluded, whether a link target exists. The workspace
// (workspace.ts) holds one, as `ws.vault`.

import { api, type FileEntry, isTauri, type LinkIndex } from "./api";
import type { NoteRef } from "./editor/host";
import { linkTargets } from "./links/internal";
import { listeners } from "./listeners";
import { isNoteFile, noteName } from "./paths";

const LINK_INDEX_DELAY = 1000;
/** A hidden webview may never paint. The same batch still flushes this soon, once. */
const FLUSH_LIMIT_MS = 50;

function inTree(root: string, path: string) {
  return path === root || path.startsWith(`${root}/`);
}

function dropTree(root: string, touch: Set<string>, reload: Set<string>) {
  for (const path of [...touch]) if (inTree(root, path)) touch.delete(path);
  for (const path of [...reload]) if (inTree(root, path)) reload.delete(path);
}

export class Vault {
  path = "";
  name = "";
  /** The current file list. Assigning a new array rebuilds the path lookup. */
  get files(): FileEntry[] {
    return this.fileList;
  }

  set files(files: FileEntry[]) {
    this.fileList = files;
    const byPath = new Map<string, FileEntry>();
    for (const file of files) if (!byPath.has(file.path)) byPath.set(file.path, file);
    this.byPath = byPath;
  }

  notes: NoteRef[] = [];
  links: LinkIndex = { outgoing: {} };
  /** Excluded files (Settings → Files and links): left out of the switcher, search, suggestions. */
  isExcluded: (path: string) => boolean = () => false;

  private fileList: FileEntry[] = [];
  /** First entry wins when one path is listed twice, matching a list scan that stops at the first hit. */
  private byPath = new Map<string, FileEntry>();
  /** Disk events waiting for this frame's single refresh. */
  private pending: { kind: string; paths: string[] }[] | null = null;
  /** Bumped when a pending flush must not apply: a new open, or the page going away. */
  private wave = 0;
  /** Bumped when one of a batch's callbacks wins, so the other one does not run it again. */
  private ticket = 0;
  private frame: number | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listenEpoch = 0;
  private stopChanges: (() => void) | undefined;
  private linkTimer = 0;
  private filesRequest = 0;
  private linksRequest = 0;
  private modified = listeners<[string]>();
  /** Listen for a file being modified (on disk, or saved here); returns a function that stops. */
  readonly onModified = this.modified.on;
  private included: { notes: NoteRef[]; test: (path: string) => boolean; out: NoteRef[] } | null = null;
  private refs: { files: FileEntry[]; out: NoteRef[] } | null = null;
  private targets: { files: FileEntry[]; exists: ReturnType<typeof linkTargets> } | null = null;

  /** `changed` hears "files" and "links"; `reload` takes a loaded note's new text from disk. */
  constructor(
    private readonly changed: (change: "files" | "links") => void,
    private readonly reload: (path: string) => Promise<void>,
  ) {
    if (typeof document !== "undefined") document.addEventListener("pagehide", () => this.abandon());
  }

  /** Open the last vault; a note's own window (`reuse`) joins the one the backend already has open. */
  async open(reuse = false) {
    this.abandon();
    this.stopChanges?.();
    this.stopChanges = undefined;
    const listen = ++this.listenEpoch;
    const last = await api.lastVault();
    let info = last;
    if (isTauri && !(reuse && last)) {
      const path =
        last?.path ??
        window.prompt("Vault folder to open", "/home/chris/workspaces/remote/grove-test-vault");
      info = path ? await api.openVault(path) : null;
    }
    if (listen !== this.listenEpoch) return;
    if (info) {
      this.path = info.path;
      this.name = info.name;
    }
    await this.refreshFiles();
    if (listen !== this.listenEpoch) return;
    void this.refreshLinks();
    const stop = await api.onVaultChanged((change) => {
      if (listen !== this.listenEpoch) return;
      void this.onChanged(change.kind, change.paths);
    });
    if (listen !== this.listenEpoch) {
      stop();
      return;
    }
    this.stopChanges = stop;
  }

  async refreshFiles() {
    const mine = ++this.filesRequest;
    const files = await api.listFiles();
    if (mine !== this.filesRequest) return;
    this.files = files;
    this.notes = this.files
      .filter((f) => !f.is_dir && isNoteFile(f.path))
      .map((f) => ({ name: noteName(f.path), path: f.path }));
    this.changed("files");
  }

  async refreshLinks() {
    const mine = ++this.linksRequest;
    const links = await api.linkIndex();
    if (mine !== this.linksRequest) return;
    this.links = links;
    this.changed("links");
  }

  /** Every file (not folders) as a link target: notes by their name without ".md", other files by their whole name. */
  fileRefs(): NoteRef[] {
    if (this.refs?.files !== this.files) {
      const notes = new Map(this.notes.map((n) => [n.path, n]));
      this.refs = { files: this.files, out: this.files.filter((f) => !f.is_dir).map((f) => notes.get(f.path) ?? { name: noteName(f.path), path: f.path }) };
    }
    return this.refs.out;
  }

  /** The notes that aren't excluded (Settings → Files and links → Excluded files). */
  includedNotes(): NoteRef[] {
    const c = this.included;
    if (c && c.notes === this.notes && c.test === this.isExcluded) return c.out;
    const out = this.notes.filter((n) => !this.isExcluded(n.path));
    this.included = { notes: this.notes, test: this.isExcluded, out };
    return out;
  }

  /** Whether a link target points at a file (sets of names and paths, made once per file list). */
  linkExists(target: string, from: string | null): boolean {
    if (this.targets?.files !== this.files) this.targets = { files: this.files, exists: linkTargets(this.files, this.notes) };
    return this.targets.exists(target, from);
  }

  /** The list entry for `path`, or none. */
  entry(path: string): FileEntry | undefined {
    return this.byPath.get(path);
  }

  isFolder(path: string) {
    return this.byPath.get(path)?.is_dir === true;
  }

  /** Mark a file as just modified (our own saves, or a change on disk), for views that cache by modified time. */
  private touch(path: string) {
    const entry = this.byPath.get(path);
    if (entry) entry.mtime_ms = Date.now();
    this.modified.emit(path);
  }

  /** We wrote a note to disk: it is modified now, and the link index is read again a moment later. */
  written(path: string) {
    this.touch(path);
    clearTimeout(this.linkTimer);
    this.linkTimer = window.setTimeout(() => void this.refreshLinks(), LINK_INDEX_DELAY);
  }

  /**
   * A change on disk, not ours. Events that arrive before the frame, or before
   * the fallback timer, share one file-list read (when any event is not a
   * modify), one touch per path that is still here, one reload per such path,
   * and one link-index read. A remove drops that path and everything inside
   * it; a later create, modify, or rename puts a path back.
   */
  private onChanged(kind: string, paths: string[]) {
    const start = this.pending === null;
    (this.pending ??= []).push({ kind, paths });
    if (start) this.armFlush();
  }

  /** One shot for this batch: the frame if it paints, otherwise the timer. */
  private armFlush() {
    const wave = this.wave;
    const ticket = this.ticket;
    const run = () => {
      if (wave !== this.wave || ticket !== this.ticket) return;
      this.ticket += 1;
      this.disarm();
      void this.flushChanges(wave);
    };
    if (typeof requestAnimationFrame === "function") this.frame = requestAnimationFrame(run);
    if (typeof setTimeout === "function") this.timer = setTimeout(run, FLUSH_LIMIT_MS);
    else if (this.frame === null) queueMicrotask(run);
  }

  private disarm() {
    if (this.frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.frame);
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.frame = null;
    this.timer = undefined;
  }

  /** Drop a queued or in-flight disk batch. A new open, or the page going away, must not apply it. */
  private abandon() {
    this.wave += 1;
    this.ticket += 1;
    this.pending = null;
    this.disarm();
    this.filesRequest += 1;
    this.linksRequest += 1;
  }

  private async flushChanges(wave: number) {
    if (wave !== this.wave) return;
    const batch = this.pending;
    this.pending = null;
    if (!batch?.length) return;
    let refresh = false;
    const touch = new Set<string>();
    const reload = new Set<string>();
    for (const change of batch) {
      if (change.kind !== "modify") refresh = true;
      if (change.kind === "remove") for (const path of change.paths) dropTree(path, touch, reload);
      else if (change.kind === "rename") {
        if (change.paths[0]) dropTree(change.paths[0], touch, reload);
        for (const path of change.paths) reload.add(path);
      } else if (change.kind === "modify") {
        for (const path of change.paths) {
          touch.add(path);
          reload.add(path);
        }
      } else for (const path of change.paths) reload.add(path);
    }
    if (refresh) await this.refreshFiles();
    if (wave !== this.wave) return;
    for (const path of touch) this.touch(path);
    for (const path of reload) {
      if (wave !== this.wave) return;
      await this.reload(path);
    }
    if (wave !== this.wave) return;
    void this.refreshLinks();
  }
}
