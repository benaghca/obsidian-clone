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
import { noteName } from "./paths";

const LINK_INDEX_DELAY = 1000;

export class Vault {
  path = "";
  name = "";
  files: FileEntry[] = [];
  notes: NoteRef[] = [];
  links: LinkIndex = { outgoing: {} };
  /** Excluded files (Settings → Files and links): left out of the switcher, search, suggestions. */
  isExcluded: (path: string) => boolean = () => false;

  private linkTimer = 0;
  private filesRequest = 0;
  private linksRequest = 0;
  private modified = listeners<[string]>();
  /** Listen for a file being modified (on disk, or saved here); returns a function that stops. */
  readonly onModified = this.modified.on;
  private included: { notes: NoteRef[]; test: (path: string) => boolean; out: NoteRef[] } | null = null;
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
      .filter((f) => !f.is_dir && f.path.toLowerCase().endsWith(".md"))
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

  isFolder(path: string) {
    return this.files.some((f) => f.path === path && f.is_dir);
  }

  /** Mark a file as just modified (our own saves, or a change on disk), for views that cache by modified time. */
  private touch(path: string) {
    const entry = this.files.find((f) => f.path === path);
    if (entry) entry.mtime_ms = Date.now();
    this.modified.emit(path);
  }

  /** We wrote a note to disk: it is modified now, and the link index is read again a moment later. */
  written(path: string) {
    this.touch(path);
    clearTimeout(this.linkTimer);
    this.linkTimer = window.setTimeout(() => void this.refreshLinks(), LINK_INDEX_DELAY);
  }

  /** A change on disk, not ours: the file list (or the files' times), loaded notes' text and the link index follow. */
  private async onChanged(kind: string, paths: string[]) {
    if (kind !== "modify") await this.refreshFiles();
    else for (const path of paths) this.touch(path);
    if (kind !== "remove") for (const path of paths) await this.reload(path);
    void this.refreshLinks();
  }
}
