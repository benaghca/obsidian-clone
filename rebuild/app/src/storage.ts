// Small things remembered in the webview's localStorage, as JSON (on disk in
// the app's data folder; nothing leaves the machine). Storage that is
// missing, full or disabled reads as the fallback and quietly keeps nothing.

/** What was stored under `key`, unchecked; `fallback` if nothing (readable) was. */
export function readStored(key: string, fallback: unknown = null): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

export function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not remembered
  }
}
