// Tags per note across the vault, for the Tags view, search's tag: terms,
// the graph and the tag suggestions: one reader per workspace, whose result
// is kept until the vault changes (a moment after a save, or a change on
// disk). The backend has no tag index, so this asks its search for lines
// containing "#" (and for fence lines, to skip tags in code blocks) and
// reads the tags from those lines. Frontmatter `tags:` are found by
// searching for the key; the frontmatter of the notes that have it comes
// from the backend's index in one call. Saved text only: the Tags view adds
// the open note's unsaved tags.

import { api, type SearchHit } from "../api";
import { perWorkspace } from "../memo";
import type { Workspace } from "../workspace";
import { type Frontmatter, frontmatterTags, tagsByNote } from "./linksTags";

const LIMIT = 100_000;

export const vaultTags = perWorkspace((ws: Workspace) => {
  /** The frontmatter of the notes with a `tags:` (or `tag:`) key below their first line. */
  async function readFrontmatter(keyLines: SearchHit[]): Promise<Map<string, Frontmatter>> {
    const paths = new Set(keyLines.filter((h) => h.line > 1 && h.path.endsWith(".md") && /^tags?\s*:/i.test(h.text)).map((h) => h.path));
    const blocks = await api.frontmatter([...paths]);
    return new Map(Object.entries(blocks).map(([path, text]) => [path, frontmatterTags(text)]));
  }

  async function readTags(): Promise<Map<string, string[]>> {
    const [tagLines, ticks, tildes, keys, oldKeys] = await Promise.all([
      api.search("#", LIMIT),
      api.search("```", LIMIT),
      api.search("~~~", LIMIT),
      api.search("tags:", LIMIT),
      api.search("tag:", LIMIT),
    ]);
    const fm = await readFrontmatter([...keys, ...oldKeys]);
    return tagsByNote(tagLines, [...ticks, ...tildes], fm);
  }

  let tags: Promise<Map<string, string[]>> | null = null;
  const forget = () => (tags = null);
  ws.on((change) => {
    if (change === "files" || change === "links") forget();
  });
  return {
    /** Every note's saved tags (notes without tags are left out), read again only after a change. */
    read: () => {
      if (!tags) {
        const pending = readTags().catch((err) => {
          if (tags === pending) forget();
          throw err;
        });
        tags = pending;
      }
      return tags;
    },
    forget,
  };
});
