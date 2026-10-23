// Settings → Files and links → Excluded files. As in Obsidian, each filter
// is a folder or file path (everything under it is excluded) or a regular
// expression between slashes ("/^Archive|draft/"). Excluded notes are left
// out of the quick switcher, search, link suggestions, unlinked mentions and
// the tags view. Free of the DOM.

type ExcludeTest = (path: string) => boolean;

export function excluder(filters: readonly string[]): ExcludeTest {
  const prefixes: string[] = [];
  const patterns: RegExp[] = [];
  for (const raw of filters) {
    const f = raw.trim();
    if (!f) continue;
    const re = /^\/(.+)\/([imsu]*)$/.exec(f);
    if (re) {
      try {
        patterns.push(new RegExp(re[1], re[2]));
      } catch {
        // an invalid pattern excludes nothing
      }
    } else prefixes.push(f.replace(/^\/+/, ""));
  }
  if (!prefixes.length && !patterns.length) return () => false;
  return (path) =>
    prefixes.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p || path === `${p}.md` || path.startsWith(`${p}/`))) ||
    patterns.some((re) => re.test(path));
}
