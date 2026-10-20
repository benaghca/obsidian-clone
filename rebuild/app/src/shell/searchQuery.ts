// The search view's query: plain words for the backend's line search, plus
// Obsidian's `path:` operator ("Search in folder" fills it in), which the
// front end applies to the hits. Pure, so it is tested on its own.

export interface SearchQuery {
  /** What to search the text for ("" when only a path is given). */
  text: string;
  /** Only files under this folder (or whose path contains it), lower case; "" for all. */
  path: string;
}

const PATH = /(?:^|\s)path:(?:"([^"]*)"|(\S+))/i;

export function parseSearchQuery(query: string): SearchQuery {
  const m = PATH.exec(query);
  if (!m) return { text: query.trim(), path: "" };
  const path = (m[1] ?? m[2] ?? "").trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  const text = (query.slice(0, m.index) + " " + query.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
  return { text, path };
}

/** Whether a vault path passes the query's path filter (Obsidian matches anywhere in the path). */
export function matchesPath(filePath: string, path: string): boolean {
  return !path || filePath.toLowerCase().includes(path);
}

/** `path:"folder"` for a folder, quoted when it has spaces, as Obsidian writes it. */
export const pathQuery = (folder: string) => `path:"${folder}" `;
