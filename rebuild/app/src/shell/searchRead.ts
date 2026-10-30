// Coalesce search-view requests so typing can never queue many vault scans.
import { api, type SearchNote, type FileEntry } from "../api";
import { compareFiles, type SortOrder } from "../paths";
import type { Workspace } from "../workspace";

export interface SearchRequest { query: string; matchCase: boolean; seq: number }

/** Preserve backend tie order while applying the frontend's exclusions and locale sort. */
export function searchResults(files: readonly FileEntry[], notes: readonly SearchNote[], excluded: (path: string) => boolean, sort: SortOrder) {
  const entries = new Map(files.filter(f => !f.is_dir).map(f => [f.path, f]));
  return notes.filter(n => entries.has(n.path) && !excluded(n.path))
    .map(n => ({ ...entries.get(n.path)!, count: n.count })).sort(compareFiles(sort));
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
