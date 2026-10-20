// Which font families are installed, for the font settings' suggestions.
// Fonts are only ever local system fonts chosen by name; nothing is
// downloaded. A family counts as installed when text set in it measures
// differently from each generic fallback (a canvas measurement). Measuring
// a font the engine hasn't used yet costs it a font lookup, so the check
// runs in small slices while the app is idle, once, after the Appearance
// section first shows; the suggestions fill in when it is done.

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
let waiting: ((fonts: string[]) => void)[] = [];

const idle = (fn: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 500 }) : setTimeout(fn, 16));

/** Calls back with the installed candidates (at once if already known). */
export function installedFonts(done: (fonts: string[]) => void) {
  if (found) return done(found);
  waiting.push(done);
  if (waiting.length > 1) return;
  const ctx = document.createElement("canvas").getContext("2d");
  const finish = (fonts: string[]) => {
    found = fonts;
    for (const fn of waiting) fn(fonts);
    waiting = [];
  };
  if (!ctx) return finish([]);
  const sample = "mmmmmmmmmmlliWWQ@#0123456789";
  const width = (family: string) => {
    ctx.font = `48px ${family}`;
    return ctx.measureText(sample).width;
  };
  const generics = ["monospace", "serif", "sans-serif"];
  const base = generics.map(width);
  const out: string[] = [];
  let i = 0;
  const slice = () => {
    const end = performance.now() + 6;
    while (i < CANDIDATES.length && performance.now() < end) {
      const name = CANDIDATES[i++];
      if (generics.some((g, j) => width(`"${name}", ${g}`) !== base[j])) out.push(name);
    }
    if (i < CANDIDATES.length) idle(slice);
    else finish(out);
  };
  idle(slice);
}
