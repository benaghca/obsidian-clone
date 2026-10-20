// The accent colour (Settings → Appearance → Accent color) as the CSS
// variables theme.css builds its accent tokens from. Free of the DOM.

/** "#rrggbb" to hue (0–360), saturation and lightness (0–100). */
export function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, Math.round(l * 100)];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(((h * 60) + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Grove's teal (#27867a), the accent when none is chosen. */
export const DEFAULT_ACCENT = "#27867a";

/**
 * The accent's CSS variables. The light theme uses the colour as chosen
 * (darker on hover); the dark theme lifts it so links and toggles keep their
 * contrast on a dark background, as Obsidian's dark theme does.
 */
export function accentVars(hex: string): Record<string, string> {
  const [h, s, l] = hexToHsl(hex || DEFAULT_ACCENT);
  const darkText = clamp(Math.max(l * 1.4, 50), 50, 78);
  return {
    "--accent-h": String(h),
    "--accent-s": `${s}%`,
    "--accent-l": `${l}%`,
    "--accent-l-hover": `${Math.round(l * 0.82)}%`,
    "--accent-l-dark": `${Math.round(clamp(l * 1.15, 36, 66))}%`,
    "--accent-l-dark-text": `${Math.round(darkText)}%`,
    "--accent-l-dark-hover": `${Math.round(Math.min(darkText + 8, 86))}%`,
  };
}
