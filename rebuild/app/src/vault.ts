// The open vault as the app knows it: its folder and name, the file list,
// the notes, and the backend's link index. It follows our own saves (the
// link index is read again a moment later) and changes on disk (the
// backend's vault-changed), and answers the questions the file list settles:
// which notes aren't excluded, whether a link target exists. The workspace
// (workspace.ts) holds one, as `ws.vault`.

import { api, type FileEntry, isTauri, type LinkIndex } from "./api";
import type { NoteRef } from "./editor/host";
import { backendRoot, onBackendRootChange, pageOwnsDisk } from "./vaultRoot";
import { linkTargets } from "./links/internal";
import { listeners } from "./listeners";
import { isNoteFile, noteName } from "./paths";

const LINK_INDEX_DELAY = 1000;
/** A hidden webview may never paint. The same batch still flushes this soon, once. */
const FLUSH_LIMIT_MS = 50;

/** Prefix-segment steps in the latest disk-batch reduction. A full scan of every queued path shows up here. */
export let batchVisits = 0;

type Tomb = { removedAt: number; kids: Map<string, Tomb> | null };
type Stamp = { path: string; at: number };

function tomb(): Tomb {
  return { removedAt: 0, kids: null };
}

/** Walk one path. Each segment is one visit, whether or not the prefix was removed. */
function walk(root: Tomb, path: string, make: boolean): Tomb | null {
  let at = root;
  for (const part of path.split("/")) {
    batchVisits += 1;
    let kids = at.kids;
    if (!kids) {
      if (!make) return null;
      kids = at.kids = new Map();
    }
    let next = kids.get(part);
    if (!next) {
      if (!make) return null;
      next = tomb();
      kids.set(part, next);
    }
    at = next;
  }
  return at;
}

/** True when this path, or a folder above it, was removed after `addedAt`. */
function buried(root: Tomb, path: string, addedAt: number): boolean {
  let at = root;
  for (const part of path.split("/")) {
    batchVisits += 1;
    const next = at.kids?.get(part);
    if (!next) return false;
    if (next.removedAt > addedAt) return true;
    at = next;
  }
  return false;
}

/** Paths in first-seen order. A later recreate appends; a repeat while still live keeps its place. */
class Marks {
  private list: Stamp[] = [];
  private index = new Map<string, number>();

  add(path: string, at: number, tombs: Tomb) {
    const have = this.index.get(path);
    if (have === undefined || buried(tombs, path, this.list[have]!.at)) {
      this.index.set(path, this.list.length);
      this.list.push({ path, at });
    } else this.list[have]!.at = at;
  }

  live(tombs: Tomb): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const mark of this.list) {
      if (seen.has(mark.path) || buried(tombs, mark.path, mark.at)) continue;
      seen.add(mark.path);
      out.push(mark.path);
    }
    return out;
  }
}

function reduceBatch(batch: { kind: string; paths: string[] }[]) {
  batchVisits = 0;
  let refresh = false;
  let seq = 0;
  const tombs = tomb();
  const touch = new Marks();
  const reload = new Marks();
  const bury = (path: string) => {
    const node = walk(tombs, path, true);
    if (node) node.removedAt = ++seq;
  };
  for (const change of batch) {
    if (change.kind !== "modify") refresh = true;
    if (change.kind === "remove") for (const path of change.paths) bury(path);
    else if (change.kind === "rename") {
      if (change.paths[0]) bury(change.paths[0]);
      for (const path of change.paths) reload.add(path, ++seq, tombs);
    } else if (change.kind === "modify") {
      for (const path of change.paths) {
        const at = ++seq;
        touch.add(path, at, tombs);
        reload.add(path, at, tombs);
      }
    } else for (const path of change.paths) reload.add(path, ++seq, tombs);
  }
  return { refresh, touch: touch.live(tombs), reload: reload.live(tombs) };
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
  /** After the page goes away, disk events wait until it is shown again or the vault opens. */
  private suspended = false;
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
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", () => this.abandon());
      window.addEventListener("pageshow", () => { this.suspended = false; });
    }
    // A root change invalidates a list that was started on the previous vault.
    // Rollback bumps the root again, so that reply still cannot install.
    onBackendRootChange(() => {
      this.filesRequest += 1;
      this.linksRequest += 1;
    });
  }

  /** Open the last vault; a note's own window (`reuse`) joins the one the backend already has open. */
  async open(reuse = false) {
    this.abandon();
    this.suspended = false;
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
    const vault = backendRoot();
    const files = await api.listFiles();
    // The reply is the vault that was current when the read ran. Install it
    // only if that vault is still this page's backend.
    if (mine !== this.filesRequest || backendRoot() !== vault || !pageOwnsDisk()) return;
    this.files = files;
    this.notes = this.files
      .filter((f) => !f.is_dir && isNoteFile(f.path))
      .map((f) => ({ name: noteName(f.path), path: f.path }));
    this.changed("files");
  }

  async refreshLinks() {
    const mine = ++this.linksRequest;
    const vault = backendRoot();
    const links = await api.linkIndex();
    if (mine !== this.linksRequest || backendRoot() !== vault || !pageOwnsDisk()) return;
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
    // A sealed page, or one whose vault is no longer the backend, must not
    // queue a refresh that would replace its models with the other vault.
    if (this.suspended || !pageOwnsDisk()) return;
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
    this.suspended = true;
    this.pending = null;
    this.disarm();
    this.filesRequest += 1;
    this.linksRequest += 1;
  }

  private async flushChanges(wave: number) {
    if (wave !== this.wave) return;
    // Ownership can change while the file list is in flight. Drop the batch
    // instead of touching or reloading the page that no longer owns the disk.
    if (!pageOwnsDisk()) {
      this.pending = null;
      return;
    }
    const batch = this.pending;
    this.pending = null;
    if (!batch?.length) return;
    const { refresh, touch, reload } = reduceBatch(batch);
    if (refresh) await this.refreshFiles();
    if (wave !== this.wave || !pageOwnsDisk()) return;
    for (const path of touch) this.touch(path);
    for (const path of reload) {
      if (wave !== this.wave || !pageOwnsDisk()) return;
      await this.reload(path);
    }
    if (wave !== this.wave || !pageOwnsDisk()) return;
    void this.refreshLinks();
  }
}
