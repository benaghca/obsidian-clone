// Shared by note embeds (W2) and canvas link cards (W3).
// A frame is sandboxed and its origin is registered before it navigates.
// Nothing here names a host: the address comes from the note or the card.

import { api } from "../api";

/** How an embedded page loads. Always is the default Chris chose. */
export type WebEmbedMode = "off" | "click" | "always";

export const WEB_EMBED_DEFAULT: WebEmbedMode = "always";

/** Cinder stores "auto" for always. Anything else falls back to the default. */
export function webEmbedMode(value: unknown): WebEmbedMode {
  if (value === "off" || value === "click" || value === "always") return value;
  if (value === "auto") return "always";
  return WEB_EMBED_DEFAULT;
}

/** No top navigation, no popups, no camera, microphone, location, or clipboard. */
export const WEB_FRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms";

export interface WebFrameTarget {
  /** Absolute page URL for the frame's src. */
  href: string;
  /** Origin form for allow_frame_origin: scheme, host, and a non-default port. */
  origin: string;
}

/**
 * An http(s) page a frame may load. Userinfo, other schemes, and a missing
 * host are refused. The origin matches the form the Rust guard stores.
 */
export function webFrameTarget(raw: string): WebFrameTarget | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || !url.hostname) return null;
  // "null" is an opaque origin. An http(s) URL with a host does not produce one.
  if (url.origin === "null") return null;
  return { href: url.href, origin: url.origin };
}

/** Sandbox, no-referrer, lazy, and no permission policy. Does not set src. */
export function prepareWebFrame(frame: HTMLIFrameElement, title: string) {
  frame.setAttribute("sandbox", WEB_FRAME_SANDBOX);
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("loading", "lazy");
  frame.removeAttribute("allow");
  frame.title = title || "Embedded page";
}

/**
 * Register the origin, then point the frame at the page.
 * `alive` is false once the card dropped the frame, so a late reply cannot navigate it.
 */
export async function armWebFrame(frame: HTMLIFrameElement, target: WebFrameTarget, alive: () => boolean) {
  prepareWebFrame(frame, frame.title || target.origin);
  await api.allowFrameOrigin(target.origin);
  if (!alive() || !frame.isConnected) return;
  frame.src = target.href;
}
