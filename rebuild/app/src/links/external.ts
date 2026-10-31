// Which links may leave the app. Only these schemes are ever handed to the
// system opener (the Tauri capability enforces the same list).

const EXTERNAL = /^(?:https?:\/\/[^\s/]|mailto:[^\s])/i;

/** True for http(s) URLs with a host and for mailto: links. */
export const isExternalUrl = (url: string) => EXTERNAL.test(url.trim());

/** True for http(s) URLs: things that would be fetched if loaded. */
export const isRemoteUrl = (url: string) => /^https?:\/\//i.test(url.trim());

/** The whole string is one http(s) URL with a host. Empty when it is not. */
export function loneWebUrl(text: string): string {
  const url = text.trim();
  return /^https?:\/\/[^\s/]\S*$/i.test(url) ? url : "";
}

/** True for a link destination with no scheme ("Note.md", "../Folder/Note"): a link to a note. */
export const isNotePath = (href: string) => !/^[a-z][a-z0-9+.-]*:/i.test(href.trim()) && !href.trim().startsWith("#");
