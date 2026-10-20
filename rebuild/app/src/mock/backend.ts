// In-memory stand-in for the Tauri backend, used only outside Tauri.
// Implements the commands in rebuild/CONTRACT.md against sampleVault().

import type { Backlink, FileEntry, Invoke, LinkIndex, Listen, SearchHit, VaultInfo } from "../api";
import { sampleVault } from "./sampleVault";

const WIKILINK = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;

export function createMockBackend(): { invoke: Invoke; listen: Listen } {
  const files = new Map<string, { content: string; mtime: number }>();
  for (const [path, content] of Object.entries(sampleVault())) {
    files.set(path, { content, mtime: Date.now() });
  }
  const vault: VaultInfo = { path: "/mock/Sample Vault", name: "Sample Vault" };

  const nameOf = (path: string) => path.split("/").pop()!.replace(/\.md$/, "");

  function entry(path: string): FileEntry {
    const f = files.get(path)!;
    return { path, name: nameOf(path), is_dir: false, mtime_ms: f.mtime, size: f.content.length };
  }

  function need(path: string) {
    const f = files.get(path);
    if (!f) throw new Error(`No such file: ${path}`);
    return f;
  }

  function listFiles(): FileEntry[] {
    const dirs = new Set<string>();
    for (const path of files.keys()) {
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    }
    const out: FileEntry[] = [...dirs].map((path) => ({
      path,
      name: path.split("/").pop()!,
      is_dir: true,
      mtime_ms: 0,
      size: 0,
    }));
    for (const path of files.keys()) out.push(entry(path));
    return out;
  }

  function search(query: string, limit: number): SearchHit[] {
    const q = query.toLowerCase();
    const hits: SearchHit[] = [];
    if (!q) return hits;
    for (const [path, f] of files) {
      const lines = f.content.split("\n");
      for (let i = 0; i < lines.length && hits.length < limit; i++) {
        if (lines[i].toLowerCase().includes(q)) hits.push({ path, line: i + 1, text: lines[i] });
      }
      if (hits.length >= limit) break;
    }
    return hits;
  }

  function linkIndex(): LinkIndex {
    const byName = new Map<string, string>();
    for (const path of files.keys()) byName.set(nameOf(path).toLowerCase(), path);
    const outgoing: Record<string, string[]> = {};
    const backlinks: Record<string, Backlink[]> = {};
    for (const [path, f] of files) {
      const out = new Set<string>();
      const lines = f.content.split("\n");
      lines.forEach((text, i) => {
        for (const m of text.matchAll(WIKILINK)) {
          const target = byName.get(m[1].trim().toLowerCase());
          if (!target) continue;
          out.add(target);
          (backlinks[target] ??= []).push({ from: path, line: i + 1, text });
        }
      });
      outgoing[path] = [...out];
    }
    return { outgoing, backlinks };
  }

  const commands: Record<string, (a: any) => unknown> = {
    open_vault: () => vault,
    last_vault: () => vault,
    list_files: () => listFiles(),
    read_note: ({ path }) => need(path).content,
    write_note: ({ path, content }) => {
      files.set(path, { content, mtime: Date.now() });
    },
    create_note: ({ path, content }) => {
      if (files.has(path)) throw new Error(`Already exists: ${path}`);
      files.set(path, { content, mtime: Date.now() });
      return entry(path);
    },
    rename_path: ({ from, to }) => {
      for (const [path, f] of [...files]) {
        if (path === from || path.startsWith(from + "/")) {
          files.delete(path);
          files.set(to + path.slice(from.length), f);
        }
      }
    },
    delete_path: ({ path }) => {
      for (const p of [...files.keys()]) if (p === path || p.startsWith(path + "/")) files.delete(p);
    },
    search: ({ query, limit }) => search(query, limit),
    link_index: () => linkIndex(),
  };

  return {
    invoke: async <T>(cmd: string, args: Record<string, unknown> = {}) => {
      const fn = commands[cmd];
      if (!fn) throw new Error(`Mock backend: unknown command ${cmd}`);
      return fn(args) as T;
    },
    // The mock never changes behind the front end's back, so no events fire.
    listen: async () => () => {},
  };
}
