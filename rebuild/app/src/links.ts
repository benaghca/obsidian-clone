// Which links may leave the app. Only these schemes are ever handed to the
// system opener (the Tauri capability enforces the same list).

const EXTERNAL = /^(?:https?:\/\/[^\s/]|mailto:[^\s])/i;

/** True for http(s) URLs with a host and for mailto: links. */
export const isExternalUrl = (url: string) => EXTERNAL.test(url.trim());

/** True for http(s) URLs: things that would be fetched if loaded. */
export const isRemoteUrl = (url: string) => /^https?:\/\//i.test(url.trim());
