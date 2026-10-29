// Tags per note across the vault, for the Tags view, search's tag: terms,
// the graph and the tag suggestions: one reader per workspace, whose result
// is kept until the vault changes (a moment after a save, or a change on
// disk). The backend keeps each note's tags in its index (index/tags.rs, a
// port of tagsInText). Saved text only: the Tags view adds the open note's
// unsaved tags.

import { api } from "../api";
import { perWorkspace } from "../memo";
import type { Workspace } from "../workspace";

export const vaultTags = perWorkspace((ws: Workspace) => {
  const readTags = async () => new Map(Object.entries(await api.tags()));

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
