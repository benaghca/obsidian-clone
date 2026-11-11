// Coalesce search-view requests so typing can never queue many vault scans.
import { api, type SearchNote, type FileEntry } from "../api";
import { compareNames, type SortOrder } from "../paths";
import type { Workspace } from "../workspace";

export interface SearchRequest { query: string; matchCase: boolean; seq: number }

let mapBuilds = 0;
let collatorSorts = 0;

/** Per-file map builds and collator sorts since the last read. An unchanged file list does neither again. */
export function takeSearchWork(): { mapBuilds: number; collatorSorts: number } {
  const out = { mapBuilds, collatorSorts };
  mapBuilds = 0;
  collatorSorts = 0;
  return out;
}

interface RankedFiles {
  length: number;
  byPath: Map<string, FileEntry>;
  /** Equal names share a rank, so a later integer sort keeps the backend's tie order. */
  nameRank: Map<string, number>;
}

const rankedFiles = new WeakMap<readonly FileEntry[], RankedFiles>();

function rankFiles(files: readonly FileEntry[]): RankedFiles {
  const cached = rankedFiles.get(files);
  if (cached && cached.length === files.length) return cached;
  mapBuilds += 1;
  collatorSorts += 1;
  const byPath = new Map<string, FileEntry>();
  for (const f of files) if (!f.is_dir) byPath.set(f.path, f);
  const rows = [...byPath].map(([path, f], at) => ({ path, name: f.name, at }));
  rows.sort((a, b) => compareNames(a.name, b.name) || a.at - b.at);
  const nameRank = new Map<string, number>();
  let rank = 0;
  let prev = "";
  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && compareNames(prev, rows[i].name) !== 0) rank++;
    prev = rows[i].name;
    nameRank.set(rows[i].path, rank);
  }
  const built = { length: files.length, byPath, nameRank };
  rankedFiles.set(files, built);
  return built;
}

/** Preserve backend tie order while applying the frontend's exclusions and locale sort. */
export function searchResults(files: readonly FileEntry[], notes: readonly SearchNote[], excluded: (path: string) => boolean, sort: SortOrder): SearchNote[] {
  const ranked = rankFiles(files);
  const timeOf = (path: string) => {
    const f = ranked.byPath.get(path)!;
    return sort.startsWith("byCreated") ? f.ctime_ms : f.mtime_ms;
  };
  return notes.filter(n => ranked.byPath.has(n.path) && !excluded(n.path))
    .map(n => ({ path: n.path, count: n.count }))
    .sort((a, b) => {
      const ra = ranked.nameRank.get(a.path)!;
      const rb = ranked.nameRank.get(b.path)!;
      if (sort === "alphabetical") return ra - rb;
      if (sort === "alphabeticalReverse") return rb - ra;
      const age = timeOf(b.path) - timeOf(a.path);
      return (sort.endsWith("Reverse") ? -age : age) || ra - rb;
    });
}

export function searchReader(ws: Pick<Workspace, "editors">, receive: (request: SearchRequest, notes: SearchNote[]) => void, failed: (request: SearchRequest, error: unknown) => void) {
  let latest: SearchRequest | null = null;
  let running = false;
  let version = 0;
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (latest) {
        const request: SearchRequest = latest;
        const mine = version;
        latest = null;
        try {
          await ws.editors.flush();
          if (mine !== version) continue; // Input changed during the flush: send only the newest.
          const notes = await api.searchNotes(request.query, request.matchCase);
          if (mine === version) receive(request, notes);
        } catch (error) {
          if (mine === version) failed(request, error);
        }
      }
    } finally { running = false; }
  }
  return {
    read(request: SearchRequest) { version++; latest = request; void drain(); },
    cancel() { version++; latest = null; },
  };
}
