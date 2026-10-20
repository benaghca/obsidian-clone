// Runs before the first paint (a plain blocking script in <head>): puts the
// last used colour scheme, accent and fonts on <html>, so the app never
// flashes the wrong theme while it starts. The app keeps this copy up to
// date (settings/appearance.ts); the vault's own .grove/appearance.json is
// applied once the vault is open. Local storage only; nothing else.
(function () {
  var root = document.documentElement;
  var theme = "system";
  try {
    var saved = JSON.parse(localStorage.getItem("grove.appearance") || "null");
    if (saved && typeof saved === "object") {
      if (saved.theme === "light" || saved.theme === "dark") theme = saved.theme;
      var vars = saved.vars || {};
      for (var name in vars) {
        if (/^--[a-z0-9-]+$/.test(name) && typeof vars[name] === "string") root.style.setProperty(name, vars[name]);
      }
    }
  } catch (e) {
    // no storage: the system's scheme and Grove's defaults
  }
  if (theme === "system") theme = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  root.classList.add("theme-" + theme);
})();
