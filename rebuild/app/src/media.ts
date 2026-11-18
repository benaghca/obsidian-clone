// Audio, video, and PDF files. The extensions and the header check match
// `read_file_bytes` in src-tauri (vault.rs): a spoofed extension is not enough.

export type MediaKind = "audio" | "video" | "pdf";

const AUDIO = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;
const VIDEO = /\.(mp4|m4v|mov|webm|ogv)$/i;
const PDF = /\.pdf$/i;

const MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  pdf: "application/pdf",
};

/** What kind of file `path` is, from its extension, or null. */
export function mediaKind(path: string): MediaKind | null {
  if (AUDIO.test(path)) return "audio";
  if (VIDEO.test(path)) return "video";
  if (PDF.test(path)) return "pdf";
  return null;
}

/** The blob type for a media or PDF file. Never a script type. */
export function mediaMime(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const ext = dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

export const MEDIA_PLAY_FAIL = "This file can't be played here.";

/** What a failed byte read shows. A file over the cap says so; anything else is not shown. */
export function mediaFailText(err: unknown, kind: MediaKind): string {
  const msg = typeof err === "string" ? err : err instanceof Error ? err.message : "";
  if (msg.includes("too large")) return "Too large to show.";
  return kind === "pdf" ? "This PDF can't be shown." : "This file can't be shown.";
}

function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** Markup or a script, even with a media extension. */
function looksLikeActive(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  if (i >= bytes.length) return false;
  return bytes[i] === 0x3c || (bytes[i] === 0x23 && bytes[i + 1] === 0x21);
}

function starts(bytes: Uint8Array, text: string, at = 0): boolean {
  if (bytes.length < at + text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

function isFtyp(bytes: Uint8Array): boolean {
  return starts(bytes, "ftyp", 4);
}

function isQuickTime(bytes: Uint8Array): boolean {
  return ["moov", "mdat", "wide", "free", "skip", "pnot"].some((atom) => starts(bytes, atom, 4));
}

function isMp3(bytes: Uint8Array): boolean {
  return starts(bytes, "ID3") || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
}

function isAdts(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
}

function isWav(bytes: Uint8Array): boolean {
  return starts(bytes, "RIFF") && starts(bytes, "WAVE", 8);
}

function isEbml(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

/**
 * True when `bytes` really are the audio, video, or PDF that `path` names.
 * A script, or a header for a different type, is false.
 */
export function mediaBytesMatch(path: string, bytes: Uint8Array): boolean {
  if (!mediaKind(path) || looksLikeActive(bytes)) return false;
  switch (extOf(path)) {
    case "pdf":
      return starts(bytes, "%PDF");
    case "mp3":
      return isMp3(bytes);
    case "wav":
      return isWav(bytes);
    case "flac":
      return starts(bytes, "fLaC");
    case "ogg":
    case "oga":
    case "opus":
    case "ogv":
      return starts(bytes, "OggS");
    case "aac":
      return isAdts(bytes) || isFtyp(bytes);
    case "m4a":
    case "mp4":
    case "m4v":
    case "mov":
      return isFtyp(bytes) || isQuickTime(bytes);
    case "webm":
      return isEbml(bytes);
    default:
      return false;
  }
}
