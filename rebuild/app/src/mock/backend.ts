// In-memory stand-in for the Tauri backend, used only outside Tauri.
// Implements the commands in rebuild/CONTRACT.md against sampleVault().

import type { Backlink, FileEntry, NoteProperties, Invoke, LinkIndex, Listen, SearchHit, SearchNote, SearchLine, VaultInfo } from "../api";
import { readProperties, splitFrontmatter } from "../editor/frontmatter";
import { linkSpellings, markdownURL, resolveLink } from "../links/internal";
import { tagsInText } from "../shell/linksTags";
import { fileName, noteName } from "../paths";
import { createSearchVault } from "../shell/searchVault";
import { sampleVault, syntheticVault } from "./sampleVault";

const WIKILINK = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;
/** [text](target) and ![alt](target); the target as written (without a title). */
const MDLINK = /(?<!\[)\[[^\]\n]*\]\((?:<([^>\n]*)>|((?:\\.|[^\\)\s])*))[^)\n]*\)/g;

/** Binary files written by `write_file_bytes`, so a later read returns the same bytes. */
const BYTE_MARK = "\u0000grove-bytes:";
const BYTE_MAX = 20 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function isBinary(content: string) {
  return content.startsWith(BYTE_MARK);
}

/** The same refusals as the Rust path check: nothing outside the vault or in a hidden folder. */
function badPath(path: string): string | null {
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.includes(":")) return "invalid path";
  const hidden = new Set([".grove", ".obsidian", ".git", ".trash"]);
  if (path.split("/").some((p) => !p || p === "." || p === ".." || hidden.has(p) || p.includes(".grove-tmp"))) return "invalid path";
  return null;
}

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
  // The switcher remembers the chosen vault here so a reload (same tab) opens
  // it. The sample vault is the default. A different path starts empty: this
  // mock does not create a folder on disk.
  const SAMPLE_PATH = "/mock/Sample Vault";
  const OPEN_KEY = "grove.mock.openVault";
  const CREATED_KEY = "grove.mock.createdVaults";
  const folderName = (path: string) => path.split(/[/\\]/).filter(Boolean).pop() || path;
  const readSaved = (): VaultInfo | null => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(OPEN_KEY) ?? "null") as { path?: unknown; name?: unknown } | null;
      if (!saved || typeof saved.path !== "string" || !saved.path.trim()) return null;
      const path = saved.path.trim();
      const name = typeof saved.name === "string" && saved.name.trim() ? saved.name.trim() : folderName(path);
      return { path, name };
    } catch {
      return null;
    }
  };
  const saved = readSaved();
  const vault: VaultInfo = saved ?? { path: SAMPLE_PATH, name: "Sample Vault" };
  if (vault.path === SAMPLE_PATH) {
    for (const [path, content] of Object.entries(vaultFiles)) put(path, content);
  }
  // Folders made with create_folder that hold no files yet.
  const emptyDirs = new Set<string>();
  const persistVault = (path: string): VaultInfo => {
    const trimmed = path.trim();
    if (!trimmed) throw new Error("empty path");
    const info = trimmed === SAMPLE_PATH ? { path: SAMPLE_PATH, name: "Sample Vault" } : { path: trimmed, name: folderName(trimmed) };
    vault.path = info.path;
    vault.name = info.name;
    try {
      sessionStorage.setItem(OPEN_KEY, JSON.stringify(info));
    } catch {
      // the next load keeps the previous vault
    }
    return { path: info.path, name: info.name };
  };
  const createdVaults = (): string[] => {
    try {
      const raw = JSON.parse(sessionStorage.getItem(CREATED_KEY) ?? "[]") as unknown;
      return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  };
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
    const binary = isBinary(f.content) ? base64ToBytes(f.content.slice(BYTE_MARK.length)) : null;
    return { path, name: noteName(path), is_dir: false, mtime_ms: f.mtime, ctime_ms: f.ctime, size: binary ? binary.byteLength : f.content.length };
  }

  function need(path: string) {
    const f = files.get(path);
    if (!f) throw new Error(`No such file: ${path}`);
    return f;
  }

  // A folder that loses its last file stays listed. On disk the directory remains.
  function keepEmptyParents(path: string) {
    let parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    while (parent) {
      const prefix = `${parent}/`;
      const still = [...files.keys()].some((p) => p.startsWith(prefix)) || [...emptyDirs].some((d) => d === parent || d.startsWith(prefix));
      if (!still) emptyDirs.add(parent);
      const slash = parent.lastIndexOf("/");
      parent = slash < 0 ? "" : parent.slice(0, slash);
    }
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
      if (isBinary(f.content)) continue;
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

  const matchVault = createSearchVault();
  // Rust indexes note bodies only up to 8 MB; attachments have names but no facts.
  const searchFiles = () => Object.fromEntries([...files].map(([path, file]) => {
    let text = /\.md$/i.test(path) && !isBinary(file.content) ? file.content : "";
    if (text.length * 3 > 8 * 1024 * 1024 && new TextEncoder().encode(text).length > 8 * 1024 * 1024) text = "";
    return [path, text];
  }));
  const pathOrder = (a: string, b: string) => {
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      const x = a.codePointAt(i)!, y = b.codePointAt(j)!;
      if (x !== y) return x - y;
      i += x > 0xffff ? 2 : 1; j += y > 0xffff ? 2 : 1;
    }
    return a.length - b.length;
  };
  const searchNotes = (query: string, matchCase: boolean): SearchNote[] => {
    const matches = matchVault(searchFiles(), query, matchCase);
    return Object.keys(matches ?? {}).filter(path => /\.md$/i.test(path)).sort(pathOrder)
      .map(path => ({ path, count: (matches![path] as { count: number }).count }));
  };
  const searchLines = (query: string, matchCase: boolean, paths: string[], limit: number): Record<string, SearchLine[]> => {
    if (limit <= 0) return {};
    const source = searchFiles();
    const matches = matchVault(source, query, matchCase, paths.filter(path => /\.md$/i.test(path)));
    const out: Record<string, SearchLine[]> = {};
    for (const path of Object.keys(matches ?? {}).sort(pathOrder)) {
      const text = source[path].replace(/^\uFEFF/, "");
      const lines = text.split("\n");
      const shown = (matches![path] as { lines: number[] }).lines.slice(0, limit).map(line => ({
        line, text: line < lines.length && lines[line - 1].endsWith("\r") ? lines[line - 1].slice(0, -1) : lines[line - 1],
      }));
      if (shown.length) out[path] = shown;
    }
    return out;
  };

  // Links resolve as the front end resolves them (links/internal.ts), which is how the backend does.
  function linkData(wanted?: Set<string>): { links: LinkIndex; backlinks: Record<string, Backlink[]> } {
    const notes = [...files.keys()].map((path) => ({ name: noteName(path), path }));
    const outgoing: Record<string, string[]> = {};
    const backlinks: Record<string, Backlink[]> = {};
    const markdown: Record<string, string[]> = {};
    const unresolved: Record<string, string[]> = {};
    for (const [path, f] of files) {
      if (isBinary(f.content)) continue;
      const out = new Set<string>();
      const md = new Set<string>();
      const missing = new Map<string, string>();
      const unknown = (name: string) => missing.has(name.toLowerCase()) || missing.set(name.toLowerCase(), name);
      let fence: { marker: string; len: number } | null = null;
      f.content.split("\n").forEach((text, i) => {
        const fm = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
        if (fence) {
          if (fm && fm[1][0] === fence.marker && fm[1].length >= fence.len && !fm[2].trim()) fence = null;
          return;
        }
        if (fm && !(fm[1][0] === "`" && fm[2].includes("`"))) {
          fence = { marker: fm[1][0], len: fm[1].length };
          return;
        }
        let scan = text;
        if (text.includes("`")) {
          const parts = text.split(/(`+)/);
          for (let j = 1; j < parts.length; j += 2) {
            const close = parts.indexOf(parts[j], j + 2);
            if (close > 0) {
              parts.fill(" ", j, close + 1);
              j = close;
            }
          }
          scan = parts.join("");
        }
        for (const m of scan.matchAll(WIKILINK)) {
          const name = m[1].trim();
          const target = resolveLink(name, path, notes);
          if (!target) {
            unknown(name);
            continue;
          }
          out.add(target);
          if (wanted?.has(target)) (backlinks[target] ??= []).push({ from: path, line: i + 1, text });
        }
        for (const m of scan.matchAll(MDLINK)) {
          const raw = (m[1] ?? m[2] ?? "").split("#")[0].trim();
          if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
          const hit = resolveLink(raw, path, notes);
          if (hit) {
            md.add(hit);
            if (wanted?.has(hit)) (backlinks[hit] ??= []).push({ from: path, line: i + 1, text });
          }
          else unknown(markdownURL(raw).replace(/^\.\//, "").replace(/\.md$/i, ""));
        }
      });
      if (out.size) outgoing[path] = [...out];
      if (md.size) markdown[path] = [...md];
      if (missing.size) unresolved[path] = [...missing.values()];
    }
    return { links: { outgoing, markdown, unresolved }, backlinks };
  }

  /** Notes that might link to `paths`. Same rules as Rust `link_sources`. */
  function linkSources(paths: string[]): string[] {
    if (!paths.length) return [];
    const wanted = new Set(paths);
    const sources = new Set<string>();
    const data = linkData(wanted);
    for (const path of paths) for (const hit of data.backlinks[path] ?? []) sources.add(hit.from);
    const needles = [...new Set(paths.filter((path) => /\.md$/i.test(path)).flatMap((path) => linkSpellings(noteName(path)).map((s) => s.toLowerCase())))];
    if (needles.length) {
      for (const [path, f] of files) {
        if (sources.has(path) || !/\.md$/i.test(path) || isBinary(f.content)) continue;
        const lower = f.content.toLowerCase();
        if (needles.some((needle) => lower.includes(needle))) sources.add(path);
      }
    }
    return [...sources].filter((path) => /\.md$/i.test(path)).sort();
  }

  const commands: Record<string, (a: any) => unknown> = {
    open_vault: ({ path }) => persistVault(String(path ?? "")),
    // A new folder name only. The parent and "already exists" checks that
    // touch the disk live in the Rust command; here a path is refused when it
    // is empty, the sample vault, the vault already open, or one this tab
    // already created. The file list changes on the next load, not this one.
    create_vault: ({ path }) => {
      const trimmed = String(path ?? "").trim();
      if (!trimmed) throw new Error("empty path");
      if (trimmed === SAMPLE_PATH || trimmed === vault.path || createdVaults().includes(trimmed)) {
        throw new Error(`already exists: ${trimmed}`);
      }
      const info = persistVault(trimmed);
      try {
        sessionStorage.setItem(CREATED_KEY, JSON.stringify([...createdVaults(), trimmed]));
      } catch {
        // not remembered
      }
      return info;
    },
    last_vault: () => ({ path: vault.path, name: vault.name }),
    list_files: () => listFiles(),
    read_note: ({ path }) => need(path).content,
    read_file_bytes: ({ path }) => {
      if (!/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(path) || path.split("/").includes("..")) throw new Error(`not an image: ${path}`);
      const content = need(path).content;
      const binary = isBinary(content) ? base64ToBytes(content.slice(BYTE_MARK.length)) : null;
      return binary ?? imageBytes(content);
    },
    write_file_bytes: ({ path, bytes }) => {
      const why = badPath(String(path ?? ""));
      if (why) throw new Error(`${why}: ${path}`);
      if (files.has(path) || listFiles().some((e) => e.path === path)) throw new Error(`already exists: ${path}`);
      const raw = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes as number[]);
      if (raw.length > BYTE_MAX) throw new Error(`too large to save: ${path}`);
      put(path, BYTE_MARK + bytesToBase64(raw));
      for (const dir of [...emptyDirs]) if (path.startsWith(dir + "/")) emptyDirs.delete(dir);
      return entry(path);
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
      keepEmptyParents(from);
    },
    // `permanent` makes no difference here: the mock has no .trash.
    delete_path: ({ path }) => {
      const under = (p: string) => p === path || p.startsWith(path + "/");
      for (const p of [...files.keys()]) if (under(p)) files.delete(p);
      for (const d of [...emptyDirs]) if (under(d)) emptyDirs.delete(d);
      keepEmptyParents(path);
    },
    search: ({ query, limit }) => search(query, limit),
    search_notes: ({ query, matchCase }) => searchNotes(query, matchCase),
    search_lines: ({ query, matchCase, paths, limit }) => searchLines(query, matchCase, paths, limit),
    search_match: ({ queries }) => {
      const source = searchFiles();
      return queries.map((query: string) => Object.keys(matchVault(source, query) ?? {}).sort(pathOrder));
    },
    link_index: () => linkData().links,
    backlinks: ({ paths }) => paths.length ? linkData(new Set(paths)).backlinks : {},
    link_sources: ({ paths }) => linkSources(paths),
    properties: ({ paths }) => {
      const out: Record<string, NoteProperties> = {};
      for (const path of (paths as string[] | null) ?? [...files.keys()]) {
        if (!/\.md$/i.test(path)) continue;
        const split = splitFrontmatter(files.get(path)?.content ?? "");
        const props = split && readProperties(split.lines);
        if (props) out[path] = { props, lines: split!.lines };
      }
      return out;
    },
    frontmatter: ({ paths }) => {
      const out: Record<string, string> = {};
      for (const path of (paths as string[] | null) ?? [...files.keys()]) {
        const lines = path.endsWith(".md") ? files.get(path)?.content.split("\n") : undefined;
        const close = lines && lines[0].trim() === "---" ? lines.findIndex((l, i) => i > 0 && l.trim() === "---") : -1;
        if (close > 0 && close <= 2000) out[path] = lines!.slice(0, close + 1).join("\n");
      }
      return out;
    },
    tags: ({ paths }) => {
      const out: Record<string, string[]> = {};
      for (const path of (paths as string[] | null) ?? [...files.keys()]) {
        const content = /\.md$/i.test(path) ? files.get(path)?.content : undefined;
        const tags = content ? tagsInText(content) : [];
        if (tags.length) out[path] = tags;
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
