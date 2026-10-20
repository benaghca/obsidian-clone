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
  // Folders made with create_folder that hold no files yet.
  const emptyDirs = new Set<string>();
  const vault: VaultInfo = { path: "/mock/Sample Vault", name: "Sample Vault" };
  // The vault's .grove settings files. Kept in the browser's localStorage so
  // settings survive a reload of the dev page, as they survive a restart in
  // Tauri (where they are files in the vault).
  const CONFIG_KEY = "grove.mock.config:";
  const CONFIG_NAME = /^[a-z0-9-]{1,64}\.json$/;
  const configName = (name: string) => {
    if (!CONFIG_NAME.test(name)) throw new Error(`invalid config name: ${name}`);
    return CONFIG_KEY + name;
  };

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
    const dirs = new Set<string>(emptyDirs);
    for (const path of [...files.keys(), ...emptyDirs]) {
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

  // Line hits are taken round-robin across files so one long note cannot fill `limit`
  // and hide matches in the rest of the vault (unlinked mentions depend on this).
  function search(query: string, limit: number): SearchHit[] {
    const q = query.toLowerCase();
    if (!q || limit <= 0) return [];
    const buckets: SearchHit[][] = [];
    for (const [path, f] of files) {
      const bucket: SearchHit[] = [];
      const lines = f.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(q)) bucket.push({ path, line: i + 1, text: lines[i] });
      }
      if (bucket.length) buckets.push(bucket);
    }
    const hits: SearchHit[] = [];
    for (let round = 0; hits.length < limit; round++) {
      let added = false;
      for (const bucket of buckets) {
        if (round < bucket.length) {
          hits.push(bucket[round]);
          added = true;
          if (hits.length >= limit) break;
        }
      }
      if (!added) break;
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
      for (const dir of [...emptyDirs]) if (path.startsWith(dir + "/")) emptyDirs.delete(dir);
      return entry(path);
    },
    create_folder: ({ path }) => {
      if (files.has(path) || listFiles().some((e) => e.path === path)) throw new Error(`Already exists: ${path}`);
      emptyDirs.add(path);
      return { path, name: nameOf(path), is_dir: true, mtime_ms: Date.now(), size: 0 };
    },
    rename_path: ({ from, to }) => {
      if (listFiles().some((e) => e.path === to)) throw new Error(`Already exists: ${to}`);
      const under = (p: string) => p === from || p.startsWith(from + "/");
      for (const [path, f] of [...files]) {
        if (under(path)) {
          files.delete(path);
          files.set(to + path.slice(from.length), f);
        }
      }
      for (const dir of [...emptyDirs]) {
        if (under(dir)) {
          emptyDirs.delete(dir);
          emptyDirs.add(to + dir.slice(from.length));
        }
      }
    },
    // `permanent` makes no difference here: the mock has no .trash.
    delete_path: ({ path }) => {
      const under = (p: string) => p === path || p.startsWith(path + "/");
      for (const p of [...files.keys()]) if (under(p)) files.delete(p);
      for (const d of [...emptyDirs]) if (under(d)) emptyDirs.delete(d);
    },
    search: ({ query, limit }) => search(query, limit),
    link_index: () => linkIndex(),
    read_config: ({ name }) => {
      const key = configName(name);
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write_config: ({ name, content }) => {
      const key = configName(name);
      JSON.parse(content); // must be JSON, as in the backend
      try {
        localStorage.setItem(key, content);
      } catch {
        // storage full or disabled: not remembered
      }
    },
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
