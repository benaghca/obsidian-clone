// Which font families are installed, for the font settings' suggestions.
// Fonts are only ever local system fonts chosen by name; nothing is
// downloaded. A family counts as installed when text set in it measures
// differently from each generic fallback (a canvas measurement, done once,
// the first time the Appearance section is built).

const CANDIDATES = [
  "Noto Sans", "Noto Serif", "Noto Sans Mono", "Inter", "Roboto", "Roboto Mono", "Open Sans", "Lato", "Source Sans 3",
  "Source Sans Pro", "Source Serif 4", "Source Code Pro", "IBM Plex Sans", "IBM Plex Serif", "IBM Plex Mono", "Fira Sans",
  "Fira Code", "Fira Mono", "JetBrains Mono", "Cascadia Code", "Cascadia Mono", "Hack", "Ubuntu", "Ubuntu Mono", "Cantarell",
  "DejaVu Sans", "DejaVu Serif", "DejaVu Sans Mono", "Liberation Sans", "Liberation Serif", "Liberation Mono", "Helvetica",
  "Helvetica Neue", "Arial", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Times New Roman", "Palatino", "Garamond",
  "EB Garamond", "Merriweather", "Literata", "Charter", "Iosevka", "Menlo", "Monaco", "Consolas", "Courier New",
  "SF Pro Text", "SF Mono", "Segoe UI", "Atkinson Hyperlegible", "Lexend", "Montserrat", "Nunito", "Work Sans",
  "Geist", "Geist Mono", "Adwaita Sans", "Adwaita Mono", "Caskaydia Cove Nerd Font", "JetBrainsMono Nerd Font",
];

let found: string[] | null = null;

export function installedFonts(): string[] {
  if (found) return found;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return (found = []);
  const sample = "mmmmmmmmmmlliWWQ@#0123456789";
  const width = (family: string) => {
    ctx.font = `48px ${family}`;
    return ctx.measureText(sample).width;
  };
  const generics = ["monospace", "serif", "sans-serif"];
  const base = generics.map(width);
  found = CANDIDATES.filter((name) => generics.some((g, i) => width(`"${name}", ${g}`) !== base[i]));
  return found;
}
