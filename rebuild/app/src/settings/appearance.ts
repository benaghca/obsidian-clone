// Settings → Appearance and Interface, applied to the page: the colour
// scheme (a class on <html>), the accent and fonts (CSS variables on <html>),
// the text size, the zoom level, and the ribbon, tab title bar, inline title
// and readable line length (classes on <body>). Each change is a few style
// writes in one go, so it costs one style recalc and no editor is touched.
// A copy of the scheme and variables is kept in localStorage for
// public/boot.js, which puts them back before the first paint.

import { isTauri } from "../api";
import { accentVars } from "./accent";
import type { SettingsOf } from "./schema";

type Appearance = SettingsOf<"appearance.json">;
type App = SettingsOf<"app.json">;

const BOOT_KEY = "grove.appearance";
const dark = window.matchMedia?.("(prefers-color-scheme: dark)");

const family = (name: string, fallback: string) => (name ? `"${name}", var(${fallback})` : `var(${fallback})`);

/** The zoom factor for Obsidian's zoom level (1.2 to that power). */
export const zoomFactor = (level: number) => Math.pow(1.2, level);

let themeSetting: Appearance["theme"] = "system";
let applied: Partial<Appearance> = {};

function resolvedTheme(): "light" | "dark" {
  return themeSetting === "system" ? (dark?.matches ? "dark" : "light") : themeSetting;
}

function applyTheme() {
  const root = document.documentElement;
  const theme = resolvedTheme();
  if (root.classList.contains(`theme-${theme}`)) return;
  root.classList.toggle("theme-dark", theme === "dark");
  root.classList.toggle("theme-light", theme === "light");
}
// "Adapt to system" follows the system's scheme while the app runs.
dark?.addEventListener("change", () => {
  if (themeSetting === "system") applyTheme();
});

/** The scheme on screen right now. */
export const currentTheme = () => resolvedTheme();

async function setZoom(factor: number) {
  if (isTauri) {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(factor);
  } else {
    // The browser preview has no webview zoom; CSS zoom stands in for it.
    document.documentElement.style.zoom = factor === 1 ? "" : String(factor);
  }
}

/** Apply the appearance settings that differ from what is on screen. */
export function applyAppearance(a: Appearance) {
  const root = document.documentElement;
  const vars: Record<string, string> = {
    ...accentVars(a.accentColor),
    "--font-interface": family(a.interfaceFontFamily, "--font-interface-default"),
    "--font-text": a.textFontFamily ? family(a.textFontFamily, "--font-interface-default") : "var(--font-interface)",
    "--font-monospace": family(a.monospaceFontFamily, "--font-monospace-default"),
    "--font-text-size": `${a.baseFontSize}px`,
  };
  for (const [name, value] of Object.entries(vars)) {
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  }
  themeSetting = a.theme;
  applyTheme();
  document.body.classList.toggle("is-ribbon-hidden", !a.showRibbon);
  document.body.classList.toggle("is-view-header-hidden", !a.showViewHeader);
  if (applied.zoomLevel !== a.zoomLevel) void setZoom(zoomFactor(a.zoomLevel)).catch((err) => console.warn("Could not zoom", err));
  applied = { ...a };
  try {
    localStorage.setItem(BOOT_KEY, JSON.stringify({ theme: a.theme, vars }));
  } catch {
    // not remembered for the next start: it starts with defaults, then applies the vault's
  }
}

/** The app.json settings that are only page classes. */
export function applyPageSettings(app: App) {
  document.body.classList.toggle("is-readable-line-length-off", !app.readableLineLength);
  document.body.classList.toggle("is-inline-title-hidden", !app.showInlineTitle);
}
