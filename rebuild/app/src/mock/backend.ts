// In-memory stand-in for the Tauri backend, used only outside Tauri.
// Implements the commands in rebuild/CONTRACT.md against sampleVault().

import type { Backlink, FileEntry, Invoke, LinkIndex, Listen, SearchHit, VaultInfo } from "../api";
import { resolveLink } from "../links/internal";
import { fileName, noteName } from "../paths";
import { sampleVault, syntheticVault } from "./sampleVault";

const WIKILINK = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;
/** [text](target) and ![alt](target); the target as written (without a title). */
const MDLINK = /(?<!\[)\[[^\]\n]*\]\((?:<([^>\n]*)>|([^)\s]*))[^)\n]*\)/g;

/** A mock image's bytes: SVG text as it is, "png WxH #colour" painted into a PNG. */
async function imageBytes(content: string): Promise<ArrayBuffer> {
  const png = /^png (\d+)x(\d+) (#\w+)/.exec(content);
  if (!png) return new TextEncoder().encode(content).buffer as ArrayBuffer;
  const canvas = new OffscreenCanvas(Number(png[1]), Number(png[2]));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = png[3];
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
}

export function createMockBackend(): { invoke: Invoke; listen: Listen } {
  const files = new Map<string, { content: string; mtime: number; ctime: number }>();
  const put = (path: string, content: string) => files.set(path, { content, mtime: Date.now(), ctime: files.get(path)?.ctime ?? Date.now() });
  // `?synthetic=1000` on the dev page adds a generated 1,000-note vault (for measuring the graph).
  const synthetic = Number(new URLSearchParams(location.search).get("synthetic")) || 0;
  const vaultFiles = { ...sampleVault(), ...(synthetic > 0 ? syntheticVault(Math.min(synthetic, 20000)) : {}) };
  for (const [path, content] of Object.entries(vaultFiles)) {
    put(path, content);
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


  function entry(path: string): FileEntry {
    const f = files.get(path)!;
    return { path, name: noteName(path), is_dir: false, mtime_ms: f.mtime, ctime_ms: f.ctime, size: f.content.length };
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
      name: fileName(path),
      is_dir: true,
      mtime_ms: 0,
      ctime_ms: 0,
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

  // Links resolve as the front end resolves them (links/internal.ts), which is how the backend does.
  function linkIndex(): LinkIndex {
    const notes = [...files.keys()].map((path) => ({ name: noteName(path), path }));
    const outgoing: Record<string, string[]> = {};
    const backlinks: Record<string, Backlink[]> = {};
    const markdown: Record<string, string[]> = {};
    const unresolved: Record<string, string[]> = {};
    for (const [path, f] of files) {
      const out = new Set<string>();
      const md = new Set<string>();
      const missing = new Map<string, string>();
      const unknown = (name: string) => missing.has(name.toLowerCase()) || missing.set(name.toLowerCase(), name);
      f.content.split("\n").forEach((text, i) => {
        for (const m of text.matchAll(WIKILINK)) {
          const name = m[1].trim();
          const target = resolveLink(name, path, notes);
          if (!target) {
            unknown(name);
            continue;
          }
          out.add(target);
          (backlinks[target] ??= []).push({ from: path, line: i + 1, text });
        }
        for (const m of text.matchAll(MDLINK)) {
          const raw = (m[1] ?? m[2] ?? "").split("#")[0].trim();
          if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
          const hit = resolveLink(raw, path, notes);
          if (hit) md.add(hit);
          else unknown(raw.replace(/^\.\//, "").replace(/\.md$/i, ""));
        }
      });
      if (out.size) outgoing[path] = [...out];
      if (md.size) markdown[path] = [...md];
      if (missing.size) unresolved[path] = [...missing.values()];
    }
    return { outgoing, backlinks, markdown, unresolved };
  }

  const commands: Record<string, (a: any) => unknown> = {
    open_vault: () => vault,
    last_vault: () => vault,
    list_files: () => listFiles(),
    read_note: ({ path }) => need(path).content,
    read_file_bytes: ({ path }) => {
      if (!/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(path) || path.split("/").includes("..")) throw new Error(`not an image: ${path}`);
      return imageBytes(need(path).content);
    },
    write_note: ({ path, content }) => {
      put(path, content);
    },
    create_note: ({ path, content }) => {
      if (files.has(path)) throw new Error(`Already exists: ${path}`);
      put(path, content);
      for (const dir of [...emptyDirs]) if (path.startsWith(dir + "/")) emptyDirs.delete(dir);
      return entry(path);
    },
    create_folder: ({ path }) => {
      if (files.has(path) || listFiles().some((e) => e.path === path)) throw new Error(`Already exists: ${path}`);
      emptyDirs.add(path);
      return { path, name: noteName(path), is_dir: true, mtime_ms: Date.now(), ctime_ms: 0, size: 0 };
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
    frontmatter: ({ paths }) => {
      const out: Record<string, string> = {};
      for (const path of (paths as string[] | null) ?? [...files.keys()]) {
        const lines = path.endsWith(".md") ? files.get(path)?.content.split("\n") : undefined;
        const close = lines && lines[0].trim() === "---" ? lines.findIndex((l, i) => i > 0 && l.trim() === "---") : -1;
        if (close > 0 && close <= 2000) out[path] = lines!.slice(0, close + 1).join("\n");
      }
      return out;
    },
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
