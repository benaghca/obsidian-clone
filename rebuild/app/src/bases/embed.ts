// A base drawn inside a note (BASES_PLAN §3.5): a ```base block's YAML, or
// ![[X.base]] / ![[X.base#View]]. It is the tab's view (view.ts) with `this`
// as the note it is drawn in, inside a box of capped height that scrolls.
// Viewing writes nothing; the toolbar writes a .base file as the tab does, and
// a block's YAML back into its note, through that note's editor.

import type { EditorView } from "@codemirror/view";
import type { BaseEmbed } from "../editor/host";
import type { Workspace } from "../workspace";
import type { BaseFile } from "./menus";
import { baseFile, createBase } from "./view";

export function mountBaseEmbed(ws: Workspace, parent: HTMLElement, embed: BaseEmbed, view: EditorView) {
  let yaml = embed.yaml ?? "", write = embed.write;
  const block: BaseFile = {
    read: async () => yaml,
    async write(text) {
      if (!write?.(text)) throw Error("Open the note this base is in to change it.");
      yaml = text;
    },
  };
  const base = createBase(ws, {
    group: ws.editors.groupOfView(view) ?? ws.activeGroup,
    file: embed.path ? baseFile(ws, embed.path) : block,
    watch: embed.path,
    host: embed.host,
    viewIndex: 0,
    viewName: embed.view || undefined,
  });
  parent.append(base.el);
  return {
    update(next: BaseEmbed) {
      write = next.write;
      if (next.yaml === undefined || next.yaml === yaml) return;
      yaml = next.yaml;
      base.reload();
    },
    destroy: () => base.dispose(),
  };
}
