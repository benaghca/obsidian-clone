/* Folio colour themes. Each palette has a light and a dark variant; the light/dark
 * mode setting picks which one applies. Colours are the palettes' published values. */
'use strict';

window.FolioThemes = (() => {
  // bg: note area, bg2: sidebars/panels, bg3: raised controls, hover, border,
  // text, muted, faint, accent, then the palette's named hues.
  const P = (bg, bg2, bg3, hover, border, text, muted, faint, accent, red, orange, yellow, green, blue, purple, cyan) =>
    ({ bg, bg2, bg3, hover, border, text, muted, faint, accent, red, orange, yellow, green, blue, purple, cyan });

  const latte = P('#eff1f5', '#e6e9ef', '#dce0e8', '#ccd0da', '#ccd0da', '#4c4f69', '#6c6f85', '#9ca0b0', '#8839ef', '#d20f39', '#fe640b', '#df8e1d', '#40a02b', '#1e66f5', '#8839ef', '#179299');
  const THEMES = [
    { id: 'default', name: 'Folio (default)' },
    {
      id: 'catppuccin-mocha', name: 'Catppuccin Mocha', light: latte,
      dark: P('#1e1e2e', '#181825', '#313244', '#45475a', '#313244', '#cdd6f4', '#a6adc8', '#6c7086', '#cba6f7', '#f38ba8', '#fab387', '#f9e2af', '#a6e3a1', '#89b4fa', '#cba6f7', '#94e2d5'),
    },
    {
      id: 'catppuccin-macchiato', name: 'Catppuccin Macchiato', light: latte,
      dark: P('#24273a', '#1e2030', '#363a4f', '#494d64', '#363a4f', '#cad3f5', '#a5adcb', '#6e738d', '#c6a0f6', '#ed8796', '#f5a97f', '#eed49f', '#a6da95', '#8aadf4', '#c6a0f6', '#8bd5ca'),
    },
    {
      id: 'catppuccin-frappe', name: 'Catppuccin Frappé', light: latte,
      dark: P('#303446', '#292c3c', '#414559', '#51576d', '#414559', '#c6d0f5', '#a5adce', '#737994', '#ca9ee6', '#e78284', '#ef9f76', '#e5c890', '#a6d189', '#8caaee', '#ca9ee6', '#81c8be'),
    },
    {
      id: 'everforest', name: 'Everforest',
      light: P('#fdf6e3', '#f4f0d9', '#efebd4', '#e6e2cc', '#e0dcc7', '#5c6a72', '#829181', '#a6b0a0', '#8da101', '#f85552', '#f57d26', '#dfa000', '#8da101', '#3a94c5', '#df69ba', '#35a77c'),
      dark: P('#2d353b', '#232a2e', '#343f44', '#3d484d', '#3d484d', '#d3c6aa', '#9da9a0', '#7a8478', '#a7c080', '#e67e80', '#e69875', '#dbbc7f', '#a7c080', '#7fbbb3', '#d699b6', '#83c092'),
    },
    {
      id: 'gruvbox', name: 'Gruvbox',
      light: P('#fbf1c7', '#f2e5bc', '#ebdbb2', '#d5c4a1', '#d5c4a1', '#3c3836', '#7c6f64', '#a89984', '#af3a03', '#9d0006', '#af3a03', '#b57614', '#79740e', '#076678', '#8f3f71', '#427b58'),
      dark: P('#282828', '#1d2021', '#3c3836', '#504945', '#3c3836', '#ebdbb2', '#a89984', '#7c6f64', '#fe8019', '#fb4934', '#fe8019', '#fabd2f', '#b8bb26', '#83a598', '#d3869b', '#8ec07c'),
    },
    {
      id: 'nord', name: 'Nord',
      light: P('#eceff4', '#e5e9f0', '#d8dee9', '#d8dee9', '#d8dee9', '#2e3440', '#4c566a', '#7b88a1', '#5e81ac', '#bf616a', '#d08770', '#c1a15c', '#8fa876', '#5e81ac', '#b48ead', '#6b9e9d'),
      dark: P('#2e3440', '#272c36', '#3b4252', '#434c5e', '#3b4252', '#d8dee9', '#a3adbf', '#616e88', '#88c0d0', '#bf616a', '#d08770', '#ebcb8b', '#a3be8c', '#81a1c1', '#b48ead', '#8fbcbb'),
    },
    {
      id: 'rose-pine', name: 'Rosé Pine',
      light: P('#faf4ed', '#fffaf3', '#f2e9e1', '#dfdad9', '#dfdad9', '#575279', '#797593', '#9893a5', '#907aa9', '#b4637a', '#d7827e', '#ea9d34', '#286983', '#56949f', '#907aa9', '#56949f'),
      dark: P('#191724', '#1f1d2e', '#26233a', '#403d52', '#26233a', '#e0def4', '#908caa', '#6e6a86', '#c4a7e7', '#eb6f92', '#ebbcba', '#f6c177', '#31748f', '#9ccfd8', '#c4a7e7', '#9ccfd8'),
    },
    {
      id: 'tokyo-night', name: 'Tokyo Night',
      light: P('#e1e2e7', '#d5d6db', '#c4c8da', '#c4c8da', '#c4c8da', '#3760bf', '#6172b0', '#848cb5', '#2e7de9', '#f52a65', '#b15c00', '#8c6c3e', '#587539', '#2e7de9', '#9854f1', '#007197'),
      dark: P('#1a1b26', '#16161e', '#24283b', '#292e42', '#292e42', '#c0caf5', '#a9b1d6', '#565f89', '#7aa2f7', '#f7768e', '#ff9e64', '#e0af68', '#9ece6a', '#7aa2f7', '#bb9af7', '#7dcfff'),
    },
    {
      id: 'dracula', name: 'Dracula',
      light: P('#fffbeb', '#f5f0dc', '#ece5c9', '#e4dcbc', '#e4dcbc', '#1f1f1f', '#635d97', '#8a86a8', '#644ac9', '#cb3a2a', '#a34d14', '#846e15', '#14710a', '#036a96', '#644ac9', '#036a96'),
      dark: P('#282a36', '#21222c', '#343746', '#44475a', '#44475a', '#f8f8f2', '#b6b9d0', '#6272a4', '#bd93f9', '#ff5555', '#ffb86c', '#f1fa8c', '#50fa7b', '#8be9fd', '#bd93f9', '#8be9fd'),
    },
    {
      id: 'solarized', name: 'Solarized',
      light: P('#fdf6e3', '#eee8d5', '#e6dfc8', '#e0d9c1', '#e0d9c1', '#586e75', '#657b83', '#93a1a1', '#268bd2', '#dc322f', '#cb4b16', '#b58900', '#859900', '#268bd2', '#6c71c4', '#2aa198'),
      dark: P('#002b36', '#00252e', '#073642', '#0a4050', '#073642', '#93a1a1', '#839496', '#586e75', '#268bd2', '#dc322f', '#cb4b16', '#b58900', '#859900', '#268bd2', '#6c71c4', '#2aa198'),
    },
  ];

  const VARS = ['--bg', '--bg2', '--bg3', '--bg-hover', '--border', '--text', '--muted', '--faint', '--accent', '--accent-soft', '--link',
    '--unresolved', '--tag-bg', '--tag', '--mark', '--code-bg', '--danger', '--syn-keyword', '--syn-string', '--syn-number', '--syn-type',
    '--syn-prop', '--c-red', '--c-orange', '--c-yellow', '--c-green', '--c-blue', '--c-purple', '--c-cyan'];

  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };

  // Set (or clear, for the default theme) the CSS variables on <html>.
  function apply(id, mode) {
    const root = document.documentElement;
    const t = THEMES.find(x => x.id === id);
    const c = t && t[mode];
    root.dataset.palette = c ? id : 'default';
    if (!c) { for (const v of VARS) root.style.removeProperty(v); return; }
    const dark = mode === 'dark';
    const vals = {
      '--bg': c.bg, '--bg2': c.bg2, '--bg3': c.bg3, '--bg-hover': c.hover, '--border': c.border,
      '--text': c.text, '--muted': c.muted, '--faint': c.faint, '--accent': c.accent,
      '--accent-soft': rgba(c.accent, dark ? 0.18 : 0.12), '--link': c.accent,
      '--unresolved': `color-mix(in srgb, ${c.accent} 55%, ${c.muted})`,
      '--tag-bg': rgba(c.accent, dark ? 0.16 : 0.1), '--tag': c.accent, '--mark': rgba(c.yellow, dark ? 0.3 : 0.4),
      '--code-bg': dark ? c.bg2 : c.bg3, '--danger': c.red,
      '--syn-keyword': c.purple, '--syn-string': c.green, '--syn-number': c.orange, '--syn-type': c.yellow, '--syn-prop': c.blue,
      '--c-red': c.red, '--c-orange': c.orange, '--c-yellow': c.yellow, '--c-green': c.green, '--c-blue': c.blue, '--c-purple': c.purple, '--c-cyan': c.cyan,
    };
    for (const [k, v] of Object.entries(vals)) root.style.setProperty(k, v);
  }

  return { list: THEMES.map(t => ({ id: t.id, name: t.name })), apply, has: id => THEMES.some(t => t.id === id) };
})();
