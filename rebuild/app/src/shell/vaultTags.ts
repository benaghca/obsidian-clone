// Tags per note across the vault, for the Tags view, search's tag: terms,
// the graph and the tag suggestions: one reader per workspace, whose result
// is kept until the vault changes (a moment after a save, or a change on
// disk). The backend has no tag index, so this asks its search for lines
// containing "#" (and for fence lines, to skip tags in code blocks) and
// reads the tags from those lines. Frontmatter `tags:` are found by
// searching for the key; only the notes that have it are read, and each is
// read again only when it changes. Saved text only: the Tags view adds the
// open note's unsaved tags.

import { api } from "../api";
import { perWorkspace, type Workspace } from "../workspace";
import { type Frontmatter, frontmatterTags, tagsByNote } from "./linksTags";

const LIMIT = 100_000;

export const vaultTags = perWorkspace((ws: Workspace) => {
  /** Frontmatter read from notes, by path, kept while the note's modified time stays the same. */
  const frontmatter = new Map<string, { mtime: number; fm: Frontmatter }>();

  /** The frontmatter of the notes with a `tags:` (or `tag:`) key on one of their first lines. */
  async function readFrontmatter(keyLines: { path: string; line: number; text: string }[]) {
    const paths = new Set(keyLines.filter((h) => h.line > 1 && h.path.endsWith(".md") && /^tags?\s*:/i.test(h.text)).map((h) => h.path));
    const out = new Map<string, Frontmatter>();
    await Promise.all(
      [...paths].map(async (path) => {
        const mtime = ws.vault.files.find((f) => f.path === path)?.mtime_ms ?? 0;
        const cached = frontmatter.get(path);
        if (cached && cached.mtime === mtime && !ws.editors.isLoaded(path)) return void out.set(path, cached.fm);
        try {
          const fm = frontmatterTags(await ws.editors.text(path));
          frontmatter.set(path, { mtime, fm });
          out.set(path, fm);
        } catch {
          // gone meanwhile
        }
      }),
    );
    return out;
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
    read: () =>
      (tags ??= readTags().catch((err) => {
        forget();
        throw err;
      })),
    forget,
  };
});
