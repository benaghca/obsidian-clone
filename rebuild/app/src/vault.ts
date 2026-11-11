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
  ) {}

  /** Open the last vault; a note's own window (`reuse`) joins the one the backend already has open. */
  async open(reuse = false) {
    const last = await api.lastVault();
    let info = last;
    if (isTauri && !(reuse && last)) {
      const path =
        last?.path ??
        window.prompt("Vault folder to open", "/home/chris/workspaces/remote/grove-test-vault");
      info = path ? await api.openVault(path) : null;
    }
    if (info) {
      this.path = info.path;
      this.name = info.name;
    }
    await this.refreshFiles();
    void this.refreshLinks();
    api.onVaultChanged((change) => void this.onChanged(change.kind, change.paths));
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
   * A change on disk, not ours. Events in one frame share one file-list read
   * (when any event is not a modify), one touch per modified path, one reload
   * per path, and one link-index read. A remove drops that path from the reload
   * set; a later create, modify, or rename puts it back.
   */
  private onChanged(kind: string, paths: string[]) {
    const start = this.pending === null;
    (this.pending ??= []).push({ kind, paths });
    if (!start) return;
    const flush = () => void this.flushChanges();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(flush);
    else queueMicrotask(flush);
  }

  private async flushChanges() {
    const batch = this.pending;
    this.pending = null;
    if (!batch?.length) return;
    let refresh = false;
    const touch = new Set<string>();
    const reload = new Set<string>();
    for (const change of batch) {
      if (change.kind !== "modify") refresh = true;
      else for (const path of change.paths) touch.add(path);
      if (change.kind === "remove") for (const path of change.paths) reload.delete(path);
      else for (const path of change.paths) reload.add(path);
    }
    if (refresh) await this.refreshFiles();
    for (const path of touch) this.touch(path);
    for (const path of reload) await this.reload(path);
    void this.refreshLinks();
  }
}
