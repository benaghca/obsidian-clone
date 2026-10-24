// Where a pasted image or a dropped file is saved, and the embed written for it.
// Obsidian's attachmentFolderPath: "/" is the vault folder (the default),
// "./" is the current note's folder, "./sub" is a subfolder of that, and any
// other value is a folder from the vault root. Names of real files are kept.
// A clipboard image (no name, or the browser's "image.png") is
// "Pasted image YYYYMMDDHHmmss.png". A name that is taken gains " 1", " 2", …
// before the extension. Free of the DOM apart from the File list helpers.

import { formatLink, type LinkStyle, type NoteLike } from "../links/internal";
import { fileName, parentDir, trimSlashes } from "../paths";

const GENERIC = /^image\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const IMAGE_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

const bad = (path: string) => path.split("/").some((p) => !p || p === "." || p === ".." || /[\\:\0]/.test(p));

/** The vault folder ("" at the root) new attachments go in. A path that would climb out falls back to the root. */
export function attachmentDir(notePath: string | null, setting: string): string {
  const raw = setting.trim();
  if (raw === "/" || raw === "") return "";
  if (raw === "./" || raw === ".") return parentDir(notePath ?? "");
  if (raw.startsWith("./")) {
    const sub = trimSlashes(raw.slice(2));
    if (!sub || bad(sub)) return parentDir(notePath ?? "");
    const base = parentDir(notePath ?? "");
    return base ? `${base}/${sub}` : sub;
  }
  const folder = trimSlashes(raw);
  return !folder || bad(folder) ? "" : folder;
}

/** "Pasted image 20261023201500.png", in local time. */
export function pastedImageName(date: Date, ext: string): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `Pasted image ${stamp}.${ext.replace(/^\./, "") || "png"}`;
}

/** The last path segment, or null when it isn't a usable file name. */
export function safeName(name: string): string | null {
  const base = (name.replace(/\\/g, "/").split("/").pop() ?? "").replace(/[\0:]/g, "").trim();
  return !base || base === "." || base === ".." ? null : base;
}

/** A clipboard screenshot, as opposed to a file the user actually named. */
export const genericClipboardName = (name: string) => !name.trim() || GENERIC.test(name.trim());

/** The file name to save: the original, or a pasted-image stamp for a nameless clipboard image. */
export function attachmentName(file: { name: string; type: string }, date: Date): string {
  const given = safeName(file.name);
  if (given && !genericClipboardName(given)) return given;
  const ext = IMAGE_MIME[file.type] ?? (given?.includes(".") ? given.slice(given.lastIndexOf(".") + 1) : "") ?? "png";
  return pastedImageName(date, ext || "png");
}

/** `dir/file`, or `dir/file 1.ext` when that path is already taken (case-insensitive). */
export function uniquePath(dir: string, file: string, taken: Iterable<string>): string {
  const name = fileName(file);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const have = new Set([...taken].map((p) => p.toLowerCase()));
  const join = (n: string) => (dir ? `${dir}/${n}` : n);
  for (let i = 0; i < 1000; i++) {
    const candidate = join(i ? `${stem} ${i}${ext}` : name);
    if (!have.has(candidate.toLowerCase())) return candidate;
  }
  return join(`${stem} ${Date.now()}${ext}`);
}

/** One free vault path per file, in order. Later files see the names chosen for earlier ones. */
export function attachmentPaths(
  notePath: string | null,
  setting: string,
  files: { name: string; type: string }[],
  taken: Iterable<string>,
  now = new Date(),
): string[] {
  const dir = attachmentDir(notePath, setting);
  const have = new Set(taken);
  return files.map((file) => {
    const path = uniquePath(dir, attachmentName(file, now), have);
    have.add(path);
    return path;
  });
}

/** An embed of `path` in the link style the settings ask for (`![[name]]` by default). */
export function embedFor(path: string, from: string | null, files: NoteLike[], style: LinkStyle): string {
  return `!${formatLink(path, from, files, style)}`;
}

/** Files on a paste or drop: the file list, or file items when the list is empty. */
export function clipboardFiles(data: DataTransfer): File[] {
  const listed = [...data.files];
  if (listed.length) return listed;
  const out: File[] = [];
  for (const item of data.items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}
