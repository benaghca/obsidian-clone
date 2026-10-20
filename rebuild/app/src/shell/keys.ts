// How modifier keys are written in hints, per platform (Obsidian writes
// "ctrl ↵" on Linux and Windows, "⌘ ↵" on macOS).

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? "⌘" : "ctrl";
export const altKey = isMac ? "⌥" : "alt";
